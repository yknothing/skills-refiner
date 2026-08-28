import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeTreeDigest } from '../lib/collection-tree.mjs';
import { buildCollectionPlan } from '../lib/collection-contract.mjs';
import { collectionSpec } from '../lib/collection-specs.mjs';
import { buildManagedPlan } from '../lib/managed-collection-contract.mjs';
import {
  parseClaudeInitCatalog, parseCodexPromptCatalog, parseCodexPromptCatalogEntries, probeRuntime,
} from '../lib/runtime-adapters.mjs';
import {
  collectRuntimeBinding, computeEvidenceId, DEFAULT_RUNTIME_POLICY, recordRuntimeEvidence, runtimeStatus,
  resolveRuntimeExecutable, runRuntimeExecutable, validateRuntimeEvidence,
} from '../lib/runtime-evidence.mjs';
import { validateCodexCandidate } from '../lib/runtime-profile.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const MEMBERS = {
  prodcraft: [
    'pc-prodcraft', 'pc-intake',
    ...Array.from({ length: 37 }, (_, index) => `pc-legacy-${String(index + 1).padStart(2, '0')}`),
  ],
  'better-skills': [
    'bs-prdefine', 'bs-insight-product', 'bs-prospect-customer', 'bs-ui-master',
    'bs-prose-master', 'bs-sw-master', 'bs-reflect-loop', 'bs-skill-auditor',
    'bs-skill-forge', 'bs-social-card', 'bs-visual-article', 'bs-ppt-master',
  ],
  loopos: [
    'loopos', 'loopos-accept', 'loopos-benchmark', 'loopos-compile', 'loopos-doctor',
    'loopos-goal', 'loopos-improve', 'loopos-recover', 'loopos-review', 'loopos-run',
  ],
  langcraft: ['langcraft', 'philosophical-discourse', 'prose-craft', 'script-craft', 'tech-writing', 'translation'],
};
const EXPECTED_CODEX = [...MEMBERS['better-skills'], 'langcraft', 'loopos', 'pc-prodcraft'].sort();

