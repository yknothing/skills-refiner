import { basename } from 'node:path';

import {
  SCHEMAS,
  computeItemHash,
  computePlanHash,
  deriveTransactionId,
  sha256Json,
  validatePlan,
} from './cleanup-contract.mjs';

export const POLICY_VERSION = 'skill-disposition.v1';

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
  constructor(code, message) {
    super(message);
    this.name = 'CleanupCoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CleanupCoreError(code, message);
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

function validateScan(scan) {
  requireObject(scan, 'scan must be an object');
  if (scan.metadata?.schema_version !== 'skill-scan.v5' || !Array.isArray(scan.entries)) {
    fail('invalid_schema', 'expected a skill-scan.v5 document');
  }
  return scan;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
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
    fail('invalid_schema', 'scan entry is missing execution identity fields');
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
    source: sourceEvidence(entry),
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

function eligibility(entry) {
  if (entry.entry_kind === 'symlink' || entry.entry_kind === 'broken_symlink') {
    return {
      mutation_eligibility: 'eligible',
      review_only_reason: null,
      action_scope: { kind: 'link_only', target_mutated: false },
    };
  }
  if (entry.provenance?.git_root) {
    return {
      mutation_eligibility: 'review_only',
      review_only_reason: 'authoring_source',
      action_scope: { kind: 'none', target_mutated: false },
    };
  }
  if (!directInstalledCopy(entry)) {
    return {
      mutation_eligibility: 'review_only',
      review_only_reason: 'unproven_installed_copy',
      action_scope: { kind: 'none', target_mutated: false },
    };
  }
  return {
    mutation_eligibility: 'eligible',
    review_only_reason: null,
    action_scope: { kind: 'installed_entry_only', target_mutated: true },
  };
}

function sourceEvidence(entry) {
  return {
    kind: entry.provenance?.kind ?? 'unknown',
    canonical_target: entry.canonical_dir || null,
    git_root: entry.provenance?.git_root || null,
    git_branch: entry.provenance?.git_branch || null,
    confidence: entry.provenance?.confidence ?? 'none',
  };
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
  const disposition = eligibility(entry);
  const distributionConsumers = consumersFor(entry, scan.entries);
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
    topology_fingerprint: topologyFingerprint,
    relevant_signals: signals,
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
    groups,
    primary_group: groups[0],
    source: sourceEvidence(entry),
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

export function compilePersistedDecisions(review, decisions) {
  const selected = validatedDecisions(review, decisions);
  return {
    schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
    kept: selected
      .filter(({ action }) => action === 'keep')
      .map(({ candidate }) => ({
        candidate_id: candidate.candidate_id,
        candidate_fingerprint: candidate.candidate_fingerprint,
        keep_key: sha256Json({
          candidate_id: candidate.candidate_id,
          entry_identity: {
            entry_path: candidate.entry_path,
            active_root: candidate.active_root,
            entry_kind: candidate.entry_kind,
          },
          topology_fingerprint: candidate.topology_fingerprint,
          relevant_signals: candidate.evidence.relevant_signals,
          scanner_schema: candidate.scanner_schema,
          policy_version: candidate.policy_version,
        }),
      }))
      .sort((left, right) => compareStrings(left.candidate_id, right.candidate_id)),
  };
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

export async function compilePlan({ review, decisions, created_at: createdAt }, platform) {
  if (review.execution_eligible !== true) fail('offline_review', 'offline review cannot compile an executable plan');
  if (!platform || typeof platform.name !== 'string' || typeof platform.inspectForPlan !== 'function') {
    fail('platform_adapter_unavailable', 'platform adapter is unavailable');
  }
  const selected = validatedDecisions(review, decisions);
  const retirements = selected.filter(({ action }) => action === 'retire').sort(itemOrder);
  for (const { candidate } of retirements) {
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
