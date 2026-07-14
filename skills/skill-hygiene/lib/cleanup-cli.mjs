import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContractError, SCHEMAS, validatePlan } from './cleanup-contract.mjs';
import { CleanupCoreError, compilePlan, compileReview } from './cleanup-core.mjs';
import { MacosAdapterError, createMacosAdapter } from './cleanup-macos.mjs';
import {
  CleanupTransactionError,
  APPLY_FAULT_PHASES,
  RESTORE_FAULT_PHASES,
  applyItem,
  statusTransaction,
  undoTransaction,
} from './cleanup-transaction.mjs';

const SCANNER_PATH = fileURLToPath(new URL('../bin/skill-scan.sh', import.meta.url));
const JSON_REQUESTED = process.argv.slice(2).includes('--json');
const TEST_FAULT_PHASES = new Set([...APPLY_FAULT_PHASES, ...RESTORE_FAULT_PHASES]);

class CliError extends Error {
  constructor(errorCode, exitCode, overallStatus, diagnostic, {
    mutationOccurred = false,
    mutationOutcome = 'unchanged',
    transactionHasMutated = false,
    committedTransactionIds = [],
    command,
    transactionId,
    transactionState,
    transactionLocation,
  } = {}) {
    super(diagnostic);
    this.name = 'CliError';
    this.errorCode = errorCode;
    this.exitCode = exitCode;
    this.overallStatus = overallStatus;
    this.diagnostic = diagnostic;
    this.mutationOccurred = mutationOccurred;
    this.mutationOutcome = mutationOutcome;
    this.transactionHasMutated = transactionHasMutated;
    this.committedTransactionIds = committedTransactionIds;
    this.command = command;
    this.transactionId = transactionId;
    this.transactionState = transactionState;
    this.transactionLocation = transactionLocation;
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

function pathIsWithin(parent, child) {
  const pathRelative = relative(parent, child);
  return pathRelative.length === 0
    || (!pathRelative.startsWith(`..${sep}`) && pathRelative !== '..' && !isAbsolute(pathRelative));
}

function transactionFaultCallback() {
  const phase = process.env.SKILLS_REFINER_TEST_FAULT;
  if (phase === undefined) return null;
  const root = process.env.SKILLS_REFINER_TEST_ROOT;
  try {
    if (!TEST_FAULT_PHASES.has(phase) || typeof root !== 'string' || !isAbsolute(root)
        || resolve(root) !== root) throw new Error('unsafe test fault request');
    const resolvedRoot = realpathSync(root);
    const resolvedTemp = realpathSync(tmpdir());
    const resolvedHome = realpathSync(process.env.HOME);
    const rootStatus = lstatSync(resolvedRoot);
    if (resolvedRoot !== root || !pathIsWithin(resolvedTemp, resolvedRoot)
        || !pathIsWithin(resolvedRoot, resolvedHome)
        || !rootStatus.isDirectory() || rootStatus.isSymbolicLink()
        || rootStatus.uid !== process.getuid() || (rootStatus.mode & 0o077) !== 0) {
      throw new Error('unsafe test fault request');
    }
  } catch {
    invalid('unsafe_test_fault_root', '[ERROR] Cleanup rejected an unsafe test fault request.');
  }
  return async (observedPhase) => {
    if (observedPhase === phase) process.kill(process.pid, 'SIGKILL');
  };
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

  if (process.platform !== 'darwin') {
    unsupported(
      'platform_adapter_unavailable',
      '[ERROR] No certified mutation adapter is available on this platform.',
    );
  }
  return compilePlan(
    { review: freshReview, decisions },
    createMacosAdapter({ home: process.env.HOME }),
  );
}

async function runApply(args) {
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
  const confirmation = parseNamedFileOption(args, '--confirm');
  if (!confirmation) invalid('confirmation_required', '[ERROR] Apply requires an exact plan confirmation.');
  if (process.platform !== 'darwin') {
    unsupported('platform_adapter_unavailable', '[ERROR] No certified mutation adapter is available on this platform.');
  }
  return applyItem({
    home: process.env.HOME,
    plan,
    confirmation,
    fault: transactionFaultCallback(),
  });
}

function parseTransactionArguments(args, { allowConfirmation = false } = {}) {
  const positional = [];
  let confirmation = null;
  let jsonSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      if (jsonSeen) invalid();
      jsonSeen = true;
      continue;
    }
    if (argument === '--confirm') {
      if (!allowConfirmation || confirmation !== null || index + 1 >= args.length
          || args[index + 1].startsWith('--')) invalid();
      confirmation = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) invalid();
    positional.push(argument);
  }
  if (positional.length !== 1) invalid();
  return { transactionId: positional[0], confirmation };
}

