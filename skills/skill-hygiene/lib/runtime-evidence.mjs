import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  accessSync, closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readlinkSync, readdirSync, realpathSync, writeFileSync,
} from 'node:fs';
import { arch, platform, release } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeTreeDigest } from './collection-tree.mjs';
import {
  validateCollectionIndex, validateCollectionPlan, validateOperationRecord,
} from './collection-contract.mjs';
import {
  createCollectionFileExclusive, inspectCollectionEntry, moveCollectionEntryExclusive,
  replaceCollectionFileCas,
} from './cleanup-macos.mjs';
import {
  validateManagedIndex, validateManagedOperation, validateManagedPlan,
} from './managed-collection-contract.mjs';

export const RUNTIME_SCHEMAS = Object.freeze({
  policy: 'skills-refiner.runtime-policy.v1',
  evidence: 'skills-refiner.runtime-evidence.v2',
  status: 'skills-refiner.runtime-status.v1',
});

const LEGACY_RUNTIME_EVIDENCE_SCHEMA = 'skills-refiner.runtime-evidence.v1';

export const RUNTIME_ADAPTERS = Object.freeze(['codex', 'claude', 'cursor']);
export const COLLECTION_IDS = Object.freeze(['prodcraft', 'better-skills', 'loopos', 'langcraft']);

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUNTIME_POLICY = join(MODULE_DIR, '..', 'references', 'runtime-policy.json');
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_ITEMS = 4096;
const MAX_EVIDENCE_TEXT = 4096;
const MAX_LIMITATION_TEXT = 1024;
const RUNTIME_SKILL_NAME = /^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/u;
const NATIVE_RUNTIME_VERSION = /^[0-9]+(?:\.[0-9]+){2}(?:[-+][A-Za-z0-9.-]+)?$/u;
const RUNTIME_ADAPTER_VERSION = Object.freeze({
  codex: /^codex-cli [0-9]+(?:\.[0-9]+){2}(?:[-+][A-Za-z0-9.-]+)?$/u,
  claude: /^[0-9]+(?:\.[0-9]+){2}(?:[-+][A-Za-z0-9.-]+)? \(Claude Code\)$/u,
  cursor: /^[0-9]+(?:\.[0-9]+){2}(?:-[A-Za-z0-9.-]+)?$/u,
});

export class RuntimeEvidenceError extends Error {
  constructor(code, message, status = 'blocked') {
    super(message);
    this.name = 'RuntimeEvidenceError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 'blocked') {
  throw new RuntimeEvidenceError(code, message, status);
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function readJson(path, code) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { fail(code, `${path}: ${error.message}`); }
}

function assertRealFile(path, code) {
  let stat;
  try { stat = lstatSync(path); } catch { fail(code, `missing file: ${path}`); }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(code, `expected real file: ${path}`);
}

function assertUnderHome(home, path) {
  if (path !== home && !path.startsWith(`${home}/`)) fail('unsafe_path', `path escapes HOME: ${path}`);
}

function assertNoSymlinkComponents(home, path) {
  assertUnderHome(home, path);
  const relative = path === home ? '' : path.slice(home.length + 1);
  let current = home;
  for (const part of relative.split('/').filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink()) fail('unsafe_control_path', `symlinked control path: ${current}`);
  }
}

function privateFileSnapshot(home, path, code, { allowMissing = false, afterRead = null } = {}) {
  assertUnderHome(home, path);
  try { assertNoSymlinkComponents(home, path); } catch (error) { fail(code, error.message); }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return null;
    fail(code, `${path}: ${error.message}`);
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n
        || before.nlink !== 1n) {
      fail(code, `expected an owner-private singly-linked real file: ${path}`);
    }
    const bytes = readFileSync(descriptor);
    if (afterRead) afterRead({ path });
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || BigInt(bytes.length) !== before.size) {
      fail(code, `file changed while being read: ${path}`);
    }
    let bound;
    try { bound = lstatSync(path, { bigint: true }); } catch { fail(code, `file path changed while being read: ${path}`); }
    if (bound.isSymbolicLink() || !bound.isFile() || bound.dev !== before.dev || bound.ino !== before.ino) {
      fail(code, `file path changed while being read: ${path}`);
    }
    try { assertNoSymlinkComponents(home, path); } catch (error) { fail(code, error.message); }
    return {
      bytes,
      digest: sha256(bytes),
      device: before.dev.toString(),
      inode: before.ino.toString(),
    };
  } finally {
    try { closeSync(descriptor); } catch {}
  }
}

function collectionControlDrift(collectionId, layer, reason) {
  const error = new RuntimeEvidenceError(
    'collection_control_drift', `${collectionId}:${layer}:${reason}`,
  );
  error.control_layer = layer;
  throw error;
}

function exactObjectKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function runtimeExecutableSnapshot(command, path) {
  let descriptor;
  try {
    accessSync(path, constants.X_OK);
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    fail('runtime_executable_unavailable', `${command}: ${error.message}`, 'unsupported');
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size < 0n || before.size > BigInt(MAX_EXECUTABLE_BYTES)) {
      fail('runtime_executable_unsafe', `${command}: executable must be a bounded real file`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || BigInt(bytes.length) !== before.size) {
      fail('runtime_executable_changed', `${command}: executable changed while being read`);
    }
    return {
      command,
      path,
      device: before.dev.toString(),
      inode: before.ino.toString(),
      size: Number(before.size),
      content_sha256: sha256(bytes),
    };
  } finally {
    try { closeSync(descriptor); } catch {}
  }
}

function validRuntimeExecutableIdentity(value) {
  return exactObjectKeys(value, ['command', 'path', 'device', 'inode', 'size', 'content_sha256'])
    && typeof value.command === 'string' && /^[A-Za-z0-9._+-]+$/u.test(value.command)
    && typeof value.path === 'string' && value.path.length <= MAX_EVIDENCE_TEXT && !value.path.includes('\0')
    && isAbsolute(value.path) && resolve(value.path) === value.path
    && /^\d+$/u.test(value.device) && /^\d+$/u.test(value.inode)
    && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= MAX_EXECUTABLE_BYTES
    && DIGEST.test(value.content_sha256);
}

export function resolveRuntimeExecutable(command, { env = process.env } = {}) {
  if (typeof command !== 'string' || !/^[A-Za-z0-9._+-]+$/u.test(command)) {
    fail('invalid_runtime_executable', `invalid executable name: ${command}`, 'invalid');
  }
  const pathValue = typeof env.PATH === 'string' ? env.PATH : '';
  for (const component of pathValue.split(delimiter)) {
    const candidate = resolve(component || process.cwd(), command);
    try {
      const canonical = realpathSync(candidate);
      return runtimeExecutableSnapshot(command, canonical);
    } catch (error) {
      if (error instanceof RuntimeEvidenceError && error.code !== 'runtime_executable_unavailable') throw error;
    }
  }
  fail('runtime_executable_unavailable', `${command}: executable was not found on PATH`, 'unsupported');
}

export function assertRuntimeExecutableIdentity(identity) {
  if (!validRuntimeExecutableIdentity(identity)) {
    fail('invalid_runtime_executable_identity', 'runtime executable identity is invalid', 'invalid');
  }
  let current;
  try { current = runtimeExecutableSnapshot(identity.command, identity.path); } catch (error) {
    if (error instanceof RuntimeEvidenceError && error.code === 'runtime_executable_unavailable') {
      fail('runtime_executable_changed', `${identity.command}: executable is no longer available`);
    }
    throw error;
  }
  if (canonicalJson(current) !== canonicalJson(identity)) {
    fail('runtime_executable_changed', `${identity.command}: executable identity changed`);
  }
  return identity;
}

export function runRuntimeExecutable(identity, args, options = {}, runner = spawnSync) {
  assertRuntimeExecutableIdentity(identity);
  let result;
  let thrown;
  try {
    result = runner(identity.path, args, { ...options, shell: false });
  } catch (error) {
    thrown = error;
  }
  assertRuntimeExecutableIdentity(identity);
  if (thrown) throw thrown;
  return result;
}

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function readControlJson(home, path, collectionId, layer) {
  let snapshot;
  try { snapshot = privateFileSnapshot(home, path, 'collection_control_drift'); } catch (error) {
    collectionControlDrift(collectionId, layer, error.message);
  }
  try {
    return { value: JSON.parse(snapshot.bytes.toString('utf8')), bytes: snapshot.bytes, digest: snapshot.digest, path };
  } catch (error) {
    collectionControlDrift(collectionId, layer, `invalid JSON: ${error.message}`);
  }
}

function validateCatalogEnvelope(loaded, layer) {
  const catalog = loaded.value;
  if (!exactObjectKeys(catalog, ['schema_version', 'updated_at', 'collections'])
      || catalog.schema_version !== 'skills-refiner.collection-catalog.v1'
      || !validTimestamp(catalog.updated_at)
      || !catalog.collections || typeof catalog.collections !== 'object'
      || Array.isArray(catalog.collections)) {
    collectionControlDrift('catalog', layer, 'catalog envelope is invalid');
  }
}

function readManagedCatalogs(home) {
  const canonical = readControlJson(
    home, join(home, 'Library', 'Application Support', 'skills-refiner', 'catalog.json'),
    'catalog', 'catalog_canonical',
  );
  const view = readControlJson(
    home, join(home, '.agents', 'skill-control', 'catalog.json'),
    'catalog', 'catalog_view',
  );
  validateCatalogEnvelope(canonical, 'catalog_canonical');
  validateCatalogEnvelope(view, 'catalog_view');
  if (!canonical.bytes.equals(view.bytes)) {
    collectionControlDrift('catalog', 'catalog_mirror', 'canonical catalog and materialized view differ');
  }
  return {
    catalog: canonical.value,
    canonical_digest: canonical.digest,
    view_digest: view.digest,
  };
}

