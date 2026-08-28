import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  compileProdcraftPlan,
  applyProdcraftPlan,
  APPLY_FAULT_PHASES,
  inspectProdcraftSource,
  LEGACY_ONLY_NAMES,
  observeProdcraftInstall,
  PUBLIC_MEMBER_NAMES,
  recoverProdcraftOperation,
  repairProdcraftCollection,
  statusProdcraftCollection,
  treeDigest,
  undoProdcraftOperation,
} from '../lib/prodcraft-collection.mjs';
import { makeLegacyHome, makeRoot, makeSource, removeRoot, sourceRevision } from './prodcraft-collection-fixtures.mjs';
import { computeCollectionPlanHash } from '../lib/collection-contract.mjs';
import { inspectCollectionEntry } from '../lib/cleanup-macos.mjs';

const launcher = fileURLToPath(new URL('../bin/skills-refiner', import.meta.url));

test('source inspection binds the exact 40-package pc-* public surface', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const observation = inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) });
  assert.equal(observation.members.length, 40);
  assert.deepEqual(observation.members.map(({ name }) => name), [...PUBLIC_MEMBER_NAMES].sort());
  assert.match(observation.tree_digest, /^sha256:[0-9a-f]{64}$/u);
});

test('v1 applies from a clean Git linked worktree without hashing its .git pointer', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const linked = join(root, 'linked-worktree');
  const added = spawnSync('/usr/bin/git', ['-C', source, 'worktree', 'add', '--detach', linked, 'HEAD'], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const fixture = makeLegacyHome(root);
  const revision = sourceRevision(linked);
  const plan = compileProdcraftPlan({
    home: fixture.home, sourceRoot: linked, revision,
    now: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(applyProdcraftPlan(plan, plan.plan_hash).status, 'FILESYSTEM_READY');
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
});

test('source inspection rejects symlinked members and frontmatter identity drift', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const target = join(root, 'elsewhere');
  mkdirSync(target);
  symlinkSync(target, join(source, 'skills/.curated/pc-intake/linked'));
  let committed = spawnSync('/usr/bin/git', [
    '-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'add', 'skills/.curated/pc-intake/linked',
  ], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  committed = spawnSync('/usr/bin/git', [
    '-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'add unsafe source symlink',
  ], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  committed = spawnSync('/usr/bin/git', ['-C', source, 'update-ref', 'refs/remotes/origin/main', 'HEAD'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  assert.throws(() => inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) }), /symlink/u);

  const sourceTwo = makeSource(join(root, 'second'));
  writeFileSync(join(sourceTwo, 'skills/.curated/pc-intake/SKILL.md'), '---\nname: wrong\ndescription: Use when wrong.\n---\n');
  committed = spawnSync('/usr/bin/git', [
    '-C', sourceTwo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-am', 'drift frontmatter identity',
  ], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  committed = spawnSync('/usr/bin/git', ['-C', sourceTwo, 'update-ref', 'refs/remotes/origin/main', 'HEAD'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  assert.throws(() => inspectProdcraftSource({ sourceRoot: sourceTwo, revision: sourceRevision(sourceTwo) }), /frontmatter name/u);
});

test('source inspection requires exact Git HEAD and ignores worktree-only bytes', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  assert.throws(
    () => inspectProdcraftSource({ sourceRoot: source, revision: 'a'.repeat(40) }),
    /HEAD does not match/u,
  );
  const expected = inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) });
  writeFileSync(join(source, 'untracked.txt'), 'untracked\n');
  writeFileSync(join(source, 'skills/.curated/pc-intake/SKILL.md'), 'worktree-only override\n');
  assert.deepEqual(inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) }), expected);
});

test('ignored and empty local paths cannot enter ProdCraft source identity', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  writeFileSync(join(source, '.gitignore'), '.DS_Store\nignored-local/\n');
  const added = spawnSync('/usr/bin/git', ['-C', source, 'add', '.gitignore'], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const committed = spawnSync('/usr/bin/git', [
    '-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'ignore local metadata',
  ], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  const attested = spawnSync('/usr/bin/git', [
    '-C', source, 'update-ref', 'refs/remotes/origin/main', 'HEAD',
  ], { encoding: 'utf8' });
  assert.equal(attested.status, 0, attested.stderr);
  const expected = inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) });
  writeFileSync(join(source, '.DS_Store'), 'ignored metadata\n');
  mkdirSync(join(source, 'ignored-local'));
  const observed = inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) });
  assert.deepEqual(observed, expected);
});

