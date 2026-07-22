/**
 * 八类缺口与六列归一化金样（ADR-0007 §12.7；O9=C 含部分投影第八类）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CATALOG_ACTIVE_VALUES, GAP_CLASSES, LINK_HEALTH_VALUES } from '../lib/panorama-constants.mjs';
import { normalizePanoramaRows, assertNoCollapsedFields } from '../lib/panorama-normalize.mjs';
import { attachGapClasses, classifyGap, isCatalogDrift } from '../lib/panorama-gaps.mjs';
import { redactHomePaths, buildPanoramaDocument, renderPanoramaMarkdown } from '../lib/panorama-render.mjs';

const AGENTS = [
  { id: 'claude', label_zh: 'Claude Code', location: '.claude/skills', present: true },
  { id: 'cursor', label_zh: 'Cursor', location: '.cursor/skills', present: true },
  { id: 'codex', label_zh: 'Codex', location: '.codex/skills', present: true },
];

/**
 * 构造最小 scan 条目。
 * @param {{ name: string, location: string, entry_kind: string, entry_path?: string, hash?: string, link_target?: string|null, canonical_dir?: string|null, canonical_skill_file?: string|null }} partial
 */
function entry(partial) {
  return {
    name: partial.name,
    dir_name: partial.name,
    location: partial.location,
    entry_path: partial.entry_path ?? `/tmp/home/${partial.location}/${partial.name}`,
    entry_kind: partial.entry_kind,
    type: partial.entry_kind,
    normalized_content_sha256: partial.hash ?? 'sha256:aaa',
    link_target: partial.link_target ?? null,
    canonical_dir: partial.canonical_dir ?? null,
    canonical_skill_file: partial.canonical_skill_file ?? null,
  };
}