function validateActiveControl(active, collectionId) {
  const operationPattern = new RegExp(`^${collectionId}-[0-9a-f]{12}$`, 'u');
  const validCommon = operationPattern.test(active?.operation_id ?? '') && DIGEST.test(active?.plan_hash ?? '');
  if (collectionId === 'prodcraft') {
    if (!exactObjectKeys(active, ['schema_version', 'operation_id', 'plan_hash'])
        || active.schema_version !== 'skills-refiner.collection.active.v1' || !validCommon) {
      collectionControlDrift(collectionId, 'active', 'active.v1 envelope is invalid');
    }
    return;
  }
  if (!exactObjectKeys(active, ['schema_version', 'collection_id', 'operation_id', 'plan_hash', 'activated_at'])
      || active.schema_version !== 'skills-refiner.collection.active.v2'
      || active.collection_id !== collectionId || !validCommon || !validTimestamp(active.activated_at)) {
    collectionControlDrift(collectionId, 'active', 'active.v2 envelope is invalid');
  }
}

function validateCatalogEntry(entry, collectionId, home) {
  if (!exactObjectKeys(entry, [
    'collection_id', 'operation_id', 'plan_hash', 'source', 'collection_root', 'recovery_plan', 'lifecycle',
  ]) || entry.collection_id !== collectionId || !DIGEST.test(entry.plan_hash ?? '')
      || !new RegExp(`^${collectionId}-[0-9a-f]{12}$`, 'u').test(entry.operation_id ?? '')
      || !exactObjectKeys(entry.source, ['provider', 'repository_id', 'resolved_revision', 'artifact_digest'])
      || entry.source.provider !== 'github' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(entry.source.repository_id ?? '')
      || !/^[0-9a-f]{40}$/u.test(entry.source.resolved_revision ?? '')
      || !DIGEST.test(entry.source.artifact_digest ?? '')
      || typeof entry.collection_root !== 'string' || typeof entry.recovery_plan !== 'string') {
    collectionControlDrift(collectionId, 'catalog_entry', 'catalog entry identity is invalid');
  }
  try {
    assertUnderHome(home, entry.collection_root);
    assertUnderHome(home, entry.recovery_plan);
  } catch (error) {
    collectionControlDrift(collectionId, 'catalog_entry', error.message);
  }
  if (!exactObjectKeys(entry.lifecycle, [
    'receipt_history', 'plan_created_at', 'first_activated_at', 'current_generation_activated_at',
  ]) || !exactObjectKeys(entry.lifecycle.receipt_history, [
    'entry_count', 'first_installed_at', 'last_updated_at',
  ]) || !Number.isSafeInteger(entry.lifecycle.receipt_history.entry_count)
      || entry.lifecycle.receipt_history.entry_count < 1
      || !['first_installed_at', 'last_updated_at'].every((key) => validTimestamp(entry.lifecycle.receipt_history[key]))
      || !['plan_created_at', 'first_activated_at', 'current_generation_activated_at']
        .every((key) => validTimestamp(entry.lifecycle[key]))) {
    collectionControlDrift(collectionId, 'catalog_entry', 'catalog lifecycle is invalid');
  }
}

function collectionControlBinding(home, collectionId, collectionRoot, index, loadedCatalog) {
  const activePath = join(home, '.agents', 'skill-control', 'collections', collectionId, 'active.json');
  const active = readControlJson(home, activePath, collectionId, 'active');
  validateActiveControl(active.value, collectionId);
  const operationRoot = join(
    home, '.agents', 'skill-control', 'collections', collectionId, 'operations',
    active.value.operation_id,
  );
  const plan = readControlJson(home, join(operationRoot, 'plan.json'), collectionId, 'plan');
  const operation = readControlJson(home, join(operationRoot, 'operation.json'), collectionId, 'operation');
  try {
    if (collectionId === 'prodcraft') validateCollectionPlan(plan.value);
    else validateManagedPlan(plan.value);
  } catch (error) { collectionControlDrift(collectionId, 'plan', error.message); }
  try {
    if (collectionId === 'prodcraft') validateOperationRecord(operation.value);
    else validateManagedOperation(operation.value);
  } catch (error) { collectionControlDrift(collectionId, 'operation', error.message); }
  const mismatches = [];
  const derivedOperationId = `${collectionId}-${plan.value.plan_hash?.slice(7, 19)}`;
  if (plan.value.home !== home || plan.value.collection_id !== collectionId) mismatches.push('plan_scope');
  if (active.value.operation_id !== derivedOperationId) mismatches.push('derived_operation_id');
  if (index.operation_id !== active.value.operation_id) mismatches.push('index_active_operation_id');
  if (plan.value.plan_hash !== active.value.plan_hash) mismatches.push('active_plan_hash');
  if (operation.value.operation_id !== active.value.operation_id) mismatches.push('active_operation_id');
  if (operation.value.plan_hash !== active.value.plan_hash) mismatches.push('operation_plan_hash');
  if (operation.value.collection_id !== collectionId || operation.value.state !== 'COMMITTED') mismatches.push('operation_state');
  if (plan.value.source.provider !== index.source.provider) mismatches.push('source_provider');
  if (plan.value.source.repository_id !== index.source.repository_id) mismatches.push('repository_id');
  if (plan.value.source.revision !== index.source.resolved_revision) mismatches.push('resolved_revision');
  if (plan.value.source.tree_digest !== index.source.tree_digest
      || plan.value.source.tree_digest !== index.artifact_digest) mismatches.push('artifact_digest');
  const generatedGateway = collectionId === 'prodcraft' ? index.gateway.name
    : index.exposure.type === 'gateway' ? index.exposure.name : null;
  const indexedMemberIdentity = index.members.map(({ name, tree_digest }) => ({
    name, tree_digest: name === generatedGateway ? null : tree_digest,
  }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const plannedMemberIdentity = plan.value.source.members.map(({ name, tree_digest }) => ({
    name, tree_digest: name === generatedGateway ? null : tree_digest,
  }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (canonicalJson(indexedMemberIdentity) !== canonicalJson(plannedMemberIdentity)) mismatches.push('member_set');
  const indexedResourceIdentity = (index.resources ?? []).map(({ relative_path, tree_digest }) => ({ relative_path, tree_digest }))
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  const plannedResourceIdentity = (plan.value.source.resources ?? []).map(({ relative_path, tree_digest }) => ({ relative_path, tree_digest }))
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path));
  if (canonicalJson(indexedResourceIdentity) !== canonicalJson(plannedResourceIdentity)) mismatches.push('resource_set');
  if (plan.value.target.collection_root !== collectionRoot) mismatches.push('collection_root');
  if (plan.value.created_at !== index.plan_created_at) mismatches.push('plan_created_at');

  let catalogEntryDigest = null;
  if (collectionId !== 'prodcraft') {
    const entry = loadedCatalog.catalog.collections[collectionId];
    if (!entry) collectionControlDrift(collectionId, 'catalog_entry', 'catalog entry is missing');
    validateCatalogEntry(entry, collectionId, home);
    const expectedRecoveryPlan = join(
      home, 'Library', 'Application Support', 'skills-refiner', 'recovery', 'operations',
      active.value.operation_id, 'plan.json',
    );
    if (entry.operation_id !== active.value.operation_id) mismatches.push('active_catalog_operation_id');
    if (entry.plan_hash !== active.value.plan_hash) mismatches.push('active_catalog_plan_hash');
    if (entry.source.provider !== plan.value.source.provider) mismatches.push('catalog_source_provider');
    if (entry.source.repository_id !== plan.value.source.repository_id) mismatches.push('catalog_repository_id');
    if (entry.source.resolved_revision !== plan.value.source.revision) mismatches.push('catalog_resolved_revision');
    if (entry.source.artifact_digest !== plan.value.source.tree_digest) mismatches.push('catalog_artifact_digest');
    if (entry.collection_root !== collectionRoot) mismatches.push('catalog_collection_root');
    if (entry.recovery_plan !== expectedRecoveryPlan) mismatches.push('recovery_plan');
    if (entry.lifecycle.plan_created_at !== plan.value.created_at
        || canonicalJson(entry.lifecycle.receipt_history) !== canonicalJson(plan.value.receipt.history)
        || entry.lifecycle.current_generation_activated_at !== active.value.activated_at) {
      mismatches.push('catalog_lifecycle');
    }
    catalogEntryDigest = sha256(canonicalJson(entry));
  }
  if (mismatches.length > 0) {
    collectionControlDrift(collectionId, 'identity', mismatches.join(','));
  }
  const identity = {
    control_schema: collectionId === 'prodcraft' ? 'prodcraft.v1' : 'managed.v2',
    collection_id: collectionId,
    operation_id: active.value.operation_id,
    plan_hash: active.value.plan_hash,
    resolved_revision: plan.value.source.revision,
    collection_root: plan.value.target.collection_root,
    active_digest: active.digest,
    plan_digest: plan.digest,
    operation_digest: operation.digest,
    catalog_entry_digest: catalogEntryDigest,
  };
  return { ...identity, binding_digest: sha256(canonicalJson(identity)) };
}

function runtimeConfigDigest(home, adapter) {
  if (adapter !== 'codex') return null;
  const path = join(home, '.codex', 'config.toml');
  return privateFileSnapshot(home, path, 'runtime_config_drift').digest;
}

function deployedResourceDigest(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) fail('collection_resource_drift', `resource is a symlink: ${path}`);
  if (stat.isDirectory()) {
    return computeTreeDigest(path, (code, message) => fail(code, message), { ignoredBasenames: ['.DS_Store'] });
  }
  if (stat.isFile()) {
    return sha256(Buffer.concat([
      Buffer.from(`f\0${stat.mode & 0o777}\0${stat.size}\0`), readFileSync(path), Buffer.from('\0'),
    ]));
  }
  fail('collection_resource_drift', `unsupported resource: ${path}`);
}

export function loadRuntimePolicy(policyPath = DEFAULT_RUNTIME_POLICY) {
  assertRealFile(policyPath, 'invalid_runtime_policy');
  const policy = readJson(policyPath, 'invalid_runtime_policy');
  const rootKeys = Object.keys(policy ?? {}).sort();
  const expectedRootKeys = ['claims', 'collections', 'evidence_max_age_hours', 'profile_id', 'schema_version', 'unmanaged_skills'].sort();
  if (policy?.schema_version !== RUNTIME_SCHEMAS.policy || policy.profile_id !== 'default'
      || policy.unmanaged_skills !== 'preserve' || !policy.collections || typeof policy.collections !== 'object'
      || canonicalJson(rootKeys) !== canonicalJson(expectedRootKeys)
      || !Number.isInteger(policy.evidence_max_age_hours) || policy.evidence_max_age_hours < 1
      || policy.evidence_max_age_hours > 720
      || policy.claims?.filesystem_nesting_saves_context !== 'vetoed'
      || policy.claims?.cross_repository_same_name_default_disposition !== 'preserve'
      || canonicalJson(policy.claims?.runtime_qualified_requires) !== canonicalJson(['catalog', 'body_access', 'route_if_gateway'])
      || canonicalJson(Object.keys(policy.collections).sort()) !== canonicalJson([...COLLECTION_IDS].sort())) {
    fail('invalid_runtime_policy', 'runtime policy header is invalid');
  }
  for (const collectionId of COLLECTION_IDS) {
    const collection = policy.collections[collectionId];
    if (!collection || canonicalJson(Object.keys(collection).sort()) !== canonicalJson([...RUNTIME_ADAPTERS].sort())) {
      fail('invalid_runtime_policy', `invalid collection policy: ${collectionId}`);
    }
    for (const adapter of RUNTIME_ADAPTERS) {
      const value = collection[adapter];
      const allowedKeys = ['catalog_mode'];
      if (value?.catalog_mode === 'gateway') allowedKeys.push('gateway');
      if (adapter === 'cursor') allowedKeys.push('mutation_policy');
      if (!value || !['gateway', 'members'].includes(value.catalog_mode)) {
        fail('invalid_runtime_policy', `invalid ${collectionId}.${adapter} policy`);
      }
      if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(allowedKeys.sort())) {
        fail('invalid_runtime_policy', `unknown or missing ${collectionId}.${adapter} policy field`);
      }
      if (value.catalog_mode === 'gateway' && !NAME.test(value.gateway ?? '')) {
        fail('invalid_runtime_policy', `invalid gateway for ${collectionId}.${adapter}`);
      }
      if (adapter === 'cursor' && value.mutation_policy !== 'observe_only_until_runtime_probe') {
        fail('invalid_runtime_policy', `invalid mutation policy for ${collectionId}.${adapter}`);
      }
    }
  }
  return { policy, path: resolve(policyPath), digest: sha256(readFileSync(policyPath)) };
}

