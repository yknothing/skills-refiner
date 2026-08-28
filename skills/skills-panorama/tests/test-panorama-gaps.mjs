/**
 * 八类缺口与六列归一化金样（ADR-0007 §12.7；O9=C 含部分投影第八类）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  linkSync,
  chmodSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATALOG_ACTIVE_VALUES, GAP_CLASSES, LINK_HEALTH_VALUES } from '../lib/panorama-constants.mjs';
import { normalizePanoramaRows, assertNoCollapsedFields } from '../lib/panorama-normalize.mjs';
import {
  approvedMembersFromCollectionArtifacts,
  collectRuntimeState,
  collectSkillScan,
} from '../lib/panorama-collect.mjs';
import { agentsFromTopology, parseAgentsFlag } from '../lib/panorama-config.mjs';
import { attachGapClasses, classifyGap, isCatalogDrift } from '../lib/panorama-gaps.mjs';
import {
  redactHomePaths,
  redactValue,
  buildPanoramaDocument,
  buildRuntimeTruthMatrix,
  renderPanoramaMarkdown,
  writePanoramaOutputs,
} from '../lib/panorama-render.mjs';

const PANORAMA_CLI = fileURLToPath(new URL('../lib/panorama-cli.mjs', import.meta.url));

const AGENTS = [
  { id: 'claude', label_zh: 'Claude Code', location: '.claude/skills', present: true },
  { id: 'cursor', label_zh: 'Cursor', location: '.cursor/skills', present: true },
  { id: 'codex', label_zh: 'Codex', location: '.codex/skills', present: true },
];

test('--agents all 只展开 scanner 实际发现的 Agent 根并排除源目录', () => {
  const topology = {
    '.agents/skills': {},
    '.claude/skills': {},
    '.codex/skills': {},
    '.cursor/skills-cursor': {},
  };
  assert.deepEqual(
    agentsFromTopology(topology).map((item) => item.location),
    ['.claude/skills', '.codex/skills', '.cursor/skills-cursor'],
  );
  assert.deepEqual(
    parseAgentsFlag('all,codex', topology).map((item) => item.location),
    ['.claude/skills', '.codex/skills', '.cursor/skills-cursor'],
  );
  assert.throws(() => parseAgentsFlag('all', { '.agents/skills': {} }), /未从 skill-scan topology/);
});

/**
 * 构造最小 scan 条目。
 * @param {{ name: string, location: string, entry_kind: string, entry_path?: string, hash?: string, link_target?: string|null, canonical_dir?: string|null, canonical_skill_file?: string|null, flags?: string[], risk_indicators?: object[], repository?: string|null, version?: string|null }} partial
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
    declared_version: partial.version ?? null,
    provenance: { source_url: partial.repository ?? null, kind: 'fixture' },
    flags: partial.flags ?? [],
    risk_indicators: partial.risk_indicators ?? [],
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

test('目录型集合成员按 INDEX 声明路径确认为源侧实物，不误报清单漂移', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-panorama-index-'));
  try {
    const collectionRoot = join(root, 'collection');
    const memberPath = join(collectionRoot, 'pc-intake');
    mkdirSync(memberPath, { recursive: true });
    writeFileSync(join(memberPath, 'SKILL.md'), '---\nname: pc-intake\ndescription: Test.\n---\n');
    writeFileSync(join(collectionRoot, 'INDEX.json'), `${JSON.stringify({
      schema_version: 'skills-refiner.collection.index.v1',
      collection_id: 'prodcraft',
      members: [{ name: 'pc-intake', relative_path: 'pc-intake', tree_digest: 'sha256:test' }],
    })}\n`);
    const observed = approvedMembersFromCollectionArtifacts({
      collections: [{ collection_id: 'prodcraft', physical_collection_root: realpathSync(collectionRoot) }],
    });
    assert.equal(observed.approvedMembers.get('pc-intake')[0].present, true);

    const normalized = normalizePanoramaRows({
      scan: { skills: [], skill_links: [], broken_symlinks: [], name_collisions: [] },
      agents: AGENTS,
      approvedNames: observed.approvedNames,
      approvedMembers: observed.approvedMembers,
      collectionRoots: observed.collectionRoots,
      catalog: { present: true, catalog: { schema_version: 'skills-refiner.collection-catalog.v1' } },
    });
    const [row] = attachGapClasses(normalized.rows, { catalogMode: normalized.catalog_mode });
    assert.equal(row.stored, true);
    assert.equal(row.catalog_active, CATALOG_ACTIVE_VALUES.active);
    assert.equal(row.gap_class, GAP_CLASSES.SOURCE_ONLY);
    assert.equal(isCatalogDrift(row, normalized.catalog_mode), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('健康外部链接不冒充断链；异目标异内容单独归命名冲突', () => {
  const scan = {
    skills: [entry({
      name: 'brainstorming', location: '.agents/skills', entry_kind: 'directory',
      entry_path: '/tmp/home/.agents/skills/brainstorming', hash: 'sha256:canonical',
    })],
    skill_links: [entry({
      name: 'brainstorming', location: '.claude/skills', entry_kind: 'symlink',
      link_target: '/tmp/cache/superpowers/brainstorming',
      canonical_dir: '/tmp/cache/superpowers/brainstorming', hash: 'sha256:external',
    })],
    broken_symlinks: [],
    name_collisions: [],
  };
  const normalized = normalizePanoramaRows({
    scan, agents: AGENTS, approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  const [row] = attachGapClasses(normalized.rows, { catalogMode: normalized.catalog_mode });
  assert.equal(row.link_health.status, LINK_HEALTH_VALUES.ok);
  assert.equal(row.collision.status, 'conflict');
  assert.equal(row.collision.default_disposition, 'preserve');
  assert.equal(row.identity.identity_status, 'ambiguous_name');
  assert.equal(row.identity.content_fingerprint, null);
  assert.equal(row.identity.variants.length, 2);
  assert.equal(row.projected.claude.content_fingerprint, 'sha256:external');
  assert.equal(
    row.projected.claude.entity_id,
    row.identity.variants.find((variant) => variant.canonical_target === '/tmp/cache/superpowers/brainstorming').entity_id,
  );
  assert.equal(row.gap_class, GAP_CLASSES.NAME_COLLISION);
});

test('同一 canonical entity 的源目录与软链聚合为一个 qualified variant', () => {
  const scan = {
    skills: [entry({
      name: 'same', location: '.agents/skills', entry_kind: 'directory',
      entry_path: '/tmp/home/.agents/skills/same', canonical_dir: '/tmp/home/.agents/skills/same', hash: 'sha256:one',
    })],
    skill_links: [entry({
      name: 'same', location: '.claude/skills', entry_kind: 'symlink',
      entry_path: '/tmp/home/.claude/skills/same', canonical_dir: '/tmp/home/.agents/skills/same', hash: 'sha256:one',
    })],
    broken_symlinks: [], name_collisions: [],
  };
  const normalized = normalizePanoramaRows({
    scan, agents: AGENTS, approvedNames: new Set(), catalog: { present: false, catalog: null },
  });
  assert.equal(normalized.rows[0].identity.identity_status, 'path_qualified');
  assert.equal(normalized.rows[0].identity.variants.length, 1);
  assert.deepEqual(normalized.rows[0].identity.variants[0].observed_locations, ['.agents/skills', '.claude/skills']);
});

test('相同上游 revision/path/digest 的物理副本保持一个 source-qualified identity', () => {
  const provenance = {
    kind: 'fixture', source_url: 'https://example.test/org/repo.git', repository_id: 'org/repo',
    resolved_revision: 'a'.repeat(40),
  };
  const scan = {
    skills: [
      { ...entry({
        name: 'same-source', location: '.agents/skills', entry_kind: 'directory',
        entry_path: '/srv/source/same-source', canonical_dir: '/srv/source/same-source', hash: 'sha256:one',
      }), storage_relative_path: 'skills/same-source', provenance },
      { ...entry({
        name: 'same-source', location: '.gemini/skills', entry_kind: 'directory',
        entry_path: '/srv/copy/same-source', canonical_dir: '/srv/copy/same-source', hash: 'sha256:one',
      }), storage_relative_path: 'skills/same-source', provenance },
    ],
    skill_links: [], broken_symlinks: [],
    name_collisions: [{ name: 'same-source', real_directory_count: 2, distinct_hashes: ['sha256:one'] }],
  };
  const [row] = normalizePanoramaRows({
    scan, agents: AGENTS, approvedNames: new Set(), catalog: { present: false, catalog: null },
  }).rows;
  assert.equal(row.identity.identity_status, 'source_qualified');
  assert.equal(row.identity.variants.length, 1);
  assert.deepEqual(row.identity.variants[0].canonical_targets, ['/srv/copy/same-source', '/srv/source/same-source']);
  assert.equal(row.collision.status, 'none');
});

test('同一健康外部目标的 Agent-only 链接不误报链接损坏', () => {
  const scan = {
    skills: [],
    skill_links: [entry({
      name: 'remotion-best-practices', location: '.claude/skills', entry_kind: 'symlink',
      link_target: '/tmp/external/remotion', canonical_dir: '/tmp/external/remotion', hash: 'sha256:one',
    })],
    broken_symlinks: [],
    name_collisions: [],
  };
  const normalized = normalizePanoramaRows({
    scan, agents: AGENTS, approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  const [row] = attachGapClasses(normalized.rows, { catalogMode: normalized.catalog_mode });
  assert.equal(row.link_health.status, LINK_HEALTH_VALUES.ok);
  assert.equal(row.gap_class, GAP_CLASSES.AGENT_ONLY);
});

test('每个 identity variant 独立记录 catalog 状态，顶层混合状态不冒充单一事实', () => {
  const managedPath = '/srv/collections/repo-a/shared';
  const externalPath = '/srv/vendor/repo-b/shared';
  const managedMember = {
    collection_id: 'repo-a', repository_id: 'org/repo-a', resolved_revision: 'a'.repeat(40),
    source_path: 'shared', member_path: managedPath, tree_digest: 'sha256:shared', present: true,
  };
  const normalized = normalizePanoramaRows({
    scan: {
      skills: [entry({
        name: 'shared', location: '.agents/skills', entry_kind: 'directory',
        entry_path: managedPath, canonical_dir: managedPath, hash: 'sha256:same', repository: 'https://example.test/repo-a.git',
      })],
      skill_links: [entry({
        name: 'shared', location: '.claude/skills', entry_kind: 'symlink',
        entry_path: '/tmp/home/.claude/skills/shared', canonical_dir: externalPath,
        hash: 'sha256:same', repository: 'https://example.test/repo-b.git',
      })],
      broken_symlinks: [], name_collisions: [],
    },
    agents: AGENTS,
    approvedNames: new Set(['shared']),
    approvedMembers: new Map([['shared', [managedMember]]]),
    collectionRoots: ['/srv/collections/repo-a'],
    catalog: { present: true, catalog: { schema_version: 'skills-refiner.collection-catalog.v1' } },
  });
  const row = normalized.rows[0];
  const byTarget = new Map(row.identity.variants.map((variant) => [variant.canonical_target, variant]));
  assert.equal(byTarget.get(managedPath).catalog_active, CATALOG_ACTIVE_VALUES.active);
  assert.equal(byTarget.get(managedPath).catalog_conformance, 'active_observed');
  assert.equal(byTarget.get(externalPath).catalog_active, CATALOG_ACTIVE_VALUES.absent);
  assert.equal(byTarget.get(externalPath).catalog_conformance, 'unmanaged');
  assert.equal(row.catalog_active, CATALOG_ACTIVE_VALUES.unknown);
});

test('同名同内容但来自不同仓库仍是需保留的 identity 冲突', () => {
  const normalized = normalizePanoramaRows({
    scan: {
      skills: [
        entry({
          name: 'prose-craft', location: '.agents/skills', entry_kind: 'directory',
          entry_path: '/srv/langcraft/prose-craft', canonical_dir: '/srv/langcraft/prose-craft',
          hash: 'sha256:identical', repository: 'https://example.test/langcraft.git',
        }),
        entry({
          name: 'prose-craft', location: '.gemini/skills', entry_kind: 'directory',
          entry_path: '/srv/better-skills/prose-craft', canonical_dir: '/srv/better-skills/prose-craft',
          hash: 'sha256:identical', repository: 'https://example.test/better-skills.git',
        }),
      ],
      skill_links: [], broken_symlinks: [], name_collisions: [],
    },
    agents: AGENTS,
    approvedNames: new Set(),
    catalog: { present: false, catalog: null },
  });
  const row = normalized.rows[0];
  assert.equal(row.identity.identity_status, 'ambiguous_name');
  assert.equal(row.identity.variants.length, 2);
  assert.equal(row.collision.status, 'conflict');
  assert.equal(row.collision.classification, 'foreign_same_name');
  assert.equal(row.collision.default_disposition, 'preserve');
  assert.deepEqual(row.collision.evidence.distinct_hashes, ['sha256:identical']);
});

test('禁止 installed/ready 塌缩字段', () => {
  assert.throws(() => assertNoCollapsedFields({ installed: true }), /禁止字段/);
  assert.throws(() => assertNoCollapsedFields({ nested: { ready: 'yes' } }), /禁止字段/);
});

test('scanner 治理复核信号进入 identity 与报告摘要，但不改变八类缺口', () => {
  const scan = {
    skills: [entry({
      name: 'review-me', location: '.agents/skills', entry_kind: 'directory',
      flags: ['pipe_to_shell', 'broken_refs:@references/missing.md'],
      risk_indicators: [{
        id: 'pipe_to_shell', detector_id: 'pipe_to_shell', subtype: 'supply_chain_remote_exec',
        severity: 'review_required', canonical_skill_file: '/tmp/home/.agents/skills/review-me/SKILL.md',
        line: 42, context_kind: 'command', execution_scope: 'local',
        redacted_preview: 'remote download piped to a shell', snippet_sha256: 'a'.repeat(64),
      }],
    })],
    skill_links: [], broken_symlinks: [], name_collisions: [],
  };
  const normalized = normalizePanoramaRows({
    scan, agents: AGENTS, approvedNames: new Set(), catalog: { present: false, catalog: null },
  });
  const rows = attachGapClasses(normalized.rows, { catalogMode: normalized.catalog_mode });
  assert.equal(rows[0].gap_class, GAP_CLASSES.SOURCE_ONLY);
  assert.deepEqual(rows[0].identity.review_signals.risk_indicators.map((risk) => risk.id), ['pipe_to_shell']);
  assert.equal(rows[0].identity.review_signals.risk_indicators[0].line, 42);
  assert.equal(rows[0].identity.review_signals.risk_indicators[0].redacted_preview, 'remote download piped to a shell');
  const doc = buildPanoramaDocument({ rows, agents: AGENTS, catalogMode: 'absent' });
  assert.equal(doc.summary.review_signal_counts.skills_requiring_risk_review, 1);
  assert.equal(doc.summary.review_signal_counts.skills_with_reference_findings, 1);
  assert.match(renderPanoramaMarkdown(doc), /治理复核信号/);
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
  assert.equal(redactHomePaths('/Users/bob/.codex/skills/y', home), '<absolute-path>');
});

test('share 深度脱敏 URL、SSH、query 与任意主机绝对路径', () => {
  const redacted = redactValue({
    home_path: '/Users/alice/.agents/skills/x',
    foreign_path: '/srv/private/repository/skill',
    linux_path: '/home/bob/.config/secret',
    windows_path: 'C:\\Users\\alice\\secret',
    unc_path: '\\\\fileserver\\private\\secret',
    url: 'https://user:password@example.test/private/repo?token=secret',
    custom_url: 'git://example.test/private/repo',
    ssh_url: 'ssh://git@example.test/private/repo',
    scp: 'git@example.test:/srv/private/repo',
    ssh_identity: 'ops@internal.example',
    ssh_command: 'ssh internal.example -- run-private-command',
    command: 'probe --endpoint ?token=secret --path /opt/private/tree',
    encoded_url: 'url=https%3A%2F%2Fuser%3Apassword%40example.test%2Frepo%3Ftoken%3Dsecret%23fragsecret',
    encoded_ssh: 'endpoint=git%40internal.example%3A%2Fsrv%2Fprivate',
    encoded_query: 'opaque%3Ftoken%3Dsecret%23fragsecret',
    encoded_path: '%2Fsrv%2Fprivate%2Fsecret',
    fragment: 'opaque#fragsecret',
    slash_unc: 'value=//fileserver/private/secret',
    userinfo: 'user:password@example.test',
    ipv6_scp: 'git@[2001:db8::1]:/srv/private/repo',
    quoted_query: 'https://example.test/repo?token="quoted secret value" --next harmless',
    nested: { api_token: 'nested-secret-value', authorization: 'Bearer nested-bearer-value' },
    'token=key-carried-secret': 'ignored-value',
  }, '/Users/alice');
  const text = JSON.stringify(redacted);
  for (const secret of [
    '/Users/alice', '/srv/private', '/home/bob', 'C:\\Users', '\\\\fileserver', 'https://', 'ssh://',
    'git@example.test', 'ops@internal.example', 'internal.example', 'password', 'token=secret',
    'fragsecret', 'fileserver', 'https%3A', 'git%40', '2001:db8',
    'quoted secret value', 'nested-secret-value', 'nested-bearer-value', 'key-carried-secret',
  ]) assert.equal(text.includes(secret), false, secret);
  assert.match(text, /<url>/);
  assert.match(text, /<ssh-endpoint>/);
  assert.match(text, /<absolute-path>/);
  assert.match(text, /<query>/);
  assert.match(text, /<fragment>/);
  assert.match(text, /<redacted-secret>/);
  assert.match(text, /<redacted-secret-key>/);
});

test('runtime/profile 的事实退出码 3/10 不把完整可解析观察降级为 collector failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-panorama-runtime-state-'));
  try {
    const home = realpathSync(root);
    const hygieneRoot = join(home, 'hygiene');
    const bin = join(hygieneRoot, 'bin');
    mkdirSync(bin, { recursive: true });
    const launcher = join(bin, 'skills-refiner');
    writeFileSync(launcher, `#!/usr/bin/env bash
if [ "$2" = "status" ]; then
  printf '%s\\n' '{"schema_version":"skills-refiner.runtime-status.v1","adapters":{"codex":{"status":"UNSUPPORTED"}}}'
  exit 3
else
  printf '%s\\n' '{"schema_version":"skills-refiner.runtime-profile.status.v1","status":"BLOCKED","issues":["drift"]}'
  exit 10
fi
`, { mode: 0o700 });
    const observed = collectRuntimeState({ home, hygieneRoot, nodeBin: process.execPath });
    assert.equal(observed.ok, true);
    assert.equal(observed.complete, true);
    assert.deepEqual(observed.blockers, []);
    assert.equal(observed.notes.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skill-scan 即使错误返回零，runtime-load blocker 仍使收集不完整', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-panorama-runtime-blocker-'));
  try {
    const home = realpathSync(root);
    const hygieneRoot = join(home, 'hygiene');
    const bin = join(hygieneRoot, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'skill-scan.sh'), `#!/usr/bin/env bash
printf '%s\\n' '{"metadata":{"schema_version":"skill-scan.v6"},"skills":[],"skill_links":[],"broken_symlinks":[],"collection_index_blockers":[],"runtime_load_blockers":[{"name":"bad","reason":"description_too_long"}]}'
exit 0
`, { mode: 0o700 });
    const observed = collectSkillScan({ home, hygieneRoot });
    assert.equal(observed.ok, true);
    assert.equal(observed.complete, false);
    assert.equal(observed.blocker.kind, 'reported_blocker_with_zero_exit');
    assert.equal(observed.blocker.reported_blockers.runtime_load[0].name, 'bad');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime truth matrix 保持 filesystem/deployment/catalog/body/route/context 六层独立', () => {
  const matrix = buildRuntimeTruthMatrix({
    managedCollections: [{ collection_id: 'prodcraft', status: 'FILESYSTEM_READY' }],
    runtimeProfileStatus: {
      status: 'DEPLOYMENT_READY', issues: [], cursor_mutation_policy: 'observe_only_until_runtime_probe',
    },
    runtimeStatus: {
      adapters: {
        codex: {
          status: 'CATALOG_ONLY',
          catalog: { result: 'pass', policy_conformance: 'pass', identity_conformance: 'pass', context_budget_pressure: true },
          effective_predicates: { body_access_observed: true, route_observed: false },
        },
      },
    },
  });
  for (const adapter of ['codex', 'claude', 'cursor']) {
    assert.deepEqual(Object.keys(matrix.adapters[adapter]), ['filesystem', 'deployment', 'catalog', 'body', 'route', 'context']);
  }
  assert.equal(matrix.adapters.codex.filesystem.result, 'pass');
  assert.equal(matrix.adapters.codex.deployment.result, 'pass');
  assert.equal(matrix.adapters.codex.catalog.result, 'pass');
  assert.equal(matrix.adapters.codex.body.result, 'observed');
  assert.equal(matrix.adapters.codex.route.result, 'unverified');
  assert.equal(matrix.adapters.codex.context.result, 'pressure_observed');
  assert.equal(matrix.adapters.cursor.deployment.result, 'observe_only');
  assert.equal(matrix.adapters.claude.catalog.result, 'unverified');

  const stale = buildRuntimeTruthMatrix({
    managedCollections: [],
    runtimeStatus: { adapters: { codex: {
      status: 'STALE', reason: 'adapter_version_changed',
      catalog: { result: 'pass', policy_conformance: 'pass', context_budget_pressure: false },
      effective_predicates: { body_access_observed: true, route_observed: true },
    } } },
    runtimeProfileStatus: null,
  });
  assert.equal(stale.adapters.codex.catalog.result, 'unverified');
  assert.equal(stale.adapters.codex.body.result, 'unverified');
  assert.equal(stale.adapters.codex.route.result, 'unverified');
  assert.equal(stale.adapters.codex.context.result, 'unverified');
  assert.equal(stale.adapters.codex.catalog.invalidation_reason, 'adapter_version_changed');
});

test('latest/share 以 0600 原子写，并拒绝 symlink 与非普通目标', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-panorama-output-'));
  try {
    const home = realpathSync(root);
    const doc = buildPanoramaDocument({ rows: [], agents: AGENTS, catalogMode: 'absent' });
    const written = writePanoramaOutputs({ home, doc, share: true });
    assert.match(doc.generation_id, /^[0-9a-f-]{36}$/u);
    assert.match(readFileSync(written.mdPath, 'utf8'), new RegExp(`报告代次：${doc.generation_id}`, 'u'));
    assert.equal(JSON.parse(readFileSync(written.shareJsonPath, 'utf8')).generation_id, doc.generation_id);
    assert.match(readFileSync(written.shareMdPath, 'utf8'), new RegExp(`报告代次：${doc.generation_id}`, 'u'));
    const outputDirectory = join(home, 'Library/Application Support/skills-refiner/panorama');
    chmodSync(outputDirectory, 0o755);
    writePanoramaOutputs({ home, doc, share: true });
    assert.equal(statSync(outputDirectory).mode & 0o777, 0o700);
    for (const path of [written.jsonPath, written.mdPath, written.shareJsonPath, written.shareMdPath]) {
      assert.equal(statSync(path).mode & 0o777, 0o600, path);
    }
    assert.deepEqual(readdirSync(join(home, 'Library/Application Support/skills-refiner/panorama'))
      .filter((name) => name.endsWith('.tmp')), []);

    const victim = join(home, 'victim.txt');
    writeFileSync(victim, 'unchanged\n');
    unlinkSync(written.jsonPath);
    symlinkSync(victim, written.jsonPath);
    assert.throws(() => writePanoramaOutputs({ home, doc, share: true }), /拒绝覆盖非普通文件目标/);
    assert.equal(readFileSync(victim, 'utf8'), 'unchanged\n');

    unlinkSync(written.jsonPath);
    linkSync(victim, written.jsonPath);
    writePanoramaOutputs({ home, doc, share: true });
    assert.equal(readFileSync(victim, 'utf8'), 'unchanged\n');
    assert.notEqual(statSync(written.jsonPath).ino, statSync(victim).ino);

    writeFileSync(written.jsonPath, '{}\n');
    unlinkSync(written.shareJsonPath);
    symlinkSync(victim, written.shareJsonPath);
    assert.throws(() => writePanoramaOutputs({ home, doc, share: true }), /拒绝覆盖非普通文件目标/);
    assert.equal(readFileSync(victim, 'utf8'), 'unchanged\n');

    unlinkSync(written.shareJsonPath);
    writeFileSync(written.shareJsonPath, '{}\n');
    unlinkSync(written.shareMdPath);
    symlinkSync(join(home, 'missing-share-target'), written.shareMdPath);
    assert.throws(() => writePanoramaOutputs({ home, doc, share: true }), /拒绝覆盖非普通文件目标/);

    unlinkSync(written.shareMdPath);
    writeFileSync(written.shareMdPath, 'restored\n');
    unlinkSync(written.jsonPath);
    mkdirSync(written.jsonPath);
    assert.throws(() => writePanoramaOutputs({ home, doc, share: true }), /拒绝覆盖非普通文件目标/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scan 非零但 JSON 可解析时保留 blocker、输出 DEGRADED 且 CLI 非零', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-panorama-collector-'));
  try {
    const home = realpathSync(root);
    const hygieneRoot = join(home, 'fake-hygiene');
    const bin = join(hygieneRoot, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'skill-scan.sh'), `#!/usr/bin/env bash
printf '%s\\n' '{"metadata":{"schema_version":"skill-scan.v6"},"topology":{},"skills":[],"skill_links":[],"broken_symlinks":[],"name_collisions":[],"runtime_load_blockers":[],"collection_index_blockers":[{"collection_id":"demo","error_code":"unsafe_index","diagnostic":"blocked","index_path":"/srv/private/INDEX.json"}]}'
exit 9
`);
    writeFileSync(join(bin, 'skills-refiner'), `#!/usr/bin/env bash
if [ "$1" = "collection" ]; then
  printf '%s\\n' '{"schema_version":"skills-refiner.collection.list.v1","collections":[]}'
elif [ "$1" = "runtime" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"schema_version":"skills-refiner.runtime-status.v1","adapters":{"codex":{"status":"UNVERIFIED"},"claude":{"status":"UNVERIFIED"},"cursor":{"status":"UNVERIFIED"}}}'
elif [ "$1" = "runtime" ] && [ "$2" = "profile" ]; then
  printf '%s\\n' '{"schema_version":"skills-refiner.runtime-profile.status.v1","status":"DEPLOYMENT_READY","issues":[],"cursor_mutation_policy":"observe_only_until_runtime_probe"}'
else
  exit 2
fi
`);
    const result = spawnSync(process.execPath, [
      PANORAMA_CLI, '--yes', '--agents', 'claude,cursor,codex',
      '--hygiene-root', hygieneRoot, '--stdout-only',
    ], { encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(result.status, 3, result.stderr);
    const doc = JSON.parse(result.stdout);
    assert.equal(doc.collectors.status, 'DEGRADED');
    assert.equal(doc.collectors.completeness, 'PARTIAL');
    assert.deepEqual(doc.collectors.degraded_reasons, ['skill_scan_nonzero']);
    assert.equal(doc.collectors.blockers[0].collector, 'skill_scan');
    assert.equal(doc.collectors.blockers[0].exit_status, 9);
    assert.equal(doc.collectors.blockers[0].reported_blockers.collection_index[0].error_code, 'unsafe_index');
    assert.match(result.stderr, /\[DEGRADED\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    managedCollections: [{
      collection_id: 'fixture', status: 'DRIFTED', runtime_status: 'UNVERIFIED',
      issues: ['MEMBER_DRIFT:a', 'MEMBER_DRIFT:b'],
      source: { upstream_release: { status: 'declared', value: '1.2.3' } },
    }],
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
  assert.match(md, /受管集合状态/);
  assert.match(md, /MEMBER_DRIFT ×2/);
});
