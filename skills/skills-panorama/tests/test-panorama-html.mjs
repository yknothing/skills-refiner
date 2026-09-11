import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { buildPanoramaDocument } from '../lib/panorama-render.mjs';
import { renderPanoramaHtml } from '../lib/panorama-html.mjs';
import { normalizePanoramaRows } from '../lib/panorama-normalize.mjs';
import { attachGapClasses } from '../lib/panorama-gaps.mjs';

function documentWithEntries(count = 2) {
  return buildPanoramaDocument({
    rows: Array.from({ length: count }, (_, index) => ({
      identity: {
        name: `fixture-${index}`,
        paths: [`/fixture/skill-${index}`],
        variants: [{ entity_id: `identity-${index}`, qualification: 'path_qualified', canonical_target: `/fixture/skill-${index}`, content_fingerprint: `content-${index}`, catalog_active: 'absent' }],
        review_signals: { risk_indicators: [], hygiene_flags: [] },
      },
      provenance_lifecycle: { variants: [{ entity_id: `identity-${index}`, observations: [{ observed_location: 'fixture', observed_path: `/fixture/skill-${index}`, version: { declaration: 'not_declared' }, lifecycle: { installed_at: '2099-01-02T03:04:05Z', timestamp_semantics: 'installer_declared' } }] }] },
      stored: true,
      projected: { codex: { present: true } },
      catalog_active: 'absent',
      link_health: { status: 'ok' },
      collision: { status: 'none' },
      gap_class: '齐全',
    })),
    agents: [{ id: 'codex', label_zh: 'Codex', present: true }],
    generationId: 'fixture-generation', generatedAt: '2026-09-11T00:00:00Z',
    interactiveConfirmed: false,
    catalogMode: 'absent', collectorStatus: 'COMPLETE', completeness: 'FULL',
  });
}

const bodyWithoutScripts = (html) => html.slice(html.indexOf('<body>'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '');
const embeddedDocument = (html) => JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/u)[1]);

test('已确认加载阻塞即使目录齐全也保留在需要检查中，未知要求不冒充阻塞', () => {
  const agents = [{ id: 'codex', label_zh: 'Codex', location: '.codex/skills', present: true }];
  const source = { name: 'blocked', location: '.agents/skills', entry_kind: 'directory',
    entry_path: '/fixture/blocked', canonical_dir: '/fixture/blocked', normalized_content_sha256: 'one',
    flags: ['description_too_long:1025>1024'], runtime_contract: { status: 'fail',
      load_blockers: ['description_too_long'], validation_method: 'conservative-static-frontmatter-preflight' } };
  const link = { ...source, location: '.codex/skills', entry_path: '/fixture/codex/blocked', entry_kind: 'symlink' };
  const render = () => {
    const { rows } = normalizePanoramaRows({ scan: { skills: [source], skill_links: [link], broken_symlinks: [], name_collisions: [] },
      agents, approvedNames: new Set(), catalog: { present: false, catalog: null } });
    const doc = documentWithEntries(0);
    doc.entries = attachGapClasses(rows, { agents });
    return { doc, body: bodyWithoutScripts(renderPanoramaHtml(doc)) };
  };
  const { doc, body } = render();
  assert.equal(doc.entries[0].gap_class, '齐全');
  assert.match(body, /data-review="true"/u);
  assert.match(body, /加载阻塞：description_too_long/u);
  assert.match(body, /先修复已确认的加载阻塞/u);
  assert.equal(doc.entries[0].identity.review_signals.runtime_load_blockers[0].observed_path, '/fixture/blocked');
  source.runtime_contract = link.runtime_contract = { status: 'unknown', load_blockers: [],
    unverified_requirements: ['description_not_observed_by_lightweight_parser'] };
  assert.match(render().body, /data-review="false"/u);
});

test('HTML body contains every entry, lifecycle and runtime fact without executing JavaScript', () => {
  const doc = documentWithEntries(222);
  const html = renderPanoramaHtml(doc);
  const body = bodyWithoutScripts(html);
  assert.match(body, /显示 222 \/ 222 条 · 全部技能/u);
  assert.equal((body.match(/data-entry-detail>/gu) ?? []).length, 222);
  assert.equal((body.match(/data-entry-link /gu) ?? []).length, 222);
  for (let index = 0; index < 222; index += 1) {
    assert.ok(body.includes(`id="entry-${index}"`));
    assert.ok(body.includes(`identity-${index}`));
    assert.ok(body.includes(`content-${index}`));
  }
  assert.match(body, /2099-01-02T03:04:05Z/u);
  assert.match(body, /installer_declared/u);
  assert.match(body, /技能发现/u);
  assert.match(body, /未验证/u);
  assert.deepEqual(embeddedDocument(html), doc);
});

test('Template styles stay fixed across different report data', () => {
  const first = renderPanoramaHtml(documentWithEntries(1));
  const second = renderPanoramaHtml(documentWithEntries(6));
  const css = first.match(/<style>([\s\S]*?)<\/style>/u)[1];
  assert.equal(css, second.match(/<style>([\s\S]*?)<\/style>/u)[1]);
  assert.match(first, /name="skills-refiner-template" content="panorama-report.v1"/u);
});

