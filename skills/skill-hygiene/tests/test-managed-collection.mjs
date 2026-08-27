import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyManagedPlan, compileManagedPlan, inspectManagedSource, MANAGED_APPLY_FAULT_PHASES,
  recoverManagedOperation, repairManagedCollection, statusManagedCollection, undoManagedOperation,
} from '../lib/managed-collection.mjs';
import {
  computeManagedPlanHash, MANAGED_COLLECTION_SCHEMAS, validateManagedPlan,
} from '../lib/managed-collection-contract.mjs';
import { collectionSpec } from '../lib/collection-specs.mjs';
import {
  makeManagedHome, makeManagedRoot, makeManagedSource, managedRevision, removeManagedRoot,
} from './managed-collection-fixtures.mjs';

function planned(t, collectionId = 'better-skills') {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, collectionId);
  const fixture = makeManagedHome(root, collectionId);
  const plan = compileManagedPlan({ collectionId, home: fixture.home, sourceRoot: source, revision: managedRevision(source), now: '2026-07-20T00:00:00.000Z' });
  return { root, source, fixture, plan };
}

test('declarative source inspection supports folded YAML and pinned member sets', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  for (const [collectionId, count] of [['loopos', 10], ['langcraft', 6], ['better-skills', 12]]) {
    const source = makeManagedSource(join(root, collectionId), collectionId);
    const observed = inspectManagedSource({ collectionId, sourceRoot: source, revision: managedRevision(source) });
    assert.equal(observed.members.length, count);
    assert.match(observed.reference_graph_digest, /^sha256:[0-9a-f]{64}$/u);
  }
});

test('source inspection rejects a current member with invalid portable YAML', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  const skillPath = join(source, 'skills/bs-prdefine/SKILL.md');
  writeFileSync(skillPath, readFileSync(skillPath, 'utf8').replace(
    'description: Use when testing managed collection member bs-prdefine.',
    'description: Use when testing managed collection member bs-prdefine. Portability: invalid.',
  ));
  const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', 'invalid portable frontmatter'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  assert.throws(() => inspectManagedSource({ collectionId: 'better-skills', sourceRoot: source, revision: managedRevision(source) }), /not portable YAML/u);
});

test('source inspection fails when a canonical current member is missing', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  rmSync(join(source, 'skills/bs-prdefine'), { recursive: true });
  const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', '-A'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  const commit = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'remove canonical member'], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  assert.throws(() => inspectManagedSource({ collectionId: 'better-skills', sourceRoot: source, revision: managedRevision(source) }), /source member bs-prdefine/u);
});

