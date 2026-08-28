import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exitCodeForRuntimeResult, runRuntimeCli } from '../lib/runtime-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, '..', 'bin', 'skills-refiner');

function evidence(probeOutcome, policyConformance, schemaVersion = 'skills-refiner.runtime-evidence.v2') {
  return {
    schema_version: schemaVersion,
    observations: { catalog: { probe_outcome: probeOutcome, policy_conformance: policyConformance } },
    effective_predicates: { runtime_qualified: false },
  };
}

test('runtime CLI exit codes never treat catalog-only observation as runtime qualification', () => {
  assert.equal(exitCodeForRuntimeResult(evidence('pass', 'pass')), 10);
  assert.equal(exitCodeForRuntimeResult(evidence('pass', 'fail')), 10);
  assert.equal(exitCodeForRuntimeResult(evidence('blocked', 'blocked')), 10);
  assert.equal(exitCodeForRuntimeResult(evidence('unsupported', 'unsupported')), 3);
  assert.equal(exitCodeForRuntimeResult(evidence(
    'blocked', 'blocked', 'skills-refiner.runtime-evidence.v1',
  )), 10);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-status.v1',
    adapters: { codex: { status: 'CATALOG_ONLY' }, claude: { status: 'CATALOG_ONLY' } },
  }), 10);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-status.v1',
    adapters: { codex: { status: 'QUALIFIED' }, claude: { status: 'QUALIFIED' } },
  }), 0);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.status.v1', status: 'DRIFT',
  }), 10);
  assert.equal(exitCodeForRuntimeResult({ schema_version: 'unknown' }), 2);
});

test('runtime profile lifecycle actions use success and fail-closed exit codes', () => {
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.plan.v1',
  }), 0);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.apply.v1',
    status: 'DEPLOYMENT_READY',
  }), 0);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.apply.v1',
    status: 'UNVERIFIED',
  }), 10);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.undo.v1',
    status: 'RESTORED_PRESTATE',
  }), 0);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.undo.v1',
    status: 'RECOVERY_REQUIRED',
  }), 10);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.recover.v1',
    status: 'RESTORED_PRESTATE',
  }), 0);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.recover.v1',
    status: 'DEPLOYMENT_READY',
  }), 0);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-profile.recover.v1',
    status: 'UNKNOWN',
  }), 10);
});

test('recorded catalog-only evidence exits 10 instead of masquerading as usage failure', () => {
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-record.v1',
    status: 'RECORDED',
  }), 10);
  assert.equal(exitCodeForRuntimeResult({
    schema_version: 'skills-refiner.runtime-record.v1',
    status: 'UNKNOWN',
  }), 10);
});

test('invalid runtime invocation returns the runtime error contract and exit 2', () => {
  const result = runRuntimeCli(['runtime', 'unknown']);
  assert.equal(result.exit_code, 2);
  assert.equal(result.result.schema_version, 'skills-refiner.runtime-error.v1');
  assert.equal(result.result.error_code, 'invalid_invocation');
});

test('Node bootstrap failure uses the runtime error schema', () => {
  const result = spawnSync('bash', [LAUNCHER, 'runtime', 'status', '--json'], {
    encoding: 'utf8', env: { ...process.env, SKILLS_REFINER_NODE_BIN: '/bin/false' },
  });
  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema_version, 'skills-refiner.runtime-error.v1');
  assert.equal(payload.error_code, 'node_runtime_unavailable');
});
