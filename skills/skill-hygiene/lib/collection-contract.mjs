import { isAbsolute, join, relative, sep } from 'node:path';

import { canonicalJson, sha256Json, validateSha256 } from './cleanup-contract.mjs';

export const COLLECTION_SCHEMAS = Object.freeze({
  plan: 'skills-refiner.collection.plan.v1',
  index: 'skills-refiner.collection.index.v1',
  operation: 'skills-refiner.collection.operation.v1',
});

const PLAN_KEYS = new Set([
  'schema_version', 'collection_id', 'home', 'source', 'receipt', 'legacy',
  'projections', 'target', 'control', 'controller', 'agent_roots', 'created_at', 'plan_hash',
]);
const INDEX_KEYS = new Set([
  'schema_version', 'collection_id', 'source', 'artifact_digest',
  'public_registry_digest', 'members', 'gateway', 'receipt_snapshot_digest',
  'profile_matrix_digest',
  'plan_created_at', 'operation_id',
]);
const OPERATION_KEYS = new Set([
  'schema_version', 'collection_id', 'operation_id', 'plan_hash', 'state',
  'updated_at', 'mutation_occurred', 'error_code',
]);
const MEMBER_NAME = /^pc-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const OPERATION_ID = /^prodcraft-[0-9a-f]{12}$/u;
const SAFE_RELATIVE = /^[a-zA-Z0-9._/-]+$/u;
const STATES = new Set([
  'PLANNED', 'PREPARED', 'APPLYING', 'COMMITTED', 'ROLLING_BACK',
  'ROLLED_BACK', 'REPAIRING', 'RESTORING', 'RESTORED', 'RECOVERY_REQUIRED',
]);

export class CollectionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CollectionContractError';
  }
}

function fail(message) {
  throw new CollectionContractError(message);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object`);
}

function exactKeys(value, keys, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${path} contains an unknown key: ${key}`);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${path} is missing ${key}`);
}

function string(value, path) {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${path} must be a safe non-empty string`);
  }
}

function absolutePath(value, path, home = null) {
  string(value, path);
  if (!isAbsolute(value) || value.includes('/../') || value.endsWith('/..') || value.includes('/./')) {
    fail(`${path} must be an absolute normalized path`);
  }
  if (home !== null) {
    const rel = relative(home, value);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`${path} must be contained in home`);
  }
}

function timestamp(value, path) {
  string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) fail(`${path} must be UTC ISO-8601`);
}

function digest(value, path) {
  try { validateSha256(value, path); } catch { fail(`${path} must be a sha256 digest`); }
}

function validateMember(member, path, sourceRelative = true) {
  const keys = new Set(['name', 'relative_path', 'tree_digest']);
  exactKeys(member, keys, path);
  if (!MEMBER_NAME.test(member.name)) fail(`${path} member name must use the pc-* namespace`);
  string(member.relative_path, `${path}.relative_path`);
  if (!SAFE_RELATIVE.test(member.relative_path) || isAbsolute(member.relative_path)
      || member.relative_path.split('/').includes('..')) fail(`${path}.relative_path is unsafe`);
  if (!sourceRelative && member.relative_path.includes('/')) fail(`${path}.relative_path must be a direct child`);
  digest(member.tree_digest, `${path}.tree_digest`);
}

export function computeCollectionPlanHash(plan) {
  object(plan, 'plan');
  canonicalJson(plan);
  const { plan_hash: _planHash, ...identity } = plan;
  return sha256Json(identity);
}

