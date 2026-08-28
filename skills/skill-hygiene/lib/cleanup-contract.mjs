import { createHash } from 'node:crypto';

export const SCHEMAS = Object.freeze({
  error: 'skills-refiner.cleanup.error.v1',
  review: 'skills-refiner.cleanup.review.v1',
  decisions: 'skills-refiner.cleanup.decisions.v1',
  plan: 'skills-refiner.cleanup.plan.v1',
  transaction: 'skills-refiner.cleanup.transaction.v1',
  transactionManifest: 'skills-refiner.cleanup.transaction-manifest.v1',
  transactionState: 'skills-refiner.cleanup.transaction-state.v1',
  identity: 'skills-refiner.cleanup.identity.v1',
  observationIdentity: 'skills-refiner.cleanup.observation-identity.v1',
  batch: 'skills-refiner.cleanup.batch.v1',
  batchPlan: 'skills-refiner.cleanup.batch-plan.v1',
  batchState: 'skills-refiner.cleanup.batch-state.v1',
  batchBinding: 'skills-refiner.cleanup.batch-binding.v1',
  batchError: 'skills-refiner.cleanup.batch-error.v1',
  batchSummary: 'skills-refiner.cleanup.batch-summary.v1',
  transactionBatchStatus: 'skills-refiner.cleanup.transaction-batch-status.v1',
  applyReport: 'skills-refiner.cleanup.apply-report.v1',
  postScan: 'skills-refiner.cleanup.post-scan.v1',
});

export const ACTIONS = Object.freeze(['quarantine']);
export const CLEANUP_BATCH_MAX_ITEMS = 8;

export const BATCH_ERROR_CODES = Object.freeze({
  preflightDrift: 'batch_preflight_drift',
  itemBlocked: 'batch_item_blocked',
  itemRecoveryRequired: 'batch_item_recovery_required',
  itemOutcomeAmbiguous: 'batch_item_outcome_ambiguous',
  batchLockUnavailable: 'batch_lock_unavailable',
  batchStateProjectionFailed: 'batch_state_projection_failed',
  batchRecoveryRequired: 'batch_recovery_required',
  batchRecordsInvalid: 'batch_records_invalid',
  batchMutationOutcomeUnknown: 'batch_mutation_outcome_unknown',
  batchLockAcquireFailed: 'batch_lock_acquire_failed',
  batchLockReleaseFailed: 'batch_lock_release_failed',
});

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractError';
  }
}

function fail(message) {
  throw new ContractError(message);
}

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalize(value, path, ancestors) {
  if (value === null) return 'null';

  if (typeof value === 'string') {
    if (CONTROL_CHARACTERS.test(value)) fail(`${path} contains a control character`);
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must be JSON-compatible`);
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') fail(`${path} must be JSON-compatible`);
  if (ancestors.has(value)) fail(`${path} must be JSON-compatible`);
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail(`${path} must not contain a sparse array`);
      }
      for (const key of Reflect.ownKeys(descriptors)) {
        if (key === 'length') continue;
        const descriptor = descriptors[key];
        const index = typeof key === 'string' && /^(0|[1-9]\d*)$/u.test(key) ? Number(key) : -1;
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.length
            || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          fail(`${path} must be JSON-compatible`);
        }
      }
      return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, ancestors)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(`${path} must be JSON-compatible`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || CONTROL_CHARACTERS.test(key)
          || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail(`${path} must be JSON-compatible`);
      }
    }

    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], `${path}.*`, ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value) {
  return canonicalize(value, '$', new WeakSet());
}

export function sha256Json(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export function validateSha256(value, field = 'digest') {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${field} must be a sha256 digest`);
  return value;
}

export function computePlanHash(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('plan must be JSON-compatible');
  canonicalJson(plan);
  const { created_at: _createdAt, plan_hash: _planHash, ...hashInput } = plan;
  if (Array.isArray(hashInput.items)) {
    hashInput.items = hashInput.items.map(({ transaction_id: _transactionId, ...item }) => item);
  }
  return sha256Json(hashInput);
}

export function computeItemHash(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('item must be JSON-compatible');
  canonicalJson(item);
  const { item_hash: _itemHash, transaction_id: _transactionId, ...hashInput } = item;
  return sha256Json(hashInput);
}

export function partitionPlan(plan, maxItems = CLEANUP_BATCH_MAX_ITEMS) {
  validatePlan(plan);
  if (!Number.isSafeInteger(maxItems) || maxItems < 1
      || maxItems > CLEANUP_BATCH_MAX_ITEMS) {
    fail('plan partition size is unsupported');
  }
  const children = [];
  for (let offset = 0; offset < plan.items.length; offset += maxItems) {
    const child = {
      schema_version: plan.schema_version,
      product_version: plan.product_version,
      platform: plan.platform,
      authorization_id: plan.authorization_id,
      scan_fingerprint: plan.scan_fingerprint,
      created_at: plan.created_at,
      items: plan.items.slice(offset, offset + maxItems).map((item) => {
        const { transaction_id: _transactionId, ...copy } = item;
        return copy;
      }),
    };
    child.plan_hash = computePlanHash(child);
    child.items = child.items.map((item) => ({
      ...item,
      transaction_id: deriveTransactionId(child.plan_hash, item.item_id),
    }));
    children.push(validatePlan(child));
  }
  return Object.freeze(children);
}

export function computeIdentityHash(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    fail('identity must be JSON-compatible');
  }
  canonicalJson(identity);
  const { identity_hash: _identityHash, ...hashInput } = identity;
  return sha256Json(hashInput);
}

export function computeObservationIdentityHash(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    fail('observation identity must be JSON-compatible');
  }
  canonicalJson(identity);
  const { identity_hash: _identityHash, ...hashInput } = identity;
  return sha256Json(hashInput);
}

export function deriveTransactionId(planHash, itemId) {
  validateSha256(planHash, 'plan_hash');
  validateSha256(itemId, 'item_id');
  return sha256Json({ plan_hash: planHash, item_id: itemId });
}

export function transactionStorageKey(transactionId) {
  validateSha256(transactionId, 'transaction_id');
  return transactionId.slice('sha256:'.length);
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
}

function exactKeys(value, allowed, required, path) {
  requireObject(value, path);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path} contains an unknown key`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${path} is missing a required key`);
  }
}

function safeNonEmptyString(value, path, maximumLength = 4096) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength
      || CONTROL_CHARACTERS.test(value)) {
    fail(`${path} must be a safe non-empty string`);
  }
}

const PLAN_KEYS = new Set([
  'schema_version',
  'product_version',
  'platform',
  'authorization_id',
  'scan_fingerprint',
  'plan_hash',
  'created_at',
  'items',
]);
const PLAN_REQUIRED_KEYS = [...PLAN_KEYS];
const ITEM_KEYS = new Set([
  'item_id',
  'item_hash',
  'transaction_id',
  'action',
  'entry_path',
  'active_root',
  'entry_kind',
  'execution_identity',
  'preconditions',
  'expected_postconditions',
  'risk',
]);
const ITEM_REQUIRED_KEYS = [
  'item_id',
  'item_hash',
  'transaction_id',
  'action',
  'entry_path',
  'active_root',
  'entry_kind',
  'execution_identity',
  'preconditions',
  'expected_postconditions',
  'risk',
];
const IDENTITY_KEYS = new Set([
  'schema_version',
  'adapter',
  'entry_path',
  'active_root',
  'entry_kind',
  'identity_hash',
  'source_hash',
  'binary_hash',
  'architecture',
  'compiler_path',
  'compiler_version',
  'helper_protocol',
  'cache_path',
  'device',
  'inode',
  'mode',
  'uid',
  'gid',
  'flags',
  'manifest_hash',
  'security_metadata_hash',
  'raw_link_target_base64',
  'receipt_sha256',
  'installed_tree_sha1',
]);
const OBSERVATION_IDENTITY_KEYS = new Set([
  'schema_version',
  'adapter',
  'entry_path',
  'active_root',
  'entry_kind',
  'identity_hash',
  'source_hash',
  'binary_hash',
  'architecture',
  'compiler_path',
  'compiler_version',
  'helper_protocol',
  'cache_path',
  'device',
  'inode',
  'mode',
  'uid',
  'gid',
  'flags',
  'manifest_hash',
  'security_metadata_hash',
  'raw_link_target_base64',
]);
const PRECONDITION_KEYS = new Set([
  'review_fingerprint',
  'candidate_fingerprint',
  'scan_fingerprint',
  'execution_identity_hash',
]);
const POSTCONDITION_KEYS = new Set([
  'active_entry_absent',
  'quarantine_entry_present',
]);
const TRANSACTION_RESULT_KEYS = new Set([
  'schema_version',
  'command',
  'status',
  'overall_status',
  'transaction_id',
  'state',
  'location',
  'mutation_occurred',
  'mutation_outcome',
  'transaction_has_mutated',
  'committed_transaction_ids',
  'next_safe_command',
]);
const TRANSACTION_RESULT_REQUIRED_KEYS = [...TRANSACTION_RESULT_KEYS]
  .filter((key) => key !== 'next_safe_command');
