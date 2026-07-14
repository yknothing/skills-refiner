import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { arch, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SCHEMAS,
  canonicalJson,
  computeIdentityHash,
} from './cleanup-contract.mjs';

const HELPER_PROTOCOL = 'skills-refiner.macos-helper.v1';
const HELPER_SOURCE = fileURLToPath(new URL('../native/cleanup-macos-helper.c', import.meta.url));
const MAX_HELPER_OUTPUT = 2 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/u;
const TREE_SHA1 = /^[0-9a-f]{40}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const ACTIVE_ROOTS = new Set([
  '.warp/skills',
  '.agents/skills',
  '.claude/skills',
  '.codex/skills',
  '.cursor/skills',
  '.cursor/skills-cursor',
  '.gemini/skills',
  '.copilot/skills',
  '.factory/skills',
  '.github/skills',
  '.opencode/skills',
]);

const helperCache = new Map();

export class MacosAdapterError extends Error {
  constructor(code, reason, message = 'macOS cleanup adapter blocked the operation') {
    super(message);
    this.name = 'MacosAdapterError';
    this.code = code;
    this.reason = reason;
  }
}

function fail(code, reason, message) {
  throw new MacosAdapterError(code, reason, message);
}

function architecture() {
  if (arch() === 'arm64') return 'arm64';
  if (arch() === 'x64') return 'x86_64';
  fail('unsupported', 'unsupported_architecture');
}

function sanitizedEnvironment(home) {
  return {
    PATH: '/usr/bin:/bin',
    HOME: home,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashFile(path) {
  return hashBytes(readFileSync(path));
}

function stableSourceSnapshot() {
  const descriptor = openSync(HELPER_SOURCE, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > (4n * 1024n * 1024n)) {
      fail('blocked', 'helper_source_unsafe');
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      fail('blocked', 'helper_source_changed');
    }
    return { bytes, hash: hashBytes(bytes) };
  } finally {
    closeSync(descriptor);
  }
}

function cStringDefinition(name, value) {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `-D${name}="${escaped}"`;
}

function safePath(path, name) {
  if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path
      || CONTROL_CHARACTERS.test(path)) {
    fail('blocked', 'invalid_path', `${name} must be a normalized absolute path`);
  }
  return path;
}

function authorizedActiveRoot(home, activeRoot) {
  safePath(activeRoot, 'activeRoot');
  if (!ACTIVE_ROOTS.has(relative(home, activeRoot))) fail('blocked', 'unrecognized_active_root');
  return activeRoot;
}

function ownedDirectory(path, mode = null) {
  const status = lstatSync(path);
  return status.isDirectory() && !status.isSymbolicLink() && status.uid === process.getuid()
    && (status.mode & 0o022) === 0 && (mode === null || (status.mode & 0o777) === mode);
}

function ownedExecutable(path, expectedHash) {
  const status = lstatSync(path);
  return status.isFile() && !status.isSymbolicLink() && status.uid === process.getuid()
    && (status.mode & 0o777) === 0o700 && hashFile(path) === expectedHash;
}

function ownedNoFollowChain(home, path, { leafKind = 'directory', leafMode = null } = {}) {
  const pathRelative = relative(home, path);
  if (pathRelative.length === 0 || pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) {
    return false;
  }
  const components = pathRelative.split(sep);
  let current = home;
  try {
    const homeStatus = lstatSync(home);
    if (!homeStatus.isDirectory() || homeStatus.isSymbolicLink()
        || homeStatus.uid !== process.getuid() || (homeStatus.mode & 0o022) !== 0) return false;
    for (let index = 0; index < components.length; index += 1) {
      current = join(current, components[index]);
      const status = lstatSync(current);
      const isLeaf = index === components.length - 1;
      if (status.isSymbolicLink() || status.uid !== process.getuid()) return false;
      if (!isLeaf && (!status.isDirectory() || (status.mode & 0o022) !== 0)) return false;
      if (isLeaf && leafKind === 'directory'
          && (!status.isDirectory() || (status.mode & 0o022) !== 0)) return false;
      if (isLeaf && leafKind === 'file'
          && (!status.isFile() || (status.mode & 0o022) !== 0)) return false;
      if (isLeaf && leafMode !== null && (status.mode & 0o777) !== leafMode) return false;
    }
    return realpathSync(path) === path;
  } catch {
    return false;
  }
}

