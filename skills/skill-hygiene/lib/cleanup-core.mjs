import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute } from 'node:path';

import {
  SCHEMAS,
  computeItemHash,
  computePlanHash,
  deriveTransactionId,
  sha256Json,
  validateObservationIdentity,
  validatePlan,
  validatePostScanReport,
} from './cleanup-contract.mjs';

export const POLICY_VERSION = 'skill-disposition.v1';
export const MAX_KEEP_RECORDS = 10_000;

export const GROUP_ORDER = Object.freeze([
  'broken_distributions',
  'backup_remnants',
  'runtime_load_blockers',
  'active_topology_conflicts',
  'security_provenance_review',
  'other_advisory_signals',
]);

const DECISION_ACTIONS = new Set(['retire', 'keep', 'later']);
const ENTRY_KINDS = new Set(['directory', 'symlink', 'broken_symlink']);

export class CleanupCoreError extends Error {
  constructor(code, message, reason = code) {
    super(message);
    this.name = 'CleanupCoreError';
    this.code = code;
    this.reason = reason;
  }
}

function fail(code, message, reason) {
  throw new CleanupCoreError(code, message, reason);
}

function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_document', message);
  return value;
}

function requireExactKeys(value, allowed, message) {
  requireObject(value, message);
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    fail('invalid_document', message);
  }
}

const SUPPORTED_SCAN_SCHEMAS = new Set(['skill-scan.v5', 'skill-scan.v6', 'skill-scan.v7']);

function validateScan(scan) {
  requireObject(scan, 'scan must be an object');
  if (!SUPPORTED_SCAN_SCHEMAS.has(scan.metadata?.schema_version) || !Array.isArray(scan.entries)
      || !scan.topology || typeof scan.topology !== 'object' || Array.isArray(scan.topology)) {
    fail('invalid_schema', 'expected a supported skill-scan.v5/v6/v7 document');
  }
  return scan;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

const SAFE_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const RAW_SHA256 = /^[0-9a-f]{64}$/u;
const RAW_SHA1 = /^[0-9a-f]{40}$/u;
const SEMANTIC_ENTRY_KINDS = new Set(['directory', 'symlink', 'broken_symlink']);
const SCAN_V5_PROVENANCE_KEYS = ['kind', 'source_url', 'git_root', 'git_branch', 'confidence'];
const SCAN_V6_PROVENANCE_KEYS = [
  'kind',
  'source_url',
  'source_provider',
  'repository_id',
  'source_path',
  'resolved_revision',
  'claim_kind',
  'git_root',
  'git_branch',
  'confidence',
];
const SOURCE_PROVIDERS = new Set(['git', 'github']);
const REVISION = /^[0-9a-f]{40}$/u;
const REPOSITORY_ID = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/u;
const GITHUB_REPOSITORY_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const PUBLIC_GIT_URL = /^https:\/\/(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)$/u;

function semanticIdentityUnavailable() {
  fail(
    'semantic_identity_unavailable',
    'semantic identity evidence is missing or malformed',
  );
}

function semanticString(value, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && value.length === 0)
      || /[\u0000-\u001f\u007f]/u.test(value)) semanticIdentityUnavailable();
  return value;
}

function semanticNullableString(value) {
  return value === null ? null : semanticString(value);
}

function repositoryIdForPublicGitUrl(sourceUrl) {
  const match = PUBLIC_GIT_URL.exec(sourceUrl);
  if (!match) return null;
  const repositoryPath = match[2].endsWith('.git') ? match[2].slice(0, -4) : match[2];
  return REPOSITORY_ID.test(`${match[1]}/${repositoryPath}`)
    ? `${match[1]}/${repositoryPath}`
    : null;
}

function validGithubRepositoryId(repositoryId) {
  if (typeof repositoryId !== 'string' || !GITHUB_REPOSITORY_ID.test(repositoryId)) return false;
  const [owner, repository] = repositoryId.split('/');
  return !['.', '..'].includes(owner)
    && !['.', '..'].includes(repository)
    && !repository.endsWith('.git');
}

