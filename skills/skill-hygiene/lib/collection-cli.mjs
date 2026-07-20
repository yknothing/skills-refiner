import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CollectionContractError, validateCollectionPlan } from './collection-contract.mjs';
import {
  applyProdcraftPlan,
  compileProdcraftPlan,
  inspectProdcraftSource,
  ProdcraftCollectionError,
  recoverProdcraftOperation,
  repairProdcraftCollection,
  statusProdcraftCollection,
  undoProdcraftOperation,
} from './prodcraft-collection.mjs';

class InvocationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvocationError';
    this.code = 'invalid_invocation';
    this.status = 'invalid';
  }
}

function invalid(message = 'invalid collection invocation') {
  throw new InvocationError(message);
}

function parseOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--json' || token === '--fresh') {
      if (!allowed.has(token) || Object.hasOwn(options, token)) invalid(`unsupported or duplicate option: ${token}`);
      options[token] = true;
      continue;
    }
    if (!token.startsWith('--') || !allowed.has(token) || Object.hasOwn(options, token)) invalid(`unsupported or duplicate option: ${token}`);
    index += 1;
    if (index >= args.length || args[index].startsWith('--')) invalid(`missing value for ${token}`);
    options[token] = args[index];
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) invalid(`${name} is required`);
  return value;
}

function loadPlan(path) {
  let value;
  try { value = JSON.parse(readFileSync(resolve(path), 'utf8')); } catch (error) { invalid(`cannot read plan: ${error.message}`); }
  validateCollectionPlan(value);
  return value;
}

function execute(argv) {
  if (argv[0] !== 'collection') invalid();
  const command = argv[1];
  const home = resolve(process.env.HOME ?? invalid('HOME is required'));
  if (command === 'check') {
    if (argv[2] !== 'prodcraft') invalid();
    const options = parseOptions(argv.slice(3), new Set(['--source', '--revision', '--json']));
    const source = inspectProdcraftSource({ sourceRoot: realpathSync(resolve(required(options, '--source'))), revision: required(options, '--revision') });
    return { schema_version: 'skills-refiner.collection.check.v1', collection_id: 'prodcraft', status: 'STRUCTURALLY_VALID', runtime_status: 'UNVERIFIED', source };
  }
  if (command === 'plan') {
    if (argv[2] !== 'prodcraft') invalid();
    const options = parseOptions(argv.slice(3), new Set(['--source', '--revision', '--output', '--json']));
    const plan = compileProdcraftPlan({ home, sourceRoot: realpathSync(resolve(required(options, '--source'))), revision: required(options, '--revision') });
    if (options['--output']) writeFileSync(resolve(options['--output']), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return plan;
  }
  if (command === 'apply') {
    const options = parseOptions(argv.slice(2), new Set(['--plan', '--confirm', '--json']));
    const plan = loadPlan(required(options, '--plan'));
    if (plan.home !== home) invalid('plan HOME does not match process HOME');
    const killPhase = process.env.SKILLS_REFINER_TEST_ALLOW_FAULTS === '1'
      ? process.env.SKILLS_REFINER_TEST_KILL_PHASE ?? null
      : null;
    return applyProdcraftPlan(plan, required(options, '--confirm'), { killPhase });
  }
  if (command === 'status') {
    if (argv[2] !== 'prodcraft') invalid();
    parseOptions(argv.slice(3), new Set(['--fresh', '--json']));
    return statusProdcraftCollection({ home });
  }
  if (command === 'repair') {
    if (argv[2] !== 'prodcraft') invalid();
    const options = parseOptions(argv.slice(3), new Set(['--confirm', '--json']));
    return repairProdcraftCollection({ home, confirmation: required(options, '--confirm') });
  }
  if (command === 'undo') {
    const id = argv[2];
    if (typeof id !== 'string' || id.startsWith('--')) invalid('operation id is required');
    const options = parseOptions(argv.slice(3), new Set(['--confirm', '--json']));
    return undoProdcraftOperation({ home, operationId: id, confirmation: required(options, '--confirm') });
  }
  if (command === 'recover') {
    const id = argv[2];
    if (typeof id !== 'string' || id.startsWith('--')) invalid('operation id is required');
    const options = parseOptions(argv.slice(3), new Set(['--confirm', '--json']));
    return recoverProdcraftOperation({ home, operationId: id, confirmation: required(options, '--confirm') });
  }
  invalid();
}

function errorPayload(error) {
  const contract = error instanceof CollectionContractError;
  const known = error instanceof ProdcraftCollectionError || error instanceof InvocationError || contract;
  const status = contract ? 'invalid' : known ? error.status : 'recovery_required';
  return {
    schema_version: 'skills-refiner.collection.error.v1',
    status,
    error_code: contract ? 'invalid_plan' : known ? error.code : 'unexpected_error',
    mutation_occurred: !contract && status === 'recovery_required',
    diagnostic: error.message,
  };
}

try {
  process.stdout.write(`${JSON.stringify(execute(process.argv.slice(2)))}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify(errorPayload(error))}\n`);
  if (!(process.argv.slice(2).includes('--json'))) process.stderr.write(`[ERROR] ${error.message}\n`);
  process.exitCode = error instanceof InvocationError || error instanceof CollectionContractError ? 2
    : error instanceof ProdcraftCollectionError && error.status !== 'recovery_required' ? 10
      : 20;
}
