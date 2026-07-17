#!/usr/bin/env node
/**
 * Validates ADR-0002 skills-pack-catalog.yaml structure and membership.
 * Does not mount skills. Exit 0 on success; non-zero on failure.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(SCRIPT_DIR, 'skills-pack-catalog.yaml');
const HOME_DIR = homedir();
const DEPLOY_ROOT = process.env.SKILLS_DEPLOY_ROOT
  ? resolve(process.env.SKILLS_DEPLOY_ROOT)
  : join(HOME_DIR, '.agents', 'skills');

const EXIT_OK = 0;
const EXIT_FAIL = 1;

/**
 * Redacts absolute home prefixes so logs/CI pastebacks do not leak usernames.
 * @param {string} absolutePath
 * @returns {string}
 */
function displayPath(absolutePath) {
  const resolved = resolve(absolutePath);
  if (resolved === HOME_DIR) return '~';
  if (resolved.startsWith(`${HOME_DIR}/`)) {
    return `~/${resolved.slice(HOME_DIR.length + 1)}`;
  }
  return resolved;
}

const REQUIRED_TOP_LEVEL = [
  'schema_version',
  'catalog_id',
  'updated',
  'status',
  'enforcement',
  'constants',
  'profile',
  'packs',
  'archive',
];

/**
 * Minimal YAML subset parser for this catalog shape (maps/lists/scalars).
 * Avoids adding a dependency solely for ADR validation.
 * @param {string} text
 * @returns {unknown}
 */
function parseSimpleYaml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, value: root, kind: 'map' }];

  /**
   * @param {string} raw
   * @returns {string|number|boolean}
   */
  function parseScalar(raw) {
    const v = raw.trim();
    if (
      (v.startsWith('"') && v.endsWith('"'))
      || (v.startsWith("'") && v.endsWith("'"))
    ) {
      return v.slice(1, -1);
    }
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    if (trimmed.startsWith('- ')) {
      const itemRaw = trimmed.slice(2);
      if (parent.kind !== 'list') {
        throw new Error(`list item under non-list at: ${trimmed}`);
      }
      if (itemRaw.includes(':') && !itemRaw.startsWith('"') && !itemRaw.startsWith("'")) {
        const map = {};
        const idx = itemRaw.indexOf(':');
        const k = itemRaw.slice(0, idx).trim();
        const rest = itemRaw.slice(idx + 1).trim();
        parent.value.push(map);
        // Keep map on stack so subsequent deeper-indented keys attach to this item.
        stack.push({ indent, value: map, kind: 'map' });
        if (rest !== '') {
          map[k] = parseScalar(rest);
        } else {
          const nested = {};
          map[k] = nested;
          stack.push({ indent: indent + 2, value: nested, kind: 'map' });
        }
      } else {
        parent.value.push(parseScalar(itemRaw));
      }
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon < 0) throw new Error(`invalid line: ${trimmed}`);
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();

    if (parent.kind !== 'map') {
      throw new Error(`map key under non-map: ${key}`);
    }

    if (rest === '') {
      // Lookahead: next non-empty non-comment line decides list vs map.
      let next = null;
      for (let i = lines.indexOf(line) + 1; i < lines.length; i += 1) {
        const cand = lines[i];
        if (!cand.trim() || cand.trim().startsWith('#')) continue;
        next = cand;
        break;
      }
      const nextIndent = next ? next.match(/^\s*/)[0].length : indent;
      const nextTrim = next ? next.trim() : '';
      if (next && nextIndent > indent && nextTrim.startsWith('- ')) {
        const list = [];
        parent.value[key] = list;
        stack.push({ indent, value: list, kind: 'list' });
      } else {
        const map = {};
        parent.value[key] = map;
        stack.push({ indent, value: map, kind: 'map' });
      }
    } else {
      parent.value[key] = parseScalar(rest);
    }
  }

  return root;
}

/**
 * @param {unknown} catalog
 * @returns {string[]}
 */
function collectCatalogSkills(catalog) {
  /** @type {string[]} */
  const names = [];
  const profile = catalog.profile;
  if (profile && Array.isArray(profile.skills)) {
    names.push(...profile.skills);
  }
  const packs = catalog.packs || {};
  for (const pack of Object.values(packs)) {
    if (pack && Array.isArray(pack.skills)) {
      names.push(...pack.skills);
    }
  }
  return names;
}