function trustedSystemPath(path, expectedKind) {
  if (!isAbsolute(path) || CONTROL_CHARACTERS.test(path) || /["\\]/u.test(path)) return false;
  try {
    path = realpathSync(path);
    let current = '/';
    const components = path.split('/').filter(Boolean);
    for (let index = 0; index < components.length; index += 1) {
      current = join(current, components[index]);
      const status = lstatSync(current);
      const isLeaf = index === components.length - 1;
      if (status.isSymbolicLink() || status.uid !== 0 || (status.mode & 0o002) !== 0) return false;
      if (!isLeaf && !status.isDirectory()) return false;
      if (isLeaf && expectedKind === 'file'
          && (!status.isFile() || (status.mode & 0o111) === 0)) return false;
      if (isLeaf && expectedKind === 'directory' && !status.isDirectory()) return false;
    }
  } catch {
    return false;
  }
  return true;
}

function parseHelperOutput(result, { mutationMayHaveOccurred = false } = {}) {
  const failAmbiguous = (reason, nonMutationCode = 'blocked') => {
    if (mutationMayHaveOccurred) fail('recovery_required', 'helper_mutation_result_unknown');
    fail(nonMutationCode, reason);
  };
  if (result.error) failAmbiguous('helper_invocation_failed', 'unsupported');
  if (Buffer.byteLength(result.stdout ?? '', 'utf8') > MAX_HELPER_OUTPUT) {
    failAmbiguous('helper_output_oversized');
  }
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    failAmbiguous('helper_output_invalid');
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)
      || response.protocol !== HELPER_PROTOCOL
      || !['ok', 'blocked', 'recovery_required'].includes(response.status)) {
    failAmbiguous('helper_protocol_mismatch');
  }
  if (response.status === 'blocked') fail('blocked', response.reason ?? 'native_helper_blocked');
  if (response.status === 'recovery_required') {
    fail('recovery_required', response.reason ?? 'native_helper_recovery_required');
  }
  if (result.status !== 0) failAmbiguous('helper_exit_mismatch');
  return response;
}

function invokeHelper(helper, args, {
  input = undefined,
  mutationMayHaveOccurred = false,
  testEnvironment = {},
} = {}) {
  const result = spawnSync(helper.path, args, {
    encoding: 'utf8',
    env: { ...sanitizedEnvironment(helper.home), ...testEnvironment },
    input,
    maxBuffer: MAX_HELPER_OUTPUT,
    shell: false,
    windowsHide: true,
  });
  return parseHelperOutput(result, { mutationMayHaveOccurred });
}

function verifiedCachedHelpers(home, targetArchitecture, expectedSourceHash) {
  const architectureRoot = join(
    home,
    '.agents',
    'skills-refiner',
    'runtime',
    'macos',
    targetArchitecture,
  );
  try {
    if (!ownedNoFollowChain(home, architectureRoot, { leafMode: 0o700 })) return [];
  } catch {
    return [];
  }
  const helpers = [];
  for (const digest of readdirSync(architectureRoot).sort()) {
    if (!DIGEST.test(digest)) continue;
    const leafDirectory = join(architectureRoot, digest);
    const executable = join(leafDirectory, 'cleanup-macos-helper');
    try {
      if (!ownedNoFollowChain(home, leafDirectory, { leafMode: 0o700 })
          || !ownedNoFollowChain(home, executable, { leafKind: 'file', leafMode: 0o700 })
          || !ownedDirectory(leafDirectory, 0o700) || !ownedExecutable(executable, digest)) continue;
      const candidate = {
        path: executable,
        home,
        binaryHash: digest,
        architecture: targetArchitecture,
        sourceHash: expectedSourceHash,
        compilerPath: null,
        compilerVersion: null,
        helperProtocol: HELPER_PROTOCOL,
        cachePath: executable,
      };
      const identity = invokeHelper(candidate, ['identity']);
      if (identity.operation === 'identity' && identity.architecture === targetArchitecture
          && identity.source_sha256 === expectedSourceHash
          && typeof identity.compiler_path === 'string' && !CONTROL_CHARACTERS.test(identity.compiler_path)
          && typeof identity.compiler_version === 'string' && !CONTROL_CHARACTERS.test(identity.compiler_version)) {
        candidate.compilerPath = identity.compiler_path;
        candidate.compilerVersion = identity.compiler_version;
        helpers.push(candidate);
      }
    } catch {
      // Invalid cache leaves are ignored here and never invoked for mutation.
    }
  }
  return helpers;
}