function normalizedScanProvenance(provenance, {
  allowMissing = false,
  expectedSchema = null,
} = {}) {
  if (provenance === undefined && allowMissing) {
    return {
      format: 'missing',
      kind: 'unknown',
      source_url: '',
      source_provider: null,
      repository_id: null,
      source_path: null,
      resolved_revision: null,
      claim_kind: null,
      git_root: '',
      git_branch: '',
      confidence: 'none',
    };
  }
  const isV5 = hasExactKeys(provenance, SCAN_V5_PROVENANCE_KEYS);
  const isStructured = hasExactKeys(provenance, SCAN_V6_PROVENANCE_KEYS);
  if (!isV5 && !isStructured) semanticIdentityUnavailable();
  if ((expectedSchema === 'skill-scan.v5' && !isV5)
      || (['skill-scan.v6', 'skill-scan.v7'].includes(expectedSchema) && !isStructured)
      || (expectedSchema !== null && !SUPPORTED_SCAN_SCHEMAS.has(expectedSchema))) {
    semanticIdentityUnavailable();
  }

  const common = {
    kind: semanticString(provenance.kind),
    source_url: semanticString(provenance.source_url, { empty: true }),
    git_root: semanticString(provenance.git_root, { empty: true }),
    git_branch: semanticString(provenance.git_branch, { empty: true }),
    confidence: semanticString(provenance.confidence),
  };
  if (isV5) {
    return {
      format: 'scan-v5',
      ...common,
      source_provider: null,
      repository_id: null,
      source_path: null,
      resolved_revision: null,
      claim_kind: null,
    };
  }

  const sourceProvider = semanticNullableString(provenance.source_provider);
  const repositoryId = semanticNullableString(provenance.repository_id);
  const sourcePath = semanticNullableString(provenance.source_path);
  const resolvedRevision = semanticNullableString(provenance.resolved_revision);
  const claimKind = semanticNullableString(provenance.claim_kind);
  if ((sourceProvider !== null && !SOURCE_PROVIDERS.has(sourceProvider))
      || (repositoryId !== null
        && (repositoryId.length > 1024 || !REPOSITORY_ID.test(repositoryId)))
      || (sourcePath !== null
        && (sourcePath.length > 2048 || isAbsolute(sourcePath)
          || (sourcePath !== '.'
            && sourcePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'))))
      || (resolvedRevision !== null && !REVISION.test(resolvedRevision))
      || (claimKind !== null
        && !['index_claim', 'installer_receipt_claim'].includes(claimKind))) {
    semanticIdentityUnavailable();
  }
  if (sourceProvider === null) {
    if (common.source_url !== '' || repositoryId !== null || resolvedRevision !== null
        || claimKind !== null
        || ['direct', 'controller_unverified', 'receipt_bound'].includes(common.confidence)) {
      semanticIdentityUnavailable();
    }
  } else if (sourceProvider === 'git') {
    if (repositoryId === null || sourcePath === null || resolvedRevision !== null
        || claimKind !== null || common.confidence !== 'direct'
        || !isAbsolute(common.git_root)
        || repositoryIdForPublicGitUrl(common.source_url) !== repositoryId) {
      semanticIdentityUnavailable();
    }
  } else if (sourceProvider === 'github') {
    const indexClaim = claimKind === 'index_claim'
      && resolvedRevision !== null
      && common.confidence === 'controller_unverified';
    const installerReceiptClaim = claimKind === 'installer_receipt_claim'
      && resolvedRevision === null
      && common.confidence === 'receipt_bound';
    const receiptStorageGitState = (common.git_root === '' && common.git_branch === '')
      || isAbsolute(common.git_root);
    if (!validGithubRepositoryId(repositoryId)
        || sourcePath === null || (!indexClaim && !installerReceiptClaim)
        || (installerReceiptClaim && expectedSchema !== null
          && expectedSchema !== 'skill-scan.v7')
        || (indexClaim && (common.git_root !== '' || common.git_branch !== ''))
        || (installerReceiptClaim && !receiptStorageGitState)
        || common.source_url !== `https://github.com/${repositoryId}.git`
    ) {
      semanticIdentityUnavailable();
    }
  } else {
    semanticIdentityUnavailable();
  }
  return {
    format: expectedSchema === 'skill-scan.v7' || claimKind === 'installer_receipt_claim'
      ? 'scan-v7'
      : 'scan-v6',
    ...common,
    source_provider: sourceProvider,
    repository_id: repositoryId,
    source_path: sourcePath,
    resolved_revision: resolvedRevision,
    claim_kind: claimKind,
  };
}

function hasExactKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key))
    && required.every((key) => Object.hasOwn(value, key));
}

function normalizedMutationProvenance(value) {
  if (!hasExactKeys(value, ['kind', 'confidence', 'evidence'])) {
    semanticIdentityUnavailable();
  }
  const kind = semanticString(value.kind);
  const confidence = semanticString(value.confidence);
  if (kind === 'unknown' && confidence === 'none' && value.evidence === null) {
    return { kind, confidence, evidence: null };
  }
  const evidence = value.evidence;
  if (kind !== 'installed_copy' || confidence !== 'direct'
      || !hasExactKeys(
        evidence,
        ['kind', 'receipt_file', 'receipt_sha256', 'installed_tree_sha1'],
        ['kind', 'receipt_sha256', 'installed_tree_sha1'],
      )
      || evidence.kind !== 'content_bound_installer_receipt'
      || typeof evidence.receipt_sha256 !== 'string'
      || !RAW_SHA256.test(evidence.receipt_sha256)
      || typeof evidence.installed_tree_sha1 !== 'string'
      || !RAW_SHA1.test(evidence.installed_tree_sha1)
      || (Object.hasOwn(evidence, 'receipt_file')
        && (typeof evidence.receipt_file !== 'string'
          || !isAbsolute(evidence.receipt_file)))) {
    semanticIdentityUnavailable();
  }
  if (Object.hasOwn(evidence, 'receipt_file')) semanticString(evidence.receipt_file);
  return {
    kind,
    confidence,
    evidence: {
      kind: evidence.kind,
      receipt_sha256: evidence.receipt_sha256,
      installed_tree_sha1: evidence.installed_tree_sha1,
    },
  };
}