function runStatus(args) {
  const { transactionId } = parseTransactionArguments(args);
  return statusTransaction({ home: process.env.HOME, transactionId });
}

async function runUndo(args) {
  const { transactionId, confirmation } = parseTransactionArguments(
    args,
    { allowConfirmation: true },
  );
  if (!confirmation) invalid('confirmation_required', '[ERROR] Undo requires an exact transaction confirmation.');
  if (process.platform !== 'darwin') {
    unsupported('platform_adapter_unavailable', '[ERROR] No certified mutation adapter is available on this platform.');
  }
  return undoTransaction({
    home: process.env.HOME,
    transactionId,
    confirmation,
    fault: transactionFaultCallback(),
  });
}

function helpText() {
  return [
    'skills-refiner cleanup — review and safely quarantine local skill entries',
    '',
    'Usage:',
    '  skills-refiner cleanup review [--scan FILE] [--json]',
    '  skills-refiner cleanup plan --review FILE --decisions FILE [--json]',
    '  skills-refiner cleanup apply --plan FILE --confirm HASH [--json]',
    '  skills-refiner cleanup status TRANSACTION_ID [--json]',
    '  skills-refiner cleanup undo TRANSACTION_ID --confirm TRANSACTION_ID [--json]',
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
  if (command === 'apply') return { kind: 'result', value: await runApply(args) };
  if (command === 'status') return { kind: 'result', value: runStatus(args) };
  if (command === 'undo') return { kind: 'result', value: await runUndo(args) };
  invalid();
}

function errorResult(error) {
  const result = {
    schema_version: SCHEMAS.error,
    status: error.overallStatus,
    overall_status: error.overallStatus,
    error_code: error.errorCode,
    mutation_occurred: error.mutationOccurred,
    mutation_outcome: error.mutationOutcome,
    transaction_has_mutated: error.transactionHasMutated,
    committed_transaction_ids: error.committedTransactionIds,
  };
  if (error.command !== undefined) result.command = error.command;
  if (error.transactionId !== undefined) result.transaction_id = error.transactionId;
  if (error.transactionState !== undefined) result.state = error.transactionState;
  if (error.transactionLocation !== undefined) result.location = error.transactionLocation;
  return result;
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
  } else if (error instanceof MacosAdapterError) {
    const isUnsupported = error.code === 'unsupported';
    const requiresRecovery = error.code === 'recovery_required';
    const mutationAmbiguous = requiresRecovery && error.mutationMayHaveOccurred;
    const isDrift = ['identity_changed', 'receipt_drift', 'installed_tree_drift'].includes(error.reason);
    mapped = new CliError(
      error.reason,
      isUnsupported ? 3 : (requiresRecovery ? 20 : 10),
      isUnsupported
        ? 'unsupported'
        : (requiresRecovery ? 'recovery_required' : (isDrift ? 'drifted' : 'blocked')),
      '[ERROR] The macOS cleanup safety adapter blocked the operation.',
      mutationAmbiguous ? {
        mutationOccurred: true,
        mutationOutcome: 'unknown',
        transactionHasMutated: true,
      } : {},
    );
  } else if (error instanceof CleanupTransactionError) {
    const exitCode = {
      invalid: 2,
      unsupported: 3,
      blocked: 10,
      recovery_required: 20,
      conflict: 21,
    }[error.status] ?? 20;
    mapped = new CliError(
      error.code,
      exitCode,
      error.status,
      '[ERROR] Cleanup transaction safety checks did not converge.',
      {
        mutationOccurred: error.mutationOccurred ?? false,
        mutationOutcome: error.mutationOutcome ?? 'unchanged',
        transactionHasMutated: error.transactionHasMutated ?? false,
        committedTransactionIds: error.committedTransactionIds ?? [],
        command: error.command,
        transactionId: error.transactionId,
        transactionState: error.transactionState,
        transactionLocation: error.transactionLocation,
      },
    );
  } else {
    mapped = new CliError(
      'internal_error',
      20,
      'recovery_required',
      '[ERROR] Cleanup encountered an internal error.',
      { mutationOccurred: true, mutationOutcome: 'unknown', transactionHasMutated: true },
    );
  }
  if (JSON_REQUESTED) process.stdout.write(`${JSON.stringify(errorResult(mapped))}\n`);
  process.stderr.write(`${mapped.diagnostic}\n`);
  process.exitCode = mapped.exitCode;
}
