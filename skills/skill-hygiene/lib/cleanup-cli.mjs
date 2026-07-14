import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  buildApplyReport,
  canonicalJson,
  ContractError,
  SCHEMAS,
  validatePlan,
} from './cleanup-contract.mjs';
import {
  CleanupCoreError,
  compilePersistedDecisions,
  compilePlan,
  compileReview,
  overlayPersistedKeeps,
  preApplyStatusAllowsBaseline,
  reconcilePostApplyScan,
  semanticIdentityHashForEntry,
  validateKeepStore,
} from './cleanup-core.mjs';
import {
  compareAndSwapDurableJson,
  MacosAdapterError,
  createMacosAdapter,
  probeDurableJson,
} from './cleanup-macos.mjs';
import {
  CleanupBatchError,
  CleanupTransactionError,
  APPLY_FAULT_PHASES,
  RESTORE_FAULT_PHASES,
  applyItem,
  applyPlan,
  statusTransaction,
  undoTransaction,
} from './cleanup-transaction.mjs';

const SCANNER_PATH = fileURLToPath(new URL('../bin/skill-scan.sh', import.meta.url));
const JSON_REQUESTED = process.argv.slice(2).includes('--json');
const TEST_FAULT_PHASES = new Set([...APPLY_FAULT_PHASES, ...RESTORE_FAULT_PHASES]);
const CONFIRMATION_HEX_LENGTH = 12;
const INTERACTIVE_LINE_GRACE_MS = 20;
const KEEP_CAS_ATTEMPTS = 3;
const KEEP_CAS_RETRY_DELAY_MS = 25;
const KEEP_SURFACE = Object.freeze({
  role: 'cleanup',
  relativeDirectory: '.',
  leaf: 'keep-decisions.json',
});
const EMPTY_KEEP_STORE = Object.freeze({
  schema_version: 'skills-refiner.cleanup.keep-decisions.v1',
  kept: Object.freeze([]),
});

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
    keepFailures,
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
    this.keepFailures = keepFailures;
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

function keepStoreUnavailableReview(review, reason) {
  return {
    ...review,
    candidates: review.candidates.map((candidate) => ({
      ...candidate,
      persisted_decision: null,
      keep_status: candidate.governance_scope === 'installed_or_distributed'
        ? 'resurfaced'
        : candidate.keep_status,
      keep_reason: candidate.governance_scope === 'installed_or_distributed'
        ? reason
        : candidate.keep_reason,
    })),
  };
}

function probeKeepState(home = process.env.HOME) {
  try {
    const probed = probeDurableJson({ home, ...KEEP_SURFACE });
    const store = probed.exists ? probed.value : EMPTY_KEEP_STORE;
    validateKeepStore(store);
    return { available: true, ...probed, store };
  } catch (error) {
    if (error instanceof CleanupCoreError
        || (error instanceof MacosAdapterError && error.code === 'blocked')) {
      return {
        available: false,
        exists: false,
        digest: null,
        store: null,
        reason: error.reason ?? error.code ?? 'keep_store_invalid',
      };
    }
    throw error;
  }
}

async function compileLiveReview() {
  const scan = runInstalledScanner();
  const review = compileReview(scan, {
    executionEligible: true,
    source: 'live_scan',
  });
  if (process.platform !== 'darwin') {
    return { review, adapter: null, keepState: null };
  }
  const adapter = createMacosAdapter({ home: process.env.HOME });
  const keepState = probeKeepState();
  if (!keepState.available) {
    return {
      review: keepStoreUnavailableReview(review, keepState.reason),
      adapter,
      keepState,
    };
  }
  return {
    review: await overlayPersistedKeeps(review, keepState.store, adapter),
    adapter,
    keepState,
  };
}

function isRetryableKeepCas(error) {
  return error instanceof MacosAdapterError
    && ['state_cas_mismatch', 'state_cas_lock_held'].includes(error.reason);
}

