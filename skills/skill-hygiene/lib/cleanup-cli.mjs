import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ContractError, SCHEMAS, validatePlan } from './cleanup-contract.mjs';
import { CleanupCoreError, compilePlan, compileReview } from './cleanup-core.mjs';

const SCANNER_PATH = fileURLToPath(new URL('../bin/skill-scan.sh', import.meta.url));
const JSON_REQUESTED = process.argv.slice(2).includes('--json');

class CliError extends Error {
  constructor(errorCode, exitCode, overallStatus, diagnostic) {
    super(diagnostic);
    this.name = 'CliError';
    this.errorCode = errorCode;
    this.exitCode = exitCode;
    this.overallStatus = overallStatus;
    this.diagnostic = diagnostic;
  }
}

function invalid(errorCode = 'invalid_invocation', diagnostic = '[ERROR] Invalid cleanup invocation.') {
  throw new CliError(errorCode, 2, 'invalid', diagnostic);
}

function unsupported(errorCode, diagnostic) {
  throw new CliError(errorCode, 3, 'unsupported', diagnostic);
}

function blocked(errorCode, overallStatus, diagnostic) {
  throw new CliError(errorCode, 10, overallStatus, diagnostic);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    invalid('invalid_document', '[ERROR] Cleanup input is not valid JSON.');
  }
}

function readJsonFile(path) {
  if (typeof path !== 'string' || path.length === 0) invalid();
  try {
    return parseJson(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof CliError) throw error;
    invalid('invalid_document', '[ERROR] Cleanup input could not be read.');
  }
}

function validateScan(scan) {
  if (!scan || typeof scan !== 'object' || Array.isArray(scan)) {
    invalid('invalid_schema', '[ERROR] Expected a skill-scan.v5 document.');
  }
  if (scan.metadata?.schema_version !== 'skill-scan.v5' || !Array.isArray(scan.entries)) {
    invalid('invalid_schema', '[ERROR] Expected a skill-scan.v5 document.');
  }
  return scan;
}

function runInstalledScanner() {
  const bash = process.platform === 'win32' ? 'bash' : '/bin/bash';
  const result = spawnSync(bash, [SCANNER_PATH, '--json'], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    unsupported('scanner_unavailable', '[ERROR] The installed skill scanner could not run.');
  }
  return validateScan(parseJson(result.stdout));
}

function parseNamedFileOption(args, option) {
  const index = args.indexOf(option);
  if (index === -1) return null;
  if (index + 1 >= args.length || args[index + 1].startsWith('--')) invalid();
  if (args.indexOf(option, index + 1) !== -1) invalid();
  return args[index + 1];
}

function rejectUnknownOptions(args, allowed) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') continue;
    if (allowed.has(argument)) {
      index += 1;
      continue;
    }
    invalid();
  }
}

function runReview(args) {
  rejectUnknownOptions(args, new Set(['--scan']));
  const scanPath = parseNamedFileOption(args, '--scan');
  if (scanPath) {
    return compileReview(validateScan(readJsonFile(scanPath)), {
      executionEligible: false,
      source: 'offline_scan',
    });
  }
  return compileReview(runInstalledScanner(), { executionEligible: true, source: 'live_scan' });
}

async function runPlan(args) {
  rejectUnknownOptions(args, new Set(['--review', '--decisions']));
  const reviewPath = parseNamedFileOption(args, '--review');
  const decisionsPath = parseNamedFileOption(args, '--decisions');
  if (!reviewPath || !decisionsPath) invalid();

  const savedReview = readJsonFile(reviewPath);
  const decisions = readJsonFile(decisionsPath);
  const freshReview = compileReview(runInstalledScanner(), {
    executionEligible: true,
    source: 'live_scan',
  });
  if (savedReview?.schema_version !== SCHEMAS.review
      || savedReview.review_fingerprint !== freshReview.review_fingerprint) {
    blocked(
      'fingerprint_mismatch',
      'drifted',
      '[ERROR] The live skill state changed after review.',
    );
  }

  return compilePlan({ review: freshReview, decisions }, {
    name: process.platform === 'darwin' ? 'macos' : process.platform,
    async inspectForPlan() {
      unsupported(
        'platform_adapter_unavailable',
        '[ERROR] No certified mutation adapter is available yet.',
      );
    },
  });
}