export function validateCollectionPlan(plan) {
  exactKeys(plan, PLAN_KEYS, 'plan');
  if (plan.schema_version !== COLLECTION_SCHEMAS.plan || plan.collection_id !== 'prodcraft') fail('plan identity is invalid');
  absolutePath(plan.home, 'plan.home');
  timestamp(plan.created_at, 'plan.created_at');

  exactKeys(plan.source, new Set(['provider', 'repository_id', 'revision', 'root', 'tree_digest', 'registry_digest', 'curated_index_digest', 'reference_graph_digest', 'members']), 'plan.source');
  if (plan.source.provider !== 'github' || plan.source.repository_id !== 'yknothing/prodcraft') fail('plan.source authority is invalid');
  if (!REVISION.test(plan.source.revision)) fail('plan.source.revision must be a full commit');
  absolutePath(plan.source.root, 'plan.source.root');
  for (const field of ['tree_digest', 'registry_digest', 'curated_index_digest', 'reference_graph_digest']) digest(plan.source[field], `plan.source.${field}`);
  if (!Array.isArray(plan.source.members) || plan.source.members.length === 0) fail('plan.source.members must be non-empty');
  plan.source.members.forEach((member, index) => validateMember(member, `plan.source.members[${index}]`));
  if (new Set(plan.source.members.map(({ name }) => name)).size !== plan.source.members.length) fail('plan.source.members contains duplicate names');

  exactKeys(plan.receipt, new Set(['path', 'digest', 'entries_digest']), 'plan.receipt');
  absolutePath(plan.receipt.path, 'plan.receipt.path', plan.home);
  digest(plan.receipt.digest, 'plan.receipt.digest');
  digest(plan.receipt.entries_digest, 'plan.receipt.entries_digest');

  if (!Array.isArray(plan.legacy)) fail('plan.legacy must be an array');
  if (plan.legacy.length !== 46) fail('plan.legacy must contain the exact 46-entry migration set');
  const legacyNames = new Set(plan.legacy.map(({ name }) => name));
  if (legacyNames.size !== 46) fail('plan.legacy contains duplicate names');
  for (const [index, entry] of plan.legacy.entries()) {
    exactKeys(entry, new Set(['name', 'path', 'kind', 'tree_digest', 'native_manifest', 'security_metadata_hash', 'receipt_evidence_digest', 'receipt', 'disposition', 'successor']), `plan.legacy[${index}]`);
    string(entry.name, `plan.legacy[${index}].name`);
    absolutePath(entry.path, `plan.legacy[${index}].path`, plan.home);
    if (entry.path !== join(plan.home, '.agents/skills', entry.name)) fail(`plan.legacy[${index}].path does not match its name`);
    if (entry.kind !== 'directory') fail(`plan.legacy[${index}].kind is invalid`);
    digest(entry.tree_digest, `plan.legacy[${index}].tree_digest`);
    digest(entry.native_manifest, `plan.legacy[${index}].native_manifest`);
    digest(entry.security_metadata_hash, `plan.legacy[${index}].security_metadata_hash`);
    digest(entry.receipt_evidence_digest, `plan.legacy[${index}].receipt_evidence_digest`);
    exactKeys(entry.receipt, new Set(['source', 'source_type', 'source_url', 'skill_path', 'skill_folder_hash', 'installed_at', 'updated_at', 'resolved_revision']), `plan.legacy[${index}].receipt`);
    if (entry.receipt.source !== 'yknothing/prodcraft' || entry.receipt.source_type !== 'github'
        || entry.receipt.source_url !== 'https://github.com/yknothing/prodcraft.git') fail(`plan.legacy[${index}].receipt authority is invalid`);
    string(entry.receipt.skill_path, `plan.legacy[${index}].receipt.skill_path`);
    if (!REVISION.test(entry.receipt.skill_folder_hash)) fail(`plan.legacy[${index}].receipt.skill_folder_hash is invalid`);
    timestamp(entry.receipt.installed_at, `plan.legacy[${index}].receipt.installed_at`);
    timestamp(entry.receipt.updated_at, `plan.legacy[${index}].receipt.updated_at`);
    if (entry.receipt.resolved_revision !== null) fail(`plan.legacy[${index}].receipt.resolved_revision must be null for unresolved legacy receipts`);
    if (!['replaced', 'retired_by_owner'].includes(entry.disposition)) fail(`plan.legacy[${index}].disposition is invalid`);
    if (entry.disposition === 'replaced' && entry.successor !== `pc-${entry.name}`) fail(`plan.legacy[${index}].successor is invalid`);
    if (entry.disposition === 'retired_by_owner' && entry.successor !== null) fail(`plan.legacy[${index}].retired successor must be null`);
    if (entry.successor !== null && !plan.source.members.some(({ name }) => name === entry.successor)) fail(`plan.legacy[${index}].successor is absent from source members`);
    if (!entry.receipt.skill_path.endsWith(`/${entry.name}/SKILL.md`)) fail(`plan.legacy[${index}].receipt path does not match its name`);
  }
  if (plan.legacy.filter(({ disposition }) => disposition === 'replaced').length !== 39
      || plan.legacy.filter(({ disposition }) => disposition === 'retired_by_owner').length !== 7) fail('plan.legacy disposition counts are invalid');
  if (plan.legacy.find(({ name }) => name === 'prodcraft')?.successor !== 'pc-prodcraft') fail('plan.legacy prodcraft gateway disposition is invalid');

  if (!Array.isArray(plan.projections)) fail('plan.projections must be an array');
  const projectionPaths = new Set();
  for (const [index, link] of plan.projections.entries()) {
    exactKeys(link, new Set(['agent', 'root', 'name', 'path', 'kind', 'raw_target', 'target_digest', 'native_manifest', 'security_metadata_hash']), `plan.projections[${index}]`);
    string(link.agent, `plan.projections[${index}].agent`);
    absolutePath(link.root, `plan.projections[${index}].root`, plan.home);
    absolutePath(link.path, `plan.projections[${index}].path`, plan.home);
    if (link.path !== join(link.root, link.name)) fail(`plan.projections[${index}].path does not match root/name`);
    if (!legacyNames.has(link.name)) fail(`plan.projections[${index}].name is not in the legacy set`);
    if (projectionPaths.has(link.path)) fail(`plan.projections[${index}].path is duplicated`);
    projectionPaths.add(link.path);
    if (link.kind !== 'symlink') fail(`plan.projections[${index}].kind is invalid`);
    string(link.name, `plan.projections[${index}].name`);
    string(link.raw_target, `plan.projections[${index}].raw_target`);
    digest(link.target_digest, `plan.projections[${index}].target_digest`);
    digest(link.native_manifest, `plan.projections[${index}].native_manifest`);
    digest(link.security_metadata_hash, `plan.projections[${index}].security_metadata_hash`);
  }

  exactKeys(plan.target, new Set(['collection_root', 'gateway_projection', 'gateway_raw_target', 'agent_gateway_raw_target']), 'plan.target');
  absolutePath(plan.target.collection_root, 'plan.target.collection_root', plan.home);
  absolutePath(plan.target.gateway_projection, 'plan.target.gateway_projection', plan.home);
  string(plan.target.gateway_raw_target, 'plan.target.gateway_raw_target');
  string(plan.target.agent_gateway_raw_target, 'plan.target.agent_gateway_raw_target');
  if (plan.target.collection_root !== join(plan.home, '.agents/skills/prodcraft')
      || plan.target.gateway_projection !== join(plan.home, '.agents/skills/pc-prodcraft')
      || plan.target.gateway_raw_target !== 'prodcraft/pc-prodcraft'
      || plan.target.agent_gateway_raw_target !== '../../.agents/skills/pc-prodcraft') fail('plan.target is not the fixed ProdCraft topology');

  exactKeys(plan.control, new Set(['root', 'quarantine_root', 'recovery_root']), 'plan.control');
  absolutePath(plan.control.root, 'plan.control.root', plan.home);
  absolutePath(plan.control.quarantine_root, 'plan.control.quarantine_root', plan.home);
  absolutePath(plan.control.recovery_root, 'plan.control.recovery_root', plan.home);
  if (plan.control.root !== join(plan.home, '.agents/skill-control/collections/prodcraft')
      || plan.control.quarantine_root !== join(plan.home, '.agents/skills-quarantine/collections')
      || plan.control.recovery_root !== join(plan.home, 'Library/Application Support/skills-refiner/recovery')) fail('plan.control is not the fixed ProdCraft topology');

  exactKeys(plan.controller, new Set(['adapter', 'node_major', 'bundle_digest', 'helper_binary_digest', 'helper_source_digest', 'architecture', 'compiler_path', 'compiler_version']), 'plan.controller');
  if (plan.controller.adapter !== 'macos-native.v1' || plan.controller.node_major !== 24) fail('plan.controller runtime is invalid');
  digest(plan.controller.bundle_digest, 'plan.controller.bundle_digest');
  digest(plan.controller.helper_binary_digest, 'plan.controller.helper_binary_digest');
  digest(plan.controller.helper_source_digest, 'plan.controller.helper_source_digest');
  string(plan.controller.architecture, 'plan.controller.architecture');
  absolutePath(plan.controller.compiler_path, 'plan.controller.compiler_path');
  string(plan.controller.compiler_version, 'plan.controller.compiler_version');

  if (!Array.isArray(plan.agent_roots)) fail('plan.agent_roots must be an array');
  const agents = new Set();
  const roots = new Set();
  for (const [index, root] of plan.agent_roots.entries()) {
    exactKeys(root, new Set(['agent', 'root', 'profile', 'qualification']), `plan.agent_roots[${index}]`);
    string(root.agent, `plan.agent_roots[${index}].agent`);
    absolutePath(root.root, `plan.agent_roots[${index}].root`, plan.home);
    if (root.profile !== 'gateway_projection') fail(`plan.agent_roots[${index}].profile is invalid`);
    if (root.qualification !== 'filesystem_only') fail(`plan.agent_roots[${index}].qualification is invalid`);
    if (agents.has(root.agent) || roots.has(root.root)) fail(`plan.agent_roots[${index}] duplicates an agent or root`);
    agents.add(root.agent);
    roots.add(root.root);
    if (!plan.projections.some((link) => link.agent === root.agent && link.root === root.root)) fail(`plan.agent_roots[${index}] has no observed projections`);
  }
  for (const [index, link] of plan.projections.entries()) {
    if (!plan.agent_roots.some((root) => root.agent === link.agent && root.root === link.root)) fail(`plan.projections[${index}] is outside the agent root matrix`);
    const legacy = plan.legacy.find(({ name }) => name === link.name);
    if (link.target_digest !== legacy.tree_digest) fail(`plan.projections[${index}].target digest does not match legacy identity`);
  }
  digest(plan.plan_hash, 'plan.plan_hash');
  if (computeCollectionPlanHash(plan) !== plan.plan_hash) fail('plan.plan_hash does not match content');
  return plan;
}

