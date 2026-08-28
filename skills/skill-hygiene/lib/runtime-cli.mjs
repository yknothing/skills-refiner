import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { probeRuntime } from './runtime-adapters.mjs';
import { MacosAdapterError } from './cleanup-macos.mjs';
import {
  DEFAULT_RUNTIME_POLICY, RuntimeEvidenceError, recordRuntimeEvidence, runtimeStatus,
} from './runtime-evidence.mjs';
import {
  applyRuntimeProfilePlan, compileRuntimeProfilePlan, recoverRuntimeProfile, RuntimeProfileError,
  statusRuntimeProfile, undoRuntimeProfile, validateRuntimeProfilePlan,
} from './runtime-profile.mjs';

class InvocationError extends Error {
  constructor(message) { super(message); this.code = 'invalid_invocation'; this.status = 'invalid'; }
}

function invalid(message = 'invalid runtime invocation') { throw new InvocationError(message); }

function parseOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--json' || token === '--fresh') {
      if (!allowed.has(token) || Object.hasOwn(options, token)) invalid(`unsupported or duplicate option: ${token}`);
      options[token] = true;
      continue;
    }
    if (!allowed.has(token) || !token.startsWith('--') || Object.hasOwn(options, token)) invalid(`unsupported or duplicate option: ${token}`);
    index += 1;
    if (index >= args.length || args[index].startsWith('--')) invalid(`missing value for ${token}`);
    options[token] = args[index];
  }
  return options;
}

function required(options, key) {
  if (typeof options[key] !== 'string' || options[key].length === 0) invalid(`${key} is required`);
  return options[key];
}

