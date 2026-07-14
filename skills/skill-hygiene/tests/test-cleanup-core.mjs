import assert from 'node:assert/strict';
import test from 'node:test';

import { computeIdentityHash, sha256Json, validatePlan } from '../lib/cleanup-contract.mjs';
import {
  compilePersistedDecisions,
  compilePlan,
  compileReview,
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
  return {
    name: 'macos',
    async inspectForPlan(entryPath, activeRoot) {
      const entryKind = entryPath.includes('skills/source-skill') ? 'symlink' : 'directory';
      const identity = {
        schema_version: 'skills-refiner.cleanup.identity.v1',
        adapter: 'macos-test.v1',
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
        receipt_sha256: entryKind === 'directory' ? 'a'.repeat(64) : null,
        installed_tree_sha1: entryKind === 'directory' ? 'b'.repeat(40) : null,
      };
      identity.identity_hash = computeIdentityHash(identity);
      return identity;
    },
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
  const review = compileReview(scanFixture(root));
  const gitSource = review.candidates.find((candidate) => candidate.entry_path === `${root}/workspace/source-skill`);
  assert.equal(gitSource.mutation_eligibility, 'review_only');
  assert.equal(gitSource.review_only_reason, 'authoring_source');

  const unknownDirectory = review.candidates.find((candidate) => candidate.name === 'authoring-copy');
  assert.equal(unknownDirectory.mutation_eligibility, 'review_only');
  assert.equal(unknownDirectory.review_only_reason, 'unproven_installed_copy');

  const link = eligible(review, 'source-skill');
  assert.equal(link.action_scope.kind, 'link_only');
  assert.equal(link.action_scope.target_mutated, false);
  assert.equal(link.source.git_root, `${root}/workspace/source-skill`);
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

test('Keep persists stable evidence while Later is session-only', () => withSandbox((root) => {
  const review = compileReview(scanFixture(root));
  const decisions = decisionsFor(review, 'later');
  decisions.decisions[0].action = 'keep';
  const persisted = compilePersistedDecisions(review, decisions);
  assert.equal(persisted.kept.length, 1);
  assert.equal(persisted.kept[0].candidate_id, decisions.decisions[0].candidate_id);
  assert.match(persisted.kept[0].keep_key, /^sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(persisted).includes('later'), false);

  const changed = compileReview(scanFixture(root, { changedSignal: true }));
  const priorCandidate = review.candidates.find(({ name }) => name === 'installed-copy');
  const changedCandidate = changed.candidates.find(({ name }) => name === 'installed-copy');
  assert.notEqual(priorCandidate.candidate_fingerprint, changedCandidate.candidate_fingerprint);
}));

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

  const first = await compilePlan({ review, decisions, created_at: '2026-07-14T00:00:00Z' }, platformFacts());
  const second = await compilePlan({ review, decisions, created_at: '2099-01-01T00:00:00Z' }, platformFacts());
  assert.equal(first.plan_hash, second.plan_hash);
  assert.deepEqual(first.items.map(({ item_hash: hash }) => hash), second.items.map(({ item_hash: hash }) => hash));
  assert.equal(first.items[0].entry_kind, 'symlink');
  assert.equal(first.items[1].entry_kind, 'directory');
  assert.ok(first.items.every(({ entry_path: path }) => path.startsWith(root)));
  assert.equal(JSON.stringify(first).includes('Use when exercising cleanup fixtures'), false);
  assert.equal(validatePlan(first).plan_hash, first.plan_hash);

  const changedTransaction = structuredClone(first);
  changedTransaction.items[0].transaction_id = sha256Json({ wrong: true });
  assert.throws(() => validatePlan(changedTransaction), /transaction_id/);
}));