function writeSkill(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when testing runtime evidence.\n---\n`);
}

function controllerFixture() {
  return {
    adapter: 'macos-native.v1', node_major: 24, bundle_digest: DIGEST,
    helper_binary_digest: DIGEST, helper_source_digest: DIGEST,
    architecture: 'fixture', compiler_path: '/usr/bin/clang', compiler_version: 'fixture',
  };
}

function prodcraftPlanFixture(home, root, indexedMembers) {
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
      registry_digest: DIGEST, curated_index_digest: DIGEST, reference_graph_digest: DIGEST,
      members: indexedMembers.map(({ name, tree_digest }) => ({
        name, relative_path: `skills/${name}`, tree_digest,
      })),
    },
    receipt: { path: join(home, '.agents', '.skill-lock.json'), digest: DIGEST, entries_digest: DIGEST },
    legacy,
    projections: [],
    target: {
      collection_root: root,
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

function managedPlanFixture(home, collectionId, root, indexedMembers, indexedResources) {
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
      collection_root: root,
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

function fixtureHome() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'skills-runtime-')));
  const catalog = {
    schema_version: 'skills-refiner.collection-catalog.v1',
    updated_at: '2026-08-28T00:00:01.000Z',
    collections: {},
  };
  for (const [collectionId, members] of Object.entries(MEMBERS)) {
    const root = join(home, '.agents', 'skills', collectionId);
    mkdirSync(root, { recursive: true });
    for (const name of members) writeSkill(root, name);
    const indexedMembers = members.map((name) => ({
        name,
        relative_path: name,
        tree_digest: computeTreeDigest(join(root, name), (code, message) => { throw new Error(`${code}:${message}`); }),
      }));
    if (collectionId === 'prodcraft') {
      writeFileSync(join(root, 'INDEX.json'), `${JSON.stringify({
        schema_version: 'skills-refiner.collection.index.v1', collection_id: collectionId,
        source: { provider: 'github', repository_id: 'yknothing/prodcraft', resolved_revision: 'b'.repeat(40), tree_digest: DIGEST },
        artifact_digest: DIGEST, public_registry_digest: DIGEST, members: indexedMembers,
        gateway: { name: 'pc-prodcraft', locator_digest: DIGEST }, receipt_snapshot_digest: DIGEST,
        profile_matrix_digest: DIGEST, plan_created_at: '2026-08-28T00:00:00.000Z',
        operation_id: 'prodcraft-aaaaaaaaaaaa',
      })}\n`);
    } else {
      const repository = collectionId === 'better-skills' ? 'yknothing/better-skills'
        : collectionId === 'loopos' ? 'yknothing/loopos' : 'yknothing/langcraft';
      const resources = [];
      if (collectionId === 'better-skills') {
        mkdirSync(join(root, 'docs', 'patterns'), { recursive: true });
        writeFileSync(join(root, 'docs', 'patterns', 'fixture.md'), 'fixture\n');
        resources.push({
          relative_path: 'docs/patterns',
          tree_digest: computeTreeDigest(join(root, 'docs', 'patterns'), (code, message) => { throw new Error(`${code}:${message}`); }),
        });
      }
      const exposureName = collectionId === 'better-skills' ? 'better-skills' : collectionId;
      writeFileSync(join(root, 'INDEX.json'), `${JSON.stringify({
        schema_version: 'skills-refiner.managed-collection.index.v2', collection_id: collectionId,
        source: { provider: 'github', repository_id: repository, resolved_revision: 'b'.repeat(40), tree_digest: DIGEST },
        artifact_digest: DIGEST, manifest_digest: DIGEST, members: indexedMembers, resources,
        exposure: { type: collectionId === 'better-skills' ? 'collection' : 'gateway', name: exposureName, locator_digest: collectionId === 'better-skills' ? null : DIGEST },
        receipt_snapshot_digest: DIGEST, profile_matrix_digest: DIGEST,
        plan_created_at: '2026-08-28T00:00:00.000Z', operation_id: `${collectionId}-aaaaaaaaaaaa`,
      })}\n`);
    }
    const indexPath = join(root, 'INDEX.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const plan = collectionId === 'prodcraft'
      ? prodcraftPlanFixture(home, root, index.members)
      : managedPlanFixture(home, collectionId, root, index.members, index.resources);
    const planHash = plan.plan_hash;
    const operationId = `${collectionId}-${planHash.slice(7, 19)}`;
    index.operation_id = operationId;
    writeFileSync(indexPath, `${JSON.stringify(index)}\n`);
    const activeRoot = join(home, '.agents', 'skill-control', 'collections', collectionId);
    mkdirSync(activeRoot, { recursive: true, mode: 0o700 });
    const operationRoot = join(activeRoot, 'operations', operationId);
    mkdirSync(operationRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(operationRoot, 'plan.json'), `${JSON.stringify(plan)}\n`, { mode: 0o600 });
    writeFileSync(join(operationRoot, 'operation.json'), `${JSON.stringify({
      schema_version: collectionId === 'prodcraft'
        ? 'skills-refiner.collection.operation.v1' : 'skills-refiner.managed-collection.operation.v2',
      collection_id: collectionId,
      operation_id: operationId,
      plan_hash: planHash,
      state: 'COMMITTED',
      updated_at: '2026-08-28T00:00:01.000Z',
      mutation_occurred: true,
      error_code: null,
    })}\n`, { mode: 0o600 });
    const active = collectionId === 'prodcraft'
      ? { schema_version: 'skills-refiner.collection.active.v1', operation_id: operationId, plan_hash: planHash }
      : {
        schema_version: 'skills-refiner.collection.active.v2', collection_id: collectionId,
        operation_id: operationId, plan_hash: planHash, activated_at: '2026-08-28T00:00:01.000Z',
      };
    writeFileSync(join(activeRoot, 'active.json'), `${JSON.stringify(active)}\n`, { mode: 0o600 });
    if (collectionId !== 'prodcraft') {
      catalog.collections[collectionId] = {
        collection_id: collectionId,
        operation_id: operationId,
        plan_hash: planHash,
        source: {
          provider: 'github', repository_id: plan.source.repository_id,
          resolved_revision: plan.source.revision, artifact_digest: plan.source.tree_digest,
        },
        collection_root: root,
        recovery_plan: join(
          home, 'Library', 'Application Support', 'skills-refiner', 'recovery', 'operations',
          operationId, 'plan.json',
        ),
        lifecycle: {
          receipt_history: plan.receipt.history,
          plan_created_at: plan.created_at,
          first_activated_at: '2026-08-28T00:00:01.000Z',
          current_generation_activated_at: '2026-08-28T00:00:01.000Z',
        },
      };
    }
  }
  const catalogBytes = `${JSON.stringify(catalog)}\n`;
  const catalogViewRoot = join(home, '.agents', 'skill-control');
  const canonicalCatalogRoot = join(home, 'Library', 'Application Support', 'skills-refiner');
  mkdirSync(catalogViewRoot, { recursive: true, mode: 0o700 });
  mkdirSync(canonicalCatalogRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(catalogViewRoot, 'catalog.json'), catalogBytes, { mode: 0o600 });
  writeFileSync(join(canonicalCatalogRoot, 'catalog.json'), catalogBytes, { mode: 0o600 });
  mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex', 'config.toml'), 'model = "fixture"\n', { mode: 0o600 });
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  mkdirSync(join(home, '.cursor', 'skills'), { recursive: true });
  return home;
}

function codexPrompt(names, home = null) {
  const collectionFor = new Map(Object.entries(MEMBERS).flatMap(([collection, members]) => members.map((name) => [name, collection])));
  const lines = names.map((name) => {
    const path = home && collectionFor.has(name) ? `r1/${collectionFor.get(name)}/${name}/SKILL.md` : `r1/${name}/SKILL.md`;
    return `- ${name}: Fixture description (file: ${path})`;
  }).join('\n');
  return JSON.stringify([{
    role: 'developer',
    content: [{ type: 'input_text', text: `<skills_instructions>\n### Skill roots\n- \`r1\` = \`${home ? join(home, '.agents', 'skills') : '/tmp/skills'}\`\n### Available skills\n${lines}\n</skills_instructions>` }],
  }]);
}