async function persistKeepDecisions(review, decisions, adapter) {
  if (process.platform !== 'darwin' || adapter === null) {
    unsupported(
      'platform_adapter_unavailable',
      '[ERROR] No certified Keep adapter is available on this platform.',
    );
  }
  for (let attempt = 0; attempt < KEEP_CAS_ATTEMPTS; attempt += 1) {
    const current = probeKeepState();
    if (!current.available) {
      blocked(
        'keep_store_unavailable',
        'blocked',
        '[ERROR] The Keep store is unsafe or invalid; it was not repaired.',
      );
    }
    const compiled = await compilePersistedDecisions(
      review,
      decisions,
      adapter,
      current.store,
    );
    let changed = false;
    if (canonicalJson(compiled.store) !== canonicalJson(current.store)) {
      try {
        compareAndSwapDurableJson({
          home: process.env.HOME,
          ...KEEP_SURFACE,
          expectedDigest: current.digest,
          value: compiled.store,
        });
        changed = true;
      } catch (error) {
        if (!isRetryableKeepCas(error) || attempt === KEEP_CAS_ATTEMPTS - 1) {
          if (isRetryableKeepCas(error)) {
            blocked(
              'keep_store_conflict',
              'blocked',
              '[ERROR] The Keep store changed concurrently; no cleanup mutation was attempted.',
            );
          }
          throw error;
        }
        await delay(KEEP_CAS_RETRY_DELAY_MS);
        continue;
      }
    }
    if (compiled.failures.length !== 0) {
      throw new CliError(
        'keep_identity_unavailable',
        10,
        'blocked',
        '[ERROR] One or more Keep identities could not be verified.',
        { keepFailures: compiled.failures.map((failure) => ({ ...failure })) },
      );
    }
    return { store: compiled.store, changed };
  }
  throw new Error('unreachable Keep CAS state');
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

async function runReview(args) {
  rejectUnknownOptions(args, new Set(['--scan']));
  const scanPath = parseNamedFileOption(args, '--scan');
  if (scanPath) {
    return compileReview(validateScan(readJsonFile(scanPath)), {
      executionEligible: false,
      source: 'offline_scan',
    });
  }
  return (await compileLiveReview()).review;
}

async function runPlan(args) {
  const persistIndexes = args
    .map((argument, index) => (argument === '--persist-keep' ? index : -1))
    .filter((index) => index >= 0);
  if (persistIndexes.length > 1) invalid();
  const persistKeep = persistIndexes.length === 1;
  const valueArgs = args.filter((argument) => argument !== '--persist-keep');
  rejectUnknownOptions(valueArgs, new Set(['--review', '--decisions']));
  const reviewPath = parseNamedFileOption(args, '--review');
  const decisionsPath = parseNamedFileOption(args, '--decisions');
  if (!reviewPath || !decisionsPath) invalid();

  const savedReview = readJsonFile(reviewPath);
  const decisions = readJsonFile(decisionsPath);
  const live = await compileLiveReview();
  const freshReview = live.review;
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
  const plan = await compilePlan(
    { review: freshReview, decisions },
    live.adapter,
  );
  if (persistKeep) {
    await persistKeepDecisions(freshReview, decisions, live.adapter);
  }
  return plan;
}

async function runApply(args) {
  const postScanIndexes = args
    .map((argument, index) => (argument === '--post-scan' ? index : -1))
    .filter((index) => index >= 0);
  if (postScanIndexes.length > 1) invalid();
  const postScanRequested = postScanIndexes.length === 1;
  const valueArgs = args.filter((argument) => argument !== '--post-scan');
  rejectUnknownOptions(valueArgs, new Set(['--plan', '--confirm']));
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
  let baselineByTransactionId = new Map();
  let baselineIdentityUnavailableTransactionIds = new Set();
  if (postScanRequested) {
    const eligibleBaselineTransactions = preApplyBaselineTransactions(plan);
    const baselineScan = tryInstalledScanner();
    if (baselineScan.available) {
      ({
        hashes: baselineByTransactionId,
        unavailable: baselineIdentityUnavailableTransactionIds,
      } = semanticBaselines(baselineScan.scan, plan, eligibleBaselineTransactions));
    } else {
      baselineIdentityUnavailableTransactionIds = new Set(eligibleBaselineTransactions);
    }
  }
  const apply = plan.items.length > 1 ? applyPlan : applyItem;
  try {
    const applyOutcome = await apply({
      home: process.env.HOME,
      plan,
      confirmation,
      fault: transactionFaultCallback(),
    });
    if (!postScanRequested) return applyOutcome;
    return await postScanApplyReport(
      plan,
      baselineByTransactionId,
      baselineIdentityUnavailableTransactionIds,
      applyOutcome,
    );
  } catch (error) {
    if (postScanRequested && error instanceof CleanupBatchError
        && error.batchError?.committed_transaction_ids?.length > 0) {
      error.applyReport = await postScanApplyReport(
        plan,
        baselineByTransactionId,
        baselineIdentityUnavailableTransactionIds,
        error.batchError,
      );
    }
    throw error;
  }
}

function tryInstalledScanner() {
  try {
    return { available: true, scan: runInstalledScanner(), errorCode: null };
  } catch (error) {
    const invalidScanner = error instanceof CliError
      && ['invalid_document', 'invalid_schema'].includes(error.errorCode);
    return {
      available: false,
      scan: null,
      errorCode: invalidScanner ? 'scanner_invalid' : 'scanner_unavailable',
    };
  }
}

function preApplyBaselineTransactions(plan) {
  const eligible = new Set();
  for (const item of plan.items) {
    let preStatus;
    try {
      const status = statusTransaction({
        home: process.env.HOME,
        transactionId: item.transaction_id,
      });
      preStatus = {
        ok: true,
        state: status.state,
        location: status.location,
        transaction_has_mutated: status.transaction_has_mutated,
      };
    } catch (error) {
      preStatus = {
        ok: false,
        error_code: error instanceof CleanupTransactionError
          ? error.code
          : 'status_unavailable',
      };
    }
    if (preApplyStatusAllowsBaseline(preStatus)) eligible.add(item.transaction_id);
  }
  return eligible;
}

function semanticBaselines(scan, plan, eligibleTransactions) {
  const hashes = new Map();
  const unavailable = new Set();
  let candidatesByPath;
  try {
    const review = compileReview(scan, { executionEligible: false, source: 'post_scan_baseline' });
    candidatesByPath = new Map(review.candidates.map((candidate) => [
      candidate.entry_path,
      candidate,
    ]));
  } catch {
    for (const transactionId of eligibleTransactions) unavailable.add(transactionId);
    return { hashes, unavailable };
  }
  for (const item of plan.items) {
    if (!eligibleTransactions.has(item.transaction_id)) continue;
    const matches = scan.entries.filter(({ entry_path: entryPath }) => (
      entryPath === item.entry_path
    ));
    if (matches.length !== 1) continue;
    const candidate = candidatesByPath.get(item.entry_path);
    if (candidate?.candidate_fingerprint !== item.preconditions.candidate_fingerprint) continue;
    try {
      hashes.set(
        item.transaction_id,
        semanticIdentityHashForEntry(matches[0]),
      );
    } catch {
      unavailable.add(item.transaction_id);
    }
  }
  return { hashes, unavailable };
}

function unavailablePostScan(
  plan,
  committedTransactionIds,
  baselineByTransactionId,
  errorCode,
) {
  const planItems = new Map(plan.items.map((item) => [item.transaction_id, item]));
  return {
    schema_version: SCHEMAS.postScan,
    observation_status: 'UNAVAILABLE',
    scanner_schema: null,
    error_code: errorCode,
    items: committedTransactionIds.map((transactionId) => {
      const item = planItems.get(transactionId);
      return {
        item_id: item.item_id,
        transaction_id: transactionId,
        entry_path: item.entry_path,
        status: 'INDETERMINATE',
        location: 'unknown',
        baseline_identity_hash: baselineByTransactionId.get(transactionId) ?? null,
        observed_identity_hash: null,
      };
    }),
    warnings: ['installer_may_redeploy', 'running_agent_may_cache'],
  };
}

async function postScanApplyReport(
  plan,
  baselineByTransactionId,
  baselineIdentityUnavailableTransactionIds,
  applyOutcome,
) {
  const committedTransactionIds = applyOutcome.committed_transaction_ids;
  const effectiveBaselines = applyOutcome.status === 'already_committed'
    ? new Map()
    : baselineByTransactionId;
  const effectiveUnavailable = applyOutcome.status === 'already_committed'
    ? new Set()
    : baselineIdentityUnavailableTransactionIds;
  let postScan;
  try {
    const adapter = createMacosAdapter({ home: process.env.HOME });
    const planItems = new Map(plan.items.map((item) => [item.transaction_id, item]));
    const nativeIdentityBeforeByTransactionId = new Map();
    for (const transactionId of committedTransactionIds) {
      nativeIdentityBeforeByTransactionId.set(
        transactionId,
        await inspectPostApplyIdentity(adapter, planItems.get(transactionId)),
      );
    }
    const scanned = tryInstalledScanner();
    const statusByTransactionId = new Map();
    const nativeIdentityAfterByTransactionId = new Map();
    if (scanned.available) {
      for (const transactionId of committedTransactionIds) {
        try {
          const status = statusTransaction({ home: process.env.HOME, transactionId });
          statusByTransactionId.set(transactionId, { ok: true, location: status.location });
        } catch {
          statusByTransactionId.set(transactionId, { ok: false, location: null });
        }
        const planItem = planItems.get(transactionId);
        nativeIdentityAfterByTransactionId.set(
          transactionId,
          await inspectPostApplyIdentity(adapter, planItem),
        );
      }
    }
    postScan = reconcilePostApplyScan({
      plan,
      committedTransactionIds,
      baselineByTransactionId: effectiveBaselines,
      baselineIdentityUnavailableTransactionIds: effectiveUnavailable,
      scan: scanned.scan,
      scanAvailable: scanned.available,
      scanErrorCode: scanned.errorCode ?? 'scanner_unavailable',
      statusByTransactionId,
      nativeIdentityBeforeByTransactionId,
      nativeIdentityAfterByTransactionId,
    });
  } catch {
    postScan = unavailablePostScan(
      plan,
      committedTransactionIds,
      effectiveBaselines,
      'post_scan_internal_error',
    );
  }
  return buildApplyReport({ applyOutcome, postScan, plan });
}

async function inspectPostApplyIdentity(adapter, planItem) {
  try {
    const identity = await adapter.inspectIdentity(
      planItem.entry_path,
      planItem.active_root,
      {
        entry_kind: planItem.entry_kind,
        entry_identity: {
          raw_link_target_base64: planItem.execution_identity.raw_link_target_base64,
        },
      },
    );
    return { ok: true, identity };
  } catch {
    return { ok: false, identity: null };
  }
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

class SafePrompter {
  constructor(input, output) {
    this.input = input;
    this.output = output;
    this.pendingQuestion = null;
    this.settlingLine = false;
    this.graceTimer = null;
    this.deferredError = null;
    this.intentionallyClosing = false;
    this.readline = createInterface({
      input,
      output,
      terminal: true,
      historySize: 0,
      removeHistoryDuplicates: true,
    });
    this.onData = (chunk) => {
      const value = chunk.toString('utf8');
      if (value.includes('\u0003')) {
        this.cancel('session_interrupted', 130, '[ERROR] Cleanup was interrupted.');
        return;
      }
      if (value.includes('\u0004')) {
        this.cancel('session_cancelled', 2, '[ERROR] Cleanup input ended before confirmation.');
        return;
      }
      const withoutLineEndings = value.replace(/\r\n|\r|\n/gu, '');
      if (withoutLineEndings.includes('\u001b')
          || /[\u0000-\u001f\u007f]/u.test(withoutLineEndings)) {
        this.cancel(
          'unsafe_interactive_input',
          2,
          '[ERROR] Cleanup cancelled unsafe interactive input.',
        );
      }
    };
    this.onLine = (line) => {
      if (this.pendingQuestion === null || this.settlingLine) {
        this.cancel(
          'unsafe_interactive_input',
          2,
          '[ERROR] Cleanup cancelled queued interactive input.',
        );
        return;
      }
      this.settlingLine = true;
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        if (this.pendingQuestion === null || this.deferredError !== null) return;
        const { resolve: resolveQuestion } = this.pendingQuestion;
        this.pendingQuestion = null;
        this.settlingLine = false;
        resolveQuestion(line);
      }, INTERACTIVE_LINE_GRACE_MS);
    };
    this.onSignal = () => {
      this.cancel('session_interrupted', 130, '[ERROR] Cleanup was interrupted.');
    };
    this.onClose = () => {
      if (!this.intentionallyClosing) {
        this.cancel('session_cancelled', 2, '[ERROR] Cleanup input ended before confirmation.');
      }
    };
    input.prependListener('data', this.onData);
    this.readline.on('line', this.onLine);
    this.readline.on('SIGINT', this.onSignal);
    this.readline.on('close', this.onClose);
  }

  cancel(errorCode, exitCode, diagnostic) {
    const error = new CliError(errorCode, exitCode, 'cancelled', diagnostic);
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    this.settlingLine = false;
    if (this.pendingQuestion === null) {
      this.deferredError = error;
      this.intentionallyClosing = true;
      this.readline.close();
      return;
    }
    const { reject: rejectQuestion } = this.pendingQuestion;
    this.pendingQuestion = null;
    this.intentionallyClosing = true;
    this.readline.close();
    rejectQuestion(error);
  }

  async question(prompt) {
    if (this.deferredError !== null) throw this.deferredError;
    if (this.intentionallyClosing) throw new CliError(
      'session_cancelled',
      2,
      'cancelled',
      '[ERROR] Cleanup input ended before confirmation.',
    );
    if (this.pendingQuestion !== null) throw new Error('interactive question already pending');
    this.output.write(prompt);
    return new Promise((resolveQuestion, rejectQuestion) => {
      this.pendingQuestion = { resolve: resolveQuestion, reject: rejectQuestion };
    });
  }

  close() {
    this.intentionallyClosing = true;
    this.pendingQuestion = null;
    this.settlingLine = false;
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.deferredError = null;
    this.input.removeListener('data', this.onData);
    this.readline.removeListener('line', this.onLine);
    this.readline.removeListener('SIGINT', this.onSignal);
    this.readline.removeListener('close', this.onClose);
    this.readline.close();
  }
}

