/**
 * 八类缺口推导：仅由六列原子字段可逆推导。
 * 优先级：命名冲突/链接损坏 > 清单不符 > 部分投影 > 仅 Agent / 仅源 > 暂无法判定 > 齐全。
 */

import {
  CATALOG_ACTIVE_VALUES,
  COLLISION_STATUS,
  GAP_CLASSES,
  GAP_CLASS_PRIORITY,
  LINK_HEALTH_VALUES,
  RISK_LEVELS,
} from './panorama-constants.mjs';

/**
 * 所选 Agent 中是否至少有一处投影。
 * @param {Record<string, { present: boolean }>} projected
 * @returns {boolean}
 */
export function anyProjection(projected) {
  return Object.values(projected ?? {}).some((item) => item?.present === true);
}

/**
 * 所选且目录存在的 Agent 是否全部有投影。
 * @param {Record<string, { present: boolean, skipped_reason?: string }>} projected
 * @returns {boolean}
 */
export function allPresentAgentsProjected(projected) {
  const considered = Object.values(projected ?? {}).filter((item) => item?.skipped_reason !== 'agent_root_absent');
  if (considered.length === 0) return false;
  return considered.every((item) => item.present === true);
}

/**
 * 是否「部分 Agent 已出现」：源里有，且至少一处投影，但未覆盖全部所选且存在的 Agent。
 * @param {object} row
 * @returns {boolean}
 */
export function isPartialProjection(row) {
  return row.stored === true
    && anyProjection(row.projected)
    && !allPresentAgentsProjected(row.projected);
}

/**
 * 是否清单漂移（无清单时恒为 false）。
 * @param {object} row
 * @param {'members'|'absent'} catalogMode
 */
export function isCatalogDrift(row, catalogMode) {
  if (catalogMode !== 'members') return false;
  const active = row.catalog_active;
  if (active === CATALOG_ACTIVE_VALUES.absent || active === CATALOG_ACTIVE_VALUES.unknown) {
    return false;
  }
  if (active === CATALOG_ACTIVE_VALUES.active) {
    return !(row.stored || anyProjection(row.projected));
  }
  if (active === CATALOG_ACTIVE_VALUES.inactive) {
    // 磁盘/投影有、但未批准（受管宇宙）
    return row.stored || anyProjection(row.projected);
  }
  return false;
}

/**
 * 字段是否不足以判定。
 * @param {object} row
 */
export function isInsufficient(row) {
  if (row.catalog_active === CATALOG_ACTIVE_VALUES.unknown) return true;
  if (row.link_health?.status === LINK_HEALTH_VALUES.unknown) return true;
  if (row.collision?.status === COLLISION_STATUS.unknown) return true;
  if (row.identity?.content_fingerprint === null && row.stored && !anyProjection(row.projected)) {
    // 源侧有实体但指纹缺失：仍可归仅源/齐全，不算 unknown
  }
  return false;
}

/**
 * 推导单条缺口类。
 * @param {object} row 六列行
 * @param {{ catalogMode: 'members'|'absent' }} options
 * @returns {string} GAP_CLASSES 中文值
 */
export function classifyGap(row, options) {
  // 冲突 / 损坏优先于一切投影完整性判断
  if (row.collision?.status === COLLISION_STATUS.conflict) {
    return GAP_CLASSES.NAME_COLLISION;
  }
  const link = row.link_health?.status;
  if (link === LINK_HEALTH_VALUES.broken || link === LINK_HEALTH_VALUES.unexpected_target) {
    return GAP_CLASSES.BROKEN_LINK;
  }
  if (isCatalogDrift(row, options.catalogMode)) {
    return GAP_CLASSES.CATALOG_DRIFT;
  }
  if (!row.stored && anyProjection(row.projected)) {
    return GAP_CLASSES.AGENT_ONLY;
  }
  if (row.stored && !anyProjection(row.projected)) {
    return GAP_CLASSES.SOURCE_ONLY;
  }
  // 部分投影：独立第八类；不得标齐全，也不得笼统暂无法判定
  if (isPartialProjection(row)) {
    return GAP_CLASSES.PARTIAL_PROJECTION;
  }
  if (isInsufficient(row)) {
    return GAP_CLASSES.UNKNOWN;
  }
  // 齐全 = 源里有 + 全部所选且存在的 Agent 均有健康投影（及清单非漂移，已在上文排除）
  if (row.stored && allPresentAgentsProjected(row.projected)) {
    const linkOk = link === LINK_HEALTH_VALUES.ok
      || link === LINK_HEALTH_VALUES.not_applicable;
    if (linkOk) return GAP_CLASSES.COMPLETE;
  }
  return GAP_CLASSES.UNKNOWN;
}

/**
 * 批量为行附加 gap_class。
 * @param {object[]} rows
 * @param {{ catalogMode: 'members'|'absent' }} options
 */
export function attachGapClasses(rows, options) {
  return rows.map((row) => ({
    ...row,
    gap_class: classifyGap(row, options),
  }));
}

/**
 * 按八类分组计数。
 * @param {Array<{ gap_class: string }>} rows
 */
export function summarizeGaps(rows) {
  const counts = {};
  for (const name of GAP_CLASS_PRIORITY) counts[name] = 0;
  for (const row of rows) {
    const key = row.gap_class;
    if (Object.hasOwn(counts, key)) counts[key] += 1;
    else counts[GAP_CLASSES.UNKNOWN] += 1;
  }
  return counts;
}

/**
 * 决策卡风险：按缺口类给出默认风险等级与半句原因。
 * @param {string} gapClass
 * @returns {{ level: string, reason: string, handoff: string }}
 */
export function decisionCardForGap(gapClass) {
  switch (gapClass) {
    case GAP_CLASSES.BROKEN_LINK:
      return {
        level: RISK_LEVELS.high,
        reason: '投影不可用，Agent 可能加载失败',
        handoff: 'skill-hygiene（评估与可恢复处置，需二次确认）',
      };
    case GAP_CLASSES.NAME_COLLISION:
      return {
        level: RISK_LEVELS.high,
        reason: '同名异内容可能导致错误技能被加载',
        handoff: 'skill-hygiene（保留默认，勿自动清退）',
      };
    case GAP_CLASSES.CATALOG_DRIFT:
      return {
        level: RISK_LEVELS.medium,
        reason: '控制意图与磁盘现实不一致',
        handoff: 'skill-hygiene collection status / 人工确认意图',
      };
    case GAP_CLASSES.PARTIAL_PROJECTION:
      return {
        level: RISK_LEVELS.low,
        reason: '所选且存在的 Agent 中仅部分有投影',
        handoff: '调整 Agent 覆盖或交给 skill-hygiene 评估是否补投影',
      };
    case GAP_CLASSES.AGENT_ONLY:
      return {
        level: RISK_LEVELS.medium,
        reason: '投影找不到预期源，可能是孤儿链接或外来副本',
        handoff: 'skill-hygiene',
      };
    case GAP_CLASSES.SOURCE_ONLY:
      return {
        level: RISK_LEVELS.low,
        reason: '源里有但未分发到所选 Agent',
        handoff: '调整 Agent 覆盖或交给 skill-hygiene 评估是否需要投影',
      };
    case GAP_CLASSES.UNKNOWN:
      return {
        level: RISK_LEVELS.low,
        reason: '上游收集器字段不足，全景不猜测',
        handoff: '等待收集器补字段；或 skill-debug 补充观测',
      };
    case GAP_CLASSES.COMPLETE:
    default:
      return {
        level: RISK_LEVELS.none,
        reason: '拓扑一致，无需处置',
        handoff: '仅阅览',
      };
  }
}