test('source inspection rejects a clean local commit absent from origin tracking refs', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const skillPath = join(source, 'skills/.curated/pc-intake/SKILL.md');
  writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}\nUnpushed local generation.\n`);
  const committed = spawnSync('/usr/bin/git', [
    '-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-am', 'unpushed local generation',
  ], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  assert.throws(
    () => inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) }),
    /origin remote-tracking ref/u,
  );
});

test('remote-tracking attestation drift after planning blocks apply before mutation', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const fixture = makeLegacyHome(root);
  const plan = compileProdcraftPlan({
    home: fixture.home, sourceRoot: source, revision: sourceRevision(source),
    now: '2026-07-20T00:00:00.000Z',
  });
  const removed = spawnSync('/usr/bin/git', [
    '-C', source, 'update-ref', '-d', 'refs/remotes/origin/main',
  ], { encoding: 'utf8' });
  assert.equal(removed.status, 0, removed.stderr);
  assert.throws(() => applyProdcraftPlan(plan, plan.plan_hash), /origin remote-tracking ref/u);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
  assert.equal(existsSync(join(fixture.skillsRoot, 'intake/SKILL.md')), true);
});

test('installed-state observation trusts exact receipt ownership and raw projection targets', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const fixture = makeLegacyHome(root);
  const observation = observeProdcraftInstall({ home: fixture.home });
  assert.equal(observation.legacy.length, 46);
  assert.equal(observation.projections.length, 92);
  assert.equal(observation.conflicts.length, 0);
  assert.equal(observation.receipt_entries.length, 46);
  assert.equal(readFileSync(observation.receipt.path, 'utf8').includes('unrelated'), true);
});

test('installed-state observation discovers every physical projection root', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const fixture = makeLegacyHome(root);
  const augment = join(fixture.home, '.augment/skills');
  mkdirSync(augment, { recursive: true });
  symlinkSync('../../.agents/skills/intake', join(augment, 'intake'));
  const observation = observeProdcraftInstall({ home: fixture.home });
  assert.equal(observation.projections.length, 93);
  assert.deepEqual(observation.agent_roots.map(({ agent }) => agent), ['augment', 'claude', 'factory']);
});

test('plan covers 39 replacements, seven owner retirements, and one upstream-only addition', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const fixture = makeLegacyHome(root);
  const plan = compileProdcraftPlan({
    home: fixture.home,
    sourceRoot: source,
    revision: sourceRevision(source),
    now: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(plan.legacy.filter(({ disposition }) => disposition === 'replaced').length, 39);
  assert.deepEqual(plan.legacy.filter(({ disposition }) => disposition === 'retired_by_owner').map(({ name }) => name).sort(), [...LEGACY_ONLY_NAMES].sort());
  assert.equal(plan.source.members.some(({ name }) => name === 'pc-requirements-engineering'), true);
  assert.equal(plan.legacy.some(({ name }) => name === 'bs-requirements-engineering'), false);
  assert.equal(plan.target.collection_root, join(fixture.home, '.agents/skills/prodcraft'));
  assert.match(plan.plan_hash, /^sha256:[0-9a-f]{64}$/u);
});

test('plan fails closed when a receipt-owned directory or projection has drifted', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const fixture = makeLegacyHome(root);
  writeFileSync(join(fixture.skillsRoot, 'intake/changed.txt'), 'drift\n');
  const first = compileProdcraftPlan({ home: fixture.home, sourceRoot: source, revision: sourceRevision(source), now: '2026-07-20T00:00:00.000Z' });
  writeFileSync(join(fixture.skillsRoot, 'intake/changed.txt'), 'more drift\n');
  const second = compileProdcraftPlan({ home: fixture.home, sourceRoot: source, revision: sourceRevision(source), now: '2026-07-20T01:00:00.000Z' });
  assert.notEqual(first.plan_hash, second.plan_hash);
});

function plannedFixture(t) {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const fixture = makeLegacyHome(root);
  const plan = compileProdcraftPlan({ home: fixture.home, sourceRoot: source, revision: sourceRevision(source), now: '2026-07-20T00:00:00.000Z' });
  return { root, source, fixture, plan };
}

function advanceProdcraftSource(source, marker = 'generation-two') {
  const relativePath = 'skills/.curated/pc-intake/generation.txt';
  writeFileSync(join(source, relativePath), `${marker}\n`);
  let result = spawnSync('/usr/bin/git', ['-C', source, 'add', relativePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync('/usr/bin/git', [
    '-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', `advance ${marker}`,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync('/usr/bin/git', ['-C', source, 'update-ref', 'refs/remotes/origin/main', 'HEAD'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return sourceRevision(source);
}

function successorFixture(t, { legacyActive = false, removeReceipt = false } = {}) {
  const value = plannedFixture(t);
  const first = applyProdcraftPlan(value.plan, value.plan.plan_hash);
  const activePath = join(value.fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  if (legacyActive) {
    writeFileSync(activePath, `${JSON.stringify({
      schema_version: 'skills-refiner.collection.active.v1',
      operation_id: first.operation_id,
      plan_hash: value.plan.plan_hash,
    }, null, 2)}\n`);
  }
  if (removeReceipt) rmSync(join(value.fixture.home, '.agents/.skill-lock.json'));
  const revision = advanceProdcraftSource(value.source);
  const successor = compileProdcraftPlan({
    home: value.fixture.home,
    sourceRoot: value.source,
    revision,
    now: '2026-07-21T00:00:00.000Z',
  });
  return { ...value, first, successor };
}

function killApplyAt({ root, home, plan, phase, label = 'kill-plan' }) {
  const planPath = join(root, `${label}-${phase}.json`);
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const result = spawnSync(launcher, [
    'collection', 'apply', '--plan', planPath, '--confirm', plan.plan_hash, '--json',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      SKILLS_REFINER_NODE_BIN: process.execPath,
      SKILLS_REFINER_TEST_ALLOW_FAULTS: '1',
      SKILLS_REFINER_TEST_KILL_PHASE: phase,
    },
  });
  assert.equal(result.signal, 'SIGKILL', result.stdout + result.stderr);
  return `prodcraft-${plan.plan_hash.slice(7, 19)}`;
}

test('ProdCraft lifecycle is deterministic across restrictive umasks', (t) => {
  const originalUmask = process.umask();
  try {
    process.umask(0o022);
    const root = makeRoot();
    t.after(() => removeRoot(root));
    const source = makeSource(root);
    const fixture = makeLegacyHome(root);
    const plan = compileProdcraftPlan({
      home: fixture.home, sourceRoot: source, revision: sourceRevision(source),
      now: '2026-07-20T00:00:00.000Z',
    });
    process.umask(0o077);
    assert.equal(applyProdcraftPlan(plan, plan.plan_hash).status, 'FILESYSTEM_READY');
    process.umask(0o022);
    assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
    process.umask(0o077);
    assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
    const collection = join(fixture.skillsRoot, 'prodcraft');
    assert.equal(lstatSync(collection).mode & 0o777, 0o755);
    assert.equal(lstatSync(join(collection, 'pc-prodcraft')).mode & 0o777, 0o755);
    assert.equal(lstatSync(join(collection, 'pc-prodcraft/SKILL.md')).mode & 0o777, 0o644);
    assert.equal(lstatSync(join(collection, 'pc-prodcraft/prodcraft-runtime.json')).mode & 0o777, 0o600);
  } finally { process.umask(originalUmask); }
});

test('successor generation upgrades from managed truth without requiring the external receipt', (t) => {
  const { fixture, plan, first, successor } = successorFixture(t, { removeReceipt: true });
  const predecessorActive = successor.predecessor.active_record;
  assert.equal(successor.schema_version, 'skills-refiner.collection.plan.v3');
  assert.equal(successor.legacy.length, 0);
  assert.equal(successor.projections.length, 0);
  assert.equal(successor.predecessor.operation_id, first.operation_id);
  assert.equal(successor.predecessor.retired_names.length, 46);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
  assert.equal(statusProdcraftCollection({ home: fixture.home }).external_receipt_state, 'missing');

  const applied = applyProdcraftPlan(successor, successor.plan_hash);
  const current = statusProdcraftCollection({ home: fixture.home });
  assert.equal(current.status, 'FILESYSTEM_READY', current.issues.join(', '));
  assert.equal(current.operation_id, applied.operation_id);
  assert.equal(current.lifecycle.first_activated_at, predecessorActive.activated_at);
  assert.equal(current.source.resolved_revision, successor.source.revision);
  assert.notEqual(current.source.resolved_revision, plan.source.revision);

  mkdirSync(join(fixture.skillsRoot, 'intake'));
  assert.equal(
    statusProdcraftCollection({ home: fixture.home }).issues.includes('LEGACY_REAPPEARED:intake'),
    true,
  );
  rmSync(join(fixture.skillsRoot, 'intake'), { recursive: true });

  const undone = undoProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(undone.status, 'RESTORED');
  const restored = statusProdcraftCollection({ home: fixture.home });
  assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
  assert.equal(restored.operation_id, first.operation_id);
});

test('successor generation preserves honest unknown activation history from active.v1', (t) => {
  const { fixture, first, successor } = successorFixture(t, { legacyActive: true });
  assert.equal(successor.predecessor.operation_id, first.operation_id);
  assert.equal(successor.predecessor.activated_at, null);
  assert.equal(successor.predecessor.first_activated_at, null);
  const forged = structuredClone(successor);
  forged.predecessor.activated_at = '2026-07-20T12:00:00.000Z';
  forged.plan_hash = computeCollectionPlanHash(forged);
  assert.throws(() => applyProdcraftPlan(forged, forged.plan_hash), /active_record is invalid/u);
  const applied = applyProdcraftPlan(successor, successor.plan_hash);
  const current = statusProdcraftCollection({ home: fixture.home });
  assert.equal(current.status, 'FILESYSTEM_READY', current.issues.join(', '));
  assert.equal(current.lifecycle.first_activated_at, null);
  assert.match(current.lifecycle.current_generation_activated_at, /^\d{4}-\d{2}-\d{2}T/u);
  undoProdcraftOperation({ home: fixture.home, operationId: applied.operation_id, confirmation: applied.operation_id });
  const restored = statusProdcraftCollection({ home: fixture.home });
  assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
  assert.equal(restored.operation_id, first.operation_id);
  assert.equal(restored.lifecycle.first_activated_at, null);
});

for (const legacySchema of [
  'skills-refiner.collection.plan.v1',
  'skills-refiner.collection.plan.v2',
]) {
  test(`successor apply and undo preserve a real ${legacySchema} control generation`, (t) => {
    const { source, fixture, plan } = plannedFixture(t);
    const legacyPlan = structuredClone(plan);
    legacyPlan.schema_version = legacySchema;
    delete legacyPlan.predecessor;
    if (legacySchema.endsWith('.v1')) delete legacyPlan.source.remote_attestation;
    legacyPlan.plan_hash = computeCollectionPlanHash(legacyPlan);
    const first = applyProdcraftPlan(legacyPlan, legacyPlan.plan_hash);
    const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
    writeFileSync(activePath, `${JSON.stringify({
      schema_version: 'skills-refiner.collection.active.v1',
      operation_id: first.operation_id,
      plan_hash: legacyPlan.plan_hash,
    }, null, 2)}\n`);
    const revision = advanceProdcraftSource(source, `successor-of-${legacySchema.at(-1)}`);
    const successor = compileProdcraftPlan({
      home: fixture.home,
      sourceRoot: source,
      revision,
      now: '2026-07-22T00:00:00.000Z',
    });
    assert.equal(successor.predecessor.operation_id, first.operation_id);
    assert.equal(successor.predecessor.activated_at, null);
    assert.equal(successor.predecessor.first_activated_at, null);
    const applied = applyProdcraftPlan(successor, successor.plan_hash);
    assert.equal(statusProdcraftCollection({ home: fixture.home }).operation_id, applied.operation_id);
    const undone = undoProdcraftOperation({
      home: fixture.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    });
    assert.equal(undone.status, 'RESTORED');
    const restored = statusProdcraftCollection({ home: fixture.home });
    assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
    assert.equal(restored.operation_id, first.operation_id);
    assert.equal(JSON.parse(readFileSync(activePath, 'utf8')).schema_version, 'skills-refiner.collection.active.v1');
  });
}

test('successor recover uses independent recovery when predecessor quarantine is missing or corrupt', (t) => {
  const { root, fixture, first, successor } = successorFixture(t);
  const operationId = killApplyAt({
    root,
    home: fixture.home,
    plan: successor,
    phase: 'after_active_publish',
    label: 'successor-recovery',
  });
  const quarantine = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${operationId}/predecessor`,
  );
  rmSync(join(quarantine, 'collection'), { recursive: true });
  const exposure = successor.predecessor.exposures[0];
  const exposureQuarantine = join(
    quarantine,
    'exposures',
    exposure.scope === 'global' ? 'global' : exposure.agent,
  );
  unlinkSync(exposureQuarantine);
  symlinkSync('corrupt-target', exposureQuarantine);
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId,
    confirmation: operationId,
  });
  assert.equal(recovered.status, 'RESTORED_PRESTATE');
  assert.equal(recovered.recreated_from_independent_recovery, true);
  const restored = statusProdcraftCollection({ home: fixture.home });
  assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
  assert.equal(restored.operation_id, first.operation_id);
});

