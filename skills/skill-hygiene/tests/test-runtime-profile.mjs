import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { computeTreeDigest } from '../lib/collection-tree.mjs';
import { buildCollectionPlan } from '../lib/collection-contract.mjs';
import { collectionSpec } from '../lib/collection-specs.mjs';
import { buildManagedPlan } from '../lib/managed-collection-contract.mjs';
import {
  applyRuntimeProfilePlan, compileRuntimeProfilePlan, recoverRuntimeProfile, statusRuntimeProfile,
  undoRuntimeProfile,
} from '../lib/runtime-profile.mjs';

const MEMBERS = {
  prodcraft: [
    'pc-prodcraft', 'pc-intake',
    ...Array.from({ length: 37 }, (_, index) => `pc-legacy-${String(index + 1).padStart(2, '0')}`),
  ],
  'better-skills': [
    'bs-prdefine', 'bs-insight-product', 'bs-prospect-customer', 'bs-ui-master',
    'bs-prose-master', 'bs-sw-master', 'bs-reflect-loop', 'bs-skill-auditor',
    'bs-skill-forge', 'bs-social-card', 'bs-visual-article', 'bs-ppt-master',
    'bs-uml-master',
  ],
  loopos: [
    'loopos', 'loopos-accept', 'loopos-benchmark', 'loopos-compile', 'loopos-doctor',
    'loopos-goal', 'loopos-improve', 'loopos-recover', 'loopos-review', 'loopos-run',
  ],
  langcraft: ['langcraft', 'philosophical-discourse', 'prose-craft', 'script-craft', 'tech-writing', 'translation'],
};

const candidateValidator = () => ({
  validator: 'fixture.v1',
  status: 'pass',
  codex_version: 'fixture',
  observed_names_digest: `sha256:${'c'.repeat(64)}`,
  managed_identity_conformant: true,
});

function write(path, body, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, body, { mode });
}

const DIGEST = `sha256:${'a'.repeat(64)}`;

function controllerFixture() {
  return {
    adapter: 'macos-native.v1', node_major: 24, bundle_digest: DIGEST,
    helper_binary_digest: DIGEST, helper_source_digest: DIGEST,
    architecture: 'fixture', compiler_path: '/usr/bin/clang', compiler_version: 'fixture',
  };
}

function prodcraftPlanFixture(home, collectionRoot, indexedMembers) {
  const replaced = indexedMembers.map((member) => ({ name: member.name.slice(3), successor: member.name }));
  const retired = Array.from({ length: 7 }, (_, index) => ({
    name: `retired-${String(index + 1).padStart(2, '0')}`, successor: null,
  }));
  const legacy = [...replaced, ...retired].map(({ name, successor }) => ({
    name,
    path: join(home, '.agents', 'skills', name),
    kind: 'directory',
    tree_digest: DIGEST,
    native_manifest: DIGEST,
    security_metadata_hash: DIGEST,
    receipt_evidence_digest: DIGEST,
    receipt: {
      source: 'yknothing/prodcraft', source_type: 'github',
      source_url: 'https://github.com/yknothing/prodcraft.git',
      skill_path: `fixture/${name}/SKILL.md`, skill_folder_hash: 'f'.repeat(40),
      installed_at: '2026-08-27T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z',
      resolved_revision: null,
    },
    disposition: successor === null ? 'retired_by_owner' : 'replaced',
    successor,
  }));
  return buildCollectionPlan({
    collection_id: 'prodcraft',
    home,
    source: {
      provider: 'github', repository_id: 'yknothing/prodcraft', revision: 'b'.repeat(40),
      root: join(home, '.cache', 'prodcraft'), tree_digest: DIGEST,
      remote_attestation: {
        scheme: 'origin-tracking-containment.v1', refs: ['refs/remotes/origin/main'],
      },
      registry_digest: DIGEST, curated_index_digest: DIGEST, reference_graph_digest: DIGEST,
      members: indexedMembers.map(({ name, tree_digest }) => ({
        name, relative_path: `skills/${name}`, tree_digest,
      })),
    },
    receipt: { path: join(home, '.agents', '.skill-lock.json'), digest: DIGEST, entries_digest: DIGEST },
    legacy,
    projections: [],
    target: {
      collection_root: collectionRoot,
      gateway_projection: join(home, '.agents', 'skills', 'pc-prodcraft'),
      gateway_raw_target: 'prodcraft/pc-prodcraft',
      agent_gateway_raw_target: '../../.agents/skills/pc-prodcraft',
    },
    control: {
      root: join(home, '.agents', 'skill-control', 'collections', 'prodcraft'),
      quarantine_root: join(home, '.agents', 'skills-quarantine', 'collections'),
      recovery_root: join(home, 'Library', 'Application Support', 'skills-refiner', 'recovery'),
    },
    controller: controllerFixture(),
    agent_roots: [],
    created_at: '2026-08-28T00:00:00.000Z',
  });
}