test('managed plan applies from a clean Git linked worktree without hashing its .git pointer', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  const linked = join(root, 'linked-worktree');
  const added = spawnSync('/usr/bin/git', ['-C', source, 'worktree', 'add', '--detach', linked, 'HEAD'], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const fixture = makeManagedHome(root, 'better-skills');
  const revision = managedRevision(linked);
  const plan = compileManagedPlan({
    collectionId: 'better-skills', home: fixture.home, sourceRoot: linked,
    revision, now: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(applyManagedPlan(plan, plan.plan_hash).status, 'FILESYSTEM_READY');
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'FILESYSTEM_READY');
});

test('status skips a planned exposure after that Agent root is removed', (t) => {
  const { fixture, plan } = planned(t);
  applyManagedPlan(plan, plan.plan_hash);
  rmSync(fixture.agentRoots[0], { recursive: true });
  const status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
  assert.equal(status.issues.some((issue) => issue.startsWith('AGENT_EXPOSURE_DRIFT:')), false);
});

test('source and deployed identity apply the same bounded Finder metadata policy', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  writeFileSync(join(source, 'skills/bs-prdefine/.DS_Store'), 'source host metadata\n');
  const committed = spawnSync('/usr/bin/git', [
    '-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'add', 'skills/bs-prdefine/.DS_Store',
  ], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  const commit = spawnSync('/usr/bin/git', [
    '-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'add source host metadata',
  ], { encoding: 'utf8' });
  assert.equal(commit.status, 0, commit.stderr);
  const fixture = makeManagedHome(root, 'better-skills');
  const plan = compileManagedPlan({
    collectionId: 'better-skills', home: fixture.home, sourceRoot: source,
    revision: managedRevision(source), now: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(applyManagedPlan(plan, plan.plan_hash).status, 'FILESYSTEM_READY');
  assert.equal(existsSync(join(fixture.skillsRoot, 'better-skills/bs-prdefine/.DS_Store')), true);
  const status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
});

test('plan moves only qualified active members and preserves ambiguous historical names', (t) => {
  const { plan } = planned(t);
  assert.equal(plan.source.members.length, 12);
  assert.equal(plan.legacy.length, 11);
  assert.equal(plan.projections.length, 22);
  assert.equal(plan.preserved_collisions.length, 14);
  assert.equal(plan.agent_roots.length, 2);
  assert.deepEqual(plan.receipt.history, {
    entry_count: 18,
    first_installed_at: '2026-03-01T00:00:00.000Z',
    last_updated_at: '2026-07-13T00:00:00.000Z',
  });
  assert.deepEqual(plan.target.exposure, {
    type: 'collection', name: 'better-skills', global_projection: null,
    global_raw_target: null, agent_raw_target: '../../.agents/skills/better-skills',
  });
});

test('apply publishes a real collection, shared resources, catalog anchor, and bounded projections', (t) => {
  const { fixture, plan } = planned(t);
  const applied = applyManagedPlan(plan, plan.plan_hash);
  assert.equal(applied.status, 'FILESYSTEM_READY');
  const collection = join(fixture.skillsRoot, 'better-skills');
  assert.equal(lstatSync(collection).isDirectory(), true);
  assert.equal(existsSync(join(collection, 'SKILL.md')), false);
  assert.equal(existsSync(join(collection, 'bs-visual-design/SKILL.md')), false);
  assert.equal(existsSync(join(collection, 'docs/patterns/README.md')), true);
  assert.equal(existsSync(join(collection, 'docs/research/README.md')), true);
  assert.equal(existsSync(join(collection, 'tools/check-patterns.sh')), true);
  assert.equal(existsSync(join(collection, 'skills.json')), true);
  const relocatedReference = join(collection, 'bs-skill-forge/references/tdd-for-skills.md');
  assert.equal(existsSync(relocatedReference), true);
  assert.match(readFileSync(relocatedReference, 'utf8'), /\]\(\.\.\/\.\.\/docs\/patterns\/README\.md\)/u);
  assert.doesNotMatch(readFileSync(relocatedReference, 'utf8'), /\]\(\.\.\/\.\.\/\.\.\/docs\/patterns\/README\.md\)/u);
  for (const member of fixture.activeMembers) assert.equal(existsSync(join(fixture.skillsRoot, member.name)), false);
  for (const root of fixture.agentRoots) {
    assert.equal(readlinkSync(join(root, 'better-skills')), '../../.agents/skills/better-skills');
    for (const alias of fixture.aliases) assert.equal(readlinkSync(join(root, alias)), `../../.agents/skills/${alias}`);
  }
  const status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
  assert.equal(status.member_count, 12);
  const catalog = JSON.parse(readFileSync(join(fixture.home, 'Library/Application Support/skills-refiner/catalog.json'), 'utf8'));
  assert.equal(catalog.collections['better-skills'].operation_id, applied.operation_id);
  assert.equal(catalog.collections['better-skills'].source.resolved_revision, plan.source.revision);
  assert.equal(catalog.collections['better-skills'].lifecycle.receipt_history.entry_count, 18);
  assert.equal(status.source.repository_id, 'yknothing/better-skills');
  assert.deepEqual(status.source.upstream_release, {
    status: 'declared', value: '0.2.0-dev', source_path: 'skills.json',
    source_digest: plan.source.manifest_digest, extraction: 'json_root_version',
  });
  assert.equal(status.lifecycle.current_generation_activated_at !== null, true);
});

test('catalog content and materialized view are part of exact READY identity', (t) => {
  const { fixture, plan } = planned(t);
  applyManagedPlan(plan, plan.plan_hash);
  const catalogPath = join(fixture.home, 'Library/Application Support/skills-refiner/catalog.json');
  const viewPath = join(fixture.home, '.agents/skill-control/catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  catalog.collections['better-skills'].source.resolved_revision = '0'.repeat(40);
  catalog.collections['better-skills'].recovery_plan = join(fixture.home, 'wrong-plan.json');
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  unlinkSync(viewPath);
  const status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.status, 'DRIFTED');
  assert.equal(status.issues.includes('CATALOG_ENTRY_IDENTITY_DRIFT'), true);
  assert.equal(status.issues.includes('CATALOG_SOURCE_DRIFT'), true);
  assert.equal(status.issues.includes('CATALOG_VIEW_MISSING'), true);
});

test('status ignores nested Finder metadata but no other unknown member entry', (t) => {
  const { fixture, plan } = planned(t);
  applyManagedPlan(plan, plan.plan_hash);
  const member = join(fixture.skillsRoot, 'better-skills/bs-prdefine');
  writeFileSync(join(member, '.DS_Store'), 'host metadata\n');
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'FILESYSTEM_READY');
  writeFileSync(join(member, '.unexpected'), 'not host metadata\n');
  const drift = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(drift.status, 'DRIFTED');
  assert.equal(drift.issues.includes('MEMBER_DRIFT:bs-prdefine'), true);
});

test('repair reconstructs a deleted catalog and proves the full post-state', (t) => {
  const { fixture, plan } = planned(t);
  const applied = applyManagedPlan(plan, plan.plan_hash);
  rmSync(join(fixture.home, 'Library/Application Support/skills-refiner/catalog.json'));
  rmSync(join(fixture.home, '.agents/skill-control/catalog.json'));
  const repaired = repairManagedCollection({ collectionId: 'better-skills', home: fixture.home, confirmation: applied.operation_id });
  assert.equal(repaired.status, 'FILESYSTEM_READY');
  assert.equal(repaired.mutation_occurred, true);
  assert.equal(repaired.repaired.includes('catalog'), true);
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'FILESYSTEM_READY');
});

