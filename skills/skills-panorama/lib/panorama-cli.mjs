/**
 * 技能全景 CLI：编排收集器 → 六列 → 八类缺口 → 写出 latest.*
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin as input } from 'node:process';

import {
  DEFAULT_AGENT_COVERAGE,
  EXIT_CODES,
  PANORAMA_IDENTITY,
} from './panorama-constants.mjs';
import {
  detectCoverageChanges,
  detectNewAgentLocations,
  loadCoverageConfig,
  markAgentPresence,
  parseAgentsFlag,
  runCoverageWizard,
  saveCoverageConfig,
  shouldRunWizard,
} from './panorama-config.mjs';
import { collectPanoramaInputs } from './panorama-collect.mjs';
import { normalizePanoramaRows } from './panorama-normalize.mjs';
import { attachGapClasses } from './panorama-gaps.mjs';
import { buildPanoramaDocument, writePanoramaOutputs } from './panorama-render.mjs';

/**
 * 打印帮助。
 */
function printHelp() {
  const text = `技能全景 (${PANORAMA_IDENTITY.cliName})

只读编排 skill-scan 与 collection/catalog，生成中文全景报告（八类缺口导航）。
不删除、不改软链、不改控制清单。

用法:
  ${PANORAMA_IDENTITY.cliName} [选项]

选项:
  --agents <list>   逗号分隔 Agent id/location，或 all（全部已发现 Agent；零交互）
  --yes             非交互：使用已存配置或默认三件套
  --stdout-only     不落盘，摘要到 stdout（JSON+标记）
  --copy-cwd        额外复制最新报告到 cwd（真名路径；分享请用 --share）
  --share           额外写出脱敏 share.json / share.md
  --json            stdout 打印权威 JSON（仍默认写 latest.*，除非 --stdout-only）
  --skip-provenance-tree  转发给 skill-scan（默认开启）
  --no-skip-provenance-tree  关闭上述加速
  --hygiene-root <path>  显式指定 skill-hygiene 根目录
  --help, -h        显示帮助
`;
  process.stdout.write(text);
}

/**
 * 解析 CLI 参数。
 * @param {string[]} argv
 */
export function parseArgv(argv) {
  const options = {
    agents: null,
    yes: false,
    stdoutOnly: false,
    copyCwd: false,
    share: false,
    jsonStdout: false,
    skipProvenanceTree: true,
    hygieneRoot: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--yes':
        options.yes = true;
        break;
      case '--stdout-only':
        options.stdoutOnly = true;
        break;
      case '--copy-cwd':
        options.copyCwd = true;
        break;
      case '--share':
        options.share = true;
        break;
      case '--json':
        options.jsonStdout = true;
        break;
      case '--skip-provenance-tree':
        options.skipProvenanceTree = true;
        break;
      case '--no-skip-provenance-tree':
        options.skipProvenanceTree = false;
        break;
      case '--agents': {
        index += 1;
        if (index >= argv.length) throw new Error('--agents 需要参数');
        options.agents = argv[index];
        break;
      }
      case '--hygiene-root': {
        index += 1;
        if (index >= argv.length) throw new Error('--hygiene-root 需要参数');
        options.hygieneRoot = resolve(argv[index]);
        break;
      }
      default:
        throw new Error(`未知参数: ${token}`);
    }
  }
  return options;
}

/**
 * 解析最终 Agent 覆盖（含可选向导）。
 * @param {{ home: string, options: object, topology: object }} params
 */
async function resolveCoverageWithWizard(params) {
  const { home, options, topology } = params;
  const notes = [];
  const isTty = Boolean(input.isTTY);
  const interactiveAllowed = isTty && !options.yes && !options.agents;

  if (options.agents) {
    const agents = markAgentPresence(home, parseAgentsFlag(options.agents, topology));
    notes.push('使用命令行 --agents，未做交互确认');
    return { agents, interactiveConfirmed: false, notes };
  }

  let current = loadCoverageConfig(home)?.agents ?? DEFAULT_AGENT_COVERAGE.map((item) => ({ ...item }));
  const discovered = Object.keys(topology ?? {});
  const { newRoots, missingSelected } = detectCoverageChanges(current, discovered, home);
  const changeDetected = newRoots.length > 0 || missingSelected.length > 0;
  const hasConfig = Boolean(loadCoverageConfig(home));

  if (shouldRunWizard({
    interactiveAllowed,
    forceWizard: false,
    hasConfig,
    changeDetected: hasConfig && changeDetected,
  }) || (interactiveAllowed && !hasConfig)) {
    const wizardCurrent = hasConfig ? current : DEFAULT_AGENT_COVERAGE.map((item) => ({ ...item }));
    const extras = detectNewAgentLocations(topology);
    const chosen = await runCoverageWizard({
      home,
      current: wizardCurrent,
      newRoots: extras.length > 0 ? extras : newRoots,
      missingSelected,
    });
    saveCoverageConfig(home, chosen);
    return {
      agents: markAgentPresence(home, chosen),
      interactiveConfirmed: true,
      notes: ['已通过交互向导确认 Agent 覆盖'],
    };
  }

  if (!hasConfig) {
    saveCoverageConfig(home, current);
    notes.push('缺配置：写入默认三件套');
  }
  if (!interactiveAllowed) {
    notes.push('非交互或 --yes：未做交互确认');
  }
  if (changeDetected && !interactiveAllowed) {
    notes.push(`检测到覆盖变化但未交互：新根=${newRoots.join('|') || '无'}; 缺失=${missingSelected.join('|') || '无'}`);
  }

  return {
    agents: markAgentPresence(home, current),
    interactiveConfirmed: false,
    notes,
  };
}

