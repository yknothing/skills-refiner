import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  createCollectionDirectoryExclusive, createCollectionFileExclusive,
  createCollectionSymlinkExclusive, inspectCollectionEntry, MacosAdapterError,
  moveCollectionEntryExclusive, replaceCollectionFileCas, unlinkCollectionSymlinkIdentityExact,
} from './cleanup-macos.mjs';
import { parseCodexPromptCatalogEntries } from './runtime-adapters.mjs';
import {
  canonicalJson, collectRuntimeBinding, DEFAULT_RUNTIME_POLICY, loadRuntimePolicy,
  resolveRuntimeAdapterExecutable, runRuntimeExecutable, sha256,
} from './runtime-evidence.mjs';

export const RUNTIME_PROFILE_SCHEMAS = Object.freeze({
  plan: 'skills-refiner.runtime-profile.plan.v1',
  apply: 'skills-refiner.runtime-profile.apply.v1',
  status: 'skills-refiner.runtime-profile.status.v1',
  operation: 'skills-refiner.runtime-profile.operation.v1',
  active: 'skills-refiner.runtime-profile.active.v1',
});

const BEGIN_MARKER = '# >>> skills-refiner runtime-profile default';
const END_MARKER = '# <<< skills-refiner runtime-profile default';
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OPERATION_ID = /^runtime-profile-[0-9a-f]{12}$/u;
const OPERATION_STATES = new Set([
  'PLANNED', 'LOCKED', 'CONFIG_WRITTEN', 'PROJECTION_STAGED', 'PROJECTION_CREATED',
  'PROJECTIONS_WRITTEN', 'VERIFYING', 'ACTIVE_STAGED', 'ACTIVE_PUBLISHED', 'COMMITTED',
  'ABORTED_STALE', 'ROLLED_BACK', 'RECOVERY_REQUIRED', 'UNDOING', 'UNDONE',
]);
const TERMINAL_OPERATION_STATES = new Set(['ABORTED_STALE', 'ROLLED_BACK', 'UNDONE']);
const OPERATION_TRANSITIONS = new Map([
  ['PLANNED', new Set(['LOCKED', 'ABORTED_STALE', 'RECOVERY_REQUIRED'])],
  ['LOCKED', new Set(['CONFIG_WRITTEN', 'ABORTED_STALE', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['CONFIG_WRITTEN', new Set(['PROJECTION_STAGED', 'PROJECTIONS_WRITTEN', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['PROJECTION_STAGED', new Set(['PROJECTION_CREATED', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['PROJECTION_CREATED', new Set(['PROJECTION_STAGED', 'PROJECTIONS_WRITTEN', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['PROJECTIONS_WRITTEN', new Set(['VERIFYING', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['VERIFYING', new Set(['ACTIVE_STAGED', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['ACTIVE_STAGED', new Set(['ACTIVE_PUBLISHED', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['ACTIVE_PUBLISHED', new Set(['COMMITTED', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['COMMITTED', new Set(['UNDOING', 'ROLLED_BACK', 'RECOVERY_REQUIRED'])],
  ['UNDOING', new Set(['UNDONE', 'RECOVERY_REQUIRED'])],
  ['RECOVERY_REQUIRED', new Set(['ROLLED_BACK', 'UNDONE', 'RECOVERY_REQUIRED'])],
]);

export class RuntimeProfileError extends Error {
  constructor(code, message, status = 'blocked') {
    super(message);
    this.name = 'RuntimeProfileError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 'blocked') {
  throw new RuntimeProfileError(code, message, status);
}

function normalizedHome(home) {
  const path = resolve(home);
  let real;
  try { real = realpathSync(path); } catch { fail('invalid_home', `HOME does not exist: ${path}`, 'invalid'); }
  if (real !== path) fail('invalid_home', `HOME must be canonical: ${path}`, 'invalid');
  return real;
}

function assertUnderHome(home, path) {
  if (path !== home && !path.startsWith(`${home}/`)) fail('unsafe_path', `path escapes HOME: ${path}`);
}

function assertSafeAncestors(home, path, { leafMayBeSymlink = false } = {}) {
  assertUnderHome(home, path);
  const parts = path.slice(home.length).split('/').filter(Boolean);
  let current = home;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    let stat;
    try { stat = lstatSync(current); } catch { continue; }
    if (stat.isSymbolicLink() && !(leafMayBeSymlink && index === parts.length - 1)) {
      fail('unsafe_path', `symlinked path component: ${current}`);
    }
  }
}

function assertRealDirectory(home, path) {
  assertSafeAncestors(home, path);
  let stat;
  try { stat = lstatSync(path); } catch { fail('missing_directory', path); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o022) !== 0 || realpathSync(path) !== path) {
    fail('unsafe_directory', `expected canonical real directory: ${path}`);
  }
}

function assertRealConfig(home, path) {
  assertSafeAncestors(home, path);
  if (!existsSync(path)) fail('missing_config', `Codex config is required for profile reconciliation: ${path}`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o022) !== 0 || stat.nlink !== 1) {
    fail('unsafe_config', `config must be a private, singly-linked real file: ${path}`);
  }
}

function decodeUtf8(bytes, label) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('invalid_utf8', `${label} is not valid UTF-8`); }
}

function readPrivateFile(home, path, code) {
  assertSafeAncestors(home, path);
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
    fail(code, `${path}: ${error.message}`, 'recovery_required');
  }
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o077n) !== 0n
        || before.nlink !== 1n || before.size < 0n || before.size > 64n * 1024n * 1024n) {
      fail(code, `expected an owner-private singly-linked real file: ${path}`, 'recovery_required');
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || BigInt(bytes.length) !== before.size) {
      fail(code, `file changed while being read: ${path}`, 'recovery_required');
    }
    assertSafeAncestors(home, path);
    return bytes;
  } finally {
    try { closeSync(descriptor); } catch {}
  }
}

function writeDurable(home, path, bytes) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createCollectionFileExclusive({ home, path, targetDigest: sha256(payload), bytes: payload });
}

function writeJson(home, path, value) {
  writeDurable(home, path, `${JSON.stringify(value, null, 2)}\n`);
}

function tomlString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`;
}

function findManagedBlock(source) {
  const beginCount = source.split(BEGIN_MARKER).length - 1;
  const endCount = source.split(END_MARKER).length - 1;
  if (beginCount === 0 && endCount === 0) return null;
  if (beginCount !== 1 || endCount !== 1) fail('managed_block_ambiguous', 'runtime profile markers are incomplete or duplicated');
  const begin = source.indexOf(BEGIN_MARKER);
  const afterBegin = begin + BEGIN_MARKER.length;
  if (!['\n', '\r'].includes(source[afterBegin]) && afterBegin !== source.length) {
    fail('managed_block_ambiguous', 'begin marker must occupy a full line');
  }
  const endMarker = source.indexOf(END_MARKER, begin);
  if (endMarker < begin) fail('managed_block_ambiguous', 'runtime profile markers are out of order');
  const lineStart = source.lastIndexOf('\n', begin - 1) + 1;
  if (lineStart !== begin) fail('managed_block_ambiguous', 'begin marker must occupy a full line');
  let end = endMarker + END_MARKER.length;
  if (source[end] === '\r' && source[end + 1] === '\n') end += 2;
  else if (source[end] === '\n') end += 1;
  if (source.slice(endMarker, end).split(/\r?\n/u)[0] !== END_MARKER) {
    fail('managed_block_ambiguous', 'end marker must occupy a full line');
  }
  return { begin, end, bytes: source.slice(begin, end) };
}

function tomlCodeBeforeComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '#') return line.slice(0, index);
  }
  return line;
}

function parseTomlBasicString(source, start) {
  if (source[start] !== '"') return null;
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') return { value, end: index + 1 };
    if (character !== '\\') {
      if (character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f) return null;
      value += character;
      continue;
    }
    index += 1;
    const escape = source[index];
    const simple = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
    if (Object.hasOwn(simple, escape)) {
      value += simple[escape];
      continue;
    }
    const width = escape === 'u' ? 4 : escape === 'U' ? 8 : 0;
    if (width === 0) return null;
    const digits = source.slice(index + 1, index + 1 + width);
    if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`, 'u').test(digits)) return null;
    const codePoint = Number.parseInt(digits, 16);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
    value += String.fromCodePoint(codePoint);
    index += width;
  }
  return null;
}

function parseTomlLiteralString(source, start) {
  if (source[start] !== "'") return null;
  const end = source.indexOf("'", start + 1);
  if (end < 0) return null;
  const value = source.slice(start + 1, end);
  return /[\u0000-\u001f\u007f]/u.test(value) ? null : { value, end: end + 1 };
}

function parseTomlDottedKey(source) {
  const keys = [];
  let index = 0;
  const horizontalSpace = /[ \t]/u;
  while (index < source.length) {
    while (horizontalSpace.test(source[index] ?? '')) index += 1;
    let parsed;
    if (source[index] === '"') parsed = parseTomlBasicString(source, index);
    else if (source[index] === "'") parsed = parseTomlLiteralString(source, index);
    else {
      const match = /^[A-Za-z0-9_-]+/u.exec(source.slice(index));
      if (match) parsed = { value: match[0], end: index + match[0].length };
    }
    if (!parsed || parsed.value.length === 0) return null;
    keys.push(parsed.value);
    index = parsed.end;
    while (horizontalSpace.test(source[index] ?? '')) index += 1;
    if (index === source.length) return keys;
    if (source[index] !== '.') return null;
    index += 1;
  }
  return null;
}

function parseTomlHeader(code) {
  const array = code.startsWith('[[');
  const table = !array && code.startsWith('[');
  if (!array && !table) return null;
  const openLength = array ? 2 : 1;
  const close = array ? ']]' : ']';
  if (!code.endsWith(close)) return { invalid: true };
  const keys = parseTomlDottedKey(code.slice(openLength, -close.length));
  return keys ? { invalid: false, array, keys } : { invalid: true };
}

function assignmentParts(code) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
    } else if (quote === "'") {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '=') return { key: code.slice(0, index), value: code.slice(index + 1) };
  }
  return null;
}

function parseTomlStringValue(source) {
  const value = source.trim();
  const parsed = value[0] === '"' ? parseTomlBasicString(value, 0)
    : value[0] === "'" ? parseTomlLiteralString(value, 0) : null;
  return parsed && value.slice(parsed.end).trim().length === 0 ? parsed.value : null;
}

function multilineTomlState(line, state) {
  const escapedAt = (index) => {
    let count = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) count += 1;
    return count % 2 === 1;
  };
  let index = 0;
  if (state) {
    while (index <= line.length - 3) {
      if (line.startsWith(state, index) && (state === "'''" || !escapedAt(index))) {
        state = null;
        index += 3;
        break;
      }
      index += 1;
    }
    if (state) return state;
  }
  let quote = null;
  let escaped = false;
  for (; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '#') return null;
    if (line.startsWith('"""', index) || line.startsWith("'''", index)) {
      const delimiter = line.slice(index, index + 3);
      let closing = index + 3;
      while (closing <= line.length - 3) {
        if (line.startsWith(delimiter, closing) && (delimiter === "'''" || !escapedAt(closing))) break;
        closing += 1;
      }
      if (closing > line.length - 3) return delimiter;
      index = closing + 2;
    } else if (character === '"' || character === "'") quote = character;
  }
  return null;
}

function canonicalConfiguredPath(value) {
  if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) return null;
  const normalized = resolve(value);
  try { return realpathSync(normalized); } catch { return normalized; }
}

function externalPathConflicts(source, disabledPaths) {
  const owned = findManagedBlock(source);
  const outside = owned ? `${source.slice(0, owned.begin)}${source.slice(owned.end)}` : source;
  const disabledCanonical = new Set(disabledPaths.map((path) => canonicalConfiguredPath(path)));
  const conflicts = new Set();
  let activeHeader = null;
  let ambiguous = false;
  let multilineState = null;
  for (const line of outside.split(/\r?\n/u)) {
    const startedInsideMultiline = multilineState !== null;
    multilineState = multilineTomlState(line, multilineState);
    if (startedInsideMultiline) continue;
    const code = tomlCodeBeforeComment(line).trim();
    if (code.length === 0) continue;
    const header = parseTomlHeader(code);
    if (header) {
      activeHeader = header.invalid ? null : header;
      if (header.invalid && /skills|\\(?:u|U)/u.test(code)) ambiguous = true;
      else if (!header.invalid && header.keys[0] === 'skills'
          && header.keys[1] === 'config'
          && (!header.array || header.keys.length !== 2)) ambiguous = true;
      continue;
    }
    const assignment = assignmentParts(code);
    if (!assignment) continue;
    const keys = parseTomlDottedKey(assignment.key);
    if (!keys) {
      if (activeHeader?.keys[0] === 'skills') ambiguous = true;
      continue;
    }
    const inSkillsConfig = activeHeader?.array === true
      && canonicalJson(activeHeader.keys) === canonicalJson(['skills', 'config']);
    if (inSkillsConfig) {
      if (keys[0] !== 'path') continue;
      if (keys.length !== 1) { ambiguous = true; continue; }
      const configured = parseTomlStringValue(assignment.value);
      const canonical = canonicalConfiguredPath(configured);
      if (!canonical) { ambiguous = true; continue; }
      if (disabledCanonical.has(canonical)) conflicts.add(canonical);
      continue;
    }
    const fullKeys = [...(activeHeader?.keys ?? []), ...keys];
    if (fullKeys[0] === 'skills' && fullKeys[1] === 'config') ambiguous = true;
  }
  return { conflicts: [...conflicts].sort(), ambiguous };
}

function renderManagedBlock(policyDigest, disabledPaths) {
  const lines = [
    BEGIN_MARKER,
    `# schema_version = ${tomlString('skills-refiner.runtime-profile.block.v1')}`,
    `# owner = ${tomlString('skills-refiner.runtime-profile')}`,
    `# policy_digest = ${tomlString(policyDigest)}`,
    '# Managed entries below are derived from runtime-policy.json and collection INDEX.json files.',
  ];
  for (const path of disabledPaths) {
    lines.push('', '[[skills.config]]', `path = ${tomlString(path)}`, 'enabled = false');
  }
  lines.push(END_MARKER);
  return `${lines.join('\n')}\n`;
}

function renderTargetConfig(before, block) {
  const existing = findManagedBlock(before);
  if (existing) return `${before.slice(0, existing.begin)}${block}${before.slice(existing.end)}`;
  if (before.length === 0) return block;
  const separator = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  return `${before}${separator}${block}`;
}

function memberMap(binding) {
  return new Map(binding.collections.map((collection) => [
    collection.collection_id,
    new Map(collection.members.map((member) => [member.name, member])),
  ]));
}

function desiredCodexDisabled(binding) {
  const paths = [];
  for (const collection of binding.collections) {
    const rule = binding.policy.collections[collection.collection_id].codex;
    if (rule.catalog_mode !== 'gateway') continue;
    for (const member of collection.members) {
      if (member.name !== rule.gateway) paths.push(member.skill_file);
    }
  }
  return [...new Set(paths)].sort();
}

function desiredClaudeLinks(home, binding) {
  const byCollection = memberMap(binding);
  const links = [];
  for (const collection of binding.collections) {
    const rule = binding.policy.collections[collection.collection_id].claude;
    const names = rule.catalog_mode === 'members'
      ? collection.members.map(({ name }) => name)
      : [rule.gateway];
    for (const name of names) {
      const member = byCollection.get(collection.collection_id)?.get(name);
      if (!member) fail('invalid_runtime_policy', `gateway is not a collection member: ${collection.collection_id}:${name}`);
      const targetDirectory = dirname(member.skill_file);
      const path = join(home, '.claude', 'skills', name);
      // Controller-created projections use a canonical absolute target so they can be staged
      // inside the private operation directory and then moved into place without changing meaning.
      const rawTarget = targetDirectory;
      links.push({ collection_id: collection.collection_id, name, path, raw_target: rawTarget, target_directory: targetDirectory });
    }
  }
  return links.sort((a, b) => a.path.localeCompare(b.path));
}

export function validateCodexCandidate({
  home,
  configBytes,
  binding,
  disabledPaths,
  executableResolver = resolveRuntimeAdapterExecutable,
  runner = spawnSync,
}) {
  const temporaryHome = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'skills-refiner-codex-candidate-')));
  try {
    writeFileSync(join(temporaryHome, 'config.toml'), configBytes, { mode: 0o600, flag: 'wx' });
    const environment = { ...process.env, HOME: home, CODEX_HOME: temporaryHome };
    const executable = executableResolver('codex');
    const version = runRuntimeExecutable(
      executable,
      ['--strict-config', '--version'],
      { encoding: 'utf8', env: environment, timeout: 15_000, maxBuffer: 1024 * 1024 },
      runner,
    );
    if (version.status !== 0) fail('candidate_config_invalid', String(version.stderr || version.stdout || '').trim().slice(0, 1000));
    const prompt = runRuntimeExecutable(
      executable,
      ['debug', 'prompt-input', 'Runtime profile candidate validation. Do not execute tools.'],
      { encoding: 'utf8', env: environment, timeout: 45_000, maxBuffer: 16 * 1024 * 1024 },
      runner,
    );
    if (prompt.status !== 0) fail('candidate_loader_blocked', String(prompt.stderr || '').trim().slice(0, 1000));
    let entries;
    try { entries = parseCodexPromptCatalogEntries(prompt.stdout); } catch (error) { fail('candidate_catalog_invalid', error.message); }
    const canonical = new Map();
    for (const entry of entries) {
      if (!canonical.has(entry.name)) canonical.set(entry.name, []);
      canonical.get(entry.name).push(entry.canonical_path);
    }
    const disabledCanonical = disabledPaths.map((path) => {
      try { return realpathSync(path); } catch { return path; }
    });
    const exposedDisabled = entries.filter((entry) => disabledCanonical.includes(entry.canonical_path));
    if (exposedDisabled.length > 0) {
      fail('candidate_policy_drift', `disabled managed Skills remain visible: ${exposedDisabled.map(({ name }) => name).join(',')}`);
    }
    const expectedCanonical = new Set(binding.expected_entities.map((entity) => {
      try { return realpathSync(entity.skill_file); } catch { return entity.skill_file; }
    }));
    const managedNames = new Set(binding.managed_universe);
    const unexpectedManaged = entries.filter((entry) => {
      const candidate = entry.canonical_path ?? entry.catalog_path;
      const underManagedRoot = binding.managed_roots.some(({ collection_root }) => (
        candidate === collection_root || candidate?.startsWith(`${collection_root}/`)
      ));
      return (underManagedRoot || managedNames.has(entry.name)) && !expectedCanonical.has(entry.canonical_path);
    });
    if (unexpectedManaged.length > 0) {
      fail('candidate_policy_drift', `unexpected managed identities remain visible: ${unexpectedManaged.map(({ name }) => name).join(',')}`);
    }
    const missing = [];
    for (const entity of binding.expected_entities) {
      let expected = entity.skill_file;
      try { expected = realpathSync(entity.skill_file); } catch {}
      if (!(canonical.get(entity.name) ?? []).includes(expected)) missing.push(entity.name);
    }
    if (missing.length > 0) fail('candidate_policy_drift', `expected managed Skills are missing: ${missing.join(',')}`);
    return {
      validator: 'codex-native-candidate.v1',
      status: 'pass',
      codex_version: String(version.stdout || version.stderr || '').trim().slice(0, 300),
      codex_executable_identity: executable,
      observed_count: new Set(entries.map(({ name }) => name)).size,
      observed_names_digest: sha256(JSON.stringify([...new Set(entries.map(({ name }) => name))].sort())),
      managed_identity_conformant: true,
    };
  } finally {
    rmSync(temporaryHome, { recursive: true, force: true });
  }
}

function observeLink(home, desired) {
  assertSafeAncestors(home, desired.path, { leafMayBeSymlink: true });
  if (!existsSync(desired.path) && (() => { try { lstatSync(desired.path); return true; } catch { return false; } })() === false) {
    return { ...desired, before: 'missing', before_raw_target: null };
  }
  const stat = lstatSync(desired.path);
  if (!stat.isSymbolicLink()) fail('projection_conflict', `Claude projection is not a symlink: ${desired.path}`);
  let resolved;
  try { resolved = realpathSync(desired.path); } catch { fail('projection_conflict', `Claude projection is broken: ${desired.path}`); }
  if (resolved !== desired.target_directory) {
    fail('projection_conflict', `Claude projection resolves to a different Skill: ${desired.path}`);
  }
  return { ...desired, before: 'exact', before_raw_target: readlinkSync(desired.path) };
}

function planHash(plan) {
  const value = structuredClone(plan);
  delete value.plan_hash;
  return sha256(canonicalJson(value));
}

function planPreconditionDigest(plan) {
  const value = structuredClone(plan);
  delete value.plan_hash;
  delete value.precondition_digest;
  delete value.generated_at;
  delete value.operation_id;
  return sha256(canonicalJson(value));
}

function profilePaths(home, operationId = null) {
  const controlRoot = join(home, '.agents', 'skill-control');
  const operationsRoot = join(home, 'Library', 'Application Support', 'skills-refiner', 'runtime-profile', 'operations');
  const operationRoot = operationId ? join(operationsRoot, operationId) : null;
  return {
    home,
    controlRoot,
    lock: join(controlRoot, 'collection-mutation.lock'),
    active: join(controlRoot, 'runtime-profile-active.json'),
    operationsRoot,
    operationRoot,
    journalRoot: operationRoot ? join(operationRoot, 'journal') : null,
  };
}

export function compileRuntimeProfilePlan({
  home,
  policyPath = DEFAULT_RUNTIME_POLICY,
  candidateValidator = validateCodexCandidate,
  validateCandidate = true,
}) {
  const root = normalizedHome(home);
  const loaded = loadRuntimePolicy(policyPath);
  const codex = collectRuntimeBinding({ home: root, adapter: 'codex', policyPath: loaded.path });
  const claude = collectRuntimeBinding({ home: root, adapter: 'claude', policyPath: loaded.path });
  const configPath = join(root, '.codex', 'config.toml');
  const claudeRoot = join(root, '.claude', 'skills');
  assertRealConfig(root, configPath);
  assertRealDirectory(root, claudeRoot);
  const configBeforeBytes = readFileSync(configPath);
  const configBefore = decodeUtf8(configBeforeBytes, configPath);
  const active = readActive(root);
  if (active && !validActiveRecord(active.value)) fail('invalid_active_record', 'runtime profile active record is invalid', 'recovery_required');
  const existingManagedBlock = findManagedBlock(configBefore);
  if (existingManagedBlock) validateManagedBlockOwnership(root, active, existingManagedBlock);
  const disabledPaths = desiredCodexDisabled(codex);
  const externalSkillsConfig = externalPathConflicts(configBefore, disabledPaths);
  if (externalSkillsConfig.ambiguous) {
    fail(
      'external_config_conflict',
      'Codex config contains an ambiguous external skills configuration structure outside the managed block',
    );
  }
  if (externalSkillsConfig.conflicts.length > 0) {
    fail('external_config_conflict', 'managed Skill paths already have user-owned Codex configuration');
  }
  const managedBlock = renderManagedBlock(loaded.digest, disabledPaths);
  const configTarget = renderTargetConfig(configBefore, managedBlock);
  const links = desiredClaudeLinks(root, claude).map((link) => observeLink(root, link));
  const candidateValidation = validateCandidate
    ? candidateValidator({ home: root, configBytes: configTarget, binding: codex, disabledPaths })
    : { validator: 'not_run', status: 'unverified', codex_version: null, observed_names_digest: null, managed_identity_conformant: false };
  if (validateCandidate && candidateValidation?.status !== 'pass') fail('candidate_validation_failed', 'Codex candidate validation did not pass');
  const deploymentDigest = sha256(canonicalJson({
    profile_id: loaded.policy.profile_id,
    policy_digest: loaded.digest,
    collections: codex.collections.map((collection) => ({
      collection_id: collection.collection_id,
      operation_id: collection.operation_id,
      index_digest: collection.index_digest,
      member_set_digest: collection.member_set_digest,
    })),
    codex_managed_block_digest: sha256(managedBlock),
    claude_links: links.map(({ collection_id, name, path, raw_target, target_directory }) => ({ collection_id, name, path, raw_target, target_directory })),
    cursor_mutation_policy: 'observe_only_until_runtime_probe',
  }));
  const plan = {
    schema_version: RUNTIME_PROFILE_SCHEMAS.plan,
    generated_at: new Date().toISOString(),
    operation_id: `runtime-profile-${randomBytes(6).toString('hex')}`,
    profile_id: loaded.policy.profile_id,
    home: root,
    policy_path: loaded.path,
    policy_digest: loaded.digest,
    deployment_digest: deploymentDigest,
    bindings: {
      codex_root_inventory_digest: codex.deployment.root_inventory_digest,
      claude_root_inventory_digest: claude.deployment.root_inventory_digest,
    },
    codex: {
      config_path: configPath,
      config_before_exists: true,
      config_before_digest: sha256(configBeforeBytes),
      config_target_digest: sha256(configTarget),
      managed_block_digest: sha256(managedBlock),
      disabled_paths: disabledPaths,
    },
    claude: { skills_root: claudeRoot, links },
    cursor: { mutation_policy: 'observe_only_until_runtime_probe', mutation_count: 0 },
    control: {
      active_before_exists: active !== null,
      active_before_digest: active ? sha256(active.bytes) : null,
      active_before_operation_id: active?.value?.operation_id ?? null,
    },
    candidate_validation: candidateValidation,
    unmanaged_skills: loaded.policy.unmanaged_skills,
    mutation_required: configBefore !== configTarget || links.some((link) => link.before === 'missing')
      || active?.value?.deployment_digest !== deploymentDigest,
  };
  plan.precondition_digest = planPreconditionDigest(plan);
  plan.plan_hash = planHash(plan);
  return plan;
}

export function validateRuntimeProfilePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
      || plan.schema_version !== RUNTIME_PROFILE_SCHEMAS.plan
      || plan.profile_id !== 'default' || typeof plan.home !== 'string'
      || !OPERATION_ID.test(plan.operation_id ?? '')
      || !DIGEST.test(plan.policy_digest ?? '') || !DIGEST.test(plan.deployment_digest ?? '')
      || !DIGEST.test(plan.precondition_digest ?? '')
      || !DIGEST.test(plan.plan_hash ?? '')
      || !DIGEST.test(plan.codex?.config_before_digest ?? '')
      || !DIGEST.test(plan.codex?.config_target_digest ?? '')
      || !DIGEST.test(plan.codex?.managed_block_digest ?? '')
      || !Array.isArray(plan.codex?.disabled_paths) || !Array.isArray(plan.claude?.links)
      || !plan.control || typeof plan.control.active_before_exists !== 'boolean'
      || !(plan.control.active_before_digest === null || DIGEST.test(plan.control.active_before_digest))
      || plan.candidate_validation?.status !== 'pass'
      || planPreconditionDigest(plan) !== plan.precondition_digest
      || planHash(plan) !== plan.plan_hash) {
    fail('invalid_profile_plan', 'runtime profile plan schema or digest is invalid', 'invalid');
  }
  const home = normalizedHome(plan.home);
  if (plan.codex.config_path !== join(home, '.codex', 'config.toml')
      || plan.claude.skills_root !== join(home, '.claude', 'skills')
      || plan.cursor?.mutation_policy !== 'observe_only_until_runtime_probe'
      || plan.cursor?.mutation_count !== 0 || plan.unmanaged_skills !== 'preserve') {
    fail('invalid_profile_plan', 'runtime profile plan contains unsafe targets', 'invalid');
  }
  const seen = new Set();
  for (const link of plan.claude.links) {
    if (seen.has(link.path) || link.path !== join(plan.claude.skills_root, link.name)
        || !['missing', 'exact'].includes(link.before)
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(link.name ?? '')
        || link.raw_target !== link.target_directory
        || !link.target_directory.startsWith(join(home, '.agents', 'skills') + '/')) {
      fail('invalid_profile_plan', 'runtime profile plan contains an invalid projection', 'invalid');
    }
    seen.add(link.path);
  }
  return plan;
}

