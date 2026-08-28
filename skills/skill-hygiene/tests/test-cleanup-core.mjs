import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEMAS,
  computeIdentityHash,
  computeObservationIdentityHash,
  sha256Json,
  validatePlan,
} from '../lib/cleanup-contract.mjs';
import {
  MAX_KEEP_RECORDS,
  compilePersistedDecisions,
  compilePlan,
  compileReview,
  overlayPersistedKeeps,
  preApplyStatusAllowsBaseline,
  reconcilePostApplyScan,
  semanticIdentityHashForEntry,
  validateKeepStore,
} from '../lib/cleanup-core.mjs';
import {
  decisionsFor,
  makeSandbox,
  removeSandbox,
  scanFixture,
} from './cleanup-fixtures.mjs';

function withSandbox(run) {
  const root = makeSandbox();
  return Promise.resolve()
    .then(() => run(root))
    .finally(() => removeSandbox(root));
}

function eligible(review, name) {
  return review.candidates.find((candidate) => candidate.name === name && candidate.mutation_eligibility === 'eligible');
}

function platformFacts() {
  const inspectIdentity = async (entryPath, activeRoot) => {
    if (!['/.agents/skills', '/.claude/skills', '/.cursor/skills']
      .some((suffix) => activeRoot.endsWith(suffix))) {
      const error = new Error('read-only observation is outside installed skill roots');
      error.name = 'MacosAdapterError';
      error.code = 'blocked';
      error.reason = 'unrecognized_active_root';
      throw error;
    }
    const entryKind = entryPath.includes('skills/source-skill') ? 'symlink' : 'directory';
    const identity = {
      schema_version: SCHEMAS.observationIdentity,
      adapter: 'macos-test-observation.v1',
      entry_path: entryPath,
      active_root: activeRoot,
      entry_kind: entryKind,
      source_hash: sha256Json({ source: 1 }),
      binary_hash: sha256Json({ binary: 1 }),
      architecture: 'arm64',
      compiler_path: '/usr/bin/clang',
      compiler_version: 'Apple clang test',
      helper_protocol: 'skills-refiner.macos-helper.v1',
      cache_path: '/tmp/skills-refiner/helper',
      device: '1',
      inode: entryKind === 'symlink' ? '2' : '3',
      mode: 0o755,
      uid: 501,
      gid: 20,
      flags: 0,
      manifest_hash: sha256Json({ manifest: entryPath }),
      security_metadata_hash: sha256Json({ security: entryPath }),
      raw_link_target_base64: entryKind === 'symlink' ? Buffer.from('target').toString('base64') : null,
    };
    identity.identity_hash = computeObservationIdentityHash(identity);
    return identity;
  };
  const inspectForPlan = async (entryPath, activeRoot) => {
    const observed = await inspectIdentity(entryPath, activeRoot);
    const identity = {
      ...observed,
      schema_version: SCHEMAS.identity,
      adapter: 'macos-test.v1',
      receipt_sha256: observed.entry_kind === 'directory' ? 'a'.repeat(64) : null,
      installed_tree_sha1: observed.entry_kind === 'directory' ? 'b'.repeat(40) : null,
    };
    identity.identity_hash = computeIdentityHash(identity);
    return identity;
  };
  return {
    name: 'macos',
    inspectIdentity,
    inspectForPlan,
  };
}

test('candidate compiler groups evidence without selecting actions', () => withSandbox((root) => {
  const review = compileReview(scanFixture(root));
  assert.equal(review.schema_version, 'skills-refiner.cleanup.review.v1');
  assert.ok(review.candidates.length > 0);
  assert.ok(review.candidates.every((candidate) => candidate.selected_action === null));
  assert.ok(review.groups.includes('broken_distributions'));
  assert.ok(review.groups.includes('backup_remnants'));

  const broken = review.candidates.find((candidate) => candidate.entry_kind === 'broken_symlink');
  assert.equal(broken.entry_path, `${root}/.claude/skills/broken-link`);

  const sameName = review.candidates.filter((candidate) => candidate.name === 'source-skill');
  assert.ok(sameName.length >= 2);
  assert.equal(new Set(sameName.map(({ candidate_id: id }) => id)).size, sameName.length);
}));

