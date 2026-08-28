import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCollectionPlan,
  computeCollectionPlanHash,
  validateCollectionIndex,
  validateCollectionPlan,
  validateOperationRecord,
} from '../lib/collection-contract.mjs';

function input() {
  const value = {
    collection_id: 'prodcraft',
    home: '/tmp/home',
    source: {
      provider: 'github',
      repository_id: 'yknothing/prodcraft',
      revision: 'a'.repeat(40),
      root: '/tmp/source',
      remote_attestation: {
        scheme: 'origin-tracking-containment.v1', refs: ['refs/remotes/origin/main'],
      },
      tree_digest: `sha256:${'1'.repeat(64)}`,
      registry_digest: `sha256:${'2'.repeat(64)}`,
      curated_index_digest: `sha256:${'3'.repeat(64)}`,
      reference_graph_digest: `sha256:${'a'.repeat(64)}`,
      members: [{
        name: 'pc-prodcraft',
        relative_path: 'skills/.curated/pc-prodcraft',
        tree_digest: `sha256:${'4'.repeat(64)}`,
      }],
    },
    receipt: {
      path: '/tmp/home/.agents/.skill-lock.json',
      digest: `sha256:${'5'.repeat(64)}`,
      entries_digest: `sha256:${'6'.repeat(64)}`,
    },
    legacy: [{
      name: 'prodcraft',
      path: '/tmp/home/.agents/skills/prodcraft',
      kind: 'directory',
      tree_digest: `sha256:${'7'.repeat(64)}`,
      native_manifest: `sha256:${'e'.repeat(64)}`,
      security_metadata_hash: `sha256:${'0'.repeat(64)}`,
      receipt_evidence_digest: `sha256:${'b'.repeat(64)}`,
      receipt: {
        source: 'yknothing/prodcraft',
        source_type: 'github',
        source_url: 'https://github.com/yknothing/prodcraft.git',
        skill_path: 'skills/.curated/prodcraft/SKILL.md',
        skill_folder_hash: 'd'.repeat(40),
        installed_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-07-13T00:00:00.000Z',
        resolved_revision: null,
      },
      disposition: 'replaced',
      successor: 'pc-prodcraft',
    }],
    projections: [{
      agent: 'claude',
      root: '/tmp/home/.claude/skills',
      name: 'prodcraft',
      path: '/tmp/home/.claude/skills/prodcraft',
      kind: 'symlink',
      raw_target: '../../.agents/skills/prodcraft',
      target_digest: `sha256:${'7'.repeat(64)}`,
      native_manifest: `sha256:${'f'.repeat(64)}`,
      security_metadata_hash: `sha256:${'1'.repeat(64)}`,
    }],
    predecessor: null,
    target: {
      collection_root: '/tmp/home/.agents/skills/prodcraft',
      gateway_projection: '/tmp/home/.agents/skills/pc-prodcraft',
      gateway_raw_target: 'prodcraft/pc-prodcraft',
      agent_gateway_raw_target: '../../.agents/skills/pc-prodcraft',
    },
    control: {
      root: '/tmp/home/.agents/skill-control/collections/prodcraft',
      quarantine_root: '/tmp/home/.agents/skills-quarantine/collections',
      recovery_root: '/tmp/home/Library/Application Support/skills-refiner/recovery',
    },
    controller: {
      adapter: 'macos-native.v1',
      node_major: 24,
      bundle_digest: `sha256:${'c'.repeat(64)}`,
      helper_binary_digest: `sha256:${'d'.repeat(64)}`,
      helper_source_digest: `sha256:${'e'.repeat(64)}`,
      architecture: 'arm64',
      compiler_path: '/usr/bin/clang',
      compiler_version: 'Apple clang fixture',
    },
    agent_roots: [{ agent: 'claude', root: '/tmp/home/.claude/skills', profile: 'gateway_projection', qualification: 'filesystem_only' }],
    created_at: '2026-07-20T00:00:00.000Z',
  };
  for (let index = 1; index <= 38; index += 1) {
    const name = `skill-${String(index).padStart(2, '0')}`;
    const successor = `pc-${name}`;
    value.source.members.push({
      name: successor,
      relative_path: `skills/.curated/${successor}`,
      tree_digest: `sha256:${String((index % 8) + 1).repeat(64)}`,
    });
    value.legacy.push({
      ...structuredClone(value.legacy[0]),
      name,
      path: `/tmp/home/.agents/skills/${name}`,
      receipt_evidence_digest: `sha256:${String((index % 8) + 1).repeat(64)}`,
      receipt: {
        ...structuredClone(value.legacy[0].receipt),
        skill_path: `skills/.curated/${name}/SKILL.md`,
      },
      successor,
    });
  }
  for (let index = 1; index <= 7; index += 1) {
    const name = `retired-${String(index).padStart(2, '0')}`;
    value.legacy.push({
      ...structuredClone(value.legacy[0]),
      name,
      path: `/tmp/home/.agents/skills/${name}`,
      receipt_evidence_digest: `sha256:${String(index).repeat(64)}`,
      receipt: {
        ...structuredClone(value.legacy[0].receipt),
        skill_path: `skills/cross-cutting/${name}/SKILL.md`,
      },
      disposition: 'retired_by_owner',
      successor: null,
    });
  }
  return value;
}

