import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  SCHEMAS,
  buildBatchBinding,
  buildBatchError,
  buildBatchPlan,
  buildBatchResult,
  buildInitialBatchState,
  BATCH_ERROR_CODES,
  canonicalJson,
  computeIdentityHash,
  computeItemHash,
  computeObservationIdentityHash,
  computePlanHash,
  deriveBatchId,
  deriveBatchSummaryOverallStatus,
  deriveTransactionId,
  sha256Json,
  transactionStorageKey,
  undoCommandArguments,
  validateBatchBinding,
  validateBatchError,
  validateBatchPlan,
  validateBatchResult,
  validateBatchSummary,
  validateBatchState,
  validateExecutionIdentity,
  validateObservationIdentity,
  validatePlan,
  validateTransactionBatchStatus,
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
        item_id: sha256Json({ candidate: 'item-1' }),
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

function validMultiPlan(count = 3) {
  const template = validPlan();
  const items = Array.from({ length: count }, (_, index) => {
    const entryPath = `/Users/example/.agents/skills/demo-${index + 1}`;
    const executionIdentity = {
      ...template.items[0].execution_identity,
      entry_path: entryPath,
      inode: String(index + 2),
    };
    executionIdentity.identity_hash = computeIdentityHash(executionIdentity);
    const item = {
      ...template.items[0],
      item_id: sha256Json({ candidate: `item-${index + 1}` }),
      entry_path: entryPath,
      execution_identity: executionIdentity,
      preconditions: {
        ...template.items[0].preconditions,
        candidate_fingerprint: sha256Json({ candidate: index + 1 }),
        execution_identity_hash: executionIdentity.identity_hash,
      },
    };
    item.item_hash = computeItemHash(item);
    return item;
  });
  const plan = { ...template, items };
  plan.plan_hash = computePlanHash(plan);
  plan.items = plan.items.map((item) => ({
    ...item,
    transaction_id: deriveTransactionId(plan.plan_hash, item.item_id),
  }));
  return plan;
}

function validObservationIdentity(entryKind = 'directory') {
  const identity = {
    schema_version: SCHEMAS.observationIdentity,
    adapter: 'macos-test.v1',
    entry_path: '/Users/example/workspace/authoring-skill',
    active_root: '/Users/example/workspace',
    entry_kind: entryKind,
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
    raw_link_target_base64: entryKind === 'directory'
      ? null
      : Buffer.from('../authoring-skill').toString('base64'),
  };
  identity.identity_hash = computeObservationIdentityHash(identity);
  return identity;
}

function resultItem(mapping, status, overrides = {}) {
  const defaults = {
    NOT_STARTED: { location: 'original', transaction_has_mutated: false },
    COMMITTED: { location: 'quarantine', transaction_has_mutated: true },
    DRIFTED: { location: 'original_drift', transaction_has_mutated: false },
    BLOCKED: { location: 'original', transaction_has_mutated: false },
    RECOVERY_REQUIRED: { location: 'unknown', transaction_has_mutated: false },
  }[status];
  return {
    item_id: mapping.item_id,
    transaction_id: mapping.transaction_id,
    status,
    ...defaults,
    ...overrides,
  };
}

