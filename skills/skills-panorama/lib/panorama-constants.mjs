/**
 * 技能全景（skills-panorama）全部稳定常量。
 * 禁止在其它模块散落魔法字符串或路径片段。
 */

import { join } from 'node:path';

/** @type {Readonly<{ schemaVersion: string; productNameZh: string; skillId: string; cliName: string }>} */
export const PANORAMA_IDENTITY = Object.freeze({
  schemaVersion: 'skills-refiner.panorama.v1',
  productNameZh: '已安装 Agent Skills 全景',
  skillId: 'skills-panorama',
  cliName: 'skill-panorama',
});

/** Application Support 下相对 HOME 的路径片段（macOS 约定，与 collection 对齐）。 */
export const APP_SUPPORT_RELATIVE = Object.freeze({
  root: join('Library', 'Application Support', 'skills-refiner'),
  panoramaDir: join('Library', 'Application Support', 'skills-refiner', 'panorama'),
  catalogFile: join('Library', 'Application Support', 'skills-refiner', 'catalog.json'),
  coverageFile: join('Library', 'Application Support', 'skills-refiner', 'panorama', 'agent-coverage.json'),
  triageFile: join('Library', 'Application Support', 'skills-refiner', 'panorama', 'triage-preferences.json'),
  latestJson: 'latest.json',
  latestMd: 'latest.md',
  shareJson: 'share.json',
  shareMd: 'share.md',
});

/** 覆盖配置 schema。 */
export const COVERAGE_SCHEMA_VERSION = 'skills-refiner.panorama.agent-coverage.v1';

/** 默认三件套：对人显示名 → scan topology 相对路径。 */
export const DEFAULT_AGENT_COVERAGE = Object.freeze([
  Object.freeze({ id: 'claude', label_zh: 'Claude Code', location: '.claude/skills' }),
  Object.freeze({ id: 'cursor', label_zh: 'Cursor', location: '.cursor/skills' }),
  Object.freeze({ id: 'codex', label_zh: 'Codex', location: '.codex/skills' }),
]);

/** 全局技能源目录（scan topology 键）。 */
export const SOURCE_STORE_LOCATION = '.agents/skills';

/** 六列原子字段键（JSON 稳定契约）。 */
export const PREDICATE_KEYS = Object.freeze({
  identity: 'identity',
  stored: 'stored',
  projected: 'projected',
  catalog_active: 'catalog_active',
  link_health: 'link_health',
  collision: 'collision',
});

/** 对人显示的六列中文名。 */
export const PREDICATE_LABELS_ZH = Object.freeze({
  identity: '身份',
  stored: '源目录里有没有',
  projected: '在哪个 Agent 里出现',
  catalog_active: '控制清单是否批准启用',
  link_health: '链接是否完好',
  collision: '是否撞名/撞内容',
});

/**
 * 八类缺口（Markdown 主导航唯一允许的中文类名；JSON `gap_class` 存中文）。
 * 稳定英文 id 见 GAP_CLASS_STABLE_IDS（禁止 installed/ready）。
 * @enum {string}
 */
export const GAP_CLASSES = Object.freeze({
  COMPLETE: '齐全',
  SOURCE_ONLY: '仅在源目录',
  AGENT_ONLY: '仅在 Agent',
  BROKEN_LINK: '链接损坏',
  CATALOG_DRIFT: '清单与现实不符',
  NAME_COLLISION: '命名冲突',
  PARTIAL_PROJECTION: '部分 Agent 已出现',
  UNKNOWN: '暂无法判定',
});

/**
 * 缺口类稳定英文 id（代码/契约对照用；对外报告用中文 GAP_CLASSES）。
 * @enum {string}
 */
export const GAP_CLASS_STABLE_IDS = Object.freeze({
  COMPLETE: 'complete',
  SOURCE_ONLY: 'source_only',
  AGENT_ONLY: 'agent_only',
  BROKEN_LINK: 'broken_link',
  CATALOG_DRIFT: 'catalog_drift',
  NAME_COLLISION: 'name_collision',
  PARTIAL_PROJECTION: 'partial_projection',
  UNKNOWN: 'unknown',
});

