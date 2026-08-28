import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fsyncSync,
  fstatSync,
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
import { computeTreeDigest, copyTreeWithStableModes } from './collection-tree.mjs';
import {
  materializeGitRevision, originTrackingRefsContaining, sourceGitAccess,
} from './git-source-attestation.mjs';
import { observeUpstreamVersion, upstreamVersionEvidence } from './upstream-version.mjs';
import {
  createCollectionFileExclusive,
  createCollectionSymlinkExclusive,
  ensureMacosHelper,
  inspectCollectionEntry,
  MacosAdapterError,
  moveCollectionEntryExclusive,
  replaceCollectionFileCas,
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
  'after_collection_publish', 'after_projection_publish', 'after_active_publish',
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
    new URL('./collection-tree.mjs', import.meta.url),
    new URL('./collection-cli.mjs', import.meta.url),
    new URL('./collection-contract.mjs', import.meta.url),
    new URL('./git-source-attestation.mjs', import.meta.url),
    new URL('./upstream-version.mjs', import.meta.url),
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

function assertAbsoluteRealDirectory(path, label) {
  if (!isAbsolute(path)) fail('unsafe_path', `${label} must be absolute`);
  let stat;
  try { stat = lstatSync(path); } catch { fail('missing_path', `${label} is missing: ${path}`); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('unsafe_path', `${label} must be a real directory: ${path}`);
  if (realpathSync(path) !== path) fail('unsafe_path', `${label} must be canonical: ${path}`);
}

export function treeDigest(root) {
  return computeTreeDigest(root, fail);
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
  const { git, readObjects } = sourceGitAccess(root);
  const topLevel = git('rev-parse', '--show-toplevel');
  const head = git('rev-parse', 'HEAD');
  const remote = git('remote', 'get-url', 'origin');
  if (topLevel.status !== 0 || realpathSync(topLevel.stdout.trim()) !== root) fail('unverified_source', 'source root must be a Git worktree root');
  if (head.status !== 0 || head.stdout.trim() !== revision) fail('source_revision_mismatch', 'source HEAD does not match the approved revision');
  if (remote.status !== 0 || !['https://github.com/yknothing/prodcraft.git', 'git@github.com:yknothing/prodcraft.git'].includes(remote.stdout.trim())) {
    fail('source_origin_mismatch', 'source origin must be the approved yknothing/prodcraft repository');
  }
  const remoteAttestation = originTrackingRefsContaining(git, revision);
  if (!remoteAttestation.ok || remoteAttestation.refs.length === 0) {
    fail('source_revision_not_remote_tracked', 'source revision must be contained by an origin remote-tracking ref');
  }
  const authorityParent = realpathSync(mkdtempSync(join(tmpdir(), 'skills-refiner-prodcraft-authority-')));
  try {
    const authorityRoot = join(authorityParent, 'repository');
    materializeGitRevision({ readObjects, revision, destination: authorityRoot, fail });
    const registryPath = join(authorityRoot, 'schemas/distribution/public-skill-registry.json');
    const indexPath = join(authorityRoot, 'skills/.curated/index.json');
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
    const curatedRoot = join(authorityRoot, 'skills/.curated');
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
    upstreamVersionEvidence(authorityRoot, { path: 'manifest.yml', format: 'yaml_root_version' });
    return {
      provider: 'github',
      repository_id: RECEIPT_SOURCE,
      revision,
      root,
      remote_attestation: {
        scheme: 'origin-tracking-containment.v1', refs: remoteAttestation.refs,
      },
      tree_digest: treeDigest(authorityRoot),
      registry_digest: sha256(registryBytes),
      curated_index_digest: sha256(indexBytes),
      reference_graph_digest: references.digest,
      members,
    };
  } finally {
    rmSync(authorityParent, { recursive: true, force: true });
  }
}

function contained(home, path) {
  const rel = relative(home, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function observeProdcraftReceipt(home) {
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
  for (const { name, receipt } of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) fail('unsafe_legacy_name', `unsafe legacy name: ${name}`);
    if (receipt.sourceType !== 'github' || receipt.sourceUrl !== RECEIPT_SOURCE_URL
        || typeof receipt.skillPath !== 'string' || receipt.skillPath.includes('..')
        || !receipt.skillPath.startsWith('skills/') || !receipt.skillPath.endsWith(`/${name}/SKILL.md`)
        || !/^[0-9a-f]{40}$/u.test(receipt.skillFolderHash ?? '')
        || typeof receipt.installedAt !== 'string' || Number.isNaN(Date.parse(receipt.installedAt))
        || typeof receipt.updatedAt !== 'string' || Number.isNaN(Date.parse(receipt.updatedAt))) {
      fail('untrusted_receipt_entry', `receipt authority is incomplete for ${name}`);
    }
  }
  return {
    entries,
    receipt: {
      path: receiptPath,
      digest: sha256(receiptBytes),
      entries_digest: sha256(Buffer.from(canonicalJson(entries))),
    },
  };
}

function receiptHistoryFromPlan(plan) {
  if (plan.predecessor?.receipt_history) return structuredClone(plan.predecessor.receipt_history);
  const installed = plan.legacy.map(({ receipt }) => receipt.installed_at).sort();
  const updated = plan.legacy.map(({ receipt }) => receipt.updated_at).sort();
  if (installed.length !== EXPECTED_LEGACY_COUNT || updated.length !== EXPECTED_LEGACY_COUNT) {
    fail('invalid_receipt_history', 'active generation has no complete ProdCraft receipt history');
  }
  return {
    entry_count: EXPECTED_LEGACY_COUNT,
    first_installed_at: installed[0],
    last_updated_at: updated.at(-1),
  };
}

function retiredTopologyFromPlan(plan) {
  if (plan.predecessor?.retired_names && plan.predecessor?.retired_projections) {
    return {
      retired_names: structuredClone(plan.predecessor.retired_names),
      retired_projections: structuredClone(plan.predecessor.retired_projections),
    };
  }
  return {
    retired_names: plan.legacy.map(({ name }) => name).sort((left, right) => left.localeCompare(right, 'en')),
    retired_projections: plan.projections.map(({ agent, root, name, path }) => ({ agent, root, name, path }))
      .sort((left, right) => left.path.localeCompare(right.path, 'en')),
  };
}

export function observeProdcraftInstall({ home }) {
  const normalizedHome = resolve(home);
  if (normalizedHome !== home) fail('unsafe_home', 'HOME must be normalized and absolute');
  assertAbsoluteRealDirectory(normalizedHome, 'HOME');
  const receiptSnapshot = observeProdcraftReceipt(home);
  const { entries } = receiptSnapshot;
  const skillsRoot = join(home, '.agents/skills');
  const conflicts = [];
  const legacy = entries.map(({ name, receipt }) => {
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
    receipt: receiptSnapshot.receipt,
    receipt_entries: entries,
    legacy,
    projections: projections.sort((a, b) => a.path.localeCompare(b.path, 'en')),
    conflicts,
    agent_roots: agentRoots,
  };
}

export function compileProdcraftPlan({ home, sourceRoot, revision, now = new Date().toISOString() }) {
  const source = inspectProdcraftSource({ sourceRoot, revision });
  const activePlan = loadActivePlan(home);
  const predecessor = activePlan === null ? null : observeProdcraftPredecessor({ plan: activePlan, home });
  const installed = activePlan === null
    ? observeProdcraftInstall({ home })
    : { receipt: structuredClone(activePlan.receipt) };
  if (activePlan === null && installed.conflicts.length > 0) fail('projection_conflict', 'legacy projection conflicts must be resolved before planning');
  const legacy = activePlan === null ? installed.legacy.map((entry) => {
    const successor = `pc-${entry.name}`;
    if (PUBLIC_SET.has(successor)) return { ...entry, disposition: 'replaced', successor };
    if (!LEGACY_ONLY_NAMES.includes(entry.name)) fail('unresolved_legacy', `no reviewed disposition for ${entry.name}`);
    return { ...entry, disposition: 'retired_by_owner', successor: null };
  }) : [];
  const agentRoots = activePlan === null
    ? installed.agent_roots
    : activePlan.agent_roots.filter((root) => predecessor.exposures.some((exposure) => exposure.scope === 'agent' && exposure.root === root.root));
  return buildCollectionPlan({
    collection_id: 'prodcraft',
    home,
    source,
    receipt: installed.receipt,
    legacy,
    projections: activePlan === null ? installed.projections : [],
    predecessor,
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
    agent_roots: agentRoots,
    created_at: now,
  });
}

function operationId(plan) {
  return `prodcraft-${plan.plan_hash.slice(7, 19)}`;
}

function isSuccessorPlan(plan) {
  return plan.schema_version === COLLECTION_SCHEMAS.plan && plan.predecessor !== null;
}

function validateActiveRecord(active, plan = null, code = 'invalid_active_generation') {
  const version = active?.schema_version;
  const expectedKeys = version === 'skills-refiner.collection.active.v2'
    ? ['activated_at', 'collection_id', 'operation_id', 'plan_hash', 'schema_version']
    : ['operation_id', 'plan_hash', 'schema_version'];
  const keysMatch = canonicalJson(Object.keys(active ?? {}).sort()) === canonicalJson(expectedKeys);
  const validTimestamp = version !== 'skills-refiner.collection.active.v2'
    || (typeof active.activated_at === 'string'
      && !Number.isNaN(Date.parse(active.activated_at))
      && new Date(active.activated_at).toISOString() === active.activated_at);
  if (!keysMatch
      || !['skills-refiner.collection.active.v1', 'skills-refiner.collection.active.v2'].includes(version)
      || !/^prodcraft-[0-9a-f]{12}$/u.test(active.operation_id ?? '')
      || !/^sha256:[0-9a-f]{64}$/u.test(active.plan_hash ?? '')
      || !validTimestamp
      || (version === 'skills-refiner.collection.active.v2' && active.collection_id !== 'prodcraft')) {
    fail(code, 'active ProdCraft generation record is invalid', 'recovery_required');
  }
  if (plan !== null
      && (active.operation_id !== operationId(plan) || active.plan_hash !== plan.plan_hash)) {
    fail(code, 'active ProdCraft generation does not match its plan', 'recovery_required');
  }
  return active;
}

function activeRecord(plan, paths, activatedAt) {
  return {
    schema_version: 'skills-refiner.collection.active.v2',
    collection_id: 'prodcraft',
    operation_id: paths.id,
    plan_hash: plan.plan_hash,
    activated_at: activatedAt,
  };
}

function createActiveExclusive(plan, paths, record) {
  const bytes = jsonBytes(record);
  return createCollectionFileExclusive({
    home: plan.home,
    path: paths.activePath,
    targetDigest: sha256(bytes),
    bytes,
  });
}

function replaceActiveCas(plan, paths, expected, replacement) {
  const current = readPrivateJson(plan.home, paths.activePath, 'invalid_active_generation');
  validateActiveRecord(current.value);
  if (canonicalJson(current.value) !== canonicalJson(expected)) {
    fail('active_generation_conflict', 'active ProdCraft generation changed before compare-and-swap', 'recovery_required');
  }
  const bytes = jsonBytes(replacement);
  replaceCollectionFileCas({
    home: plan.home,
    path: paths.activePath,
    expectedDigest: current.digest,
    targetDigest: sha256(bytes),
    bytes,
  });
}

function publishActiveRecord(plan, paths, record) {
  if (isSuccessorPlan(plan)) {
    replaceActiveCas(plan, paths, plan.predecessor.active_record, record);
  } else {
    if (lstatExists(paths.activePath)) {
      fail('active_generation_conflict', 'an active ProdCraft generation already exists', 'recovery_required');
    }
    createActiveExclusive(plan, paths, record);
  }
}

function archiveInitialActive(plan, paths, destinationName) {
  if (!lstatExists(paths.activePath)) return;
  const current = readPrivateJson(plan.home, paths.activePath, 'invalid_active_generation').value;
  validateActiveRecord(current, plan);
  const identity = inspectCollectionEntry({ home: plan.home, path: paths.activePath });
  const destination = join(paths.operationRoot, destinationName);
  if (lstatExists(destination)) {
    fail('active_generation_conflict', `active archive already exists: ${destination}`, 'recovery_required');
  }
  moveCollectionEntryExclusive({
    home: plan.home,
    source: paths.activePath,
    destination,
    expectedManifest: identity.manifest_hash,
    expectedDevice: identity.device,
    expectedInode: identity.inode,
  });
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
    recoveryPlanPath: join(recoveryOperationRoot, 'plan.json'),
    quarantineOperationRoot,
    stageRoot: join(plan.home, '.agents/.skills-refiner-stage', id),
    artifactStage: join(plan.home, '.agents/.skills-refiner-stage', id, 'artifact-repo'),
    stageCollection: join(plan.home, '.agents/.skills-refiner-stage', id, 'prodcraft'),
    lockPath: join(plan.home, '.agents/skill-control/collection-mutation.lock'),
  };
}

function predecessorExposurePath(base, exposure) {
  return join(base, 'predecessor', 'exposures', exposure.scope === 'global' ? 'global' : exposure.agent);
}

function observeProdcraftPredecessor({ plan, home }) {
  const paths = operationPaths(plan);
  const status = statusAgainstPlan(plan, paths);
  if (status.status !== 'FILESYSTEM_READY') {
    fail('predecessor_drift', `active ProdCraft generation is not upgradeable: ${status.issues.join(', ')}`);
  }
  const active = validateActiveRecord(
    readPrivateJson(home, paths.activePath, 'invalid_active_generation').value,
    plan,
    'predecessor_drift',
  );
  const operation = readPrivateJson(home, paths.operationPath, 'invalid_operation').value;
  validateOperationRecord(operation);
  if (operation.state !== OPERATION_STATES.committed) fail('predecessor_drift', 'active ProdCraft operation is not committed');
  assertCommittedLineageTip(home, paths.id);
  const activatedAt = active.schema_version === 'skills-refiner.collection.active.v2'
    ? active.activated_at : null;
  const firstActivatedAt = isSuccessorPlan(plan)
    ? plan.predecessor.first_activated_at
    : (active.schema_version === 'skills-refiner.collection.active.v2' ? active.activated_at : null);
  const retiredTopology = retiredTopologyFromPlan(plan);
  const collectionIdentity = nativeIdentity(home, plan.target.collection_root);
  const exposures = [];
  const globalIdentity = nativeIdentity(home, plan.target.gateway_projection);
  if (!exactManagedSymlink(plan.target.gateway_projection, plan.target.gateway_raw_target)) {
    fail('predecessor_drift', 'active ProdCraft global gateway changed');
  }
  exposures.push({
    scope: 'global', agent: null, root: dirname(plan.target.gateway_projection),
    path: plan.target.gateway_projection, raw_target: plan.target.gateway_raw_target,
    native_manifest: globalIdentity.manifest_hash,
    security_metadata_hash: globalIdentity.security_metadata_hash,
  });
  for (const root of plan.agent_roots) {
    if (!lstatExists(root.root)) continue;
    const path = join(root.root, 'pc-prodcraft');
    if (!exactManagedSymlink(path, plan.target.agent_gateway_raw_target)) {
      fail('predecessor_drift', `active ProdCraft Agent gateway changed: ${path}`);
    }
    const identity = nativeIdentity(home, path);
    exposures.push({
      scope: 'agent', agent: root.agent, root: root.root, path,
      raw_target: plan.target.agent_gateway_raw_target,
      native_manifest: identity.manifest_hash,
      security_metadata_hash: identity.security_metadata_hash,
    });
  }
  return {
    operation_id: paths.id,
    plan_hash: plan.plan_hash,
    active_record: active,
    activated_at: activatedAt,
    first_activated_at: firstActivatedAt,
    receipt_history: receiptHistoryFromPlan(plan),
    ...retiredTopology,
    collection: {
      path: plan.target.collection_root,
      tree_digest: treeDigest(plan.target.collection_root),
      native_manifest: collectionIdentity.manifest_hash,
      security_metadata_hash: collectionIdentity.security_metadata_hash,
    },
    exposures: exposures.sort((left, right) => left.path.localeCompare(right.path, 'en')),
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
  const bytes = jsonBytes(record);
  if (!lstatExists(paths.operationPath)) {
    createCollectionFileExclusive({ home: plan.home, path: paths.operationPath, targetDigest: sha256(bytes), bytes });
  } else {
    const current = readPrivateJson(plan.home, paths.operationPath, 'invalid_operation');
    validateOperationRecord(current.value);
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
    if (created && error instanceof ProdcraftCollectionError) throw error;
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

function verifySourceAgainstPlan(plan) {
  const observed = inspectProdcraftSource({ sourceRoot: plan.source.root, revision: plan.source.revision });
  if (!Object.hasOwn(plan.source, 'remote_attestation')) delete observed.remote_attestation;
  if (canonicalJson(observed) !== canonicalJson(plan.source)) fail('source_drift', 'candidate source changed after planning');
}

function verifyControllerAgainstPlan(plan) {
  if (Number(process.versions.node.split('.')[0]) !== 24
      || canonicalJson(controllerIdentity(plan.home)) !== canonicalJson(plan.controller)) {
    fail('controller_drift', 'controller/native-helper identity changed after planning');
  }
}

function verifyInstalledFactsAgainstPlan(plan) {
  if (plan.predecessor !== undefined && plan.predecessor !== null) {
    const active = loadActivePlan(plan.home);
    if (active === null || active.plan_hash !== plan.predecessor.plan_hash
        || operationId(active) !== plan.predecessor.operation_id) {
      fail('predecessor_drift', 'active ProdCraft generation changed after planning');
    }
    const observed = observeProdcraftPredecessor({ plan: active, home: plan.home });
    const expected = {
      receipt: active.receipt,
      legacy: [],
      projections: [],
      predecessor: observed,
      agent_roots: active.agent_roots.filter((root) => observed.exposures.some((exposure) => exposure.scope === 'agent' && exposure.root === root.root)),
    };
    const planned = {
      receipt: plan.receipt,
      legacy: plan.legacy,
      projections: plan.projections,
      predecessor: plan.predecessor,
      agent_roots: plan.agent_roots,
    };
    if (canonicalJson(expected) !== canonicalJson(planned)) {
      fail('installed_facts_drift', 'plan does not match the active ProdCraft generation');
    }
    return;
  }
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
  if (isSuccessorPlan(plan)) {
    const predecessorReceipt = join(
      plan.control.recovery_root,
      'operations',
      plan.predecessor.operation_id,
      'pre-state/skill-lock.json',
    );
    try {
      if (sha256(readFileSync(predecessorReceipt)) !== plan.receipt.digest) {
        fail('receipt_history_drift', 'predecessor receipt history changed after planning');
      }
    } catch (error) {
      if (error instanceof ProdcraftCollectionError) throw error;
      fail('receipt_history_missing', 'predecessor receipt history is unavailable');
    }
  } else {
    const receiptDigest = sha256(readFileSync(plan.receipt.path));
    if (receiptDigest !== plan.receipt.digest) fail('receipt_drift', 'external installer receipt changed after planning');
  }
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
  if (plan.predecessor === undefined || plan.predecessor === null) {
    if (existsSync(plan.target.gateway_projection)) fail('target_conflict', `gateway projection already exists: ${plan.target.gateway_projection}`);
    for (const root of plan.agent_roots) {
      const target = join(root.root, 'pc-prodcraft');
      if (existsSync(target) || lstatExists(target)) fail('target_conflict', `agent gateway projection already exists: ${target}`);
    }
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
  if (treeDigest(paths.artifactStage) !== plan.source.tree_digest) fail('artifact_copy_failed', 'artifact copy did not preserve source identity');
  renameSync(paths.artifactStage, paths.artifactRepo);
  const parent = openSync(dirname(paths.artifactRepo), 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
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
    copyTreeWithStableModes(join(paths.artifactRepo, 'skills/.curated/pc-prodcraft'), temporaryGateway, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    }, fail);
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

function publishedCollectionMatches(plan, paths) {
  try {
    const artifactStat = lstatSync(paths.artifactRepo);
    const artifactMode = artifactStat.mode & 0o777;
    if (artifactStat.isSymbolicLink() || !artifactStat.isDirectory()
        || (artifactMode & 0o500) !== 0o500 || (artifactMode & 0o022) !== 0
        || lstatExists(join(paths.artifactRepo, '.git'))
        || treeDigest(paths.artifactRepo) !== plan.source.tree_digest) return false;
    const root = plan.target.collection_root;
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()
        || (rootStat.mode & 0o777) !== 0o755) return false;
    const index = readJson(join(root, 'INDEX.json'), 'invalid_index');
    validateCollectionIndex(index);
    const expected = expectedCollectionIndex(plan, paths);
    if (canonicalJson(index) !== canonicalJson(expected)) return false;
    const expectedEntries = new Set(['INDEX.json', ...expected.members.map(({ name }) => name)]);
    const actualEntries = readdirSync(root);
    if (actualEntries.some((name) => !expectedEntries.has(name)
        && !IGNORED_COLLECTION_METADATA.has(name))) return false;
    if ([...expectedEntries].some((name) => !actualEntries.includes(name))) return false;
    for (const member of expected.members) {
      const memberPath = join(root, member.name);
      const stat = lstatSync(memberPath);
      if (stat.isSymbolicLink() || !stat.isDirectory()
          || (stat.mode & 0o777) !== 0o755
          || treeDigest(memberPath) !== member.tree_digest) return false;
    }
    const locatorPath = join(root, 'pc-prodcraft/prodcraft-runtime.json');
    return sha256(readFileSync(locatorPath)) === expected.gateway.locator_digest
      && canonicalJson(readJson(locatorPath, 'invalid_locator'))
        === canonicalJson(runtimeLocator(plan, paths));
  } catch { return false; }
}

function materializeCollection(plan, paths, target = paths.stageCollection) {
  assertSafeManagedPath(plan.home, target);
  if (lstatExists(target)) fail('stage_conflict', `staging target already exists: ${target}`);
  mkdirSync(target, { recursive: true, mode: 0o755 });
  chmodSync(target, 0o755);
  for (const member of plan.source.members) {
    copyTreeWithStableModes(join(paths.artifactRepo, member.relative_path), join(target, member.name), {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    }, fail);
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
  durableJson(paths.recoveryPlanPath, plan);
  if (plan.predecessor !== undefined && plan.predecessor !== null) {
    const collectionTarget = join(paths.recoveryPreState, 'predecessor', 'collection');
    const copiedCollection = spawnSync('/usr/bin/ditto', [
      '--rsrc', '--extattr', '--acl', plan.predecessor.collection.path, collectionTarget,
    ], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
    });
    if (copiedCollection.status !== 0
        || treeDigest(collectionTarget) !== plan.predecessor.collection.tree_digest
        || nativeIdentity(plan.home, collectionTarget).security_metadata_hash
          !== plan.predecessor.collection.security_metadata_hash) {
      fail('recovery_copy_failed', 'predecessor collection recovery mismatch');
    }
    for (const exposure of plan.predecessor.exposures) {
      const target = predecessorExposurePath(paths.recoveryPreState, exposure);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      const copied = spawnSync('/bin/cp', ['-a', exposure.path, target], {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
      });
      if (copied.status !== 0 || !exactManagedSymlink(target, exposure.raw_target)
          || nativeIdentity(plan.home, target).security_metadata_hash !== exposure.security_metadata_hash) {
        fail('recovery_copy_failed', `predecessor exposure recovery mismatch: ${exposure.path}`);
      }
    }
  }
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
  const receiptSource = isSuccessorPlan(plan)
    ? join(plan.control.recovery_root, 'operations', plan.predecessor.operation_id, 'pre-state/skill-lock.json')
    : plan.receipt.path;
  copyFileSync(receiptSource, join(paths.recoveryPreState, 'skill-lock.json'));
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
  durableJson(join(paths.recoveryOperationRoot, 'manifest.json'), expectedRecoveryManifest(plan, paths));
}

function expectedRecoveryManifest(plan, paths) {
  return {
    schema_version: 'skills-refiner.collection.recovery-manifest.v1',
    operation_id: paths.id,
    plan_hash: plan.plan_hash,
    receipt_digest: plan.receipt.digest,
    predecessor_digest: plan.predecessor === undefined || plan.predecessor === null
      ? null : sha256(Buffer.from(canonicalJson(plan.predecessor))),
    legacy: plan.legacy.map(({ name, tree_digest, native_manifest, security_metadata_hash }) => ({ name, tree_digest, native_manifest, security_metadata_hash })),
    projections_digest: sha256(Buffer.from(canonicalJson(plan.projections))),
  };
}

function exactManagedSymlink(path, rawTarget) {
  try { return lstatSync(path).isSymbolicLink() && readlinkSync(path) === rawTarget; } catch { return false; }
}

function manifestMatches(home, path, expected) {
  try { return nativeManifest(home, path) === expected; } catch { return false; }
}

function validateLegacyRecoverySource(plan, paths, entry) {
  const source = join(paths.recoveryPreState, 'skills', entry.name);
  if (treeDigest(source) !== entry.tree_digest
      || nativeIdentity(plan.home, source).security_metadata_hash !== entry.security_metadata_hash) {
    fail('recovery_source_drift', `independent recovery source changed: ${entry.name}`, 'recovery_required');
  }
  return source;
}

function isolateInvalidRecoveryPartial(plan, paths, partial, label) {
  const identity = inspectCollectionEntry({ home: plan.home, path: partial });
  const safeLabel = label.replace(/[^a-z0-9._-]/giu, '_');
  const destination = join(
    paths.quarantineOperationRoot,
    'recovery-stage-audit',
    `${safeLabel}-${identity.device}-${identity.inode}.partial`,
  );
  moveCollectionEntryExclusive({
    home: plan.home,
    source: partial,
    destination,
    expectedManifest: identity.manifest_hash,
    expectedDevice: identity.device,
    expectedInode: identity.inode,
  });
}

function stageLegacyFromRecovery(plan, paths, entry) {
  const stage = join(paths.quarantineOperationRoot, 'recovery-restore/skills', entry.name);
  if (lstatExists(stage)) {
    if (!sourceMatchesDirectory(plan, stage, entry)) {
      fail('recovery_stage_conflict', `recovery stage changed: ${entry.name}`, 'recovery_required');
    }
    return stage;
  }
  const partial = `${stage}.partial`;
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  if (lstatExists(partial)) {
    if (sourceMatchesDirectory(plan, partial, entry)) {
      moveCollectionEntryExclusive({
        home: plan.home,
        source: partial,
        destination: stage,
        expectedManifest: nativeManifest(plan.home, partial),
      });
      return stage;
    }
    isolateInvalidRecoveryPartial(plan, paths, partial, `legacy-${entry.name}`);
  }
  const source = validateLegacyRecoverySource(plan, paths, entry);
  const copied = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', source, partial], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
  });
  if (copied.status !== 0) fail('recovery_restore_copy_failed', `cannot copy independent recovery for ${entry.name}`, 'recovery_required');
  if (!sourceMatchesDirectory(plan, partial, entry)) {
    fail('recovery_restore_copy_failed', `cannot stage independent recovery for ${entry.name}`, 'recovery_required');
  }
  moveCollectionEntryExclusive({
    home: plan.home,
    source: partial,
    destination: stage,
    expectedManifest: nativeManifest(plan.home, partial),
  });
  return stage;
}

function validateProjectionRecoverySource(plan, paths, link) {
  const source = join(paths.recoveryPreState, 'projections', link.agent, link.name);
  if (!exactManagedSymlink(source, link.raw_target)
      || nativeIdentity(plan.home, source).security_metadata_hash !== link.security_metadata_hash) {
    fail('recovery_source_drift', `independent projection recovery changed: ${link.path}`, 'recovery_required');
  }
  return source;
}

function stageProjectionFromRecovery(plan, paths, link) {
  const stage = join(paths.quarantineOperationRoot, 'recovery-restore/projections', link.agent, link.name);
  if (lstatExists(stage)) {
    if (!sourceMatchesExposure(plan, stage, link)) {
      fail('recovery_stage_conflict', `projection recovery stage changed: ${link.path}`, 'recovery_required');
    }
    return stage;
  }
  const partial = `${stage}.partial`;
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  if (lstatExists(partial)) {
    if (sourceMatchesExposure(plan, partial, link)) {
      moveCollectionEntryExclusive({
        home: plan.home,
        source: partial,
        destination: stage,
        expectedManifest: nativeManifest(plan.home, partial),
      });
      return stage;
    }
    isolateInvalidRecoveryPartial(plan, paths, partial, `projection-${link.agent}-${link.name}`);
  }
  const source = validateProjectionRecoverySource(plan, paths, link);
  const copied = spawnSync('/bin/cp', ['-a', source, partial], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
  });
  if (copied.status !== 0 || !sourceMatchesExposure(plan, partial, link)) {
    fail('recovery_restore_copy_failed', `cannot stage independent projection recovery: ${link.path}`, 'recovery_required');
  }
  moveCollectionEntryExclusive({
    home: plan.home,
    source: partial,
    destination: stage,
    expectedManifest: nativeManifest(plan.home, partial),
  });
  return stage;
}

function validatePredecessorCollectionRecoverySource(plan, paths) {
  const entry = plan.predecessor.collection;
  const source = join(paths.recoveryPreState, 'predecessor', 'collection');
  if (treeDigest(source) !== entry.tree_digest
      || nativeIdentity(plan.home, source).security_metadata_hash !== entry.security_metadata_hash) {
    fail('recovery_source_drift', 'independent predecessor collection recovery changed', 'recovery_required');
  }
  return source;
}

function stagePredecessorCollectionRecovery(plan, paths, preferredSource = null) {
  const entry = plan.predecessor.collection;
  const stage = join(paths.quarantineOperationRoot, 'recovery-restore/predecessor/collection');
  if (lstatExists(stage)) {
    if (treeDigest(stage) !== entry.tree_digest
        || nativeIdentity(plan.home, stage).security_metadata_hash !== entry.security_metadata_hash) {
      fail('recovery_stage_conflict', 'predecessor collection recovery stage changed', 'recovery_required');
    }
    return stage;
  }
  const partial = `${stage}.partial`;
  if (lstatExists(partial)) {
    if (sourceMatchesDirectory(plan, partial, entry)) {
      moveCollectionEntryExclusive({
        home: plan.home,
        source: partial,
        destination: stage,
        expectedManifest: nativeManifest(plan.home, partial),
      });
      return stage;
    }
    isolateInvalidRecoveryPartial(plan, paths, partial, 'predecessor-collection');
  }
  const source = preferredSource ?? validatePredecessorCollectionRecoverySource(plan, paths);
  if (preferredSource !== null
      && (treeDigest(source) !== entry.tree_digest
        || nativeIdentity(plan.home, source).security_metadata_hash !== entry.security_metadata_hash)) {
    fail('recovery_source_drift', 'preferred predecessor collection source changed', 'recovery_required');
  }
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  const copied = spawnSync('/usr/bin/ditto', ['--rsrc', '--extattr', '--acl', source, partial], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
  });
  if (copied.status !== 0 || !sourceMatchesDirectory(plan, partial, entry)) {
    fail('recovery_restore_copy_failed', 'cannot stage predecessor collection recovery', 'recovery_required');
  }
  moveCollectionEntryExclusive({
    home: plan.home,
    source: partial,
    destination: stage,
    expectedManifest: nativeManifest(plan.home, partial),
  });
  return stage;
}

function validatePredecessorExposureRecoverySource(plan, paths, exposure) {
  const source = predecessorExposurePath(paths.recoveryPreState, exposure);
  if (!exactManagedSymlink(source, exposure.raw_target)
      || nativeIdentity(plan.home, source).security_metadata_hash !== exposure.security_metadata_hash) {
    fail('recovery_source_drift', `independent predecessor exposure recovery changed: ${exposure.path}`, 'recovery_required');
  }
  return source;
}

function stagePredecessorExposureRecovery(plan, paths, exposure, preferredSource = null) {
  const stage = predecessorExposurePath(join(paths.quarantineOperationRoot, 'recovery-restore'), exposure);
  if (lstatExists(stage)) {
    if (!exactManagedSymlink(stage, exposure.raw_target)
        || nativeIdentity(plan.home, stage).security_metadata_hash !== exposure.security_metadata_hash) {
      fail('recovery_stage_conflict', `predecessor exposure recovery stage changed: ${exposure.path}`, 'recovery_required');
    }
    return stage;
  }
  const partial = `${stage}.partial`;
  if (lstatExists(partial)) {
    if (sourceMatchesExposure(plan, partial, exposure)) {
      moveCollectionEntryExclusive({
        home: plan.home,
        source: partial,
        destination: stage,
        expectedManifest: nativeManifest(plan.home, partial),
      });
      return stage;
    }
    isolateInvalidRecoveryPartial(
      plan,
      paths,
      partial,
      `predecessor-exposure-${exposure.scope === 'global' ? 'global' : exposure.agent}`,
    );
  }
  const source = preferredSource ?? validatePredecessorExposureRecoverySource(plan, paths, exposure);
  if (preferredSource !== null
      && (!exactManagedSymlink(source, exposure.raw_target)
        || nativeIdentity(plan.home, source).security_metadata_hash !== exposure.security_metadata_hash)) {
    fail('recovery_source_drift', `preferred predecessor exposure source changed: ${exposure.path}`, 'recovery_required');
  }
  mkdirSync(dirname(stage), { recursive: true, mode: 0o700 });
  const copied = spawnSync('/bin/cp', ['-a', source, partial], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: plan.home, LANG: 'C', LC_ALL: 'C' },
  });
  if (copied.status !== 0 || !sourceMatchesExposure(plan, partial, exposure)) {
    fail('recovery_restore_copy_failed', `cannot stage predecessor exposure recovery: ${exposure.path}`, 'recovery_required');
  }
  moveCollectionEntryExclusive({
    home: plan.home,
    source: partial,
    destination: stage,
    expectedManifest: nativeManifest(plan.home, partial),
  });
  return stage;
}

function predecessorCollectionMatches(plan, { requireNativeManifest = false } = {}) {
  const entry = plan.predecessor.collection;
  try {
    const identity = nativeIdentity(plan.home, entry.path);
    return treeDigest(entry.path) === entry.tree_digest
      && identity.security_metadata_hash === entry.security_metadata_hash
      && (!requireNativeManifest || identity.manifest_hash === entry.native_manifest);
  } catch { return false; }
}

function predecessorExposureMatches(plan, exposure, { requireNativeManifest = false } = {}) {
  try {
    const identity = nativeIdentity(plan.home, exposure.path);
    return exactManagedSymlink(exposure.path, exposure.raw_target)
      && identity.security_metadata_hash === exposure.security_metadata_hash
      && (!requireNativeManifest || identity.manifest_hash === exposure.native_manifest);
  } catch { return false; }
}

function restorePredecessorControl(plan, paths) {
  const predecessor = plan.predecessor.active_record;
  if (!lstatExists(paths.activePath)) {
    createActiveExclusive(plan, paths, predecessor);
    return;
  }
  const active = validateActiveRecord(
    readPrivateJson(plan.home, paths.activePath, 'invalid_active_generation').value,
  );
  const currentOwned = active.operation_id === paths.id && active.plan_hash === plan.plan_hash;
  const predecessorOwned = canonicalJson(active) === canonicalJson(predecessor);
  if (!currentOwned && !predecessorOwned) {
    fail('active_generation_conflict', 'active ProdCraft generation changed during rollback', 'recovery_required');
  }
  if (predecessorOwned) return;
  replaceActiveCas(plan, paths, active, predecessor);
}

function removeInitialActiveIfOwned(plan, paths) {
  archiveInitialActive(plan, paths, 'active.rolled-back.json');
}

function restoreSuccessorPreState(plan, paths) {
  let recreatedFromRecovery = false;
  let currentGenerationPublished = false;
  const predecessorOperation = loadOperationPlan(plan.home, plan.predecessor.operation_id);
  if (predecessorOperation.plan.plan_hash !== plan.predecessor.plan_hash
      || predecessorOperation.operation.state !== OPERATION_STATES.committed) {
    fail('predecessor_control_drift', 'predecessor operation is not the exact committed generation', 'recovery_required');
  }
  validateActiveRecord(plan.predecessor.active_record, predecessorOperation.plan, 'predecessor_control_drift');
  if (lstatExists(paths.activePath)) {
    const active = validateActiveRecord(
      readPrivateJson(plan.home, paths.activePath, 'invalid_active_generation').value,
    );
    const currentOwned = active.operation_id === paths.id && active.plan_hash === plan.plan_hash;
    const predecessorOwned = canonicalJson(active) === canonicalJson(plan.predecessor.active_record);
    if (!currentOwned && !predecessorOwned) {
      fail('active_generation_conflict', 'active ProdCraft generation changed during rollback', 'recovery_required');
    }
    currentGenerationPublished = currentOwned;
  }
  let currentCollectionOwned = false;
  if (lstatExists(plan.predecessor.collection.path)) {
    currentCollectionOwned = publishedCollectionMatches(plan, paths);
    currentGenerationPublished ||= currentCollectionOwned;
    if (!currentCollectionOwned && !predecessorCollectionMatches(plan)) {
      fail('rollback_conflict', 'current collection has no exact recognized generation identity', 'recovery_required');
    }
  }

  const collectionPath = plan.predecessor.collection.path;
  const collectionQuarantine = join(paths.quarantineOperationRoot, 'predecessor', 'collection');
  const collectionQuarantineValid = lstatExists(collectionQuarantine)
    && manifestMatches(plan.home, collectionQuarantine, plan.predecessor.collection.native_manifest);
  const collectionAlreadyPredecessor = lstatExists(collectionPath)
    && predecessorCollectionMatches(plan);
  let collectionAction = null;
  if (!collectionAlreadyPredecessor) {
    if (lstatExists(collectionPath) && !currentCollectionOwned) {
      fail('rollback_conflict', 'current collection is not owned by the interrupted generation', 'recovery_required');
    }
    const postState = join(paths.quarantineOperationRoot, 'post-state/rollback/prodcraft');
    if (lstatExists(collectionPath) && lstatExists(postState)) {
      fail('rollback_conflict', 'rollback post-state collection already exists', 'recovery_required');
    }
    const stage = stagePredecessorCollectionRecovery(
      plan,
      paths,
      collectionQuarantineValid ? collectionQuarantine : null,
    );
    recreatedFromRecovery ||= !collectionQuarantineValid;
    collectionAction = {
      current: lstatExists(collectionPath) ? collectionPath : null,
      postState,
      stage,
      destination: collectionPath,
    };
  }

  const exposureActions = [];
  for (const exposure of plan.predecessor.exposures) {
    if (exposure.scope === 'agent' && !lstatExists(exposure.root)) continue;
    const postState = predecessorExposurePath(
      join(paths.quarantineOperationRoot, 'post-state/rollback'),
      exposure,
    );
    const stagePath = predecessorExposurePath(
      join(paths.quarantineOperationRoot, 'recovery-restore'),
      exposure,
    );
    const exactPredecessor = lstatExists(exposure.path)
      && predecessorExposureMatches(plan, exposure, { requireNativeManifest: true });
    const semanticPredecessor = lstatExists(exposure.path)
      && predecessorExposureMatches(plan, exposure);
    const reentrantPredecessor = semanticPredecessor
      && exactManagedSymlink(postState, exposure.raw_target)
      && !lstatExists(stagePath);
    if (exactPredecessor || (!currentGenerationPublished && semanticPredecessor)
        || reentrantPredecessor) continue;
    if (lstatExists(exposure.path)) {
      if (!currentGenerationPublished || !exactManagedSymlink(exposure.path, exposure.raw_target)) {
        fail('rollback_conflict', `current exposure is not owned by the interrupted generation: ${exposure.path}`, 'recovery_required');
      }
      if (lstatExists(postState)) {
        fail('rollback_conflict', `rollback post-state exposure exists: ${exposure.path}`, 'recovery_required');
      }
    }
    const quarantined = predecessorExposurePath(paths.quarantineOperationRoot, exposure);
    const quarantineValid = lstatExists(quarantined)
      && manifestMatches(plan.home, quarantined, exposure.native_manifest);
    const stage = stagePredecessorExposureRecovery(
      plan,
      paths,
      exposure,
      quarantineValid ? quarantined : null,
    );
    recreatedFromRecovery ||= !quarantineValid;
    exposureActions.push({
      exposure,
      current: lstatExists(exposure.path) ? exposure.path : null,
      postState,
      stage,
    });
  }

  if (collectionAction !== null && collectionAction.current !== null) {
    moveCollectionEntryExclusive({
      home: plan.home,
      source: collectionAction.current,
      destination: collectionAction.postState,
    });
  }
  for (const action of exposureActions) {
    if (action.current !== null) {
      moveCollectionEntryExclusive({
        home: plan.home,
        source: action.current,
        destination: action.postState,
      });
    }
  }
  if (collectionAction !== null) {
    moveCollectionEntryExclusive({
      home: plan.home,
      source: collectionAction.stage,
      destination: collectionAction.destination,
    });
  }
  for (const action of exposureActions) {
    moveCollectionEntryExclusive({
      home: plan.home,
      source: action.stage,
      destination: action.exposure.path,
    });
  }
  restorePredecessorControl(plan, paths);
  return recreatedFromRecovery;
}

function verifyInitialRollbackOwnership(plan, paths) {
  if (lstatExists(paths.activePath)) {
    const active = validateActiveRecord(
      readPrivateJson(plan.home, paths.activePath, 'invalid_active_generation').value,
    );
    if (active.operation_id !== paths.id || active.plan_hash !== plan.plan_hash) {
      fail('active_generation_conflict', 'another ProdCraft generation is active', 'recovery_required');
    }
  }
  if (!lstatExists(plan.target.collection_root)) return false;
  if (publishedCollectionMatches(plan, paths)) return true;
  const indexPath = join(plan.target.collection_root, 'INDEX.json');
  if (lstatExists(indexPath)) {
    fail('rollback_conflict', 'published collection is not the exact interrupted generation', 'recovery_required');
  }
  const legacyGateway = plan.legacy.find(({ name }) => name === 'prodcraft');
  if (!legacyGateway || treeDigest(plan.target.collection_root) !== legacyGateway.tree_digest) {
    fail('rollback_conflict', 'collection path is neither authorized legacy nor current post-state', 'recovery_required');
  }
  return false;
}

function preflightInitialRollback(plan, paths, publishedCollection, {
  activeArchiveName = 'active.rolled-back.json',
  postCollectionPath = join(paths.quarantineOperationRoot, 'post-state/prodcraft'),
} = {}) {
  let recreatedFromRecovery = false;
  const activeArchive = join(paths.operationRoot, activeArchiveName);
  if (lstatExists(paths.activePath) && lstatExists(activeArchive)) {
    fail('active_generation_conflict', 'rollback active archive already exists', 'recovery_required');
  }
  if (!lstatExists(paths.activePath) && lstatExists(activeArchive)) {
    const archived = readPrivateJson(plan.home, activeArchive, 'invalid_active_generation').value;
    validateActiveRecord(archived, plan);
  }
  if (publishedCollection && lstatExists(postCollectionPath)) {
    fail('rollback_conflict', 'rollback post-state collection already exists', 'recovery_required');
  }
  if (lstatExists(plan.target.gateway_projection)
      && !exactManagedSymlink(plan.target.gateway_projection, plan.target.gateway_raw_target)) {
    fail('rollback_conflict', 'gateway projection changed before rollback', 'recovery_required');
  }
  for (const root of plan.agent_roots) {
    if (!lstatExists(root.root)) continue;
    const gateway = join(root.root, 'pc-prodcraft');
    if (lstatExists(gateway)
        && !exactManagedSymlink(gateway, plan.target.agent_gateway_raw_target)) {
      fail('rollback_conflict', `agent gateway changed before rollback: ${gateway}`, 'recovery_required');
    }
  }
  const legacyActions = [];
  for (const entry of plan.legacy) {
    const currentIsPublishedCollection = entry.name === 'prodcraft' && publishedCollection;
    if (lstatExists(entry.path) && !currentIsPublishedCollection
        && !sourceMatchesDirectory(plan, entry.path, entry)) {
      fail('rollback_conflict', `legacy destination has foreign content: ${entry.path}`, 'recovery_required');
    }
    if (lstatExists(entry.path) && !currentIsPublishedCollection
        && !sourceMatchesDirectory(plan, entry.path, entry, { requireManifest: true })) {
      recreatedFromRecovery = true;
    }
    if (!lstatExists(entry.path) || currentIsPublishedCollection) {
      const quarantine = join(paths.quarantineOperationRoot, 'skills', entry.name);
      const quarantineValid = sourceMatchesDirectory(plan, quarantine, entry, { requireManifest: true });
      const source = quarantineValid ? quarantine : stageLegacyFromRecovery(plan, paths, entry);
      legacyActions.push({
        entry,
        source,
        expectedManifest: nativeManifest(plan.home, source),
        recreatedFromRecovery: !quarantineValid,
      });
    }
  }
  const projectionActions = [];
  for (const link of plan.projections) {
    if (!lstatExists(link.root)) continue;
    if (lstatExists(link.path) && !sourceMatchesExposure(plan, link.path, link)) {
      fail('rollback_conflict', `legacy projection destination has foreign content: ${link.path}`, 'recovery_required');
    }
    if (lstatExists(link.path)
        && !sourceMatchesExposure(plan, link.path, link, { requireManifest: true })) {
      recreatedFromRecovery = true;
    }
    if (!lstatExists(link.path)) {
      const quarantine = join(paths.quarantineOperationRoot, 'projections', link.agent, link.name);
      const quarantineValid = sourceMatchesExposure(plan, quarantine, link, { requireManifest: true });
      const source = quarantineValid ? quarantine : stageProjectionFromRecovery(plan, paths, link);
      projectionActions.push({
        link,
        source,
        expectedManifest: nativeManifest(plan.home, source),
        recreatedFromRecovery: !quarantineValid,
      });
    }
  }
  return { legacyActions, projectionActions, recreatedFromRecovery };
}

function rollbackApply(plan, paths) {
  let recreatedFromRecovery = false;
  writeOperation(paths, plan, OPERATION_STATES.rollingBack, { mutationOccurred: true });
  if (isSuccessorPlan(plan)) {
    recreatedFromRecovery = restoreSuccessorPreState(plan, paths);
    verifyExactPreState(plan, { allowRecreatedIdentity: true });
    writeOperation(paths, plan, OPERATION_STATES.rolledBack, {
      mutationOccurred: true,
      errorCode: recreatedFromRecovery ? 'restored_from_independent_recovery' : null,
    });
    return { recreatedFromRecovery };
  }
  const publishedCollection = verifyInitialRollbackOwnership(plan, paths);
  const restore = preflightInitialRollback(plan, paths, publishedCollection);
  recreatedFromRecovery = restore.recreatedFromRecovery;
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
  for (const action of restore.legacyActions) {
    moveCollectionEntryExclusive({
      home: plan.home,
      source: action.source,
      destination: action.entry.path,
      expectedManifest: action.expectedManifest,
    });
    recreatedFromRecovery ||= action.recreatedFromRecovery;
  }
  for (const action of restore.projectionActions) {
    moveCollectionEntryExclusive({
      home: plan.home,
      source: action.source,
      destination: action.link.path,
      expectedManifest: action.expectedManifest,
    });
    recreatedFromRecovery ||= action.recreatedFromRecovery;
  }
  removeInitialActiveIfOwned(plan, paths);
  verifyExactPreState(plan, { allowRecreatedIdentity: recreatedFromRecovery });
  writeOperation(paths, plan, OPERATION_STATES.rolledBack, {
    mutationOccurred: true,
    errorCode: recreatedFromRecovery ? 'restored_from_independent_recovery' : null,
  });
  return { recreatedFromRecovery };
}

function verifyExactPreState(plan, { allowRecreatedIdentity = false } = {}) {
  if (isSuccessorPlan(plan)) {
    if (!predecessorCollectionMatches(plan, { requireNativeManifest: !allowRecreatedIdentity })) {
      fail('prestate_identity_drift', 'predecessor collection mismatch after recovery', 'recovery_required');
    }
    for (const exposure of plan.predecessor.exposures) {
      if (exposure.scope === 'agent' && !lstatExists(exposure.root)) continue;
      if (!predecessorExposureMatches(plan, exposure, { requireNativeManifest: !allowRecreatedIdentity })) {
        fail('prestate_projection_drift', `predecessor exposure mismatch after recovery: ${exposure.path}`, 'recovery_required');
      }
    }
    const active = validateActiveRecord(
      readPrivateJson(plan.home, operationPaths(plan).activePath, 'invalid_active_generation').value,
    );
    if (canonicalJson(active) !== canonicalJson(plan.predecessor.active_record)) {
      fail('prestate_active_drift', 'predecessor active record mismatch after recovery', 'recovery_required');
    }
    const predecessor = loadOperationPlan(plan.home, plan.predecessor.operation_id);
    if (predecessor.operation.state !== OPERATION_STATES.committed) {
      fail('prestate_status_drift', 'predecessor operation is not committed after recovery', 'recovery_required');
    }
    return;
  }
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
  let stageOwned = false;
  try {
    verifyPreconditions(plan);
    if (lstatExists(paths.operationRoot) || lstatExists(paths.quarantineOperationRoot)) fail('operation_conflict', `operation already exists: ${paths.id}`);
    mkdirSync(paths.operationRoot, { recursive: true, mode: 0o700 });
    durableJson(paths.planPath, plan);
    writeOperation(paths, plan, OPERATION_STATES.planned);
    assertSafeManagedPath(plan.home, paths.stageRoot);
    if (lstatExists(paths.stageRoot)) fail('stage_conflict', `staging root already exists: ${paths.stageRoot}`);
    mkdirSync(dirname(paths.stageRoot), { recursive: true, mode: 0o700 });
    chmodSync(dirname(paths.stageRoot), 0o700);
    mkdirSync(paths.stageRoot, { recursive: false, mode: 0o700 });
    stageOwned = true;
    chmodSync(paths.stageRoot, 0o700);
    ensureArtifact(plan, paths);
    materializeCollection(plan, paths);
    copyRecovery(plan, paths);
    writeOperation(paths, plan, OPERATION_STATES.prepared);
    injectFault('after_prepared', faultPhase, killPhase);
    writeOperation(paths, plan, OPERATION_STATES.applying, { mutationOccurred: true });
    mutationOccurred = true;

    const projectionPayloads = isSuccessorPlan(plan) ? plan.predecessor.exposures : plan.projections;
    for (const link of projectionPayloads) {
      const target = isSuccessorPlan(plan)
        ? predecessorExposurePath(paths.quarantineOperationRoot, link)
        : join(paths.quarantineOperationRoot, 'projections', link.agent, link.name);
      moveCollectionEntryExclusive({ home: plan.home, source: link.path, destination: target, expectedManifest: link.native_manifest });
    }
    injectFault('after_projection_quarantine', faultPhase, killPhase);
    const directoryPayloads = isSuccessorPlan(plan) ? [plan.predecessor.collection] : plan.legacy;
    for (const entry of directoryPayloads) {
      const target = isSuccessorPlan(plan)
        ? join(paths.quarantineOperationRoot, 'predecessor', 'collection')
        : join(paths.quarantineOperationRoot, 'skills', entry.name);
      moveCollectionEntryExclusive({ home: plan.home, source: entry.path, destination: target, expectedManifest: entry.native_manifest });
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
    const activatedAt = new Date().toISOString();
    publishActiveRecord(plan, paths, activeRecord(plan, paths, activatedAt));
    injectFault('after_active_publish', faultPhase, killPhase);
    const status = statusAgainstPlan(plan, paths, { requireCommitted: false });
    if (status.status !== 'FILESYSTEM_READY') fail('postcondition_failed', `postcondition failed: ${status.issues.join(', ')}`, 'recovery_required');
    writeOperation(paths, plan, OPERATION_STATES.committed, { mutationOccurred: true });
    return { schema_version: 'skills-refiner.collection.apply.v1', status: 'FILESYSTEM_READY', runtime_status: 'UNVERIFIED', operation_id: paths.id, plan_hash: plan.plan_hash, mutation_occurred: true, recovery_root: paths.recoveryOperationRoot, quarantine_root: paths.quarantineOperationRoot };
  } catch (error) {
    if (error instanceof MacosAdapterError && error.mutationMayHaveOccurred) mutationOccurred = true;
    if (mutationOccurred) {
      try { rollbackApply(plan, paths); } catch (rollbackError) {
        try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: rollbackError.code ?? 'rollback_failed' }); } catch {}
        fail('recovery_required', `apply failed and rollback did not complete: ${rollbackError.message}`, 'recovery_required');
      }
    } else {
      if (lstatExists(paths.recoveryOperationRoot)) rmSync(paths.recoveryOperationRoot, { recursive: true, force: true });
      if (lstatExists(paths.quarantineOperationRoot)) rmSync(paths.quarantineOperationRoot, { recursive: true, force: true });
      if (lstatExists(paths.operationRoot)) rmSync(paths.operationRoot, { recursive: true, force: true });
    }
    if (error instanceof MacosAdapterError) {
      fail('native_mutation_blocked', `native collection mutation blocked: ${error.reason}`);
    }
    throw error;
  } finally {
    if (stageOwned && lstatExists(paths.stageRoot)) rmSync(paths.stageRoot, { recursive: true, force: true });
    releaseLock(paths, lock);
  }
}

