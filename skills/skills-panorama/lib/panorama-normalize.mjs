/**
 * 将 skill-scan + catalog 成员对齐为 ADR 六列原子字段（纯函数，可逆推导缺口）。
 */

import {
  CATALOG_ACTIVE_VALUES,
  COLLISION_STATUS,
  FORBIDDEN_COLLAPSED_FIELDS,
  LINK_HEALTH_VALUES,
  PREDICATE_KEYS,
  SOURCE_STORE_LOCATION,
} from './panorama-constants.mjs';

/**
 * 断言对象不含禁止塌缩字段。
 * @param {object} value
 */
export function assertNoCollapsedFields(value) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const key of Object.keys(current)) {
      if (FORBIDDEN_COLLAPSED_FIELDS.includes(key)) {
        throw new Error(`禁止字段出现: ${key}`);
      }
      const child = current[key];
      if (child && typeof child === 'object') stack.push(child);
    }
  }
}

/**
 * 从 scan entries 建立按 name 聚合的观察。
 * @param {object} scan
 * @returns {Map<string, { name: string, entries: object[] }>}
 */
export function indexScanByName(scan) {
  const map = new Map();
  const buckets = [
    ...(Array.isArray(scan?.skills) ? scan.skills : []),
    ...(Array.isArray(scan?.skill_links) ? scan.skill_links : []),
    ...(Array.isArray(scan?.broken_symlinks) ? scan.broken_symlinks : []),
  ];
  for (const entry of buckets) {
    const name = entry?.name || entry?.dir_name;
    if (typeof name !== 'string' || name.length === 0) continue;
    if (!map.has(name)) map.set(name, { name, entries: [] });
    map.get(name).entries.push(entry);
  }
  return map;
}

/**
 * 判定某条目是否位于源存储。
 * @param {object} entry
 * @param {string} sourceLocation
 * @returns {boolean}
 */
function isStoredEntry(entry, sourceLocation) {
  if (entry.location !== sourceLocation) return false;
  const kind = entry.entry_kind || entry.type;
  return kind === 'directory';
}

/**
 * 判定投影健康。
 * @param {object} entry
 * @param {string} sourceLocation
 * @returns {{ status: string, detail: string | null }}
 */
function assessLinkHealth(entry, sourceLocation) {
  const kind = entry.entry_kind || entry.type;
  if (kind === 'broken_symlink') {
    return { status: LINK_HEALTH_VALUES.broken, detail: '投影软链目标不可达' };
  }
  if (kind === 'directory') {
    return { status: LINK_HEALTH_VALUES.not_applicable, detail: '实体目录，非软链投影' };
  }
  if (kind === 'symlink') {
    const canonical = entry.canonical_dir || entry.link_target || '';
    if (typeof canonical === 'string' && canonical.includes(sourceLocation.replace(/^\./, ''))) {
      return { status: LINK_HEALTH_VALUES.ok, detail: null };
    }
    if (typeof entry.link_target === 'string' && entry.link_target.length > 0) {
      // 指向可达目标，但未必落在预期源；标 unexpected 供缺口类使用
      if (entry.canonical_dir || entry.canonical_skill_file) {
        return { status: LINK_HEALTH_VALUES.unexpected_target, detail: '投影未指回预期源目录' };
      }
      return { status: LINK_HEALTH_VALUES.ok, detail: null };
    }
    return { status: LINK_HEALTH_VALUES.unknown, detail: '上游未提供足够链接字段' };
  }
  return { status: LINK_HEALTH_VALUES.unknown, detail: '条目类型无法判定' };
}

/**
 * 汇总某 skill 在所选 Agent 上的投影。
 * @param {object[]} entries
 * @param {Array<{ id: string, label_zh: string, location: string, present: boolean }>} agents
 * @param {string} sourceLocation
 */