function writeExclusiveJson(path, value) {
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

function freshRuntimeStatus(home, policyPath) {
  const adapters = {};
  for (const adapter of ['codex', 'claude', 'cursor']) {
    try { adapters[adapter] = probeRuntime({ home, adapter, policyPath }); } catch (error) {
      adapters[adapter] = errorPayload(error);
    }
  }
  return { schema_version: 'skills-refiner.runtime-fresh-status.v1', profile_id: 'default', adapters };
}

export function exitCodeForRuntimeResult(value) {
  if (['skills-refiner.runtime-evidence.v1', 'skills-refiner.runtime-evidence.v2']
    .includes(value?.schema_version)) {
    if (value.observations?.catalog?.probe_outcome === 'unsupported') return 3;
    return value.effective_predicates?.runtime_qualified === true ? 0 : 10;
  }
  if (value?.schema_version === 'skills-refiner.runtime-fresh-status.v1') {
    const codes = Object.values(value.adapters ?? {}).map(exitCodeForRuntimeResult);
    return codes.includes(20) ? 20 : codes.includes(10) ? 10 : codes.includes(3) ? 3 : 0;
  }
  if (value?.schema_version === 'skills-refiner.runtime-status.v1') {
    const states = Object.values(value.adapters ?? {}).map(({ status }) => status);
    if (states.length > 0 && states.every((status) => status === 'UNSUPPORTED')) return 3;
    return states.length > 0 && states.every((status) => status === 'QUALIFIED') ? 0 : 10;
  }
  if (value?.schema_version === 'skills-refiner.runtime-profile.status.v1') {
    return value.status === 'DEPLOYMENT_READY' ? 0 : 10;
  }
  if (value?.schema_version === 'skills-refiner.runtime-profile.plan.v1') return 0;
  if (value?.schema_version === 'skills-refiner.runtime-profile.apply.v1') {
    return value.status === 'DEPLOYMENT_READY' ? 0 : 10;
  }
  if (value?.schema_version === 'skills-refiner.runtime-profile.undo.v1') {
    return value.status === 'RESTORED_PRESTATE' ? 0 : 10;
  }
  if (value?.schema_version === 'skills-refiner.runtime-profile.recover.v1') {
    return ['RESTORED_PRESTATE', 'DEPLOYMENT_READY'].includes(value.status) ? 0 : 10;
  }
  if (value?.schema_version === 'skills-refiner.runtime-record.v1') return 10;
  if (value?.schema_version === 'skills-refiner.runtime-error.v1') {
    return value.status === 'invalid' ? 2 : value.status === 'unsupported' ? 3
      : value.status === 'recovery_required' ? 20 : 10;
  }
  return 2;
}

function execute(argv) {
  if (argv[0] !== 'runtime') invalid();
  const command = argv[1];
  const home = resolve(process.env.HOME ?? invalid('HOME is required'));
  if (command === 'probe') {
    const options = parseOptions(argv.slice(2), new Set(['--adapter', '--policy', '--context-events', '--output', '--json']));
    const evidence = probeRuntime({
      home,
      adapter: required(options, '--adapter'),
      policyPath: options['--policy'] ? resolve(options['--policy']) : DEFAULT_RUNTIME_POLICY,
      contextEventsPath: options['--context-events'] ? resolve(options['--context-events']) : null,
    });
    if (options['--output']) writeExclusiveJson(options['--output'], evidence);
    return evidence;
  }
  if (command === 'record') {
    const options = parseOptions(argv.slice(2), new Set(['--evidence', '--confirm', '--policy', '--json']));
    let evidence;
    try { evidence = JSON.parse(readFileSync(resolve(required(options, '--evidence')), 'utf8')); } catch (error) { invalid(`cannot read evidence: ${error.message}`); }
    return recordRuntimeEvidence({
      home,
      evidence,
      confirmation: required(options, '--confirm'),
      policyPath: options['--policy'] ? resolve(options['--policy']) : DEFAULT_RUNTIME_POLICY,
    });
  }
  if (command === 'status') {
    const options = parseOptions(argv.slice(2), new Set(['--fresh', '--policy', '--json']));
    const policyPath = options['--policy'] ? resolve(options['--policy']) : DEFAULT_RUNTIME_POLICY;
    return options['--fresh'] ? freshRuntimeStatus(home, policyPath) : runtimeStatus({ home, policyPath });
  }
  if (command === 'profile') {
    const action = argv[2];
    if (action === 'plan') {
      const options = parseOptions(argv.slice(3), new Set(['--policy', '--output', '--json']));
      const plan = compileRuntimeProfilePlan({
        home,
        policyPath: options['--policy'] ? resolve(options['--policy']) : DEFAULT_RUNTIME_POLICY,
      });
      if (options['--output']) writeExclusiveJson(options['--output'], plan);
      return plan;
    }
    if (action === 'apply') {
      const options = parseOptions(argv.slice(3), new Set(['--plan', '--confirm', '--json']));
      let plan;
      try { plan = JSON.parse(readFileSync(resolve(required(options, '--plan')), 'utf8')); } catch (error) { invalid(`cannot read plan: ${error.message}`); }
      validateRuntimeProfilePlan(plan);
      if (plan.home !== home) invalid('plan HOME does not match process HOME');
      return applyRuntimeProfilePlan(plan, required(options, '--confirm'));
    }
    if (action === 'status') {
      const options = parseOptions(argv.slice(3), new Set(['--policy', '--json']));
      return statusRuntimeProfile({ home, policyPath: options['--policy'] ? resolve(options['--policy']) : DEFAULT_RUNTIME_POLICY });
    }
    if (action === 'undo' || action === 'recover') {
      const id = argv[3];
      if (typeof id !== 'string' || id.startsWith('--')) invalid('operation id is required');
      const options = parseOptions(argv.slice(4), new Set(['--confirm', '--json']));
      const input = { home, operationId: id, confirmation: required(options, '--confirm') };
      return action === 'undo' ? undoRuntimeProfile(input) : recoverRuntimeProfile(input);
    }
    invalid('invalid runtime profile invocation');
  }
  invalid();
}

function errorPayload(error) {
  const known = error instanceof InvocationError || error instanceof RuntimeEvidenceError
    || error instanceof RuntimeProfileError || error instanceof MacosAdapterError;
  const status = error instanceof MacosAdapterError
    ? error.code === 'recovery_required' || error.mutationMayHaveOccurred ? 'recovery_required' : 'blocked'
    : known ? error.status : 'recovery_required';
  return {
    schema_version: 'skills-refiner.runtime-error.v1',
    status,
    error_code: error instanceof MacosAdapterError ? error.reason : known ? error.code : 'unexpected_error',
    diagnostic: known ? error.message : 'unexpected runtime failure',
    mutation_occurred: error instanceof MacosAdapterError ? error.mutationMayHaveOccurred : status === 'recovery_required',
  };
}

export function runRuntimeCli(argv = process.argv.slice(2)) {
  try {
    const result = execute(argv);
    return { result, exit_code: exitCodeForRuntimeResult(result) };
  } catch (error) {
    const result = errorPayload(error);
    return { result, exit_code: exitCodeForRuntimeResult(result) };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outcome = runRuntimeCli();
  process.stdout.write(`${JSON.stringify(outcome.result)}\n`);
  process.exitCode = outcome.exit_code;
}