test('source directories are review-only while distribution links remain link-only eligible', () => withSandbox((root) => {
  const scan = scanFixture(root);
  const review = compileReview(scan);
  const gitSource = review.candidates.find((candidate) => candidate.entry_path === `${root}/workspace/source-skill`);
  assert.equal(gitSource.mutation_eligibility, 'review_only');
  assert.equal(gitSource.review_only_reason, 'outside_governance_scope');
  assert.equal(gitSource.governance_scope, 'outside_scope');
  assert.deepEqual(gitSource.action_scope, { kind: 'none', target_mutated: false });

  const unknownDirectory = review.candidates.find((candidate) => candidate.name === 'authoring-copy');
  assert.equal(unknownDirectory.mutation_eligibility, 'review_only');
  assert.equal(unknownDirectory.review_only_reason, 'unproven_installed_copy');
  assert.equal(unknownDirectory.governance_scope, 'installed_or_distributed');

  const link = eligible(review, 'source-skill');
  assert.equal(link.action_scope.kind, 'link_only');
  assert.equal(link.action_scope.target_mutated, false);
  assert.equal(link.source.git_root, `${root}/workspace/source-skill`);

  const installedGitScan = structuredClone(scan);
  const installedGitEntry = installedGitScan.entries.find(({ name }) => name === 'authoring-copy');
  installedGitEntry.provenance = {
    kind: 'native_agent',
    source_url: '',
    git_root: installedGitEntry.entry_path,
    git_branch: 'main',
    confidence: 'direct',
  };
  const installedGit = compileReview(installedGitScan).candidates
    .find(({ candidate_id: candidateId }) => candidateId === unknownDirectory.candidate_id);
  assert.equal(installedGit.governance_scope, 'installed_or_distributed');
  assert.equal(installedGit.mutation_eligibility, 'review_only');
  assert.equal(installedGit.review_only_reason, 'authoring_source');

  const workspaceNonGitScan = structuredClone(scan);
  const workspaceNonGitEntry = workspaceNonGitScan.entries
    .find(({ entry_path: entryPath }) => entryPath === `${root}/workspace/source-skill`);
  workspaceNonGitEntry.provenance = {
    kind: 'unknown',
    source_url: '',
    git_root: '',
    git_branch: '',
    confidence: 'none',
  };
  const workspaceNonGit = compileReview(workspaceNonGitScan).candidates
    .find(({ candidate_id: candidateId }) => candidateId === gitSource.candidate_id);
  assert.equal(workspaceNonGit.governance_scope, 'outside_scope');
  assert.equal(workspaceNonGit.mutation_eligibility, 'review_only');
  assert.equal(workspaceNonGit.review_only_reason, 'outside_governance_scope');
  assert.deepEqual(workspaceNonGit.action_scope, { kind: 'none', target_mutated: false });
}));

test('machine candidates carry inspect evidence without terminal prose parsing', () => withSandbox((root) => {
  const review = compileReview(scanFixture(root));
  for (const candidate of review.candidates) {
    assert.equal(typeof candidate.entry_path, 'string');
    assert.equal(typeof candidate.active_root, 'string');
    assert.ok(candidate.source && typeof candidate.source === 'object');
    assert.ok(Array.isArray(candidate.distribution_consumers));
    assert.ok(Array.isArray(candidate.evidence.relevant_signals));
    assert.ok(Array.isArray(candidate.uncertainty));
    assert.ok(candidate.action_scope && typeof candidate.action_scope === 'object');
  }
}));

test('Keep binds the live observation identity while Later is session-only', () => withSandbox(async (root) => {
  const review = compileReview(scanFixture(root));
  const decisions = decisionsFor(review, 'later');
  const installed = eligible(review, 'installed-copy');
  decisions.decisions.find(({ candidate_id: id }) => id === installed.candidate_id).action = 'keep';
  const platform = platformFacts();
  const persistedResult = await compilePersistedDecisions(review, decisions, platform);
  assert.deepEqual(Object.keys(persistedResult), ['store', 'failures']);
  assert.deepEqual(persistedResult.failures, []);
  const persisted = persistedResult.store;
  assert.deepEqual(Object.keys(persisted), ['schema_version', 'kept']);
  assert.equal(persisted.kept.length, 1);
  assert.equal(persisted.kept[0].candidate_id, installed.candidate_id);
  assert.match(persisted.kept[0].keep_key, /^sha256:[0-9a-f]{64}$/);
  assert.match(persisted.kept[0].observation_identity_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(persisted.kept[0], 'execution_identity_hash'), false);
  assert.equal(JSON.stringify(persisted).includes('later'), false);
  const observationIdentity = await platform.inspectIdentity(
    installed.entry_path,
    installed.active_root,
  );
  assert.equal(persisted.kept[0].keep_key, sha256Json({
    candidate_id: installed.candidate_id,
    observation_identity: observationIdentity,
    topology_fingerprint: installed.topology_fingerprint,
    relevant_signals: installed.evidence.relevant_signals,
    scanner_schema: installed.scanner_schema,
    policy_version: installed.policy_version,
  }));

  const changedPlatform = platformFacts();
  const inspect = changedPlatform.inspectIdentity;
  changedPlatform.inspectIdentity = async (...args) => {
    const identity = await inspect(...args);
    identity.inode = '999';
    identity.identity_hash = computeObservationIdentityHash(identity);
    return identity;
  };
  const changedIdentity = await compilePersistedDecisions(review, decisions, changedPlatform);
  assert.notEqual(changedIdentity.store.kept[0].keep_key, persisted.kept[0].keep_key);

  const overlaid = await overlayPersistedKeeps(review, persisted, platformFacts());
  assert.equal(
    overlaid.candidates.find(({ candidate_id: id }) => id === installed.candidate_id).keep_status,
    'kept',
  );
  const resurfaced = await overlayPersistedKeeps(review, persisted, changedPlatform);
  assert.equal(
    resurfaced.candidates.find(({ candidate_id: id }) => id === installed.candidate_id).keep_status,
    'resurfaced',
  );
  assert.equal(resurfaced.candidates.length, review.candidates.length);

  const reset = await overlayPersistedKeeps(overlaid, {
    schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
    kept: [],
  });
  const resetInstalled = reset.candidates.find(({ candidate_id: id }) => id === installed.candidate_id);
  assert.equal(resetInstalled.persisted_decision, null);
  assert.equal(resetInstalled.keep_status, 'none');
  assert.equal(resetInstalled.keep_reason, null);
  assert.deepEqual(await overlayPersistedKeeps(overlaid, persisted, platformFacts()), overlaid);

  const laterOnly = decisionsFor(review, 'later');
  assert.deepEqual(
    (await compilePersistedDecisions(review, laterOnly, platformFacts(), persisted)).store,
    persisted,
  );
  const retired = decisionsFor(review, 'later');
  retired.decisions.find(({ candidate_id: id }) => id === installed.candidate_id).action = 'retire';
  assert.equal(
    (await compilePersistedDecisions(review, retired, platformFacts(), persisted)).store.kept.length,
    0,
  );

  const outside = review.candidates.find(({ governance_scope: scope }) => scope === 'outside_scope');
  const outsideDecisions = decisionsFor(review, 'later');
  outsideDecisions.decisions
    .find(({ candidate_id: id }) => id === outside.candidate_id).action = 'keep';
  const outsideResult = await compilePersistedDecisions(
    review,
    outsideDecisions,
    undefined,
  );
  assert.deepEqual(outsideResult.store.kept, []);
  assert.deepEqual(outsideResult.failures, [{
    candidate_id: outside.candidate_id,
    code: 'outside_governance_scope',
    reason: 'outside_governance_scope',
  }]);
  assert.deepEqual(Object.keys(outsideResult.failures[0]), ['candidate_id', 'code', 'reason']);

  const staleOutsideStore = {
    schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
    kept: [{
      candidate_id: outside.candidate_id,
      candidate_fingerprint: outside.candidate_fingerprint,
      observation_identity_hash: sha256Json({ stale: 'observation' }),
      keep_key: sha256Json({ stale: 'key' }),
    }],
  };
  assert.deepEqual(
    (await compilePersistedDecisions(
      review,
      decisionsFor(review, 'later'),
      undefined,
      staleOutsideStore,
    )).store.kept,
    [],
  );

  const changed = compileReview(scanFixture(root, { changedSignal: true }));
  const priorCandidate = review.candidates.find(({ name }) => name === 'installed-copy');
  const changedCandidate = changed.candidates.find(({ name }) => name === 'installed-copy');
  assert.notEqual(priorCandidate.candidate_fingerprint, changedCandidate.candidate_fingerprint);
}));