test('catalog deletion, index, artifact, resource, quarantine, and recovery drift are observable', (t) => {
  const { fixture, plan } = planned(t);
  const applied = applyManagedPlan(plan, plan.plan_hash);
  const catalogPath = join(fixture.home, 'Library/Application Support/skills-refiner/catalog.json');
  const catalogBytes = readFileSync(catalogPath);
  rmSync(catalogPath);
  let status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.issues.includes('ORPHANED_CATALOG'), true);
  writeFileSync(catalogPath, catalogBytes);

  const collection = join(fixture.skillsRoot, 'better-skills');
  const indexPath = join(collection, 'INDEX.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.source.resolved_revision = '0'.repeat(40);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).issues.includes('INDEX_IDENTITY_DRIFT'), true);

  const artifact = join(fixture.home, `.agents/skill-control/collections/better-skills/artifacts/${plan.source.tree_digest.slice(7)}/repo/tampered.txt`);
  writeFileSync(artifact, 'tampered\n');
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).issues.includes('ARTIFACT_IDENTITY_DRIFT'), true);

  writeFileSync(join(collection, 'docs/patterns/README.md'), 'tampered\n');
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).issues.includes('RESOURCE_DRIFT:docs/patterns'), true);

  const quarantineSkill = join(fixture.home, `.agents/skills-quarantine/collections/${applied.operation_id}/skills/bs-prdefine/tampered.txt`);
  const recoverySkill = join(fixture.home, `Library/Application Support/skills-refiner/recovery/operations/${applied.operation_id}/pre-state/skills/bs-prdefine/tampered.txt`);
  writeFileSync(quarantineSkill, 'tampered\n');
  writeFileSync(recoverySkill, 'tampered\n');
  status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.issues.includes('QUARANTINE_DRIFT:bs-prdefine'), true);
  assert.equal(status.issues.includes('RECOVERY_DRIFT:bs-prdefine'), true);
});

test('gateway locator drift is observable', (t) => {
  const { fixture, plan } = planned(t, 'langcraft');
  applyManagedPlan(plan, plan.plan_hash);
  writeFileSync(join(fixture.skillsRoot, 'langcraft/langcraft/langcraft-runtime.json'), '{}\n');
  assert.equal(statusManagedCollection({ collectionId: 'langcraft', home: fixture.home }).issues.includes('LOCATOR_DRIFT'), true);
});

for (const collectionId of ['loopos', 'langcraft']) {
  test(`${collectionId} supports a same-name collection container and nested gateway`, (t) => {
    const { fixture, plan, source } = planned(t, collectionId);
    const applied = applyManagedPlan(plan, plan.plan_hash);
    assert.equal(existsSync(join(fixture.skillsRoot, collectionId, collectionId, 'SKILL.md')), true);
    assert.equal(existsSync(join(fixture.skillsRoot, collectionId, 'SKILL.md')), false);
    for (const root of fixture.agentRoots) {
      assert.equal(readlinkSync(join(root, collectionId)), `../../.agents/skills/${collectionId}/${collectionId}`);
    }
    assert.equal(statusManagedCollection({ collectionId, home: fixture.home }).status, 'FILESYSTEM_READY');
    const upgrade = compileManagedPlan({
      collectionId, home: fixture.home, sourceRoot: source,
      revision: managedRevision(source), now: '2026-07-20T01:00:00.000Z',
    });
    const activeExposurePaths = new Set(fixture.agentRoots.map((root) => join(root, collectionId)));
    assert.equal(upgrade.preserved_collisions.some(({ path }) => activeExposurePaths.has(path)), false);
    assert.equal(undoManagedOperation({ home: fixture.home, operationId: applied.operation_id, confirmation: applied.operation_id }).status, 'RESTORED');
  });
}