const APPLY_REPORT_KEYS = new Set([
  'schema_version',
  'command',
  'apply_outcome',
  'post_scan',
]);
const POST_SCAN_KEYS = new Set([
  'schema_version',
  'observation_status',
  'scanner_schema',
  'error_code',
  'items',
  'warnings',
]);
const POST_SCAN_ITEM_KEYS = new Set([
  'item_id',
  'transaction_id',
  'entry_path',
  'status',
  'location',
  'baseline_identity_hash',
  'observed_identity_hash',
]);
const POST_SCAN_STATUSES = new Set([
  'QUARANTINED',
  'REHYDRATED',
  'RESTORE_CONFLICT',
  'INDETERMINATE',
]);
const POST_SCAN_OBSERVATION_STATUSES = new Set(['COMPLETE', 'PARTIAL', 'UNAVAILABLE']);
const POST_SCAN_ERROR_CODES = new Set([
  'scanner_unavailable',
  'scanner_invalid',
  'status_unavailable',
  'native_observation_unavailable',
  'observation_race',
  'semantic_identity_unavailable',
  'post_scan_internal_error',
]);
const POST_SCAN_LOCATIONS = new Set(['quarantine', 'rehydrated', 'unknown']);
const POST_SCAN_BASE_WARNINGS = Object.freeze([
  'installer_may_redeploy',
  'running_agent_may_cache',
]);
const POST_SCAN_REHYDRATION_WARNING = 'automatic_requarantine_disabled';
const TRANSACTION_STATES = new Set([
  'PLANNED',
  'CONFIRMED',
  'PREPARED',
  'APPLYING',
  'COMMITTED',
  'BLOCKED',
  'ABORTED',
  'RECOVERY_REQUIRED',
  'RESTORE_PREPARED',
  'RESTORING',
  'RESTORED',
]);
const TRANSACTION_STATUSES = Object.freeze({
  apply: new Set(['committed', 'already_committed']),
  status: new Set([
    'ready_to_resume_apply',
    'ready_to_finalize_commit',
    'committed',
    'rehydrated',
    'drifted',
    'ready_to_resume_undo',
    'ready_to_finalize_restore',
    'restore_conflict',
    'restored',
  ]),
  undo: new Set(['restored', 'already_restored']),
});

export function validateExecutionIdentity(identity, {
  entryPath = undefined,
  activeRoot = undefined,
  entryKind = undefined,
} = {}) {
  exactKeys(identity, IDENTITY_KEYS, [...IDENTITY_KEYS], 'execution identity');
  canonicalJson(identity);
  if (identity.schema_version !== SCHEMAS.identity) {
    fail(`execution identity schema mismatch: expected ${SCHEMAS.identity}`);
  }
  safeNonEmptyString(identity.adapter, 'execution identity.adapter', 128);
  safeNonEmptyString(identity.entry_path, 'execution identity.entry_path');
  safeNonEmptyString(identity.active_root, 'execution identity.active_root');
  if (!['directory', 'symlink', 'broken_symlink'].includes(identity.entry_kind)) {
    fail('execution identity entry_kind is unsupported');
  }
  if ((entryPath !== undefined && identity.entry_path !== entryPath)
      || (activeRoot !== undefined && identity.active_root !== activeRoot)
      || (entryKind !== undefined && identity.entry_kind !== entryKind)) {
    fail('execution identity does not match the expected entry');
  }
  validateSha256(identity.identity_hash, 'execution identity.identity_hash');
  if (identity.identity_hash !== computeIdentityHash(identity)) {
    fail('execution identity identity_hash does not match canonical identity content');
  }
  validateSha256(identity.source_hash, 'execution identity.source_hash');
  validateSha256(identity.binary_hash, 'execution identity.binary_hash');
  safeNonEmptyString(identity.architecture, 'execution identity.architecture', 32);
  safeNonEmptyString(identity.compiler_path, 'execution identity.compiler_path');
  safeNonEmptyString(identity.compiler_version, 'execution identity.compiler_version', 4096);
  safeNonEmptyString(identity.helper_protocol, 'execution identity.helper_protocol', 128);
  safeNonEmptyString(identity.cache_path, 'execution identity.cache_path');
  if (!/^\d+$/u.test(identity.device) || !/^\d+$/u.test(identity.inode)) {
    fail('execution identity object identifiers are unsupported');
  }
  for (const field of ['mode', 'uid', 'gid', 'flags']) {
    if (!Number.isSafeInteger(identity[field]) || identity[field] < 0) {
      fail('execution identity native metadata is unsupported');
    }
  }
  validateSha256(identity.manifest_hash, 'execution identity.manifest_hash');
  validateSha256(identity.security_metadata_hash, 'execution identity.security_metadata_hash');
  const rawTarget = identity.raw_link_target_base64;
  if (rawTarget !== null && (typeof rawTarget !== 'string' || !BASE64.test(rawTarget))) {
    fail('execution identity raw link target is unsupported');
  }
  if (identity.entry_kind === 'directory') {
    if (typeof identity.receipt_sha256 !== 'string'
        || !/^[0-9a-f]{64}$/u.test(identity.receipt_sha256)
        || typeof identity.installed_tree_sha1 !== 'string'
        || !SHA1.test(identity.installed_tree_sha1)
        || rawTarget !== null) {
      fail('execution identity installed-copy evidence is unsupported');
    }
  } else if (identity.receipt_sha256 !== null || identity.installed_tree_sha1 !== null
      || typeof rawTarget !== 'string') {
    fail('execution identity link evidence is unsupported');
  }
  return identity;
}

export function validateObservationIdentity(identity) {
  exactKeys(
    identity,
    OBSERVATION_IDENTITY_KEYS,
    [...OBSERVATION_IDENTITY_KEYS],
    'observation identity',
  );
  canonicalJson(identity);
  if (identity.schema_version !== SCHEMAS.observationIdentity) {
    fail(`observation identity schema mismatch: expected ${SCHEMAS.observationIdentity}`);
  }
  safeNonEmptyString(identity.adapter, 'observation identity.adapter', 128);
  safeNonEmptyString(identity.entry_path, 'observation identity.entry_path');
  safeNonEmptyString(identity.active_root, 'observation identity.active_root');
  if (!['directory', 'symlink', 'broken_symlink'].includes(identity.entry_kind)) {
    fail('observation identity entry_kind is unsupported');
  }
  validateSha256(identity.identity_hash, 'observation identity.identity_hash');
  if (identity.identity_hash !== computeObservationIdentityHash(identity)) {
    fail('observation identity identity_hash does not match canonical identity content');
  }
  validateSha256(identity.source_hash, 'observation identity.source_hash');
  validateSha256(identity.binary_hash, 'observation identity.binary_hash');
  safeNonEmptyString(identity.architecture, 'observation identity.architecture', 32);
  safeNonEmptyString(identity.compiler_path, 'observation identity.compiler_path');
  safeNonEmptyString(identity.compiler_version, 'observation identity.compiler_version', 4096);
  safeNonEmptyString(identity.helper_protocol, 'observation identity.helper_protocol', 128);
  safeNonEmptyString(identity.cache_path, 'observation identity.cache_path');
  if (!/^\d+$/u.test(identity.device) || !/^\d+$/u.test(identity.inode)) {
    fail('observation identity object identifiers are unsupported');
  }
  for (const field of ['mode', 'uid', 'gid', 'flags']) {
    if (!Number.isSafeInteger(identity[field]) || identity[field] < 0) {
      fail('observation identity native metadata is unsupported');
    }
  }
  validateSha256(identity.manifest_hash, 'observation identity.manifest_hash');
  validateSha256(
    identity.security_metadata_hash,
    'observation identity.security_metadata_hash',
  );
  if (identity.entry_kind === 'directory') {
    if (identity.raw_link_target_base64 !== null) {
      fail('observation identity directory link target is unsupported');
    }
  } else if (typeof identity.raw_link_target_base64 !== 'string'
      || identity.raw_link_target_base64.length === 0
      || !BASE64.test(identity.raw_link_target_base64)) {
    fail('observation identity link target is unsupported');
  }
  return identity;
}