function summaryItem(mapping, status, overrides = {}) {
  const defaults = {
    NOT_STARTED: { location: 'original', transaction_has_mutated: false },
    APPLY_PENDING: { location: 'original', transaction_has_mutated: false },
    APPLY_FINALIZE_PENDING: { location: 'quarantine', transaction_has_mutated: true },
    COMMITTED: { location: 'quarantine', transaction_has_mutated: true },
    RESTORE_PENDING: { location: 'quarantine', transaction_has_mutated: true },
    RESTORE_FINALIZE_PENDING: { location: 'original', transaction_has_mutated: true },
    RESTORED: { location: 'original', transaction_has_mutated: true },
    REHYDRATED: { location: 'rehydrated', transaction_has_mutated: true },
    RESTORE_CONFLICT: { location: 'rehydrated', transaction_has_mutated: true },
    DRIFTED: { location: 'original_drift', transaction_has_mutated: false },
    BLOCKED: { location: 'original', transaction_has_mutated: false },
    RECOVERY_REQUIRED: { location: 'unknown', transaction_has_mutated: false },
  }[status];
  return {
    item_id: mapping.item_id,
    transaction_id: mapping.transaction_id,
    status,
    ...defaults,
    ...overrides,
  };
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

test('execution and observation identities remain exact, disjoint authorities', () => {
  const plan = validPlan();
  const executionIdentity = plan.items[0].execution_identity;
  assert.equal(validateExecutionIdentity(executionIdentity, {
    entryPath: plan.items[0].entry_path,
    activeRoot: plan.items[0].active_root,
    entryKind: plan.items[0].entry_kind,
  }), executionIdentity);
  assert.throws(() => validateExecutionIdentity(validObservationIdentity()), /execution identity/);
  assert.throws(() => validateObservationIdentity(executionIdentity), /observation identity/);
  assert.throws(
    () => validateExecutionIdentity(executionIdentity, { entryPath: '/different/entry' }),
    /execution identity/,
  );
});

test('plan and batch item IDs are fixed sha256 identities, never arbitrary JSON strings', () => {
  for (const itemId of ['item-1', 'item-"quoted', `sha256:${'a'.repeat(65)}`]) {
    const plan = validPlan();
    plan.items[0].item_id = itemId;
    assert.throws(() => validatePlan(plan), /item_id/);
  }

  const plan = validMultiPlan();
  const batchPlan = buildBatchPlan(plan);
  const malformedMapping = {
    ...batchPlan,
    transaction_map: batchPlan.transaction_map.map((mapping, index) => (
      index === 0 ? { ...mapping, item_id: 'item-"quoted' } : mapping
    )),
  };
  assert.throws(() => validateBatchPlan(malformedMapping), /item_id/);
  const summary = {
    schema_version: SCHEMAS.batchSummary,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    overall_status: 'READY',
    items: batchPlan.transaction_map.map((mapping, index) => ({
      ...summaryItem(mapping, 'NOT_STARTED'),
      ...(index === 0 ? { item_id: 'x'.repeat(4096) } : {}),
    })),
  };
  assert.throws(() => validateBatchSummary(summary), /item_id/);
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

test('batch plan derives a stable ID and exact immutable item bindings from a validated plan', () => {
  const plan = validMultiPlan();
  const batchPlan = buildBatchPlan(plan);

  assert.equal(batchPlan.schema_version, SCHEMAS.batchPlan);
  assert.equal(batchPlan.batch_id, deriveBatchId(plan.plan_hash));
  assert.deepEqual(
    batchPlan.transaction_map,
    plan.items.map((item) => ({
      item_id: item.item_id,
      transaction_id: item.transaction_id,
      item_hash: item.item_hash,
      execution_identity_hash: item.execution_identity.identity_hash,
    })),
  );
  assert.equal(validateBatchPlan(batchPlan, plan), batchPlan);
  assert.equal(
    buildBatchPlan({ ...plan, created_at: '2099-01-01T00:00:00.000Z' }).batch_id,
    batchPlan.batch_id,
  );
});

test('observation identities cover read-only directories without fabricating installer evidence', () => {
  const directory = validObservationIdentity();
  assert.equal(validateObservationIdentity(directory), directory);
  assert.equal(directory.schema_version, SCHEMAS.observationIdentity);
  assert.equal(computeObservationIdentityHash(directory), directory.identity_hash);
  assert.equal(Object.hasOwn(directory, 'receipt_sha256'), false);
  assert.equal(Object.hasOwn(directory, 'installed_tree_sha1'), false);

  const link = validObservationIdentity('symlink');
  assert.equal(validateObservationIdentity(link), link);
  assert.equal(validObservationIdentity('broken_symlink').entry_kind, 'broken_symlink');
});

test('observation identities are exact, content-bound, and kind-sensitive', () => {
  const directory = validObservationIdentity();
  for (const invalid of [
    { ...directory, unexpected: true },
    { ...directory, receipt_sha256: 'a'.repeat(64) },
    { ...directory, raw_link_target_base64: '' },
    { ...directory, identity_hash: sha256Json({ wrong: true }) },
    { ...directory, device: '-1' },
    { ...directory, flags: -1 },
    { ...directory, manifest_hash: sha256Json({ wrong: true }), identity_hash: directory.identity_hash },
  ]) {
    assert.throws(() => validateObservationIdentity(invalid), /observation identity/);
  }

  const link = validObservationIdentity('symlink');
  const missingTarget = { ...link, raw_link_target_base64: null };
  missingTarget.identity_hash = computeObservationIdentityHash(missingTarget);
  assert.throws(() => validateObservationIdentity(missingTarget), /observation identity/);
});

test('batch plan rejects unknown keys, mapping drift, duplicate IDs, and derived-ID mismatches', () => {
  const plan = validMultiPlan();
  const batchPlan = buildBatchPlan(plan);
  const invalidPlans = [
    { ...batchPlan, unexpected: true },
    { ...batchPlan, batch_id: sha256Json({ wrong: 'batch' }) },
    { ...batchPlan, plan_hash: sha256Json({ wrong: 'plan' }) },
    {
      ...batchPlan,
      transaction_map: batchPlan.transaction_map.map((mapping, index) => (
        index === 0 ? { ...mapping, item_hash: sha256Json({ wrong: 'item' }) } : mapping
      )),
    },
    {
      ...batchPlan,
      transaction_map: batchPlan.transaction_map.map((mapping, index) => (
        index === 0
          ? { ...mapping, execution_identity_hash: sha256Json({ wrong: 'identity' }) }
          : mapping
      )),
    },
    {
      ...batchPlan,
      transaction_map: batchPlan.transaction_map.map((mapping, index) => (
        index === 1 ? { ...mapping, item_id: batchPlan.transaction_map[0].item_id } : mapping
      )),
    },
    {
      ...batchPlan,
      transaction_map: batchPlan.transaction_map.map((mapping, index) => (
        index === 1
          ? { ...mapping, transaction_id: batchPlan.transaction_map[0].transaction_id }
          : mapping
      )),
    },
  ];
  for (const invalid of invalidPlans) {
    assert.throws(() => validateBatchPlan(invalid, plan), /batch/);
  }

  const reordered = {
    ...batchPlan,
    transaction_map: batchPlan.transaction_map.toReversed(),
  };
  assert.throws(() => validateBatchPlan(reordered, plan), /mapping/);
  const mappingWithUnknownKey = {
    ...batchPlan,
    transaction_map: [
      { ...batchPlan.transaction_map[0], unexpected: true },
      ...batchPlan.transaction_map.slice(1),
    ],
  };
  assert.throws(() => validateBatchPlan(mappingWithUnknownKey), /unknown key/);
});

test('batch binding is an exact durable reverse pointer to one immutable mapping', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const binding = buildBatchBinding(batchPlan, batchPlan.transaction_map[1].item_id);

  assert.deepEqual(binding, {
    schema_version: SCHEMAS.batchBinding,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    ...batchPlan.transaction_map[1],
  });
  assert.equal(validateBatchBinding(binding, batchPlan), binding);
  assert.throws(
    () => validateBatchBinding({ ...binding, unexpected: true }, batchPlan),
    /unknown key/,
  );
  assert.throws(
    () => validateBatchBinding({ ...binding, transaction_id: sha256Json({ wrong: true }) }, batchPlan),
    /binding/,
  );
  assert.throws(
    () => buildBatchBinding(batchPlan, sha256Json({ missing: 'item' })),
    /binding/,
  );
});

test('batch state is exact, sequence-monotonic, mapping-bound, and never downgrades commits', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const ready = buildInitialBatchState(batchPlan);
  assert.deepEqual(ready.items.map(({ status }) => status), [
    'NOT_STARTED',
    'NOT_STARTED',
    'NOT_STARTED',
  ]);
  assert.equal(ready.state, 'READY');
  assert.equal(validateBatchState(ready, batchPlan), ready);

  const running = {
    ...ready,
    sequence: 1,
    state: 'RUNNING',
    items: ready.items.map((item, index) => (
      index === 0 ? { ...item, status: 'COMMITTED' } : item
    )),
  };
  assert.equal(validateBatchState(running, batchPlan, { previousState: ready }), running);

  for (const invalid of [
    { ...running, unexpected: true },
    { ...running, sequence: 0 },
    { ...running, sequence: 2 },
    { ...running, batch_id: sha256Json({ wrong: true }) },
    { ...running, items: running.items.toReversed() },
    {
      ...running,
      items: running.items.map((item, index) => (
        index === 1 ? { ...item, transaction_id: sha256Json({ wrong: true }) } : item
      )),
    },
    {
      ...running,
      items: running.items.map((item, index) => (
        index === 1 ? { ...item, status: 'APPLYING' } : item
      )),
    },
  ]) {
    assert.throws(
      () => validateBatchState(invalid, batchPlan, { previousState: ready }),
      /batch state/,
    );
  }

  const downgraded = {
    ...running,
    sequence: 2,
    items: running.items.map((item, index) => (
      index === 0 ? { ...item, status: 'NOT_STARTED' } : item
    )),
  };
  assert.throws(
    () => validateBatchState(downgraded, batchPlan, { previousState: running }),
    /COMMITTED|downgrade|failure truth/,
  );
});

test('batch state preserves failure truth, stops after one failure, and requires exact convergence proof', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const ready = buildInitialBatchState(batchPlan);
  const started = { ...ready, sequence: 1, state: 'RUNNING' };
  const failed = {
    ...started,
    sequence: 2,
    state: 'PARTIAL',
    items: started.items.map((item, index) => {
      if (index === 0) return { ...item, status: 'COMMITTED' };
      if (index === 1) return { ...item, status: 'DRIFTED' };
      return item;
    }),
  };
  assert.equal(validateBatchState(failed, batchPlan, { previousState: started }), failed);
  const erasedDrift = {
    ...failed,
    sequence: 3,
    state: 'RUNNING',
    items: failed.items.map((item, index) => (
      index === 1 ? { ...item, status: 'NOT_STARTED' } : item
    )),
  };
  assert.throws(
    () => validateBatchState(erasedDrift, batchPlan, { previousState: failed }),
    /DRIFTED|downgrade|failure truth/,
  );

  for (const failureStatus of ['BLOCKED', 'RECOVERY_REQUIRED']) {
    const previous = {
      ...failed,
      state: failureStatus === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED' : failed.state,
      items: failed.items.map((item, index) => (
        index === 1 ? { ...item, status: failureStatus } : item
      )),
    };
    const next = {
      ...previous,
      sequence: 3,
      state: 'RUNNING',
      items: previous.items.map((item, index) => (
        index === 1 ? { ...item, status: 'COMMITTED' } : item
      )),
    };
    if (failureStatus === 'BLOCKED') {
      assert.throws(
        () => validateBatchState(next, batchPlan, { previousState: previous }),
        /BLOCKED|failure truth/,
      );
    } else {
      assert.throws(
        () => validateBatchState(next, batchPlan, { previousState: previous }),
        /convergence/,
      );
      assert.equal(validateBatchState(next, batchPlan, {
        previousState: previous,
        authoritativeConvergence: [batchPlan.transaction_map[1].transaction_id],
      }), next);
      assert.throws(
        () => validateBatchState(next, batchPlan, {
          previousState: previous,
          authoritativeConvergence: [
            batchPlan.transaction_map[1].transaction_id,
            batchPlan.transaction_map[2].transaction_id,
          ],
        }),
        /convergence/,
      );
    }
  }

  const twoFailures = {
    ...failed,
    sequence: 3,
    items: failed.items.map((item, index) => (
      index === 2 ? { ...item, status: 'BLOCKED' } : item
    )),
  };
  assert.throws(
    () => validateBatchState(twoFailures, batchPlan),
    /first failure|more than one failure|stop/,
  );

  const allCommittedRunning = {
    ...ready,
    sequence: 1,
    state: 'RUNNING',
    items: ready.items.map((item) => ({ ...item, status: 'COMMITTED' })),
  };
  const projectionFailure = {
    ...allCommittedRunning,
    sequence: 2,
    state: 'RECOVERY_REQUIRED',
  };
  const safelyPublished = {
    ...projectionFailure,
    sequence: 3,
    state: 'COMMITTED',
  };
  assert.equal(
    validateBatchState(projectionFailure, batchPlan, { previousState: allCommittedRunning }),
    projectionFailure,
  );
  assert.equal(
    validateBatchState(safelyPublished, batchPlan, { previousState: projectionFailure }),
    safelyPublished,
  );
});