function decisionsForReview(review) {
  return {
    schema_version: SCHEMAS.decisions,
    review_fingerprint: review.review_fingerprint,
    decisions: review.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      action: 'later',
    })),
  };
}

function setDecision(decisions, candidateId, action) {
  const decision = decisions.decisions.find(({ candidate_id: id }) => id === candidateId);
  if (decision === undefined) throw new Error('guided decision candidate is missing');
  decision.action = action;
}

function terminalText(value, fallback = 'not observed') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, (character) => (
    `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`
  ));
}

function terminalList(values, render = (value) => terminalText(value)) {
  if (!Array.isArray(values) || values.length === 0) return 'none';
  return values.map(render).join(', ');
}

function sourceSummary(candidate) {
  const source = candidate.source ?? {};
  const parts = [terminalText(source.kind, 'unknown')];
  if (source.confidence) parts.push(`confidence=${terminalText(source.confidence)}`);
  if (source.git_root) parts.push(`git_root=${terminalText(source.git_root)}`);
  if (source.git_branch) parts.push(`git_branch=${terminalText(source.git_branch)}`);
  return parts.join('; ');
}

function actionScopeSummary(candidate) {
  const scope = candidate.action_scope ?? {};
  const parts = [
    terminalText(scope.kind, 'none'),
    `target_mutated=${scope.target_mutated === true ? 'true' : 'false'}`,
  ];
  if (candidate.mutation_eligibility === 'review_only') {
    parts.push(`review_only: ${terminalText(candidate.review_only_reason)}`);
  } else {
    parts.push('Retire available');
  }
  return parts.join('; ');
}