test('Keep compilation isolates known observation failures and rejects unknown programmer errors', () => withSandbox(async (root) => {
  const review = compileReview(scanFixture(root));
  const installed = eligible(review, 'installed-copy');
  const reviewOnlyInstalled = review.candidates.find(({ name }) => name === 'authoring-copy');
  const decisions = decisionsFor(review, 'later');
  decisions.decisions.find(({ candidate_id: id }) => id === installed.candidate_id).action = 'keep';
  decisions.decisions.find(({ candidate_id: id }) => id === reviewOnlyInstalled.candidate_id).action = 'keep';

  const initial = await compilePersistedDecisions(review, decisions, platformFacts());
  assert.equal(initial.store.kept.length, 2);
  assert.deepEqual(initial.failures, []);

  const partiallyBlocked = platformFacts();
  const inspect = partiallyBlocked.inspectIdentity;
  partiallyBlocked.inspectIdentity = async (entryPath, ...rest) => {
    if (entryPath === installed.entry_path) {
      const error = new Error('native metadata could not be observed');
      error.name = 'MacosAdapterError';
      error.code = 'blocked';
      error.reason = 'metadata_unsupported';
      throw error;
    }
    return inspect(entryPath, ...rest);
  };
  const isolated = await compilePersistedDecisions(
    review,
    decisions,
    partiallyBlocked,
    initial.store,
  );
  assert.deepEqual(isolated.failures, [{
    candidate_id: installed.candidate_id,
    code: 'blocked',
    reason: 'metadata_unsupported',
  }]);
  assert.deepEqual(
    isolated.store.kept.map(({ candidate_id: candidateId }) => candidateId),
    [reviewOnlyInstalled.candidate_id],
  );

  const invalidObservation = platformFacts();
  invalidObservation.inspectIdentity = async () => ({ invalid: true });
  const reversedDecisions = structuredClone(decisions);
  reversedDecisions.decisions.reverse();
  const invalid = await compilePersistedDecisions(
    review,
    reversedDecisions,
    invalidObservation,
    initial.store,
  );
  assert.equal(invalid.store.kept.length, 0);
  assert.deepEqual(invalid.failures, review.candidates
    .filter(({ candidate_id: candidateId }) => [installed.candidate_id, reviewOnlyInstalled.candidate_id]
      .includes(candidateId))
    .map((candidate) => ({
      candidate_id: candidate.candidate_id,
      code: 'observation_identity_unavailable',
      reason: 'invalid_observation_identity',
    })));

  const programmerError = platformFacts();
  programmerError.inspectIdentity = async () => {
    throw new TypeError('programmer error');
  };
  await assert.rejects(
    () => compilePersistedDecisions(review, decisions, programmerError, initial.store),
    /programmer error/,
  );

  const adapterUnavailable = await compilePersistedDecisions(
    review,
    decisions,
    undefined,
    initial.store,
  );
  assert.equal(adapterUnavailable.store.kept.length, 0);
  assert.deepEqual(adapterUnavailable.failures, review.candidates
    .filter(({ candidate_id: candidateId }) => [installed.candidate_id, reviewOnlyInstalled.candidate_id]
      .includes(candidateId))
    .map((candidate) => ({
      candidate_id: candidate.candidate_id,
      code: 'observation_identity_unavailable',
      reason: 'platform_adapter_unavailable',
    })));
}));

