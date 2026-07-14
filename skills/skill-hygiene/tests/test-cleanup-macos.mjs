import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';

import {
  MacosAdapterError,
  __testing,
  acquireBatchLock,
  advanceBatchStateRecord,
  advanceTransactionStateUnderBatchLease,
  compareAndSwapDurableJson,
  createMacosAdapter,
  durableWriteJson,
  ensureMacosHelper,
  ensureReferencedMacosHelper,
  initializeBatchRecords,
  initializeBatchTransactionRecords,
  initializeTransactionRecords,
  isolateStaleBatchLock,
  probeBatchRecords,
  probeBatchTransactionRecords,
  probeDurableJson,
  probeTransactionRecords,
  probeTransactionKind,
  releaseBatchLock,
  renameExclusive,
} from '../lib/cleanup-macos.mjs';
import {
  canonicalJson,
  computeIdentityHash,
  validateObservationIdentity,
  validatePlan,
} from '../lib/cleanup-contract.mjs';
import { compilePlan, compileReview } from '../lib/cleanup-core.mjs';
import {
  makeSandbox,
  onlyTransactionId,
  removeSandbox,
  writeSkill,
} from './cleanup-fixtures.mjs';

const gitEnvironment = (home, extra = {}) => ({
  PATH: '/usr/bin:/bin',
  HOME: home,
  LANG: 'C',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  ...extra,
});

