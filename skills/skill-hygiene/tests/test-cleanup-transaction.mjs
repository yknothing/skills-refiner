import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  computeItemHash,
  computePlanHash,
  deriveTransactionId,
  sha256Json,
} from '../lib/cleanup-contract.mjs';
import {
  __testing,
  MacosAdapterError,
  acquireTransactionLock,
  advanceTransactionStateRecord,
  createMacosAdapter,
  ensureMacosHelper,
  initializeTransactionRecords,
  isolateStaleTransactionLock,
  probeTransactionRecords,
  releaseTransactionLock,
} from '../lib/cleanup-macos.mjs';
import {
  CleanupTransactionError,
  APPLY_FAULT_PHASES,
  RESTORE_FAULT_PHASES,
  advanceTransactionState,
  applyItem,
  assertTransactionTransition,
  initializeTransaction,
  statusTransaction,
  undoTransaction,
} from '../lib/cleanup-transaction.mjs';
import { makeSandbox, removeSandbox, writeSkill } from './cleanup-fixtures.mjs';

const allowedForward = [
  ['PLANNED', 'CONFIRMED'],
  ['CONFIRMED', 'PREPARED'],
  ['PREPARED', 'APPLYING'],
  ['APPLYING', 'COMMITTED'],
  ['PLANNED', 'BLOCKED'],
  ['PLANNED', 'ABORTED'],
  ['CONFIRMED', 'BLOCKED'],
  ['CONFIRMED', 'ABORTED'],
  ['PREPARED', 'BLOCKED'],
  ['PREPARED', 'ABORTED'],
  ['APPLYING', 'RECOVERY_REQUIRED'],
  ['COMMITTED', 'RESTORE_PREPARED'],
  ['RESTORE_PREPARED', 'RESTORING'],
  ['RESTORING', 'RESTORED'],
  ['RESTORE_PREPARED', 'RECOVERY_REQUIRED'],
  ['RESTORING', 'RECOVERY_REQUIRED'],
];

function planForIdentity(identity, authorizationId = '0'.repeat(32)) {
  const item = {
    item_id: `sha256:${'2'.repeat(64)}`,
    action: 'quarantine',
    entry_path: identity.entry_path,
    active_root: identity.active_root,
    entry_kind: identity.entry_kind,
    execution_identity: identity,
    preconditions: {
      review_fingerprint: `sha256:${'3'.repeat(64)}`,
      candidate_fingerprint: `sha256:${'4'.repeat(64)}`,
      scan_fingerprint: `sha256:${'5'.repeat(64)}`,
      execution_identity_hash: identity.identity_hash,
    },
    expected_postconditions: {
      active_entry_absent: true,
      quarantine_entry_present: true,
    },
    risk: 'reviewed',
  };
  item.item_hash = computeItemHash(item);
  const plan = {
    schema_version: 'skills-refiner.cleanup.plan.v1',
    product_version: '2.0',
    platform: 'macos',
    authorization_id: authorizationId,
    scan_fingerprint: item.preconditions.scan_fingerprint,
    created_at: '2026-07-14T00:00:00.000Z',
    items: [item],
  };
  plan.plan_hash = computePlanHash(plan);
  item.transaction_id = deriveTransactionId(plan.plan_hash, item.item_id);
  return plan;
}

const CLI_LAUNCHER = fileURLToPath(new URL('../bin/skills-refiner', import.meta.url));

