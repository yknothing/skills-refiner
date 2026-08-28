import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { materializeGitRevision, sourceGitAccess } from '../lib/git-source-attestation.mjs';

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function git(root, args, options = {}) {
  return spawnSync('/usr/bin/git', ['-C', root, ...args], {
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/',
      LANG: 'C',
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_AUTHOR_DATE: '2026-07-20T00:00:00Z',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_DATE: '2026-07-20T00:00:00Z',
    },
  });
}

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'skills-refiner-git-source-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const initialized = git(root, ['init', '-q']);
  assert.equal(initialized.status, 0, initialized.stderr);
  return root;
}

function blob(root, body) {
  const created = git(root, ['hash-object', '-w', '--stdin'], { input: body });
  assert.equal(created.status, 0, created.stderr);
  return created.stdout.trim();
}

function tree(root, records) {
  const chunks = records.map(({ mode = '100644', type = 'blob', oid, path }) => Buffer.concat([
    Buffer.from(`${mode} ${type} ${oid}\t`), Buffer.isBuffer(path) ? path : Buffer.from(path), Buffer.from([0]),
  ]));
  const created = git(root, ['mktree', '-z'], { encoding: null, input: Buffer.concat(chunks) });
  assert.equal(created.status, 0, created.stderr?.toString());
  return created.stdout.toString('ascii').trim();
}

function literalTree(root, records) {
  const body = Buffer.concat(records.map(({ mode = '100644', oid, path }) => Buffer.concat([
    Buffer.from(`${mode} ${path}\0`), Buffer.from(oid, 'hex'),
  ])));
  const created = git(root, ['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'], {
    encoding: null, input: body,
  });
  assert.equal(created.status, 0, created.stderr?.toString());
  return created.stdout.toString('ascii').trim();
}

function commit(root, treeOid) {
  const created = git(root, ['commit-tree', treeOid, '-m', 'fixture tree']);
  assert.equal(created.status, 0, created.stderr);
  return created.stdout.trim();
}

function materialize(root, revision) {
  const { readObjects } = sourceGitAccess(root);
  materializeGitRevision({
    readObjects, revision, destination: join(root, 'materialized'), fail: failure,
  });
}

test('raw materializer rejects non-UTF-8 Git paths without lossy replacement', (t) => {
  const root = repository(t);
  const oid = blob(root, Buffer.from('bytes\n'));
  const treeOid = tree(root, [{ oid, path: Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x78, 0x74]) }]);
  assert.throws(() => materialize(root, commit(root, treeOid)), /non-UTF-8 path/u);
});

test('raw materializer rejects case-folding path collisions before publication', (t) => {
  const root = repository(t);
  const oid = blob(root, Buffer.from('bytes\n'));
  const treeOid = tree(root, [{ oid, path: 'Member.txt' }, { oid, path: 'member.txt' }]);
  assert.throws(() => materialize(root, commit(root, treeOid)), /filesystem path collision/u);
});

test('raw materializer rejects reserved nested .git path components', (t) => {
  const root = repository(t);
  const oid = blob(root, Buffer.from('bytes\n'));
  const nested = tree(root, [{ oid, path: 'config' }]);
  const rootTree = tree(root, [{ mode: '040000', type: 'tree', oid: nested, path: '.GIT' }]);
  assert.throws(() => materialize(root, commit(root, rootTree)), /reserved \.git path component/u);
});

test('raw materializer rejects non-canonical Unicode paths', (t) => {
  const root = repository(t);
  const oid = blob(root, Buffer.from('bytes\n'));
  const treeOid = tree(root, [{ oid, path: `e\u0301.txt` }]);
  assert.throws(() => materialize(root, commit(root, treeOid)), /non-portable path/u);
});

test('raw materializer rejects unresolved Git LFS pointers', (t) => {
  const root = repository(t);
  const pointer = Buffer.from([
    '   ',
    '\t',
    '  version https://git-lfs.github.com/spec/v1',
    'ext-0-example sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    `oid sha256:${'a'.repeat(64)}`,
    'size +0 ',
    ' ',
  ].join('\r\n'));
  const oid = blob(root, pointer);
  const treeOid = tree(root, [{ oid, path: 'asset.bin' }]);
  assert.throws(() => materialize(root, commit(root, treeOid)), /unresolved Git LFS payload/u);
});