function removeBuildDirectory(path) {
  const parent = resolve(tmpdir());
  const resolved = resolve(path);
  const status = lstatSync(resolved);
  if (!resolved.startsWith(`${parent}${sep}`)
      || !basename(resolved).startsWith('skills-refiner-build-')
      || !status.isDirectory() || status.isSymbolicLink() || status.uid !== process.getuid()) {
    fail('blocked', 'unsafe_build_cleanup');
  }
  rmSync(resolved, { recursive: true, force: true });
}

function processIsLive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function cleanupStaleBuildDirectories() {
  const parent = resolve(tmpdir());
  for (const name of readdirSync(parent)) {
    const match = /^skills-refiner-build-(\d+)-/u.exec(name);
    if (!match) continue;
    const processId = Number(match[1]);
    if (!Number.isSafeInteger(processId) || processId <= 0 || processIsLive(processId)) continue;
    const path = join(parent, name);
    try {
      const status = lstatSync(path);
      if (status.isDirectory() && !status.isSymbolicLink() && status.uid === process.getuid()
          && (status.mode & 0o777) === 0o700) {
        rmSync(path, { recursive: true, force: true });
      }
    } catch {
      // A concurrent cleanup or replacement makes this candidate ineligible.
    }
  }
}

function compileAndInstallHelper(home, targetArchitecture, sourceSnapshot, xcrunPath) {
  const sourceHash = sourceSnapshot.hash;
  const xcrun = spawnSync(xcrunPath, ['--find', 'clang'], {
    encoding: 'utf8',
    env: sanitizedEnvironment(home),
    maxBuffer: MAX_HELPER_OUTPUT,
    shell: false,
  });
  if (xcrun.error || xcrun.status !== 0) fail('unsupported', 'compiler_unavailable');
  const compilerPath = xcrun.stdout.trim();
  if (!trustedSystemPath(compilerPath, 'file')) {
    fail('unsupported', 'compiler_unavailable');
  }
  const version = spawnSync(compilerPath, ['--version'], {
    encoding: 'utf8',
    env: sanitizedEnvironment(home),
    maxBuffer: MAX_HELPER_OUTPUT,
    shell: false,
  });
  if (version.error || version.status !== 0) fail('unsupported', 'compiler_unavailable');
  const compilerVersion = version.stdout.split(/\r?\n/u)[0].slice(0, 4096);
  if (compilerVersion.length === 0 || CONTROL_CHARACTERS.test(compilerVersion)
      || /["\\]/u.test(compilerVersion)) fail('unsupported', 'compiler_unavailable');
  const sdk = spawnSync(xcrunPath, ['--sdk', 'macosx', '--show-sdk-path'], {
    encoding: 'utf8',
    env: sanitizedEnvironment(home),
    maxBuffer: MAX_HELPER_OUTPUT,
    shell: false,
  });
  const sdkPath = sdk.stdout?.trim();
  if (sdk.error || sdk.status !== 0 || !trustedSystemPath(sdkPath, 'directory')) {
    fail('unsupported', 'compiler_unavailable');
  }

  cleanupStaleBuildDirectories();
  const buildDirectory = mkdtempSync(join(tmpdir(), `skills-refiner-build-${process.pid}-`));
  chmodSync(buildDirectory, 0o700);
  const outputPath = join(buildDirectory, 'cleanup-macos-helper');
  const sourcePath = join(buildDirectory, 'cleanup-macos-helper.c');
  try {
    writeFileSync(sourcePath, sourceSnapshot.bytes, { flag: 'wx', mode: 0o600 });
    const compilation = spawnSync(compilerPath, [
      '-std=c17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-O2',
      '-isysroot',
      sdkPath,
      `-DSR_SOURCE_SHA256="${sourceHash}"`,
      cStringDefinition('SR_COMPILER_PATH', compilerPath),
      cStringDefinition('SR_COMPILER_VERSION', compilerVersion),
      sourcePath,
      '-o',
      outputPath,
    ], {
      encoding: 'utf8',
      env: sanitizedEnvironment(home),
      maxBuffer: MAX_HELPER_OUTPUT,
      shell: false,
    });
    if (compilation.error || compilation.status !== 0) fail('unsupported', 'compiler_failed');
    chmodSync(outputPath, 0o700);
    const binaryHash = hashFile(outputPath);
    if (!ownedExecutable(outputPath, binaryHash)) fail('blocked', 'compiled_helper_unsafe');
    const bootstrap = {
      path: outputPath,
      home,
      binaryHash,
      architecture: targetArchitecture,
      sourceHash,
      compilerPath,
      compilerVersion,
      helperProtocol: HELPER_PROTOCOL,
      cachePath: join(
        home,
        '.agents',
        'skills-refiner',
        'runtime',
        'macos',
        targetArchitecture,
        binaryHash,
        'cleanup-macos-helper',
      ),
    };
    const installed = invokeHelper(bootstrap, [
      'install-self',
      home,
      targetArchitecture,
      binaryHash,
    ]);
    if (installed.operation !== 'install-self' || installed.binary_sha256 !== binaryHash
        || !ownedExecutable(bootstrap.cachePath, binaryHash)) {
      fail('blocked', 'runtime_cache_verification_failed');
    }
    return { ...bootstrap, path: bootstrap.cachePath };
  } finally {
    removeBuildDirectory(buildDirectory);
  }
}

function ensureMacosHelperInternal({
  home,
  forceCompile = false,
  xcrunPath = '/usr/bin/xcrun',
} = {}) {
  if (process.platform !== 'darwin') fail('unsupported', 'unsupported_platform');
  if (process.versions.node.split('.')[0] !== '24') fail('unsupported', 'unsupported_node_runtime');
  const verifiedHome = safePath(home ?? process.env.HOME, 'home');
  const targetArchitecture = architecture();
  const sourceSnapshot = stableSourceSnapshot();
  const sourceHash = sourceSnapshot.hash;
  const key = `${verifiedHome}\0${targetArchitecture}\0${sourceHash}`;
  if (!forceCompile && helperCache.has(key)) {
    const cached = helperCache.get(key);
    if (ownedNoFollowChain(verifiedHome, cached.path, { leafKind: 'file', leafMode: 0o700 })
        && ownedExecutable(cached.path, cached.binaryHash)) return cached;
    helperCache.delete(key);
  }
  if (!forceCompile) {
    const persistent = verifiedCachedHelpers(verifiedHome, targetArchitecture, sourceHash)
      .sort((left, right) => left.binaryHash.localeCompare(right.binaryHash));
    if (persistent.length > 0) {
      helperCache.set(key, persistent[0]);
      return persistent[0];
    }
  }
  const built = compileAndInstallHelper(verifiedHome, targetArchitecture, sourceSnapshot, xcrunPath);
  helperCache.set(key, built);
  return built;
}

export function ensureMacosHelper(options = {}) {
  return ensureMacosHelperInternal(options);
}

export function ensureReferencedMacosHelper({
  home,
  binaryHash,
  sourceHash,
  expectedArchitecture,
} = {}) {
  if (process.platform !== 'darwin') fail('unsupported', 'unsupported_platform');
  if (process.versions.node.split('.')[0] !== '24') fail('unsupported', 'unsupported_node_runtime');
  const verifiedHome = safePath(home ?? process.env.HOME, 'home');
  const targetArchitecture = expectedArchitecture ?? architecture();
  if (!DIGEST.test(binaryHash ?? '') || !DIGEST.test(sourceHash ?? '')
      || targetArchitecture !== architecture()) {
    fail('blocked', 'invalid_referenced_helper_identity');
  }
  const candidates = verifiedCachedHelpers(verifiedHome, targetArchitecture, sourceHash)
    .filter((candidate) => candidate.binaryHash === binaryHash);
  if (candidates.length !== 1) fail('recovery_required', 'referenced_helper_unavailable');
  return candidates[0];
}

function gitResult(home, args, extraEnvironment = {}) {
  return spawnSync('/usr/bin/git', args, {
    encoding: 'utf8',
    env: { ...sanitizedEnvironment(home), ...extraEnvironment },
    maxBuffer: MAX_HELPER_OUTPUT,
    shell: false,
    windowsHide: true,
  });
}

function isGitManagedDirectory(home, entryPath) {
  let current = entryPath;
  for (;;) {
    try {
      const gitMarker = lstatSync(join(current, '.git'));
      if (gitMarker.isDirectory() || gitMarker.isFile() || gitMarker.isSymbolicLink()) return true;
      fail('blocked', 'git_probe_failed');
    } catch (error) {
      if (error instanceof MacosAdapterError) throw error;
      if (error?.code !== 'ENOENT') fail('blocked', 'git_probe_failed');
    }
    if (current === home) break;
    const parent = dirname(current);
    if (parent === current || (!parent.startsWith(`${home}${sep}`) && parent !== home)) {
      fail('blocked', 'git_probe_failed');
    }
    current = parent;
  }
  const result = gitResult(home, ['-C', entryPath, 'rev-parse', '--show-toplevel']);
  if (result.error) fail('blocked', 'git_probe_failed');
  return result.status === 0;
}

function safeRemoveGitTemporary(path) {
  const resolved = resolve(path);
  const parent = resolve(tmpdir());
  const status = lstatSync(resolved);
  if (!resolved.startsWith(`${parent}${sep}`)
      || !basename(resolved).startsWith('skills-refiner-git-tree-')
      || !status.isDirectory() || status.isSymbolicLink() || status.uid !== process.getuid()) {
    fail('blocked', 'unsafe_git_temporary_cleanup');
  }
  rmSync(resolved, { recursive: true, force: true });
}

function installedTreeSha1(home, entryPath) {
  const temporary = mkdtempSync(join(tmpdir(), 'skills-refiner-git-tree-'));
  chmodSync(temporary, 0o700);
  const repository = join(temporary, 'repo');
  const index = join(temporary, 'index');
  try {
    const initialized = gitResult(home, ['init', '--bare', '-q', repository]);
    if (initialized.error || initialized.status !== 0) fail('blocked', 'installed_tree_hash_failed');
    const environment = { GIT_INDEX_FILE: index };
    const added = gitResult(home, [
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
    ], environment);
    if (added.error || added.status !== 0) fail('blocked', 'installed_tree_hash_failed');
    const written = gitResult(home, [
      `--git-dir=${repository}`,
      `--work-tree=${entryPath}`,
      'write-tree',
    ], environment);
    const tree = written.stdout.trim();
    if (written.error || written.status !== 0 || !TREE_SHA1.test(tree)) {
      fail('blocked', 'installed_tree_hash_failed');
    }
    return tree;
  } finally {
    safeRemoveGitTemporary(temporary);
  }
}

function directReceiptEvidence(candidate) {
  const mutation = candidate?.evidence?.mutation_provenance;
  const evidence = mutation?.evidence;
  if (mutation?.kind !== 'installed_copy' || mutation.confidence !== 'direct'
      || evidence?.kind !== 'content_bound_installer_receipt'
      || !DIGEST.test(evidence.receipt_sha256 ?? '')
      || !TREE_SHA1.test(evidence.installed_tree_sha1 ?? '')) return null;
  return evidence;
}

function receiptTreeForEntry(response, entryPath) {
  if (typeof response.receipt_base64 !== 'string' || response.receipt_base64.length === 0) {
    fail('blocked', 'receipt_mapping_invalid');
  }
  const bytes = Buffer.from(response.receipt_base64, 'base64');
  if (bytes.toString('base64') !== response.receipt_base64) {
    fail('blocked', 'receipt_mapping_invalid');
  }
  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('blocked', 'receipt_mapping_invalid');
  }
  const skills = receipt?.skills;
  const name = basename(entryPath);
  if (receipt?.version !== 3 || !skills || typeof skills !== 'object' || Array.isArray(skills)
      || !Object.hasOwn(skills, name)) {
    fail('blocked', receipt?.version === 3 ? 'receipt_entry_missing' : 'receipt_mapping_invalid');
  }
  const record = skills[name];
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || !['source', 'sourceType', 'sourceUrl', 'skillPath'].every(
        (field) => typeof record[field] === 'string' && record[field].length > 0,
      )
      || record.sourceType !== 'github'
      || !TREE_SHA1.test(record.skillFolderHash ?? '')) {
    fail('blocked', 'receipt_mapping_invalid');
  }
  return record.skillFolderHash;
}

