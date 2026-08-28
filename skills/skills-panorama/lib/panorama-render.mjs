/**
 * 渲染 latest.json / latest.md，以及脱敏可分享副本。
 */

import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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
  const original = text;
  if (home && home.length > 1 && (original === home || original.startsWith(`${home}/`))) {
    return `${REDACTION.homeToken}${original.slice(home.length)}`;
  }
  if (isAbsolute(original) || /^[A-Za-z]:[\\/]/u.test(original) || /^\\\\[^\\]+\\/u.test(original)) {
    return REDACTION.absolutePathToken;
  }
  let result = original;
  if (home && home.length > 1) {
    result = result.split(home).join(REDACTION.homeToken);
  }
  // A query/fragment can legally contain quotes and whitespace in diagnostic
  // text. Redact the complete remainder of that line before endpoint matching
  // so a quoted value cannot survive after the URL prefix is replaced.
  result = result.replace(/\?[^\r\n]*/gu, REDACTION.queryToken);
  result = result.replace(/#[^\r\n]*/gu, REDACTION.fragmentToken);
  // Percent-encoded endpoints are still credentials/endpoints. Decode only for
  // classification; never emit the decoded value or let decode failures weaken
  // the raw-string redaction below.
  if (/%(?:2f|3a|3f|23|40)/iu.test(result)) {
    try {
      const decoded = decodeURIComponent(result);
      if (/(?:ssh|git\+ssh):\/\//iu.test(decoded)
          || /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/u.test(decoded)) {
        return REDACTION.sshToken;
      }
      if (/[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(decoded)) return REDACTION.urlToken;
      if (isAbsolute(decoded) || /^[A-Za-z]:[\\/]/u.test(decoded) || /^\\\\[^\\]+\\/u.test(decoded)) {
        return REDACTION.absolutePathToken;
      }
      if (decoded.includes('?')) return REDACTION.queryToken;
      if (decoded.includes('#')) return REDACTION.fragmentToken;
    } catch {
      // Malformed percent escapes are handled by the raw-string rules.
    }
  }
  result = result.replace(/\b(?:ssh|git\+ssh):\/\/[^\s"'`<>]+/giu, REDACTION.sshToken);
  result = result.replace(/\b[A-Za-z0-9._-]+@(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.%]+\]):[^\s"'`<>]+/gu, REDACTION.sshToken);
  result = result.replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]+/gu, REDACTION.urlToken);
  result = result.replace(/\b[^\s:@/]+:[^\s@/]+@[A-Za-z0-9.-]+\b/gu, REDACTION.sshToken);
  result = result.replace(/\b[A-Za-z0-9._-]+@(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.%]+\])/gu, REDACTION.sshToken);
  result = result.replace(/\bssh\s+[^\r\n]+/gu, REDACTION.sshToken);
  result = result.replace(
    /(^|[\s=(:'"\[,;{])\/(?:\/)?([^\s/"'`<>|,;\])][^\s"'`<>|,;\])]*|[^\s/"'`<>|,;\])])/gu,
    (_, prefix) => `${prefix}${REDACTION.absolutePathToken}`,
  );
  result = result.replace(/\b[A-Za-z]:\\[^\s"'`<>|,;\])]+/gu, REDACTION.absolutePathToken);
  result = result.replace(/\\\\[^\\\s]+\\[^\s"'`<>|,;\])]+/gu, REDACTION.absolutePathToken);
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
      const sensitiveKey = /(?:token|secret|password|passwd|credential|authorization|api[_-]?key|private[_-]?key|(?:^|[_-])auth(?:$|[_-]))/iu.test(key);
      const keyCarriesValue = sensitiveKey && /[=:]/u.test(key);
      const redactedKey = keyCarriesValue ? REDACTION.secretKeyToken : redactHomePaths(key, home);
      out[redactedKey] = sensitiveKey ? REDACTION.secretToken : redactValue(child, home);
    }
    return out;
  }
  return value;
}

function filesystemTruth(managedCollections) {
  const statuses = (managedCollections ?? []).map((collection) => ({
    collection_id: collection.collection_id ?? null,
    result: collection.status ?? 'UNVERIFIED',
  }));
  if (statuses.length === 0) return { result: 'unverified', collections: [] };
  return {
    result: statuses.every(({ result }) => result === 'FILESYSTEM_READY') ? 'pass' : 'fail',
    collections: statuses,
  };
}

function deploymentTruth(adapterId, profile) {
  if (adapterId === 'cursor') {
    if (!profile) return { result: 'unverified', profile_status: 'UNVERIFIED', mutation_policy: 'unverified' };
    if (profile.cursor_mutation_policy === 'observe_only_until_runtime_probe') {
      return {
        result: 'observe_only',
        profile_status: profile.status ?? 'UNVERIFIED',
        mutation_policy: profile.cursor_mutation_policy,
      };
    }
    return {
      result: 'policy_mismatch',
      profile_status: profile.status ?? 'UNVERIFIED',
      mutation_policy: profile.cursor_mutation_policy ?? 'unverified',
    };
  }
  if (!profile) return { result: 'unverified', profile_status: 'UNVERIFIED' };
  return {
    result: profile.status === 'DEPLOYMENT_READY' ? 'pass'
      : profile.status === 'BLOCKED' ? 'blocked' : 'fail',
    profile_status: profile.status ?? 'UNVERIFIED',
    issues: profile.issues ?? [],
  };
}

/** Keep filesystem/deployment/runtime observations independent; never infer a single readiness flag. */
export function buildRuntimeTruthMatrix(params) {
  const filesystem = filesystemTruth(params.managedCollections);
  const adapters = {};
  for (const adapterId of ['codex', 'claude', 'cursor']) {
    const runtime = params.runtimeStatus?.adapters?.[adapterId] ?? null;
    const catalog = runtime?.catalog ?? null;
    const predicates = runtime?.effective_predicates ?? null;
    const pressure = catalog?.context_budget_pressure;
    const evidenceCurrent = runtime !== null && runtime.status !== 'STALE';
    adapters[adapterId] = {
      filesystem: structuredClone(filesystem),
      deployment: deploymentTruth(adapterId, params.runtimeProfileStatus),
      catalog: {
        result: evidenceCurrent ? catalog?.result ?? 'unverified' : 'unverified',
        policy_conformance: evidenceCurrent ? catalog?.policy_conformance ?? 'unverified' : 'unverified',
        identity_conformance: evidenceCurrent ? catalog?.identity_conformance ?? 'unverified' : 'unverified',
        evidence_status: runtime?.status ?? 'UNVERIFIED',
        evidence_id: runtime?.evidence_id ?? null,
        observed_at: runtime?.observed_at ?? null,
        invalidation_reason: runtime?.reason ?? null,
      },
      body: {
        result: evidenceCurrent && predicates?.body_access_observed === true ? 'observed' : 'unverified',
      },
      route: {
        result: evidenceCurrent && predicates?.route_observed === true ? 'observed' : 'unverified',
      },
      context: {
        result: !evidenceCurrent ? 'unverified'
          : pressure === true ? 'pressure_observed'
          : pressure === false ? 'no_pressure_observed' : 'unverified',
        filesystem_nesting_saves_context: 'not_inferred',
      },
    };
  }
  return {
    claim_boundary: 'filesystem, deployment, catalog, body, route, and context are independent facts',
    adapters,
  };
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
    generation_id: params.generationId ?? randomUUID(),
    title_zh: PANORAMA_IDENTITY.productNameZh,
    generated_at: params.generatedAt ?? new Date().toISOString(),
    interactive_confirmed: params.interactiveConfirmed,
    notes: params.notes ?? [],
    agents: params.agents,
    catalog_mode: params.catalogMode,
    collectors: {
      status: params.collectorStatus ?? 'DEGRADED',
      completeness: params.completeness ?? 'PARTIAL',
      commands: params.commands ?? [],
      notes: params.collectorNotes ?? [],
      degraded_reasons: params.degradedReasons ?? [],
      blockers: params.collectorBlockers ?? [],
    },
    managed_collections: params.managedCollections ?? [],
    runtime_truth_matrix: buildRuntimeTruthMatrix(params),
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
  lines.push(`报告代次：${doc.generation_id}`);
  lines.push(`交互确认：${doc.interactive_confirmed ? '是' : '否（报告已注明）'}`);
  lines.push(`控制清单模式：${doc.catalog_mode === 'members' ? '已对照批准成员' : '未使用控制清单'}`);
  lines.push(`收集完整性：${doc.collectors?.status ?? 'DEGRADED'} / ${doc.collectors?.completeness ?? 'PARTIAL'}`);
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
  if ((doc.collectors?.blockers ?? []).length > 0) {
    lines.push('### 收集器阻断证据');
    lines.push('');
    lines.push('| 收集器 | 类型 | 退出状态 |');
    lines.push('|---|---|---:|');
    for (const blocker of doc.collectors.blockers) {
      lines.push(`| ${blocker.collector ?? 'unknown'} | ${blocker.kind ?? 'unknown'} | ${blocker.exit_status ?? 'n/a'} |`);
    }
    lines.push('');
    lines.push('非零但可解析的输出仍保留在 JSON；`DEGRADED` 表示事实面不完整，不等于没有报告。');
    lines.push('');
  }

  lines.push('### Runtime truth matrix');
  lines.push('');
  lines.push('| Agent | filesystem | deployment | catalog | body | route | context |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [adapter, truth] of Object.entries(doc.runtime_truth_matrix?.adapters ?? {})) {
    lines.push(`| ${adapter} | ${truth.filesystem.result} | ${truth.deployment.result} | ${truth.catalog.result} | ${truth.body.result} | ${truth.route.result} | ${truth.context.result} |`);
  }
  lines.push('');
  lines.push('六层事实独立呈现；文件系统嵌套本身不构成节省 context 的证据。');
  lines.push('');

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
      lines.push(`  - 撞名：${entry.collision?.status}${entry.collision?.classification ? `（${entry.collision.classification}）` : ''}`);
      if (entry.collision?.status === 'conflict') {
        lines.push(`  - 默认处置：${entry.collision.default_disposition ?? 'preserve'}（仅保留，不授权删除或重链）`);
        for (const variant of entry.identity?.variants ?? []) {
          const locations = (variant.observed_locations ?? []).join(', ') || '未观测宿主';
          lines.push(`  - 身份变体：${variant.entity_id}；${locations}`);
        }
      }
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

function assertSafeExistingTarget(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (stat.isSymbolicLink() || !stat.isFile() || (currentUid !== null && stat.uid !== currentUid)) {
    throw new Error(`拒绝覆盖非普通文件目标: ${path}`);
  }
}

function ensurePrivateOutputDirectory(home) {
  const normalizedHome = resolve(home);
  if (!isAbsolute(normalizedHome)) throw new Error('HOME 必须是绝对路径');
  const homeStat = lstatSync(normalizedHome);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (homeStat.isSymbolicLink() || !homeStat.isDirectory()
      || (currentUid !== null && homeStat.uid !== currentUid)) {
    throw new Error(`HOME 不是当前用户自有的 real directory: ${normalizedHome}`);
  }
  const directory = panoramaDir(normalizedHome);
  const rel = relative(normalizedHome, directory);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('panorama 输出越出 HOME');
  let current = normalizedHome;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) {
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()
        || (currentUid !== null && stat.uid !== currentUid)) {
      throw new Error(`输出路径含非自有目录或软链: ${current}`);
    }
  }
  const finalStat = lstatSync(directory);
  if ((finalStat.mode & 0o077) !== 0) {
    const descriptor = openSync(directory, 'r');
    try {
      fchmodSync(descriptor, 0o700);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    const privateStat = lstatSync(directory);
    if (privateStat.dev !== finalStat.dev || privateStat.ino !== finalStat.ino
        || (privateStat.mode & 0o077) !== 0) {
      throw new Error(`panorama 输出目录无法收敛为私有 0700: ${directory}`);
    }
  }
  return directory;
}

function writePrivateAtomic(path, bytes) {
  assertSafeExistingTarget(path);
  const directory = dirname(path);
  const directoryStat = lstatSync(directory);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()
      || (currentUid !== null && directoryStat.uid !== currentUid)) {
    throw new Error(`输出父目录不安全: ${directory}`);
  }
  const directoryIdentity = `${directoryStat.dev}:${directoryStat.ino}`;
  const assertSameDirectory = () => {
    const current = lstatSync(directory);
    if (current.isSymbolicLink() || !current.isDirectory()
        || `${current.dev}:${current.ino}` !== directoryIdentity
        || (currentUid !== null && current.uid !== currentUid)) {
      throw new Error(`输出父目录在原子替换期间发生变化: ${directory}`);
    }
  };
  const temporary = join(directory, `.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assertSameDirectory();
    assertSafeExistingTarget(path);
    renameSync(temporary, path);
    assertSameDirectory();
    const parent = openSync(directory, 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
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

  const dir = ensurePrivateOutputDirectory(options.home);
  const jsonPath = join(dir, APP_SUPPORT_RELATIVE.latestJson);
  const mdPath = join(dir, APP_SUPPORT_RELATIVE.latestMd);
  const outputs = [
    { path: jsonPath, bytes: jsonText },
    { path: mdPath, bytes: md },
  ];
  if (options.share) {
    const redacted = redactValue(options.doc, options.home);
    const shareJson = join(dir, APP_SUPPORT_RELATIVE.shareJson);
    const shareMd = join(dir, APP_SUPPORT_RELATIVE.shareMd);
    outputs.push(
      { path: shareJson, bytes: `${JSON.stringify(redacted, null, 2)}\n` },
      { path: shareMd, bytes: redactHomePaths(md, options.home) },
    );
    result.shareJsonPath = shareJson;
    result.shareMdPath = shareMd;
  }

  if (options.copyToCwd) {
    outputs.push(
      { path: join(process.cwd(), APP_SUPPORT_RELATIVE.latestJson), bytes: jsonText },
      { path: join(process.cwd(), APP_SUPPORT_RELATIVE.latestMd), bytes: md },
    );
  }

  for (const output of outputs) assertSafeExistingTarget(output.path);
  for (const output of outputs) writePrivateAtomic(output.path, output.bytes);
  result.jsonPath = jsonPath;
  result.mdPath = mdPath;

  return result;
}