function printCandidate(candidate, index, count) {
  process.stdout.write(`\n${index + 1}/${count}  ${terminalText(candidate.name)}\n`);
  process.stdout.write(`Installed entry: ${terminalText(candidate.entry_path)}\n`);
  process.stdout.write(`Canonical target: ${terminalText(candidate.source?.canonical_target)}\n`);
  process.stdout.write(`Source: ${sourceSummary(candidate)}\n`);
  process.stdout.write(`Action scope: ${actionScopeSummary(candidate)}\n`);
}

function printInspection(candidate) {
  process.stdout.write(`Installed entry: ${terminalText(candidate.entry_path)}\n`);
  process.stdout.write(`Canonical target: ${terminalText(candidate.source?.canonical_target)}\n`);
  process.stdout.write(`Source: ${sourceSummary(candidate)}\n`);
  process.stdout.write(`Action scope: ${actionScopeSummary(candidate)}\n`);
  process.stdout.write(`Kind: ${terminalText(candidate.entry_kind)}\n`);
  process.stdout.write(`Scope: ${terminalText(candidate.governance_scope)}\n`);
  process.stdout.write(`Eligibility: ${terminalText(candidate.mutation_eligibility)}\n`);
  process.stdout.write(`Review reason: ${terminalText(candidate.review_only_reason, 'none')}\n`);
  process.stdout.write(`Primary group: ${terminalText(candidate.primary_group)}\n`);
  process.stdout.write(`Distribution consumers: ${terminalList(
    candidate.distribution_consumers,
    (consumer) => `${terminalText(consumer.entry_path)} (${terminalText(consumer.entry_kind)})`,
  )}\n`);
  process.stdout.write(`Relevant signals: ${terminalList(candidate.evidence?.relevant_signals)}\n`);
  process.stdout.write(`Uncertainty: ${terminalList(candidate.uncertainty)}\n`);
}

