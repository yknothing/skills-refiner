import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { makeLegacyHome, makeRoot, makeSource, removeRoot, sourceRevision } from './prodcraft-collection-fixtures.mjs';
import { makeManagedHome, makeManagedRoot, makeManagedSource, managedRevision, removeManagedRoot } from './managed-collection-fixtures.mjs';

const launcher = fileURLToPath(new URL('../bin/skills-refiner', import.meta.url));

function run(home, args) {
  const result = spawnSync(launcher, args, {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, SKILLS_REFINER_NODE_BIN: process.execPath },
  });
  let response;
  try { response = JSON.parse(result.stdout); } catch { response = null; }
  return { ...result, response };
}

test('collection CLI checks, plans, applies, statuses, and undoes one JSON contract per call', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const source = makeSource(root);
  const { home } = makeLegacyHome(root);
  const revision = sourceRevision(source);
  const planPath = join(root, 'plan.json');

  const checked = run(home, ['collection', 'check', 'prodcraft', '--source', source, '--revision', revision, '--json']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.response.status, 'STRUCTURALLY_VALID');
  assert.equal(checked.response.source.members.length, 40);

  const planned = run(home, ['collection', 'plan', 'prodcraft', '--source', source, '--revision', revision, '--output', planPath, '--json']);
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(planned.response.schema_version, 'skills-refiner.collection.plan.v2');
  assert.equal(JSON.parse(readFileSync(planPath, 'utf8')).plan_hash, planned.response.plan_hash);

  const rejected = run(home, ['collection', 'apply', '--plan', planPath, '--confirm', 'wrong', '--json']);
  assert.equal(rejected.status, 10);
  assert.equal(rejected.response.error_code, 'confirmation_mismatch');

  const applied = run(home, ['collection', 'apply', '--plan', planPath, '--confirm', planned.response.plan_hash, '--json']);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.equal(applied.response.status, 'FILESYSTEM_READY');

  const status = run(home, ['collection', 'status', 'prodcraft', '--fresh', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.response.status, 'FILESYSTEM_READY');

  const undone = run(home, ['collection', 'undo', applied.response.operation_id, '--confirm', applied.response.operation_id, '--json']);
  assert.equal(undone.status, 0, undone.stdout + undone.stderr);
  assert.equal(undone.response.status, 'RESTORED');
});

test('collection CLI rejects malformed invocations with exit 2', (t) => {
  const root = makeRoot();
  t.after(() => removeRoot(root));
  const { home } = makeLegacyHome(root);
  const result = run(home, ['collection', 'plan', 'wrong', '--json']);
  assert.equal(result.status, 2);
  assert.equal(result.response.status, 'invalid');
});

test('collection CLI dispatches managed collections and management-center list', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  const { home } = makeManagedHome(root, 'better-skills');
  const revision = managedRevision(source);
  const planPath = join(root, 'managed-plan.json');

  const checked = run(home, ['collection', 'check', 'better-skills', '--source', source, '--revision', revision, '--json']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.response.source.members.length, 13);

  const planned = run(home, ['collection', 'plan', 'better-skills', '--source', source, '--revision', revision, '--output', planPath, '--json']);
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(planned.response.schema_version, 'skills-refiner.managed-collection.plan.v5');

  const applied = run(home, ['collection', 'apply', '--plan', planPath, '--confirm', planned.response.plan_hash, '--json']);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const listed = run(home, ['collection', 'list', '--fresh', '--json']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(listed.response.collections.map(({ collection_id }) => collection_id), ['prodcraft', 'better-skills', 'langcraft', 'loopos']);
  assert.equal(listed.response.collections.find(({ collection_id }) => collection_id === 'better-skills').status, 'FILESYSTEM_READY');

  const undone = run(home, ['collection', 'undo', applied.response.operation_id, '--confirm', applied.response.operation_id, '--json']);
  assert.equal(undone.status, 0, undone.stdout + undone.stderr);
});

test('malformed managed plan is an input error with exit 2', (t) => {
  const root = makeManagedRoot();
  t.after(() => removeManagedRoot(root));
  const source = makeManagedSource(root, 'better-skills');
  const { home } = makeManagedHome(root, 'better-skills');
  const planPath = join(root, 'malformed-plan.json');
  const planned = run(home, ['collection', 'plan', 'better-skills', '--source', source, '--revision', managedRevision(source), '--output', planPath, '--json']);
  assert.equal(planned.status, 0, planned.stderr);
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  plan.unexpected = true;
  const malformedPath = join(root, 'malformed-input.json');
  writeFileSync(malformedPath, `${JSON.stringify(plan, null, 2)}\n`);
  const result = run(home, ['collection', 'apply', '--plan', malformedPath, '--confirm', plan.plan_hash, '--json']);
  assert.equal(result.status, 2);
  assert.equal(result.response.status, 'invalid');
});