test('successor recovery source failure is detected before moving current payloads', (t) => {
  const { root, fixture, successor } = successorFixture(t);
  const operationId = killApplyAt({
    root,
    home: fixture.home,
    plan: successor,
    phase: 'after_active_publish',
    label: 'successor-missing-recovery',
  });
  const quarantineCollection = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${operationId}/predecessor/collection`,
  );
  const recoveryCollection = join(
    fixture.home,
    `Library/Application Support/skills-refiner/recovery/operations/${operationId}/pre-state/predecessor/collection`,
  );
  rmSync(quarantineCollection, { recursive: true });
  rmSync(recoveryCollection, { recursive: true });
  const collection = join(fixture.skillsRoot, 'prodcraft');
  const treeBefore = treeDigest(collection);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  const activeBefore = readFileSync(activePath, 'utf8');
  const gatewayBefore = readlinkSync(join(fixture.skillsRoot, 'pc-prodcraft'));
  assert.throws(
    () => recoverProdcraftOperation({ home: fixture.home, operationId, confirmation: operationId }),
    /missing|recovery/u,
  );
  assert.equal(treeDigest(collection), treeBefore);
  assert.equal(readFileSync(activePath, 'utf8'), activeBefore);
  assert.equal(readlinkSync(join(fixture.skillsRoot, 'pc-prodcraft')), gatewayBefore);
});

test('successor recover refuses a tampered current collection before any rollback mutation', (t) => {
  const { root, fixture, successor } = successorFixture(t);
  const operationId = killApplyAt({
    root,
    home: fixture.home,
    plan: successor,
    phase: 'after_active_publish',
    label: 'successor-current-collection-drift',
  });
  writeFileSync(join(fixture.skillsRoot, 'prodcraft/pc-intake/tampered.txt'), 'tampered\n');
  const collection = join(fixture.skillsRoot, 'prodcraft');
  const collectionBefore = treeDigest(collection);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  const activeBefore = readFileSync(activePath, 'utf8');
  const gatewayPath = join(fixture.skillsRoot, 'pc-prodcraft');
  const gatewayBefore = inspectCollectionEntry({
    home: fixture.home,
    path: gatewayPath,
  }).manifest_hash;
  assert.throws(
    () => recoverProdcraftOperation({ home: fixture.home, operationId, confirmation: operationId }),
    /physical ProdCraft collection is not the exact generation/u,
  );
  assert.equal(treeDigest(collection), collectionBefore);
  assert.equal(readFileSync(activePath, 'utf8'), activeBefore);
  assert.equal(inspectCollectionEntry({
    home: fixture.home,
    path: gatewayPath,
  }).manifest_hash, gatewayBefore);
});

test('successor recover uses exact quarantine when independent recovery is unavailable', (t) => {
  const { root, fixture, first, successor } = successorFixture(t);
  const operationId = killApplyAt({
    root,
    home: fixture.home,
    plan: successor,
    phase: 'after_active_publish',
    label: 'successor-quarantine-source',
  });
  rmSync(join(
    fixture.home,
    `Library/Application Support/skills-refiner/recovery/operations/${operationId}/pre-state/predecessor`,
  ), { recursive: true });
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId,
    confirmation: operationId,
  });
  assert.equal(recovered.status, 'RESTORED_PRESTATE');
  assert.equal(recovered.recreated_from_independent_recovery, false);
  const restored = statusProdcraftCollection({ home: fixture.home });
  assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
  assert.equal(restored.operation_id, first.operation_id);
});

test('successor undo uses independent recovery when exact predecessor quarantine is unavailable', (t) => {
  const { fixture, first, successor } = successorFixture(t);
  const applied = applyProdcraftPlan(successor, successor.plan_hash);
  const quarantineRoot = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${applied.operation_id}/predecessor`,
  );
  rmSync(join(quarantineRoot, 'collection'), { recursive: true });
  const exposure = successor.predecessor.exposures[0];
  rmSync(join(
    quarantineRoot,
    'exposures',
    exposure.scope === 'global' ? 'global' : exposure.agent,
  ));
  const undone = undoProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(undone.status, 'RESTORED');
  assert.equal(undone.recreated_from_independent_recovery, true);
  const restored = statusProdcraftCollection({ home: fixture.home });
  assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
  assert.equal(restored.operation_id, first.operation_id);
});

test('successor recover replays an exposure already restored before a crash', (t) => {
  const { root, fixture, first, successor } = successorFixture(t);
  const operationId = killApplyAt({
    root,
    home: fixture.home,
    plan: successor,
    phase: 'after_active_publish',
    label: 'successor-reentrant-exposure',
  });
  const exposure = successor.predecessor.exposures[0];
  const label = exposure.scope === 'global' ? 'global' : exposure.agent;
  const quarantine = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${operationId}/predecessor/exposures/${label}`,
  );
  const postState = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${operationId}/post-state/rollback/predecessor/exposures/${label}`,
  );
  mkdirSync(join(postState, '..'), { recursive: true });
  renameSync(exposure.path, postState);
  const copied = spawnSync('/bin/cp', ['-a', quarantine, exposure.path], { encoding: 'utf8' });
  assert.equal(copied.status, 0, copied.stderr);
  assert.equal(readlinkSync(exposure.path), exposure.raw_target);
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId,
    confirmation: operationId,
  });
  assert.equal(recovered.status, 'RESTORED_PRESTATE');
  const restored = statusProdcraftCollection({ home: fixture.home });
  assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
  assert.equal(restored.operation_id, first.operation_id);
});