/**
 * CLI 主流程。
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function runPanoramaCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgv(argv);
  } catch (error) {
    process.stderr.write(`[ERROR] ${error.message}\n`);
    return EXIT_CODES.invalid;
  }
  if (options.help) {
    printHelp();
    return EXIT_CODES.ok;
  }

  const home = resolve(process.env.HOME ?? '');
  if (!home || !existsSync(home)) {
    process.stderr.write('[ERROR] HOME 无效\n');
    return EXIT_CODES.invalid;
  }

  const collected = collectPanoramaInputs({
    home,
    hygieneRoot: options.hygieneRoot ?? undefined,
    skipProvenanceTree: options.skipProvenanceTree,
  });
  if (!collected.ok) {
    process.stderr.write(`[ERROR] ${collected.error}\n`);
    return EXIT_CODES.collectorFailed;
  }

  const coverage = await resolveCoverageWithWizard({
    home,
    options,
    topology: collected.scan.topology ?? {},
  });

  const normalized = normalizePanoramaRows({
    scan: collected.scan,
    agents: coverage.agents,
    approvedNames: collected.approvedNames,
    approvedMembers: collected.approvedMembers,
    catalog: collected.catalog,
    collectionRoots: collected.collectionRoots ?? [],
  });
  const rows = attachGapClasses(normalized.rows, { catalogMode: normalized.catalog_mode });
  const doc = buildPanoramaDocument({
    rows,
    agents: coverage.agents,
    catalogMode: normalized.catalog_mode,
    interactiveConfirmed: coverage.interactiveConfirmed,
    notes: [...coverage.notes, ...collected.collectorNotes],
    commands: collected.commands,
    collectorNotes: collected.collectorNotes,
    collectorStatus: collected.collectorStatus,
    completeness: collected.completeness,
    degradedReasons: collected.degradedReasons,
    collectorBlockers: collected.collectorBlockers,
    managedCollections: collected.collectionList?.collections ?? [],
    runtimeStatus: collected.runtimeStatus,
    runtimeProfileStatus: collected.runtimeProfileStatus,
  });

  let written;
  try {
    written = writePanoramaOutputs({
      home,
      doc,
      stdoutOnly: options.stdoutOnly,
      copyToCwd: options.copyCwd,
      share: options.share,
    });
  } catch (error) {
    process.stderr.write(`[ERROR] 无法安全写入 panorama 输出: ${error.message}\n`);
    return EXIT_CODES.invalid;
  }

  if (options.stdoutOnly) {
    process.stdout.write(`${JSON.stringify(written.stdout.json, null, 2)}\n`);
  } else if (options.jsonStdout) {
    process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
  } else {
    process.stdout.write(`技能全景已写入:\n`);
    process.stdout.write(`  JSON: ${written.jsonPath}\n`);
    process.stdout.write(`  Markdown: ${written.mdPath}\n`);
    if (written.shareJsonPath) {
      process.stdout.write(`  可分享(脱敏): ${written.shareJsonPath}\n`);
      process.stdout.write(`  可分享 Markdown: ${written.shareMdPath}\n`);
    }
    process.stdout.write(`条目 ${doc.summary.total}；齐全 ${doc.summary.gap_counts['齐全']}；缺口见报告。\n`);
  }
  if (collected.collectorStatus !== 'COMPLETE') {
    process.stderr.write(`[DEGRADED] 收集器不完整: ${collected.degradedReasons.join(', ')}\n`);
    return EXIT_CODES.collectorFailed;
  }
  return EXIT_CODES.ok;
}

import { pathToFileURL } from 'node:url';

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  // Do not force process.exit() after writing a potentially large panorama.
  // stdout may be a pipe and process.stdout.write() is asynchronous there;
  // natural event-loop shutdown is what guarantees the complete JSON reaches
  // the consumer before the requested exit status is observed.
  runPanoramaCli().then((code) => {
    process.exitCode = code;
  });
}