function semanticIdentity(entry, { scannerSchema = null } = {}) {
  requireObject(entry, 'scan entry must be an object');
  const entryPath = semanticString(entry.entry_path);
  const activeRoot = semanticString(entry.active_root);
  const entryKind = entry.entry_kind;
  if (!isAbsolute(entryPath) || !isAbsolute(activeRoot) || dirname(entryPath) !== activeRoot
      || !SEMANTIC_ENTRY_KINDS.has(entryKind)) semanticIdentityUnavailable();
  const rawTarget = entry.raw_link_target_base64;
  if ((entryKind === 'directory' && rawTarget !== null)
      || (entryKind !== 'directory'
        && (typeof rawTarget !== 'string' || rawTarget.length === 0
          || !SAFE_BASE64.test(rawTarget)))) semanticIdentityUnavailable();
  const canonicalTarget = entry.canonical_dir ?? null;
  if ((entryKind === 'broken_symlink' && canonicalTarget !== null)
      || (entryKind !== 'broken_symlink'
        && (typeof canonicalTarget !== 'string' || canonicalTarget.length === 0
          || !isAbsolute(canonicalTarget)))) semanticIdentityUnavailable();
  if (canonicalTarget !== null) semanticString(canonicalTarget);
  const provenance = entry.provenance;
  const source = normalizedScanProvenance(provenance, {
    allowMissing: entryKind === 'broken_symlink',
    expectedSchema: scannerSchema,
  });
  const mutationProvenance = normalizedMutationProvenance(entry.mutation_provenance);
  if (source.claim_kind === 'installer_receipt_claim'
      && (mutationProvenance.kind !== 'installed_copy'
        || mutationProvenance.confidence !== 'direct'
        || mutationProvenance.evidence?.kind !== 'content_bound_installer_receipt')) {
    semanticIdentityUnavailable();
  }
  const normalizedProvenance = ['scan-v6', 'scan-v7'].includes(source.format)
    ? {
      kind: source.kind,
      source_url: source.source_url,
      source_provider: source.source_provider,
      repository_id: source.repository_id,
      source_path: source.source_path,
      resolved_revision: source.resolved_revision,
      claim_kind: source.claim_kind,
      git_root: source.git_root,
    }
    : { kind: source.kind, source_url: source.source_url, git_root: source.git_root };
  const contentHash = entry.normalized_content_sha256 ?? null;
  if ((entryKind === 'broken_symlink' && contentHash !== null)
      || (entryKind !== 'broken_symlink'
        && (typeof contentHash !== 'string' || !RAW_SHA256.test(contentHash)))) {
    semanticIdentityUnavailable();
  }
  return {
    entry_path: entryPath,
    active_root: activeRoot,
    entry_kind: entryKind,
    raw_link_target_base64: rawTarget,
    canonical_target: canonicalTarget,
    provenance: normalizedProvenance,
    mutation_provenance: mutationProvenance,
    normalized_content_sha256: contentHash,
  };
}

export function semanticIdentityHashForEntry(entry, options = {}) {
  return sha256Json(semanticIdentity(entry, options));
}

export function preApplyStatusAllowsBaseline(status) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return false;
  if (status.ok === false) return status.error_code === 'transaction_unavailable';
  return status.ok === true && status.location === 'original'
    && status.transaction_has_mutated === false
    && ['PLANNED', 'CONFIRMED', 'PREPARED', 'APPLYING'].includes(status.state);
}

function nativeObservationStable(before, after, planItem) {
  if (before?.ok !== true || after?.ok !== true
      || !before.identity || !after.identity) return false;
  for (const identity of [before.identity, after.identity]) {
    if (identity.entry_path !== planItem.entry_path
        || identity.active_root !== planItem.active_root
        || identity.entry_kind !== planItem.entry_kind
        || (planItem.entry_kind !== 'directory'
          && identity.raw_link_target_base64
            !== planItem.execution_identity?.raw_link_target_base64)) return false;
  }
  return typeof before.identity.identity_hash === 'string'
    && before.identity.identity_hash === after.identity.identity_hash;
}