test('successor recover validates the predecessor operation before payload mutation', (t) => {
  const { root, fixture, first, successor } = successorFixture(t);
  const operationId = killApplyAt({
    root,
    home: fixture.home,
    plan: successor,
    phase: 'after_active_publish',
    label: 'successor-predecessor-control',
  });
  const predecessorOperationPath = join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${first.operation_id}/operation.json`,
  );
  const predecessorOperation = JSON.parse(readFileSync(predecessorOperationPath, 'utf8'));
  predecessorOperation.state = 'RESTORED';
  writeFileSync(predecessorOperationPath, `${JSON.stringify(predecessorOperation, null, 2)}\n`);
  const collection = join(fixture.skillsRoot, 'prodcraft');
  const collectionBefore = treeDigest(collection);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  const activeBefore = readFileSync(activePath, 'utf8');
  const gatewayBefore = inspectCollectionEntry({
    home: fixture.home,
    path: join(fixture.skillsRoot, 'pc-prodcraft'),
  }).manifest_hash;
  assert.throws(
    () => recoverProdcraftOperation({ home: fixture.home, operationId, confirmation: operationId }),
    /predecessor operation is not the exact committed generation/u,
  );
  assert.equal(treeDigest(collection), collectionBefore);
  assert.equal(readFileSync(activePath, 'utf8'), activeBefore);
  assert.equal(inspectCollectionEntry({
    home: fixture.home,
    path: join(fixture.skillsRoot, 'pc-prodcraft'),
  }).manifest_hash, gatewayBefore);
});

test('recover refuses ambiguous sibling successor generations without mutation', (t) => {
  const { fixture, source, successor: firstSuccessor } = successorFixture(t);
  const secondSuccessor = compileProdcraftPlan({
    home: fixture.home,
    sourceRoot: source,
    revision: sourceRevision(source),
    now: '2026-07-21T01:00:00.000Z',
  });
  const committedOperation = JSON.parse(readFileSync(join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${firstSuccessor.predecessor.operation_id}/operation.json`,
  ), 'utf8'));
  for (const candidate of [firstSuccessor, secondSuccessor]) {
    const id = `prodcraft-${candidate.plan_hash.slice(7, 19)}`;
    const operationRoot = join(
      fixture.home,
      `.agents/skill-control/collections/prodcraft/operations/${id}`,
    );
    mkdirSync(operationRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(operationRoot, 'plan.json'), `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(operationRoot, 'operation.json'), `${JSON.stringify({
      ...committedOperation,
      operation_id: id,
      plan_hash: candidate.plan_hash,
      state: 'PREPARED',
      mutation_occurred: false,
      error_code: null,
    }, null, 2)}\n`, { mode: 0o600 });
  }
  const requestedId = `prodcraft-${firstSuccessor.plan_hash.slice(7, 19)}`;
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  const activeBefore = readFileSync(activePath, 'utf8');
  const collectionBefore = treeDigest(join(fixture.skillsRoot, 'prodcraft'));
  const operationPath = join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${requestedId}/operation.json`,
  );
  const operationBefore = readFileSync(operationPath, 'utf8');
  assert.throws(
    () => recoverProdcraftOperation({
      home: fixture.home,
      operationId: requestedId,
      confirmation: requestedId,
    }),
    /multiple nonterminal ProdCraft operations/u,
  );
  assert.equal(readFileSync(activePath, 'utf8'), activeBefore);
  assert.equal(readFileSync(operationPath, 'utf8'), operationBefore);
  assert.equal(treeDigest(join(fixture.skillsRoot, 'prodcraft')), collectionBefore);
});

test('successor rollback destination conflicts fail before moving any active payload', (t) => {
  const { root, fixture, successor } = successorFixture(t);
  const operationId = killApplyAt({
    root,
    home: fixture.home,
    plan: successor,
    phase: 'after_active_publish',
    label: 'successor-post-conflict',
  });
  const exposure = successor.predecessor.exposures.at(-1);
  const conflict = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${operationId}/post-state/rollback/predecessor/exposures/${exposure.scope === 'global' ? 'global' : exposure.agent}`,
  );
  mkdirSync(join(conflict, '..'), { recursive: true });
  symlinkSync('conflict', conflict);
  const collection = join(fixture.skillsRoot, 'prodcraft');
  const treeBefore = treeDigest(collection);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  const activeBefore = readFileSync(activePath, 'utf8');
  const gatewaySnapshots = successor.predecessor.exposures
    .filter(({ path }) => existsSync(path))
    .map(({ path }) => [path, inspectCollectionEntry({ home: fixture.home, path }).manifest_hash]);
  assert.throws(
    () => recoverProdcraftOperation({ home: fixture.home, operationId, confirmation: operationId }),
    /post-state exposure exists/u,
  );
  assert.equal(treeDigest(collection), treeBefore);
  assert.equal(readFileSync(activePath, 'utf8'), activeBefore);
  for (const [path, manifest] of gatewaySnapshots) {
    assert.equal(inspectCollectionEntry({ home: fixture.home, path }).manifest_hash, manifest);
  }
});

test('recover refuses a superseded committed generation before touching current state', (t) => {
  const { fixture, first, successor } = successorFixture(t);
  const applied = applyProdcraftPlan(successor, successor.plan_hash);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  const operationPath = join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${first.operation_id}/operation.json`,
  );
  const activeBefore = readFileSync(activePath, 'utf8');
  const operationBefore = readFileSync(operationPath, 'utf8');
  const gatewayBefore = readlinkSync(join(fixture.skillsRoot, 'pc-prodcraft'));
  assert.throws(
    () => recoverProdcraftOperation({
      home: fixture.home,
      operationId: first.operation_id,
      confirmation: first.operation_id,
    }),
    /committed generation that is not active/u,
  );
  assert.equal(readFileSync(activePath, 'utf8'), activeBefore);
  assert.equal(readFileSync(operationPath, 'utf8'), operationBefore);
  assert.equal(readlinkSync(join(fixture.skillsRoot, 'pc-prodcraft')), gatewayBefore);
  const current = statusProdcraftCollection({ home: fixture.home });
  assert.equal(current.status, 'FILESYSTEM_READY', current.issues.join(', '));
  assert.equal(current.operation_id, applied.operation_id);
});

test('missing active pointer is reported and recovered without inventing activation time', (t) => {
  const { fixture, successor } = successorFixture(t);
  const applied = applyProdcraftPlan(successor, successor.plan_hash);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  rmSync(activePath);
  const orphaned = statusProdcraftCollection({ home: fixture.home });
  assert.equal(orphaned.status, 'RECOVERY_REQUIRED');
  assert.equal(orphaned.operation_id, applied.operation_id);
  assert.equal(orphaned.plan_hash, successor.plan_hash);
  assert.deepEqual(orphaned.issues, ['ORPHANED_ACTIVE_POINTER']);
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(recovered.status, 'FILESYSTEM_READY');
  assert.equal(recovered.mutation_occurred, true);
  assert.deepEqual(recovered.repaired, ['active_pointer']);
  const active = JSON.parse(readFileSync(activePath, 'utf8'));
  assert.equal(active.schema_version, 'skills-refiner.collection.active.v1');
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
  assert.equal(statusProdcraftCollection({ home: fixture.home }).lifecycle.current_generation_activated_at, null);
});

test('orphaned status and recover refuse a tampered physical collection', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  rmSync(activePath);
  writeFileSync(join(fixture.skillsRoot, 'prodcraft/pc-intake/tampered.txt'), 'tampered\n');
  const orphaned = statusProdcraftCollection({ home: fixture.home });
  assert.equal(orphaned.status, 'RECOVERY_REQUIRED');
  assert.deepEqual(orphaned.issues, ['ORPHANED_COLLECTION_CONTROL']);
  assert.throws(
    () => recoverProdcraftOperation({
      home: fixture.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    }),
    /not the exact generation|not the exact physical collection/u,
  );
  assert.equal(existsSync(activePath), false);
  assert.equal(existsSync(join(fixture.skillsRoot, 'prodcraft/pc-intake/tampered.txt')), true);
});

test('status retains committed control truth when active and physical collection are deleted', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  rmSync(join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json'));
  rmSync(join(fixture.skillsRoot, 'prodcraft'), { recursive: true });
  const orphaned = statusProdcraftCollection({ home: fixture.home });
  assert.equal(orphaned.status, 'RECOVERY_REQUIRED');
  assert.equal(orphaned.operation_id, applied.operation_id);
  assert.equal(orphaned.plan_hash, plan.plan_hash);
  assert.deepEqual(orphaned.issues, ['ORPHANED_COLLECTION_MISSING']);
  assert.throws(
    () => recoverProdcraftOperation({
      home: fixture.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    }),
    /not the exact physical collection/u,
  );
});

test('active recovery refuses to resurrect a superseded committed lineage generation', (t) => {
  const { fixture, first, successor } = successorFixture(t);
  applyProdcraftPlan(successor, successor.plan_hash);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  rmSync(activePath);
  const currentCollection = join(fixture.skillsRoot, 'prodcraft');
  rmSync(currentCollection, { recursive: true });
  const predecessorCollection = join(
    fixture.home,
    `.agents/skills-quarantine/collections/prodcraft-${successor.plan_hash.slice(7, 19)}/predecessor/collection`,
  );
  const copied = spawnSync('/usr/bin/ditto', [
    '--rsrc', '--extattr', '--acl', predecessorCollection, currentCollection,
  ], { encoding: 'utf8' });
  assert.equal(copied.status, 0, copied.stderr);
  const orphaned = statusProdcraftCollection({ home: fixture.home });
  assert.equal(orphaned.status, 'RECOVERY_REQUIRED');
  assert.equal(orphaned.operation_id, first.operation_id);
  assert.deepEqual(orphaned.issues, ['ORPHANED_LINEAGE_DRIFT']);

  writeFileSync(activePath, `${JSON.stringify(successor.predecessor.active_record, null, 2)}\n`, { mode: 0o600 });
  const rewound = statusProdcraftCollection({ home: fixture.home });
  assert.equal(rewound.status, 'RECOVERY_REQUIRED');
  assert.equal(rewound.issues.includes('ACTIVE_LINEAGE_DRIFT'), true);
  rmSync(activePath);
  const collectionBefore = treeDigest(currentCollection);
  assert.throws(
    () => recoverProdcraftOperation({
      home: fixture.home,
      operationId: first.operation_id,
      confirmation: first.operation_id,
    }),
    /unique committed lineage tip/u,
  );
  assert.equal(existsSync(activePath), false);
  assert.equal(treeDigest(currentCollection), collectionBefore);
});

