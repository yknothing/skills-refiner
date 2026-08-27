/**
 * Agent 覆盖配置：读写本机配置、交互向导、非交互逃逸。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import {
  COVERAGE_SCHEMA_VERSION,
  DEFAULT_AGENT_COVERAGE,
  SOURCE_STORE_LOCATION,
  coverageConfigPath,
  panoramaDir,
} from './panorama-constants.mjs';

/** 向导重置口令（交互输入，非常量路径）。 */
const WIZARD_RESET_TOKEN = 'reset';

/**
 * 从 scan topology 键集合推断「新检测到的」Agent 根（相对路径）。
 * @param {Record<string, unknown>} topology skill-scan topology
 * @param {ReadonlyArray<{ id: string, label_zh: string, location: string }>} known
 * @returns {string[]}
 */
export function detectNewAgentLocations(topology, known = DEFAULT_AGENT_COVERAGE) {
  const knownSet = new Set(known.map((item) => item.location));
  const found = [];
  for (const location of Object.keys(topology ?? {})) {
    if (location === SOURCE_STORE_LOCATION) continue;
    if (!location.endsWith('/skills') && !location.includes('/skills')) continue;
    if (knownSet.has(location)) continue;
    if (!found.includes(location)) found.push(location);
  }
  return found.sort();
}

/**
 * 读取已存覆盖配置；丢失或不合法时返回 null。
 * @param {string} home
 * @returns {{ schema_version: string, agents: Array<{ id: string, label_zh: string, location: string }>, updated_at: string } | null}
 */
export function loadCoverageConfig(home) {
  const path = coverageConfigPath(home);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value?.schema_version !== COVERAGE_SCHEMA_VERSION) return null;
    if (!Array.isArray(value.agents) || value.agents.length === 0) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * 持久化覆盖配置到本机（不进 git）。
 * @param {string} home
 * @param {Array<{ id: string, label_zh: string, location: string }>} agents
 * @returns {string} 写入路径
 */