test('LangCraft preserves Better Skills prose-craft projections as a cross-repository name collision', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'langcraft');
  const fixture = makeManagedHome(root, 'langcraft');
  const receiptPath = join(fixture.home, '.agents/.skill-lock.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.skills['prose-craft'] = {
    ...receipt.skills['prose-craft'],
    source: 'yknothing/better-skills',
    sourceUrl: 'https://github.com/yknothing/better-skills.git',
    skillPath: 'skills/prose-craft/SKILL.md',
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const plan = compileManagedPlan({
    collectionId: 'langcraft', home: fixture.home, sourceRoot: source,
    revision: managedRevision(source), now: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(plan.legacy.some(({ name }) => name === 'prose-craft'), false);
  assert.equal(plan.projections.some(({ name }) => name === 'prose-craft'), false);
  assert.equal(plan.preserved_collisions.some(({ scope, name, kind, relation }) => scope === 'global' && name === 'prose-craft' && kind === 'directory' && relation === 'other_repository_name'), true);
  const applied = applyManagedPlan(plan, plan.plan_hash);
  assert.equal(applied.status, 'FILESYSTEM_READY');
  for (const agentRoot of fixture.agentRoots) {
    assert.equal(readlinkSync(join(agentRoot, 'prose-craft')), '../../.agents/skills/prose-craft');
  }
  const status = statusManagedCollection({ collectionId: 'langcraft', home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
  assert.equal(status.name_collisions.filter(({ name, relation, disposition }) => name === 'prose-craft' && relation === 'other_repository_name' && disposition === 'preserve').length, fixture.agentRoots.length + 1);
});

test('apply binds preserved collision targets into the immutable plan precondition', (t) => {
  const { fixture, plan } = planned(t);
  const collision = plan.preserved_collisions.find(({ scope, agent }) => scope === 'agent' && agent === 'claude');
  assert.equal(collision.target_status, 'missing');
  unlinkSync(collision.path);
  symlinkSync('../../.agents/skills/different-history', collision.path);
  assert.throws(() => applyManagedPlan(plan, plan.plan_hash), /installed state/u);
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'UNMANAGED');
});

test('historical V2 profile remains interpretable and V2 to V4 undo restores the predecessor', (t) => {
  const { fixture, plan: firstPlan, source } = planned(t);

  const historicalProfile = structuredClone(firstPlan);
  historicalProfile.schema_version = MANAGED_COLLECTION_SCHEMAS.legacyPlan;
  delete historicalProfile.preserved_collisions;
  const historicalMembers = collectionSpec('better-skills').memberProfiles.find((profile) => profile.length === 9);
  historicalProfile.source.members = historicalMembers.map(({ name, sourcePath }, index) => ({
    name,
    source_path: sourcePath,
    tree_digest: `sha256:${String((index % 8) + 1).repeat(64)}`,
  }));
  historicalProfile.source.resources = historicalProfile.source.resources.slice(0, 1);
  historicalProfile.legacy = historicalProfile.legacy.filter(({ name }) => name === 'bs-social-card');
  historicalProfile.projections = historicalProfile.projections.filter(({ name }) => name === 'bs-social-card');
  historicalProfile.plan_hash = computeManagedPlanHash(historicalProfile);
  assert.doesNotThrow(() => validateManagedPlan(historicalProfile));
  assert.equal(historicalProfile.source.members.length, 9);
  assert.equal(historicalProfile.source.resources.length, 1);

  const firstV2Plan = structuredClone(firstPlan);
  firstV2Plan.schema_version = MANAGED_COLLECTION_SCHEMAS.legacyPlan;
  delete firstV2Plan.preserved_collisions;
  firstV2Plan.plan_hash = computeManagedPlanHash(firstV2Plan);
  validateManagedPlan(firstV2Plan);
  const first = applyManagedPlan(firstV2Plan, firstV2Plan.plan_hash);
  const skillPath = join(source, 'skills/bs-prdefine/SKILL.md');
  writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}\nSecond generation.\n`);
  const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', 'second generation'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  const secondPlan = compileManagedPlan({
    collectionId: 'better-skills', home: fixture.home, sourceRoot: source,
    revision: managedRevision(source), now: '2026-07-20T01:00:00.000Z',
  });
  assert.equal(secondPlan.schema_version, MANAGED_COLLECTION_SCHEMAS.plan);
  assert.equal(secondPlan.legacy.length, 0);
  assert.equal(secondPlan.predecessor.operation_id, first.operation_id);
  assert.equal(secondPlan.predecessor.plan_hash, firstV2Plan.plan_hash);
  const second = applyManagedPlan(secondPlan, secondPlan.plan_hash);
  let status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
  assert.equal(status.operation_id, second.operation_id);
  assert.equal(status.source.resolved_revision, secondPlan.source.revision);
  assert.equal(undoManagedOperation({ home: fixture.home, operationId: second.operation_id, confirmation: second.operation_id }).status, 'RESTORED');
  status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
  assert.equal(status.operation_id, first.operation_id);
  assert.equal(status.plan_hash, firstV2Plan.plan_hash);
  assert.equal(status.member_count, firstV2Plan.source.members.length);
  assert.equal(status.source.resolved_revision, firstV2Plan.source.revision);
  assert.equal(undoManagedOperation({ home: fixture.home, operationId: first.operation_id, confirmation: first.operation_id }).status, 'RESTORED');
});

test('upgrade transaction explicitly adopts allowlisted installer metadata and undo restores it', (t) => {
  const { fixture, plan: firstPlan, source } = planned(t);
  applyManagedPlan(firstPlan, firstPlan.plan_hash);
  const metadataPath = join(fixture.skillsRoot, 'better-skills/.better-skills.json');
  writeFileSync(metadataPath, '{"version":"fixture"}\n');

  const skillPath = join(source, 'skills/bs-prdefine/SKILL.md');
  writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}\nUpgrade candidate.\n`);
  const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', 'upgrade candidate'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);

  const upgrade = compileManagedPlan({
    collectionId: 'better-skills', home: fixture.home, sourceRoot: source,
    revision: managedRevision(source), now: '2026-07-20T03:00:00.000Z',
  });
  assert.deepEqual(upgrade.predecessor.accepted_drift, ['UNEXPECTED_COLLECTION_ENTRY:.better-skills.json']);
  const applied = applyManagedPlan(upgrade, upgrade.plan_hash);
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'FILESYSTEM_READY');
  assert.equal(existsSync(metadataPath), false);

  assert.equal(undoManagedOperation({
    home: fixture.home, operationId: applied.operation_id, confirmation: applied.operation_id,
  }).status, 'RESTORED');
  assert.equal(readFileSync(metadataPath, 'utf8'), '{"version":"fixture"}\n');
  const restored = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(restored.status, 'DRIFTED');
  assert.equal(restored.issues.includes('UNEXPECTED_COLLECTION_ENTRY:.better-skills.json'), true);
});

