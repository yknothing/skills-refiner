import { createHash } from 'node:crypto';
import {
  chmodSync, closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_MATERIALIZED_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_NODES = 100_000;
const MAX_TREE_DEPTH = 64;

export function sourceGitEnvironment() {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/',
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function sourceGitAccess(root) {
  const env = sourceGitEnvironment();
  return {
    git: (...args) => spawnSync('/usr/bin/git', ['-C', root, ...args], {
      encoding: 'utf8', env, maxBuffer: MAX_MATERIALIZED_BYTES,
    }),
    readObjects: (input, maxBuffer) => spawnSync('/usr/bin/git', ['-C', root, 'cat-file', '--batch'], {
      encoding: null, env, input, maxBuffer,
    }),
  };
}

export function originTrackingRefsContaining(git, revision) {
  const observed = git(
    'for-each-ref', `--contains=${revision}`, '--format=%(refname)', 'refs/remotes/origin',
  );
  if (observed.status !== 0) return { ok: false, refs: [] };
  const refs = observed.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.startsWith('refs/remotes/origin/')
      && value !== 'refs/remotes/origin/HEAD')
    .sort((left, right) => left.localeCompare(right, 'en'));
  return { ok: true, refs };
}

function pathIdentityKey(component) {
  return component.normalize('NFC').toLowerCase();
}

function registerPathNode(nodes, path, type, fail) {
  const key = path.split('/').map(pathIdentityKey).join('/');
  const prior = nodes.get(key);
  if (prior) {
    fail('source_path_collision', `approved Git revision has a filesystem path collision: ${prior.path} / ${path}`);
  }
  nodes.set(key, { path, type });
}

function validatedComponent(pathBytes, fail) {
  let component;
  try { component = new TextDecoder('utf-8', { fatal: true }).decode(pathBytes); }
  catch { fail('unsafe_source_path', 'approved Git revision contains a non-UTF-8 path'); }
  if (!Buffer.from(component, 'utf8').equals(pathBytes)) {
    fail('unsafe_source_path', 'approved Git revision path is not losslessly UTF-8 encoded');
  }
  if (component === '' || component === '.' || component === '..' || component.includes('/')) {
    fail('unsafe_source_entry', `approved Git revision contains unsafe path component: ${component}`);
  }
  if (component.normalize('NFC') !== component
      || /[\p{Cc}\p{Default_Ignorable_Code_Point}]/u.test(component)) {
    fail('unsafe_source_path', `approved Git revision contains a non-portable path: ${component}`);
  }
  if (pathIdentityKey(component) === '.git') {
    fail('unsafe_source_entry', `approved Git revision contains reserved .git path component: ${component}`);
  }
  return component;
}

function gitObjectIdentity(body, oid, type, fail) {
  const algorithm = oid.length === 40 ? 'sha1' : oid.length === 64 ? 'sha256' : null;
  if (algorithm === null) fail('unverified_source', `unsupported Git object format: ${oid}`);
  return createHash(algorithm)
    .update(Buffer.from(`${type} ${body.length}\0`))
    .update(body)
    .digest('hex');
}

function readObjectBatch(readObjects, requested, fail) {
  if (requested.length === 0) return new Map();
  const input = Buffer.from(`${requested.join('\n')}\n`);
  const result = readObjects(input, MAX_MATERIALIZED_BYTES);
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail('unverified_source', 'cannot read approved Git objects');
  }
  const objects = new Map();
  let offset = 0;
  for (const expectedOid of requested) {
    const headerEnd = result.stdout.indexOf(0x0a, offset);
    if (headerEnd < 0) fail('unverified_source', 'approved Git object batch has a truncated header');
    const header = result.stdout.subarray(offset, headerEnd).toString('ascii');
    const match = /^([0-9a-f]+) ([a-z]+) ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== expectedOid) {
      fail('unverified_source', `approved Git object is unavailable: ${expectedOid}`);
    }
    const [, oid, type, rawSize] = match;
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0) fail('unverified_source', `approved Git object has invalid size: ${oid}`);
    const start = headerEnd + 1;
    const end = start + size;
    if (end >= result.stdout.length || result.stdout[end] !== 0x0a) {
      fail('unverified_source', `approved Git object batch is truncated: ${oid}`);
    }
    const body = result.stdout.subarray(start, end);
    if (gitObjectIdentity(body, oid, type, fail) !== oid) {
      fail('git_object_identity_mismatch', `Git object bytes do not match object id: ${oid}`);
    }
    objects.set(oid, { oid, type, body });
    offset = end + 1;
  }
  if (offset !== result.stdout.length) fail('unverified_source', 'approved Git object batch has trailing output');
  return objects;
}