function helperIdentity(helper) {
  return {
    source_hash: helper.sourceHash === null ? null : `sha256:${helper.sourceHash}`,
    binary_hash: `sha256:${helper.binaryHash}`,
    architecture: helper.architecture,
    compiler_path: helper.compilerPath,
    compiler_version: helper.compilerVersion,
    helper_protocol: helper.helperProtocol,
    cache_path: helper.cachePath,
  };
}

export function createMacosAdapter({ home = process.env.HOME, forceCompile = false } = {}) {
  const verifiedHome = safePath(home, 'home');
  return {
    name: 'macos',
    async inspectForPlan(entryPath, activeRoot, candidate = null) {
      safePath(entryPath, 'entryPath');
      safePath(activeRoot, 'activeRoot');
      if (!ACTIVE_ROOTS.has(relative(verifiedHome, activeRoot))
          || dirname(entryPath) !== activeRoot || basename(entryPath).length === 0) {
        fail('blocked', 'not_immediate_child');
      }
      const helper = ensureMacosHelper({ home: verifiedHome, forceCompile });
      let response;
      try {
        response = invokeHelper(helper, ['inspect', verifiedHome, activeRoot, entryPath]);
      } catch (error) {
        if (error instanceof MacosAdapterError && error.reason === 'authoring_source') {
          fail('review_only', 'authoring_source');
        }
        throw error;
      }
      if (response.operation !== 'inspect') fail('blocked', 'helper_protocol_mismatch');
      const expectedKind = candidate?.entry_kind ?? response.entry_kind;
      if (response.entry_kind === 'symlink') {
        if (!['symlink', 'broken_symlink'].includes(expectedKind)) fail('blocked', 'entry_kind_changed');
        if (candidate?.entry_identity?.raw_link_target_base64 != null
            && candidate.entry_identity.raw_link_target_base64 !== response.raw_link_target_base64) {
          fail('blocked', 'identity_changed');
        }
      } else if (expectedKind !== 'directory') {
        fail('blocked', 'entry_kind_changed');
      }

      let receiptSha256 = null;
      let treeSha1 = null;
      if (response.entry_kind === 'directory') {
        if (candidate?.mutation_eligibility === 'review_only' || candidate?.source?.git_root
            || isGitManagedDirectory(verifiedHome, entryPath)) {
          fail('review_only', 'authoring_source');
        }
        const receiptEvidence = directReceiptEvidence(candidate);
        if (receiptEvidence === null) fail('review_only', 'unproven_installed_copy');
        const receipt = invokeHelper(helper, ['hash-install-receipt', verifiedHome]);
        if (receipt.operation !== 'hash-install-receipt'
            || receipt.receipt_sha256 !== receiptEvidence.receipt_sha256) {
          fail('blocked', 'receipt_drift');
        }
        const receiptTreeSha1 = receiptTreeForEntry(receipt, entryPath);
        if (receiptTreeSha1 !== receiptEvidence.installed_tree_sha1) {
          fail('blocked', 'receipt_mapping_drift');
        }
        treeSha1 = installedTreeSha1(verifiedHome, entryPath);
        if (treeSha1 !== receiptTreeSha1) fail('blocked', 'installed_tree_drift');
        receiptSha256 = receipt.receipt_sha256;
      }

      const identity = {
        schema_version: SCHEMAS.identity,
        adapter: 'macos-native.v1',
        entry_path: entryPath,
        active_root: activeRoot,
        entry_kind: expectedKind,
        ...helperIdentity(helper),
        device: response.device,
        inode: response.inode,
        mode: response.mode,
        uid: response.uid,
        gid: response.gid,
        flags: response.flags,
        manifest_hash: response.manifest_hash,
        security_metadata_hash: response.security_metadata_hash,
        raw_link_target_base64: response.raw_link_target_base64,
        receipt_sha256: receiptSha256,
        installed_tree_sha1: treeSha1,
      };
      identity.identity_hash = computeIdentityHash(identity);
      return identity;
    },
  };
}