test('batch result derives durable truth and strict reverse undo commands from item states', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const committedItems = batchPlan.transaction_map.map((mapping) => (
    resultItem(mapping, 'COMMITTED')
  ));
  const committed = buildBatchResult({
    batchPlan,
    status: 'committed',
    overallStatus: 'committed',
    items: committedItems,
    mutationOccurred: true,
  });
  assert.equal(validateBatchResult(committed, batchPlan), committed);
  assert.equal(validateBatchResult(committed), committed);
  assert.equal(committed.mutation_outcome, 'moved');
  assert.equal(committed.transaction_has_mutated, true);
  assert.deepEqual(
    committed.committed_transaction_ids,
    batchPlan.transaction_map.map(({ transaction_id }) => transaction_id),
  );
  assert.deepEqual(
    committed.undo_commands,
    batchPlan.transaction_map.toReversed().map(({ transaction_id }) => (
      `skills-refiner cleanup undo ${transaction_id} --confirm ${transaction_id} --json`
    )),
  );

  const retried = buildBatchResult({
    batchPlan,
    status: 'already_committed',
    overallStatus: 'committed',
    items: committedItems,
    mutationOccurred: false,
  });
  assert.equal(retried.mutation_outcome, 'unchanged');
  assert.equal(retried.transaction_has_mutated, true);
  assert.equal(validateBatchResult(retried, batchPlan), retried);
});

