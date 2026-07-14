import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEMAS,
  canonicalJson,
  computePlanHash,
  deriveTransactionId,
  sha256Json,
  validatePlan,
} from '../lib/cleanup-contract.mjs';

function validPlan(overrides = {}) {
  const plan = {
    schema_version: SCHEMAS.plan,
    product_version: '2.0',
    platform: 'macos',
    scan_fingerprint: sha256Json({ scan: 1 }),
    created_at: '2026-07-14T00:00:00.000Z',
    items: [
      {
        item_id: 'item-1',
        action: 'quarantine',
        entry_path: '/Users/example/.agents/skills/demo',
        active_root: '/Users/example/.agents/skills',
        entry_kind: 'directory',
        preconditions: {},
        expected_postconditions: {},
        risk: 'reviewed',
      },
    ],
    ...overrides,
  };
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

test('plan hash excludes created_at and derived transaction IDs', () => {
  const first = validPlan();
  const second = validPlan({ created_at: '2099-01-01T00:00:00.000Z' });
  assert.equal(first.plan_hash, second.plan_hash);
  assert.equal(computePlanHash(first), first.plan_hash);
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
});
