import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export class UpstreamVersionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UpstreamVersionError';
    this.code = code;
  }
}

function fail(code, message) { throw new UpstreamVersionError(code, message); }
function sha256(bytes) { return `sha256:${createHash('sha256').update(bytes).digest('hex')}`; }

function normalizedVersion(value, sourcePath) {
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0
      || [...value].length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('invalid_upstream_version', `invalid upstream version in ${sourcePath}`);
  }
  return value;
}

function parseJsonRootVersion(text, sourcePath) {
  let document;
  try { document = JSON.parse(text); } catch (error) {
    fail('invalid_upstream_version_document', `cannot parse ${sourcePath}: ${error.message}`);
  }
  return normalizedVersion(document?.version, sourcePath);
}

function parsePep621ProjectVersion(text, sourcePath) {
  let inProject = false;
  for (const line of text.replace(/\r\n/gu, '\n').split('\n')) {
    const section = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    if (section) {
      inProject = section[1].trim() === 'project';
      continue;
    }
    if (!inProject || /^\s*(?:#|$)/u.test(line)) continue;
    const match = /^\s*version\s*=\s*(["'])(.*?)\1\s*(?:#.*)?$/u.exec(line);
    if (match) return normalizedVersion(match[2], sourcePath);
  }
  fail('upstream_version_not_found', `PEP 621 project.version is absent in ${sourcePath}`);
}

function parseYamlRootVersion(text, sourcePath) {
  for (const line of text.replace(/\r\n/gu, '\n').split('\n')) {
    const match = /^version:\s*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    let value = match[1];
    const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/u.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/u, '');
    return normalizedVersion(value, sourcePath);
  }
  fail('upstream_version_not_found', `root version is absent in ${sourcePath}`);
}

const PARSERS = Object.freeze({
  json_root_version: parseJsonRootVersion,
  pep621_project_version: parsePep621ProjectVersion,
  yaml_root_version: parseYamlRootVersion,
});

export function upstreamVersionEvidence(root, rule) {
  if (rule === null) {
    return Object.freeze({
      status: 'not_declared', value: null, source_path: null,
      source_digest: null, extraction: null,
    });
  }
  if (typeof root !== 'string' || !isAbsolute(root) || typeof rule?.path !== 'string'
      || !Object.hasOwn(PARSERS, rule.format)) fail('invalid_upstream_version_rule', 'invalid upstream version rule');
  const path = join(root, rule.path);
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    fail('upstream_version_source_missing', `cannot inspect ${path}: ${error.message}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail('unsafe_upstream_version_source', `version source must be a regular file: ${path}`);
  const bytes = readFileSync(path);
  const value = PARSERS[rule.format](bytes.toString('utf8'), rule.path);
  return Object.freeze({
    status: 'declared', value, source_path: rule.path,
    source_digest: sha256(bytes), extraction: rule.format,
  });
}

export function observeUpstreamVersion(root, rule) {
  try { return upstreamVersionEvidence(root, rule); }
  catch (error) {
    if (!(error instanceof UpstreamVersionError)) throw error;
    return Object.freeze({
      status: 'invalid', value: null, source_path: rule?.path ?? null,
      source_digest: null, extraction: rule?.format ?? null, error_code: error.code,
    });
  }
}
