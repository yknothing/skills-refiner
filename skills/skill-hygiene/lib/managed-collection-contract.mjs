import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

import { canonicalJson } from './cleanup-contract.mjs';
import { collectionSpec } from './collection-specs.mjs';

export const MANAGED_COLLECTION_SCHEMAS = Object.freeze({
  plan: 'skills-refiner.managed-collection.plan.v4',
  priorPlan: 'skills-refiner.managed-collection.plan.v3',
  legacyPlan: 'skills-refiner.managed-collection.plan.v2',
  index: 'skills-refiner.managed-collection.index.v2',
  operation: 'skills-refiner.managed-collection.operation.v2',
});

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const STATES = new Set(['PLANNED', 'PREPARED', 'APPLYING', 'COMMITTED', 'ROLLING_BACK', 'ROLLED_BACK', 'REPAIRING', 'RESTORING', 'RESTORED', 'RECOVERY_REQUIRED']);

export class ManagedCollectionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManagedCollectionContractError';
  }
}

function fail(message) { throw new ManagedCollectionContractError(message); }
function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) fail(`${label} keys are invalid`);
}
function text(value, label) { if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`); }
function digest(value, label) { if (!DIGEST.test(value ?? '')) fail(`${label} must be a SHA-256 digest`); }
function absolute(value, label, home = null) {
  if (typeof value !== 'string' || !isAbsolute(value)) fail(`${label} must be absolute`);
  if (home !== null && value !== home && !value.startsWith(`${home}/`)) fail(`${label} must stay under HOME`);
}
function timestamp(value, label) { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO timestamp`); }
function operationPattern(collectionId) { return new RegExp(`^${collectionId}-[0-9a-f]{12}$`, 'u'); }

export function computeManagedPlanHash(plan) {
  const copy = structuredClone(plan);
  delete copy.plan_hash;
  return `sha256:${createHash('sha256').update(canonicalJson(copy)).digest('hex')}`;
}

function memberIdentity(member, label, withSource = true) {
  exactKeys(member, new Set(withSource ? ['name', 'source_path', 'tree_digest'] : ['name', 'relative_path', 'tree_digest']), label);
  if (!NAME.test(member.name ?? '')) fail(`${label}.name is invalid`);
  text(member[withSource ? 'source_path' : 'relative_path'], `${label}.${withSource ? 'source_path' : 'relative_path'}`);
  digest(member.tree_digest, `${label}.tree_digest`);
}

function nullableText(value, label) {
  if (value !== null) text(value, label);
}

function preservedCollision(collision, label, home) {
  exactKeys(collision, new Set([
    'scope', 'agent', 'name', 'path', 'kind', 'raw_target', 'resolved_target',
    'target_status', 'target_tree_digest', 'receipt_claim', 'relation', 'disposition',
  ]), label);
  if (!['global', 'agent'].includes(collision.scope)
      || (collision.scope === 'agent') !== (typeof collision.agent === 'string')) fail(`${label}.scope is invalid`);
  if (collision.scope === 'global' && collision.agent !== null) fail(`${label}.agent is invalid`);
  if (!NAME.test(collision.name ?? '') || !['symlink', 'directory', 'file', 'other'].includes(collision.kind)) fail(`${label}.identity is invalid`);
  absolute(collision.path, `${label}.path`, home);
  nullableText(collision.raw_target, `${label}.raw_target`);
  nullableText(collision.resolved_target, `${label}.resolved_target`);
  if (!['resolved', 'missing', 'unsupported'].includes(collision.target_status)) fail(`${label}.target_status is invalid`);
  if (collision.target_tree_digest !== null) digest(collision.target_tree_digest, `${label}.target_tree_digest`);
  if (collision.receipt_claim !== null) {
    exactKeys(collision.receipt_claim, new Set(['source', 'source_type', 'source_url', 'skill_path', 'skill_folder_hash']), `${label}.receipt_claim`);
    for (const field of ['source', 'source_type', 'source_url', 'skill_path', 'skill_folder_hash']) nullableText(collision.receipt_claim[field], `${label}.receipt_claim.${field}`);
  }
  if (!['same_repository_name', 'other_repository_name', 'unqualified_name'].includes(collision.relation)
      || collision.disposition !== 'preserve') fail(`${label}.disposition is invalid`);
}