function managedPlanFixture(home, collectionId, collectionRoot, indexedMembers, indexedResources) {
  const spec = collectionSpec(collectionId);
  const treeByName = new Map(indexedMembers.map((member) => [member.name, member.tree_digest]));
  const sourceMembers = spec.members.map(({ name, sourcePath }) => ({
    name, source_path: sourcePath, tree_digest: treeByName.get(name),
  }));
  const first = sourceMembers[0];
  const firstSpec = spec.members.find(({ name }) => name === first.name);
  return buildManagedPlan({
    collection_id: collectionId,
    home,
    source: {
      provider: 'github', repository_id: spec.repositoryId, revision: 'b'.repeat(40),
      root: join(home, '.cache', collectionId), tree_digest: DIGEST,
      remote_attestation: {
        scheme: 'origin-tracking-containment.v1', refs: ['refs/remotes/origin/main'],
      },
      manifest_digest: DIGEST, reference_graph_digest: DIGEST,
      members: sourceMembers,
      resources: indexedResources.map(({ relative_path, tree_digest }) => ({
        source_path: relative_path, relative_path, tree_digest,
      })),
    },
    preserved_collisions: [],
    receipt: {
      path: join(home, '.agents', '.skill-lock.json'), digest: DIGEST, entries_digest: DIGEST,
      history: {
        entry_count: indexedMembers.length,
        first_installed_at: '2026-08-27T00:00:00.000Z',
        last_updated_at: '2026-08-28T00:00:00.000Z',
      },
    },
    legacy: [{
      name: first.name, path: join(home, '.agents', 'skills', first.name), kind: 'directory',
      tree_digest: DIGEST, native_manifest: DIGEST, security_metadata_hash: DIGEST,
      receipt_evidence_digest: DIGEST,
      receipt: {
        source: spec.repositoryId, source_type: 'github', source_url: spec.sourceUrl,
        skill_path: `${firstSpec.sourcePath}/SKILL.md`, skill_folder_hash: 'f'.repeat(40),
        installed_at: '2026-08-27T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z',
        resolved_revision: null,
      },
      disposition: 'replaced', successor: first.name,
    }],
    projections: [],
    predecessor: null,
    target: {
      collection_root: collectionRoot,
      exposure: {
        type: spec.exposure.type, name: spec.exposure.name,
        global_projection: null, global_raw_target: null,
        agent_raw_target: spec.exposure.type === 'gateway'
          ? `../../.agents/skills/${collectionId}/${spec.exposure.name}`
          : `../../.agents/skills/${collectionId}`,
      },
    },
    control: {
      root: join(home, '.agents', 'skill-control', 'collections', collectionId),
      quarantine_root: join(home, '.agents', 'skills-quarantine', 'collections'),
      recovery_root: join(home, 'Library', 'Application Support', 'skills-refiner', 'recovery'),
    },
    controller: controllerFixture(),
    agent_roots: [],
    created_at: '2026-08-28T00:00:00.000Z',
  });
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'skills-runtime-profile-')));
  const home = join(root, 'home');
  mkdirSync(home, { mode: 0o700 });
  const catalog = {
    schema_version: 'skills-refiner.collection-catalog.v1',
    updated_at: '2026-08-28T00:00:01.000Z',
    collections: {},
  };
  for (const [collectionId, members] of Object.entries(MEMBERS)) {
    const collectionRoot = join(home, '.agents', 'skills', collectionId);
    mkdirSync(collectionRoot, { recursive: true, mode: 0o755 });
    for (const name of members) write(join(collectionRoot, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when testing runtime profile reconciliation.\n---\n`, 0o644);
    const indexed = members.map((name) => ({
      name,
      relative_path: name,
      tree_digest: computeTreeDigest(join(collectionRoot, name), (code, message) => { throw new Error(`${code}:${message}`); }),
    }));
    const repository = collectionId === 'prodcraft' ? 'yknothing/prodcraft'
      : collectionId === 'better-skills' ? 'yknothing/better-skills'
        : collectionId === 'loopos' ? 'yknothing/loopos' : 'yknothing/langcraft';
    if (collectionId === 'prodcraft') {
      write(join(collectionRoot, 'INDEX.json'), `${JSON.stringify({
        schema_version: 'skills-refiner.collection.index.v1', collection_id: collectionId,
        source: { provider: 'github', repository_id: 'yknothing/prodcraft', resolved_revision: 'b'.repeat(40), tree_digest: DIGEST },
        artifact_digest: DIGEST, public_registry_digest: DIGEST, members: indexed,
        gateway: { name: 'pc-prodcraft', locator_digest: DIGEST }, receipt_snapshot_digest: DIGEST,
        profile_matrix_digest: DIGEST, plan_created_at: '2026-08-28T00:00:00.000Z',
        operation_id: 'prodcraft-aaaaaaaaaaaa',
      })}\n`, 0o644);
    } else {
      const resources = [];
      if (collectionId === 'better-skills') {
        write(join(collectionRoot, 'docs', 'patterns', 'fixture.md'), 'fixture\n', 0o644);
        resources.push({
          relative_path: 'docs/patterns',
          tree_digest: computeTreeDigest(join(collectionRoot, 'docs', 'patterns'), (code, message) => { throw new Error(`${code}:${message}`); }),
        });
      }
      write(join(collectionRoot, 'INDEX.json'), `${JSON.stringify({
        schema_version: 'skills-refiner.managed-collection.index.v2', collection_id: collectionId,
        source: { provider: 'github', repository_id: repository, resolved_revision: 'b'.repeat(40), tree_digest: DIGEST },
        artifact_digest: DIGEST, manifest_digest: DIGEST, members: indexed, resources,
        exposure: { type: collectionId === 'better-skills' ? 'collection' : 'gateway', name: collectionId, locator_digest: collectionId === 'better-skills' ? null : DIGEST },
        receipt_snapshot_digest: DIGEST, profile_matrix_digest: DIGEST,
        plan_created_at: '2026-08-28T00:00:00.000Z', operation_id: `${collectionId}-aaaaaaaaaaaa`,
      })}\n`, 0o644);
    }
    const indexPath = join(collectionRoot, 'INDEX.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const collectionPlan = collectionId === 'prodcraft'
      ? prodcraftPlanFixture(home, collectionRoot, index.members)
      : managedPlanFixture(home, collectionId, collectionRoot, index.members, index.resources);
    const planHash = collectionPlan.plan_hash;
    const operationId = `${collectionId}-${planHash.slice(7, 19)}`;
    index.operation_id = operationId;
    write(indexPath, `${JSON.stringify(index)}\n`, 0o644);
    const operationRoot = join(
      home, '.agents', 'skill-control', 'collections', collectionId, 'operations', operationId,
    );
    write(join(operationRoot, 'plan.json'), `${JSON.stringify(collectionPlan)}\n`);
    write(join(operationRoot, 'operation.json'), `${JSON.stringify({
      schema_version: collectionId === 'prodcraft'
        ? 'skills-refiner.collection.operation.v1' : 'skills-refiner.managed-collection.operation.v2',
      collection_id: collectionId,
      operation_id: operationId,
      plan_hash: planHash,
      state: 'COMMITTED',
      updated_at: '2026-08-28T00:00:01.000Z',
      mutation_occurred: true,
      error_code: null,
    })}\n`);
    const active = collectionId === 'prodcraft'
      ? { schema_version: 'skills-refiner.collection.active.v1', operation_id: operationId, plan_hash: planHash }
      : {
          schema_version: 'skills-refiner.collection.active.v2', collection_id: collectionId,
          operation_id: operationId, plan_hash: planHash, activated_at: '2026-08-28T00:00:01.000Z',
        };
    write(join(home, '.agents', 'skill-control', 'collections', collectionId, 'active.json'), `${JSON.stringify(active)}\n`);
    if (collectionId !== 'prodcraft') {
      catalog.collections[collectionId] = {
        collection_id: collectionId,
        operation_id: operationId,
        plan_hash: planHash,
        source: {
          provider: 'github', repository_id: repository,
          resolved_revision: collectionPlan.source.revision,
          artifact_digest: collectionPlan.source.tree_digest,
        },
        collection_root: collectionRoot,
        recovery_plan: join(home, 'Library', 'Application Support', 'skills-refiner', 'recovery', 'operations', operationId, 'plan.json'),
        lifecycle: {
          receipt_history: collectionPlan.receipt.history,
          plan_created_at: collectionPlan.created_at,
          first_activated_at: '2026-08-28T00:00:01.000Z',
          current_generation_activated_at: '2026-08-28T00:00:01.000Z',
        },
      };
    }
  }
  const catalogBytes = `${JSON.stringify(catalog)}\n`;
  write(join(home, '.agents', 'skill-control', 'catalog.json'), catalogBytes);
  write(join(home, 'Library', 'Application Support', 'skills-refiner', 'catalog.json'), catalogBytes);
  const codex = join(home, '.codex');
  const claude = join(home, '.claude', 'skills');
  const cursor = join(home, '.cursor', 'skills');
  mkdirSync(codex, { recursive: true, mode: 0o700 });
  mkdirSync(claude, { recursive: true, mode: 0o700 });
  mkdirSync(cursor, { recursive: true, mode: 0o700 });
  const config = '# user-owned prefix\nmodel = "fixture"\n';
  write(join(codex, 'config.toml'), config);
  for (const [name, target] of [
    ['pc-prodcraft', '../../.agents/skills/prodcraft/pc-prodcraft'],
    ['loopos', '../../.agents/skills/loopos/loopos'],
    ['langcraft', '../../.agents/skills/langcraft/langcraft'],
  ]) symlinkSync(target, join(claude, name));
  write(join(cursor, 'keep', 'SKILL.md'), '---\nname: keep\ndescription: Keep.\n---\n', 0o644);
  return { root, home, config, cursorSentinel: readFileSync(join(cursor, 'keep', 'SKILL.md')) };
}

function cleanup(value) {
  rmSync(value.root, { recursive: true, force: true });
}

function plan(home) {
  return compileRuntimeProfilePlan({ home, candidateValidator });
}

test('profile plan derives gateway/member exposure without mutating Cursor', () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    assert.deepEqual(compiled.codex.disabled_paths.map((path) => path.split('/').at(-2)).sort(), [
      'loopos-accept', 'loopos-benchmark', 'loopos-compile', 'loopos-doctor', 'loopos-goal',
      'loopos-improve', 'loopos-recover', 'loopos-review', 'loopos-run',
      ...MEMBERS.prodcraft.filter((name) => name !== 'pc-prodcraft'),
      'philosophical-discourse', 'prose-craft', 'script-craft', 'tech-writing', 'translation',
    ].sort());
    assert.deepEqual(compiled.claude.links.filter(({ before }) => before === 'missing').map(({ name }) => name), [...MEMBERS['better-skills']].sort());
    assert.equal(compiled.cursor.mutation_count, 0);
    const initial = statusRuntimeProfile({ home: value.home });
    assert.equal(initial.status, 'DRIFT');
    assert.ok(initial.issues.includes('PROFILE_NOT_APPLIED'));
    assert.equal(initial.issues.includes('ORPHANED_CONTROL'), false);
    assert.equal(readFileSync(join(value.home, '.codex', 'config.toml'), 'utf8'), value.config);
    assert.deepEqual(readFileSync(join(value.home, '.cursor', 'skills', 'keep', 'SKILL.md')), value.cursorSentinel);
  } finally { cleanup(value); }
});

test('operation artifacts without an active profile are reported as orphaned control', () => {
  const value = fixture();
  try {
    mkdirSync(join(
      value.home, 'Library', 'Application Support', 'skills-refiner', 'runtime-profile',
      'operations', 'runtime-profile-aaaaaaaaaaaa',
    ), { recursive: true, mode: 0o700 });
    const status = statusRuntimeProfile({ home: value.home });
    assert.ok(status.issues.includes('ORPHANED_CONTROL'));
    assert.equal(status.issues.includes('PROFILE_NOT_APPLIED'), false);
  } finally { cleanup(value); }
});

test('apply is confirmation-bound, preserves user config bytes, and undo restores exact prestate', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    assert.throws(() => applyRuntimeProfilePlan(compiled, `sha256:${'0'.repeat(64)}`, { candidateValidator }), /confirmation/);
    const applied = applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator });
    assert.equal(applied.status, 'DEPLOYMENT_READY');
    const configured = readFileSync(join(value.home, '.codex', 'config.toml'), 'utf8');
    assert.ok(configured.startsWith(value.config));
    assert.match(configured, /pc-intake\/SKILL\.md/u);
    assert.equal(realpathSync(join(value.home, '.claude', 'skills', 'bs-prdefine')), join(value.home, '.agents', 'skills', 'better-skills', 'bs-prdefine'));
    assert.equal(realpathSync(join(value.home, '.claude', 'skills', 'bs-uml-master')), join(value.home, '.agents', 'skills', 'better-skills', 'bs-uml-master'));
    assert.equal(statusRuntimeProfile({ home: value.home }).status, 'DEPLOYMENT_READY');
    assert.deepEqual(readFileSync(join(value.home, '.cursor', 'skills', 'keep', 'SKILL.md')), value.cursorSentinel);
    const undone = undoRuntimeProfile({ home: value.home, operationId: applied.operation_id, confirmation: applied.operation_id });
    assert.equal(undone.status, 'RESTORED_PRESTATE');
    assert.equal(readFileSync(join(value.home, '.codex', 'config.toml'), 'utf8'), value.config);
    assert.throws(() => realpathSync(join(value.home, '.claude', 'skills', 'bs-prdefine')));
    assert.throws(() => realpathSync(join(value.home, '.claude', 'skills', 'bs-uml-master')));
    assert.equal(realpathSync(join(value.home, '.claude', 'skills', 'loopos')), join(value.home, '.agents', 'skills', 'loopos', 'loopos'));
  } finally { cleanup(value); }
});

test('config drift after planning blocks apply before mutation', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    writeFileSync(join(value.home, '.codex', 'config.toml'), `${value.config}temperature = 0.2\n`, { mode: 0o600 });
    assert.throws(() => applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator }), /changed after planning|stale/u);
    assert.equal(readFileSync(join(value.home, '.codex', 'config.toml'), 'utf8'), `${value.config}temperature = 0.2\n`);
  } finally { cleanup(value); }
});

test('same-name Claude conflict is preserved and blocks planning', () => {
  const value = fixture();
  try {
    write(join(value.home, '.claude', 'skills', 'bs-prdefine', 'SKILL.md'), '---\nname: bs-prdefine\ndescription: Foreign.\n---\n', 0o644);
    assert.throws(() => plan(value.home), (error) => error.code === 'projection_conflict');
    assert.match(readFileSync(join(value.home, '.claude', 'skills', 'bs-prdefine', 'SKILL.md'), 'utf8'), /Foreign/u);
  } finally { cleanup(value); }
});

test('a same-target link appearing after planning is preserved and makes the plan stale', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    const path = join(value.home, '.claude', 'skills', 'bs-prdefine');
    symlinkSync('../../.agents/skills/better-skills/bs-prdefine', path);
    assert.throws(() => applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator }), /changed after planning|stale/u);
    assert.equal(realpathSync(path), join(value.home, '.agents', 'skills', 'better-skills', 'bs-prdefine'));
    assert.equal(readFileSync(join(value.home, '.codex', 'config.toml'), 'utf8'), value.config);
  } finally { cleanup(value); }
});

test('fault after config publish rolls back with native CAS', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    assert.throws(
      () => applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator, faultPhase: 'after_config' }),
      (error) => error.code === 'injected_fault',
    );
    assert.equal(readFileSync(join(value.home, '.codex', 'config.toml'), 'utf8'), value.config);
    assert.throws(() => realpathSync(join(value.home, '.claude', 'skills', 'bs-prdefine')));
  } finally { cleanup(value); }
});

test('a rolled-back plan can be freshly planned and retried with a unique operation', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const first = plan(value.home);
    assert.throws(
      () => applyRuntimeProfilePlan(first, first.plan_hash, { candidateValidator, faultPhase: 'after_config' }),
      (error) => error.code === 'injected_fault',
    );
    const retry = plan(value.home);
    assert.notEqual(retry.operation_id, first.operation_id);
    assert.notEqual(retry.plan_hash, first.plan_hash);
    assert.equal(retry.precondition_digest, first.precondition_digest);
    const applied = applyRuntimeProfilePlan(retry, retry.plan_hash, { candidateValidator });
    assert.equal(applied.status, 'DEPLOYMENT_READY');
  } finally { cleanup(value); }
});

test('a crash after lock publication is recoverable and does not brick later plans', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const moduleUrl = new URL('../lib/runtime-profile.mjs', import.meta.url).href;
    const source = `
      import { compileRuntimeProfilePlan, applyRuntimeProfilePlan } from ${JSON.stringify(moduleUrl)};
      const candidateValidator = () => ({validator:'fixture.v1',status:'pass',codex_version:'fixture',observed_names_digest:'sha256:${'c'.repeat(64)}',managed_identity_conformant:true});
      const plan = compileRuntimeProfilePlan({home:process.env.FIXTURE_HOME,candidateValidator});
      applyRuntimeProfilePlan(plan, plan.plan_hash, {candidateValidator,faultPhase:'kill_after_lock'});
    `;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      env: { ...process.env, FIXTURE_HOME: value.home }, encoding: 'utf8', timeout: 120_000,
    });
    assert.equal(crashed.signal, 'SIGKILL');
    const lockPath = join(value.home, '.agents', 'skill-control', 'collection-mutation.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const recovered = recoverRuntimeProfile({
      home: value.home, operationId: lock.operation_id, confirmation: lock.operation_id,
    });
    assert.equal(recovered.status, 'RESTORED_PRESTATE');
    assert.equal(existsSync(lockPath), false);
    const retry = plan(value.home);
    assert.equal(applyRuntimeProfilePlan(retry, retry.plan_hash, { candidateValidator }).status, 'DEPLOYMENT_READY');
  } finally { cleanup(value); }
});

test('deleting active control makes the managed block unowned and blocks readiness', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    const applied = applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator });
    rmSync(join(value.home, '.agents', 'skill-control', 'runtime-profile-active.json'));
    const status = statusRuntimeProfile({ home: value.home });
    assert.equal(status.status, 'BLOCKED');
    assert.ok(status.issues.includes('unowned_managed_block'));
    assert.ok(applied.operation_id);
  } finally { cleanup(value); }
});

test('recover revalidates a committed operation and preserves later managed-block tampering', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    const applied = applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator });
    const configPath = join(value.home, '.codex', 'config.toml');
    const edited = readFileSync(configPath, 'utf8').replace('enabled = false', 'enabled = true');
    writeFileSync(configPath, edited, { mode: 0o600 });
    assert.throws(
      () => recoverRuntimeProfile({ home: value.home, operationId: applied.operation_id, confirmation: applied.operation_id }),
      (error) => error.code === 'committed_operation_drift',
    );
    assert.equal(readFileSync(configPath, 'utf8'), edited);
  } finally { cleanup(value); }
});

test('a forged operation view cannot make status or no-op planning report ready', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    const applied = applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator });
    const operationPath = join(
      value.home, 'Library', 'Application Support', 'skills-refiner', 'runtime-profile',
      'operations', applied.operation_id, 'operation.json',
    );
    writeFileSync(operationPath, `${JSON.stringify({
      schema_version: 'skills-refiner.runtime-profile.operation.v1',
      operation_id: applied.operation_id,
      plan_hash: compiled.plan_hash,
      state: 'COMMITTED',
    })}\n`, { mode: 0o600 });
    const status = statusRuntimeProfile({ home: value.home });
    assert.throws(
      () => plan(value.home),
      (error) => error.code === 'managed_block_ownership_unverifiable',
    );
    assert.equal(status.status, 'BLOCKED');
    assert.ok(status.issues.includes('managed_block_ownership_unverifiable'));
  } finally { cleanup(value); }
});

test('hand-written managed markers are never adopted without an attested active record', () => {
  const value = fixture();
  try {
    writeFileSync(join(value.home, '.codex', 'config.toml'), `${value.config}\n# >>> skills-refiner runtime-profile default\n# owner = "skills-refiner.runtime-profile"\n# <<< skills-refiner runtime-profile default\n`, { mode: 0o600 });
    assert.throws(() => plan(value.home), (error) => error.code === 'unowned_managed_block');
  } finally { cleanup(value); }
});