/**
 * 缺口分类优先级（越靠前越优先归入；冲突/损坏 > 清单不符 > 部分投影 > …）。
 */
export const GAP_CLASS_PRIORITY = Object.freeze([
  GAP_CLASSES.BROKEN_LINK,
  GAP_CLASSES.NAME_COLLISION,
  GAP_CLASSES.CATALOG_DRIFT,
  GAP_CLASSES.PARTIAL_PROJECTION,
  GAP_CLASSES.AGENT_ONLY,
  GAP_CLASSES.SOURCE_ONLY,
  GAP_CLASSES.UNKNOWN,
  GAP_CLASSES.COMPLETE,
]);

/** catalog_active 允许取值（禁止 false/true 塌缩）。 */
export const CATALOG_ACTIVE_VALUES = Object.freeze({
  active: 'active',
  inactive: 'inactive',
  absent: 'absent',
  unknown: 'unknown',
});

/** link_health 允许取值。 */
export const LINK_HEALTH_VALUES = Object.freeze({
  ok: 'ok',
  broken: 'broken',
  unexpected_target: 'unexpected_target',
  not_applicable: 'not_applicable',
  unknown: 'unknown',
});

/** collision 状态。 */
export const COLLISION_STATUS = Object.freeze({
  none: 'none',
  conflict: 'conflict',
  unknown: 'unknown',
});

/** 禁止出现的塌缩字段名。 */
export const FORBIDDEN_COLLAPSED_FIELDS = Object.freeze(['installed', 'ready']);

/** 扫描收集器相关。 */
export const SCAN_COLLECTOR = Object.freeze({
  schemaVersion: 'skill-scan.v5',
  relativeBinFromHygiene: join('bin', 'skill-scan.sh'),
  hygieneSkillDirName: 'skill-hygiene',
  jsonFlag: '--json',
  skipProvenanceFlag: '--skip-provenance-tree',
});

/** collection 收集器相关。 */
export const COLLECTION_COLLECTOR = Object.freeze({
  listSchema: 'skills-refiner.collection.list.v1',
  catalogSchema: 'skills-refiner.collection-catalog.v1',
  indexSchemaV1: 'skills-refiner.collection.index.v1',
  indexSchemaV2: 'skills-refiner.managed-collection.index.v2',
  indexFileName: 'INDEX.json',
  membersField: 'members',
  memberNameField: 'name',
  launcherName: 'skills-refiner',
  relativeLauncherFromHygiene: join('bin', 'skills-refiner'),
  subcommand: 'collection',
  listCommand: 'list',
  freshFlag: '--fresh',
  jsonFlag: '--json',
});

/** 风险等级（决策卡）。 */
export const RISK_LEVELS = Object.freeze({
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
});

/** 退出码。 */
export const EXIT_CODES = Object.freeze({
  ok: 0,
  invalid: 2,
  collectorFailed: 3,
});

/** 脱敏占位。 */
export const REDACTION = Object.freeze({
  homeToken: '~',
  usernameToken: '<user>',
});

/**
 * 解析 panorama 数据根目录。
 * @param {string} home HOME 绝对路径
 * @returns {string}
 */
export function panoramaDir(home) {
  return join(home, APP_SUPPORT_RELATIVE.panoramaDir);
}

/**
 * 解析覆盖配置路径。
 * @param {string} home HOME 绝对路径
 * @returns {string}
 */
export function coverageConfigPath(home) {
  return join(home, APP_SUPPORT_RELATIVE.coverageFile);
}

/**
 * 解析权威 catalog 路径。
 * @param {string} home HOME 绝对路径
 * @returns {string}
 */
export function catalogPath(home) {
  return join(home, APP_SUPPORT_RELATIVE.catalogFile);
}