test('outside-scope entries of every kind never invoke Keep observation', () => withSandbox(async (root) => {
  for (const entryKind of ['directory', 'symlink', 'broken_symlink']) {
    const scan = scanFixture(root);
    const outsideEntry = scan.entries
      .find(({ entry_path: entryPath }) => entryPath === `${root}/workspace/source-skill`);
    outsideEntry.entry_kind = entryKind;
    outsideEntry.type = entryKind;
    outsideEntry.provenance = {
      kind: 'unknown',
      source_url: '',
      git_root: '',
      git_branch: '',
      confidence: 'none',
    };
    const review = compileReview(scan);
    const outside = review.candidates
      .find(({ entry_path: entryPath }) => entryPath === outsideEntry.entry_path);
    assert.equal(outside.governance_scope, 'outside_scope');
    assert.equal(outside.mutation_eligibility, 'review_only');
    assert.equal(outside.review_only_reason, 'outside_governance_scope');
    assert.deepEqual(outside.action_scope, { kind: 'none', target_mutated: false });

    const decisions = decisionsFor(review, 'later');
    decisions.decisions.find(({ candidate_id: candidateId }) => candidateId === outside.candidate_id)
      .action = 'keep';
    let observationCalls = 0;
    const rejectingPlatform = {
      name: 'macos',
      async inspectIdentity() {
        observationCalls += 1;
        throw new TypeError('outside-scope observation must not run');
      },
      async inspectForPlan() {
        throw new TypeError('outside-scope planning observation must not run');
      },
    };
    const compiled = await compilePersistedDecisions(review, decisions, rejectingPlatform);
    assert.deepEqual(compiled.failures, [{
      candidate_id: outside.candidate_id,
      code: 'outside_governance_scope',
      reason: 'outside_governance_scope',
    }]);
    const staleStore = {
      schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
      kept: [{
        candidate_id: outside.candidate_id,
        candidate_fingerprint: outside.candidate_fingerprint,
        observation_identity_hash: sha256Json({ entryKind, identity: 'stale' }),
        keep_key: sha256Json({ entryKind, keep: 'stale' }),
      }],
    };
    const overlaid = await overlayPersistedKeeps(review, staleStore, rejectingPlatform);
    const overlaidOutside = overlaid.candidates
      .find(({ candidate_id: candidateId }) => candidateId === outside.candidate_id);
    assert.equal(overlaidOutside.keep_status, 'resurfaced');
    assert.equal(overlaidOutside.keep_reason, 'outside_governance_scope');
    assert.equal(observationCalls, 0);

    const retire = decisionsFor(review, 'later');
    retire.decisions.find(({ candidate_id: candidateId }) => candidateId === outside.candidate_id)
      .action = 'retire';
    await assert.rejects(
      () => compilePlan({ review, decisions: retire }, rejectingPlatform),
      /outside-scope candidate cannot be retired/,
    );
  }
}));

test('Keep store validation is exact, duplicate-safe, and bounded by MAX_KEEP_RECORDS', () => {
  const record = (index) => ({
    candidate_id: sha256Json({ candidate: index }),
    candidate_fingerprint: sha256Json({ fingerprint: index }),
    observation_identity_hash: sha256Json({ observation: index }),
    keep_key: sha256Json({ keep: index }),
  });
  const valid = {
    schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
    kept: [record(0)],
  };
  assert.equal(validateKeepStore(valid), valid);
  assert.throws(
    () => validateKeepStore({ ...valid, schema_version: 'skills-refiner.cleanup.keep-decisions.v0' }),
    /schema mismatch/,
  );
  assert.throws(() => validateKeepStore({ ...valid, extra: true }), /unsupported fields/);
  assert.throws(
    () => validateKeepStore({ ...valid, kept: [{ ...record(0), extra: true }] }),
    /unsupported fields/,
  );
  assert.throws(() => validateKeepStore({ ...valid, kept: [record(0), record(0)] }), /invalid/);

  const atLimit = {
    schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
    kept: Array.from({ length: MAX_KEEP_RECORDS }, (_, index) => record(index)),
  };
  assert.equal(validateKeepStore(atLimit), atLimit);
  assert.throws(
    () => validateKeepStore({ ...atLimit, kept: [...atLimit.kept, record(MAX_KEEP_RECORDS)] }),
    /schema mismatch/,
  );
});

test('receipt and identity drift re-surface installed copies without changing stable candidate IDs', () => withSandbox((root) => {
  const originalScan = scanFixture(root);
  originalScan.entries[3].description = 'display text with\na legitimate newline';
  const original = compileReview(originalScan);
  const installed = eligible(original, 'installed-copy');

  const displayOnlyScan = structuredClone(originalScan);
  displayOnlyScan.entries[3].description = 'unrelated display text';
  const displayOnly = eligible(compileReview(displayOnlyScan), 'installed-copy');
  assert.equal(displayOnly.candidate_fingerprint, installed.candidate_fingerprint);

  const changedReceiptScan = structuredClone(originalScan);
  changedReceiptScan.entries[3].mutation_provenance.evidence.receipt_sha256 = 'd'.repeat(64);
  const changedReceipt = eligible(compileReview(changedReceiptScan), 'installed-copy');
  assert.equal(changedReceipt.candidate_id, installed.candidate_id);
  assert.notEqual(changedReceipt.candidate_fingerprint, installed.candidate_fingerprint);

  const invalidReceiptScan = structuredClone(originalScan);
  invalidReceiptScan.entries[3].mutation_provenance.evidence.receipt_sha256 = 'not-a-digest';
  const invalidReceipt = compileReview(invalidReceiptScan).candidates
    .find((candidate) => candidate.name === 'installed-copy');
  assert.equal(invalidReceipt.mutation_eligibility, 'review_only');
  assert.equal(invalidReceipt.review_only_reason, 'unproven_installed_copy');
}));