test('blocked and PARTIAL batch results cannot lie about current or durable mutation truth', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const baseItems = batchPlan.transaction_map.map((mapping) => (
    resultItem(mapping, 'NOT_STARTED')
  ));
  const blocked = buildBatchResult({
    batchPlan,
    status: 'blocked',
    overallStatus: 'drifted',
    items: baseItems.map((item, index) => (
      index === 1 ? resultItem(batchPlan.transaction_map[index], 'DRIFTED') : item
    )),
    mutationOccurred: false,
  });
  assert.equal(blocked.transaction_has_mutated, false);
  assert.deepEqual(blocked.committed_transaction_ids, []);
  assert.deepEqual(blocked.undo_commands, []);
  assert.equal(validateBatchResult(blocked, batchPlan), blocked);

  const partialItems = baseItems.map((item, index) => {
    if (index === 0) return resultItem(batchPlan.transaction_map[index], 'COMMITTED');
    if (index === 1) return resultItem(batchPlan.transaction_map[index], 'DRIFTED');
    return item;
  });
  const partial = buildBatchResult({
    batchPlan,
    status: 'recovery_required',
    overallStatus: 'PARTIAL',
    items: partialItems,
    mutationOccurred: true,
  });
  assert.equal(partial.mutation_occurred, true);
  assert.equal(partial.transaction_has_mutated, true);
  assert.deepEqual(partial.committed_transaction_ids, [batchPlan.transaction_map[0].transaction_id]);
  assert.equal(partial.undo_commands.length, 1);
  assert.equal(validateBatchResult(partial, batchPlan), partial);

  const historicalPartialRetry = buildBatchResult({
    batchPlan,
    status: 'recovery_required',
    overallStatus: 'PARTIAL',
    items: partialItems,
    mutationOccurred: false,
  });
  assert.equal(historicalPartialRetry.mutation_occurred, false);
  assert.equal(historicalPartialRetry.mutation_outcome, 'unchanged');
  assert.equal(historicalPartialRetry.transaction_has_mutated, true);
  assert.equal(validateBatchResult(historicalPartialRetry), historicalPartialRetry);

  const committedItems = batchPlan.transaction_map.map((mapping) => (
    resultItem(mapping, 'COMMITTED')
  ));
  const projectionFailureAfterCommit = buildBatchResult({
    batchPlan,
    status: 'recovery_required',
    overallStatus: 'RECOVERY_REQUIRED',
    items: committedItems,
    mutationOccurred: true,
  });
  assert.equal(projectionFailureAfterCommit.transaction_has_mutated, true);
  assert.equal(
    projectionFailureAfterCommit.committed_transaction_ids.length,
    batchPlan.transaction_map.length,
  );
  assert.equal(validateBatchResult(projectionFailureAfterCommit), projectionFailureAfterCommit);

  for (const invalid of [
    { ...blocked, unexpected: true },
    { ...blocked, mutation_occurred: true, mutation_outcome: 'moved' },
    { ...blocked, transaction_has_mutated: true },
    { ...blocked, committed_transaction_ids: [batchPlan.transaction_map[0].transaction_id] },
    { ...partial, overall_status: 'drifted' },
    { ...partial, mutation_occurred: false, mutation_outcome: 'moved' },
    { ...partial, transaction_has_mutated: false },
    { ...partial, committed_transaction_ids: [] },
    { ...partial, undo_commands: partial.undo_commands.toReversed().concat('cleanup undo wrong') },
    {
      ...partial,
      items: partial.items.map((item, index) => (
        index === 2 ? { ...item, status: 'COMMITTED' } : item
      )),
    },
  ]) {
    assert.throws(() => validateBatchResult(invalid, batchPlan), /batch result/);
  }
});