test('upgrade still refuses an unrecognized unexpected collection entry', (t) => {
  const { fixture, plan: firstPlan, source } = planned(t);
  applyManagedPlan(firstPlan, firstPlan.plan_hash);
  writeFileSync(join(fixture.skillsRoot, 'better-skills/.unrecognized'), 'do not adopt\n');
  assert.throws(() => compileManagedPlan({
    collectionId: 'better-skills', home: fixture.home, sourceRoot: source,
    revision: managedRevision(source), now: '2026-07-20T03:10:00.000Z',
  }), /active generation is not upgradeable/u);
});

test('upgrade drops an absent Agent root from the new immutable projection profile', (t) => {
  const { fixture, plan: firstPlan, source } = planned(t);
  applyManagedPlan(firstPlan, firstPlan.plan_hash);
  rmSync(fixture.agentRoots[0], { recursive: true });

  const skillPath = join(source, 'skills/bs-prdefine/SKILL.md');
  writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}\nAgent scope refresh.\n`);
  const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', 'agent scope refresh'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);

  const upgrade = compileManagedPlan({
    collectionId: 'better-skills', home: fixture.home, sourceRoot: source,
    revision: managedRevision(source), now: '2026-07-20T03:20:00.000Z',
  });
  assert.equal(upgrade.agent_roots.length, 1);
  assert.equal(upgrade.predecessor.exposures.filter(({ scope }) => scope === 'agent').length, 1);
  applyManagedPlan(upgrade, upgrade.plan_hash);
  const status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY', status.issues.join(', '));
});

test('second-generation catalog reconstruction preserves exact durable lifecycle timestamps', (t) => {
  const { fixture, plan: firstPlan, source } = planned(t);
  applyManagedPlan(firstPlan, firstPlan.plan_hash);
  const skillPath = join(source, 'skills/bs-prdefine/SKILL.md');
  writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}\nLifecycle reconstruction fixture.\n`);
  const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', 'lifecycle reconstruction fixture'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  const secondPlan = compileManagedPlan({
    collectionId: 'better-skills', home: fixture.home, sourceRoot: source,
    revision: managedRevision(source), now: '2026-07-20T01:30:00.000Z',
  });
  const second = applyManagedPlan(secondPlan, secondPlan.plan_hash);
  const catalogPath = join(fixture.home, 'Library/Application Support/skills-refiner/catalog.json');
  const viewPath = join(fixture.home, '.agents/skill-control/catalog.json');
  const before = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const lifecycle = before.collections['better-skills'].lifecycle;
  assert.notEqual(lifecycle.first_activated_at, lifecycle.current_generation_activated_at);
  rmSync(catalogPath);
  rmSync(viewPath);
  const repaired = repairManagedCollection({ collectionId: 'better-skills', home: fixture.home, confirmation: second.operation_id });
  assert.equal(repaired.status, 'FILESYSTEM_READY');
  const after = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.deepEqual(after.collections['better-skills'].lifecycle, lifecycle);
  assert.equal(after.updated_at, before.updated_at);
  assert.deepEqual(JSON.parse(readFileSync(viewPath, 'utf8')), after);
});