test('semantic identity hashes bind entry identity, source, provenance, and normalized content only', () => withSandbox((root) => {
  const original = scanFixture(root).entries[1];
  const baseline = semanticIdentityHashForEntry(original);
  const advisoryOnly = structuredClone(original);
  advisoryOnly.flags = ['dangerous_cmd'];
  advisoryOnly.risk_indicators = [{ id: 'different', severity: 'review_required' }];
  advisoryOnly.runtime_contract = { status: 'fail', loadable: false, load_blockers: ['changed'] };
  advisoryOnly.freshness = { mtime_epoch: 999, is_stale: true };
  advisoryOnly.location = '.different/topology';
  advisoryOnly.provenance.git_branch = 'changed-but-non-semantic';
  advisoryOnly.provenance.confidence = 'none';
  assert.equal(semanticIdentityHashForEntry(advisoryOnly), baseline);

  for (const changed of [
    { ...structuredClone(original), entry_path: `${original.entry_path}-changed` },
    {
      ...structuredClone(original),
      active_root: `${original.active_root}-changed`,
      entry_path: `${original.active_root}-changed/${original.name}`,
    },
    {
      ...structuredClone(original),
      entry_kind: 'broken_symlink',
      canonical_dir: null,
      normalized_content_sha256: null,
    },
    { ...structuredClone(original), raw_link_target_base64: Buffer.from('changed').toString('base64') },
    { ...structuredClone(original), canonical_dir: `${original.canonical_dir}-changed` },
    { ...structuredClone(original), provenance: { ...original.provenance, git_root: '/changed' } },
    { ...structuredClone(original), normalized_content_sha256: 'f'.repeat(64) },
  ]) {
    assert.notEqual(semanticIdentityHashForEntry(changed), baseline);
  }
}));

test('semantic identity rejects missing or malformed evidence instead of hashing defaults', () => withSandbox((root) => {
  const original = scanFixture(root).entries[1];
  const malformed = [
    { ...structuredClone(original), entry_path: null },
    { ...structuredClone(original), active_root: '' },
    { ...structuredClone(original), entry_kind: 'file' },
    { ...structuredClone(original), raw_link_target_base64: 'not base64' },
    { ...structuredClone(original), canonical_dir: null },
    { ...structuredClone(original), provenance: null },
    { ...structuredClone(original), provenance: { ...original.provenance, source_url: null } },
    { ...structuredClone(original), mutation_provenance: { kind: 'unknown', confidence: 'none', evidence: {} } },
    { ...structuredClone(original), normalized_content_sha256: null },
    { ...structuredClone(original), normalized_content_sha256: 'not-a-digest' },
  ];
  for (const entry of malformed) {
    assert.throws(() => semanticIdentityHashForEntry(entry), /semantic identity/i);
  }

  const validBroken = scanFixture(root).entries[0];
  delete validBroken.canonical_dir;
  delete validBroken.provenance;
  delete validBroken.normalized_content_sha256;
  assert.match(semanticIdentityHashForEntry(validBroken), /^sha256:[0-9a-f]{64}$/u);
  assert.throws(
    () => semanticIdentityHashForEntry({ ...validBroken, normalized_content_sha256: 'a'.repeat(64) }),
    /semantic identity/i,
  );
  assert.throws(
    () => semanticIdentityHashForEntry({
      ...structuredClone(original),
      provenance: { ...original.provenance, unexpected: true },
    }),
    /semantic identity/i,
  );
  assert.throws(
    () => semanticIdentityHashForEntry({
      ...structuredClone(original),
      mutation_provenance: {
        ...original.mutation_provenance,
        unexpected: true,
      },
    }),
    /semantic identity/i,
  );
  const installed = scanFixture(root).entries[3];
  const installedHash = semanticIdentityHashForEntry(installed);
  installed.mutation_provenance.evidence.receipt_file = `${root}/.agents/.skill-lock.json`;
  assert.equal(semanticIdentityHashForEntry(installed), installedHash);
  installed.mutation_provenance.evidence.receipt_file = null;
  assert.throws(() => semanticIdentityHashForEntry(installed), /semantic identity/i);

  const scanV6Entry = structuredClone(original);
  scanV6Entry.provenance = {
    ...scanV6Entry.provenance,
    confidence: 'heuristic',
    source_provider: null,
    repository_id: null,
    source_path: null,
    resolved_revision: null,
    claim_kind: null,
  };
  assert.match(semanticIdentityHashForEntry(scanV6Entry), /^sha256:[0-9a-f]{64}$/u);

  const indexedScanV6Entry = {
    ...structuredClone(scanV6Entry),
    provenance: {
      ...scanV6Entry.provenance,
      source_url: 'https://github.com/example/skills.git',
      source_provider: 'github',
      repository_id: 'example/skills',
      source_path: 'skills/source-skill',
      resolved_revision: 'c'.repeat(40),
      claim_kind: 'index_claim',
      git_root: '',
      git_branch: '',
      confidence: 'controller_unverified',
    },
  };
  assert.match(semanticIdentityHashForEntry(indexedScanV6Entry), /^sha256:[0-9a-f]{64}$/u);
  indexedScanV6Entry.provenance.confidence = 'direct';
  assert.throws(() => semanticIdentityHashForEntry(indexedScanV6Entry), /semantic identity/i);
}));