function readCollectionBinding(home, collectionId, loadedCatalog) {
  const collectionRoot = join(home, '.agents', 'skills', collectionId);
  const indexPath = join(collectionRoot, 'INDEX.json');
  assertUnderHome(home, collectionRoot);
  let rootStat;
  try { rootStat = lstatSync(collectionRoot); } catch { fail('collection_missing', `missing collection: ${collectionId}`); }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || realpathSync(collectionRoot) !== collectionRoot) {
    fail('unsafe_collection', `collection root must be a canonical real directory: ${collectionRoot}`);
  }
  assertRealFile(indexPath, 'invalid_collection_index');
  const index = readJson(indexPath, 'invalid_collection_index');
  try {
    if (collectionId === 'prodcraft') validateCollectionIndex(index);
    else validateManagedIndex(index);
  } catch (error) { fail('invalid_collection_index', `${collectionId}: ${error.message}`); }
  const controlBinding = collectionControlBinding(home, collectionId, collectionRoot, index, loadedCatalog);
  const ignoredBasenames = new Set(['.DS_Store']);
  const allowedRoots = [
    ...index.members.map(({ relative_path }) => relative_path),
    ...(index.resources ?? []).map(({ relative_path }) => relative_path),
  ];
  const observedPaths = [];
  const observedSkillFiles = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (ignoredBasenames.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const relativePath = path.slice(collectionRoot.length + 1);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        fail('collection_root_drift', `${collectionId}: unsafe collection entry ${relativePath}`);
      }
      const covered = relativePath === 'INDEX.json' || allowedRoots.some((root) => (
        relativePath === root || relativePath.startsWith(`${root}/`) || root.startsWith(`${relativePath}/`)
      ));
      if (!covered) fail('collection_root_drift', `${collectionId}: unindexed collection entry ${relativePath}`);
      observedPaths.push(relativePath);
      if (stat.isDirectory()) walk(path);
      else if (entry.name === 'SKILL.md') observedSkillFiles.push(relativePath);
    }
  };
  walk(collectionRoot);
  const expectedSkillFiles = index.members.map(({ relative_path }) => `${relative_path}/SKILL.md`).sort();
  if (canonicalJson(observedSkillFiles.sort()) !== canonicalJson(expectedSkillFiles)) {
    fail('collection_root_drift', `${collectionId}: discovered SKILL.md set does not match INDEX.json`);
  }
  for (const resource of index.resources ?? []) {
    const path = join(collectionRoot, resource.relative_path);
    try {
      if (deployedResourceDigest(path) !== resource.tree_digest) {
        fail('collection_resource_drift', `${collectionId}: ${resource.relative_path} does not match INDEX.json`);
      }
    } catch (error) {
      if (error instanceof RuntimeEvidenceError) throw error;
      fail('collection_resource_drift', `${collectionId}: ${resource.relative_path} is unavailable`);
    }
  }
  const members = index.members.map((member) => {
    if (!NAME.test(member?.name ?? '') || !DIGEST.test(member.tree_digest ?? '')) {
      fail('invalid_collection_index', `invalid member in ${collectionId}`);
    }
    const skillFile = join(collectionRoot, member.relative_path, 'SKILL.md');
    assertRealFile(skillFile, 'collection_member_missing');
    const memberRoot = dirname(skillFile);
    const observedTreeDigest = computeTreeDigest(
      memberRoot,
      (code, message) => fail(code, message),
      { ignoredBasenames: index.schema_version === 'skills-refiner.managed-collection.index.v2' ? ['.DS_Store'] : [] },
    );
    if (observedTreeDigest !== member.tree_digest) {
      fail('collection_member_drift', `${collectionId}:${member.name} does not match INDEX.json`);
    }
    return {
      name: member.name,
      tree_digest: observedTreeDigest,
      declared_tree_digest: member.tree_digest,
      skill_file: skillFile,
      source_path: member.relative_path,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(members.map(({ name }) => name)).size !== members.length) {
    fail('invalid_collection_index', `duplicate members in ${collectionId}`);
  }
  return {
    collection_id: collectionId,
    collection_root: collectionRoot,
    operation_id: controlBinding.operation_id,
    plan_hash: controlBinding.plan_hash,
    source_provider: index.source.provider,
    repository_id: index.source.repository_id,
    resolved_revision: index.source?.resolved_revision ?? null,
    artifact_digest: index.artifact_digest ?? index.source?.tree_digest ?? null,
    index_digest: sha256(readFileSync(indexPath)),
    member_set_digest: sha256(canonicalJson(members.map(({ name, tree_digest }) => ({ name, tree_digest })))),
    root_tree_digest: computeTreeDigest(collectionRoot, (code, message) => fail(code, message), { ignoredBasenames: [...ignoredBasenames] }),
    root_inventory_digest: sha256(canonicalJson(observedPaths.sort())),
    control_binding: controlBinding,
    members,
  };
}

function rootEntries(root) {
  if (!existsSync(root)) return [];
  let rootStat;
  try { rootStat = lstatSync(root); } catch { return []; }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return [{ name: '.', kind: 'unsafe_root' }];
  return readdirSync(root).sort().map((name) => {
    const path = join(root, name);
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        let resolved = null;
        try { resolved = realpathSync(path); } catch {}
        let skill_file_digest = null;
        try {
          const skillFile = join(resolved, 'SKILL.md');
          if (lstatSync(skillFile).isFile() && !lstatSync(skillFile).isSymbolicLink()) skill_file_digest = sha256(readFileSync(skillFile));
        } catch {}
        return { name, kind: 'symlink', raw_target: readlinkSync(path), resolved_target: resolved, skill_file_digest };
      }
      let skill_file_digest = null;
      if (stat.isDirectory()) {
        try {
          const skillFile = join(path, 'SKILL.md');
          if (lstatSync(skillFile).isFile() && !lstatSync(skillFile).isSymbolicLink()) skill_file_digest = sha256(readFileSync(skillFile));
        } catch {}
      }
      return { name, kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', skill_file_digest };
    } catch { return { name, kind: 'unreadable' }; }
  });
}

function adapterRoots(home, adapter) {
  if (adapter === 'codex') return [join(home, '.agents', 'skills'), join(home, '.codex', 'skills')];
  if (adapter === 'claude') return [join(home, '.claude', 'skills')];
  return [join(home, '.cursor', 'skills'), join(home, '.cursor', 'skills-cursor')];
}