function statusAgainstPlan(plan, paths = operationPaths(plan), { requireCommitted = true } = {}) {
  const issues = [];
  let index = null;
  let expectedIndex = null;
  let observedOperation = null;
  let observedActive = null;
  try {
    observedOperation = readPrivateJson(plan.home, paths.operationPath, 'invalid_operation').value;
    validateOperationRecord(observedOperation);
    if (observedOperation.operation_id !== paths.id || observedOperation.plan_hash !== plan.plan_hash) issues.push('OPERATION_IDENTITY_DRIFT');
    if (requireCommitted && observedOperation.state !== OPERATION_STATES.committed) issues.push(`OPERATION_NOT_COMMITTED:${observedOperation.state}`);
  } catch { issues.push('OPERATION_MISSING_OR_INVALID'); }
  try {
    const recoveryPlan = readPrivateJson(
      plan.home,
      paths.recoveryPlanPath,
      'invalid_recovery_plan',
    ).value;
    validateCollectionPlan(recoveryPlan);
    if (canonicalJson(recoveryPlan) !== canonicalJson(plan)) issues.push('RECOVERY_PLAN_DRIFT');
  } catch { issues.push('RECOVERY_PLAN_MISSING_OR_INVALID'); }
  try {
    const recoveryManifest = readPrivateJson(
      plan.home,
      join(paths.recoveryOperationRoot, 'manifest.json'),
      'invalid_recovery_manifest',
    ).value;
    if (canonicalJson(recoveryManifest)
        !== canonicalJson(expectedRecoveryManifest(plan, paths))) {
      issues.push('RECOVERY_MANIFEST_DRIFT');
    }
  } catch { issues.push('RECOVERY_MANIFEST_MISSING_OR_INVALID'); }
  try {
    observedActive = validateActiveRecord(
      readPrivateJson(plan.home, paths.activePath, 'invalid_active_generation').value,
      plan,
    );
  } catch { issues.push('ACTIVE_GENERATION_MISSING_OR_INVALID'); }
  try {
    const rootStat = lstatSync(plan.target.collection_root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) issues.push('COLLECTION_ROOT_NOT_REAL_DIRECTORY');
    else if ((rootStat.mode & 0o777) !== 0o755) issues.push('COLLECTION_ROOT_MODE_DRIFT');
  } catch { issues.push('COLLECTION_ROOT_MISSING'); }
  if (lstatExists(join(plan.target.collection_root, 'SKILL.md'))) issues.push('COLLECTION_ROOT_HAS_SKILL_MD');
  try {
    index = readJson(join(plan.target.collection_root, 'INDEX.json'), 'invalid_index');
    validateCollectionIndex(index);
    expectedIndex = expectedCollectionIndex(plan, paths);
    if (canonicalJson(index) !== canonicalJson(expectedIndex)) issues.push('INDEX_IDENTITY_DRIFT');
  } catch { issues.push('INDEX_MISSING_OR_INVALID'); }
  try {
    const artifactRootMode = lstatSync(paths.artifactRepo).mode & 0o777;
    if ((artifactRootMode & 0o500) !== 0o500 || (artifactRootMode & 0o022) !== 0) issues.push('ARTIFACT_ROOT_MODE_UNSAFE');
    if (lstatExists(join(paths.artifactRepo, '.git'))) issues.push('ARTIFACT_CONTAINS_GIT_METADATA');
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
        if ((lstatSync(path).mode & 0o777) !== 0o755) issues.push(`MEMBER_ROOT_MODE_DRIFT:${member.name}`);
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
    // Agent 根目录本身可能随宿主卸载而消失。不存在的宿主不再属于当前
    // runtime surface；只有根仍存在时，才要求它保持受管 gateway。
    if (lstatExists(root.root)
        && !exactManagedSymlink(join(root.root, 'pc-prodcraft'), plan.target.agent_gateway_raw_target)) {
      issues.push(`AGENT_GATEWAY_DRIFT:${root.agent}`);
    }
  }
  const retiredTopology = isSuccessorPlan(plan)
    ? {
      names: plan.predecessor.retired_names,
      projections: plan.predecessor.retired_projections,
    }
    : {
      names: plan.legacy.map(({ name }) => name),
      projections: plan.projections.map(({ agent, root, name, path }) => ({ agent, root, name, path })),
    };
  for (const name of retiredTopology.names) {
    if (name !== 'prodcraft' && lstatExists(join(plan.home, '.agents/skills', name))) {
      issues.push(`LEGACY_REAPPEARED:${name}`);
    }
  }
  for (const projection of retiredTopology.projections) {
    if (lstatExists(projection.path)) {
      issues.push(`LEGACY_PROJECTION_REAPPEARED:${projection.agent}:${projection.name}`);
    }
  }
  for (const name of PUBLIC_MEMBER_NAMES) {
    const topLevel = join(plan.home, '.agents/skills', name);
    if (name !== 'pc-prodcraft' && lstatExists(topLevel)) issues.push(`COMPETING_TOP_LEVEL_MEMBER:${name}`);
  }
  for (const entry of plan.legacy) {
    const quarantined = join(paths.quarantineOperationRoot, 'skills', entry.name);
    try {
      if (treeDigest(quarantined) !== entry.tree_digest) issues.push(`QUARANTINE_DRIFT:${entry.name}`);
      if (nativeIdentity(plan.home, quarantined).security_metadata_hash !== entry.security_metadata_hash) issues.push(`QUARANTINE_METADATA_DRIFT:${entry.name}`);
    } catch { issues.push(`QUARANTINE_MISSING_OR_INVALID:${entry.name}`); }
    const recovered = join(paths.recoveryPreState, 'skills', entry.name);
    try {
      if (treeDigest(recovered) !== entry.tree_digest) issues.push(`RECOVERY_DRIFT:${entry.name}`);
      if (nativeIdentity(plan.home, recovered).security_metadata_hash !== entry.security_metadata_hash) issues.push(`RECOVERY_METADATA_DRIFT:${entry.name}`);
    } catch { issues.push(`RECOVERY_MISSING_OR_INVALID:${entry.name}`); }
  }
  for (const link of plan.projections) {
    const quarantined = join(paths.quarantineOperationRoot, 'projections', link.agent, link.name);
    if (!exactManagedSymlink(quarantined, link.raw_target)) issues.push(`QUARANTINE_PROJECTION_DRIFT:${link.agent}:${link.name}`);
    else {
      try {
        if (nativeIdentity(plan.home, quarantined).security_metadata_hash !== link.security_metadata_hash) issues.push(`QUARANTINE_PROJECTION_METADATA_DRIFT:${link.agent}:${link.name}`);
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
  if (isSuccessorPlan(plan)) {
    const quarantinedCollection = join(paths.quarantineOperationRoot, 'predecessor', 'collection');
    const recoveredCollection = join(paths.recoveryPreState, 'predecessor', 'collection');
    try {
      const identity = nativeIdentity(plan.home, quarantinedCollection);
      if (treeDigest(quarantinedCollection) !== plan.predecessor.collection.tree_digest
          || identity.security_metadata_hash !== plan.predecessor.collection.security_metadata_hash) {
        issues.push('PREDECESSOR_QUARANTINE_DRIFT');
      }
    } catch { issues.push('PREDECESSOR_QUARANTINE_MISSING_OR_INVALID'); }
    try {
      const identity = nativeIdentity(plan.home, recoveredCollection);
      if (treeDigest(recoveredCollection) !== plan.predecessor.collection.tree_digest
          || identity.security_metadata_hash !== plan.predecessor.collection.security_metadata_hash) {
        issues.push('PREDECESSOR_RECOVERY_DRIFT');
      }
    } catch { issues.push('PREDECESSOR_RECOVERY_MISSING_OR_INVALID'); }
    for (const exposure of plan.predecessor.exposures) {
      const label = exposure.scope === 'global' ? 'global' : exposure.agent;
      for (const [kind, base] of [
        ['QUARANTINE', paths.quarantineOperationRoot],
        ['RECOVERY', paths.recoveryPreState],
      ]) {
        const candidate = predecessorExposurePath(base, exposure);
        try {
          if (!exactManagedSymlink(candidate, exposure.raw_target)
              || nativeIdentity(plan.home, candidate).security_metadata_hash !== exposure.security_metadata_hash) {
            issues.push(`PREDECESSOR_${kind}_EXPOSURE_DRIFT:${label}`);
          }
        } catch { issues.push(`PREDECESSOR_${kind}_EXPOSURE_MISSING_OR_INVALID:${label}`); }
      }
    }
  }
  try {
    if (sha256(readFileSync(join(paths.recoveryPreState, 'skill-lock.json'))) !== plan.receipt.digest) issues.push('RECOVERY_RECEIPT_DRIFT');
  } catch { issues.push('RECOVERY_RECEIPT_MISSING'); }
  let receiptState = 'unknown';
  try {
    const receiptBytes = readFileSync(plan.receipt.path);
    const receiptData = JSON.parse(receiptBytes.toString('utf8'));
    const scopedEntries = Object.entries(receiptData.skills ?? {})
      .filter(([, value]) => value?.source === RECEIPT_SOURCE)
      .map(([name, receipt]) => ({ name, receipt }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
    const scopedDigest = sha256(Buffer.from(canonicalJson(scopedEntries)));
    receiptState = sha256(receiptBytes) === plan.receipt.digest ? 'superseded'
      : scopedDigest === plan.receipt.entries_digest ? 'unrelated_history_changed' : 'drifted';
  } catch { receiptState = 'missing'; }
  const receiptHistory = receiptHistoryFromPlan(plan);
  const currentActivatedAt = observedActive?.schema_version === 'skills-refiner.collection.active.v2'
    ? observedActive.activated_at : null;
  const firstActivatedAt = isSuccessorPlan(plan)
    ? plan.predecessor.first_activated_at
    : currentActivatedAt;
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
    source: {
      provider: plan.source.provider, repository_id: plan.source.repository_id,
      resolved_revision: plan.source.revision, artifact_digest: plan.source.tree_digest,
      upstream_release: observeUpstreamVersion(paths.artifactRepo, { path: 'manifest.yml', format: 'yaml_root_version' }),
    },
    lifecycle: {
      receipt_history: {
        entry_count: receiptHistory.entry_count,
        first_installed_at: receiptHistory.first_installed_at,
        last_updated_at: receiptHistory.last_updated_at,
      },
      plan_created_at: plan.created_at,
      first_activated_at: firstActivatedAt,
      current_generation_activated_at: currentActivatedAt,
    },
    issues,
  };
}

function loadActivePlan(home) {
  const controlRoot = join(home, '.agents/skill-control/collections/prodcraft');
  const activePath = join(controlRoot, 'active.json');
  if (!lstatExists(activePath)) return null;
  const active = readPrivateJson(home, activePath, 'invalid_active_generation').value;
  const planPath = join(controlRoot, 'operations', active.operation_id, 'plan.json');
  const plan = readPrivateJson(home, planPath, 'invalid_active_plan').value;
  validateCollectionPlan(plan);
  validateActiveRecord(active, plan);
  return plan;
}

function loadOperationPlan(home, id) {
  if (!/^prodcraft-[0-9a-f]{12}$/u.test(id)) fail('invalid_operation_id', 'invalid ProdCraft operation id');
  const root = join(home, '.agents/skill-control/collections/prodcraft/operations', id);
  const plan = readPrivateJson(home, join(root, 'plan.json'), 'invalid_operation_plan').value;
  validateCollectionPlan(plan);
  if (operationId(plan) !== id) fail('invalid_operation_plan', 'operation id does not match plan authorization');
  const operation = readPrivateJson(home, join(root, 'operation.json'), 'invalid_operation').value;
  validateOperationRecord(operation);
  if (operation.operation_id !== id || operation.plan_hash !== plan.plan_hash) fail('invalid_operation', 'operation record does not match plan');
  return { plan, operation };
}

function operationIds(home) {
  const operationsRoot = join(home, '.agents/skill-control/collections/prodcraft/operations');
  try {
    const entries = readdirSync(operationsRoot, { withFileTypes: true })
      .filter((entry) => /^prodcraft-[0-9a-f]{12}$/u.test(entry.name));
    if (entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
      fail('invalid_operation_root', 'ProdCraft operation root contains an unsafe operation entry', 'recovery_required');
    }
    return entries.map(({ name }) => name).sort();
  } catch (error) {
    if (error instanceof ProdcraftCollectionError) throw error;
    return [];
  }
}

function pendingOperation(home, { tolerateInvalidOperationId = null } = {}) {
  const pending = [];
  for (const id of operationIds(home)) {
    let loaded;
    try { loaded = loadOperationPlan(home, id); } catch (error) {
      if (id === tolerateInvalidOperationId) continue;
      throw error;
    }
    if (![
      OPERATION_STATES.committed,
      OPERATION_STATES.rolledBack,
      OPERATION_STATES.restored,
    ].includes(loaded.operation.state)) {
      pending.push({ id, ...loaded });
    }
  }
  if (pending.length > 1) fail('ambiguous_operations', 'multiple nonterminal ProdCraft operations require operator review', 'recovery_required');
  return pending[0] ?? null;
}

function committedLineageTips(home) {
  const committed = new Map();
  for (const id of operationIds(home)) {
    const loaded = loadOperationPlan(home, id);
    if (loaded.operation.state === OPERATION_STATES.committed) committed.set(id, loaded);
  }
  const superseded = new Set();
  for (const [id, loaded] of committed) {
    if (!isSuccessorPlan(loaded.plan)) continue;
    const predecessor = committed.get(loaded.plan.predecessor.operation_id);
    if (predecessor === undefined
        || predecessor.plan.plan_hash !== loaded.plan.predecessor.plan_hash) {
      fail(
        'committed_lineage_drift',
        `committed successor ${id} does not bind an exact committed predecessor`,
        'recovery_required',
      );
    }
    superseded.add(loaded.plan.predecessor.operation_id);
  }
  const tips = [...committed.entries()].filter(([id]) => !superseded.has(id));
  return tips.map(([id, loaded]) => ({ id, ...loaded }));
}

function committedLineageTip(home) {
  const tips = committedLineageTips(home);
  if (tips.length !== 1) {
    fail(
      'ambiguous_committed_lineage',
      `ProdCraft committed lineage has ${tips.length} tips`,
      'recovery_required',
    );
  }
  return tips[0];
}

function assertCommittedLineageTip(home, operationIdValue) {
  const tip = committedLineageTip(home);
  if (tip.id !== operationIdValue) {
    fail(
      'superseded_generation',
      'ProdCraft generation is not the unique committed lineage tip',
      'recovery_required',
    );
  }
  return tip;
}

function orphanedProdcraftStatus(home) {
  const root = join(home, '.agents/skills/prodcraft');
  const indexPath = join(root, 'INDEX.json');
  if (!lstatExists(indexPath)) {
    let tips = [];
    let lineageInvalid = false;
    try { tips = committedLineageTips(home); } catch { lineageInvalid = true; }
    if (!lineageInvalid && tips.length === 0) return null;
    const tip = tips.length === 1 ? tips[0] : null;
    const issue = lineageInvalid || tips.length !== 1
      ? 'ORPHANED_LINEAGE_DRIFT'
      : (lstatExists(root) ? 'ORPHANED_COLLECTION_CONTROL' : 'ORPHANED_COLLECTION_MISSING');
    return {
      schema_version: 'skills-refiner.collection.status.v1',
      collection_id: 'prodcraft',
      status: 'RECOVERY_REQUIRED',
      scope: 'filesystem',
      runtime_status: 'UNVERIFIED',
      observed_at: new Date().toISOString(),
      observer_version: 'skills-refiner.collection.observer.v1',
      operation_id: tip?.id ?? null,
      plan_hash: tip?.plan.plan_hash ?? null,
      physical_collection_root: root,
      member_count: 0,
      external_receipt_state: 'unknown',
      source: tip === null ? null : {
        provider: tip.plan.source.provider,
        repository_id: tip.plan.source.repository_id,
        resolved_revision: tip.plan.source.revision,
        artifact_digest: tip.plan.source.tree_digest,
      },
      lifecycle: null,
      issues: [issue],
    };
  }
  let index = null;
  let planHash = null;
  let issue = 'ORPHANED_ACTIVE_POINTER';
  try {
    index = readJson(indexPath, 'invalid_physical_collection_index');
    validateCollectionIndex(index);
    const loaded = loadOperationPlan(home, index.operation_id);
    planHash = loaded.plan.plan_hash;
    if (!publishedCollectionMatches(loaded.plan, operationPaths(loaded.plan))) {
      issue = 'ORPHANED_COLLECTION_CONTROL';
    } else {
      try { assertCommittedLineageTip(home, index.operation_id); } catch {
        issue = 'ORPHANED_LINEAGE_DRIFT';
      }
    }
  } catch { issue = 'ORPHANED_COLLECTION_CONTROL'; }
  return {
    schema_version: 'skills-refiner.collection.status.v1',
    collection_id: 'prodcraft',
    status: 'RECOVERY_REQUIRED',
    scope: 'filesystem',
    runtime_status: 'UNVERIFIED',
    observed_at: new Date().toISOString(),
    observer_version: 'skills-refiner.collection.observer.v1',
    operation_id: index?.operation_id ?? null,
    plan_hash: planHash,
    physical_collection_root: root,
    member_count: Array.isArray(index?.members) ? index.members.length : 0,
    external_receipt_state: 'unknown',
    source: index?.source ?? null,
    lifecycle: null,
    issues: [issue],
  };
}

export function statusProdcraftCollection({ home }) {
  const plan = loadActivePlan(home);
  const pending = pendingOperation(home, {
    tolerateInvalidOperationId: plan === null ? null : operationId(plan),
  });
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
      source: null,
      lifecycle: null,
      issues: [`NONTERMINAL_OPERATION:${pending.operation.state}`],
    };
  }
  if (plan === null) {
    const orphaned = orphanedProdcraftStatus(home);
    if (orphaned !== null) return orphaned;
    return { schema_version: 'skills-refiner.collection.status.v1', collection_id: 'prodcraft', status: 'UNMANAGED', scope: 'filesystem', runtime_status: 'UNVERIFIED', observed_at: new Date().toISOString(), observer_version: 'skills-refiner.collection.observer.v1', operation_id: null, plan_hash: null, physical_collection_root: join(home, '.agents/skills/prodcraft'), member_count: 0, external_receipt_state: 'unknown', source: null, lifecycle: null, issues: ['NO_ACTIVE_GENERATION'] };
  }
  const result = statusAgainstPlan(plan);
  try {
    assertCommittedLineageTip(home, operationId(plan));
  } catch {
    result.issues.push('ACTIVE_LINEAGE_DRIFT');
    result.status = 'RECOVERY_REQUIRED';
  }
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
  const snapshot = readPrivateJson(plan.home, paths.lockPath, 'invalid_stale_lock');
  const lock = snapshot.value;
  if (lock.operation_id !== paths.id || lock.plan_hash !== plan.plan_hash || processIsAlive(lock.pid)) {
    fail('live_or_foreign_lock', 'collection lock is live or belongs to another operation', 'recovery_required');
  }
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

function physicalProdcraftOperationId(home) {
  const indexPath = join(home, '.agents/skills/prodcraft/INDEX.json');
  if (!lstatExists(indexPath)) return null;
  const index = readJson(indexPath, 'invalid_physical_collection_index');
  try { validateCollectionIndex(index); } catch {
    fail('invalid_physical_collection_index', 'physical ProdCraft INDEX is invalid', 'recovery_required');
  }
  const loaded = loadOperationPlan(home, index.operation_id);
  if (!publishedCollectionMatches(loaded.plan, operationPaths(loaded.plan))) {
    fail(
      'physical_collection_drift',
      'physical ProdCraft collection is not the exact generation named by its INDEX',
      'recovery_required',
    );
  }
  return index.operation_id;
}

function verifyRecoverOwnership(home, loaded, paths) {
  const pending = pendingOperation(home);
  if (pending === null || pending.id !== paths.id) {
    fail(
      'foreign_or_superseded_operation',
      'recover refuses a nonterminal operation that is not the unique pending ProdCraft generation',
    );
  }
  const activePlan = loadActivePlan(home);
  const activeId = activePlan === null ? null : operationId(activePlan);
  const physicalId = physicalProdcraftOperationId(home);
  const predecessorActive = isSuccessorPlan(loaded.plan)
    && activeId === loaded.plan.predecessor.operation_id;
  const orphanedCurrent = activeId === null && physicalId === paths.id;
  const orphanedPredecessor = activeId === null && isSuccessorPlan(loaded.plan)
    && physicalId === loaded.plan.predecessor.operation_id;
  const bootstrapPrePublish = activeId === null && !isSuccessorPlan(loaded.plan)
    && physicalId === null;
  const authorized = activeId === paths.id
    || predecessorActive
    || orphanedCurrent
    || orphanedPredecessor
    || bootstrapPrePublish;
  if (!authorized) {
    fail(
      'foreign_or_superseded_operation',
      'recover refuses an operation that is not the current or interrupted ProdCraft generation',
    );
  }
}

export function recoverProdcraftOperation({ home, operationId: requestedId, confirmation }) {
  const loaded = loadOperationPlan(home, requestedId);
  const { plan } = loaded;
  const paths = operationPaths(plan);
  if (confirmation !== paths.id) fail('confirmation_mismatch', 'recover confirmation must equal operation id');
  if ([OPERATION_STATES.rolledBack, OPERATION_STATES.restored].includes(loaded.operation.state)) {
    const current = statusProdcraftCollection({ home });
    const exact = isSuccessorPlan(plan)
      ? current.status === 'FILESYSTEM_READY'
        && current.operation_id === plan.predecessor.operation_id
      : current.status === 'UNMANAGED';
    if (!exact) fail('recover_retry_conflict', 'rolled-back operation no longer matches its restored pre-state', 'recovery_required');
    return {
      schema_version: 'skills-refiner.collection.recover.v1',
      status: 'RESTORED_PRESTATE',
      operation_id: paths.id,
      mutation_occurred: false,
      recreated_from_independent_recovery: false,
    };
  }
  if (loaded.operation.state === OPERATION_STATES.committed) {
    const active = loadActivePlan(home);
    if (active === null) {
      const pending = pendingOperation(home);
      if (pending !== null) {
        fail('ambiguous_operations', 'active pointer recovery refuses while another ProdCraft operation is nonterminal', 'recovery_required');
      }
      if (physicalProdcraftOperationId(home) !== paths.id) {
        fail('foreign_or_superseded_operation', 'recover refuses a committed generation that is not the exact physical collection');
      }
      assertCommittedLineageTip(home, paths.id);
      isolateStaleCollectionLock(plan, paths);
      const lock = acquireLock(paths, plan);
      try {
        const current = loadOperationPlan(home, requestedId);
        if (current.operation.state !== OPERATION_STATES.committed
            || loadActivePlan(home) !== null
            || physicalProdcraftOperationId(home) !== paths.id) {
          fail('active_generation_conflict', 'committed generation changed before active pointer recovery', 'recovery_required');
        }
        assertCommittedLineageTip(home, paths.id);
        const before = statusAgainstPlan(plan, paths);
        const unexpected = before.issues.filter(
          (issue) => issue !== 'ACTIVE_GENERATION_MISSING_OR_INVALID',
        );
        if (unexpected.length > 0) {
          fail(
            'active_recovery_precondition',
            `active pointer recovery requires exact managed state: ${unexpected.join(', ')}`,
            'recovery_required',
          );
        }
        const creation = createActiveExclusive(plan, paths, {
          schema_version: 'skills-refiner.collection.active.v1',
          operation_id: paths.id,
          plan_hash: plan.plan_hash,
        });
        const createdIdentity = inspectCollectionEntry({ home: plan.home, path: paths.activePath });
        if (createdIdentity.device !== creation.device || createdIdentity.inode !== creation.inode) {
          fail('active_recovery_failed', 'created active pointer identity changed', 'recovery_required');
        }
        try {
          const repaired = statusAgainstPlan(plan, paths);
          if (repaired.status !== 'FILESYSTEM_READY') {
            fail('active_recovery_failed', `active pointer recovery postcondition failed: ${repaired.issues.join(', ')}`, 'recovery_required');
          }
        } catch (error) {
          try {
            moveCollectionEntryExclusive({
              home: plan.home,
              source: paths.activePath,
              destination: join(
                paths.operationRoot,
                `active.recovery-failed-${createdIdentity.device}-${createdIdentity.inode}.json`,
              ),
              expectedManifest: createdIdentity.manifest_hash,
              expectedDevice: createdIdentity.device,
              expectedInode: createdIdentity.inode,
            });
          } catch (compensationError) {
            fail(
              'active_recovery_compensation_failed',
              `active pointer recovery failed and its created pointer could not be isolated: ${compensationError.message}`,
              'recovery_required',
            );
          }
          throw error;
        }
        return {
          schema_version: 'skills-refiner.collection.recover.v1',
          status: 'FILESYSTEM_READY',
          operation_id: paths.id,
          mutation_occurred: true,
          recreated_from_independent_recovery: false,
          repaired: ['active_pointer'],
        };
      } finally {
        releaseLock(paths, lock);
      }
    }
    if (operationId(active) !== paths.id) {
      fail('foreign_or_superseded_operation', 'recover refuses a committed generation that is not active');
    }
    assertCommittedLineageTip(home, paths.id);
    const current = statusAgainstPlan(plan, paths);
    if (current.status !== 'FILESYSTEM_READY') {
      fail('committed_operation_drift', `recover refuses drifted committed state: ${current.issues.join(', ')}`);
    }
    return {
      schema_version: 'skills-refiner.collection.recover.v1',
      status: 'FILESYSTEM_READY',
      operation_id: paths.id,
      mutation_occurred: false,
      recreated_from_independent_recovery: false,
    };
  }
  verifyRecoverOwnership(home, loaded, paths);
  isolateStaleCollectionLock(plan, paths);
  const lock = acquireLock(paths, plan);
  try {
    verifyRecoverOwnership(home, loadOperationPlan(home, requestedId), paths);
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
  assertCommittedLineageTip(home, paths.id);
  const before = statusAgainstPlan(plan, paths);
  if (before.status === 'FILESYSTEM_READY') return { schema_version: 'skills-refiner.collection.repair.v1', status: 'FILESYSTEM_READY', operation_id: paths.id, mutation_occurred: false, repaired: [] };
  const indexPath = join(plan.target.collection_root, 'INDEX.json');
  const locatorPath = join(plan.target.collection_root, 'pc-prodcraft/prodcraft-runtime.json');
  const replaceCollection = (before.issues.includes('INDEX_MISSING_OR_INVALID') && !lstatExists(indexPath))
    || (before.issues.includes('LOCATOR_MISSING_OR_INVALID') && !lstatExists(locatorPath))
    || before.issues.includes('COLLECTION_ROOT_MODE_DRIFT')
    || before.issues.some((issue) => issue.startsWith('MEMBER_ROOT_MODE_DRIFT:'));
  const allowed = before.issues.every((issue) => issue.startsWith('MISSING_COLLECTION_ENTRY:')
    || issue === 'GATEWAY_PROJECTION_DRIFT'
    || issue.startsWith('AGENT_GATEWAY_DRIFT:')
    || (replaceCollection && (['INDEX_MISSING_OR_INVALID', 'LOCATOR_MISSING_OR_INVALID', 'INDEX_IDENTITY_DRIFT', 'MEMBER_DRIFT:pc-prodcraft', 'COLLECTION_ROOT_MODE_DRIFT'].includes(issue)
      || issue.startsWith('MEMBER_ROOT_MODE_DRIFT:'))));
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

function sourceMatchesDirectory(plan, path, entry, { requireManifest = false } = {}) {
  try {
    const identity = nativeIdentity(plan.home, path);
    return treeDigest(path) === entry.tree_digest
      && identity.security_metadata_hash === entry.security_metadata_hash
      && (!requireManifest || identity.manifest_hash === entry.native_manifest);
  } catch { return false; }
}

function sourceMatchesExposure(plan, path, exposure, { requireManifest = false } = {}) {
  try {
    const identity = nativeIdentity(plan.home, path);
    return exactManagedSymlink(path, exposure.raw_target)
      && identity.security_metadata_hash === exposure.security_metadata_hash
      && (!requireManifest || identity.manifest_hash === exposure.native_manifest);
  } catch { return false; }
}

function assertUndoReadiness(plan, paths) {
  assertCommittedLineageTip(plan.home, paths.id);
  const observed = statusAgainstPlan(plan, paths);
  const sourceIssue = isSuccessorPlan(plan)
    ? (issue) => issue.startsWith('PREDECESSOR_QUARANTINE_')
      || issue.startsWith('PREDECESSOR_RECOVERY_')
    : (issue) => issue.startsWith('QUARANTINE_DRIFT:')
      || issue.startsWith('QUARANTINE_METADATA_DRIFT:')
      || issue.startsWith('QUARANTINE_MISSING_OR_INVALID:')
      || issue.startsWith('RECOVERY_DRIFT:')
      || issue.startsWith('RECOVERY_METADATA_DRIFT:')
      || issue.startsWith('RECOVERY_MISSING_OR_INVALID:')
      || issue.startsWith('QUARANTINE_PROJECTION_')
      || issue.startsWith('RECOVERY_PROJECTION_');
  const blocking = observed.issues.filter((issue) => !sourceIssue(issue));
  if (blocking.length > 0) {
    fail('undo_conflict', `undo requires FILESYSTEM_READY post-state: ${blocking.join(', ')}`);
  }
  if (isSuccessorPlan(plan)) {
    const collectionQuarantine = join(paths.quarantineOperationRoot, 'predecessor', 'collection');
    const collectionRecovery = join(paths.recoveryPreState, 'predecessor', 'collection');
    if (!sourceMatchesDirectory(plan, collectionQuarantine, plan.predecessor.collection, { requireManifest: true })
        && !sourceMatchesDirectory(plan, collectionRecovery, plan.predecessor.collection)) {
      fail('undo_conflict', 'undo has no verified predecessor collection source');
    }
    for (const exposure of plan.predecessor.exposures) {
      const quarantine = predecessorExposurePath(paths.quarantineOperationRoot, exposure);
      const recovery = predecessorExposurePath(paths.recoveryPreState, exposure);
      if (!sourceMatchesExposure(plan, quarantine, exposure, { requireManifest: true })
          && !sourceMatchesExposure(plan, recovery, exposure)) {
        fail('undo_conflict', `undo has no verified predecessor exposure source: ${exposure.path}`);
      }
    }
  } else {
    for (const entry of plan.legacy) {
      const quarantine = join(paths.quarantineOperationRoot, 'skills', entry.name);
      const recovery = join(paths.recoveryPreState, 'skills', entry.name);
      if (!sourceMatchesDirectory(plan, quarantine, entry, { requireManifest: true })
          && !sourceMatchesDirectory(plan, recovery, entry)) {
        fail('undo_conflict', `undo has no verified legacy source: ${entry.name}`);
      }
    }
    for (const exposure of plan.projections) {
      const quarantine = join(paths.quarantineOperationRoot, 'projections', exposure.agent, exposure.name);
      const recovery = join(paths.recoveryPreState, 'projections', exposure.agent, exposure.name);
      if (!sourceMatchesExposure(plan, quarantine, exposure, { requireManifest: true })
          && !sourceMatchesExposure(plan, recovery, exposure)) {
        fail('undo_conflict', `undo has no verified legacy exposure source: ${exposure.path}`);
      }
    }
  }
  return observed;
}

export function undoProdcraftOperation({ home, operationId: requestedId, confirmation }) {
  const plan = loadActivePlan(home);
  if (plan === null) fail('no_active_generation', 'no active ProdCraft generation exists');
  const paths = operationPaths(plan);
  if (requestedId !== paths.id || confirmation !== paths.id) fail('confirmation_mismatch', 'undo confirmation must equal active operation id');
  assertUndoReadiness(plan, paths);
  const lock = acquireLock(paths, plan);
  try {
    assertUndoReadiness(plan, paths);
    writeOperation(paths, plan, OPERATION_STATES.restoring, { mutationOccurred: true });
    const postRoot = join(paths.quarantineOperationRoot, 'post-state/undo');
    if (lstatExists(postRoot)) fail('undo_conflict', 'undo post-state quarantine already exists');
    if (isSuccessorPlan(plan)) {
      const recreatedFromRecovery = restoreSuccessorPreState(plan, paths);
      verifyExactPreState(plan, { allowRecreatedIdentity: true });
      writeOperation(paths, plan, OPERATION_STATES.restored, {
        mutationOccurred: true,
        errorCode: recreatedFromRecovery ? 'restored_from_independent_recovery' : null,
      });
      return {
        schema_version: 'skills-refiner.collection.undo.v1',
        status: 'RESTORED',
        operation_id: paths.id,
        mutation_occurred: true,
        recreated_from_independent_recovery: recreatedFromRecovery,
      };
    }
    const restore = preflightInitialRollback(plan, paths, true, {
      activeArchiveName: 'active.restored.json',
      postCollectionPath: join(postRoot, 'prodcraft'),
    });
    for (const root of plan.agent_roots) {
      if (!lstatExists(root.root)) continue;
      moveCollectionEntryExclusive({ home: plan.home, source: join(root.root, 'pc-prodcraft'), destination: join(postRoot, 'agents', root.agent) });
    }
    moveCollectionEntryExclusive({ home: plan.home, source: plan.target.gateway_projection, destination: join(postRoot, 'pc-prodcraft') });
    moveCollectionEntryExclusive({ home: plan.home, source: plan.target.collection_root, destination: join(postRoot, 'prodcraft') });
    let recreatedFromRecovery = restore.recreatedFromRecovery;
    for (const action of restore.legacyActions) {
      moveCollectionEntryExclusive({
        home: plan.home,
        source: action.source,
        destination: action.entry.path,
        expectedManifest: action.expectedManifest,
      });
      recreatedFromRecovery ||= action.recreatedFromRecovery;
    }
    for (const action of restore.projectionActions) {
      moveCollectionEntryExclusive({
        home: plan.home,
        source: action.source,
        destination: action.link.path,
        expectedManifest: action.expectedManifest,
      });
      recreatedFromRecovery ||= action.recreatedFromRecovery;
    }
    verifyExactPreState(plan, { allowRecreatedIdentity: recreatedFromRecovery });
    archiveInitialActive(plan, paths, 'active.restored.json');
    writeOperation(paths, plan, OPERATION_STATES.restored, {
      mutationOccurred: true,
      errorCode: recreatedFromRecovery ? 'restored_from_independent_recovery' : null,
    });
    return {
      schema_version: 'skills-refiner.collection.undo.v1',
      status: 'RESTORED',
      operation_id: paths.id,
      mutation_occurred: true,
      recreated_from_independent_recovery: recreatedFromRecovery,
    };
  } catch (error) {
    try { writeOperation(paths, plan, OPERATION_STATES.recoveryRequired, { mutationOccurred: true, errorCode: error.code ?? 'undo_failed' }); } catch {}
    throw error;
  } finally {
    releaseLock(paths, lock);
  }
}
