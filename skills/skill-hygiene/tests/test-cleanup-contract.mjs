import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEMAS,
  canonicalJson,
  computeIdentityHash,
  computeItemHash,
  computePlanHash,
  deriveTransactionId,
  sha256Json,
  transactionStorageKey,
  validatePlan,
  validateTransactionResult,
} from '../lib/cleanup-contract.mjs';

function validPlan(overrides = {}) {
  const executionIdentity = {
    schema_version: SCHEMAS.identity,
    adapter: 'macos-test.v1',
    entry_path: '/Users/example/.agents/skills/demo',
    active_root: '/Users/example/.agents/skills',
    entry_kind: 'directory',
    source_hash: sha256Json({ source: 1 }),
    binary_hash: sha256Json({ binary: 1 }),
    architecture: 'arm64',
    compiler_path: '/usr/bin/clang',
    compiler_version: 'Apple clang test',
    helper_protocol: 'skills-refiner.macos-helper.v1',
    cache_path: '/Users/example/.agents/skills-refiner/runtime/helper',
    device: '1',
    inode: '2',
    mode: 0o755,
    uid: 501,
    gid: 20,
    flags: 0,
    manifest_hash: sha256Json({ manifest: 1 }),
    security_metadata_hash: sha256Json({ security: 1 }),
    raw_link_target_base64: null,
    receipt_sha256: 'a'.repeat(64),
    installed_tree_sha1: 'b'.repeat(40),
  };
  executionIdentity.identity_hash = computeIdentityHash(executionIdentity);
  const plan = {
    schema_version: SCHEMAS.plan,
    product_version: '2.0',
    platform: 'macos',
    authorization_id: '0'.repeat(32),
    scan_fingerprint: sha256Json({ scan: 1 }),
    created_at: '2026-07-14T00:00:00.000Z',
    items: [
      {
        item_id: 'item-1',
        action: 'quarantine',
        entry_path: '/Users/example/.agents/skills/demo',
        active_root: '/Users/example/.agents/skills',
        entry_kind: 'directory',
        execution_identity: executionIdentity,
        preconditions: {
          review_fingerprint: sha256Json({ review: 1 }),
          candidate_fingerprint: sha256Json({ candidate: 1 }),
          scan_fingerprint: sha256Json({ scan: 1 }),
          execution_identity_hash: executionIdentity.identity_hash,
        },
        expected_postconditions: {
          active_entry_absent: true,
          quarantine_entry_present: true,
        },
        risk: 'reviewed',
      },
    ],
    ...overrides,
  };
  plan.items = plan.items.map((item) => ({ ...item, item_hash: computeItemHash(item) }));
  plan.plan_hash = computePlanHash(plan);
  plan.items = plan.items.map((item) => ({
    ...item,
    transaction_id: deriveTransactionId(plan.plan_hash, item.item_id),
  }));
  return plan;
}

test('canonical JSON sorts nested keys by Unicode code point', () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, x: 3 } }),
    '{"a":{"x":3,"y":2},"z":1}',
  );
  assert.equal(canonicalJson({ '\u{10000}': 2, '\u{e000}': 1 }), '{"":1,"𐀀":2}');
});

test('canonical JSON rejects values that are not safe JSON data', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined, 1n, new Date()]) {
    assert.throws(() => canonicalJson(value), /JSON-compatible/);
  }
  assert.throws(() => canonicalJson([, 1]), /sparse/);
  assert.throws(() => canonicalJson({ value: 'unsafe\u001b[31m' }), /control/);
  assert.throws(() => canonicalJson({ '\u0001unsafe': 1 }), /JSON-compatible/);

  const customArray = [1];
  customArray['01'] = 2;
  assert.throws(() => canonicalJson(customArray), /JSON-compatible/);

  let accessorExecuted = false;
  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get() {
      accessorExecuted = true;
      return 1;
    },
  });
  accessorArray.length = 1;
  assert.throws(() => canonicalJson(accessorArray), /JSON-compatible/);
  assert.equal(accessorExecuted, false);
});

test('hash primitives are deterministic and schema-shaped', () => {
  assert.match(sha256Json({ b: 2, a: 1 }), /^sha256:[0-9a-f]{64}$/);
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
});

test('public transaction IDs map to Windows-safe storage keys', () => {
  const transactionId = sha256Json({ transaction: 'portable' });
  const storageKey = transactionStorageKey(transactionId);
  assert.match(storageKey, /^[0-9a-f]{64}$/u);
  assert.equal(storageKey.includes(':'), false);
  assert.throws(() => transactionStorageKey(storageKey), /transaction_id/);
});

test('plan hash excludes created_at and derived transaction IDs', () => {
  const first = validPlan();
  const second = validPlan({ created_at: '2099-01-01T00:00:00.000Z' });
  assert.equal(first.plan_hash, second.plan_hash);
  assert.equal(computePlanHash(first), first.plan_hash);

  const newAuthorization = validPlan({ authorization_id: '1'.repeat(32) });
  assert.notEqual(first.plan_hash, newAuthorization.plan_hash);
});