test('batch summary is an exact read-only reconstruction bound to deterministic item identities', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const summary = {
    schema_version: SCHEMAS.batchSummary,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    overall_status: 'PARTIAL',
    items: batchPlan.transaction_map.map((mapping, index) => summaryItem(
      mapping,
      index === 0 ? 'COMMITTED' : index === 1 ? 'DRIFTED' : 'NOT_STARTED',
    )),
  };
  assert.equal(validateBatchSummary(summary), summary);
  assert.equal(validateBatchSummary(summary, batchPlan), summary);
  assert.throws(() => validateBatchSummary({ ...summary, unexpected: true }), /batch summary/);
  assert.throws(
    () => validateBatchSummary({ ...summary, batch_id: sha256Json({ wrong: true }) }),
    /batch summary/,
  );
  assert.throws(
    () => validateBatchSummary({ ...summary, overall_status: 'COMMITTED' }),
    /batch summary/,
  );

  const summaryFor = (statuses) => {
    const items = statuses.map((status, index) => summaryItem(
      batchPlan.transaction_map[index],
      status,
    ));
    return {
      schema_version: SCHEMAS.batchSummary,
      batch_id: batchPlan.batch_id,
      plan_hash: batchPlan.plan_hash,
      overall_status: deriveBatchSummaryOverallStatus(items),
      items,
    };
  };
  for (const [statuses, expected] of [
    [['NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED'], 'READY'],
    [['COMMITTED', 'NOT_STARTED', 'NOT_STARTED'], 'RUNNING'],
    [['COMMITTED', 'COMMITTED', 'COMMITTED'], 'COMMITTED'],
    [['DRIFTED', 'NOT_STARTED', 'NOT_STARTED'], 'BLOCKED'],
    [['COMMITTED', 'DRIFTED', 'NOT_STARTED'], 'PARTIAL'],
    [['RESTORE_PENDING', 'COMMITTED', 'COMMITTED'], 'RESTORE_PENDING'],
    [['RESTORED', 'COMMITTED', 'COMMITTED'], 'PARTIALLY_RESTORED'],
    [['RESTORED', 'RESTORED', 'RESTORED'], 'RESTORED'],
    [['REHYDRATED', 'COMMITTED', 'COMMITTED'], 'REHYDRATED'],
    [['RESTORE_CONFLICT', 'RESTORE_PENDING', 'COMMITTED'], 'RESTORE_CONFLICT'],
    [['RECOVERY_REQUIRED', 'RESTORE_PENDING', 'COMMITTED'], 'RECOVERY_REQUIRED'],
  ]) {
    const candidate = summaryFor(statuses);
    assert.equal(candidate.overall_status, expected);
    assert.equal(validateBatchSummary(candidate, batchPlan), candidate);
  }

  const contradictoryLocation = summaryFor(['COMMITTED', 'COMMITTED', 'COMMITTED']);
  contradictoryLocation.items[0] = {
    ...contradictoryLocation.items[0],
    location: 'original',
  };
  assert.throws(() => validateBatchSummary(contradictoryLocation, batchPlan), /location|history/);
});

