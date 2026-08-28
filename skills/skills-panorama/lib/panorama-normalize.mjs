/**
 * 将 skill-scan + catalog 成员对齐为 ADR 六列原子字段（纯函数，可逆推导缺口）。
 */

import { createHash } from 'node:crypto';

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
    // scanner 已将不可达链接单列为 broken_symlink。只要 symlink
    // 条目带有可达目标证据，它就是健康链接；外部来源不等于损坏。
    // “是否指回某个期望目标”必须由计划/清单提供，不能由路径启发式猜测。
    if (entry.canonical_dir || entry.canonical_skill_file
        || (typeof entry.link_target === 'string' && entry.link_target.length > 0)) {
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
      canonical_target: hit.canonical_dir || hit.entry_path || null,
      content_fingerprint: hit.normalized_content_sha256 ?? null,
      entity_id: hit.normalized_content_sha256
        ? `${hit.name || hit.dir_name}@${hit.normalized_content_sha256}`
        : `${hit.name || hit.dir_name}@path:${hit.canonical_dir || hit.entry_path || 'unknown'}`,
      repository: hit.provenance?.source_url ?? null,
      link_detail: health.detail,
    };
  }
  return projected;
}

function collisionClassification(entries, sourceLocation) {
  const concrete = (entries ?? []).filter((entry) => (entry.entry_kind || entry.type) !== 'broken_symlink');
  const repositories = concrete.map((entry) => entry.provenance?.source_url ?? null);
  const versions = [...new Set(concrete
    .map((entry) => entry.declared_version ?? entry.metadata_version)
    .filter(Boolean))];
  const revisions = [...new Set(concrete
    .map((entry) => entry.provenance?.resolved_revision)
    .filter(Boolean))];
  const locations = new Set(concrete.map((entry) => entry.location).filter(Boolean));
  const everySameRepository = repositories.length > 1
    && repositories.every((value) => typeof value === 'string' && value.length > 0)
    && new Set(repositories).size === 1;
  if (everySameRepository && (versions.length > 1 || revisions.length > 1)) return 'same_source_revision_skew';
  if (everySameRepository) return 'same_source_artifact_mismatch';
  if (versions.length === 1 && concrete.length > 1 && repositories.every((value) => !value)) {
    return 'provider_variant_set_candidate';
  }
  if (!locations.has(sourceLocation) && locations.size > 1) return 'host_isolated_same_name';
  return 'foreign_same_name';
}

