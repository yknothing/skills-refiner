import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GAP_CLASS_PRIORITY } from './panorama-constants.mjs';
import { decisionCardForGap } from './panorama-gaps.mjs';

const template = readFileSync(new URL('../templates/report.html', import.meta.url), 'utf8');
const html = (value) => String(value ?? '未知').replace(/[&<>"']/gu, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const json = (value) => JSON.stringify(value, null, 2);
const scriptJson = (value) => json(value).replace(/[<>&\u2028\u2029]/gu,
  (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
const hash = (value) => createHash('sha256').update(value).digest('base64');

function timestamp(value) {
  if (typeof value !== 'string' || !value) return '未记录';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '时间格式无效'
    : parsed.toISOString().replace('T', ' ').replace(/\.[0-9]{3}Z$/u, ' UTC');
}

function facts(pairs) {
  return `<dl class="facts">${pairs.map(([label, value]) => `<dt>${html(label)}</dt><dd>${html(value)}</dd>`).join('')}</dl>`;
}

function signals(entry) {
  return [
    ...(entry.identity?.review_signals?.risk_indicators ?? []).map((risk) => risk.id),
    ...(entry.identity?.review_signals?.hygiene_flags ?? []).filter((flag) => flag.startsWith('broken_refs:')),
    ...new Set((entry.identity?.review_signals?.runtime_load_blockers ?? []).map((blocker) => `加载阻塞：${blocker.reason}`)),
  ];
}

function needsReview(entry) {
  return ['链接损坏', '命名冲突', '清单与现实不符'].includes(entry.gap_class)
    || entry.collision?.assessment === 'inventory_only' || signals(entry).length > 0;
}

function agentLabel(entry, doc) {
  return Object.entries(entry.projected ?? {}).filter(([, projection]) => projection.present)
    .map(([id]) => doc.agents.find((agent) => agent.id === id)?.label_zh ?? id).join('、')
    || '所选 Agent 的技能目录中未找到';
}

function versionLabel(variant, observations) {
  const values = [...new Set([variant.declared_version, ...observations.map((item) => item.version?.value)].filter(Boolean))];
  if (values.length) return values.join(' / ');
  return observations.length && observations.every((item) => item.version?.declaration === 'not_declared')
    ? '技能未声明版本号' : '未采集到版本信息';
}

function renderSourceGroup(entry, variant, index) {
  const observations = entry.provenance_lifecycle?.variants
    ?.find((item) => item.entity_id === variant.entity_id)?.observations ?? [];
  const paths = observations.some((item) => item.installation)
    ? [...new Set(observations.map((item) => item.installation?.canonical_target).filter(Boolean))]
    : variant.canonical_targets ?? (variant.canonical_target ? [variant.canonical_target] : []);
  const sources = [...new Set([variant.repository_id || variant.repository_url,
    ...observations.map((item) => item.source?.repository_id || item.source?.repository_url)].filter(Boolean))];
  const entries = observations.length ? observations : (variant.observed_paths ?? []).map((path) => ({ observed_path: path }));
  const history = observations.filter((item) => item.lifecycle?.installed_at
    || item.lifecycle?.updated_at || item.lifecycle?.receipt_history);
  const sourceBasis = observations.some((item) => item.evidence_state?.source === 'receipt_declared')
    ? '安装记录声明；本次未校验当前文件与安装记录的一致性'
    : observations.some((item) => item.evidence_state?.source === 'receipt_bound')
      ? '安装记录声明；当前文件与记录中的内容指纹一致' : null;
  return `<section class="variant"><h3>文件组 ${index + 1}</h3>${facts([
    ['实际文件目录', paths.join('\n') || '未能解析实际文件目录'],
    ['上游仓库', sources.join('\n') || '本次未获得来源证据'],
    ...(sourceBasis ? [['来源依据', sourceBasis]] : []),
    ['声明版本', versionLabel(variant, observations)],
  ])}
    <h3>安装入口（${entries.length}）</h3>
    <p class="muted small">软链接让多个 Agent 使用同一目录中的文件，不会复制技能内容。</p>
    <ul class="installation-list">${entries.map((observation) => {
    const installation = observation.installation ?? {};
    const kind = installation.entry_kind;
    const label = kind === 'symlink' ? '软链接' : kind === 'broken_symlink' ? '失效软链接'
      : kind === 'directory' ? '实体目录' : '路径类型未记录';
    const target = installation.canonical_target;
    return `<li><span class="tag">${label}</span> <code>${html(observation.observed_path)}</code>
      ${kind === 'symlink' || kind === 'broken_symlink'
      ? `<div class="small">→ <code>${html(target || installation.link_target || '链接目标未记录')}</code>${kind === 'broken_symlink' ? '（目标不可达）' : ''}</div>` : ''}</li>`;
  }).join('')}</ul>
    ${history.length ? `<details class="evidence"><summary>安装与更新记录（${history.length} 条）</summary>
      <p class="muted small">时间来自对应路径的安装记录，不代表软链接创建时间。技能集合的操作记录也不代表每个技能的安装时间。</p>
      ${history.map((observation) => {
    const lifecycle = observation.lifecycle;
    const semantics = lifecycle.timestamp_semantics;
    const basis = semantics === 'installer_declared' ? '安装器记录'
      : semantics === 'controller_record' ? '管理工具记录' : semantics ?? '未记录';
    return `<section class="variant">${facts([
      ['记录对应路径', observation.observed_path],
      ['安装 / 首次启用', timestamp(lifecycle.installed_at)],
      ['更新 / 当前版本启用', timestamp(lifecycle.updated_at)],
      ['时间依据', basis],
    ])}${observation.evidence_state?.content_binding === 'tree_unverified'
      ? '<p class="muted small">该安装记录尚未与当前文件内容完成校验。</p>' : ''}
      ${lifecycle.receipt_history ? `<p class="small">技能集合的操作记录：</p><pre>${html(json(lifecycle.receipt_history))}</pre>` : ''}</section>`;
  }).join('')}</details>` : '<p class="muted small">没有对应的安装或更新时间记录；已采集的文件路径和链接关系见上方。</p>'}
    <details class="evidence"><summary>标识与内容校验信息</summary>${facts([
    ['记录标识符', variant.entity_id], ['识别依据', variant.qualification],
    ['内容指纹', variant.content_fingerprint || '未知'], ['启用状态', variant.catalog_active],
  ])}</details></section>`;
}

function renderEntry(entry, index, doc) {
  const variants = entry.identity?.variants ?? [];
  const card = decisionCardForGap(entry.gap_class);
  const inventory = entry.collision?.assessment === 'inventory_only';
  const localFacts = inventory
    ? `发现 ${entry.collision.evidence?.real_directory_count ?? variants.length} 个实际文件目录、${entry.collision.evidence?.distinct_hashes?.length ?? '未知数量的'} 种内容指纹。宿主加载影响未验证，不能据此确认命名冲突`
    : card.reason;
  return `<details id="entry-${index}" class="entry-detail" data-entry-detail>
    <summary>${html(entry.identity?.name)} <span class="tag">${html(entry.gap_class)}</span></summary>
    <div class="detail-body">
      <div class="detail-heading"><h2>${html(entry.identity?.name)}</h2><a class="small" href="#inventory">返回技能列表</a></div>
      <p class="muted small">${variants.length} 组文件与来源 · 以下为目录和链接检查结果</p>
      <p class="fact">${html(localFacts)}。Agent 是否能从共享目录发现技能、加载技能并正确执行任务，仍需单独验证。</p>
      ${facts([
    ['源目录', entry.stored ? '已找到' : '未找到'],
    ['所在 Agent 目录', agentLabel(entry, doc)],
    ['启用状态', entry.catalog_active === 'absent' ? '未配置逐技能启用清单' : entry.catalog_active],
    ['链接状态', entry.link_health?.status],
    ['待检查项', signals(entry).join('、') || '未发现已确认的加载阻塞、安全规则或文件引用告警；尚未完成安全审核'],
  ])}
      <h3>来源与路径</h3>
      ${variants.map((variant, variantIndex) => renderSourceGroup(entry, variant, variantIndex)).join('')}
      <section class="guidance"><h3>后续处理与验证</h3><ol>
        <li>建议下一步：${html(entry.identity?.review_signals?.runtime_load_blockers?.length
    ? '先修复已确认的加载阻塞，并在目标 Agent 中验证加载结果' : card.handoff)}。继续检查时，保存报告 ID、目标路径、内容指纹和所选 Agent，明确问题的复现条件。</li>
        <li>按已有授权确定修改内容、预期结果和需要保留的功能。修改、安装或停用技能时，遵循对应工具的操作流程。</li>
        <li>使用相同目标和检查范围重新验证问题，再检查依赖该技能的功能。检查范围缩小、目标不再出现或命令执行成功，都不能单独证明问题已解决。</li>
        <li>分别记录“已解决 / 问题仍存在 / 未验证 / 出现新问题”。文件检查结果和 Agent 中的实际运行结果分别说明。</li>
      </ol></section>
      <details class="evidence"><summary>原始检查数据（JSON）</summary><pre>${html(json(entry))}</pre></details>
    </div>
  </details>`;
}

/** Render the complete document before JavaScript adds optional filtering. */
export function renderPanoramaHtml(doc, options = {}) {
  if (!doc || !Array.isArray(doc.entries) || !Array.isArray(doc.agents) || !doc.summary) {
    throw new TypeError('HTML report requires a panorama document with entries, agents and summary');
  }
  const complete = doc.collectors?.status === 'COMPLETE';
  const css = template.match(/<style>([\s\S]*?)<\/style>/u)[1];
  const javascript = template.match(/<script>([\s\S]*?)<\/script>/u)[1];
  const csp = `default-src 'none'; script-src 'sha256-${hash(javascript)}'; style-src 'sha256-${hash(css)}'; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  const values = {
    CSP: html(csp),
    TITLE: html(doc.title_zh ?? '技能概览'),
    SNAPSHOT_LABEL: html(options.snapshotLabel ?? timestamp(doc.generated_at)),
    STAMP: `检查范围：${html(doc.agents.map((agent) => agent.label_zh ?? agent.id).join(' / ') || '未指定 Agent')}`,
    STATS: [
      [doc.summary.total, '扫描到的技能'],
      [doc.summary.gap_counts?.['命名冲突'], '已确认命名冲突'],
      [doc.summary.review_signal_counts?.skills_requiring_risk_review, '需要安全检查的技能'],
      [doc.summary.gap_counts?.['暂无法判定'], '证据不足，暂无法判定'],
    ].map(([count, label]) => `<div class="stat"><strong>${html(count)}</strong><span>${html(label)}</span></div>`).join(''),
    NOTICE: `<p class="notice${complete ? '' : ' warning'}">数据采集状态：${html(doc.collectors?.status ?? 'DEGRADED')} / ${html(doc.collectors?.completeness ?? 'PARTIAL')}。${complete ? '数据已完整采集，技能能否正常加载仍需验证。' : '部分数据未能采集，无法据此判断相关技能是否正常。'} 扫描告警需进一步检查，以确认是否存在实际问题。</p>`,
    GAP_OPTIONS: GAP_CLASS_PRIORITY.map((gap) => `<option value="${html(gap)}">${html(gap)} · ${html(doc.summary.gap_counts?.[gap])}</option>`).join(''),
    GAP_COUNTS: facts(GAP_CLASS_PRIORITY.map((gap) => [gap, doc.summary.gap_counts?.[gap]])),
    RESULT: `显示 ${doc.entries.length} / ${html(doc.summary.total)} 条 · 全部技能`,
    ENTRY_LINKS: doc.entries.map((entry, index) => `<li><a class="entry-link" data-entry-link data-review="${needsReview(entry)}" data-gap="${html(entry.gap_class)}" data-search="${html([entry.identity?.name, ...(entry.identity?.paths ?? []), agentLabel(entry, doc), entry.gap_class].join(' '))}" href="#entry-${index}"><span class="entry-line"><span class="entry-name">${html(entry.identity?.name)}</span><span class="tag${signals(entry).length ? ' review' : ''}">${html(entry.gap_class)}</span></span><span class="entry-context">${html(agentLabel(entry, doc))}</span></a></li>`).join(''),
    EMPTY_HIDDEN: doc.entries.length ? 'hidden' : '',
    DETAIL_EMPTY_HIDDEN: doc.entries.length ? 'hidden' : '',
    ENTRY_DETAILS: doc.entries.map((entry, index) => renderEntry(entry, index, doc)).join(''),
    COLLECTOR_DETAILS: `<details class="evidence"><summary>采集范围与错误详情</summary><pre>${html(json({ collectors: doc.collectors, notes: doc.notes, agents: doc.agents }))}</pre></details>`,
    COLLECTION_DETAILS: (doc.managed_collections ?? []).length ? `<section class="panel runtime"><div class="panel-head"><h2>托管的技能集合</h2><p class="muted small">查看各集合的文件检查和运行验证结果。</p></div><div class="runtime-grid">${doc.managed_collections.map((collection) => `<section class="runtime-adapter"><h3>${html(collection.collection_id)}</h3>${facts([['文件系统', collection.status], ['运行时', collection.runtime_status]])}<details class="evidence"><summary>集合检查数据</summary><pre>${html(json(collection))}</pre></details></section>`).join('')}</div></section>` : '',
    RUNTIME: Object.entries(doc.runtime_truth_matrix?.adapters ?? {}).map(([agent, truth]) => `<section class="runtime-adapter"><h3>${html(agent)}</h3>${facts([
      ['文件系统', truth.filesystem?.result], ['部署配置', truth.deployment?.result], ['技能发现', truth.catalog?.result],
      ['内容读取', truth.body?.result], ['技能选择', truth.route?.result], ['上下文占用', truth.context?.result],
    ])}</section>`).join('') || '<p class="muted">尚未记录 Agent 中的实际运行结果。</p>',
    FOOTER: `报告 ID：${html(doc.generation_id)} · 模板：panorama-report.v1<br>本报告只展示检查结果。继续检查和修复可使用 skill-hygiene。页面数据与同一报告 ID 的 JSON 一致。`,
    REPORT_JSON: scriptJson(doc),
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/gu, (_, key) => {
    if (!(key in values)) throw new Error(`Unknown report template slot: ${key}`);
    return values[key];
  });
}
