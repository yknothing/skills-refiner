import {
  BATCH_ERROR_CODES,
  CLEANUP_BATCH_MAX_ITEMS,
  SCHEMAS,
  buildBatchBinding,
  buildBatchError,
  buildBatchPlan,
  buildBatchResult,
  buildInitialBatchState,
  canonicalJson,
  deriveBatchSummaryOverallStatus,
  sha256Json,
  transactionStorageKey,
  validateBatchBinding,
  validateBatchPlan,
  validateBatchSummary,
  validateBatchState,
  validatePlan,
  validateTransactionBatchStatus,
  validateTransactionResult,
} from './cleanup-contract.mjs';
import {
  MacosAdapterError,
  acquireBatchLock,
  acquireTransactionLock,
  advanceBatchStateRecord,
  advanceTransactionStateRecord,
  advanceTransactionStateUnderBatchLease,
  discoverTransactionRecords,
  initializeBatchRecords,
  initializeBatchTransactionRecords,
  initializeTransactionRecords,
  isolateStaleBatchLock,
  isolateStaleTransactionLock,
  probeBatchRecords,
  probeBatchTransactionRecords,
  probeTransactionKind,
  probeTransactionRecords,
  reconcileTransactionLocation,
  releaseBatchLock,
  releaseTransactionLock,
  renameExclusive,
  restoreExclusive,
} from './cleanup-macos.mjs';

const TRANSITIONS = new Map([
  ['PLANNED', new Set(['CONFIRMED', 'BLOCKED', 'ABORTED'])],
  ['CONFIRMED', new Set(['PREPARED', 'BLOCKED', 'ABORTED'])],
  ['PREPARED', new Set(['APPLYING', 'BLOCKED', 'ABORTED'])],
  ['APPLYING', new Set(['COMMITTED', 'RECOVERY_REQUIRED'])],
  ['COMMITTED', new Set(['RESTORE_PREPARED'])],
  ['RESTORE_PREPARED', new Set(['RESTORING', 'RECOVERY_REQUIRED'])],
  ['RESTORING', new Set(['RESTORED', 'RECOVERY_REQUIRED'])],
]);

export const APPLY_DURABLE_STATES = Object.freeze([
  'PLANNED',
  'CONFIRMED',
  'PREPARED',
  'APPLYING',
  'COMMITTED',
]);

export const RESTORE_DURABLE_STATES = Object.freeze([
  'RESTORE_PREPARED',
  'RESTORING',
  'RESTORED',
]);

export { CLEANUP_BATCH_MAX_ITEMS };
const NATIVE_HELPER_MAX_INPUT_BYTES = 1024 * 1024;

function publicationFaultPhases(state) {
  const name = state.toLowerCase();
  return [`before_state_${name}`, `after_state_${name}`];
}

export const APPLY_FAULT_PHASES = Object.freeze([
  ...publicationFaultPhases(APPLY_DURABLE_STATES[0]),
  'before_lock_acquire',
  'after_lock_acquire',
  ...APPLY_DURABLE_STATES.slice(1, -1).flatMap(publicationFaultPhases),
  'before_move',
  'after_move',
  'before_postcondition_verify',
  'after_postcondition_verify',
  ...publicationFaultPhases(APPLY_DURABLE_STATES.at(-1)),
]);

export const RESTORE_FAULT_PHASES = Object.freeze([
  'before_restore_lock_acquire',
  'after_restore_lock_acquire',
  ...RESTORE_DURABLE_STATES.slice(0, -1).flatMap(publicationFaultPhases),
  'before_restore_move',
  'after_restore_move',
  'before_restore_postcondition_verify',
  'after_restore_postcondition_verify',
  ...publicationFaultPhases(RESTORE_DURABLE_STATES.at(-1)),
]);

export class CleanupTransactionError extends Error {
  constructor(code, message = 'cleanup transaction failed', status = 'blocked') {
    super(message);
    this.name = 'CleanupTransactionError';
    this.code = code;
    this.status = status;
  }
}

export class CleanupBatchError extends CleanupTransactionError {
  constructor(code, status, batch = {}) {
    super(code, 'cleanup batch failed', status);
    this.name = 'CleanupBatchError';
    Object.assign(this, batch);
  }
}

function transactionHasMutated(transaction, location) {
  return transaction !== undefined && (
    ['COMMITTED', 'RESTORE_PREPARED', 'RESTORING', 'RESTORED'].includes(
      transaction.state.state,
    )
    || ['quarantine', 'rehydrated'].includes(location)
  );
}

function contextualizeTransactionError(error, {
  command,
  transaction,
  location,
  mutationOccurred = false,
  mutationOutcome = mutationOccurred ? 'unknown' : 'unchanged',
} = {}) {
  const transactionError = normalizedTransactionError(error);
  if (transactionError === null) return error;
  const state = transaction?.state?.state;
  const transactionId = transaction?.manifest?.transaction_id;
  const currentMutation = transactionError.mutationOccurred ?? mutationOccurred;
  const historicalMutation = transactionHasMutated(transaction, location) || currentMutation;
  const committedStates = new Set(['COMMITTED', 'RESTORE_PREPARED', 'RESTORING']);
  const commandContext = {
    command,
    mutationOccurred,
    mutationOutcome,
  };
  for (const [key, value] of Object.entries(commandContext)) {
    if (value !== undefined && !Object.hasOwn(transactionError, key)) {
      transactionError[key] = value;
    }
  }
  if (transaction !== undefined) {
    transactionError.transactionId = transactionId;
    transactionError.transactionState = state;
    if (location !== undefined) transactionError.transactionLocation = location;
    transactionError.transactionHasMutated = historicalMutation;
    transactionError.committedTransactionIds = transactionId !== undefined
        && committedStates.has(state)
      ? [transactionId]
      : [];
  } else {
    if (!Object.hasOwn(transactionError, 'transactionHasMutated')) {
      transactionError.transactionHasMutated = currentMutation;
    }
    if (!Object.hasOwn(transactionError, 'committedTransactionIds')) {
      transactionError.committedTransactionIds = [];
    }
  }
  return transactionError;
}

export function assertTransactionTransition(current, next) {
  if (!TRANSITIONS.get(current)?.has(next)) {
    throw new CleanupTransactionError('invalid_state_transition');
  }
  return next;
}

function fail(code, status = 'blocked') {
  throw new CleanupTransactionError(code, 'cleanup transaction failed', status);
}

function normalizedTransactionError(error) {
  if (error instanceof CleanupTransactionError) return error;
  if (error instanceof MacosAdapterError) {
    const normalized = new CleanupTransactionError(
      error.reason,
      'cleanup transaction failed',
      error.code === 'recovery_required' ? 'recovery_required' : error.code,
    );
    normalized.mutationOccurred = error.mutationMayHaveOccurred === true;
    normalized.mutationOutcome = error.mutationMayHaveOccurred === true
      ? 'unknown'
      : 'unchanged';
    return normalized;
  }
  return null;
}

function joinMutationTruth(command, ...truths) {
  if (!['apply', 'undo'].includes(command)) {
    throw new TypeError('mutation truth command is unsupported');
  }
  const unknown = truths.some((truth) => truth?.mutationOutcome === 'unknown');
  const mutationOccurred = unknown || truths.some((truth) => (
    truth?.mutationOccurred === true
      || ['moved', 'restored'].includes(truth?.mutationOutcome)
  ));
  if (unknown) return { mutationOccurred: true, mutationOutcome: 'unknown' };
  if (mutationOccurred) {
    return {
      mutationOccurred: true,
      mutationOutcome: command === 'undo' ? 'restored' : 'moved',
    };
  }
  return { mutationOccurred: false, mutationOutcome: 'unchanged' };
}

function releaseAfterDeterministicFailure(transaction, owner, error) {
  if (!['blocked', 'conflict'].includes(error.status)) return;
  try {
    releaseTransactionLock({
      home: transaction.home,
      transactionId: transaction.manifest.transaction_id,
      planHash: transaction.manifest.plan_hash,
      owner,
      executionIdentity: transaction.manifest.execution_identity,
    });
  } catch (releaseError) {
    if (releaseError instanceof MacosAdapterError) {
      fail(releaseError.reason, 'recovery_required');
    }
    throw releaseError;
  }
}

