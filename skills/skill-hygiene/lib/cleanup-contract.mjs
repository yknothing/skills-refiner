import { createHash } from 'node:crypto';

export const SCHEMAS = Object.freeze({
  error: 'skills-refiner.cleanup.error.v1',
  review: 'skills-refiner.cleanup.review.v1',
  decisions: 'skills-refiner.cleanup.decisions.v1',
  plan: 'skills-refiner.cleanup.plan.v1',
  transaction: 'skills-refiner.cleanup.transaction.v1',
  identity: 'skills-refiner.cleanup.identity.v1',
});

export const ACTIONS = Object.freeze(['quarantine']);

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

export function computeIdentityHash(identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    fail('identity must be JSON-compatible');
  }
  canonicalJson(identity);
  const { identity_hash: _identityHash, ...hashInput } = identity;
  return sha256Json(hashInput);
}

export function deriveTransactionId(planHash, itemId) {
  validateSha256(planHash, 'plan_hash');
  if (typeof itemId !== 'string' || itemId.length === 0 || CONTROL_CHARACTERS.test(itemId)) {
    fail('item_id must be a safe non-empty string');
  }
  return sha256Json({ plan_hash: planHash, item_id: itemId });
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

export function validatePlan(plan) {
  requireObject(plan, 'plan');
  if (plan.schema_version !== SCHEMAS.plan) {
    fail(`plan schema mismatch: expected ${SCHEMAS.plan}`);
  }
  canonicalJson(plan);
  exactKeys(plan, PLAN_KEYS, PLAN_REQUIRED_KEYS, 'plan');
  if (plan.product_version !== '2.0') fail('plan product_version is unsupported');
  safeNonEmptyString(plan.platform, 'plan.platform', 32);
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
    safeNonEmptyString(item.item_id, `${path}.item_id`, 256);
    if (itemIds.has(item.item_id)) fail('plan contains a duplicate item_id');
    itemIds.add(item.item_id);
    if (!ACTIONS.includes(item.action)) fail(`${path}.action is unsupported`);
    safeNonEmptyString(item.entry_path, `${path}.entry_path`);
    safeNonEmptyString(item.active_root, `${path}.active_root`);
    if (!['directory', 'symlink', 'broken_symlink'].includes(item.entry_kind)) {
      fail(`${path}.entry_kind is unsupported`);
    }
    exactKeys(item.execution_identity, IDENTITY_KEYS, [...IDENTITY_KEYS], `${path}.execution_identity`);
    if (item.execution_identity.schema_version !== SCHEMAS.identity) {
      fail(`${path}.execution_identity schema is unsupported`);
    }
    safeNonEmptyString(item.execution_identity.adapter, `${path}.execution_identity.adapter`, 128);
    if (item.execution_identity.entry_path !== item.entry_path
        || item.execution_identity.active_root !== item.active_root
        || item.execution_identity.entry_kind !== item.entry_kind) {
      fail(`${path}.execution_identity does not match the plan item`);
    }
    validateSha256(item.execution_identity.identity_hash, `${path}.execution_identity.identity_hash`);
    if (item.execution_identity.identity_hash !== computeIdentityHash(item.execution_identity)) {
      fail(`${path}.execution_identity.identity_hash does not match canonical identity content`);
    }
    validateSha256(item.execution_identity.source_hash, `${path}.execution_identity.source_hash`);
    validateSha256(item.execution_identity.binary_hash, `${path}.execution_identity.binary_hash`);
    safeNonEmptyString(item.execution_identity.architecture, `${path}.execution_identity.architecture`, 32);
    safeNonEmptyString(item.execution_identity.compiler_path, `${path}.execution_identity.compiler_path`);
    safeNonEmptyString(item.execution_identity.compiler_version, `${path}.execution_identity.compiler_version`, 4096);
    safeNonEmptyString(item.execution_identity.helper_protocol, `${path}.execution_identity.helper_protocol`, 128);
    safeNonEmptyString(item.execution_identity.cache_path, `${path}.execution_identity.cache_path`);
    if (!/^\d+$/u.test(item.execution_identity.device)
        || !/^\d+$/u.test(item.execution_identity.inode)) {
      fail(`${path}.execution_identity object identifiers are unsupported`);
    }
    for (const field of ['mode', 'uid', 'gid', 'flags']) {
      if (!Number.isSafeInteger(item.execution_identity[field]) || item.execution_identity[field] < 0) {
        fail(`${path}.execution_identity native metadata is unsupported`);
      }
    }
    validateSha256(item.execution_identity.manifest_hash, `${path}.execution_identity.manifest_hash`);
    validateSha256(
      item.execution_identity.security_metadata_hash,
      `${path}.execution_identity.security_metadata_hash`,
    );
    const rawTarget = item.execution_identity.raw_link_target_base64;
    if (rawTarget !== null && (typeof rawTarget !== 'string' || !BASE64.test(rawTarget))) {
      fail(`${path}.execution_identity raw link target is unsupported`);
    }
    const receipt = item.execution_identity.receipt_sha256;
    const installedTree = item.execution_identity.installed_tree_sha1;
    if (item.entry_kind === 'directory') {
      if (typeof receipt !== 'string' || !/^[0-9a-f]{64}$/u.test(receipt)
          || typeof installedTree !== 'string' || !SHA1.test(installedTree)
          || rawTarget !== null) {
        fail(`${path}.execution_identity installed-copy evidence is unsupported`);
      }
    } else if (receipt !== null || installedTree !== null || typeof rawTarget !== 'string') {
      fail(`${path}.execution_identity link evidence is unsupported`);
    }
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