export function collectRuntimeBinding({ home, adapter, policyPath = DEFAULT_RUNTIME_POLICY }) {
  if (!RUNTIME_ADAPTERS.includes(adapter)) fail('invalid_adapter', `unsupported adapter: ${adapter}`, 'invalid');
  const normalizedHome = realpathSync(resolve(home));
  const loaded = loadRuntimePolicy(policyPath);
  const prodcraft = readCollectionBinding(normalizedHome, 'prodcraft', null);
  const loadedCatalog = readManagedCatalogs(normalizedHome);
  const collections = [prodcraft, ...COLLECTION_IDS.filter((collectionId) => collectionId !== 'prodcraft').map((collectionId) => (
    readCollectionBinding(normalizedHome, collectionId, loadedCatalog)
  ))];
  const roots = adapterRoots(normalizedHome, adapter).map((root) => ({ root, entries: rootEntries(root) }));
  const expectedNames = [];
  const expectedEntities = [];
  const managedUniverse = new Set();
  const managedEntities = [];
  for (const collection of collections) {
    const rule = loaded.policy.collections[collection.collection_id][adapter];
    for (const member of collection.members) {
      managedUniverse.add(member.name);
      managedEntities.push({
        collection_id: collection.collection_id,
        repository_id: collection.repository_id,
        resolved_revision: collection.resolved_revision,
        source_path: member.source_path,
        name: member.name,
        skill_file: member.skill_file,
        tree_digest: member.tree_digest,
      });
    }
    if (rule.catalog_mode === 'members') {
      expectedNames.push(...collection.members.map(({ name }) => name));
      expectedEntities.push(...managedEntities.filter(({ collection_id }) => collection_id === collection.collection_id));
    } else {
      const gateway = collection.members.find(({ name }) => name === rule.gateway);
      if (!gateway) fail('invalid_runtime_policy', `gateway is not a collection member: ${collection.collection_id}:${rule.gateway}`);
      expectedNames.push(rule.gateway);
      expectedEntities.push(managedEntities.find(({ collection_id, name }) => collection_id === collection.collection_id && name === gateway.name));
    }
    if (rule.gateway) managedUniverse.add(rule.gateway);
  }
  const inventoryCollections = collections.map(({ plan_hash: _planHash, control_binding: _control, ...collection }) => collection);
  const collectionControlDigest = sha256(canonicalJson({
    canonical_catalog_digest: loadedCatalog.canonical_digest,
    catalog_view_digest: loadedCatalog.view_digest,
    collections: collections.map(({ control_binding }) => control_binding),
  }));
  const deployment = {
    profile_id: loaded.policy.profile_id,
    policy_path: loaded.path,
    policy_digest: loaded.digest,
    discovery_roots: roots.map(({ root }) => root),
    root_inventory_digest: sha256(canonicalJson({ collections: inventoryCollections, roots })),
    collection_control_digest: collectionControlDigest,
    runtime_config_digest: runtimeConfigDigest(normalizedHome, adapter),
  };
  return {
    policy: loaded.policy,
    collections,
    deployment,
    expected_names: [...new Set(expectedNames)].sort(),
    expected_entities: expectedEntities.sort((a, b) => a.name.localeCompare(b.name)),
    managed_universe: [...managedUniverse].sort(),
    managed_entities: managedEntities.sort((a, b) => a.name.localeCompare(b.name)),
    managed_roots: collections.map(({ collection_id, collection_root }) => ({ collection_id, collection_root })),
  };
}

function currentHostEnvironment() {
  return { platform: platform(), architecture: arch(), os_release: release(), node_version: process.version };
}

function validHostEnvironment(value) {
  return exactObjectKeys(value, ['platform', 'architecture', 'os_release', 'node_version'])
    && ['platform', 'architecture', 'os_release', 'node_version'].every((key) => (
      typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 300
    ));
}

function runtimeExecutableName(adapter) {
  if (adapter === 'codex') return 'codex';
  if (adapter === 'claude') return 'claude';
  if (adapter === 'cursor') return 'cursor-agent';
  fail('invalid_adapter', `unsupported adapter: ${adapter}`, 'invalid');
}

export function resolveRuntimeAdapterExecutable(adapter, options = {}) {
  return resolveRuntimeExecutable(runtimeExecutableName(adapter), options);
}

export function currentRuntimeAdapterVersion(
  adapter,
  executable = resolveRuntimeAdapterExecutable(adapter),
  runner = spawnSync,
) {
  if (executable.command !== runtimeExecutableName(adapter)) {
    fail('runtime_executable_binding_mismatch', `${adapter}: executable command does not match adapter`, 'invalid');
  }
  let result;
  try {
    result = runRuntimeExecutable(
      executable,
      ['--version'],
      { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 },
      runner,
    );
  } catch {
    fail('runtime_version_probe_failed', `${executable.command}: version probe failed`);
  }
  const version = String(result.stdout ?? '').trim();
  if (result.error || result.status !== 0 || !boundedString(version, 300)
      || !RUNTIME_ADAPTER_VERSION[adapter].test(version)) {
    fail('runtime_version_probe_failed', `${executable.command}: version probe failed`);
  }
  return version;
}

export function computeEvidenceId(evidence) {
  const copy = structuredClone(evidence);
  delete copy.evidence_id;
  return sha256(canonicalJson(copy));
}

function boundedString(value, maxLength = MAX_EVIDENCE_TEXT) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !value.includes('\0');
}

function boundedAbsolutePath(value) {
  return boundedString(value) && isAbsolute(value) && resolve(value) === value;
}

function sortedUniqueStrings(value, { pattern = null, maxItems = MAX_EVIDENCE_ITEMS } = {}) {
  return Array.isArray(value) && value.length <= maxItems
    && value.every((item) => boundedString(item, 512) && (!pattern || pattern.test(item)))
    && canonicalJson(value) === canonicalJson([...new Set(value)].sort());
}

function validObservedManagedEntity(value) {
  return exactObjectKeys(value, [
    'name', 'catalog_path', 'canonical_path', 'entity_id', 'collection_id', 'match_status',
  ])
    && boundedString(value.name, 256) && RUNTIME_SKILL_NAME.test(value.name)
    && (value.catalog_path === null || boundedAbsolutePath(value.catalog_path))
    && (value.canonical_path === null || boundedAbsolutePath(value.canonical_path))
    && (value.entity_id === null || DIGEST.test(value.entity_id))
    && (value.collection_id === null || COLLECTION_IDS.includes(value.collection_id))
    && ['matched', 'unmatched', 'name_only'].includes(value.match_status);
}

function validArtifactBinding(value) {
  if (!exactObjectKeys(value, ['collections']) || !Array.isArray(value.collections)
      || canonicalJson(value.collections.map(({ collection_id: id }) => id)) !== canonicalJson(COLLECTION_IDS)) {
    return false;
  }
  return value.collections.every((collection) => exactObjectKeys(collection, [
    'collection_id', 'operation_id', 'resolved_revision', 'artifact_digest', 'index_digest',
    'member_set_digest', 'root_tree_digest', 'root_inventory_digest',
  ])
    && new RegExp(`^${collection.collection_id}-[0-9a-f]{12}$`, 'u').test(collection.operation_id ?? '')
    && /^[0-9a-f]{40}$/u.test(collection.resolved_revision ?? '')
    && ['artifact_digest', 'index_digest', 'member_set_digest', 'root_tree_digest', 'root_inventory_digest']
      .every((key) => DIGEST.test(collection[key] ?? '')));
}

function validDeploymentBinding(value, adapter) {
  return exactObjectKeys(value, [
    'profile_id', 'policy_path', 'policy_digest', 'discovery_roots', 'root_inventory_digest',
    'collection_control_digest', 'runtime_config_digest',
  ])
    && value.profile_id === 'default'
    && boundedAbsolutePath(value.policy_path)
    && DIGEST.test(value.policy_digest ?? '')
    && Array.isArray(value.discovery_roots) && value.discovery_roots.length >= 1
    && value.discovery_roots.length <= 4
    && value.discovery_roots.every(boundedAbsolutePath)
    && new Set(value.discovery_roots).size === value.discovery_roots.length
    && DIGEST.test(value.root_inventory_digest ?? '')
    && DIGEST.test(value.collection_control_digest ?? '')
    && (adapter === 'codex'
      ? DIGEST.test(value.runtime_config_digest ?? '')
      : value.runtime_config_digest === null);
}

function expectedCommandContract(adapter) {
  if (adapter === 'codex') return ['codex', 'debug', 'prompt-input', 'Runtime catalog probe. Do not execute tools.'];
  if (adapter === 'claude') return ['claude', '-p', '--output-format', 'stream-json', '--no-session-persistence', '<probe>'];
  return ['cursor-agent', 'status'];
}

function validProbe(value, evidenceSchema) {
  const expectedContract = evidenceSchema === LEGACY_RUNTIME_EVIDENCE_SCHEMA
    ? 'skills-refiner.runtime-probe.v1' : 'skills-refiner.runtime-probe.v2';
  const currentVersionShape = evidenceSchema === LEGACY_RUNTIME_EVIDENCE_SCHEMA
    || (value && RUNTIME_ADAPTER_VERSION[value.adapter_id]?.test(value.adapter_version)
      && (value.adapter_id === 'claude'
        ? value.runtime_build === 'unobserved' || NATIVE_RUNTIME_VERSION.test(value.runtime_build)
        : value.runtime_build === value.adapter_version));
  if (!exactObjectKeys(value, [
    'adapter_id', 'adapter_version', 'runtime_build', 'probe_contract_version', 'executable_identity',
    'host_environment', 'command_contract', 'session_kind', 'cwd', 'auth_state', 'sandbox_mode',
  ]) || !RUNTIME_ADAPTERS.includes(value.adapter_id)
      || value.probe_contract_version !== expectedContract
      || !boundedString(value.adapter_version, 300) || !boundedString(value.runtime_build, 300)
      || !currentVersionShape
      || !validRuntimeExecutableIdentity(value.executable_identity)
      || value.executable_identity.command !== runtimeExecutableName(value.adapter_id)
      || !validHostEnvironment(value.host_environment)
      || canonicalJson(value.command_contract) !== canonicalJson(expectedCommandContract(value.adapter_id))
      || !boundedAbsolutePath(value.cwd) || value.sandbox_mode !== 'read_only_probe') {
    return false;
  }
  const expectedSession = value.adapter_id === 'codex' ? 'native_prompt_render'
    : value.adapter_id === 'claude' ? 'fresh_no_persistence' : 'native_status_only';
  const authStates = value.adapter_id === 'codex' ? ['not_required_for_prompt_render']
    : value.adapter_id === 'claude'
      ? evidenceSchema === LEGACY_RUNTIME_EVIDENCE_SCHEMA
        ? ['available', 'authentication_blocked_after_init', 'blocked']
        : ['available', 'post_init_nonzero', 'blocked']
      : ['not_logged_in', 'blocked'];
  return value.session_kind === expectedSession && authStates.includes(value.auth_state);
}

