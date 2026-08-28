import { createHash } from 'node:crypto';
import {
  chmodSync, cpSync, lstatSync, readFileSync, readdirSync, realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

function walk(root, current, hash, fail, ignoredBasenames) {
  const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    if (ignoredBasenames.has(entry.name)) continue;
    const path = join(current, entry.name);
    const rel = relative(root, path);
    // Git worktrees store repository metadata as either a directory or a
    // pointer file. Neither form is part of the immutable source artifact.
    if (rel === '.git') continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail('source_symlink', `tree contains symlink: ${path}`);
    if (stat.isDirectory()) {
      hash.update(`d\0${rel}\0${stat.mode & 0o777}\0`);
      walk(root, path, hash, fail, ignoredBasenames);
    } else if (stat.isFile()) {
      hash.update(`f\0${rel}\0${stat.mode & 0o777}\0${stat.size}\0`);
      hash.update(readFileSync(path));
      hash.update('\0');
    } else fail('unsafe_tree_entry', `tree contains unsupported entry: ${path}`);
  }
}

export function computeTreeDigest(root, fail, { ignoredBasenames = [] } = {}) {
  if (typeof fail !== 'function') throw new TypeError('computeTreeDigest requires a fail callback');
  if (!isAbsolute(root)) fail('unsafe_path', 'tree root must be absolute');
  let stat;
  try { stat = lstatSync(root); } catch { fail('missing_path', `tree root is missing: ${root}`); }
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(root) !== root) fail('unsafe_path', `tree root must be a canonical real directory: ${root}`);
  const hash = createHash('sha256');
  walk(root, root, hash, fail, new Set(ignoredBasenames));
  return `sha256:${hash.digest('hex')}`;
}

function restoreCopiedModes(source, destination, fail) {
  const sourceStat = lstatSync(source);
  const destinationStat = lstatSync(destination);
  if (sourceStat.isSymbolicLink() || destinationStat.isSymbolicLink()) {
    fail('source_symlink', `copied tree contains symlink: ${source}`);
  }
  if (sourceStat.isDirectory() !== destinationStat.isDirectory()
      || sourceStat.isFile() !== destinationStat.isFile()) {
    fail('copy_identity_mismatch', `copied tree changed entry type: ${source}`);
  }
  chmodSync(destination, sourceStat.mode & 0o777);
  if (!sourceStat.isDirectory()) return;
  for (const entry of readdirSync(destination, { withFileTypes: true })) {
    restoreCopiedModes(join(source, entry.name), join(destination, entry.name), fail);
  }
}

/**
 * fs.cpSync applies the caller's ambient umask while creating directories.
 * Collection identity includes permission bits, so restore every copied mode
 * explicitly before hashing or publishing the copy.
 */
export function copyTreeWithStableModes(source, destination, options, fail) {
  if (typeof fail !== 'function') throw new TypeError('copyTreeWithStableModes requires a fail callback');
  cpSync(source, destination, options);
  restoreCopiedModes(source, destination, fail);
}