test('undo WAL survives a post-restore fault and recovery finishes the requested undo', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    const applied = applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator });
    assert.throws(
      () => undoRuntimeProfile({
        home: value.home,
        operationId: applied.operation_id,
        confirmation: applied.operation_id,
        faultPhase: 'after_undo_restore',
      }),
      (error) => error.code === 'injected_fault',
    );
    const recovered = recoverRuntimeProfile({
      home: value.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    });
    assert.equal(recovered.status, 'RESTORED_PRESTATE');
    assert.equal(readFileSync(join(value.home, '.codex', 'config.toml'), 'utf8'), value.config);
    const journalRoot = join(
      value.home, 'Library', 'Application Support', 'skills-refiner', 'runtime-profile',
      'operations', applied.operation_id, 'journal',
    );
    const terminal = readFileSync(join(journalRoot, readdirSync(journalRoot).filter((name) => name.endsWith('.json')).sort().at(-1)), 'utf8');
    assert.equal(JSON.parse(terminal).state, 'UNDONE');
  } finally { cleanup(value); }
});

test('SIGKILL after undo WAL is recovered as undo, never as an apply rollback', { timeout: 120_000 }, () => {
  const value = fixture();
  try {
    const compiled = plan(value.home);
    const applied = applyRuntimeProfilePlan(compiled, compiled.plan_hash, { candidateValidator });
    const moduleUrl = new URL('../lib/runtime-profile.mjs', import.meta.url).href;
    const source = `
      import { undoRuntimeProfile } from ${JSON.stringify(moduleUrl)};
      undoRuntimeProfile({home:process.env.FIXTURE_HOME,operationId:process.env.OPERATION_ID,confirmation:process.env.OPERATION_ID,faultPhase:'kill_after_undo_wal'});
    `;
    const crashed = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      env: { ...process.env, FIXTURE_HOME: value.home, OPERATION_ID: applied.operation_id },
      encoding: 'utf8', timeout: 120_000,
    });
    assert.equal(crashed.signal, 'SIGKILL');
    const recovered = recoverRuntimeProfile({
      home: value.home,
      operationId: applied.operation_id,
      confirmation: applied.operation_id,
    });
    assert.equal(recovered.status, 'RESTORED_PRESTATE');
    assert.equal(readFileSync(join(value.home, '.codex', 'config.toml'), 'utf8'), value.config);
    assert.throws(() => realpathSync(join(value.home, '.claude', 'skills', 'bs-prdefine')));
  } finally { cleanup(value); }
});


