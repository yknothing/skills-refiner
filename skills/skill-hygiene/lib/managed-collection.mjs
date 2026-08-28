import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants, copyFileSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from './cleanup-contract.mjs';
import { computeTreeDigest, copyTreeWithStableModes } from './collection-tree.mjs';
import {
  createCollectionFileExclusive, createCollectionSymlinkExclusive, ensureMacosHelper, inspectCollectionEntry,
  MacosAdapterError, moveCollectionEntryExclusive, replaceCollectionFileCas, unlinkCollectionSymlinkExact,
} from './cleanup-macos.mjs';
import { collectionSpec, managedCollectionIds } from './collection-specs.mjs';
import {
  materializeGitRevision, originTrackingRefsContaining, sourceGitAccess,
} from './git-source-attestation.mjs';
import { observeUpstreamVersion, upstreamVersionEvidence } from './upstream-version.mjs';
import {
  buildManagedPlan, MANAGED_COLLECTION_SCHEMAS, validateManagedIndex,
  validateManagedOperation, validateManagedPlan,
} from './managed-collection-contract.mjs';

const OPERATION_STATES = Object.freeze({
  planned: 'PLANNED', prepared: 'PREPARED', applying: 'APPLYING', committed: 'COMMITTED',
  rollingBack: 'ROLLING_BACK', rolledBack: 'ROLLED_BACK', repairing: 'REPAIRING',
  restoring: 'RESTORING', restored: 'RESTORED', recoveryRequired: 'RECOVERY_REQUIRED',
});
const REPAIR_STATES = Object.freeze({
  prepared: 'PREPARED', quarantined: 'QUARANTINED', published: 'PUBLISHED',
  committed: 'COMMITTED', rolledBack: 'ROLLED_BACK', recoveryRequired: 'RECOVERY_REQUIRED',
});
const TERMINAL_REPAIR_STATES = new Set([REPAIR_STATES.committed, REPAIR_STATES.rolledBack]);
const REPAIR_SCHEMA = 'skills-refiner.collection.repair-attempt.v1';
export const MANAGED_APPLY_FAULT_PHASES = Object.freeze([
  'after_prepared', 'after_first_projection_quarantine', 'after_projection_quarantine',
  'after_first_legacy_quarantine', 'after_legacy_quarantine',
  'after_collection_publish', 'after_projection_publish', 'after_catalog_publish',
]);
export const MANAGED_REPAIR_FAULT_PHASES = Object.freeze([
  'after_repair_prepared', 'after_repair_quarantine', 'before_repair_publish',
  'after_repair_publish', 'before_repair_commit', 'after_repair_cleanup',
]);
const IGNORED_COLLECTION_METADATA = new Set(['.DS_Store']);
const CATALOG_SCHEMA = 'skills-refiner.collection-catalog.v1';

export class ManagedCollectionError extends Error {
  constructor(code, message, status = 'blocked') {
    super(message);
    this.name = 'ManagedCollectionError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 'blocked') { throw new ManagedCollectionError(code, message, status); }
function treeDigest(root) { return computeTreeDigest(root, fail); }
function deployedTreeDigest(root) { return computeTreeDigest(root, fail, { ignoredBasenames: ['.DS_Store'] }); }
function sha256(data) { return `sha256:${createHash('sha256').update(data).digest('hex')}`; }
function resourceDigest(path, { deployed = false } = {}) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) fail('unsafe_path', `resource must not be a symlink: ${path}`);
  if (stat.isDirectory()) return deployed ? deployedTreeDigest(path) : treeDigest(path);
  if (stat.isFile()) return sha256(Buffer.concat([
    Buffer.from(`f\0${stat.mode & 0o777}\0${stat.size}\0`), readFileSync(path), Buffer.from('\0'),
  ]));
  fail('unsafe_path', `unsupported resource type: ${path}`);
}
function lstatExists(path) { try { lstatSync(path); return true; } catch { return false; } }
function readJson(path, code) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { fail(code, `cannot read JSON ${path}: ${error.message}`); } }
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }

function readPrivateSnapshot(home, path, code) {
  assertSafeManagedPath(home, path);
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
    fail(code, `cannot open private control file ${path}: ${error.message}`, 'recovery_required');
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n
        || before.nlink !== 1n || before.size < 0n || before.size > 64n * 1024n * 1024n) {
      fail(code, `control file must be an owner-private singly-linked real file: ${path}`, 'recovery_required');
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || BigInt(bytes.length) !== before.size) {
      fail(code, `control file changed while being read: ${path}`, 'recovery_required');
    }
    assertSafeManagedPath(home, path);
    let linked;
    try { linked = lstatSync(path, { bigint: true }); } catch (error) {
      fail(code, `control file disappeared while being read: ${path}: ${error.message}`, 'recovery_required');
    }
    if (linked.isSymbolicLink() || linked.dev !== before.dev || linked.ino !== before.ino
        || linked.size !== before.size || linked.mtimeNs !== before.mtimeNs || linked.ctimeNs !== before.ctimeNs) {
      fail(code, `control file path changed while being read: ${path}`, 'recovery_required');
    }
    return { bytes, device: String(before.dev), inode: String(before.ino), digest: sha256(bytes) };
  } finally { try { closeSync(descriptor); } catch {} }
}

function readPrivateJson(home, path, code) {
  const snapshot = readPrivateSnapshot(home, path, code);
  try { return { ...snapshot, value: JSON.parse(snapshot.bytes.toString('utf8')) }; } catch (error) {
    fail(code, `cannot parse JSON ${path}: ${error.message}`, 'recovery_required');
  }
}

function contained(home, path) {
  const rel = relative(home, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function assertRealDirectory(path, label) {
  if (!isAbsolute(path)) fail('unsafe_path', `${label} must be absolute`);
  let stat;
  try { stat = lstatSync(path); } catch { fail('missing_path', `${label} is missing: ${path}`); }
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(path) !== path) fail('unsafe_path', `${label} must be a canonical real directory: ${path}`);
}

function assertRealResource(path, label) {
  if (!isAbsolute(path)) fail('unsafe_path', `${label} must be absolute`);
  let stat;
  try { stat = lstatSync(path); } catch { fail('missing_path', `${label} is missing: ${path}`); }
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || realpathSync(path) !== path) fail('unsafe_path', `${label} must be a canonical real file or directory: ${path}`);
}

function assertSafeManagedPath(home, path) {
  if (!contained(home, path)) fail('unsafe_path', `managed path escaped HOME: ${path}`);
  let current = home;
  for (const part of relative(home, path).split(sep).slice(0, -1)) {
    current = join(current, part);
    if (!lstatExists(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('unsafe_path', `managed path has unsafe parent: ${current}`);
  }
}

function approvedGithubOrigin(value, spec) {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\/$/u, '').toLowerCase();
  return normalized === spec.sourceUrl.toLowerCase()
    || normalized === `git@github.com:${spec.repositoryId}.git`.toLowerCase();
}

function durableWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${path.split('/').at(-1)}.${process.pid}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const parent = openSync(dirname(path), 'r');
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (lstatExists(temporary)) rmSync(temporary, { force: true });
  }
}
function durableJson(path, value) { durableWrite(path, `${JSON.stringify(value, null, 2)}\n`); }

function controllerIdentity(home) {
  const files = [
    import.meta.url,
    new URL('./collection-specs.mjs', import.meta.url),
    new URL('./collection-tree.mjs', import.meta.url),
    new URL('./managed-collection-contract.mjs', import.meta.url),
    new URL('./git-source-attestation.mjs', import.meta.url),
    new URL('./upstream-version.mjs', import.meta.url),
    new URL('./collection-cli.mjs', import.meta.url),
    new URL('./cleanup-macos.mjs', import.meta.url),
    new URL('../native/cleanup-macos-helper.c', import.meta.url),
    new URL('../bin/skills-refiner', import.meta.url),
  ].map((url) => fileURLToPath(url));
  const helper = ensureMacosHelper({ home });
  return {
    adapter: 'macos-native.v1', node_major: 24,
    bundle_digest: sha256(Buffer.from(canonicalJson(files.map((path) => ({ path: relative(dirname(fileURLToPath(import.meta.url)), path), digest: sha256(readFileSync(path)) }))))),
    helper_binary_digest: `sha256:${helper.binaryHash}`,
    helper_source_digest: `sha256:${helper.sourceHash}`,
    architecture: helper.architecture, compiler_path: helper.compilerPath,
    compiler_version: helper.compilerVersion,
  };
}

function parseFrontmatter(path) {
  const source = readFileSync(path, 'utf8').replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n');
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(source)?.[1];
  if (block === undefined) fail('invalid_skill', `missing frontmatter: ${path}`);
  const lines = block.split('\n');
  const scalar = (key) => {
    const lineIndex = lines.findIndex((line) => new RegExp(`^${key}:`, 'u').test(line));
    if (lineIndex < 0) return null;
    const raw = lines[lineIndex].slice(lines[lineIndex].indexOf(':') + 1).trim();
    if (raw === '>' || raw === '|') {
      const values = [];
      for (let index = lineIndex + 1; index < lines.length; index += 1) {
        if (!/^\s+/u.test(lines[index]) && lines[index].trim() !== '') break;
        values.push(lines[index].trim());
      }
      return raw === '>' ? values.filter(Boolean).join(' ') : values.join('\n').trim();
    }
    const quoted = /^(?:"([\s\S]*)"|'([\s\S]*)')$/u.exec(raw);
    if (quoted) return quoted[1] ?? quoted[2];
    if (/:(?:\s|$)/u.test(raw)) fail('invalid_skill', `plain frontmatter scalar is not portable YAML: ${path} (${key})`);
    return raw;
  };
  const name = scalar('name');
  const description = scalar('description');
  if (!name || !description) fail('invalid_skill', `name and description are required: ${path}`);
  return { name, description };
}