test('post-apply scan reconciliation exposes exact conservative Agent truth', () => withSandbox((root) => {
  const scan = scanFixture(root);
  const entry = scan.entries[1];
  const plan = {
    items: [{
      item_id: sha256Json({ item: 1 }),
      transaction_id: sha256Json({ transaction: 1 }),
      entry_path: entry.entry_path,
      active_root: entry.active_root,
      entry_kind: entry.entry_kind,
      execution_identity: {
        manifest_hash: sha256Json({ manifest: 1 }),
        raw_link_target_base64: entry.raw_link_target_base64,
      },
    }],
  };
  const transactionId = plan.items[0].transaction_id;
  const hash = semanticIdentityHashForEntry(entry);
  const baselineByTransactionId = new Map([[transactionId, hash]]);
  const committedTransactionIds = [transactionId];
  const statusByTransactionId = new Map([[transactionId, { ok: true, location: 'rehydrated' }]]);
  const nativeIdentity = {
    ok: true,
    identity: {
      identity_hash: sha256Json({ native: 1 }),
      entry_path: entry.entry_path,
      active_root: entry.active_root,
      entry_kind: entry.entry_kind,
      manifest_hash: plan.items[0].execution_identity.manifest_hash,
      raw_link_target_base64: entry.raw_link_target_base64,
    },
  };
  const nativeIdentityBeforeByTransactionId = new Map([[transactionId, nativeIdentity]]);
  const nativeIdentityAfterByTransactionId = new Map([[transactionId, structuredClone(nativeIdentity)]]);
  const reconcile = (overrides = {}) => reconcilePostApplyScan({
    plan,
    committedTransactionIds,
    baselineByTransactionId,
    scan,
    scanAvailable: true,
    statusByTransactionId,
    nativeIdentityBeforeByTransactionId,
    nativeIdentityAfterByTransactionId,
    ...overrides,
  });

  const rehydrated = reconcile();
  assert.equal(rehydrated.observation_status, 'COMPLETE');
  assert.equal(rehydrated.scanner_schema, 'skill-scan.v5');
  assert.equal(rehydrated.error_code, null);
  assert.deepEqual(rehydrated.items[0], {
    item_id: plan.items[0].item_id,
    transaction_id: transactionId,
    entry_path: entry.entry_path,
    status: 'REHYDRATED',
    location: 'rehydrated',
    baseline_identity_hash: hash,
    observed_identity_hash: hash,
  });
  assert.deepEqual(rehydrated.warnings, [
    'installer_may_redeploy',
    'running_agent_may_cache',
    'automatic_requarantine_disabled',
  ]);

  const duplicateScan = structuredClone(scan);
  duplicateScan.entries.push(structuredClone(entry));
  assert.equal(reconcile({ scan: duplicateScan }).items[0].status, 'RESTORE_CONFLICT');
  assert.equal(reconcile({ baselineByTransactionId: new Map() }).items[0].status, 'RESTORE_CONFLICT');
  const invalidBaseline = reconcile({
    baselineByTransactionId: new Map(),
    baselineIdentityUnavailableTransactionIds: new Set([transactionId]),
  });
  assert.equal(invalidBaseline.observation_status, 'PARTIAL');
  assert.equal(invalidBaseline.error_code, 'semantic_identity_unavailable');
  assert.equal(invalidBaseline.items[0].status, 'RESTORE_CONFLICT');
  const statusUnavailable = reconcile({
    statusByTransactionId: new Map([[transactionId, { ok: false, location: null }]]),
  });
  assert.equal(statusUnavailable.observation_status, 'PARTIAL');
  assert.equal(statusUnavailable.error_code, 'status_unavailable');
  assert.equal(statusUnavailable.items[0].status, 'INDETERMINATE');

  const unavailable = reconcile({
    scan: null,
    scanAvailable: false,
    scanErrorCode: 'scanner_unavailable',
  });
  assert.equal(unavailable.observation_status, 'UNAVAILABLE');
  assert.equal(unavailable.scanner_schema, null);
  assert.equal(unavailable.error_code, 'scanner_unavailable');
  assert.equal(unavailable.items[0].status, 'INDETERMINATE');

  const quarantinedScan = structuredClone(scan);
  quarantinedScan.entries = quarantinedScan.entries.filter(({ entry_path: path }) => (
    path !== entry.entry_path
  ));
  const quarantined = reconcile({
    scan: quarantinedScan,
    statusByTransactionId: new Map([[transactionId, { ok: true, location: 'quarantine' }]]),
  });
  assert.equal(quarantined.items[0].status, 'QUARANTINED');
  assert.equal(quarantined.items[0].location, 'quarantine');
  assert.equal(quarantined.warnings.includes('automatic_requarantine_disabled'), false);

  const contradictoryQuarantine = reconcile({
    statusByTransactionId: new Map([[transactionId, { ok: true, location: 'quarantine' }]]),
  });
  assert.equal(contradictoryQuarantine.items[0].status, 'INDETERMINATE');
  assert.equal(contradictoryQuarantine.items[0].location, 'unknown');
  assert.equal(contradictoryQuarantine.error_code, 'observation_race');

  const changedScan = structuredClone(scan);
  changedScan.entries.find(({ entry_path: path }) => path === entry.entry_path)
    .normalized_content_sha256 = 'e'.repeat(64);
  assert.equal(reconcile({ scan: changedScan }).items[0].status, 'RESTORE_CONFLICT');

  const malformedScan = structuredClone(scan);
  malformedScan.entries.find(({ entry_path: path }) => path === entry.entry_path)
    .normalized_content_sha256 = null;
  const malformed = reconcile({ scan: malformedScan });
  assert.equal(malformed.observation_status, 'PARTIAL');
  assert.equal(malformed.error_code, 'semantic_identity_unavailable');
  assert.equal(malformed.items[0].status, 'RESTORE_CONFLICT');

  const nativeUnavailable = reconcile({
    nativeIdentityBeforeByTransactionId: new Map([[
      transactionId,
      { ok: false, identity: null },
    ]]),
  });
  assert.equal(nativeUnavailable.items[0].status, 'INDETERMINATE');
  assert.equal(nativeUnavailable.error_code, 'observation_race');

  const nativeMismatch = structuredClone(nativeIdentity);
  nativeMismatch.identity.identity_hash = sha256Json({ native: 'changed' });
  const mismatched = reconcile({
    nativeIdentityAfterByTransactionId: new Map([[transactionId, nativeMismatch]]),
  });
  assert.equal(mismatched.items[0].status, 'INDETERMINATE');
  assert.equal(mismatched.error_code, 'observation_race');
}));

