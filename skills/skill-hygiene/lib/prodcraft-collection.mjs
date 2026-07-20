import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCollectionPlan,
  COLLECTION_SCHEMAS,
  validateCollectionIndex,
  validateCollectionPlan,
  validateOperationRecord,
} from './collection-contract.mjs';
import { canonicalJson } from './cleanup-contract.mjs';
import {
  createCollectionSymlinkExclusive,
  ensureMacosHelper,
  inspectCollectionEntry,
  MacosAdapterError,
  moveCollectionEntryExclusive,
  unlinkCollectionSymlinkExact,
} from './cleanup-macos.mjs';

export const PUBLIC_MEMBER_NAMES = Object.freeze([
  'pc-prodcraft', 'pc-intake', 'pc-problem-framing', 'pc-user-research',
  'pc-requirements-engineering', 'pc-spec-writing', 'pc-domain-modeling',
  'pc-acceptance-criteria', 'pc-system-design', 'pc-data-modeling',
  'pc-security-design', 'pc-tech-selection', 'pc-api-design', 'pc-task-breakdown',
  'pc-estimation', 'pc-risk-assessment', 'pc-sprint-planning', 'pc-tdd',
  'pc-systematic-debugging', 'pc-task-execution', 'pc-feature-development',
  'pc-refactoring', 'pc-code-review', 'pc-receiving-code-review',
  'pc-testing-strategy', 'pc-e2e-scenario-design', 'pc-security-audit', 'pc-ci-cd',
  'pc-release-management', 'pc-deployment-strategy', 'pc-delivery-completion',
  'pc-observability', 'pc-verification-before-completion', 'pc-accessibility',
  'pc-documentation', 'pc-monitoring-observability', 'pc-incident-response',
  'pc-runbooks', 'pc-tech-debt-management', 'pc-retrospective',
]);

export const LEGACY_ONLY_NAMES = Object.freeze([
  'bug-history-retrieval', 'compliance', 'feasibility-study',
  'implementation-alignment-review', 'implementation-integrity-audit',
  'internationalization', 'market-analysis',
]);

const PUBLIC_SET = new Set(PUBLIC_MEMBER_NAMES);
const EXPECTED_LEGACY_COUNT = 46;
const RECEIPT_SOURCE = 'yknothing/prodcraft';
const RECEIPT_SOURCE_URL = 'https://github.com/yknothing/prodcraft.git';
const OPERATION_STATES = Object.freeze({
  planned: 'PLANNED',
  prepared: 'PREPARED',
  applying: 'APPLYING',
  committed: 'COMMITTED',
  rollingBack: 'ROLLING_BACK',
  rolledBack: 'ROLLED_BACK',
  repairing: 'REPAIRING',
  restoring: 'RESTORING',
  restored: 'RESTORED',
  recoveryRequired: 'RECOVERY_REQUIRED',
});
export const APPLY_FAULT_PHASES = Object.freeze([
  'after_prepared', 'after_projection_quarantine', 'after_legacy_quarantine',
  'after_collection_publish', 'after_projection_publish',
]);
const IGNORED_COLLECTION_METADATA = new Set(['.DS_Store']);

export class ProdcraftCollectionError extends Error {
  constructor(code, message, status = 'blocked') {
    super(message);
    this.name = 'ProdcraftCollectionError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 'blocked') {
  throw new ProdcraftCollectionError(code, message, status);
}

function sha256(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function controllerIdentity(home) {
  const files = [
    import.meta.url,
    new URL('./collection-cli.mjs', import.meta.url),
    new URL('./collection-contract.mjs', import.meta.url),
    new URL('./cleanup-macos.mjs', import.meta.url),
    new URL('../native/cleanup-macos-helper.c', import.meta.url),
    new URL('../bin/skills-refiner', import.meta.url),
  ].map((url) => fileURLToPath(url));
  const helper = ensureMacosHelper({ home });
  return {
    adapter: 'macos-native.v1',
    node_major: 24,
    bundle_digest: sha256(Buffer.from(canonicalJson(files.map((path) => ({ path: relative(dirname(fileURLToPath(import.meta.url)), path), digest: sha256(readFileSync(path)) }))))),
    helper_binary_digest: `sha256:${helper.binaryHash}`,
    helper_source_digest: `sha256:${helper.sourceHash}`,
    architecture: helper.architecture,
    compiler_path: helper.compilerPath,
    compiler_version: helper.compilerVersion,
  };
}

function readJson(path, code) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { fail(code, `cannot read JSON ${path}: ${error.message}`); }
}

function assertAbsoluteRealDirectory(path, label) {
  if (!isAbsolute(path)) fail('unsafe_path', `${label} must be absolute`);
  let stat;
  try { stat = lstatSync(path); } catch { fail('missing_path', `${label} is missing: ${path}`); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('unsafe_path', `${label} must be a real directory: ${path}`);
  if (realpathSync(path) !== path) fail('unsafe_path', `${label} must be canonical: ${path}`);
}

function walkTree(root, current, hash) {
  const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const path = join(current, entry.name);
    const rel = relative(root, path);
    if (rel === '.git' && entry.isDirectory()) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail('source_symlink', `tree contains symlink: ${path}`);
    if (stat.isDirectory()) {
      hash.update(`d\0${rel}\0${stat.mode & 0o777}\0`);
      walkTree(root, path, hash);
    } else if (stat.isFile()) {
      hash.update(`f\0${rel}\0${stat.mode & 0o777}\0${stat.size}\0`);
      hash.update(readFileSync(path));
      hash.update('\0');
    } else {
      fail('unsafe_tree_entry', `tree contains unsupported entry: ${path}`);
    }
  }
}

export function treeDigest(root) {
  assertAbsoluteRealDirectory(root, 'tree root');
  const hash = createHash('sha256');
  walkTree(root, root, hash);
  return `sha256:${hash.digest('hex')}`;
}

function frontmatter(path) {
  const text = readFileSync(path, 'utf8');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text);
  if (!match) fail('invalid_skill', `missing frontmatter: ${path}`);
  const name = /^name:\s*([^\s]+)\s*$/mu.exec(match[1])?.[1];
  const description = /^description:\s*(.+)\s*$/mu.exec(match[1])?.[1];
  if (!name) fail('invalid_skill', `missing frontmatter name: ${path}`);
  if (!description) fail('invalid_skill', `missing frontmatter description: ${path}`);
  return { name, description };
}