export function reconcilePostApplyScan({
  plan,
  committedTransactionIds,
  baselineByTransactionId,
  baselineIdentityUnavailableTransactionIds = new Set(),
  scan,
  scanAvailable,
  scanErrorCode = 'scanner_unavailable',
  statusByTransactionId,
  nativeIdentityBeforeByTransactionId,
  nativeIdentityAfterByTransactionId,
} = {}) {
  requireObject(plan, 'plan must be an object');
  if (!Array.isArray(plan.items) || !Array.isArray(committedTransactionIds)
      || !(baselineByTransactionId instanceof Map)
      || !(baselineIdentityUnavailableTransactionIds instanceof Set)
      || !(statusByTransactionId instanceof Map)
      || !(nativeIdentityBeforeByTransactionId instanceof Map)
      || !(nativeIdentityAfterByTransactionId instanceof Map)
      || typeof scanAvailable !== 'boolean'
      || (scanAvailable && (!scan || !Array.isArray(scan.entries)))) {
    fail('invalid_document', 'post-apply scan inputs are invalid');
  }
  const planItems = new Map(plan.items.map((item) => [item.transaction_id, item]));
  let statusUnavailable = false;
  let observationRace = false;
  let semanticUnavailable = false;
  const items = committedTransactionIds.map((transactionId) => {
    const planItem = planItems.get(transactionId);
    if (planItem === undefined) {
      fail('invalid_document', 'committed transaction is not present in the plan');
    }
    const baseline = baselineByTransactionId.get(transactionId) ?? null;
    if (!scanAvailable) {
      return {
        transaction_id: transactionId,
        item_id: planItem.item_id,
        entry_path: planItem.entry_path,
        status: 'INDETERMINATE',
        location: 'unknown',
        baseline_identity_hash: baseline,
        observed_identity_hash: null,
      };
    }
    const matches = scan.entries.filter(({ entry_path: entryPath }) => (
      entryPath === planItem.entry_path
    ));
    let observed = null;
    if (matches.length === 1) {
      try {
        observed = semanticIdentityHashForEntry(matches[0], {
          scannerSchema: scan.metadata.schema_version,
        });
      } catch (error) {
        if (!(error instanceof CleanupCoreError)
            || error.code !== 'semantic_identity_unavailable') throw error;
        semanticUnavailable = true;
      }
    }
    const nativeStatus = statusByTransactionId.get(transactionId);
    const nativeBefore = nativeIdentityBeforeByTransactionId.get(transactionId);
    const nativeAfter = nativeIdentityAfterByTransactionId.get(transactionId);
    let status;
    let location;
    if (nativeStatus?.ok !== true) {
      status = 'INDETERMINATE';
      location = 'unknown';
      statusUnavailable = true;
    } else if (nativeStatus.location === 'quarantine' && matches.length === 0) {
      status = 'QUARANTINED';
      location = 'quarantine';
    } else if (nativeStatus.location === 'quarantine') {
      status = 'INDETERMINATE';
      location = 'unknown';
      observationRace = true;
    } else if (nativeStatus.location === 'rehydrated') {
      location = 'rehydrated';
      if (baselineIdentityUnavailableTransactionIds.has(transactionId)) {
        semanticUnavailable = true;
      }
      if (matches.length !== 1) {
        status = 'RESTORE_CONFLICT';
      } else if (!nativeObservationStable(nativeBefore, nativeAfter, planItem)) {
        status = 'INDETERMINATE';
        location = 'unknown';
        observationRace = true;
      } else if (baseline !== null && observed !== null && baseline === observed) {
        status = 'REHYDRATED';
      } else {
        status = 'RESTORE_CONFLICT';
      }
    } else {
      status = 'INDETERMINATE';
      location = 'unknown';
      statusUnavailable = true;
    }
    return {
      item_id: planItem.item_id,
      transaction_id: transactionId,
      entry_path: planItem.entry_path,
      status,
      location,
      baseline_identity_hash: baseline,
      observed_identity_hash: status === 'QUARANTINED' ? null : observed,
    };
  });
  const rehydrationWarning = items.some(({ status }) => (
    ['REHYDRATED', 'RESTORE_CONFLICT'].includes(status)
  ));
  const warnings = ['installer_may_redeploy', 'running_agent_may_cache'];
  if (rehydrationWarning) warnings.push('automatic_requarantine_disabled');
  const unavailable = !scanAvailable;
  const partial = !unavailable
    && (statusUnavailable || observationRace || semanticUnavailable);
  return validatePostScanReport({
    schema_version: SCHEMAS.postScan,
    observation_status: unavailable ? 'UNAVAILABLE' : (partial ? 'PARTIAL' : 'COMPLETE'),
    scanner_schema: unavailable ? null : scan.metadata?.schema_version,
    error_code: unavailable
      ? scanErrorCode
      : (statusUnavailable
        ? 'status_unavailable'
        : (observationRace
          ? 'observation_race'
          : (semanticUnavailable ? 'semantic_identity_unavailable' : null))),
    items,
    warnings,
  }, committedTransactionIds, plan);
}