function printPostScanVerification(postScan) {
  const statuses = [...new Set(postScan.items.map(({ status }) => status))].join(', ');
  process.stdout.write(`Post-scan verification: ${postScan.observation_status} (${statuses}).\n`);
  if (postScan.warnings.includes('automatic_requarantine_disabled')) {
    process.stdout.write('Warning: an installer may have redeployed a retired skill; cleanup did not delete it again.\n');
  } else {
    process.stdout.write('Installers can redeploy retired skills; rerun review if an entry reappears.\n');
  }
  process.stdout.write('Running Agents may retain cached skill state until they are restarted.\n');
}

async function persistGuidedKeepDecisions(review, decisions, adapter) {
  try {
    return await persistKeepDecisions(review, decisions, adapter);
  } catch (error) {
    if (error instanceof CliError && Array.isArray(error.keepFailures)) {
      const candidates = new Map(review.candidates.map((candidate) => [
        candidate.candidate_id,
        candidate,
      ]));
      for (const failure of error.keepFailures) {
        const candidate = candidates.get(failure.candidate_id);
        const label = candidate?.name ?? failure.candidate_id;
        process.stdout.write(`Keep failed: ${terminalText(label)}; ${terminalText(failure.code)}; ${terminalText(failure.reason)}\n`);
      }
    }
    throw error;
  }
}