export function validateTransactionResult(result) {
  exactKeys(
    result,
    TRANSACTION_RESULT_KEYS,
    TRANSACTION_RESULT_REQUIRED_KEYS,
    'transaction_result',
  );
  if (result.schema_version !== SCHEMAS.transaction) {
    fail(`transaction result schema mismatch: expected ${SCHEMAS.transaction}`);
  }
  canonicalJson(result);
  if (!Object.hasOwn(TRANSACTION_STATUSES, result.command)
      || !TRANSACTION_STATUSES[result.command].has(result.status)
      || result.overall_status !== result.status) {
    fail('transaction result command or status is unsupported');
  }
  validateSha256(result.transaction_id, 'transaction_result.transaction_id');
  if (!TRANSACTION_STATES.has(result.state)) fail('transaction result state is unsupported');
  if (!['original', 'original_drift', 'quarantine', 'rehydrated'].includes(result.location)) {
    fail('transaction result location is unsupported');
  }
  if (typeof result.mutation_occurred !== 'boolean'
      || typeof result.transaction_has_mutated !== 'boolean'
      || !['unchanged', 'moved', 'restored'].includes(result.mutation_outcome)
      || (result.command === 'status' && result.mutation_occurred !== false)
      || (result.mutation_occurred === false && result.mutation_outcome !== 'unchanged')
      || (result.mutation_occurred === true
        && result.mutation_outcome !== (result.command === 'undo' ? 'restored' : 'moved'))) {
    fail('transaction result mutation truth is invalid');
  }
  const historicalMutationRequired = [
    'COMMITTED',
    'RESTORE_PREPARED',
    'RESTORING',
    'RESTORED',
  ].includes(result.state) || ['quarantine', 'rehydrated'].includes(result.location);
  if ((historicalMutationRequired || result.mutation_occurred)
      && result.transaction_has_mutated !== true) {
    fail('transaction result historical mutation truth is invalid');
  }
  if (!Array.isArray(result.committed_transaction_ids)
      || result.committed_transaction_ids.length !== (result.state === 'COMMITTED' ? 1 : 0)
      || (result.state === 'COMMITTED'
        && result.committed_transaction_ids[0] !== result.transaction_id)) {
    fail('transaction result committed IDs are invalid');
  }
  if (Object.hasOwn(result, 'next_safe_command')
      && result.next_safe_command !== null) {
    safeNonEmptyString(result.next_safe_command, 'transaction_result.next_safe_command', 512);
  }
  return result;
}

function validateApplyOutcome(outcome) {
  requireObject(outcome, 'apply report.apply_outcome');
  if (outcome.schema_version === SCHEMAS.transaction) {
    validateTransactionResult(outcome);
    if (outcome.command !== 'apply' || outcome.state !== 'COMMITTED'
        || outcome.committed_transaction_ids.length !== 1) {
      fail('apply report transaction outcome is not committed');
    }
    return outcome.committed_transaction_ids;
  }
  if (outcome.schema_version === SCHEMAS.batch) {
    validateBatchResult(outcome);
  } else if (outcome.schema_version === SCHEMAS.batchError) {
    validateBatchError(outcome);
  } else {
    fail('apply report outcome schema is unsupported');
  }
  if (outcome.committed_transaction_ids.length === 0) {
    fail('apply report batch outcome has no committed prefix');
  }
  return outcome.committed_transaction_ids;
}

export function validatePostScanReport(
  report,
  committedTransactionIds = null,
  plan = null,
) {
  exactKeys(report, POST_SCAN_KEYS, [...POST_SCAN_KEYS], 'post-scan report');
  canonicalJson(report);
  if (report.schema_version !== SCHEMAS.postScan
      || !POST_SCAN_OBSERVATION_STATUSES.has(report.observation_status)
      || !Array.isArray(report.items) || report.items.length === 0) {
    fail(`post-scan report schema mismatch: expected ${SCHEMAS.postScan}`);
  }
  const supportedScanner = ['skill-scan.v5', 'skill-scan.v6', 'skill-scan.v7']
    .includes(report.scanner_schema);
  if ((report.scanner_schema !== null && !supportedScanner)
      || (report.error_code !== null && !POST_SCAN_ERROR_CODES.has(report.error_code))) {
    fail('post-scan observation metadata is invalid');
  }
  if ((report.observation_status === 'COMPLETE'
      && (!supportedScanner || report.error_code !== null))
    || (report.observation_status === 'PARTIAL'
      && (!supportedScanner || report.error_code === null))
    || (report.observation_status === 'UNAVAILABLE'
      && (report.scanner_schema !== null || report.error_code === null))) {
    fail('post-scan observation status contradicts scanner or error truth');
  }
  if ((report.observation_status === 'UNAVAILABLE'
      && !['scanner_unavailable', 'scanner_invalid', 'post_scan_internal_error']
        .includes(report.error_code))
    || (report.observation_status === 'PARTIAL'
      && ['scanner_unavailable', 'scanner_invalid'].includes(report.error_code))) {
    fail('post-scan error code contradicts observation availability');
  }
  const seen = new Set();
  for (const item of report.items) {
    exactKeys(item, POST_SCAN_ITEM_KEYS, [...POST_SCAN_ITEM_KEYS], 'post-scan item');
    validateSha256(item.item_id, 'post-scan item.item_id');
    validateSha256(item.transaction_id, 'post-scan item.transaction_id');
    safeNonEmptyString(item.entry_path, 'post-scan item.entry_path');
    if (seen.has(item.transaction_id) || !POST_SCAN_STATUSES.has(item.status)
        || !POST_SCAN_LOCATIONS.has(item.location)) {
      fail('post-scan item identity or status is invalid');
    }
    seen.add(item.transaction_id);
    for (const field of [
      'baseline_identity_hash',
      'observed_identity_hash',
    ]) {
      if (item[field] !== null) validateSha256(item[field], `post-scan item.${field}`);
    }
    const baseline = item.baseline_identity_hash;
    const observed = item.observed_identity_hash;
    if ((item.status === 'REHYDRATED'
        && (item.location !== 'rehydrated' || baseline === null || observed === null
          || baseline !== observed))
      || (item.status === 'RESTORE_CONFLICT'
        && item.location !== 'rehydrated')
      || (item.status === 'QUARANTINED'
        && (item.location !== 'quarantine' || observed !== null))
      || (item.status === 'INDETERMINATE' && item.location !== 'unknown')) {
      fail('post-scan item status contradicts semantic identity evidence');
    }
  }
  if ((report.observation_status === 'COMPLETE'
      && report.items.some(({ status }) => status === 'INDETERMINATE'))
    || (report.observation_status === 'UNAVAILABLE'
      && report.items.some(({ status }) => status !== 'INDETERMINATE'))) {
    fail('post-scan observation status contradicts item truth');
  }
  if (committedTransactionIds !== null
      && canonicalJson(report.items.map(({ transaction_id: id }) => id))
        !== canonicalJson(committedTransactionIds)) {
    fail('post-scan items do not match the committed transaction prefix');
  }
  if (plan !== null) {
    const planItems = new Map(plan.items.map((item) => [item.transaction_id, item]));
    for (const item of report.items) {
      const expected = planItems.get(item.transaction_id);
      if (expected === undefined || expected.item_id !== item.item_id
          || expected.entry_path !== item.entry_path) {
        fail('post-scan item does not match its immutable plan item');
      }
    }
  }
  const expectedWarnings = [...POST_SCAN_BASE_WARNINGS];
  if (report.items.some(({ status }) => ['REHYDRATED', 'RESTORE_CONFLICT'].includes(status))) {
    expectedWarnings.push(POST_SCAN_REHYDRATION_WARNING);
  }
  if (!Array.isArray(report.warnings)
      || canonicalJson(report.warnings) !== canonicalJson(expectedWarnings)) {
    fail('post-scan warnings do not match stable safety guidance');
  }
  return report;
}

export function validateApplyReport(report, plan = null) {
  exactKeys(report, APPLY_REPORT_KEYS, [...APPLY_REPORT_KEYS], 'apply report');
  canonicalJson(report);
  if (report.schema_version !== SCHEMAS.applyReport || report.command !== 'apply') {
    fail(`apply report schema mismatch: expected ${SCHEMAS.applyReport}`);
  }
  const committedTransactionIds = validateApplyOutcome(report.apply_outcome);
  if (plan === null) fail('apply report validation requires its immutable plan');
  validatePlan(plan);
  validatePostScanReport(report.post_scan, committedTransactionIds, plan);
  return report;
}

export function buildApplyReport({ applyOutcome, postScan, plan } = {}) {
  return validateApplyReport({
    schema_version: SCHEMAS.applyReport,
    command: 'apply',
    apply_outcome: applyOutcome,
    post_scan: postScan,
  }, plan);
}