test('金样：无清单仍可齐全', () => {
  const scan = {
    skills: [entry({ name: 'alpha', location: '.agents/skills', entry_kind: 'directory', hash: 'sha256:1' })],
    skill_links: [
      entry({
        name: 'alpha',
        location: '.claude/skills',
        entry_kind: 'symlink',
        link_target: '../.agents/skills/alpha',
        canonical_dir: '/tmp/home/.agents/skills/alpha',
      }),
      entry({
        name: 'alpha',
        location: '.cursor/skills',
        entry_kind: 'symlink',
        link_target: '../.agents/skills/alpha',
        canonical_dir: '/tmp/home/.agents/skills/alpha',
      }),
      entry({
        name: 'alpha',
        location: '.codex/skills',
        entry_kind: 'symlink',
        link_target: '../.agents/skills/alpha',
        canonical_dir: '/tmp/home/.agents/skills/alpha',
      }),
    ],
    broken_symlinks: [],
    name_collisions: [],
  };
  const { rows, catalog_mode } = normalizePanoramaRows({
    scan,
    agents: AGENTS,
    approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  assert.equal(catalog_mode, 'absent');
  const decorated = attachGapClasses(rows, { catalogMode: catalog_mode });
  assert.equal(decorated[0].catalog_active, CATALOG_ACTIVE_VALUES.absent);
  assert.equal(decorated[0].gap_class, GAP_CLASSES.COMPLETE);
  assert.equal(isCatalogDrift(decorated[0], catalog_mode), false);
});

test('金样：仅源未投影', () => {
  const scan = {
    skills: [entry({ name: 'beta', location: '.agents/skills', entry_kind: 'directory' })],
    skill_links: [],
    broken_symlinks: [],
    name_collisions: [],
  };
  const { rows, catalog_mode } = normalizePanoramaRows({
    scan,
    agents: AGENTS,
    approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  const decorated = attachGapClasses(rows, { catalogMode: catalog_mode });
  assert.equal(decorated[0].gap_class, GAP_CLASSES.SOURCE_ONLY);
});

test('金样：人为断链', () => {
  const scan = {
    skills: [entry({ name: 'gamma', location: '.agents/skills', entry_kind: 'directory' })],
    skill_links: [],
    broken_symlinks: [
      entry({
        name: 'gamma',
        location: '.claude/skills',
        entry_kind: 'broken_symlink',
        link_target: '/missing/gamma',
      }),
    ],
    name_collisions: [],
  };
  const { rows, catalog_mode } = normalizePanoramaRows({
    scan,
    agents: AGENTS,
    approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  const decorated = attachGapClasses(rows, { catalogMode: catalog_mode });
  assert.equal(decorated[0].link_health.status, LINK_HEALTH_VALUES.broken);
  assert.equal(decorated[0].gap_class, GAP_CLASSES.BROKEN_LINK);
});

test('金样：清单漂移（批准但磁盘没有）', () => {
  const scan = {
    skills: [],
    skill_links: [],
    broken_symlinks: [],
    name_collisions: [],
  };
  const { rows, catalog_mode } = normalizePanoramaRows({
    scan,
    agents: AGENTS,
    approvedNames: new Set(['delta-missing']),
    catalog: { present: true, catalog: { schema_version: 'skills-refiner.collection-catalog.v1', collections: {} } },
  });
  assert.equal(catalog_mode, 'members');
  const decorated = attachGapClasses(rows, { catalogMode: catalog_mode });
  const row = decorated.find((item) => item.identity.name === 'delta-missing');
  assert.ok(row);
  assert.equal(row.catalog_active, CATALOG_ACTIVE_VALUES.active);
  assert.equal(row.gap_class, GAP_CLASSES.CATALOG_DRIFT);
});

test('金样：撞名', () => {
  const scan = {
    skills: [
      entry({ name: 'epsilon', location: '.agents/skills', entry_kind: 'directory', hash: 'sha256:a' }),
    ],
    skill_links: [
      entry({
        name: 'epsilon',
        location: '.claude/skills',
        entry_kind: 'symlink',
        canonical_dir: '/tmp/home/.agents/skills/epsilon',
      }),
    ],
    broken_symlinks: [],
    name_collisions: [
      {
        name: 'epsilon',
        real_directory_count: 2,
        distinct_hashes: ['sha256:a', 'sha256:b'],
        distinct_versions: [],
      },
    ],
  };
  const { rows, catalog_mode } = normalizePanoramaRows({
    scan,
    agents: AGENTS,
    approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  const decorated = attachGapClasses(rows, { catalogMode: catalog_mode });
  assert.equal(decorated[0].gap_class, GAP_CLASSES.NAME_COLLISION);
});

test('禁止 installed/ready 塌缩字段', () => {
  assert.throws(() => assertNoCollapsedFields({ installed: true }), /禁止字段/);
  assert.throws(() => assertNoCollapsedFields({ nested: { ready: 'yes' } }), /禁止字段/);
});

test('无清单时不因 absent 判清单漂移', () => {
  const row = {
    stored: true,
    projected: { claude: { present: true } },
    catalog_active: CATALOG_ACTIVE_VALUES.absent,
    link_health: { status: LINK_HEALTH_VALUES.ok },
    collision: { status: 'none' },
    identity: { name: 'x' },
  };
  assert.equal(isCatalogDrift(row, 'absent'), false);
  // 单 Agent 投影在本行上下文视为「全部所选存在 Agent 已投影」→ 齐全
  assert.equal(classifyGap(row, { catalogMode: 'absent' }), GAP_CLASSES.COMPLETE);
});

test('金样：部分投影 → 部分 Agent 已出现（第八类）', () => {
  const scan = {
    skills: [entry({ name: 'partial', location: '.agents/skills', entry_kind: 'directory' })],
    skill_links: [
      entry({
        name: 'partial',
        location: '.claude/skills',
        entry_kind: 'symlink',
        link_target: '../.agents/skills/partial',
        canonical_dir: '/tmp/home/.agents/skills/partial',
      }),
    ],
    broken_symlinks: [],
    name_collisions: [],
  };
  const { rows, catalog_mode } = normalizePanoramaRows({
    scan,
    agents: AGENTS,
    approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  const decorated = attachGapClasses(rows, { catalogMode: catalog_mode });
  assert.equal(decorated[0].gap_class, GAP_CLASSES.PARTIAL_PROJECTION);
  assert.notEqual(decorated[0].gap_class, GAP_CLASSES.COMPLETE);
  assert.notEqual(decorated[0].gap_class, GAP_CLASSES.UNKNOWN);
});

test('优先级：部分投影遇断链仍归链接损坏', () => {
  const scan = {
    skills: [entry({ name: 'partial-broken', location: '.agents/skills', entry_kind: 'directory' })],
    skill_links: [
      entry({
        name: 'partial-broken',
        location: '.cursor/skills',
        entry_kind: 'symlink',
        link_target: '../.agents/skills/partial-broken',
        canonical_dir: '/tmp/home/.agents/skills/partial-broken',
      }),
    ],
    broken_symlinks: [
      entry({
        name: 'partial-broken',
        location: '.claude/skills',
        entry_kind: 'broken_symlink',
        link_target: '/missing/partial-broken',
      }),
    ],
    name_collisions: [],
  };
  const { rows, catalog_mode } = normalizePanoramaRows({
    scan,
    agents: AGENTS,
    approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  const decorated = attachGapClasses(rows, { catalogMode: catalog_mode });
  assert.equal(decorated[0].gap_class, GAP_CLASSES.BROKEN_LINK);
});

test('脱敏导出弱化家目录', () => {
  const home = '/Users/alice';
  assert.equal(redactHomePaths(`${home}/.agents/skills/x`, home), '~/.agents/skills/x');
  assert.match(redactHomePaths('/Users/bob/.codex/skills/y', home), /<user>/);
});

test('Markdown 含八类与字段对照且无突变命令', () => {
  const rows = attachGapClasses(
    normalizePanoramaRows({
      scan: {
        skills: [entry({ name: 'alpha', location: '.agents/skills', entry_kind: 'directory' })],
        skill_links: [],
        broken_symlinks: [],
        name_collisions: [],
      },
      agents: AGENTS,
      approvedNames: new Set(),
      catalog: { present: false, catalog: null },
    }).rows,
    { catalogMode: 'absent' },
  );
  const doc = buildPanoramaDocument({
    rows,
    agents: AGENTS,
    catalogMode: 'absent',
    interactiveConfirmed: false,
    notes: ['未做交互确认'],
  });
  const md = renderPanoramaMarkdown(doc);
  for (const gap of Object.values(GAP_CLASSES)) {
    assert.match(md, new RegExp(gap));
  }
  assert.match(md, /字段对照/);
  assert.match(md, /catalog_active/);
  assert.doesNotMatch(md, /rm -rf/);
  assert.doesNotMatch(md, /ln -s/);
  assert.match(md, /skill-hygiene/);
});
