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
    const observations = row.identity?.catalog_members;
    if (Array.isArray(observations) && observations.length > 0) {
      return !observations.some((item) => item?.present === true);
    }
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
  if (row.collision?.status === COLLISION_STATUS.unknown) {
    return GAP_CLASSES.UNKNOWN;
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
        reason: '技能链接损坏或指向非预期路径，Agent 可能无法加载',
        handoff: '使用 skill-hygiene 检查链接，执行修复前需再次确认',
      };
    case GAP_CLASSES.NAME_COLLISION:
      return {
        level: RISK_LEVELS.high,
        reason: '同一宿主的加载范围内存在已确认的同名选择歧义',
        handoff: '先核对宿主、候选路径和加载证据，再使用 skill-hygiene 评估处理方式',
      };
    case GAP_CLASSES.CATALOG_DRIFT:
      return {
        level: RISK_LEVELS.medium,
        reason: '技能启用配置与实际文件状态不一致',
        handoff: '使用 skill-hygiene collection status 检查配置，确认哪些技能应当启用',
      };
    case GAP_CLASSES.PARTIAL_PROJECTION:
      return {
        level: RISK_LEVELS.low,
        reason: '在所选且目录存在的 Agent 中，只有部分技能目录包含此技能',
        handoff: '确认需要使用此技能的 Agent，再使用 skill-hygiene 评估是否补充安装',
      };
    case GAP_CLASSES.AGENT_ONLY:
      return {
        level: RISK_LEVELS.medium,
        reason: 'Agent 目录中存在此技能，但未找到对应的源文件，可能是失效链接或独立副本',
        handoff: '使用 skill-hygiene 检查源文件和链接目标',
      };
    case GAP_CLASSES.SOURCE_ONLY:
      return {
        level: RISK_LEVELS.low,
        reason: '源目录中存在此技能，但所选 Agent 的技能目录中没有对应文件或链接',
        handoff: '确认需要使用此技能的 Agent，再使用 skill-hygiene 评估是否需要安装',
      };
    case GAP_CLASSES.UNKNOWN:
      return {
        level: RISK_LEVELS.low,
        reason: '现有证据不足以确认状态；同名文件或不同内容本身不证明加载冲突',
        handoff: '检查数据采集错误，或使用 skill-debug 收集更多运行信息',
      };
    case GAP_CLASSES.COMPLETE:
    default:
      return {
        level: RISK_LEVELS.none,
        reason: '所选范围内的源目录、Agent 目录和链接检查一致',
        handoff: '查看报告，当前目录和链接检查未发现需要处理的问题',
      };
  }
}