function durableWriteJsonInternal({
  home = process.env.HOME,
  role,
  relativeDirectory = '.',
  leaf,
  value,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = ensureMacosHelper({ home: verifiedHome });
  const input = `${canonicalJson(value)}\n`;
  return invokeHelper(helper, [
    'publish-state',
    verifiedHome,
    role,
    relativeDirectory,
    leaf,
  ], { input, mutationMayHaveOccurred: true, testEnvironment });
}

export function durableWriteJson(options = {}) {
  return durableWriteJsonInternal(options);
}

function renameExclusiveInternal({
  home = process.env.HOME,
  activeRoot,
  entryPath,
  destinationRelativeDirectory,
  destinationLeaf,
  expectedIdentity,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  if (!expectedIdentity || typeof expectedIdentity.device !== 'string'
      || typeof expectedIdentity.inode !== 'string'
      || typeof expectedIdentity.manifest_hash !== 'string') {
    fail('blocked', 'missing_expected_identity');
  }
  const helper = ensureMacosHelper({ home: verifiedHome });
  return invokeHelper(helper, [
    'rename-exclusive',
    verifiedHome,
    authorizedActiveRoot(verifiedHome, activeRoot),
    safePath(entryPath, 'entryPath'),
    destinationRelativeDirectory,
    destinationLeaf,
    expectedIdentity.device,
    expectedIdentity.inode,
    expectedIdentity.manifest_hash,
    expectedIdentity.receipt_sha256 ?? '-',
  ], { mutationMayHaveOccurred: true, testEnvironment });
}

export function renameExclusive(options = {}) {
  return renameExclusiveInternal(options);
}

export const __testing = Object.freeze({
  HELPER_PROTOCOL,
  HELPER_SOURCE,
  clearHelperCache() {
    helperCache.clear();
  },
  hashFile,
  parseHelperResult(result, options) {
    return parseHelperOutput(result, options);
  },
  ensureWithXcrun(options) {
    return ensureMacosHelperInternal(options);
  },
  publishStateWithCrash(options, point = 'after_state_rename') {
    return durableWriteJsonInternal(options, { SKILLS_REFINER_TEST_CRASH: point });
  },
  renameWithCrash(options, point = 'after_rename') {
    return renameExclusiveInternal(options, { SKILLS_REFINER_TEST_CRASH: point });
  },
  publishStateWithFailure(options, point) {
    return durableWriteJsonInternal(options, { SKILLS_REFINER_TEST_FAIL: point });
  },
  renameWithFailure(options, point) {
    return renameExclusiveInternal(options, { SKILLS_REFINER_TEST_FAIL: point });
  },
});