test('batch-bound transaction status uses a new exact schema without weakening Task 5 results', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const batchSummary = {
    schema_version: SCHEMAS.batchSummary,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    overall_status: 'RUNNING',
    items: batchPlan.transaction_map.map((mapping, index) => summaryItem(
      mapping,
      index === 0 ? 'COMMITTED' : 'NOT_STARTED',
    )),
  };
  const transactionId = batchPlan.transaction_map[0].transaction_id;
  const status = {
    schema_version: SCHEMAS.transactionBatchStatus,
    command: 'status',
    status: 'committed',
    overall_status: 'committed',
    transaction_id: transactionId,
    state: 'COMMITTED',
    location: 'quarantine',
    mutation_occurred: false,
    mutation_outcome: 'unchanged',
    transaction_has_mutated: true,
    committed_transaction_ids: [transactionId],
    batch_id: batchPlan.batch_id,
    batch_summary: batchSummary,
  };
  assert.equal(validateTransactionBatchStatus(status, batchPlan), status);
  assert.throws(() => validateTransactionResult(status), /transaction[_ ]result/);
  assert.throws(
    () => validateTransactionBatchStatus({ ...status, unexpected: true }, batchPlan),
    /batch status/,
  );
  assert.throws(
    () => validateTransactionBatchStatus({ ...status, batch_id: sha256Json({ wrong: true }) }, batchPlan),
    /batch status/,
  );
  const missingTransaction = {
    ...status,
    transaction_id: sha256Json({ transaction: 'missing' }),
    committed_transaction_ids: [sha256Json({ transaction: 'missing' })],
  };
  assert.throws(() => validateTransactionBatchStatus(missingTransaction, batchPlan), /batch status/);

  const restoredSummary = {
    schema_version: SCHEMAS.batchSummary,
    batch_id: batchPlan.batch_id,
    plan_hash: batchPlan.plan_hash,
    overall_status: 'RESTORED',
    items: batchPlan.transaction_map.map((mapping, index) => summaryItem(
      mapping,
      index === 0 ? 'RESTORED' : 'NOT_STARTED',
    )),
  };
  const restored = {
    ...status,
    status: 'restored',
    overall_status: 'restored',
    state: 'RESTORED',
    location: 'original',
    committed_transaction_ids: [],
    batch_summary: restoredSummary,
  };
  assert.equal(validateTransactionBatchStatus(restored, batchPlan), restored);
  const restoredContradiction = {
    ...restored,
    batch_summary: {
      ...restoredSummary,
      overall_status: 'COMMITTED',
      items: restoredSummary.items.map((item, index) => (
        index === 0 ? summaryItem(batchPlan.transaction_map[index], 'COMMITTED') : item
      )),
    },
  };
  assert.throws(
    () => validateTransactionBatchStatus(restoredContradiction, batchPlan),
    /batch status/,
  );

  const rehydratedSummary = {
    ...batchSummary,
    overall_status: 'REHYDRATED',
    items: batchSummary.items.map((item, index) => (
      index === 0
        ? summaryItem(batchPlan.transaction_map[index], 'REHYDRATED')
        : item
    )),
  };
  const rehydrated = {
    ...status,
    status: 'rehydrated',
    overall_status: 'rehydrated',
    location: 'rehydrated',
    batch_summary: rehydratedSummary,
  };
  assert.equal(validateTransactionBatchStatus(rehydrated, batchPlan), rehydrated);

  const hiddenRehydration = {
    ...rehydrated,
    status: 'committed',
    overall_status: 'committed',
    batch_summary: {
      ...rehydratedSummary,
      overall_status: 'COMMITTED',
      items: rehydratedSummary.items.map((item, index) => (
        index === 0 ? { ...item, status: 'COMMITTED' } : item
      )),
    },
  };
  assert.throws(() => validateTransactionBatchStatus(hiddenRehydration, batchPlan), /batch status/);

  const restoreConflictSummary = {
    ...batchSummary,
    overall_status: 'RESTORE_CONFLICT',
    items: batchSummary.items.map((item, index) => (
      index === 0 ? summaryItem(batchPlan.transaction_map[index], 'RESTORE_CONFLICT') : item
    )),
  };
  const restoreConflict = {
    ...status,
    status: 'restore_conflict',
    overall_status: 'restore_conflict',
    state: 'RESTORE_PREPARED',
    location: 'rehydrated',
    committed_transaction_ids: [],
    batch_summary: restoreConflictSummary,
  };
  assert.equal(validateTransactionBatchStatus(restoreConflict, batchPlan), restoreConflict);
  const hiddenRestoreConflict = {
    ...restoreConflict,
    batch_summary: {
      ...restoreConflictSummary,
      overall_status: 'RESTORE_PENDING',
      items: restoreConflictSummary.items.map((item, index) => (
        index === 0 ? { ...item, status: 'RESTORE_PENDING' } : item
      )),
    },
  };
  assert.throws(() => validateTransactionBatchStatus(hiddenRestoreConflict, batchPlan), /batch status/);

  assert.throws(
    () => validateTransactionBatchStatus({
      ...status,
      status: 'drifted',
      overall_status: 'drifted',
    }, batchPlan),
    /batch status/,
  );
  const committedAsBlocked = {
    ...status,
    batch_summary: {
      ...batchSummary,
      overall_status: 'BLOCKED',
      items: batchSummary.items.map((item, index) => (
        index === 0
          ? summaryItem(batchPlan.transaction_map[index], 'BLOCKED')
          : item
      )),
    },
  };
  assert.throws(() => validateTransactionBatchStatus(committedAsBlocked, batchPlan), /batch status/);

  const applyPendingSummary = {
    ...batchSummary,
    overall_status: 'RUNNING',
    items: batchSummary.items.map((item, index) => (
      index === 0 ? summaryItem(batchPlan.transaction_map[index], 'APPLY_PENDING') : item
    )),
  };
  for (const state of ['CONFIRMED', 'PREPARED']) {
    const pending = {
      ...status,
      status: 'ready_to_resume_apply',
      overall_status: 'ready_to_resume_apply',
      state,
      location: 'original',
      transaction_has_mutated: false,
      committed_transaction_ids: [],
      batch_summary: applyPendingSummary,
    };
    assert.equal(validateTransactionBatchStatus(pending, batchPlan), pending);
    const hiddenPending = {
      ...pending,
      batch_summary: {
        ...applyPendingSummary,
        overall_status: 'READY',
        items: applyPendingSummary.items.map((item, index) => (
          index === 0 ? summaryItem(batchPlan.transaction_map[index], 'NOT_STARTED') : item
        )),
      },
    };
    assert.throws(() => validateTransactionBatchStatus(hiddenPending, batchPlan), /batch status/);
  }

  const planned = {
    ...status,
    status: 'ready_to_resume_apply',
    overall_status: 'ready_to_resume_apply',
    state: 'PLANNED',
    location: 'original',
    transaction_has_mutated: false,
    committed_transaction_ids: [],
    batch_summary: {
      ...applyPendingSummary,
      overall_status: 'READY',
      items: applyPendingSummary.items.map((item, index) => (
        index === 0 ? summaryItem(batchPlan.transaction_map[index], 'NOT_STARTED') : item
      )),
    },
  };
  assert.equal(validateTransactionBatchStatus(planned, batchPlan), planned);
});