for (const phase of ['after_first_legacy_quarantine', 'after_catalog_publish']) {
  test(`interrupted managed upgrade ${phase} discovers the new operation and restores predecessor`, (t) => {
    const { fixture, plan: firstPlan, source, root } = planned(t);
    const first = applyManagedPlan(firstPlan, firstPlan.plan_hash);
    const skillPath = join(source, 'skills/bs-prdefine/SKILL.md');
    writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}\nUpgrade fault fixture.\n`);
    const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', 'upgrade fault fixture'], { encoding: 'utf8' });
    assert.equal(committed.status, 0, committed.stderr);
    const upgrade = compileManagedPlan({ collectionId: 'better-skills', home: fixture.home, sourceRoot: source, revision: managedRevision(source), now: `2026-07-20T02:00:0${phase === 'after_catalog_publish' ? '1' : '0'}.000Z` });
    const planPath = join(root, `upgrade-${phase}.json`);
    writeFileSync(planPath, `${JSON.stringify(upgrade, null, 2)}\n`);
    const launcher = fileURLToPath(new URL('../bin/skills-refiner', import.meta.url));
    const killed = spawnSync(launcher, ['collection', 'apply', '--plan', planPath, '--confirm', upgrade.plan_hash, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: fixture.home, SKILLS_REFINER_NODE_BIN: process.execPath, SKILLS_REFINER_TEST_ALLOW_FAULTS: '1', SKILLS_REFINER_TEST_KILL_PHASE: phase },
    });
    assert.equal(killed.signal, 'SIGKILL');
    const interrupted = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
    const upgradeId = `better-skills-${upgrade.plan_hash.slice(7, 19)}`;
    assert.equal(interrupted.status, 'RECOVERY_REQUIRED');
    assert.equal(interrupted.operation_id, upgradeId);
    assert.equal(recoverManagedOperation({ home: fixture.home, operationId: upgradeId, confirmation: upgradeId }).status, 'RESTORED_PRESTATE');
    const restored = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
    assert.equal(restored.status, 'FILESYSTEM_READY', restored.issues.join(', '));
    assert.equal(restored.operation_id, first.operation_id);
  });
}

test('catalog preserves multiple collections and undo removes only its active entry', (t) => {
  const { fixture, plan: betterPlan, root } = planned(t);
  const better = applyManagedPlan(betterPlan, betterPlan.plan_hash);
  const loopSource = makeManagedSource(join(root, 'loop-source'), 'loopos');
  const receiptPath = join(fixture.home, '.agents/.skill-lock.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const loopSpec = collectionSpec('loopos');
  for (const member of loopSpec.members.slice(0, -1)) {
    const path = join(fixture.skillsRoot, member.name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'SKILL.md'), `---\nname: ${member.name}\ndescription: Use when testing managed collection member ${member.name}.\n---\n\n# ${member.name}\n`);
    receipt.skills[member.name] = {
      source: loopSpec.repositoryId, sourceType: 'github', sourceUrl: loopSpec.sourceUrl,
      skillPath: `${member.sourcePath}/SKILL.md`, skillFolderHash: 'c'.repeat(64),
      installedAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
    };
    for (const rootPath of fixture.agentRoots) symlinkSync(`../../.agents/skills/${member.name}`, join(rootPath, member.name));
  }
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const loopPlan = compileManagedPlan({ collectionId: 'loopos', home: fixture.home, sourceRoot: loopSource, revision: managedRevision(loopSource), now: '2026-07-20T03:00:00.000Z' });
  const loop = applyManagedPlan(loopPlan, loopPlan.plan_hash);
  const catalogPath = join(fixture.home, 'Library/Application Support/skills-refiner/catalog.json');
  let catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.deepEqual(Object.keys(catalog.collections).sort(), ['better-skills', 'loopos']);
  assert.equal(undoManagedOperation({ home: fixture.home, operationId: loop.operation_id, confirmation: loop.operation_id }).status, 'RESTORED');
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.deepEqual(Object.keys(catalog.collections), ['better-skills']);
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).operation_id, better.operation_id);
});

test('missing member repair and exact undo restore the observed pre-state', (t) => {
  const { fixture, plan } = planned(t);
  const applied = applyManagedPlan(plan, plan.plan_hash);
  rmSync(join(fixture.skillsRoot, 'better-skills/bs-prdefine'), { recursive: true });
  const drift = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(drift.status, 'DRIFTED');
  assert.equal(drift.issues.includes('MISSING_COLLECTION_ENTRY:bs-prdefine'), true);
  const repaired = repairManagedCollection({ collectionId: 'better-skills', home: fixture.home, confirmation: applied.operation_id });
  assert.equal(repaired.status, 'FILESYSTEM_READY');
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'FILESYSTEM_READY');
  const undone = undoManagedOperation({ home: fixture.home, operationId: applied.operation_id, confirmation: applied.operation_id });
  assert.equal(undone.status, 'RESTORED');
  for (const member of fixture.activeMembers) assert.equal(existsSync(join(fixture.skillsRoot, member.name, 'SKILL.md')), true);
  for (const root of fixture.agentRoots) {
    assert.equal(existsSync(join(root, 'better-skills')), false);
    for (const alias of fixture.aliases) assert.equal(lstatSync(join(root, alias)).isSymbolicLink(), true);
  }
});

test('missing shared resource is repaired by exact collection replacement', (t) => {
  const { fixture, plan } = planned(t);
  const applied = applyManagedPlan(plan, plan.plan_hash);
  rmSync(join(fixture.skillsRoot, 'better-skills/docs'), { recursive: true });
  const drift = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(drift.issues.includes('RESOURCE_MISSING_OR_INVALID:docs/patterns'), true);
  const repaired = repairManagedCollection({ collectionId: 'better-skills', home: fixture.home, confirmation: applied.operation_id });
  assert.equal(repaired.status, 'FILESYSTEM_READY');
  assert.equal(existsSync(join(fixture.skillsRoot, 'better-skills/docs/patterns/README.md')), true);
});