function collisionResult(evidence, entries, sourceLocation) {
  return {
    status: COLLISION_STATUS.conflict,
    classification: collisionClassification(entries, sourceLocation),
    default_disposition: 'preserve',
    evidence,
  };
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
 * @param {object[]} entries
 * @param {object[]} approvedMembers
 */
function buildCollision(
  name,
  collisions,
  entries,
  approvedMembers = [],
  sourceLocation = SOURCE_STORE_LOCATION,
  variants = [],
) {
  const hit = (collisions ?? []).find((item) => item.name === name);
  if (hit && variants.length > 1) {
    return collisionResult({
        real_directory_count: hit.real_directory_count ?? null,
        distinct_hashes: hit.distinct_hashes ?? [],
        distinct_versions: hit.distinct_versions ?? [],
      }, entries, sourceLocation);
  }

  // skill-scan 的目录冲突检查不会把健康 symlink 的外部目标算成第二个
  // 实体。全景可直接复用 scanner 已给出的 canonical_dir + 内容指纹，
  // 在不重扫磁盘的前提下补出“不同真实目标且内容不同”的冲突。
  const targetPaths = new Set();
  const targetHashes = new Set();
  for (const entry of entries ?? []) {
    const kind = entry.entry_kind || entry.type;
    const targetPath = kind === 'directory' ? entry.entry_path : entry.canonical_dir;
    if (typeof targetPath === 'string' && targetPath.length > 0) targetPaths.add(targetPath);
    const hash = entry.normalized_content_sha256;
    if (typeof hash === 'string' && hash.length > 0) targetHashes.add(hash);
  }
  if (variants.length > 1 && targetPaths.size > 1) {
    return collisionResult({
        real_directory_count: targetPaths.size,
        distinct_hashes: [...targetHashes].sort(),
        distinct_versions: [...new Set((entries ?? [])
          .map((entry) => entry.declared_version ?? entry.metadata_version)
          .filter(Boolean))].sort(),
        canonical_targets: [...targetPaths].sort(),
      }, entries, sourceLocation);
  }

  const memberPaths = new Set(approvedMembers.map((item) => item.member_path).filter(Boolean));
  const memberDigests = new Set(approvedMembers.map((item) => item.tree_digest).filter(Boolean));
  const allDeclaredTargets = new Set([...targetPaths, ...memberPaths]);
  if (variants.length > 1 && allDeclaredTargets.size > 1) {
    return collisionResult({
        real_directory_count: allDeclaredTargets.size,
        distinct_hashes: [...new Set([...targetHashes, ...memberDigests])].sort(),
        distinct_versions: [],
        canonical_targets: [...allDeclaredTargets].sort(),
      }, entries, sourceLocation);
  }
  return { status: COLLISION_STATUS.none, evidence: null };
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
 * 聚合 scanner 已产出的治理复核信号；只转述，不在 panorama 重新检测。
 * @param {object[]} entries
 */
function buildReviewSignals(entries) {
  const risks = new Map();
  const hygieneFlags = new Set();
  for (const entry of entries ?? []) {
    for (const flag of entry.flags ?? []) hygieneFlags.add(flag);
    for (const risk of entry.risk_indicators ?? []) {
      if (!risk?.id) continue;
      const key = [risk.id, risk.subtype ?? '', risk.canonical_skill_file ?? '', risk.line ?? '', risk.snippet_sha256 ?? ''].join('\0');
      const current = risks.get(key) ?? {
        ...risk,
        id: risk.id,
        severity: risk.severity ?? 'review_required',
        observed_paths: new Set(),
      };
      if (entry.entry_path) current.observed_paths.add(entry.entry_path);
      risks.set(key, current);
    }
  }
  return {
    risk_indicators: [...risks.values()]
      .map((risk) => ({ ...risk, observed_paths: [...risk.observed_paths].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    hygiene_flags: [...hygieneFlags].sort(),
  };
}

function identityDigest(fields) {
  return `sha256:${createHash('sha256').update(JSON.stringify(fields)).digest('hex')}`;
}

function catalogStateForVariant({ member, underCollection, catalogState }) {
  if (member) return CATALOG_ACTIVE_VALUES.active;
  if (underCollection) return CATALOG_ACTIVE_VALUES.inactive;
  if (catalogState?.catalogFileUnreadable) return CATALOG_ACTIVE_VALUES.unknown;
  return CATALOG_ACTIVE_VALUES.absent;
}

function buildIdentityVariants(name, entries, approvedMembers, collectionRoots = [], catalogState = {}) {
  const variants = new Map();
  const memberByPath = new Map((approvedMembers ?? [])
    .filter(({ member_path }) => typeof member_path === 'string')
    .map((member) => [member.member_path, member]));
  const matchedMembers = new Set();
  for (const entry of entries ?? []) {
    const canonicalTarget = entry.canonical_dir || entry.entry_path || null;
    const fingerprint = entry.normalized_content_sha256 ?? null;
    const member = memberByPath.get(canonicalTarget) ?? null;
    if (member) matchedMembers.add(member.member_path);
    const repositoryId = member?.repository_id ?? entry.provenance?.repository_id
      ?? entry.provenance?.source ?? entry.provenance?.source_url ?? null;
    const repositoryUrl = member?.repository_url ?? entry.provenance?.source_url ?? null;
    const revision = member?.resolved_revision ?? entry.provenance?.resolved_revision ?? null;
    const sourcePath = member?.source_path ?? entry.storage_relative_path ?? null;
    const collectionId = member?.collection_id ?? entry.collection_id ?? null;
    const artifactDigest = member?.tree_digest ?? fingerprint;
    const sourceQualified = repositoryId && revision && sourcePath;
    const entityId = identityDigest(sourceQualified ? [
      'source', collectionId, repositoryId, revision, sourcePath, name, artifactDigest,
    ] : [
      'path', collectionId, repositoryId, revision, sourcePath, name, artifactDigest, canonicalTarget,
    ]);
    const key = entityId;
    const underCollection = typeof canonicalTarget === 'string' && collectionRoots.some((root) => (
      canonicalTarget === root || canonicalTarget.startsWith(`${root}/`)
    ));
    const catalogActive = catalogStateForVariant({ member, underCollection, catalogState });
    const current = variants.get(key) ?? {
      entity_id: entityId,
      declared_name: name,
      collection_id: collectionId,
      repository_id: repositoryId,
      repository_url: repositoryUrl,
      resolved_revision: revision,
      source_path: sourcePath,
      canonical_target: canonicalTarget,
      canonical_targets: canonicalTarget ? [canonicalTarget] : [],
      content_fingerprint: fingerprint,
      collection_tree_digest: member?.tree_digest ?? null,
      declared_version: entry.declared_version ?? entry.metadata_version ?? null,
      source_kind: entry.provenance?.kind ?? null,
      qualification: repositoryId && revision && sourcePath ? 'source_qualified' : 'path_qualified',
      catalog_active: catalogActive,
      catalog_conformance: member ? member.present ? 'active_observed' : 'drift_missing'
        : underCollection ? 'inactive_unindexed' : 'unmanaged',
      catalog_members: member ? [member] : [],
      observed_paths: [],
      observed_locations: [],
    };
    if (entry.entry_path && !current.observed_paths.includes(entry.entry_path)) current.observed_paths.push(entry.entry_path);
    if (entry.location && !current.observed_locations.includes(entry.location)) current.observed_locations.push(entry.location);
    if (canonicalTarget && !current.canonical_targets.includes(canonicalTarget)) current.canonical_targets.push(canonicalTarget);
    current.canonical_target = current.canonical_targets.length === 1 ? current.canonical_targets[0] : null;
    variants.set(key, current);
  }
  for (const member of approvedMembers ?? []) {
    if (matchedMembers.has(member.member_path)) continue;
    const entityId = identityDigest([
      member.collection_id, member.repository_id, member.resolved_revision, member.source_path,
      name, member.tree_digest, member.member_path,
    ]);
    if (!variants.has(entityId)) {
      const key = entityId;
      variants.set(key, {
        entity_id: entityId,
        declared_name: name,
        collection_id: member.collection_id ?? null,
        repository_id: member.repository_id ?? null,
        repository_url: member.repository_url ?? null,
        resolved_revision: member.resolved_revision ?? null,
        source_path: member.source_path ?? member.relative_path ?? null,
        canonical_target: member.member_path ?? null,
        canonical_targets: member.member_path ? [member.member_path] : [],
        content_fingerprint: null,
        collection_tree_digest: member.tree_digest ?? null,
        declared_version: null,
        source_kind: 'managed_collection_catalog',
        qualification: member.repository_id && member.resolved_revision ? 'source_qualified' : 'collection_qualified',
        catalog_active: CATALOG_ACTIVE_VALUES.active,
        catalog_conformance: member.present ? 'active_stored' : 'drift_missing',
        catalog_members: [member],
        observed_paths: member.member_path ? [member.member_path] : [],
        observed_locations: [],
      });
    }
  }
  return [...variants.values()]
    .map((variant) => ({
      ...variant,
      observed_paths: [...variant.observed_paths].sort(),
      observed_locations: [...variant.observed_locations].sort(),
      canonical_targets: [...variant.canonical_targets].sort(),
    }))
    .sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id)));
}

/**
 * 规范化单条六列记录。
 * @param {{ name: string, entries: object[] }} group
 * @param {{ agents: Array, sourceLocation: string, collisions: object[], catalogState: object, collectionRoots: string[] }} ctx
 */
export function normalizeSkillRow(group, ctx) {
  const { name, entries } = group;
  const approvedMembers = ctx.approvedMembers?.get(name) ?? [];
  const storedEntries = entries.filter((entry) => isStoredEntry(entry, ctx.sourceLocation));
  const underCollection = entries.some((entry) => {
    const path = entry.canonical_dir || entry.entry_path || '';
    return (ctx.collectionRoots ?? []).some((root) => typeof path === 'string'
      && (path === root || path.startsWith(`${root}/`)));
  });
  const stored = storedEntries.length > 0 || underCollection
    || approvedMembers.some((item) => item.present === true);
  const variants = buildIdentityVariants(name, entries, approvedMembers, ctx.collectionRoots, ctx.catalogState);
  const fingerprints = [...new Set(variants.map((variant) => variant.content_fingerprint).filter(Boolean))];
  const versions = [...new Set(variants.map((variant) => variant.declared_version).filter(Boolean))];
  const repositories = [...new Set(variants.map((variant) => variant.repository_id).filter(Boolean))];
  const identity = {
    name,
    paths: [...new Set(entries.map((entry) => entry.entry_path).filter(Boolean))],
    identity_status: variants.length > 1 ? 'ambiguous_name' : variants[0]?.qualification ?? 'unqualified',
    content_fingerprint: fingerprints.length === 1 ? fingerprints[0] : null,
    declared_version: versions.length === 1 ? versions[0] : null,
    repository_id: repositories.length === 1 ? repositories[0] : null,
    variants,
    catalog_members: approvedMembers,
    review_signals: buildReviewSignals(entries),
  };
  const projected = buildProjected(entries, ctx.agents, ctx.sourceLocation);
  for (const projection of Object.values(projected)) {
    if (!projection.present) continue;
    const variant = variants.find(({ observed_paths }) => observed_paths.includes(projection.path));
    if (variant) {
      projection.entity_id = variant.entity_id;
      projection.repository_id = variant.repository_id;
      projection.resolved_revision = variant.resolved_revision;
    }
  }
  const link_health = aggregateLinkHealth(projected);
  const collision = buildCollision(name, ctx.collisions, entries, approvedMembers, ctx.sourceLocation, variants);
  const variantCatalogStates = new Set(variants.map(({ catalog_active: state }) => state));
  const catalog_active = variantCatalogStates.size === 1
    ? [...variantCatalogStates][0]
    : variantCatalogStates.size > 1
      ? CATALOG_ACTIVE_VALUES.unknown
      : buildCatalogActive(name, ctx.catalogState, underCollection);

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
    const observations = ctx.approvedMembers?.get(name) ?? [];
    const stored = observations.some((item) => item.present === true);
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
        paths: observations.map((item) => item.member_path).filter(Boolean),
        identity_status: 'source_qualified',
        content_fingerprint: null,
        declared_version: null,
        repository_id: [...new Set(observations.map(({ repository_id }) => repository_id).filter(Boolean))].at(0) ?? null,
        variants: buildIdentityVariants(name, [], observations, ctx.collectionRoots, ctx.catalogState),
        catalog_members: observations,
        review_signals: { risk_indicators: [], hygiene_flags: [] },
      },
      stored,
      projected,
      catalog_active: CATALOG_ACTIVE_VALUES.active,
      link_health: {
        status: LINK_HEALTH_VALUES.not_applicable,
        detail: stored
          ? '批准成员位于受管集合内；skill-scan 不展开集合成员投影'
          : '批准成员的声明路径不存在',
      },
      collision: buildCollision(
        name,
        ctx.collisions,
        [],
        observations,
        ctx.sourceLocation,
        buildIdentityVariants(name, [], observations, ctx.collectionRoots, ctx.catalogState),
      ),
    });
  }
  return rows;
}

/**
 * 从收集输入生成全部六列行。
 * @param {{ scan: object, agents: Array, approvedNames: Set<string>, approvedMembers?: Map<string, object[]>, catalog: { present: boolean, catalog: object | null }, collectionRoots?: string[] }} input
 */
export function normalizePanoramaRows(input) {
  const catalogFilePresent = Boolean(input.catalog?.present);
  const catalogFileUnreadable = catalogFilePresent && !input.catalog?.catalog && (input.approvedNames?.size ?? 0) === 0;
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
    approvedMembers: input.approvedMembers instanceof Map ? input.approvedMembers : new Map(),
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