export function validateManagedPlan(plan) {
  const current = plan?.schema_version === MANAGED_COLLECTION_SCHEMAS.plan;
  const prior = plan?.schema_version === MANAGED_COLLECTION_SCHEMAS.priorPlan;
  const legacy = plan?.schema_version === MANAGED_COLLECTION_SCHEMAS.legacyPlan;
  exactKeys(plan, new Set([
    'schema_version', 'collection_id', 'home', 'source', 'receipt', 'legacy', 'projections',
    'predecessor', 'target', 'control', 'controller', 'agent_roots', 'created_at', 'plan_hash',
    ...(current || prior ? ['preserved_collisions'] : []),
  ]), 'plan');
  if (!current && !prior && !legacy) fail('plan schema is invalid');
  const spec = collectionSpec(plan.collection_id);
  absolute(plan.home, 'plan.home');
  timestamp(plan.created_at, 'plan.created_at');

  exactKeys(plan.source, new Set(['provider', 'repository_id', 'revision', 'root', 'tree_digest', 'manifest_digest', 'reference_graph_digest', 'members', 'resources']), 'plan.source');
  if (plan.source.provider !== 'github' || plan.source.repository_id !== spec.repositoryId || !REVISION.test(plan.source.revision ?? '')) fail('plan.source authority is invalid');
  absolute(plan.source.root, 'plan.source.root');
  for (const field of ['tree_digest', 'manifest_digest', 'reference_graph_digest']) digest(plan.source[field], `plan.source.${field}`);
  if (!Array.isArray(plan.source.members)) fail('plan.source members are invalid');
  plan.source.members.forEach((member, index) => memberIdentity(member, `plan.source.members[${index}]`));
  const actualMembers = plan.source.members.map(({ name, source_path }) => ({ name, source_path }));
  if (!spec.memberProfiles.some((profile) => canonicalJson(profile.map(({ name, sourcePath }) => ({ name, source_path: sourcePath }))) === canonicalJson(actualMembers))) fail('plan.source members do not match a compatible packaging profile');
  if (!Array.isArray(plan.source.resources)) fail('plan.source resources are invalid');
  const resourceProfile = plan.source.resources.map(({ source_path }) => source_path);
  if (!spec.sharedPathProfiles.some((profile) => canonicalJson(profile) === canonicalJson(resourceProfile))) fail('plan.source resources do not match a compatible packaging profile');
  for (const [index, resource] of plan.source.resources.entries()) {
    exactKeys(resource, new Set(['source_path', 'relative_path', 'tree_digest']), `plan.source.resources[${index}]`);
    if (resource.relative_path !== resource.source_path) fail(`plan.source.resources[${index}] path is invalid`);
    digest(resource.tree_digest, `plan.source.resources[${index}].tree_digest`);
  }

  if (current || prior) {
    if (!Array.isArray(plan.preserved_collisions)) fail('plan.preserved_collisions must be an array');
    const paths = new Set();
    for (const [index, collision] of plan.preserved_collisions.entries()) {
      preservedCollision(collision, `plan.preserved_collisions[${index}]`, plan.home);
      if (paths.has(collision.path)) fail(`plan.preserved_collisions[${index}].path is duplicated`);
      paths.add(collision.path);
    }
  }

  exactKeys(plan.receipt, new Set(['path', 'digest', 'entries_digest', 'history']), 'plan.receipt');
  absolute(plan.receipt.path, 'plan.receipt.path', plan.home);
  digest(plan.receipt.digest, 'plan.receipt.digest');
  digest(plan.receipt.entries_digest, 'plan.receipt.entries_digest');
  exactKeys(plan.receipt.history, new Set(['entry_count', 'first_installed_at', 'last_updated_at']), 'plan.receipt.history');
  if (!Number.isSafeInteger(plan.receipt.history.entry_count) || plan.receipt.history.entry_count < 1) fail('plan.receipt.history.entry_count is invalid');
  timestamp(plan.receipt.history.first_installed_at, 'plan.receipt.history.first_installed_at');
  timestamp(plan.receipt.history.last_updated_at, 'plan.receipt.history.last_updated_at');

  if (!Array.isArray(plan.legacy) || (plan.predecessor === null && plan.legacy.length === 0)
      || (plan.predecessor !== null && plan.legacy.length !== 0)) fail('plan.legacy does not match predecessor mode');
  const legacyNames = new Set();
  for (const [index, entry] of plan.legacy.entries()) {
    exactKeys(entry, new Set(['name', 'path', 'kind', 'tree_digest', 'native_manifest', 'security_metadata_hash', 'receipt_evidence_digest', 'receipt', 'disposition', 'successor']), `plan.legacy[${index}]`);
    if (!NAME.test(entry.name ?? '') || legacyNames.has(entry.name)) fail(`plan.legacy[${index}].name is invalid or duplicated`);
    legacyNames.add(entry.name);
    if (!plan.source.members.some(({ name }) => name === entry.name) || entry.successor !== entry.name || entry.disposition !== 'replaced') fail(`plan.legacy[${index}] disposition is invalid`);
    absolute(entry.path, `plan.legacy[${index}].path`, plan.home);
    if (entry.path !== join(plan.home, '.agents/skills', entry.name) || entry.kind !== 'directory') fail(`plan.legacy[${index}] topology is invalid`);
    for (const field of ['tree_digest', 'native_manifest', 'security_metadata_hash', 'receipt_evidence_digest']) digest(entry[field], `plan.legacy[${index}].${field}`);
    exactKeys(entry.receipt, new Set(['source', 'source_type', 'source_url', 'skill_path', 'skill_folder_hash', 'installed_at', 'updated_at', 'resolved_revision']), `plan.legacy[${index}].receipt`);
    if (entry.receipt.source !== spec.repositoryId || entry.receipt.source_type !== 'github' || entry.receipt.source_url !== spec.sourceUrl) fail(`plan.legacy[${index}].receipt authority is invalid`);
    text(entry.receipt.skill_path, `plan.legacy[${index}].receipt.skill_path`);
    if (!/^[0-9a-f]{40,64}$/u.test(entry.receipt.skill_folder_hash ?? '')) fail(`plan.legacy[${index}].receipt hash is invalid`);
    timestamp(entry.receipt.installed_at, `plan.legacy[${index}].receipt.installed_at`);
    timestamp(entry.receipt.updated_at, `plan.legacy[${index}].receipt.updated_at`);
    if (entry.receipt.resolved_revision !== null) fail(`plan.legacy[${index}].receipt resolved revision must be null`);
  }

  if (!Array.isArray(plan.projections)) fail('plan.projections must be an array');
  const projectionPaths = new Set();
  for (const [index, link] of plan.projections.entries()) {
    exactKeys(link, new Set(['agent', 'root', 'name', 'path', 'kind', 'raw_target', 'target_digest', 'native_manifest', 'security_metadata_hash']), `plan.projections[${index}]`);
    text(link.agent, `plan.projections[${index}].agent`);
    absolute(link.root, `plan.projections[${index}].root`, plan.home);
    absolute(link.path, `plan.projections[${index}].path`, plan.home);
    if (!legacyNames.has(link.name) || link.path !== join(link.root, link.name) || link.kind !== 'symlink' || projectionPaths.has(link.path)) fail(`plan.projections[${index}] topology is invalid`);
    projectionPaths.add(link.path);
    text(link.raw_target, `plan.projections[${index}].raw_target`);
    if (link.target_digest !== null) digest(link.target_digest, `plan.projections[${index}].target_digest`);
    for (const field of ['native_manifest', 'security_metadata_hash']) digest(link[field], `plan.projections[${index}].${field}`);
  }

  exactKeys(plan.target, new Set(['collection_root', 'exposure']), 'plan.target');
  absolute(plan.target.collection_root, 'plan.target.collection_root', plan.home);
  if (plan.target.collection_root !== join(plan.home, '.agents/skills', plan.collection_id)) fail('plan.target collection root is invalid');
  exactKeys(plan.target.exposure, new Set(['type', 'name', 'global_projection', 'global_raw_target', 'agent_raw_target']), 'plan.target.exposure');
  if (plan.target.exposure.type !== spec.exposure.type || plan.target.exposure.name !== spec.exposure.name) fail('plan.target exposure profile is invalid');
  const expectedGlobal = spec.exposure.type === 'gateway' && spec.exposure.name !== plan.collection_id
    ? join(plan.home, '.agents/skills', spec.exposure.name) : null;
  if (plan.target.exposure.global_projection !== expectedGlobal) fail('plan.target global projection is invalid');
  if (expectedGlobal === null ? plan.target.exposure.global_raw_target !== null : plan.target.exposure.global_raw_target !== `${plan.collection_id}/${spec.exposure.name}`) fail('plan.target global raw target is invalid');
  const expectedAgentTarget = spec.exposure.type === 'gateway'
    ? `../../.agents/skills/${plan.collection_id}/${spec.exposure.name}`
    : `../../.agents/skills/${plan.collection_id}`;
  if (plan.target.exposure.agent_raw_target !== expectedAgentTarget) fail('plan.target agent raw target is invalid');

  exactKeys(plan.control, new Set(['root', 'quarantine_root', 'recovery_root']), 'plan.control');
  for (const field of ['root', 'quarantine_root', 'recovery_root']) absolute(plan.control[field], `plan.control.${field}`, plan.home);
  if (plan.control.root !== join(plan.home, '.agents/skill-control/collections', plan.collection_id)
      || plan.control.quarantine_root !== join(plan.home, '.agents/skills-quarantine/collections')
      || plan.control.recovery_root !== join(plan.home, 'Library/Application Support/skills-refiner/recovery')) fail('plan.control topology is invalid');

  exactKeys(plan.controller, new Set(['adapter', 'node_major', 'bundle_digest', 'helper_binary_digest', 'helper_source_digest', 'architecture', 'compiler_path', 'compiler_version']), 'plan.controller');
  if (plan.controller.adapter !== 'macos-native.v1' || plan.controller.node_major !== 24) fail('plan.controller runtime is invalid');
  for (const field of ['bundle_digest', 'helper_binary_digest', 'helper_source_digest']) digest(plan.controller[field], `plan.controller.${field}`);
  text(plan.controller.architecture, 'plan.controller.architecture');
  absolute(plan.controller.compiler_path, 'plan.controller.compiler_path');
  text(plan.controller.compiler_version, 'plan.controller.compiler_version');

  if (!Array.isArray(plan.agent_roots)) fail('plan.agent_roots must be an array');
  const roots = new Set();
  for (const [index, root] of plan.agent_roots.entries()) {
    exactKeys(root, new Set(['agent', 'root', 'profile', 'qualification']), `plan.agent_roots[${index}]`);
    text(root.agent, `plan.agent_roots[${index}].agent`);
    absolute(root.root, `plan.agent_roots[${index}].root`, plan.home);
    if (root.profile !== `${spec.exposure.type}_projection` || root.qualification !== 'filesystem_only' || roots.has(root.root)) fail(`plan.agent_roots[${index}] is invalid`);
    roots.add(root.root);
    if (plan.predecessor !== null
        && !plan.predecessor.exposures.some((link) => link.root === root.root)) fail(`plan.agent_roots[${index}] has no predecessor exposure`);
  }
  if (plan.predecessor !== null) {
    exactKeys(plan.predecessor, new Set([
      'operation_id', 'plan_hash', 'active_record', 'catalog_entry', 'collection', 'exposures',
      ...(current ? ['accepted_drift'] : []),
    ]), 'plan.predecessor');
    if (current) {
      if (!Array.isArray(plan.predecessor.accepted_drift)
          || new Set(plan.predecessor.accepted_drift).size !== plan.predecessor.accepted_drift.length
          || [...plan.predecessor.accepted_drift].sort().some((value, index) => value !== plan.predecessor.accepted_drift[index])
          || plan.predecessor.accepted_drift.some((value) => !/^UNEXPECTED_COLLECTION_ENTRY:[A-Za-z0-9._-]+$/u.test(value))) {
        fail('plan.predecessor.accepted_drift is invalid');
      }
    }
    if (!operationPattern(plan.collection_id).test(plan.predecessor.operation_id ?? '')) fail('plan.predecessor.operation_id is invalid');
    digest(plan.predecessor.plan_hash, 'plan.predecessor.plan_hash');
    exactKeys(plan.predecessor.active_record, new Set(['schema_version', 'collection_id', 'operation_id', 'plan_hash', 'activated_at']), 'plan.predecessor.active_record');
    if (plan.predecessor.active_record.schema_version !== 'skills-refiner.collection.active.v2'
        || plan.predecessor.active_record.collection_id !== plan.collection_id
        || plan.predecessor.active_record.operation_id !== plan.predecessor.operation_id
        || plan.predecessor.active_record.plan_hash !== plan.predecessor.plan_hash) fail('plan.predecessor.active_record is invalid');
    timestamp(plan.predecessor.active_record.activated_at, 'plan.predecessor.active_record.activated_at');
    exactKeys(plan.predecessor.collection, new Set(['path', 'tree_digest', 'native_manifest', 'security_metadata_hash']), 'plan.predecessor.collection');
    if (plan.predecessor.collection.path !== plan.target.collection_root) fail('plan.predecessor.collection path is invalid');
    for (const field of ['tree_digest', 'native_manifest', 'security_metadata_hash']) digest(plan.predecessor.collection[field], `plan.predecessor.collection.${field}`);
    if (!Array.isArray(plan.predecessor.exposures) || plan.predecessor.exposures.length !== plan.agent_roots.length + (plan.target.exposure.global_projection === null ? 0 : 1)) fail('plan.predecessor.exposures is invalid');
    for (const [index, exposure] of plan.predecessor.exposures.entries()) {
      exactKeys(exposure, new Set(['scope', 'agent', 'root', 'path', 'raw_target', 'native_manifest', 'security_metadata_hash']), `plan.predecessor.exposures[${index}]`);
      if (!['agent', 'global'].includes(exposure.scope) || (exposure.scope === 'agent') !== (typeof exposure.agent === 'string')) fail(`plan.predecessor.exposures[${index}] scope is invalid`);
      if (exposure.scope === 'global' && exposure.agent !== null) fail(`plan.predecessor.exposures[${index}] agent is invalid`);
      absolute(exposure.root, `plan.predecessor.exposures[${index}].root`, plan.home);
      absolute(exposure.path, `plan.predecessor.exposures[${index}].path`, plan.home);
      text(exposure.raw_target, `plan.predecessor.exposures[${index}].raw_target`);
      for (const field of ['native_manifest', 'security_metadata_hash']) digest(exposure[field], `plan.predecessor.exposures[${index}].${field}`);
      if (exposure.scope === 'agent') {
        const root = plan.agent_roots.find((entry) => entry.agent === exposure.agent);
        if (!root || exposure.root !== root.root || exposure.path !== join(root.root, plan.target.exposure.name)
            || exposure.raw_target !== plan.target.exposure.agent_raw_target) fail(`plan.predecessor.exposures[${index}] topology is invalid`);
      } else if (exposure.path !== plan.target.exposure.global_projection
          || exposure.raw_target !== plan.target.exposure.global_raw_target) fail(`plan.predecessor.exposures[${index}] global topology is invalid`);
    }
    const catalog = plan.predecessor.catalog_entry;
    exactKeys(catalog, new Set(['collection_id', 'operation_id', 'plan_hash', 'source', 'collection_root', 'recovery_plan', 'lifecycle']), 'plan.predecessor.catalog_entry');
    if (catalog.collection_id !== plan.collection_id || catalog.operation_id !== plan.predecessor.operation_id
        || catalog.plan_hash !== plan.predecessor.plan_hash || catalog.collection_root !== plan.target.collection_root
        || catalog.recovery_plan !== join(plan.home, 'Library/Application Support/skills-refiner/recovery/operations', plan.predecessor.operation_id, 'plan.json')) fail('plan.predecessor.catalog_entry identity is invalid');
    exactKeys(catalog.source, new Set(['provider', 'repository_id', 'resolved_revision', 'artifact_digest']), 'plan.predecessor.catalog_entry.source');
    if (catalog.source.provider !== 'github' || catalog.source.repository_id !== spec.repositoryId
        || !REVISION.test(catalog.source.resolved_revision ?? '')) fail('plan.predecessor.catalog_entry.source is invalid');
    digest(catalog.source.artifact_digest, 'plan.predecessor.catalog_entry.source.artifact_digest');
    exactKeys(catalog.lifecycle, new Set(['receipt_history', 'plan_created_at', 'first_activated_at', 'current_generation_activated_at']), 'plan.predecessor.catalog_entry.lifecycle');
    exactKeys(catalog.lifecycle.receipt_history, new Set(['entry_count', 'first_installed_at', 'last_updated_at']), 'plan.predecessor.catalog_entry.lifecycle.receipt_history');
    if (!Number.isSafeInteger(catalog.lifecycle.receipt_history.entry_count) || catalog.lifecycle.receipt_history.entry_count < 1) fail('plan.predecessor catalog receipt history is invalid');
    for (const field of ['first_installed_at', 'last_updated_at']) timestamp(catalog.lifecycle.receipt_history[field], `plan.predecessor.catalog_entry.lifecycle.receipt_history.${field}`);
    for (const field of ['plan_created_at', 'first_activated_at', 'current_generation_activated_at']) timestamp(catalog.lifecycle[field], `plan.predecessor.catalog_entry.lifecycle.${field}`);
  }
  digest(plan.plan_hash, 'plan.plan_hash');
  if (computeManagedPlanHash(plan) !== plan.plan_hash) fail('plan.plan_hash does not match content');
  return plan;
}