function stableUnique(values) {
  return [...new Set(values)].sort();
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function entryIdentity(entry) {
  if (typeof entry.entry_path !== 'string' || entry.entry_path.length === 0
      || typeof entry.active_root !== 'string' || entry.active_root.length === 0
      || !ENTRY_KINDS.has(entry.entry_kind)) {
    fail('invalid_schema', 'scan entry is missing entry identity fields');
  }
  return {
    entry_path: entry.entry_path,
    active_root: entry.active_root,
    entry_kind: entry.entry_kind,
    raw_link_target_base64: entry.raw_link_target_base64 ?? null,
  };
}

function scanFingerprint(scan) {
  const collisions = collisionNames(scan);
  const entryFacts = scan.entries.map((entry) => ({
    ...entryIdentity(entry),
    name: entry.name ?? basename(entry.entry_path),
    canonical_dir: entry.canonical_dir ?? null,
    normalized_content_sha256: entry.normalized_content_sha256 ?? null,
    mutation_provenance: entry.mutation_provenance ?? null,
    source: sourceEvidence(entry, scan.metadata.schema_version),
    relevant_signals: relevantSignals(entry, collisions.has(entry.name)),
  })).sort((left, right) => compareStrings(left.entry_path, right.entry_path));
  return sha256Json({
    scanner_schema: scan.metadata.schema_version,
    product_version: scan.metadata.product_version ?? null,
    runtime_validation_mode: scan.metadata.runtime_validation_mode ?? null,
    hash_normalization: scan.metadata.hash_normalization ?? null,
    entries: entryFacts,
    name_collisions: safeArray(scan.name_collisions).map((collision) => ({
      name: collision?.name ?? null,
      locations: stableUnique(safeArray(collision?.locations).filter((location) => typeof location === 'string')),
    })),
  });
}

function collisionNames(scan) {
  return new Set(safeArray(scan.name_collisions)
    .map((collision) => collision?.name)
    .filter((name) => typeof name === 'string' && name.length > 0));
}

function relevantSignals(entry, colliding) {
  const signals = [];
  for (const flag of safeArray(entry.flags)) {
    if (typeof flag === 'string') signals.push(`flag:${flag}`);
  }
  for (const blocker of safeArray(entry.runtime_contract?.load_blockers)) {
    if (typeof blocker === 'string') signals.push(`runtime:${blocker}`);
  }
  if (typeof entry.runtime_contract?.status === 'string'
      && !['unknown', 'pass', 'ok'].includes(entry.runtime_contract.status)) {
    signals.push(`runtime_status:${entry.runtime_contract.status}`);
  }
  for (const risk of safeArray(entry.risk_indicators)) {
    if (typeof risk?.id === 'string') signals.push(`risk:${risk.id}`);
  }
  if (colliding) signals.push('topology:name_collision');
  if (typeof entry.provenance?.kind === 'string') signals.push(`source:${entry.provenance.kind}`);
  if (typeof entry.mutation_provenance?.kind === 'string') {
    signals.push(`mutation_provenance:${entry.mutation_provenance.kind}`);
  }
  return stableUnique(signals);
}

function groupsFor(entry, signals, colliding) {
  const groups = [];
  if (entry.entry_kind === 'broken_symlink' || safeArray(entry.flags).includes('broken_symlink')) {
    groups.push('broken_distributions');
  }
  if (safeArray(entry.flags).some((flag) => flag === 'backup_remnant' || /backup/u.test(flag))) {
    groups.push('backup_remnants');
  }
  if (safeArray(entry.runtime_contract?.load_blockers).length > 0
      || entry.runtime_contract?.loadable === false) {
    groups.push('runtime_load_blockers');
  }
  if (colliding) groups.push('active_topology_conflicts');
  if (entry.provenance?.git_root || entry.mutation_provenance?.kind !== 'installed_copy') {
    groups.push('security_provenance_review');
  }
  if (groups.length === 0 || signals.length > 0) groups.push('other_advisory_signals');
  return GROUP_ORDER.filter((group) => groups.includes(group));
}

function directInstalledCopy(entry) {
  const provenance = entry.mutation_provenance;
  const evidence = provenance?.evidence;
  return provenance?.kind === 'installed_copy'
    && provenance?.confidence === 'direct'
    && evidence?.kind === 'content_bound_installer_receipt'
    && typeof evidence.receipt_sha256 === 'string'
    && /^[0-9a-f]{64}$/u.test(evidence.receipt_sha256)
    && typeof evidence.installed_tree_sha1 === 'string'
    && /^[0-9a-f]{40}$/u.test(evidence.installed_tree_sha1);
}

function eligibility(entry, scan) {
  const governanceScope = Object.hasOwn(scan.topology, entry.location)
    ? 'installed_or_distributed'
    : 'outside_scope';
  if (governanceScope === 'outside_scope') {
    return {
      governance_scope: governanceScope,
      mutation_eligibility: 'review_only',
      review_only_reason: 'outside_governance_scope',
      action_scope: { kind: 'none', target_mutated: false },
    };
  }
  if (entry.entry_kind === 'symlink' || entry.entry_kind === 'broken_symlink') {
    return {
      governance_scope: governanceScope,
      mutation_eligibility: 'eligible',
      review_only_reason: null,
      action_scope: { kind: 'link_only', target_mutated: false },
    };
  }
  if (entry.provenance?.git_root) {
    return {
      governance_scope: governanceScope,
      mutation_eligibility: 'review_only',
      review_only_reason: 'authoring_source',
      action_scope: { kind: 'none', target_mutated: false },
    };
  }
  if (!directInstalledCopy(entry)) {
    return {
      governance_scope: governanceScope,
      mutation_eligibility: 'review_only',
      review_only_reason: 'unproven_installed_copy',
      action_scope: { kind: 'none', target_mutated: false },
    };
  }
  return {
    governance_scope: governanceScope,
    mutation_eligibility: 'eligible',
    review_only_reason: null,
    action_scope: { kind: 'installed_entry_only', target_mutated: true },
  };
}

function sourceEvidence(entry, scannerSchema) {
  const source = normalizedScanProvenance(entry.provenance, {
    allowMissing: entry.entry_kind === 'broken_symlink',
    expectedSchema: scannerSchema,
  });
  const evidence = {
    kind: source.kind,
    canonical_target: entry.canonical_dir || null,
    git_root: source.git_root || null,
    git_branch: source.git_branch || null,
    confidence: source.confidence,
  };
  if (['scan-v6', 'scan-v7'].includes(source.format)) {
    evidence.source_url = source.source_url || null;
    evidence.source_provider = source.source_provider;
    evidence.repository_id = source.repository_id;
    evidence.source_path = source.source_path;
    evidence.resolved_revision = source.resolved_revision;
    evidence.claim_kind = source.claim_kind;
  }
  return evidence;
}

function consumersFor(entry, entries) {
  const target = entry.canonical_dir || (entry.entry_kind === 'directory' ? entry.entry_path : null);
  if (!target) return [];
  return entries
    .filter((other) => other.entry_path !== entry.entry_path && other.canonical_dir === target)
    .map((other) => ({
      entry_path: other.entry_path,
      active_root: other.active_root,
      entry_kind: other.entry_kind,
    }))
    .sort((left, right) => compareStrings(left.entry_path, right.entry_path));
}

function uncertaintyFor(entry, mutationEligibility) {
  const uncertainty = [];
  if (!entry.provenance || entry.provenance.confidence !== 'direct') uncertainty.push('source_not_directly_proven');
  if (mutationEligibility === 'review_only') uncertainty.push('mutation_authority_not_proven');
  if (!entry.runtime_contract || entry.runtime_contract.status === 'unknown') uncertainty.push('runtime_state_unknown');
  return stableUnique(uncertainty);
}

function candidateFor(entry, scan, scanDigest, collisions) {
  const identity = entryIdentity(entry);
  const colliding = collisions.has(entry.name);
  const signals = relevantSignals(entry, colliding);
  const groups = groupsFor(entry, signals, colliding);
  const disposition = eligibility(entry, scan);
  const distributionConsumers = consumersFor(entry, scan.entries);
  const source = sourceEvidence(entry, scan.metadata.schema_version);
  const topologyFingerprint = sha256Json({
    name: entry.name ?? basename(entry.entry_path),
    consumers: distributionConsumers,
    collision: colliding,
  });
  const evidence = {
    relevant_signals: signals,
    mutation_provenance: entry.mutation_provenance ?? null,
    normalized_content_sha256: entry.normalized_content_sha256 ?? null,
  };
  const candidateId = sha256Json({
    policy_version: POLICY_VERSION,
    entry_path: identity.entry_path,
    active_root: identity.active_root,
    entry_kind: identity.entry_kind,
  });
  const candidateFingerprint = sha256Json({
    candidate_id: candidateId,
    entry_identity: identity,
    governance_scope: disposition.governance_scope,
    topology_fingerprint: topologyFingerprint,
    relevant_signals: signals,
    source,
    mutation_provenance: entry.mutation_provenance ?? null,
    normalized_content_sha256: entry.normalized_content_sha256 ?? null,
    scanner_schema: scan.metadata.schema_version,
    policy_version: POLICY_VERSION,
  });
  return {
    candidate_id: candidateId,
    candidate_fingerprint: candidateFingerprint,
    name: entry.name ?? basename(entry.entry_path),
    entry_path: entry.entry_path,
    active_root: entry.active_root,
    entry_kind: entry.entry_kind,
    entry_identity: identity,
    selected_action: null,
    persisted_decision: null,
    keep_status: 'none',
    keep_reason: null,
    groups,
    primary_group: groups[0],
    source,
    distribution_consumers: distributionConsumers,
    evidence,
    uncertainty: uncertaintyFor(entry, disposition.mutation_eligibility),
    topology_fingerprint: topologyFingerprint,
    scanner_schema: scan.metadata.schema_version,
    policy_version: POLICY_VERSION,
    scan_fingerprint: scanDigest,
    ...disposition,
  };
}

function compareCandidates(left, right) {
  const groupDifference = GROUP_ORDER.indexOf(left.primary_group) - GROUP_ORDER.indexOf(right.primary_group);
  if (groupDifference !== 0) return groupDifference;
  return compareStrings(left.candidate_id, right.candidate_id);
}

export function compileReview(scan, options = {}) {
  validateScan(scan);
  const digest = scanFingerprint(scan);
  const collisions = collisionNames(scan);
  const candidates = scan.entries.map((entry) => candidateFor(entry, scan, digest, collisions)).sort(compareCandidates);
  const executionEligible = options.executionEligible ?? true;
  const source = options.source ?? (executionEligible ? 'live_scan' : 'offline_scan');
  const reviewFingerprint = sha256Json({
    scan_fingerprint: digest,
    candidate_fingerprints: candidates.map((candidate) => candidate.candidate_fingerprint),
    scanner_schema: scan.metadata.schema_version,
    policy_version: POLICY_VERSION,
  });
  return {
    schema_version: SCHEMAS.review,
    product_version: '2.0',
    overall_status: 'review_ready',
    execution_eligible: executionEligible,
    source,
    scan_schema_version: scan.metadata.schema_version,
    scan_fingerprint: digest,
    review_fingerprint: reviewFingerprint,
    observed_entry_count: scan.entries.length,
    groups: GROUP_ORDER.filter((group) => candidates.some((candidate) => candidate.groups.includes(group))),
    candidates,
    executable_plan: null,
  };
}

function validatedDecisions(review, decisions) {
  requireObject(review, 'review must be an object');
  requireExactKeys(
    decisions,
    ['schema_version', 'review_fingerprint', 'decisions'],
    'decisions document contains unsupported fields',
  );
  if (review.schema_version !== SCHEMAS.review || decisions.schema_version !== SCHEMAS.decisions) {
    fail('invalid_schema', 'review or decisions schema mismatch');
  }
  if (decisions.review_fingerprint !== review.review_fingerprint) {
    fail('fingerprint_mismatch', 'decision and review fingerprint mismatch');
  }
  if (!Array.isArray(review.candidates) || !Array.isArray(decisions.decisions)) {
    fail('invalid_document', 'review candidates and decisions must be arrays');
  }
  const candidates = new Map(review.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const selected = new Map();
  for (const decision of decisions.decisions) {
    requireExactKeys(
      decision,
      ['candidate_id', 'action'],
      'each explicit decision must contain only candidate_id and action',
    );
    if (typeof decision.candidate_id !== 'string' || !candidates.has(decision.candidate_id)) {
      fail('invalid_decision', 'explicit decision references an unknown candidate');
    }
    if (!DECISION_ACTIONS.has(decision.action)) fail('invalid_decision', 'explicit decision action is unsupported');
    if (selected.has(decision.candidate_id)) fail('invalid_decision', 'duplicate explicit decision');
    selected.set(decision.candidate_id, { ...decision, candidate: candidates.get(decision.candidate_id) });
  }
  if (selected.size !== candidates.size) fail('incomplete_decisions', 'every candidate requires an explicit decision');
  return [...selected.values()];
}

export function computeKeepKey(candidate, observationIdentity) {
  const identity = validateKeepIdentity(candidate, observationIdentity);
  return sha256Json({
    candidate_id: candidate.candidate_id,
    observation_identity: identity,
    topology_fingerprint: candidate.topology_fingerprint,
    relevant_signals: candidate.evidence.relevant_signals,
    scanner_schema: candidate.scanner_schema,
    policy_version: candidate.policy_version,
  });
}

export function validateKeepStore(store) {
  requireExactKeys(store, ['schema_version', 'kept'], 'keep store contains unsupported fields');
  if (store.schema_version !== 'skills-refiner.cleanup.keep-decisions.v1'
      || !Array.isArray(store.kept) || store.kept.length > MAX_KEEP_RECORDS) {
    fail('invalid_schema', 'keep store schema mismatch');
  }
  const seen = new Set();
  for (const kept of store.kept) {
    requireExactKeys(
      kept,
      ['candidate_id', 'candidate_fingerprint', 'observation_identity_hash', 'keep_key'],
      'keep record contains unsupported fields',
    );
    if (![kept.candidate_id, kept.candidate_fingerprint, kept.observation_identity_hash, kept.keep_key]
      .every((value) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value))
      || seen.has(kept.candidate_id)) {
      fail('invalid_document', 'keep store record is invalid');
    }
    seen.add(kept.candidate_id);
  }
  return store;
}

export async function overlayPersistedKeeps(review, store, platform) {
  validateKeepStore(store);
  const stored = new Map(store.kept.map((record) => [record.candidate_id, record]));
  const candidates = [];
  for (const candidate of review.candidates) {
    const resetCandidate = {
      ...candidate,
      persisted_decision: null,
      keep_status: 'none',
      keep_reason: null,
    };
    const record = stored.get(candidate.candidate_id);
    if (record === undefined) {
      candidates.push(resetCandidate);
      continue;
    }
    if (candidate.governance_scope === 'outside_scope') {
      candidates.push({
        ...resetCandidate,
        keep_status: 'resurfaced',
        keep_reason: 'outside_governance_scope',
      });
      continue;
    }
    try {
      if (!platform || typeof platform.inspectIdentity !== 'function') {
        fail(
          'observation_identity_unavailable',
          'platform adapter is unavailable for observation',
          'platform_adapter_unavailable',
        );
      }
      const observationIdentity = await platform.inspectIdentity(
        candidate.entry_path,
        candidate.active_root,
        candidate,
      );
      const keepKey = computeKeepKey(candidate, observationIdentity);
      const current = record.candidate_fingerprint === candidate.candidate_fingerprint
        && record.observation_identity_hash === observationIdentity.identity_hash
        && record.keep_key === keepKey;
      candidates.push({
        ...resetCandidate,
        persisted_decision: current ? 'keep' : null,
        keep_status: current ? 'kept' : 'resurfaced',
        keep_reason: current ? null : 'fingerprint_mismatch',
      });
    } catch (error) {
      const failure = knownObservationFailure(error);
      if (failure === null) throw error;
      candidates.push({
        ...resetCandidate,
        keep_status: 'resurfaced',
        keep_reason: failure.reason,
      });
    }
  }
  return { ...review, candidates };
}

export async function compilePersistedDecisions(
  review,
  decisions,
  platform,
  existingStore = {
    schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
    kept: [],
  },
) {
  const selected = validatedDecisions(review, decisions);
  validateKeepStore(existingStore);
  const kept = new Map(existingStore.kept.map((record) => [record.candidate_id, record]));
  const failures = [];
  for (const { action, candidate } of selected) {
    if (candidate.governance_scope === 'outside_scope') {
      kept.delete(candidate.candidate_id);
      if (action === 'keep') {
        failures.push({
          candidate_id: candidate.candidate_id,
          code: 'outside_governance_scope',
          reason: 'outside_governance_scope',
        });
      }
      continue;
    }
    if (action === 'retire') {
      kept.delete(candidate.candidate_id);
      continue;
    }
    if (action === 'later') continue;
    try {
      if (!platform || typeof platform.inspectIdentity !== 'function') {
        fail(
          'observation_identity_unavailable',
          'platform adapter is unavailable for observation',
          'platform_adapter_unavailable',
        );
      }
      const observationIdentity = validateKeepIdentity(
        candidate,
        await platform.inspectIdentity(candidate.entry_path, candidate.active_root, candidate),
      );
      kept.set(candidate.candidate_id, {
        candidate_id: candidate.candidate_id,
        candidate_fingerprint: candidate.candidate_fingerprint,
        observation_identity_hash: observationIdentity.identity_hash,
        keep_key: computeKeepKey(candidate, observationIdentity),
      });
    } catch (error) {
      const failure = knownObservationFailure(error);
      if (failure === null) throw error;
      kept.delete(candidate.candidate_id);
      failures.push({ candidate_id: candidate.candidate_id, ...failure });
    }
  }
  const order = new Map(review.candidates.map((candidate, index) => [candidate.candidate_id, index]));
  failures.sort((left, right) => order.get(left.candidate_id) - order.get(right.candidate_id));
  const store = {
    schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
    kept: [...kept.values()].sort(
      (left, right) => compareStrings(left.candidate_id, right.candidate_id),
    ),
  };
  validateKeepStore(store);
  return { store, failures };
}

function validateKeepIdentity(candidate, identity) {
  try {
    validateObservationIdentity(identity);
  } catch {
    fail(
      'observation_identity_unavailable',
      'platform adapter did not provide a valid observation identity',
      'invalid_observation_identity',
    );
  }
  if (identity.entry_path !== candidate.entry_path
      || identity.active_root !== candidate.active_root
      || identity.entry_kind !== candidate.entry_kind) {
    fail(
      'observation_identity_unavailable',
      'platform adapter did not provide a matching observation identity',
      'mismatched_observation_identity',
    );
  }
  return identity;
}

function knownObservationFailure(error) {
  if (error instanceof CleanupCoreError && error.code === 'observation_identity_unavailable') {
    return { code: error.code, reason: error.reason };
  }
  if (typeof error?.name === 'string' && error.name.endsWith('AdapterError')
      && typeof error.code === 'string' && /^[a-z][a-z0-9_]*$/u.test(error.code)
      && error.code.length <= 128
      && typeof error.reason === 'string' && /^[a-z][a-z0-9_]*$/u.test(error.reason)
      && error.reason.length <= 128) {
    return { code: error.code, reason: error.reason };
  }
  return null;
}

function validateExecutionIdentity(candidate, identity) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)
      || identity.schema_version !== SCHEMAS.identity
      || typeof identity.adapter !== 'string' || identity.adapter.length === 0
      || identity.entry_path !== candidate.entry_path
      || identity.active_root !== candidate.active_root
      || identity.entry_kind !== candidate.entry_kind
      || typeof identity.identity_hash !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(identity.identity_hash)) {
    fail('execution_identity_unavailable', 'platform adapter did not provide a matching execution identity');
  }
  return identity;
}