test('batch errors preserve current uncertainty, per-item history, and exact failure identity', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const items = batchPlan.transaction_map.map((mapping, index) => {
    if (index === 0) return resultItem(mapping, 'COMMITTED', { location: 'rehydrated' });
    if (index === 1) {
      return resultItem(mapping, 'RECOVERY_REQUIRED', {
        location: 'unknown',
        transaction_has_mutated: true,
      });
    }
    return resultItem(mapping, 'NOT_STARTED');
  });
  const error = buildBatchError({
    batchPlan,
    status: 'recovery_required',
    overallStatus: 'PARTIAL',
    items,
    mutationOccurred: true,
    mutationOutcome: 'unknown',
    errorCode: 'batch_item_outcome_ambiguous',
    failureScope: 'item',
    failureItemIndex: 1,
  });
  assert.equal(error.schema_version, SCHEMAS.batchError);
  assert.equal(error.failure_item_id, batchPlan.transaction_map[1].item_id);
  assert.equal(error.failure_item_index, 1);
  assert.equal(error.mutation_outcome, 'unknown');
  assert.equal(error.transaction_has_mutated, true);
  assert.equal(error.items[1].transaction_has_mutated, true);
  assert.equal(error.items[0].location, 'rehydrated');
  assert.equal(validateBatchError(error, batchPlan), error);

  for (const invalid of [
    { ...error, unexpected: true },
    { ...error, transaction_has_mutated: false },
    { ...error, failure_item_index: 2 },
    { ...error, failure_item_id: batchPlan.transaction_map[2].item_id },
    { ...error, mutation_occurred: false },
    { ...error, mutation_outcome: 'moved' },
    {
      ...error,
      items: error.items.map((item, index) => (
        index === 2 ? resultItem(batchPlan.transaction_map[index], 'BLOCKED') : item
      )),
    },
  ]) {
    assert.throws(() => validateBatchError(invalid, batchPlan), /batch error/);
  }

  const projectionError = buildBatchError({
    batchPlan,
    status: 'recovery_required',
    overallStatus: 'RECOVERY_REQUIRED',
    items: batchPlan.transaction_map.map((mapping) => resultItem(mapping, 'COMMITTED')),
    mutationOccurred: true,
    mutationOutcome: 'unknown',
    errorCode: 'batch_state_projection_failed',
    failureScope: 'batch',
  });
  assert.equal(projectionError.failure_item_id, null);
  assert.equal(projectionError.failure_item_index, null);
  assert.equal(validateBatchError(projectionError), projectionError);
  assert.throws(
    () => validateBatchError({ ...projectionError, failure_item_index: 0 }, batchPlan),
    /batch error/,
  );
  assert.throws(() => validateBatchResult(error, batchPlan), /batch result/);

  const driftItems = batchPlan.transaction_map.map((mapping, index) => (
    index === 1 ? resultItem(mapping, 'DRIFTED') : resultItem(mapping, 'NOT_STARTED')
  ));
  const driftError = buildBatchError({
    batchPlan,
    status: 'blocked',
    overallStatus: 'drifted',
    items: driftItems,
    mutationOccurred: false,
    mutationOutcome: 'unchanged',
    errorCode: BATCH_ERROR_CODES.preflightDrift,
    failureScope: 'item',
    failureItemIndex: 1,
  });
  assert.equal(validateBatchError(driftError, batchPlan), driftError);
  const partialDrift = buildBatchError({
    batchPlan,
    status: 'recovery_required',
    overallStatus: 'PARTIAL',
    items: batchPlan.transaction_map.map((mapping, index) => {
      if (index === 0) return resultItem(mapping, 'COMMITTED');
      if (index === 1) return resultItem(mapping, 'DRIFTED');
      return resultItem(mapping, 'NOT_STARTED');
    }),
    mutationOccurred: true,
    mutationOutcome: 'moved',
    errorCode: BATCH_ERROR_CODES.preflightDrift,
    failureScope: 'item',
    failureItemIndex: 1,
  });
  assert.equal(validateBatchError(partialDrift, batchPlan), partialDrift);
  assert.throws(
    () => validateBatchError({
      ...partialDrift,
      status: 'blocked',
      overall_status: 'drifted',
    }, batchPlan),
    /batch error/,
  );
  assert.throws(
    () => validateBatchError({ ...driftError, failure_scope: 'batch', failure_item_id: null,
      failure_item_index: null }, batchPlan),
    /batch error/,
  );
  assert.throws(
    () => validateBatchError({ ...driftError, error_code: 'arbitrary_internal_reason' }, batchPlan),
    /batch error/,
  );
  assert.throws(
    () => validateBatchError({
      ...driftError,
      items: driftError.items.map((item, index) => (
        index === 1 ? resultItem(batchPlan.transaction_map[index], 'BLOCKED') : item
      )),
    }, batchPlan),
    /batch error/,
  );

  const batchUnknown = buildBatchError({
    batchPlan,
    status: 'recovery_required',
    overallStatus: 'RECOVERY_REQUIRED',
    items: batchPlan.transaction_map.map((mapping) => resultItem(mapping, 'NOT_STARTED')),
    mutationOccurred: true,
    mutationOutcome: 'unknown',
    errorCode: BATCH_ERROR_CODES.batchMutationOutcomeUnknown,
    failureScope: 'batch',
  });
  assert.equal(batchUnknown.transaction_has_mutated, false);
  assert.equal(validateBatchError(batchUnknown, batchPlan), batchUnknown);
  assert.throws(
    () => validateBatchError({
      ...batchUnknown,
      error_code: BATCH_ERROR_CODES.batchStateProjectionFailed,
    }, batchPlan),
    /batch error/,
  );

  const ambiguousWithoutFailedItemHistory = {
    ...error,
    items: error.items.map((item, index) => (
      index === 1
        ? resultItem(batchPlan.transaction_map[index], 'RECOVERY_REQUIRED')
        : item
    )),
  };
  assert.throws(
    () => validateBatchError(ambiguousWithoutFailedItemHistory, batchPlan),
    /batch error/,
  );
  const batchUnknownAfterCommit = buildBatchError({
    batchPlan,
    status: 'recovery_required',
    overallStatus: 'RECOVERY_REQUIRED',
    items: batchPlan.transaction_map.map((mapping, index) => (
      index === 0 ? resultItem(mapping, 'COMMITTED') : resultItem(mapping, 'NOT_STARTED')
    )),
    mutationOccurred: true,
    mutationOutcome: 'unknown',
    errorCode: BATCH_ERROR_CODES.batchMutationOutcomeUnknown,
    failureScope: 'batch',
  });
  assert.equal(validateBatchError(batchUnknownAfterCommit, batchPlan), batchUnknownAfterCommit);
  assert.equal(
    batchUnknownAfterCommit.items.some(({ status: itemStatus }) => itemStatus === 'RECOVERY_REQUIRED'),
    false,
  );
});