function referenceGraph(root) {
  const markdown = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('source_symlink', `reference graph contains symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) markdown.push(path);
    }
  };
  visit(root);
  const edges = [];
  const markdownTarget = /!?(?:\[[^\]]*\])\(([^)]+)\)/gu;
  for (const path of markdown) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(markdownTarget)) {
      let target = match[1].trim().replace(/^<|>$/gu, '').split(/\s+["']/u, 1)[0];
      if (target.length === 0 || /^(?:[a-z]+:|#)/iu.test(target)) continue;
      target = decodeURIComponent(target.split('#', 1)[0]);
      const resolved = resolve(dirname(path), target);
      if (!contained(root, resolved) || !lstatExists(resolved)) {
        fail('broken_reference', `unresolved local Markdown reference: ${path} -> ${target}`);
      }
      const stat = lstatSync(resolved);
      if (stat.isSymbolicLink()) fail('source_symlink', `reference target is a symlink: ${resolved}`);
      edges.push({ from: relative(root, path), to: relative(root, resolved) });
    }
  }
  return { edge_count: edges.length, digest: sha256(Buffer.from(canonicalJson(edges))) };
}

export function inspectProdcraftSource({ sourceRoot, revision }) {
  const root = resolve(sourceRoot);
  if (root !== sourceRoot) fail('unsafe_source_root', 'source root must be normalized and absolute');
  assertAbsoluteRealDirectory(root, 'source root');
  if (!/^[0-9a-f]{40}$/u.test(revision)) fail('invalid_revision', 'revision must be a full commit SHA');
  const registryPath = join(root, 'schemas/distribution/public-skill-registry.json');
  const indexPath = join(root, 'skills/.curated/index.json');
  const registryBytes = readFileSync(registryPath);
  const indexBytes = readFileSync(indexPath);
  const registry = readJson(registryPath, 'invalid_registry');
  const index = readJson(indexPath, 'invalid_curated_index');
  const registryNames = registry.public_skills?.map(({ name }) => name);
  const indexNames = index.skills?.map(({ name }) => name);
  if (!Array.isArray(registryNames) || !Array.isArray(indexNames)) fail('invalid_public_surface', 'registry/index skills arrays are required');
  const expected = [...PUBLIC_MEMBER_NAMES].sort();
  for (const names of [registryNames, indexNames]) {
    if (names.length !== 40 || new Set(names).size !== 40
        || canonicalJson([...names].sort()) !== canonicalJson(expected)) {
      fail('invalid_public_surface', 'public surface must equal the reviewed 40 pc-* packages');
    }
  }
  const curatedRoot = join(root, 'skills/.curated');
  const diskNames = readdirSync(curatedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
  if (canonicalJson(diskNames) !== canonicalJson(expected)) fail('invalid_public_surface', 'curated directories do not match registry');
  const members = expected.map((name) => {
    if (!PUBLIC_SET.has(name)) fail('invalid_public_surface', `unknown member ${name}`);
    const memberRoot = join(curatedRoot, name);
    assertAbsoluteRealDirectory(memberRoot, `member ${name}`);
    const metadata = frontmatter(join(memberRoot, 'SKILL.md'));
    if (metadata.name !== name) fail('invalid_skill', `frontmatter name mismatch for ${name}`);
    if (metadata.description.length > 1024) fail('invalid_skill', `frontmatter description too long for ${name}`);
    return { name, relative_path: `skills/.curated/${name}`, tree_digest: treeDigest(memberRoot) };
  });
  const references = referenceGraph(curatedRoot);
  const gitEnvironment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  const git = (...args) => spawnSync('/usr/bin/git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnvironment });
  const topLevel = git('rev-parse', '--show-toplevel');
  const head = git('rev-parse', 'HEAD');
  const status = git('status', '--porcelain=v1', '--untracked-files=all');
  const remote = git('remote', 'get-url', 'origin');
  if (topLevel.status !== 0 || realpathSync(topLevel.stdout.trim()) !== root) fail('unverified_source', 'source root must be a Git worktree root');
  if (head.status !== 0 || head.stdout.trim() !== revision) fail('source_revision_mismatch', 'source HEAD does not match the approved revision');
  if (status.status !== 0 || status.stdout.length !== 0) fail('source_worktree_dirty', 'source worktree must be clean');
  if (remote.status !== 0 || !['https://github.com/yknothing/prodcraft.git', 'git@github.com:yknothing/prodcraft.git'].includes(remote.stdout.trim())) {
    fail('source_origin_mismatch', 'source origin must be the approved yknothing/prodcraft repository');
  }
  return {
    provider: 'github',
    repository_id: RECEIPT_SOURCE,
    revision,
    root,
    tree_digest: treeDigest(root),
    registry_digest: sha256(registryBytes),
    curated_index_digest: sha256(indexBytes),
    reference_graph_digest: references.digest,
    members,
  };
}

function contained(home, path) {
  const rel = relative(home, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function observeProdcraftInstall({ home }) {
  const normalizedHome = resolve(home);
  if (normalizedHome !== home) fail('unsafe_home', 'HOME must be normalized and absolute');
  assertAbsoluteRealDirectory(normalizedHome, 'HOME');
  const receiptPath = join(home, '.agents/.skill-lock.json');
  if (!contained(home, receiptPath)) fail('unsafe_path', 'receipt path escaped HOME');
  const receiptBytes = readFileSync(receiptPath);
  const receiptData = readJson(receiptPath, 'invalid_receipt');
  if (receiptData.version !== 3) fail('unsupported_receipt', 'expected skill-lock receipt version 3');
  const entries = Object.entries(receiptData.skills ?? {})
    .filter(([, value]) => value?.source === RECEIPT_SOURCE)
    .map(([name, value]) => ({ name, receipt: value }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (entries.length !== EXPECTED_LEGACY_COUNT) fail('legacy_set_mismatch', `expected 46 ProdCraft receipt entries, observed ${entries.length}`);
  const skillsRoot = join(home, '.agents/skills');
  const conflicts = [];
  const legacy = entries.map(({ name, receipt }) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) fail('unsafe_legacy_name', `unsafe legacy name: ${name}`);
    if (receipt.sourceType !== 'github' || receipt.sourceUrl !== RECEIPT_SOURCE_URL
        || typeof receipt.skillPath !== 'string' || receipt.skillPath.includes('..')
        || !receipt.skillPath.startsWith('skills/') || !receipt.skillPath.endsWith(`/${name}/SKILL.md`)
        || !/^[0-9a-f]{40}$/u.test(receipt.skillFolderHash ?? '')
        || typeof receipt.installedAt !== 'string' || typeof receipt.updatedAt !== 'string') {
      fail('untrusted_receipt_entry', `receipt authority is incomplete for ${name}`);
    }
    const path = join(skillsRoot, name);
    let stat;
    try { stat = lstatSync(path); } catch { fail('missing_legacy', `receipt-owned legacy directory is missing: ${path}`); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('legacy_conflict', `legacy path is not a real directory: ${path}`);
    const native = nativeIdentity(home, path);
    return {
      name,
      path,
      kind: 'directory',
      tree_digest: treeDigest(path),
      native_manifest: native.manifest_hash,
      security_metadata_hash: native.security_metadata_hash,
      receipt_evidence_digest: sha256(Buffer.from(canonicalJson({ name, receipt }))),
      receipt: {
        source: receipt.source,
        source_type: receipt.sourceType,
        source_url: receipt.sourceUrl,
        skill_path: receipt.skillPath,
        skill_folder_hash: receipt.skillFolderHash,
        installed_at: receipt.installedAt,
        updated_at: receipt.updatedAt,
        resolved_revision: null,
      },
    };
  });
  const legacyByName = new Map(legacy.map((entry) => [entry.name, entry]));
  const candidateRoots = readdirSync(home, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.'))
    .map((entry) => ({ agent: entry.name.slice(1), root: join(home, entry.name, 'skills') }))
    .filter(({ root }) => root !== skillsRoot)
    .filter(({ root }) => {
      try { return lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(); } catch { return false; }
    });
  const projections = [];
  for (const { agent, root } of candidateRoots) {
    for (const legacyEntry of legacy) {
      const path = join(root, legacyEntry.name);
      let stat;
      try { stat = lstatSync(path); } catch { continue; }
      if (!stat.isSymbolicLink()) {
        conflicts.push({ path, reason: 'legacy projection name is not a symlink' });
        continue;
      }
      const rawTarget = readlinkSync(path);
      const native = nativeIdentity(home, path);
      let resolved;
      try { resolved = realpathSync(path); } catch { conflicts.push({ path, reason: 'broken legacy projection' }); continue; }
      if (resolved !== legacyEntry.path || !legacyByName.has(legacyEntry.name)) {
        conflicts.push({ path, reason: 'legacy projection target mismatch' });
        continue;
      }
      projections.push({
        agent,
        root,
        name: legacyEntry.name,
        path,
        kind: 'symlink',
        raw_target: rawTarget,
        target_digest: legacyEntry.tree_digest,
        native_manifest: native.manifest_hash,
        security_metadata_hash: native.security_metadata_hash,
      });
    }
  }
  const projectedRoots = new Set(projections.map(({ root }) => root));
  const agentRoots = candidateRoots
    .filter(({ root }) => projectedRoots.has(root))
    .map(({ agent, root }) => ({ agent, root, profile: 'gateway_projection', qualification: 'filesystem_only' }))
    .sort((a, b) => a.root.localeCompare(b.root, 'en'));
  return {
    home,
    receipt: { path: receiptPath, digest: sha256(receiptBytes), entries_digest: sha256(Buffer.from(canonicalJson(entries))) },
    receipt_entries: entries,
    legacy,
    projections: projections.sort((a, b) => a.path.localeCompare(b.path, 'en')),
    conflicts,
    agent_roots: agentRoots,
  };
}

export function compileProdcraftPlan({ home, sourceRoot, revision, now = new Date().toISOString() }) {
  const source = inspectProdcraftSource({ sourceRoot, revision });
  const installed = observeProdcraftInstall({ home });
  if (installed.conflicts.length > 0) fail('projection_conflict', 'legacy projection conflicts must be resolved before planning');
  const legacy = installed.legacy.map((entry) => {
    const successor = `pc-${entry.name}`;
    if (PUBLIC_SET.has(successor)) return { ...entry, disposition: 'replaced', successor };
    if (!LEGACY_ONLY_NAMES.includes(entry.name)) fail('unresolved_legacy', `no reviewed disposition for ${entry.name}`);
    return { ...entry, disposition: 'retired_by_owner', successor: null };
  });
  return buildCollectionPlan({
    collection_id: 'prodcraft',
    home,
    source,
    receipt: installed.receipt,
    legacy,
    projections: installed.projections,
    target: {
      collection_root: join(home, '.agents/skills/prodcraft'),
      gateway_projection: join(home, '.agents/skills/pc-prodcraft'),
      gateway_raw_target: 'prodcraft/pc-prodcraft',
      agent_gateway_raw_target: '../../.agents/skills/pc-prodcraft',
    },
    control: {
      root: join(home, '.agents/skill-control/collections/prodcraft'),
      quarantine_root: join(home, '.agents/skills-quarantine/collections'),
      recovery_root: join(home, 'Library/Application Support/skills-refiner/recovery'),
    },
    controller: controllerIdentity(home),
    agent_roots: installed.agent_roots,
    created_at: now,
  });
}

function operationId(plan) {
  return `prodcraft-${plan.plan_hash.slice(7, 19)}`;
}

function operationPaths(plan, id = operationId(plan)) {
  const operationRoot = join(plan.control.root, 'operations', id);
  const recoveryOperationRoot = join(plan.control.recovery_root, 'operations', id);
  const quarantineOperationRoot = join(plan.control.quarantine_root, id);
  return {
    id,
    operationRoot,
    operationPath: join(operationRoot, 'operation.json'),
    planPath: join(operationRoot, 'plan.json'),
    activePath: join(plan.control.root, 'active.json'),
    artifactRepo: join(plan.control.root, 'artifacts', plan.source.tree_digest.slice(7), 'repo'),
    recoveryOperationRoot,
    recoveryPreState: join(recoveryOperationRoot, 'pre-state'),
    quarantineOperationRoot,
    stageRoot: join(plan.home, '.agents/.skills-refiner-stage', id),
    stageCollection: join(plan.home, '.agents/.skills-refiner-stage', id, 'prodcraft'),
    lockPath: join(plan.home, '.agents/skill-control/collection-mutation.lock'),
  };
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
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function durableJson(path, value) {
  durableWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function assertSafeManagedPath(home, path) {
  if (!contained(home, path)) fail('unsafe_path', `managed path escaped HOME: ${path}`);
  let current = home;
  const rel = relative(home, path);
  for (const part of rel.split(sep).slice(0, -1)) {
    current = join(current, part);
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('unsafe_path', `managed path has unsafe parent: ${current}`);
  }
}

function writeOperation(paths, plan, state, { mutationOccurred = false, errorCode = null } = {}) {
  const record = {
    schema_version: COLLECTION_SCHEMAS.operation,
    collection_id: 'prodcraft',
    operation_id: paths.id,
    plan_hash: plan.plan_hash,
    state,
    updated_at: new Date().toISOString(),
    mutation_occurred: mutationOccurred,
    error_code: errorCode,
  };
  validateOperationRecord(record);
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

function verifySourceAgainstPlan(plan) {
  const observed = inspectProdcraftSource({ sourceRoot: plan.source.root, revision: plan.source.revision });
  if (canonicalJson(observed) !== canonicalJson(plan.source)) fail('source_drift', 'candidate source changed after planning');
}

function verifyControllerAgainstPlan(plan) {
  if (Number(process.versions.node.split('.')[0]) !== 24
      || canonicalJson(controllerIdentity(plan.home)) !== canonicalJson(plan.controller)) {
    fail('controller_drift', 'controller/native-helper identity changed after planning');
  }
}

function verifyInstalledFactsAgainstPlan(plan) {
  const installed = observeProdcraftInstall({ home: plan.home });
  if (installed.conflicts.length > 0) fail('projection_conflict', 'fresh installed-state observation contains conflicts');
  const legacy = installed.legacy.map((entry) => {
    const successor = `pc-${entry.name}`;
    if (PUBLIC_SET.has(successor)) return { ...entry, disposition: 'replaced', successor };
    if (!LEGACY_ONLY_NAMES.includes(entry.name)) fail('unresolved_legacy', `fresh observation has no disposition for ${entry.name}`);
    return { ...entry, disposition: 'retired_by_owner', successor: null };
  });
  const expected = {
    receipt: installed.receipt,
    legacy,
    projections: installed.projections,
    agent_roots: installed.agent_roots,
  };
  const planned = {
    receipt: plan.receipt,
    legacy: plan.legacy,
    projections: plan.projections,
    agent_roots: plan.agent_roots,
  };
  if (canonicalJson(expected) !== canonicalJson(planned)) fail('installed_facts_drift', 'plan does not match a fresh canonical installed-state observation');
}

function verifyPreconditions(plan) {
  validateCollectionPlan(plan);
  verifyControllerAgainstPlan(plan);
  verifySourceAgainstPlan(plan);
  verifyInstalledFactsAgainstPlan(plan);
  const receiptDigest = sha256(readFileSync(plan.receipt.path));
  if (receiptDigest !== plan.receipt.digest) fail('receipt_drift', 'external installer receipt changed after planning');
  for (const entry of plan.legacy) {
    let stat;
    try { stat = lstatSync(entry.path); } catch { fail('legacy_drift', `legacy entry disappeared: ${entry.path}`); }
    if (stat.isSymbolicLink() || !stat.isDirectory() || treeDigest(entry.path) !== entry.tree_digest) {
      fail('legacy_drift', `legacy entry identity changed: ${entry.path}`);
    }
    if (nativeManifest(plan.home, entry.path) !== entry.native_manifest) fail('legacy_metadata_drift', `legacy native manifest changed: ${entry.path}`);
  }
  for (const link of plan.projections) {
    let stat;
    try { stat = lstatSync(link.path); } catch { fail('projection_drift', `legacy projection disappeared: ${link.path}`); }
    if (!stat.isSymbolicLink() || readlinkSync(link.path) !== link.raw_target) fail('projection_drift', `legacy projection changed: ${link.path}`);
    let target;
    try { target = realpathSync(link.path); } catch { fail('projection_drift', `legacy projection broke: ${link.path}`); }
    if (treeDigest(target) !== link.target_digest) fail('projection_drift', `legacy projection target changed: ${link.path}`);
    if (nativeManifest(plan.home, link.path) !== link.native_manifest) fail('projection_metadata_drift', `legacy projection native manifest changed: ${link.path}`);
  }
  if (existsSync(plan.target.gateway_projection)) fail('target_conflict', `gateway projection already exists: ${plan.target.gateway_projection}`);
  for (const root of plan.agent_roots) {
    const target = join(root.root, 'pc-prodcraft');
    if (existsSync(target) || lstatExists(target)) fail('target_conflict', `agent gateway projection already exists: ${target}`);
  }
}

function lstatExists(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

function nativeManifest(home, path) {
  return nativeIdentity(home, path).manifest_hash;
}

function nativeIdentity(home, path) {
  return inspectCollectionEntry({ home, path });
}

function ensureArtifact(plan, paths) {
  if (lstatExists(paths.artifactRepo)) {
    if (treeDigest(paths.artifactRepo) !== plan.source.tree_digest) fail('artifact_conflict', 'existing artifact digest mismatch');
    return;
  }
  assertSafeManagedPath(plan.home, paths.artifactRepo);
  mkdirSync(dirname(paths.artifactRepo), { recursive: true, mode: 0o700 });
  cpSync(plan.source.root, paths.artifactRepo, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
    filter: (source) => relative(plan.source.root, source) !== '.git'
      && !relative(plan.source.root, source).startsWith(`.git${sep}`),
  });
  if (treeDigest(paths.artifactRepo) !== plan.source.tree_digest) fail('artifact_copy_failed', 'artifact copy did not preserve source identity');
}

function runtimeLocator(plan, paths) {
  return {
    schema_version: 'prodcraft-runtime-locator.v1',
    skill_name: 'pc-prodcraft',
    install_surface: 'global',
    global_skill_path: join(plan.target.collection_root, 'pc-prodcraft'),
    canonical_repo_root: paths.artifactRepo,
    gateway_path: join(paths.artifactRepo, 'skills/_gateway.md'),
    source_skills_root: join(paths.artifactRepo, 'skills'),
    workflow_root: join(paths.artifactRepo, 'workflows'),
    curated_sibling_root_hint: plan.target.collection_root,
    singleton_gateway_directory_is_expected: true,
  };
}

function expectedMaterializedMembers(plan, paths) {
  const members = plan.source.members.map(({ name, tree_digest }) => ({
    name,
    relative_path: name,
    tree_digest,
  }));
  const gateway = members.find(({ name }) => name === 'pc-prodcraft');
  const temporaryRoot = realpathSync(mkdtempSync(join(tmpdir(), 'skills-refiner-prodcraft-gateway-')));
  try {
    const temporaryGateway = join(temporaryRoot, 'pc-prodcraft');
    cpSync(join(paths.artifactRepo, 'skills/.curated/pc-prodcraft'), temporaryGateway, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
    durableJson(join(temporaryGateway, 'prodcraft-runtime.json'), runtimeLocator(plan, paths));
    gateway.tree_digest = treeDigest(temporaryGateway);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  return members;
}

function expectedCollectionIndex(plan, paths, members = expectedMaterializedMembers(plan, paths)) {
  const locator = runtimeLocator(plan, paths);
  return {
    schema_version: COLLECTION_SCHEMAS.index,
    collection_id: 'prodcraft',
    source: {
      provider: plan.source.provider,
      repository_id: plan.source.repository_id,
      resolved_revision: plan.source.revision,
      tree_digest: plan.source.tree_digest,
    },
    artifact_digest: plan.source.tree_digest,
    public_registry_digest: plan.source.registry_digest,
    members,
    gateway: { name: 'pc-prodcraft', locator_digest: sha256(jsonBytes(locator)) },
    receipt_snapshot_digest: plan.receipt.digest,
    profile_matrix_digest: sha256(Buffer.from(canonicalJson(plan.agent_roots))),
    plan_created_at: plan.created_at,
    operation_id: paths.id,
  };
}

function materializeCollection(plan, paths, target = paths.stageCollection) {
  assertSafeManagedPath(plan.home, target);
  if (lstatExists(target)) fail('stage_conflict', `staging target already exists: ${target}`);
  mkdirSync(target, { recursive: true, mode: 0o755 });
  for (const member of plan.source.members) {
    cpSync(join(paths.artifactRepo, member.relative_path), join(target, member.name), {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
  }
  const locatorPath = join(target, 'pc-prodcraft/prodcraft-runtime.json');
  durableJson(locatorPath, runtimeLocator(plan, paths));
  const members = plan.source.members.map(({ name }) => ({
    name,
    relative_path: name,
    tree_digest: treeDigest(join(target, name)),
  }));
  const index = expectedCollectionIndex(plan, paths, members);
  validateCollectionIndex(index);
  durableJson(join(target, 'INDEX.json'), index);
  return index;
}

function copyRecovery(plan, paths) {
  if (lstatExists(paths.recoveryOperationRoot)) fail('recovery_conflict', `recovery operation already exists: ${paths.recoveryOperationRoot}`);
  assertSafeManagedPath(plan.home, paths.recoveryOperationRoot);
  const recoverySkills = join(paths.recoveryPreState, 'skills');
  mkdirSync(recoverySkills, { recursive: true, mode: 0o700 });
  for (const entry of plan.legacy) {
    const target = join(recoverySkills, entry.name);
    const copied = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', entry.path, target], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
    });
    if (copied.status !== 0) fail('recovery_copy_failed', `ditto failed for ${entry.name}: ${copied.stderr.trim()}`);
    if (treeDigest(target) !== entry.tree_digest
        || nativeIdentity(plan.home, target).security_metadata_hash !== entry.security_metadata_hash) {
      fail('recovery_copy_failed', `recovery copy mismatch for ${entry.name}`);
    }
  }
  copyFileSync(plan.receipt.path, join(paths.recoveryPreState, 'skill-lock.json'));
  if (sha256(readFileSync(join(paths.recoveryPreState, 'skill-lock.json'))) !== plan.receipt.digest) fail('recovery_copy_failed', 'receipt recovery copy mismatch');
  durableJson(join(paths.recoveryPreState, 'projections.json'), plan.projections);
  for (const link of plan.projections) {
    const target = join(paths.recoveryPreState, 'projections', link.agent, link.name);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const copied = spawnSync('/bin/cp', ['-a', link.path, target], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
    });
    if (copied.status !== 0 || !exactManagedSymlink(target, link.raw_target)
        || nativeIdentity(plan.home, target).security_metadata_hash !== link.security_metadata_hash) {
      fail('recovery_copy_failed', `projection recovery copy mismatch: ${link.path}`);
    }
  }
  durableJson(join(paths.recoveryOperationRoot, 'manifest.json'), {
    schema_version: 'skills-refiner.collection.recovery-manifest.v1',
    operation_id: paths.id,
    plan_hash: plan.plan_hash,
    receipt_digest: plan.receipt.digest,
    legacy: plan.legacy.map(({ name, tree_digest, native_manifest, security_metadata_hash }) => ({ name, tree_digest, native_manifest, security_metadata_hash })),
    projections_digest: sha256(Buffer.from(canonicalJson(plan.projections))),
  });
}

function exactManagedSymlink(path, rawTarget) {
  try { return lstatSync(path).isSymbolicLink() && readlinkSync(path) === rawTarget; } catch { return false; }
}

function manifestMatches(home, path, expected) {
  try { return nativeManifest(home, path) === expected; } catch { return false; }
}

function restoreLegacyFromRecovery(plan, paths, entry) {
  const source = join(paths.recoveryPreState, 'skills', entry.name);
  if (treeDigest(source) !== entry.tree_digest
      || nativeIdentity(plan.home, source).security_metadata_hash !== entry.security_metadata_hash) {
    fail('recovery_source_drift', `independent recovery source changed: ${entry.name}`, 'recovery_required');
  }
  const stage = join(paths.quarantineOperationRoot, 'recovery-restore/skills', entry.name);
  if (lstatExists(stage)) fail('recovery_stage_conflict', `recovery stage exists: ${entry.name}`, 'recovery_required');
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  const copied = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', source, stage], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
  });
  if (copied.status !== 0) fail('recovery_restore_copy_failed', `cannot copy independent recovery for ${entry.name}`, 'recovery_required');
  if (treeDigest(stage) !== entry.tree_digest
      || nativeIdentity(plan.home, stage).security_metadata_hash !== entry.security_metadata_hash) {
    fail('recovery_restore_copy_failed', `cannot stage independent recovery for ${entry.name}`, 'recovery_required');
  }
  moveCollectionEntryExclusive({ home: plan.home, source: stage, destination: entry.path });
}

function restoreProjectionFromRecovery(plan, paths, link) {
  const source = join(paths.recoveryPreState, 'projections', link.agent, link.name);
  if (!exactManagedSymlink(source, link.raw_target)
      || nativeIdentity(plan.home, source).security_metadata_hash !== link.security_metadata_hash) {
    fail('recovery_source_drift', `independent projection recovery changed: ${link.path}`, 'recovery_required');
  }
  const stage = join(paths.quarantineOperationRoot, 'recovery-restore/projections', link.agent, link.name);
  if (lstatExists(stage)) fail('recovery_stage_conflict', `projection recovery stage exists: ${link.path}`, 'recovery_required');
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  const copied = spawnSync('/bin/cp', ['-a', source, stage], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
  });
  if (copied.status !== 0 || !exactManagedSymlink(stage, link.raw_target)
      || nativeIdentity(plan.home, stage).security_metadata_hash !== link.security_metadata_hash) {
    fail('recovery_restore_copy_failed', `cannot stage independent projection recovery: ${link.path}`, 'recovery_required');
  }
  moveCollectionEntryExclusive({ home: plan.home, source: stage, destination: link.path });
}

function rollbackApply(plan, paths) {
  let recreatedFromRecovery = false;
  writeOperation(paths, plan, OPERATION_STATES.rollingBack, { mutationOccurred: true });
  for (const root of plan.agent_roots) {
    const gateway = join(root.root, 'pc-prodcraft');
    if (lstatExists(gateway)) {
      if (!exactManagedSymlink(gateway, plan.target.agent_gateway_raw_target)) fail('rollback_conflict', `agent gateway changed during rollback: ${gateway}`, 'recovery_required');
      unlinkCollectionSymlinkExact({ home: plan.home, path: gateway, rawTarget: plan.target.agent_gateway_raw_target });
    }
  }
  if (lstatExists(plan.target.gateway_projection)) {
    if (!exactManagedSymlink(plan.target.gateway_projection, plan.target.gateway_raw_target)) fail('rollback_conflict', 'gateway projection changed during rollback', 'recovery_required');
    unlinkCollectionSymlinkExact({ home: plan.home, path: plan.target.gateway_projection, rawTarget: plan.target.gateway_raw_target });
  }
  if (lstatExists(plan.target.collection_root)) {
    const indexPath = join(plan.target.collection_root, 'INDEX.json');
    if (lstatExists(indexPath)) {
      const index = readJson(indexPath, 'rollback_conflict');
      if (index.operation_id !== paths.id) fail('rollback_conflict', 'published collection ownership changed', 'recovery_required');
      const postState = join(paths.quarantineOperationRoot, 'post-state/prodcraft');
      moveCollectionEntryExclusive({ home: plan.home, source: plan.target.collection_root, destination: postState });
    } else {
      const legacyGateway = plan.legacy.find(({ name }) => name === 'prodcraft');
      if (!legacyGateway || treeDigest(plan.target.collection_root) !== legacyGateway.tree_digest) {
        fail('rollback_conflict', 'collection path is neither legacy nor managed post-state', 'recovery_required');
      }
    }
  }
  for (const entry of plan.legacy) {
    const quarantined = join(paths.quarantineOperationRoot, 'skills', entry.name);
    if (!lstatExists(entry.path)) {
      if (lstatExists(quarantined) && manifestMatches(plan.home, quarantined, entry.native_manifest)) {
        moveCollectionEntryExclusive({ home: plan.home, source: quarantined, destination: entry.path, expectedManifest: entry.native_manifest });
      } else {
        restoreLegacyFromRecovery(plan, paths, entry);
        recreatedFromRecovery = true;
      }
    }
  }
  for (const link of plan.projections) {
    const quarantined = join(paths.quarantineOperationRoot, 'projections', link.agent, link.name);
    if (!lstatExists(link.path)) {
      if (lstatExists(quarantined) && manifestMatches(plan.home, quarantined, link.native_manifest)) {
        moveCollectionEntryExclusive({ home: plan.home, source: quarantined, destination: link.path, expectedManifest: link.native_manifest });
      } else {
        restoreProjectionFromRecovery(plan, paths, link);
        recreatedFromRecovery = true;
      }
    }
  }
  verifyExactPreState(plan, { allowRecreatedIdentity: recreatedFromRecovery });
  writeOperation(paths, plan, OPERATION_STATES.rolledBack, {
    mutationOccurred: true,
    errorCode: recreatedFromRecovery ? 'restored_from_independent_recovery' : null,
  });
  return { recreatedFromRecovery };
}

function verifyExactPreState(plan, { allowRecreatedIdentity = false } = {}) {
  if (sha256(readFileSync(plan.receipt.path)) !== plan.receipt.digest) fail('prestate_receipt_drift', 'receipt changed during recovery', 'recovery_required');
  for (const entry of plan.legacy) {
    try {
      if (treeDigest(entry.path) !== entry.tree_digest) fail('prestate_identity_drift', `legacy identity mismatch after recovery: ${entry.name}`, 'recovery_required');
      const native = nativeIdentity(plan.home, entry.path);
      if (native.security_metadata_hash !== entry.security_metadata_hash
          || (!allowRecreatedIdentity && native.manifest_hash !== entry.native_manifest)) {
        fail('prestate_metadata_drift', `legacy native manifest mismatch after recovery: ${entry.name}`, 'recovery_required');
      }
    } catch (error) {
      if (error instanceof ProdcraftCollectionError) throw error;
      fail('prestate_missing', `legacy entry missing after recovery: ${entry.name}`, 'recovery_required');
    }
  }
  for (const link of plan.projections) {
    if (!exactManagedSymlink(link.path, link.raw_target)) fail('prestate_projection_drift', `legacy projection mismatch after recovery: ${link.path}`, 'recovery_required');
    const native = nativeIdentity(plan.home, link.path);
    if (native.security_metadata_hash !== link.security_metadata_hash
        || (!allowRecreatedIdentity && native.manifest_hash !== link.native_manifest)) {
      fail('prestate_projection_metadata_drift', `legacy projection native manifest mismatch after recovery: ${link.path}`, 'recovery_required');
    }
  }
  if (lstatExists(plan.target.gateway_projection)) fail('prestate_gateway_conflict', 'new gateway remains after recovery', 'recovery_required');
  for (const root of plan.agent_roots) {
    if (lstatExists(join(root.root, 'pc-prodcraft'))) fail('prestate_agent_gateway_conflict', `new agent gateway remains after recovery: ${root.agent}`, 'recovery_required');
  }
}

function injectFault(phase, requested, killRequested) {
  if (requested === phase) fail('injected_fault', `injected fault at ${phase}`);
  if (killRequested === phase) process.kill(process.pid, 'SIGKILL');
}

export function applyProdcraftPlan(plan, confirmation, { faultPhase = null, killPhase = null } = {}) {
  validateCollectionPlan(plan);
  if (confirmation !== plan.plan_hash) fail('confirmation_mismatch', 'confirmation must equal the full plan hash');
  if (faultPhase !== null && !APPLY_FAULT_PHASES.includes(faultPhase)) fail('invalid_fault_phase', 'unsupported fault phase');
  if (killPhase !== null && (!APPLY_FAULT_PHASES.includes(killPhase)
      || process.env.SKILLS_REFINER_TEST_ALLOW_FAULTS !== '1')) fail('invalid_fault_phase', 'kill injection is test-only');
  const paths = operationPaths(plan);
  verifyPreconditions(plan);
  const lock = acquireLock(paths, plan);
  let mutationOccurred = false;
  try {
    verifyPreconditions(plan);
    if (lstatExists(paths.operationRoot) || lstatExists(paths.quarantineOperationRoot)) fail('operation_conflict', `operation already exists: ${paths.id}`);
    mkdirSync(paths.operationRoot, { recursive: true, mode: 0o700 });
    durableJson(paths.planPath, plan);
    writeOperation(paths, plan, OPERATION_STATES.planned);
    ensureArtifact(plan, paths);
    materializeCollection(plan, paths);
    copyRecovery(plan, paths);
    writeOperation(paths, plan, OPERATION_STATES.prepared);
    injectFault('after_prepared', faultPhase, killPhase);
    writeOperation(paths, plan, OPERATION_STATES.applying);

    for (const link of plan.projections) {
      const target = join(paths.quarantineOperationRoot, 'projections', link.agent, link.name);
      moveCollectionEntryExclusive({ home: plan.home, source: link.path, destination: target, expectedManifest: link.native_manifest });
      mutationOccurred = true;
    }
    injectFault('after_projection_quarantine', faultPhase, killPhase);
    for (const entry of plan.legacy) {
      moveCollectionEntryExclusive({ home: plan.home, source: entry.path, destination: join(paths.quarantineOperationRoot, 'skills', entry.name), expectedManifest: entry.native_manifest });
      mutationOccurred = true;
    }
    injectFault('after_legacy_quarantine', faultPhase, killPhase);
    moveCollectionEntryExclusive({ home: plan.home, source: paths.stageCollection, destination: plan.target.collection_root });
    mutationOccurred = true;
    injectFault('after_collection_publish', faultPhase, killPhase);
    createCollectionSymlinkExclusive({ home: plan.home, path: plan.target.gateway_projection, rawTarget: plan.target.gateway_raw_target });
    for (const root of plan.agent_roots) {
      createCollectionSymlinkExclusive({ home: plan.home, path: join(root.root, 'pc-prodcraft'), rawTarget: plan.target.agent_gateway_raw_target });
    }
    injectFault('after_projection_publish', faultPhase, killPhase);
    const status = statusAgainstPlan(plan, paths, { requireCommitted: false });
    if (status.status !== 'FILESYSTEM_READY') fail('postcondition_failed', `postcondition failed: ${status.issues.join(', ')}`, 'recovery_required');
    writeOperation(paths, plan, OPERATION_STATES.committed, { mutationOccurred: true });
    durableJson(paths.activePath, { schema_version: 'skills-refiner.collection.active.v1', operation_id: paths.id, plan_hash: plan.plan_hash });
    return { schema_version: 'skills-refiner.collection.apply.v1', status: 'FILESYSTEM_READY', runtime_status: 'UNVERIFIED', operation_id: paths.id, plan_hash: plan.plan_hash, mutation_occurred: true, recovery_root: paths.recoveryOperationRoot, quarantine_root: paths.quarantineOperationRoot };
  } catch (error) {
    if (error instanceof MacosAdapterError && error.mutationMayHaveOccurred) mutationOccurred = true;
    if (mutationOccurred) {
      try { rollbackApply(plan, paths); } catch (rollbackError) {
        try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: rollbackError.code ?? 'rollback_failed' }); } catch {}
        fail('recovery_required', `apply failed and rollback did not complete: ${rollbackError.message}`, 'recovery_required');
      }
    } else {
      if (lstatExists(paths.stageRoot)) rmSync(paths.stageRoot, { recursive: true, force: true });
      if (lstatExists(paths.recoveryOperationRoot)) rmSync(paths.recoveryOperationRoot, { recursive: true, force: true });
      if (lstatExists(paths.quarantineOperationRoot)) rmSync(paths.quarantineOperationRoot, { recursive: true, force: true });
      if (lstatExists(paths.operationRoot)) rmSync(paths.operationRoot, { recursive: true, force: true });
    }
    if (error instanceof MacosAdapterError) {
      fail('native_mutation_blocked', `native collection mutation blocked: ${error.reason}`);
    }
    throw error;
  } finally {
    releaseLock(paths, lock);
  }
}

function statusAgainstPlan(plan, paths = operationPaths(plan), { requireCommitted = true } = {}) {
  const issues = [];
  let index = null;
  let expectedIndex = null;
  if (canonicalJson(controllerIdentity(plan.home)) !== canonicalJson(plan.controller)) issues.push('CONTROLLER_IDENTITY_DRIFT');
  try {
    const operation = readJson(paths.operationPath, 'invalid_operation');
    validateOperationRecord(operation);
    if (operation.operation_id !== paths.id || operation.plan_hash !== plan.plan_hash) issues.push('OPERATION_IDENTITY_DRIFT');
    if (requireCommitted && operation.state !== OPERATION_STATES.committed) issues.push(`OPERATION_NOT_COMMITTED:${operation.state}`);
  } catch { issues.push('OPERATION_MISSING_OR_INVALID'); }
  try {
    const rootStat = lstatSync(plan.target.collection_root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) issues.push('COLLECTION_ROOT_NOT_REAL_DIRECTORY');
  } catch { issues.push('COLLECTION_ROOT_MISSING'); }
  if (lstatExists(join(plan.target.collection_root, 'SKILL.md'))) issues.push('COLLECTION_ROOT_HAS_SKILL_MD');
  try {
    index = readJson(join(plan.target.collection_root, 'INDEX.json'), 'invalid_index');
    validateCollectionIndex(index);
    expectedIndex = expectedCollectionIndex(plan, paths);
    if (canonicalJson(index) !== canonicalJson(expectedIndex)) issues.push('INDEX_IDENTITY_DRIFT');
  } catch { issues.push('INDEX_MISSING_OR_INVALID'); }
  try {
    if (treeDigest(paths.artifactRepo) !== plan.source.tree_digest) issues.push('ARTIFACT_IDENTITY_DRIFT');
  } catch { issues.push('ARTIFACT_MISSING_OR_INVALID'); }
  if (index !== null) {
    const expectedEntries = new Set(['INDEX.json', ...index.members.map(({ name }) => name)]);
    try {
      const actualEntries = readdirSync(plan.target.collection_root);
      for (const name of actualEntries) {
        if (!expectedEntries.has(name) && !IGNORED_COLLECTION_METADATA.has(name)) {
          issues.push(`UNEXPECTED_COLLECTION_ENTRY:${name}`);
        }
      }
      for (const name of expectedEntries) if (!actualEntries.includes(name)) issues.push(`MISSING_COLLECTION_ENTRY:${name}`);
    } catch {}
    const expectedMembers = new Map((expectedIndex?.members ?? []).map((member) => [member.name, member]));
    for (const member of index.members) {
      const path = join(plan.target.collection_root, member.name);
      if (!lstatExists(path)) continue;
      try {
        if (expectedMembers.size > 0 && treeDigest(path) !== expectedMembers.get(member.name)?.tree_digest) issues.push(`MEMBER_DRIFT:${member.name}`);
      } catch { issues.push(`MEMBER_INVALID:${member.name}`); }
    }
    const locatorPath = join(plan.target.collection_root, 'pc-prodcraft/prodcraft-runtime.json');
    try {
      if (sha256(readFileSync(locatorPath)) !== index.gateway.locator_digest) issues.push('LOCATOR_DIGEST_DRIFT');
      const locator = readJson(locatorPath, 'invalid_locator');
      if (canonicalJson(locator) !== canonicalJson(runtimeLocator(plan, paths))) issues.push('LOCATOR_CONTENT_DRIFT');
    } catch { issues.push('LOCATOR_MISSING_OR_INVALID'); }
  }
  if (!exactManagedSymlink(plan.target.gateway_projection, plan.target.gateway_raw_target)) issues.push('GATEWAY_PROJECTION_DRIFT');
  for (const root of plan.agent_roots) {
    if (!exactManagedSymlink(join(root.root, 'pc-prodcraft'), plan.target.agent_gateway_raw_target)) issues.push(`AGENT_GATEWAY_DRIFT:${root.agent}`);
  }
  for (const entry of plan.legacy) {
    if (entry.name !== 'prodcraft' && lstatExists(entry.path)) issues.push(`LEGACY_REAPPEARED:${entry.name}`);
  }
  for (const entry of plan.legacy) {
    const quarantined = join(paths.quarantineOperationRoot, 'skills', entry.name);
    try {
      if (treeDigest(quarantined) !== entry.tree_digest) issues.push(`QUARANTINE_DRIFT:${entry.name}`);
      if (nativeManifest(plan.home, quarantined) !== entry.native_manifest) issues.push(`QUARANTINE_METADATA_DRIFT:${entry.name}`);
    } catch { issues.push(`QUARANTINE_MISSING_OR_INVALID:${entry.name}`); }
    const recovered = join(paths.recoveryPreState, 'skills', entry.name);
    try {
      if (treeDigest(recovered) !== entry.tree_digest) issues.push(`RECOVERY_DRIFT:${entry.name}`);
      if (nativeIdentity(plan.home, recovered).security_metadata_hash !== entry.security_metadata_hash) issues.push(`RECOVERY_METADATA_DRIFT:${entry.name}`);
    } catch { issues.push(`RECOVERY_MISSING_OR_INVALID:${entry.name}`); }
  }
  for (const link of plan.projections) {
    if (lstatExists(link.path)) issues.push(`LEGACY_PROJECTION_REAPPEARED:${link.agent}:${link.name}`);
    const quarantined = join(paths.quarantineOperationRoot, 'projections', link.agent, link.name);
    if (!exactManagedSymlink(quarantined, link.raw_target)) issues.push(`QUARANTINE_PROJECTION_DRIFT:${link.agent}:${link.name}`);
    else {
      try {
        if (nativeManifest(plan.home, quarantined) !== link.native_manifest) issues.push(`QUARANTINE_PROJECTION_METADATA_DRIFT:${link.agent}:${link.name}`);
      } catch { issues.push(`QUARANTINE_PROJECTION_METADATA_INVALID:${link.agent}:${link.name}`); }
    }
    const recovered = join(paths.recoveryPreState, 'projections', link.agent, link.name);
    if (!exactManagedSymlink(recovered, link.raw_target)) issues.push(`RECOVERY_PROJECTION_DRIFT:${link.agent}:${link.name}`);
    else {
      try {
        if (nativeIdentity(plan.home, recovered).security_metadata_hash !== link.security_metadata_hash) issues.push(`RECOVERY_PROJECTION_METADATA_DRIFT:${link.agent}:${link.name}`);
      } catch { issues.push(`RECOVERY_PROJECTION_METADATA_INVALID:${link.agent}:${link.name}`); }
    }
  }
  try {
    if (sha256(readFileSync(join(paths.recoveryPreState, 'skill-lock.json'))) !== plan.receipt.digest) issues.push('RECOVERY_RECEIPT_DRIFT');
  } catch { issues.push('RECOVERY_RECEIPT_MISSING'); }
  let receiptState = 'unknown';
  try { receiptState = sha256(readFileSync(plan.receipt.path)) === plan.receipt.digest ? 'superseded' : 'drifted'; } catch {}
  return {
    schema_version: 'skills-refiner.collection.status.v1',
    collection_id: 'prodcraft',
    status: issues.length === 0 ? 'FILESYSTEM_READY' : 'DRIFTED',
    scope: 'filesystem',
    runtime_status: 'UNVERIFIED',
    observed_at: new Date().toISOString(),
    observer_version: 'skills-refiner.collection.observer.v1',
    operation_id: paths.id,
    plan_hash: plan.plan_hash,
    physical_collection_root: plan.target.collection_root,
    member_count: index?.members?.length ?? 0,
    external_receipt_state: receiptState,
    issues,
  };
}

function loadActivePlan(home) {
  const controlRoot = join(home, '.agents/skill-control/collections/prodcraft');
  const activePath = join(controlRoot, 'active.json');
  if (!lstatExists(activePath)) return null;
  const active = readJson(activePath, 'invalid_active_generation');
  const planPath = join(controlRoot, 'operations', active.operation_id, 'plan.json');
  const plan = readJson(planPath, 'invalid_active_plan');
  validateCollectionPlan(plan);
  if (active.plan_hash !== plan.plan_hash || active.operation_id !== operationId(plan)) fail('invalid_active_generation', 'active generation does not match its plan');
  return plan;
}

function loadOperationPlan(home, id) {
  if (!/^prodcraft-[0-9a-f]{12}$/u.test(id)) fail('invalid_operation_id', 'invalid ProdCraft operation id');
  const root = join(home, '.agents/skill-control/collections/prodcraft/operations', id);
  const plan = readJson(join(root, 'plan.json'), 'invalid_operation_plan');
  validateCollectionPlan(plan);
  if (operationId(plan) !== id) fail('invalid_operation_plan', 'operation id does not match plan authorization');
  const operation = readJson(join(root, 'operation.json'), 'invalid_operation');
  validateOperationRecord(operation);
  if (operation.operation_id !== id || operation.plan_hash !== plan.plan_hash) fail('invalid_operation', 'operation record does not match plan');
  return { plan, operation };
}

function pendingOperation(home) {
  const operationsRoot = join(home, '.agents/skill-control/collections/prodcraft/operations');
  let ids;
  try {
    ids = readdirSync(operationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^prodcraft-[0-9a-f]{12}$/u.test(entry.name))
      .map(({ name }) => name)
      .sort();
  } catch { return null; }
  const pending = [];
  for (const id of ids) {
    const loaded = loadOperationPlan(home, id);
    if (![OPERATION_STATES.rolledBack, OPERATION_STATES.restored].includes(loaded.operation.state)) {
      pending.push({ id, ...loaded });
    }
  }
  if (pending.length > 1) fail('ambiguous_operations', 'multiple nonterminal ProdCraft operations require operator review', 'recovery_required');
  return pending[0] ?? null;
}

export function statusProdcraftCollection({ home }) {
  const plan = loadActivePlan(home);
  if (plan === null) {
    const pending = pendingOperation(home);
    if (pending !== null) {
      return {
        schema_version: 'skills-refiner.collection.status.v1',
        collection_id: 'prodcraft',
        status: 'RECOVERY_REQUIRED',
        scope: 'filesystem',
        runtime_status: 'UNVERIFIED',
        observed_at: new Date().toISOString(),
        observer_version: 'skills-refiner.collection.observer.v1',
        operation_id: pending.id,
        plan_hash: pending.plan.plan_hash,
        physical_collection_root: pending.plan.target.collection_root,
        member_count: 0,
        external_receipt_state: 'unknown',
        issues: [`NONTERMINAL_OPERATION:${pending.operation.state}`],
      };
    }
    return { schema_version: 'skills-refiner.collection.status.v1', collection_id: 'prodcraft', status: 'UNMANAGED', scope: 'filesystem', runtime_status: 'UNVERIFIED', observed_at: new Date().toISOString(), observer_version: 'skills-refiner.collection.observer.v1', operation_id: null, plan_hash: null, physical_collection_root: join(home, '.agents/skills/prodcraft'), member_count: 0, external_receipt_state: 'unknown', issues: ['NO_ACTIVE_GENERATION'] };
  }
  const result = statusAgainstPlan(plan);
  if (result.issues.some((issue) => issue.startsWith('OPERATION_NOT_COMMITTED:'))) result.status = 'RECOVERY_REQUIRED';
  return result;
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

function isolateStaleCollectionLock(plan, paths) {
  if (!lstatExists(paths.lockPath)) return;
  assertSafeManagedPath(plan.home, paths.lockPath);
  const stat = lstatSync(paths.lockPath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail('unsafe_stale_lock', 'collection lock is not a real file', 'recovery_required');
  const lock = readJson(paths.lockPath, 'invalid_stale_lock');
  if (lock.operation_id !== paths.id || lock.plan_hash !== plan.plan_hash || processIsAlive(lock.pid)) {
    fail('live_or_foreign_lock', 'collection lock is live or belongs to another operation', 'recovery_required');
  }
  unlinkSync(paths.lockPath);
}

export function recoverProdcraftOperation({ home, operationId: requestedId, confirmation }) {
  const { plan } = loadOperationPlan(home, requestedId);
  const paths = operationPaths(plan);
  if (confirmation !== paths.id) fail('confirmation_mismatch', 'recover confirmation must equal operation id');
  isolateStaleCollectionLock(plan, paths);
  const lock = acquireLock(paths, plan);
  try {
    if (lstatExists(paths.activePath)) {
      const active = readJson(paths.activePath, 'invalid_active_generation');
      if (active.operation_id === paths.id) rmSync(paths.activePath, { force: true });
      else fail('foreign_active_generation', 'another active generation exists', 'recovery_required');
    }
    const rollback = rollbackApply(plan, paths);
    if (lstatExists(paths.stageRoot)) {
      assertSafeManagedPath(plan.home, paths.stageRoot);
      rmSync(paths.stageRoot, { recursive: true, force: true });
    }
    return {
      schema_version: 'skills-refiner.collection.recover.v1',
      status: 'RESTORED_PRESTATE',
      operation_id: paths.id,
      mutation_occurred: true,
      recreated_from_independent_recovery: rollback.recreatedFromRecovery,
    };
  } catch (error) {
    try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: error.code ?? 'recover_failed' }); } catch {}
    throw error;
  } finally {
    releaseLock(paths, lock);
  }
}

export function repairProdcraftCollection({ home, confirmation }) {
  const plan = loadActivePlan(home);
  if (plan === null) fail('no_active_generation', 'no active ProdCraft generation exists');
  const paths = operationPaths(plan);
  if (confirmation !== paths.id) fail('confirmation_mismatch', 'repair confirmation must equal operation id');
  const before = statusAgainstPlan(plan, paths);
  if (before.status === 'FILESYSTEM_READY') return { schema_version: 'skills-refiner.collection.repair.v1', status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: false, repaired: [] };
  const indexPath = join(plan.target.collection_root, 'INDEX.json');
  const locatorPath = join(plan.target.collection_root, 'pc-prodcraft/prodcraft-runtime.json');
  const replaceCollection = (before.issues.includes('INDEX_MISSING_OR_INVALID') && !lstatExists(indexPath))
    || (before.issues.includes('LOCATOR_MISSING_OR_INVALID') && !lstatExists(locatorPath));
  const allowed = before.issues.every((issue) => issue.startsWith('MISSING_COLLECTION_ENTRY:')
    || issue === 'GATEWAY_PROJECTION_DRIFT'
    || issue.startsWith('AGENT_GATEWAY_DRIFT:')
    || (replaceCollection && ['INDEX_MISSING_OR_INVALID', 'LOCATOR_MISSING_OR_INVALID', 'INDEX_IDENTITY_DRIFT', 'MEMBER_DRIFT:pc-prodcraft'].includes(issue)));
  if (!allowed) fail('repair_conflict', `repair refuses non-missing drift: ${before.issues.join(', ')}`);
  const lock = acquireLock(paths, plan);
  const repaired = [];
  const repairRoot = join(plan.home, '.agents/.skills-refiner-repair', paths.id);
  try {
    writeOperation(paths, plan, OPERATION_STATES.repairing, { mutationOccurred: false });
    materializeCollection(plan, paths, join(repairRoot, 'prodcraft'));
    if (replaceCollection) {
      const oldCollection = join(paths.quarantineOperationRoot, 'repair-old/prodcraft');
      if (lstatExists(oldCollection)) fail('repair_conflict', 'repair-old collection already exists');
      moveCollectionEntryExclusive({ home: plan.home, source: plan.target.collection_root, destination: oldCollection });
      try {
        moveCollectionEntryExclusive({ home: plan.home, source: join(repairRoot, 'prodcraft'), destination: plan.target.collection_root });
      } catch (error) {
        if (!lstatExists(plan.target.collection_root) && lstatExists(oldCollection)) {
          moveCollectionEntryExclusive({ home: plan.home, source: oldCollection, destination: plan.target.collection_root });
        }
        throw error;
      }
      repaired.push('collection_metadata');
    }
    for (const issue of replaceCollection ? [] : before.issues) {
      if (issue.startsWith('MISSING_COLLECTION_ENTRY:')) {
        const name = issue.split(':')[1];
        const destination = join(plan.target.collection_root, name);
        if (lstatExists(destination)) fail('repair_conflict', `repair destination appeared: ${destination}`);
        moveCollectionEntryExclusive({ home: plan.home, source: join(repairRoot, 'prodcraft', name), destination });
        repaired.push(name);
      } else if (issue === 'GATEWAY_PROJECTION_DRIFT') {
        if (lstatExists(plan.target.gateway_projection)) fail('repair_conflict', 'gateway projection exists with conflicting identity');
        createCollectionSymlinkExclusive({ home: plan.home, path: plan.target.gateway_projection, rawTarget: plan.target.gateway_raw_target });
        repaired.push('gateway_projection');
      } else if (issue.startsWith('AGENT_GATEWAY_DRIFT:')) {
        const agent = issue.split(':')[1];
        const root = plan.agent_roots.find((item) => item.agent === agent);
        const destination = join(root.root, 'pc-prodcraft');
        if (lstatExists(destination)) fail('repair_conflict', `agent projection exists with conflicting identity: ${destination}`);
        createCollectionSymlinkExclusive({ home: plan.home, path: destination, rawTarget: plan.target.agent_gateway_raw_target });
        repaired.push(`agent:${agent}`);
      }
    }
    rmSync(repairRoot, { recursive: true, force: true });
    const after = statusAgainstPlan(plan, paths, { requireCommitted: false });
    if (after.status !== 'FILESYSTEM_READY') fail('repair_failed', after.issues.join(', '), 'recovery_required');
    writeOperation(paths, plan, OPERATION_STATES.committed, { mutationOccurred: repaired.length > 0 });
    return { schema_version: 'skills-refiner.collection.repair.v1', status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: repaired.length > 0, repaired };
  } finally {
    if (lstatExists(repairRoot)) rmSync(repairRoot, { recursive: true, force: true });
    releaseLock(paths, lock);
  }
}

export function undoProdcraftOperation({ home, operationId: requestedId, confirmation }) {
  const plan = loadActivePlan(home);
  if (plan === null) fail('no_active_generation', 'no active ProdCraft generation exists');
  const paths = operationPaths(plan);
  if (requestedId !== paths.id || confirmation !== paths.id) fail('confirmation_mismatch', 'undo confirmation must equal active operation id');
  const before = statusAgainstPlan(plan, paths);
  if (before.status !== 'FILESYSTEM_READY') fail('undo_conflict', `undo requires FILESYSTEM_READY post-state: ${before.issues.join(', ')}`);
  const lock = acquireLock(paths, plan);
  try {
    const lockedStatus = statusAgainstPlan(plan, paths);
    if (lockedStatus.status !== 'FILESYSTEM_READY') fail('undo_conflict', `undo post-state changed after lock: ${lockedStatus.issues.join(', ')}`);
    writeOperation(paths, plan, OPERATION_STATES.restoring, { mutationOccurred: true });
    const postRoot = join(paths.quarantineOperationRoot, 'post-state/undo');
    if (lstatExists(postRoot)) fail('undo_conflict', 'undo post-state quarantine already exists');
    for (const root of plan.agent_roots) {
      moveCollectionEntryExclusive({ home: plan.home, source: join(root.root, 'pc-prodcraft'), destination: join(postRoot, 'agents', root.agent) });
    }
    moveCollectionEntryExclusive({ home: plan.home, source: plan.target.gateway_projection, destination: join(postRoot, 'pc-prodcraft') });
    moveCollectionEntryExclusive({ home: plan.home, source: plan.target.collection_root, destination: join(postRoot, 'prodcraft') });
    for (const entry of plan.legacy) {
      const source = join(paths.quarantineOperationRoot, 'skills', entry.name);
      if (!lstatExists(source) || lstatExists(entry.path)) fail('undo_conflict', `cannot restore legacy entry: ${entry.name}`);
      moveCollectionEntryExclusive({ home: plan.home, source, destination: entry.path, expectedManifest: entry.native_manifest });
    }
    for (const link of plan.projections) {
      const source = join(paths.quarantineOperationRoot, 'projections', link.agent, link.name);
      if (!lstatExists(source) || lstatExists(link.path)) fail('undo_conflict', `cannot restore legacy projection: ${link.path}`);
      moveCollectionEntryExclusive({ home: plan.home, source, destination: link.path, expectedManifest: link.native_manifest });
    }
    verifyExactPreState(plan);
    renameSync(paths.activePath, join(paths.operationRoot, 'active.restored.json'));
    writeOperation(paths, plan, OPERATION_STATES.restored, { mutationOccurred: true });
    return { schema_version: 'skills-refiner.collection.undo.v1', status: 'RESTORED', operation_id: paths.id, mutation_occurred: true };
  } catch (error) {
    try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: error.code ?? 'undo_failed' }); } catch {}
    throw error;
  } finally {
    releaseLock(paths, lock);
  }
}