test('buildCollectionPlan produces a validated plan whose timestamp is authorization-bound', () => {
  const plan = buildCollectionPlan(input());
  assert.equal(validateCollectionPlan(plan), plan);
  assert.match(plan.plan_hash, /^sha256:[0-9a-f]{64}$/u);
  const changedTime = { ...plan, created_at: '2027-01-01T00:00:00.000Z' };
  assert.notEqual(computeCollectionPlanHash(changedTime), plan.plan_hash);
});

test('plan hash binds source and installed-state identities', () => {
  const plan = buildCollectionPlan(input());
  const changed = structuredClone(plan);
  changed.legacy[0].tree_digest = `sha256:${'8'.repeat(64)}`;
  changed.plan_hash = computeCollectionPlanHash(changed);
  assert.notEqual(changed.plan_hash, plan.plan_hash);
});

test('validation rejects unknown keys, unsafe names, and relative managed paths', () => {
  const unknown = buildCollectionPlan(input());
  unknown.surprise = true;
  assert.throws(() => validateCollectionPlan(unknown), /unknown key/u);

  const unsafeName = input();
  unsafeName.source.members[0].name = 'prodcraft';
  assert.throws(() => buildCollectionPlan(unsafeName), /member name/u);

  const relativePath = input();
  relativePath.target.collection_root = '.agents/skills/prodcraft';
  assert.throws(() => buildCollectionPlan(relativePath), /absolute/u);

  const wrongTarget = input();
  wrongTarget.target.collection_root = '/tmp/home/.agents/skills/unrelated';
  assert.throws(() => buildCollectionPlan(wrongTarget), /fixed ProdCraft topology/u);

  const wrongSuccessor = input();
  wrongSuccessor.legacy[0].successor = 'pc-made-up';
  assert.throws(() => buildCollectionPlan(wrongSuccessor), /successor/u);

  const unrelatedProjection = input();
  unrelatedProjection.projections[0].name = 'unrelated';
  unrelatedProjection.projections[0].path = '/tmp/home/.claude/skills/unrelated';
  assert.throws(() => buildCollectionPlan(unrelatedProjection), /legacy set/u);
});

test('collection index and operation records reject malformed materialized state', () => {
  const index = {
    schema_version: 'skills-refiner.collection.index.v1',
    collection_id: 'prodcraft',
    source: { provider: 'github', repository_id: 'yknothing/prodcraft', resolved_revision: 'a'.repeat(40), tree_digest: `sha256:${'1'.repeat(64)}` },
    artifact_digest: `sha256:${'1'.repeat(64)}`,
    public_registry_digest: `sha256:${'2'.repeat(64)}`,
    members: [{ name: 'pc-prodcraft', relative_path: 'pc-prodcraft', tree_digest: `sha256:${'4'.repeat(64)}` }],
    gateway: { name: 'pc-prodcraft', locator_digest: `sha256:${'9'.repeat(64)}` },
    receipt_snapshot_digest: `sha256:${'5'.repeat(64)}`,
    profile_matrix_digest: `sha256:${'6'.repeat(64)}`,
    plan_created_at: '2026-07-20T00:00:00.000Z',
    operation_id: 'prodcraft-abcdef012345',
  };
  assert.equal(validateCollectionIndex(index), index);
  assert.throws(() => validateCollectionIndex({ ...index, description: 'context payload' }), /unknown key/u);

  const operation = {
    schema_version: 'skills-refiner.collection.operation.v1',
    collection_id: 'prodcraft',
    operation_id: 'prodcraft-abcdef012345',
    plan_hash: `sha256:${'a'.repeat(64)}`,
    state: 'COMMITTED',
    updated_at: '2026-07-20T00:00:00.000Z',
    mutation_occurred: true,
    error_code: null,
  };
  assert.equal(validateOperationRecord(operation), operation);
  assert.throws(() => validateOperationRecord({ ...operation, state: 'DONE' }), /state/u);
});