export function validatePlan(plan) {
  requireObject(plan, 'plan');
  if (plan.schema_version !== SCHEMAS.plan) {
    fail(`plan schema mismatch: expected ${SCHEMAS.plan}`);
  }
  canonicalJson(plan);
  exactKeys(plan, PLAN_KEYS, PLAN_REQUIRED_KEYS, 'plan');
  if (plan.product_version !== '2.0') fail('plan product_version is unsupported');
  safeNonEmptyString(plan.platform, 'plan.platform', 32);
  if (typeof plan.authorization_id !== 'string' || !/^[0-9a-f]{32}$/u.test(plan.authorization_id)) {
    fail('plan.authorization_id is unsupported');
  }
  safeNonEmptyString(plan.created_at, 'plan.created_at', 64);
  validateSha256(plan.scan_fingerprint, 'scan_fingerprint');
  validateSha256(plan.plan_hash, 'plan_hash');
  if (!Array.isArray(plan.items)) fail('plan.items must be an array');

  const itemIds = new Set();
  const transactionIds = new Set();
  for (let index = 0; index < plan.items.length; index += 1) {
    const item = plan.items[index];
    const path = `plan.items[${index}]`;
    exactKeys(item, ITEM_KEYS, ITEM_REQUIRED_KEYS, path);
    validateSha256(item.item_id, `${path}.item_id`);
    if (itemIds.has(item.item_id)) fail('plan contains a duplicate item_id');
    itemIds.add(item.item_id);
    if (!ACTIONS.includes(item.action)) fail(`${path}.action is unsupported`);
    safeNonEmptyString(item.entry_path, `${path}.entry_path`);
    safeNonEmptyString(item.active_root, `${path}.active_root`);
    if (!['directory', 'symlink', 'broken_symlink'].includes(item.entry_kind)) {
      fail(`${path}.entry_kind is unsupported`);
    }
    validateExecutionIdentity(item.execution_identity, {
      entryPath: item.entry_path,
      activeRoot: item.active_root,
      entryKind: item.entry_kind,
    });
    exactKeys(item.preconditions, PRECONDITION_KEYS, [...PRECONDITION_KEYS], `${path}.preconditions`);
    validateSha256(item.preconditions.review_fingerprint, `${path}.preconditions.review_fingerprint`);
    validateSha256(item.preconditions.candidate_fingerprint, `${path}.preconditions.candidate_fingerprint`);
    validateSha256(item.preconditions.scan_fingerprint, `${path}.preconditions.scan_fingerprint`);
    validateSha256(item.preconditions.execution_identity_hash, `${path}.preconditions.execution_identity_hash`);
    if (item.preconditions.scan_fingerprint !== plan.scan_fingerprint
        || item.preconditions.execution_identity_hash !== item.execution_identity.identity_hash) {
      fail(`${path}.preconditions do not match the plan item`);
    }
    exactKeys(
      item.expected_postconditions,
      POSTCONDITION_KEYS,
      [...POSTCONDITION_KEYS],
      `${path}.expected_postconditions`,
    );
    if (item.expected_postconditions.active_entry_absent !== true
        || item.expected_postconditions.quarantine_entry_present !== true) {
      fail(`${path}.expected_postconditions are unsupported`);
    }
    if (item.risk !== 'reviewed') fail(`${path}.risk is unsupported`);
    validateSha256(item.item_hash, `${path}.item_hash`);
    if (item.item_hash !== computeItemHash(item)) fail(`${path}.item_hash does not match canonical item content`);
    validateSha256(item.transaction_id, `${path}.transaction_id`);
    if (transactionIds.has(item.transaction_id)) fail('plan contains a duplicate transaction_id');
    transactionIds.add(item.transaction_id);
  }

  const expectedPlanHash = computePlanHash(plan);
  if (plan.plan_hash !== expectedPlanHash) fail('plan_hash does not match canonical plan content');
  for (const item of plan.items) {
    const expectedTransactionId = deriveTransactionId(plan.plan_hash, item.item_id);
    if (item.transaction_id !== expectedTransactionId) {
      fail('transaction_id does not match plan_hash and item_id');
    }
  }
  return plan;
}

const BATCH_PLAN_KEYS = new Set([
  'schema_version',
  'batch_id',
  'plan_hash',
  'platform',
  'transaction_map',
]);
const BATCH_MAPPING_KEYS = new Set([
  'item_id',
  'transaction_id',
  'item_hash',
  'execution_identity_hash',
]);
const BATCH_BINDING_KEYS = new Set([
  'schema_version',
  'batch_id',
  'plan_hash',
  ...BATCH_MAPPING_KEYS,
]);
const BATCH_STATE_KEYS = new Set([
  'schema_version',
  'batch_id',
  'plan_hash',
  'sequence',
  'state',
  'items',
]);
const BATCH_STATE_ITEM_KEYS = new Set(['item_id', 'transaction_id', 'status']);
const BATCH_PUBLIC_ITEM_KEYS = new Set([
  'item_id',
  'transaction_id',
  'status',
  'location',
  'transaction_has_mutated',
]);
const BATCH_STATES = new Set([
  'READY',
  'RUNNING',
  'COMMITTED',
  'BLOCKED',
  'PARTIAL',
  'RECOVERY_REQUIRED',
]);
const BATCH_STATE_ITEM_STATUSES = new Set([
  'NOT_STARTED',
  'COMMITTED',
  'DRIFTED',
  'BLOCKED',
  'RECOVERY_REQUIRED',
]);
const BATCH_SUMMARY_ITEM_STATUSES = new Set([
  'NOT_STARTED',
  'APPLY_PENDING',
  'APPLY_FINALIZE_PENDING',
  'COMMITTED',
  'RESTORE_PENDING',
  'RESTORE_FINALIZE_PENDING',
  'RESTORED',
  'REHYDRATED',
  'RESTORE_CONFLICT',
  'DRIFTED',
  'BLOCKED',
  'RECOVERY_REQUIRED',
]);
const BATCH_SUMMARY_OVERALL_STATUSES = new Set([
  'READY',
  'RUNNING',
  'COMMITTED',
  'PARTIAL',
  'BLOCKED',
  'RECOVERY_REQUIRED',
  'RESTORE_PENDING',
  'PARTIALLY_RESTORED',
  'RESTORED',
  'REHYDRATED',
  'RESTORE_CONFLICT',
]);
const BATCH_LOCATIONS = new Set([
  'original',
  'original_drift',
  'quarantine',
  'rehydrated',
  'unknown',
]);
const BATCH_RESULT_KEYS = new Set([
  'schema_version',
  'command',
  'status',
  'overall_status',
  'batch_id',
  'plan_hash',
  'items',
  'mutation_occurred',
  'mutation_outcome',
  'transaction_has_mutated',
  'committed_transaction_ids',
  'undo_commands',
]);
const BATCH_SUMMARY_KEYS = new Set([
  'schema_version',
  'batch_id',
  'plan_hash',
  'overall_status',
  'items',
]);
const BATCH_ERROR_KEYS = new Set([
  ...BATCH_RESULT_KEYS,
  'error_code',
  'failure_scope',
  'failure_item_id',
  'failure_item_index',
]);
const TRANSACTION_BATCH_STATUS_KEYS = new Set([
  ...TRANSACTION_RESULT_KEYS,
  'batch_id',
  'batch_summary',
]);
const TRANSACTION_BATCH_STATUS_REQUIRED_KEYS = [
  ...TRANSACTION_RESULT_REQUIRED_KEYS,
  'batch_id',
  'batch_summary',
];
const BATCH_RESULT_STATUS_PAIRS = new Set([
  'committed\u0000committed',
  'already_committed\u0000committed',
  'blocked\u0000blocked',
  'blocked\u0000drifted',
  'recovery_required\u0000PARTIAL',
  'recovery_required\u0000RECOVERY_REQUIRED',
]);
const BATCH_ERROR_POLICIES = new Map([
  [BATCH_ERROR_CODES.preflightDrift, {
    scope: 'item', itemStatus: 'DRIFTED',
    pairs: new Set(['blocked\u0000drifted', 'recovery_required\u0000PARTIAL']),
    enforceStopFirst: true,
  }],
  [BATCH_ERROR_CODES.itemBlocked, {
    scope: 'item', itemStatus: 'BLOCKED', pairs: new Set(['blocked\u0000blocked']),
    enforceStopFirst: true,
  }],
  [BATCH_ERROR_CODES.itemRecoveryRequired, {
    scope: 'item', itemStatus: 'RECOVERY_REQUIRED',
    pairs: new Set(['recovery_required\u0000PARTIAL', 'recovery_required\u0000RECOVERY_REQUIRED']),
    enforceStopFirst: true,
  }],
  [BATCH_ERROR_CODES.itemOutcomeAmbiguous, {
    scope: 'item', itemStatus: 'RECOVERY_REQUIRED',
    pairs: new Set(['recovery_required\u0000PARTIAL', 'recovery_required\u0000RECOVERY_REQUIRED']),
    requiresUnknownOutcome: true,
    failedItemMustHaveHistory: true,
    enforceStopFirst: true,
  }],
  [BATCH_ERROR_CODES.batchLockUnavailable, {
    scope: 'batch', pairs: new Set(['blocked\u0000blocked']),
  }],
  [BATCH_ERROR_CODES.batchStateProjectionFailed, {
    scope: 'batch', pairs: new Set(['recovery_required\u0000RECOVERY_REQUIRED']),
    allowsKnownItemTruth: true,
  }],
  [BATCH_ERROR_CODES.batchRecoveryRequired, {
    scope: 'batch', pairs: new Set(['recovery_required\u0000RECOVERY_REQUIRED']),
  }],
  [BATCH_ERROR_CODES.batchRecordsInvalid, {
    scope: 'batch', pairs: new Set(['recovery_required\u0000RECOVERY_REQUIRED']),
    allowsKnownItemTruth: true,
  }],
  [BATCH_ERROR_CODES.batchMutationOutcomeUnknown, {
    scope: 'batch', pairs: new Set(['recovery_required\u0000RECOVERY_REQUIRED']),
    unknownWithoutItemHistory: true,
    allowsKnownItemTruth: true,
  }],
  [BATCH_ERROR_CODES.batchLockReleaseFailed, {
    scope: 'batch', pairs: new Set(['recovery_required\u0000RECOVERY_REQUIRED']),
    allowsKnownItemTruth: true,
  }],
  [BATCH_ERROR_CODES.batchLockAcquireFailed, {
    scope: 'batch', pairs: new Set(['recovery_required\u0000RECOVERY_REQUIRED']),
    allowsKnownItemTruth: true,
  }],
]);