export function buildManagedPlan(input) {
  const plan = { schema_version: MANAGED_COLLECTION_SCHEMAS.plan, ...structuredClone(input), plan_hash: `sha256:${'0'.repeat(64)}` };
  plan.plan_hash = computeManagedPlanHash(plan);
  return validateManagedPlan(plan);
}

export function validateManagedIndex(index) {
  exactKeys(index, new Set(['schema_version', 'collection_id', 'source', 'artifact_digest', 'manifest_digest', 'members', 'resources', 'exposure', 'receipt_snapshot_digest', 'profile_matrix_digest', 'plan_created_at', 'operation_id']), 'index');
  if (index.schema_version !== MANAGED_COLLECTION_SCHEMAS.index) fail('index schema is invalid');
  const spec = collectionSpec(index.collection_id);
  exactKeys(index.source, new Set(['provider', 'repository_id', 'resolved_revision', 'tree_digest']), 'index.source');
  if (index.source.provider !== 'github' || index.source.repository_id !== spec.repositoryId || !REVISION.test(index.source.resolved_revision ?? '')) fail('index.source is invalid');
  for (const field of ['tree_digest', 'artifact_digest', 'manifest_digest', 'receipt_snapshot_digest', 'profile_matrix_digest']) digest(index[field] ?? index.source[field], `index.${field}`);
  if (!Array.isArray(index.members)) fail('index.members is invalid');
  index.members.forEach((member, position) => memberIdentity(member, `index.members[${position}]`, false));
  const indexMemberProfile = index.members.map(({ name, relative_path }) => ({ name, source_path: relative_path }));
  if (!spec.memberProfiles.some((profile) => canonicalJson(profile.map(({ name }) => ({ name, source_path: name }))) === canonicalJson(indexMemberProfile))) fail('index.members does not match a compatible packaging profile');
  if (!Array.isArray(index.resources)) fail('index.resources is invalid');
  const resourceProfile = index.resources.map(({ relative_path }) => relative_path);
  if (!spec.sharedPathProfiles.some((profile) => canonicalJson(profile) === canonicalJson(resourceProfile))) fail('index.resources does not match a compatible packaging profile');
  for (const [position, resource] of index.resources.entries()) {
    exactKeys(resource, new Set(['relative_path', 'tree_digest']), `index.resources[${position}]`);
    digest(resource.tree_digest, `index.resources[${position}].tree_digest`);
  }
  exactKeys(index.exposure, new Set(['type', 'name', 'locator_digest']), 'index.exposure');
  if (index.exposure.type !== spec.exposure.type || index.exposure.name !== spec.exposure.name) fail('index.exposure is invalid');
  if (index.exposure.locator_digest !== null) digest(index.exposure.locator_digest, 'index.exposure.locator_digest');
  timestamp(index.plan_created_at, 'index.plan_created_at');
  if (!operationPattern(index.collection_id).test(index.operation_id ?? '')) fail('index.operation_id is invalid');
  return index;
}

export function validateManagedOperation(operation) {
  exactKeys(operation, new Set(['schema_version', 'collection_id', 'operation_id', 'plan_hash', 'state', 'updated_at', 'mutation_occurred', 'error_code']), 'operation');
  if (operation.schema_version !== MANAGED_COLLECTION_SCHEMAS.operation) fail('operation schema is invalid');
  collectionSpec(operation.collection_id);
  if (!operationPattern(operation.collection_id).test(operation.operation_id ?? '')) fail('operation id is invalid');
  digest(operation.plan_hash, 'operation.plan_hash');
  if (!STATES.has(operation.state)) fail('operation state is invalid');
  timestamp(operation.updated_at, 'operation.updated_at');
  if (typeof operation.mutation_occurred !== 'boolean') fail('operation.mutation_occurred is invalid');
  if (operation.error_code !== null) text(operation.error_code, 'operation.error_code');
  return operation;
}