function compareTreeKeys(left, right) {
  return Buffer.compare(left, right);
}

function parseTree(body, hashBytes, fail) {
  const records = [];
  const names = new Set();
  let priorKey = null;
  let offset = 0;
  while (offset < body.length) {
    const modeEnd = body.indexOf(0x20, offset);
    const nameEnd = modeEnd < 0 ? -1 : body.indexOf(0x00, modeEnd + 1);
    if (modeEnd < 0 || nameEnd < 0 || nameEnd + 1 + hashBytes > body.length) {
      fail('unverified_source', 'approved Git tree object is truncated');
    }
    const mode = body.subarray(offset, modeEnd).toString('ascii');
    const nameBytes = body.subarray(modeEnd + 1, nameEnd);
    const oid = body.subarray(nameEnd + 1, nameEnd + 1 + hashBytes).toString('hex');
    offset = nameEnd + 1 + hashBytes;
    let type;
    if (mode === '40000') type = 'directory';
    else if (mode === '100644' || mode === '100755') type = 'file';
    else if (mode === '120000') fail('source_symlink', 'approved Git revision contains a symlink');
    else if (mode === '160000') fail('source_submodule', 'approved Git revision contains a submodule');
    else fail('unsafe_source_entry', `approved Git revision contains unsupported mode: ${mode}`);
    const name = validatedComponent(nameBytes, fail);
    if (names.has(name)) fail('source_path_collision', `approved Git revision contains duplicate path component: ${name}`);
    names.add(name);
    const sortKey = Buffer.concat([nameBytes, Buffer.from([type === 'directory' ? 0x2f : 0x00])]);
    if (priorKey !== null && compareTreeKeys(priorKey, sortKey) >= 0) {
      fail('noncanonical_git_tree', `approved Git tree entries are not canonically ordered near: ${name}`);
    }
    priorKey = sortKey;
    records.push({ mode: mode === '100755' ? 0o755 : 0o644, name, oid, type });
  }
  return records;
}

function revisionEntries(readObjects, revision, fail) {
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/u.test(revision)) {
    fail('invalid_revision', 'revision must be a full commit object id');
  }
  const commit = readObjectBatch(readObjects, [revision], fail).get(revision);
  if (commit.type !== 'commit') fail('unverified_source', 'approved revision is not a Git commit object');
  const commitHeader = /^tree ([0-9a-f]+)\n/u.exec(commit.body.toString('utf8'));
  if (!commitHeader || commitHeader[1].length !== revision.length) {
    fail('unverified_source', 'approved Git commit has an invalid root tree');
  }
  const hashBytes = revision.length / 2;
  const entries = new Map();
  const nodes = new Map();
  const treeCache = new Map();
  let pending = [{ oid: commitHeader[1], prefix: '', depth: 0 }];
  while (pending.length > 0) {
    const missing = [...new Set(pending.map(({ oid }) => oid).filter((oid) => !treeCache.has(oid)))];
    const objects = readObjectBatch(readObjects, missing, fail);
    for (const [oid, object] of objects) {
      if (object.type !== 'tree') fail('unverified_source', `approved Git tree points to non-tree object: ${oid}`);
      treeCache.set(oid, parseTree(object.body, hashBytes, fail));
    }
    const next = [];
    for (const context of pending) {
      if (context.depth > MAX_TREE_DEPTH) fail('unsafe_source_entry', 'approved Git revision exceeds maximum tree depth');
      for (const record of treeCache.get(context.oid)) {
        const path = context.prefix.length === 0 ? record.name : `${context.prefix}/${record.name}`;
        registerPathNode(nodes, path, record.type, fail);
        if (nodes.size > MAX_SOURCE_NODES) fail('unsafe_source_entry', 'approved Git revision exceeds maximum path count');
        if (record.type === 'directory') {
          next.push({ oid: record.oid, prefix: path, depth: context.depth + 1 });
        } else {
          entries.set(path, { mode: record.mode, oid: record.oid });
        }
      }
    }
    pending = next;
  }
  return { entries, nodes };
}