test('active recovery validates recovery evidence before creating the pointer', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  rmSync(activePath);
  writeFileSync(join(
    fixture.home,
    `Library/Application Support/skills-refiner/recovery/operations/${applied.operation_id}/pre-state/skills/intake/tampered.txt`,
  ), 'tampered recovery\n');
  const operationPath = join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${applied.operation_id}/operation.json`,
  );
  const operationBefore = readFileSync(operationPath, 'utf8');
  const collectionBefore = treeDigest(join(fixture.skillsRoot, 'prodcraft'));
  assert.throws(
    () => recoverProdcraftOperation({
      home: fixture.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    }),
    /active pointer recovery requires exact managed state/u,
  );
  assert.equal(existsSync(activePath), false);
  assert.equal(readFileSync(operationPath, 'utf8'), operationBefore);
  assert.equal(treeDigest(join(fixture.skillsRoot, 'prodcraft')), collectionBefore);
});

test('orphan recovery does not derive expected identity from a mutable artifact', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  rmSync(activePath);
  const artifactRoot = join(
    plan.control.root,
    'artifacts',
    plan.source.tree_digest.slice('sha256:'.length),
    'repo',
  );
  writeFileSync(join(artifactRoot, 'skills/.curated/pc-intake/tampered.txt'), 'tampered artifact\n');
  const orphaned = statusProdcraftCollection({ home: fixture.home });
  assert.equal(orphaned.status, 'RECOVERY_REQUIRED');
  assert.deepEqual(orphaned.issues, ['ORPHANED_COLLECTION_CONTROL']);
  assert.throws(
    () => recoverProdcraftOperation({
      home: fixture.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    }),
    /not the exact generation/u,
  );
  assert.equal(existsSync(activePath), false);
});

test('recover after successor undo is idempotent and preserves RESTORED history', (t) => {
  const { fixture, successor } = successorFixture(t);
  const applied = applyProdcraftPlan(successor, successor.plan_hash);
  undoProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  const operationPath = join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${applied.operation_id}/operation.json`,
  );
  const before = readFileSync(operationPath, 'utf8');
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(recovered.mutation_occurred, false);
  assert.equal(readFileSync(operationPath, 'utf8'), before);
  assert.equal(JSON.parse(before).state, 'RESTORED');
});

test('recover on a healthy committed generation is a zero-mutation status check', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const operationPath = join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${applied.operation_id}/operation.json`,
  );
  const before = readFileSync(operationPath, 'utf8');
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(recovered.status, 'FILESYSTEM_READY');
  assert.equal(recovered.mutation_occurred, false);
  assert.equal(readFileSync(operationPath, 'utf8'), before);
});

test('recover refuses drifted committed state without changing payload or history', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const operationPath = join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${applied.operation_id}/operation.json`,
  );
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  const missingMember = join(fixture.skillsRoot, 'prodcraft/pc-intake');
  rmSync(missingMember, { recursive: true });
  const operationBefore = readFileSync(operationPath, 'utf8');
  const activeBefore = readFileSync(activePath, 'utf8');
  assert.throws(
    () => recoverProdcraftOperation({
      home: fixture.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    }),
    /drifted committed state/u,
  );
  assert.equal(existsSync(missingMember), false);
  assert.equal(readFileSync(operationPath, 'utf8'), operationBefore);
  assert.equal(readFileSync(activePath, 'utf8'), activeBefore);
});

for (const faultPhase of APPLY_FAULT_PHASES) {
  test(`successor apply fault ${faultPhase} restores the immediate predecessor generation`, (t) => {
    const { fixture, first, successor } = successorFixture(t);
    assert.throws(
      () => applyProdcraftPlan(successor, successor.plan_hash, { faultPhase }),
      /injected fault/u,
    );
    const restored = statusProdcraftCollection({ home: fixture.home });
    assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
    assert.equal(restored.operation_id, first.operation_id);
  });
}

for (const killPhase of APPLY_FAULT_PHASES) {
  test(`successor SIGKILL ${killPhase} is visible and recover restores the predecessor`, (t) => {
    const { root, fixture, first, successor } = successorFixture(t);
    const planPath = join(root, `successor-kill-${killPhase}.json`);
    writeFileSync(planPath, `${JSON.stringify(successor, null, 2)}\n`);
    const result = spawnSync(launcher, [
      'collection', 'apply', '--plan', planPath, '--confirm', successor.plan_hash, '--json',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: fixture.home,
        SKILLS_REFINER_NODE_BIN: process.execPath,
        SKILLS_REFINER_TEST_ALLOW_FAULTS: '1',
        SKILLS_REFINER_TEST_KILL_PHASE: killPhase,
      },
    });
    assert.equal(result.signal, 'SIGKILL');
    const interrupted = statusProdcraftCollection({ home: fixture.home });
    assert.equal(interrupted.status, 'RECOVERY_REQUIRED');
    assert.equal(interrupted.operation_id, `prodcraft-${successor.plan_hash.slice(7, 19)}`);
    const recovered = recoverProdcraftOperation({
      home: fixture.home,
      operationId: interrupted.operation_id,
      confirmation: interrupted.operation_id,
    });
    assert.equal(recovered.status, 'RESTORED_PRESTATE');
    const restored = statusProdcraftCollection({ home: fixture.home });
    assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
    assert.equal(restored.operation_id, first.operation_id);
  });
}

test('ProdCraft apply preserves an unowned conflicting staging root', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const stageRoot = join(
    fixture.home, '.agents/.skills-refiner-stage',
    `prodcraft-${plan.plan_hash.slice(7, 19)}`,
  );
  mkdirSync(stageRoot, { recursive: true });
  const marker = join(stageRoot, 'user-owned-marker.txt');
  writeFileSync(marker, 'preserve\n');
  assert.throws(() => applyProdcraftPlan(plan, plan.plan_hash), /staging root already exists/u);
  assert.equal(readFileSync(marker, 'utf8'), 'preserve\n');
});

test('ProdCraft status detects and repair restores collection root mode drift', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  chmodSync(join(fixture.skillsRoot, 'prodcraft'), 0o700);
  const drifted = statusProdcraftCollection({ home: fixture.home });
  assert.equal(drifted.issues.includes('COLLECTION_ROOT_MODE_DRIFT'), true);
  repairProdcraftCollection({ home: fixture.home, confirmation: applied.operation_id });
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
  assert.equal(lstatSync(join(fixture.skillsRoot, 'prodcraft')).mode & 0o777, 0o755);
});

test('ProdCraft status rejects hidden Git metadata and unsafe artifact root modes', (t) => {
  const { fixture, plan } = plannedFixture(t);
  applyProdcraftPlan(plan, plan.plan_hash);
  const artifactRoot = join(plan.control.root, 'artifacts', plan.source.tree_digest.slice(7), 'repo');
  chmodSync(artifactRoot, 0o750);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
  chmodSync(artifactRoot, 0o777);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).issues.includes('ARTIFACT_ROOT_MODE_UNSAFE'), true);
  chmodSync(artifactRoot, 0o700);
  mkdirSync(join(artifactRoot, '.git'));
  assert.equal(statusProdcraftCollection({ home: fixture.home }).issues.includes('ARTIFACT_CONTAINS_GIT_METADATA'), true);
});