function recordRecoveryRequired(transaction, owner, code) {
  const recovered = advanceTransactionState(transaction, 'RECOVERY_REQUIRED', { owner });
  try {
    releaseTransactionLock({
      home: recovered.home,
      transactionId: recovered.manifest.transaction_id,
      planHash: recovered.manifest.plan_hash,
      owner,
      executionIdentity: recovered.manifest.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, 'recovery_required');
    throw error;
  }
  fail(code, 'recovery_required');
}

function recoverAfterCurrentMutation(transaction, owner, error) {
  let recovered = transaction;
  try {
    if (['APPLYING', 'RESTORE_PREPARED', 'RESTORING'].includes(transaction.state.state)) {
      recovered = advanceTransactionState(transaction, 'RECOVERY_REQUIRED', { owner });
    }
    releaseTransactionLock({
      home: recovered.home,
      transactionId: recovered.manifest.transaction_id,
      planHash: recovered.manifest.plan_hash,
      owner,
      executionIdentity: recovered.manifest.execution_identity,
    });
    recovered = { ...recovered, lock: null };
  } catch {
    try {
      const records = discoverTransactionRecords({
        home: transaction.home,
        transactionId: transaction.manifest.transaction_id,
      });
      const observed = transactionFromRecords(
        transaction.home,
        records,
        transaction.manifest.transaction_id,
      );
      if (canonicalJson(observed.lock) === canonicalJson(owner)
          && ['COMMITTED', 'RECOVERY_REQUIRED', 'RESTORED'].includes(observed.state.state)) {
        releaseTransactionLock({
          home: observed.home,
          transactionId: observed.manifest.transaction_id,
          planHash: observed.manifest.plan_hash,
          owner,
          executionIdentity: observed.manifest.execution_identity,
        });
        recovered = { ...observed, lock: null };
      }
    } catch {
      // Keep an uncertain lease in place; process death makes it stale and reconcilable.
    }
  }
  return {
    transaction: recovered,
    error: new CleanupTransactionError(
      error.code,
      'cleanup transaction failed after a current-command mutation',
      'recovery_required',
    ),
  };
}

function itemForTransaction(plan, transactionId) {
  const matches = plan.items.filter((item) => item.transaction_id === transactionId);
  if (matches.length !== 1) fail('transaction_item_mismatch', 'recovery_required');
  return matches[0];
}

function manifestFor(plan, item) {
  const storageKey = transactionStorageKey(item.transaction_id);
  return {
    schema_version: SCHEMAS.transactionManifest,
    transaction_id: item.transaction_id,
    storage_key: storageKey,
    plan_hash: plan.plan_hash,
    item_id: item.item_id,
    item_hash: item.item_hash,
    platform: plan.platform,
    entry_path: item.entry_path,
    active_root: item.active_root,
    entry_kind: item.entry_kind,
    payload_relative_directory: `transactions/${storageKey}/payload`,
    payload_leaf: `entry-${sha256Json({ item_id: item.item_id }).slice('sha256:'.length)}`,
    execution_identity: item.execution_identity,
  };
}

function initialStateFor(plan, item) {
  return {
    schema_version: SCHEMAS.transactionState,
    transaction_id: item.transaction_id,
    plan_hash: plan.plan_hash,
    item_id: item.item_id,
    item_hash: item.item_hash,
    state: 'PLANNED',
    sequence: 0,
    updated_at: plan.created_at,
    lock: null,
    outcome: null,
  };
}

export function assertBatchPlanCapacity(plan) {
  validatePlan(plan);
  if (plan.items.length <= 1) return plan;
  if (plan.items.length > CLEANUP_BATCH_MAX_ITEMS) {
    throw new CleanupBatchError('batch_item_limit_exceeded', 'invalid');
  }
  const batchPlan = buildBatchPlan(plan);
  for (const item of plan.items) {
    const input = [
      plan,
      manifestFor(plan, item),
      initialStateFor(plan, item),
      buildBatchBinding(batchPlan, item.item_id),
    ].map((value) => canonicalJson(value)).join('\n').concat('\n');
    if (Buffer.byteLength(input, 'utf8') > NATIVE_HELPER_MAX_INPUT_BYTES) {
      throw new CleanupBatchError('batch_native_input_limit_exceeded', 'invalid');
    }
  }
  return plan;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateTransactionOwner(owner, manifest) {
  const lockKeys = [
    'nonce',
    'pid',
    'plan_hash',
    'process_start_sec',
    'process_start_usec',
    'transaction_id',
  ];
  return Object.keys(owner).length === lockKeys.length
    && lockKeys.every((key) => Object.hasOwn(owner, key))
    && /^[0-9a-f]{64}$/u.test(owner.nonce ?? '')
    && Number.isSafeInteger(owner.pid) && owner.pid > 0
    && Number.isSafeInteger(owner.process_start_sec) && owner.process_start_sec >= 0
    && Number.isSafeInteger(owner.process_start_usec) && owner.process_start_usec >= 0
    && owner.plan_hash === manifest.plan_hash
    && owner.transaction_id === manifest.transaction_id;
}

function validateBatchOwner(owner, manifest, binding) {
  const lockKeys = [
    'batch_id',
    'nonce',
    'pid',
    'plan_hash',
    'process_start_sec',
    'process_start_usec',
    'scope',
  ];
  return isObject(binding)
    && Object.keys(owner).length === lockKeys.length
    && lockKeys.every((key) => Object.hasOwn(owner, key))
    && owner.scope === 'batch'
    && owner.batch_id === binding.batch_id
    && owner.plan_hash === manifest.plan_hash
    && /^[0-9a-f]{64}$/u.test(owner.nonce ?? '')
    && Number.isSafeInteger(owner.pid) && owner.pid > 0
    && Number.isSafeInteger(owner.process_start_sec) && owner.process_start_sec >= 0
    && Number.isSafeInteger(owner.process_start_usec) && owner.process_start_usec >= 0;
}

function validateState(state, manifest, { ownerScope = 'transaction', binding = null } = {}) {
  const keys = [
    'schema_version',
    'transaction_id',
    'plan_hash',
    'item_id',
    'item_hash',
    'state',
    'sequence',
    'updated_at',
    'lock',
    'outcome',
  ];
  if (!isObject(state) || Object.keys(state).length !== keys.length
      || keys.some((key) => !Object.hasOwn(state, key))
      || state.schema_version !== SCHEMAS.transactionState
      || state.transaction_id !== manifest.transaction_id
      || state.plan_hash !== manifest.plan_hash
      || state.item_id !== manifest.item_id
      || state.item_hash !== manifest.item_hash
      || !Number.isSafeInteger(state.sequence) || state.sequence < 0
      || typeof state.updated_at !== 'string' || state.updated_at.length === 0
      || ![
        ...TRANSITIONS.keys(),
        'BLOCKED',
        'ABORTED',
        'RECOVERY_REQUIRED',
        'RESTORED',
      ].includes(state.state)
      || (state.lock !== null && !isObject(state.lock))
      || (state.outcome !== null && !isObject(state.outcome))) {
    fail('transaction_state_invalid', 'recovery_required');
  }
  if (state.lock !== null) {
    const validOwner = ownerScope === 'batch'
      ? validateBatchOwner(state.lock, manifest, binding)
      : validateTransactionOwner(state.lock, manifest);
    if (!validOwner) {
      fail('transaction_state_invalid', 'recovery_required');
    }
  }
  if (state.outcome !== null) {
    if (Object.keys(state.outcome).length !== 2
        || !Object.hasOwn(state.outcome, 'location')
        || !Object.hasOwn(state.outcome, 'manifest_hash')
        || !['original', 'quarantine'].includes(state.outcome.location)
        || !/^sha256:[0-9a-f]{64}$/u.test(state.outcome.manifest_hash ?? '')) {
      fail('transaction_state_invalid', 'recovery_required');
    }
  }
  canonicalJson(state);
  return state;
}

function validateStoredRecords(records, expectedPlan, transactionId) {
  try {
    validatePlan(records.plan);
  } catch {
    fail('stored_plan_invalid', 'recovery_required');
  }
  const expectedItem = itemForTransaction(expectedPlan, transactionId);
  const storedItem = itemForTransaction(records.plan, transactionId);
  if (records.plan.plan_hash !== expectedPlan.plan_hash
      || records.plan.platform !== expectedPlan.platform
      || storedItem.item_hash !== expectedItem.item_hash) {
    fail('stored_plan_mismatch', 'recovery_required');
  }
  const expectedManifest = manifestFor(records.plan, storedItem);
  if (canonicalJson(records.manifest) !== canonicalJson(expectedManifest)) {
    fail('transaction_manifest_mismatch', 'recovery_required');
  }
  validateState(records.state, expectedManifest);
  return {
    plan: records.plan,
    item: storedItem,
    manifest: records.manifest,
    state: records.state,
  };
}

function validateStoredBatchRecords(records, expectedPlan, batchPlan, transactionId) {
  try {
    validateBatchPlan(batchPlan, expectedPlan);
    validateBatchBinding(records.binding, batchPlan);
  } catch {
    fail('batch_binding_invalid', 'recovery_required');
  }
  if (records.binding.transaction_id !== transactionId) {
    fail('batch_binding_invalid', 'recovery_required');
  }
  try {
    validatePlan(records.plan);
  } catch {
    fail('stored_plan_invalid', 'recovery_required');
  }
  const expectedItem = itemForTransaction(expectedPlan, transactionId);
  const storedItem = itemForTransaction(records.plan, transactionId);
  if (records.plan.plan_hash !== expectedPlan.plan_hash
      || records.plan.platform !== expectedPlan.platform
      || storedItem.item_hash !== expectedItem.item_hash
      || records.binding.item_id !== expectedItem.item_id
      || records.binding.item_hash !== expectedItem.item_hash
      || records.binding.execution_identity_hash !== expectedItem.execution_identity.identity_hash) {
    fail('stored_plan_mismatch', 'recovery_required');
  }
  const expectedManifest = manifestFor(records.plan, storedItem);
  if (canonicalJson(records.manifest) !== canonicalJson(expectedManifest)) {
    fail('transaction_manifest_mismatch', 'recovery_required');
  }
  validateState(records.state, expectedManifest, {
    ownerScope: 'batch',
    binding: records.binding,
  });
  return {
    plan: records.plan,
    item: storedItem,
    manifest: records.manifest,
    state: records.state,
    binding: records.binding,
  };
}

function batchTransactionFromRecords(home, records, expectedPlan, batchPlan, transactionId) {
  return {
    home,
    initialization: 'existing',
    lock: records.lock,
    ...validateStoredBatchRecords(
      records,
      expectedPlan,
      batchPlan,
      transactionId,
    ),
  };
}

function initializeBatchTransaction({
  home,
  plan,
  batchPlan,
  item,
}) {
  const manifest = manifestFor(plan, item);
  const state = initialStateFor(plan, item);
  const binding = buildBatchBinding(batchPlan, item.item_id);
  let initialization;
  try {
    initialization = initializeBatchTransactionRecords({
      home,
      transactionId: item.transaction_id,
      plan,
      manifest,
      state,
      binding,
      executionIdentity: item.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) {
      throw normalizedTransactionError(error);
    }
    throw error;
  }
  let records;
  try {
    records = probeBatchTransactionRecords({
      home,
      transactionId: item.transaction_id,
      executionIdentity: item.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) throw normalizedTransactionError(error);
    throw error;
  }
  return {
    ...batchTransactionFromRecords(home, records, plan, batchPlan, item.transaction_id),
    initialization: initialization.result,
  };
}

export function initializeTransaction({
  home = process.env.HOME,
  plan,
  transactionId,
  confirmation,
} = {}) {
  try {
    validatePlan(plan);
  } catch {
    fail('invalid_plan', 'invalid');
  }
  if (plan.items.length !== 1) fail('single_item_plan_required', 'unsupported');
  if (confirmation !== plan.plan_hash) fail('confirmation_mismatch', 'invalid');
  const item = itemForTransaction(plan, transactionId);
  const manifest = manifestFor(plan, item);
  const state = initialStateFor(plan, item);
  let initialization;
  try {
    initialization = initializeTransactionRecords({
      home,
      transactionId,
      plan,
      manifest,
      state,
      executionIdentity: item.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) {
      fail(error.reason, error.code === 'recovery_required' ? 'recovery_required' : error.code);
    }
    throw error;
  }
  let records;
  try {
    records = probeTransactionRecords({
      home,
      transactionId,
      executionIdentity: item.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, 'recovery_required');
    throw error;
  }
  return {
    home,
    initialization: initialization.result,
    lock: records.lock,
    ...validateStoredRecords(records, plan, transactionId),
  };
}

export function advanceTransactionState(transaction, next, {
  owner,
  outcome = null,
  updatedAt = new Date().toISOString(),
} = {}) {
  if (!transaction || !isObject(transaction.state) || !isObject(transaction.manifest)) {
    fail('transaction_state_invalid', 'recovery_required');
  }
  assertTransactionTransition(transaction.state.state, next);
  if (!owner) fail('state_lease_mismatch', 'recovery_required');
  const nextState = {
    ...transaction.state,
    state: next,
    sequence: transaction.state.sequence + 1,
    updated_at: updatedAt,
    lock: owner,
    outcome,
  };
  validateState(nextState, transaction.manifest);
  let records;
  try {
    records = advanceTransactionStateRecord({
      home: transaction.home,
      transactionId: transaction.manifest.transaction_id,
      planHash: transaction.manifest.plan_hash,
      currentState: transaction.state,
      nextState,
      owner,
      executionIdentity: transaction.manifest.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) {
      fail(error.reason, error.code === 'recovery_required' ? 'recovery_required' : error.code);
    }
    throw error;
  }
  return {
    ...transaction,
    state: validateState(records.state, transaction.manifest),
  };
}

function advanceBatchTransactionState(transaction, next, {
  batchPlan,
  owner,
  outcome = null,
  updatedAt = new Date().toISOString(),
} = {}) {
  if (!transaction || !isObject(transaction.state) || !isObject(transaction.manifest)
      || !isObject(transaction.binding)) {
    fail('transaction_state_invalid', 'recovery_required');
  }
  assertTransactionTransition(transaction.state.state, next);
  if (!owner) fail('state_lease_mismatch', 'recovery_required');
  try {
    validateBatchPlan(batchPlan, transaction.plan);
    validateBatchBinding(transaction.binding, batchPlan);
  } catch {
    fail('batch_binding_invalid', 'recovery_required');
  }
  const nextState = {
    ...transaction.state,
    state: next,
    sequence: transaction.state.sequence + 1,
    updated_at: updatedAt,
    lock: owner,
    outcome,
  };
  validateState(nextState, transaction.manifest, {
    ownerScope: 'batch',
    binding: transaction.binding,
  });
  let records;
  try {
    records = advanceTransactionStateUnderBatchLease({
      home: transaction.home,
      batchId: batchPlan.batch_id,
      itemId: transaction.binding.item_id,
      itemHash: transaction.binding.item_hash,
      executionIdentityHash: transaction.binding.execution_identity_hash,
      transactionId: transaction.binding.transaction_id,
      planHash: transaction.binding.plan_hash,
      batchPlan,
      currentState: transaction.state,
      nextState,
      owner,
      executionIdentity: transaction.manifest.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) {
      throw normalizedTransactionError(error);
    }
    throw error;
  }
  return batchTransactionFromRecords(
    transaction.home,
    records,
    transaction.plan,
    batchPlan,
    transaction.manifest.transaction_id,
  );
}

async function publishNextBatchTransactionState(
  transaction,
  next,
  batchPlan,
  owner,
  fault,
  context,
  outcome = null,
) {
  await faultAt(fault, `before_state_${next.toLowerCase()}`, {
    ...context,
    state: transaction.state.state,
  });
  const advanced = advanceBatchTransactionState(transaction, next, {
    batchPlan,
    owner,
    outcome,
  });
  await faultAt(fault, `after_state_${next.toLowerCase()}`, {
    ...context,
    state: advanced.state.state,
  });
  return advanced;
}

async function faultAt(fault, phase, state) {
  if (typeof fault === 'function') await fault(phase, state);
}

async function publishNextState(transaction, next, owner, fault, outcome = null) {
  await faultAt(fault, `before_state_${next.toLowerCase()}`, transaction.state.state);
  const advanced = advanceTransactionState(transaction, next, { owner, outcome });
  await faultAt(fault, `after_state_${next.toLowerCase()}`, advanced.state.state);
  return advanced;
}

function coherentApplyLocation(state, location) {
  if (['PLANNED', 'CONFIRMED', 'PREPARED'].includes(state)) return location === 'original';
  if (state === 'APPLYING') return ['original', 'quarantine', 'rehydrated'].includes(location);
  if (state === 'COMMITTED') return ['quarantine', 'rehydrated'].includes(location);
  return false;
}

function publicTransactionResult(
  command,
  status,
  transaction,
  location,
  mutationOccurred,
  nextSafeCommand = undefined,
) {
  const committed = transaction.state.state === 'COMMITTED';
  const transactionHasMutated = [
    'COMMITTED',
    'RESTORE_PREPARED',
    'RESTORING',
    'RESTORED',
  ].includes(transaction.state.state) || ['quarantine', 'rehydrated'].includes(location);
  const result = {
    schema_version: SCHEMAS.transaction,
    command,
    status,
    overall_status: status,
    transaction_id: transaction.manifest.transaction_id,
    state: transaction.state.state,
    location,
    mutation_occurred: mutationOccurred,
    mutation_outcome: mutationOccurred ? (command === 'undo' ? 'restored' : 'moved') : 'unchanged',
    transaction_has_mutated: transactionHasMutated,
    committed_transaction_ids: committed ? [transaction.manifest.transaction_id] : [],
  };
  if (nextSafeCommand !== undefined) result.next_safe_command = nextSafeCommand;
  return validateTransactionResult(result);
}

function transactionFromRecords(home, records, transactionId) {
  const validated = validateStoredRecords(records, records.plan, transactionId);
  return {
    home,
    initialization: 'existing',
    lock: records.lock,
    ...validated,
  };
}

function statusForLocation(state, location) {
  if (['PLANNED', 'CONFIRMED', 'PREPARED'].includes(state)) {
    if (location === 'original') return 'ready_to_resume_apply';
    if (location === 'original_drift') return 'drifted';
    return null;
  }
  if (state === 'APPLYING') {
    if (location === 'original') return 'ready_to_resume_apply';
    if (['quarantine', 'rehydrated'].includes(location)) return 'ready_to_finalize_commit';
    return null;
  }
  if (state === 'COMMITTED') {
    if (location === 'quarantine') return 'committed';
    if (location === 'rehydrated') return 'rehydrated';
    return null;
  }
  if (state === 'RESTORE_PREPARED') {
    if (location === 'quarantine') return 'ready_to_resume_undo';
    if (location === 'rehydrated') return 'restore_conflict';
    return null;
  }
  if (state === 'RESTORING') {
    if (location === 'quarantine') return 'ready_to_resume_undo';
    if (location === 'original') return 'ready_to_finalize_restore';
    if (location === 'rehydrated') return 'restore_conflict';
    return null;
  }
  if (state === 'RESTORED' && location === 'original') return 'restored';
  return null;
}

function nextSafeCommandForStatus(status, transaction) {
  const transactionId = transaction.manifest.transaction_id;
  if (status === 'committed' || status === 'ready_to_resume_undo'
      || status === 'ready_to_finalize_restore') {
    return `skills-refiner cleanup undo ${transactionId} --confirm ${transactionId} --json`;
  }
  if (status === 'ready_to_resume_apply' || status === 'ready_to_finalize_commit') {
    return `skills-refiner cleanup apply --plan PLAN_FILE --confirm ${transaction.manifest.plan_hash} --json`;
  }
  if (status === 'drifted') return 'skills-refiner cleanup review --json';
  return null;
}

function observeStatusUnderLease(home, transaction) {
  let owner;
  let observedTransaction;
  let location;
  let observationError;
  try {
    owner = acquireTransactionLock({
      home,
      transactionId: transaction.manifest.transaction_id,
      planHash: transaction.manifest.plan_hash,
      executionIdentity: transaction.manifest.execution_identity,
    });
    const records = discoverTransactionRecords({
      home,
      transactionId: transaction.manifest.transaction_id,
    });
    transaction = transactionFromRecords(home, records, transaction.manifest.transaction_id);
    if (canonicalJson(transaction.lock) !== canonicalJson(owner)) {
      fail('lock_identity_mismatch', 'recovery_required');
    }
    location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
    observedTransaction = transaction;
  } catch (error) {
    const transactionError = normalizedTransactionError(error);
    observationError = transactionError ?? error;
  } finally {
    if (owner !== undefined) {
      try {
        releaseTransactionLock({
          home,
          transactionId: transaction.manifest.transaction_id,
          planHash: transaction.manifest.plan_hash,
          owner,
          executionIdentity: transaction.manifest.execution_identity,
        });
      } catch (error) {
        const releaseError = normalizedTransactionError(error);
        if (releaseError !== null) fail(releaseError.code, 'recovery_required');
        throw error;
      }
    }
  }
  if (observationError !== undefined) throw observationError;
  if (observedTransaction.state.state === 'RESTORE_PREPARED'
      && location.location === 'original') {
    fail('restore_without_intent', 'recovery_required');
  }
  return { transaction: { ...observedTransaction, lock: null }, location };
}

function batchSummaryStatus(truth) {
  return deriveBatchSummaryOverallStatus(truth.items);
}

function assertActiveBatchOwnerConsistent(truth, owner) {
  for (const observation of truth.observations) {
    const state = observation.transaction?.state;
    if (state === undefined) fail('batch_transaction_unavailable', 'recovery_required');
    if (['CONFIRMED', 'PREPARED', 'APPLYING'].includes(state.state)
        && canonicalJson(state.lock) !== canonicalJson(owner)) {
      fail('batch_lock_identity_invalid', 'recovery_required');
    }
  }
}

function untouchedStaleBatchCanRelease(batchState, truth, owner) {
  return batchState?.state === 'READY' && batchState.sequence === 0
    && batchState.items.every(({ status }) => status === 'NOT_STARTED')
    && truth.observations.every((observation) => {
      const state = observation.transaction?.state;
      return state?.state === 'PLANNED' && state.sequence === 0
        && state.lock === null && state.outcome === null
        && canonicalJson(observation.transaction?.lock) === canonicalJson(owner)
        && observation.transactionHasMutated === false;
    });
}

function statusBatchTransactionInternal({
  home,
  transactionId,
  discoveryRecords,
}) {
  const executionIdentity = discoveryRecords.manifest?.execution_identity;
  let targetRecords;
  try {
    targetRecords = probeBatchTransactionRecords({ home, transactionId, executionIdentity });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  let binding;
  try {
    binding = validateBatchBinding(targetRecords.binding);
  } catch {
    fail('batch_binding_invalid', 'recovery_required');
  }
  let batchRecords;
  try {
    batchRecords = probeBatchRecords({
      home,
      batchId: binding.batch_id,
      executionIdentity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  const plan = targetRecords.plan;
  let batchPlan;
  try {
    validatePlan(plan);
    batchPlan = validateBatchPlan(batchRecords.plan, plan);
    validateBatchState(batchRecords.state, batchPlan);
    validateBatchBinding(binding, batchPlan);
  } catch {
    fail('batch_records_invalid', 'recovery_required');
  }
  const batch = {
    home,
    plan,
    batchPlan,
    batchState: batchRecords.state,
    batchLock: batchRecords.lock,
    executionIdentity,
  };
  let truth = rebuildBatchTruth(batch, { summary: true });
  const targetIndex = batchPlan.transaction_map.findIndex((mapping) => (
    mapping.transaction_id === transactionId
      && mapping.item_id === binding.item_id
      && mapping.item_hash === binding.item_hash
      && mapping.execution_identity_hash === binding.execution_identity_hash
  ));
  if (targetIndex < 0) fail('batch_binding_invalid', 'recovery_required');

  if (batchRecords.lock !== null) {
    const releaseUntouchedStaleLock = untouchedStaleBatchCanRelease(batchRecords.state, truth, batchRecords.lock);
    if (truth.items.some(({ status }) => status === 'RECOVERY_REQUIRED')
        && !releaseUntouchedStaleLock) fail('batch_recovery_required', 'recovery_required');
    assertActiveBatchOwnerConsistent(truth, batchRecords.lock);
    try {
      isolateStaleBatchLock({
        home,
        batchId: batchPlan.batch_id,
        planHash: batchPlan.plan_hash,
        owner: batchRecords.lock,
        executionIdentity,
      });
    } catch (error) {
      if (error instanceof MacosAdapterError) fail(error.reason, error.code);
      throw error;
    }
    const afterIsolation = probeBatchRecords({
      home,
      batchId: batchPlan.batch_id,
      executionIdentity,
    });
    validateBatchRecordSet(afterIsolation, batchPlan, plan);
    if (afterIsolation.lock !== null
        || canonicalJson(afterIsolation.state) !== canonicalJson(batchRecords.state)) {
      fail('batch_lock_isolation_postcondition_failed', 'recovery_required');
    }
    batch.batchLock = null;
    truth = rebuildBatchTruth(batch, { summary: true });
  }

  if (truth.items.some(({ status }) => status === 'RECOVERY_REQUIRED')) {
    fail('batch_recovery_required', 'recovery_required');
  }

  const target = truth.observations[targetIndex];
  if (target.transaction === null || target.location === null) {
    fail('transaction_state_incoherent', 'recovery_required');
  }
  const status = statusForLocation(target.transaction.state.state, target.location);
  if (status === null) fail('transaction_state_incoherent', 'recovery_required');
  const transactionResult = publicTransactionResult(
    'status',
    status,
    target.transaction,
    target.location,
    false,
    nextSafeCommandForStatus(status, target.transaction),
  );
  const batchSummary = validateBatchSummary({
    schema_version: SCHEMAS.batchSummary,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    overall_status: batchSummaryStatus(truth),
    items: truth.items,
  }, batchPlan);
  return validateTransactionBatchStatus({
    ...transactionResult,
    schema_version: SCHEMAS.transactionBatchStatus,
    batch_id: batchPlan.batch_id,
    batch_summary: batchSummary,
  }, batchPlan);
}

function statusTransactionInternal({
  home = process.env.HOME,
  transactionId,
} = {}) {
  if (typeof transactionId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(transactionId)) {
    fail('invalid_transaction_id', 'invalid');
  }
  let records;
  try {
    records = discoverTransactionRecords({ home, transactionId });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  let kind;
  try {
    kind = probeTransactionKind({
      home,
      transactionId,
      executionIdentity: records.manifest?.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  if (kind === 'batch_v2') {
    return statusBatchTransactionInternal({
      home,
      transactionId,
      discoveryRecords: records,
    });
  }
  let transaction = transactionFromRecords(home, records, transactionId);
  if (transaction.lock !== null) {
    if (transaction.lock.transaction_id !== transactionId) fail('lock_held_by_other', 'blocked');
    let preIsolationLocation;
    try {
      preIsolationLocation = reconcileTransactionLocation({ home, manifest: transaction.manifest });
    } catch (error) {
      if (error instanceof MacosAdapterError) fail(error.reason, error.code);
      throw error;
    }
    if (statusForLocation(transaction.state.state, preIsolationLocation.location) === null) {
      fail('transaction_state_incoherent', 'recovery_required');
    }
    try {
      isolateStaleTransactionLock({
        home,
        transactionId,
        planHash: transaction.manifest.plan_hash,
        owner: transaction.lock,
        executionIdentity: transaction.manifest.execution_identity,
      });
    } catch (error) {
      if (error instanceof MacosAdapterError) fail(error.reason, error.code);
      throw error;
    }
    records = discoverTransactionRecords({ home, transactionId });
    transaction = transactionFromRecords(home, records, transactionId);
    if (transaction.lock !== null) fail('lock_held', 'blocked');
  }
  const observed = observeStatusUnderLease(home, transaction);
  transaction = observed.transaction;
  const location = observed.location;
  const status = statusForLocation(transaction.state.state, location.location);
  if (status === null) fail('transaction_state_incoherent', 'recovery_required');
  return publicTransactionResult(
    'status',
    status,
    transaction,
    location.location,
    false,
    nextSafeCommandForStatus(status, transaction),
  );
}

async function applyItemInternal({
  home = process.env.HOME,
  plan,
  confirmation,
  fault = null,
} = {}) {
  await faultAt(fault, 'before_state_planned', 'UNINITIALIZED');
  let transaction = initializeTransaction({
    home,
    plan,
    transactionId: plan?.items?.[0]?.transaction_id,
    confirmation,
  });
  await faultAt(fault, 'after_state_planned', transaction.state.state);
  let initialLocation = null;
  try {
    initialLocation = reconcileTransactionLocation({ home, manifest: transaction.manifest });
  } catch (error) {
    const transactionError = normalizedTransactionError(error);
    if (transactionError === null) throw error;
    if (transaction.state.state !== 'APPLYING') throw transactionError;
  }
  if (transaction.state.state === 'COMMITTED') {
    if (initialLocation === null || !coherentApplyLocation('COMMITTED', initialLocation.location)) {
      fail('committed_state_incoherent', 'recovery_required');
    }
    return publicTransactionResult(
      'apply',
      'already_committed',
      transaction,
      initialLocation.location,
      false,
    );
  }
  if (transaction.state.state === 'RESTORED') fail('replay_protected', 'blocked');
  if (['PLANNED', 'CONFIRMED', 'PREPARED'].includes(transaction.state.state)
      && initialLocation?.location === 'original_drift') {
    fail('preflight_identity_drift', 'blocked');
  }
  if (!['PLANNED', 'CONFIRMED', 'PREPARED', 'APPLYING'].includes(transaction.state.state)
      || (transaction.state.state !== 'APPLYING'
        && (initialLocation === null
          || !coherentApplyLocation(transaction.state.state, initialLocation.location)))) {
    fail('transaction_state_incoherent', 'recovery_required');
  }

  await faultAt(fault, 'before_lock_acquire', transaction.state.state);
  if (transaction.lock !== null) fail('lock_held', 'blocked');
  let owner;
  try {
    owner = acquireTransactionLock({
      home,
      transactionId: transaction.manifest.transaction_id,
      planHash: transaction.manifest.plan_hash,
      executionIdentity: transaction.manifest.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  transaction = { ...transaction, lock: owner };
  await faultAt(fault, 'after_lock_acquire', transaction.state.state);

  let mutationOccurred = false;
  let mutationAttempted = false;
  try {
    const leasedRecords = discoverTransactionRecords({
      home,
      transactionId: transaction.manifest.transaction_id,
    });
    transaction = transactionFromRecords(
      home,
      leasedRecords,
      transaction.manifest.transaction_id,
    );
    if (canonicalJson(transaction.lock) !== canonicalJson(owner)) {
      fail('lock_identity_mismatch', 'recovery_required');
    }
    let leasedLocation;
    try {
      leasedLocation = reconcileTransactionLocation({ home, manifest: transaction.manifest });
    } catch (error) {
      const transactionError = normalizedTransactionError(error);
      if (transactionError !== null && transaction.state.state === 'APPLYING') {
        recordRecoveryRequired(transaction, owner, transactionError.code);
      }
      throw error;
    }
    if (transaction.state.state === 'COMMITTED') {
      if (!coherentApplyLocation('COMMITTED', leasedLocation.location)) {
        fail('committed_state_incoherent', 'recovery_required');
      }
      releaseTransactionLock({
        home,
        transactionId: transaction.manifest.transaction_id,
        planHash: transaction.manifest.plan_hash,
        owner,
        executionIdentity: transaction.manifest.execution_identity,
      });
      transaction = { ...transaction, lock: null };
      return publicTransactionResult(
        'apply',
        'already_committed',
        transaction,
        leasedLocation.location,
        false,
      );
    }
    if (transaction.state.state === 'RESTORED') fail('replay_protected', 'blocked');
    if (['PLANNED', 'CONFIRMED', 'PREPARED'].includes(transaction.state.state)) {
      if (leasedLocation.location === 'original_drift') {
        fail('preflight_identity_drift', 'blocked');
      }
      if (leasedLocation.location !== 'original') {
        fail('transaction_state_incoherent', 'recovery_required');
      }
    } else if (transaction.state.state === 'APPLYING') {
      if (!['original', 'quarantine', 'rehydrated'].includes(leasedLocation.location)) {
        recordRecoveryRequired(transaction, owner, 'transaction_state_incoherent');
      }
    } else {
      fail('transaction_state_incoherent', 'recovery_required');
    }
    if (transaction.state.state === 'PLANNED') {
      transaction = await publishNextState(transaction, 'CONFIRMED', owner, fault);
    }
    if (transaction.state.state === 'CONFIRMED') {
      const beforePrepare = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      if (beforePrepare.location !== 'original') {
        fail('preflight_identity_drift', 'blocked');
      }
      transaction = await publishNextState(transaction, 'PREPARED', owner, fault);
    }
    if (transaction.state.state === 'PREPARED') {
      const beforeApplying = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      if (beforeApplying.location !== 'original') {
        fail('preflight_identity_drift', 'blocked');
      }
      transaction = await publishNextState(transaction, 'APPLYING', owner, fault);
    }
    if (transaction.state.state === 'APPLYING') {
      let location;
      try {
        location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      } catch (error) {
        const transactionError = normalizedTransactionError(error);
        if (transactionError !== null) {
          recordRecoveryRequired(transaction, owner, transactionError.code);
        }
        throw error;
      }
      if (!['original', 'quarantine', 'rehydrated'].includes(location.location)) {
        recordRecoveryRequired(transaction, owner, 'transaction_state_incoherent');
      }
      if (location.location === 'original') {
        await faultAt(fault, 'before_move', transaction.state.state);
        mutationAttempted = true;
        renameExclusive({
          home,
          activeRoot: transaction.manifest.active_root,
          entryPath: transaction.manifest.entry_path,
          destinationRelativeDirectory: transaction.manifest.payload_relative_directory,
          destinationLeaf: transaction.manifest.payload_leaf,
          expectedIdentity: transaction.manifest.execution_identity,
        });
        mutationOccurred = true;
        await faultAt(fault, 'after_move', transaction.state.state);
      }
      await faultAt(fault, 'before_postcondition_verify', transaction.state.state);
      try {
        location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      } catch (error) {
        const transactionError = normalizedTransactionError(error);
        if (transactionError !== null) {
          recordRecoveryRequired(transaction, owner, transactionError.code);
        }
        throw error;
      }
      if (!['quarantine', 'rehydrated'].includes(location.location)) {
        recordRecoveryRequired(transaction, owner, 'apply_postcondition_failed');
      }
      await faultAt(fault, 'after_postcondition_verify', transaction.state.state);
      transaction = await publishNextState(transaction, 'COMMITTED', owner, fault, {
        location: 'quarantine',
        manifest_hash: transaction.manifest.execution_identity.manifest_hash,
      });
    }
    const finalLocation = reconcileTransactionLocation({ home, manifest: transaction.manifest });
    releaseTransactionLock({
      home,
      transactionId: transaction.manifest.transaction_id,
      planHash: transaction.manifest.plan_hash,
      owner,
      executionIdentity: transaction.manifest.execution_identity,
    });
    transaction = { ...transaction, lock: null };
    return publicTransactionResult(
      'apply',
      'committed',
      transaction,
      finalLocation.location,
      mutationOccurred,
    );
  } catch (error) {
    let transactionError = normalizedTransactionError(error);
    if (transactionError !== null) {
      if (mutationOccurred && transactionError.status !== 'recovery_required') {
        const recovery = recoverAfterCurrentMutation(transaction, owner, transactionError);
        transaction = recovery.transaction;
        transactionError = recovery.error;
      } else {
        releaseAfterDeterministicFailure(transaction, owner, transactionError);
      }
      const observed = transactionContextFromDisk(
        home,
        transaction.manifest.transaction_id,
      );
      throw contextualizeTransactionError(transactionError, {
        command: 'apply',
        transaction: observed.transaction ?? transaction,
        location: observed.location,
        mutationOccurred: mutationOccurred
          || (mutationAttempted && transactionError.status === 'recovery_required'),
        mutationOutcome: mutationOccurred ? 'moved' : (
          mutationAttempted && transactionError.status === 'recovery_required'
            ? 'unknown'
            : 'unchanged'
        ),
      });
    }
    throw error;
  }
}

function validateBatchRecordSet(records, batchPlan, plan) {
  try {
    validateBatchPlan(records.plan, plan);
    validateBatchState(records.state, batchPlan);
  } catch {
    fail('batch_records_invalid', 'recovery_required');
  }
  return records;
}

function initializeBatch({ home, plan }) {
  const batchPlan = buildBatchPlan(plan);
  const initialState = buildInitialBatchState(batchPlan);
  const executionIdentity = plan.items[0].execution_identity;
  let initialization;
  try {
    initialization = initializeBatchRecords({
      home,
      batchId: batchPlan.batch_id,
      plan: batchPlan,
      state: initialState,
      executionIdentity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) {
      throw normalizedTransactionError(error);
    }
    throw error;
  }
  let records;
  try {
    records = probeBatchRecords({
      home,
      batchId: batchPlan.batch_id,
      executionIdentity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) throw normalizedTransactionError(error);
    throw error;
  }
  validateBatchRecordSet(records, batchPlan, plan);
  const transactions = plan.items.map((item) => initializeBatchTransaction({
    home,
    plan,
    batchPlan,
    item,
  }));
  return {
    home,
    plan,
    batchPlan,
    batchState: records.state,
    batchLock: records.lock,
    executionIdentity,
    initialization: initialization.result,
    transactions,
  };
}

function observeBatchItem(transaction) {
  let location;
  try {
    location = reconcileTransactionLocation({
      home: transaction.home,
      manifest: transaction.manifest,
    }).location;
  } catch (error) {
    const transactionError = normalizedTransactionError(error);
    if (transactionError === null) throw error;
    return {
      transaction,
      location: 'unknown',
      status: 'RECOVERY_REQUIRED',
      summaryStatus: 'RECOVERY_REQUIRED',
      transactionHasMutated: transactionHasMutated(transaction),
      error: transactionError,
    };
  }
  const state = transaction.state.state;
  const mutated = transactionHasMutated(transaction, location);
  if (state === 'COMMITTED') {
    return coherentApplyLocation(state, location)
      ? {
        transaction,
        location,
        status: 'COMMITTED',
        summaryStatus: location === 'rehydrated' ? 'REHYDRATED' : 'COMMITTED',
        transactionHasMutated: true,
        error: null,
      }
      : {
        transaction,
        location,
        status: 'RECOVERY_REQUIRED',
        summaryStatus: 'RECOVERY_REQUIRED',
        transactionHasMutated: mutated,
        error: new CleanupTransactionError(
          'committed_state_incoherent',
          'cleanup transaction failed',
          'recovery_required',
        ),
      };
  }
  if (['PLANNED', 'CONFIRMED', 'PREPARED'].includes(state)) {
    if (location === 'original') {
      return {
        transaction,
        location,
        status: state === 'PLANNED' ? 'NOT_STARTED' : 'APPLY_PENDING',
        summaryStatus: state === 'PLANNED' ? 'NOT_STARTED' : 'APPLY_PENDING',
        transactionHasMutated: false,
        error: null,
      };
    }
    if (location === 'original_drift') {
      return {
        transaction,
        location,
        status: 'DRIFTED',
        summaryStatus: 'DRIFTED',
        transactionHasMutated: false,
        error: new CleanupTransactionError('preflight_identity_drift'),
      };
    }
    return {
      transaction,
      location,
      status: 'RECOVERY_REQUIRED',
      summaryStatus: 'RECOVERY_REQUIRED',
      transactionHasMutated: mutated,
      error: new CleanupTransactionError(
        'transaction_state_incoherent',
        'cleanup transaction failed',
        'recovery_required',
      ),
    };
  }
  if (state === 'APPLYING' && ['original', 'quarantine', 'rehydrated'].includes(location)) {
    return {
      transaction,
      location,
      status: location === 'original' ? 'APPLY_PENDING' : 'APPLY_FINALIZE_PENDING',
      summaryStatus: location === 'rehydrated'
        ? 'REHYDRATED'
        : (location === 'original' ? 'APPLY_PENDING' : 'APPLY_FINALIZE_PENDING'),
      transactionHasMutated: location !== 'original',
      error: null,
    };
  }
  if (state === 'RESTORE_PREPARED'
      && ['quarantine', 'rehydrated'].includes(location)) {
    return {
      transaction,
      location,
      status: 'RESTORE_PENDING',
      summaryStatus: location === 'rehydrated' ? 'RESTORE_CONFLICT' : 'RESTORE_PENDING',
      transactionHasMutated: true,
      error: new CleanupTransactionError('replay_protected'),
    };
  }
  if (state === 'RESTORING') {
    if (['quarantine', 'rehydrated'].includes(location)) {
      return {
        transaction,
        location,
        status: 'RESTORE_PENDING',
        summaryStatus: location === 'rehydrated' ? 'RESTORE_CONFLICT' : 'RESTORE_PENDING',
        transactionHasMutated: true,
        error: new CleanupTransactionError('replay_protected'),
      };
    }
    if (location === 'original') {
      return {
        transaction,
        location,
        status: 'RESTORE_FINALIZE_PENDING',
        summaryStatus: 'RESTORE_FINALIZE_PENDING',
        transactionHasMutated: true,
        error: new CleanupTransactionError('replay_protected'),
      };
    }
  }
  if (state === 'RESTORED' && location === 'original') {
    return {
      transaction,
      location,
      status: 'RESTORED',
      summaryStatus: 'RESTORED',
      transactionHasMutated: true,
      error: new CleanupTransactionError('replay_protected'),
    };
  }
  if (state === 'RECOVERY_REQUIRED') {
    return {
      transaction,
      location,
      status: 'RECOVERY_REQUIRED',
      summaryStatus: 'RECOVERY_REQUIRED',
      transactionHasMutated: mutated,
      error: new CleanupTransactionError(
        'transaction_recovery_required',
        'cleanup transaction requires recovery',
        'recovery_required',
      ),
    };
  }
  return {
    transaction,
    location,
    status: 'RECOVERY_REQUIRED',
    summaryStatus: 'RECOVERY_REQUIRED',
    transactionHasMutated: mutated,
    error: new CleanupTransactionError(
      'transaction_state_incoherent',
      'cleanup transaction failed',
      'recovery_required',
    ),
  };
}

function rebuildBatchTruth(batch, {
  summary = false,
  ignoreLeaseMismatchForReporting = false,
} = {}) {
  const observations = batch.plan.items.map((item) => {
    let records;
    try {
      records = probeBatchTransactionRecords({
        home: batch.home,
        transactionId: item.transaction_id,
        executionIdentity: item.execution_identity,
      });
    } catch (error) {
      if (error instanceof MacosAdapterError) {
        return {
          transaction: null,
          location: 'unknown',
          status: 'RECOVERY_REQUIRED',
          summaryStatus: 'RECOVERY_REQUIRED',
          transactionHasMutated: false,
          error: new CleanupTransactionError(error.reason, 'cleanup transaction failed', 'recovery_required'),
        };
      }
      throw error;
    }
    let transaction;
    try {
      transaction = batchTransactionFromRecords(
        batch.home,
        records,
        batch.plan,
        batch.batchPlan,
        item.transaction_id,
      );
    } catch (error) {
      const transactionError = normalizedTransactionError(error);
      if (transactionError === null) throw error;
      return {
        transaction: null,
        location: 'unknown',
        status: 'RECOVERY_REQUIRED',
        summaryStatus: 'RECOVERY_REQUIRED',
        transactionHasMutated: false,
        error: transactionError,
      };
    }
    if (!ignoreLeaseMismatchForReporting
        && batch.batchLock !== null
        && canonicalJson(transaction.lock) !== canonicalJson(batch.batchLock)) {
      return {
        transaction,
        location: 'unknown',
        status: 'RECOVERY_REQUIRED',
        summaryStatus: 'RECOVERY_REQUIRED',
        transactionHasMutated: transactionHasMutated(transaction),
        error: new CleanupTransactionError(
          'batch_lock_identity_invalid',
          'cleanup transaction failed',
          'recovery_required',
        ),
      };
    }
    return observeBatchItem(transaction);
  });
  return {
    observations,
    items: observations.map((observation, index) => ({
      item_id: batch.plan.items[index].item_id,
      transaction_id: batch.plan.items[index].transaction_id,
      status: summary ? observation.summaryStatus : observation.status,
      location: observation.location,
      transaction_has_mutated: observation.transactionHasMutated,
    })),
  };
}

function rebuildBatchTruthForReporting({ home, plan }) {
  validatePlan(plan);
  const batchPlan = buildBatchPlan(plan);
  return rebuildBatchTruth({
    home,
    plan,
    batchPlan,
    batchState: null,
    batchLock: null,
    executionIdentity: plan.items[0].execution_identity,
  }, { ignoreLeaseMismatchForReporting: true });
}

function firstFailedObservation(truth) {
  const index = truth.observations.findIndex(({ status }) => (
    ![
      'NOT_STARTED',
      'APPLY_PENDING',
      'APPLY_FINALIZE_PENDING',
      'COMMITTED',
    ].includes(status)
  ));
  if (index < 0) return null;
  return { index, observation: truth.observations[index] };
}

function stopFirstFailureTruth(truth) {
  const failure = firstFailedObservation(truth);
  if (failure === null) return truth;
  return {
    observations: truth.observations.map((observation, index) => (
      index <= failure.index
        ? observation
        : {
          ...observation,
          status: 'NOT_STARTED',
          location: 'original',
          transactionHasMutated: false,
          error: null,
        }
    )),
    items: truth.items.map((item, index) => (
      index <= failure.index
        ? item
        : {
          ...item,
          status: 'NOT_STARTED',
          location: 'original',
          transaction_has_mutated: false,
        }
    )),
  };
}

function batchError(code, status, result, failure = {}) {
  return new CleanupBatchError(code, status, {
    batchError: result,
    errorCode: result.error_code ?? code,
    failureScope: result.failure_scope ?? failure.scope ?? 'batch',
    failureItemId: result.failure_item_id ?? failure.itemId ?? null,
    failureIndex: result.failure_item_index ?? failure.index ?? null,
    batchId: result.batch_id,
    planHash: result.plan_hash,
    overallStatus: result.overall_status,
    items: result.items,
    mutationOccurred: result.mutation_occurred,
    mutationOutcome: result.mutation_outcome,
    transactionHasMutated: result.transaction_has_mutated,
    committedTransactionIds: result.committed_transaction_ids,
    undoCommands: result.undo_commands,
  });
}

function buildFailureResult(
  batch,
  truth,
  mutationOccurred,
  mutationOutcome = mutationOccurred ? 'moved' : 'unchanged',
) {
  const unsupportedFailure = firstFailedObservation(truth);
  if (unsupportedFailure !== null
      && !['DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(
        unsupportedFailure.observation.status,
      )) {
    truth.observations[unsupportedFailure.index] = {
      ...unsupportedFailure.observation,
      status: 'RECOVERY_REQUIRED',
    };
    truth.items[unsupportedFailure.index] = {
      ...truth.items[unsupportedFailure.index],
      status: 'RECOVERY_REQUIRED',
    };
  }
  truth = stopFirstFailureTruth(truth);
  let failed = firstFailedObservation(truth);
  const committed = truth.items.filter(({ status }) => status === 'COMMITTED').length;
  if (committed > 0 && failed?.observation.status === 'BLOCKED') {
    truth.observations[failed.index] = {
      ...failed.observation,
      status: 'RECOVERY_REQUIRED',
      summaryStatus: 'RECOVERY_REQUIRED',
    };
    truth.items[failed.index] = {
      ...truth.items[failed.index],
      status: 'RECOVERY_REQUIRED',
    };
    failed = firstFailedObservation(truth);
  }
  const recoveryRequired = truth.items.some(({ status }) => status === 'RECOVERY_REQUIRED');
  const partial = committed > 0 && committed < truth.items.length;
  const status = partial || recoveryRequired ? 'recovery_required' : 'blocked';
  const overallStatus = partial ? 'PARTIAL' : (
    recoveryRequired ? 'RECOVERY_REQUIRED' : (
      truth.items.some(({ status: itemStatus }) => itemStatus === 'DRIFTED')
        ? 'drifted'
        : 'blocked'
    )
  );
  const failedItem = failed === null ? null : truth.items[failed.index];
  const code = failedItem?.status === 'DRIFTED'
    ? BATCH_ERROR_CODES.preflightDrift
    : (failedItem?.status === 'BLOCKED'
      ? BATCH_ERROR_CODES.itemBlocked
      : (failedItem?.status === 'RECOVERY_REQUIRED'
        && mutationOutcome === 'unknown'
        && failedItem.transaction_has_mutated
        ? BATCH_ERROR_CODES.itemOutcomeAmbiguous
        : (failedItem?.status === 'RECOVERY_REQUIRED'
          ? BATCH_ERROR_CODES.itemRecoveryRequired
          : BATCH_ERROR_CODES.batchRecoveryRequired)));
  const failureScope = failed === null ? 'batch' : 'item';
  const result = buildBatchError({
    batchPlan: batch.batchPlan,
    status,
    overallStatus,
    items: truth.items,
    mutationOccurred,
    mutationOutcome,
    errorCode: code,
    failureScope,
    failureItemIndex: failed?.index ?? null,
  });
  return {
    result,
    error: batchError(code, partial || recoveryRequired ? 'recovery_required' : 'blocked', result, {
      scope: failureScope,
      itemId: failed === null ? null : batch.plan.items[failed.index].item_id,
      index: failed?.index ?? null,
    }),
  };
}

function batchErrorItems(items) {
  return items.map((item) => {
    if (['COMMITTED', 'DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(item.status)) {
      return { ...item };
    }
    if (item.transaction_has_mutated) {
      return { ...item, status: 'RECOVERY_REQUIRED' };
    }
    return {
      ...item,
      status: 'NOT_STARTED',
      location: 'original',
      transaction_has_mutated: false,
    };
  });
}

function mergeBatchErrorItems(pendingItems, observedItems) {
  const pending = pendingItems === null
    ? null
    : batchErrorItems(pendingItems);
  return batchErrorItems(observedItems).map((observed, index) => {
    const prior = pending?.[index];
    if (['COMMITTED', 'DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(observed.status)) {
      return observed;
    }
    if (prior !== undefined
        && ['DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(prior.status)) {
      return prior;
    }
    return observed;
  });
}

function buildBatchScopedRecovery(
  batch,
  truth,
  mutationOccurred,
  mutationOutcome,
  errorCode,
) {
  const allowedCodes = new Set([
    BATCH_ERROR_CODES.batchStateProjectionFailed,
    BATCH_ERROR_CODES.batchRecoveryRequired,
    BATCH_ERROR_CODES.batchRecordsInvalid,
    BATCH_ERROR_CODES.batchMutationOutcomeUnknown,
    BATCH_ERROR_CODES.batchLockAcquireFailed,
    BATCH_ERROR_CODES.batchLockReleaseFailed,
  ]);
  const stablePrimaryCodes = new Set([
    BATCH_ERROR_CODES.batchStateProjectionFailed,
    BATCH_ERROR_CODES.batchRecordsInvalid,
  ]);
  const normalizedCode = stablePrimaryCodes.has(errorCode)
    ? errorCode
    : (mutationOccurred && mutationOutcome === 'unknown'
      ? BATCH_ERROR_CODES.batchMutationOutcomeUnknown
      : (allowedCodes.has(errorCode)
        ? errorCode
        : BATCH_ERROR_CODES.batchRecoveryRequired));
  const items = batchErrorItems(truth.items);
  const result = buildBatchError({
    batchPlan: batch.batchPlan,
    status: 'recovery_required',
    overallStatus: 'RECOVERY_REQUIRED',
    items,
    mutationOccurred,
    mutationOutcome,
    errorCode: normalizedCode,
    failureScope: 'batch',
  });
  return {
    result,
    error: batchError(normalizedCode, 'recovery_required', result),
  };
}

function durableBatchItems(items) {
  return items.map(({ item_id: itemId, transaction_id: transactionId, status }) => ({
    item_id: itemId,
    transaction_id: transactionId,
    status: ['COMMITTED', 'DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(status)
      ? status
      : 'NOT_STARTED',
  }));
}

function batchStateProjectionError(error) {
  const transactionError = normalizedTransactionError(error);
  const projectionError = new CleanupTransactionError(
    BATCH_ERROR_CODES.batchStateProjectionFailed,
    'cleanup batch state projection failed',
    'recovery_required',
  );
  Object.assign(
    projectionError,
    joinMutationTruth('apply', transactionError),
  );
  return projectionError;
}

function advanceBatchProjection(batch, owner, state, items) {
  const currentState = batch.batchState;
  const stateItems = durableBatchItems(items);
  const nextState = {
    ...currentState,
    sequence: currentState.sequence + 1,
    state,
    items: stateItems,
  };
  const authoritativeConvergence = nextState.items
    .filter((item, index) => (
      currentState.items[index].status === 'RECOVERY_REQUIRED'
        && item.status === 'COMMITTED'
    ))
    .map(({ transaction_id: transactionId }) => transactionId);
  try {
    validateBatchState(nextState, batch.batchPlan, {
      previousState: currentState,
      authoritativeConvergence,
    });
  } catch (error) {
    throw batchStateProjectionError(error);
  }
  let records;
  try {
    records = advanceBatchStateRecord({
      home: batch.home,
      batchId: batch.batchPlan.batch_id,
      planHash: batch.batchPlan.plan_hash,
      currentState,
      nextState,
      owner,
      executionIdentity: batch.executionIdentity,
    });
  } catch (error) {
    throw batchStateProjectionError(error);
  }
  try {
    validateBatchRecordSet(records, batch.batchPlan, batch.plan);
  } catch (error) {
    throw batchStateProjectionError(error);
  }
  batch.batchState = records.state;
  batch.batchLock = records.lock;
  return batch;
}

async function applyBatchTransaction({
  batch,
  transaction,
  owner,
  index,
  fault,
}) {
  const context = {
    batch_id: batch.batchPlan.batch_id,
    index,
    item_id: transaction.item.item_id,
    transaction_id: transaction.manifest.transaction_id,
  };
  let mutationOccurred = false;
  let mutationAttempted = false;
  try {
    if (transaction.state.state === 'COMMITTED') {
      const observation = observeBatchItem(transaction);
      if (observation.status !== 'COMMITTED') throw observation.error;
      return { transaction, mutationOccurred, location: observation.location };
    }
    if (transaction.state.state === 'RESTORED') fail('replay_protected', 'blocked');
    const initial = observeBatchItem(transaction);
    if (initial.status === 'DRIFTED') throw initial.error;
    if (!['NOT_STARTED', 'APPLY_PENDING', 'APPLY_FINALIZE_PENDING'].includes(initial.status)) {
      throw initial.error;
    }
    if (transaction.state.state === 'PLANNED') {
      transaction = await publishNextBatchTransactionState(
        transaction, 'CONFIRMED', batch.batchPlan, owner, fault, context,
      );
    }
    if (transaction.state.state === 'CONFIRMED') {
      const beforePrepare = observeBatchItem(transaction);
      if (beforePrepare.location !== 'original') fail('preflight_identity_drift', 'blocked');
      transaction = await publishNextBatchTransactionState(
        transaction, 'PREPARED', batch.batchPlan, owner, fault, context,
      );
    }
    if (transaction.state.state === 'PREPARED') {
      const beforeApplying = observeBatchItem(transaction);
      if (beforeApplying.location !== 'original') fail('preflight_identity_drift', 'blocked');
      transaction = await publishNextBatchTransactionState(
        transaction, 'APPLYING', batch.batchPlan, owner, fault, context,
      );
    }
    if (transaction.state.state === 'APPLYING') {
      let observation = observeBatchItem(transaction);
      if (!['original', 'quarantine', 'rehydrated'].includes(observation.location)) {
        fail('transaction_state_incoherent', 'recovery_required');
      }
      if (observation.location === 'original') {
        await faultAt(fault, 'before_move', { ...context, state: transaction.state.state });
        mutationAttempted = true;
        renameExclusive({
          home: batch.home,
          activeRoot: transaction.manifest.active_root,
          entryPath: transaction.manifest.entry_path,
          destinationRelativeDirectory: transaction.manifest.payload_relative_directory,
          destinationLeaf: transaction.manifest.payload_leaf,
          expectedIdentity: transaction.manifest.execution_identity,
        });
        mutationOccurred = true;
        await faultAt(fault, 'after_move', { ...context, state: transaction.state.state });
      }
      observation = observeBatchItem(transaction);
      if (!['quarantine', 'rehydrated'].includes(observation.location)) {
        fail('apply_postcondition_failed', 'recovery_required');
      }
      transaction = await publishNextBatchTransactionState(
        transaction,
        'COMMITTED',
        batch.batchPlan,
        owner,
        fault,
        context,
        {
          location: 'quarantine',
          manifest_hash: transaction.manifest.execution_identity.manifest_hash,
        },
      );
    }
    const finalObservation = observeBatchItem(transaction);
    if (finalObservation.status !== 'COMMITTED') {
      fail('committed_state_incoherent', 'recovery_required');
    }
    return { transaction, mutationOccurred, location: finalObservation.location };
  } catch (error) {
    let transactionError = normalizedTransactionError(error)
      ?? new CleanupTransactionError(
        'batch_item_interrupted',
        'cleanup batch item was interrupted',
        'recovery_required',
      );
    const mutationTruth = joinMutationTruth(
      'apply',
      transactionError,
      {
        mutationOccurred: mutationOccurred
          || (mutationAttempted && transactionError.status === 'recovery_required'),
        mutationOutcome: mutationOccurred ? 'moved' : (
          mutationAttempted && transactionError.status === 'recovery_required'
            ? 'unknown'
            : 'unchanged'
        ),
      },
    );
    if ((mutationOccurred || mutationAttempted)
        && transaction.state.state === 'APPLYING') {
      try {
        transaction = advanceBatchTransactionState(transaction, 'RECOVERY_REQUIRED', {
          batchPlan: batch.batchPlan,
          owner,
        });
      } catch {
        // Durable location reconciliation remains authoritative if the state CAS cannot publish.
      }
      transactionError = new CleanupTransactionError(
        transactionError.code,
        'cleanup batch item failed after a current-command mutation',
        'recovery_required',
      );
    }
    Object.assign(transactionError, mutationTruth);
    throw transactionError;
  }
}

function loadBatchTransactionContext({
  home,
  transactionId,
  executionIdentity,
}) {
  let transactionRecords;
  try {
    transactionRecords = probeBatchTransactionRecords({
      home,
      transactionId,
      executionIdentity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  let binding;
  try {
    binding = validateBatchBinding(transactionRecords.binding);
  } catch {
    fail('batch_binding_invalid', 'recovery_required');
  }
  let batchRecords;
  try {
    batchRecords = probeBatchRecords({
      home,
      batchId: binding.batch_id,
      executionIdentity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  const plan = transactionRecords.plan;
  let batchPlan;
  try {
    validatePlan(plan);
    batchPlan = validateBatchPlan(batchRecords.plan, plan);
    validateBatchState(batchRecords.state, batchPlan);
    validateBatchBinding(binding, batchPlan);
  } catch {
    fail('batch_records_invalid', 'recovery_required');
  }
  const transaction = batchTransactionFromRecords(
    home,
    transactionRecords,
    plan,
    batchPlan,
    transactionId,
  );
  return {
    batch: {
      home,
      plan,
      batchPlan,
      batchState: batchRecords.state,
      batchLock: batchRecords.lock,
      executionIdentity,
    },
    transaction,
  };
}

async function undoBatchTransactionInternal({
  home,
  transactionId,
  confirmation,
  fault,
  discoveryRecords,
}) {
  if (confirmation !== transactionId) fail('confirmation_mismatch', 'invalid');
  const executionIdentity = discoveryRecords.manifest?.execution_identity;
  let { batch, transaction } = loadBatchTransactionContext({
    home,
    transactionId,
    executionIdentity,
  });
  await faultAt(fault, 'before_restore_lock_acquire', {
    batch_id: batch.batchPlan.batch_id,
    transaction_id: transactionId,
    state: transaction.state.state,
  });
  let owner;
  try {
    owner = acquireBatchLock({
      home,
      batchId: batch.batchPlan.batch_id,
      planHash: batch.batchPlan.plan_hash,
      executionIdentity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  batch.batchLock = owner;
  let mutationOccurred = false;
  let mutationAttempted = false;
  let pendingError = null;
  let returnValue = null;
  try {
    await faultAt(fault, 'after_restore_lock_acquire', {
      batch_id: batch.batchPlan.batch_id,
      transaction_id: transactionId,
      state: transaction.state.state,
    });
    ({ batch, transaction } = loadBatchTransactionContext({
      home,
      transactionId,
      executionIdentity,
    }));
    if (canonicalJson(batch.batchLock) !== canonicalJson(owner)
        || canonicalJson(transaction.lock) !== canonicalJson(owner)) {
      fail('batch_lock_identity_invalid', 'recovery_required');
    }
    let location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
    if (transaction.state.state === 'RESTORED') {
      if (location.location !== 'original') fail('restored_state_incoherent', 'recovery_required');
      returnValue = publicTransactionResult(
        'undo', 'already_restored', transaction, 'original', false,
      );
    } else {
      if (!['COMMITTED', 'RESTORE_PREPARED', 'RESTORING'].includes(transaction.state.state)) {
        fail('undo_not_committed', 'blocked');
      }
      if (location.location === 'rehydrated') fail('restore_destination_occupied', 'conflict');
      if (transaction.state.state === 'COMMITTED' && location.location !== 'quarantine') {
        fail('committed_state_incoherent', 'recovery_required');
      }
      const context = {
        batch_id: batch.batchPlan.batch_id,
        item_id: transaction.item.item_id,
        transaction_id: transactionId,
      };
      if (transaction.state.state === 'COMMITTED') {
        transaction = await publishNextBatchTransactionState(
          transaction,
          'RESTORE_PREPARED',
          batch.batchPlan,
          owner,
          fault,
          context,
        );
      }
      location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      if (location.location === 'rehydrated') fail('restore_destination_occupied', 'conflict');
      if (transaction.state.state === 'RESTORE_PREPARED'
          && location.location !== 'quarantine') {
        fail('restore_without_intent', 'recovery_required');
      }
      if (transaction.state.state === 'RESTORE_PREPARED') {
        transaction = await publishNextBatchTransactionState(
          transaction,
          'RESTORING',
          batch.batchPlan,
          owner,
          fault,
          context,
        );
      }
      location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      if (!['quarantine', 'original'].includes(location.location)) {
        fail('restore_state_incoherent', 'recovery_required');
      }
      if (location.location === 'quarantine') {
        await faultAt(fault, 'before_restore_move', {
          ...context,
          state: transaction.state.state,
        });
        mutationAttempted = true;
        restoreExclusive({ home, manifest: transaction.manifest });
        mutationOccurred = true;
        await faultAt(fault, 'after_restore_move', {
          ...context,
          state: transaction.state.state,
        });
      }
      await faultAt(fault, 'before_restore_postcondition_verify', {
        ...context,
        state: transaction.state.state,
      });
      location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      if (location.location !== 'original') fail('restore_postcondition_failed', 'recovery_required');
      await faultAt(fault, 'after_restore_postcondition_verify', {
        ...context,
        state: transaction.state.state,
      });
      transaction = await publishNextBatchTransactionState(
        transaction,
        'RESTORED',
        batch.batchPlan,
        owner,
        fault,
        context,
        {
          location: 'original',
          manifest_hash: transaction.manifest.execution_identity.manifest_hash,
        },
      );
      returnValue = publicTransactionResult(
        'undo', 'restored', transaction, 'original', mutationOccurred,
      );
    }
  } catch (error) {
    let transactionError = normalizedTransactionError(error)
      ?? new CleanupTransactionError(
        'batch_undo_interrupted',
        'cleanup batch undo was interrupted',
        'recovery_required',
      );
    const mutationTruth = joinMutationTruth(
      'undo',
      transactionError,
      {
        mutationOccurred: mutationOccurred
          || (mutationAttempted && transactionError.status === 'recovery_required'),
        mutationOutcome: mutationOccurred ? 'restored' : (
          mutationAttempted && transactionError.status === 'recovery_required'
            ? 'unknown'
            : 'unchanged'
        ),
      },
    );
    if ((mutationOccurred || mutationAttempted)
        && ['RESTORE_PREPARED', 'RESTORING'].includes(transaction.state.state)) {
      try {
        transaction = advanceBatchTransactionState(transaction, 'RECOVERY_REQUIRED', {
          batchPlan: batch.batchPlan,
          owner,
        });
      } catch {
        // Reconciliation remains authoritative if recovery-state publication cannot complete.
      }
      transactionError = new CleanupTransactionError(
        transactionError.code,
        'cleanup batch undo failed after a current-command mutation',
        'recovery_required',
      );
    }
    pendingError = contextualizeTransactionError(transactionError, {
      command: 'undo',
      transaction,
      location: (() => {
        try {
          return reconcileTransactionLocation({ home, manifest: transaction.manifest }).location;
        } catch {
          return undefined;
        }
      })(),
      ...mutationTruth,
    });
  }
  try {
    releaseBatchLock({
      home,
      batchId: batch.batchPlan.batch_id,
      planHash: batch.batchPlan.plan_hash,
      owner,
      executionIdentity,
    });
  } catch (error) {
    const releaseError = normalizedTransactionError(error);
    if (releaseError === null) throw error;
    const primaryError = pendingError ?? releaseError;
    const mutationTruth = joinMutationTruth(
      'undo',
      pendingError,
      releaseError,
      {
        mutationOccurred,
        mutationOutcome: mutationOccurred ? 'restored' : 'unchanged',
      },
    );
    throw contextualizeTransactionError(
      new CleanupTransactionError(
        primaryError.code,
        pendingError?.message ?? 'cleanup batch undo could not release its exact lease',
        'recovery_required',
      ),
      {
        command: 'undo',
        transaction,
        location: (() => {
          try {
            return reconcileTransactionLocation({ home, manifest: transaction.manifest }).location;
          } catch {
            return undefined;
          }
        })(),
        ...mutationTruth,
      },
    );
  }
  if (pendingError !== null) throw pendingError;
  return returnValue;
}

async function undoTransactionInternal({
  home = process.env.HOME,
  transactionId,
  confirmation,
  fault = null,
} = {}) {
  if (confirmation !== transactionId) fail('confirmation_mismatch', 'invalid');
  let records;
  try {
    records = discoverTransactionRecords({ home, transactionId });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  let kind;
  try {
    kind = probeTransactionKind({
      home,
      transactionId,
      executionIdentity: records.manifest?.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  if (kind === 'batch_v2') {
    return undoBatchTransactionInternal({
      home,
      transactionId,
      confirmation,
      fault,
      discoveryRecords: records,
    });
  }
  let transaction = transactionFromRecords(home, records, transactionId);
  if (transaction.lock !== null) {
    if (transaction.lock.transaction_id !== transactionId) fail('lock_held_by_other', 'blocked');
    let preIsolationLocation;
    try {
      preIsolationLocation = reconcileTransactionLocation({ home, manifest: transaction.manifest });
    } catch (error) {
      if (error instanceof MacosAdapterError) fail(error.reason, error.code);
      throw error;
    }
    if (statusForLocation(transaction.state.state, preIsolationLocation.location) === null) {
      fail('transaction_state_incoherent', 'recovery_required');
    }
    try {
      isolateStaleTransactionLock({
        home,
        transactionId,
        planHash: transaction.manifest.plan_hash,
        owner: transaction.lock,
        executionIdentity: transaction.manifest.execution_identity,
      });
    } catch (error) {
      if (error instanceof MacosAdapterError) fail(error.reason, error.code);
      throw error;
    }
    records = discoverTransactionRecords({ home, transactionId });
    transaction = transactionFromRecords(home, records, transactionId);
    if (transaction.lock !== null) fail('lock_held', 'blocked');
  }
  let location = null;
  try {
    location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
  } catch (error) {
    const transactionError = normalizedTransactionError(error);
    if (transactionError === null) throw error;
    if (!['RESTORE_PREPARED', 'RESTORING'].includes(transaction.state.state)) {
      throw transactionError;
    }
  }
  if (transaction.state.state === 'RESTORED') {
    if (location === null || location.location !== 'original') {
      fail('restored_state_incoherent', 'recovery_required');
    }
    return publicTransactionResult('undo', 'already_restored', transaction, 'original', false);
  }
  if (!['COMMITTED', 'RESTORE_PREPARED', 'RESTORING'].includes(transaction.state.state)) {
    fail('undo_not_committed', 'blocked');
  }
  if (location?.location === 'rehydrated') fail('restore_destination_occupied', 'conflict');
  if (transaction.state.state === 'COMMITTED'
      && (location === null || location.location !== 'quarantine')) {
    fail('committed_state_incoherent', 'recovery_required');
  }
  if (['RESTORE_PREPARED', 'RESTORING'].includes(transaction.state.state)
      && location !== null && location.location === 'rehydrated') {
    fail('restore_destination_occupied', 'conflict');
  }

  await faultAt(fault, 'before_restore_lock_acquire', transaction.state.state);
  let owner;
  try {
    owner = acquireTransactionLock({
      home,
      transactionId,
      planHash: transaction.manifest.plan_hash,
      executionIdentity: transaction.manifest.execution_identity,
    });
  } catch (error) {
    if (error instanceof MacosAdapterError) fail(error.reason, error.code);
    throw error;
  }
  transaction = { ...transaction, lock: owner };
  await faultAt(fault, 'after_restore_lock_acquire', transaction.state.state);
  let mutationOccurred = false;
  let mutationAttempted = false;
  try {
    records = discoverTransactionRecords({ home, transactionId });
    transaction = transactionFromRecords(home, records, transactionId);
    if (canonicalJson(transaction.lock) !== canonicalJson(owner)) {
      fail('lock_identity_mismatch', 'recovery_required');
    }
    location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
    if (transaction.state.state === 'RESTORED') {
      releaseTransactionLock({
        home,
        transactionId,
        planHash: transaction.manifest.plan_hash,
        owner,
        executionIdentity: transaction.manifest.execution_identity,
      });
      transaction = { ...transaction, lock: null };
      return publicTransactionResult('undo', 'already_restored', transaction, 'original', false);
    }
    if (!['COMMITTED', 'RESTORE_PREPARED', 'RESTORING'].includes(transaction.state.state)) {
      fail('undo_not_committed', 'blocked');
    }
    if (location.location === 'rehydrated') fail('restore_destination_occupied', 'conflict');
    if (transaction.state.state === 'COMMITTED' && location.location !== 'quarantine') {
      fail('committed_state_incoherent', 'recovery_required');
    }
    if (transaction.state.state === 'COMMITTED') {
      transaction = await publishNextState(transaction, 'RESTORE_PREPARED', owner, fault);
    }
    try {
      location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
    } catch (error) {
      const transactionError = normalizedTransactionError(error);
      if (transactionError !== null) {
        recordRecoveryRequired(transaction, owner, transactionError.code);
      }
      throw error;
    }
    if (location.location === 'rehydrated') fail('restore_destination_occupied', 'conflict');
    if (!['quarantine', 'original'].includes(location.location)) {
      recordRecoveryRequired(transaction, owner, 'restore_state_incoherent');
    }
    if (transaction.state.state === 'RESTORE_PREPARED'
        && location.location !== 'quarantine') {
      recordRecoveryRequired(transaction, owner, 'restore_without_intent');
    }
    if (transaction.state.state === 'RESTORE_PREPARED') {
      transaction = await publishNextState(transaction, 'RESTORING', owner, fault);
    }
    if (transaction.state.state === 'RESTORING') {
      try {
        location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      } catch (error) {
        const transactionError = normalizedTransactionError(error);
        if (transactionError !== null) {
          recordRecoveryRequired(transaction, owner, transactionError.code);
        }
        throw error;
      }
      if (location.location === 'rehydrated') fail('restore_destination_occupied', 'conflict');
      if (!['quarantine', 'original'].includes(location.location)) {
        recordRecoveryRequired(transaction, owner, 'restore_state_incoherent');
      }
      if (location.location === 'quarantine') {
        await faultAt(fault, 'before_restore_move', transaction.state.state);
        mutationAttempted = true;
        try {
          restoreExclusive({ home, manifest: transaction.manifest });
        } catch (error) {
          if (error instanceof MacosAdapterError
              && error.reason === 'restore_destination_occupied') {
            fail('restore_destination_occupied', 'conflict');
          }
          throw error;
        }
        mutationOccurred = true;
        await faultAt(fault, 'after_restore_move', transaction.state.state);
      }
      await faultAt(fault, 'before_restore_postcondition_verify', transaction.state.state);
      try {
        location = reconcileTransactionLocation({ home, manifest: transaction.manifest });
      } catch (error) {
        const transactionError = normalizedTransactionError(error);
        if (transactionError !== null) {
          recordRecoveryRequired(transaction, owner, transactionError.code);
        }
        throw error;
      }
      if (location.location !== 'original') {
        recordRecoveryRequired(transaction, owner, 'restore_postcondition_failed');
      }
      await faultAt(fault, 'after_restore_postcondition_verify', transaction.state.state);
      transaction = await publishNextState(transaction, 'RESTORED', owner, fault, {
        location: 'original',
        manifest_hash: transaction.manifest.execution_identity.manifest_hash,
      });
    }
    releaseTransactionLock({
      home,
      transactionId,
      planHash: transaction.manifest.plan_hash,
      owner,
      executionIdentity: transaction.manifest.execution_identity,
    });
    transaction = { ...transaction, lock: null };
    return publicTransactionResult(
      'undo',
      'restored',
      transaction,
      'original',
      mutationOccurred,
    );
  } catch (error) {
    let transactionError = normalizedTransactionError(error);
    if (transactionError !== null) {
      if (mutationOccurred && transactionError.status !== 'recovery_required') {
        const recovery = recoverAfterCurrentMutation(transaction, owner, transactionError);
        transaction = recovery.transaction;
        transactionError = recovery.error;
      } else {
        releaseAfterDeterministicFailure(transaction, owner, transactionError);
      }
      const observed = transactionContextFromDisk(home, transactionId);
      throw contextualizeTransactionError(transactionError, {
        command: 'undo',
        transaction: observed.transaction ?? transaction,
        location: observed.location ?? location?.location,
        mutationOccurred: mutationOccurred
          || (mutationAttempted && transactionError.status === 'recovery_required'),
        mutationOutcome: mutationOccurred ? 'restored' : (
          mutationAttempted && transactionError.status === 'recovery_required'
            ? 'unknown'
            : 'unchanged'
        ),
      });
    }
    throw error;
  }
}

function transactionContextFromDisk(home, transactionId) {
  if (typeof transactionId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(transactionId)) {
    return {};
  }
  try {
    const records = discoverTransactionRecords({ home, transactionId });
    const kind = probeTransactionKind({
      home,
      transactionId,
      executionIdentity: records.manifest?.execution_identity,
    });
    const transaction = kind === 'batch_v2'
      ? loadBatchTransactionContext({
        home,
        transactionId,
        executionIdentity: records.manifest?.execution_identity,
      }).transaction
      : transactionFromRecords(home, records, transactionId);
    let location;
    try {
      location = reconcileTransactionLocation({ home, manifest: transaction.manifest }).location;
    } catch {
      // State and transaction identity remain useful when location is ambiguous.
    }
    return { transaction, location };
  } catch {
    return {};
  }
}

export function statusTransaction(options = {}) {
  try {
    return statusTransactionInternal(options);
  } catch (error) {
    const context = transactionContextFromDisk(options.home ?? process.env.HOME, options.transactionId);
    throw contextualizeTransactionError(error, { command: 'status', ...context });
  }
}

export async function applyItem(options = {}) {
  try {
    return await applyItemInternal(options);
  } catch (error) {
    const transactionId = options.plan?.items?.length === 1
      ? options.plan.items[0].transaction_id
      : undefined;
    const context = transactionContextFromDisk(options.home ?? process.env.HOME, transactionId);
    throw contextualizeTransactionError(error, { command: 'apply', ...context });
  }
}

export async function undoTransaction(options = {}) {
  try {
    return await undoTransactionInternal(options);
  } catch (error) {
    const context = transactionContextFromDisk(options.home ?? process.env.HOME, options.transactionId);
    throw contextualizeTransactionError(error, { command: 'undo', ...context });
  }
}

function stateForBatchFailure(result) {
  if (result.items.some(({ status }) => status === 'RECOVERY_REQUIRED')) {
    return 'RECOVERY_REQUIRED';
  }
  if (result.overall_status === 'PARTIAL') return 'PARTIAL';
  if (result.overall_status === 'RECOVERY_REQUIRED') return 'RECOVERY_REQUIRED';
  return 'BLOCKED';
}

async function applyPlanInternal({
  home = process.env.HOME,
  plan,
  confirmation,
  fault = null,
} = {}) {
  try {
    validatePlan(plan);
  } catch {
    throw new CleanupBatchError('invalid_plan', 'invalid', {
      errorCode: 'invalid_plan',
      failureScope: 'batch',
      failureItemId: null,
      failureIndex: null,
    });
  }
  if (confirmation !== plan.plan_hash) {
    throw new CleanupBatchError('confirmation_mismatch', 'invalid', {
      errorCode: 'confirmation_mismatch',
      failureScope: 'batch',
      failureItemId: null,
      failureIndex: null,
    });
  }
  if (plan.items.length < 2) {
    throw new CleanupBatchError('batch_requires_multiple_items', 'unsupported', {
      errorCode: 'batch_requires_multiple_items',
      failureScope: 'batch',
      failureItemId: null,
      failureIndex: null,
    });
  }
  assertBatchPlanCapacity(plan);
  let batch;
  try {
    batch = initializeBatch({ home, plan });
  } catch (error) {
    const transactionError = normalizedTransactionError(error);
    if (transactionError === null) throw error;
    const batchPlan = buildBatchPlan(plan);
    const { mutationOccurred, mutationOutcome } = joinMutationTruth(
      'apply', transactionError,
    );
    const truth = rebuildBatchTruthForReporting({ home, plan });
    const historicalMutation = truth.items.some((item) => (
      item.status === 'COMMITTED' || item.transaction_has_mutated
    ));
    const errorCode = mutationOutcome === 'unknown' && !historicalMutation
      ? BATCH_ERROR_CODES.batchMutationOutcomeUnknown
      : BATCH_ERROR_CODES.batchRecordsInvalid;
    const built = buildBatchScopedRecovery({
      home,
      plan,
      batchPlan,
    }, truth,
      mutationOccurred,
      mutationOutcome,
      errorCode,
    );
    throw built.error;
  }

  let owner;
  try {
    await faultAt(fault, 'before_batch_lock_acquire', {
      batch_id: batch.batchPlan.batch_id,
    });
    owner = acquireBatchLock({
      home,
      batchId: batch.batchPlan.batch_id,
      planHash: batch.batchPlan.plan_hash,
      executionIdentity: batch.executionIdentity,
    });
  } catch (error) {
    const transactionError = normalizedTransactionError(error);
    if (transactionError === null) throw error;
    let truth = rebuildBatchTruth(batch);
    const unfinishedMutation = truth.items.findIndex((item) => (
      item.status !== 'COMMITTED' && item.transaction_has_mutated
    ));
    if (firstFailedObservation(truth) === null && unfinishedMutation >= 0) {
      truth.items[unfinishedMutation].status = 'RECOVERY_REQUIRED';
      truth.observations[unfinishedMutation] = {
        ...truth.observations[unfinishedMutation],
        status: 'RECOVERY_REQUIRED',
        summaryStatus: 'RECOVERY_REQUIRED',
        error: transactionError,
      };
    }
    if (firstFailedObservation(truth) !== null) {
      const mutationTruth = joinMutationTruth('apply', transactionError);
      throw buildFailureResult(
        batch,
        truth,
        mutationTruth.mutationOccurred,
        mutationTruth.mutationOutcome,
      ).error;
    }
    truth = stopFirstFailureTruth(truth);
    const { mutationOccurred, mutationOutcome } = joinMutationTruth(
      'apply', transactionError,
    );
    const historicalMutation = truth.items.some(({ transaction_has_mutated: mutated }) => mutated);
    const recoveryRequired = transactionError.status === 'recovery_required'
      || mutationOutcome === 'unknown'
      || historicalMutation;
    const errorCode = mutationOutcome === 'unknown'
      ? BATCH_ERROR_CODES.batchMutationOutcomeUnknown
      : (recoveryRequired
        ? BATCH_ERROR_CODES.batchLockAcquireFailed
        : BATCH_ERROR_CODES.batchLockUnavailable);
    const result = buildBatchError({
      batchPlan: batch.batchPlan,
      status: recoveryRequired ? 'recovery_required' : 'blocked',
      overallStatus: recoveryRequired ? 'RECOVERY_REQUIRED' : 'blocked',
      items: batchErrorItems(truth.items),
      mutationOccurred,
      mutationOutcome,
      errorCode,
      failureScope: 'batch',
    });
    throw batchError(
      errorCode,
      recoveryRequired ? 'recovery_required' : 'blocked',
      result,
    );
  }

  let pendingError = null;
  let returnValue = null;
  let mutationOccurred = false;
  let activeIndex = null;
  try {
    const leasedRecords = probeBatchRecords({
      home,
      batchId: batch.batchPlan.batch_id,
      executionIdentity: batch.executionIdentity,
    });
    validateBatchRecordSet(leasedRecords, batch.batchPlan, batch.plan);
    if (canonicalJson(leasedRecords.lock) !== canonicalJson(owner)) {
      fail('batch_lock_identity_invalid', 'recovery_required');
    }
    batch.batchState = leasedRecords.state;
    batch.batchLock = leasedRecords.lock;

    let truth = rebuildBatchTruth(batch);
    let failure = firstFailedObservation(truth);
    if (failure !== null) {
      const built = buildFailureResult(batch, truth, mutationOccurred);
      advanceBatchProjection(batch, owner, stateForBatchFailure(built.result), built.result.items);
      throw built.error;
    }

    if (truth.items.every(({ status }) => status === 'COMMITTED')) {
      if (batch.batchState.state !== 'COMMITTED'
          || canonicalJson(batch.batchState.items)
            !== canonicalJson(durableBatchItems(truth.items))) {
        await faultAt(fault, 'before_batch_state_update', {
          batch_id: batch.batchPlan.batch_id,
          index: batch.plan.items.length - 1,
        });
        advanceBatchProjection(batch, owner, 'COMMITTED', truth.items);
        await faultAt(fault, 'after_batch_state_update', {
          batch_id: batch.batchPlan.batch_id,
          index: batch.plan.items.length - 1,
        });
      }
      returnValue = buildBatchResult({
        batchPlan: batch.batchPlan,
        status: 'already_committed',
        overallStatus: 'committed',
        items: truth.items,
        mutationOccurred: false,
      });
    } else {
      if (batch.batchState.state !== 'RUNNING'
          || canonicalJson(batch.batchState.items)
            !== canonicalJson(durableBatchItems(truth.items))) {
        advanceBatchProjection(batch, owner, 'RUNNING', truth.items);
      }
      for (let index = 0; index < batch.plan.items.length; index += 1) {
        activeIndex = index;
        const planItem = batch.plan.items[index];
        await faultAt(fault, 'before_batch_item_start', {
          batch_id: batch.batchPlan.batch_id,
          index,
          item_id: planItem.item_id,
          transaction_id: planItem.transaction_id,
        });

        truth = rebuildBatchTruth(batch);
        failure = firstFailedObservation(truth);
        if (failure !== null) {
          const built = buildFailureResult(batch, truth, mutationOccurred);
          advanceBatchProjection(batch, owner, stateForBatchFailure(built.result), built.result.items);
          throw built.error;
        }
        if (truth.items[index].status === 'COMMITTED') continue;

        const applied = await applyBatchTransaction({
          batch,
          transaction: truth.observations[index].transaction,
          owner,
          index,
          fault,
        });
        mutationOccurred ||= applied.mutationOccurred;
        await faultAt(fault, 'after_batch_item_commit', {
          batch_id: batch.batchPlan.batch_id,
          index,
          item_id: planItem.item_id,
          transaction_id: planItem.transaction_id,
        });

        truth = rebuildBatchTruth(batch);
        failure = firstFailedObservation(truth);
        if (failure !== null) {
          const built = buildFailureResult(batch, truth, mutationOccurred);
          advanceBatchProjection(batch, owner, stateForBatchFailure(built.result), built.result.items);
          throw built.error;
        }
        const nextBatchState = truth.items.every(({ status }) => status === 'COMMITTED')
          ? 'COMMITTED'
          : 'RUNNING';
        await faultAt(fault, 'before_batch_state_update', {
          batch_id: batch.batchPlan.batch_id,
          index,
          item_id: planItem.item_id,
          transaction_id: planItem.transaction_id,
        });
        advanceBatchProjection(batch, owner, nextBatchState, truth.items);
        await faultAt(fault, 'after_batch_state_update', {
          batch_id: batch.batchPlan.batch_id,
          index,
          item_id: planItem.item_id,
          transaction_id: planItem.transaction_id,
        });
      }
      truth = rebuildBatchTruth(batch);
      returnValue = buildBatchResult({
        batchPlan: batch.batchPlan,
        status: 'committed',
        overallStatus: 'committed',
        items: truth.items,
        mutationOccurred,
      });
    }
  } catch (error) {
    if (error instanceof CleanupBatchError) {
      pendingError = error;
    } else {
      const transactionError = normalizedTransactionError(error)
        ?? new CleanupTransactionError(
          'batch_execution_interrupted',
          'cleanup batch execution was interrupted',
          'recovery_required',
        );
      const truth = rebuildBatchTruth(batch);
      const mutationTruth = joinMutationTruth(
        'apply',
        {
          mutationOccurred,
          mutationOutcome: mutationOccurred ? 'moved' : 'unchanged',
        },
        transactionError,
      );
      const currentMutation = mutationTruth.mutationOccurred;
      const { mutationOutcome } = mutationTruth;
      let built;
      const failed = firstFailedObservation(truth);
      const ambiguousItemIndex = failed?.observation.status === 'RECOVERY_REQUIRED'
          && truth.items[failed.index].transaction_has_mutated
        ? failed.index
        : (activeIndex !== null
            && truth.items[activeIndex].status !== 'COMMITTED'
            && truth.items[activeIndex].transaction_has_mutated
          ? activeIndex
          : null);
      if (transactionError.code === BATCH_ERROR_CODES.batchStateProjectionFailed) {
        built = buildBatchScopedRecovery(
          batch,
          truth,
          currentMutation,
          mutationOutcome,
          BATCH_ERROR_CODES.batchStateProjectionFailed,
        );
      } else if (currentMutation && mutationOutcome === 'unknown'
          && ambiguousItemIndex === null) {
        built = buildBatchScopedRecovery(
          batch,
          truth,
          true,
          'unknown',
          BATCH_ERROR_CODES.batchMutationOutcomeUnknown,
        );
      } else if (truth.items.every(({ status }) => status === 'COMMITTED')) {
        built = buildBatchScopedRecovery(
          batch,
          truth,
          currentMutation,
          mutationOutcome,
          transactionError.code,
        );
      } else {
        if (firstFailedObservation(truth) === null) {
          const index = activeIndex !== null
              && truth.items[activeIndex].status !== 'COMMITTED'
            ? activeIndex
            : truth.items.findIndex(({ status }) => status !== 'COMMITTED');
          truth.items[index].status = transactionError.status === 'recovery_required'
            ? 'RECOVERY_REQUIRED'
            : 'BLOCKED';
          truth.observations[index] = {
            ...truth.observations[index],
            status: truth.items[index].status,
            error: transactionError,
          };
        }
        built = buildFailureResult(
          batch,
          truth,
          currentMutation,
          mutationOutcome,
        );
        try {
          advanceBatchProjection(batch, owner, stateForBatchFailure(built.result), built.result.items);
        } catch (projectionFailure) {
          const projectionError = normalizedTransactionError(projectionFailure)
            ?? batchStateProjectionError(projectionFailure);
          const observed = rebuildBatchTruth(batch, {
            ignoreLeaseMismatchForReporting: true,
          });
          const items = mergeBatchErrorItems(built.result.items, observed.items);
          const projectionMutation = joinMutationTruth(
            'apply',
            built.error,
            projectionError,
            {
              mutationOccurred,
              mutationOutcome: mutationOccurred ? 'moved' : 'unchanged',
            },
          );
          built = buildBatchScopedRecovery(
            batch,
            { ...observed, items },
            projectionMutation.mutationOccurred,
            projectionMutation.mutationOutcome,
            BATCH_ERROR_CODES.batchStateProjectionFailed,
          );
        }
      }
      pendingError = built.error;
    }
  }

  try {
    await faultAt(fault, 'before_batch_lock_release', {
      batch_id: batch.batchPlan.batch_id,
    });
    releaseBatchLock({
      home,
      batchId: batch.batchPlan.batch_id,
      planHash: batch.batchPlan.plan_hash,
      owner,
      executionIdentity: batch.executionIdentity,
    });
  } catch (error) {
    const transactionError = normalizedTransactionError(error);
    if (transactionError === null) throw error;
    const observed = rebuildBatchTruth(batch, { ignoreLeaseMismatchForReporting: true });
    const items = mergeBatchErrorItems(pendingError?.items ?? null, observed.items);
    const mutationTruth = joinMutationTruth(
      'apply',
      {
        mutationOccurred,
        mutationOutcome: mutationOccurred ? 'moved' : 'unchanged',
      },
      pendingError,
      transactionError,
    );
    const built = buildBatchScopedRecovery(
      batch,
      { ...observed, items },
      mutationTruth.mutationOccurred,
      mutationTruth.mutationOutcome,
      BATCH_ERROR_CODES.batchLockReleaseFailed,
    );
    throw built.error;
  }

  if (pendingError !== null) throw pendingError;
  return returnValue;
}

export async function applyPlan(options = {}) {
  return applyPlanInternal(options);
}

export const __testing = Object.freeze({
  joinMutationTruth,
  rebuildBatchTruthForReporting,
  untouchedStaleBatchCanRelease,
});