function buildProjected(entries, agents, sourceLocation) {
  /** @type {Record<string, { present: boolean, entry_kind: string | null, link_health: string, path: string | null }>} */
  const projected = {};
  for (const agent of agents) {
    if (!agent.present) {
      projected[agent.id] = {
        present: false,
        entry_kind: null,
        link_health: LINK_HEALTH_VALUES.not_applicable,
        path: null,
        skipped_reason: 'agent_root_absent',
      };
      continue;
    }
    const hit = entries.find((entry) => entry.location === agent.location);
    if (!hit) {
      projected[agent.id] = {
        present: false,
        entry_kind: null,
        link_health: LINK_HEALTH_VALUES.not_applicable,
        path: null,
      };
      continue;
    }
    const health = assessLinkHealth(hit, sourceLocation);
    projected[agent.id] = {
      present: true,
      entry_kind: hit.entry_kind || hit.type || null,
      link_health: health.status,
      path: hit.entry_path || null,
      link_detail: health.detail,
    };
  }
  return projected;
}

/**
 * 合并 link_health 总览（按最严重投影）。
 * @param {Record<string, { present: boolean, link_health: string }>} projected
 * @returns {{ status: string, detail: string | null }}
 */
function aggregateLinkHealth(projected) {
  const ranks = {
    [LINK_HEALTH_VALUES.broken]: 0,
    [LINK_HEALTH_VALUES.unexpected_target]: 1,
    [LINK_HEALTH_VALUES.unknown]: 2,
    [LINK_HEALTH_VALUES.ok]: 3,
    [LINK_HEALTH_VALUES.not_applicable]: 4,
  };
  let best = { status: LINK_HEALTH_VALUES.not_applicable, detail: null, rank: 99 };
  let anyPresent = false;
  for (const value of Object.values(projected)) {
    if (!value.present) continue;
    anyPresent = true;
    const rank = ranks[value.link_health] ?? 2;
    if (rank < best.rank) {
      best = { status: value.link_health, detail: value.link_detail ?? null, rank };
    }
  }
  if (!anyPresent) return { status: LINK_HEALTH_VALUES.not_applicable, detail: '无投影' };
  return { status: best.status, detail: best.detail };
}

/**
 * 从 scan.name_collisions 映射 collision 列。
 * @param {string} name
 * @param {object[]} collisions
 */
function buildCollision(name, collisions) {
  const hit = (collisions ?? []).find((item) => item.name === name);
  if (!hit) return { status: COLLISION_STATUS.none, evidence: null };
  return {
    status: COLLISION_STATUS.conflict,
    evidence: {
      real_directory_count: hit.real_directory_count ?? null,
      distinct_hashes: hit.distinct_hashes ?? [],
      distinct_versions: hit.distinct_versions ?? [],
    },
  };
}

/**
 * 计算 catalog_active。
 * 无成员级清单 → absent；批准集命中 → active；
 * 落在受管 collection 根但未批准 → inactive；其余个人技能 → absent（不误判漂移）。
 * @param {string} name
 * @param {{ catalogPresent: boolean, approvedNames: Set<string>, catalogReadable: boolean, catalogFileUnreadable: boolean }} catalogState
 * @param {boolean} underCollection
 * @returns {string}
 */
function buildCatalogActive(name, catalogState, underCollection) {
  if (catalogState.catalogFileUnreadable) {
    return CATALOG_ACTIVE_VALUES.unknown;
  }
  if (!catalogState.catalogPresent || catalogState.approvedNames.size === 0) {
    return CATALOG_ACTIVE_VALUES.absent;
  }
  if (catalogState.approvedNames.has(name)) {
    return CATALOG_ACTIVE_VALUES.active;
  }
  if (underCollection) {
    return CATALOG_ACTIVE_VALUES.inactive;
  }
  return CATALOG_ACTIVE_VALUES.absent;
}

/**
 * 规范化单条六列记录。
 * @param {{ name: string, entries: object[] }} group
 * @param {{ agents: Array, sourceLocation: string, collisions: object[], catalogState: object, collectionRoots: string[] }} ctx
 */