test('apply publishes the physical collection, index, locator, and bounded projections', (t) => {
  const { fixture, plan } = plannedFixture(t);
  assert.throws(() => applyProdcraftPlan(plan, 'wrong'), /confirmation/u);
  const result = applyProdcraftPlan(plan, plan.plan_hash);
  assert.equal(result.status, 'FILESYSTEM_READY');
  const collection = join(fixture.skillsRoot, 'prodcraft');
  assert.equal(lstatSync(collection).isDirectory(), true);
  assert.equal(existsSync(join(collection, 'SKILL.md')), false);
  assert.equal(PUBLIC_MEMBER_NAMES.filter((name) => lstatSync(join(collection, name)).isDirectory()).length, 40);
  assert.equal(readlinkSync(join(fixture.skillsRoot, 'pc-prodcraft')), 'prodcraft/pc-prodcraft');
  assert.equal(fixture.legacyNames.some((name) => name !== 'prodcraft' && existsSync(join(fixture.skillsRoot, name))), false);
  assert.equal(existsSync(join(fixture.skillsRoot, 'unrelated/SKILL.md')), true);
  const status = statusProdcraftCollection({ home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY');
  assert.equal(status.member_count, 40);
  assert.equal(status.external_receipt_state, 'superseded');
  assert.equal(status.source.upstream_release.status, 'declared');
  assert.equal(status.source.upstream_release.value, '1.0.0');
  assert.equal(status.source.upstream_release.source_path, 'manifest.yml');
  assert.equal(status.source.upstream_release.extraction, 'yaml_root_version');
});

test('ProdCraft controller audits the exact released lock and rejects symlinked operation views', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const fixture = makeLegacyHome(root);
  const plan = compileProdcraftPlan({ home: fixture.home, sourceRoot: source, revision: sourceRevision(source), now: '2026-07-20T00:00:00.000Z' });
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const lockPath = join(fixture.home, '.agents/skill-control/collection-mutation.lock');
  assert.equal(existsSync(lockPath), false);
  const auditRoot = join(fixture.home, '.agents/skill-control/lock-audit');
  const releases = readdirSync(auditRoot).filter((name) => name.endsWith('.released.json'));
  assert.equal(releases.length, 1);
  assert.equal(lstatSync(join(auditRoot, releases[0])).mode & 0o077, 0);

  const operationRoot = join(fixture.home, `.agents/skill-control/collections/prodcraft/operations/${applied.operation_id}`);
  const operationPath = join(operationRoot, 'operation.json');
  renameSync(operationPath, join(operationRoot, 'operation.real.json'));
  symlinkSync('operation.real.json', operationPath);
  const status = statusProdcraftCollection({ home: fixture.home });
  assert.equal(status.status, 'RECOVERY_REQUIRED');
  assert.equal(status.issues.includes('OPERATION_MISSING_OR_INVALID'), true);
  assert.equal(status.issues.includes('ACTIVE_LINEAGE_DRIFT'), true);

  unlinkSync(operationPath);
  renameSync(join(operationRoot, 'operation.real.json'), operationPath);
  const replacement = JSON.parse(readFileSync(operationPath, 'utf8'));
  replacement.plan_hash = `sha256:${'0'.repeat(64)}`;
  const replacementPath = join(operationRoot, 'operation.replacement.json');
  writeFileSync(replacementPath, `${JSON.stringify(replacement, null, 2)}\n`, { mode: 0o600 });
  renameSync(replacementPath, operationPath);
  const replacedStatus = statusProdcraftCollection({ home: fixture.home });
  assert.equal(replacedStatus.status, 'RECOVERY_REQUIRED');
  assert.equal(replacedStatus.issues.includes('OPERATION_IDENTITY_DRIFT'), true);
  assert.equal(replacedStatus.issues.includes('ACTIVE_LINEAGE_DRIFT'), true);
});

test('status skips a planned Agent projection after that Agent root is removed', (t) => {
  const { fixture, plan } = plannedFixture(t);
  applyProdcraftPlan(plan, plan.plan_hash);
  rmSync(fixture.agentRoots[0], { recursive: true });
  const status = statusProdcraftCollection({ home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
  assert.equal(status.issues.some((issue) => issue.startsWith('AGENT_GATEWAY_DRIFT:')), false);
});

test('quarantine status uses stable content and security identity, not inode-bound manifest identity', (t) => {
  const { root, fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const quarantineRoot = join(fixture.home, `.agents/skills-quarantine/collections/${applied.operation_id}`);

  const quarantinedSkill = join(quarantineRoot, 'skills', plan.legacy[0].name);
  const replacement = join(root, 'replacement-skill');
  const beforeSkill = inspectCollectionEntry({ home: fixture.home, path: quarantinedSkill });
  const copied = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', quarantinedSkill, replacement], { encoding: 'utf8' });
  assert.equal(copied.status, 0, copied.stderr);
  rmSync(quarantinedSkill, { recursive: true });
  renameSync(replacement, quarantinedSkill);
  const afterSkill = inspectCollectionEntry({ home: fixture.home, path: quarantinedSkill });
  assert.notEqual(afterSkill.manifest_hash, beforeSkill.manifest_hash);
  assert.equal(afterSkill.security_metadata_hash, beforeSkill.security_metadata_hash);

  const link = plan.projections[0];
  const quarantinedLink = join(quarantineRoot, 'projections', link.agent, link.name);
  const beforeLink = inspectCollectionEntry({ home: fixture.home, path: quarantinedLink });
  const rawTarget = readlinkSync(quarantinedLink);
  unlinkSync(quarantinedLink);
  symlinkSync(rawTarget, quarantinedLink);
  const afterLink = inspectCollectionEntry({ home: fixture.home, path: quarantinedLink });
  assert.notEqual(afterLink.manifest_hash, beforeLink.manifest_hash);
  assert.equal(afterLink.security_metadata_hash, beforeLink.security_metadata_hash);

  const status = statusProdcraftCollection({ home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
});

test('status ignores only Finder metadata and rejects every other unknown collection entry', (t) => {
  const { fixture, plan } = plannedFixture(t);
  applyProdcraftPlan(plan, plan.plan_hash);
  writeFileSync(join(fixture.skillsRoot, 'prodcraft/.DS_Store'), 'finder metadata\n');
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
  writeFileSync(join(fixture.skillsRoot, 'prodcraft/.unexpected'), 'unknown\n');
  const drift = statusProdcraftCollection({ home: fixture.home });
  assert.equal(drift.status, 'DRIFTED');
  assert.equal(drift.issues.includes('UNEXPECTED_COLLECTION_ENTRY:.unexpected'), true);
});

test('recovery copies preserve stable security metadata when provenance is present', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const fixture = makeLegacyHome(root);
  const original = join(fixture.skillsRoot, 'acceptance-criteria');
  const stamped = spawnSync('/usr/bin/xattr', ['-wx', 'com.apple.provenance', '0102', join(original, 'SKILL.md')], { encoding: 'utf8' });
  assert.equal(stamped.status, 0, stamped.stderr);
  const plan = compileProdcraftPlan({ home: fixture.home, sourceRoot: source, revision: sourceRevision(source), now: '2026-07-20T00:00:00.000Z' });
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  assert.equal(applied.status, 'FILESYSTEM_READY');
  const copiedRoot = join(applied.recovery_root, 'pre-state/skills/acceptance-criteria');
  const planned = plan.legacy.find(({ name }) => name === 'acceptance-criteria');
  assert.equal(inspectCollectionEntry({ home: fixture.home, path: copiedRoot }).security_metadata_hash, planned.security_metadata_hash);
});

test('status binds the recovery plan and manifest control evidence', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const recoveryRoot = join(
    fixture.home,
    `Library/Application Support/skills-refiner/recovery/operations/${applied.operation_id}`,
  );
  rmSync(join(recoveryRoot, 'plan.json'));
  const manifestPath = join(recoveryRoot, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.plan_hash = `sha256:${'0'.repeat(64)}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const status = statusProdcraftCollection({ home: fixture.home });
  assert.equal(status.status, 'DRIFTED');
  assert.equal(status.issues.includes('RECOVERY_PLAN_MISSING_OR_INVALID'), true);
  assert.equal(status.issues.includes('RECOVERY_MANIFEST_DRIFT'), true);
});

test('preflight drift causes zero active mutation', (t) => {
  const { fixture, plan } = plannedFixture(t);
  writeFileSync(join(fixture.skillsRoot, 'intake/drift.txt'), 'changed after plan\n');
  assert.throws(
    () => applyProdcraftPlan(plan, plan.plan_hash),
    /plan does not match a fresh canonical installed-state observation/u,
  );
  assert.equal(existsSync(join(fixture.skillsRoot, 'intake/SKILL.md')), true);
  assert.equal(existsSync(join(fixture.skillsRoot, 'pc-prodcraft')), false);
});

test('apply rejects a rehashed plan that diverges from fresh canonical installed facts', (t) => {
  const { fixture, plan } = plannedFixture(t);
  plan.projections[0].raw_target = '../../.agents/skills/prodcraft';
  plan.plan_hash = computeCollectionPlanHash(plan);
  assert.throws(() => applyProdcraftPlan(plan, plan.plan_hash), /canonical installed-state observation/u);
  for (const name of fixture.legacyNames) assert.equal(existsSync(join(fixture.skillsRoot, name)), true, name);
});

test('symlinked quarantine parent fails before any active mutation', (t) => {
  const { root, fixture, plan } = plannedFixture(t);
  const outside = join(root, 'outside-quarantine');
  mkdirSync(outside);
  symlinkSync(outside, join(fixture.home, '.agents/skills-quarantine'));
  assert.throws(() => applyProdcraftPlan(plan, plan.plan_hash), /adapter|collection|unsafe|helper/u);
  for (const name of fixture.legacyNames) assert.equal(existsSync(join(fixture.skillsRoot, name)), true, name);
  assert.equal(existsSync(join(outside, 'collections')), false);
});

for (const faultPhase of APPLY_FAULT_PHASES) {
  test(`apply fault ${faultPhase} restores all active legacy paths`, (t) => {
    const { fixture, plan } = plannedFixture(t);
    assert.throws(() => applyProdcraftPlan(plan, plan.plan_hash, { faultPhase }), /injected fault/u);
    for (const name of fixture.legacyNames) assert.equal(existsSync(join(fixture.skillsRoot, name)), true, name);
    for (const agentRoot of fixture.agentRoots) {
      assert.equal(existsSync(join(agentRoot, 'prodcraft')), true);
      assert.equal(existsSync(join(agentRoot, 'pc-prodcraft')), false);
    }
    assert.equal(existsSync(join(fixture.skillsRoot, 'pc-prodcraft')), false);
  });
}

test('manual member deletion is detected, repaired from the active artifact, then undo restores exact legacy links', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  rmSync(join(fixture.skillsRoot, 'prodcraft/pc-intake'), { recursive: true });
  const drift = statusProdcraftCollection({ home: fixture.home });
  assert.equal(drift.status, 'DRIFTED');
  assert.equal(drift.issues.includes('MISSING_COLLECTION_ENTRY:pc-intake'), true);
  const repaired = repairProdcraftCollection({ home: fixture.home, confirmation: applied.operation_id });
  assert.deepEqual(repaired.repaired, ['pc-intake']);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');

  const undone = undoProdcraftOperation({ home: fixture.home, operationId: applied.operation_id, confirmation: applied.operation_id });
  assert.equal(undone.status, 'RESTORED');
  for (const name of fixture.legacyNames) assert.equal(existsSync(join(fixture.skillsRoot, name)), true, name);
  for (const agentRoot of fixture.agentRoots) {
    assert.equal(readlinkSync(join(agentRoot, 'prodcraft')), '../../.agents/skills/prodcraft');
    assert.equal(existsSync(join(agentRoot, 'pc-prodcraft')), false);
  }
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
});

for (const metadataPath of ['INDEX.json', 'pc-prodcraft/prodcraft-runtime.json']) {
  test(`repair restores missing ${metadataPath} by replacing the collection from the bound artifact`, (t) => {
    const { fixture, plan } = plannedFixture(t);
    const applied = applyProdcraftPlan(plan, plan.plan_hash);
    rmSync(join(fixture.skillsRoot, 'prodcraft', metadataPath));
    assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'DRIFTED');
    const repaired = repairProdcraftCollection({ home: fixture.home, confirmation: applied.operation_id });
    assert.deepEqual(repaired.repaired, ['collection_metadata']);
    assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'FILESYSTEM_READY');
  });
}

test('recover uses independent bytes when quarantine payloads are missing or corrupt', (t) => {
  const { root, fixture, plan } = plannedFixture(t);
  const operationId = killApplyAt({
    root,
    home: fixture.home,
    plan,
    phase: 'after_active_publish',
    label: 'bootstrap-recovery',
  });
  const quarantine = join(fixture.home, `.agents/skills-quarantine/collections/${operationId}`);
  writeFileSync(join(quarantine, 'skills/intake/tampered.txt'), 'tampered\n');
  const projection = plan.projections.at(-1);
  unlinkSync(join(quarantine, 'projections', projection.agent, projection.name));
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId,
    confirmation: operationId,
  });
  assert.equal(recovered.status, 'RESTORED_PRESTATE');
  assert.equal(recovered.recreated_from_independent_recovery, true);
  for (const name of fixture.legacyNames) assert.equal(existsSync(join(fixture.skillsRoot, name)), true, name);
  assert.equal(readlinkSync(projection.path), projection.raw_target);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
});

test('bootstrap undo stages every independent source before moving active payloads', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const quarantineRoot = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${applied.operation_id}/skills`,
  );
  const recoveryRoot = join(
    fixture.home,
    `Library/Application Support/skills-refiner/recovery/operations/${applied.operation_id}/pre-state/skills`,
  );
  const first = plan.legacy[0];
  const last = plan.legacy.at(-1);
  writeFileSync(join(quarantineRoot, first.name, 'tampered.txt'), 'force independent recovery\n');
  writeFileSync(join(quarantineRoot, last.name, 'tampered.txt'), 'force late independent recovery\n');
  const invalidLastStage = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${applied.operation_id}/recovery-restore/skills/${last.name}`,
  );
  mkdirSync(invalidLastStage, { recursive: true });
  writeFileSync(join(invalidLastStage, 'partial.txt'), 'invalid completed stage\n');
  const collection = join(fixture.skillsRoot, 'prodcraft');
  const collectionBefore = treeDigest(collection);
  const activePath = join(fixture.home, '.agents/skill-control/collections/prodcraft/active.json');
  const activeBefore = readFileSync(activePath, 'utf8');
  assert.throws(
    () => undoProdcraftOperation({
      home: fixture.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    }),
    /recovery source|no verified|changed/u,
  );
  assert.equal(treeDigest(collection), collectionBefore);
  assert.equal(readFileSync(activePath, 'utf8'), activeBefore);
  const stagedFirst = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${applied.operation_id}/recovery-restore/skills/${first.name}`,
  );
  assert.equal(treeDigest(stagedFirst), first.tree_digest);

  rmSync(invalidLastStage, { recursive: true });
  rmSync(join(recoveryRoot, first.name), { recursive: true });
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(recovered.status, 'RESTORED_PRESTATE');
  assert.equal(recovered.recreated_from_independent_recovery, true);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
});

test('bootstrap undo replaces an owned partial recovery stage before payload mutation', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const entry = plan.legacy[0];
  writeFileSync(join(
    fixture.home,
    `.agents/skills-quarantine/collections/${applied.operation_id}/skills/${entry.name}/tampered.txt`,
  ), 'force independent recovery\n');
  const partial = join(
    fixture.home,
    `.agents/skills-quarantine/collections/${applied.operation_id}/recovery-restore/skills/${entry.name}.partial`,
  );
  mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, 'partial.txt'), 'interrupted copy\n');
  const undone = undoProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(undone.status, 'RESTORED');
  assert.equal(undone.recreated_from_independent_recovery, true);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
});