test('status detects scoped receipt drift, competing installs, and orphaned control records', (t) => {
  const { fixture, plan } = planned(t);
  applyManagedPlan(plan, plan.plan_hash);
  const receiptPath = join(fixture.home, '.agents/.skill-lock.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.skills.unrelated.updatedAt = '2026-07-20T01:00:00.000Z';
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'FILESYSTEM_READY');
  receipt.skills['bs-prdefine'].updatedAt = '2026-07-20T02:00:00.000Z';
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).issues.includes('SCOPED_RECEIPT_DRIFT'), true);
  receipt.skills['bs-prdefine'].updatedAt = '2026-07-13T00:00:00.000Z';
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  mkdirSync(join(fixture.skillsRoot, 'visual-design'));
  writeFileSync(join(fixture.skillsRoot, 'visual-design/SKILL.md'), 'conflict\n');
  const collisionStatus = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(collisionStatus.status, 'FILESYSTEM_READY');
  assert.equal(collisionStatus.name_collisions.some(({ name, disposition }) => name === 'visual-design' && disposition === 'preserve'), true);
  rmSync(join(fixture.skillsRoot, 'visual-design'), { recursive: true });
  rmSync(join(fixture.home, '.agents/skill-control/collections/better-skills'), { recursive: true });
  const orphaned = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(orphaned.status, 'DRIFTED');
  assert.equal(orphaned.issues.includes('ORPHANED_CONTROL'), true);
});

test('status reports same-name flat entries as preserved collisions without claiming ownership', (t) => {
  const { fixture, plan } = planned(t);
  applyManagedPlan(plan, plan.plan_hash);
  symlinkSync('../../.agents/skills/visual-design', join(fixture.agentRoots[0], 'visual-design'));
  const newRoot = join(fixture.home, '.newagent/skills');
  mkdirSync(newRoot, { recursive: true });
  symlinkSync('../../.agents/skills/bs-prdefine', join(newRoot, 'bs-prdefine'));
  const status = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
  assert.equal(status.status, 'FILESYSTEM_READY');
  assert.equal(status.name_collisions.some(({ agent, name, disposition }) => agent === 'claude' && name === 'visual-design' && disposition === 'preserve'), true);
  assert.equal(status.name_collisions.some(({ agent, name, disposition }) => agent === 'newagent' && name === 'bs-prdefine' && disposition === 'preserve'), true);
  assert.equal(status.name_collision_status, 'ATTENTION_REQUIRED');
  assert.equal(status.management_attention.some(({ code }) => code === 'PRESERVED_COLLISION_SET_CHANGED'), true);
  assert.equal(status.management_attention.some(({ code }) => code === 'BROKEN_PRESERVED_SYMLINK'), true);
  assert.equal(status.management_attention.some(({ code }) => code === 'STALE_SAME_REPOSITORY_PROJECTION'), true);
});

test('status reports only versions declared by immutable upstream artifacts', (t) => {
  for (const [collectionId, expected] of [['loopos', '0.2.1'], ['langcraft', null]]) {
    const root = makeManagedRoot();
    t.after(() => removeManagedRoot(root));
    const sourceRoot = makeManagedSource(root, collectionId);
    const fixture = makeManagedHome(root, collectionId);
    const plan = compileManagedPlan({ collectionId, home: fixture.home, sourceRoot, revision: managedRevision(sourceRoot) });
    applyManagedPlan(plan, plan.plan_hash);
    const release = statusManagedCollection({ collectionId, home: fixture.home }).source.upstream_release;
    if (expected === null) {
      assert.deepEqual(release, { status: 'not_declared', value: null, source_path: null, source_digest: null, extraction: null });
    } else {
      assert.equal(release.status, 'declared');
      assert.equal(release.value, expected);
      assert.equal(release.source_path, 'pyproject.toml');
      assert.equal(release.extraction, 'pep621_project_version');
    }
  }
});

test('global mutation lock contention leaves no phantom operation', (t) => {
  const { fixture, plan } = planned(t);
  const lockPath = join(fixture.home, '.agents/skill-control/collection-mutation.lock');
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, '{"foreign":true}\n');
  assert.throws(() => applyManagedPlan(plan, plan.plan_hash), /lock is unavailable/u);
  const operationId = `better-skills-${plan.plan_hash.slice(7, 19)}`;
  assert.equal(existsSync(join(fixture.home, `.agents/skill-control/collections/better-skills/operations/${operationId}`)), false);
  assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'UNMANAGED');
});

for (const phase of MANAGED_APPLY_FAULT_PHASES) {
  test(`fault ${phase} restores every active member and legacy projection`, (t) => {
    const { fixture, plan } = planned(t);
    assert.throws(() => applyManagedPlan(plan, plan.plan_hash, { faultPhase: phase }), /injected fault/u);
    for (const member of fixture.activeMembers) assert.equal(existsSync(join(fixture.skillsRoot, member.name, 'SKILL.md')), true, member.name);
    for (const root of fixture.agentRoots) {
      for (const member of fixture.activeMembers) {
        assert.equal(lstatSync(join(root, member.name)).isSymbolicLink(), true, `${root}/${member.name}`);
        assert.equal(readlinkSync(join(root, member.name)), `../../.agents/skills/${member.name}`);
      }
      for (const alias of fixture.aliases) {
        assert.equal(lstatSync(join(root, alias)).isSymbolicLink(), true, `${root}/${alias}`);
        assert.equal(readlinkSync(join(root, alias)), `../../.agents/skills/${alias}`);
      }
    }
    assert.equal(existsSync(join(fixture.home, '.agents/skill-control/collections/better-skills/active.json')), false);
    assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'UNMANAGED');
  });
}