function validLimitations(adapter, value, evidenceSchema) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3
      || value.some((item) => !boundedString(item, MAX_LIMITATION_TEXT))) return false;
  if (adapter === 'cursor') {
    return canonicalJson(value) === canonicalJson([
      'Cursor CLI exposes no native catalog command in this build',
      'static implementation evidence does not qualify current runtime discovery',
    ]);
  }
  const terminal = adapter === 'codex'
    ? 'catalog metadata does not prove body access or instruction compliance'
    : 'system.init proves metadata enumeration only; body access is unverified';
  if (evidenceSchema !== LEGACY_RUNTIME_EVIDENCE_SCHEMA) {
    return canonicalJson(value) === canonicalJson([terminal]);
  }
  if (value.at(-1) !== terminal || value.length > 2) return false;
  if (value.length === 1) return true;
  const parseError = value[0];
  return adapter === 'codex'
    ? /^parse_error:(?:codex prompt-input output is not JSON|codex prompt-input output must be an array|expected exactly one Codex skills catalog, observed \d+|Codex skills catalog was not found)$/u.test(parseError)
    : parseError === 'parse_error:Claude system.init.skills was not found';
}

function validProbeResult(adapter, value) {
  if (!exactObjectKeys(value, ['execution', 'decoding'])
      || !exactObjectKeys(value.execution, ['outcome', 'exit_code', 'signal', 'failure_class'])
      || !exactObjectKeys(value.decoding, ['outcome', 'error_code'])) return false;
  const execution = value.execution;
  const failureClasses = ['none', 'permission_denied', 'not_found', 'timeout', 'output_limit', 'unknown'];
  if (!failureClasses.includes(execution.failure_class)) return false;
  if (execution.outcome === 'exit_zero') {
    if (execution.exit_code !== 0 || execution.signal !== null || execution.failure_class !== 'none') return false;
  } else if (execution.outcome === 'exit_nonzero') {
    if (!Number.isSafeInteger(execution.exit_code) || execution.exit_code <= 0
        || execution.exit_code > 255
        || execution.signal !== null || !['permission_denied', 'unknown'].includes(execution.failure_class)) return false;
  } else if (execution.outcome === 'spawn_error') {
    if (execution.exit_code !== null || execution.signal !== null || execution.failure_class === 'none') return false;
  } else if (execution.outcome === 'signaled') {
    if (execution.exit_code !== null || typeof execution.signal !== 'string'
        || !/^SIG[A-Z0-9]{1,24}$/u.test(execution.signal)
        || execution.failure_class !== 'unknown') return false;
  } else return false;

  const decoding = value.decoding;
  if (adapter === 'cursor') {
    return decoding.outcome === 'not_applicable' && decoding.error_code === null;
  }
  if (decoding.outcome === 'parsed') return decoding.error_code === null;
  const allowed = adapter === 'codex'
    ? ['not_json', 'wrong_shape', 'catalog_count_mismatch', 'catalog_missing', 'unknown']
    : ['init_missing', 'init_count_mismatch', 'init_invalid', 'unknown'];
  return decoding.outcome === 'invalid' && allowed.includes(decoding.error_code);
}

function validV2ProbeSemantics(evidence) {
  const adapter = evidence.probe.adapter_id;
  const execution = evidence.probe_result.execution;
  const decoding = evidence.probe_result.decoding;
  const catalog = evidence.observations.catalog;
  if (decoding.outcome === 'invalid'
      && (catalog.observed_count !== 0 || catalog.observed_names.length !== 0
        || catalog.observed_managed_entities.length !== 0)) return false;
  if (adapter === 'codex') {
    if (catalog.identity_capability !== 'canonical_path'
        || catalog.observed_managed_entities.some(({ match_status: status }) => status === 'name_only')
        || (decoding.outcome === 'parsed'
          ? typeof catalog.recursion_observed !== 'boolean'
          : catalog.recursion_observed !== 'unverified')
        || catalog.symlink_following_observed !== 'unverified'
        || ![true, 'unverified'].includes(catalog.context_budget_pressure)
        || catalog.description_truncated !== (
          catalog.context_budget_pressure === true ? true : 'unverified'
        )) {
      return false;
    }
  } else if (adapter === 'claude') {
    const expectedCapability = catalog.probe_outcome === 'pass' ? 'name_only' : 'none';
    if (catalog.identity_capability !== expectedCapability
        || catalog.identity_conformance !== 'unverified'
        || [
          catalog.recursion_observed, catalog.symlink_following_observed,
          catalog.description_truncated, catalog.context_budget_pressure,
        ].some((value) => value !== 'unverified')
        || catalog.observed_managed_entities.some((entity) => (
          !catalog.managed_universe.includes(entity.name) || entity.catalog_path !== null
          || entity.canonical_path !== null || entity.entity_id !== null
          || entity.collection_id !== null || entity.match_status !== 'name_only'
        ))) return false;
  } else if (catalog.identity_capability !== 'none'
      || catalog.identity_conformance !== 'unverified'
      || catalog.observed_count !== 0 || catalog.observed_names.length !== 0
      || catalog.observed_managed_entities.length !== 0
      || [
        catalog.recursion_observed, catalog.symlink_following_observed,
        catalog.description_truncated, catalog.context_budget_pressure,
      ].some((value) => value !== 'unverified')) return false;
  if (adapter === 'claude') {
    if (decoding.outcome === 'parsed') {
      if (!NATIVE_RUNTIME_VERSION.test(evidence.probe.runtime_build)) return false;
    } else if (evidence.probe.runtime_build !== 'unobserved') return false;
    const expectedAuth = decoding.outcome === 'parsed' && execution.outcome === 'exit_zero'
      ? 'available'
      : decoding.outcome === 'parsed' && execution.outcome === 'exit_nonzero'
        ? 'post_init_nonzero' : 'blocked';
    if (evidence.probe.auth_state !== expectedAuth) return false;
  }
  let expected;
  if (execution.failure_class === 'not_found') expected = 'unsupported';
  else if (adapter === 'codex') {
    expected = execution.outcome === 'exit_zero' && decoding.outcome === 'parsed' ? 'pass' : 'blocked';
  } else if (adapter === 'claude') {
    expected = ['exit_zero', 'exit_nonzero'].includes(execution.outcome)
      && decoding.outcome === 'parsed' ? 'pass' : 'blocked';
  } else expected = 'blocked';
  return evidence.observations.catalog.probe_outcome === expected;
}

function validObservationEnvelope(value) {
  return exactObjectKeys(value, ['catalog', 'body_access', 'route'])
    && exactObjectKeys(value.body_access, [
      'result', 'requested_skill', 'resolved_skill_path', 'normalized_content_sha256', 'complete_read_observed',
    ])
    && value.body_access.result === 'unverified'
    && value.body_access.requested_skill === null
    && value.body_access.resolved_skill_path === null
    && value.body_access.normalized_content_sha256 === null
    && value.body_access.complete_read_observed === false
    && exactObjectKeys(value.route, ['result', 'requested_gateway', 'routed_member'])
    && value.route.result === 'unverified'
    && value.route.requested_gateway === null
    && value.route.routed_member === null;
}

function validEvidenceMetadata(value, adapter, commandContract) {
  const expectedSource = adapter === 'codex' ? 'native_prompt'
    : adapter === 'claude' ? 'native_init' : 'native_status';
  return exactObjectKeys(value, [
    'source_kind', 'command_argv_redacted', 'stdout_sha256', 'stderr_sha256',
  ])
    && value.source_kind === expectedSource
    && canonicalJson(value.command_argv_redacted) === canonicalJson(commandContract)
    && DIGEST.test(value.stdout_sha256 ?? '') && DIGEST.test(value.stderr_sha256 ?? '');
}

function validEffectivePredicates(value, catalog) {
  return exactObjectKeys(value, [
    'metadata_discoverable', 'policy_conformant', 'body_access_observed', 'route_observed', 'runtime_qualified',
  ])
    && value.metadata_discoverable === catalog.result
    && value.policy_conformant === catalog.policy_conformance
    && value.body_access_observed === false
    && value.route_observed === false
    && value.runtime_qualified === false;
}

export function runtimeEntityId(entity, canonicalPath = entity.skill_file) {
  return sha256(JSON.stringify([
    entity.collection_id, entity.repository_id, entity.resolved_revision, entity.source_path,
    entity.name, entity.tree_digest, canonicalPath,
  ]));
}

function expectedEntityIds(binding) {
  return binding.expected_entities.map((entity) => {
    let canonicalPath = entity.skill_file;
    try { canonicalPath = realpathSync(entity.skill_file); } catch {}
    return runtimeEntityId(entity, canonicalPath);
  }).sort();
}

