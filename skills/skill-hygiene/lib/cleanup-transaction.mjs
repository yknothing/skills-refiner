import {
  SCHEMAS,
  canonicalJson,
  sha256Json,
  transactionStorageKey,
  validatePlan,
  validateTransactionResult,
} from './cleanup-contract.mjs';
import {
  MacosAdapterError,
  acquireTransactionLock,
  advanceTransactionStateRecord,
  discoverTransactionRecords,
  initializeTransactionRecords,
  isolateStaleTransactionLock,
  probeTransactionRecords,
  reconcileTransactionLocation,
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
    return new CleanupTransactionError(
      error.reason,
      'cleanup transaction failed',
      error.code === 'recovery_required' ? 'recovery_required' : error.code,
    );
  }
  return null;
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateState(state, manifest) {
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
    const lockKeys = [
      'nonce',
      'pid',
      'plan_hash',
      'process_start_sec',
      'process_start_usec',
      'transaction_id',
    ];
    if (Object.keys(state.lock).length !== lockKeys.length
        || lockKeys.some((key) => !Object.hasOwn(state.lock, key))
        || !/^[0-9a-f]{64}$/u.test(state.lock.nonce ?? '')
        || !Number.isSafeInteger(state.lock.pid) || state.lock.pid <= 0
        || !Number.isSafeInteger(state.lock.process_start_sec) || state.lock.process_start_sec < 0
        || !Number.isSafeInteger(state.lock.process_start_usec) || state.lock.process_start_usec < 0
        || state.lock.plan_hash !== manifest.plan_hash
        || state.lock.transaction_id !== manifest.transaction_id) {
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
    return `cleanup undo ${transactionId} --confirm ${transactionId}`;
  }
  if (status === 'ready_to_resume_apply' || status === 'ready_to_finalize_commit') {
    return `cleanup apply --plan PLAN_FILE --confirm ${transaction.manifest.plan_hash}`;
  }
  if (status === 'drifted') return 'cleanup review --json';
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
    const transaction = transactionFromRecords(home, records, transactionId);
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