for (const phase of MANAGED_APPLY_FAULT_PHASES) {
  test(`SIGKILL ${phase} is discoverable and exactly recoverable`, (t) => {
    const { fixture, plan, root } = planned(t);
    const planPath = join(root, `${phase}.json`);
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const launcher = fileURLToPath(new URL('../bin/skills-refiner', import.meta.url));
    const killed = spawnSync(launcher, ['collection', 'apply', '--plan', planPath, '--confirm', plan.plan_hash, '--json'], {
      encoding: 'utf8',
      env: {
        ...process.env, HOME: fixture.home, SKILLS_REFINER_NODE_BIN: process.execPath,
        SKILLS_REFINER_TEST_ALLOW_FAULTS: '1', SKILLS_REFINER_TEST_KILL_PHASE: phase,
      },
    });
    assert.equal(killed.signal, 'SIGKILL');
    const operationId = `better-skills-${plan.plan_hash.slice(7, 19)}`;
    const pending = statusManagedCollection({ collectionId: 'better-skills', home: fixture.home });
    assert.equal(pending.status, 'RECOVERY_REQUIRED', pending.issues.join(', '));
    const recovered = recoverManagedOperation({ home: fixture.home, operationId, confirmation: operationId });
    assert.equal(recovered.status, 'RESTORED_PRESTATE');
    if (phase === 'after_prepared') {
      assert.equal(recoverManagedOperation({ home: fixture.home, operationId, confirmation: operationId }).status, 'RESTORED_PRESTATE');
    }
    assert.equal(statusManagedCollection({ collectionId: 'better-skills', home: fixture.home }).status, 'UNMANAGED');
    for (const member of fixture.activeMembers) assert.equal(existsSync(join(fixture.skillsRoot, member.name, 'SKILL.md')), true);
    for (const rootPath of fixture.agentRoots) {
      for (const member of fixture.activeMembers) assert.equal(readlinkSync(join(rootPath, member.name)), `../../.agents/skills/${member.name}`);
    }
  });
}

test('a conflicting non-symlink projection fails plan compilation', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  const fixture = makeManagedHome(root, 'better-skills');
  const path = join(fixture.home, '.codex/skills/bs-prdefine');
  mkdirSync(path, { recursive: true });
  assert.throws(() => compileManagedPlan({ collectionId: 'better-skills', home: fixture.home, sourceRoot: source, revision: managedRevision(source) }), /not a symlink/u);
});

test('broken and byte-identical unqualified active projections fail planning', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  const fixture = makeManagedHome(root, 'better-skills');
  const broken = join(fixture.home, '.claude/skills/bs-prdefine');
  unlinkSync(broken);
  symlinkSync('../../.agents/skills/no-such', broken);
  assert.throws(() => compileManagedPlan({ collectionId: 'better-skills', home: fixture.home, sourceRoot: source, revision: managedRevision(source) }), /qualified exact upstream member/u);
  unlinkSync(broken);
  symlinkSync('../../.agents/skills/bs-prdefine', broken);
  const alternate = join(root, 'alternate-bs-prose-master');
  cpSync(join(fixture.skillsRoot, 'bs-prose-master'), alternate, { recursive: true });
  const divergent = join(fixture.home, '.factory/skills/bs-prose-master');
  unlinkSync(divergent);
  symlinkSync(alternate, divergent);
  assert.throws(() => compileManagedPlan({ collectionId: 'better-skills', home: fixture.home, sourceRoot: source, revision: managedRevision(source) }), /qualified exact upstream member/u);
});

test('source inspection rejects references not closed by declared packaging resources', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  const skillPath = join(source, 'skills/bs-prdefine/SKILL.md');
  writeFileSync(skillPath, `${readFileSync(skillPath, 'utf8')}\n[Missing](references/not-declared.md)\n`);
  const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', 'broken reference'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  assert.throws(() => inspectManagedSource({ collectionId: 'better-skills', sourceRoot: source, revision: managedRevision(source) }), /packaged reference/u);
});

test('source inspection closes references originating from shared resources', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  rmSync(join(source, 'tools/check-patterns.sh'));
  const committed = spawnSync('/usr/bin/git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-am', 'remove shared dependency'], { encoding: 'utf8' });
  assert.equal(committed.status, 0, committed.stderr);
  assert.throws(() => inspectManagedSource({ collectionId: 'better-skills', sourceRoot: source, revision: managedRevision(source) }), /reference input/u);
});