function operationId(plan) {
  return plan.operation_id;
}

function readActive(home) {
  const path = profilePaths(home).active;
  if (!existsSync(path)) return null;
  assertSafeAncestors(home, path);
  const bytes = readPrivateFile(home, path, 'unsafe_active_record');
  let value;
  try { value = JSON.parse(decodeUtf8(bytes, path)); } catch (error) {
    if (error instanceof RuntimeProfileError) throw error;
    fail('invalid_active_record', `${path}: ${error.message}`, 'recovery_required');
  }
  return { path, bytes, value };
}

function validActiveRecord(value) {
  return value?.schema_version === RUNTIME_PROFILE_SCHEMAS.active
    && value.profile_id === 'default'
    && OPERATION_ID.test(value.operation_id ?? '')
    && DIGEST.test(value.plan_hash ?? '')
    && DIGEST.test(value.policy_digest ?? '')
    && DIGEST.test(value.deployment_digest ?? '')
    && DIGEST.test(value.managed_block_digest ?? '')
    && !Number.isNaN(Date.parse(value.activated_at));
}

function validateManagedBlockOwnership(home, active, block) {
  if (!active) fail('unowned_managed_block', 'managed block exists without an active controller record', 'recovery_required');
  if (active.value.managed_block_digest !== sha256(block.bytes)) {
    fail('managed_block_ownership_drift', 'managed block digest does not match the active controller record', 'recovery_required');
  }
  let loaded;
  try { loaded = loadOperation(home, active.value.operation_id); } catch {
    fail('managed_block_ownership_unverifiable', 'active operation history is unavailable', 'recovery_required');
  }
  let afterBytes;
  try {
    afterBytes = readPrivateFile(
      home,
      join(loaded.paths.operationRoot, 'active.after.json'),
      'managed_block_ownership_unverifiable',
    );
  } catch {
    fail('managed_block_ownership_unverifiable', 'active operation attestation is unavailable', 'recovery_required');
  }
  if (loaded.operation.state !== 'COMMITTED'
      || loaded.plan.plan_hash !== active.value.plan_hash
      || loaded.plan.codex.managed_block_digest !== active.value.managed_block_digest
      || sha256(afterBytes) !== sha256(active.bytes)) {
    fail('managed_block_ownership_unverifiable', 'managed block ownership chain is inconsistent', 'recovery_required');
  }
}