function referenceGraph(root, scanRoots, { allowMissing = false, excludedPaths = new Set() } = {}) {
  const files = [];
  const visit = (path) => {
    const relativePath = relative(root, path);
    if (excludedPaths.has(relativePath)) return;
    if (!lstatExists(path)) fail('broken_reference', `declared reference input is missing: ${path}`);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail('source_symlink', `source contains symlink: ${path}`);
    if (stat.isFile()) {
      if (path.endsWith('.md')) files.push(path);
      return;
    }
    if (!stat.isDirectory()) fail('unsafe_tree_entry', `source contains unsupported entry: ${path}`);
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const child = join(path, entry.name);
      visit(child);
    }
  };
  for (const scanRoot of scanRoots) visit(scanRoot);
  const edges = [];
  const markdownTarget = /!?(?:\[[^\]]*\])\(([^)]+)\)/gu;
  for (const path of files) {
    const body = readFileSync(path, 'utf8');
    for (const match of body.matchAll(markdownTarget)) {
      let target = match[1].trim().replace(/^<|>$/gu, '').split(/\s+["']/u, 1)[0];
      if (target.length === 0 || /^(?:[a-z]+:|#)/iu.test(target)) continue;
      target = decodeURIComponent(target.split('#', 1)[0]);
      const destination = resolve(dirname(path), target);
      const missing = !contained(root, destination) || !lstatExists(destination);
      if (missing && !allowMissing) fail('broken_reference', `unresolved local Markdown reference: ${path} -> ${target}`);
      if (!missing && lstatSync(destination).isSymbolicLink()) fail('source_symlink', `reference target is a symlink: ${destination}`);
      edges.push({ from: relative(root, path), to: relative(root, destination), target, missing });
    }
  }
  return { edge_count: edges.length, digest: sha256(Buffer.from(canonicalJson(edges))), edges };
}

function packagingMappings(spec) {
  return [
    ...spec.members.map(({ name, sourcePath }) => ({ virtualPath: name, sourcePath })),
    ...spec.sharedPaths.map((sourcePath) => ({ virtualPath: sourcePath, sourcePath })),
  ].sort((a, b) => b.virtualPath.length - a.virtualPath.length);
}

function mappingForSourcePath(mappings, sourcePath) {
  return mappings.find((mapping) => sourcePath === mapping.sourcePath
    || sourcePath.startsWith(`${mapping.sourcePath}/`));
}

function mappingForVirtualPath(mappings, virtualPath) {
  return mappings.find((mapping) => virtualPath === mapping.virtualPath
    || virtualPath.startsWith(`${mapping.virtualPath}/`));
}

/**
 * Validate every local Markdown edge against both layouts and return the exact
 * deterministic target rewrite needed by the flattened collection layout.
 * A source may already use collection-relative targets (legacy profile), in
 * which case replacement === target and no bytes change.
 */
function packagingReferenceActions(root, spec, graph) {
  const virtualRoot = '/skills-refiner-collection';
  const mappings = packagingMappings(spec);
  const actions = [];
  for (const edge of graph.edges) {
    const owner = mappings.find(({ sourcePath }) => edge.from === sourcePath || edge.from.startsWith(`${sourcePath}/`));
    if (!owner) fail('broken_reference', `reference owner is outside declared packaging inputs: ${edge.from}`);
    const ownerRelative = relative(owner.sourcePath, edge.from);
    const virtualFrom = join(virtualRoot, owner.virtualPath, ownerRelative);
    const sourceDestination = resolve(root, dirname(edge.from), edge.target);
    const sourceRelative = relative(root, sourceDestination);
    const sourceMapping = contained(root, sourceDestination)
      ? mappingForSourcePath(mappings, sourceRelative)
      : null;
    if (sourceMapping && lstatExists(sourceDestination)) {
      if (sourceMapping.sourcePath === owner.sourcePath
          && sourceMapping.virtualPath === owner.virtualPath) {
        actions.push({ from: edge.from, target: edge.target, replacement: edge.target });
        continue;
      }
      const virtualDestination = join(
        virtualRoot,
        sourceMapping.virtualPath,
        relative(sourceMapping.sourcePath, sourceRelative),
      );
      const replacement = relative(dirname(virtualFrom), virtualDestination) || '.';
      actions.push({ from: edge.from, target: edge.target, replacement });
      continue;
    }

    // Compatibility path: older upstreams sometimes authored the target for
    // the already-flattened deployment layout, so it is missing in source but
    // resolves after packaging. Preserve those bytes when the mapped target is
    // declared and exists in the source authority.
    const virtualDestination = resolve(dirname(virtualFrom), edge.target);
    if (!contained(virtualRoot, virtualDestination)) {
      fail('broken_reference', `packaged reference escapes collection: ${edge.from} -> ${edge.target}`);
    }
    const virtualRelative = relative(virtualRoot, virtualDestination);
    const virtualMapping = mappingForVirtualPath(mappings, virtualRelative);
    if (!virtualMapping) {
      fail('broken_reference', `packaged reference has no declared member or resource: ${edge.from} -> ${edge.target}`);
    }
    const mappedSource = join(root, virtualMapping.sourcePath, relative(virtualMapping.virtualPath, virtualRelative));
    if (!lstatExists(mappedSource)) {
      fail('broken_reference', `packaged reference is unresolved: ${edge.from} -> ${edge.target}`);
    }
    actions.push({ from: edge.from, target: edge.target, replacement: edge.target });
  }
  return actions;
}

function copyPackagingInputs(sourceRoot, target, spec) {
  mkdirSync(target, { recursive: true, mode: 0o755 });
  chmodSync(target, 0o755);
  for (const member of spec.members) {
    copyTreeWithStableModes(join(sourceRoot, member.sourcePath), join(target, member.name), {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
    }, fail);
  }
  for (const sourcePath of spec.sharedPaths) {
    const destination = join(target, sourcePath);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
    chmodSync(dirname(destination), 0o755);
    copyTreeWithStableModes(join(sourceRoot, sourcePath), destination, {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
    }, fail);
  }
}

function applyPackagingReferenceActions(sourceRoot, target, spec, actions) {
  const mappings = packagingMappings(spec);
  const byFile = new Map();
  for (const action of actions) {
    if (action.replacement === action.target) continue;
    if (!byFile.has(action.from)) byFile.set(action.from, []);
    byFile.get(action.from).push(action);
  }
  for (const [sourceRelative, fileActions] of byFile) {
    const owner = mappingForSourcePath(mappings, sourceRelative);
    if (!owner) fail('broken_reference', `cannot relocate undeclared reference owner: ${sourceRelative}`);
    const deployedPath = join(target, owner.virtualPath, relative(owner.sourcePath, sourceRelative));
    let body = readFileSync(deployedPath, 'utf8');
    for (const action of fileActions) {
      const marker = `](${action.target})`;
      const replacement = `](${action.replacement})`;
      if (!body.includes(marker)) {
        fail('broken_reference', `cannot apply deterministic reference relocation: ${sourceRelative} -> ${action.target}`);
      }
      body = body.split(marker).join(replacement);
    }
    writeFileSync(deployedPath, body, 'utf8');
  }
}

export function inspectManagedSource({ collectionId, sourceRoot, revision }) {
  const spec = collectionSpec(collectionId);
  const root = resolve(sourceRoot);
  if (root !== sourceRoot) fail('unsafe_source_root', 'source root must be normalized and absolute');
  assertRealDirectory(root, 'source root');
  if (!/^[0-9a-f]{40}$/u.test(revision)) fail('invalid_revision', 'revision must be a full commit SHA');
  const { git, readObjects } = sourceGitAccess(root);
  const top = git('rev-parse', '--show-toplevel');
  const head = git('rev-parse', 'HEAD');
  const remote = git('remote', 'get-url', 'origin');
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== root) fail('unverified_source', 'source root must be a Git worktree root');
  if (head.status !== 0 || head.stdout.trim() !== revision) fail('source_revision_mismatch', 'source HEAD does not match revision');
  if (remote.status !== 0 || !approvedGithubOrigin(remote.stdout.trim(), spec)) fail('source_origin_mismatch', `source origin must be ${spec.repositoryId}`);
  const remoteAttestation = originTrackingRefsContaining(git, revision);
  if (!remoteAttestation.ok || remoteAttestation.refs.length === 0) {
    fail('source_revision_not_remote_tracked', 'source revision must be contained by an origin remote-tracking ref');
  }
  const authorityParent = realpathSync(mkdtempSync(join(tmpdir(), `skills-refiner-${collectionId}-authority-`)));
  try {
    const authorityRoot = join(authorityParent, 'repository');
    materializeGitRevision({ readObjects, revision, destination: authorityRoot, fail });
    const manifestPath = join(authorityRoot, spec.manifestPath);
    if (!lstatExists(manifestPath) || !lstatSync(manifestPath).isFile()) fail('invalid_manifest', `manifest is missing: ${manifestPath}`);
    upstreamVersionEvidence(authorityRoot, spec.upstreamVersion);
    for (const rejected of spec.rejectedMembers) {
      const rejectedRoot = join(authorityRoot, rejected.sourcePath);
      assertRealDirectory(rejectedRoot, `rejected source member ${rejected.name}`);
      let rejectionProven = false;
      try { parseFrontmatter(join(rejectedRoot, 'SKILL.md')); }
      catch (error) {
        rejectionProven = error instanceof ManagedCollectionError
          && error.code === 'invalid_skill'
          && rejected.reason === 'invalid_portable_yaml'
          && /not portable YAML/u.test(error.message);
        if (!rejectionProven) throw error;
      }
      if (!rejectionProven) fail('stale_rejection_profile', `rejected member now passes its recorded gate: ${rejected.name}`);
    }
    const memberMetadata = spec.members.map(({ name, sourcePath }) => {
      const memberRoot = join(authorityRoot, sourcePath);
      assertRealDirectory(memberRoot, `source member ${name}`);
      const metadata = parseFrontmatter(join(memberRoot, 'SKILL.md'));
      if (metadata.name !== name) fail('invalid_skill', `frontmatter name mismatch for ${name}`);
      if ([...metadata.description].length > 1024) fail('invalid_skill', `frontmatter description too long for ${name}`);
      return { name, source_path: sourcePath };
    });
    const references = referenceGraph(authorityRoot, [
      ...spec.members.map(({ sourcePath }) => join(authorityRoot, sourcePath)),
      ...spec.sharedPaths.map((sourcePath) => join(authorityRoot, sourcePath)),
    ], { allowMissing: true, excludedPaths: new Set(spec.referenceExclusions) });
    const actions = packagingReferenceActions(authorityRoot, spec, references);
    for (const sourcePath of spec.sharedPaths) {
      const resourceRoot = join(authorityRoot, sourcePath);
      assertRealResource(resourceRoot, `shared resource ${sourcePath}`);
    }
    const preview = join(authorityParent, 'preview');
    copyPackagingInputs(authorityRoot, preview, spec);
    applyPackagingReferenceActions(authorityRoot, preview, spec, actions);
    referenceGraph(preview, [
      ...spec.members.map(({ name }) => join(preview, name)),
      ...spec.sharedPaths.map((sourcePath) => join(preview, sourcePath)),
    ], { excludedPaths: new Set(spec.referenceExclusions) });
    const members = memberMetadata.map(({ name, source_path }) => ({
      name, source_path, tree_digest: deployedTreeDigest(join(preview, name)),
    }));
    const resources = spec.sharedPaths.map((sourcePath) => ({
      source_path: sourcePath,
      relative_path: sourcePath,
      tree_digest: resourceDigest(join(preview, sourcePath), { deployed: true }),
    }));
    return {
      provider: 'github', repository_id: spec.repositoryId, revision, root,
      remote_attestation: {
        scheme: 'origin-tracking-containment.v1', refs: remoteAttestation.refs,
      },
      tree_digest: treeDigest(authorityRoot), manifest_digest: sha256(readFileSync(manifestPath)),
      reference_graph_digest: references.digest, members, resources,
    };
  } finally {
    rmSync(authorityParent, { recursive: true, force: true });
  }
}

function nativeIdentity(home, path) { return inspectCollectionEntry({ home, path }); }
function sameFilesystemObject(left, right) {
  try {
    const a = statSync(left);
    const b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch { return false; }
}
function qualifiedProjectionTarget({ path, name, legacyPath, candidate, spec }) {
  let destination;
  try { destination = realpathSync(path); } catch { return false; }
  if (sameFilesystemObject(destination, legacyPath)) return true;
  const member = spec.members.find((entry) => entry.name === name);
  const candidateMember = candidate?.members.find((entry) => entry.name === name);
  if (!member || !candidateMember) return false;
  try {
    if (treeDigest(destination) !== candidateMember.tree_digest) return false;
    if (sameFilesystemObject(destination, join(candidate.root, member.sourcePath))) return true;
    const { git } = sourceGitAccess(destination);
    const top = git('rev-parse', '--show-toplevel');
    const head = git('rev-parse', 'HEAD');
    const remote = git('remote', 'get-url', 'origin');
    if (top.status !== 0 || head.status !== 0 || remote.status !== 0) return false;
    const topRoot = realpathSync(top.stdout.trim());
    return head.stdout.trim() === candidate.revision
      && approvedGithubOrigin(remote.stdout.trim(), spec)
      && sameFilesystemObject(destination, join(topRoot, member.sourcePath));
  } catch { return false; }
}
function projectionRoots(home, skillsRoot) {
  return readdirSync(home, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.'))
    .map((entry) => ({ agent: entry.name.slice(1), root: join(home, entry.name, 'skills') }))
    .filter(({ root }) => root !== skillsRoot)
    .filter(({ root }) => { try { const stat = lstatSync(root); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } });
}

export function inspectManagedNameCollisions({ collectionId, home, excludePaths = new Set() }) {
  const spec = collectionSpec(collectionId);
  const skillsRoot = join(home, '.agents/skills');
  const receipt = readJson(join(home, '.agents/.skill-lock.json'), 'invalid_receipt');
  const receiptClaims = new Map(Object.entries(receipt.skills ?? {}));
  const names = new Set([...spec.members.map(({ name }) => name), ...spec.preservedNames]);
  const candidates = [
    ...[...names].map((name) => ({ scope: 'global', agent: null, name, path: join(skillsRoot, name) })),
    ...projectionRoots(home, skillsRoot).flatMap(({ agent, root }) => [...names].map((name) => ({ scope: 'agent', agent, name, path: join(root, name) }))),
  ];
  return candidates.filter(({ path }) => lstatExists(path) && !excludePaths.has(path)).map((entry) => {
    const stat = lstatSync(entry.path);
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    const claim = receiptClaims.get(entry.name) ?? null;
    const receiptClaim = claim === null ? null : {
      source: claim.source ?? null, source_type: claim.sourceType ?? null,
      source_url: claim.sourceUrl ?? null, skill_path: claim.skillPath ?? null,
      skill_folder_hash: claim.skillFolderHash ?? null,
    };
    let rawTarget = null;
    let resolvedTarget = null;
    let targetStatus = 'unsupported';
    let targetTreeDigest = null;
    if (kind === 'symlink') {
      rawTarget = readlinkSync(entry.path);
      try {
        resolvedTarget = realpathSync(entry.path);
        targetTreeDigest = resourceDigest(resolvedTarget);
        targetStatus = 'resolved';
      } catch { targetStatus = 'missing'; }
    } else if (kind === 'directory' || kind === 'file') {
      resolvedTarget = realpathSync(entry.path);
      targetTreeDigest = resourceDigest(entry.path);
      targetStatus = 'resolved';
    }
    return {
      ...entry, kind, raw_target: rawTarget, resolved_target: resolvedTarget,
      target_status: targetStatus, target_tree_digest: targetTreeDigest,
      receipt_claim: receiptClaim,
      relation: claim?.source === spec.repositoryId ? 'same_repository_name'
        : claim !== null ? 'other_repository_name' : 'unqualified_name',
      disposition: 'preserve',
    };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function observeManagedInstall({
  collectionId, home, candidate = null, activeCollectionRoot = null,
  activeExposurePaths = new Set(),
}) {
  const spec = collectionSpec(collectionId);
  const normalizedHome = resolve(home);
  if (normalizedHome !== home) fail('unsafe_home', 'HOME must be normalized and absolute');
  assertRealDirectory(home, 'HOME');
  const receiptPath = join(home, '.agents/.skill-lock.json');
  const receiptBytes = readFileSync(receiptPath);
  const receipt = readJson(receiptPath, 'invalid_receipt');
  if (receipt.version !== 3) fail('unsupported_receipt', 'expected skill-lock version 3');
  const sourceEntries = Object.entries(receipt.skills ?? {})
    .filter(([, value]) => value?.source === spec.repositoryId)
    .map(([name, value]) => ({ name, receipt: value }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const byName = new Map(sourceEntries.map((entry) => [entry.name, entry.receipt]));
  const expectedNames = new Set(spec.members.map(({ name }) => name));
  const memberByName = new Map(spec.members.map((member) => [member.name, member]));
  const skillsRoot = join(home, '.agents/skills');
  const conflicts = [];
  const legacy = [];
  for (const name of expectedNames) {
    const path = join(skillsRoot, name);
    if (!lstatExists(path)) continue;
    if (path === activeCollectionRoot) continue;
    const evidence = byName.get(name);
    const member = memberByName.get(name);
    const trustedEvidence = evidence?.sourceType === 'github' && evidence.sourceUrl === spec.sourceUrl
      && evidence.skillPath === `${member.sourcePath}/SKILL.md`
      && /^[0-9a-f]{40,64}$/u.test(evidence.skillFolderHash ?? '')
      && !Number.isNaN(Date.parse(evidence.installedAt)) && !Number.isNaN(Date.parse(evidence.updatedAt));
    if (!trustedEvidence) {
      if (name === collectionId) conflicts.push({ path, reason: 'unowned path occupies the required collection root' });
      continue;
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) { conflicts.push({ path, reason: 'receipt-owned active managed name is not a real directory' }); continue; }
    if (!evidence || evidence.sourceType !== 'github' || evidence.sourceUrl !== spec.sourceUrl
        || typeof evidence.skillPath !== 'string' || evidence.skillPath.includes('..')
        || !/^[0-9a-f]{40,64}$/u.test(evidence.skillFolderHash ?? '')
        || Number.isNaN(Date.parse(evidence.installedAt)) || Number.isNaN(Date.parse(evidence.updatedAt))) {
      conflicts.push({ path, reason: 'active directory lacks trusted source receipt' });
      continue;
    }
    const native = nativeIdentity(home, path);
    legacy.push({
      name, path, kind: 'directory', tree_digest: treeDigest(path),
      native_manifest: native.manifest_hash, security_metadata_hash: native.security_metadata_hash,
      receipt_evidence_digest: sha256(Buffer.from(canonicalJson({ name, receipt: evidence }))),
      receipt: {
        source: evidence.source, source_type: evidence.sourceType, source_url: evidence.sourceUrl,
        skill_path: evidence.skillPath, skill_folder_hash: evidence.skillFolderHash,
        installed_at: evidence.installedAt, updated_at: evidence.updatedAt, resolved_revision: null,
      },
    });
  }
  const requiredCollectionRoot = join(skillsRoot, collectionId);
  if (activeCollectionRoot === null && lstatExists(requiredCollectionRoot)
      && !legacy.some(({ path }) => path === requiredCollectionRoot)) {
    conflicts.push({ path: requiredCollectionRoot, reason: 'unowned path occupies the required collection root' });
  }
  for (const { name } of sourceEntries) {
    const path = join(skillsRoot, name);
    if (lstatExists(path) && !expectedNames.has(name) && !spec.preservedNames.includes(name)) conflicts.push({ path, reason: 'source-owned active name has no collection disposition' });
  }
  if (legacy.length === 0 && activeCollectionRoot === null) conflicts.push({ path: skillsRoot, reason: 'no active receipt-owned members were observed' });
  const managedProjectionNames = new Set(legacy.map(({ name }) => name));
  const projections = [];
  for (const { agent, root } of projectionRoots(home, skillsRoot)) {
    for (const name of managedProjectionNames) {
      const path = join(root, name);
      if (!lstatExists(path)) continue;
      const stat = lstatSync(path);
      if (!stat.isSymbolicLink()) { conflicts.push({ path, reason: 'managed projection name is not a symlink' }); continue; }
      const rawTarget = readlinkSync(path);
      const native = nativeIdentity(home, path);
      let targetDigest = null;
      try { targetDigest = treeDigest(realpathSync(path)); } catch {}
      const legacyEntry = legacy.find((entry) => entry.name === name);
      if (targetDigest === null || !legacyEntry || !qualifiedProjectionTarget({ path, name, legacyPath: legacyEntry.path, candidate, spec })) {
        conflicts.push({ path, reason: 'projection target is not the active member or a qualified exact upstream member' });
      }
      projections.push({
        agent, root, name, path, kind: 'symlink', raw_target: rawTarget,
        target_digest: targetDigest, native_manifest: native.manifest_hash,
        security_metadata_hash: native.security_metadata_hash,
      });
    }
  }
  const ownedPaths = new Set([...legacy.map(({ path }) => path), ...projections.map(({ path }) => path)]);
  if (activeCollectionRoot !== null) ownedPaths.add(activeCollectionRoot);
  for (const path of activeExposurePaths) ownedPaths.add(path);
  const nameCollisions = inspectManagedNameCollisions({ collectionId, home, excludePaths: ownedPaths });
  const projectedRoots = new Set([
    ...projections.map(({ root }) => root),
    ...nameCollisions.filter(({ scope, relation }) => scope === 'agent' && relation === 'same_repository_name')
      .map(({ path }) => dirname(path)),
  ]);
  const agentRoots = projectionRoots(home, skillsRoot)
    .filter(({ root }) => projectedRoots.has(root))
    .map(({ agent, root }) => ({ agent, root, profile: `${spec.exposure.type}_projection`, qualification: 'filesystem_only' }))
    .sort((a, b) => a.root.localeCompare(b.root, 'en'));
  const installedTimes = sourceEntries.map(({ receipt: value }) => value.installedAt).filter((value) => !Number.isNaN(Date.parse(value))).sort();
  const updatedTimes = sourceEntries.map(({ receipt: value }) => value.updatedAt).filter((value) => !Number.isNaN(Date.parse(value))).sort();
  if (installedTimes.length !== sourceEntries.length || updatedTimes.length !== sourceEntries.length) conflicts.push({ path: receiptPath, reason: 'source receipt history contains invalid lifecycle timestamps' });
  return {
    receipt: {
      path: receiptPath, digest: sha256(receiptBytes), entries_digest: sha256(Buffer.from(canonicalJson(sourceEntries))),
      history: {
        entry_count: sourceEntries.length,
        first_installed_at: installedTimes[0] ?? new Date(0).toISOString(),
        last_updated_at: updatedTimes.at(-1) ?? new Date(0).toISOString(),
      },
    },
    source_entries: sourceEntries, legacy: legacy.sort((a, b) => a.name.localeCompare(b.name, 'en')),
    projections: projections.sort((a, b) => a.path.localeCompare(b.path, 'en')), conflicts, agent_roots: agentRoots,
    name_collisions: nameCollisions,
  };
}

function observeManagedPredecessor({ plan, home, duringUpgrade = false, candidate = null }) {
  const paths = operationPaths(plan);
  const catalog = catalogEntry(home, plan.collection_id);
  const status = duringUpgrade
    ? statusAgainstPlan(plan, paths)
    : statusManagedCollection({ collectionId: plan.collection_id, home });
  if (duringUpgrade && catalog.value !== null) {
    status.issues.push(...catalogIdentityIssues(home, plan, paths, catalog.catalog));
    if (status.issues.length > 0) status.status = 'DRIFTED';
  }
  const spec = collectionSpec(plan.collection_id);
  const candidateMemberNames = new Set(candidate?.members?.map(({ name }) => name) ?? []);
  const acceptedDrift = [...new Set(status.issues ?? [])].sort();
  const safelyAdoptable = status.status === 'DRIFTED'
    && candidate !== null
    && acceptedDrift.length > 0
    && acceptedDrift.every((issue) => {
      if (!issue.startsWith('UNEXPECTED_COLLECTION_ENTRY:')) return false;
      const name = issue.slice('UNEXPECTED_COLLECTION_ENTRY:'.length);
      return candidateMemberNames.has(name) || spec.adoptableCollectionEntries.includes(name);
    });
  if (status.status !== 'FILESYSTEM_READY' && !safelyAdoptable) {
    fail('predecessor_drift', `active generation is not upgradeable: ${status.issues.join(', ')}`);
  }
  const activeRecord = readPrivateJson(home, paths.activePath, 'invalid_active_generation').value;
  if (catalog.value === null) fail('predecessor_drift', 'active generation has no catalog entry');
  const native = nativeIdentity(home, plan.target.collection_root);
  const exposures = [];
  for (const root of plan.agent_roots) {
    if (!lstatExists(root.root)) continue;
    const path = exposurePath(plan, root);
    if (!exactSymlink(path, plan.target.exposure.agent_raw_target)) fail('predecessor_drift', `active exposure changed: ${path}`);
    const identity = nativeIdentity(home, path);
    exposures.push({
      scope: 'agent', agent: root.agent, root: root.root, path,
      raw_target: plan.target.exposure.agent_raw_target,
      native_manifest: identity.manifest_hash, security_metadata_hash: identity.security_metadata_hash,
    });
  }
  if (plan.target.exposure.global_projection !== null) {
    const path = plan.target.exposure.global_projection;
    if (!exactSymlink(path, plan.target.exposure.global_raw_target)) fail('predecessor_drift', 'active global exposure changed');
    const identity = nativeIdentity(home, path);
    exposures.push({
      scope: 'global', agent: null, root: dirname(path), path,
      raw_target: plan.target.exposure.global_raw_target,
      native_manifest: identity.manifest_hash, security_metadata_hash: identity.security_metadata_hash,
    });
  }
  return {
    operation_id: paths.id, plan_hash: plan.plan_hash,
    accepted_drift: safelyAdoptable ? acceptedDrift : [],
    active_record: activeRecord, catalog_entry: structuredClone(catalog.value),
    collection: {
      path: plan.target.collection_root, tree_digest: treeDigest(plan.target.collection_root),
      native_manifest: native.manifest_hash, security_metadata_hash: native.security_metadata_hash,
    },
    exposures: exposures.sort((a, b) => a.path.localeCompare(b.path, 'en')),
  };
}

export function compileManagedPlan({ collectionId, home, sourceRoot, revision, now = new Date().toISOString() }) {
  const spec = collectionSpec(collectionId);
  const source = inspectManagedSource({ collectionId, sourceRoot, revision });
  const activePlan = loadPlanFromControl(home, collectionId);
  const predecessor = activePlan === null
    ? null
    : observeManagedPredecessor({ plan: activePlan, home, candidate: source });
  const installed = observeManagedInstall({
    collectionId, home, candidate: source,
    activeCollectionRoot: activePlan?.target.collection_root ?? null,
    activeExposurePaths: new Set(predecessor?.exposures.map(({ path }) => path) ?? []),
  });
  if (installed.conflicts.length > 0) fail('installed_conflict', installed.conflicts.map(({ path, reason }) => `${path}: ${reason}`).join('; '));
  const globalProjection = spec.exposure.type === 'gateway' && spec.exposure.name !== collectionId
    ? join(home, '.agents/skills', spec.exposure.name) : null;
  return buildManagedPlan({
    collection_id: collectionId, home, source, receipt: installed.receipt,
    legacy: installed.legacy.map((entry) => ({ ...entry, disposition: 'replaced', successor: entry.name })),
    projections: installed.projections, preserved_collisions: installed.name_collisions, predecessor,
    target: {
      collection_root: join(home, '.agents/skills', collectionId),
      exposure: {
        type: spec.exposure.type, name: spec.exposure.name, global_projection: globalProjection,
        global_raw_target: globalProjection === null ? null : `${collectionId}/${spec.exposure.name}`,
        agent_raw_target: spec.exposure.type === 'gateway'
          ? `../../.agents/skills/${collectionId}/${spec.exposure.name}`
          : `../../.agents/skills/${collectionId}`,
      },
    },
    control: {
      root: join(home, '.agents/skill-control/collections', collectionId),
      quarantine_root: join(home, '.agents/skills-quarantine/collections'),
      recovery_root: join(home, 'Library/Application Support/skills-refiner/recovery'),
    },
    controller: controllerIdentity(home),
    agent_roots: predecessor === null
      ? installed.agent_roots
      : activePlan.agent_roots.filter((root) => predecessor.exposures.some((exposure) => exposure.scope === 'agent' && exposure.root === root.root)),
    created_at: now,
  });
}

function operationId(plan) { return `${plan.collection_id}-${plan.plan_hash.slice(7, 19)}`; }
function operationPaths(plan, id = operationId(plan)) {
  const operationRoot = join(plan.control.root, 'operations', id);
  const recoveryOperationRoot = join(plan.control.recovery_root, 'operations', id);
  const quarantineOperationRoot = join(plan.control.quarantine_root, id);
  return {
    id, operationRoot, operationPath: join(operationRoot, 'operation.json'), planPath: join(operationRoot, 'plan.json'),
    activePath: join(plan.control.root, 'active.json'), artifactRepo: join(plan.control.root, 'artifacts', plan.source.tree_digest.slice(7), 'repo'),
    recoveryOperationRoot, recoveryPreState: join(recoveryOperationRoot, 'pre-state'), recoveryPlanPath: join(recoveryOperationRoot, 'plan.json'),
    quarantineOperationRoot, stageRoot: join(plan.home, '.agents/.skills-refiner-stage', id),
    artifactStage: join(plan.home, '.agents/.skills-refiner-stage', id, 'artifact-repo'),
    stageCollection: join(plan.home, '.agents/.skills-refiner-stage', id, plan.collection_id),
    lockPath: join(plan.home, '.agents/skill-control/collection-mutation.lock'),
    catalogPath: join(plan.home, 'Library/Application Support/skills-refiner/catalog.json'),
    catalogViewPath: join(plan.home, '.agents/skill-control/catalog.json'),
  };
}

function writeOperation(paths, plan, state, { mutationOccurred = false, errorCode = null } = {}) {
  const record = {
    schema_version: MANAGED_COLLECTION_SCHEMAS.operation, collection_id: plan.collection_id,
    operation_id: paths.id, plan_hash: plan.plan_hash, state, updated_at: new Date().toISOString(),
    mutation_occurred: mutationOccurred, error_code: errorCode,
  };
  validateManagedOperation(record);
  const bytes = jsonBytes(record);
  if (!lstatExists(paths.operationPath)) {
    createCollectionFileExclusive({ home: plan.home, path: paths.operationPath, targetDigest: sha256(bytes), bytes });
  } else {
    const current = readPrivateJson(plan.home, paths.operationPath, 'invalid_operation');
    validateManagedOperation(current.value);
    if (current.value.operation_id !== paths.id || current.value.plan_hash !== plan.plan_hash) {
      fail('invalid_operation', 'operation current view does not match its plan', 'recovery_required');
    }
    replaceCollectionFileCas({
      home: plan.home, path: paths.operationPath, expectedDigest: current.digest,
      targetDigest: sha256(bytes), bytes,
    });
  }
  return record;
}

function repairAttemptPaths(paths, repairId) {
  const root = join(paths.operationRoot, 'repairs', repairId);
  return { root, record: join(root, 'repair.json') };
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validateRepairAttempt(record, plan, paths) {
  const expectedKeys = [
    'schema_version', 'repair_id', 'collection_id', 'operation_id', 'plan_hash',
    'state', 'issues', 'artifact_digest', 'desired_tree_digest', 'desired_identity',
    'stage_path', 'stage_identity', 'published_identity', 'pre_state',
    'created_at', 'updated_at', 'mutation_occurred', 'error_code',
  ].sort();
  if (canonicalJson(Object.keys(record ?? {}).sort()) !== canonicalJson(expectedKeys)
      || record.schema_version !== REPAIR_SCHEMA
      || !/^repair-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(record.repair_id ?? '')
      || record.collection_id !== plan.collection_id || record.operation_id !== paths.id
      || record.plan_hash !== plan.plan_hash || !Object.values(REPAIR_STATES).includes(record.state)
      || !Array.isArray(record.issues) || record.issues.length === 0
      || record.issues.some((issue) => typeof issue !== 'string' || issue.length === 0)
      || new Set(record.issues).size !== record.issues.length
      || record.artifact_digest !== plan.source.tree_digest
      || !/^sha256:[0-9a-f]{64}$/u.test(record.desired_tree_digest ?? '')
      || !canonicalTimestamp(record.created_at) || !canonicalTimestamp(record.updated_at)
      || typeof record.mutation_occurred !== 'boolean'
      || (record.error_code !== null && (typeof record.error_code !== 'string' || record.error_code.length === 0))) {
    fail('invalid_repair_attempt', `repair attempt is invalid for ${plan.collection_id}`, 'recovery_required');
  }
  const desiredIdentityKeys = ['entry_kind', 'security_metadata_hash'].sort();
  if (canonicalJson(Object.keys(record.desired_identity ?? {}).sort()) !== canonicalJson(desiredIdentityKeys)
      || record.desired_identity.entry_kind !== 'directory'
      || !/^sha256:[0-9a-f]{64}$/u.test(record.desired_identity.security_metadata_hash ?? '')) {
    fail('invalid_repair_attempt', 'repair desired identity is invalid', 'recovery_required');
  }
  const expectedStagePath = join(
    plan.home, '.agents/.skills-refiner-repair', paths.id, record.repair_id, plan.collection_id,
  );
  if (record.stage_path !== expectedStagePath) {
    fail('invalid_repair_attempt', 'repair stage path is not operation-bound', 'recovery_required');
  }
  const publishedIdentityKeys = [
    'entry_kind', 'device', 'inode', 'manifest_hash', 'security_metadata_hash',
  ].sort();
  if (canonicalJson(Object.keys(record.stage_identity ?? {}).sort()) !== canonicalJson(publishedIdentityKeys)
      || record.stage_identity.entry_kind !== 'directory'
      || !/^\d+$/u.test(record.stage_identity.device ?? '')
      || !/^\d+$/u.test(record.stage_identity.inode ?? '')
      || !/^sha256:[0-9a-f]{64}$/u.test(record.stage_identity.manifest_hash ?? '')
      || !/^sha256:[0-9a-f]{64}$/u.test(record.stage_identity.security_metadata_hash ?? '')) {
    fail('invalid_repair_attempt', 'repair stage identity is invalid', 'recovery_required');
  }
  if (record.published_identity !== null
      && (canonicalJson(Object.keys(record.published_identity ?? {}).sort()) !== canonicalJson(publishedIdentityKeys)
        || record.published_identity.entry_kind !== 'directory'
        || !/^\d+$/u.test(record.published_identity.device ?? '')
        || !/^\d+$/u.test(record.published_identity.inode ?? '')
        || !/^sha256:[0-9a-f]{64}$/u.test(record.published_identity.manifest_hash ?? '')
        || !/^sha256:[0-9a-f]{64}$/u.test(record.published_identity.security_metadata_hash ?? ''))) {
    fail('invalid_repair_attempt', 'repair published identity is invalid', 'recovery_required');
  }
  if ([REPAIR_STATES.published, REPAIR_STATES.committed].includes(record.state)
      && record.published_identity === null) {
    fail('invalid_repair_attempt', 'published repair state requires native identity', 'recovery_required');
  }
  const preStateKeys = [
    'present', 'entry_kind', 'device', 'inode', 'manifest_hash',
    'security_metadata_hash', 'quarantine_path',
  ].sort();
  const pre = record.pre_state;
  if (canonicalJson(Object.keys(pre ?? {}).sort()) !== canonicalJson(preStateKeys)
      || typeof pre.present !== 'boolean') {
    fail('invalid_repair_attempt', 'repair pre-state envelope is invalid', 'recovery_required');
  }
  const expectedQuarantine = join(
    paths.quarantineOperationRoot, 'repairs', record.repair_id, 'pre-state', plan.collection_id,
  );
  if (pre.present) {
    if (!['directory', 'file', 'symlink', 'other'].includes(pre.entry_kind)
        || !/^\d+$/u.test(pre.device ?? '') || !/^\d+$/u.test(pre.inode ?? '')
        || !/^sha256:[0-9a-f]{64}$/u.test(pre.manifest_hash ?? '')
        || !/^sha256:[0-9a-f]{64}$/u.test(pre.security_metadata_hash ?? '')
        || pre.quarantine_path !== expectedQuarantine) {
      fail('invalid_repair_attempt', 'repair pre-state identity is invalid', 'recovery_required');
    }
  } else if ([
    pre.entry_kind, pre.device, pre.inode, pre.manifest_hash,
    pre.security_metadata_hash, pre.quarantine_path,
  ].some((value) => value !== null)) {
    fail('invalid_repair_attempt', 'missing repair pre-state must not claim identity', 'recovery_required');
  }
  return record;
}

function createRepairAttempt(plan, paths, {
  repairId, issues, desiredTreeDigest, desiredIdentity, stagePath, stageIdentity, preState,
}) {
  const attemptPaths = repairAttemptPaths(paths, repairId);
  assertSafeManagedPath(plan.home, attemptPaths.record);
  if (lstatExists(attemptPaths.root)) fail('repair_attempt_conflict', `repair attempt exists: ${attemptPaths.root}`);
  mkdirSync(dirname(attemptPaths.root), { recursive: true, mode: 0o700 });
  mkdirSync(attemptPaths.root, { recursive: false, mode: 0o700 });
  const now = new Date().toISOString();
  const quarantinePath = preState === null ? null : join(
    paths.quarantineOperationRoot, 'repairs', repairId, 'pre-state', plan.collection_id,
  );
  const record = validateRepairAttempt({
    schema_version: REPAIR_SCHEMA, repair_id: repairId, collection_id: plan.collection_id,
    operation_id: paths.id, plan_hash: plan.plan_hash, state: REPAIR_STATES.prepared,
    issues: [...new Set(issues)].sort(), artifact_digest: plan.source.tree_digest,
    desired_tree_digest: desiredTreeDigest,
    desired_identity: {
      entry_kind: desiredIdentity.entry_kind,
      security_metadata_hash: desiredIdentity.security_metadata_hash,
    },
    stage_path: stagePath,
    stage_identity: {
      entry_kind: stageIdentity.entry_kind, device: stageIdentity.device,
      inode: stageIdentity.inode, manifest_hash: stageIdentity.manifest_hash,
      security_metadata_hash: stageIdentity.security_metadata_hash,
    },
    published_identity: null,
    pre_state: preState === null ? {
      present: false, entry_kind: null, device: null, inode: null, manifest_hash: null,
      security_metadata_hash: null, quarantine_path: null,
    } : {
      present: true, entry_kind: preState.entry_kind, device: preState.device,
      inode: preState.inode, manifest_hash: preState.manifest_hash,
      security_metadata_hash: preState.security_metadata_hash, quarantine_path: quarantinePath,
    },
    created_at: now, updated_at: now, mutation_occurred: false, error_code: null,
  }, plan, paths);
  const bytes = jsonBytes(record);
  try {
    createCollectionFileExclusive({
      home: plan.home, path: attemptPaths.record, targetDigest: sha256(bytes), bytes,
    });
  } catch (error) {
    if (lstatExists(attemptPaths.root)) rmSync(attemptPaths.root, { recursive: true, force: true });
    throw error;
  }
  return record;
}

function updateRepairAttempt(plan, paths, attempt, state, {
  mutationOccurred = attempt.mutation_occurred, errorCode = null,
  publishedIdentity = attempt.published_identity,
} = {}) {
  const attemptPaths = repairAttemptPaths(paths, attempt.repair_id);
  const current = readPrivateJson(plan.home, attemptPaths.record, 'invalid_repair_attempt');
  validateRepairAttempt(current.value, plan, paths);
  if (canonicalJson(current.value) !== canonicalJson(attempt)) {
    fail('repair_attempt_changed', 'repair attempt changed during reconciliation', 'recovery_required');
  }
  const next = validateRepairAttempt({
    ...attempt, state,
    published_identity: publishedIdentity === null ? null : {
      entry_kind: publishedIdentity.entry_kind, device: publishedIdentity.device,
      inode: publishedIdentity.inode, manifest_hash: publishedIdentity.manifest_hash,
      security_metadata_hash: publishedIdentity.security_metadata_hash,
    },
    updated_at: new Date().toISOString(),
    mutation_occurred: mutationOccurred, error_code: errorCode,
  }, plan, paths);
  const bytes = jsonBytes(next);
  replaceCollectionFileCas({
    home: plan.home, path: attemptPaths.record, expectedDigest: current.digest,
    targetDigest: sha256(bytes), bytes,
  });
  return next;
}

function inspectRepairLedger(plan, paths) {
  const root = join(paths.operationRoot, 'repairs');
  const pending = [];
  const issues = [];
  const records = [];
  const knownRepairIds = new Set();
  if (lstatExists(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (!entry.isDirectory() || !entry.name.startsWith('repair-')) {
        fail('invalid_repair_attempt', `unexpected repair ledger entry: ${entry.name}`, 'recovery_required');
      }
      const record = readPrivateJson(plan.home, repairAttemptPaths(paths, entry.name).record, 'invalid_repair_attempt').value;
      validateRepairAttempt(record, plan, paths);
      if (record.repair_id !== entry.name) {
        fail('invalid_repair_attempt', `repair ledger directory does not match ${record.repair_id}`, 'recovery_required');
      }
      knownRepairIds.add(record.repair_id);
      records.push(record);
      if (record.state === REPAIR_STATES.committed && record.pre_state.present
          && !repairIdentityMatches(plan.home, record.pre_state.quarantine_path, record.pre_state)) {
        issues.push(`REPAIR_QUARANTINE_MISSING_OR_DRIFT:${record.repair_id}`);
      }
      if (TERMINAL_REPAIR_STATES.has(record.state)
          && (lstatExists(record.stage_path) || lstatExists(dirname(record.stage_path)))) {
        issues.push(`REPAIR_STAGE_RESIDUE:${record.repair_id}`);
      }
      if (!TERMINAL_REPAIR_STATES.has(record.state)) pending.push(record);
    }
  }
  const stageRoot = join(plan.home, '.agents/.skills-refiner-repair', paths.id);
  if (lstatExists(stageRoot)) {
    for (const entry of readdirSync(stageRoot, { withFileTypes: true })) {
      if (/^repair-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(entry.name)
          && !knownRepairIds.has(entry.name)) issues.push(`ORPHAN_REPAIR_STAGE:${entry.name}`);
    }
  }
  if (pending.length > 1) fail('ambiguous_repairs', `multiple pending repairs exist for ${plan.collection_id}`, 'recovery_required');
  return { pending: pending[0] ?? null, issues, records };
}

function pendingRepairAttempt(plan, paths) {
  return inspectRepairLedger(plan, paths).pending;
}

function acquireLock(paths, plan) {
  assertSafeManagedPath(plan.home, paths.lockPath);
  mkdirSync(dirname(paths.lockPath), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(`${JSON.stringify({ operation_id: paths.id, plan_hash: plan.plan_hash, pid: process.pid })}\n`);
  const auditRoot = join(plan.home, '.agents/skill-control/lock-audit');
  assertSafeManagedPath(plan.home, join(auditRoot, 'entry'));
  mkdirSync(auditRoot, { recursive: true, mode: 0o700 });
  let created = false;
  try {
    const creation = createCollectionFileExclusive({ home: plan.home, path: paths.lockPath, targetDigest: sha256(bytes), bytes });
    created = true;
    const identity = inspectCollectionEntry({ home: plan.home, path: paths.lockPath });
    if (identity.device !== creation.device || identity.inode !== creation.inode) {
      fail('mutation_lock_identity_changed', 'collection lock changed immediately after exclusive creation', 'recovery_required');
    }
    return {
      home: plan.home, path: paths.lockPath, ...identity,
      releaseDestination: join(auditRoot, `${paths.id}-${identity.device}-${identity.inode}.released.json`),
    };
  } catch (error) {
    if (created && error instanceof ManagedCollectionError) throw error;
    if (created) fail('mutation_lock_identity_unknown', `cannot bind collection lock identity: ${error.message}`, 'recovery_required');
    fail('mutation_lock_unavailable', `collection mutation lock is unavailable: ${error.message}`);
  }
}
function releaseLock(paths, lock) {
  try {
    moveCollectionEntryExclusive({
      home: lock.home, source: lock.path, destination: lock.releaseDestination,
      expectedManifest: lock.manifest_hash, expectedDevice: lock.device, expectedInode: lock.inode,
    });
  } catch (error) { fail('mutation_lock_release_failed', error.message, 'recovery_required'); }
}

function emptyCatalog() { return { schema_version: CATALOG_SCHEMA, updated_at: new Date(0).toISOString(), collections: {} }; }
function loadCatalog(home, path) {
  if (!lstatExists(path)) return emptyCatalog();
  const catalog = readPrivateJson(home, path, 'invalid_collection_catalog').value;
  if (catalog.schema_version !== CATALOG_SCHEMA || !catalog.collections || typeof catalog.collections !== 'object') fail('invalid_collection_catalog', 'collection catalog schema is invalid');
  return catalog;
}
function catalogEntryForPlan(plan, paths, { firstActivatedAt, currentActivatedAt }) {
  return {
    collection_id: plan.collection_id, operation_id: paths.id, plan_hash: plan.plan_hash,
    source: {
      provider: plan.source.provider, repository_id: plan.source.repository_id,
      resolved_revision: plan.source.revision, artifact_digest: plan.source.tree_digest,
    },
    collection_root: plan.target.collection_root, recovery_plan: paths.recoveryPlanPath,
    lifecycle: {
      receipt_history: plan.receipt.history, plan_created_at: plan.created_at,
      first_activated_at: firstActivatedAt, current_generation_activated_at: currentActivatedAt,
    },
  };
}
function publishCatalog(plan, paths, activatedAt) {
  const catalog = loadCatalog(plan.home, paths.catalogPath);
  const previous = catalog.collections[plan.collection_id];
  catalog.updated_at = activatedAt;
  catalog.collections[plan.collection_id] = catalogEntryForPlan(plan, paths, {
    firstActivatedAt: previous?.lifecycle?.first_activated_at ?? activatedAt,
    currentActivatedAt: activatedAt,
  });
  durableJson(paths.catalogPath, catalog);
  durableJson(paths.catalogViewPath, catalog);
}
function rebuildCatalogFromControls(home) {
  const primaryPath = join(home, 'Library/Application Support/skills-refiner/catalog.json');
  const viewPath = join(home, '.agents/skill-control/catalog.json');
  const rebuilt = emptyCatalog();
  const activationTimes = [];
  for (const collectionId of managedCollectionIds()) {
    const plan = loadPlanFromControl(home, collectionId);
    if (plan === null) continue;
    const paths = operationPaths(plan);
    const operation = readPrivateJson(home, paths.operationPath, 'invalid_operation').value;
    const active = readPrivateJson(home, paths.activePath, 'invalid_active_generation').value;
    validateManagedOperation(operation);
    if (operation.state !== OPERATION_STATES.committed) fail('catalog_rebuild_blocked', `cannot rebuild catalog from non-committed ${collectionId}`);
    validateActiveRecord(active, plan, 'catalog_rebuild_blocked');
    const durableFirst = plan.predecessor?.catalog_entry.lifecycle.first_activated_at ?? active.activated_at;
    rebuilt.collections[collectionId] = catalogEntryForPlan(plan, paths, {
      firstActivatedAt: durableFirst, currentActivatedAt: active.activated_at,
    });
    activationTimes.push(active.activated_at);
  }
  rebuilt.updated_at = activationTimes.sort().at(-1) ?? new Date(0).toISOString();
  durableJson(primaryPath, rebuilt);
  durableJson(viewPath, rebuilt);
}
function removeActiveIfOwned(plan, paths) {
  if (!lstatExists(paths.activePath)) return;
  const active = readPrivateJson(plan.home, paths.activePath, 'invalid_active_generation').value;
  if (active.collection_id !== plan.collection_id || active.operation_id !== paths.id || active.plan_hash !== plan.plan_hash) {
    fail('active_generation_conflict', 'active generation is not owned by the rolling-back operation', 'recovery_required');
  }
  unlinkSync(paths.activePath);
}
function removeCatalogEntry(plan, paths) {
  const catalog = loadCatalog(plan.home, paths.catalogPath);
  const current = catalog.collections[plan.collection_id];
  if (!current || current.operation_id !== paths.id || current.plan_hash !== plan.plan_hash) fail('catalog_conflict', 'catalog active generation changed', 'recovery_required');
  delete catalog.collections[plan.collection_id];
  catalog.updated_at = new Date().toISOString();
  durableJson(paths.catalogPath, catalog);
  durableJson(paths.catalogViewPath, catalog);
}

function verifySourceAgainstPlan(plan) {
  const observed = inspectManagedSource({ collectionId: plan.collection_id, sourceRoot: plan.source.root, revision: plan.source.revision });
  if (!Object.hasOwn(plan.source, 'remote_attestation')) delete observed.remote_attestation;
  if (canonicalJson(observed) !== canonicalJson(plan.source)) fail('source_drift', 'candidate source changed after planning');
}
function verifyInstalledAgainstPlan(plan) {
  const installed = observeManagedInstall({
    collectionId: plan.collection_id, home: plan.home, candidate: plan.source,
    activeCollectionRoot: plan.predecessor?.collection.path ?? null,
    activeExposurePaths: new Set(plan.predecessor?.exposures.map(({ path }) => path) ?? []),
  });
  if (installed.conflicts.length > 0) fail('installed_conflict', 'fresh installed observation contains conflicts');
  if (plan.predecessor !== null) {
    const active = loadPlanFromControl(plan.home, plan.collection_id);
    if (active === null || active.plan_hash !== plan.predecessor.plan_hash || operationId(active) !== plan.predecessor.operation_id) fail('predecessor_drift', 'active generation changed after planning');
    if (canonicalJson(observeManagedPredecessor({
      plan: active,
      home: plan.home,
      duringUpgrade: true,
      candidate: plan.source,
    })) !== canonicalJson(plan.predecessor)) fail('predecessor_drift', 'active generation facts changed after planning');
  }
  const expected = {
    receipt: installed.receipt,
    legacy: installed.legacy.map((entry) => ({ ...entry, disposition: 'replaced', successor: entry.name })),
    projections: installed.projections,
    preserved_collisions: installed.name_collisions,
    agent_roots: plan.predecessor === null ? installed.agent_roots : plan.agent_roots,
  };
  const planned = {
    receipt: plan.receipt, legacy: plan.legacy, projections: plan.projections,
    preserved_collisions: plan.preserved_collisions ?? installed.name_collisions,
    agent_roots: plan.agent_roots,
  };
  if (canonicalJson(expected) !== canonicalJson(planned)) fail('installed_facts_drift', 'plan does not match fresh installed state');
}
function verifyPreconditions(plan) {
  validateManagedPlan(plan);
  if (Number(process.versions.node.split('.')[0]) !== 24 || canonicalJson(controllerIdentity(plan.home)) !== canonicalJson(plan.controller)) fail('controller_drift', 'controller identity changed after planning');
  verifySourceAgainstPlan(plan);
  verifyInstalledAgainstPlan(plan);
  if (sha256(readFileSync(plan.receipt.path)) !== plan.receipt.digest) fail('receipt_drift', 'installer receipt changed after planning');
  const collectionLegacy = plan.legacy.find(({ path }) => path === plan.target.collection_root);
  if (lstatExists(plan.target.collection_root) && !collectionLegacy && plan.predecessor === null) fail('target_conflict', `collection root exists: ${plan.target.collection_root}`);
  if (plan.target.exposure.global_projection !== null && lstatExists(plan.target.exposure.global_projection) && plan.predecessor === null) fail('target_conflict', 'global exposure already exists');
  for (const root of plan.agent_roots) {
    const target = join(root.root, plan.target.exposure.name);
    const quarantinedLegacy = plan.projections.some(({ path }) => path === target);
    if (lstatExists(target) && !quarantinedLegacy && plan.predecessor === null) fail('target_conflict', `agent exposure already exists: ${target}`);
  }
}

function ensureArtifact(plan, paths) {
  if (lstatExists(paths.artifactRepo)) {
    const rootMode = lstatSync(paths.artifactRepo).mode & 0o777;
    if ((rootMode & 0o500) !== 0o500 || (rootMode & 0o022) !== 0) fail('artifact_conflict', 'existing artifact root mode is unsafe');
    if (lstatExists(join(paths.artifactRepo, '.git'))) fail('artifact_conflict', 'existing artifact contains Git metadata');
    if (treeDigest(paths.artifactRepo) !== plan.source.tree_digest) fail('artifact_conflict', 'existing artifact digest mismatch');
    return;
  }
  assertSafeManagedPath(plan.home, paths.artifactRepo);
  mkdirSync(dirname(paths.artifactRepo), { recursive: true, mode: 0o700 });
  assertSafeManagedPath(plan.home, paths.artifactStage);
  const { readObjects } = sourceGitAccess(plan.source.root);
  materializeGitRevision({
    readObjects, revision: plan.source.revision, destination: paths.artifactStage, fail,
  });
  if (treeDigest(paths.artifactStage) !== plan.source.tree_digest) fail('artifact_copy_failed', 'artifact copy changed identity');
  renameSync(paths.artifactStage, paths.artifactRepo);
  const parent = openSync(dirname(paths.artifactRepo), 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

function runtimeLocator(plan, paths) {
  if (plan.target.exposure.type !== 'gateway') return null;
  return {
    schema_version: 'skills-refiner.collection-runtime-locator.v2', collection_id: plan.collection_id,
    skill_name: plan.target.exposure.name, resolved_revision: plan.source.revision,
    artifact_digest: plan.source.tree_digest, global_skill_path: join(plan.target.collection_root, plan.target.exposure.name),
    canonical_repo_root: paths.artifactRepo, member_root: plan.target.collection_root,
  };
}
function locatorFilename(plan) { return `${plan.collection_id}-runtime.json`; }
function expectedMembers(plan, paths) {
  return plan.source.members.map(({ name, tree_digest }) => {
    if (plan.target.exposure.type !== 'gateway' || name !== plan.target.exposure.name) return { name, relative_path: name, tree_digest };
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), `skills-refiner-${plan.collection_id}-gateway-`)));
    try {
      const gateway = join(temporary, name);
      const source = plan.source.members.find((member) => member.name === name);
      copyTreeWithStableModes(join(paths.artifactRepo, source.source_path), gateway, {
        recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
      }, fail);
      durableJson(join(gateway, locatorFilename(plan)), runtimeLocator(plan, paths));
      return { name, relative_path: name, tree_digest: deployedTreeDigest(gateway) };
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
}
function expectedIndex(plan, paths, members = expectedMembers(plan, paths)) {
  const locator = runtimeLocator(plan, paths);
  return {
    schema_version: MANAGED_COLLECTION_SCHEMAS.index, collection_id: plan.collection_id,
    source: { provider: plan.source.provider, repository_id: plan.source.repository_id, resolved_revision: plan.source.revision, tree_digest: plan.source.tree_digest },
    artifact_digest: plan.source.tree_digest, manifest_digest: plan.source.manifest_digest, members,
    resources: plan.source.resources.map(({ relative_path, tree_digest }) => ({ relative_path, tree_digest })),
    exposure: { type: plan.target.exposure.type, name: plan.target.exposure.name, locator_digest: locator === null ? null : sha256(jsonBytes(locator)) },
    receipt_snapshot_digest: plan.receipt.entries_digest,
    profile_matrix_digest: sha256(Buffer.from(canonicalJson(plan.agent_roots))),
    plan_created_at: plan.created_at, operation_id: paths.id,
  };
}
function materializeCollection(plan, paths, target = paths.stageCollection) {
  assertSafeManagedPath(plan.home, target);
  if (lstatExists(target)) fail('stage_conflict', `staging target exists: ${target}`);
  const spec = collectionSpec(plan.collection_id);
  const sourceGraph = referenceGraph(paths.artifactRepo, [
    ...spec.members.map(({ sourcePath }) => join(paths.artifactRepo, sourcePath)),
    ...spec.sharedPaths.map((sourcePath) => join(paths.artifactRepo, sourcePath)),
  ], { allowMissing: true, excludedPaths: new Set(spec.referenceExclusions) });
  const actions = packagingReferenceActions(paths.artifactRepo, spec, sourceGraph);
  copyPackagingInputs(paths.artifactRepo, target, spec);
  applyPackagingReferenceActions(paths.artifactRepo, target, spec, actions);
  if (plan.target.exposure.type === 'gateway') durableJson(join(target, plan.target.exposure.name, locatorFilename(plan)), runtimeLocator(plan, paths));
  const members = plan.source.members.map(({ name }) => ({
    name, relative_path: name, tree_digest: deployedTreeDigest(join(target, name)),
  }));
  const index = expectedIndex(plan, paths, members);
  validateManagedIndex(index);
  durableJson(join(target, 'INDEX.json'), index);
  referenceGraph(target, [
    ...plan.source.members.map(({ name }) => join(target, name)),
    ...plan.source.resources.map(({ relative_path }) => join(target, relative_path)),
  ], { excludedPaths: new Set(spec.referenceExclusions) });
  return index;
}

function exactSymlink(path, rawTarget) { try { return lstatSync(path).isSymbolicLink() && readlinkSync(path) === rawTarget; } catch { return false; } }
function predecessorExposurePath(base, exposure) {
  return join(base, 'predecessor', 'exposures', exposure.scope === 'global' ? 'global' : exposure.agent);
}
function copyRecovery(plan, paths) {
  if (lstatExists(paths.recoveryOperationRoot)) fail('recovery_conflict', `recovery operation exists: ${paths.recoveryOperationRoot}`);
  assertSafeManagedPath(plan.home, paths.recoveryOperationRoot);
  durableJson(paths.recoveryPlanPath, plan);
  const recoverySkills = join(paths.recoveryPreState, 'skills');
  mkdirSync(recoverySkills, { recursive: true, mode: 0o700 });
  for (const entry of plan.legacy) {
    const target = join(recoverySkills, entry.name);
    const copied = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', entry.path, target], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' } });
    if (copied.status !== 0 || treeDigest(target) !== entry.tree_digest || nativeIdentity(plan.home, target).security_metadata_hash !== entry.security_metadata_hash) fail('recovery_copy_failed', `recovery copy mismatch for ${entry.name}`);
  }
  copyFileSync(plan.receipt.path, join(paths.recoveryPreState, 'skill-lock.json'));
  for (const link of plan.projections) {
    const target = join(paths.recoveryPreState, 'projections', link.agent, link.name);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const copied = spawnSync('/bin/cp', ['-a', link.path, target], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' } });
    if (copied.status !== 0 || !exactSymlink(target, link.raw_target) || nativeIdentity(plan.home, target).security_metadata_hash !== link.security_metadata_hash) fail('recovery_copy_failed', `projection recovery mismatch: ${link.path}`);
  }
  if (plan.predecessor !== null) {
    const collectionTarget = join(paths.recoveryPreState, 'predecessor', 'collection');
    const copiedCollection = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', plan.predecessor.collection.path, collectionTarget], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' } });
    if (copiedCollection.status !== 0 || treeDigest(collectionTarget) !== plan.predecessor.collection.tree_digest
        || nativeIdentity(plan.home, collectionTarget).security_metadata_hash !== plan.predecessor.collection.security_metadata_hash) fail('recovery_copy_failed', 'predecessor collection recovery mismatch');
    for (const exposure of plan.predecessor.exposures) {
      const target = predecessorExposurePath(paths.recoveryPreState, exposure);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      const copied = spawnSync('/bin/cp', ['-a', exposure.path, target], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' } });
      if (copied.status !== 0 || !exactSymlink(target, exposure.raw_target)
          || nativeIdentity(plan.home, target).security_metadata_hash !== exposure.security_metadata_hash) fail('recovery_copy_failed', `predecessor exposure recovery mismatch: ${exposure.path}`);
    }
  }
  durableJson(join(paths.recoveryOperationRoot, 'manifest.json'), {
    schema_version: 'skills-refiner.collection.recovery-manifest.v2', collection_id: plan.collection_id,
    operation_id: paths.id, plan_hash: plan.plan_hash, receipt_digest: plan.receipt.digest,
    legacy: plan.legacy.map(({ name, tree_digest, security_metadata_hash }) => ({ name, tree_digest, security_metadata_hash })),
    projections_digest: sha256(Buffer.from(canonicalJson(plan.projections))),
    predecessor_digest: plan.predecessor === null ? null : sha256(Buffer.from(canonicalJson(plan.predecessor))),
  });
}

function restoreDirectory(plan, paths, entry) {
  const recovery = join(paths.recoveryPreState, 'skills', entry.name);
  if (!lstatExists(recovery) || treeDigest(recovery) !== entry.tree_digest || nativeIdentity(plan.home, recovery).security_metadata_hash !== entry.security_metadata_hash) fail('recovery_source_drift', `recovery source changed: ${entry.name}`, 'recovery_required');
  const stage = join(paths.quarantineOperationRoot, 'recovery-restore/skills', entry.name);
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  const copied = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', recovery, stage], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' } });
  if (copied.status !== 0 || treeDigest(stage) !== entry.tree_digest) fail('recovery_restore_failed', `cannot stage recovery: ${entry.name}`, 'recovery_required');
  moveCollectionEntryExclusive({ home: plan.home, source: stage, destination: entry.path });
}
function restoreProjection(plan, paths, link) {
  const recovery = join(paths.recoveryPreState, 'projections', link.agent, link.name);
  if (!exactSymlink(recovery, link.raw_target)) fail('recovery_source_drift', `projection recovery changed: ${link.path}`, 'recovery_required');
  const stage = join(paths.quarantineOperationRoot, 'recovery-restore/projections', link.agent, link.name);
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  const copied = spawnSync('/bin/cp', ['-a', recovery, stage], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' } });
  if (copied.status !== 0 || !exactSymlink(stage, link.raw_target)) fail('recovery_restore_failed', `cannot stage projection recovery: ${link.path}`, 'recovery_required');
  moveCollectionEntryExclusive({ home: plan.home, source: stage, destination: link.path });
}

function restorePredecessorCollection(plan, paths) {
  const entry = plan.predecessor.collection;
  const recovery = join(paths.recoveryPreState, 'predecessor', 'collection');
  if (!lstatExists(recovery) || treeDigest(recovery) !== entry.tree_digest
      || nativeIdentity(plan.home, recovery).security_metadata_hash !== entry.security_metadata_hash) fail('recovery_source_drift', 'predecessor collection recovery changed', 'recovery_required');
  const stage = join(paths.quarantineOperationRoot, 'recovery-restore/predecessor/collection');
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  const copied = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', recovery, stage], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' } });
  if (copied.status !== 0 || treeDigest(stage) !== entry.tree_digest) fail('recovery_restore_failed', 'cannot stage predecessor collection', 'recovery_required');
  moveCollectionEntryExclusive({ home: plan.home, source: stage, destination: entry.path });
}
function restorePredecessorExposure(plan, paths, exposure) {
  const recovery = predecessorExposurePath(paths.recoveryPreState, exposure);
  if (!exactSymlink(recovery, exposure.raw_target)) fail('recovery_source_drift', `predecessor exposure recovery changed: ${exposure.path}`, 'recovery_required');
  const stage = predecessorExposurePath(join(paths.quarantineOperationRoot, 'recovery-restore'), exposure);
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  const copied = spawnSync('/bin/cp', ['-a', recovery, stage], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' } });
  if (copied.status !== 0 || !exactSymlink(stage, exposure.raw_target)) fail('recovery_restore_failed', `cannot stage predecessor exposure: ${exposure.path}`, 'recovery_required');
  moveCollectionEntryExclusive({ home: plan.home, source: stage, destination: exposure.path });
}

function restorePredecessorControl(plan, paths) {
  if (plan.predecessor === null) {
    removeActiveIfOwned(plan, paths);
    if (lstatExists(paths.catalogPath)) {
      const catalog = loadCatalog(plan.home, paths.catalogPath);
      if (catalog.collections[plan.collection_id]?.operation_id === paths.id) {
        delete catalog.collections[plan.collection_id];
        catalog.updated_at = new Date().toISOString();
        durableJson(paths.catalogPath, catalog);
        durableJson(paths.catalogViewPath, catalog);
      }
    }
    return;
  }
  if (lstatExists(paths.activePath)) {
    const active = readPrivateJson(plan.home, paths.activePath, 'invalid_active_generation').value;
    const currentOwned = active.operation_id === paths.id && active.plan_hash === plan.plan_hash;
    const predecessorOwned = canonicalJson(active) === canonicalJson(plan.predecessor.active_record);
    if (!currentOwned && !predecessorOwned) fail('active_generation_conflict', 'active generation changed during rollback', 'recovery_required');
  }
  durableJson(paths.activePath, plan.predecessor.active_record);
  const catalog = loadCatalog(plan.home, paths.catalogPath);
  const current = catalog.collections[plan.collection_id];
  if (current && current.operation_id !== paths.id && current.operation_id !== plan.predecessor.operation_id) fail('catalog_conflict', 'catalog generation changed during rollback', 'recovery_required');
  catalog.collections[plan.collection_id] = plan.predecessor.catalog_entry;
  catalog.updated_at = new Date().toISOString();
  durableJson(paths.catalogPath, catalog);
  durableJson(paths.catalogViewPath, catalog);
}

function exposurePath(plan, root) { return join(root.root, plan.target.exposure.name); }
function rollback(plan, paths) {
  let recreated = false;
  writeOperation(paths, plan, OPERATION_STATES.rollingBack, { mutationOccurred: true });
  for (const root of plan.agent_roots) {
    const path = exposurePath(plan, root);
    if (lstatExists(path)) {
      if (!exactSymlink(path, plan.target.exposure.agent_raw_target)) fail('rollback_conflict', `agent exposure changed: ${path}`, 'recovery_required');
      unlinkCollectionSymlinkExact({ home: plan.home, path, rawTarget: plan.target.exposure.agent_raw_target });
    }
  }
  if (plan.target.exposure.global_projection !== null && lstatExists(plan.target.exposure.global_projection)) {
    if (!exactSymlink(plan.target.exposure.global_projection, plan.target.exposure.global_raw_target)) fail('rollback_conflict', 'global exposure changed', 'recovery_required');
    unlinkCollectionSymlinkExact({ home: plan.home, path: plan.target.exposure.global_projection, rawTarget: plan.target.exposure.global_raw_target });
  }
  if (lstatExists(plan.target.collection_root)) {
    const post = join(paths.quarantineOperationRoot, 'post-state', plan.collection_id);
    moveCollectionEntryExclusive({ home: plan.home, source: plan.target.collection_root, destination: post });
  }
  if (plan.predecessor === null) {
    for (const entry of plan.legacy) {
      if (lstatExists(entry.path)) continue;
      const quarantined = join(paths.quarantineOperationRoot, 'skills', entry.name);
      if (lstatExists(quarantined)) moveCollectionEntryExclusive({ home: plan.home, source: quarantined, destination: entry.path, expectedManifest: entry.native_manifest });
      else { restoreDirectory(plan, paths, entry); recreated = true; }
    }
    for (const link of plan.projections) {
      if (lstatExists(link.path)) continue;
      const quarantined = join(paths.quarantineOperationRoot, 'projections', link.agent, link.name);
      if (lstatExists(quarantined)) moveCollectionEntryExclusive({ home: plan.home, source: quarantined, destination: link.path, expectedManifest: link.native_manifest });
      else { restoreProjection(plan, paths, link); recreated = true; }
    }
  } else {
    const collectionQuarantine = join(paths.quarantineOperationRoot, 'predecessor', 'collection');
    if (!lstatExists(plan.predecessor.collection.path)) {
      if (lstatExists(collectionQuarantine)) moveCollectionEntryExclusive({ home: plan.home, source: collectionQuarantine, destination: plan.predecessor.collection.path, expectedManifest: plan.predecessor.collection.native_manifest });
      else { restorePredecessorCollection(plan, paths); recreated = true; }
    }
    for (const exposure of plan.predecessor.exposures) {
      if (lstatExists(exposure.path)) continue;
      const quarantined = predecessorExposurePath(paths.quarantineOperationRoot, exposure);
      if (lstatExists(quarantined)) moveCollectionEntryExclusive({ home: plan.home, source: quarantined, destination: exposure.path, expectedManifest: exposure.native_manifest });
      else { restorePredecessorExposure(plan, paths, exposure); recreated = true; }
    }
  }
  restorePredecessorControl(plan, paths);
  writeOperation(paths, plan, OPERATION_STATES.rolledBack, { mutationOccurred: true });
  return { recreated };
}

function injectFault(phase, requested, killRequested) {
  if (killRequested === phase) process.kill(process.pid, 'SIGKILL');
  if (requested === phase) fail('injected_fault', `injected fault at ${phase}`, 'recovery_required');
}

export function applyManagedPlan(plan, confirmation, { faultPhase = null, killPhase = null } = {}) {
  validateManagedPlan(plan);
  const paths = operationPaths(plan);
  if (confirmation !== plan.plan_hash) fail('confirmation_mismatch', 'apply confirmation must equal plan hash');
  if (lstatExists(paths.activePath) && plan.predecessor === null) fail('active_generation_exists', `active generation exists for ${plan.collection_id}`);
  verifyPreconditions(plan);
  const lock = acquireLock(paths, plan);
  let mutation = false;
  let operationPublished = false;
  let stageOwned = false;
  try {
    mkdirSync(dirname(paths.operationRoot), { recursive: true, mode: 0o700 });
    mkdirSync(paths.operationRoot, { recursive: false, mode: 0o700 });
    durableJson(paths.planPath, plan);
    writeOperation(paths, plan, OPERATION_STATES.planned);
    operationPublished = true;
    verifyPreconditions(plan);
    assertSafeManagedPath(plan.home, paths.stageRoot);
    if (lstatExists(paths.stageRoot)) fail('stage_conflict', `staging root already exists: ${paths.stageRoot}`);
    mkdirSync(dirname(paths.stageRoot), { recursive: true, mode: 0o700 });
    chmodSync(dirname(paths.stageRoot), 0o700);
    mkdirSync(paths.stageRoot, { recursive: false, mode: 0o700 });
    stageOwned = true;
    chmodSync(paths.stageRoot, 0o700);
    ensureArtifact(plan, paths);
    copyRecovery(plan, paths);
    materializeCollection(plan, paths);
    writeOperation(paths, plan, OPERATION_STATES.prepared);
    injectFault('after_prepared', faultPhase, killPhase);
    writeOperation(paths, plan, OPERATION_STATES.applying, { mutationOccurred: true });
    mutation = true;
    const projectionPayloads = plan.predecessor === null ? plan.projections : plan.predecessor.exposures;
    for (const [index, link] of projectionPayloads.entries()) {
      const destination = plan.predecessor === null
        ? join(paths.quarantineOperationRoot, 'projections', link.agent, link.name)
        : predecessorExposurePath(paths.quarantineOperationRoot, link);
      moveCollectionEntryExclusive({ home: plan.home, source: link.path, destination, expectedManifest: link.native_manifest });
      if (index === 0) injectFault('after_first_projection_quarantine', faultPhase, killPhase);
    }
    injectFault('after_projection_quarantine', faultPhase, killPhase);
    const directoryPayloads = plan.predecessor === null ? plan.legacy : [plan.predecessor.collection];
    for (const [index, entry] of directoryPayloads.entries()) {
      const destination = plan.predecessor === null
        ? join(paths.quarantineOperationRoot, 'skills', entry.name)
        : join(paths.quarantineOperationRoot, 'predecessor', 'collection');
      moveCollectionEntryExclusive({ home: plan.home, source: entry.path, destination, expectedManifest: entry.native_manifest });
      if (index === 0) injectFault('after_first_legacy_quarantine', faultPhase, killPhase);
    }
    injectFault('after_legacy_quarantine', faultPhase, killPhase);
    moveCollectionEntryExclusive({ home: plan.home, source: paths.stageCollection, destination: plan.target.collection_root });
    injectFault('after_collection_publish', faultPhase, killPhase);
    if (plan.target.exposure.global_projection !== null) createCollectionSymlinkExclusive({ home: plan.home, path: plan.target.exposure.global_projection, rawTarget: plan.target.exposure.global_raw_target });
    for (const root of plan.agent_roots) createCollectionSymlinkExclusive({ home: plan.home, path: exposurePath(plan, root), rawTarget: plan.target.exposure.agent_raw_target });
    injectFault('after_projection_publish', faultPhase, killPhase);
    const activatedAt = new Date().toISOString();
    durableJson(paths.activePath, { schema_version: 'skills-refiner.collection.active.v2', collection_id: plan.collection_id, operation_id: paths.id, plan_hash: plan.plan_hash, activated_at: activatedAt });
    publishCatalog(plan, paths, activatedAt);
    injectFault('after_catalog_publish', faultPhase, killPhase);
    const observed = statusAgainstPlan(plan, paths, { requireCommitted: false });
    if (observed.status !== 'FILESYSTEM_READY') fail('postcondition_failed', observed.issues.join(', '), 'recovery_required');
    writeOperation(paths, plan, OPERATION_STATES.committed, { mutationOccurred: true });
    return { schema_version: 'skills-refiner.collection.apply.v2', collection_id: plan.collection_id, status: 'FILESYSTEM_READY', runtime_status: 'UNVERIFIED', operation_id: paths.id, plan_hash: plan.plan_hash, mutation_occurred: true, recovery_root: paths.recoveryOperationRoot, quarantine_root: paths.quarantineOperationRoot };
  } catch (error) {
    if (mutation) {
      try { rollback(plan, paths); } catch (rollbackError) {
        try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: rollbackError.code ?? 'rollback_failed' }); } catch {}
        throw rollbackError;
      }
    } else if (operationPublished) {
      try { writeOperation(paths, plan, OPERATION_STATES.rolledBack, { mutationOccurred: false, errorCode: error.code ?? 'apply_failed' }); } catch {}
    }
    if (error instanceof MacosAdapterError) fail('native_mutation_blocked', error.reason, error.status);
    throw error;
  } finally {
    if (stageOwned && lstatExists(paths.stageRoot)) rmSync(paths.stageRoot, { recursive: true, force: true });
    releaseLock(paths, lock);
  }
}

function scopedReceiptDigest(plan) {
  try {
    const receipt = readJson(plan.receipt.path, 'invalid_receipt');
    const entries = Object.entries(receipt.skills ?? {})
      .filter(([, value]) => value?.source === plan.source.repository_id)
      .map(([name, value]) => ({ name, receipt: value })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return sha256(Buffer.from(canonicalJson(entries)));
  } catch { return null; }
}

function statusAgainstPlan(plan, paths = operationPaths(plan), { requireCommitted = true, orphanedCatalog = false, orphanedControl = false } = {}) {
  const spec = collectionSpec(plan.collection_id);
  const issues = [];
  let index = null;
  let expected = null;
  if (orphanedCatalog) issues.push('ORPHANED_CATALOG');
  if (orphanedControl) issues.push('ORPHANED_CONTROL');
  try {
    const operation = readPrivateJson(plan.home, paths.operationPath, 'invalid_operation').value;
    validateManagedOperation(operation);
    if (operation.operation_id !== paths.id || operation.plan_hash !== plan.plan_hash) issues.push('OPERATION_IDENTITY_DRIFT');
    if (requireCommitted && operation.state !== OPERATION_STATES.committed) issues.push(`OPERATION_NOT_COMMITTED:${operation.state}`);
  } catch { issues.push('OPERATION_MISSING_OR_INVALID'); }
  try {
    const stat = lstatSync(plan.target.collection_root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) issues.push('COLLECTION_ROOT_NOT_REAL_DIRECTORY');
    else if ((stat.mode & 0o777) !== 0o755) issues.push('COLLECTION_ROOT_MODE_DRIFT');
  } catch { issues.push('COLLECTION_ROOT_MISSING'); }
  if (lstatExists(join(plan.target.collection_root, 'SKILL.md'))) issues.push('COLLECTION_ROOT_HAS_SKILL_MD');
  try {
    index = readJson(join(plan.target.collection_root, 'INDEX.json'), 'invalid_index');
    validateManagedIndex(index);
    expected = expectedIndex(plan, paths);
    if (canonicalJson(index) !== canonicalJson(expected)) issues.push('INDEX_IDENTITY_DRIFT');
  } catch { issues.push('INDEX_MISSING_OR_INVALID'); }
  try {
    const artifactRootMode = lstatSync(paths.artifactRepo).mode & 0o777;
    if ((artifactRootMode & 0o500) !== 0o500 || (artifactRootMode & 0o022) !== 0) issues.push('ARTIFACT_ROOT_MODE_UNSAFE');
    if (lstatExists(join(paths.artifactRepo, '.git'))) issues.push('ARTIFACT_CONTAINS_GIT_METADATA');
    if (treeDigest(paths.artifactRepo) !== plan.source.tree_digest) issues.push('ARTIFACT_IDENTITY_DRIFT');
  } catch { issues.push('ARTIFACT_MISSING_OR_INVALID'); }
  if (index !== null) {
    const expectedEntries = new Set(['INDEX.json', ...index.members.map(({ name }) => name), ...index.resources.map(({ relative_path }) => relative_path.split('/')[0])]);
    try {
      const actual = readdirSync(plan.target.collection_root);
      for (const name of actual) if (!expectedEntries.has(name) && !IGNORED_COLLECTION_METADATA.has(name)) issues.push(`UNEXPECTED_COLLECTION_ENTRY:${name}`);
      for (const name of expectedEntries) if (!actual.includes(name)) issues.push(`MISSING_COLLECTION_ENTRY:${name}`);
    } catch {}
    const expectedMembers = new Map((expected?.members ?? []).map((member) => [member.name, member.tree_digest]));
    for (const member of index.members) {
      const path = join(plan.target.collection_root, member.name);
      if (!lstatExists(path)) continue;
      try {
        if ((lstatSync(path).mode & 0o777) !== 0o755) issues.push(`MEMBER_ROOT_MODE_DRIFT:${member.name}`);
        if (deployedTreeDigest(path) !== expectedMembers.get(member.name)) issues.push(`MEMBER_DRIFT:${member.name}`);
      } catch { issues.push(`MEMBER_INVALID:${member.name}`); }
    }
    for (const resource of index.resources) {
      try {
        const resourcePath = join(plan.target.collection_root, resource.relative_path);
        const stat = lstatSync(resourcePath);
        if (stat.isDirectory() && (stat.mode & 0o777) !== 0o755) issues.push(`RESOURCE_ROOT_MODE_DRIFT:${resource.relative_path}`);
        if (resourceDigest(resourcePath, { deployed: true }) !== resource.tree_digest) issues.push(`RESOURCE_DRIFT:${resource.relative_path}`);
      } catch { issues.push(`RESOURCE_MISSING_OR_INVALID:${resource.relative_path}`); }
    }
    if (plan.target.exposure.type === 'gateway') {
      const locatorPath = join(plan.target.collection_root, plan.target.exposure.name, locatorFilename(plan));
      try { if (sha256(readFileSync(locatorPath)) !== index.exposure.locator_digest || canonicalJson(readJson(locatorPath, 'invalid_locator')) !== canonicalJson(runtimeLocator(plan, paths))) issues.push('LOCATOR_DRIFT'); } catch { issues.push('LOCATOR_MISSING_OR_INVALID'); }
    }
  }
  if (plan.target.exposure.global_projection !== null && !exactSymlink(plan.target.exposure.global_projection, plan.target.exposure.global_raw_target)) issues.push('GLOBAL_EXPOSURE_DRIFT');
  for (const root of plan.agent_roots) {
    // 宿主被卸载后，其根目录不再是当前暴露面；不要为了满足历史计划
    // 而把整个 Agent 目录重新创建出来。若根再次出现，status 会重新要求暴露。
    if (lstatExists(root.root)
        && !exactSymlink(exposurePath(plan, root), plan.target.exposure.agent_raw_target)) {
      issues.push(`AGENT_EXPOSURE_DRIFT:${root.agent}`);
    }
  }
  const plannedRootPaths = new Set(plan.agent_roots.map(({ root }) => root));
  for (const observedRoot of projectionRoots(plan.home, join(plan.home, '.agents/skills'))) {
    const currentExposure = exposurePath(plan, observedRoot);
    if (lstatExists(currentExposure) && !plannedRootPaths.has(observedRoot.root)) issues.push(`UNPLANNED_AGENT_EXPOSURE:${observedRoot.agent}`);
  }
  for (const entry of plan.legacy) if (entry.path !== plan.target.collection_root && lstatExists(entry.path)) issues.push(`LEGACY_REAPPEARED:${entry.name}`);
  for (const entry of plan.legacy) {
    const quarantined = join(paths.quarantineOperationRoot, 'skills', entry.name);
    const recovered = join(paths.recoveryPreState, 'skills', entry.name);
    try { if (treeDigest(quarantined) !== entry.tree_digest) issues.push(`QUARANTINE_DRIFT:${entry.name}`); } catch { issues.push(`QUARANTINE_MISSING_OR_INVALID:${entry.name}`); }
    try { if (treeDigest(recovered) !== entry.tree_digest) issues.push(`RECOVERY_DRIFT:${entry.name}`); } catch { issues.push(`RECOVERY_MISSING_OR_INVALID:${entry.name}`); }
  }
  for (const link of plan.projections) {
    if (lstatExists(link.path) && link.path !== exposurePath(plan, { root: link.root })) issues.push(`LEGACY_PROJECTION_REAPPEARED:${link.agent}:${link.name}`);
    if (!exactSymlink(join(paths.quarantineOperationRoot, 'projections', link.agent, link.name), link.raw_target)) issues.push(`QUARANTINE_PROJECTION_DRIFT:${link.agent}:${link.name}`);
    if (!exactSymlink(join(paths.recoveryPreState, 'projections', link.agent, link.name), link.raw_target)) issues.push(`RECOVERY_PROJECTION_DRIFT:${link.agent}:${link.name}`);
  }
  if (plan.predecessor !== null) {
    const quarantinedCollection = join(paths.quarantineOperationRoot, 'predecessor', 'collection');
    const recoveredCollection = join(paths.recoveryPreState, 'predecessor', 'collection');
    try { if (treeDigest(quarantinedCollection) !== plan.predecessor.collection.tree_digest) issues.push('PREDECESSOR_QUARANTINE_DRIFT'); } catch { issues.push('PREDECESSOR_QUARANTINE_MISSING_OR_INVALID'); }
    try { if (treeDigest(recoveredCollection) !== plan.predecessor.collection.tree_digest) issues.push('PREDECESSOR_RECOVERY_DRIFT'); } catch { issues.push('PREDECESSOR_RECOVERY_MISSING_OR_INVALID'); }
    for (const exposure of plan.predecessor.exposures) {
      const label = exposure.scope === 'global' ? 'global' : exposure.agent;
      if (!exactSymlink(predecessorExposurePath(paths.quarantineOperationRoot, exposure), exposure.raw_target)) issues.push(`PREDECESSOR_QUARANTINE_EXPOSURE_DRIFT:${label}`);
      if (!exactSymlink(predecessorExposurePath(paths.recoveryPreState, exposure), exposure.raw_target)) issues.push(`PREDECESSOR_RECOVERY_EXPOSURE_DRIFT:${label}`);
    }
  }
  const currentScopedReceipt = scopedReceiptDigest(plan);
  if (currentScopedReceipt !== plan.receipt.entries_digest) issues.push('SCOPED_RECEIPT_DRIFT');
  let receiptState = 'unknown';
  try { receiptState = sha256(readFileSync(plan.receipt.path)) === plan.receipt.digest ? 'superseded' : currentScopedReceipt === plan.receipt.entries_digest ? 'unrelated_history_changed' : 'drifted'; } catch {}
  const collisionExclusions = new Set([
    plan.target.collection_root,
    ...(plan.target.exposure.global_projection === null ? [] : [plan.target.exposure.global_projection]),
    ...plan.agent_roots.map((root) => exposurePath(plan, root)),
  ]);
  const nameCollisions = inspectManagedNameCollisions({ collectionId: plan.collection_id, home: plan.home, excludePaths: collisionExclusions });
  const managementAttention = nameCollisions
    .filter(({ kind, target_status: targetStatus }) => kind === 'symlink' && targetStatus === 'missing')
    .map(({ name, path, relation }) => ({
      code: relation === 'same_repository_name' && spec.preservedNames.includes(name)
        ? 'STALE_SAME_REPOSITORY_PROJECTION' : 'BROKEN_PRESERVED_SYMLINK',
      path,
    }));
  if (plan.preserved_collisions !== undefined
      && canonicalJson(nameCollisions) !== canonicalJson(plan.preserved_collisions)) {
    managementAttention.unshift({ code: 'PRESERVED_COLLISION_SET_CHANGED', path: null });
  }
  return {
    schema_version: 'skills-refiner.collection.status.v2', collection_id: plan.collection_id,
    status: issues.length === 0 ? 'FILESYSTEM_READY' : 'DRIFTED', scope: 'filesystem', runtime_status: 'UNVERIFIED',
    observed_at: new Date().toISOString(), observer_version: 'skills-refiner.collection.observer.v2',
    operation_id: paths.id, plan_hash: plan.plan_hash, physical_collection_root: plan.target.collection_root,
    member_count: index?.members?.length ?? 0, external_receipt_state: receiptState,
    source: {
      provider: plan.source.provider, repository_id: plan.source.repository_id,
      resolved_revision: plan.source.revision, artifact_digest: plan.source.tree_digest,
      upstream_release: observeUpstreamVersion(paths.artifactRepo, spec.upstreamVersion),
    },
    lifecycle: { receipt_history: plan.receipt.history, plan_created_at: plan.created_at },
    name_collision_status: managementAttention.length > 0 ? 'ATTENTION_REQUIRED' : nameCollisions.length > 0 ? 'OBSERVED' : 'CLEAR',
    name_collisions: nameCollisions, management_attention: managementAttention,
    issues,
  };
}

function loadPlanFromControl(home, collectionId) {
  const activePath = join(home, '.agents/skill-control/collections', collectionId, 'active.json');
  if (!lstatExists(activePath)) return null;
  const active = readPrivateJson(home, activePath, 'invalid_active_generation').value;
  validateActiveEnvelope(active, collectionId);
  const path = join(home, '.agents/skill-control/collections', collectionId, 'operations', active.operation_id, 'plan.json');
  const plan = readPrivateJson(home, path, 'invalid_active_plan').value;
  validateManagedPlan(plan);
  validateActiveRecord(active, plan);
  return plan;
}

function validateActiveEnvelope(active, collectionId, code = 'invalid_active_generation') {
  const expectedKeys = ['activated_at', 'collection_id', 'operation_id', 'plan_hash', 'schema_version'];
  const canonicalTimestamp = typeof active?.activated_at === 'string'
    && !Number.isNaN(Date.parse(active.activated_at))
    && new Date(active.activated_at).toISOString() === active.activated_at;
  if (canonicalJson(Object.keys(active ?? {}).sort()) !== canonicalJson(expectedKeys)
      || active.schema_version !== 'skills-refiner.collection.active.v2'
      || active.collection_id !== collectionId
      || !new RegExp(`^${collectionId}-[0-9a-f]{12}$`, 'u').test(active.operation_id ?? '')
      || !/^sha256:[0-9a-f]{64}$/u.test(active.plan_hash ?? '')
      || !canonicalTimestamp) fail(code, `active record is invalid for ${collectionId}`);
}

function validateActiveRecord(active, plan, code = 'invalid_active_generation') {
  validateActiveEnvelope(active, plan.collection_id, code);
  if (active.plan_hash !== plan.plan_hash || active.operation_id !== operationId(plan)) {
    fail(code, `active generation does not match plan for ${plan.collection_id}`);
  }
}
function catalogEntry(home, collectionId) {
  const path = join(home, 'Library/Application Support/skills-refiner/catalog.json');
  const catalog = loadCatalog(home, path);
  return { path, catalog, value: catalog.collections[collectionId] ?? null };
}
function pendingManagedOperation(home, collectionId, { activeOperationId = null } = {}) {
  const operationsRoot = join(home, '.agents/skill-control/collections', collectionId, 'operations');
  let ids = [];
  try {
    ids = readdirSync(operationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${collectionId}-`))
      .map(({ name }) => name).sort();
  } catch { return null; }
  const pending = [];
  for (const id of ids) {
    const root = join(operationsRoot, id);
    try {
      const plan = readPrivateJson(home, join(root, 'plan.json'), 'invalid_operation_plan').value;
      const operation = readPrivateJson(home, join(root, 'operation.json'), 'invalid_operation').value;
      validateManagedPlan(plan);
      validateManagedOperation(operation);
      if (operation.operation_id !== id || operation.plan_hash !== plan.plan_hash || operationId(plan) !== id) fail('invalid_operation', 'operation identity is inconsistent');
      const interrupted = ![OPERATION_STATES.committed, OPERATION_STATES.rolledBack, OPERATION_STATES.restored].includes(operation.state);
      const committedWithoutActive = operation.state === OPERATION_STATES.committed && activeOperationId === null;
      if (interrupted || committedWithoutActive) pending.push({ plan, operation });
    } catch (error) {
      if (error instanceof ManagedCollectionError) throw error;
      fail('invalid_operation', `cannot inspect pending operation ${id}: ${error.message}`, 'recovery_required');
    }
  }
  if (pending.length > 1) fail('ambiguous_operations', `multiple nonterminal ${collectionId} operations require review`, 'recovery_required');
  return pending[0] ?? null;
}
function catalogIdentityIssues(home, plan, paths, catalog) {
  const entry = catalog.collections[plan.collection_id];
  if (!entry) return ['ORPHANED_CATALOG'];
  const issues = [];
  const keys = (value) => Object.keys(value ?? {}).sort();
  if (canonicalJson(keys(entry)) !== canonicalJson(['collection_id', 'collection_root', 'lifecycle', 'operation_id', 'plan_hash', 'recovery_plan', 'source'].sort())) issues.push('CATALOG_ENTRY_SHAPE_DRIFT');
  if (entry.collection_id !== plan.collection_id || entry.operation_id !== paths.id || entry.plan_hash !== plan.plan_hash
      || entry.collection_root !== plan.target.collection_root || entry.recovery_plan !== paths.recoveryPlanPath) issues.push('CATALOG_ENTRY_IDENTITY_DRIFT');
  const expectedSource = {
    provider: plan.source.provider, repository_id: plan.source.repository_id,
    resolved_revision: plan.source.revision, artifact_digest: plan.source.tree_digest,
  };
  if (canonicalJson(entry.source) !== canonicalJson(expectedSource)) issues.push('CATALOG_SOURCE_DRIFT');
  let lifecycleDrift = canonicalJson(keys(entry.lifecycle)) !== canonicalJson(['current_generation_activated_at', 'first_activated_at', 'plan_created_at', 'receipt_history'].sort())
      || canonicalJson(entry.lifecycle?.receipt_history) !== canonicalJson(plan.receipt.history)
      || entry.lifecycle?.plan_created_at !== plan.created_at
      || Number.isNaN(Date.parse(entry.lifecycle?.first_activated_at))
      || Number.isNaN(Date.parse(entry.lifecycle?.current_generation_activated_at));
  if (lstatExists(paths.activePath)) {
    const active = readPrivateJson(home, paths.activePath, 'invalid_active_generation').value;
    validateActiveRecord(active, plan);
    const expectedFirstActivatedAt = plan.predecessor?.catalog_entry.lifecycle.first_activated_at ?? active.activated_at;
    lifecycleDrift ||= entry.lifecycle?.first_activated_at !== expectedFirstActivatedAt
      || entry.lifecycle?.current_generation_activated_at !== active.activated_at;
  }
  if (lifecycleDrift) issues.push('CATALOG_LIFECYCLE_DRIFT');
  const viewPath = join(home, '.agents/skill-control/catalog.json');
  if (!lstatExists(viewPath)) issues.push('CATALOG_VIEW_MISSING');
  else {
    try { if (canonicalJson(readPrivateJson(home, viewPath, 'invalid_collection_catalog_view').value) !== canonicalJson(catalog)) issues.push('CATALOG_VIEW_DRIFT'); }
    catch { issues.push('CATALOG_VIEW_INVALID'); }
  }
  return issues;
}

export function statusManagedCollection({ collectionId, home }) {
  collectionSpec(collectionId);
  const controlPlan = loadPlanFromControl(home, collectionId);
  const catalog = catalogEntry(home, collectionId);
  if (controlPlan !== null) {
    const interrupted = pendingManagedOperation(home, collectionId, { activeOperationId: operationId(controlPlan) });
    if (interrupted !== null) {
      const interruptedResult = statusAgainstPlan(interrupted.plan, operationPaths(interrupted.plan));
      interruptedResult.status = 'RECOVERY_REQUIRED';
      if (operationId(interrupted.plan) !== operationId(controlPlan)) interruptedResult.issues.unshift(`INTERRUPTED_UPGRADE_FROM:${operationId(controlPlan)}`);
      return interruptedResult;
    }
  }
  if (controlPlan === null && catalog.value === null) {
    const pending = pendingManagedOperation(home, collectionId);
    if (pending !== null) {
      const pendingResult = statusAgainstPlan(pending.plan, operationPaths(pending.plan));
      pendingResult.status = 'RECOVERY_REQUIRED';
      return pendingResult;
    }
    return { schema_version: 'skills-refiner.collection.status.v2', collection_id: collectionId, status: 'UNMANAGED', scope: 'filesystem', runtime_status: 'UNVERIFIED', observed_at: new Date().toISOString(), observer_version: 'skills-refiner.collection.observer.v2', operation_id: null, plan_hash: null, physical_collection_root: join(home, '.agents/skills', collectionId), member_count: 0, external_receipt_state: 'unknown', source: null, lifecycle: null, issues: ['NO_ACTIVE_GENERATION'] };
  }
  let plan = controlPlan;
  let orphanedControl = false;
  let orphanedCatalog = false;
  if (plan === null) {
    orphanedControl = true;
    if (!new RegExp(`^${collectionId}-[0-9a-f]{12}$`, 'u').test(catalog.value.operation_id ?? '')) fail('catalog_conflict', 'catalog operation id is invalid', 'recovery_required');
    const canonicalRecoveryPlan = join(home, 'Library/Application Support/skills-refiner/recovery/operations', catalog.value.operation_id, 'plan.json');
    plan = readPrivateJson(home, canonicalRecoveryPlan, 'missing_recovery_plan').value;
    validateManagedPlan(plan);
  } else if (catalog.value === null) orphanedCatalog = true;
  else if (catalog.value.operation_id !== operationId(plan) || catalog.value.plan_hash !== plan.plan_hash) fail('catalog_conflict', 'catalog and control generation disagree', 'recovery_required');
  const result = statusAgainstPlan(plan, operationPaths(plan), { orphanedCatalog, orphanedControl });
  if (catalog.value !== null) result.issues.push(...catalogIdentityIssues(home, plan, operationPaths(plan), catalog.catalog));
  result.lifecycle = {
    ...result.lifecycle,
    first_activated_at: catalog.value?.lifecycle?.first_activated_at ?? null,
    current_generation_activated_at: catalog.value?.lifecycle?.current_generation_activated_at ?? null,
  };
  const repairLedger = inspectRepairLedger(plan, operationPaths(plan));
  result.issues.push(...repairLedger.issues);
  if (repairLedger.pending !== null) {
    result.issues.push(`REPAIR_ATTEMPT_PENDING:${repairLedger.pending.repair_id}:${repairLedger.pending.state}`);
    result.status = 'RECOVERY_REQUIRED';
  }
  if (result.issues.length > 0 && result.status === 'FILESYSTEM_READY') result.status = 'DRIFTED';
  if (result.issues.some((issue) => issue.startsWith('OPERATION_NOT_COMMITTED:'))) result.status = 'RECOVERY_REQUIRED';
  return result;
}

export function listManagedCollections({ home }) {
  const catalog = loadCatalog(home, join(home, 'Library/Application Support/skills-refiner/catalog.json'));
  return {
    schema_version: 'skills-refiner.collection.list.v1', observed_at: new Date().toISOString(),
    collections: managedCollectionIds().map((collectionId) => statusManagedCollection({ collectionId, home })),
    catalog_updated_at: catalog.updated_at,
  };
}

function loadOperation(home, id) {
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9a-f]{12})$/u.exec(id);
  if (!match) fail('invalid_operation_id', 'invalid managed collection operation id');
  const collectionId = managedCollectionIds().find((candidate) => id.startsWith(`${candidate}-`));
  if (!collectionId) fail('invalid_operation_id', 'unknown collection operation id');
  const root = join(home, '.agents/skill-control/collections', collectionId, 'operations', id);
  let plan;
  try { plan = readPrivateJson(home, join(root, 'plan.json'), 'invalid_operation_plan').value; } catch {
    plan = readPrivateJson(home, join(home, 'Library/Application Support/skills-refiner/recovery/operations', id, 'plan.json'), 'invalid_operation_plan').value;
  }
  validateManagedPlan(plan);
  if (operationId(plan) !== id) fail('invalid_operation_plan', 'operation id does not match plan');
  return plan;
}
function processIsAlive(pid) { if (!Number.isSafeInteger(pid) || pid < 1) return true; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
function isolateStaleLock(plan, paths) {
  if (!lstatExists(paths.lockPath)) return;
  const stat = lstatSync(paths.lockPath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail('unsafe_stale_lock', 'collection lock is not a real file', 'recovery_required');
  const snapshot = readPrivateJson(plan.home, paths.lockPath, 'invalid_stale_lock');
  const lock = snapshot.value;
  if (lock.operation_id !== paths.id || lock.plan_hash !== plan.plan_hash || processIsAlive(lock.pid)) fail('live_or_foreign_lock', 'collection lock is live or foreign', 'recovery_required');
  const identity = inspectCollectionEntry({ home: plan.home, path: paths.lockPath });
  if (identity.device !== snapshot.device || identity.inode !== snapshot.inode) fail('lock_identity_changed', 'collection lock changed during stale-lock validation', 'recovery_required');
  const auditRoot = join(plan.home, '.agents/skill-control/lock-audit');
  assertSafeManagedPath(plan.home, join(auditRoot, 'entry'));
  mkdirSync(auditRoot, { recursive: true, mode: 0o700 });
  moveCollectionEntryExclusive({
    home: plan.home, source: paths.lockPath,
    destination: join(auditRoot, `${paths.id}-${identity.device}-${identity.inode}.stale.json`),
    expectedManifest: identity.manifest_hash, expectedDevice: identity.device, expectedInode: identity.inode,
  });
}

export function recoverManagedOperation({ home, operationId: requestedId, confirmation }) {
  const plan = loadOperation(home, requestedId);
  const paths = operationPaths(plan);
  if (confirmation !== paths.id) fail('confirmation_mismatch', 'recover confirmation must equal operation id');
  const pendingRepair = pendingRepairAttempt(plan, paths);
  if (pendingRepair !== null) {
    fail(
      'pending_repair_requires_repair',
      `operation ${paths.id} has pending ${pendingRepair.repair_id}; rerun collection repair ${plan.collection_id}`,
      'recovery_required',
    );
  }
  isolateStaleLock(plan, paths);
  const lock = acquireLock(paths, plan);
  let rollbackStarted = false;
  try {
    const existingOperation = readPrivateJson(home, paths.operationPath, 'invalid_operation').value;
    validateManagedOperation(existingOperation);
    const lockedPendingRepair = pendingRepairAttempt(plan, paths);
    if (lockedPendingRepair !== null) {
      fail(
        'pending_repair_requires_repair',
        `operation ${paths.id} has pending ${lockedPendingRepair.repair_id}; rerun collection repair ${plan.collection_id}`,
        'recovery_required',
      );
    }
    if ([OPERATION_STATES.rolledBack, OPERATION_STATES.restored].includes(existingOperation.state)) {
      const current = statusManagedCollection({ collectionId: plan.collection_id, home });
      const exact = plan.predecessor === null
        ? current.status === 'UNMANAGED'
        : current.status === 'FILESYSTEM_READY' && current.operation_id === plan.predecessor.operation_id;
      if (!exact) fail('recover_retry_conflict', 'terminal operation no longer matches its restored pre-state', 'recovery_required');
      return { schema_version: 'skills-refiner.collection.recover.v2', collection_id: plan.collection_id, status: 'RESTORED_PRESTATE', operation_id: paths.id, mutation_occurred: false, recreated_from_independent_recovery: false };
    }
    if (existingOperation.state === OPERATION_STATES.committed) {
      const active = loadPlanFromControl(home, plan.collection_id);
      if (active === null || active.plan_hash !== plan.plan_hash || operationId(active) !== paths.id) {
        fail('foreign_or_superseded_operation', 'recover refuses a committed generation that is not active');
      }
      const current = statusManagedCollection({ collectionId: plan.collection_id, home });
      if (current.status !== 'FILESYSTEM_READY' || current.operation_id !== paths.id) {
        fail('committed_operation_drift', `recover refuses drifted committed state: ${current.issues.join(', ')}`);
      }
      return { schema_version: 'skills-refiner.collection.recover.v2', collection_id: plan.collection_id, status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: false, recreated_from_independent_recovery: false };
    }
    if (existingOperation.state === OPERATION_STATES.repairing) {
      fail('legacy_repair_requires_review', 'legacy REPAIRING state cannot use installation recovery', 'recovery_required');
    }
    rollbackStarted = true;
    const result = rollback(plan, paths);
    if (lstatExists(paths.stageRoot)) rmSync(paths.stageRoot, { recursive: true, force: true });
    return { schema_version: 'skills-refiner.collection.recover.v2', collection_id: plan.collection_id, status: 'RESTORED_PRESTATE', operation_id: paths.id, mutation_occurred: true, recreated_from_independent_recovery: result.recreated };
  } catch (error) {
    if (rollbackStarted) {
      try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: error.code ?? 'recover_failed' }); } catch {}
    }
    throw error;
  } finally { releaseLock(paths, lock); }
}

function repairStatusAgainstPlan(plan, paths, { ownedRepairStageId = null } = {}) {
  const catalog = catalogEntry(plan.home, plan.collection_id);
  const result = statusAgainstPlan(plan, paths, { orphanedCatalog: catalog.value === null });
  if (catalog.value !== null) result.issues.push(...catalogIdentityIssues(plan.home, plan, paths, catalog.catalog));
  result.issues.push(...inspectRepairLedger(plan, paths).issues.filter(
    (issue) => issue !== `ORPHAN_REPAIR_STAGE:${ownedRepairStageId}`,
  ));
  if (result.issues.length > 0 && result.status === 'FILESYSTEM_READY') result.status = 'DRIFTED';
  return result;
}

function deployedCollectionRepairIssue(issue) {
  return [
    'COLLECTION_ROOT_MISSING', 'COLLECTION_ROOT_NOT_REAL_DIRECTORY', 'COLLECTION_ROOT_MODE_DRIFT',
    'COLLECTION_ROOT_HAS_SKILL_MD', 'INDEX_MISSING_OR_INVALID', 'INDEX_IDENTITY_DRIFT',
    'LOCATOR_MISSING_OR_INVALID', 'LOCATOR_DRIFT',
  ].includes(issue)
    || issue.startsWith('MISSING_COLLECTION_ENTRY:')
    || issue.startsWith('UNEXPECTED_COLLECTION_ENTRY:') || issue.startsWith('MEMBER_INVALID:')
    || issue.startsWith('MEMBER_DRIFT:') || issue.startsWith('MEMBER_ROOT_MODE_DRIFT:')
    || issue.startsWith('RESOURCE_MISSING_OR_INVALID:') || issue.startsWith('RESOURCE_DRIFT:')
    || issue.startsWith('RESOURCE_ROOT_MODE_DRIFT:');
}

function assessRepairStatus(status) {
  const replaceCollection = status.issues.some(deployedCollectionRepairIssue);
  const allowed = status.issues.every((issue) => issue.startsWith('MISSING_COLLECTION_ENTRY:')
    || issue.startsWith('AGENT_EXPOSURE_DRIFT:') || issue === 'GLOBAL_EXPOSURE_DRIFT'
    || issue.startsWith('REPAIR_STAGE_RESIDUE:')
    || ['ORPHANED_CATALOG', 'CATALOG_VIEW_MISSING', 'CATALOG_VIEW_DRIFT', 'CATALOG_VIEW_INVALID'].includes(issue)
    || (replaceCollection && deployedCollectionRepairIssue(issue)));
  return {
    replaceCollection, allowed,
    missingEntries: status.issues.filter((issue) => issue.startsWith('MISSING_COLLECTION_ENTRY:')),
  };
}

function assertTrustedRepairArtifact(plan, paths) {
  try {
    const stat = lstatSync(paths.artifactRepo);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o500) !== 0o500
        || (stat.mode & 0o022) !== 0 || realpathSync(paths.artifactRepo) !== paths.artifactRepo
        || lstatExists(join(paths.artifactRepo, '.git'))
        || treeDigest(paths.artifactRepo) !== plan.source.tree_digest) {
      fail('repair_artifact_untrusted', 'repair artifact identity is not exact', 'recovery_required');
    }
  } catch (error) {
    if (error instanceof ManagedCollectionError) throw error;
    fail('repair_artifact_untrusted', `cannot verify repair artifact: ${error.message}`, 'recovery_required');
  }
}

function repairIdentityMatches(home, path, expected) {
  if (!lstatExists(path)) return false;
  try {
    const observed = inspectCollectionEntry({ home, path });
    return observed.entry_kind === expected.entry_kind && observed.device === expected.device
      && observed.inode === expected.inode && observed.manifest_hash === expected.manifest_hash
      && observed.security_metadata_hash === expected.security_metadata_hash;
  } catch { return false; }
}

function desiredCollectionIdentity(plan, attempt) {
  try {
    const stat = lstatSync(plan.target.collection_root);
    if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o755
        || deployedTreeDigest(plan.target.collection_root) !== attempt.desired_tree_digest) return null;
    const identity = inspectCollectionEntry({ home: plan.home, path: plan.target.collection_root });
    if (identity.entry_kind !== attempt.desired_identity.entry_kind
        || identity.security_metadata_hash !== attempt.desired_identity.security_metadata_hash) return null;
    const expectedNative = attempt.published_identity ?? attempt.stage_identity;
    if (identity.device !== expectedNative.device || identity.inode !== expectedNative.inode
        || identity.manifest_hash !== expectedNative.manifest_hash
        || identity.security_metadata_hash !== expectedNative.security_metadata_hash) return null;
    return identity;
  } catch { return null; }
}

function moveRepairEntryExact(plan, source, destination, identity) {
  moveCollectionEntryExclusive({
    home: plan.home, source, destination, expectedManifest: identity.manifest_hash,
    expectedDevice: identity.device, expectedInode: identity.inode,
  });
}

function stableRepairStageIdentity(plan, stageCollection, attempt) {
  const before = inspectCollectionEntry({ home: plan.home, path: stageCollection });
  const tree = deployedTreeDigest(stageCollection);
  const after = inspectCollectionEntry({ home: plan.home, path: stageCollection });
  if (tree !== attempt.desired_tree_digest
      || before.entry_kind !== attempt.desired_identity.entry_kind
      || before.security_metadata_hash !== attempt.desired_identity.security_metadata_hash
      || before.device !== attempt.stage_identity.device || before.inode !== attempt.stage_identity.inode
      || before.manifest_hash !== attempt.stage_identity.manifest_hash
      || before.security_metadata_hash !== attempt.stage_identity.security_metadata_hash
      || after.entry_kind !== before.entry_kind || after.device !== before.device
      || after.inode !== before.inode || after.manifest_hash !== before.manifest_hash
      || after.security_metadata_hash !== before.security_metadata_hash) {
    fail('repair_stage_drift', 'repair stage changed before native publication', 'recovery_required');
  }
  return after;
}

function cleanupRepairInvocation({
  plan, attempt, invocationRoot, stageCollection, stageOwned, finalize = false,
}) {
  if (invocationRoot === null) return;
  if (attempt === null) {
    if (stageOwned && lstatExists(invocationRoot)) rmSync(invocationRoot, { recursive: true, force: true });
    return;
  }
  if (!TERMINAL_REPAIR_STATES.has(attempt.state) && !finalize) return;
  if (lstatExists(stageCollection)) {
    if (!repairIdentityMatches(plan.home, stageCollection, attempt.stage_identity)) return;
    rmSync(stageCollection, { recursive: true, force: true });
  }
  try { rmdirSync(invocationRoot); } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
}

function cleanupTerminalRepairResidues(plan, paths) {
  const cleaned = [];
  for (const record of inspectRepairLedger(plan, paths).records) {
    if (!TERMINAL_REPAIR_STATES.has(record.state)
        || (!lstatExists(record.stage_path) && !lstatExists(dirname(record.stage_path)))) continue;
    cleanupRepairInvocation({
      plan, attempt: record, invocationRoot: dirname(record.stage_path),
      stageCollection: record.stage_path, stageOwned: false,
    });
    if (lstatExists(record.stage_path) || lstatExists(dirname(record.stage_path))) {
      fail('repair_stage_residue_conflict', `repair stage residue is not exact: ${record.repair_id}`, 'recovery_required');
    }
    cleaned.push(record.repair_id);
  }
  return cleaned;
}

function reconcileCollectionReplacement({ plan, paths, attempt, stageCollection, faultPhase, killPhase }) {
  const pre = attempt.pre_state;
  const quarantine = pre.quarantine_path;
  let targetIdentity = desiredCollectionIdentity(plan, attempt);
  let targetDesired = targetIdentity !== null;
  let quarantineExact = pre.present && repairIdentityMatches(plan.home, quarantine, pre);

  if (targetDesired) {
    if (pre.present && !quarantineExact) {
      fail('repair_prestate_missing', 'desired collection is active but the bound pre-state is not quarantined', 'recovery_required');
    }
    if (attempt.state !== REPAIR_STATES.published) {
      attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.published, {
        mutationOccurred: true, publishedIdentity: targetIdentity,
      });
    }
    return attempt;
  }

  stableRepairStageIdentity(plan, stageCollection, attempt);

  if (attempt.state === REPAIR_STATES.published) {
    fail('repair_poststate_drift', 'published repair collection changed before commit', 'recovery_required');
  }

  if (pre.present) {
    const targetExact = repairIdentityMatches(plan.home, plan.target.collection_root, pre);
    if (quarantineExact) {
      if (lstatExists(plan.target.collection_root)) {
        fail('repair_destination_conflict', 'repair target appeared after pre-state quarantine', 'recovery_required');
      }
    } else {
      if (!targetExact) {
        fail('repair_prestate_changed', 'active collection changed after repair observation', 'recovery_required');
      }
      try {
        moveRepairEntryExact(plan, plan.target.collection_root, quarantine, pre);
      } catch (error) {
        quarantineExact = repairIdentityMatches(plan.home, quarantine, pre);
        if (!quarantineExact || lstatExists(plan.target.collection_root)) throw error;
      }
      attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.quarantined, { mutationOccurred: true });
      injectFault('after_repair_quarantine', faultPhase, killPhase);
    }
  } else {
    if (lstatExists(plan.target.collection_root)) {
      fail('repair_destination_conflict', 'repair target appeared after missing pre-state observation', 'recovery_required');
    }
    if (attempt.state !== REPAIR_STATES.quarantined) {
      attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.quarantined);
      injectFault('after_repair_quarantine', faultPhase, killPhase);
    }
  }

  assertTrustedRepairArtifact(plan, paths);
  const stagedIdentity = stableRepairStageIdentity(plan, stageCollection, attempt);
  try {
    injectFault('before_repair_publish', faultPhase, killPhase);
    moveRepairEntryExact(plan, stageCollection, plan.target.collection_root, stagedIdentity);
  } catch (error) {
    targetIdentity = desiredCollectionIdentity(plan, attempt);
    targetDesired = targetIdentity !== null;
    if (!targetDesired) {
      if (pre.present && !lstatExists(plan.target.collection_root)
          && repairIdentityMatches(plan.home, quarantine, pre)) {
        try {
          moveRepairEntryExact(plan, quarantine, plan.target.collection_root, pre);
          attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.rolledBack, {
            mutationOccurred: true, errorCode: error.code ?? 'repair_publish_failed',
          });
        } catch (restoreError) {
          try {
            attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.recoveryRequired, {
              mutationOccurred: true, errorCode: restoreError.code ?? 'repair_compensation_failed',
            });
          } catch {}
          throw restoreError;
        }
      } else {
        try {
          attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.recoveryRequired, {
            mutationOccurred: true, errorCode: error.code ?? 'repair_publish_failed',
          });
        } catch {}
      }
      throw error;
    }
  }
  const publishedIdentity = inspectCollectionEntry({ home: plan.home, path: plan.target.collection_root });
  if (publishedIdentity.device !== stagedIdentity.device || publishedIdentity.inode !== stagedIdentity.inode
      || publishedIdentity.manifest_hash !== stagedIdentity.manifest_hash
      || publishedIdentity.security_metadata_hash !== stagedIdentity.security_metadata_hash) {
    fail('repair_publish_identity_changed', 'published collection is not the staged native object', 'recovery_required');
  }
  attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.published, {
    mutationOccurred: true, publishedIdentity,
  });
  injectFault('after_repair_publish', faultPhase, killPhase);
  return attempt;
}

export function repairManagedCollection({
  collectionId, home, confirmation, faultPhase = null, killPhase = null,
}) {
  const plan = loadPlanFromControl(home, collectionId);
  if (plan === null) fail('no_active_generation', `no active ${collectionId} generation exists`);
  const paths = operationPaths(plan);
  if (confirmation !== paths.id) fail('confirmation_mismatch', 'repair confirmation must equal operation id');
  isolateStaleLock(plan, paths);
  const lock = acquireLock(paths, plan);
  let invocationRoot = null;
  let stageCollection = null;
  let stageOwned = false;
  let attempt = null;
  const repaired = [];
  try {
    const active = loadPlanFromControl(home, collectionId);
    if (active === null || active.plan_hash !== plan.plan_hash || operationId(active) !== paths.id) {
      fail('active_generation_changed', 'active generation changed before repair', 'recovery_required');
    }
    attempt = pendingRepairAttempt(plan, paths);
    let before = repairStatusAgainstPlan(plan, paths);
    let assessment = assessRepairStatus(before);
    if (attempt === null && before.status === 'FILESYSTEM_READY') {
      return {
        schema_version: 'skills-refiner.collection.repair.v3', collection_id: collectionId,
        status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: false,
        repaired: [], repair_id: null, quarantined_pre_state: null,
        pre_state_manifest: null, post_state_manifest: null,
        artifact_digest: plan.source.tree_digest,
      };
    }
    if (!assessment.allowed) fail('repair_conflict', `repair refuses untrusted drift: ${before.issues.join(', ')}`);
    assertTrustedRepairArtifact(plan, paths);
    if (before.issues.some((issue) => issue.startsWith('REPAIR_STAGE_RESIDUE:'))) {
      for (const repairId of cleanupTerminalRepairResidues(plan, paths)) repaired.push(`repair_stage:${repairId}`);
      before = repairStatusAgainstPlan(plan, paths);
      assessment = assessRepairStatus(before);
      if (!assessment.allowed) fail('repair_conflict', `repair stage cleanup exposed untrusted drift: ${before.issues.join(', ')}`);
    }

    const needsStage = assessment.replaceCollection || assessment.missingEntries.length > 0;
    let repairId = null;
    if (attempt !== null) {
      stageCollection = attempt.stage_path;
      invocationRoot = dirname(stageCollection);
    } else if (needsStage) {
      repairId = assessment.replaceCollection ? `repair-${randomUUID()}` : null;
      invocationRoot = join(
        plan.home, '.agents/.skills-refiner-repair', paths.id,
        repairId ?? `invocation-${randomUUID()}`,
      );
      stageCollection = join(invocationRoot, plan.collection_id);
      assertSafeManagedPath(plan.home, stageCollection);
      if (lstatExists(invocationRoot)) fail('repair_stage_conflict', `repair invocation exists: ${invocationRoot}`);
      mkdirSync(invocationRoot, { recursive: true, mode: 0o700 });
      stageOwned = true;
      materializeCollection(plan, paths, stageCollection);
      assertTrustedRepairArtifact(plan, paths);
    }

    if (attempt === null && assessment.replaceCollection) {
      before = repairStatusAgainstPlan(plan, paths, { ownedRepairStageId: repairId });
      assessment = assessRepairStatus(before);
      if (!assessment.allowed || !assessment.replaceCollection) {
        if (before.status === 'FILESYSTEM_READY') {
          return {
            schema_version: 'skills-refiner.collection.repair.v3', collection_id: collectionId,
            status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: false,
            repaired: [], repair_id: null, quarantined_pre_state: null,
            pre_state_manifest: null, post_state_manifest: null,
            artifact_digest: plan.source.tree_digest,
          };
        }
        fail('repair_precondition_changed', `repair state changed during staging: ${before.issues.join(', ')}`, 'recovery_required');
      }
      const preState = lstatExists(plan.target.collection_root)
        ? inspectCollectionEntry({ home: plan.home, path: plan.target.collection_root }) : null;
      const desiredIdentity = inspectCollectionEntry({ home: plan.home, path: stageCollection });
      attempt = createRepairAttempt(plan, paths, {
        repairId,
        issues: before.issues, desiredTreeDigest: deployedTreeDigest(stageCollection),
        desiredIdentity, stagePath: stageCollection, stageIdentity: desiredIdentity, preState,
      });
      injectFault('after_repair_prepared', faultPhase, killPhase);
    }

    if (attempt !== null) {
      attempt = reconcileCollectionReplacement({
        plan, paths, attempt, stageCollection, faultPhase, killPhase,
      });
      repaired.push('collection');
    } else {
      for (const issue of assessment.missingEntries) {
        const name = issue.split(':')[1];
        const destination = join(plan.target.collection_root, name);
        if (lstatExists(destination)) fail('repair_conflict', `repair destination appeared: ${destination}`);
        const staged = join(stageCollection, name);
        const identity = inspectCollectionEntry({ home: plan.home, path: staged });
        moveRepairEntryExact(plan, staged, destination, identity);
        repaired.push(name);
      }
    }

    before = repairStatusAgainstPlan(plan, paths);
    assessment = assessRepairStatus(before);
    if (!assessment.allowed) fail('repair_conflict', `repair post-publish state is untrusted: ${before.issues.join(', ')}`);
    if (before.issues.includes('ORPHANED_CATALOG')) {
      rebuildCatalogFromControls(home);
      repaired.push('catalog');
    } else if (before.issues.some((issue) => ['CATALOG_VIEW_MISSING', 'CATALOG_VIEW_DRIFT', 'CATALOG_VIEW_INVALID'].includes(issue))) {
      const catalog = loadCatalog(plan.home, paths.catalogPath);
      durableJson(paths.catalogViewPath, catalog);
      repaired.push('catalog_view');
    }
    for (const issue of before.issues) {
      if (issue === 'GLOBAL_EXPOSURE_DRIFT') {
        if (lstatExists(plan.target.exposure.global_projection)) fail('repair_conflict', 'global exposure has conflicting identity');
        createCollectionSymlinkExclusive({ home: plan.home, path: plan.target.exposure.global_projection, rawTarget: plan.target.exposure.global_raw_target });
        repaired.push('global_exposure');
      } else if (issue.startsWith('AGENT_EXPOSURE_DRIFT:')) {
        const agent = issue.split(':')[1];
        const root = plan.agent_roots.find((entry) => entry.agent === agent);
        if (root === undefined) fail('repair_conflict', `repair cannot resolve agent exposure: ${agent}`);
        const path = exposurePath(plan, root);
        if (lstatExists(path)) fail('repair_conflict', `agent exposure has conflicting identity: ${path}`);
        createCollectionSymlinkExclusive({ home: plan.home, path, rawTarget: plan.target.exposure.agent_raw_target });
        repaired.push(`agent:${agent}`);
      }
    }

    const after = repairStatusAgainstPlan(plan, paths);
    if (after.status !== 'FILESYSTEM_READY') fail('repair_failed', after.issues.join(', '), 'recovery_required');
    if (attempt !== null) {
      injectFault('before_repair_commit', faultPhase, killPhase);
      cleanupRepairInvocation({
        plan, attempt, invocationRoot, stageCollection, stageOwned, finalize: true,
      });
      if (lstatExists(stageCollection) || lstatExists(invocationRoot)) {
        fail('repair_stage_cleanup_failed', `repair stage could not be removed: ${attempt.repair_id}`, 'recovery_required');
      }
      stageOwned = false;
      injectFault('after_repair_cleanup', faultPhase, killPhase);
      attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.committed, { mutationOccurred: true });
    }
    const reconciled = statusManagedCollection({ collectionId, home });
    if (reconciled.status !== 'FILESYSTEM_READY') fail('repair_failed', reconciled.issues.join(', '), 'recovery_required');
    return {
      schema_version: 'skills-refiner.collection.repair.v3', collection_id: collectionId,
      status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: repaired.length > 0,
      repaired, repair_id: attempt?.repair_id ?? null,
      quarantined_pre_state: attempt?.pre_state.quarantine_path ?? null,
      pre_state_manifest: attempt?.pre_state.manifest_hash ?? null,
      post_state_manifest: attempt?.published_identity?.manifest_hash ?? null,
      artifact_digest: plan.source.tree_digest,
    };
  } catch (error) {
    if (attempt !== null) {
      try {
        const current = readPrivateJson(
          plan.home, repairAttemptPaths(paths, attempt.repair_id).record, 'invalid_repair_attempt',
        ).value;
        validateRepairAttempt(current, plan, paths);
        attempt = current;
      } catch {}
    }
    if (attempt !== null && !TERMINAL_REPAIR_STATES.has(attempt.state)) {
      try {
        attempt = updateRepairAttempt(plan, paths, attempt, REPAIR_STATES.recoveryRequired, {
          mutationOccurred: attempt.mutation_occurred,
          errorCode: error.code ?? 'repair_failed',
        });
      } catch {}
    }
    throw error;
  } finally {
    cleanupRepairInvocation({ plan, attempt, invocationRoot, stageCollection, stageOwned });
    releaseLock(paths, lock);
  }
}

export function undoManagedOperation({ home, operationId: requestedId, confirmation }) {
  const plan = loadOperation(home, requestedId);
  const active = loadPlanFromControl(home, plan.collection_id);
  if (active === null || active.plan_hash !== plan.plan_hash || confirmation !== requestedId) fail('confirmation_mismatch', 'undo confirmation must equal active operation id');
  const paths = operationPaths(plan);
  const before = statusManagedCollection({ collectionId: plan.collection_id, home });
  if (before.status !== 'FILESYSTEM_READY') fail('undo_conflict', `undo requires FILESYSTEM_READY: ${before.issues.join(', ')}`);
  const lock = acquireLock(paths, plan);
  try {
    writeOperation(paths, plan, OPERATION_STATES.restoring, { mutationOccurred: true });
    const post = join(paths.quarantineOperationRoot, 'post-state/undo');
    for (const root of plan.agent_roots) moveCollectionEntryExclusive({ home: plan.home, source: exposurePath(plan, root), destination: join(post, 'agents', root.agent) });
    if (plan.target.exposure.global_projection !== null) moveCollectionEntryExclusive({ home: plan.home, source: plan.target.exposure.global_projection, destination: join(post, 'global-exposure') });
    moveCollectionEntryExclusive({ home: plan.home, source: plan.target.collection_root, destination: join(post, plan.collection_id) });
    if (plan.predecessor === null) {
      for (const entry of plan.legacy) moveCollectionEntryExclusive({ home: plan.home, source: join(paths.quarantineOperationRoot, 'skills', entry.name), destination: entry.path, expectedManifest: entry.native_manifest });
      for (const link of plan.projections) moveCollectionEntryExclusive({ home: plan.home, source: join(paths.quarantineOperationRoot, 'projections', link.agent, link.name), destination: link.path, expectedManifest: link.native_manifest });
      removeCatalogEntry(plan, paths);
      renameSync(paths.activePath, join(paths.operationRoot, 'active.restored.json'));
    } else {
      moveCollectionEntryExclusive({ home: plan.home, source: join(paths.quarantineOperationRoot, 'predecessor', 'collection'), destination: plan.predecessor.collection.path, expectedManifest: plan.predecessor.collection.native_manifest });
      for (const exposure of plan.predecessor.exposures) {
        moveCollectionEntryExclusive({ home: plan.home, source: predecessorExposurePath(paths.quarantineOperationRoot, exposure), destination: exposure.path, expectedManifest: exposure.native_manifest });
      }
      restorePredecessorControl(plan, paths);
    }
    writeOperation(paths, plan, OPERATION_STATES.restored, { mutationOccurred: true });
    return { schema_version: 'skills-refiner.collection.undo.v2', collection_id: plan.collection_id, status: 'RESTORED', operation_id: paths.id, mutation_occurred: true };
  } catch (error) {
    try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: error.code ?? 'undo_failed' }); } catch {}
    throw error;
  } finally { releaseLock(paths, lock); }
}