export function normalizeSkillRow(group, ctx) {
  const { name, entries } = group;
  const storedEntries = entries.filter((entry) => isStoredEntry(entry, ctx.sourceLocation));
  const underCollection = entries.some((entry) => {
    const path = entry.canonical_dir || entry.entry_path || '';
    return (ctx.collectionRoots ?? []).some((root) => typeof path === 'string' && path.startsWith(root));
  });
  const stored = storedEntries.length > 0 || underCollection;
  const identityEntry = storedEntries[0] || entries[0] || {};
  const identity = {
    name,
    paths: [...new Set(entries.map((entry) => entry.entry_path).filter(Boolean))],
    content_fingerprint: identityEntry.normalized_content_sha256 ?? null,
    declared_version: identityEntry.declared_version ?? identityEntry.metadata_version ?? null,
    repository: identityEntry.provenance?.source_url ?? null,
  };
  const projected = buildProjected(entries, ctx.agents, ctx.sourceLocation);
  const link_health = aggregateLinkHealth(projected);
  const collision = buildCollision(name, ctx.collisions);
  const catalog_active = buildCatalogActive(name, ctx.catalogState, underCollection);

  const row = {
    [PREDICATE_KEYS.identity]: identity,
    [PREDICATE_KEYS.stored]: stored,
    [PREDICATE_KEYS.projected]: projected,
    [PREDICATE_KEYS.catalog_active]: catalog_active,
    [PREDICATE_KEYS.link_health]: link_health,
    [PREDICATE_KEYS.collision]: collision,
  };
  assertNoCollapsedFields(row);
  return row;
}

/**
 * 为「清单批准但磁盘全无」的名字补空行。
 * @param {Set<string>} approvedNames
 * @param {Set<string>} seenNames
 * @param {{ agents: Array }} ctx
 */
export function rowsForMissingApproved(approvedNames, seenNames, ctx) {
  const rows = [];
  for (const name of approvedNames) {
    if (seenNames.has(name)) continue;
    const projected = {};
    for (const agent of ctx.agents) {
      projected[agent.id] = {
        present: false,
        entry_kind: null,
        link_health: LINK_HEALTH_VALUES.not_applicable,
        path: null,
      };
    }
    rows.push({
      identity: {
        name,
        paths: [],
        content_fingerprint: null,
        declared_version: null,
        repository: null,
      },
      stored: false,
      projected,
      catalog_active: CATALOG_ACTIVE_VALUES.active,
      link_health: { status: LINK_HEALTH_VALUES.not_applicable, detail: '批准成员未在扫描中出现' },
      collision: { status: COLLISION_STATUS.none, evidence: null },
    });
  }
  return rows;
}

/**
 * 从收集输入生成全部六列行。
 * @param {{ scan: object, agents: Array, approvedNames: Set<string>, catalog: { present: boolean, catalog: object | null }, collectionRoots?: string[] }} input
 */
export function normalizePanoramaRows(input) {
  const catalogFilePresent = Boolean(input.catalog?.present);
  const catalogFileUnreadable = catalogFilePresent && !input.catalog?.catalog;
  const approvedNames = input.approvedNames instanceof Set ? input.approvedNames : new Set(input.approvedNames ?? []);
  // 有 catalog 文件但批准成员为空，仍视为「未使用成员级控制清单」
  const effectiveCatalogPresent = !catalogFileUnreadable && approvedNames.size > 0;
  const catalogState = {
    catalogPresent: effectiveCatalogPresent,
    catalogReadable: !catalogFileUnreadable,
    catalogFileUnreadable,
    approvedNames,
  };
  const indexed = indexScanByName(input.scan);
  const collisions = input.scan?.name_collisions ?? [];
  const ctx = {
    agents: input.agents,
    sourceLocation: SOURCE_STORE_LOCATION,
    collisions,
    catalogState,
    collectionRoots: input.collectionRoots ?? [],
  };
  const rows = [];
  for (const group of indexed.values()) {
    rows.push(normalizeSkillRow(group, ctx));
  }
  const seen = new Set(rows.map((row) => row.identity.name));
  rows.push(...rowsForMissingApproved(approvedNames, seen, ctx));
  rows.sort((a, b) => a.identity.name.localeCompare(b.identity.name));
  return {
    rows,
    catalog_mode: effectiveCatalogPresent ? 'members' : 'absent',
  };
}