function run(path, args, { home, env = {} } = {}) {
  const result = spawnSync(path, args, {
    encoding: 'utf8',
    env: gitEnvironment(home, env),
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  assert.equal(result.status, 0, `${path} ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function gitTreeSha1(home, entryPath) {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'skills-refiner-test-git-')));
  const repository = join(temporary, 'repo');
  const index = join(temporary, 'index');
  try {
    run('/usr/bin/git', ['init', '--bare', '-q', repository], { home });
    run('/usr/bin/git', [
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
    ], { home, env: { GIT_INDEX_FILE: index } });
    return run('/usr/bin/git', [
      `--git-dir=${repository}`,
      `--work-tree=${entryPath}`,
      'write-tree',
    ], { home, env: { GIT_INDEX_FILE: index } });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Json(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function helperExecutionIdentity(homePath) {
  const helper = ensureMacosHelper({ home: homePath });
  const identity = {
    schema_version: 'skills-refiner.cleanup.identity.v1',
    adapter: 'macos-native.v1',
    entry_path: join(homePath, '.agents/skills/runtime-authority-link'),
    active_root: join(homePath, '.agents/skills'),
    entry_kind: 'symlink',
    source_hash: `sha256:${helper.sourceHash}`,
    binary_hash: `sha256:${helper.binaryHash}`,
    architecture: helper.architecture,
    compiler_path: helper.compilerPath,
    compiler_version: helper.compilerVersion,
    helper_protocol: helper.helperProtocol,
    cache_path: helper.cachePath,
    device: '1',
    inode: '1',
    mode: 0o777,
    uid: process.getuid(),
    gid: process.getgid(),
    flags: 0,
    manifest_hash: `sha256:${'1'.repeat(64)}`,
    security_metadata_hash: `sha256:${'2'.repeat(64)}`,
    raw_link_target_base64: Buffer.from('../runtime-authority').toString('base64'),
    receipt_sha256: null,
    installed_tree_sha1: null,
  };
  identity.identity_hash = computeIdentityHash(identity);
  return identity;
}

function symlinkCandidate(entryPath, activeRoot, target, entryKind = 'symlink') {
  return {
    entry_path: entryPath,
    active_root: activeRoot,
    entry_kind: entryKind,
    mutation_eligibility: 'eligible',
    source: { git_root: dirname(target) },
    entry_identity: {
      entry_path: entryPath,
      active_root: activeRoot,
      entry_kind: entryKind,
      raw_link_target_base64: Buffer.from(target).toString('base64'),
    },
  };
}

function installedCandidate(entryPath, activeRoot, receiptSha256, installedTreeSha1) {
  return {
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
          installed_tree_sha1: installedTreeSha1,
        },
      },
    },
  };
}

function expectAdapterError(code, reason) {
  return (error) => error instanceof MacosAdapterError && error.code === code && error.reason === reason;
}

function initializeRepository(home, repository) {
  mkdirSync(repository, { recursive: true });
  run('/usr/bin/git', ['init', '-q', repository], { home });
  run('/usr/bin/git', ['-C', repository, 'config', 'user.email', 'cleanup@example.invalid'], { home });
  run('/usr/bin/git', ['-C', repository, 'config', 'user.name', 'Cleanup Test'], { home });
}

let home;
let adapter;
let installed;
let installedRoot;
let installedCandidateValue;

test.before(() => {
  home = makeSandbox();
  for (const relativeRoot of [
    '.agents/skills',
    '.claude/skills',
    '.codex/skills',
    '.cursor/skills',
    '.gemini/skills',
    '.copilot/skills',
    '.factory',
    '.github/skills',
  ]) mkdirSync(join(home, relativeRoot), { recursive: true });

  ensureMacosHelper({ home, forceCompile: true });
  adapter = createMacosAdapter({ home });

  installedRoot = join(home, '.agents/skills');
  installed = writeSkill(join(installedRoot, 'Installed Skill 空 格'), 'installed-skill');
  mkdirSync(join(installed, 'nested'), { recursive: true });
  writeFileSync(join(installed, 'nested', 'read only.txt'), 'read-only\n');
  chmodSync(join(installed, 'nested', 'read only.txt'), 0o400);
  symlinkSync('../../outside-target', join(installed, 'nested', 'internal-link'));
  const tree = gitTreeSha1(home, installed);
  const receiptPath = join(home, '.agents/.skill-lock.json');
  writeFileSync(receiptPath, `${JSON.stringify({
    version: 3,
    skills: {
      'Installed Skill 空 格': {
        source: 'fixture',
        sourceType: 'github',
        sourceUrl: 'https://example.invalid/fixture.git',
        skillPath: 'skills/installed',
        skillFolderHash: tree,
      },
    },
  })}\n`, { mode: 0o600 });
  installedCandidateValue = installedCandidate(installed, installedRoot, sha256File(receiptPath), tree);
});

test.after(() => {
  try {
    run('/usr/bin/chflags', ['-R', 'nouchg', home], { home });
  } finally {
    __testing.clearHelperCache();
    removeSandbox(home);
  }
});

test('fixture helpers expose guarded roots and single transaction IDs', () => {
  assert.equal(typeof onlyTransactionId, 'function');
  assert.equal(onlyTransactionId({ items: [{ transaction_id: 'tx' }] }), 'tx');
  assert.throws(() => removeSandbox(join(home, 'not-the-root')), /unverified cleanup sandbox/);
});

test('helper response parsing rejects malformed, oversized, and unknown responses', () => {
  assert.throws(
    () => __testing.parseHelperResult({ stdout: '{', status: 10 }),
    expectAdapterError('blocked', 'helper_output_invalid'),
  );
  assert.throws(
    () => __testing.parseHelperResult({ stdout: 'x'.repeat((2 * 1024 * 1024) + 1), status: 10 }),
    expectAdapterError('blocked', 'helper_output_oversized'),
  );
  assert.throws(
    () => __testing.parseHelperResult({
      stdout: JSON.stringify({ protocol: 'unknown.v1', status: 'ok' }),
      status: 0,
    }),
    expectAdapterError('blocked', 'helper_protocol_mismatch'),
  );
  assert.throws(
    () => __testing.parseHelperResult(
      { stdout: '', status: null, signal: 'SIGKILL' },
      { mutationMayHaveOccurred: true },
    ),
    expectAdapterError('recovery_required', 'helper_mutation_result_unknown'),
  );
  assert.throws(
    () => __testing.parseHelperResult({
      stdout: JSON.stringify({
        protocol: 'skills-refiner.macos-helper.v1',
        status: 'recovery_required',
        reason: 'probe_ambiguous',
      }),
      status: 20,
    }),
    (error) => error instanceof MacosAdapterError
      && error.reason === 'probe_ambiguous'
      && error.mutationMayHaveOccurred === false,
  );
  assert.throws(
    () => __testing.parseHelperResult({
      stdout: JSON.stringify({
        protocol: 'skills-refiner.macos-helper.v1',
        status: 'recovery_required',
        reason: 'rename_ambiguous',
      }),
      status: 20,
    }, { mutationMayHaveOccurred: true }),
    (error) => error instanceof MacosAdapterError
      && error.reason === 'rename_ambiguous'
      && error.mutationMayHaveOccurred === true,
  );
});

test('path authorization rejects relative, nested, unknown, and symlinked active roots', async () => {
  await assert.rejects(
    adapter.inspectForPlan('relative/skill', installedRoot, installedCandidateValue),
    expectAdapterError('blocked', 'invalid_path'),
  );
  await assert.rejects(
    adapter.inspectForPlan(join(installed, 'nested'), installedRoot, installedCandidateValue),
    expectAdapterError('blocked', 'not_immediate_child'),
  );
  await assert.rejects(
    adapter.inspectForPlan(installed, join(home, 'workspace'), installedCandidateValue),
    expectAdapterError('blocked', 'not_immediate_child'),
  );

  const realRoot = join(home, 'factory-real-skills');
  mkdirSync(realRoot);
  symlinkSync(realRoot, join(home, '.factory/skills'));
  const linkedEntry = join(home, '.factory/skills/demo');
  writeSkill(join(realRoot, 'demo'));
  await assert.rejects(
    adapter.inspectForPlan(linkedEntry, join(home, '.factory/skills'), {
      ...installedCandidateValue,
      entry_path: linkedEntry,
      active_root: join(home, '.factory/skills'),
    }),
    expectAdapterError('blocked', 'unsafe_active_root'),
  );
});

test('relative, absolute, chained, external, and broken symlink identities preserve raw bytes', async () => {
  const activeRoot = join(home, '.claude/skills');
  const source = writeSkill(join(home, 'git source'));
  initializeRepository(home, source);
  const external = writeSkill(join(home, 'external source'));
  const targets = new Map([
    ['relative-link', '../../git source'],
    ['absolute-link', source],
    ['external-link', external],
    ['broken-link', '../../missing-target'],
  ]);
  symlinkSync('../../git source', join(activeRoot, 'relative-link'));
  symlinkSync(source, join(activeRoot, 'absolute-link'));
  symlinkSync(external, join(activeRoot, 'external-link'));
  symlinkSync('../../missing-target', join(activeRoot, 'broken-link'));
  symlinkSync('relative-link', join(activeRoot, 'chained-link'));
  targets.set('chained-link', 'relative-link');

  for (const [name, target] of targets) {
    const entryPath = join(activeRoot, name);
    const entryKind = name === 'broken-link' ? 'broken_symlink' : 'symlink';
    const identity = await adapter.inspectForPlan(
      entryPath,
      activeRoot,
      symlinkCandidate(entryPath, activeRoot, target, entryKind),
    );
    assert.equal(identity.entry_kind, entryKind);
    assert.equal(identity.raw_link_target_base64, Buffer.from(target).toString('base64'));
    assert.match(identity.manifest_hash, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(readlinkSync(entryPath), target);
  }

  const metadataLink = join(activeRoot, 'relative-link');
  const metadataCandidate = symlinkCandidate(metadataLink, activeRoot, '../../git source');
  const beforeMetadata = await adapter.inspectForPlan(metadataLink, activeRoot, metadataCandidate);
  run('/usr/bin/xattr', ['-s', '-w', 'com.skills-refiner.test', 'link-value', metadataLink], { home });
  run('/bin/chmod', ['-h', '+a', `${userInfo().username} allow read`, metadataLink], { home });
  const afterMetadata = await adapter.inspectForPlan(metadataLink, activeRoot, metadataCandidate);
  assert.notEqual(afterMetadata.security_metadata_hash, beforeMetadata.security_metadata_hash);
  assert.equal(afterMetadata.raw_link_target_base64, beforeMetadata.raw_link_target_base64);
});

test('receipt-backed installed directory binds tree, security metadata, and internal links no-follow', async () => {
  const first = await adapter.inspectForPlan(installed, installedRoot, installedCandidateValue);
  assert.equal(first.entry_kind, 'directory');
  assert.equal(first.receipt_sha256, installedCandidateValue.evidence.mutation_provenance.evidence.receipt_sha256);
  assert.equal(first.installed_tree_sha1, installedCandidateValue.evidence.mutation_provenance.evidence.installed_tree_sha1);
  assert.equal(first.raw_link_target_base64, null);

  writeFileSync(join(home, 'outside-target'), 'first outside content');
  const outsideFirst = await adapter.inspectForPlan(installed, installedRoot, installedCandidateValue);
  writeFileSync(join(home, 'outside-target'), 'changed outside content');
  const outsideSecond = await adapter.inspectForPlan(installed, installedRoot, installedCandidateValue);
  assert.equal(outsideFirst.manifest_hash, outsideSecond.manifest_hash);

  const nestedFile = join(installed, 'nested', 'read only.txt');
  const nestedDirectory = join(installed, 'nested');
  const internalLink = join(nestedDirectory, 'internal-link');
  chmodSync(nestedFile, 0o600);
  run('/usr/bin/xattr', ['-w', 'com.skills-refiner.test', 'fixture-value', nestedFile], { home });
  run('/usr/bin/xattr', ['-w', 'com.skills-refiner.test', 'directory-value', nestedDirectory], { home });
  run('/usr/bin/xattr', ['-s', '-w', 'com.skills-refiner.test', 'nested-link-value', internalLink], { home });
  chmodSync(nestedFile, 0o400);
  const withXattr = await adapter.inspectForPlan(installed, installedRoot, installedCandidateValue);
  assert.notEqual(withXattr.security_metadata_hash, first.security_metadata_hash);

  const aclRule = `${userInfo().username} allow read`;
  run('/bin/chmod', ['+a', aclRule, nestedFile], { home });
  run('/bin/chmod', ['+a', aclRule, nestedDirectory], { home });
  run('/bin/chmod', ['-h', '+a', aclRule, internalLink], { home });
  const withAcl = await adapter.inspectForPlan(installed, installedRoot, installedCandidateValue);
  assert.notEqual(withAcl.security_metadata_hash, withXattr.security_metadata_hash);

  run('/usr/bin/chflags', ['hidden', nestedFile], { home });
  const hidden = await adapter.inspectForPlan(installed, installedRoot, installedCandidateValue);
  assert.notEqual(hidden.security_metadata_hash, withAcl.security_metadata_hash);
  assert.ok(existsSync(nestedFile));
});

test('immutable, unreadable, FIFO, and socket entries fail closed before mutation', async () => {
  const nestedFile = join(installed, 'nested', 'read only.txt');
  run('/usr/bin/chflags', ['uchg', nestedFile], { home });
  await assert.rejects(
    adapter.inspectForPlan(installed, installedRoot, installedCandidateValue),
    expectAdapterError('blocked', 'metadata_or_tree_blocked'),
  );
  assert.ok(existsSync(installed));
  run('/usr/bin/chflags', ['nouchg', nestedFile], { home });

  chmodSync(nestedFile, 0o000);
  await assert.rejects(
    adapter.inspectForPlan(installed, installedRoot, installedCandidateValue),
    expectAdapterError('blocked', 'metadata_or_tree_blocked'),
  );
  chmodSync(nestedFile, 0o400);

  const fifo = join(installed, 'nested', 'blocked-fifo');
  run('/usr/bin/mkfifo', [fifo], { home });
  await assert.rejects(
    adapter.inspectForPlan(installed, installedRoot, installedCandidateValue),
    expectAdapterError('blocked', 'metadata_or_tree_blocked'),
  );
  rmSync(fifo);

  const oversized = join(installed, 'nested', 'oversized-sparse-file');
  writeFileSync(oversized, '');
  truncateSync(oversized, (512 * 1024 * 1024) + 1);
  await assert.rejects(
    adapter.inspectForPlan(installed, installedRoot, installedCandidateValue),
    expectAdapterError('blocked', 'metadata_or_tree_blocked'),
  );
  rmSync(oversized);

  const socketPath = join(installedRoot, 's');
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(socketPath, resolveListen);
  });
  try {
    await assert.rejects(
      adapter.inspectForPlan(socketPath, installedRoot, {
        ...installedCandidateValue,
        entry_path: socketPath,
      }),
      expectAdapterError('blocked', 'unsupported_entry_kind'),
    );
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('real nested mounts and cross-device quarantine moves fail closed', async () => {
  const sandboxRoot = makeSandbox();
  const imagePath = join(sandboxRoot, 'foreign-volume.dmg');
  let mountedAt = null;
  const detach = () => {
    if (mountedAt !== null) {
      run('/usr/bin/hdiutil', ['detach', '-quiet', mountedAt], { home: sandboxRoot });
      mountedAt = null;
    }
  };
  const attach = (mountPoint) => {
    run('/usr/bin/hdiutil', [
      'attach',
      '-quiet',
      '-nobrowse',
      '-mountpoint',
      mountPoint,
      imagePath,
    ], { home: sandboxRoot });
    mountedAt = mountPoint;
  };
  try {
    run('/usr/bin/hdiutil', [
      'create',
      '-quiet',
      '-size',
      '8m',
      '-fs',
      'HFS+',
      '-volname',
      `skills-refiner-${process.pid}`,
      imagePath,
    ], { home: sandboxRoot });
    const installedActiveRoot = join(sandboxRoot, '.agents/skills');
    mkdirSync(installedActiveRoot, { recursive: true });
    const mountedSkill = writeSkill(join(installedActiveRoot, 'nested-mount'));
    const nestedMount = join(mountedSkill, 'mounted-volume');
    mkdirSync(nestedMount);
    attach(nestedMount);
    assert.notEqual(lstatSync(nestedMount).dev, lstatSync(sandboxRoot).dev);
    writeFileSync(join(nestedMount, 'foreign-content'), 'foreign device');
    ensureMacosHelper({ home: sandboxRoot, forceCompile: true });
    const isolatedAdapter = createMacosAdapter({ home: sandboxRoot });
    await assert.rejects(
      isolatedAdapter.inspectForPlan(
        mountedSkill,
        installedActiveRoot,
        installedCandidate(mountedSkill, installedActiveRoot, 'a'.repeat(64), 'b'.repeat(40)),
      ),
      expectAdapterError('blocked', 'metadata_or_tree_blocked'),
    );
    detach();

    const linkActiveRoot = join(sandboxRoot, '.github/skills');
    mkdirSync(linkActiveRoot, { recursive: true });
    const source = writeSkill(join(sandboxRoot, 'link-source'));
    const entryPath = join(linkActiveRoot, 'cross-device-link');
    symlinkSync(source, entryPath);
    const identity = await isolatedAdapter.inspectForPlan(
      entryPath,
      linkActiveRoot,
      symlinkCandidate(entryPath, linkActiveRoot, source),
    );
    const quarantineMount = join(sandboxRoot, '.agents/skills-quarantine');
    mkdirSync(quarantineMount, { mode: 0o700 });
    attach(quarantineMount);
    chmodSync(quarantineMount, 0o700);
    assert.notEqual(lstatSync(quarantineMount).dev, lstatSync(sandboxRoot).dev);
    assert.throws(
      () => renameExclusive({
        home: sandboxRoot,
        activeRoot: linkActiveRoot,
        entryPath,
        destinationRelativeDirectory: 'transactions/cross-device/payload',
        destinationLeaf: 'opaque-item',
        expectedIdentity: identity,
      }),
      expectAdapterError('blocked', 'cross_device_or_missing_source'),
    );
    assert.equal(readlinkSync(entryPath), source);
  } finally {
    try {
      detach();
    } finally {
      __testing.clearHelperCache();
      removeSandbox(sandboxRoot);
    }
  }
});

test('Git roots, ancestor worktrees, .git files, and proven sources remain review-only', async () => {
  const gitSkill = writeSkill(join(home, '.codex/skills/git-authored'));
  initializeRepository(home, gitSkill);
  const observation = await adapter.inspectIdentity(gitSkill, join(home, '.codex/skills'));
  assert.equal(validateObservationIdentity(observation), observation);
  assert.equal(Object.hasOwn(observation, 'receipt_sha256'), false);
  assert.equal(Object.hasOwn(observation, 'installed_tree_sha1'), false);
  await assert.rejects(
    adapter.inspectForPlan(gitSkill, join(home, '.codex/skills'), installedCandidate(
      gitSkill,
      join(home, '.codex/skills'),
      'a'.repeat(64),
      'b'.repeat(40),
    )),
    expectAdapterError('review_only', 'authoring_source'),
  );

  const ancestorRoot = join(home, '.cursor');
  initializeRepository(home, ancestorRoot);
  const tracked = writeSkill(join(home, '.cursor/skills/tracked'));
  run('/usr/bin/git', ['-C', ancestorRoot, 'add', '-A'], { home });
  writeFileSync(join(tracked, 'SKILL.md'), `${readFileSync(join(tracked, 'SKILL.md'), 'utf8')}\nDirty.\n`);
  await assert.rejects(
    adapter.inspectForPlan(tracked, join(home, '.cursor/skills'), installedCandidate(
      tracked,
      join(home, '.cursor/skills'),
      'a'.repeat(64),
      'b'.repeat(40),
    )),
    expectAdapterError('review_only', 'authoring_source'),
  );

  const gitFileSkill = writeSkill(join(home, '.gemini/skills/git-file'));
  writeFileSync(join(gitFileSkill, '.git'), 'gitdir: /missing/worktree\n');
  await assert.rejects(
    adapter.inspectForPlan(gitFileSkill, join(home, '.gemini/skills'), installedCandidate(
      gitFileSkill,
      join(home, '.gemini/skills'),
      'a'.repeat(64),
      'b'.repeat(40),
    )),
    expectAdapterError('review_only', 'authoring_source'),
  );

  const nestedGitSkill = writeSkill(join(home, '.codex/skills/nested-git-source'));
  initializeRepository(home, join(nestedGitSkill, 'vendor/repository'));
  await assert.rejects(
    adapter.inspectForPlan(nestedGitSkill, join(home, '.codex/skills'), installedCandidate(
      nestedGitSkill,
      join(home, '.codex/skills'),
      'a'.repeat(64),
      'b'.repeat(40),
    )),
    expectAdapterError('review_only', 'authoring_source'),
  );

  const proven = writeSkill(join(home, '.copilot/skills/proven-source'));
  await assert.rejects(
    adapter.inspectForPlan(proven, join(home, '.copilot/skills'), {
      entry_kind: 'directory',
      mutation_eligibility: 'review_only',
      source: { git_root: null },
    }),
    expectAdapterError('review_only', 'authoring_source'),
  );

  const sourceRepository = writeSkill(join(home, 'worktree-source'));
  initializeRepository(home, sourceRepository);
  run('/usr/bin/git', ['-C', sourceRepository, 'add', '-A'], { home });
  run('/usr/bin/git', ['-C', sourceRepository, 'commit', '-q', '-m', 'fixture'], { home });

  const worktree = join(home, '.github/skills/actual-worktree');
  run('/usr/bin/git', ['-C', sourceRepository, 'worktree', 'add', '-q', '-b', 'cleanup-worktree', worktree], { home });
  await assert.rejects(
    adapter.inspectForPlan(worktree, join(home, '.github/skills'), installedCandidate(
      worktree,
      join(home, '.github/skills'),
      'a'.repeat(64),
      'b'.repeat(40),
    )),
    expectAdapterError('review_only', 'authoring_source'),
  );

  const submoduleParent = join(home, '.copilot');
  initializeRepository(home, submoduleParent);
  const submodule = join(home, '.copilot/skills/actual-submodule');
  run('/usr/bin/git', [
    '-c',
    'protocol.file.allow=always',
    '-C',
    submoduleParent,
    'submodule',
    'add',
    '-q',
    sourceRepository,
    'skills/actual-submodule',
  ], { home });
  await assert.rejects(
    adapter.inspectForPlan(submodule, join(home, '.copilot/skills'), installedCandidate(
      submodule,
      join(home, '.copilot/skills'),
      'a'.repeat(64),
      'b'.repeat(40),
    )),
    expectAdapterError('review_only', 'authoring_source'),
  );
});

test('observation identity cannot authorize rename or transaction record mutation', async () => {
  const activeRoot = join(home, '.codex/skills');
  const entryPath = writeSkill(join(activeRoot, 'observation-authority'));
  initializeRepository(home, entryPath);
  const observation = await adapter.inspectIdentity(entryPath, activeRoot);
  const transactionId = `sha256:${'2'.repeat(64)}`;
  assert.throws(
    () => renameExclusive({
      home,
      activeRoot,
      entryPath,
      destinationRelativeDirectory: `transactions/${transactionId.slice(7)}/payload`,
      destinationLeaf: 'opaque-item',
      expectedIdentity: observation,
    }),
    expectAdapterError('blocked', 'invalid_mutation_identity'),
  );
  assert.equal(existsSync(entryPath), true);
  assert.throws(
    () => initializeTransactionRecords({
      home,
      transactionId,
      plan: { schema_version: 'fixture.tx-plan.v1' },
      manifest: { schema_version: 'fixture.tx-manifest.v1', transaction_id: transactionId },
      state: { schema_version: 'fixture.tx-state.v1', sequence: 0, state: 'PREPARED' },
      executionIdentity: observation,
    }),
    expectAdapterError('blocked', 'invalid_mutation_identity'),
  );
  assert.equal(existsSync(join(
    home, '.agents/skills-quarantine/transactions', transactionId.slice(7),
  )), false);
  assert.throws(
    () => initializeBatchRecords({
      home,
      batchId: `sha256:${'3'.repeat(64)}`,
      plan: { schema_version: 'fixture.batch-plan.v1' },
      state: { schema_version: 'fixture.batch-state.v1', sequence: 0, state: 'READY' },
      executionIdentity: observation,
    }),
    expectAdapterError('blocked', 'invalid_mutation_identity'),
  );
});

test('receipt and installed tree drift block a directory identity', async () => {
  const receiptPath = join(home, '.agents/.skill-lock.json');
  const unlisted = writeSkill(join(installedRoot, 'manual-unlisted'));
  const unlistedTree = gitTreeSha1(home, unlisted);
  await assert.rejects(
    adapter.inspectForPlan(unlisted, installedRoot, installedCandidate(
      unlisted,
      installedRoot,
      sha256File(receiptPath),
      unlistedTree,
    )),
    expectAdapterError('blocked', 'receipt_entry_missing'),
  );
  rmSync(unlisted, { recursive: true, force: true });

  await assert.rejects(
    adapter.inspectForPlan(installed, installedRoot, installedCandidate(
      installed,
      installedRoot,
      sha256File(receiptPath),
      'b'.repeat(40),
    )),
    expectAdapterError('blocked', 'receipt_mapping_drift'),
  );

  const originalReceipt = readFileSync(receiptPath);
  const wrongVersion = JSON.parse(originalReceipt.toString('utf8'));
  wrongVersion.version = 2;
  writeFileSync(receiptPath, `${JSON.stringify(wrongVersion)}\n`, { mode: 0o600 });
  await assert.rejects(
    adapter.inspectForPlan(installed, installedRoot, installedCandidate(
      installed,
      installedRoot,
      sha256File(receiptPath),
      gitTreeSha1(home, installed),
    )),
    expectAdapterError('blocked', 'receipt_mapping_invalid'),
  );
  writeFileSync(receiptPath, originalReceipt, { mode: 0o600 });

  writeFileSync(receiptPath, `${originalReceipt.toString('utf8')} `, { mode: 0o600 });
  await assert.rejects(
    adapter.inspectForPlan(installed, installedRoot, installedCandidateValue),
    expectAdapterError('blocked', 'receipt_drift'),
  );
  writeFileSync(receiptPath, originalReceipt, { mode: 0o600 });

  writeFileSync(join(installed, 'new-content.txt'), 'drift');
  await assert.rejects(
    adapter.inspectForPlan(installed, installedRoot, installedCandidateValue),
    expectAdapterError('blocked', 'installed_tree_drift'),
  );
  rmSync(join(installed, 'new-content.txt'));
});

test('core plan compilation receives and validates full native execution identity', async () => {
  const scan = {
    metadata: {
      schema_version: 'skill-scan.v5',
      product_version: '2.0',
      runtime_validation_mode: 'static-preflight',
      hash_normalization: 'strip-canary-crlf-bom.v1',
    },
    topology: {
      '.agents/skills': { total: 1, symlinks: 0, native: 1, broken_symlinks: 0 },
    },
    entries: [{
      name: 'Installed Skill 空 格',
      location: '.agents/skills',
      entry_path: installed,
      active_root: installedRoot,
      entry_kind: 'directory',
      canonical_dir: installed,
      normalized_content_sha256: 'a'.repeat(64),
      mutation_provenance: installedCandidateValue.evidence.mutation_provenance,
      provenance: {
        kind: 'canonical_global',
        git_root: '',
        git_branch: '',
        confidence: 'direct',
      },
      runtime_contract: { status: 'unknown', loadable: null, load_blockers: [] },
      risk_indicators: [],
      flags: [],
    }],
    name_collisions: [],
    runtime_load_blockers: [],
  };
  const review = compileReview(scan);
  const decisions = {
    schema_version: 'skills-refiner.cleanup.decisions.v1',
    review_fingerprint: review.review_fingerprint,
    decisions: [{ candidate_id: review.candidates[0].candidate_id, action: 'retire' }],
  };
  const plan = await compilePlan({ review, decisions }, adapter);
  assert.equal(validatePlan(plan).items[0].execution_identity.adapter, 'macos-native.v1');
  assert.equal(plan.items[0].execution_identity.receipt_sha256,
    installedCandidateValue.evidence.mutation_provenance.evidence.receipt_sha256);
});

test('durable state publication is owner-only and rejects a symlink destination', () => {
  const value = { schema_version: 'fixture.v1', state: 'PREPARED' };
  const result = durableWriteJson({
    home,
    role: 'cleanup',
    relativeDirectory: 'state records',
    leaf: 'state.json',
    value,
  });
  assert.equal(result.operation, 'publish-state');
  const directory = join(home, '.agents/skills-refiner/cleanup/state records');
  const path = join(directory, 'state.json');
  assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), value);
  assert.equal(readdirNoTemporary(directory).length, 0);

  const previousUmask = process.umask(0o777);
  try {
    durableWriteJson({
      home,
      role: 'cleanup',
      relativeDirectory: 'strict umask',
      leaf: 'state.json',
      value,
    });
  } finally {
    process.umask(previousUmask);
  }
  const strictDirectory = join(home, '.agents/skills-refiner/cleanup/strict umask');
  assert.equal(lstatSync(strictDirectory).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(strictDirectory, 'state.json')).mode & 0o777, 0o600);

  symlinkSync('/dev/null', join(directory, 'unsafe.json'));
  assert.throws(
    () => durableWriteJson({
      home,
      role: 'cleanup',
      relativeDirectory: 'state records',
      leaf: 'unsafe.json',
      value,
    }),
    expectAdapterError('blocked', 'unsafe_state_destination'),
  );

  const interruptedValue = { schema_version: 'fixture.v1', state: 'MOVING' };
  assert.throws(
    () => __testing.publishStateWithCrash({
      home,
      role: 'cleanup',
      relativeDirectory: 'interrupted publication',
      leaf: 'state.json',
      value: interruptedValue,
    }),
    expectAdapterError('recovery_required', 'helper_mutation_result_unknown'),
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(
      home,
      '.agents/skills-refiner/cleanup/interrupted publication/state.json',
    ), 'utf8')),
    interruptedValue,
  );

  assert.throws(
    () => __testing.publishStateWithFailure({
      home,
      role: 'cleanup',
      relativeDirectory: 'file fsync failure',
      leaf: 'state.json',
      value,
    }, 'state_file_fsync'),
    expectAdapterError('blocked', 'state_publish_failed'),
  );
  const fileFsyncDirectory = join(
    home,
    '.agents/skills-refiner/cleanup/file fsync failure',
  );
  assert.equal(existsSync(join(fileFsyncDirectory, 'state.json')), false);
  assert.equal(readdirNoTemporary(fileFsyncDirectory).length, 0);

  assert.throws(
    () => __testing.publishStateWithFailure({
      home,
      role: 'cleanup',
      relativeDirectory: 'parent fsync failure',
      leaf: 'state.json',
      value,
    }, 'state_parent_fsync'),
    expectAdapterError('recovery_required', 'state_durability_unknown'),
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(
      home,
      '.agents/skills-refiner/cleanup/parent fsync failure/state.json',
    ), 'utf8')),
    value,
  );
});

test('quarantine and state ancestors reject symlink substitution', () => {
  const sandboxRoot = makeSandbox();
  const alternate = join(sandboxRoot, 'alternate quarantine');
  mkdirSync(join(sandboxRoot, '.agents'), { mode: 0o755 });
  mkdirSync(alternate);
  symlinkSync(alternate, join(sandboxRoot, '.agents/skills-quarantine'));
  try {
    ensureMacosHelper({ home: sandboxRoot, forceCompile: true });
    assert.throws(
      () => durableWriteJson({
        home: sandboxRoot,
        role: 'quarantine',
        relativeDirectory: 'transactions',
        leaf: 'state.json',
        value: { state: 'PLANNED' },
      }),
      expectAdapterError('blocked', 'unsafe_state_destination'),
    );
  } finally {
    __testing.clearHelperCache();
    removeSandbox(sandboxRoot);
  }
});

test('runtime cache is source-bound, survives exact rebuild, and blocks tampering', () => {
  const sandboxRoot = makeSandbox();
  const spacedHome = join(sandboxRoot, 'home with spaces');
  const staleBuild = join(tmpdir(), `skills-refiner-build-2147483647-fixture-${process.pid}`);
  mkdirSync(spacedHome, { mode: 0o700 });
  mkdirSync(staleBuild, { mode: 0o700 });
  writeFileSync(join(staleBuild, 'partial-helper'), 'partial');
  try {
    const initial = ensureMacosHelper({ home: spacedHome, forceCompile: true });
    assert.equal(existsSync(staleBuild), false);
    assert.ok(initial.path.includes('home with spaces'));
    assert.match(initial.sourceHash, /^[0-9a-f]{64}$/u);
    assert.equal(lstatSync(initial.path).mode & 0o777, 0o700);

    __testing.clearHelperCache();
    const reused = ensureReferencedMacosHelper({
      home: spacedHome,
      binaryHash: initial.binaryHash,
      sourceHash: initial.sourceHash,
      expectedArchitecture: initial.architecture,
    });
    assert.equal(reused.binaryHash, initial.binaryHash);
    assert.equal(reused.sourceHash, initial.sourceHash);
    assert.equal(reused.compilerPath, initial.compilerPath);
    assert.equal(reused.compilerVersion, initial.compilerVersion);

    __testing.clearHelperCache();
    const reusedWithoutCompiler = __testing.ensureWithXcrun({
      home: spacedHome,
      xcrunPath: join(spacedHome, 'missing-xcrun'),
    });
    assert.equal(reusedWithoutCompiler.binaryHash, initial.binaryHash);
    assert.equal(reusedWithoutCompiler.sourceHash, initial.sourceHash);

    const runtimeRoot = join(spacedHome, '.agents/skills-refiner/runtime');
    const redirectedRuntime = join(spacedHome, 'redirected-runtime');
    renameSync(runtimeRoot, redirectedRuntime);
    symlinkSync(redirectedRuntime, runtimeRoot);
    assert.throws(
      () => __testing.ensureWithXcrun({
        home: spacedHome,
        xcrunPath: join(spacedHome, 'missing-xcrun'),
      }),
      expectAdapterError('unsupported', 'compiler_unavailable'),
    );
    unlinkSync(runtimeRoot);
    renameSync(redirectedRuntime, runtimeRoot);
    __testing.ensureWithXcrun({ home: spacedHome });

    renameSync(runtimeRoot, redirectedRuntime);
    symlinkSync(redirectedRuntime, runtimeRoot);
    __testing.clearHelperCache();
    assert.throws(
      () => __testing.ensureWithXcrun({
        home: spacedHome,
        xcrunPath: join(spacedHome, 'missing-xcrun'),
      }),
      expectAdapterError('unsupported', 'compiler_unavailable'),
    );
    unlinkSync(runtimeRoot);
    renameSync(redirectedRuntime, runtimeRoot);

    rmSync(dirname(initial.path), { recursive: true, force: true });
    __testing.clearHelperCache();
    assert.throws(
      () => ensureReferencedMacosHelper({
        home: spacedHome,
        binaryHash: initial.binaryHash,
        sourceHash: initial.sourceHash,
        expectedArchitecture: initial.architecture,
      }),
      expectAdapterError('recovery_required', 'referenced_helper_unavailable'),
    );
    assert.throws(
      () => __testing.ensureWithXcrun({
        home: spacedHome,
        forceCompile: true,
        xcrunPath: join(spacedHome, 'missing-xcrun'),
      }),
      expectAdapterError('unsupported', 'compiler_unavailable'),
    );
    const rebuilt = ensureMacosHelper({ home: spacedHome, forceCompile: true });
    assert.equal(rebuilt.binaryHash, initial.binaryHash);

    chmodSync(rebuilt.path, 0o777);
    __testing.clearHelperCache();
    assert.throws(
      () => ensureMacosHelper({ home: spacedHome, forceCompile: true }),
      expectAdapterError('blocked', 'runtime_cache_tampered'),
    );
    chmodSync(rebuilt.path, 0o700);
  } finally {
    __testing.clearHelperCache();
    rmSync(staleBuild, { recursive: true, force: true });
    removeSandbox(sandboxRoot);
  }
});

function readdirNoTemporary(directory) {
  return readdirSync(directory).filter((name) => name.startsWith('.skills-refiner-'));
}

test('exclusive rename binds expected identity and never replaces an occupied destination', async () => {
  const activeRoot = join(home, '.github/skills');
  const source = writeSkill(join(home, 'rename-source'));
  const firstEntry = join(activeRoot, 'move-link');
  symlinkSync(source, firstEntry);
  const candidate = symlinkCandidate(firstEntry, activeRoot, source);
  const identity = await adapter.inspectForPlan(firstEntry, activeRoot, candidate);
  const moved = renameExclusive({
    home,
    activeRoot,
    entryPath: firstEntry,
    destinationRelativeDirectory: 'transactions/tx-one/payload',
    destinationLeaf: 'opaque-item',
    expectedIdentity: identity,
  });
  assert.equal(moved.operation, 'rename-exclusive');
  assert.equal(moved.manifest_hash, identity.manifest_hash);
  assert.equal(existsSync(firstEntry), false);
  const destination = join(home, '.agents/skills-quarantine/transactions/tx-one/payload/opaque-item');
  assert.equal(readlinkSync(destination), source);

  const secondEntry = join(activeRoot, 'conflict-link');
  symlinkSync(source, secondEntry);
  const secondIdentity = await adapter.inspectForPlan(
    secondEntry,
    activeRoot,
    symlinkCandidate(secondEntry, activeRoot, source),
  );
  const competitor = join(home, '.agents/skills-quarantine/transactions/tx-two/payload/opaque-item');
  mkdirSync(dirname(competitor), { recursive: true, mode: 0o700 });
  writeFileSync(competitor, 'competitor bytes');
  await assert.rejects(
    Promise.resolve().then(() => renameExclusive({
      home,
      activeRoot,
      entryPath: secondEntry,
      destinationRelativeDirectory: 'transactions/tx-two/payload',
      destinationLeaf: 'opaque-item',
      expectedIdentity: secondIdentity,
    })),
    expectAdapterError('blocked', 'destination_exists'),
  );
  assert.equal(readFileSync(competitor, 'utf8'), 'competitor bytes');
  assert.equal(readlinkSync(secondEntry), source);

  await assert.rejects(
    Promise.resolve().then(() => renameExclusive({
      home,
      activeRoot,
      entryPath: secondEntry,
      destinationRelativeDirectory: 'transactions/tx-three/payload',
      destinationLeaf: 'opaque-item',
      expectedIdentity: { ...secondIdentity, inode: '0' },
    })),
    expectAdapterError('blocked', 'invalid_mutation_identity'),
  );
  assert.equal(readlinkSync(secondEntry), source);

  const metadataDriftEntry = join(activeRoot, 'metadata-drift-link');
  symlinkSync(source, metadataDriftEntry);
  const metadataDriftIdentity = await adapter.inspectForPlan(
    metadataDriftEntry,
    activeRoot,
    symlinkCandidate(metadataDriftEntry, activeRoot, source),
  );
  run('/usr/bin/xattr', [
    '-s',
    '-w',
    'com.skills-refiner.test',
    'changed-after-plan',
    metadataDriftEntry,
  ], { home });
  await assert.rejects(
    Promise.resolve().then(() => renameExclusive({
      home,
      activeRoot,
      entryPath: metadataDriftEntry,
      destinationRelativeDirectory: 'transactions/tx-drift/payload',
      destinationLeaf: 'opaque-item',
      expectedIdentity: metadataDriftIdentity,
    })),
    expectAdapterError('blocked', 'identity_changed'),
  );
  assert.equal(readlinkSync(metadataDriftEntry), source);

  const interruptedEntry = join(activeRoot, 'interrupted-link');
  symlinkSync(source, interruptedEntry);
  const interruptedIdentity = await adapter.inspectForPlan(
    interruptedEntry,
    activeRoot,
    symlinkCandidate(interruptedEntry, activeRoot, source),
  );
  assert.throws(
    () => __testing.renameWithCrash({
      home,
      activeRoot,
      entryPath: interruptedEntry,
      destinationRelativeDirectory: 'transactions/tx-interrupted/payload',
      destinationLeaf: 'opaque-item',
      expectedIdentity: interruptedIdentity,
    }),
    expectAdapterError('recovery_required', 'helper_mutation_result_unknown'),
  );
  assert.equal(existsSync(interruptedEntry), false);
  assert.equal(
    readlinkSync(join(
      home,
      '.agents/skills-quarantine/transactions/tx-interrupted/payload/opaque-item',
    )),
    source,
  );

  const fsyncEntry = join(activeRoot, 'fsync-failure-link');
  symlinkSync(source, fsyncEntry);
  const fsyncIdentity = await adapter.inspectForPlan(
    fsyncEntry,
    activeRoot,
    symlinkCandidate(fsyncEntry, activeRoot, source),
  );
  assert.throws(
    () => __testing.renameWithFailure({
      home,
      activeRoot,
      entryPath: fsyncEntry,
      destinationRelativeDirectory: 'transactions/tx-fsync/payload',
      destinationLeaf: 'opaque-item',
      expectedIdentity: fsyncIdentity,
    }, 'rename_parent_fsync'),
    expectAdapterError('recovery_required', 'rename_recovery_required'),
  );
  assert.equal(existsSync(fsyncEntry), false);
  assert.equal(
    readlinkSync(join(
      home,
      '.agents/skills-quarantine/transactions/tx-fsync/payload/opaque-item',
    )),
    source,
  );
});

test('exclusive rename rejects same-inode directory content drift', async () => {
  const sandboxRoot = makeSandbox();
  const activeRoot = join(sandboxRoot, '.agents/skills');
  mkdirSync(activeRoot, { recursive: true });
  const entryPath = writeSkill(join(activeRoot, 'directory-drift'));
  const tree = gitTreeSha1(sandboxRoot, entryPath);
  const receiptPath = join(sandboxRoot, '.agents/.skill-lock.json');
  writeFileSync(receiptPath, `${JSON.stringify({
    version: 3,
    skills: {
      'directory-drift': {
        source: 'fixture',
        sourceType: 'github',
        sourceUrl: 'https://example.invalid/fixture.git',
        skillPath: 'skills/directory-drift',
        skillFolderHash: tree,
      },
    },
  })}\n`, { mode: 0o600 });
  try {
    ensureMacosHelper({ home: sandboxRoot, forceCompile: true });
    const isolatedAdapter = createMacosAdapter({ home: sandboxRoot });
    const identity = await isolatedAdapter.inspectForPlan(
      entryPath,
      activeRoot,
      installedCandidate(entryPath, activeRoot, sha256File(receiptPath), tree),
    );
    const skillFile = join(entryPath, 'SKILL.md');
    writeFileSync(skillFile, `${readFileSync(skillFile, 'utf8')}\nChanged after plan.\n`);
    assert.throws(
      () => renameExclusive({
        home: sandboxRoot,
        activeRoot,
        entryPath,
        destinationRelativeDirectory: 'transactions/directory-drift/payload',
        destinationLeaf: 'opaque-item',
        expectedIdentity: identity,
      }),
      expectAdapterError('blocked', 'identity_changed'),
    );
    assert.equal(existsSync(entryPath), true);
  } finally {
    __testing.clearHelperCache();
    removeSandbox(sandboxRoot);
  }
});

test('exclusive rename never clobbers a concurrent destination creator', async () => {
  const activeRoot = join(home, '.github/skills');
  const source = join(home, 'rename-source');
  const entryPath = join(activeRoot, 'race-link');
  symlinkSync(source, entryPath);
  const identity = await adapter.inspectForPlan(
    entryPath,
    activeRoot,
    symlinkCandidate(entryPath, activeRoot, source),
  );
  const destinationDirectory = join(
    home,
    '.agents/skills-quarantine/transactions/race/payload',
  );
  mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
  const destination = join(destinationDirectory, 'opaque-item');
  const barrier = join(home, 'race-barrier');
  const competitorCode = [
    'const fs=require("node:fs");',
    'const [destination,barrier]=process.argv.slice(1);',
    'process.stdout.write("READY\\n");',
    'while(!fs.existsSync(barrier)) {}',
    'try { fs.writeFileSync(destination,"competitor bytes",{flag:"wx"}); process.stdout.write("WON\\n"); }',
    'catch(error) { if(error.code!=="EEXIST") throw error; process.stdout.write("LOST\\n"); }',
  ].join('');
  const competitor = spawn(process.execPath, ['-e', competitorCode, destination, barrier], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  competitor.stdout.setEncoding('utf8');
  competitor.stdout.on('data', (chunk) => { output += chunk; });
  await new Promise((resolveReady, rejectReady) => {
    const inspectOutput = () => {
      if (output.includes('READY')) {
        competitor.stdout.off('data', inspectOutput);
        resolveReady();
      }
    };
    competitor.stdout.on('data', inspectOutput);
    competitor.once('error', rejectReady);
  });
  writeFileSync(barrier, 'go');
  let renameError = null;
  try {
    renameExclusive({
      home,
      activeRoot,
      entryPath,
      destinationRelativeDirectory: 'transactions/race/payload',
      destinationLeaf: 'opaque-item',
      expectedIdentity: identity,
    });
  } catch (error) {
    renameError = error;
  }
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    competitor.once('error', rejectExit);
    competitor.once('exit', resolveExit);
  });
  assert.equal(exitCode, 0);
  if (renameError === null) {
    assert.match(output, /LOST/u);
    assert.equal(readlinkSync(destination), source);
  } else {
    assert.ok(expectAdapterError('blocked', 'destination_exists')(renameError));
    assert.match(output, /WON/u);
    assert.equal(readFileSync(destination, 'utf8'), 'competitor bytes');
    assert.equal(readlinkSync(entryPath), source);
  }
});

test('versioned batch records and lease advance batch and mapped item state independently', () => {
  const identity = helperExecutionIdentity(home);
  const batchId = `sha256:${'b'.repeat(64)}`;
  const transactionId = `sha256:${'c'.repeat(64)}`;
  const planHash = `sha256:${'d'.repeat(64)}`;
  const itemId = `sha256:${'0'.repeat(64)}`;
  const itemHash = `sha256:${'3'.repeat(64)}`;
  const executionIdentityHash = `sha256:${'4'.repeat(64)}`;
  const batchPlan = {
    schema_version: 'skills-refiner.cleanup.batch-plan.v1',
    batch_id: batchId,
    plan_hash: planHash,
    transaction_map: [{
      execution_identity_hash: executionIdentityHash,
      item_hash: itemHash,
      item_id: itemId,
      transaction_id: transactionId,
    }],
  };
  const batchState = {
    schema_version: 'skills-refiner.cleanup.batch-state.v1',
    sequence: 0,
    state: 'READY',
  };
  const transactionState = { schema_version: 'fixture.tx-state.v1', sequence: 0, state: 'PREPARED' };

  assert.equal(initializeBatchRecords({
    home, batchId, plan: batchPlan, state: batchState, executionIdentity: identity,
  }).operation, 'batch-init-v1');
  assert.equal(initializeBatchRecords({
    home, batchId, plan: batchPlan, state: batchState, executionIdentity: identity,
  }).result, 'existing');
  assert.deepEqual(probeBatchRecords({ home, batchId, executionIdentity: identity }), {
    plan: batchPlan,
    state: batchState,
    lock: null,
  });
  const binding = {
    schema_version: 'skills-refiner.cleanup.batch-binding.v1',
    batch_id: batchId,
    execution_identity_hash: executionIdentityHash,
    item_hash: itemHash,
    item_id: itemId,
    plan_hash: planHash,
    transaction_id: transactionId,
  };
  initializeBatchTransactionRecords({
    home,
    transactionId,
    plan: { schema_version: 'fixture.tx-plan.v1' },
    manifest: {
      schema_version: 'fixture.tx-manifest.v1', transaction_id: transactionId,
      execution_identity: identity,
    },
    state: transactionState,
    binding,
    executionIdentity: identity,
  });
  assert.deepEqual(probeBatchTransactionRecords({
    home, transactionId, executionIdentity: identity,
  }).binding, binding);
  assert.equal(probeTransactionKind({
    home, transactionId, executionIdentity: identity,
  }), 'batch_v2');

  const owner = acquireBatchLock({ home, batchId, planHash, executionIdentity: identity });
  assert.equal(owner.scope, 'batch');
  assert.equal(owner.batch_id, batchId);
  assert.equal(owner.transaction_id, undefined);
  const nextBatchState = { ...batchState, sequence: 1, state: 'RUNNING' };
  assert.deepEqual(advanceBatchStateRecord({
    home, batchId, planHash, currentState: batchState, nextState: nextBatchState,
    owner, executionIdentity: identity,
  }).state, nextBatchState);
  const nextTransactionState = { ...transactionState, sequence: 1, state: 'COMMITTED' };
  assert.deepEqual(advanceTransactionStateUnderBatchLease({
    home, batchId, itemId, itemHash, executionIdentityHash,
    transactionId, planHash, batchPlan,
    currentState: transactionState, nextState: nextTransactionState,
    owner, executionIdentity: identity,
  }).state, nextTransactionState);
  assert.throws(
    () => isolateStaleBatchLock({
      home, batchId, planHash, owner, executionIdentity: identity,
    }),
    expectAdapterError('blocked', 'lock_live'),
  );
  assert.equal(existsSync(join(home, '.agents/skills-quarantine/lock')), true);
  assert.equal(releaseBatchLock({
    home, batchId, planHash, owner, executionIdentity: identity,
  }).operation, 'batch-lock-release-v1');
  assert.equal(existsSync(join(
    home, '.agents/skills-quarantine/batches', batchId.slice(7),
    `released-lock-${owner.nonce}`,
  )), true);
});

test('batch leases cannot advance a transaction absent from the immutable mapping', () => {
  const identity = helperExecutionIdentity(home);
  const batchId = `sha256:${'e'.repeat(64)}`;
  const mappedTransactionId = `sha256:${'f'.repeat(64)}`;
  const otherTransactionId = `sha256:${'1'.repeat(64)}`;
  const planHash = `sha256:${'2'.repeat(64)}`;
  const itemHash = `sha256:${'5'.repeat(64)}`;
  const executionIdentityHash = `sha256:${'6'.repeat(64)}`;
  const itemId = `sha256:${'0'.repeat(64)}`;
  const batchPlan = {
    schema_version: 'skills-refiner.cleanup.batch-plan.v1', batch_id: batchId, plan_hash: planHash,
    transaction_map: [{
      execution_identity_hash: executionIdentityHash,
      item_hash: itemHash,
      item_id: itemId,
      transaction_id: mappedTransactionId,
    }],
  };
  const batchState = { schema_version: 'fixture.batch-state.v1', sequence: 0, state: 'READY' };
  initializeBatchRecords({
    home, batchId, plan: batchPlan, state: batchState, executionIdentity: identity,
  });
  const owner = acquireBatchLock({ home, batchId, planHash, executionIdentity: identity });
  const state = { schema_version: 'fixture.tx-state.v1', sequence: 0, state: 'PREPARED' };
  initializeBatchTransactionRecords({
    home,
    transactionId: otherTransactionId,
    plan: { schema_version: 'fixture.tx-plan.v1' },
    manifest: {
      schema_version: 'fixture.tx-manifest.v1', transaction_id: otherTransactionId,
      execution_identity: identity,
    },
    state,
    binding: {
      schema_version: 'skills-refiner.cleanup.batch-binding.v1',
      batch_id: batchId,
      execution_identity_hash: executionIdentityHash,
      item_hash: itemHash,
      item_id: itemId,
      plan_hash: planHash,
      transaction_id: otherTransactionId,
    },
    executionIdentity: identity,
  });
  assert.throws(
    () => advanceTransactionStateUnderBatchLease({
      home, batchId, itemId, itemHash, executionIdentityHash,
      transactionId: otherTransactionId, planHash, batchPlan,
      currentState: state, nextState: { ...state, sequence: 1, state: 'COMMITTED' },
      owner, executionIdentity: identity,
    }),
    expectAdapterError('recovery_required', 'batch_mapping_invalid'),
  );
  assert.deepEqual(probeTransactionRecords({
    home, transactionId: otherTransactionId, executionIdentity: identity,
  }).state, state);
  releaseBatchLock({ home, batchId, planHash, owner, executionIdentity: identity });
});

test('transaction kind is explicit and unsafe binding metadata fails closed', () => {
  const identity = helperExecutionIdentity(home);
  const standaloneId = `sha256:${'7'.repeat(64)}`;
  const state = { schema_version: 'fixture.tx-state.v1', sequence: 0, state: 'PREPARED' };
  initializeTransactionRecords({
    home,
    transactionId: standaloneId,
    plan: { schema_version: 'fixture.tx-plan.v1' },
    manifest: { schema_version: 'fixture.tx-manifest.v1', transaction_id: standaloneId },
    state,
    executionIdentity: identity,
  });
  assert.equal(probeTransactionKind({
    home, transactionId: standaloneId, executionIdentity: identity,
  }), 'standalone_v1');

  const batchTransactionId = `sha256:${'8'.repeat(64)}`;
  initializeBatchTransactionRecords({
    home,
    transactionId: batchTransactionId,
    plan: { schema_version: 'fixture.tx-plan.v1' },
    manifest: { schema_version: 'fixture.tx-manifest.v1', transaction_id: batchTransactionId },
    state,
    binding: {
      schema_version: 'skills-refiner.cleanup.batch-binding.v1',
      batch_id: `sha256:${'9'.repeat(64)}`,
      execution_identity_hash: `sha256:${'a'.repeat(64)}`,
      item_hash: `sha256:${'b'.repeat(64)}`,
      item_id: `sha256:${'d'.repeat(64)}`,
      plan_hash: `sha256:${'c'.repeat(64)}`,
      transaction_id: batchTransactionId,
    },
    executionIdentity: identity,
  });
  const bindingPath = join(
    home, '.agents/skills-quarantine/transactions', batchTransactionId.slice(7), 'binding.json',
  );
  unlinkSync(bindingPath);
  symlinkSync('/dev/null', bindingPath);
  assert.throws(
    () => probeTransactionKind({ home, transactionId: batchTransactionId, executionIdentity: identity }),
    expectAdapterError('recovery_required', 'transaction_kind_ambiguous'),
  );
});

test('batch item state does not advance for missing, tampered, or symlinked binding', () => {
  const identity = helperExecutionIdentity(home);
  const batchId = `sha256:${'d'.repeat(64)}`;
  const transactionId = `sha256:${'e'.repeat(64)}`;
  const planHash = `sha256:${'f'.repeat(64)}`;
  const itemHash = `sha256:${'0'.repeat(64)}`;
  const executionIdentityHash = `sha256:${'1'.repeat(64)}`;
  const itemId = `sha256:${'2'.repeat(64)}`;
  const mapping = {
    execution_identity_hash: executionIdentityHash,
    item_hash: itemHash,
    item_id: itemId,
    transaction_id: transactionId,
  };
  const batchPlan = {
    schema_version: 'skills-refiner.cleanup.batch-plan.v1',
    batch_id: batchId,
    plan_hash: planHash,
    transaction_map: [mapping],
  };
  initializeBatchRecords({
    home,
    batchId,
    plan: batchPlan,
    state: { schema_version: 'fixture.batch-state.v1', sequence: 0, state: 'READY' },
    executionIdentity: identity,
  });
  const state = { schema_version: 'fixture.tx-state.v1', sequence: 0, state: 'PREPARED' };
  initializeBatchTransactionRecords({
    home,
    transactionId,
    plan: { schema_version: 'fixture.tx-plan.v1' },
    manifest: { schema_version: 'fixture.tx-manifest.v1', transaction_id: transactionId },
    state,
    binding: {
      schema_version: 'skills-refiner.cleanup.batch-binding.v1',
      batch_id: batchId,
      execution_identity_hash: executionIdentityHash,
      item_hash: itemHash,
      item_id: itemId,
      plan_hash: planHash,
      transaction_id: transactionId,
    },
    executionIdentity: identity,
  });
  const bindingPath = join(
    home, '.agents/skills-quarantine/transactions', transactionId.slice(7), 'binding.json',
  );
  const owner = acquireBatchLock({ home, batchId, planHash, executionIdentity: identity });
  const attemptAdvance = () => advanceTransactionStateUnderBatchLease({
      home, batchId, itemId, itemHash, executionIdentityHash,
      transactionId, planHash, batchPlan, currentState: state,
      nextState: { ...state, sequence: 1, state: 'COMMITTED' }, owner,
      executionIdentity: identity,
    });
  unlinkSync(bindingPath);
  assert.throws(
    attemptAdvance,
    expectAdapterError('recovery_required', 'batch_binding_invalid'),
  );
  writeFileSync(bindingPath, canonicalJson({
    schema_version: 'skills-refiner.cleanup.batch-binding.v1',
    batch_id: batchId,
    execution_identity_hash: executionIdentityHash,
    item_hash: itemHash,
    item_id: 'tampered-item',
    plan_hash: planHash,
    transaction_id: transactionId,
  }), { mode: 0o600 });
  assert.throws(
    attemptAdvance,
    expectAdapterError('recovery_required', 'batch_binding_invalid'),
  );
  unlinkSync(bindingPath);
  symlinkSync('/dev/null', bindingPath);
  assert.throws(
    attemptAdvance,
    expectAdapterError('recovery_required', 'batch_binding_invalid'),
  );
  assert.deepEqual(JSON.parse(readFileSync(join(dirname(bindingPath), 'state.json'), 'utf8')), state);
  releaseBatchLock({ home, batchId, planHash, owner, executionIdentity: identity });
});

test('Keep state probe and digest CAS fail closed and prevent lost updates', () => {
  const identity = helperExecutionIdentity(home);
  const options = {
    home, role: 'cleanup', relativeDirectory: '.', leaf: 'keep-decisions.json',
    executionIdentity: identity,
  };
  assert.deepEqual(probeDurableJson(options), { exists: false, digest: null, value: null });
  const first = { schema_version: 'fixture.keep.v1', decisions: { a: true } };
  const firstResult = compareAndSwapDurableJson({ ...options, expectedDigest: null, value: first });
  assert.equal(firstResult.digest, sha256Json(first));
  assert.deepEqual(probeDurableJson(options), {
    exists: true, digest: sha256Json(first), value: first,
  });
  const second = { schema_version: 'fixture.keep.v1', decisions: { a: true, b: true } };
  assert.throws(
    () => compareAndSwapDurableJson({ ...options, expectedDigest: null, value: second }),
    expectAdapterError('blocked', 'state_cas_mismatch'),
  );
  assert.deepEqual(probeDurableJson(options).value, first);

  const keepPath = join(home, '.agents/skills-refiner/cleanup/keep-decisions.json');
  writeFileSync(keepPath, '{malformed', { mode: 0o600 });
  assert.throws(() => probeDurableJson(options), expectAdapterError('blocked', 'state_invalid'));
  assert.throws(
    () => compareAndSwapDurableJson({
      ...options, expectedDigest: `sha256:${'0'.repeat(64)}`, value: second,
    }),
    expectAdapterError('blocked', 'state_invalid'),
  );
  assert.equal(readFileSync(keepPath, 'utf8'), '{malformed');
  unlinkSync(keepPath);
  symlinkSync('/dev/null', keepPath);
  assert.throws(() => probeDurableJson(options), expectAdapterError('blocked', 'unsafe_state_source'));
  unlinkSync(keepPath);
  writeFileSync(keepPath, '{}', { mode: 0o644 });
  assert.throws(() => probeDurableJson(options), expectAdapterError('blocked', 'unsafe_state_source'));
  assert.equal(lstatSync(keepPath).mode & 0o777, 0o644);

  for (const override of [
    { role: 'quarantine' },
    { relativeDirectory: 'transactions' },
    { leaf: 'other.json' },
  ]) {
    assert.throws(
      () => probeDurableJson({ ...options, ...override }),
      expectAdapterError('blocked', 'invalid_keep_surface'),
    );
    assert.throws(
      () => compareAndSwapDurableJson({
        ...options, ...override, expectedDigest: null, value: first,
      }),
      expectAdapterError('blocked', 'invalid_keep_surface'),
    );
  }
  unlinkSync(keepPath);
});

test('native Keep primitives cannot target quarantine records or arbitrary cleanup files', () => {
  const helper = ensureMacosHelper({ home });
  for (const args of [
    ['probe-state-v1', home, 'quarantine', '.', 'keep-decisions.json'],
    ['probe-state-v1', home, 'cleanup', 'transactions', 'keep-decisions.json'],
    ['probe-state-v1', home, 'cleanup', '.', 'other.json'],
    ['state-cas-v1', home, 'quarantine', '.', 'keep-decisions.json', 'absent'],
  ]) {
    const result = spawnSync(helper.path, args, {
      encoding: 'utf8',
      env: gitEnvironment(home),
      input: canonicalJson({ schema_version: 'fixture.keep.v1', decisions: {} }),
    });
    assert.equal(result.status, 10);
    assert.equal(JSON.parse(result.stdout).reason, 'invalid_keep_surface');
  }
});

test('Keep CAS returns promptly without writing when its directory lock is held', async () => {
  const helper = ensureMacosHelper({ home });
  const cleanupDirectory = join(home, '.agents/skills-refiner/cleanup');
  mkdirSync(cleanupDirectory, { recursive: true, mode: 0o700 });
  const lockerPath = join(home, 'directory-locker');
  const lockerSource = `
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 2) return 64;
    int fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0 || flock(fd, LOCK_EX) != 0) return 65;
    if (write(STDOUT_FILENO, "LOCKED\\n", 7) != 7) return 66;
    char release;
    while (read(STDIN_FILENO, &release, 1) < 0 && errno == EINTR) {}
    close(fd);
    return 0;
}
`;
  const compiled = spawnSync('/usr/bin/xcrun', [
    'clang', '-std=c11', '-x', 'c', '-', '-o', lockerPath,
  ], {
    encoding: 'utf8',
    env: gitEnvironment(home),
    input: lockerSource,
  });
  assert.equal(compiled.status, 0, compiled.stderr);

  const locker = spawn(lockerPath, [cleanupDirectory], {
    env: gitEnvironment(home),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let lockerOutput = '';
  locker.stdout.setEncoding('utf8');
  locker.stdout.on('data', (chunk) => { lockerOutput += chunk; });
  await new Promise((resolveLocked, rejectLocked) => {
    const timeout = setTimeout(() => {
      locker.kill('SIGKILL');
      rejectLocked(new Error('directory locker did not acquire the lock within 2 seconds'));
    }, 2000);
    const inspect = () => {
      if (!lockerOutput.includes('LOCKED')) return;
      clearTimeout(timeout);
      locker.stdout.off('data', inspect);
      resolveLocked();
    };
    locker.stdout.on('data', inspect);
    locker.once('error', (error) => {
      clearTimeout(timeout);
      rejectLocked(error);
    });
    locker.once('exit', (status) => {
      if (!lockerOutput.includes('LOCKED')) {
        clearTimeout(timeout);
        rejectLocked(new Error(`directory locker exited before readiness: ${status}`));
      }
    });
  });

  const value = canonicalJson({ schema_version: 'fixture.keep.v1', decisions: { held: true } });
  let cas;
  try {
    const started = Date.now();
    cas = await new Promise((resolveCas, rejectCas) => {
      const child = spawn(helper.path, [
        'state-cas-v1', home, 'cleanup', '.', 'keep-decisions.json', 'absent',
      ], { env: gitEnvironment(home), stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        rejectCas(new Error('Keep CAS blocked on a held directory lock'));
      }, 1000);
      child.once('error', (error) => {
        clearTimeout(timeout);
        rejectCas(error);
      });
      child.once('exit', (status) => {
        clearTimeout(timeout);
        resolveCas({ status, stdout, stderr, elapsed: Date.now() - started });
      });
      child.stdin.end(value);
    });
  } finally {
    const lockerExit = new Promise((resolveExit) => locker.once('exit', resolveExit));
    locker.stdin.end('x');
    await lockerExit;
  }
  assert.equal(cas.status, 10, cas.stderr);
  assert.equal(JSON.parse(cas.stdout).reason, 'state_cas_lock_held');
  assert.ok(cas.elapsed < 1000, `Keep CAS took ${cas.elapsed}ms`);
  assert.equal(existsSync(join(cleanupDirectory, 'keep-decisions.json')), false);
  assert.deepEqual(
    readdirSync(cleanupDirectory).filter((leaf) => leaf.startsWith('.skills-refiner-state-')),
    [],
  );
});

test('native batch item lease accepts only digest item IDs', () => {
  const helper = ensureMacosHelper({ home });
  const digest = `sha256:${'4'.repeat(64)}`;
  for (const itemId of ['item-01', 'x'.repeat(129), 'item"quoted']) {
    const result = spawnSync(helper.path, [
      'transaction-advance-batch-v2',
      home,
      `sha256:${'5'.repeat(64)}`,
      `sha256:${'6'.repeat(64)}`,
      `sha256:${'7'.repeat(64)}`,
      `sha256:${'8'.repeat(64)}`,
      itemId,
      `sha256:${'9'.repeat(64)}`,
      `sha256:${'a'.repeat(64)}`,
      `sha256:${'b'.repeat(64)}`,
      'c'.repeat(64),
      String(process.pid),
      '0',
      '0',
      '0',
      '1',
    ], {
      encoding: 'utf8',
      env: gitEnvironment(home),
      input: canonicalJson({ schema_version: 'fixture.tx-state.v1', sequence: 1, state: 'COMMITTED' }),
    });
    assert.equal(result.status, 10, itemId);
    assert.equal(JSON.parse(result.stdout).reason, 'invalid_batch_transaction_lease');
  }
  assert.match(digest, /^sha256:[0-9a-f]{64}$/u);
});

test('concurrent Keep CAS has one winner, one stable loser, and preserves winner bytes', async () => {
  const helper = ensureMacosHelper({ home });
  const leaf = 'keep-decisions.json';
  const values = [
    canonicalJson({ schema_version: 'fixture.keep.v1', decisions: { winner: 'a' } }),
    canonicalJson({ schema_version: 'fixture.keep.v1', decisions: { winner: 'b' } }),
  ];
  const invoke = (input) => new Promise((resolveChild, rejectChild) => {
    const child = spawn(helper.path, [
      'state-cas-v1', home, 'cleanup', '.', leaf, 'absent',
    ], { env: gitEnvironment(home), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectChild);
    child.once('exit', (status) => resolveChild({ status, stdout, stderr, input }));
    child.stdin.end(input);
  });
  const results = await Promise.all(values.map(invoke));
  assert.deepEqual(results.map((result) => result.status).sort((a, b) => a - b), [0, 10]);
  const loser = results.find((result) => result.status === 10);
  assert.ok(
    ['state_cas_lock_held', 'state_cas_mismatch'].includes(JSON.parse(loser.stdout).reason),
  );
  const winner = results.find((result) => result.status === 0);
  assert.equal(
    readFileSync(join(home, '.agents/skills-refiner/cleanup', leaf), 'utf8'),
    winner.input,
  );
});