function rewriteJson(path, update) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  update(value);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function rewriteCatalogs(home, update) {
  for (const path of [
    join(home, 'Library', 'Application Support', 'skills-refiner', 'catalog.json'),
    join(home, '.agents', 'skill-control', 'catalog.json'),
  ]) rewriteJson(path, update);
}

function collectionOperationPath(home, collectionId, file) {
  const active = JSON.parse(readFileSync(
    join(home, '.agents', 'skill-control', 'collections', collectionId, 'active.json'), 'utf8',
  ));
  return join(
    home, '.agents', 'skill-control', 'collections', collectionId, 'operations',
    active.operation_id, file,
  );
}

function assertControlDrift(home, expectedLayer) {
  assert.throws(
    () => collectRuntimeBinding({ home, adapter: 'codex' }),
    (error) => error.code === 'collection_control_drift' && error.control_layer === expectedLayer,
  );
  const status = runtimeStatus({ home });
  for (const adapter of ['codex', 'claude', 'cursor']) {
    assert.equal(status.adapters[adapter].status, 'DEPLOYMENT_DRIFT');
    assert.equal(status.adapters[adapter].reason, 'collection_control_drift');
    assert.equal(status.adapters[adapter].control_layer, expectedLayer);
  }
}

test('Codex parser extracts ordinary and plugin-qualified names without retaining prompt text', () => {
  const names = parseCodexPromptCatalog(codexPrompt(['pc-prodcraft', 'github:github']));
  assert.deepEqual(names, ['github:github', 'pc-prodcraft']);
});

test('Codex parser requires one developer-owned catalog and rejects alias traversal', () => {
  const one = JSON.parse(codexPrompt(['pc-prodcraft']));
  assert.throws(
    () => parseCodexPromptCatalogEntries(JSON.stringify([...one, ...one])),
    /exactly one Codex skills catalog/u,
  );
  one[0].role = 'user';
  assert.throws(() => parseCodexPromptCatalogEntries(JSON.stringify(one)), /observed 0/u);
  const traversing = JSON.parse(codexPrompt(['pc-prodcraft']));
  traversing[0].content[0].text = traversing[0].content[0].text
    .replace('r1/pc-prodcraft/SKILL.md', 'r1/../pc-prodcraft/SKILL.md');
  assert.throws(() => parseCodexPromptCatalogEntries(JSON.stringify(traversing)), /catalog was not found/u);
});

test('Claude parser extracts native system.init.skills from a mixed JSONL stream', () => {
  const parsed = parseClaudeInitCatalog([
    JSON.stringify({ type: 'system', subtype: 'hook_started' }),
    JSON.stringify({ type: 'system', subtype: 'init', skills: ['loopos', 'langcraft'], claude_code_version: '2.1.250' }),
    JSON.stringify({ type: 'assistant', error: 'authentication_failed' }),
  ].join('\n'));
  assert.deepEqual(parsed.names, ['langcraft', 'loopos']);
  assert.equal(parsed.runtimeVersion, '2.1.250');
});

