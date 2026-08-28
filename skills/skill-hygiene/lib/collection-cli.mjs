import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { COLLECTION_SCHEMAS, CollectionContractError, validateCollectionPlan } from './collection-contract.mjs';
import { MANAGED_COLLECTION_SCHEMAS, ManagedCollectionContractError, validateManagedPlan } from './managed-collection-contract.mjs';
import { managedCollectionIds } from './collection-specs.mjs';
import {
  applyManagedPlan,
  compileManagedPlan,
  inspectManagedSource,
  listManagedCollections,
  ManagedCollectionError,
  recoverManagedOperation,
  repairManagedCollection,
  statusManagedCollection,
  undoManagedOperation,
} from './managed-collection.mjs';
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
  if ([COLLECTION_SCHEMAS.plan, COLLECTION_SCHEMAS.priorPlan].includes(value.schema_version)) validateCollectionPlan(value);
  else if ([
    MANAGED_COLLECTION_SCHEMAS.plan, MANAGED_COLLECTION_SCHEMAS.priorPlan,
    MANAGED_COLLECTION_SCHEMAS.olderPlan, MANAGED_COLLECTION_SCHEMAS.legacyPlan,
  ].includes(value.schema_version)) validateManagedPlan(value);
  else invalid('unsupported plan schema');
  return value;
}

function execute(argv) {
  if (argv[0] !== 'collection') invalid();
  const command = argv[1];
  const home = resolve(process.env.HOME ?? invalid('HOME is required'));
  if (command === 'list') {
    parseOptions(argv.slice(2), new Set(['--fresh', '--json']));
    const listed = listManagedCollections({ home });
    return { ...listed, collections: [statusProdcraftCollection({ home }), ...listed.collections] };
  }
  if (command === 'check') {
    if (argv[2] !== 'prodcraft' && !managedCollectionIds().includes(argv[2])) invalid();
    const options = parseOptions(argv.slice(3), new Set(['--source', '--revision', '--json']));
    const source = argv[2] === 'prodcraft'
      ? inspectProdcraftSource({ sourceRoot: realpathSync(resolve(required(options, '--source'))), revision: required(options, '--revision') })
      : inspectManagedSource({ collectionId: argv[2], sourceRoot: realpathSync(resolve(required(options, '--source'))), revision: required(options, '--revision') });
    return { schema_version: argv[2] === 'prodcraft' ? 'skills-refiner.collection.check.v1' : 'skills-refiner.collection.check.v2', collection_id: argv[2], status: 'STRUCTURALLY_VALID', runtime_status: 'UNVERIFIED', source };
  }
  if (command === 'plan') {
    if (argv[2] !== 'prodcraft' && !managedCollectionIds().includes(argv[2])) invalid();
    const options = parseOptions(argv.slice(3), new Set(['--source', '--revision', '--output', '--json']));
    const plan = argv[2] === 'prodcraft'
      ? compileProdcraftPlan({ home, sourceRoot: realpathSync(resolve(required(options, '--source'))), revision: required(options, '--revision') })
      : compileManagedPlan({ collectionId: argv[2], home, sourceRoot: realpathSync(resolve(required(options, '--source'))), revision: required(options, '--revision') });
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
    return [COLLECTION_SCHEMAS.plan, COLLECTION_SCHEMAS.priorPlan].includes(plan.schema_version)
      ? applyProdcraftPlan(plan, required(options, '--confirm'), { killPhase })
      : applyManagedPlan(plan, required(options, '--confirm'), { killPhase });
  }
  if (command === 'status') {
    if (argv[2] !== 'prodcraft' && !managedCollectionIds().includes(argv[2])) invalid();
    parseOptions(argv.slice(3), new Set(['--fresh', '--json']));
    return argv[2] === 'prodcraft' ? statusProdcraftCollection({ home }) : statusManagedCollection({ collectionId: argv[2], home });
  }
  if (command === 'repair') {
    if (argv[2] !== 'prodcraft' && !managedCollectionIds().includes(argv[2])) invalid();
    const options = parseOptions(argv.slice(3), new Set(['--confirm', '--json']));
    return argv[2] === 'prodcraft'
      ? repairProdcraftCollection({ home, confirmation: required(options, '--confirm') })
      : repairManagedCollection({ collectionId: argv[2], home, confirmation: required(options, '--confirm') });
  }
  if (command === 'undo') {
    const id = argv[2];
    if (typeof id !== 'string' || id.startsWith('--')) invalid('operation id is required');
    const options = parseOptions(argv.slice(3), new Set(['--confirm', '--json']));
    return id.startsWith('prodcraft-')
      ? undoProdcraftOperation({ home, operationId: id, confirmation: required(options, '--confirm') })
      : undoManagedOperation({ home, operationId: id, confirmation: required(options, '--confirm') });
  }
  if (command === 'recover') {
    const id = argv[2];
    if (typeof id !== 'string' || id.startsWith('--')) invalid('operation id is required');
    const options = parseOptions(argv.slice(3), new Set(['--confirm', '--json']));
    return id.startsWith('prodcraft-')
      ? recoverProdcraftOperation({ home, operationId: id, confirmation: required(options, '--confirm') })
      : recoverManagedOperation({ home, operationId: id, confirmation: required(options, '--confirm') });
  }
  invalid();
}

function errorPayload(error) {
  const contract = error instanceof CollectionContractError || error instanceof ManagedCollectionContractError;
  const known = error instanceof ProdcraftCollectionError || error instanceof ManagedCollectionError || error instanceof InvocationError || contract;
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
  process.exitCode = error instanceof InvocationError || error instanceof CollectionContractError || error instanceof ManagedCollectionContractError ? 2
    : (error instanceof ProdcraftCollectionError || error instanceof ManagedCollectionError) && error.status !== 'recovery_required' ? 10
      : 20;
}