function acquireLock(home, plan) {
  const paths = profilePaths(home);
  const bytes = Buffer.from(`${JSON.stringify({ kind: 'runtime-profile', operation_id: operationId(plan), plan_hash: plan.plan_hash, pid: process.pid })}\n`);
  try {
    createCollectionFileExclusive({ home, path: paths.lock, targetDigest: sha256(bytes), bytes });
    const identity = inspectIdentity(home, paths.lock);
    return {
      ...identity,
      home,
      release_destination: join(profilePaths(home, operationId(plan)).operationRoot, `lock.released-${identity.inode}.json`),
    };
  } catch (error) {
    fail('mutation_lock_unavailable', `collection mutation lock is unavailable: ${error.message}`, 'recovery_required');
  }
}

function releaseLock(lock) {
  if (!lock) return;
  try {
    moveIdentity(lock.home, lock, lock.release_destination);
  } catch (error) {
    if (error instanceof RuntimeProfileError) throw error;
    fail('mutation_lock_release_failed', error.message, 'recovery_required');
  }
}

function validIdentity(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.path === 'string'
    && /^\d+$/u.test(value.device ?? '') && /^\d+$/u.test(value.inode ?? '')
    && DIGEST.test(value.manifest_hash ?? '');
}

function validateOperationRecord(value, plan) {
  const createdLinks = value?.created_links;
  const allowedKeys = new Set([
    'schema_version', 'operation_id', 'plan_hash', 'state', 'journal_sequence',
    'previous_record_digest', 'updated_at', 'created_links', 'active_transition',
    'pending_projection', 'error_code', 'recovered', 'intent',
  ]);
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !allowedKeys.has(key))
      || value.schema_version !== RUNTIME_PROFILE_SCHEMAS.operation
      || value.operation_id !== operationId(plan) || value.plan_hash !== plan.plan_hash
      || !OPERATION_STATES.has(value.state)
      || !Number.isInteger(value.journal_sequence) || value.journal_sequence < 0
      || !(value.previous_record_digest === null || DIGEST.test(value.previous_record_digest))
      || Number.isNaN(Date.parse(value.updated_at)) || !Array.isArray(createdLinks)
      || !['apply', 'undo'].includes(value.intent)
      || createdLinks.some((entry) => !validIdentity(entry)
        || typeof entry.raw_target !== 'string' || typeof entry.stage_path !== 'string'
        || typeof entry.stage_raw_target !== 'string' || typeof entry.target_directory !== 'string'
        || typeof entry.destination_path !== 'string')) {
    fail('invalid_operation', 'runtime profile operation journal is invalid', 'recovery_required');
  }
  const paths = profilePaths(plan.home, operationId(plan));
  for (const entry of createdLinks) {
    const desired = plan.claude.links.find((link) => link.path === entry.destination_path && link.before === 'missing');
    if (!desired || entry.raw_target !== desired.raw_target || entry.stage_raw_target !== desired.raw_target
        || entry.target_directory !== desired.target_directory
        || !entry.stage_path.startsWith(`${paths.operationRoot}/projection-`)
        || !entry.stage_path.endsWith('.staged')
        || ![entry.stage_path, entry.destination_path].includes(entry.path)) {
      fail('invalid_operation', 'runtime profile projection journal escapes its plan', 'recovery_required');
    }
  }
  if (value.active_transition !== null && value.active_transition !== undefined) {
    const { staged, previous } = value.active_transition;
    if (!validIdentity(staged) || typeof staged.stage_path !== 'string' || !DIGEST.test(staged.digest ?? '')
        || !(previous === null || (validIdentity(previous) && typeof previous.backup_path === 'string'
          && DIGEST.test(previous.digest ?? '')))) {
      fail('invalid_operation', 'runtime profile active transition is invalid', 'recovery_required');
    }
    if (staged.path !== paths.active || staged.stage_path !== join(paths.operationRoot, 'active.staged.json')
        || (previous && (previous.path !== paths.active
          || previous.backup_path !== join(paths.operationRoot, 'active.previous.live.json')))) {
      fail('invalid_operation', 'runtime profile active transition escapes its operation', 'recovery_required');
    }
  }
  return value;
}

