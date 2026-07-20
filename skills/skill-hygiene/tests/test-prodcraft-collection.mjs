import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  assert.throws(() => inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) }), /symlink/u);

  const sourceTwo = makeSource(join(root, 'second'));
  writeFileSync(join(sourceTwo, 'skills/.curated/pc-intake/SKILL.md'), '---\nname: wrong\ndescription: Use when wrong.\n---\n');
  assert.throws(() => inspectProdcraftSource({ sourceRoot: sourceTwo, revision: sourceRevision(sourceTwo) }), /frontmatter name/u);
});

test('source inspection requires exact clean Git HEAD and approved origin', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  assert.throws(
    () => inspectProdcraftSource({ sourceRoot: source, revision: 'a'.repeat(40) }),
    /HEAD does not match/u,
  );
  writeFileSync(join(source, 'untracked.txt'), 'untracked\n');
  assert.throws(
    () => inspectProdcraftSource({ sourceRoot: source, revision: sourceRevision(source) }),
    /worktree must be clean/u,
  );
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
  const { fixture, plan } = plannedFixture(t);
  const applied = applyProdcraftPlan(plan, plan.plan_hash);
  const quarantine = join(fixture.home, `.agents/skills-quarantine/collections/${applied.operation_id}`);
  writeFileSync(join(quarantine, 'skills/intake/tampered.txt'), 'tampered\n');
  const projection = plan.projections.at(-1);
  rmSync(join(quarantine, 'projections', projection.agent, projection.name));
  const recovered = recoverProdcraftOperation({
    home: fixture.home,
    operationId: applied.operation_id,
    confirmation: applied.operation_id,
  });
  assert.equal(recovered.status, 'RESTORED_PRESTATE');
  assert.equal(recovered.recreated_from_independent_recovery, true);
  for (const name of fixture.legacyNames) assert.equal(existsSync(join(fixture.skillsRoot, name)), true, name);
  assert.equal(readlinkSync(projection.path), projection.raw_target);
  assert.equal(statusProdcraftCollection({ home: fixture.home }).status, 'UNMANAGED');
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

test('status binds the active immutable artifact and undo binds quarantine bytes', (t) => {
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
  assert.throws(
    () => undoProdcraftOperation({ home: secondFixture.home, operationId: secondApplied.operation_id, confirmation: secondApplied.operation_id }),
    /requires FILESYSTEM_READY post-state/u,
  );
  assert.equal(existsSync(join(secondFixture.home, `.agents/skills-quarantine/collections/${secondApplied.operation_id}/skills/intake/tampered.txt`)), true);
  assert.equal(applied.status, 'FILESYSTEM_READY');
});
