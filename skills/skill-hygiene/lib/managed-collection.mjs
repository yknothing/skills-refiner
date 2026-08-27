import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync, copyFileSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from './cleanup-contract.mjs';
import { computeTreeDigest } from './collection-tree.mjs';
import {
  createCollectionSymlinkExclusive, ensureMacosHelper, inspectCollectionEntry,
  MacosAdapterError, moveCollectionEntryExclusive, unlinkCollectionSymlinkExact,
} from './cleanup-macos.mjs';
import { collectionSpec, managedCollectionIds } from './collection-specs.mjs';
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
export const MANAGED_APPLY_FAULT_PHASES = Object.freeze([
  'after_prepared', 'after_first_projection_quarantine', 'after_projection_quarantine',
  'after_first_legacy_quarantine', 'after_legacy_quarantine',
  'after_collection_publish', 'after_projection_publish', 'after_catalog_publish',
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
  for (const member of spec.members) {
    cpSync(join(sourceRoot, member.sourcePath), join(target, member.name), {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
    });
  }
  for (const sourcePath of spec.sharedPaths) {
    const destination = join(target, sourcePath);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
    cpSync(join(sourceRoot, sourcePath), destination, {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
    });
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
  const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...args) => spawnSync('/usr/bin/git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnvironment });
  const top = git('rev-parse', '--show-toplevel');
  const head = git('rev-parse', 'HEAD');
  const status = git('status', '--porcelain=v1', '--untracked-files=all');
  const remote = git('remote', 'get-url', 'origin');
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== root) fail('unverified_source', 'source root must be a Git worktree root');
  if (head.status !== 0 || head.stdout.trim() !== revision) fail('source_revision_mismatch', 'source HEAD does not match revision');
  if (status.status !== 0 || status.stdout.length !== 0) fail('source_worktree_dirty', 'source worktree must be clean');
  if (remote.status !== 0 || !approvedGithubOrigin(remote.stdout.trim(), spec)) fail('source_origin_mismatch', `source origin must be ${spec.repositoryId}`);
  const manifestPath = join(root, spec.manifestPath);
  if (!lstatExists(manifestPath) || !lstatSync(manifestPath).isFile()) fail('invalid_manifest', `manifest is missing: ${manifestPath}`);
  upstreamVersionEvidence(root, spec.upstreamVersion);
  for (const rejected of spec.rejectedMembers) {
    const rejectedRoot = join(root, rejected.sourcePath);
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
    const memberRoot = join(root, sourcePath);
    assertRealDirectory(memberRoot, `source member ${name}`);
    const metadata = parseFrontmatter(join(memberRoot, 'SKILL.md'));
    if (metadata.name !== name) fail('invalid_skill', `frontmatter name mismatch for ${name}`);
    if ([...metadata.description].length > 1024) fail('invalid_skill', `frontmatter description too long for ${name}`);
    return { name, source_path: sourcePath };
  });
  const references = referenceGraph(root, [
    ...spec.members.map(({ sourcePath }) => join(root, sourcePath)),
    ...spec.sharedPaths.map((sourcePath) => join(root, sourcePath)),
  ], { allowMissing: true, excludedPaths: new Set(spec.referenceExclusions) });
  const actions = packagingReferenceActions(root, spec, references);
  for (const sourcePath of spec.sharedPaths) {
    const resourceRoot = join(root, sourcePath);
    assertRealResource(resourceRoot, `shared resource ${sourcePath}`);
  }
  const previewRoot = realpathSync(mkdtempSync(join(tmpdir(), `skills-refiner-${collectionId}-preview-`)));
  let members;
  let resources;
  try {
    const preview = join(previewRoot, collectionId);
    copyPackagingInputs(root, preview, spec);
    applyPackagingReferenceActions(root, preview, spec, actions);
    referenceGraph(preview, [
      ...spec.members.map(({ name }) => join(preview, name)),
      ...spec.sharedPaths.map((sourcePath) => join(preview, sourcePath)),
    ], { excludedPaths: new Set(spec.referenceExclusions) });
    members = memberMetadata.map(({ name, source_path }) => ({
      name, source_path, tree_digest: deployedTreeDigest(join(preview, name)),
    }));
    resources = spec.sharedPaths.map((sourcePath) => ({
      source_path: sourcePath,
      relative_path: sourcePath,
      tree_digest: resourceDigest(join(preview, sourcePath), { deployed: true }),
    }));
  } finally {
    rmSync(previewRoot, { recursive: true, force: true });
  }
  return {
    provider: 'github', repository_id: spec.repositoryId, revision, root,
    tree_digest: treeDigest(root), manifest_digest: sha256(readFileSync(manifestPath)),
    reference_graph_digest: references.digest, members, resources,
  };
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
    const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    const git = (...args) => spawnSync('/usr/bin/git', ['-C', destination, ...args], { encoding: 'utf8', env: gitEnvironment });
    const top = git('rev-parse', '--show-toplevel');
    const head = git('rev-parse', 'HEAD');
    const status = git('status', '--porcelain=v1', '--untracked-files=all');
    const remote = git('remote', 'get-url', 'origin');
    if (top.status !== 0 || head.status !== 0 || status.status !== 0 || remote.status !== 0) return false;
    const topRoot = realpathSync(top.stdout.trim());
    return head.stdout.trim() === candidate.revision && status.stdout.length === 0
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
  const activeRecord = readJson(paths.activePath, 'invalid_active_generation');
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
  durableJson(paths.operationPath, record);
  return record;
}