function createInitialOperation(paths, plan) {
  createCollectionDirectoryExclusive({ home: paths.home, path: paths.journalRoot });
  const initial = {
    schema_version: RUNTIME_PROFILE_SCHEMAS.operation,
    operation_id: operationId(plan),
    plan_hash: plan.plan_hash,
    state: 'PLANNED',
    journal_sequence: 0,
    previous_record_digest: null,
    updated_at: new Date().toISOString(),
    created_links: [],
    active_transition: null,
    intent: 'apply',
  };
  const bytes = `${JSON.stringify(initial, null, 2)}\n`;
  writeDurable(paths.home, operationSnapshotPath(paths, initial), bytes);
  writeDurable(paths.home, join(paths.operationRoot, 'operation.json'), bytes);
}

function operationSnapshotPath(paths, operation) {
  return join(
    paths.journalRoot,
    `${String(operation.journal_sequence).padStart(6, '0')}-${operation.state}.json`,
  );
}

function operationTransitionAllowed(before, after) {
  return OPERATION_TRANSITIONS.get(before)?.has(after) === true;
}

function loadOperationJournal(paths, plan) {
  assertRealDirectory(paths.home, paths.journalRoot);
  const names = readdirSync(paths.journalRoot).sort();
  if (names.length === 0) fail('invalid_operation_journal', 'operation journal is empty', 'recovery_required');
  const records = [];
  for (let sequence = 0; sequence < names.length; sequence += 1) {
    const match = /^(\d{6})-([A-Z_]+)\.json$/u.exec(names[sequence]);
    if (!match || Number(match[1]) !== sequence) {
      fail('invalid_operation_journal', 'operation journal sequence is not contiguous', 'recovery_required');
    }
    const path = join(paths.journalRoot, names[sequence]);
    const bytes = readPrivateFile(paths.home, path, 'invalid_operation_journal');
    let decoded;
    try { decoded = JSON.parse(decodeUtf8(bytes, path)); } catch (error) {
      if (error instanceof RuntimeProfileError) throw error;
      fail('invalid_operation_journal', `${path}: ${error.message}`, 'recovery_required');
    }
    const record = validateOperationRecord(decoded, plan);
    if (record.journal_sequence !== sequence || record.state !== match[2]
        || operationSnapshotPath(paths, record) !== path) {
      fail('invalid_operation_journal', 'operation journal filename does not bind its record', 'recovery_required');
    }
    if (sequence === 0) {
      if (record.state !== 'PLANNED' || record.previous_record_digest !== null) {
        fail('invalid_operation_journal', 'operation journal genesis is invalid', 'recovery_required');
      }
    } else {
      const previous = records.at(-1);
      if (record.previous_record_digest !== sha256(previous.bytes)
          || !operationTransitionAllowed(previous.record.state, record.state)) {
        fail('invalid_operation_journal', 'operation journal chain is invalid', 'recovery_required');
      }
    }
    records.push({ path, bytes, record });
  }
  return records;
}