export function deriveBatchId(planHash) {
  validateSha256(planHash, 'plan_hash');
  return sha256Json({ kind: 'cleanup_batch', plan_hash: planHash });
}

function mappingForItem(item) {
  return {
    item_id: item.item_id,
    transaction_id: item.transaction_id,
    item_hash: item.item_hash,
    execution_identity_hash: item.execution_identity.identity_hash,
  };
}

function validateBatchMapping(mapping, path) {
  exactKeys(mapping, BATCH_MAPPING_KEYS, [...BATCH_MAPPING_KEYS], path);
  validateSha256(mapping.item_id, `${path}.item_id`);
  validateSha256(mapping.transaction_id, `${path}.transaction_id`);
  validateSha256(mapping.item_hash, `${path}.item_hash`);
  validateSha256(mapping.execution_identity_hash, `${path}.execution_identity_hash`);
  return mapping;
}

export function buildBatchPlan(plan) {
  validatePlan(plan);
  const batchPlan = {
    schema_version: SCHEMAS.batchPlan,
    batch_id: deriveBatchId(plan.plan_hash),
    plan_hash: plan.plan_hash,
    platform: plan.platform,
    transaction_map: plan.items.map(mappingForItem),
  };
  return validateBatchPlan(batchPlan, plan);
}

export function validateBatchPlan(batchPlan, plan = null) {
  exactKeys(batchPlan, BATCH_PLAN_KEYS, [...BATCH_PLAN_KEYS], 'batch plan');
  canonicalJson(batchPlan);
  if (batchPlan.schema_version !== SCHEMAS.batchPlan) {
    fail(`batch plan schema mismatch: expected ${SCHEMAS.batchPlan}`);
  }
  validateSha256(batchPlan.batch_id, 'batch plan.batch_id');
  validateSha256(batchPlan.plan_hash, 'batch plan.plan_hash');
  if (batchPlan.batch_id !== deriveBatchId(batchPlan.plan_hash)) {
    fail('batch plan batch_id does not match plan_hash');
  }
  safeNonEmptyString(batchPlan.platform, 'batch plan.platform', 32);
  if (!Array.isArray(batchPlan.transaction_map) || batchPlan.transaction_map.length === 0) {
    fail('batch plan transaction_map must be a non-empty array');
  }

  const itemIds = new Set();
  const transactionIds = new Set();
  for (let index = 0; index < batchPlan.transaction_map.length; index += 1) {
    const mapping = validateBatchMapping(
      batchPlan.transaction_map[index],
      `batch plan.transaction_map[${index}]`,
    );
    if (itemIds.has(mapping.item_id)) fail('batch plan contains a duplicate item_id');
    if (transactionIds.has(mapping.transaction_id)) {
      fail('batch plan contains a duplicate transaction_id');
    }
    itemIds.add(mapping.item_id);
    transactionIds.add(mapping.transaction_id);
    if (mapping.transaction_id !== deriveTransactionId(batchPlan.plan_hash, mapping.item_id)) {
      fail('batch plan transaction_id does not match plan_hash and item_id');
    }
  }

  if (plan !== null) {
    validatePlan(plan);
    if (plan.plan_hash !== batchPlan.plan_hash
        || plan.platform !== batchPlan.platform
        || plan.items.length !== batchPlan.transaction_map.length) {
      fail('batch plan does not match the cleanup plan');
    }
    for (let index = 0; index < plan.items.length; index += 1) {
      if (canonicalJson(batchPlan.transaction_map[index])
          !== canonicalJson(mappingForItem(plan.items[index]))) {
        fail('batch plan mapping does not match the cleanup plan');
      }
    }
  }
  return batchPlan;
}

export function buildBatchBinding(batchPlan, itemId) {
  validateBatchPlan(batchPlan);
  validateSha256(itemId, 'batch binding.item_id');
  const matches = batchPlan.transaction_map.filter((mapping) => mapping.item_id === itemId);
  if (matches.length !== 1) fail('batch binding item is absent from the batch plan');
  return validateBatchBinding({
    schema_version: SCHEMAS.batchBinding,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    ...matches[0],
  }, batchPlan);
}

export function validateBatchBinding(binding, batchPlan = null) {
  exactKeys(binding, BATCH_BINDING_KEYS, [...BATCH_BINDING_KEYS], 'batch binding');
  canonicalJson(binding);
  if (binding.schema_version !== SCHEMAS.batchBinding) {
    fail(`batch binding schema mismatch: expected ${SCHEMAS.batchBinding}`);
  }
  validateSha256(binding.batch_id, 'batch binding.batch_id');
  validateSha256(binding.plan_hash, 'batch binding.plan_hash');
  validateBatchMapping({
    item_id: binding.item_id,
    transaction_id: binding.transaction_id,
    item_hash: binding.item_hash,
    execution_identity_hash: binding.execution_identity_hash,
  }, 'batch binding.mapping');
  if (binding.batch_id !== deriveBatchId(binding.plan_hash)
      || binding.transaction_id !== deriveTransactionId(binding.plan_hash, binding.item_id)) {
    fail('batch binding identity is invalid');
  }
  if (batchPlan !== null) {
    validateBatchPlan(batchPlan);
    const matches = batchPlan.transaction_map.filter((mapping) => (
      mapping.item_id === binding.item_id
      && canonicalJson(mapping) === canonicalJson({
        item_id: binding.item_id,
        transaction_id: binding.transaction_id,
        item_hash: binding.item_hash,
        execution_identity_hash: binding.execution_identity_hash,
      })
    ));
    if (binding.batch_id !== batchPlan.batch_id
        || binding.plan_hash !== batchPlan.plan_hash
        || matches.length !== 1) {
      fail('batch binding does not match the batch plan');
    }
  }
  return binding;
}

function batchItemProjection(batchPlan, status = 'NOT_STARTED') {
  return batchPlan.transaction_map.map(({ item_id, transaction_id }) => ({
    item_id,
    transaction_id,
    status,
  }));
}

export function buildInitialBatchState(batchPlan) {
  validateBatchPlan(batchPlan);
  return validateBatchState({
    schema_version: SCHEMAS.batchState,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    sequence: 0,
    state: 'READY',
    items: batchItemProjection(batchPlan),
  }, batchPlan);
}

function validateMappedItemIdentity(item, keys, batchPlan, path, planHash) {
  exactKeys(item, keys, [...keys], path);
  validateSha256(item.item_id, `${path}.item_id`);
  validateSha256(item.transaction_id, `${path}.transaction_id`);
  if (planHash !== undefined
      && item.transaction_id !== deriveTransactionId(planHash, item.item_id)) {
    fail(`${path} transaction_id is invalid`);
  }
  return item;
}