async function guidedChoice(prompter, candidate, { keepAvailable, retireAvailable }) {
  while (true) {
    const choices = [
      retireAvailable ? '[R]etire' : null,
      keepAvailable ? '[K]eep' : null,
      '[L]ater',
      '[I]nspect',
    ].filter(Boolean).join('  ');
    const answer = (await prompter.question(`Choose ${choices} (blank = Later): `))
      .trim().toLowerCase();
    if (answer === '' || answer === 'l' || answer === 'later') return 'later';
    if (answer === 'i' || answer === 'inspect') {
      printInspection(candidate);
      continue;
    }
    if (answer === 'r' || answer === 'retire') {
      if (retireAvailable) return 'retire';
      process.stdout.write(`Retire unavailable: ${candidate.review_only_reason ?? 'platform_adapter_unavailable'}\n`);
      continue;
    }
    if (answer === 'k' || answer === 'keep') {
      if (keepAvailable) return 'keep';
      process.stdout.write('Keep unavailable: the local Keep store or adapter is not safe.\n');
      continue;
    }
    process.stdout.write('Enter R, K, L, I, or press Enter for Later.\n');
  }
}

async function runGuidedCleanup(args) {
  if (args.length !== 0) invalid();
  const live = await compileLiveReview();
  const review = live.review;
  const governed = review.candidates.filter(
    ({ governance_scope: scope }) => scope === 'installed_or_distributed',
  );
  const decisions = decisionsForReview(review);
  const persisted = governed.filter(({ persisted_decision: decision }) => decision === 'keep');
  const pending = governed.filter(({ persisted_decision: decision }) => decision !== 'keep');
  for (const candidate of persisted) setDecision(decisions, candidate.candidate_id, 'keep');

  process.stdout.write('Local skill cleanup\n');
  process.stdout.write(`Installed or distributed entries: ${governed.length}\n`);
  if (persisted.length > 0) process.stdout.write(`Already kept: ${persisted.length}\n`);
  if (pending.length === 0) {
    process.stdout.write('No decisions required.\n');
    return { kind: 'text', text: '' };
  }

  const prompter = new SafePrompter(process.stdin, process.stdout);
  let keepCount = 0;
  let retireCount = 0;
  try {
    for (let index = 0; index < pending.length; index += 1) {
      const candidate = pending[index];
      printCandidate(candidate, index, pending.length);
      const action = await guidedChoice(prompter, candidate, {
        keepAvailable: process.platform === 'darwin' && live.keepState?.available === true,
        retireAvailable: process.platform === 'darwin'
          && candidate.mutation_eligibility === 'eligible',
      });
      setDecision(decisions, candidate.candidate_id, action);
      if (action === 'keep') keepCount += 1;
      if (action === 'retire') retireCount += 1;
    }

    if (retireCount === 0) {
      if (keepCount > 0) {
        await persistGuidedKeepDecisions(review, decisions, live.adapter);
        process.stdout.write(`Saved ${keepCount} Keep decision${keepCount === 1 ? '' : 's'}.\n`);
      } else {
        process.stdout.write('No changes applied.\n');
      }
      return { kind: 'text', text: '' };
    }

    const plan = await compilePlan({ review, decisions }, live.adapter);
    const confirmation = `apply ${plan.plan_hash.slice(7, 7 + CONFIRMATION_HEX_LENGTH)}`;
    const answer = await prompter.question(`Type ${confirmation} to retire ${retireCount}: `);
    if (answer !== confirmation) {
      invalid(
        'confirmation_mismatch',
        '[ERROR] Cleanup confirmation did not match; no changes were applied.',
      );
    }

    if (keepCount > 0 || live.keepState?.available === true) {
      await persistGuidedKeepDecisions(review, decisions, live.adapter);
    }
    const eligibleBaselineTransactions = preApplyBaselineTransactions(plan);
    const baselineScan = tryInstalledScanner();
    const baselines = baselineScan.available
      ? semanticBaselines(baselineScan.scan, plan, eligibleBaselineTransactions)
      : {
        hashes: new Map(),
        unavailable: new Set(eligibleBaselineTransactions),
      };
    const apply = plan.items.length > 1 ? applyPlan : applyItem;
    let applyOutcome;
    try {
      applyOutcome = await apply({
        home: process.env.HOME,
        plan,
        confirmation: plan.plan_hash,
        fault: transactionFaultCallback(),
      });
    } catch (error) {
      if (error instanceof CleanupBatchError
          && error.batchError?.committed_transaction_ids?.length > 0) {
        const report = await postScanApplyReport(
          plan,
          baselines.hashes,
          baselines.unavailable,
          error.batchError,
        );
        const committed = error.batchError.committed_transaction_ids.length;
        process.stdout.write(`Retired ${committed} entr${committed === 1 ? 'y' : 'ies'} before cleanup stopped.\n`);
        printPostScanVerification(report.post_scan);
      }
      throw error;
    }
    const report = await postScanApplyReport(
      plan,
      baselines.hashes,
      baselines.unavailable,
      applyOutcome,
    );
    process.stdout.write(`Retired ${retireCount} entr${retireCount === 1 ? 'y' : 'ies'}.\n`);
    if (keepCount > 0) {
      process.stdout.write(`Saved ${keepCount} Keep decision${keepCount === 1 ? '' : 's'}.\n`);
    }
    printPostScanVerification(report.post_scan);
    return { kind: 'text', text: '' };
  } finally {
    prompter.close();
  }
}