function prepareNativeHelper(path, args, home, extraEnvironment = {}) {
  let releaseInput;
  const completed = new Promise((resolve, reject) => {
    const child = spawn(path, args, {
      env: {
        HOME: home,
        LANG: 'C',
        LC_ALL: 'C',
        PATH: '/usr/bin:/bin',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
        ...extraEnvironment,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (status, signal) => {
      const output = Buffer.concat(stdout).toString('utf8');
      let response = null;
      try {
        response = JSON.parse(output);
      } catch {
        // The assertion reports the exact process result below.
      }
      resolve({
        status,
        signal,
        response,
        stdout: output,
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    releaseInput = (input) => child.stdin.end(input);
  });
  return {
    completed,
    release(input) {
      releaseInput(input);
    },
  };
}

function runNativeHelper(path, args, input, home, extraEnvironment = {}) {
  const prepared = prepareNativeHelper(path, args, home, extraEnvironment);
  prepared.release(input);
  return prepared.completed;
}

function runCleanupCli(args, home, extraEnvironment = {}) {
  return runNativeHelper(
    CLI_LAUNCHER,
    args,
    '',
    home,
    {
      SKILLS_REFINER_NODE_BIN: process.execPath,
      ...extraEnvironment,
    },
  );
}

function installedTreeSha1(home, entryPath, token) {
  const repository = join(home, `.tree-hash-${token}.git`);
  const index = join(home, `.tree-hash-${token}.index`);
  const environment = {
    HOME: home,
    LANG: 'C',
    LC_ALL: 'C',
    PATH: '/usr/bin:/bin',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_INDEX_FILE: index,
  };
  try {
    assert.equal(spawnSync('/usr/bin/git', ['init', '--bare', '-q', repository], {
      env: environment,
    }).status, 0);
    assert.equal(spawnSync('/usr/bin/git', [
      `--git-dir=${repository}`,
      `--work-tree=${entryPath}`,
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.filemode=true',
      '-c',
      'core.symlinks=true',
      'add',
      '-f',
      '-A',
      '--',
      '.',
    ], { env: environment }).status, 0);
    const written = spawnSync('/usr/bin/git', [
      `--git-dir=${repository}`,
      `--work-tree=${entryPath}`,
      'write-tree',
    ], { encoding: 'utf8', env: environment });
    assert.equal(written.status, 0);
    assert.match(written.stdout.trim(), /^[0-9a-f]{40}$/u);
    return written.stdout.trim();
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(index, { force: true });
  }
}

function onlyStoredTransactionId(home, entryPath) {
  const transactionsRoot = join(home, '.agents/skills-quarantine/transactions');
  const matches = readdirSync(transactionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f]{64}$/u.test(entry.name))
    .map((entry) => ({
      leaf: entry.name,
      manifest: JSON.parse(readFileSync(join(transactionsRoot, entry.name, 'manifest.json'), 'utf8')),
    }))
    .filter(({ manifest }) => manifest.entry_path === entryPath);
  assert.equal(matches.length, 1, `expected one durable transaction for ${entryPath}`);
  assert.equal(matches[0].leaf, matches[0].manifest.transaction_id.slice('sha256:'.length));
  return matches[0].manifest.transaction_id;
}

test('transaction state machine accepts only declared forward transitions', () => {
  for (const [current, next] of allowedForward) {
    assert.equal(assertTransactionTransition(current, next), next);
  }

  for (const [current, next] of [
    ['PLANNED', 'PLANNED'],
    ['CONFIRMED', 'PLANNED'],
    ['PREPARED', 'CONFIRMED'],
    ['COMMITTED', 'APPLYING'],
    ['RESTORED', 'RESTORING'],
    ['UNKNOWN', 'PLANNED'],
    [null, 'PLANNED'],
  ]) {
    assert.throws(
      () => assertTransactionTransition(current, next),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'invalid_state_transition',
    );
  }
});

test('transaction initialization atomically publishes owner-only immutable records', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    const source = writeSkill(join(home, 'source'));
    const entryPath = join(activeRoot, 'distribution');
    symlinkSync(source, entryPath);
    const helper = ensureMacosHelper({ home, forceCompile: true });
    const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    const transactionId = `sha256:${'1'.repeat(64)}`;
    const plan = { schema_version: 'fixture.plan.v1', transaction_id: transactionId };
    const manifest = {
      schema_version: 'skills-refiner.cleanup.transaction-manifest.v1',
      transaction_id: transactionId,
      execution_identity: identity,
    };
    const state = {
      schema_version: 'skills-refiner.cleanup.transaction-state.v1',
      transaction_id: transactionId,
      state: 'PLANNED',
      sequence: 0,
    };
    const initializationInput = [plan, manifest, state]
      .map((value) => canonicalJson(value)).join('\n').concat('\n');
    const initializationContenders = [
      prepareNativeHelper(
        helper.path,
        ['transaction-init', home, transactionId],
        home,
      ),
      prepareNativeHelper(
        helper.path,
        ['transaction-init', home, transactionId],
        home,
      ),
    ];
    for (const contender of initializationContenders) {
      contender.release(initializationInput);
    }
    const initializationResults = await Promise.all(
      initializationContenders.map(({ completed }) => completed),
    );
    assert.deepEqual(
      initializationResults.map(({ status }) => status),
      [0, 0],
    );
    assert.deepEqual(
      initializationResults.map(({ response }) => response?.result).sort(),
      ['created', 'existing'],
    );
    assert.deepEqual(
      readdirSync(join(home, '.agents/skills-quarantine/transactions'))
        .filter((leaf) => leaf.startsWith('.skills-refiner-tx-')),
      [],
    );
    const transactionRoot = join(
      home,
      '.agents/skills-quarantine/transactions',
      transactionId.slice('sha256:'.length),
    );
    assert.equal(lstatSync(transactionRoot).mode & 0o777, 0o700);
    assert.equal(lstatSync(join(transactionRoot, 'payload')).mode & 0o777, 0o700);
    for (const leaf of ['plan.json', 'manifest.json', 'state.json', 'events.jsonl']) {
      assert.equal(lstatSync(join(transactionRoot, leaf)).mode & 0o777, 0o600);
    }
    assert.equal(readFileSync(join(transactionRoot, 'events.jsonl'), 'utf8'), '');
    assert.deepEqual(
      probeTransactionRecords({ home, transactionId, executionIdentity: identity }),
      { plan, manifest, state, lock: null },
    );
    const existing = initializeTransactionRecords({
      home,
      transactionId,
      plan,
      manifest,
      state,
      executionIdentity: identity,
    });
    assert.equal(existing.result, 'existing');
    assert.deepEqual(
      probeTransactionRecords({ home, transactionId, executionIdentity: identity }),
      { plan, manifest, state, lock: null },
    );

    const lockPlanHash = `sha256:${'6'.repeat(64)}`;
    const owner = acquireTransactionLock({
      home,
      transactionId,
      planHash: lockPlanHash,
      executionIdentity: identity,
    });
    assert.equal(owner.pid, process.pid);
    assert.equal(owner.transaction_id, transactionId);
    assert.deepEqual(
      probeTransactionRecords({ home, transactionId, executionIdentity: identity }).lock,
      owner,
    );
    assert.throws(
      () => acquireTransactionLock({
        home,
        transactionId,
        planHash: lockPlanHash,
        executionIdentity: identity,
      }),
      (error) => error instanceof MacosAdapterError
        && error.code === 'blocked' && error.reason === 'lock_held',
    );
    const nonOwnerRelease = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import { spawnSync } from 'node:child_process';
const result = spawnSync(${JSON.stringify(helper.path)}, ${JSON.stringify([
    'lock-release',
    home,
    transactionId,
    lockPlanHash,
    owner.nonce,
    String(owner.pid),
    String(owner.process_start_sec),
    String(owner.process_start_usec),
  ])}, { encoding: 'utf8', env: process.env });
process.stdout.write(JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr }));`,
    ], {
      encoding: 'utf8',
      env: {
        HOME: home,
        LANG: 'C',
        LC_ALL: 'C',
        PATH: '/usr/bin:/bin',
      },
    });
    assert.equal(nonOwnerRelease.status, 0, nonOwnerRelease.stderr);
    const nonOwnerResult = JSON.parse(nonOwnerRelease.stdout);
    assert.equal(nonOwnerResult.status, 10, nonOwnerResult.stderr);
    assert.equal(JSON.parse(nonOwnerResult.stdout).reason, 'lock_release_not_owner');
    assert.deepEqual(
      probeTransactionRecords({ home, transactionId, executionIdentity: identity }).lock,
      owner,
    );
    assert.equal(releaseTransactionLock({
      home,
      transactionId,
      planHash: lockPlanHash,
      owner,
      executionIdentity: identity,
    }).operation, 'lock-release');
    assert.equal(
      probeTransactionRecords({ home, transactionId, executionIdentity: identity }).lock,
      null,
    );
    assert.equal(
      lstatSync(join(transactionRoot, `released-lock-${owner.nonce}`)).mode & 0o777,
      0o700,
    );

    const executablePlan = planForIdentity(identity);
    const executableTransactionId = executablePlan.items[0].transaction_id;
    const executableRoot = join(
      home,
      '.agents/skills-quarantine/transactions',
      executableTransactionId.slice('sha256:'.length),
    );
    const secondItem = {
      ...executablePlan.items[0],
      item_id: `sha256:${'7'.repeat(64)}`,
    };
    secondItem.item_hash = computeItemHash(secondItem);
    const multiPlan = {
      ...executablePlan,
      authorization_id: 'f'.repeat(32),
      items: [executablePlan.items[0], secondItem],
    };
    multiPlan.plan_hash = computePlanHash(multiPlan);
    multiPlan.items = multiPlan.items.map((item) => ({
      ...item,
      transaction_id: deriveTransactionId(multiPlan.plan_hash, item.item_id),
    }));
    await assert.rejects(
      applyItem({ home, plan: multiPlan, confirmation: multiPlan.plan_hash }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'single_item_plan_required' && error.status === 'unsupported',
    );
    for (const item of multiPlan.items) {
      assert.equal(existsSync(join(
        home,
        '.agents/skills-quarantine/transactions',
        item.transaction_id.slice('sha256:'.length),
      )), false);
    }
    assert.throws(
      () => initializeTransaction({
        home,
        plan: executablePlan,
        transactionId: executableTransactionId,
        confirmation: 'wrong confirmation',
      }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'confirmation_mismatch' && error.status === 'invalid',
    );
    assert.equal(existsSync(executableRoot), false);
    const initialized = initializeTransaction({
      home,
      plan: executablePlan,
      transactionId: executableTransactionId,
      confirmation: executablePlan.plan_hash,
    });
    assert.equal(initialized.initialization, 'created');
    assert.equal(initialized.state.state, 'PLANNED');
    assert.equal(initializeTransaction({
      home,
      plan: executablePlan,
      transactionId: executableTransactionId,
      confirmation: executablePlan.plan_hash,
    }).initialization, 'existing');

    const executableOwner = acquireTransactionLock({
      home,
      transactionId: executableTransactionId,
      planHash: executablePlan.plan_hash,
      executionIdentity: identity,
    });
    let liveStatusError;
    try {
      statusTransaction({ home, transactionId: executableTransactionId });
    } catch (error) {
      liveStatusError = error;
    }
    assert.ok(liveStatusError instanceof CleanupTransactionError);
    assert.equal(liveStatusError.code, 'lock_live');
    assert.equal(liveStatusError.status, 'blocked');
    const skippedSequence = {
      ...initialized.state,
      state: 'CONFIRMED',
      sequence: 2,
      updated_at: '2026-07-14T00:00:01.000Z',
      lock: executableOwner,
    };
    assert.throws(
      () => advanceTransactionStateRecord({
        home,
        transactionId: executableTransactionId,
        planHash: executablePlan.plan_hash,
        currentState: initialized.state,
        nextState: skippedSequence,
        owner: executableOwner,
        executionIdentity: identity,
      }),
      (error) => error instanceof MacosAdapterError
        && error.code === 'blocked' && error.reason === 'invalid_state_sequence',
    );

    const expectedStateHash = `sha256:${createHash('sha256')
      .update(canonicalJson(initialized.state), 'utf8').digest('hex')}`;
    const competingStates = [
      '2026-07-14T00:00:02.000Z',
      '2026-07-14T00:00:03.000Z',
    ].map((updatedAt) => ({
      ...initialized.state,
      state: 'CONFIRMED',
      sequence: 1,
      updated_at: updatedAt,
      lock: executableOwner,
    }));
    const stateArguments = [
      'transaction-advance',
      home,
      executableTransactionId,
      executablePlan.plan_hash,
      expectedStateHash,
      executableOwner.nonce,
      String(executableOwner.pid),
      String(executableOwner.process_start_sec),
      String(executableOwner.process_start_usec),
      '0',
      '1',
    ];
    const forgedSequenceState = {
      ...initialized.state,
      state: 'CONFIRMED',
      sequence: 2,
      updated_at: ',"sequence":1,"state":',
      lock: executableOwner,
    };
    const forgedSequenceResult = await runNativeHelper(
      helper.path,
      stateArguments,
      canonicalJson(forgedSequenceState),
      home,
    );
    assert.equal(forgedSequenceResult.status, 10);
    assert.equal(forgedSequenceResult.response?.reason, 'invalid_state_sequence');
    const stateResults = await Promise.all(competingStates.map((nextState) => runNativeHelper(
      helper.path,
      stateArguments,
      canonicalJson(nextState),
      home,
    )));
    assert.deepEqual(stateResults.map(({ status }) => status).sort((a, b) => a - b), [0, 10]);
    assert.equal(
      stateResults.find(({ status }) => status === 10)?.response?.reason,
      'state_cas_mismatch',
    );
    const confirmedState = probeTransactionRecords({
      home,
      transactionId: executableTransactionId,
      executionIdentity: identity,
    }).state;
    assert.equal(confirmedState.state, 'CONFIRMED');
    assert.equal(confirmedState.sequence, 1);
    assert.deepEqual(confirmedState.lock, executableOwner);
    assert.ok(competingStates.some((stateCandidate) => (
      canonicalJson(stateCandidate) === canonicalJson(confirmedState)
    )));
    assert.throws(
      () => advanceTransactionState(initialized, 'CONFIRMED', {
        owner: executableOwner,
        updatedAt: '2026-07-14T00:00:04.000Z',
      }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'state_cas_mismatch',
    );
    releaseTransactionLock({
      home,
      transactionId: executableTransactionId,
      planHash: executablePlan.plan_hash,
      owner: executableOwner,
      executionIdentity: identity,
    });

    const applied = await applyItem({
      home,
      plan: executablePlan,
      confirmation: executablePlan.plan_hash,
    });
    assert.equal(applied.status, 'committed');
    assert.equal(applied.state, 'COMMITTED');
    assert.equal(applied.mutation_occurred, true);
    assert.equal(existsSync(entryPath), false);
    const appliedTransaction = initializeTransaction({
      home,
      plan: executablePlan,
      transactionId: executableTransactionId,
      confirmation: executablePlan.plan_hash,
    });
    assert.equal(
      readlinkSync(join(
        executableRoot,
        'payload',
        appliedTransaction.manifest.payload_leaf,
      )),
      source,
    );
    const repeatedApply = await applyItem({
      home,
      plan: executablePlan,
      confirmation: executablePlan.plan_hash,
    });
    assert.equal(repeatedApply.status, 'already_committed');
    assert.equal(repeatedApply.mutation_occurred, false);
    assert.equal(repeatedApply.transaction_has_mutated, true);
    __testing.clearHelperCache();
    const committedStatus = statusTransaction({ home, transactionId: executableTransactionId });
    assert.equal(committedStatus.status, 'committed');
    assert.equal(committedStatus.location, 'quarantine');
    assert.equal(committedStatus.mutation_occurred, false);
    assert.equal(committedStatus.transaction_has_mutated, true);

    await assert.rejects(
      undoTransaction({
        home,
        transactionId: executableTransactionId,
        confirmation: 'wrong confirmation',
      }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'confirmation_mismatch' && error.status === 'invalid',
    );
    const competingSource = writeSkill(join(home, 'competing-source'));
    symlinkSync(competingSource, entryPath);
    await assert.rejects(
      undoTransaction({
        home,
        transactionId: executableTransactionId,
        confirmation: executableTransactionId,
      }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'restore_destination_occupied' && error.status === 'conflict',
    );
    assert.equal(
      probeTransactionRecords({
        home,
        transactionId: executableTransactionId,
        executionIdentity: identity,
      }).lock,
      null,
    );
    assert.equal(readlinkSync(entryPath), competingSource);
    assert.equal(
      readlinkSync(join(
        executableRoot,
        'payload',
        appliedTransaction.manifest.payload_leaf,
      )),
      source,
    );
    unlinkSync(entryPath);
    const undone = await undoTransaction({
      home,
      transactionId: executableTransactionId,
      confirmation: executableTransactionId,
    });
    assert.equal(undone.status, 'restored');
    assert.equal(undone.mutation_occurred, true);
    assert.equal(readlinkSync(entryPath), source);
    const repeatedUndo = await undoTransaction({
      home,
      transactionId: executableTransactionId,
      confirmation: executableTransactionId,
    });
    assert.equal(repeatedUndo.status, 'already_restored');
    assert.equal(repeatedUndo.mutation_occurred, false);
    await assert.rejects(
      applyItem({
        home,
        plan: executablePlan,
        confirmation: executablePlan.plan_hash,
      }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'replay_protected',
    );
    const freshIdentity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    const freshPlan = planForIdentity(freshIdentity, '1'.repeat(32));
    assert.notEqual(freshPlan.plan_hash, executablePlan.plan_hash);
    const reapplied = await applyItem({
      home,
      plan: freshPlan,
      confirmation: freshPlan.plan_hash,
    });
    assert.equal(reapplied.status, 'committed');
    assert.equal(existsSync(entryPath), false);

    const storedPlanPath = join(executableRoot, 'plan.json');
    const presentationOnly = { ...executablePlan, created_at: '2026-07-14T01:00:00.000Z' };
    writeFileSync(storedPlanPath, canonicalJson(presentationOnly), { mode: 0o600 });
    assert.equal(initializeTransaction({
      home,
      plan: executablePlan,
      transactionId: executableTransactionId,
      confirmation: executablePlan.plan_hash,
    }).state.state, 'RESTORED');

    writeFileSync(storedPlanPath, canonicalJson({ invalid: true }), { mode: 0o600 });
    assert.throws(
      () => initializeTransaction({
        home,
        plan: executablePlan,
        transactionId: executableTransactionId,
        confirmation: executablePlan.plan_hash,
      }),
      (error) => error instanceof CleanupTransactionError
        && error.status === 'recovery_required',
    );
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('every declared coordinator seam survives a real SIGKILL and converges', {
  timeout: 120_000,
}, async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    ensureMacosHelper({ home, forceCompile: true });
    const unaffectedSource = writeSkill(join(home, 'unaffected-source'), 'unaffected');
    const unaffectedEntry = join(activeRoot, 'unaffected');
    symlinkSync(unaffectedSource, unaffectedEntry);
    const unaffectedTarget = readlinkSync(unaffectedEntry);

    for (const [index, phase] of APPLY_FAULT_PHASES.entries()) {
      const source = writeSkill(join(home, 'apply-sources', String(index)), `apply-${index}`);
      const sourceBytes = readFileSync(join(source, 'SKILL.md'));
      const entryPath = join(activeRoot, `apply-${index}`);
      symlinkSync(source, entryPath);
      const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
        entry_kind: 'symlink',
        entry_identity: {
          raw_link_target_base64: Buffer.from(source).toString('base64'),
        },
      });
      const plan = planForIdentity(identity, index.toString(16).padStart(32, '0'));
      const planPath = join(home, `apply-plan-${index}.json`);
      writeFileSync(planPath, canonicalJson(plan), { mode: 0o600 });
      const killed = await runCleanupCli([
        'cleanup',
        'apply',
        '--plan',
        planPath,
        '--confirm',
        plan.plan_hash,
        '--json',
      ], home, {
        SKILLS_REFINER_TEST_FAULT: phase,
        SKILLS_REFINER_TEST_ROOT: home,
      });
      assert.equal(
        killed.signal,
        'SIGKILL',
        `apply seam ${phase} must use a real SIGKILL: ${JSON.stringify(killed)}`,
      );

      const status = await runCleanupCli([
        'cleanup',
        'status',
        plan.items[0].transaction_id,
        '--json',
      ], home);
      if (phase === 'before_state_planned') {
        assert.equal(status.status, 10, `apply seam ${phase} status`);
        assert.equal(status.response?.error_code, 'transaction_unavailable');
      } else {
        assert.equal(status.status, 0, `apply seam ${phase} status`);
        assert.equal(status.response?.schema_version, 'skills-refiner.cleanup.transaction.v1');
        assert.doesNotMatch(status.response?.next_safe_command ?? '', /cleanup status/u, phase);
        assert.equal(
          onlyStoredTransactionId(home, entryPath),
          plan.items[0].transaction_id,
          phase,
        );
      }

      const converged = await applyItem({
        home,
        plan,
        confirmation: plan.plan_hash,
      });
      assert.ok(['committed', 'already_committed'].includes(converged.status), phase);
      const applyMoveAlreadyOccurred = APPLY_FAULT_PHASES.indexOf(phase)
        >= APPLY_FAULT_PHASES.indexOf('after_move');
      assert.equal(converged.mutation_occurred, !applyMoveAlreadyOccurred, phase);
      assert.equal(existsSync(entryPath), false, phase);
      assert.deepEqual(readFileSync(join(source, 'SKILL.md')), sourceBytes, phase);
      assert.equal(readlinkSync(unaffectedEntry), unaffectedTarget, phase);
    }

    for (const [index, phase] of RESTORE_FAULT_PHASES.entries()) {
      const skillName = `restore-${index}`;
      const source = writeSkill(join(home, 'restore-sources', skillName), skillName);
      const sourceBytes = readFileSync(join(source, 'SKILL.md'));
      const entryPath = join(activeRoot, skillName);
      const relativeTarget = `../../restore-sources/${skillName}`;
      symlinkSync(relativeTarget, entryPath);
      const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
        entry_kind: 'symlink',
        entry_identity: {
          raw_link_target_base64: Buffer.from(relativeTarget).toString('base64'),
        },
      });
      const plan = planForIdentity(
        identity,
        (APPLY_FAULT_PHASES.length + index).toString(16).padStart(32, '0'),
      );
      const applied = await applyItem({ home, plan, confirmation: plan.plan_hash });
      assert.equal(applied.status, 'committed');
      const transactionId = plan.items[0].transaction_id;
      const killed = await runCleanupCli([
        'cleanup',
        'undo',
        transactionId,
        '--confirm',
        transactionId,
        '--json',
      ], home, {
        SKILLS_REFINER_TEST_FAULT: phase,
        SKILLS_REFINER_TEST_ROOT: home,
      });
      assert.equal(
        killed.signal,
        'SIGKILL',
        `restore seam ${phase} must use a real SIGKILL: ${JSON.stringify(killed)}`,
      );

      const status = await runCleanupCli([
        'cleanup',
        'status',
        transactionId,
        '--json',
      ], home);
      assert.equal(status.status, 0, `restore seam ${phase} status`);
      assert.equal(status.response?.schema_version, 'skills-refiner.cleanup.transaction.v1');
      assert.doesNotMatch(status.response?.next_safe_command ?? '', /cleanup status/u, phase);
      assert.equal(
        onlyStoredTransactionId(home, entryPath),
        transactionId,
        phase,
      );

      const converged = await undoTransaction({
        home,
        transactionId,
        confirmation: transactionId,
      });
      assert.ok(['restored', 'already_restored'].includes(converged.status), phase);
      const restoreMoveAlreadyOccurred = RESTORE_FAULT_PHASES.indexOf(phase)
        >= RESTORE_FAULT_PHASES.indexOf('after_restore_move');
      assert.equal(converged.mutation_occurred, !restoreMoveAlreadyOccurred, phase);
      assert.equal(readlinkSync(entryPath), relativeTarget, phase);
      assert.deepEqual(readFileSync(join(source, 'SKILL.md')), sourceBytes, phase);
      assert.equal(readlinkSync(unaffectedEntry), unaffectedTarget, phase);
    }
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('native post-rename crash seams remain reconcilable without false success', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    const source = writeSkill(join(home, 'native-crash-source'), 'native-crash-source');
    const entryPath = join(activeRoot, 'native-crash-entry');
    symlinkSync(source, entryPath);
    ensureMacosHelper({ home, forceCompile: true });
    const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    const plan = planForIdentity(identity, 'f'.repeat(32));
    const transactionId = plan.items[0].transaction_id;
    const initializedManifest = {
      schema_version: 'skills-refiner.cleanup.transaction-manifest.v1',
      transaction_id: transactionId,
      storage_key: transactionId.slice('sha256:'.length),
      plan_hash: plan.plan_hash,
      item_id: plan.items[0].item_id,
      item_hash: plan.items[0].item_hash,
      platform: plan.platform,
      entry_path: entryPath,
      active_root: activeRoot,
      entry_kind: identity.entry_kind,
      payload_relative_directory: `transactions/${transactionId.slice('sha256:'.length)}/payload`,
      payload_leaf: `entry-${sha256Json({ item_id: plan.items[0].item_id }).slice('sha256:'.length)}`,
      execution_identity: identity,
    };
    const initializedState = {
      schema_version: 'skills-refiner.cleanup.transaction-state.v1',
      transaction_id: transactionId,
      plan_hash: plan.plan_hash,
      item_id: plan.items[0].item_id,
      item_hash: plan.items[0].item_hash,
      state: 'PLANNED',
      sequence: 0,
      updated_at: plan.created_at,
      lock: null,
      outcome: null,
    };

    assert.throws(
      () => __testing.initializeTransactionWithCrash({
        home,
        transactionId,
        plan,
        manifest: initializedManifest,
        state: initializedState,
        executionIdentity: identity,
      }, 'before_transaction_publish'),
      (error) => error instanceof MacosAdapterError
        && error.code === 'recovery_required'
        && error.reason === 'helper_mutation_result_unknown',
    );
    assert.throws(
      () => statusTransaction({ home, transactionId }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'transaction_unavailable' && error.status === 'blocked',
    );
    assert.equal(
      readdirSync(join(home, '.agents/skills-quarantine/transactions'))
        .filter((leaf) => leaf.startsWith('.skills-refiner-tx-')).length,
      1,
    );

    assert.throws(
      () => __testing.initializeTransactionWithCrash({
        home,
        transactionId,
        plan,
        manifest: initializedManifest,
        state: initializedState,
        executionIdentity: identity,
      }),
      (error) => error instanceof MacosAdapterError
        && error.code === 'recovery_required'
        && error.reason === 'helper_mutation_result_unknown',
    );
    assert.deepEqual(
      probeTransactionRecords({ home, transactionId, executionIdentity: identity }).plan,
      plan,
    );

    assert.throws(
      () => __testing.acquireTransactionLockWithCrash({
        home,
        transactionId,
        planHash: plan.plan_hash,
        executionIdentity: identity,
      }, 'before_lock_publish'),
      (error) => error instanceof MacosAdapterError
        && error.code === 'recovery_required'
        && error.reason === 'helper_mutation_result_unknown',
    );
    assert.equal(probeTransactionRecords({
      home,
      transactionId,
      executionIdentity: identity,
    }).lock, null);
    assert.equal(statusTransaction({ home, transactionId }).status, 'ready_to_resume_apply');
    assert.equal(
      readdirSync(join(home, '.agents/skills-quarantine'))
        .filter((leaf) => leaf.startsWith('.skills-refiner-lock-')).length,
      1,
    );

    assert.throws(
      () => __testing.acquireTransactionLockWithCrash({
        home,
        transactionId,
        planHash: plan.plan_hash,
        executionIdentity: identity,
      }),
      (error) => error instanceof MacosAdapterError
        && error.code === 'recovery_required'
        && error.reason === 'helper_mutation_result_unknown',
    );
    const crashedLock = probeTransactionRecords({
      home,
      transactionId,
      executionIdentity: identity,
    }).lock;
    assert.equal(crashedLock.pid, process.pid);
    releaseTransactionLock({
      home,
      transactionId,
      planHash: plan.plan_hash,
      owner: crashedLock,
      executionIdentity: identity,
    });

    const transaction = initializeTransaction({
      home,
      plan,
      transactionId,
      confirmation: plan.plan_hash,
    });
    const owner = acquireTransactionLock({
      home,
      transactionId,
      planHash: plan.plan_hash,
      executionIdentity: identity,
    });
    const confirmedState = {
      ...transaction.state,
      state: 'CONFIRMED',
      sequence: 1,
      updated_at: '2026-07-14T00:00:01.000Z',
      lock: owner,
    };
    assert.throws(
      () => __testing.advanceTransactionStateWithCrash({
        home,
        transactionId,
        planHash: plan.plan_hash,
        currentState: transaction.state,
        nextState: confirmedState,
        owner,
        executionIdentity: identity,
      }, 'before_transaction_state_publish'),
      (error) => error instanceof MacosAdapterError
        && error.code === 'recovery_required'
        && error.reason === 'helper_mutation_result_unknown',
    );
    assert.deepEqual(
      probeTransactionRecords({ home, transactionId, executionIdentity: identity }).state,
      transaction.state,
    );
    assert.equal(
      readdirSync(join(
        home,
        '.agents/skills-quarantine/transactions',
        transactionId.slice('sha256:'.length),
      )).filter((leaf) => leaf.startsWith('.skills-refiner-state-')).length,
      1,
    );

    assert.throws(
      () => __testing.advanceTransactionStateWithCrash({
        home,
        transactionId,
        planHash: plan.plan_hash,
        currentState: transaction.state,
        nextState: confirmedState,
        owner,
        executionIdentity: identity,
      }),
      (error) => error instanceof MacosAdapterError
        && error.code === 'recovery_required'
        && error.reason === 'helper_mutation_result_unknown',
    );
    assert.deepEqual(
      probeTransactionRecords({ home, transactionId, executionIdentity: identity }).state,
      confirmedState,
    );
    releaseTransactionLock({
      home,
      transactionId,
      planHash: plan.plan_hash,
      owner,
      executionIdentity: identity,
    });
    assert.equal(statusTransaction({ home, transactionId }).status, 'ready_to_resume_apply');

    const restoreSource = writeSkill(join(home, 'native-restore-source'), 'native-restore-source');
    const restoreEntry = join(activeRoot, 'native-restore-entry');
    const relativeTarget = '../../native-restore-source';
    symlinkSync(relativeTarget, restoreEntry);
    const restoreIdentity = await createMacosAdapter({ home }).inspectForPlan(
      restoreEntry,
      activeRoot,
      {
        entry_kind: 'symlink',
        entry_identity: {
          raw_link_target_base64: Buffer.from(relativeTarget).toString('base64'),
        },
      },
    );
    const restorePlan = planForIdentity(restoreIdentity, 'e'.repeat(32));
    await applyItem({ home, plan: restorePlan, confirmation: restorePlan.plan_hash });
    const restoreTransactionId = restorePlan.items[0].transaction_id;
    let restoreTransaction = initializeTransaction({
      home,
      plan: restorePlan,
      transactionId: restoreTransactionId,
      confirmation: restorePlan.plan_hash,
    });
    const restoreOwner = acquireTransactionLock({
      home,
      transactionId: restoreTransactionId,
      planHash: restorePlan.plan_hash,
      executionIdentity: restoreIdentity,
    });
    restoreTransaction = advanceTransactionState(
      restoreTransaction,
      'RESTORE_PREPARED',
      { owner: restoreOwner },
    );
    restoreTransaction = advanceTransactionState(
      restoreTransaction,
      'RESTORING',
      { owner: restoreOwner },
    );
    assert.throws(
      () => __testing.restoreWithCrash({ home, manifest: restoreTransaction.manifest }),
      (error) => error instanceof MacosAdapterError
        && error.code === 'recovery_required'
        && error.reason === 'helper_mutation_result_unknown',
    );
    assert.equal(readlinkSync(restoreEntry), relativeTarget);
    releaseTransactionLock({
      home,
      transactionId: restoreTransactionId,
      planHash: restorePlan.plan_hash,
      owner: restoreOwner,
      executionIdentity: restoreIdentity,
    });
    assert.equal(
      statusTransaction({ home, transactionId: restoreTransactionId }).status,
      'ready_to_finalize_restore',
    );
    assert.equal((await undoTransaction({
      home,
      transactionId: restoreTransactionId,
      confirmation: restoreTransactionId,
    })).status, 'restored');
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('status and undo use only the uniquely matching historical helper', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    const source = writeSkill(join(home, 'historical-source'), 'historical-source');
    const entryPath = join(activeRoot, 'historical-entry');
    symlinkSync(source, entryPath);
    ensureMacosHelper({ home, forceCompile: true });
    const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    const plan = planForIdentity(identity, 'd'.repeat(32));
    const transactionId = plan.items[0].transaction_id;
    assert.equal((await applyItem({
      home,
      plan,
      confirmation: plan.plan_hash,
    })).status, 'committed');

    const isolatedDistribution = join(home, 'isolated-distribution');
    const isolatedBin = join(isolatedDistribution, 'bin');
    const isolatedLib = join(isolatedDistribution, 'lib');
    mkdirSync(isolatedBin, { recursive: true });
    mkdirSync(isolatedLib, { recursive: true });
    copyFileSync(CLI_LAUNCHER, join(isolatedBin, 'skills-refiner'));
    chmodSync(join(isolatedBin, 'skills-refiner'), 0o700);
    for (const leaf of [
      'cleanup-cli.mjs',
      'cleanup-contract.mjs',
      'cleanup-core.mjs',
      'cleanup-macos.mjs',
      'cleanup-transaction.mjs',
    ]) {
      copyFileSync(
        fileURLToPath(new URL(`../lib/${leaf}`, import.meta.url)),
        join(isolatedLib, leaf),
      );
    }
    assert.equal(existsSync(join(isolatedDistribution, 'native')), false);
    const isolatedCli = (args) => runNativeHelper(
      join(isolatedBin, 'skills-refiner'),
      args,
      '',
      home,
      { SKILLS_REFINER_NODE_BIN: process.execPath },
    );
    const status = await isolatedCli(['cleanup', 'status', transactionId, '--json']);
    assert.equal(status.status, 0);
    assert.equal(status.response?.status, 'committed');
    const undo = await isolatedCli([
      'cleanup',
      'undo',
      transactionId,
      '--confirm',
      transactionId,
      '--json',
    ]);
    assert.equal(undo.status, 0);
    assert.equal(undo.response?.status, 'restored');
    assert.equal(readlinkSync(entryPath), source);

    rmSync(dirname(identity.cache_path), { recursive: true, force: true });
    __testing.clearHelperCache();
    assert.throws(
      () => statusTransaction({ home, transactionId }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'transaction_helper_identity_ambiguous'
        && error.status === 'recovery_required',
    );
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('receipt-backed installed directories quarantine and restore without copy semantics', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.agents/skills');
    mkdirSync(activeRoot, { recursive: true });
    const entryPath = writeSkill(join(activeRoot, 'installed-directory'), 'installed-directory');
    mkdirSync(join(entryPath, 'nested'), { recursive: true });
    writeFileSync(join(entryPath, 'nested', 'read-only.txt'), 'read-only\n', { mode: 0o400 });
    symlinkSync('../SKILL.md', join(entryPath, 'nested', 'internal-link'));
    const tree = installedTreeSha1(home, entryPath, 'before');
    const receiptPath = join(home, '.agents/.skill-lock.json');
    writeFileSync(receiptPath, `${JSON.stringify({
      version: 3,
      skills: {
        'installed-directory': {
          source: 'fixture',
          sourceType: 'github',
          sourceUrl: 'https://example.invalid/fixture.git',
          skillPath: 'skills/installed-directory',
          skillFolderHash: tree,
        },
      },
    })}\n`, { mode: 0o600 });
    const receiptSha256 = createHash('sha256').update(readFileSync(receiptPath)).digest('hex');
    ensureMacosHelper({ home, forceCompile: true });
    const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_path: entryPath,
      active_root: activeRoot,
      entry_kind: 'directory',
      mutation_eligibility: 'eligible',
      source: { git_root: null },
      evidence: {
        mutation_provenance: {
          kind: 'installed_copy',
          confidence: 'direct',
          evidence: {
            kind: 'content_bound_installer_receipt',
            receipt_sha256: receiptSha256,
            installed_tree_sha1: tree,
          },
        },
      },
    });
    const plan = planForIdentity(identity, 'c'.repeat(32));
    const applied = await applyItem({ home, plan, confirmation: plan.plan_hash });
    assert.equal(applied.status, 'committed');
    assert.equal(existsSync(entryPath), false);
    const transactionId = plan.items[0].transaction_id;
    const restored = await undoTransaction({
      home,
      transactionId,
      confirmation: transactionId,
    });
    assert.equal(restored.status, 'restored');
    assert.equal(lstatSync(entryPath).isDirectory(), true);
    assert.equal(installedTreeSha1(home, entryPath, 'after'), tree);
    assert.equal(lstatSync(join(entryPath, 'nested', 'read-only.txt')).mode & 0o777, 0o400);
    assert.equal(readlinkSync(join(entryPath, 'nested', 'internal-link')), '../SKILL.md');
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('ambiguous intent is durably terminal while payload drift remains preserved', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    ensureMacosHelper({ home, forceCompile: true });

    const lostSource = writeSkill(join(home, 'lost-source'), 'lost-source');
    const lostEntry = join(activeRoot, 'lost-entry');
    symlinkSync(lostSource, lostEntry);
    const lostIdentity = await createMacosAdapter({ home }).inspectForPlan(
      lostEntry,
      activeRoot,
      {
        entry_kind: 'symlink',
        entry_identity: {
          raw_link_target_base64: Buffer.from(lostSource).toString('base64'),
        },
      },
    );
    const lostPlan = planForIdentity(lostIdentity, 'b'.repeat(32));
    const lostTransactionId = lostPlan.items[0].transaction_id;
    let lostTransaction = initializeTransaction({
      home,
      plan: lostPlan,
      transactionId: lostTransactionId,
      confirmation: lostPlan.plan_hash,
    });
    const lostOwner = acquireTransactionLock({
      home,
      transactionId: lostTransactionId,
      planHash: lostPlan.plan_hash,
      executionIdentity: lostIdentity,
    });
    for (const state of ['CONFIRMED', 'PREPARED', 'APPLYING']) {
      lostTransaction = advanceTransactionState(lostTransaction, state, { owner: lostOwner });
    }
    releaseTransactionLock({
      home,
      transactionId: lostTransactionId,
      planHash: lostPlan.plan_hash,
      owner: lostOwner,
      executionIdentity: lostIdentity,
    });
    unlinkSync(lostEntry);
    await assert.rejects(
      applyItem({ home, plan: lostPlan, confirmation: lostPlan.plan_hash }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'transaction_state_incoherent'
        && error.status === 'recovery_required',
    );
    const lostRecords = probeTransactionRecords({
      home,
      transactionId: lostTransactionId,
      executionIdentity: lostIdentity,
    });
    assert.equal(lostRecords.state.state, 'RECOVERY_REQUIRED');
    assert.equal(lostRecords.lock, null);
    assert.equal(existsSync(lostEntry), false);

    const payloadSource = writeSkill(join(home, 'payload-source'), 'payload-source');
    const payloadEntry = join(activeRoot, 'payload-entry');
    symlinkSync(payloadSource, payloadEntry);
    const payloadIdentity = await createMacosAdapter({ home }).inspectForPlan(
      payloadEntry,
      activeRoot,
      {
        entry_kind: 'symlink',
        entry_identity: {
          raw_link_target_base64: Buffer.from(payloadSource).toString('base64'),
        },
      },
    );
    const payloadPlan = planForIdentity(payloadIdentity, 'a'.repeat(32));
    await applyItem({ home, plan: payloadPlan, confirmation: payloadPlan.plan_hash });
    const payloadTransactionId = payloadPlan.items[0].transaction_id;
    const payloadTransaction = initializeTransaction({
      home,
      plan: payloadPlan,
      transactionId: payloadTransactionId,
      confirmation: payloadPlan.plan_hash,
    });
    const payloadPath = join(
      home,
      '.agents/skills-quarantine/transactions',
      payloadTransaction.manifest.storage_key,
      'payload',
      payloadTransaction.manifest.payload_leaf,
    );
    const competingSource = writeSkill(join(home, 'payload-competing'), 'payload-competing');
    unlinkSync(payloadPath);
    symlinkSync(competingSource, payloadPath);
    await assert.rejects(
      undoTransaction({
        home,
        transactionId: payloadTransactionId,
        confirmation: payloadTransactionId,
      }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'reconcile_identity_mismatch'
        && error.status === 'recovery_required',
    );
    assert.equal(readlinkSync(payloadPath), competingSource);
    assert.equal(existsSync(payloadEntry), false);
    assert.equal(probeTransactionRecords({
      home,
      transactionId: payloadTransactionId,
      executionIdentity: payloadIdentity,
    }).state.state, 'COMMITTED');
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('Git authoring drift blocks status, apply, and undo without leaking a lease', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    ensureMacosHelper({ home, forceCompile: true });
    const source = writeSkill(join(home, 'git-drift-source'), 'git-drift-source');
    const entryPath = join(activeRoot, 'git-drift-entry');
    symlinkSync(source, entryPath);
    let identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    let plan = planForIdentity(identity, 'c'.repeat(32));
    let transactionId = plan.items[0].transaction_id;
    initializeTransaction({
      home,
      plan,
      transactionId,
      confirmation: plan.plan_hash,
    });
    mkdirSync(join(activeRoot, '.git'));

    assert.throws(
      () => statusTransaction({ home, transactionId }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'authoring_source_changed'
        && error.status === 'blocked'
        && error.mutationOccurred === false
        && error.transactionHasMutated === false,
    );
    assert.equal(probeTransactionRecords({
      home,
      transactionId,
      executionIdentity: identity,
    }).lock, null);
    await assert.rejects(
      applyItem({ home, plan, confirmation: plan.plan_hash }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'authoring_source_changed'
        && error.status === 'blocked'
        && error.mutationOccurred === false,
    );
    assert.equal(readlinkSync(entryPath), source);

    rmSync(join(activeRoot, '.git'), { recursive: true });
    const changedSource = writeSkill(join(home, 'identity-drift-source'), 'identity-drift-source');
    unlinkSync(entryPath);
    symlinkSync(changedSource, entryPath);
    await assert.rejects(
      applyItem({ home, plan, confirmation: plan.plan_hash }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'preflight_identity_drift'
        && error.status === 'blocked'
        && error.mutationOccurred === false
        && error.transactionState === 'PLANNED',
    );
    assert.equal(readlinkSync(entryPath), changedSource);
    unlinkSync(entryPath);
    symlinkSync(source, entryPath);
    identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    plan = planForIdentity(identity, 'f'.repeat(32));
    transactionId = plan.items[0].transaction_id;
    const applied = await applyItem({ home, plan, confirmation: plan.plan_hash });
    assert.equal(applied.status, 'committed');
    mkdirSync(join(activeRoot, '.git'));
    await assert.rejects(
      undoTransaction({ home, transactionId, confirmation: transactionId }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'authoring_source_changed'
        && error.status === 'blocked'
        && error.mutationOccurred === false
        && error.transactionHasMutated === true
        && error.committedTransactionIds[0] === transactionId,
    );
    assert.equal(existsSync(entryPath), false);
    rmSync(join(activeRoot, '.git'), { recursive: true });
    assert.equal((await undoTransaction({
      home,
      transactionId,
      confirmation: transactionId,
    })).status, 'restored');
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('post-move state conflicts escalate to recovery with exact mutation truth', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    ensureMacosHelper({ home, forceCompile: true });
    const source = writeSkill(join(home, 'state-conflict-source'), 'state-conflict-source');
    const entryPath = join(activeRoot, 'state-conflict-entry');
    symlinkSync(source, entryPath);
    const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    const plan = planForIdentity(identity, 'd'.repeat(32));
    const transactionId = plan.items[0].transaction_id;
    let applyError;
    try {
      await applyItem({
        home,
        plan,
        confirmation: plan.plan_hash,
        fault: async (phase) => {
          if (phase !== 'before_state_committed') return;
          const records = probeTransactionRecords({ home, transactionId, executionIdentity: identity });
          const nextState = {
            ...records.state,
            state: 'RECOVERY_REQUIRED',
            sequence: records.state.sequence + 1,
            updated_at: new Date().toISOString(),
            lock: records.lock,
          };
          advanceTransactionStateRecord({
            home,
            transactionId,
            planHash: plan.plan_hash,
            currentState: records.state,
            nextState,
            owner: records.lock,
            executionIdentity: identity,
          });
        },
      });
    } catch (error) {
      applyError = error;
    }
    assert.ok(applyError instanceof CleanupTransactionError);
    assert.equal(applyError.code, 'state_cas_mismatch');
    assert.equal(applyError.status, 'recovery_required');
    assert.equal(applyError.mutationOccurred, true);
    assert.equal(applyError.mutationOutcome, 'moved');
    assert.equal(applyError.transactionState, 'RECOVERY_REQUIRED');
    assert.equal(applyError.transactionLocation, 'quarantine');
    assert.equal(applyError.transactionHasMutated, true);
    assert.equal(existsSync(entryPath), false);
    assert.equal(probeTransactionRecords({
      home,
      transactionId,
      executionIdentity: identity,
    }).lock, null);
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('RESTORE_PREPARED plus original is read-only in status and terminal in undo', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    ensureMacosHelper({ home, forceCompile: true });
    const source = writeSkill(join(home, 'restore-intent-source'), 'restore-intent-source');
    const entryPath = join(activeRoot, 'restore-intent-entry');
    symlinkSync(source, entryPath);
    const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    const plan = planForIdentity(identity, 'e'.repeat(32));
    const transactionId = plan.items[0].transaction_id;
    await applyItem({ home, plan, confirmation: plan.plan_hash });
    let transaction = initializeTransaction({
      home,
      plan,
      transactionId,
      confirmation: plan.plan_hash,
    });
    const owner = acquireTransactionLock({
      home,
      transactionId,
      planHash: plan.plan_hash,
      executionIdentity: identity,
    });
    transaction = advanceTransactionState(transaction, 'RESTORE_PREPARED', { owner });
    releaseTransactionLock({
      home,
      transactionId,
      planHash: plan.plan_hash,
      owner,
      executionIdentity: identity,
    });
    const payloadPath = join(
      home,
      '.agents/skills-quarantine/transactions',
      transaction.manifest.storage_key,
      'payload',
      transaction.manifest.payload_leaf,
    );
    renameSync(payloadPath, entryPath);

    assert.throws(
      () => statusTransaction({ home, transactionId }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'restore_without_intent'
        && error.status === 'recovery_required'
        && error.mutationOccurred === false
        && error.transactionState === 'RESTORE_PREPARED',
    );
    assert.equal(probeTransactionRecords({
      home,
      transactionId,
      executionIdentity: identity,
    }).state.state, 'RESTORE_PREPARED');
    await assert.rejects(
      undoTransaction({ home, transactionId, confirmation: transactionId }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'restore_without_intent'
        && error.status === 'recovery_required'
        && error.mutationOccurred === false
        && error.transactionState === 'RECOVERY_REQUIRED',
    );
    assert.equal(probeTransactionRecords({
      home,
      transactionId,
      executionIdentity: identity,
    }).state.state, 'RECOVERY_REQUIRED');
    assert.equal(readlinkSync(entryPath), source);
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('occupied restore is no-clobber and sanitizer-clean', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    const source = writeSkill(join(home, 'asan-source'), 'asan-source');
    const competingSource = writeSkill(join(home, 'asan-competing'), 'asan-competing');
    const entryPath = join(activeRoot, 'asan-entry');
    symlinkSync(source, entryPath);
    ensureMacosHelper({ home, forceCompile: true });
    const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
      entry_kind: 'symlink',
      entry_identity: {
        raw_link_target_base64: Buffer.from(source).toString('base64'),
      },
    });
    const plan = planForIdentity(identity, '9'.repeat(32));
    await applyItem({ home, plan, confirmation: plan.plan_hash });
    const transaction = initializeTransaction({
      home,
      plan,
      transactionId: plan.items[0].transaction_id,
      confirmation: plan.plan_hash,
    });
    symlinkSync(competingSource, entryPath);

    const sanitizerHelper = join(home, 'cleanup-macos-helper-asan');
    const compilation = spawnSync('/usr/bin/xcrun', [
      '--sdk',
      'macosx',
      'clang',
      '-std=c17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O1',
      '-g',
      '-fsanitize=address,undefined',
      '-fno-omit-frame-pointer',
      __testing.HELPER_SOURCE,
      '-o',
      sanitizerHelper,
    ], { encoding: 'utf8' });
    assert.equal(compilation.status, 0, compilation.stderr);
    const sanitizerEnvironment = {
      HOME: home,
      LANG: 'C',
      LC_ALL: 'C',
      PATH: '/usr/bin:/bin',
      ASAN_OPTIONS: 'abort_on_error=1',
      UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1',
    };
    const forwardSource = writeSkill(join(home, 'asan-forward-source'), 'asan-forward-source');
    const forwardEntry = join(activeRoot, 'asan-forward-entry');
    symlinkSync(forwardSource, forwardEntry);
    const forwardIdentity = await createMacosAdapter({ home }).inspectForPlan(
      forwardEntry,
      activeRoot,
      {
        entry_kind: 'symlink',
        entry_identity: {
          raw_link_target_base64: Buffer.from(forwardSource).toString('base64'),
        },
      },
    );
    const forwardArguments = [
      'rename-exclusive',
      home,
      activeRoot,
      forwardEntry,
      transaction.manifest.payload_relative_directory,
      'asan-forward-ok',
      forwardIdentity.device,
      forwardIdentity.inode,
      forwardIdentity.manifest_hash,
      '-',
    ];
    const forward = spawnSync(sanitizerHelper, forwardArguments, {
      encoding: 'utf8',
      env: sanitizerEnvironment,
    });
    assert.equal(forward.status, 0, forward.stderr);
    assert.doesNotMatch(forward.stderr, /AddressSanitizer|UndefinedBehaviorSanitizer|runtime error/u);
    assert.equal(existsSync(forwardEntry), false);

    const conflictSource = writeSkill(join(home, 'asan-forward-conflict'), 'asan-forward-conflict');
    const conflictEntry = join(activeRoot, 'asan-forward-conflict');
    symlinkSync(conflictSource, conflictEntry);
    const conflictIdentity = await createMacosAdapter({ home }).inspectForPlan(
      conflictEntry,
      activeRoot,
      {
        entry_kind: 'symlink',
        entry_identity: {
          raw_link_target_base64: Buffer.from(conflictSource).toString('base64'),
        },
      },
    );
    const forwardConflict = spawnSync(sanitizerHelper, [
      'rename-exclusive',
      home,
      activeRoot,
      conflictEntry,
      transaction.manifest.payload_relative_directory,
      transaction.manifest.payload_leaf,
      conflictIdentity.device,
      conflictIdentity.inode,
      conflictIdentity.manifest_hash,
      '-',
    ], { encoding: 'utf8', env: sanitizerEnvironment });
    assert.equal(forwardConflict.status, 10, forwardConflict.stderr);
    assert.equal(JSON.parse(forwardConflict.stdout).reason, 'destination_exists');
    assert.doesNotMatch(
      forwardConflict.stderr,
      /AddressSanitizer|UndefinedBehaviorSanitizer|runtime error/u,
    );
    assert.equal(readlinkSync(conflictEntry), conflictSource);
    const restore = spawnSync(sanitizerHelper, [
      'restore-exclusive',
      home,
      activeRoot,
      entryPath,
      transaction.manifest.transaction_id,
      transaction.manifest.payload_leaf,
      identity.device,
      identity.inode,
      identity.manifest_hash,
    ], {
      encoding: 'utf8',
      env: sanitizerEnvironment,
    });
    assert.equal(restore.status, 10, restore.stderr);
    assert.equal(JSON.parse(restore.stdout).reason, 'restore_destination_occupied');
    assert.doesNotMatch(restore.stderr, /AddressSanitizer|UndefinedBehaviorSanitizer|runtime error/u);
    assert.equal(readlinkSync(entryPath), competingSource);
    assert.equal(readlinkSync(join(
      home,
      '.agents/skills-quarantine/transactions',
      transaction.manifest.storage_key,
      'payload',
      transaction.manifest.payload_leaf,
    )), source);
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('status never isolates another transaction lock or an identity-mismatched owner', async () => {
  const home = makeSandbox();
  try {
    const activeRoot = join(home, '.claude/skills');
    mkdirSync(activeRoot, { recursive: true });
    ensureMacosHelper({ home, forceCompile: true });
    const transactions = [];
    for (const [index, authorization] of ['7', '8'].entries()) {
      const source = writeSkill(join(home, `lock-source-${index}`), `lock-source-${index}`);
      const entryPath = join(activeRoot, `lock-entry-${index}`);
      symlinkSync(source, entryPath);
      const identity = await createMacosAdapter({ home }).inspectForPlan(entryPath, activeRoot, {
        entry_kind: 'symlink',
        entry_identity: {
          raw_link_target_base64: Buffer.from(source).toString('base64'),
        },
      });
      const plan = planForIdentity(identity, authorization.repeat(32));
      const transactionId = plan.items[0].transaction_id;
      initializeTransaction({
        home,
        plan,
        transactionId,
        confirmation: plan.plan_hash,
      });
      transactions.push({ identity, plan, transactionId });
    }
    const [ownerTransaction, otherTransaction] = transactions;
    const owner = acquireTransactionLock({
      home,
      transactionId: ownerTransaction.transactionId,
      planHash: ownerTransaction.plan.plan_hash,
      executionIdentity: ownerTransaction.identity,
    });
    assert.throws(
      () => statusTransaction({ home, transactionId: otherTransaction.transactionId }),
      (error) => error instanceof CleanupTransactionError
        && error.code === 'lock_held_by_other' && error.status === 'blocked',
    );
    assert.throws(
      () => isolateStaleTransactionLock({
        home,
        transactionId: ownerTransaction.transactionId,
        planHash: ownerTransaction.plan.plan_hash,
        owner: { ...owner, process_start_usec: owner.process_start_usec + 1 },
        executionIdentity: ownerTransaction.identity,
      }),
      (error) => error instanceof MacosAdapterError
        && error.code === 'recovery_required' && error.reason === 'lock_identity_mismatch',
    );
    assert.deepEqual(probeTransactionRecords({
      home,
      transactionId: ownerTransaction.transactionId,
      executionIdentity: ownerTransaction.identity,
    }).lock, owner);
    releaseTransactionLock({
      home,
      transactionId: ownerTransaction.transactionId,
      planHash: ownerTransaction.plan.plan_hash,
      owner,
      executionIdentity: ownerTransaction.identity,
    });
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});