test('Untrusted names, paths and JSON cannot create HTML or script elements', () => {
  const doc = documentWithEntries(1);
  const hostile = '</script><img src=x onerror="alert(1)"> {{TITLE}} & data';
  doc.entries[0].identity.name = hostile;
  doc.entries[0].identity.paths = [hostile];
  doc.entries[0].identity.variants[0].canonical_target = hostile;
  doc.entries[0].provenance_lifecycle.variants[0].observations[0].installation = {
    entry_kind: 'symlink', canonical_target: hostile, link_target: hostile,
  };
  doc.entries[0].provenance_lifecycle.variants[0].observations[0].observed_path = hostile;
  doc.notes = [hostile];
  const html = renderPanoramaHtml(doc, { snapshotLabel: hostile });
  assert.equal((html.match(/<script\b/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /<img\b/gu);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/u);
  assert.deepEqual(embeddedDocument(html), doc);
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)[1];
  new Script(script);
  const digest = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`sha256-${digest}`));
  assert.doesNotMatch(html, /unsafe-inline/u);
});

test('Incomplete and empty observations stay explicit, while all identity variants survive', () => {
  const doc = documentWithEntries(1);
  doc.collectors = { status: 'DEGRADED', completeness: 'PARTIAL', blockers: [{ kind: 'fixture-failure' }] };
  doc.entries[0].identity.variants.push({ entity_id: 'second-identity', canonical_target: '/second-target', qualification: 'path_qualified' });
  const body = bodyWithoutScripts(renderPanoramaHtml(doc));
  assert.match(body, /DEGRADED \/ PARTIAL/u);
  assert.match(body, /部分数据未能采集/u);
  assert.match(body, /fixture-failure/u);
  assert.match(body, /second-identity/u);
  assert.match(body, /\/second-target/u);
  const empty = bodyWithoutScripts(renderPanoramaHtml(documentWithEntries(0)));
  assert.match(empty, /显示 0 \/ 0 条/u);
  assert.match(empty, /暂无技能详情/u);
});

test('Report time uses UTC without inferring the host location', () => {
  const doc = documentWithEntries(0);
  doc.generated_at = '2026-09-11T09:23:45+08:00';
  const body = bodyWithoutScripts(renderPanoramaHtml(doc));
  assert.match(body, /2026-09-11 01:23:45 UTC/u);
  assert.doesNotMatch(body, /新加坡|Singapore|Asia\//u);
});

test('Symlink entry paths are shown with their targets, separately from source install history', () => {
  const doc = documentWithEntries(1);
  const variant = doc.entries[0].identity.variants[0];
  const observations = doc.entries[0].provenance_lifecycle.variants[0].observations;
  observations[0].installation = { entry_kind: 'directory', canonical_target: variant.canonical_target };
  observations.push({
    observed_location: '.factory/skills', observed_path: '/fixture/factory/fixture-0',
    installation: { entry_kind: 'symlink', link_target: '../skill-0', canonical_target: variant.canonical_target, link_health: 'ok' },
    version: { value: null, declaration: 'not_declared' },
    source: { repository_id: null, repository_url: null },
    lifecycle: { installed_at: null, updated_at: null, timestamp_semantics: null },
  });
  const html = renderPanoramaHtml(doc);
  const body = bodyWithoutScripts(html);
  assert.match(body, /软链接/u);
  assert.match(body, /安装入口/u);
  assert.match(body, /实际文件目录/u);
  assert.match(body, /上游仓库/u);
  assert.match(body, /未声明版本号/u);
  assert.match(body, /不代表软链接创建时间/u);
  assert.match(body, /\/fixture\/factory\/fixture-0/u);
  assert.match(body, /\/fixture\/skill-0/u);
  assert.deepEqual(embeddedDocument(html), doc);
  const visible = body.replace(/<pre>[\s\S]*?<\/pre>/gu, '');
  assert.doesNotMatch(visible, /来源尚未确认/u);
  assert.equal((visible.match(/2099-01-02 03:04:05 UTC/gu) ?? []).length, 1);
});


test('同名目录只展示文件事实和未验证的加载影响，安装声明明确标注', () => {
  const doc = documentWithEntries(1);
  doc.entries[0].gap_class = '暂无法判定';
  doc.entries[0].collision = { status: 'unknown', assessment: 'inventory_only',
    evidence: { real_directory_count: 2, distinct_hashes: ['one', 'two'] } };
  const observation = doc.entries[0].provenance_lifecycle.variants[0].observations[0];
  observation.source = { repository_id: 'obra/superpowers', confidence: 'installer_declared' };
  observation.evidence_state = { source: 'receipt_declared' };
  const body = bodyWithoutScripts(renderPanoramaHtml(doc));
  assert.match(body, /发现 2 个实际文件目录、2 种内容指纹/u);
  assert.match(body, /宿主加载影响未验证，不能据此确认命名冲突/u);
  assert.match(body, /安装记录声明；本次未校验当前文件与安装记录的一致性/u);
  assert.match(body, /obra\/superpowers/u);
  assert.match(body, /data-review="true"/u);
  assert.doesNotMatch(body, /未记录上游仓库|同名异内容可能导致错载/u);
});