test('user-owned config for a managed path blocks instead of being overwritten', () => {
  const value = fixture();
  try {
    const path = join(value.home, '.agents', 'skills', 'prodcraft', 'pc-intake', 'SKILL.md');
    writeFileSync(join(value.home, '.codex', 'config.toml'), `${value.config}\n[[skills.config]]\npath = "${path}"\nenabled = true\n`, { mode: 0o600 });
    assert.throws(() => plan(value.home), (error) => error.code === 'external_config_conflict');
  } finally { cleanup(value); }
});

test('quoted headers and escaped paths cannot hide a managed-path ownership conflict', () => {
  for (const renderExternalConfig of [
    (path) => `[[ "skills" . "config" ]]\npath = "${path}"\nenabled = true\n`,
    (path) => `[[skills.config]]\npath = "${path.replace(/^\//u, '\\u002f')}"\nenabled = true\n`,
  ]) {
    const value = fixture();
    try {
      const path = join(value.home, '.agents', 'skills', 'prodcraft', 'pc-intake', 'SKILL.md');
      writeFileSync(
        join(value.home, '.codex', 'config.toml'),
        `${value.config}\n${renderExternalConfig(path)}`,
        { mode: 0o600 },
      );
      assert.throws(() => plan(value.home), (error) => error.code === 'external_config_conflict');
    } finally { cleanup(value); }
  }
});

test('unrelated path and name based Codex skill preferences coexist with the managed profile', () => {
  const value = fixture();
  try {
    writeFileSync(join(value.home, '.codex', 'config.toml'), `${value.config}
[[skills.config]]
name = "plugin:unrelated"
enabled = false

[[ "skills" . "config" ]]
path = "/tmp/unrelated/SKILL.md"
enabled = false
`, { mode: 0o600 });
    assert.equal(plan(value.home).schema_version, 'skills-refiner.runtime-profile.plan.v1');
  } finally { cleanup(value); }
});