export function buildCollectionPlan(input) {
  const plan = { schema_version: COLLECTION_SCHEMAS.plan, ...structuredClone(input), plan_hash: `sha256:${'0'.repeat(64)}` };
  plan.plan_hash = computeCollectionPlanHash(plan);
  return validateCollectionPlan(plan);
}

export function validateCollectionIndex(index) {
  exactKeys(index, INDEX_KEYS, 'index');
  if (index.schema_version !== COLLECTION_SCHEMAS.index || index.collection_id !== 'prodcraft') fail('index identity is invalid');
  exactKeys(index.source, new Set(['provider', 'repository_id', 'resolved_revision', 'tree_digest']), 'index.source');
  if (index.source.provider !== 'github' || index.source.repository_id !== 'yknothing/prodcraft' || !REVISION.test(index.source.resolved_revision)) fail('index.source is invalid');
  digest(index.source.tree_digest, 'index.source.tree_digest');
  digest(index.artifact_digest, 'index.artifact_digest');
  digest(index.public_registry_digest, 'index.public_registry_digest');
  digest(index.receipt_snapshot_digest, 'index.receipt_snapshot_digest');
  digest(index.profile_matrix_digest, 'index.profile_matrix_digest');
  if (!Array.isArray(index.members) || index.members.length === 0) fail('index.members must be non-empty');
  index.members.forEach((member, position) => validateMember(member, `index.members[${position}]`, false));
  exactKeys(index.gateway, new Set(['name', 'locator_digest']), 'index.gateway');
  if (index.gateway.name !== 'pc-prodcraft') fail('index.gateway.name is invalid');
  digest(index.gateway.locator_digest, 'index.gateway.locator_digest');
  timestamp(index.plan_created_at, 'index.plan_created_at');
  if (!OPERATION_ID.test(index.operation_id)) fail('index.operation_id is invalid');
  return index;
}

export function validateOperationRecord(operation) {
  exactKeys(operation, OPERATION_KEYS, 'operation');
  if (operation.schema_version !== COLLECTION_SCHEMAS.operation || operation.collection_id !== 'prodcraft') fail('operation identity is invalid');
  if (!OPERATION_ID.test(operation.operation_id)) fail('operation.operation_id is invalid');
  digest(operation.plan_hash, 'operation.plan_hash');
  if (!STATES.has(operation.state)) fail('operation.state is invalid');
  timestamp(operation.updated_at, 'operation.updated_at');
  if (typeof operation.mutation_occurred !== 'boolean') fail('operation.mutation_occurred must be boolean');
  if (operation.error_code !== null) string(operation.error_code, 'operation.error_code');
  return operation;
}