function validateCatalogSelfConsistency(catalog) {
  const states = new Set(['pass', 'fail', 'blocked', 'unsupported']);
  if (!exactObjectKeys(catalog, [
    'probe_outcome', 'result', 'policy_conformance', 'identity_conformance', 'identity_capability',
    'observed_count', 'observed_names', 'observed_names_digest', 'observed_entities_digest',
    'expected_names', 'managed_universe', 'expected_entity_ids', 'expected_present', 'missing_expected',
    'unexpected_managed', 'missing_expected_entities', 'unexpected_managed_entities',
    'unmatched_managed_entities', 'ambiguous_expected_names', 'wrong_identity',
    'observed_managed_entities', 'recursion_observed', 'symlink_following_observed',
    'description_truncated', 'context_budget_pressure',
  ])
      || !states.has(catalog?.probe_outcome) || !states.has(catalog?.result)
      || !states.has(catalog?.policy_conformance)
      || !['pass', 'fail', 'unverified'].includes(catalog?.identity_conformance)
      || !['canonical_path', 'name_only', 'none'].includes(catalog?.identity_capability)
      || !sortedUniqueStrings(catalog.observed_names, { pattern: RUNTIME_SKILL_NAME })
      || !sortedUniqueStrings(catalog.expected_names, { pattern: RUNTIME_SKILL_NAME })
      || !sortedUniqueStrings(catalog.managed_universe, { pattern: RUNTIME_SKILL_NAME })
      || !sortedUniqueStrings(catalog.expected_entity_ids, { pattern: DIGEST })
      || !sortedUniqueStrings(catalog.expected_present, { pattern: RUNTIME_SKILL_NAME })
      || !sortedUniqueStrings(catalog.missing_expected, { pattern: RUNTIME_SKILL_NAME })
      || !sortedUniqueStrings(catalog.unexpected_managed, { pattern: RUNTIME_SKILL_NAME })
      || !sortedUniqueStrings(catalog.missing_expected_entities, { pattern: DIGEST })
      || !sortedUniqueStrings(catalog.unexpected_managed_entities, { pattern: DIGEST })
      || !sortedUniqueStrings(catalog.unmatched_managed_entities, { pattern: DIGEST })
      || !sortedUniqueStrings(catalog.ambiguous_expected_names, { pattern: RUNTIME_SKILL_NAME })
      || !sortedUniqueStrings(catalog.wrong_identity, { pattern: RUNTIME_SKILL_NAME })
      || !Array.isArray(catalog.observed_managed_entities)
      || catalog.observed_managed_entities.length > MAX_EVIDENCE_ITEMS
      || !catalog.observed_managed_entities.every(validObservedManagedEntity)
      || !Number.isSafeInteger(catalog.observed_count) || catalog.observed_count < 0
      || ![true, false, 'unverified'].includes(catalog.recursion_observed)
      || ![true, false, 'unverified'].includes(catalog.symlink_following_observed)
      || ![true, false, 'unverified'].includes(catalog.description_truncated)
      || ![true, false, 'unverified'].includes(catalog.context_budget_pressure)
      || catalog.observed_count !== catalog.observed_names.length
      || catalog.observed_names_digest !== sha256(JSON.stringify(catalog.observed_names))
      || catalog.observed_entities_digest !== sha256(JSON.stringify(catalog.observed_managed_entities))) {
    fail('invalid_runtime_evidence', 'catalog evidence is internally inconsistent', 'invalid');
  }
  const observed = new Set(catalog.observed_names);
  const managedUniverse = new Set(catalog.managed_universe);
  const observedManagedNames = new Set(catalog.observed_managed_entities.map(({ name }) => name));
  if (catalog.observed_managed_entities.some(({ name }) => !observed.has(name))
      || catalog.observed_names.some((name) => managedUniverse.has(name) && !observedManagedNames.has(name))) {
    fail('invalid_runtime_evidence', 'managed catalog observations are not closed over observed names', 'invalid');
  }
  const expected = new Set(catalog.expected_names);
  const present = catalog.expected_names.filter((name) => observed.has(name));
  const missing = catalog.expected_names.filter((name) => !observed.has(name));
  const unexpected = [...new Set(catalog.observed_managed_entities.map(({ name }) => name))]
    .filter((name) => !expected.has(name)).sort();
  const observedIds = new Set(catalog.observed_managed_entities.map(({ entity_id }) => entity_id).filter(Boolean));
  const expectedIds = new Set(catalog.expected_entity_ids);
  const missingEntities = catalog.identity_capability === 'canonical_path'
    ? [...expectedIds].filter((id) => !observedIds.has(id)).sort() : [];
  const unexpectedEntities = [...observedIds].filter((id) => !expectedIds.has(id)).sort();
  const unmatchedEntities = catalog.observed_managed_entities
    .filter(({ match_status }) => match_status === 'unmatched').map(({ entity_id }) => entity_id).sort();
  const expectedIdentity = catalog.probe_outcome !== 'pass' ? 'unverified'
    : catalog.identity_capability === 'canonical_path'
    ? missingEntities.length === 0 && unexpectedEntities.length === 0 && unmatchedEntities.length === 0 ? 'pass' : 'fail'
    : 'unverified';
  const expectedResult = catalog.probe_outcome === 'pass' && missing.length === 0
    ? 'pass' : catalog.probe_outcome === 'pass' ? 'fail' : catalog.probe_outcome;
  const expectedPolicy = catalog.probe_outcome === 'pass'
    ? missing.length === 0 && unexpected.length === 0 && expectedIdentity !== 'fail'
      && (catalog.identity_capability === 'canonical_path' || catalog.ambiguous_expected_names.length === 0)
      ? 'pass' : 'fail'
    : catalog.probe_outcome;
  if (canonicalJson(present) !== canonicalJson(catalog.expected_present)
      || canonicalJson(missing) !== canonicalJson(catalog.missing_expected)
      || canonicalJson(unexpected) !== canonicalJson(catalog.unexpected_managed)
      || canonicalJson(missingEntities) !== canonicalJson(catalog.missing_expected_entities)
      || canonicalJson(unexpectedEntities) !== canonicalJson(catalog.unexpected_managed_entities)
      || canonicalJson(unmatchedEntities) !== canonicalJson(catalog.unmatched_managed_entities)
      || catalog.identity_conformance !== expectedIdentity
      || catalog.result !== expectedResult
      || catalog.policy_conformance !== expectedPolicy) {
    fail('invalid_runtime_evidence', 'catalog derived fields are inconsistent', 'invalid');
  }
}

function validateCatalogAgainstBinding(evidence, binding) {
  const catalog = evidence.observations.catalog;
  validateCatalogSelfConsistency(catalog);
  if (canonicalJson(catalog.expected_names) !== canonicalJson(binding.expected_names)
      || canonicalJson(catalog.managed_universe) !== canonicalJson(binding.managed_universe)
      || canonicalJson(catalog.expected_entity_ids) !== canonicalJson(expectedEntityIds(binding))) {
    fail('runtime_evidence_binding_mismatch', 'catalog policy inputs do not match current deployment');
  }
  const managedById = new Map(binding.managed_entities.map((entity) => {
    let canonicalPath = entity.skill_file;
    try { canonicalPath = realpathSync(entity.skill_file); } catch {}
    const id = runtimeEntityId(entity, canonicalPath);
    return [id, { ...entity, canonical_path: canonicalPath }];
  }));
  const managedRootFor = (observed) => {
    const candidate = observed.canonical_path ?? observed.catalog_path;
    return typeof candidate === 'string' ? binding.managed_roots.find(({ collection_root }) => (
      candidate === collection_root || candidate.startsWith(`${collection_root}/`)
    )) : null;
  };
  for (const observed of catalog.observed_managed_entities) {
    if (typeof observed?.name !== 'string'
        || !(observed.entity_id === null || DIGEST.test(observed.entity_id ?? ''))
        || !(observed.catalog_path === null || typeof observed.catalog_path === 'string')
        || !(observed.canonical_path === null || typeof observed.canonical_path === 'string')
        || !['matched', 'unmatched', 'name_only'].includes(observed.match_status)) {
      fail('invalid_runtime_evidence', 'observed managed entity is invalid', 'invalid');
    }
    if (observed.match_status === 'matched') {
      const entity = managedById.get(observed.entity_id);
      if (!entity || entity.name !== observed.name || entity.collection_id !== observed.collection_id
          || entity.canonical_path !== observed.canonical_path) {
        fail('runtime_evidence_binding_mismatch', 'observed entity identity does not match current deployment');
      }
    } else if (observed.match_status === 'unmatched') {
      const root = managedRootFor(observed);
      const expectedUnmatched = sha256(JSON.stringify([
        'unmatched-managed-runtime-entity', observed.name,
        observed.canonical_path ?? observed.catalog_path, root?.collection_id ?? null,
      ]));
      if (observed.entity_id !== expectedUnmatched || observed.collection_id !== (root?.collection_id ?? null)) {
        fail('runtime_evidence_binding_mismatch', 'unmatched managed entity identity is invalid');
      }
    } else if (observed.entity_id !== null || observed.collection_id !== null) {
      fail('runtime_evidence_binding_mismatch', 'name-only observation contains a forged identity');
    }
  }
  const observedIds = new Set(catalog.observed_managed_entities.map(({ entity_id }) => entity_id).filter(Boolean));
  const expectedIds = new Set(catalog.expected_entity_ids);
  const missingEntities = catalog.identity_capability === 'canonical_path'
    ? [...expectedIds].filter((id) => !observedIds.has(id)).sort() : [];
  const unexpectedEntities = [...observedIds].filter((id) => !expectedIds.has(id)).sort();
  const unmatchedEntities = catalog.observed_managed_entities
    .filter(({ match_status }) => match_status === 'unmatched').map(({ entity_id }) => entity_id).sort();
  const counts = new Map();
  for (const entity of binding.expected_entities) counts.set(entity.name, (counts.get(entity.name) ?? 0) + 1);
  const ambiguous = [...counts].filter(([, count]) => count > 1).map(([name]) => name).sort();
  const expectedIdentity = catalog.probe_outcome !== 'pass' ? 'unverified'
    : catalog.identity_capability === 'canonical_path'
    ? missingEntities.length === 0 && unexpectedEntities.length === 0 && unmatchedEntities.length === 0 ? 'pass' : 'fail'
    : 'unverified';
  const expectedPolicy = catalog.probe_outcome === 'pass'
    ? catalog.missing_expected.length === 0 && catalog.unexpected_managed.length === 0
      && expectedIdentity !== 'fail' && (catalog.identity_capability === 'canonical_path' || ambiguous.length === 0)
      ? 'pass' : 'fail'
    : catalog.probe_outcome;
  if (canonicalJson(catalog.missing_expected_entities) !== canonicalJson(missingEntities)
      || canonicalJson(catalog.unexpected_managed_entities) !== canonicalJson(unexpectedEntities)
      || canonicalJson(catalog.unmatched_managed_entities) !== canonicalJson(unmatchedEntities)
      || canonicalJson(catalog.ambiguous_expected_names) !== canonicalJson(ambiguous)
      || catalog.identity_conformance !== expectedIdentity
      || catalog.policy_conformance !== expectedPolicy) {
    fail('runtime_evidence_binding_mismatch', 'catalog semantics do not match current deployment');
  }
}

