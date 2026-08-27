/**
 * 渲染 latest.json / latest.md，以及脱敏可分享副本。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APP_SUPPORT_RELATIVE,
  GAP_CLASS_PRIORITY,
  PANORAMA_IDENTITY,
  PREDICATE_KEYS,
  PREDICATE_LABELS_ZH,
  REDACTION,
  panoramaDir,
} from './panorama-constants.mjs';
import { decisionCardForGap, summarizeGaps } from './panorama-gaps.mjs';

/**
 * 将家目录真路径替换为 ~（可分享脱敏）。
 * @param {string} text
 * @param {string} home
 * @returns {string}
 */
export function redactHomePaths(text, home) {
  if (typeof text !== 'string') return text;
  let result = text;
  if (home && home.length > 1) {
    result = result.split(home).join(REDACTION.homeToken);
  }
  // 弱化 /Users/<name> 或 /home/<name>
  result = result.replace(/\/Users\/[^/"'\s]+/g, `/Users/${REDACTION.usernameToken}`);
  result = result.replace(/\/home\/[^/"'\s]+/g, `/home/${REDACTION.usernameToken}`);
  return result;
}

/**
 * 深度脱敏对象中的字符串路径。
 * @param {unknown} value
 * @param {string} home
 * @returns {unknown}
 */
export function redactValue(value, home) {
  if (typeof value === 'string') return redactHomePaths(value, home);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, home));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = redactValue(child, home);
    }
    return out;
  }
  return value;
}

/**
 * 构建权威 JSON 快照对象。
 * @param {object} params
 */
export function buildPanoramaDocument(params) {
  const counts = summarizeGaps(params.rows);
  const riskRows = params.rows.filter((row) => (row.identity?.review_signals?.risk_indicators ?? []).length > 0);
  const referenceRows = params.rows.filter((row) => (row.identity?.review_signals?.hygiene_flags ?? [])
    .some((flag) => flag.startsWith('broken_refs:')));
  const riskIndicatorCounts = {};
  for (const row of riskRows) {
    for (const risk of row.identity.review_signals.risk_indicators) {
      riskIndicatorCounts[risk.id] = (riskIndicatorCounts[risk.id] ?? 0) + 1;
    }
  }
  return {
    schema_version: PANORAMA_IDENTITY.schemaVersion,
    title_zh: PANORAMA_IDENTITY.productNameZh,
    generated_at: params.generatedAt ?? new Date().toISOString(),
    interactive_confirmed: params.interactiveConfirmed,
    notes: params.notes ?? [],
    agents: params.agents,
    catalog_mode: params.catalogMode,
    collectors: {
      commands: params.commands ?? [],
      notes: params.collectorNotes ?? [],
    },
    managed_collections: params.managedCollections ?? [],
    summary: {
      total: params.rows.length,
      gap_counts: counts,
      review_signal_counts: {
        skills_requiring_risk_review: riskRows.length,
        skills_with_reference_findings: referenceRows.length,
        risk_indicators: riskIndicatorCounts,
      },
    },
    entries: params.rows,
    field_glossary_zh: PREDICATE_LABELS_ZH,
    predicate_keys: PREDICATE_KEYS,
  };
}

/**
 * 渲染中文 Markdown（高可读：总览 → 八类 → Agent 摘要 → 字段对照）。
 * @param {object} doc buildPanoramaDocument 结果
 * @returns {string}
 */