test('batch-primary reconciliation errors preserve visible item truth without inventing sequence', () => {
  const batchPlan = buildBatchPlan(validMultiPlan());
  const committedThenDrifted = batchPlan.transaction_map.map((mapping, index) => {
    if (index === 0) return resultItem(mapping, 'COMMITTED');
    if (index === 1) return resultItem(mapping, 'DRIFTED');
    return resultItem(mapping, 'NOT_STARTED');
  });
  const recoveryThenCommitted = batchPlan.transaction_map.map((mapping, index) => {
    if (index === 0) return resultItem(mapping, 'RECOVERY_REQUIRED');
    if (index === 1) return resultItem(mapping, 'COMMITTED');
    return resultItem(mapping, 'NOT_STARTED');
  });
  const committedThenRecovery = batchPlan.transaction_map.map((mapping, index) => {
    if (index === 0) return resultItem(mapping, 'COMMITTED');
    if (index === 1) {
      return resultItem(mapping, 'RECOVERY_REQUIRED', {
        location: 'unknown',
        transaction_has_mutated: true,
      });
    }
    return resultItem(mapping, 'NOT_STARTED');
  });
  const cases = [
    {
      code: BATCH_ERROR_CODES.batchStateProjectionFailed,
      items: committedThenDrifted,
      mutationOccurred: false,
      mutationOutcome: 'unchanged',
      committedIndex: 0,
    },
    {
      code: BATCH_ERROR_CODES.batchRecordsInvalid,
      items: recoveryThenCommitted,
      mutationOccurred: false,
      mutationOutcome: 'unchanged',
      committedIndex: 1,
    },
    {
      code: BATCH_ERROR_CODES.batchMutationOutcomeUnknown,
      items: committedThenRecovery,
      mutationOccurred: true,
      mutationOutcome: 'unknown',
      committedIndex: 0,
    },
    {
      code: BATCH_ERROR_CODES.batchLockReleaseFailed,
      items: committedThenDrifted,
      mutationOccurred: false,
      mutationOutcome: 'unchanged',
      committedIndex: 0,
    },
    {
      code: BATCH_ERROR_CODES.batchLockAcquireFailed,
      items: batchPlan.transaction_map.map((mapping, index) => (
        index === 0 ? resultItem(mapping, 'COMMITTED') : resultItem(mapping, 'NOT_STARTED')
      )),
      mutationOccurred: false,
      mutationOutcome: 'unchanged',
      committedIndex: 0,
    },
  ];

  for (const fixture of cases) {
    const error = buildBatchError({
      batchPlan,
      status: 'recovery_required',
      overallStatus: 'RECOVERY_REQUIRED',
      items: fixture.items,
      mutationOccurred: fixture.mutationOccurred,
      mutationOutcome: fixture.mutationOutcome,
      errorCode: fixture.code,
      failureScope: 'batch',
    });
    const committedId = batchPlan.transaction_map[fixture.committedIndex].transaction_id;
    assert.equal(validateBatchError(error, batchPlan), error);
    assert.deepEqual(error.committed_transaction_ids, [committedId]);
    assert.deepEqual(error.undo_commands, [
      `skills-refiner cleanup undo ${committedId} --confirm ${committedId} --json`,
    ]);
    assert.equal(error.failure_item_id, null);
    assert.equal(error.failure_item_index, null);
  }

  assert.deepEqual(recoveryThenCommitted.map(({ status }) => status), [
    'RECOVERY_REQUIRED',
    'COMMITTED',
    'NOT_STARTED',
  ]);

  assert.throws(
    () => buildBatchError({
      batchPlan,
      status: 'blocked',
      overallStatus: 'blocked',
      items: batchPlan.transaction_map.map((mapping, index) => (
        index === 0 ? resultItem(mapping, 'BLOCKED') : resultItem(mapping, 'NOT_STARTED')
      )),
      mutationOccurred: false,
      mutationOutcome: 'unchanged',
      errorCode: BATCH_ERROR_CODES.batchLockUnavailable,
      failureScope: 'batch',
    }),
    /batch error/,
  );
  assert.throws(
    () => buildBatchError({
      batchPlan,
      status: 'blocked',
      overallStatus: 'blocked',
      items: batchPlan.transaction_map.map((mapping, index) => (
        index === 0 ? resultItem(mapping, 'COMMITTED') : resultItem(mapping, 'NOT_STARTED')
      )),
      mutationOccurred: false,
      mutationOutcome: 'unchanged',
      errorCode: BATCH_ERROR_CODES.batchLockUnavailable,
      failureScope: 'batch',
    }),
    /batch error/,
  );
  assert.throws(
    () => buildBatchError({
      batchPlan,
      status: 'recovery_required',
      overallStatus: 'RECOVERY_REQUIRED',
      items: recoveryThenCommitted,
      mutationOccurred: false,
      mutationOutcome: 'unchanged',
      errorCode: BATCH_ERROR_CODES.itemRecoveryRequired,
      failureScope: 'item',
      failureItemIndex: 0,
    }),
    /batch error/,
  );
});

test('undo guidance is generated as executable argv and survives a controlled no-shell invocation', () => {
  const transactionId = sha256Json({ transaction: 'undo-guidance' });
  const args = undoCommandArguments(transactionId);
  assert.deepEqual(args, [
    'skills-refiner',
    'cleanup',
    'undo',
    transactionId,
    '--confirm',
    transactionId,
    '--json',
  ]);
  const stub = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args],
    { encoding: 'utf8', shell: false },
  );
  assert.equal(stub.status, 0, stub.stderr);
  assert.deepEqual(JSON.parse(stub.stdout), args);
  assert.throws(() => undoCommandArguments('sha256:not-a-command-safe-id'), /transaction_id/);
});