test('raw materializer rejects duplicate entries in a malformed Git tree', (t) => {
  const root = repository(t);
  const first = blob(root, Buffer.from('first\n'));
  const second = blob(root, Buffer.from('second\n'));
  const treeOid = literalTree(root, [
    { oid: first, path: 'duplicate.txt' },
    { oid: second, path: 'duplicate.txt' },
  ]);
  assert.throws(() => materialize(root, commit(root, treeOid)), /duplicate path/u);
});

test('raw materializer rejects duplicate directory entries in a malformed Git tree', (t) => {
  const root = repository(t);
  const oid = blob(root, Buffer.from('bytes\n'));
  const first = tree(root, [{ oid, path: 'first.txt' }]);
  const second = tree(root, [{ oid, path: 'second.txt' }]);
  const rootTree = literalTree(root, [
    { mode: '40000', oid: first, path: 'duplicate' },
    { mode: '40000', oid: second, path: 'duplicate' },
  ]);
  assert.throws(() => materialize(root, commit(root, rootTree)), /duplicate path/u);
});

test('raw materializer rejects slash-bearing names in malformed Git trees', (t) => {
  const root = repository(t);
  const oid = blob(root, Buffer.from('bytes\n'));
  const treeOid = literalTree(root, [{ oid, path: 'flat/nested.txt' }]);
  assert.throws(() => materialize(root, commit(root, treeOid)), /unsafe path component/u);
});

test('raw materializer rejects non-canonical Git tree ordering', (t) => {
  const root = repository(t);
  const oid = blob(root, Buffer.from('bytes\n'));
  const treeOid = literalTree(root, [
    { oid, path: 'second.txt' },
    { oid, path: 'first.txt' },
  ]);
  assert.throws(() => materialize(root, commit(root, treeOid)), /not canonically ordered/u);
});

test('raw materializer preserves binary bytes, executable mode, empty blobs, and repeated blob identities', (t) => {
  const root = repository(t);
  const binary = Buffer.from([0x00, 0xff, 0x0a, 0x7f]);
  const binaryOid = blob(root, binary);
  const emptyOid = blob(root, Buffer.alloc(0));
  const treeOid = tree(root, [
    { mode: '100755', oid: binaryOid, path: 'executable.bin' },
    { oid: binaryOid, path: 'repeated.bin' },
    { oid: emptyOid, path: 'empty.txt' },
  ]);
  materialize(root, commit(root, treeOid));
  assert.deepEqual(readFileSync(join(root, 'materialized/executable.bin')), binary);
  assert.deepEqual(readFileSync(join(root, 'materialized/repeated.bin')), binary);
  assert.equal(readFileSync(join(root, 'materialized/empty.txt')).length, 0);
  assert.equal(lstatSync(join(root, 'materialized/executable.bin')).mode & 0o777, 0o755);
  assert.equal(lstatSync(join(root, 'materialized/repeated.bin')).mode & 0o777, 0o644);
});

test('raw materializer preserves explicit empty Git trees', (t) => {
  const root = repository(t);
  const emptyTree = tree(root, []);
  const rootTree = tree(root, [{ mode: '040000', type: 'tree', oid: emptyTree, path: 'empty-directory' }]);
  materialize(root, commit(root, rootTree));
  const directory = join(root, 'materialized/empty-directory');
  assert.equal(lstatSync(directory).isDirectory(), true);
  assert.equal(lstatSync(directory).mode & 0o777, 0o755);
});

test('raw materializer removes a partial destination after filesystem write failure', (t) => {
  const root = repository(t);
  const oid = blob(root, Buffer.from('bytes\n'));
  const overlong = 'x'.repeat(300);
  const treeOid = literalTree(root, [{ oid, path: overlong }]);
  assert.throws(() => materialize(root, commit(root, treeOid)), /ENAMETOOLONG|name too long/iu);
  assert.equal(existsSync(join(root, 'materialized')), false);
});