test('scan v6 provenance binds semantic, review, and candidate authorization', () => withSandbox((root) => {
  const asV6 = (scan) => {
    const result = structuredClone(scan);
    result.metadata.schema_version = 'skill-scan.v6';
    result.entries = result.entries.map((entry) => ({
      ...entry,
      provenance: {
        ...entry.provenance,
        confidence: entry.provenance.confidence === 'direct'
          ? 'heuristic'
          : entry.provenance.confidence,
        source_provider: null,
        repository_id: null,
        source_path: null,
        resolved_revision: null,
        claim_kind: null,
      },
    }));
    result.skills = result.entries.filter((entry) => entry.entry_kind === 'directory');
    result.skill_links = result.entries.filter((entry) => entry.entry_kind === 'symlink');
    result.broken_symlinks = result.entries.filter((entry) => entry.entry_kind === 'broken_symlink');
    return result;
  };
  const scan = asV6(scanFixture(root));
  const entry = scan.entries[1];
  entry.provenance = {
    ...entry.provenance,
    source_url: 'https://github.com/example/skills.git',
    source_provider: 'git',
    repository_id: 'github.com/example/skills',
    source_path: 'skills/source-skill',
    confidence: 'direct',
  };
  const semanticBaseline = semanticIdentityHashForEntry(entry);
  const reviewBaseline = compileReview(scan);
  const candidateBaseline = reviewBaseline.candidates.find(({ entry_path: path }) => path === entry.entry_path);

  const changedScan = structuredClone(scan);
  const changedEntry = changedScan.entries.find(({ entry_path: path }) => path === entry.entry_path);
  changedEntry.provenance.source_url = 'https://github.com/example/other-skills.git';
  changedEntry.provenance.repository_id = 'github.com/example/other-skills';
  assert.notEqual(semanticIdentityHashForEntry(changedEntry), semanticBaseline);
  const changedReview = compileReview(changedScan);
  const changedCandidate = changedReview.candidates.find(({ entry_path: path }) => path === entry.entry_path);
  assert.notEqual(changedReview.review_fingerprint, reviewBaseline.review_fingerprint);
  assert.notEqual(changedCandidate.candidate_fingerprint, candidateBaseline.candidate_fingerprint);

  const mismatchedRepository = structuredClone(scan);
  mismatchedRepository.entries.find(({ entry_path: path }) => path === entry.entry_path)
    .provenance.repository_id = 'github.com/example/other-skills';
  assert.throws(() => compileReview(mismatchedRepository), /semantic identity/i);

  const credentialUrl = structuredClone(scan);
  credentialUrl.entries.find(({ entry_path: path }) => path === entry.entry_path)
    .provenance.source_url = 'https://user:SECRET_TOKEN@github.com/example/skills.git';
  assert.throws(() => compileReview(credentialUrl), /semantic identity/i);

  const providerlessUrl = structuredClone(scan);
  const providerlessEntry = providerlessUrl.entries.find(({ entry_path: path }) => path === entry.entry_path);
  providerlessEntry.provenance.source_provider = null;
  providerlessEntry.provenance.repository_id = null;
  assert.throws(() => compileReview(providerlessUrl), /semantic identity/i);

  const falseDirect = structuredClone(scan);
  const falseDirectEntry = falseDirect.entries.find(({ entry_path: path }) => path === entry.entry_path);
  falseDirectEntry.provenance.source_url = '';
  falseDirectEntry.provenance.source_provider = null;
  falseDirectEntry.provenance.repository_id = null;
  falseDirectEntry.provenance.source_path = null;
  assert.throws(() => compileReview(falseDirect), /semantic identity/i);

  const missingGitRoot = structuredClone(scan);
  missingGitRoot.entries.find(({ entry_path: path }) => path === entry.entry_path)
    .provenance.git_root = '';
  assert.throws(() => compileReview(missingGitRoot), /semantic identity/i);

  const changedPath = structuredClone(entry);
  changedPath.provenance.source_path = 'skills/renamed-source-skill';
  assert.notEqual(semanticIdentityHashForEntry(changedPath), semanticBaseline);

  const indexed = structuredClone(entry);
  indexed.provenance = {
    ...indexed.provenance,
    source_url: 'https://github.com/example/skills.git',
    source_provider: 'github',
    repository_id: 'example/skills',
    source_path: 'skills/source-skill',
    resolved_revision: 'd'.repeat(40),
    claim_kind: 'index_claim',
    git_root: '',
    git_branch: '',
    confidence: 'controller_unverified',
  };
  const indexedBaseline = semanticIdentityHashForEntry(indexed);
  indexed.provenance.resolved_revision = 'e'.repeat(40);
  assert.notEqual(semanticIdentityHashForEntry(indexed), indexedBaseline);
  indexed.provenance.resolved_revision = 'not-a-revision';
  assert.throws(() => semanticIdentityHashForEntry(indexed), /semantic identity/i);

  const downgradedV6 = structuredClone(scan);
  const downgradedEntry = downgradedV6.entries.find(({ entry_path: path }) => path === entry.entry_path);
  for (const key of ['source_provider', 'repository_id', 'source_path', 'resolved_revision', 'claim_kind']) {
    delete downgradedEntry.provenance[key];
  }
  assert.throws(() => compileReview(downgradedV6), /semantic identity/i);

  const upgradedV5 = scanFixture(root);
  upgradedV5.entries[1].provenance = {
    ...upgradedV5.entries[1].provenance,
    source_provider: null,
    repository_id: null,
    source_path: null,
    resolved_revision: null,
    claim_kind: null,
  };
  assert.throws(() => compileReview(upgradedV5), /semantic identity/i);
}));