export function validateRuntimeEvidence(evidence) {
  const catalog = evidence?.observations?.catalog;
  const adapter = evidence?.probe?.adapter_id;
  const schema = evidence?.schema_version;
  const legacy = schema === LEGACY_RUNTIME_EVIDENCE_SCHEMA;
  const current = schema === RUNTIME_SCHEMAS.evidence;
  const rootKeys = [
    'schema_version', 'evidence_id', 'observed_at', 'probe', 'artifact_binding', 'deployment_binding',
    'observations', 'evidence', 'limitations', 'effective_predicates',
  ];
  if (current) rootKeys.splice(rootKeys.indexOf('limitations'), 0, 'probe_result');
  if (!exactObjectKeys(evidence, rootKeys)
      || (!legacy && !current)
      || Buffer.byteLength(canonicalJson(evidence)) > MAX_EVIDENCE_BYTES
      || !validTimestamp(evidence.observed_at)
      || !validProbe(evidence.probe, schema)
      || !validArtifactBinding(evidence.artifact_binding)
      || !validDeploymentBinding(evidence.deployment_binding, adapter)
      || !validObservationEnvelope(evidence.observations)
      || !validEvidenceMetadata(evidence.evidence, adapter, evidence.probe.command_contract)
      || !validLimitations(adapter, evidence.limitations, schema)
      || (current && (!validProbeResult(adapter, evidence.probe_result)
        || !validV2ProbeSemantics(evidence)))
      || !validEffectivePredicates(evidence.effective_predicates, catalog)
      || !DIGEST.test(evidence.evidence_id ?? '')
      || computeEvidenceId(evidence) !== evidence.evidence_id) {
    fail('invalid_runtime_evidence', 'runtime evidence schema or digest is invalid', 'invalid');
  }
  validateCatalogSelfConsistency(catalog);
  return evidence;
}

function evidenceRoot(home) {
  return join(home, 'Library', 'Application Support', 'skills-refiner', 'runtime-evidence');
}