export function renderPanoramaMarkdown(doc) {
  const lines = [];
  lines.push(`# ${doc.title_zh}`);
  lines.push('');
  lines.push(`生成时间：${doc.generated_at}`);
  lines.push(`交互确认：${doc.interactive_confirmed ? '是' : '否（报告已注明）'}`);
  lines.push(`控制清单模式：${doc.catalog_mode === 'members' ? '已对照批准成员' : '未使用控制清单'}`);
  lines.push('');
  lines.push('## 总览');
  lines.push('');
  lines.push(`条目总数：${doc.summary.total}`);
  lines.push('');
  const reviewCounts = doc.summary.review_signal_counts ?? {};
  lines.push(`安全复核：${reviewCounts.skills_requiring_risk_review ?? 0} 条；引用复核：${reviewCounts.skills_with_reference_findings ?? 0} 条。`);
  lines.push('静态信号只表示需要人工复核，不等于已确认安全问题。');
  lines.push('');
  const reviewEntries = doc.entries.filter((entry) => (entry.identity?.review_signals?.risk_indicators ?? []).length > 0
    || (entry.identity?.review_signals?.hygiene_flags ?? []).some((flag) => flag.startsWith('broken_refs:')));
  if (reviewEntries.length > 0) {
    lines.push('### 治理复核信号');
    lines.push('');
    lines.push('| Skill | 安全信号 | 引用信号 |');
    lines.push('|---|---|---|');
    for (const entry of reviewEntries) {
      const risks = entry.identity.review_signals.risk_indicators.map((risk) => risk.id).join(', ') || '无';
      const refs = entry.identity.review_signals.hygiene_flags
        .filter((flag) => flag.startsWith('broken_refs:'))
        .join(', ') || '无';
      lines.push(`| ${entry.identity.name} | ${risks} | ${refs} |`);
    }
    lines.push('');
  }
  if (Array.isArray(doc.managed_collections) && doc.managed_collections.length > 0) {
    lines.push('### 受管集合状态');
    lines.push('');
    lines.push('| 集合 | 文件系统 | 运行时 | 上游版本 | 问题摘要 |');
    lines.push('|---|---|---|---|---|');
    for (const collection of doc.managed_collections) {
      const groupedIssues = new Map();
      for (const issue of collection.issues ?? []) {
        const code = String(issue).split(':', 1)[0];
        groupedIssues.set(code, (groupedIssues.get(code) ?? 0) + 1);
      }
      const issueSummary = [...groupedIssues.entries()]
        .map(([code, count]) => `${code}${count > 1 ? ` ×${count}` : ''}`)
        .join('；') || '无';
      const release = collection.source?.upstream_release;
      const releaseText = release?.status === 'declared'
        ? release.value
        : release?.status === 'not_declared' ? '上游未声明' : '未知';
      lines.push(`| ${collection.collection_id} | ${collection.status} | ${collection.runtime_status} | ${releaseText} | ${issueSummary} |`);
    }
    lines.push('');
    lines.push('文件系统状态、运行时验证和上游版本是三个独立事实；`UNVERIFIED` 不会被写成通过。');
    lines.push('');
  }
  lines.push('| 缺口类 | 数量 |');
  lines.push('|---|---:|');
  for (const gap of GAP_CLASS_PRIORITY) {
    lines.push(`| ${gap} | ${doc.summary.gap_counts[gap] ?? 0} |`);
  }
  lines.push('');
  if (Array.isArray(doc.notes) && doc.notes.length > 0) {
    lines.push('### 运行说明');
    lines.push('');
    for (const note of doc.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  lines.push('## 按缺口分组');
  lines.push('');
  for (const gap of GAP_CLASS_PRIORITY) {
    const items = doc.entries.filter((entry) => entry.gap_class === gap);
    lines.push(`### ${gap}（${items.length}）`);
    lines.push('');
    if (items.length === 0) {
      lines.push('（无）');
      lines.push('');
      continue;
    }
    const card = decisionCardForGap(gap);
    lines.push(`- 风险：${card.level} — ${card.reason}`);
    lines.push(`- 若继续评估：交给 ${card.handoff}`);
    lines.push('');
    for (const entry of items) {
      const agents = Object.entries(entry.projected || {})
        .filter(([, value]) => value.present)
        .map(([id]) => id)
        .join(', ') || '无';
      lines.push(`- **${entry.identity.name}**`);
      lines.push(`  - 源目录：${entry.stored ? '有' : '无'}`);
      lines.push(`  - 出现在：${agents}`);
      lines.push(`  - 控制清单：${entry.catalog_active}`);
      lines.push(`  - 链接：${entry.link_health?.status}${entry.link_health?.detail ? `（${entry.link_health.detail}）` : ''}`);
      lines.push(`  - 撞名：${entry.collision?.status}`);
    }
    lines.push('');
  }

  lines.push('## 按 Agent 分列摘要');
  lines.push('');
  for (const agent of doc.agents ?? []) {
    const presentCount = doc.entries.filter((entry) => entry.projected?.[agent.id]?.present).length;
    lines.push(`- ${agent.label_zh}（\`${agent.location}\`）${agent.present ? '' : ' — 目录不存在，已跳过投影列'}：${presentCount} 条`);
  }
  lines.push('');

  lines.push('## 字段对照（中文 ↔ JSON 键）');
  lines.push('');
  lines.push('| 对人显示 | JSON 键 |');
  lines.push('|---|---|');
  for (const [key, label] of Object.entries(PREDICATE_LABELS_ZH)) {
    lines.push(`| ${label} | \`${key}\` |`);
  }
  lines.push('');
  lines.push('本报告只读。不提供删除、改软链或改控制清单的命令；处置请进入 `skill-hygiene` 并二次确认。');
  lines.push('');
  return `${lines.join('\n')}`;
}

/**
 * 覆盖写入本机 latest.json / latest.md。
 * @param {{ home: string, doc: object, stdoutOnly?: boolean, copyToCwd?: boolean, share?: boolean }} options
 */
export function writePanoramaOutputs(options) {
  const md = renderPanoramaMarkdown(options.doc);
  const jsonText = `${JSON.stringify(options.doc, null, 2)}\n`;
  const result = { jsonPath: null, mdPath: null, shareJsonPath: null, shareMdPath: null, stdout: null };

  if (options.stdoutOnly) {
    result.stdout = { json: options.doc, markdown: md };
    return result;
  }

  const dir = panoramaDir(options.home);
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, APP_SUPPORT_RELATIVE.latestJson);
  const mdPath = join(dir, APP_SUPPORT_RELATIVE.latestMd);
  writeFileSync(jsonPath, jsonText, 'utf8');
  writeFileSync(mdPath, md, 'utf8');
  result.jsonPath = jsonPath;
  result.mdPath = mdPath;

  if (options.share) {
    const redacted = redactValue(options.doc, options.home);
    const shareJson = join(dir, APP_SUPPORT_RELATIVE.shareJson);
    const shareMd = join(dir, APP_SUPPORT_RELATIVE.shareMd);
    writeFileSync(shareJson, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');
    writeFileSync(shareMd, redactHomePaths(md, options.home), 'utf8');
    result.shareJsonPath = shareJson;
    result.shareMdPath = shareMd;
  }

  if (options.copyToCwd) {
    writeFileSync(join(process.cwd(), APP_SUPPORT_RELATIVE.latestJson), jsonText, 'utf8');
    writeFileSync(join(process.cwd(), APP_SUPPORT_RELATIVE.latestMd), md, 'utf8');
  }

  return result;
}