function helpText() {
  return [
    'skills-refiner cleanup — review and safely quarantine local skill entries',
    '',
    'Usage:',
    '  skills-refiner cleanup review [--scan FILE] [--json]',
    '  skills-refiner cleanup plan --review FILE --decisions FILE [--persist-keep] [--json]',
    '  skills-refiner cleanup apply --plan FILE --confirm HASH [--post-scan] [--json]',
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
    return runGuidedCleanup(args);
  }
  if (command === 'review') return { kind: 'result', value: await runReview(args) };
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
  if (error.keepFailures !== undefined) {
    result.failures = error.keepFailures.map((failure) => ({ ...failure }));
  }
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
  } else if (outcome.kind === 'result') {
    process.stdout.write(`${JSON.stringify(outcome.value)}\n`);
  } else if (outcome.text.length > 0) {
    process.stdout.write(outcome.text);
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
  } else if (error instanceof CleanupBatchError) {
    const exitCode = {
      invalid: 2,
      unsupported: 3,
      blocked: 10,
      recovery_required: 20,
      conflict: 21,
    }[error.status] ?? 20;
    if (error.applyReport !== undefined) {
      process.stdout.write(`${JSON.stringify(error.applyReport)}\n`);
      process.stderr.write('[ERROR] Cleanup batch safety checks did not converge.\n');
      process.exitCode = exitCode;
      mapped = null;
    } else if (JSON_REQUESTED && error.batchError !== undefined) {
      process.stdout.write(`${JSON.stringify(error.batchError)}\n`);
      process.stderr.write('[ERROR] Cleanup batch safety checks did not converge.\n');
      process.exitCode = exitCode;
      mapped = null;
    } else {
      mapped = new CliError(
        error.code,
        exitCode,
        error.status,
        '[ERROR] Cleanup batch safety checks did not converge.',
        {
          mutationOccurred: error.mutationOccurred ?? false,
          mutationOutcome: error.mutationOutcome ?? 'unchanged',
          transactionHasMutated: error.transactionHasMutated ?? false,
          committedTransactionIds: error.committedTransactionIds ?? [],
        },
      );
    }
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
  if (mapped !== null) {
    if (JSON_REQUESTED) process.stdout.write(`${JSON.stringify(errorResult(mapped))}\n`);
    process.stderr.write(`${mapped.diagnostic}\n`);
    process.exitCode = mapped.exitCode;
  }
}