/**
 * @param {string} root
 * @returns {Set<string>}
 */
function listDeploySkills(root) {
  const set = new Set();
  if (!existsSync(root)) return set;
  for (const name of readdirSync(root)) {
    if (name.startsWith('.')) continue;
    const p = join(root, name);
    try {
      if (!statSync(p).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(p, 'SKILL.md'))) set.add(name);
  }
  return set;
}

function main() {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];

  if (!existsSync(CATALOG_PATH)) {
    console.error(`FAIL missing catalog: ${CATALOG_PATH}`);
    process.exit(EXIT_FAIL);
  }

  let catalog;
  try {
    catalog = parseSimpleYaml(readFileSync(CATALOG_PATH, 'utf8'));
  } catch (err) {
    console.error(`FAIL yaml parse: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT_FAIL);
  }

  for (const key of REQUIRED_TOP_LEVEL) {
    if (catalog[key] === undefined) errors.push(`missing top-level key: ${key}`);
  }

  if (catalog.catalog_id !== 'skills-pack-catalog') {
    errors.push(`catalog_id must be skills-pack-catalog, got ${catalog.catalog_id}`);
  }
  if (catalog.enforcement !== 'none' && catalog.status === 'draft') {
    warnings.push('draft catalog usually keeps enforcement: none');
  }

  const mountAlways = catalog.constants?.mount?.always;
  const mountOnDemand = catalog.constants?.mount?.on_demand;
  const mountNever = catalog.constants?.mount?.never;
  if (!mountAlways || !mountOnDemand || !mountNever) {
    errors.push('constants.mount must define always, on_demand, never');
  }

  if (catalog.profile?.mount !== mountAlways) {
    errors.push(`profile.mount must equal constants.mount.always (${mountAlways})`);
  }
  if (!Array.isArray(catalog.profile?.skills) || catalog.profile.skills.length === 0) {
    errors.push('profile.skills must be a non-empty list');
  }

  for (const [packId, pack] of Object.entries(catalog.packs || {})) {
    if (pack.mount !== mountOnDemand) {
      errors.push(`pack ${packId}.mount must be ${mountOnDemand}`);
    }
    if (!Array.isArray(pack.skills) || pack.skills.length === 0) {
      errors.push(`pack ${packId}.skills must be non-empty`);
    }
  }

  if (catalog.archive?.mount !== mountNever) {
    errors.push(`archive.mount must be ${mountNever}`);
  }

  const listed = collectCatalogSkills(catalog);
  const dup = listed.filter((n, i) => listed.indexOf(n) !== i);
  if (dup.length) {
    errors.push(`duplicate skill membership: ${[...new Set(dup)].join(', ')}`);
  }

  const deploy = listDeploySkills(DEPLOY_ROOT);
  if (deploy.size === 0) {
    warnings.push(`deploy root empty or missing: ${DEPLOY_ROOT}`);
  } else {
    for (const name of listed) {
      if (!deploy.has(name)) {
        errors.push(`catalog skill not on deploy root: ${name}`);
      }
    }
    const listedSet = new Set(listed);
    const uncovered = [...deploy].filter((n) => !listedSet.has(n)).sort();
    if (uncovered.length) {
      errors.push(
        `deploy skills missing from catalog (${uncovered.length}): ${uncovered.join(', ')}`,
      );
    }
  }

  const coreCount = catalog.profile?.skills?.length ?? 0;
  const maxDiscoverable = catalog.targets?.discoverable_skill_count_max;
  if (typeof maxDiscoverable === 'number' && coreCount > maxDiscoverable) {
    errors.push(
      `core size ${coreCount} exceeds targets.discoverable_skill_count_max ${maxDiscoverable}`,
    );
  }

  console.log(`catalog: ${displayPath(CATALOG_PATH)}`);
  console.log(`deploy_root: ${displayPath(DEPLOY_ROOT)}`);
  console.log(`core_count: ${coreCount}`);
  console.log(`listed_count: ${listed.length}`);
  console.log(`deploy_count: ${deploy.size}`);

  for (const w of warnings) console.warn(`WARN ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);

  if (errors.length) {
    console.error(`FAIL ${errors.length} error(s)`);
    process.exit(EXIT_FAIL);
  }
  console.log('PASS skills-pack-catalog validation');
  process.exit(EXIT_OK);
}

main();