function acquireLock(paths, plan) {
  assertSafeManagedPath(plan.home, paths.lockPath);
  mkdirSync(dirname(paths.lockPath), { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = openSync(paths.lockPath, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ operation_id: paths.id, plan_hash: plan.plan_hash, pid: process.pid })}\n`);
    fsyncSync(descriptor);
    return descriptor;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    fail('mutation_lock_unavailable', `collection mutation lock is unavailable: ${error.message}`);
  }
}
function releaseLock(paths, descriptor) {
  try { closeSync(descriptor); } finally {
    try { unlinkSync(paths.lockPath); } catch (error) { fail('mutation_lock_release_failed', error.message, 'recovery_required'); }
  }
}

function emptyCatalog() { return { schema_version: CATALOG_SCHEMA, updated_at: new Date(0).toISOString(), collections: {} }; }
function loadCatalog(path) {
  if (!lstatExists(path)) return emptyCatalog();
  const catalog = readJson(path, 'invalid_collection_catalog');
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
  const catalog = loadCatalog(paths.catalogPath);
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
    const operation = readJson(paths.operationPath, 'invalid_operation');
    const active = readJson(paths.activePath, 'invalid_active_generation');
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
  const active = readJson(paths.activePath, 'invalid_active_generation');
  if (active.collection_id !== plan.collection_id || active.operation_id !== paths.id || active.plan_hash !== plan.plan_hash) {
    fail('active_generation_conflict', 'active generation is not owned by the rolling-back operation', 'recovery_required');
  }
  unlinkSync(paths.activePath);
}
function removeCatalogEntry(plan, paths) {
  const catalog = loadCatalog(paths.catalogPath);
  const current = catalog.collections[plan.collection_id];
  if (!current || current.operation_id !== paths.id || current.plan_hash !== plan.plan_hash) fail('catalog_conflict', 'catalog active generation changed', 'recovery_required');
  delete catalog.collections[plan.collection_id];
  catalog.updated_at = new Date().toISOString();
  durableJson(paths.catalogPath, catalog);
  durableJson(paths.catalogViewPath, catalog);
}

function verifySourceAgainstPlan(plan) {
  const observed = inspectManagedSource({ collectionId: plan.collection_id, sourceRoot: plan.source.root, revision: plan.source.revision });
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
    if (treeDigest(paths.artifactRepo) !== plan.source.tree_digest) fail('artifact_conflict', 'existing artifact digest mismatch');
    return;
  }
  assertSafeManagedPath(plan.home, paths.artifactRepo);
  mkdirSync(dirname(paths.artifactRepo), { recursive: true, mode: 0o700 });
  cpSync(plan.source.root, paths.artifactRepo, {
    recursive: true, force: false, errorOnExist: true, preserveTimestamps: true,
    filter: (source) => relative(plan.source.root, source) !== '.git' && !relative(plan.source.root, source).startsWith(`.git${sep}`),
  });
  if (treeDigest(paths.artifactRepo) !== plan.source.tree_digest) fail('artifact_copy_failed', 'artifact copy changed identity');
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
      cpSync(join(paths.artifactRepo, source.source_path), gateway, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
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
      const catalog = loadCatalog(paths.catalogPath);
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
    const active = readJson(paths.activePath, 'invalid_active_generation');
    const currentOwned = active.operation_id === paths.id && active.plan_hash === plan.plan_hash;
    const predecessorOwned = canonicalJson(active) === canonicalJson(plan.predecessor.active_record);
    if (!currentOwned && !predecessorOwned) fail('active_generation_conflict', 'active generation changed during rollback', 'recovery_required');
  }
  durableJson(paths.activePath, plan.predecessor.active_record);
  const catalog = loadCatalog(paths.catalogPath);
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
  try {
    mkdirSync(dirname(paths.operationRoot), { recursive: true, mode: 0o700 });
    mkdirSync(paths.operationRoot, { recursive: false, mode: 0o700 });
    durableJson(paths.planPath, plan);
    writeOperation(paths, plan, OPERATION_STATES.planned);
    operationPublished = true;
    verifyPreconditions(plan);
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
    if (lstatExists(paths.stageRoot)) rmSync(paths.stageRoot, { recursive: true, force: true });
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
    const operation = readJson(paths.operationPath, 'invalid_operation');
    validateManagedOperation(operation);
    if (operation.operation_id !== paths.id || operation.plan_hash !== plan.plan_hash) issues.push('OPERATION_IDENTITY_DRIFT');
    if (requireCommitted && operation.state !== OPERATION_STATES.committed) issues.push(`OPERATION_NOT_COMMITTED:${operation.state}`);
  } catch { issues.push('OPERATION_MISSING_OR_INVALID'); }
  try { const stat = lstatSync(plan.target.collection_root); if (stat.isSymbolicLink() || !stat.isDirectory()) issues.push('COLLECTION_ROOT_NOT_REAL_DIRECTORY'); } catch { issues.push('COLLECTION_ROOT_MISSING'); }
  if (lstatExists(join(plan.target.collection_root, 'SKILL.md'))) issues.push('COLLECTION_ROOT_HAS_SKILL_MD');
  try {
    index = readJson(join(plan.target.collection_root, 'INDEX.json'), 'invalid_index');
    validateManagedIndex(index);
    expected = expectedIndex(plan, paths);
    if (canonicalJson(index) !== canonicalJson(expected)) issues.push('INDEX_IDENTITY_DRIFT');
  } catch { issues.push('INDEX_MISSING_OR_INVALID'); }
  try { if (treeDigest(paths.artifactRepo) !== plan.source.tree_digest) issues.push('ARTIFACT_IDENTITY_DRIFT'); } catch { issues.push('ARTIFACT_MISSING_OR_INVALID'); }
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
      try { if (deployedTreeDigest(path) !== expectedMembers.get(member.name)) issues.push(`MEMBER_DRIFT:${member.name}`); } catch { issues.push(`MEMBER_INVALID:${member.name}`); }
    }
    for (const resource of index.resources) {
      try { if (resourceDigest(join(plan.target.collection_root, resource.relative_path), { deployed: true }) !== resource.tree_digest) issues.push(`RESOURCE_DRIFT:${resource.relative_path}`); } catch { issues.push(`RESOURCE_MISSING_OR_INVALID:${resource.relative_path}`); }
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
  const active = readJson(activePath, 'invalid_active_generation');
  validateActiveEnvelope(active, collectionId);
  const path = join(home, '.agents/skill-control/collections', collectionId, 'operations', active.operation_id, 'plan.json');
  const plan = readJson(path, 'invalid_active_plan');
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
  const catalog = loadCatalog(path);
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
      const plan = readJson(join(root, 'plan.json'), 'invalid_operation_plan');
      const operation = readJson(join(root, 'operation.json'), 'invalid_operation');
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
    const active = readJson(paths.activePath, 'invalid_active_generation');
    validateActiveRecord(active, plan);
    const expectedFirstActivatedAt = plan.predecessor?.catalog_entry.lifecycle.first_activated_at ?? active.activated_at;
    lifecycleDrift ||= entry.lifecycle?.first_activated_at !== expectedFirstActivatedAt
      || entry.lifecycle?.current_generation_activated_at !== active.activated_at;
  }
  if (lifecycleDrift) issues.push('CATALOG_LIFECYCLE_DRIFT');
  const viewPath = join(home, '.agents/skill-control/catalog.json');
  if (!lstatExists(viewPath)) issues.push('CATALOG_VIEW_MISSING');
  else {
    try { if (canonicalJson(readJson(viewPath, 'invalid_collection_catalog_view')) !== canonicalJson(catalog)) issues.push('CATALOG_VIEW_DRIFT'); }
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
    plan = readJson(canonicalRecoveryPlan, 'missing_recovery_plan');
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
  if (result.issues.length > 0 && result.status === 'FILESYSTEM_READY') result.status = 'DRIFTED';
  if (result.issues.some((issue) => issue.startsWith('OPERATION_NOT_COMMITTED:'))) result.status = 'RECOVERY_REQUIRED';
  return result;
}

export function listManagedCollections({ home }) {
  const catalog = loadCatalog(join(home, 'Library/Application Support/skills-refiner/catalog.json'));
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
  try { plan = readJson(join(root, 'plan.json'), 'invalid_operation_plan'); } catch {
    plan = readJson(join(home, 'Library/Application Support/skills-refiner/recovery/operations', id, 'plan.json'), 'invalid_operation_plan');
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
  const lock = readJson(paths.lockPath, 'invalid_stale_lock');
  if (lock.operation_id !== paths.id || lock.plan_hash !== plan.plan_hash || processIsAlive(lock.pid)) fail('live_or_foreign_lock', 'collection lock is live or foreign', 'recovery_required');
  unlinkSync(paths.lockPath);
}

export function recoverManagedOperation({ home, operationId: requestedId, confirmation }) {
  const plan = loadOperation(home, requestedId);
  const paths = operationPaths(plan);
  if (confirmation !== paths.id) fail('confirmation_mismatch', 'recover confirmation must equal operation id');
  const existingOperation = readJson(paths.operationPath, 'invalid_operation');
  validateManagedOperation(existingOperation);
  if (existingOperation.state === OPERATION_STATES.rolledBack) {
    const current = statusManagedCollection({ collectionId: plan.collection_id, home });
    const exact = plan.predecessor === null
      ? current.status === 'UNMANAGED'
      : current.status === 'FILESYSTEM_READY' && current.operation_id === plan.predecessor.operation_id;
    if (!exact) fail('recover_retry_conflict', 'rolled-back operation no longer matches its restored pre-state', 'recovery_required');
    return { schema_version: 'skills-refiner.collection.recover.v2', collection_id: plan.collection_id, status: 'RESTORED_PRESTATE', operation_id: paths.id, mutation_occurred: false, recreated_from_independent_recovery: false };
  }
  isolateStaleLock(plan, paths);
  const lock = acquireLock(paths, plan);
  try {
    const result = rollback(plan, paths);
    if (lstatExists(paths.stageRoot)) rmSync(paths.stageRoot, { recursive: true, force: true });
    return { schema_version: 'skills-refiner.collection.recover.v2', collection_id: plan.collection_id, status: 'RESTORED_PRESTATE', operation_id: paths.id, mutation_occurred: true, recreated_from_independent_recovery: result.recreated };
  } catch (error) {
    try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: error.code ?? 'recover_failed' }); } catch {}
    throw error;
  } finally { releaseLock(paths, lock); }
}

export function repairManagedCollection({ collectionId, home, confirmation }) {
  const plan = loadPlanFromControl(home, collectionId);
  if (plan === null) fail('no_active_generation', `no active ${collectionId} generation exists`);
  const paths = operationPaths(plan);
  if (confirmation !== paths.id) fail('confirmation_mismatch', 'repair confirmation must equal operation id');
  const before = statusManagedCollection({ collectionId, home });
  if (before.status === 'FILESYSTEM_READY') return { schema_version: 'skills-refiner.collection.repair.v2', collection_id: collectionId, status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: false, repaired: [] };
  const missingResource = before.issues.some((issue) => issue.startsWith('RESOURCE_MISSING_OR_INVALID:'));
  const replaceCollection = before.issues.includes('COLLECTION_ROOT_MISSING')
    || before.issues.includes('INDEX_MISSING_OR_INVALID') || before.issues.includes('LOCATOR_MISSING_OR_INVALID')
    || missingResource;
  const allowed = before.issues.every((issue) => issue.startsWith('MISSING_COLLECTION_ENTRY:')
    || issue.startsWith('AGENT_EXPOSURE_DRIFT:') || issue === 'GLOBAL_EXPOSURE_DRIFT'
    || ['ORPHANED_CATALOG', 'CATALOG_VIEW_MISSING', 'CATALOG_VIEW_DRIFT', 'CATALOG_VIEW_INVALID'].includes(issue)
    || (replaceCollection && (['COLLECTION_ROOT_MISSING', 'INDEX_MISSING_OR_INVALID', 'INDEX_IDENTITY_DRIFT', 'LOCATOR_MISSING_OR_INVALID', 'LOCATOR_DRIFT'].includes(issue)
      || issue.startsWith('RESOURCE_MISSING_OR_INVALID:'))));
  if (!allowed) fail('repair_conflict', `repair refuses non-missing drift: ${before.issues.join(', ')}`);
  const lock = acquireLock(paths, plan);
  const repairRoot = join(plan.home, '.agents/.skills-refiner-repair', paths.id);
  const repaired = [];
  try {
    if (before.issues.includes('ORPHANED_CATALOG')) {
      rebuildCatalogFromControls(home);
      repaired.push('catalog');
    } else if (before.issues.some((issue) => ['CATALOG_VIEW_MISSING', 'CATALOG_VIEW_DRIFT', 'CATALOG_VIEW_INVALID'].includes(issue))) {
      const catalog = loadCatalog(paths.catalogPath);
      durableJson(paths.catalogViewPath, catalog);
      repaired.push('catalog_view');
    }
    writeOperation(paths, plan, OPERATION_STATES.repairing);
    const missingEntries = before.issues.filter((value) => value.startsWith('MISSING_COLLECTION_ENTRY:'));
    if (replaceCollection || missingEntries.length > 0) materializeCollection(plan, paths, join(repairRoot, plan.collection_id));
    if (replaceCollection) {
      if (lstatExists(plan.target.collection_root)) moveCollectionEntryExclusive({ home: plan.home, source: plan.target.collection_root, destination: join(paths.quarantineOperationRoot, 'repair-old', plan.collection_id) });
      moveCollectionEntryExclusive({ home: plan.home, source: join(repairRoot, plan.collection_id), destination: plan.target.collection_root });
      repaired.push('collection');
    } else {
      for (const issue of missingEntries) {
        const name = issue.split(':')[1];
        moveCollectionEntryExclusive({ home: plan.home, source: join(repairRoot, plan.collection_id, name), destination: join(plan.target.collection_root, name) });
        repaired.push(name);
      }
    }
    for (const issue of before.issues) {
      if (issue === 'GLOBAL_EXPOSURE_DRIFT') {
        if (lstatExists(plan.target.exposure.global_projection)) fail('repair_conflict', 'global exposure has conflicting identity');
        createCollectionSymlinkExclusive({ home: plan.home, path: plan.target.exposure.global_projection, rawTarget: plan.target.exposure.global_raw_target });
        repaired.push('global_exposure');
      } else if (issue.startsWith('AGENT_EXPOSURE_DRIFT:')) {
        const agent = issue.split(':')[1];
        const root = plan.agent_roots.find((entry) => entry.agent === agent);
        const path = exposurePath(plan, root);
        if (lstatExists(path)) fail('repair_conflict', `agent exposure has conflicting identity: ${path}`);
        createCollectionSymlinkExclusive({ home: plan.home, path, rawTarget: plan.target.exposure.agent_raw_target });
        repaired.push(`agent:${agent}`);
      }
    }
    if (lstatExists(repairRoot)) rmSync(repairRoot, { recursive: true, force: true });
    const after = statusAgainstPlan(plan, paths, { requireCommitted: false });
    if (after.status !== 'FILESYSTEM_READY') fail('repair_failed', after.issues.join(', '), 'recovery_required');
    writeOperation(paths, plan, OPERATION_STATES.committed, { mutationOccurred: repaired.length > 0 });
    const reconciled = statusManagedCollection({ collectionId, home });
    if (reconciled.status !== 'FILESYSTEM_READY') fail('repair_failed', reconciled.issues.join(', '), 'recovery_required');
    return { schema_version: 'skills-refiner.collection.repair.v2', collection_id: collectionId, status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: repaired.length > 0, repaired };
  } finally {
    if (lstatExists(repairRoot)) rmSync(repairRoot, { recursive: true, force: true });
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