test('pre-apply baseline eligibility excludes prior committed and ambiguous retry occupants', () => {
  assert.equal(preApplyStatusAllowsBaseline({
    ok: false,
    error_code: 'transaction_unavailable',
  }), true);
  assert.equal(preApplyStatusAllowsBaseline({
    ok: true,
    state: 'APPLYING',
    location: 'original',
    transaction_has_mutated: false,
  }), true);
  assert.equal(preApplyStatusAllowsBaseline({
    ok: true,
    state: 'PLANNED',
    location: 'original',
    transaction_has_mutated: false,
  }), true);
  for (const status of [
    { ok: true, state: 'COMMITTED', location: 'quarantine', transaction_has_mutated: true },
    { ok: true, state: 'COMMITTED', location: 'rehydrated', transaction_has_mutated: true },
    { ok: false, error_code: 'status_unavailable' },
  ]) {
    assert.equal(preApplyStatusAllowsBaseline(status), false);
  }
});

test('plan compilation requires explicit matched decisions and execution identity', () => withSandbox(async (root) => {
  const review = compileReview(scanFixture(root));
  const incomplete = decisionsFor(review);
  incomplete.decisions.pop();
  await assert.rejects(() => compilePlan({ review, decisions: incomplete }, platformFacts()), /explicit decision/);

  const mismatched = decisionsFor(review);
  mismatched.review_fingerprint = sha256Json({ changed: true });
  await assert.rejects(() => compilePlan({ review, decisions: mismatched }, platformFacts()), /fingerprint/);

  const injected = decisionsFor(review);
  injected.decisions[0].note = 'must not enter a plan';
  await assert.rejects(() => compilePlan({ review, decisions: injected }, platformFacts()), /only candidate_id and action/);

  const reviewOnly = review.candidates.find((candidate) => candidate.mutation_eligibility === 'review_only');
  const unsafe = decisionsFor(review);
  unsafe.decisions.find(({ candidate_id: id }) => id === reviewOnly.candidate_id).action = 'retire';
  await assert.rejects(() => compilePlan({ review, decisions: unsafe }, platformFacts()), /review_only/);

  const installed = eligible(review, 'installed-copy');
  const selected = decisionsFor(review);
  selected.decisions.find(({ candidate_id: id }) => id === installed.candidate_id).action = 'retire';
  await assert.rejects(
    () => compilePlan({ review, decisions: selected }, { name: 'macos', inspectForPlan: async () => null }),
    /execution identity/,
  );
  await assert.rejects(
    () => compilePlan({ review, decisions: selected }, {
      name: 'macos',
      inspectForPlan: async () => ({
        schema_version: 'skills-refiner.cleanup.identity.v1',
        adapter: 'macos-test.v1',
        entry_path: installed.entry_path,
        active_root: installed.active_root,
        entry_kind: installed.entry_kind,
        identity_hash: 'not-a-digest',
      }),
    }),
    /execution identity/,
  );
}));

test('plans are deterministic, link-first, content-free, and contract-valid', () => withSandbox(async (root) => {
  const review = compileReview(scanFixture(root));
  const link = eligible(review, 'source-skill');
  const installed = eligible(review, 'installed-copy');
  const decisions = decisionsFor(review);
  decisions.decisions.find(({ candidate_id: id }) => id === link.candidate_id).action = 'retire';
  decisions.decisions.find(({ candidate_id: id }) => id === installed.candidate_id).action = 'retire';

  const authorization_id = '0'.repeat(32);
  const first = await compilePlan({
    review,
    decisions,
    created_at: '2026-07-14T00:00:00Z',
    authorization_id,
  }, platformFacts());
  const second = await compilePlan({
    review,
    decisions,
    created_at: '2099-01-01T00:00:00Z',
    authorization_id,
  }, platformFacts());
  assert.equal(first.plan_hash, second.plan_hash);
  assert.deepEqual(first.items.map(({ item_hash: hash }) => hash), second.items.map(({ item_hash: hash }) => hash));
  assert.equal(first.items[0].entry_kind, 'symlink');
  assert.equal(first.items[1].entry_kind, 'directory');
  assert.ok(first.items.every(({ entry_path: path }) => path.startsWith(root)));
  assert.equal(JSON.stringify(first).includes('Use when exercising cleanup fixtures'), false);
  assert.equal(validatePlan(first).plan_hash, first.plan_hash);

  const newlyAuthorized = await compilePlan({
    review,
    decisions,
    created_at: '2026-07-14T00:00:00Z',
    authorization_id: '1'.repeat(32),
  }, platformFacts());
  assert.notEqual(newlyAuthorized.plan_hash, first.plan_hash);

  const changedTransaction = structuredClone(first);
  changedTransaction.items[0].transaction_id = sha256Json({ wrong: true });
  assert.throws(() => validatePlan(changedTransaction), /transaction_id/);
}));