function currentOperation(paths, plan, { allowPointerLag = false } = {}) {
  const records = loadOperationJournal(paths, plan);
  const latest = records.at(-1);
  const pointerPath = join(paths.operationRoot, 'operation.json');
  let pointerBytes = null;
  try { lstatSync(pointerPath); pointerBytes = readPrivateFile(paths.home, pointerPath, 'invalid_operation'); } catch (error) {
    if (error instanceof RuntimeProfileError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  if (pointerBytes && pointerBytes.equals(latest.bytes)) {
    return { ...latest, records, pointer_path: pointerPath, pointer_bytes: pointerBytes, pointer_lag: false };
  }
  const previous = records.length > 1 ? records.at(-2) : null;
  const safelyLagged = pointerBytes === null
    ? records.length === 1
    : previous !== null && pointerBytes.equals(previous.bytes)
      && latest.record.previous_record_digest === sha256(pointerBytes);
  if (!allowPointerLag || !safelyLagged) {
    fail('operation_view_drift', 'operation.json does not match the append-only journal', 'recovery_required');
  }
  return { ...latest, records, pointer_path: pointerPath, pointer_bytes: pointerBytes, pointer_lag: true };
}

function repairOperationView(home, current) {
  if (!current.pointer_lag) return;
  if (current.pointer_bytes === null) {
    writeDurable(home, current.pointer_path, current.bytes);
  } else {
    replaceCollectionFileCas({
      home,
      path: current.pointer_path,
      expectedDigest: sha256(current.pointer_bytes),
      targetDigest: sha256(current.bytes),
      bytes: current.bytes,
    });
  }
}

function updateOperation(paths, plan, state, extra = {}) {
  if (!OPERATION_STATES.has(state)) fail('invalid_operation_state', state, 'recovery_required');
  const path = join(paths.operationRoot, 'operation.json');
  const current = currentOperation(paths, plan);
  const beforeBytes = current.bytes;
  const before = current.record;
  if (TERMINAL_OPERATION_STATES.has(before.state) || !operationTransitionAllowed(before.state, state)) {
    fail('invalid_operation_transition', `${before.state} -> ${state}`, 'recovery_required');
  }
  const after = {
    schema_version: RUNTIME_PROFILE_SCHEMAS.operation,
    operation_id: operationId(plan),
    plan_hash: plan.plan_hash,
    state,
    journal_sequence: before.journal_sequence + 1,
    previous_record_digest: sha256(beforeBytes),
    updated_at: new Date().toISOString(),
    created_links: extra.created_links ?? before.created_links,
    active_transition: extra.active_transition ?? before.active_transition ?? null,
    intent: extra.intent ?? before.intent,
  };
  for (const key of ['pending_projection', 'error_code', 'recovered']) {
    if (Object.hasOwn(extra, key)) after[key] = extra[key];
  }
  const bytes = `${JSON.stringify(after, null, 2)}\n`;
  writeDurable(paths.home, operationSnapshotPath(paths, after), bytes);
  replaceCollectionFileCas({
    home: paths.home,
    path,
    expectedDigest: sha256(beforeBytes),
    targetDigest: sha256(bytes),
    bytes,
  });
}

function linkIsExact(link) {
  try { return lstatSync(link.path).isSymbolicLink() && realpathSync(link.path) === link.target_directory; } catch { return false; }
}

function entryExists(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

function inspectIdentity(home, path) {
  const value = inspectCollectionEntry({ home, path });
  return { path, device: value.device, inode: value.inode, manifest_hash: value.manifest_hash };
}

function identityMatches(home, identity) {
  if (!identity || !entryExists(identity.path)) return false;
  try {
    const current = inspectIdentity(home, identity.path);
    return current.device === identity.device && current.inode === identity.inode
      && current.manifest_hash === identity.manifest_hash;
  } catch { return false; }
}

function moveIdentity(home, identity, destination) {
  moveCollectionEntryExclusive({
    home,
    source: identity.path,
    destination,
    expectedManifest: identity.manifest_hash,
    expectedDevice: identity.device,
    expectedInode: identity.inode,
  });
  return { ...identity, path: destination };
}

function stageProjection(home, paths, link, index) {
  const stagePath = join(paths.operationRoot, `projection-${String(index).padStart(3, '0')}.staged`);
  assertSafeAncestors(home, stagePath, { leafMayBeSymlink: true });
  createCollectionSymlinkExclusive({ home, path: stagePath, rawTarget: link.raw_target });
  const identity = inspectIdentity(home, stagePath);
  if (realpathSync(stagePath) !== link.target_directory || readlinkSync(stagePath) !== link.raw_target) {
    fail('projection_stage_postcondition_failed', stagePath, 'recovery_required');
  }
  return {
    ...identity,
    stage_path: stagePath,
    raw_target: link.raw_target,
    stage_raw_target: link.raw_target,
    target_directory: link.target_directory,
    destination_path: link.path,
  };
}

function publishStagedProjection(home, staged) {
  const moved = moveIdentity(home, { ...staged, path: staged.stage_path }, staged.destination_path);
  if (!identityMatches(home, moved) || realpathSync(staged.destination_path) !== staged.target_directory
      || readlinkSync(staged.destination_path) !== staged.raw_target) {
    fail('projection_postcondition_failed', staged.destination_path, 'recovery_required');
  }
  return { ...staged, path: staged.destination_path };
}

function operationCreatedLinks(paths) {
  let rawPlan;
  try { rawPlan = JSON.parse(decodeUtf8(readPrivateFile(paths.home, join(paths.operationRoot, 'plan.json'), 'invalid_operation'), 'plan.json')); } catch (error) {
    if (error instanceof RuntimeProfileError) throw error;
    fail('invalid_operation', error.message, 'recovery_required');
  }
  const plan = validateRuntimeProfilePlan(rawPlan);
  const operation = currentOperation(paths, plan).record;
  return Array.isArray(operation.created_links) ? operation.created_links : [];
}

function stageActiveRecord(home, plan, paths, activeAfter) {
  const bytes = Buffer.from(`${JSON.stringify(activeAfter, null, 2)}\n`);
  const auditPath = join(paths.operationRoot, 'active.after.json');
  const stagePath = join(paths.operationRoot, 'active.staged.json');
  writeDurable(home, auditPath, bytes);
  writeDurable(home, stagePath, bytes);
  const stagedIdentity = inspectIdentity(home, stagePath);
  const current = readActive(home);
  const previous = current ? {
    ...inspectIdentity(home, paths.active),
    digest: sha256(current.bytes),
    backup_path: join(paths.operationRoot, 'active.previous.live.json'),
  } : null;
  if ((previous?.digest ?? null) !== plan.control.active_before_digest) {
    fail('active_precondition_changed', 'runtime profile active record changed before publication', 'recovery_required');
  }
  return {
    staged: {
      ...stagedIdentity,
      path: paths.active,
      stage_path: stagePath,
      digest: sha256(bytes),
    },
    previous,
  };
}

function publishActiveRecord(home, paths, transition) {
  if (transition.previous) {
    moveIdentity(home, { ...transition.previous, path: paths.active }, transition.previous.backup_path);
  }
  moveIdentity(home, { ...transition.staged, path: transition.staged.stage_path }, paths.active);
  if (!identityMatches(home, { ...transition.staged, path: paths.active })
      || sha256(readPrivateFile(home, paths.active, 'active_publish_postcondition_failed')) !== transition.staged.digest) {
    fail('active_publish_postcondition_failed', paths.active, 'recovery_required');
  }
}

function restoreActivePreState(home, plan, paths, transition) {
  if (!transition) {
    const current = readActive(home);
    if ((current ? sha256(current.bytes) : null) !== plan.control.active_before_digest) {
      fail('recovery_active_conflict', 'runtime profile active record changed outside the operation', 'recovery_required');
    }
    return;
  }
  const activeStaged = { ...transition.staged, path: paths.active };
  const activePrevious = transition.previous ? { ...transition.previous, path: paths.active } : null;
  if (entryExists(paths.active)) {
    if (identityMatches(home, activeStaged)) {
      const rollbackPath = join(paths.operationRoot, 'active.rolled-back.json');
      if (entryExists(rollbackPath)) fail('active_rollback_destination_conflict', rollbackPath, 'recovery_required');
      moveIdentity(home, activeStaged, rollbackPath);
    } else if (!activePrevious || !identityMatches(home, activePrevious)) {
      fail('recovery_active_conflict', 'runtime profile active record changed outside the operation', 'recovery_required');
    }
  }
  if (transition.previous) {
    if (identityMatches(home, activePrevious)) return;
    const backup = { ...transition.previous, path: transition.previous.backup_path };
    if (!identityMatches(home, backup) || entryExists(paths.active)) {
      fail('recovery_active_conflict', 'previous active record cannot be restored safely', 'recovery_required');
    }
    moveIdentity(home, backup, paths.active);
  } else if (entryExists(paths.active)) {
    fail('recovery_active_conflict', 'active record should be absent after rollback', 'recovery_required');
  }
}

function restorePreState(home, plan, paths, createdLinks = operationCreatedLinks(paths)) {
  const currentRecord = currentOperation(paths, plan).record;
  const currentConfig = readFileSync(plan.codex.config_path);
  const currentDigest = sha256(currentConfig);
  if (![plan.codex.config_before_digest, plan.codex.config_target_digest].includes(currentDigest)) {
    fail('recovery_config_conflict', 'Codex config changed outside the runtime profile operation', 'recovery_required');
  }
  const createdByPath = new Map(createdLinks.map((entry) => [entry.destination_path ?? entry.path, entry]));
  for (const link of plan.claude.links) {
    if (link.before === 'missing') {
      if (!existsSync(link.path) && (() => { try { lstatSync(link.path); return true; } catch { return false; } })() === false) continue;
      const created = createdByPath.get(link.path);
      if (!created || !linkIsExact(link)
          || !identityMatches(home, { ...created, path: link.path })) {
        fail('recovery_unjournaled_projection', link.path, 'recovery_required');
      }
    } else if (!linkIsExact(link) || readlinkSync(link.path) !== link.before_raw_target) {
      fail('recovery_projection_conflict', link.path, 'recovery_required');
    }
  }
  for (const created of [...createdLinks].reverse()) {
    const published = { ...created, path: created.destination_path ?? created.path };
    const staged = { ...created, path: created.stage_path };
    if (identityMatches(home, published)) {
      unlinkCollectionSymlinkIdentityExact({
        home, path: published.path, rawTarget: created.raw_target,
        device: created.device, inode: created.inode,
      });
    } else if (identityMatches(home, staged)) {
      unlinkCollectionSymlinkIdentityExact({
        home, path: staged.path, rawTarget: created.stage_raw_target,
        device: created.device, inode: created.inode,
      });
    } else if (entryExists(published.path) || entryExists(staged.path)) {
      fail('recovery_projection_identity_changed', published.path, 'recovery_required');
    }
  }
  const beforePath = join(paths.operationRoot, 'config.before.toml');
  if (currentDigest === plan.codex.config_target_digest && currentDigest !== plan.codex.config_before_digest) {
    replaceCollectionFileCas({
      home,
      path: plan.codex.config_path,
      expectedDigest: plan.codex.config_target_digest,
      targetDigest: plan.codex.config_before_digest,
      bytes: readFileSync(beforePath),
    });
  }
  restoreActivePreState(home, plan, paths, currentRecord.active_transition ?? null);
  if (sha256(readFileSync(plan.codex.config_path)) !== plan.codex.config_before_digest) {
    fail('rollback_config_postcondition_failed', plan.codex.config_path, 'recovery_required');
  }
}

function freshPlanMustMatch(plan, candidateValidator) {
  const fresh = compileRuntimeProfilePlan({ home: plan.home, policyPath: plan.policy_path, candidateValidator });
  if (fresh.precondition_digest !== plan.precondition_digest) fail('profile_plan_stale', 'runtime profile state changed after planning');
  return fresh;
}

function surfacesReady(plan) {
  const issues = [];
  try {
    if (sha256(readFileSync(plan.codex.config_path)) !== plan.codex.config_target_digest) issues.push('CODEX_PROFILE_DRIFT');
  } catch { issues.push('CODEX_CONFIG_UNAVAILABLE'); }
  for (const link of plan.claude.links) if (!linkIsExact(link)) issues.push(`CLAUDE_PROJECTION_DRIFT:${link.name}`);
  return issues;
}

function reserveOperation(plan, paths) {
  try { createCollectionDirectoryExclusive({ home: plan.home, path: paths.operationRoot }); } catch (error) {
    fail('operation_conflict', `${paths.operationRoot}: ${error.message}`, 'recovery_required');
  }
  assertRealDirectory(plan.home, paths.operationsRoot);
  assertRealDirectory(plan.home, paths.operationRoot);
  writeJson(plan.home, join(paths.operationRoot, 'plan.json'), plan);
  const configBytes = readFileSync(plan.codex.config_path);
  if (sha256(configBytes) !== plan.codex.config_before_digest) {
    fail('profile_plan_stale', 'Codex config changed after planning and before operation reservation');
  }
  writeDurable(plan.home, join(paths.operationRoot, 'config.before.toml'), configBytes);
  const active = readActive(plan.home);
  if ((active ? sha256(active.bytes) : null) !== plan.control.active_before_digest) {
    fail('profile_plan_stale', 'active profile changed after planning and before operation reservation');
  }
  if (active) writeDurable(plan.home, join(paths.operationRoot, 'active.before.json'), active.bytes);
  createInitialOperation(paths, plan);
}

export function applyRuntimeProfilePlan(plan, confirmation, {
  faultPhase = null,
  candidateValidator = validateCodexCandidate,
} = {}) {
  validateRuntimeProfilePlan(plan);
  if (confirmation !== plan.plan_hash) fail('confirmation_mismatch', 'apply confirmation must equal plan hash', 'invalid');
  if (!plan.mutation_required) {
    freshPlanMustMatch(plan, candidateValidator);
    const status = statusRuntimeProfile({ home: plan.home, policyPath: plan.policy_path });
    if (status.status !== 'DEPLOYMENT_READY') fail('deployment_not_ready', status.issues.join(', '), 'recovery_required');
    return { schema_version: RUNTIME_PROFILE_SCHEMAS.apply, status: 'DEPLOYMENT_READY', runtime_status: 'UNVERIFIED', operation_id: status.active_operation_id, plan_hash: plan.plan_hash, mutation_occurred: false };
  }
  const id = operationId(plan);
  const paths = profilePaths(plan.home, id);
  reserveOperation(plan, paths);
  let lock;
  try { lock = acquireLock(plan.home, plan); } catch (error) {
    try { updateOperation(paths, plan, 'ABORTED_STALE', { error_code: error.code ?? 'lock_unavailable' }); } catch {}
    throw error;
  }
  let mutationStarted = false;
  const createdLinks = [];
  try {
    freshPlanMustMatch(plan, candidateValidator);
    updateOperation(paths, plan, 'LOCKED', { created_links: createdLinks });
    if (faultPhase === 'kill_after_lock') process.kill(process.pid, 'SIGKILL');
    const configBytes = readFileSync(plan.codex.config_path);
    mutationStarted = true;
    const loaded = loadRuntimePolicy(plan.policy_path);
    const targetConfig = renderTargetConfig(decodeUtf8(configBytes, plan.codex.config_path), renderManagedBlock(loaded.digest, plan.codex.disabled_paths));
    if (sha256(targetConfig) !== plan.codex.config_target_digest) fail('target_digest_mismatch', 'Codex target config digest changed', 'recovery_required');
    if (plan.codex.config_before_digest !== plan.codex.config_target_digest) {
      replaceCollectionFileCas({
        home: plan.home,
        path: plan.codex.config_path,
        expectedDigest: plan.codex.config_before_digest,
        targetDigest: plan.codex.config_target_digest,
        bytes: targetConfig,
      });
    }
    updateOperation(paths, plan, 'CONFIG_WRITTEN', { created_links: createdLinks });
    if (faultPhase === 'after_config') fail('injected_fault', 'fault after config write', 'recovery_required');
    for (let index = 0; index < plan.claude.links.length; index += 1) {
      const link = plan.claude.links[index];
      if (link.before !== 'missing') continue;
      const staged = stageProjection(plan.home, paths, link, index);
      createdLinks.push(staged);
      updateOperation(paths, plan, 'PROJECTION_STAGED', { created_links: createdLinks, pending_projection: link.path });
      createdLinks[createdLinks.length - 1] = publishStagedProjection(plan.home, staged);
      updateOperation(paths, plan, 'PROJECTION_CREATED', { created_links: createdLinks });
    }
    updateOperation(paths, plan, 'PROJECTIONS_WRITTEN', { created_links: createdLinks });
    if (faultPhase === 'after_projections') fail('injected_fault', 'fault after projection write', 'recovery_required');
    const surfaceIssues = surfacesReady(plan);
    if (surfaceIssues.length > 0) fail('postcondition_failed', surfaceIssues.join(', '), 'recovery_required');
    updateOperation(paths, plan, 'VERIFYING', { created_links: createdLinks });
    const activeAfter = {
      schema_version: RUNTIME_PROFILE_SCHEMAS.active,
      profile_id: plan.profile_id,
      operation_id: id,
      plan_hash: plan.plan_hash,
      policy_digest: plan.policy_digest,
      deployment_digest: plan.deployment_digest,
      managed_block_digest: plan.codex.managed_block_digest,
      activated_at: new Date().toISOString(),
    };
    const activeTransition = stageActiveRecord(plan.home, plan, paths, activeAfter);
    updateOperation(paths, plan, 'ACTIVE_STAGED', { created_links: createdLinks, active_transition: activeTransition });
    publishActiveRecord(plan.home, paths, activeTransition);
    updateOperation(paths, plan, 'ACTIVE_PUBLISHED', { created_links: createdLinks, active_transition: activeTransition });
    if (faultPhase === 'after_active') fail('injected_fault', 'fault after active record write', 'recovery_required');
    updateOperation(paths, plan, 'COMMITTED', { created_links: createdLinks, active_transition: activeTransition });
    const status = statusRuntimeProfile({ home: plan.home, policyPath: plan.policy_path });
    if (status.status !== 'DEPLOYMENT_READY') fail('postcondition_failed', status.issues.join(', '), 'recovery_required');
    return {
      schema_version: RUNTIME_PROFILE_SCHEMAS.apply,
      status: 'DEPLOYMENT_READY',
      runtime_status: 'UNVERIFIED',
      operation_id: id,
      plan_hash: plan.plan_hash,
      mutation_occurred: true,
      recovery_root: paths.operationRoot,
    };
  } catch (error) {
    if (mutationStarted) {
      try {
        restorePreState(plan.home, plan, paths, createdLinks);
        updateOperation(paths, plan, 'ROLLED_BACK', { error_code: error.code ?? 'unexpected_error', created_links: createdLinks });
      } catch (rollbackError) {
        try { updateOperation(paths, plan, 'RECOVERY_REQUIRED', { error_code: rollbackError.code ?? 'rollback_failed' }); } catch {}
        fail(rollbackError.code ?? 'rollback_failed', rollbackError.message, 'recovery_required');
      }
    } else {
      try { updateOperation(paths, plan, 'ABORTED_STALE', { error_code: error.code ?? 'unexpected_error' }); } catch {}
    }
    throw error;
  } finally {
    releaseLock(lock);
  }
}

export function statusRuntimeProfile({ home, policyPath = DEFAULT_RUNTIME_POLICY }) {
  const root = normalizedHome(home);
  let plan;
  try { plan = compileRuntimeProfilePlan({ home: root, policyPath, validateCandidate: false }); } catch (error) {
    if (error instanceof RuntimeProfileError) {
      return { schema_version: RUNTIME_PROFILE_SCHEMAS.status, profile_id: 'default', status: 'BLOCKED', runtime_status: 'UNVERIFIED', issues: [error.code], diagnostic: error.message };
    }
    throw error;
  }
  const issues = [];
  if (plan.codex.config_before_digest !== plan.codex.config_target_digest) issues.push('CODEX_PROFILE_DRIFT');
  for (const link of plan.claude.links) if (link.before !== 'exact') issues.push(`CLAUDE_PROJECTION_MISSING:${link.name}`);
  const active = readActive(root);
  if (!active) {
    const operationsRoot = profilePaths(root).operationsRoot;
    let orphaned = false;
    try {
      const stat = lstatSync(operationsRoot);
      orphaned = stat.isSymbolicLink() || !stat.isDirectory()
        || readdirSync(operationsRoot).some((name) => OPERATION_ID.test(name));
    } catch (error) {
      if (error.code !== 'ENOENT') orphaned = true;
    }
    issues.push(orphaned ? 'ORPHANED_CONTROL' : 'PROFILE_NOT_APPLIED');
  }
  else if (!validActiveRecord(active.value)) issues.push('ACTIVE_RECORD_INVALID');
  else {
    if (active.value.policy_digest !== plan.policy_digest || active.value.deployment_digest !== plan.deployment_digest) {
      issues.push('ACTIVE_DEPLOYMENT_DRIFT');
    }
    try {
      const loaded = loadOperation(root, active.value.operation_id);
      const afterBytes = readPrivateFile(
        root,
        join(loaded.paths.operationRoot, 'active.after.json'),
        'active_operation_unavailable',
      );
      if (loaded.operation.state !== 'COMMITTED'
          || loaded.plan.plan_hash !== active.value.plan_hash
          || loaded.plan.policy_digest !== active.value.policy_digest
          || loaded.plan.deployment_digest !== active.value.deployment_digest
          || sha256(afterBytes) !== sha256(active.bytes)
          || loaded.operation.active_transition?.staged?.digest !== sha256(active.bytes)) {
        issues.push('ACTIVE_OPERATION_NOT_COMMITTED');
      }
    } catch { issues.push('ACTIVE_OPERATION_UNAVAILABLE'); }
  }
  return {
    schema_version: RUNTIME_PROFILE_SCHEMAS.status,
    profile_id: plan.profile_id,
    status: issues.length === 0 ? 'DEPLOYMENT_READY' : 'DRIFT',
    runtime_status: 'UNVERIFIED',
    policy_digest: plan.policy_digest,
    deployment_digest: plan.deployment_digest,
    codex_disabled_count: plan.codex.disabled_paths.length,
    claude_projection_count: plan.claude.links.length,
    cursor_mutation_policy: plan.cursor.mutation_policy,
    active_operation_id: active?.value?.operation_id ?? null,
    issues,
  };
}

function loadOperation(home, requestedId, { allowPointerLag = false } = {}) {
  if (!OPERATION_ID.test(requestedId ?? '')) fail('invalid_operation_id', 'invalid runtime profile operation id', 'invalid');
  const paths = profilePaths(home, requestedId);
  assertSafeAncestors(home, paths.operationRoot);
  let rawPlan;
  try {
    const bytes = readPrivateFile(home, join(paths.operationRoot, 'plan.json'), 'invalid_operation');
    rawPlan = JSON.parse(decodeUtf8(bytes, 'plan.json'));
  } catch (error) {
    if (error instanceof RuntimeProfileError) throw error;
    fail('invalid_operation', error.message, 'recovery_required');
  }
  const plan = validateRuntimeProfilePlan(rawPlan);
  if (operationId(plan) !== requestedId) fail('invalid_operation', 'operation id does not match plan');
  const current = currentOperation(paths, plan, { allowPointerLag });
  return { paths, plan, operation: current.record, current };
}

export function undoRuntimeProfile({ home, operationId: requestedId, confirmation, faultPhase = null }) {
  const root = normalizedHome(home);
  if (confirmation !== requestedId) fail('confirmation_mismatch', 'undo confirmation must equal operation id', 'invalid');
  let loaded = loadOperation(root, requestedId);
  if (loaded.operation.state !== 'COMMITTED') fail('operation_not_committed', loaded.operation.state);
  const lock = acquireLock(root, loaded.plan);
  try {
    loaded = loadOperation(root, requestedId);
    const active = readActive(root);
    if (active?.value?.operation_id !== requestedId || active.value.plan_hash !== loaded.plan.plan_hash) {
      fail('active_operation_conflict', 'only the active runtime profile operation can be undone');
    }
    updateOperation(loaded.paths, loaded.plan, 'UNDOING', {
      intent: 'undo',
      created_links: loaded.operation.created_links ?? [],
    });
    if (faultPhase === 'kill_after_undo_wal') process.kill(process.pid, 'SIGKILL');
    try {
      restorePreState(root, loaded.plan, loaded.paths, loaded.operation.created_links ?? []);
      if (faultPhase === 'after_undo_restore') fail('injected_fault', 'fault after undo restore', 'recovery_required');
      updateOperation(loaded.paths, loaded.plan, 'UNDONE', {
        intent: 'undo',
        created_links: loaded.operation.created_links ?? [],
      });
    } catch (error) {
      try {
        updateOperation(loaded.paths, loaded.plan, 'RECOVERY_REQUIRED', {
          intent: 'undo',
          error_code: error.code ?? 'undo_failed',
          created_links: loaded.operation.created_links ?? [],
        });
      } catch {}
      throw error;
    }
    return { schema_version: 'skills-refiner.runtime-profile.undo.v1', status: 'RESTORED_PRESTATE', operation_id: requestedId, mutation_occurred: true };
  } finally { releaseLock(lock); }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function clearOwnedStaleLock(home, operation, paths) {
  const lockPath = profilePaths(home).lock;
  if (!existsSync(lockPath)) return;
  let lock;
  try {
    lock = JSON.parse(decodeUtf8(
      readPrivateFile(home, lockPath, 'invalid_stale_lock'),
      lockPath,
    ));
  } catch (error) {
    if (error instanceof RuntimeProfileError) throw error;
    fail('invalid_stale_lock', `${lockPath}: ${error.message}`, 'recovery_required');
  }
  if (lock.kind !== 'runtime-profile' || lock.operation_id !== operation.operation_id
      || lock.plan_hash !== operation.plan_hash || processAlive(lock.pid)) {
    fail('live_or_foreign_lock', 'runtime profile lock is live or belongs to another operation', 'recovery_required');
  }
  const identity = inspectCollectionEntry({ home, path: lockPath });
  const destination = join(paths.operationRoot, 'stale-lock.json');
  if (existsSync(destination)) fail('stale_lock_quarantine_conflict', destination, 'recovery_required');
  moveCollectionEntryExclusive({
    home,
    source: lockPath,
    destination,
    expectedManifest: identity.manifest_hash,
    expectedDevice: identity.device,
    expectedInode: identity.inode,
  });
}

export function recoverRuntimeProfile({ home, operationId: requestedId, confirmation }) {
  const root = normalizedHome(home);
  if (confirmation !== requestedId) fail('confirmation_mismatch', 'recover confirmation must equal operation id', 'invalid');
  let loaded = loadOperation(root, requestedId, { allowPointerLag: true });
  clearOwnedStaleLock(root, loaded.operation, loaded.paths);
  if (!loaded.current.pointer_lag && ['ROLLED_BACK', 'UNDONE'].includes(loaded.operation.state)) {
    return { schema_version: 'skills-refiner.runtime-profile.recover.v1', status: 'RESTORED_PRESTATE', operation_id: requestedId, mutation_occurred: false };
  }
  if (!loaded.current.pointer_lag && loaded.operation.state === 'COMMITTED') {
    const status = statusRuntimeProfile({ home: root, policyPath: loaded.plan.policy_path });
    if (status.status !== 'DEPLOYMENT_READY' || status.active_operation_id !== requestedId) {
      fail('committed_operation_drift', status.issues.join(', '), 'recovery_required');
    }
    return { schema_version: 'skills-refiner.runtime-profile.recover.v1', status: 'DEPLOYMENT_READY', operation_id: requestedId, mutation_occurred: false };
  }
  const lock = acquireLock(root, loaded.plan);
  try {
    repairOperationView(root, loaded.current);
    loaded = loadOperation(root, requestedId);
    if (['ROLLED_BACK', 'UNDONE'].includes(loaded.operation.state)) {
      return { schema_version: 'skills-refiner.runtime-profile.recover.v1', status: 'RESTORED_PRESTATE', operation_id: requestedId, mutation_occurred: false };
    }
    if (loaded.operation.state === 'COMMITTED') {
      const status = statusRuntimeProfile({ home: root, policyPath: loaded.plan.policy_path });
      if (status.status !== 'DEPLOYMENT_READY' || status.active_operation_id !== requestedId) {
        fail('committed_operation_drift', status.issues.join(', '), 'recovery_required');
      }
      return { schema_version: 'skills-refiner.runtime-profile.recover.v1', status: 'DEPLOYMENT_READY', operation_id: requestedId, mutation_occurred: false };
    }
    const restoringUndo = loaded.operation.intent === 'undo'
      && ['UNDOING', 'RECOVERY_REQUIRED'].includes(loaded.operation.state);
    restorePreState(root, loaded.plan, loaded.paths, loaded.operation.created_links ?? []);
    updateOperation(loaded.paths, loaded.plan, restoringUndo ? 'UNDONE' : 'ROLLED_BACK', {
      intent: restoringUndo ? 'undo' : loaded.operation.intent,
      recovered: true,
      created_links: loaded.operation.created_links ?? [],
    });
    return { schema_version: 'skills-refiner.runtime-profile.recover.v1', status: 'RESTORED_PRESTATE', operation_id: requestedId, mutation_occurred: true };
  } catch (error) {
    try { updateOperation(loaded.paths, loaded.plan, 'RECOVERY_REQUIRED', { error_code: error.code ?? 'recover_failed' }); } catch {}
    throw error;
  } finally { releaseLock(lock); }
}

export function removeRuntimeProfileFixture(path) {
  // Test-only helper is intentionally not used by the CLI.
  rmSync(path, { recursive: true, force: true });
}