export function saveCoverageConfig(home, agents) {
  const dir = panoramaDir(home);
  mkdirSync(dir, { recursive: true });
  const path = coverageConfigPath(home);
  const payload = {
    schema_version: COVERAGE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    agents,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * 将 topology 中实际发现的 Agent skill 根转换为覆盖项。
 * `.agents/skills` 是权威源目录，不是 Agent 投影根，必须排除。
 *
 * @param {Record<string, unknown>} topology skill-scan topology
 * @returns {Array<{ id: string, label_zh: string, location: string }>}
 */
export function agentsFromTopology(topology) {
  const byLoc = new Map(DEFAULT_AGENT_COVERAGE.map((item) => [item.location, item]));
  return Object.keys(topology ?? {})
    .filter((location) => location !== SOURCE_STORE_LOCATION)
    .filter((location) => location.endsWith('/skills') || location.includes('/skills'))
    .sort()
    .map((location) => {
      if (byLoc.has(location)) return { ...byLoc.get(location) };
      const id = location.replace(/^\./, '').replace(/\/skills$/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
      return { id, label_zh: location, location };
    });
}

/**
 * 解析 --agents 参数：逗号分隔 id（claude,cursor,codex）、location，或 all。
 * @param {string} raw
 * @param {Record<string, unknown>} topology skill-scan topology
 * @returns {Array<{ id: string, label_zh: string, location: string }>}
 */
export function parseAgentsFlag(raw, topology = {}) {
  const tokens = String(raw)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('--agents 不能为空');
  }
  const byId = new Map(DEFAULT_AGENT_COVERAGE.map((item) => [item.id, item]));
  const byLoc = new Map(DEFAULT_AGENT_COVERAGE.map((item) => [item.location, item]));
  const expanded = [];
  for (const token of tokens) {
    if (token === 'all') {
      const discovered = agentsFromTopology(topology);
      if (discovered.length === 0) {
        throw new Error('--agents all 未从 skill-scan topology 检测到任何 Agent 根');
      }
      expanded.push(...discovered);
      continue;
    }
    if (byId.has(token)) {
      expanded.push({ ...byId.get(token) });
      continue;
    }
    if (byLoc.has(token)) {
      expanded.push({ ...byLoc.get(token) });
      continue;
    }
    const id = token.replace(/^\./, '').replace(/\/skills$/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    expanded.push({ id, label_zh: token, location: token.startsWith('.') ? token : `.${token}` });
  }
  return [...new Map(expanded.map((item) => [item.location, item])).values()];
}

/**
 * 仅保留「目录存在」的 Agent 根，用于投影列。
 * @param {string} home
 * @param {Array<{ id: string, label_zh: string, location: string }>} agents
 * @returns {Array<{ id: string, label_zh: string, location: string, present: boolean }>}
 */
export function markAgentPresence(home, agents) {
  return agents.map((agent) => ({
    ...agent,
    present: existsSync(`${home}/${agent.location}`),
  }));
}

/**
 * 判定是否应进入交互向导。
 * @param {{ interactiveAllowed: boolean, forceWizard: boolean, hasConfig: boolean, changeDetected: boolean }} options
 * @returns {boolean}
 */
export function shouldRunWizard(options) {
  if (!options.interactiveAllowed) return false;
  if (options.forceWizard) return true;
  if (!options.hasConfig) return true;
  if (options.changeDetected) return true;
  return false;
}

/**
 * 检测配置变化：新根出现或已选根消失。
 * @param {Array<{ location: string }>} configured
 * @param {string[]} discoveredLocations topology 中的全部 skills 根
 * @param {string} home
 * @returns {{ newRoots: string[], missingSelected: string[] }}
 */
export function detectCoverageChanges(configured, discoveredLocations, home) {
  const configuredLocs = configured.map((item) => item.location);
  const discovered = new Set(discoveredLocations);
  const knownDefaults = new Set(DEFAULT_AGENT_COVERAGE.map((item) => item.location));
  const newRoots = [...discovered]
    .filter((loc) => loc !== SOURCE_STORE_LOCATION)
    .filter((loc) => !configuredLocs.includes(loc))
    .filter((loc) => !knownDefaults.has(loc) || !configuredLocs.includes(loc));
  const missingSelected = configuredLocs.filter((loc) => !existsSync(`${home}/${loc}`));
  return { newRoots, missingSelected };
}

/**
 * 交互向导：默认三件套已勾选；主要展示新根；回车保持。
 * @param {{ home: string, current: Array<{ id: string, label_zh: string, location: string }>, newRoots: string[], missingSelected: string[] }} params
 * @returns {Promise<Array<{ id: string, label_zh: string, location: string }>>}
 */
export async function runCoverageWizard(params) {
  const rl = readline.createInterface({ input, output });
  try {
    output.write('技能全景 — Agent 覆盖向导\n');
    output.write('默认已勾选：Claude Code / Cursor / Codex（目录存在才参与投影列）。\n');
    if (params.missingSelected.length > 0) {
      output.write(`已选但当前不存在的根：${params.missingSelected.join(', ')}\n`);
    }
    if (params.newRoots.length > 0) {
      output.write(`新检测到的根：\n`);
      params.newRoots.forEach((loc, index) => {
        output.write(`  [${index + 1}] ${loc}\n`);
      });
      output.write('输入要追加的编号（逗号分隔），或直接回车保持当前选择：\n');
      const answer = (await rl.question('> ')).trim();
      if (answer.length === 0) return params.current;
      const selected = answer
        .split(',')
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= params.newRoots.length)
        .map((n) => params.newRoots[n - 1]);
      const extras = selected.map((location) => ({
        id: location.replace(/^\./, '').replace(/\/skills$/, '').replace(/[^a-z0-9-]+/gi, '-'),
        label_zh: location,
        location,
      }));
      return mergeAgents(params.current, extras);
    }
    output.write('未发现新根。直接回车保持当前选择，或输入 reset 恢复默认三件套：\n');
    const answer = (await rl.question('> ')).trim();
    if (answer === WIZARD_RESET_TOKEN) {
      return DEFAULT_AGENT_COVERAGE.map((item) => ({ ...item }));
    }
    return params.current;
  } finally {
    rl.close();
  }
}

/**
 * 合并 Agent 列表（按 location 去重）。
 * @param {Array<{ id: string, label_zh: string, location: string }>} base
 * @param {Array<{ id: string, label_zh: string, location: string }>} extras
 */
function mergeAgents(base, extras) {
  const map = new Map();
  for (const item of [...base, ...extras]) {
    map.set(item.location, item);
  }
  return [...map.values()];
}

/**
 * 解析最终覆盖清单（非交互路径）。
 * @param {{ home: string, agentsFlag: string | null, yes: boolean, interactive: boolean }} options
 * @returns {Promise<{ agents: Array<{ id: string, label_zh: string, location: string, present: boolean }>, interactiveConfirmed: boolean, notes: string[] }>}
 */
export async function resolveAgentCoverage(options) {
  const notes = [];
  if (options.agentsFlag) {
    const agents = markAgentPresence(options.home, parseAgentsFlag(options.agentsFlag));
    notes.push('使用命令行 --agents，未做交互确认');
    return { agents, interactiveConfirmed: false, notes };
  }

  const existing = loadCoverageConfig(options.home);
  const defaults = DEFAULT_AGENT_COVERAGE.map((item) => ({ ...item }));

  if (!options.interactive) {
    const base = existing?.agents ?? defaults;
    notes.push('非交互模式：未做交互确认');
    if (!existing) notes.push('缺配置，仅用默认三件套');
    return { agents: markAgentPresence(options.home, base), interactiveConfirmed: false, notes };
  }

  if (options.yes && existing) {
    return { agents: markAgentPresence(options.home, existing.agents), interactiveConfirmed: false, notes: ['使用 --yes，跳过向导'] };
  }

  if (options.yes && !existing) {
    saveCoverageConfig(options.home, defaults);
    notes.push('使用 --yes 且无配置：写入默认三件套，未做交互确认');
    return { agents: markAgentPresence(options.home, defaults), interactiveConfirmed: false, notes };
  }

  // 交互路径：首次/丢失自动；变化短问。拓扑级发现由调用方传入 notes 外的 change 检测在 CLI 完成。
  return {
    agents: markAgentPresence(options.home, existing?.agents ?? defaults),
    interactiveConfirmed: Boolean(existing),
    notes,
    _needsWizard: !existing,
    _existing: existing,
  };
}