function safeMkdir(path, home) {
  assertUnderHome(home, path);
  assertNoSymlinkComponents(home, dirname(path));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(home, path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid()
      || (stat.mode & 0o077) !== 0) fail('unsafe_control_path', path);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function acquireRecordLock({ home, adapterRoot, lockPath, evidence }) {
  const create = () => {
    const descriptor = openSync(lockPath, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify({
      schema_version: 'skills-refiner.runtime-record-lock.v1',
      adapter: evidence.probe.adapter_id,
      evidence_id: evidence.evidence_id,
      pid: process.pid,
      created_at: new Date().toISOString(),
    })}\n`);
    fsyncSync(descriptor);
    const status = fstatSync(descriptor, { bigint: true });
    const identity = { device: status.dev.toString(), inode: status.ino.toString() };
    return { descriptor, identity };
  };
  try { return create(); } catch (error) {
    if (error.code !== 'EEXIST') fail('runtime_record_lock_unavailable', error.message);
  }
  const staleSnapshot = privateFileSnapshot(home, lockPath, 'invalid_runtime_record_lock');
  let stale;
  try { stale = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(staleSnapshot.bytes)); } catch {
    fail('invalid_runtime_record_lock', 'runtime record lock is not valid UTF-8 JSON', 'recovery_required');
  }
  if (stale.schema_version !== 'skills-refiner.runtime-record-lock.v1'
      || stale.adapter !== evidence.probe.adapter_id || !DIGEST.test(stale.evidence_id ?? '')
      || Number.isNaN(Date.parse(stale.created_at)) || !Number.isInteger(stale.pid)) {
    fail('invalid_runtime_record_lock', 'runtime record lock cannot be safely attributed', 'recovery_required');
  }
  if (processAlive(stale.pid)) fail('runtime_record_lock_unavailable', 'runtime evidence recorder is active');
  const identity = inspectCollectionEntry({ home, path: lockPath });
  if (identity.device !== staleSnapshot.device || identity.inode !== staleSnapshot.inode) {
    fail('invalid_runtime_record_lock', 'runtime record lock changed while being inspected', 'recovery_required');
  }
  const staleRoot = join(adapterRoot, 'stale-locks');
  safeMkdir(staleRoot, home);
  const destination = join(staleRoot, `${identity.device}-${identity.inode}.json`);
  if (existsSync(destination)) fail('runtime_record_stale_lock_conflict', destination, 'recovery_required');
  moveCollectionEntryExclusive({
    home, source: lockPath, destination,
    expectedManifest: identity.manifest_hash, expectedDevice: identity.device, expectedInode: identity.inode,
  });
  try { return create(); } catch (error) { fail('runtime_record_lock_unavailable', error.message); }
}

function releaseRecordLock({ home, adapterRoot, lockPath, lockIdentity, evidenceId }) {
  const releasedRoot = join(adapterRoot, 'released-locks');
  safeMkdir(releasedRoot, home);
  const destination = join(
    releasedRoot,
    `${evidenceId.slice('sha256:'.length)}-${lockIdentity.device}-${lockIdentity.inode}.json`,
  );
  try {
    moveCollectionEntryExclusive({
      home,
      source: lockPath,
      destination,
      expectedDevice: lockIdentity.device,
      expectedInode: lockIdentity.inode,
    });
  } catch (error) {
    fail('runtime_record_lock_release_conflict', error.message, 'recovery_required');
  }
}

function collectionEvidenceBinding(collections) {
  return collections.map((collection) => ({
    collection_id: collection.collection_id,
    operation_id: collection.operation_id,
    resolved_revision: collection.resolved_revision,
    artifact_digest: collection.artifact_digest,
    index_digest: collection.index_digest,
    member_set_digest: collection.member_set_digest,
    root_tree_digest: collection.root_tree_digest,
    root_inventory_digest: collection.root_inventory_digest,
  }));
}

function sameRuntimeExecutable(left, right) {
  return validRuntimeExecutableIdentity(left) && validRuntimeExecutableIdentity(right)
    && canonicalJson(left) === canonicalJson(right);
}

function runtimeProbeReason(evidence) {
  if (evidence.schema_version === RUNTIME_SCHEMAS.evidence) {
    const { execution, decoding } = evidence.probe_result;
    const failureReasons = {
      permission_denied: 'probe_execution_permission_denied',
      not_found: 'probe_executable_not_found',
      timeout: 'probe_execution_timeout',
      output_limit: 'probe_output_limit',
    };
    if (failureReasons[execution.failure_class]) return failureReasons[execution.failure_class];
    if (execution.outcome === 'exit_nonzero') return 'probe_exit_nonzero';
    if (execution.outcome === 'signaled') return 'probe_signaled';
    if (execution.outcome === 'spawn_error') return 'probe_spawn_error';
    if (decoding.outcome === 'invalid') return `probe_decode_${decoding.error_code}`;
  } else {
    const parseError = evidence.limitations.find((item) => item.startsWith('parse_error:'));
    if (parseError?.includes('not JSON')) return 'probe_decode_not_json';
    if (parseError?.includes('must be an array')) return 'probe_decode_wrong_shape';
    if (parseError?.includes('exactly one Codex skills catalog')) return 'probe_decode_catalog_count_mismatch';
    if (parseError?.includes('catalog was not found')) return 'probe_decode_catalog_missing';
    if (parseError?.includes('system.init.skills was not found')) return 'probe_decode_init_missing';
  }
  return 'probe_blocked';
}

export function recordRuntimeEvidence({
  home,
  evidence,
  confirmation,
  policyPath = DEFAULT_RUNTIME_POLICY,
  executableResolver = resolveRuntimeAdapterExecutable,
  beforePointerPublish = null,
  beforeLockRelease = null,
}) {
  validateRuntimeEvidence(evidence);
  if (confirmation !== evidence.evidence_id) fail('confirmation_mismatch', 'confirmation must equal evidence_id', 'invalid');
  const current = collectRuntimeBinding({ home, adapter: evidence.probe.adapter_id, policyPath });
  const currentExecutable = executableResolver(evidence.probe.adapter_id);
  validateCatalogAgainstBinding(evidence, current);
  if (canonicalJson(evidence.deployment_binding) !== canonicalJson(current.deployment)
      || canonicalJson(evidence.artifact_binding.collections) !== canonicalJson(collectionEvidenceBinding(current.collections))
      || !sameRuntimeExecutable(evidence.probe.executable_identity, currentExecutable)
      || evidence.probe.adapter_version !== currentRuntimeAdapterVersion(evidence.probe.adapter_id, currentExecutable)
      || canonicalJson(evidence.probe.host_environment) !== canonicalJson(currentHostEnvironment())
      || Date.parse(evidence.observed_at) - Date.now() > MAX_CLOCK_SKEW_MS
      || Date.now() - Date.parse(evidence.observed_at) > current.policy.evidence_max_age_hours * 60 * 60 * 1000) {
    fail('runtime_evidence_stale', 'deployment or policy changed after probe');
  }
  const normalizedHome = realpathSync(resolve(home));
  const adapterRoot = join(evidenceRoot(normalizedHome), evidence.probe.adapter_id);
  safeMkdir(adapterRoot, normalizedHome);
  const immutablePath = join(adapterRoot, `${evidence.evidence_id.slice('sha256:'.length)}.json`);
  const pointerPath = join(adapterRoot, 'current.json');
  const lockPath = join(adapterRoot, '.record.lock');
  const bytes = `${JSON.stringify(evidence, null, 2)}\n`;
  const evidenceBytes = Buffer.from(bytes);
  const acquired = acquireRecordLock({ home: normalizedHome, adapterRoot, lockPath, evidence });
  const lock = acquired.descriptor;
  const lockIdentity = acquired.identity;
  try {
    let immutable = privateFileSnapshot(
      normalizedHome, immutablePath, 'evidence_identity_conflict', { allowMissing: true },
    );
    if (immutable) {
      if (!immutable.bytes.equals(evidenceBytes)) fail('evidence_identity_conflict', immutablePath);
    } else {
      try {
        createCollectionFileExclusive({
          home: normalizedHome,
          path: immutablePath,
          targetDigest: sha256(bytes),
          bytes,
        });
      } catch (error) {
        fail('evidence_identity_conflict', error.message, 'recovery_required');
      }
      immutable = privateFileSnapshot(normalizedHome, immutablePath, 'evidence_identity_conflict');
      if (!immutable.bytes.equals(evidenceBytes)) fail('evidence_identity_conflict', immutablePath, 'recovery_required');
    }
    const pointerBefore = privateFileSnapshot(
      normalizedHome, pointerPath, 'runtime_record_pointer_conflict', { allowMissing: true },
    );
    const immutableAfter = privateFileSnapshot(normalizedHome, immutablePath, 'evidence_identity_conflict');
    if (!immutableAfter.bytes.equals(evidenceBytes)
        || immutableAfter.device !== immutable.device || immutableAfter.inode !== immutable.inode) {
      fail('evidence_identity_conflict', 'immutable evidence identity changed before pointer publication', 'recovery_required');
    }
    if (beforePointerPublish) beforePointerPublish({ pointerPath });
    try {
      if (pointerBefore) {
        replaceCollectionFileCas({
          home: normalizedHome,
          path: pointerPath,
          expectedDigest: pointerBefore.digest,
          targetDigest: sha256(bytes),
          bytes,
        });
      } else {
        createCollectionFileExclusive({
          home: normalizedHome,
          path: pointerPath,
          targetDigest: sha256(bytes),
          bytes,
        });
      }
    } catch (error) {
      fail('runtime_record_pointer_conflict', error.message, 'recovery_required');
    }
    const pointerAfter = privateFileSnapshot(normalizedHome, pointerPath, 'runtime_record_pointer_conflict');
    if (!pointerAfter.bytes.equals(evidenceBytes)) {
      fail('runtime_record_pointer_conflict', 'current evidence pointer postcondition failed', 'recovery_required');
    }
  } finally {
    try { closeSync(lock); } catch {}
    if (beforeLockRelease) beforeLockRelease({ lockPath, lockIdentity: { ...lockIdentity } });
    releaseRecordLock({
      home: normalizedHome,
      adapterRoot,
      lockPath,
      lockIdentity,
      evidenceId: evidence.evidence_id,
    });
  }
  return {
    schema_version: 'skills-refiner.runtime-record.v1',
    status: 'RECORDED',
    adapter: evidence.probe.adapter_id,
    evidence_id: evidence.evidence_id,
    immutable_path: immutablePath,
    current_path: pointerPath,
  };
}

export function runtimeStatus({
  home,
  policyPath = DEFAULT_RUNTIME_POLICY,
  executableResolver = resolveRuntimeAdapterExecutable,
  recordSnapshotHook = null,
}) {
  const normalizedHome = realpathSync(resolve(home));
  const adapters = {};
  for (const adapter of RUNTIME_ADAPTERS) {
    try {
      const current = collectRuntimeBinding({ home: normalizedHome, adapter, policyPath });
      const path = join(evidenceRoot(normalizedHome), adapter, 'current.json');
      const snapshot = privateFileSnapshot(normalizedHome, path, 'invalid_runtime_record', {
        allowMissing: true,
        afterRead: recordSnapshotHook ? () => recordSnapshotHook({ adapter, path }) : null,
      });
      if (!snapshot) {
        adapters[adapter] = {
          status: 'UNVERIFIED', evidence_id: null, reason: 'no_recorded_evidence',
          catalog: null, body_access: null, route: null, context: null, effective_predicates: null,
        };
        continue;
      }
      let decoded;
      try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes)); } catch {
        fail('invalid_runtime_record', 'current runtime evidence is not valid UTF-8 JSON', 'invalid');
      }
      const evidence = validateRuntimeEvidence(decoded);
      const immutablePath = join(
        evidenceRoot(normalizedHome), adapter, `${evidence.evidence_id.slice('sha256:'.length)}.json`,
      );
      const immutable = privateFileSnapshot(normalizedHome, immutablePath, 'invalid_runtime_record');
      if (!immutable.bytes.equals(snapshot.bytes)) {
        fail('invalid_runtime_record', 'current evidence does not match its immutable object', 'invalid');
      }
      const staleReasons = [];
      if (evidence.deployment_binding.policy_digest !== current.deployment.policy_digest) staleReasons.push('policy_changed');
      if (evidence.deployment_binding.root_inventory_digest !== current.deployment.root_inventory_digest) staleReasons.push('root_inventory_changed');
      if (evidence.deployment_binding.collection_control_digest !== current.deployment.collection_control_digest) staleReasons.push('collection_control_changed');
      if (evidence.deployment_binding.runtime_config_digest !== current.deployment.runtime_config_digest) staleReasons.push('runtime_config_changed');
      if (evidence.deployment_binding.profile_id !== current.deployment.profile_id
          || evidence.deployment_binding.policy_path !== current.deployment.policy_path
          || canonicalJson(evidence.deployment_binding.discovery_roots) !== canonicalJson(current.deployment.discovery_roots)) {
        staleReasons.push('deployment_metadata_changed');
      }
      if (canonicalJson(evidence.artifact_binding.collections) !== canonicalJson(collectionEvidenceBinding(current.collections))) staleReasons.push('collection_binding_changed');
      if (canonicalJson(evidence.probe.host_environment) !== canonicalJson(currentHostEnvironment())) staleReasons.push('host_environment_changed');
      if (Date.parse(evidence.observed_at) - Date.now() > MAX_CLOCK_SKEW_MS) staleReasons.push('clock_skew_future');
      if (Date.now() - Date.parse(evidence.observed_at) > current.policy.evidence_max_age_hours * 60 * 60 * 1000) staleReasons.push('evidence_expired');
      const currentExecutable = executableResolver(adapter);
      if (!sameRuntimeExecutable(evidence.probe.executable_identity, currentExecutable)) {
        staleReasons.push('executable_changed');
      } else if (evidence.probe.adapter_version !== currentRuntimeAdapterVersion(adapter, currentExecutable)) {
        staleReasons.push('adapter_version_changed');
      }
      const stale = staleReasons.length > 0;
      if (!stale) validateCatalogAgainstBinding(evidence, current);
      const catalogStatus = evidence.observations.catalog.policy_conformance === 'fail' ? 'POLICY_DRIFT'
        : evidence.observations.catalog.result === 'pass' ? 'CATALOG_ONLY'
          : String(evidence.observations.catalog.result).toUpperCase();
      adapters[adapter] = {
        status: stale ? 'STALE' : catalogStatus,
        evidence_id: evidence.evidence_id,
        observed_at: evidence.observed_at,
        catalog: evidence.observations.catalog,
        body_access: evidence.observations.body_access,
        route: evidence.observations.route,
        context: {
          description_truncated: evidence.observations.catalog.description_truncated,
          context_budget_pressure: evidence.observations.catalog.context_budget_pressure,
        },
        effective_predicates: evidence.effective_predicates,
        reason: stale ? staleReasons.join(',')
          : ['BLOCKED', 'UNSUPPORTED'].includes(catalogStatus) ? runtimeProbeReason(evidence) : null,
      };
    } catch (error) {
      adapters[adapter] = {
        status: ['collection_member_drift', 'collection_member_missing', 'collection_root_drift',
          'collection_resource_drift', 'invalid_collection_index', 'collection_missing', 'unsafe_collection',
          'runtime_config_drift', 'collection_control_drift'].includes(error.code)
          ? 'DEPLOYMENT_DRIFT' : 'INVALID',
        evidence_id: null,
        reason: error.code ?? 'invalid_runtime_record',
        control_layer: error.control_layer ?? null,
        catalog: null,
        body_access: null,
        route: null,
        context: null,
        effective_predicates: null,
      };
    }
  }
  return { schema_version: RUNTIME_SCHEMAS.status, profile_id: 'default', adapters };
}
