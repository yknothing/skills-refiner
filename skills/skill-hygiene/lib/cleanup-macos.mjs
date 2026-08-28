import { createHash, randomBytes } from 'node:crypto';
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
  computeObservationIdentityHash,
  validateExecutionIdentity,
  validateObservationIdentity,
} from './cleanup-contract.mjs';

const HELPER_PROTOCOL = 'skills-refiner.macos-helper.v1';
const HELPER_SOURCE = fileURLToPath(new URL('../native/cleanup-macos-helper.c', import.meta.url));
const COMMAND_LINE_TOOLS_DEVELOPER_DIR = '/Library/Developer/CommandLineTools';
const MAX_HELPER_OUTPUT = 2 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/u;
const TREE_SHA1 = /^[0-9a-f]{40}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const SHA256_IDENTIFIER = /^sha256:[0-9a-f]{64}$/u;
const STATIC_ACTIVE_ROOTS = new Set([
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
const DISCOVERED_AGENT_ACTIVE_ROOT = /^\.[A-Za-z0-9][A-Za-z0-9._-]*\/skills$/u;

const helperCache = new Map();

export class MacosAdapterError extends Error {
  constructor(code, reason, message = 'macOS cleanup adapter blocked the operation', {
    mutationMayHaveOccurred = false,
  } = {}) {
    super(message);
    this.name = 'MacosAdapterError';
    this.code = code;
    this.reason = reason;
    this.mutationMayHaveOccurred = mutationMayHaveOccurred;
  }
}

function fail(code, reason, message, context) {
  throw new MacosAdapterError(code, reason, message, context);
}

function architecture() {
  if (arch() === 'arm64') return 'arm64';
  if (arch() === 'x64') return 'x86_64';
  fail('unsupported', 'unsupported_architecture');
}

function sanitizedEnvironment(home, developerDirectory = null) {
  const environment = {
    PATH: '/usr/bin:/bin',
    HOME: home,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (developerDirectory !== null) environment.DEVELOPER_DIR = developerDirectory;
  return environment;
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
  const relativeRoot = relative(home, activeRoot);
  if (!STATIC_ACTIVE_ROOTS.has(relativeRoot) && !DISCOVERED_AGENT_ACTIVE_ROOT.test(relativeRoot)) {
    fail('blocked', 'unrecognized_active_root');
  }
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
    if (mutationMayHaveOccurred) {
      fail(
        'recovery_required',
        'helper_mutation_result_unknown',
        undefined,
        { mutationMayHaveOccurred: true },
      );
    }
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
    fail(
      'recovery_required',
      response.reason ?? 'native_helper_recovery_required',
      undefined,
      { mutationMayHaveOccurred },
    );
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

function verifiedCachedHelpers(home, targetArchitecture, expectedSourceHash = null) {
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
  const cacheLeaves = readdirSync(architectureRoot).sort();
  if (cacheLeaves.length > 256) return [];
  for (const digest of cacheLeaves) {
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
          && (expectedSourceHash === null || identity.source_sha256 === expectedSourceHash)
          && typeof identity.compiler_path === 'string' && !CONTROL_CHARACTERS.test(identity.compiler_path)
          && typeof identity.compiler_version === 'string' && !CONTROL_CHARACTERS.test(identity.compiler_version)) {
        candidate.sourceHash = identity.source_sha256;
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

function discoverTrustedToolchain(home, xcrunPath, developerDirectory = null) {
  if (developerDirectory !== null
      && !trustedSystemPath(developerDirectory, 'directory')) return null;
  const environment = sanitizedEnvironment(home, developerDirectory);
  const xcrun = spawnSync(xcrunPath, ['--find', 'clang'], {
    encoding: 'utf8',
    env: environment,
    maxBuffer: MAX_HELPER_OUTPUT,
    shell: false,
  });
  if (xcrun.error || xcrun.status !== 0) return null;
  const compilerPath = xcrun.stdout.trim();
  if (!trustedSystemPath(compilerPath, 'file')) return null;
  const version = spawnSync(compilerPath, ['--version'], {
    encoding: 'utf8',
    env: environment,
    maxBuffer: MAX_HELPER_OUTPUT,
    shell: false,
  });
  if (version.error || version.status !== 0) return null;
  const compilerVersion = version.stdout.split(/\r?\n/u)[0].slice(0, 4096);
  if (compilerVersion.length === 0 || CONTROL_CHARACTERS.test(compilerVersion)
      || /["\\]/u.test(compilerVersion)) return null;
  const sdk = spawnSync(xcrunPath, ['--sdk', 'macosx', '--show-sdk-path'], {
    encoding: 'utf8',
    env: environment,
    maxBuffer: MAX_HELPER_OUTPUT,
    shell: false,
  });
  const sdkPath = sdk.stdout?.trim();
  if (sdk.error || sdk.status !== 0 || !trustedSystemPath(sdkPath, 'directory')) return null;
  return { compilerPath, compilerVersion, sdkPath, environment };
}

function compileAndInstallHelper(home, targetArchitecture, sourceSnapshot, xcrunPath) {
  const sourceHash = sourceSnapshot.hash;
  const toolchain = discoverTrustedToolchain(home, xcrunPath)
    ?? discoverTrustedToolchain(home, xcrunPath, COMMAND_LINE_TOOLS_DEVELOPER_DIR);
  if (toolchain === null) fail('unsupported', 'compiler_unavailable');
  const {
    compilerPath,
    compilerVersion,
    sdkPath,
    environment,
  } = toolchain;

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
      env: { ...environment, TMPDIR: buildDirectory },
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

function installVerifiedLauncherInternal({
  home = process.env.HOME,
  targetDirectory,
  launcherBytes,
  expectedHash,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const verifiedTarget = safePath(targetDirectory, 'targetDirectory');
  if (!Buffer.isBuffer(launcherBytes) || launcherBytes.length === 0
      || launcherBytes.length > 1024 * 1024 || !DIGEST.test(expectedHash ?? '')
      || hashBytes(launcherBytes) !== expectedHash) {
    fail('blocked', 'invalid_launcher_identity');
  }
  const helper = ensureMacosHelperInternal({ home: verifiedHome });
  const installed = invokeHelper(helper, [
    'install-launcher-v1',
    verifiedTarget,
    expectedHash,
  ], { input: launcherBytes, mutationMayHaveOccurred: true, testEnvironment });
  if (installed.operation !== 'install-launcher-v1'
      || !['installed', 'existing'].includes(installed.result)
      || installed.digest !== expectedHash) {
    fail(
      'recovery_required',
      'launcher_install_result_invalid',
      undefined,
      { mutationMayHaveOccurred: true },
    );
  }
  let verified;
  try {
    verified = invokeHelper(helper, [
      'verify-launcher-v1',
      verifiedTarget,
      expectedHash,
    ], { mutationMayHaveOccurred: installed.result === 'installed', testEnvironment });
  } catch (error) {
    if (installed.result === 'installed') {
      fail(
        'recovery_required',
        'launcher_postcondition_failed',
        undefined,
        { mutationMayHaveOccurred: true },
      );
    }
    throw error;
  }
  if (verified.operation !== 'verify-launcher-v1' || verified.digest !== expectedHash
      || verified.mode !== 0o700 || verified.uid !== process.getuid()) {
    fail(
      'recovery_required',
      'launcher_postcondition_failed',
      undefined,
      { mutationMayHaveOccurred: installed.result === 'installed' },
    );
  }
  return { result: installed.result, digest: expectedHash };
}

export function installVerifiedLauncher(options = {}) {
  return installVerifiedLauncherInternal(options);
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
  const inspectIdentity = async (entryPath, activeRoot, candidate = null) => {
    safePath(entryPath, 'entryPath');
    safePath(activeRoot, 'activeRoot');
    const relativeRoot = relative(verifiedHome, activeRoot);
    if ((!STATIC_ACTIVE_ROOTS.has(relativeRoot) && !DISCOVERED_AGENT_ACTIVE_ROOT.test(relativeRoot))
        || dirname(entryPath) !== activeRoot || basename(entryPath).length === 0) {
      fail('blocked', 'not_immediate_child');
    }
    const helper = ensureMacosHelper({ home: verifiedHome, forceCompile });
    const response = invokeHelper(helper, [
      'inspect-observation-v1', verifiedHome, activeRoot, entryPath,
    ]);
    if (response.operation !== 'inspect-observation-v1') fail('blocked', 'helper_protocol_mismatch');
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
    const identity = {
      schema_version: SCHEMAS.observationIdentity,
      adapter: 'macos-native-observation.v1',
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
    };
    identity.identity_hash = computeObservationIdentityHash(identity);
    return identity;
  };
  return {
    name: 'macos',
    inspectIdentity,
    async inspectForPlan(entryPath, activeRoot, candidate = null) {
      const observation = await inspectIdentity(entryPath, activeRoot, candidate);
      const helper = helperForObservationIdentity(verifiedHome, observation);
      const expectedKind = observation.entry_kind;

      let receiptSha256 = null;
      let treeSha1 = null;
      if (expectedKind === 'directory') {
        let mutationObservation;
        try {
          mutationObservation = invokeHelper(helper, [
            'inspect', verifiedHome, activeRoot, entryPath,
          ]);
        } catch (error) {
          if (error instanceof MacosAdapterError && error.reason === 'authoring_source') {
            fail('review_only', 'authoring_source');
          }
          throw error;
        }
        if (mutationObservation.operation !== 'inspect'
            || mutationObservation.manifest_hash !== observation.manifest_hash) {
          fail('blocked', 'identity_changed');
        }
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
        entry_path: observation.entry_path,
        active_root: observation.active_root,
        entry_kind: expectedKind,
        ...helperIdentity(helper),
        device: observation.device,
        inode: observation.inode,
        mode: observation.mode,
        uid: observation.uid,
        gid: observation.gid,
        flags: observation.flags,
        manifest_hash: observation.manifest_hash,
        security_metadata_hash: observation.security_metadata_hash,
        raw_link_target_base64: observation.raw_link_target_base64,
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
  executionIdentity = null,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = executionIdentity === null
    ? ensureMacosHelper({ home: verifiedHome })
    : helperForExecutionIdentity(verifiedHome, executionIdentity);
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
  const helper = helperForExecutionIdentity(verifiedHome, expectedIdentity);
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

function collectionPathParts(home, path, name) {
  const verified = safePath(path, name);
  const parent = dirname(verified);
  const parentRelative = relative(home, parent);
  const leaf = basename(verified);
  if (parentRelative.length === 0 || parentRelative === '..'
      || parentRelative.startsWith(`..${sep}`) || isAbsolute(parentRelative)
      || leaf.length === 0 || leaf === '.' || leaf === '..') {
    fail('blocked', 'invalid_collection_path');
  }
  return { path: verified, parentRelative, leaf };
}

export function inspectCollectionEntry({ home = process.env.HOME, path } = {}) {
  const verifiedHome = safePath(home, 'home');
  const entry = collectionPathParts(verifiedHome, path, 'path');
  const helper = ensureMacosHelper({ home: verifiedHome });
  return invokeHelper(helper, [
    'collection-inspect-v1', verifiedHome, entry.parentRelative, entry.leaf,
  ]);
}

export function moveCollectionEntryExclusive({
  home = process.env.HOME,
  source,
  destination,
  expectedManifest = null,
  expectedDevice = null,
  expectedInode = null,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const sourceEntry = collectionPathParts(verifiedHome, source, 'source');
  const destinationEntry = collectionPathParts(verifiedHome, destination, 'destination');
  const helper = ensureMacosHelper({ home: verifiedHome });
  const identity = invokeHelper(helper, [
    'collection-inspect-v1', verifiedHome, sourceEntry.parentRelative, sourceEntry.leaf,
  ]);
  if ((expectedManifest !== null
        && (!SHA256_IDENTIFIER.test(expectedManifest) || identity.manifest_hash !== expectedManifest))
      || (expectedDevice !== null && identity.device !== expectedDevice)
      || (expectedInode !== null && identity.inode !== expectedInode)) {
    fail('blocked', 'collection_identity_changed');
  }
  return invokeHelper(helper, [
    'collection-rename-exclusive-v1',
    verifiedHome,
    sourceEntry.parentRelative,
    sourceEntry.leaf,
    destinationEntry.parentRelative,
    destinationEntry.leaf,
    identity.device,
    identity.inode,
    identity.manifest_hash,
  ], { mutationMayHaveOccurred: true });
}

export function createCollectionSymlinkExclusive({
  home = process.env.HOME,
  path,
  rawTarget,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const entry = collectionPathParts(verifiedHome, path, 'path');
  if (typeof rawTarget !== 'string' || rawTarget.length === 0 || CONTROL_CHARACTERS.test(rawTarget)) {
    fail('blocked', 'invalid_collection_symlink_target');
  }
  const helper = ensureMacosHelper({ home: verifiedHome });
  return invokeHelper(helper, [
    'collection-symlink-exclusive-v1', verifiedHome, entry.parentRelative, entry.leaf, rawTarget,
  ], { mutationMayHaveOccurred: true });
}

export function unlinkCollectionSymlinkExact({
  home = process.env.HOME,
  path,
  rawTarget,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const entry = collectionPathParts(verifiedHome, path, 'path');
  if (typeof rawTarget !== 'string' || rawTarget.length === 0 || CONTROL_CHARACTERS.test(rawTarget)) {
    fail('blocked', 'invalid_collection_symlink_target');
  }
  const helper = ensureMacosHelper({ home: verifiedHome });
  return invokeHelper(helper, [
    'collection-unlink-symlink-v1', verifiedHome, entry.parentRelative, entry.leaf, rawTarget,
  ], { mutationMayHaveOccurred: true });
}

export function unlinkCollectionSymlinkIdentityExact({
  home = process.env.HOME,
  path,
  rawTarget,
  device,
  inode,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const entry = collectionPathParts(verifiedHome, path, 'path');
  if (typeof rawTarget !== 'string' || rawTarget.length === 0 || CONTROL_CHARACTERS.test(rawTarget)
      || typeof device !== 'string' || !/^\d+$/u.test(device)
      || typeof inode !== 'string' || !/^\d+$/u.test(inode)) {
    fail('blocked', 'invalid_collection_symlink_identity');
  }
  const helper = ensureMacosHelper({ home: verifiedHome });
  return invokeHelper(helper, [
    'collection-unlink-symlink-identity-v1',
    verifiedHome,
    entry.parentRelative,
    entry.leaf,
    rawTarget,
    device,
    inode,
  ], { mutationMayHaveOccurred: true });
}

export function createCollectionFileExclusive({
  home = process.env.HOME,
  path,
  targetDigest,
  bytes,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const entry = collectionPathParts(verifiedHome, path, 'path');
  if (!SHA256_IDENTIFIER.test(targetDigest ?? '')
      || !(typeof bytes === 'string' || Buffer.isBuffer(bytes))) {
    fail('blocked', 'invalid_file_create_contract');
  }
  const helper = ensureMacosHelper({ home: verifiedHome });
  const response = invokeHelper(helper, [
    'collection-create-file-exclusive-v1',
    verifiedHome,
    entry.parentRelative,
    entry.leaf,
    targetDigest,
  ], { input: bytes, mutationMayHaveOccurred: true, testEnvironment });
  if (response.operation !== 'collection-create-file-exclusive-v1'
      || response.digest !== targetDigest
      || typeof response.device !== 'string' || !/^\d+$/u.test(response.device)
      || typeof response.inode !== 'string' || !/^\d+$/u.test(response.inode)) {
    fail('recovery_required', 'file_create_postcondition_failed', undefined, { mutationMayHaveOccurred: true });
  }
  return response;
}

export function createCollectionDirectoryExclusive({
  home = process.env.HOME,
  path,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const entry = collectionPathParts(verifiedHome, path, 'path');
  const helper = ensureMacosHelper({ home: verifiedHome });
  const response = invokeHelper(helper, [
    'collection-create-directory-exclusive-v1',
    verifiedHome,
    entry.parentRelative,
    entry.leaf,
  ], { mutationMayHaveOccurred: true, testEnvironment });
  if (response.operation !== 'collection-create-directory-exclusive-v1'
      || typeof response.device !== 'string' || !/^\d+$/u.test(response.device)
      || typeof response.inode !== 'string' || !/^\d+$/u.test(response.inode)) {
    fail('recovery_required', 'directory_create_postcondition_failed', undefined, { mutationMayHaveOccurred: true });
  }
  return response;
}

export function replaceCollectionFileCas({
  home = process.env.HOME,
  path,
  expectedDigest,
  targetDigest,
  bytes,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const entry = collectionPathParts(verifiedHome, path, 'path');
  if (!SHA256_IDENTIFIER.test(expectedDigest ?? '') || !SHA256_IDENTIFIER.test(targetDigest ?? '')
      || !(typeof bytes === 'string' || Buffer.isBuffer(bytes))) {
    fail('blocked', 'invalid_file_cas_contract');
  }
  const helper = ensureMacosHelper({ home: verifiedHome });
  const response = invokeHelper(helper, [
    'collection-replace-file-cas-v1',
    verifiedHome,
    entry.parentRelative,
    entry.leaf,
    expectedDigest,
    targetDigest,
  ], { input: bytes, mutationMayHaveOccurred: true, testEnvironment });
  if (response.operation !== 'collection-replace-file-cas-v1' || response.digest !== targetDigest) {
    fail('recovery_required', 'file_cas_postcondition_failed', undefined, { mutationMayHaveOccurred: true });
  }
  return response;
}

function validateMutationIdentity(executionIdentity) {
  try {
    validateExecutionIdentity(executionIdentity);
    if (executionIdentity.adapter !== 'macos-native.v1'
        || executionIdentity.helper_protocol !== HELPER_PROTOCOL) {
      fail('blocked', 'invalid_mutation_identity');
    }
    return executionIdentity;
  } catch (error) {
    if (error instanceof MacosAdapterError) throw error;
    fail('blocked', 'invalid_mutation_identity');
  }
}

function helperForExecutionIdentity(home, executionIdentity) {
  const identity = validateMutationIdentity(executionIdentity);
  return ensureReferencedMacosHelper({
    home,
    binaryHash: identity.binary_hash.replace(/^sha256:/u, ''),
    sourceHash: identity.source_hash.replace(/^sha256:/u, ''),
    expectedArchitecture: identity.architecture,
  });
}

function helperForObservationIdentity(home, observationIdentity) {
  try {
    validateObservationIdentity(observationIdentity);
    if (observationIdentity.adapter !== 'macos-native-observation.v1'
        || observationIdentity.helper_protocol !== HELPER_PROTOCOL) {
      fail('blocked', 'invalid_observation_identity');
    }
  } catch (error) {
    if (error instanceof MacosAdapterError) throw error;
    fail('blocked', 'invalid_observation_identity');
  }
  return ensureReferencedMacosHelper({
    home,
    binaryHash: observationIdentity.binary_hash.replace(/^sha256:/u, ''),
    sourceHash: observationIdentity.source_hash.replace(/^sha256:/u, ''),
    expectedArchitecture: observationIdentity.architecture,
  });
}

function helperForKeepProbeAuthority(home, identity) {
  return identity?.schema_version === SCHEMAS.observationIdentity
    ? helperForObservationIdentity(home, identity)
    : helperForExecutionIdentity(home, identity);
}

function decodeTransactionRecord(response, field) {
  const encoded = response[field];
  if (typeof encoded !== 'string') fail('recovery_required', 'transaction_records_invalid');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) {
    fail('recovery_required', 'transaction_records_invalid');
  }
  let textValue;
  let value;
  try {
    textValue = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(textValue);
  } catch {
    fail('recovery_required', 'transaction_records_invalid');
  }
  if (canonicalJson(value) !== textValue) {
    fail('recovery_required', 'transaction_records_noncanonical');
  }
  return value;
}

function decodeOptionalTransactionRecord(response, field) {
  if (response[field] === null) return null;
  return decodeTransactionRecord(response, field);
}

function sha256Canonical(value) {
  return `sha256:${hashBytes(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

function initializeTransactionRecordsInternal({
  home = process.env.HOME,
  transactionId,
  plan,
  manifest,
  state,
  executionIdentity,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const input = [plan, manifest, state].map((value) => canonicalJson(value)).join('\n').concat('\n');
  return invokeHelper(helper, ['transaction-init', verifiedHome, transactionId], {
    input,
    mutationMayHaveOccurred: true,
    testEnvironment,
  });
}

export function initializeTransactionRecords(options = {}) {
  return initializeTransactionRecordsInternal(options);
}

export function initializeBatchTransactionRecords({
  home = process.env.HOME,
  transactionId,
  plan,
  manifest,
  state,
  binding,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const input = [plan, manifest, state, binding]
    .map((value) => canonicalJson(value)).join('\n').concat('\n');
  const response = invokeHelper(helper, [
    'transaction-init-batch-v2', verifiedHome, transactionId,
  ], { input, mutationMayHaveOccurred: true });
  if (response.operation !== 'transaction-init-batch-v2'
      || !['created', 'existing'].includes(response.result)) {
    fail('recovery_required', 'batch_transaction_records_invalid');
  }
  return response;
}

export function probeTransactionRecords({
  home = process.env.HOME,
  transactionId,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  return probeTransactionRecordsWithHelper(helper, transactionId);
}

export function probeBatchTransactionRecords({
  home = process.env.HOME,
  transactionId,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const response = invokeHelper(helper, [
    'probe-transaction-batch-v2', verifiedHome, transactionId,
  ]);
  if (response.operation !== 'probe-transaction-batch-v2') {
    fail('recovery_required', 'batch_transaction_records_invalid');
  }
  return {
    plan: decodeTransactionRecord(response, 'plan_base64'),
    manifest: decodeTransactionRecord(response, 'manifest_base64'),
    state: decodeTransactionRecord(response, 'state_base64'),
    binding: decodeTransactionRecord(response, 'binding_base64'),
    lock: decodeOptionalTransactionRecord(response, 'lock_base64'),
  };
}

export function probeTransactionKind({
  home = process.env.HOME,
  transactionId,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const response = invokeHelper(helper, [
    'probe-transaction-kind-v1', verifiedHome, transactionId,
  ]);
  if (response.operation !== 'probe-transaction-kind-v1'
      || !['standalone_v1', 'batch_v2'].includes(response.kind)) {
    fail('recovery_required', 'transaction_kind_ambiguous');
  }
  return response.kind;
}

function probeTransactionRecordsWithHelper(helper, transactionId) {
  const response = invokeHelper(helper, ['probe-transaction', helper.home, transactionId]);
  if (response.operation !== 'probe-transaction') {
    fail('recovery_required', 'transaction_records_invalid');
  }
  return {
    plan: decodeTransactionRecord(response, 'plan_base64'),
    manifest: decodeTransactionRecord(response, 'manifest_base64'),
    state: decodeTransactionRecord(response, 'state_base64'),
    lock: decodeOptionalTransactionRecord(response, 'lock_base64'),
  };
}

export function discoverTransactionRecords({
  home = process.env.HOME,
  transactionId,
} = {}) {
  if (process.platform !== 'darwin') fail('unsupported', 'unsupported_platform');
  if (process.versions.node.split('.')[0] !== '24') fail('unsupported', 'unsupported_node_runtime');
  const verifiedHome = safePath(home, 'home');
  const candidates = verifiedCachedHelpers(verifiedHome, architecture());
  let unavailable = 0;
  const matches = [];
  for (const candidate of candidates) {
    try {
      const records = probeTransactionRecordsWithHelper(candidate, transactionId);
      const identity = records.manifest?.execution_identity;
      if (identity?.binary_hash === `sha256:${candidate.binaryHash}`
          && identity.source_hash === `sha256:${candidate.sourceHash}`
          && identity.architecture === candidate.architecture
          && identity.helper_protocol === candidate.helperProtocol
          && identity.cache_path === candidate.cachePath
          && records.manifest?.transaction_id === transactionId) {
        matches.push({ helper: candidate, records });
      }
    } catch (error) {
      if (error instanceof MacosAdapterError && error.reason === 'transaction_unavailable') {
        unavailable += 1;
      }
    }
  }
  if (matches.length !== 1) {
    if (matches.length === 0 && candidates.length > 0 && unavailable === candidates.length) {
      fail('blocked', 'transaction_unavailable');
    }
    fail('recovery_required', 'transaction_helper_identity_ambiguous');
  }
  return matches[0].records;
}

function validateLockOwner(owner, { transactionId, planHash, nonce, pid = null }) {
  const keys = [
    'nonce',
    'pid',
    'plan_hash',
    'process_start_sec',
    'process_start_usec',
    'transaction_id',
  ];
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)
      || Object.keys(owner).length !== keys.length
      || keys.some((key) => !Object.hasOwn(owner, key))
      || owner.transaction_id !== transactionId || owner.plan_hash !== planHash
      || owner.nonce !== nonce || (pid !== null && owner.pid !== pid)
      || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || !Number.isSafeInteger(owner.process_start_sec) || owner.process_start_sec < 0
      || !Number.isSafeInteger(owner.process_start_usec) || owner.process_start_usec < 0) {
    fail('recovery_required', 'lock_identity_invalid');
  }
  canonicalJson(owner);
  return owner;
}

function acquireTransactionLockInternal({
  home = process.env.HOME,
  transactionId,
  planHash,
  executionIdentity,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const nonce = randomBytes(32).toString('hex');
  const response = invokeHelper(helper, [
    'lock-acquire',
    verifiedHome,
    transactionId,
    planHash,
    nonce,
    String(process.pid),
  ], { mutationMayHaveOccurred: true, testEnvironment });
  if (response.operation !== 'lock-acquire') fail('recovery_required', 'lock_identity_invalid');
  return validateLockOwner(response.owner, {
    transactionId,
    planHash,
    nonce,
    pid: process.pid,
  });
}

export function acquireTransactionLock(options = {}) {
  return acquireTransactionLockInternal(options);
}

function moveTransactionLock(command, {
  home = process.env.HOME,
  transactionId,
  planHash,
  owner,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const validatedOwner = validateLockOwner(owner, {
    transactionId,
    planHash,
    nonce: owner?.nonce,
  });
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  return invokeHelper(helper, [
    command,
    verifiedHome,
    transactionId,
    planHash,
    validatedOwner.nonce,
    String(validatedOwner.pid),
    String(validatedOwner.process_start_sec),
    String(validatedOwner.process_start_usec),
  ], { mutationMayHaveOccurred: true });
}

export function releaseTransactionLock(options = {}) {
  return moveTransactionLock('lock-release', options);
}

export function isolateStaleTransactionLock(options = {}) {
  return moveTransactionLock('lock-isolate-stale', options);
}

function advanceTransactionStateRecordInternal({
  home = process.env.HOME,
  transactionId,
  planHash,
  currentState,
  nextState,
  owner,
  executionIdentity,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const validatedOwner = validateLockOwner(owner, {
    transactionId,
    planHash,
    nonce: owner?.nonce,
    pid: process.pid,
  });
  const currentBytes = canonicalJson(currentState);
  const nextBytes = canonicalJson(nextState);
  const expectedStateHash = `sha256:${hashBytes(Buffer.from(currentBytes, 'utf8'))}`;
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const response = invokeHelper(helper, [
    'transaction-advance',
    verifiedHome,
    transactionId,
    planHash,
    expectedStateHash,
    validatedOwner.nonce,
    String(validatedOwner.pid),
    String(validatedOwner.process_start_sec),
    String(validatedOwner.process_start_usec),
    String(currentState.sequence),
    String(nextState.sequence),
  ], {
    input: nextBytes,
    mutationMayHaveOccurred: true,
    testEnvironment,
  });
  if (response.operation !== 'transaction-advance') {
    fail('recovery_required', 'transaction_state_invalid');
  }
  const observed = probeTransactionRecords({
    home: verifiedHome, transactionId, executionIdentity,
  });
  if (canonicalJson(observed.state) !== nextBytes) {
    fail('recovery_required', 'transaction_state_postcondition_failed');
  }
  return observed;
}

export function advanceTransactionStateRecord(options = {}) {
  return advanceTransactionStateRecordInternal(options);
}

function validateBatchLockOwner(owner, { batchId, planHash, nonce, pid = null }) {
  const keys = [
    'batch_id',
    'nonce',
    'pid',
    'plan_hash',
    'process_start_sec',
    'process_start_usec',
    'scope',
  ];
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)
      || Object.keys(owner).length !== keys.length
      || keys.some((key) => !Object.hasOwn(owner, key))
      || owner.scope !== 'batch' || owner.batch_id !== batchId
      || owner.plan_hash !== planHash || owner.nonce !== nonce
      || (pid !== null && owner.pid !== pid)
      || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || !Number.isSafeInteger(owner.process_start_sec) || owner.process_start_sec < 0
      || !Number.isSafeInteger(owner.process_start_usec) || owner.process_start_usec < 0) {
    fail('recovery_required', 'batch_lock_identity_invalid');
  }
  canonicalJson(owner);
  return owner;
}

function initializeBatchRecordsInternal({
  home = process.env.HOME,
  batchId,
  plan,
  state,
  executionIdentity,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const input = [plan, state].map((value) => canonicalJson(value)).join('\n').concat('\n');
  const response = invokeHelper(helper, ['batch-init-v1', verifiedHome, batchId], {
    input,
    mutationMayHaveOccurred: true,
    testEnvironment,
  });
  if (response.operation !== 'batch-init-v1'
      || !['created', 'existing'].includes(response.result)) {
    fail('recovery_required', 'batch_records_invalid');
  }
  return response;
}

export function initializeBatchRecords(options = {}) {
  return initializeBatchRecordsInternal(options);
}

export function probeBatchRecords({
  home = process.env.HOME,
  batchId,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const response = invokeHelper(helper, ['probe-batch-v1', verifiedHome, batchId]);
  if (response.operation !== 'probe-batch-v1') fail('recovery_required', 'batch_records_invalid');
  return {
    plan: decodeTransactionRecord(response, 'plan_base64'),
    state: decodeTransactionRecord(response, 'state_base64'),
    lock: decodeOptionalTransactionRecord(response, 'lock_base64'),
  };
}

function acquireBatchLockInternal({
  home = process.env.HOME,
  batchId,
  planHash,
  executionIdentity,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const nonce = randomBytes(32).toString('hex');
  const response = invokeHelper(helper, [
    'batch-lock-acquire-v1', verifiedHome, batchId, planHash, nonce, String(process.pid),
  ], { mutationMayHaveOccurred: true, testEnvironment });
  if (response.operation !== 'batch-lock-acquire-v1') {
    fail('recovery_required', 'batch_lock_identity_invalid');
  }
  return validateBatchLockOwner(response.owner, {
    batchId, planHash, nonce, pid: process.pid,
  });
}

export function acquireBatchLock(options = {}) {
  return acquireBatchLockInternal(options);
}

function moveBatchLock(command, {
  home = process.env.HOME,
  batchId,
  planHash,
  owner,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const validatedOwner = validateBatchLockOwner(owner, {
    batchId, planHash, nonce: owner?.nonce,
  });
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  return invokeHelper(helper, [
    command,
    verifiedHome,
    batchId,
    planHash,
    validatedOwner.nonce,
    String(validatedOwner.pid),
    String(validatedOwner.process_start_sec),
    String(validatedOwner.process_start_usec),
  ], { mutationMayHaveOccurred: true });
}

export function releaseBatchLock(options = {}) {
  return moveBatchLock('batch-lock-release-v1', options);
}

export function isolateStaleBatchLock(options = {}) {
  return moveBatchLock('batch-lock-isolate-stale-v1', options);
}

function advanceBatchStateRecordInternal({
  home = process.env.HOME,
  batchId,
  planHash,
  currentState,
  nextState,
  owner,
  executionIdentity,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const validatedOwner = validateBatchLockOwner(owner, {
    batchId, planHash, nonce: owner?.nonce, pid: process.pid,
  });
  const nextBytes = canonicalJson(nextState);
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const response = invokeHelper(helper, [
    'batch-state-cas-v1',
    verifiedHome,
    batchId,
    planHash,
    sha256Canonical(currentState),
    validatedOwner.nonce,
    String(validatedOwner.pid),
    String(validatedOwner.process_start_sec),
    String(validatedOwner.process_start_usec),
    String(currentState.sequence),
    String(nextState.sequence),
  ], { input: nextBytes, mutationMayHaveOccurred: true, testEnvironment });
  if (response.operation !== 'batch-state-cas-v1') {
    fail('recovery_required', 'batch_state_invalid');
  }
  const observed = probeBatchRecords({ home: verifiedHome, batchId, executionIdentity });
  if (canonicalJson(observed.state) !== nextBytes) {
    fail('recovery_required', 'batch_state_postcondition_failed');
  }
  return observed;
}

export function advanceBatchStateRecord(options = {}) {
  return advanceBatchStateRecordInternal(options);
}

function mappedTransaction(batchPlan, itemId, itemHash, executionIdentityHash, transactionId) {
  return SHA256_IDENTIFIER.test(itemId ?? '') && batchPlan?.transaction_map?.some((mapping) => mapping
    && typeof mapping === 'object' && !Array.isArray(mapping)
    && Object.keys(mapping).length === 4
    && mapping.item_id === itemId && mapping.item_hash === itemHash
    && mapping.execution_identity_hash === executionIdentityHash
    && mapping.transaction_id === transactionId) === true;
}

export function advanceTransactionStateUnderBatchLease({
  home = process.env.HOME,
  batchId,
  itemId,
  itemHash,
  executionIdentityHash,
  transactionId,
  planHash,
  batchPlan,
  currentState,
  nextState,
  owner,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  if (batchPlan?.batch_id !== batchId || batchPlan?.plan_hash !== planHash
      || !mappedTransaction(
        batchPlan, itemId, itemHash, executionIdentityHash, transactionId,
      )) {
    fail('recovery_required', 'batch_mapping_invalid');
  }
  const validatedOwner = validateBatchLockOwner(owner, {
    batchId, planHash, nonce: owner?.nonce, pid: process.pid,
  });
  const nextBytes = canonicalJson(nextState);
  const helper = helperForExecutionIdentity(verifiedHome, executionIdentity);
  const response = invokeHelper(helper, [
    'transaction-advance-batch-v2',
    verifiedHome,
    batchId,
    transactionId,
    planHash,
    sha256Canonical(batchPlan),
    itemId,
    itemHash,
    executionIdentityHash,
    sha256Canonical(currentState),
    validatedOwner.nonce,
    String(validatedOwner.pid),
    String(validatedOwner.process_start_sec),
    String(validatedOwner.process_start_usec),
    String(currentState.sequence),
    String(nextState.sequence),
  ], { input: nextBytes, mutationMayHaveOccurred: true });
  if (response.operation !== 'transaction-advance-batch-v2') {
    fail('recovery_required', 'transaction_state_invalid');
  }
  const observed = probeBatchTransactionRecords({
    home: verifiedHome, transactionId, executionIdentity,
  });
  if (canonicalJson(observed.state) !== nextBytes) {
    fail('recovery_required', 'transaction_state_postcondition_failed');
  }
  return observed;
}

export function probeDurableJson({
  home = process.env.HOME,
  role,
  relativeDirectory = '.',
  leaf,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  if (role !== 'cleanup' || relativeDirectory !== '.' || leaf !== 'keep-decisions.json') {
    fail('blocked', 'invalid_keep_surface');
  }
  const helper = executionIdentity == null
    ? ensureMacosHelper({ home: verifiedHome })
    : helperForKeepProbeAuthority(verifiedHome, executionIdentity);
  const response = invokeHelper(helper, [
    'probe-state-v1', verifiedHome, role, relativeDirectory, leaf,
  ]);
  if (response.operation !== 'probe-state-v1' || typeof response.exists !== 'boolean') {
    fail('recovery_required', 'state_probe_invalid');
  }
  if (!response.exists) return { exists: false, digest: null, value: null };
  let value;
  try {
    value = decodeTransactionRecord(response, 'state_base64');
  } catch (error) {
    if (error instanceof MacosAdapterError) fail('blocked', 'state_invalid');
    throw error;
  }
  const digest = sha256Canonical(value);
  if (response.digest !== digest) fail('recovery_required', 'state_digest_invalid');
  return { exists: true, digest, value };
}

export function compareAndSwapDurableJson({
  home = process.env.HOME,
  role,
  relativeDirectory = '.',
  leaf,
  expectedDigest,
  value,
  executionIdentity,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  if (role !== 'cleanup' || relativeDirectory !== '.' || leaf !== 'keep-decisions.json') {
    fail('blocked', 'invalid_keep_surface');
  }
  const current = probeDurableJson({
    home: verifiedHome, role, relativeDirectory, leaf, executionIdentity,
  });
  if (current.digest !== expectedDigest) fail('blocked', 'state_cas_mismatch');
  const helper = executionIdentity == null
    ? ensureMacosHelper({ home: verifiedHome })
    : helperForExecutionIdentity(verifiedHome, executionIdentity);
  const input = canonicalJson(value);
  const response = invokeHelper(helper, [
    'state-cas-v1',
    verifiedHome,
    role,
    relativeDirectory,
    leaf,
    expectedDigest ?? 'absent',
  ], { input, mutationMayHaveOccurred: true });
  const digest = sha256Canonical(value);
  if (response.operation !== 'state-cas-v1' || response.digest !== digest) {
    fail('recovery_required', 'state_cas_postcondition_failed');
  }
  const observed = probeDurableJson({
    home: verifiedHome, role, relativeDirectory, leaf, executionIdentity,
  });
  if (observed.digest !== digest) fail('recovery_required', 'state_cas_postcondition_failed');
  return observed;
}

export function reconcileTransactionLocation({
  home = process.env.HOME,
  manifest,
} = {}) {
  const verifiedHome = safePath(home, 'home');
  const identity = manifest?.execution_identity;
  const helper = helperForExecutionIdentity(verifiedHome, identity);
  const response = invokeHelper(helper, [
    'reconcile',
    verifiedHome,
    authorizedActiveRoot(verifiedHome, manifest.active_root),
    safePath(manifest.entry_path, 'entryPath'),
    manifest.transaction_id,
    manifest.payload_leaf,
    identity.device,
    identity.inode,
    identity.manifest_hash,
  ]);
  if (response.operation !== 'reconcile'
      || ![
        'original',
        'original_drift',
        'quarantine',
        'rehydrated',
        'both',
        'neither',
      ].includes(response.location)) {
    fail('recovery_required', 'reconcile_result_invalid');
  }
  return response;
}

function restoreExclusiveInternal({
  home = process.env.HOME,
  manifest,
} = {}, testEnvironment = {}) {
  const verifiedHome = safePath(home, 'home');
  const identity = manifest?.execution_identity;
  const helper = helperForExecutionIdentity(verifiedHome, identity);
  return invokeHelper(helper, [
    'restore-exclusive',
    verifiedHome,
    authorizedActiveRoot(verifiedHome, manifest.active_root),
    safePath(manifest.entry_path, 'entryPath'),
    manifest.transaction_id,
    manifest.payload_leaf,
    identity.device,
    identity.inode,
    identity.manifest_hash,
  ], { mutationMayHaveOccurred: true, testEnvironment });
}

export function restoreExclusive(options = {}) {
  return restoreExclusiveInternal(options);
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
  installLauncherWithCrash(options, point = 'after_launcher_rename') {
    return installVerifiedLauncherInternal(options, { SKILLS_REFINER_TEST_CRASH: point });
  },
  installLauncherWithVerificationFailure(options) {
    return installVerifiedLauncherInternal(
      options,
      { SKILLS_REFINER_TEST_FAIL: 'launcher_verify' },
    );
  },
  installLauncherWithCleanupFailure(options, point) {
    if (!['launcher_temp_unlink', 'launcher_temp_parent_fsync'].includes(point)) {
      fail('blocked', 'invalid_launcher_test_seam');
    }
    return installVerifiedLauncherInternal(options, { SKILLS_REFINER_TEST_FAIL: point });
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
  initializeTransactionWithCrash(options, point = 'after_transaction_publish') {
    return initializeTransactionRecordsInternal(
      options,
      { SKILLS_REFINER_TEST_CRASH: point },
    );
  },
  acquireTransactionLockWithCrash(options, point = 'after_lock_publish') {
    return acquireTransactionLockInternal(options, { SKILLS_REFINER_TEST_CRASH: point });
  },
  advanceTransactionStateWithCrash(options, point = 'after_transaction_state_rename') {
    return advanceTransactionStateRecordInternal(
      options,
      { SKILLS_REFINER_TEST_CRASH: point },
    );
  },
  restoreWithCrash(options, point = 'after_restore_rename') {
    return restoreExclusiveInternal(options, { SKILLS_REFINER_TEST_CRASH: point });
  },
});