test('bootstrap undo ignores unrelated external receipt changes and preserves them byte-for-byte', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const receiptPath = join(fixture.home, '.agents/.skill-lock.json');
  const replacement = '{"skills":{"unrelated":{"source":"someone/else","version":"9.9.9"}}}\n';
  writeFileSync(receiptPath, replacement);
  const undone = undoProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(undone.status, 'RESTORED');
  assert.equal(readFileSync(receiptPath, 'utf8'), replacement);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
});

test('bootstrap undo preflights an active archive conflict before moving payloads', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const operationRoot = join(
    fixture.home,
    `.agents/skill-control/collections/prodcraft/operations/${applied.operation_id}`,
  );
  writeFileSync(join(operationRoot, 'active.restored.json'), readFileSync(join(
    fixture.home,
    '.agents/skill-control/collections/prodcraft/active.json',
  )), { mode: 0o600 });
  const collection = join(fixture.skillsRoot, 'prodcraft');
  const collectionBefore = treeDigest(collection);
  const gatewayPath = join(fixture.skillsRoot, 'pc-prodcraft');
  const gatewayBefore = inspectCollectionEntry({
    home: fixture.home,
    path: gatewayPath,
  }).manifest_hash;
  assert.throws(
    () => undoProdcraftOperation({
      home: fixture.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    }),
    /active archive already exists/u,
  );
  assert.equal(treeDigest(collection), collectionBefore);
  assert.equal(inspectCollectionEntry({
    home: fixture.home,
    path: gatewayPath,
  }).manifest_hash, gatewayBefore);
});