function validateMappedItems(items, batchPlan, path, planHash, validateItem) {
  if (!Array.isArray(items) || items.length === 0
      || (batchPlan !== null && items.length !== batchPlan.transaction_map.length)) {
    fail(`${path} items do not match the batch mapping`);
  }
  const itemIds = new Set();
  const transactionIds = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = validateItem(items[index], `${path}.items[${index}]`);
    if (itemIds.has(item.item_id) || transactionIds.has(item.transaction_id)) {
      fail(`${path} item mapping contains duplicate identities`);
    }
    itemIds.add(item.item_id);
    transactionIds.add(item.transaction_id);
    const mapping = batchPlan?.transaction_map[index];
    if (mapping !== undefined
        && (item.item_id !== mapping.item_id || item.transaction_id !== mapping.transaction_id)) {
      fail(`${path} item mapping is invalid`);
    }
  }
  return items;
}

function validateStopFirst(items, path, failureStatuses) {
  const failureIndexes = items
    .map((item, index) => (failureStatuses.has(item.status) ? index : -1))
    .filter((index) => index >= 0);
  if (failureIndexes.length > 1) fail(`${path} contains more than one failure`);
  if (failureIndexes.length === 1) {
    const failureIndex = failureIndexes[0];
    const before = items.slice(0, failureIndex);
    const beforeAllCommitted = before.every(({ status }) => status === 'COMMITTED');
    const beforeAllUnstarted = before.every(({ status }) => status === 'NOT_STARTED');
    if ((!beforeAllCommitted && !beforeAllUnstarted)
        || items.slice(failureIndex + 1).some(({ status }) => status !== 'NOT_STARTED')) {
      fail(`${path} must stop after the first failure`);
    }
    return;
  }
  let unstartedSeen = false;
  for (const item of items) {
    if (item.status === 'NOT_STARTED') unstartedSeen = true;
    else if (item.status !== 'COMMITTED' || unstartedSeen) {
      fail(`${path} committed items must be a prefix before unstarted items`);
    }
  }
}

function validateBatchStateItems(items, batchPlan, path) {
  validateMappedItems(items, batchPlan, path, batchPlan.plan_hash, (item, itemPath) => {
    validateMappedItemIdentity(item, BATCH_STATE_ITEM_KEYS, batchPlan, itemPath, batchPlan.plan_hash);
    if (!BATCH_STATE_ITEM_STATUSES.has(item.status)) fail(`${path} item status is unsupported`);
    return item;
  });
  validateStopFirst(items, path, new Set(['DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED']));
  return items;
}

const BATCH_STATE_TRANSITIONS = Object.freeze({
  READY: new Set(['RUNNING', 'BLOCKED', 'RECOVERY_REQUIRED']),
  RUNNING: new Set(['RUNNING', 'COMMITTED', 'BLOCKED', 'PARTIAL', 'RECOVERY_REQUIRED']),
  COMMITTED: new Set(['COMMITTED']),
  BLOCKED: new Set(['BLOCKED']),
  PARTIAL: new Set(['PARTIAL', 'RUNNING', 'COMMITTED', 'RECOVERY_REQUIRED']),
  RECOVERY_REQUIRED: new Set(['RECOVERY_REQUIRED', 'RUNNING', 'COMMITTED', 'PARTIAL']),
});

function validateConvergence(convergence, batchPlan, previousState, state) {
  if (!(Array.isArray(convergence) || convergence instanceof Set)) {
    fail('batch state authoritative convergence must be an array or Set');
  }
  const supplied = [...convergence];
  const unique = new Set(supplied);
  if (unique.size !== supplied.length) fail('batch state authoritative convergence is duplicated');
  const mapped = new Set(batchPlan.transaction_map.map(({ transaction_id: id }) => id));
  for (const transactionId of supplied) {
    validateSha256(transactionId, 'batch state authoritative convergence transaction_id');
    if (!mapped.has(transactionId)) fail('batch state authoritative convergence is not mapped');
  }
  const required = new Set();
  if (previousState !== null) {
    for (let index = 0; index < state.items.length; index += 1) {
      if (previousState.items[index].status === 'RECOVERY_REQUIRED'
          && state.items[index].status === 'COMMITTED') {
        required.add(state.items[index].transaction_id);
      }
    }
  }
  if (required.size !== unique.size || [...required].some((id) => !unique.has(id))) {
    fail('batch state authoritative convergence does not exactly match reconciled transitions');
  }
  return unique;
}