function itemOrder(left, right) {
  const rank = { symlink: 0, broken_symlink: 0, directory: 1 };
  const difference = rank[left.candidate.entry_kind] - rank[right.candidate.entry_kind];
  if (difference !== 0) return difference;
  return compareStrings(left.candidate.candidate_id, right.candidate.candidate_id);
}

export async function compilePlan({
  review,
  decisions,
  created_at: createdAt,
  authorization_id: authorizationId,
}, platform) {
  if (review.execution_eligible !== true) fail('offline_review', 'offline review cannot compile an executable plan');
  if (!platform || typeof platform.name !== 'string' || typeof platform.inspectForPlan !== 'function') {
    fail('platform_adapter_unavailable', 'platform adapter is unavailable');
  }
  const selected = validatedDecisions(review, decisions);
  const retirements = selected.filter(({ action }) => action === 'retire').sort(itemOrder);
  for (const { candidate } of retirements) {
    if (candidate.governance_scope !== 'installed_or_distributed') {
      fail('outside_governance_scope', 'outside-scope candidate cannot be retired');
    }
    if (candidate.mutation_eligibility === 'review_only') {
      fail('review_only', 'review_only candidate cannot be retired');
    }
  }

  const items = [];
  for (const { candidate } of retirements) {
    const identity = validateExecutionIdentity(
      candidate,
      await platform.inspectForPlan(candidate.entry_path, candidate.active_root, candidate),
    );
    const item = {
      item_id: sha256Json({ candidate_id: candidate.candidate_id, identity_hash: identity.identity_hash }),
      action: 'quarantine',
      entry_path: candidate.entry_path,
      active_root: candidate.active_root,
      entry_kind: candidate.entry_kind,
      execution_identity: identity,
      preconditions: {
        review_fingerprint: review.review_fingerprint,
        candidate_fingerprint: candidate.candidate_fingerprint,
        scan_fingerprint: review.scan_fingerprint,
        execution_identity_hash: identity.identity_hash,
      },
      expected_postconditions: {
        active_entry_absent: true,
        quarantine_entry_present: true,
      },
      risk: 'reviewed',
    };
    item.item_hash = computeItemHash(item);
    items.push(item);
  }

  const plan = {
    schema_version: SCHEMAS.plan,
    product_version: '2.0',
    platform: platform.name,
    authorization_id: authorizationId ?? randomBytes(16).toString('hex'),
    scan_fingerprint: review.scan_fingerprint,
    created_at: createdAt ?? new Date().toISOString(),
    items,
  };
  plan.plan_hash = computePlanHash(plan);
  plan.items = plan.items.map((item) => ({
    ...item,
    transaction_id: deriveTransactionId(plan.plan_hash, item.item_id),
  }));
  return validatePlan(plan);
}