test('repair and undo refuse conflicting externally created post-state', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  writeFileSync(join(fixture.skillsRoot, 'prodcraft/pc-intake/foreign.txt'), 'foreign\n');
  assert.throws(
    () => repairProdcraftCollection({ home: fixture.home, confirmation: applied.operation_id }),
    /refuses non-missing drift/u,
  );
  assert.throws(
    () => undoProdcraftOperation({ home: fixture.home, operationId: applied.operation_id, confirmation: applied.operation_id }),
    /requires FILESYSTEM_READY post-state/u,
  );
  assert.equal(existsSync(join(fixture.skillsRoot, 'prodcraft/pc-intake/foreign.txt')), true);
});

test('status does not let a tampered index redefine the desired member set', (t) => {
  const { fixture, plan } = plannedFixture(t);
  applyProdcraftPlan(plan, plan.plan_hash);
  const indexPath = join(fixture.skillsRoot, 'prodcraft/INDEX.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.members = index.members.filter(({ name }) => name !== 'pc-intake');
  rmSync(join(fixture.skillsRoot, 'prodcraft/pc-intake'), { recursive: true });
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const status = statusProdcraftCollection({ home: fixture.home });
  assert.equal(status.status, 'DRIFTED');
  assert.equal(status.issues.includes('INDEX_IDENTITY_DRIFT'), true);
});

test('status rejects coordinated member and INDEX digest tampering', (t) => {
  const { fixture, plan } = plannedFixture(t);
  applyProdcraftPlan(plan, plan.plan_hash);
  const member = join(fixture.skillsRoot, 'prodcraft/pc-intake');
  writeFileSync(join(member, 'tamper.txt'), 'tamper\n');
  const indexPath = join(fixture.skillsRoot, 'prodcraft/INDEX.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.members.find(({ name }) => name === 'pc-intake').tree_digest = treeDigest(member);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const status = statusProdcraftCollection({ home: fixture.home });
  assert.equal(status.status, 'DRIFTED');
  assert.equal(status.issues.includes('INDEX_IDENTITY_DRIFT'), true);
  assert.equal(status.issues.includes('MEMBER_DRIFT:pc-intake'), true);
});

test('legacy projection reappearance blocks undo before any post-state mutation', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const link = plan.projections.at(-1);
  symlinkSync(link.raw_target, link.path);
  const status = statusProdcraftCollection({ home: fixture.home });
  assert.equal(status.issues.some((issue) => issue.startsWith('LEGACY_PROJECTION_REAPPEARED:')), true);
  assert.throws(
    () => undoProdcraftOperation({ home: fixture.home, operationId: applied.operation_id, confirmation: applied.operation_id }),
    /requires FILESYSTEM_READY post-state/u,
  );
  assert.equal(existsSync(join(fixture.skillsRoot, 'prodcraft/INDEX.json')), true);
});

for (const killPhase of APPLY_FAULT_PHASES) {
  test(`SIGKILL ${killPhase} leaves RECOVERY_REQUIRED and recover restores exact pre-state`, (t) => {
    const { root, fixture, plan } = plannedFixture(t);
    const planPath = join(root, 'kill-plan.json');
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const result = spawnSync(launcher, ['collection', 'apply', '--plan', planPath, '--confirm', plan.plan_hash, '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: fixture.home,
        SKILLS_REFINER_NODE_BIN: process.execPath,
        SKILLS_REFINER_TEST_ALLOW_FAULTS: '1',
        SKILLS_REFINER_TEST_KILL_PHASE: killPhase,
      },
    });
    assert.equal(result.signal, 'SIGKILL');
    const interrupted = statusProdcraftCollection({ home: fixture.home });
    assert.equal(interrupted.status, 'RECOVERY_REQUIRED');
    const recovered = recoverProdcraftOperation({
      home: fixture.home,
      operationId: interrupted.operation_id,
      confirmation: interrupted.operation_id,
    });
    assert.equal(recovered.status, 'RESTORED_PRESTATE');
    for (const name of fixture.legacyNames) assert.equal(existsSync(join(fixture.skillsRoot, name)), true, name);
    for (const agentRoot of fixture.agentRoots) assert.equal(existsSync(join(agentRoot, 'prodcraft')), true);
    assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
  });
}

async function killDuringPartialQuarantine({ fixture, plan, root, kind }) {
  const planPath = join(root, `${kind}-partial-plan.json`);
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const operationId = `prodcraft-${plan.plan_hash.slice(7, 19)}`;
  const quarantine = join(fixture.home, `.agents/skills-quarantine/collections/${operationId}`);
  const child = spawn(launcher, ['collection', 'apply', '--plan', planPath, '--confirm', plan.plan_hash, '--json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: fixture.home, SKILLS_REFINER_NODE_BIN: process.execPath },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const started = Date.now();
  for (;;) {
    const rootPath = kind === 'projection' ? join(quarantine, 'projections') : join(quarantine, 'skills');
    let count = 0;
    if (existsSync(rootPath)) {
      if (kind === 'projection') {
        for (const agent of readdirSync(rootPath)) count += readdirSync(join(rootPath, agent)).length;
      } else {
        count = readdirSync(rootPath).length;
      }
    }
    const total = kind === 'projection' ? plan.projections.length : plan.legacy.length;
    if (count > 0 && count < total) {
      child.kill('SIGKILL');
      break;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`apply exited before partial ${kind} quarantine: exit=${child.exitCode} signal=${child.signalCode} stdout=${stdout} stderr=${stderr}`);
    }
    if (Date.now() - started > 20_000) {
      child.kill('SIGKILL');
      throw new Error(`did not observe partial ${kind} quarantine`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await new Promise((resolve) => child.once('exit', resolve));
  const interrupted = statusProdcraftCollection({ home: fixture.home });
  assert.equal(interrupted.status, 'RECOVERY_REQUIRED');
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId: interrupted.operation_id,
    confirmation: interrupted.operation_id,
  });
  assert.equal(recovered.status, 'RESTORED_PRESTATE');
  for (const name of fixture.legacyNames) assert.equal(existsSync(join(fixture.skillsRoot, name)), true, name);
  for (const agentRoot of fixture.agentRoots) assert.equal(existsSync(join(agentRoot, 'prodcraft')), true);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
}

for (const kind of ['projection', 'legacy']) {
  test(`external SIGKILL during partial ${kind} loop recovers exact pre-state`, async (t) => {
    const { root, fixture, plan } = plannedFixture(t);
    await killDuringPartialQuarantine({ fixture, plan, root, kind });
  });
}

test('status binds the active artifact while undo can fall back from drifted quarantine', (t) => {
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const digest = plan.source.tree_digest.slice('sha256:'.length);
  rmSync(join(fixture.home, `.agents/skill-control/collections/prodcraft/artifacts/${digest}/repo`), { recursive: true });
  assert.equal(statusProdcraftCollection({ home: fixture.home }).issues.includes('ARTIFACT_MISSING_OR_INVALID'), true);

  const { fixture: secondFixture, plan: secondPlan } = plannedFixture(t);
  const secondApplied = applyProdcraftPlan(secondPlan, secondPlan.plan_hash);
  writeFileSync(join(secondFixture.home, `.agents/skills-quarantine/collections/${secondApplied.operation_id}/skills/intake/tampered.txt`), 'tampered\n');
  const drift = statusProdcraftCollection({ home: secondFixture.home });
  assert.equal(drift.issues.includes('QUARANTINE_DRIFT:intake'), true);
  const undone = undoProdcraftOperation({
    home: secondFixture.home,
    operationId: secondApplied.operation_id,
    confirmation: secondApplied.operation_id,
  });
  assert.equal(undone.status, 'RESTORED');
  assert.equal(undone.recreated_from_independent_recovery, true);
  assert.equal(existsSync(join(secondFixture.home, `.agents/skills-quarantine/collections/${secondApplied.operation_id}/skills/intake/tampered.txt`)), true);
  assert.equal(statusProdcraftCollection({ home: secondFixture.home }).status, 'UNMANAGED');
  assert.equal(applied.status, 'FILESYSTEM_READY');
});