test('policy derives host-specific expected catalogs from exact INDEX member sets', () => {
  const home = fixtureHome();
  try {
    const codex = collectRuntimeBinding({ home, adapter: 'codex' });
    assert.deepEqual(codex.expected_names, EXPECTED_CODEX);
    assert.match(codex.deployment.collection_control_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(codex.collections[0].plan_hash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(codex.collections[0].control_binding.control_schema, 'prodcraft.v1');
    assert.equal(codex.collections[1].control_binding.control_schema, 'managed.v2');
    const claude = collectRuntimeBinding({ home, adapter: 'claude' });
    assert.deepEqual(claude.expected_names, codex.expected_names);
    const cursor = collectRuntimeBinding({ home, adapter: 'cursor' });
    assert.deepEqual(cursor.expected_names, Object.values(MEMBERS).flat().sort());
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Codex config must exist as an owner-private real file', () => {
  for (const mutation of ['missing', 'non_private', 'symlink']) {
    const home = fixtureHome();
    try {
      const configPath = join(home, '.codex', 'config.toml');
      if (mutation === 'missing') rmSync(configPath);
      else if (mutation === 'non_private') chmodSync(configPath, 0o640);
      else {
        rmSync(configPath);
        writeFileSync(join(home, '.codex', 'config-target.toml'), 'model = "target"\n', { mode: 0o600 });
        symlinkSync('config-target.toml', configPath);
      }
      assert.throws(
        () => collectRuntimeBinding({ home, adapter: 'codex' }),
        (error) => error.code === 'runtime_config_drift',
      );
      const status = runtimeStatus({ home });
      assert.equal(status.adapters.codex.status, 'DEPLOYMENT_DRIFT');
      assert.equal(status.adapters.codex.reason, 'runtime_config_drift');
      assert.equal(status.adapters.claude.status, 'UNVERIFIED');
      assert.equal(status.adapters.cursor.status, 'UNVERIFIED');
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test('collection control binding fails closed by catalog, active, and identity layer', () => {
  const cases = [
    {
      layer: 'catalog_canonical',
      mutate: (home) => rmSync(join(home, 'Library', 'Application Support', 'skills-refiner', 'catalog.json')),
    },
    {
      layer: 'catalog_view',
      mutate: (home) => rmSync(join(home, '.agents', 'skill-control', 'catalog.json')),
    },
    {
      layer: 'catalog_mirror',
      mutate: (home) => rewriteJson(join(home, '.agents', 'skill-control', 'catalog.json'), (catalog) => {
        catalog.updated_at = '2026-08-28T00:00:02.000Z';
      }),
    },
    {
      layer: 'active',
      mutate: (home) => rmSync(join(home, '.agents', 'skill-control', 'collections', 'prodcraft', 'active.json')),
    },
    {
      layer: 'catalog_entry',
      mutate: (home) => rewriteCatalogs(home, (catalog) => {
        delete catalog.collections.loopos;
      }),
    },
    {
      layer: 'identity',
      mutate: (home) => rewriteJson(join(home, '.agents', 'skills', 'prodcraft', 'INDEX.json'), (index) => {
        index.operation_id = 'prodcraft-bbbbbbbbbbbb';
      }),
    },
    {
      layer: 'identity',
      mutate: (home) => rewriteCatalogs(home, (catalog) => {
        catalog.collections['better-skills'].plan_hash = `sha256:${'d'.repeat(64)}`;
      }),
    },
    {
      layer: 'identity',
      mutate: (home) => rewriteCatalogs(home, (catalog) => {
        catalog.collections.loopos.source.resolved_revision = 'd'.repeat(40);
      }),
    },
    {
      layer: 'identity',
      mutate: (home) => rewriteCatalogs(home, (catalog) => {
        catalog.collections.langcraft.collection_root = join(home, '.agents', 'skills', 'other-langcraft');
      }),
    },
    {
      layer: 'plan',
      mutate: (home) => rewriteJson(collectionOperationPath(home, 'prodcraft', 'plan.json'), (plan) => {
        plan.source.revision = 'd'.repeat(40);
      }),
    },
    {
      layer: 'identity',
      mutate: (home) => rewriteJson(collectionOperationPath(home, 'prodcraft', 'operation.json'), (operation) => {
        operation.state = 'ROLLED_BACK';
      }),
    },
  ];
  for (const { layer, mutate } of cases) {
    const home = fixtureHome();
    try {
      mutate(home);
      assertControlDrift(home, layer);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test('Codex evidence separates metadata discovery from desired-policy drift and hashes raw output', () => {
  const home = fixtureHome();
  try {
    const observed = Object.values(MEMBERS).flat();
    const runner = () => ({ status: 0, stdout: codexPrompt(observed, home), stderr: 'sensitive stderr is hashed only' });
    const evidence = probeRuntime({ home, adapter: 'codex', runner });
    validateRuntimeEvidence(evidence);
    assert.equal(evidence.observations.catalog.result, 'pass');
    assert.equal(evidence.observations.catalog.policy_conformance, 'fail');
    assert.deepEqual(evidence.observations.catalog.missing_expected, []);
    assert.ok(evidence.observations.catalog.unexpected_managed.includes('pc-intake'));
    assert.equal(evidence.effective_predicates.runtime_qualified, false);
    assert.equal(JSON.stringify(evidence).includes('sensitive stderr'), false);
    assert.equal(evidence.evidence.stdout_sha256.startsWith('sha256:'), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('record is confirmation-bound and status becomes stale when runtime config changes', () => {
  const home = fixtureHome();
  try {
    const runner = () => ({
      status: 0,
      stdout: codexPrompt(EXPECTED_CODEX, home),
      stderr: '',
    });
    const evidence = probeRuntime({ home, adapter: 'codex', runner });
    assert.equal(evidence.observations.catalog.policy_conformance, 'pass', JSON.stringify(evidence.observations.catalog));
    assert.throws(
      () => recordRuntimeEvidence({ home, evidence, confirmation: DIGEST }),
      (error) => error.code === 'confirmation_mismatch',
    );
    const recorded = recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id });
    assert.equal(recorded.status, 'RECORDED');
    let status = runtimeStatus({ home });
    assert.equal(status.adapters.codex.status, 'CATALOG_ONLY');
    assert.deepEqual(status.adapters.codex.catalog, evidence.observations.catalog);
    assert.deepEqual(status.adapters.codex.body_access, evidence.observations.body_access);
    assert.deepEqual(status.adapters.codex.route, evidence.observations.route);
    assert.deepEqual(status.adapters.codex.context, {
      description_truncated: evidence.observations.catalog.description_truncated,
      context_budget_pressure: evidence.observations.catalog.context_budget_pressure,
    });
    assert.deepEqual(status.adapters.codex.effective_predicates, evidence.effective_predicates);
    assert.equal(status.adapters.claude.status, 'UNVERIFIED');
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "changed"\n');
    status = runtimeStatus({ home });
    assert.equal(status.adapters.codex.status, 'STALE');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('same-name foreign identity is preserved as an unmatched entity and cannot satisfy policy', () => {
  const home = fixtureHome();
  try {
    writeSkill(join(home, '.agents', 'skills'), 'foreign');
    const prompt = JSON.parse(codexPrompt(EXPECTED_CODEX, home));
    prompt[0].content[0].text = prompt[0].content[0].text.replace(
      '</skills_instructions>',
      '- bs-insight-product: Foreign same-name entity (file: r1/foreign/SKILL.md)\n</skills_instructions>',
    );
    const evidence = probeRuntime({
      home, adapter: 'codex',
      runner: () => ({ status: 0, stdout: JSON.stringify(prompt), stderr: '' }),
    });
    assert.equal(evidence.observations.catalog.result, 'pass');
    assert.equal(evidence.observations.catalog.identity_conformance, 'fail');
    assert.equal(evidence.observations.catalog.policy_conformance, 'fail');
    assert.equal(evidence.observations.catalog.unmatched_managed_entities.length, 1);
    recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id });
    assert.equal(runtimeStatus({ home }).adapters.codex.status, 'POLICY_DRIFT');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('policy change makes a self-consistent historical record stale rather than invalid', () => {
  const home = fixtureHome();
  try {
    const policyPath = join(home, 'runtime-policy.json');
    writeFileSync(policyPath, readFileSync(DEFAULT_RUNTIME_POLICY));
    const evidence = probeRuntime({
      home, adapter: 'codex', policyPath,
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id, policyPath });
    const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
    policy.collections.prodcraft.codex.gateway = 'pc-intake';
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const status = runtimeStatus({ home, policyPath });
    assert.equal(status.adapters.codex.status, 'STALE');
    assert.match(status.adapters.codex.reason, /policy_changed/u);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('future-dated evidence is rejected as stale', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home, adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    evidence.observed_at = '2099-01-01T00:00:00.000Z';
    evidence.evidence_id = computeEvidenceId(evidence);
    assert.throws(
      () => recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id }),
      (error) => error.code === 'runtime_evidence_stale',
    );
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('a dead recorder lock is identity-quarantined and does not brick future evidence', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home, adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    const adapterRoot = join(home, 'Library', 'Application Support', 'skills-refiner', 'runtime-evidence', 'codex');
    mkdirSync(adapterRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(adapterRoot, '.record.lock'), `${JSON.stringify({
      schema_version: 'skills-refiner.runtime-record-lock.v1', adapter: 'codex',
      evidence_id: DIGEST, pid: 2147483647, created_at: '2026-08-28T00:00:00.000Z',
    })}\n`, { mode: 0o600 });
    const recorded = recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id });
    assert.equal(recorded.status, 'RECORDED');
    assert.equal(readdirSync(join(adapterRoot, 'stale-locks')).length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('record lock release preserves a raced replacement instead of unlinking by path', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home, adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    const lockPath = join(
      home, 'Library', 'Application Support', 'skills-refiner', 'runtime-evidence', 'codex', '.record.lock',
    );
    const foreign = 'foreign lock replacement\n';
    assert.throws(
      () => recordRuntimeEvidence({
        home,
        evidence,
        confirmation: evidence.evidence_id,
        beforeLockRelease: () => {
          rmSync(lockPath);
          writeFileSync(lockPath, foreign, { mode: 0o600, flag: 'wx' });
        },
      }),
      (error) => error.code === 'runtime_record_lock_release_conflict'
        && error.status === 'recovery_required',
    );
    assert.equal(readFileSync(lockPath, 'utf8'), foreign);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('record rejects a hardlinked immutable evidence object', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home, adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    const adapterRoot = join(home, 'Library', 'Application Support', 'skills-refiner', 'runtime-evidence', 'codex');
    mkdirSync(adapterRoot, { recursive: true, mode: 0o700 });
    const immutablePath = join(adapterRoot, `${evidence.evidence_id.slice('sha256:'.length)}.json`);
    writeFileSync(immutablePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    linkSync(immutablePath, join(adapterRoot, 'foreign-hardlink.json'));
    assert.throws(
      () => recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id }),
      (error) => error.code === 'evidence_identity_conflict',
    );
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('runtime status binds current evidence to a private immutable object', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home, adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    const recorded = recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id });
    linkSync(recorded.immutable_path, `${recorded.immutable_path}.foreign-link`);
    const status = runtimeStatus({ home });
    assert.equal(status.adapters.codex.status, 'INVALID');
    assert.equal(status.adapters.codex.reason, 'invalid_runtime_record');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('current evidence pointer publication is CAS-bound against replacement', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home, adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id });
    const pointerPath = join(
      home, 'Library', 'Application Support', 'skills-refiner', 'runtime-evidence', 'codex', 'current.json',
    );
    const foreign = 'foreign pointer replacement\n';
    assert.throws(
      () => recordRuntimeEvidence({
        home,
        evidence,
        confirmation: evidence.evidence_id,
        beforePointerPublish: () => {
          rmSync(pointerPath);
          writeFileSync(pointerPath, foreign, { mode: 0o600, flag: 'wx' });
        },
      }),
      (error) => error.code === 'runtime_record_pointer_conflict'
        && error.status === 'recovery_required',
    );
    assert.equal(readFileSync(pointerPath, 'utf8'), foreign);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('runtime status detects replacement of current evidence during fd snapshot', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home, adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id });
    const pointerPath = join(
      home, 'Library', 'Application Support', 'skills-refiner', 'runtime-evidence', 'codex', 'current.json',
    );
    const foreign = 'foreign status replacement\n';
    const status = runtimeStatus({
      home,
      recordSnapshotHook: ({ adapter }) => {
        if (adapter !== 'codex') return;
        rmSync(pointerPath);
        writeFileSync(pointerPath, foreign, { mode: 0o600, flag: 'wx' });
      },
    });
    assert.equal(status.adapters.codex.status, 'INVALID');
    assert.equal(status.adapters.codex.reason, 'invalid_runtime_record');
    assert.equal(readFileSync(pointerPath, 'utf8'), foreign);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('evidence digest covers observations and rejects mutation', () => {
  const home = fixtureHome();
  try {
    const runner = () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' });
    const evidence = probeRuntime({ home, adapter: 'codex', runner });
    const changed = structuredClone(evidence);
    changed.observations.catalog.result = 'fail';
    assert.notEqual(computeEvidenceId(changed), evidence.evidence_id);
    assert.throws(() => validateRuntimeEvidence(changed), /schema or digest/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('actual collection byte drift invalidates every adapter status even when INDEX is unchanged', () => {
  const home = fixtureHome();
  try {
    writeFileSync(join(home, '.agents', 'skills', 'prodcraft', 'pc-intake', 'SKILL.md'), '---\nname: pc-intake\ndescription: Drifted after deployment.\n---\n');
    const status = runtimeStatus({ home });
    assert.equal(status.adapters.codex.status, 'DEPLOYMENT_DRIFT');
    assert.equal(status.adapters.claude.status, 'DEPLOYMENT_DRIFT');
    assert.equal(status.adapters.cursor.status, 'DEPLOYMENT_DRIFT');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an unindexed Skill anywhere under a managed collection is deployment drift', () => {
  const home = fixtureHome();
  try {
    writeSkill(join(home, '.agents', 'skills', 'better-skills', 'docs', 'patterns'), 'rogue-extra');
    assert.throws(
      () => collectRuntimeBinding({ home, adapter: 'codex' }),
      (error) => ['collection_root_drift', 'collection_resource_drift'].includes(error.code),
    );
    const status = runtimeStatus({ home });
    assert.equal(status.adapters.codex.status, 'DEPLOYMENT_DRIFT');
    assert.equal(status.adapters.claude.status, 'DEPLOYMENT_DRIFT');
    assert.equal(status.adapters.cursor.status, 'DEPLOYMENT_DRIFT');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('historical host metadata remains valid evidence shape and becomes stale only during status comparison', () => {
  const home = fixtureHome();
  try {
    const runner = () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' });
    const evidence = probeRuntime({ home, adapter: 'codex', runner });
    evidence.probe.host_environment.os_release = 'historical-release';
    evidence.evidence_id = computeEvidenceId(evidence);
    assert.doesNotThrow(() => validateRuntimeEvidence(evidence));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Claude CLI version and native init build are distinct bindings', () => {
  const home = fixtureHome();
  try {
    const runner = () => ({
      status: 1,
      stdout: `${JSON.stringify({ type: 'system', subtype: 'init', skills: EXPECTED_CODEX, claude_code_version: '2.1.250' })}\n`,
      stderr: 'authentication_failed',
    });
    const evidence = probeRuntime({
      home,
      adapter: 'claude',
      runner,
      versionResolver: () => '2.1.250 (Claude Code)',
    });
    assert.equal(evidence.probe.adapter_version, '2.1.250 (Claude Code)');
    assert.equal(evidence.probe.runtime_build, '2.1.250');
    assert.equal(evidence.observations.catalog.identity_conformance, 'unverified');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('minimal self-hashed evidence cannot forge a catalog-only success', () => {
  const forged = {
    schema_version: 'skills-refiner.runtime-evidence.v1',
    evidence_id: null,
    observed_at: new Date().toISOString(),
    probe: { adapter_id: 'codex' },
    artifact_binding: { collections: [] },
    deployment_binding: {
      policy_digest: DIGEST,
      root_inventory_digest: DIGEST,
      collection_control_digest: DIGEST,
      runtime_config_digest: null,
    },
  };
  forged.evidence_id = computeEvidenceId(forged);
  assert.throws(() => validateRuntimeEvidence(forged), (error) => error.code === 'invalid_runtime_evidence');
});

test('runtime executable resolution binds one absolute identity and detects in-call replacement', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-runtime-executable-'));
  const executable = join(root, 'codex');
  try {
    writeFileSync(executable, '#!/bin/sh\nprintf "fixture-version\\n"\n', { mode: 0o700 });
    const identity = resolveRuntimeExecutable('codex', { env: { PATH: root } });
    assert.equal(identity.path, realpathSync(executable));
    assert.match(identity.content_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.match(identity.device, /^\d+$/u);
    assert.match(identity.inode, /^\d+$/u);
    const result = runRuntimeExecutable(identity, ['--version'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'fixture-version');

    assert.throws(
      () => runRuntimeExecutable(identity, ['debug'], { encoding: 'utf8' }, () => {
        writeFileSync(executable, '#!/bin/sh\nprintf "replacement\\n"\n', { mode: 0o700 });
        return { status: 0, stdout: '', stderr: '' };
      }),
      (error) => error.code === 'runtime_executable_changed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime probe uses and records one resolved executable identity', () => {
  const home = fixtureHome();
  const binRoot = join(home, '.runtime-bin');
  const executable = join(binRoot, 'codex');
  try {
    mkdirSync(binRoot, { recursive: true });
    writeFileSync(executable, '#!/bin/sh\nprintf "fixture-version\\n"\n', { mode: 0o700 });
    const identity = resolveRuntimeExecutable('codex', { env: { PATH: binRoot } });
    const invoked = [];
    const evidence = probeRuntime({
      home,
      adapter: 'codex',
      executableResolver: () => identity,
      runner: (command, args) => {
        invoked.push({ command, args });
        return { status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' };
      },
    });
    assert.deepEqual(evidence.probe.executable_identity, identity);
    assert.equal(evidence.probe.adapter_version, 'fixture-version');
    assert.deepEqual(invoked, [{
      command: identity.path,
      args: ['debug', 'prompt-input', 'Runtime catalog probe. Do not execute tools.'],
    }]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('record and status revalidate the exact probed executable identity', () => {
  const home = fixtureHome();
  const binRoot = join(home, '.runtime-bin');
  const executable = join(binRoot, 'codex');
  try {
    mkdirSync(binRoot, { recursive: true });
    writeFileSync(executable, '#!/bin/sh\nprintf "fixture-version\\n"\n', { mode: 0o700 });
    const identity = resolveRuntimeExecutable('codex', { env: { PATH: binRoot } });
    const executableResolver = () => identity;
    const evidence = probeRuntime({
      home,
      adapter: 'codex',
      executableResolver,
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    assert.equal(recordRuntimeEvidence({
      home, evidence, confirmation: evidence.evidence_id, executableResolver,
    }).status, 'RECORDED');

    writeFileSync(executable, '#!/bin/sh\nprintf "replacement-version\\n"\n', { mode: 0o700 });
    const status = runtimeStatus({
      home,
      executableResolver: (adapter) => resolveRuntimeExecutable(
        adapter === 'codex' ? 'codex' : adapter === 'claude' ? 'claude' : 'cursor-agent',
        { env: { PATH: binRoot } },
      ),
    });
    assert.equal(status.adapters.codex.status, 'STALE');
    assert.match(status.adapters.codex.reason, /executable_changed/u);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('Codex profile candidate validation runs version and prompt against one identity', () => {
  const home = fixtureHome();
  const binRoot = join(home, '.runtime-bin');
  const executable = join(binRoot, 'codex');
  try {
    mkdirSync(binRoot, { recursive: true });
    writeFileSync(executable, '#!/bin/sh\nprintf "fixture-version\\n"\n', { mode: 0o700 });
    const identity = resolveRuntimeExecutable('codex', { env: { PATH: binRoot } });
    const invoked = [];
    const result = validateCodexCandidate({
      home,
      configBytes: '',
      binding: collectRuntimeBinding({ home, adapter: 'codex' }),
      disabledPaths: [],
      executableResolver: () => identity,
      runner: (command, args) => {
        invoked.push({ command, args });
        if (args[0] === '--strict-config') return { status: 0, stdout: 'fixture-version\n', stderr: '' };
        return { status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' };
      },
    });
    assert.equal(result.status, 'pass');
    assert.deepEqual(result.codex_executable_identity, identity);
    assert.deepEqual(invoked.map(({ command }) => command), [identity.path, identity.path]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('runtime evidence exact schema rejects root and nested raw transcript fields', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home,
      adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    for (const mutate of [
      (value) => { value.raw_prompt = 'secret prompt transcript'; },
      (value) => { value.evidence.stdout_raw = 'secret stdout transcript'; },
      (value) => { value.probe.host_environment.raw_environment = 'secret'; },
    ]) {
      const forged = structuredClone(evidence);
      mutate(forged);
      forged.evidence_id = computeEvidenceId(forged);
      assert.throws(
        () => validateRuntimeEvidence(forged),
        (error) => error.code === 'invalid_runtime_evidence',
      );
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('runtime evidence rejects contradictory predicates and unbounded free text', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home,
      adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    const contradictory = structuredClone(evidence);
    contradictory.observations.body_access.result = 'pass';
    contradictory.evidence_id = computeEvidenceId(contradictory);
    assert.throws(
      () => validateRuntimeEvidence(contradictory),
      (error) => error.code === 'invalid_runtime_evidence',
    );

    const unbounded = structuredClone(evidence);
    unbounded.limitations = ['x'.repeat(5000)];
    unbounded.evidence_id = computeEvidenceId(unbounded);
    assert.throws(
      () => validateRuntimeEvidence(unbounded),
      (error) => error.code === 'invalid_runtime_evidence',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('record rejects self-hashed deployment metadata that is not the observed binding', () => {
  const home = fixtureHome();
  try {
    const evidence = probeRuntime({
      home,
      adapter: 'codex',
      runner: () => ({ status: 0, stdout: codexPrompt(EXPECTED_CODEX, home), stderr: '' }),
    });
    evidence.deployment_binding.policy_path = join(home, 'forged-runtime-policy.json');
    evidence.evidence_id = computeEvidenceId(evidence);
    assert.throws(
      () => recordRuntimeEvidence({ home, evidence, confirmation: evidence.evidence_id }),
      (error) => error.code === 'runtime_evidence_stale',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