function runApply(args) {
  rejectUnknownOptions(args, new Set(['--plan', '--confirm']));
  const planPath = parseNamedFileOption(args, '--plan');
  if (!planPath) invalid();
  const plan = readJsonFile(planPath);
  try {
    validatePlan(plan);
  } catch (error) {
    if (error instanceof ContractError) {
      invalid('invalid_schema', '[ERROR] Cleanup plan validation failed.');
    }
    throw error;
  }
  unsupported('platform_adapter_unavailable', '[ERROR] No certified mutation adapter is available yet.');
}

function helpText() {
  return [
    'skills-refiner cleanup — review and safely quarantine local skill entries',
    '',
    'Usage:',
    '  skills-refiner cleanup review [--scan FILE] [--json]',
    '  skills-refiner cleanup plan --review FILE --decisions FILE [--json]',
    '  skills-refiner cleanup apply --plan FILE --confirm HASH [--json]',
    '  skills-refiner cleanup --help',
    '',
  ].join('\n');
}

async function run(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help', text: helpText() };
  if (argv[0] !== 'cleanup') invalid();
  const command = argv[1];
  const args = argv.slice(2);
  if (!command) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) invalid();
    return { kind: 'result', value: runReview(args) };
  }
  if (command === 'review') return { kind: 'result', value: runReview(args) };
  if (command === 'plan') return { kind: 'result', value: await runPlan(args) };
  if (command === 'apply') return { kind: 'result', value: runApply(args) };
  if (['status', 'undo'].includes(command)) {
    unsupported('command_not_implemented', '[ERROR] This cleanup command is not implemented yet.');
  }
  invalid();
}

function errorResult(error) {
  return {
    schema_version: SCHEMAS.error,
    status: error.overallStatus,
    overall_status: error.overallStatus,
    error_code: error.errorCode,
    mutation_occurred: false,
    committed_transaction_ids: [],
  };
}

try {
  const outcome = await run(process.argv.slice(2));
  if (outcome.kind === 'help') {
    if (JSON_REQUESTED) {
      process.stdout.write(`${JSON.stringify({ schema_version: 'skills-refiner.cleanup.help.v1', overall_status: 'ok' })}\n`);
    } else {
      process.stdout.write(outcome.text);
    }
  } else {
    process.stdout.write(`${JSON.stringify(outcome.value)}\n`);
  }
} catch (error) {
  let mapped;
  if (error instanceof CliError) {
    mapped = error;
  } else if (error instanceof ContractError) {
    mapped = new CliError(
      'invalid_schema',
      2,
      'invalid',
      '[ERROR] Cleanup document validation failed.',
    );
  } else if (error instanceof CleanupCoreError) {
    const isBlocked = ['execution_identity_unavailable', 'review_only'].includes(error.code);
    mapped = new CliError(
      error.code,
      error.code === 'platform_adapter_unavailable' ? 3 : (isBlocked ? 10 : 2),
      error.code === 'platform_adapter_unavailable' ? 'unsupported' : (isBlocked ? 'blocked' : 'invalid'),
      '[ERROR] Cleanup review or plan validation failed.',
    );
  } else {
    mapped = new CliError(
      'internal_error',
      20,
      'recovery_required',
      '[ERROR] Cleanup encountered an internal error.',
    );
  }
  if (JSON_REQUESTED) process.stdout.write(`${JSON.stringify(errorResult(mapped))}\n`);
  process.stderr.write(`${mapped.diagnostic}\n`);
  process.exitCode = mapped.exitCode;
}