test('plan validator rejects a scanner document before adapter work', () => {
  assert.throws(
    () => validatePlan({ schema_version: 'skill-scan.v5' }),
    /expected skills-refiner\.cleanup\.plan\.v1/,
  );
});

test('plan validator enforces actions, semantic IDs, hashes, and keys', () => {
  assert.equal(validatePlan(validPlan()).schema_version, SCHEMAS.plan);

  const unknownAction = validPlan();
  unknownAction.items[0].action = 'delete';
  assert.throws(() => validatePlan(unknownAction), /action/);

  const duplicate = validPlan();
  duplicate.items.push({ ...duplicate.items[0] });
  duplicate.plan_hash = computePlanHash(duplicate);
  duplicate.items = duplicate.items.map((item) => ({
    ...item,
    transaction_id: deriveTransactionId(duplicate.plan_hash, item.item_id),
  }));
  assert.throws(() => validatePlan(duplicate), /duplicate item_id/);

  const wrongPlanHash = validPlan();
  wrongPlanHash.plan_hash = sha256Json({ wrong: true });
  assert.throws(() => validatePlan(wrongPlanHash), /plan_hash/);

  const wrongTransaction = validPlan();
  wrongTransaction.items[0].transaction_id = sha256Json({ wrong: true });
  assert.throws(() => validatePlan(wrongTransaction), /transaction_id/);

  const unknownKey = validPlan({ unexpected: true });
  assert.throws(() => validatePlan(unknownKey), /unknown key/);
});

test('validation errors never echo unsafe field contents', () => {
  const secret = 'secret-value-never-echo';
  const plan = validPlan();
  plan.items[0].risk = `${secret}\u0001`;
  assert.throws(
    () => validatePlan(plan),
    (error) => error instanceof Error && !error.message.includes(secret),
  );

  const secretKey = 'secret-key-never-echo';
  assert.throws(
    () => canonicalJson({ [secretKey]: undefined }),
    (error) => error instanceof Error && !error.message.includes(secretKey),
  );
});

test('nested plan objects cannot carry arbitrary content even with valid hashes', () => {
  for (const field of ['preconditions', 'expected_postconditions']) {
    const plan = validPlan();
    plan.items[0][field] = { skill_content: 'embedded-content' };
    plan.plan_hash = computePlanHash(plan);
    plan.items[0].transaction_id = deriveTransactionId(plan.plan_hash, plan.items[0].item_id);
    assert.throws(() => validatePlan(plan), /unknown key/);
  }

  const risk = validPlan();
  risk.items[0].risk = 'embedded-content';
  risk.plan_hash = computePlanHash(risk);
  risk.items[0].transaction_id = deriveTransactionId(risk.plan_hash, risk.items[0].item_id);
  assert.throws(() => validatePlan(risk), /risk is unsupported/);

  const identity = validPlan();
  identity.items[0].execution_identity.skill_content = 'embedded-content';
  identity.items[0].execution_identity.identity_hash = computeIdentityHash(identity.items[0].execution_identity);
  identity.items[0].item_hash = computeItemHash(identity.items[0]);
  identity.plan_hash = computePlanHash(identity);
  identity.items[0].transaction_id = deriveTransactionId(identity.plan_hash, identity.items[0].item_id);
  assert.throws(() => validatePlan(identity), /unknown key/);
});

test('execution identity drift is rejected before plan hashes can authorize it', () => {
  const plan = validPlan();
  plan.items[0].execution_identity.inode = '999';
  plan.items[0].item_hash = computeItemHash(plan.items[0]);
  plan.plan_hash = computePlanHash(plan);
  plan.items[0].transaction_id = deriveTransactionId(plan.plan_hash, plan.items[0].item_id);
  assert.throws(() => validatePlan(plan), /identity_hash/);
});

test('public transaction results expose exact machine-readable mutation truth', () => {
  const transactionId = sha256Json({ transaction: 1 });
  const committed = {
    schema_version: SCHEMAS.transaction,
    command: 'apply',
    status: 'committed',
    overall_status: 'committed',
    transaction_id: transactionId,
    state: 'COMMITTED',
    location: 'quarantine',
    mutation_occurred: true,
    mutation_outcome: 'moved',
    transaction_has_mutated: true,
    committed_transaction_ids: [transactionId],
  };
  assert.equal(validateTransactionResult(committed), committed);

  for (const invalid of [
    { ...committed, unexpected: true },
    { ...committed, mutation_occurred: false },
    { ...committed, mutation_outcome: 'unknown' },
    { ...committed, transaction_has_mutated: false },
    { ...committed, committed_transaction_ids: [] },
    { ...committed, command: 'status' },
  ]) {
    assert.throws(() => validateTransactionResult(invalid), /transaction[_ ]result/);
  }

  const restored = {
    ...committed,
    command: 'undo',
    status: 'restored',
    overall_status: 'restored',
    state: 'RESTORED',
    location: 'original',
    mutation_outcome: 'restored',
    committed_transaction_ids: [],
  };
  assert.equal(validateTransactionResult(restored), restored);
});