// Only a caller that has reconciled the durable item transaction may populate
// authoritativeConvergence. Stored/public validation must leave it empty.
export function validateBatchState(state, batchPlan, {
  previousState = null,
  authoritativeConvergence = [],
} = {}) {
  validateBatchPlan(batchPlan);
  exactKeys(state, BATCH_STATE_KEYS, [...BATCH_STATE_KEYS], 'batch state');
  canonicalJson(state);
  if (state.schema_version !== SCHEMAS.batchState) {
    fail(`batch state schema mismatch: expected ${SCHEMAS.batchState}`);
  }
  if (state.batch_id !== batchPlan.batch_id || state.plan_hash !== batchPlan.plan_hash) {
    fail('batch state identity does not match the batch plan');
  }
  if (!Number.isSafeInteger(state.sequence) || state.sequence < 0) {
    fail('batch state sequence is invalid');
  }
  if (!BATCH_STATES.has(state.state)) fail('batch state is unsupported');
  validateBatchStateItems(state.items, batchPlan, 'batch state');
  const committedCount = state.items.filter(({ status }) => status === 'COMMITTED').length;
  const failureStatuses = state.items.filter(({ status }) => (
    ['DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(status)
  ));
  if ((state.state === 'READY'
      && (state.sequence !== 0 || state.items.some(({ status }) => status !== 'NOT_STARTED')))
      || (state.state === 'RUNNING' && failureStatuses.length > 0)
      || (state.state === 'COMMITTED' && committedCount !== state.items.length)
      || (state.state === 'PARTIAL'
        && (committedCount === 0 || !failureStatuses.some(({ status }) => (
          ['DRIFTED', 'BLOCKED'].includes(status)
        ))))
      || (state.state === 'BLOCKED'
        && (committedCount !== 0 || !failureStatuses.some(({ status }) => (
          ['DRIFTED', 'BLOCKED'].includes(status)
        ))))
      || (state.state === 'RECOVERY_REQUIRED'
        && committedCount !== state.items.length && failureStatuses.length === 0)) {
    fail('batch state does not match its item projection');
  }

  if (previousState === null) {
    validateConvergence(authoritativeConvergence, batchPlan, null, state);
    return state;
  }
  validateBatchState(previousState, batchPlan);
  const convergence = validateConvergence(
    authoritativeConvergence,
    batchPlan,
    previousState,
    state,
  );
  if (state.sequence !== previousState.sequence + 1
      || !BATCH_STATE_TRANSITIONS[previousState.state].has(state.state)) {
    fail('batch state transition or sequence is invalid');
  }
  for (let index = 0; index < state.items.length; index += 1) {
    const before = previousState.items[index].status;
    const after = state.items[index].status;
    if (before === 'NOT_STARTED') continue;
    if (before === 'RECOVERY_REQUIRED' && after === 'COMMITTED'
        && convergence.has(state.items[index].transaction_id)) continue;
    if (before !== after) fail(`batch state cannot erase ${before} failure truth`);
  }
  return state;
}

function validatePublicItemTruth(item, path, statuses) {
  validateMappedItemIdentity(item, BATCH_PUBLIC_ITEM_KEYS, null, path);
  if (!statuses.has(item.status)) fail(`${path} status is unsupported`);
  if (!BATCH_LOCATIONS.has(item.location) || typeof item.transaction_has_mutated !== 'boolean') {
    fail(`${path} location or history is unsupported`);
  }
  if (['quarantine', 'rehydrated'].includes(item.location)
      && item.transaction_has_mutated !== true) {
    fail(`${path} location requires historical mutation truth`);
  }
  const summaryTruth = statuses === BATCH_SUMMARY_ITEM_STATUSES;
  const exactTruth = {
    NOT_STARTED: item.location === 'original' && item.transaction_has_mutated === false,
    APPLY_PENDING: item.location === 'original' && item.transaction_has_mutated === false,
    APPLY_FINALIZE_PENDING: item.location === 'quarantine'
      && item.transaction_has_mutated === true,
    COMMITTED: (summaryTruth ? item.location === 'quarantine'
      : ['quarantine', 'rehydrated'].includes(item.location))
      && item.transaction_has_mutated === true,
    RESTORE_PENDING: item.location === 'quarantine'
      && item.transaction_has_mutated === true,
    RESTORE_FINALIZE_PENDING: ['original', 'original_drift'].includes(item.location)
      && item.transaction_has_mutated === true,
    RESTORED: ['original', 'original_drift'].includes(item.location)
      && item.transaction_has_mutated === true,
    REHYDRATED: item.location === 'rehydrated' && item.transaction_has_mutated === true,
    RESTORE_CONFLICT: item.location === 'rehydrated' && item.transaction_has_mutated === true,
    DRIFTED: item.location === 'original_drift',
    BLOCKED: ['original', 'original_drift'].includes(item.location)
      && item.transaction_has_mutated === false,
    RECOVERY_REQUIRED: true,
  }[item.status];
  if (!exactTruth) fail(`${path} status, location, and history are contradictory`);
  return item;
}

function validatePublicItems(items, batchPlan, path, planHash, statuses, stopFirst = false) {
  validateMappedItems(items, batchPlan, path, planHash, (item, itemPath) => (
    validatePublicItemTruth(item, itemPath, statuses)
  ));
  if (stopFirst) validateStopFirst(items, path, new Set(['DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED']));
  return items;
}

function committedIdsFor(items) {
  return items.filter(({ status }) => status === 'COMMITTED')
    .map(({ transaction_id: transactionId }) => transactionId);
}

export function undoCommandArguments(transactionId) {
  validateSha256(transactionId, 'transaction_id');
  return ['skills-refiner', 'cleanup', 'undo', transactionId, '--confirm', transactionId, '--json'];
}

function undoCommandsFor(transactionIds) {
  return transactionIds.toReversed().map((transactionId) => (
    undoCommandArguments(transactionId).join(' ')
  ));
}

function validateBatchEnvelopeIdentity(value, batchPlan, path) {
  validateSha256(value.batch_id, `${path}.batch_id`);
  validateSha256(value.plan_hash, `${path}.plan_hash`);
  if (value.batch_id !== deriveBatchId(value.plan_hash)) fail(`${path} identity is invalid`);
  if (batchPlan !== null) {
    validateBatchPlan(batchPlan);
    if (value.batch_id !== batchPlan.batch_id || value.plan_hash !== batchPlan.plan_hash) {
      fail(`${path} does not match the batch plan`);
    }
  }
}

function validateBatchDurableTruth(value, path) {
  const committedTransactionIds = committedIdsFor(value.items);
  const expectedUndoCommands = undoCommandsFor(committedTransactionIds);
  const historical = value.items.some(({ transaction_has_mutated: mutated }) => mutated);
  if (value.transaction_has_mutated !== historical
      || canonicalJson(value.committed_transaction_ids) !== canonicalJson(committedTransactionIds)
      || canonicalJson(value.undo_commands) !== canonicalJson(expectedUndoCommands)) {
    fail(`${path} durable mutation truth is invalid`);
  }
  return committedTransactionIds;
}

export function buildBatchResult({
  batchPlan, status, overallStatus, items, mutationOccurred,
} = {}) {
  validateBatchPlan(batchPlan);
  validatePublicItems(
    items, batchPlan, 'batch result', batchPlan.plan_hash, BATCH_STATE_ITEM_STATUSES, true,
  );
  const committedTransactionIds = committedIdsFor(items);
  return validateBatchResult({
    schema_version: SCHEMAS.batch,
    command: 'apply',
    status,
    overall_status: overallStatus,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    items: items.map((item) => ({ ...item })),
    mutation_occurred: mutationOccurred,
    mutation_outcome: mutationOccurred === true ? 'moved' : 'unchanged',
    transaction_has_mutated: items.some(({ transaction_has_mutated: mutated }) => mutated),
    committed_transaction_ids: committedTransactionIds,
    undo_commands: undoCommandsFor(committedTransactionIds),
  }, batchPlan);
}

export function validateBatchResult(result, batchPlan = null) {
  exactKeys(result, BATCH_RESULT_KEYS, [...BATCH_RESULT_KEYS], 'batch result');
  canonicalJson(result);
  if (result.schema_version !== SCHEMAS.batch || result.command !== 'apply'
      || !BATCH_RESULT_STATUS_PAIRS.has(`${result.status}\u0000${result.overall_status}`)) {
    fail('batch result schema, command, or status is unsupported');
  }
  validateBatchEnvelopeIdentity(result, batchPlan, 'batch result');
  validatePublicItems(
    result.items, batchPlan, 'batch result', result.plan_hash, BATCH_STATE_ITEM_STATUSES, true,
  );
  if (typeof result.mutation_occurred !== 'boolean'
      || !['unchanged', 'moved'].includes(result.mutation_outcome)
      || result.mutation_outcome !== (result.mutation_occurred ? 'moved' : 'unchanged')) {
    fail('batch result current-command mutation truth is invalid');
  }
  const committedTransactionIds = validateBatchDurableTruth(result, 'batch result');
  const allCommitted = committedTransactionIds.length === result.items.length;
  const noCommitted = committedTransactionIds.length === 0;
  if ((result.status === 'committed' && (!allCommitted || !result.mutation_occurred))
      || (result.status === 'already_committed' && (!allCommitted || result.mutation_occurred))
      || (result.status === 'blocked'
        && (!noCommitted || result.mutation_occurred || result.transaction_has_mutated
          || !result.items.some(({ status }) => ['DRIFTED', 'BLOCKED'].includes(status))))
      || (result.overall_status === 'PARTIAL' && (noCommitted || allCommitted))
      || (result.overall_status === 'RECOVERY_REQUIRED'
        && !allCommitted
        && !result.items.some(({ status }) => status === 'RECOVERY_REQUIRED'))) {
    fail('batch result status does not match its item or mutation truth');
  }
  return result;
}

export function deriveBatchSummaryOverallStatus(items) {
  validatePublicItems(items, null, 'batch summary', undefined, BATCH_SUMMARY_ITEM_STATUSES);
  const statuses = new Set(items.map(({ status }) => status));
  if (statuses.has('RECOVERY_REQUIRED')) return 'RECOVERY_REQUIRED';
  if (statuses.has('RESTORE_CONFLICT')) return 'RESTORE_CONFLICT';
  if (statuses.has('REHYDRATED')) return 'REHYDRATED';
  if (statuses.has('RESTORE_PENDING') || statuses.has('RESTORE_FINALIZE_PENDING')) {
    return 'RESTORE_PENDING';
  }
  if (statuses.has('RESTORED')) {
    return items.every(({ status }) => ['RESTORED', 'NOT_STARTED'].includes(status))
      ? 'RESTORED'
      : 'PARTIALLY_RESTORED';
  }
  if (statuses.has('DRIFTED') || statuses.has('BLOCKED')) {
    return items.some(({ transaction_has_mutated: mutated }) => mutated) ? 'PARTIAL' : 'BLOCKED';
  }
  if (items.every(({ status }) => status === 'COMMITTED')) return 'COMMITTED';
  if (statuses.has('COMMITTED') || statuses.has('APPLY_PENDING')
      || statuses.has('APPLY_FINALIZE_PENDING')) return 'RUNNING';
  return 'READY';
}

export function validateBatchSummary(summary, batchPlan = null) {
  exactKeys(summary, BATCH_SUMMARY_KEYS, [...BATCH_SUMMARY_KEYS], 'batch summary');
  canonicalJson(summary);
  if (summary.schema_version !== SCHEMAS.batchSummary
      || !BATCH_SUMMARY_OVERALL_STATUSES.has(summary.overall_status)) {
    fail(`batch summary schema mismatch: expected ${SCHEMAS.batchSummary}`);
  }
  validateBatchEnvelopeIdentity(summary, batchPlan, 'batch summary');
  validatePublicItems(
    summary.items, batchPlan, 'batch summary', summary.plan_hash, BATCH_SUMMARY_ITEM_STATUSES,
  );
  if (summary.overall_status !== deriveBatchSummaryOverallStatus(summary.items)) {
    fail('batch summary overall_status does not match precedence-derived item truth');
  }
  return summary;
}

function expectedBatchStatusForTransaction(result) {
  const location = result.location;
  const mutated = result.transaction_has_mutated;
  if (result.state === 'PLANNED') {
    if (location === 'original' && !mutated) {
      return { publicStatus: 'ready_to_resume_apply', summaryStatus: 'NOT_STARTED' };
    }
    if (location === 'original_drift' && !mutated) {
      return { publicStatus: 'drifted', summaryStatus: 'DRIFTED' };
    }
    return null;
  }
  if (['CONFIRMED', 'PREPARED'].includes(result.state)) {
    if (location === 'original' && !mutated) {
      return { publicStatus: 'ready_to_resume_apply', summaryStatus: 'APPLY_PENDING' };
    }
    if (location === 'original_drift' && !mutated) {
      return { publicStatus: 'drifted', summaryStatus: 'DRIFTED' };
    }
    return null;
  }
  if (result.state === 'APPLYING') {
    if (location === 'original' && !mutated) {
      return { publicStatus: 'ready_to_resume_apply', summaryStatus: 'APPLY_PENDING' };
    }
    if (location === 'quarantine' && mutated) {
      return { publicStatus: 'ready_to_finalize_commit', summaryStatus: 'APPLY_FINALIZE_PENDING' };
    }
    if (location === 'rehydrated' && mutated) {
      return { publicStatus: 'ready_to_finalize_commit', summaryStatus: 'REHYDRATED' };
    }
    return null;
  }
  if (result.state === 'COMMITTED') {
    if (location === 'quarantine' && mutated) {
      return { publicStatus: 'committed', summaryStatus: 'COMMITTED' };
    }
    if (location === 'rehydrated' && mutated) {
      return { publicStatus: 'rehydrated', summaryStatus: 'REHYDRATED' };
    }
    return null;
  }
  if (result.state === 'RESTORE_PREPARED') {
    if (location === 'quarantine' && mutated) {
      return { publicStatus: 'ready_to_resume_undo', summaryStatus: 'RESTORE_PENDING' };
    }
    if (location === 'rehydrated' && mutated) {
      return { publicStatus: 'restore_conflict', summaryStatus: 'RESTORE_CONFLICT' };
    }
    return null;
  }
  if (result.state === 'RESTORING') {
    if (location === 'quarantine' && mutated) {
      return { publicStatus: 'ready_to_resume_undo', summaryStatus: 'RESTORE_PENDING' };
    }
    if (location === 'original' && mutated) {
      return { publicStatus: 'ready_to_finalize_restore', summaryStatus: 'RESTORE_FINALIZE_PENDING' };
    }
    if (location === 'rehydrated' && mutated) {
      return { publicStatus: 'restore_conflict', summaryStatus: 'RESTORE_CONFLICT' };
    }
    return null;
  }
  if (result.state === 'RESTORED' && location === 'original' && mutated) {
    return { publicStatus: 'restored', summaryStatus: 'RESTORED' };
  }
  return null;
}

export function validateTransactionBatchStatus(result, batchPlan = null) {
  exactKeys(
    result, TRANSACTION_BATCH_STATUS_KEYS, TRANSACTION_BATCH_STATUS_REQUIRED_KEYS,
    'transaction batch status',
  );
  canonicalJson(result);
  if (result.schema_version !== SCHEMAS.transactionBatchStatus || result.command !== 'status') {
    fail(`transaction batch status schema mismatch: expected ${SCHEMAS.transactionBatchStatus}`);
  }
  const { batch_id: batchId, batch_summary: batchSummary, ...transactionFields } = result;
  try {
    validateTransactionResult({ ...transactionFields, schema_version: SCHEMAS.transaction });
    validateBatchSummary(batchSummary, batchPlan);
  } catch {
    fail('transaction batch status contains invalid transaction or batch truth');
  }
  const matches = batchSummary.items.filter((item) => item.transaction_id === result.transaction_id);
  const expected = expectedBatchStatusForTransaction(result);
  if (batchId !== batchSummary.batch_id || matches.length !== 1 || expected === null
      || result.status !== expected.publicStatus || result.overall_status !== expected.publicStatus
      || matches[0].status !== expected.summaryStatus || matches[0].location !== result.location
      || matches[0].transaction_has_mutated !== result.transaction_has_mutated) {
    fail('transaction batch status is contradictory with its reconciled batch item');
  }
  return result;
}

export function buildBatchError({
  batchPlan,
  status,
  overallStatus,
  items,
  mutationOccurred,
  mutationOutcome,
  errorCode,
  failureScope,
  failureItemIndex = null,
} = {}) {
  validateBatchPlan(batchPlan);
  const committedTransactionIds = committedIdsFor(items);
  const itemId = failureScope === 'item' && Number.isSafeInteger(failureItemIndex)
    ? items[failureItemIndex]?.item_id ?? null
    : null;
  return validateBatchError({
    schema_version: SCHEMAS.batchError,
    command: 'apply',
    status,
    overall_status: overallStatus,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    items: items.map((item) => ({ ...item })),
    mutation_occurred: mutationOccurred,
    mutation_outcome: mutationOutcome,
    transaction_has_mutated: items.some(({ transaction_has_mutated: mutated }) => mutated),
    committed_transaction_ids: committedTransactionIds,
    undo_commands: undoCommandsFor(committedTransactionIds),
    error_code: errorCode,
    failure_scope: failureScope,
    failure_item_id: itemId,
    failure_item_index: failureScope === 'item' ? failureItemIndex : null,
  }, batchPlan);
}

export function validateBatchError(error, batchPlan = null) {
  exactKeys(error, BATCH_ERROR_KEYS, [...BATCH_ERROR_KEYS], 'batch error');
  canonicalJson(error);
  const policy = BATCH_ERROR_POLICIES.get(error.error_code);
  const statusPair = `${error.status}\u0000${error.overall_status}`;
  if (error.schema_version !== SCHEMAS.batchError || error.command !== 'apply'
      || policy === undefined || !policy.pairs.has(statusPair)
      || error.failure_scope !== policy.scope) {
    fail('batch error schema, command, or status is unsupported');
  }
  validateBatchEnvelopeIdentity(error, batchPlan, 'batch error');
  validatePublicItems(
    error.items, batchPlan, 'batch error', error.plan_hash, BATCH_STATE_ITEM_STATUSES, false,
  );
  if (typeof error.mutation_occurred !== 'boolean'
      || !['unchanged', 'moved', 'unknown'].includes(error.mutation_outcome)
      || (!error.mutation_occurred && error.mutation_outcome !== 'unchanged')
      || (error.mutation_occurred && error.mutation_outcome === 'unchanged')) {
    fail('batch error current-command mutation truth is invalid');
  }
  if (policy.requiresUnknownOutcome === true
      && (!error.mutation_occurred || error.mutation_outcome !== 'unknown')) {
    fail('batch error code requires an unknown current-command mutation outcome');
  }
  const committed = validateBatchDurableTruth(error, 'batch error');
  const failures = error.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => ['DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED'].includes(item.status));
  if (policy.enforceStopFirst === true) {
    validateStopFirst(
      error.items,
      'batch error',
      new Set(['DRIFTED', 'BLOCKED', 'RECOVERY_REQUIRED']),
    );
  }
  if (policy.scope === 'batch') {
    const knownItemTruth = error.items.some(({ status: itemStatus }) => itemStatus !== 'NOT_STARTED');
    if (error.failure_item_id !== null || error.failure_item_index !== null
        || (knownItemTruth && policy.allowsKnownItemTruth !== true)) {
      fail('batch error batch-scoped failure must not masquerade a known item failure');
    }
  } else {
    if (failures.length !== 1 || error.failure_item_index !== failures[0].index
        || error.failure_item_id !== failures[0].item.item_id
        || failures[0].item.status !== policy.itemStatus) {
      fail('batch error item-scoped failure does not match the first failure');
    }
  }
  if (policy.failedItemMustHaveHistory === true
      && failures[0]?.item.transaction_has_mutated !== true) {
    fail('batch error ambiguous item outcome lacks that item historical mutation truth');
  }
  const explicitBatchUnknown = policy.unknownWithoutItemHistory === true
    && error.failure_scope === 'batch'
    && error.mutation_occurred === true
    && error.mutation_outcome === 'unknown';
  if (error.mutation_occurred && !error.transaction_has_mutated && !explicitBatchUnknown) {
    fail('batch error current mutation lacks item history or explicit batch-level unknown truth');
  }
  if (policy.unknownWithoutItemHistory === true && !explicitBatchUnknown) {
    fail('batch error explicit batch-level unknown contract is incomplete');
  }
  if ((error.status === 'blocked'
      && (error.mutation_occurred || error.transaction_has_mutated || committed.length > 0))
      || (error.overall_status === 'PARTIAL'
        && (committed.length === 0 || committed.length === error.items.length))
      || (error.overall_status === 'RECOVERY_REQUIRED'
        && error.failure_scope !== 'batch'
        && !failures.some(({ item }) => item.status === 'RECOVERY_REQUIRED'))) {
    fail('batch error status contradicts current or historical mutation truth');
  }
  return error;
}
