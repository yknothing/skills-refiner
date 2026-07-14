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