function isGitLfsPointer(body) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { return false; }
  const lines = text.replace(/\r\n/gu, '\n').split('\n').filter((line) => line.trim().length > 0);
  if (lines.shift()?.trim() !== 'version https://git-lfs.github.com/spec/v1') return false;
  const hasOid = lines.some((line) => /^oid[ \t]+sha256:[0-9a-f]{64}[ \t]*$/iu.test(line));
  const hasSize = lines.some((line) => /^size[ \t]+[+-]?[0-9]+[ \t]*$/u.test(line));
  return hasOid && hasSize;
}

function revisionBlobs(readObjects, entries, fail) {
  const requested = [...new Set([...entries.values()].map(({ oid }) => oid))];
  const objects = readObjectBatch(readObjects, requested, fail);
  for (const [oid, object] of objects) {
    if (object.type !== 'blob') fail('unverified_source', `approved Git file points to non-blob object: ${oid}`);
    if (isGitLfsPointer(object.body)) {
      fail('source_lfs_pointer', `approved Git revision requires unresolved Git LFS payload: ${oid}`);
    }
  }
  return objects;
}

function verifyMaterializedRevision(root, entries, nodes, fail) {
  const observed = new Set();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const rel = relative(root, path);
      const expectedNode = nodes.get(rel.split('/').map(pathIdentityKey).join('/'));
      if (!expectedNode || expectedNode.path !== rel) {
        fail('git_path_identity_mismatch', `materialized Git path changed identity: ${rel}`);
      }
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) fail('unsafe_source_entry', `materialized Git revision contains symlink: ${rel}`);
      if (stat.isDirectory()) {
        if (expectedNode.type !== 'directory' || (stat.mode & 0o777) !== 0o755) {
          fail('git_path_identity_mismatch', `materialized Git directory changed identity: ${rel}`);
        }
        observed.add(rel);
        walk(path);
      } else if (stat.isFile()) {
        const expected = entries.get(rel);
        if (!expected || expectedNode.type !== 'file' || (stat.mode & 0o777) !== expected.mode
            || gitObjectIdentity(readFileSync(path), expected.oid, 'blob', fail) !== expected.oid) {
          fail('git_object_identity_mismatch', `materialized Git blob changed identity: ${rel}`);
        }
        observed.add(rel);
      } else fail('unsafe_source_entry', `materialized Git revision contains unsupported entry: ${rel}`);
    }
  };
  walk(root);
  for (const { path } of nodes.values()) {
    if (!observed.has(path)) fail('git_path_identity_mismatch', `materialized Git revision is missing path: ${path}`);
  }
}

function ensureParentDirectories(root, relativePath) {
  const parts = relativePath.split('/').slice(0, -1);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    mkdirSync(current, { recursive: true, mode: 0o755 });
    chmodSync(current, 0o755);
  }
}

function writeBlobDurably(path, blob, mode) {
  const descriptor = openSync(path, 'wx', mode);
  try {
    writeFileSync(descriptor, blob);
    fchmodSync(descriptor, mode);
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
}

function fsyncDirectories(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) fsyncDirectories(join(root, entry.name));
  }
  const descriptor = openSync(root, 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

/** Materialize only bytes and executable bits selected by the approved commit. */
export function materializeGitRevision({ readObjects, revision, destination, fail }) {
  if (typeof fail !== 'function') throw new TypeError('materializeGitRevision requires a fail callback');
  if (typeof readObjects !== 'function') throw new TypeError('materializeGitRevision requires a readObjects callback');
  if (existsSync(destination)) fail('target_conflict', `Git revision destination already exists: ${destination}`);
  const { entries, nodes } = revisionEntries(readObjects, revision, fail);
  const blobs = revisionBlobs(readObjects, entries, fail);
  let complete = false;
  try {
    mkdirSync(destination, { recursive: false, mode: 0o755 });
    chmodSync(destination, 0o755);
    for (const { path, type } of nodes.values()) {
      if (type !== 'directory') continue;
      const directory = join(destination, ...path.split('/'));
      mkdirSync(directory, { recursive: true, mode: 0o755 });
      chmodSync(directory, 0o755);
    }
    for (const [relativePath, { mode, oid }] of entries) {
      ensureParentDirectories(destination, relativePath);
      const path = join(destination, ...relativePath.split('/'));
      writeBlobDurably(path, blobs.get(oid).body, mode);
    }
    verifyMaterializedRevision(destination, entries, nodes, fail);
    fsyncDirectories(destination);
    complete = true;
  } finally {
    if (!complete && existsSync(destination)) rmSync(destination, { recursive: true, force: true });
  }
}
