/**
 * 编排现有收集器：skill-scan + catalog/INDEX（只读），禁止第二套磁盘遍历算法。
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  COLLECTION_COLLECTOR,
  SCAN_COLLECTOR,
  SOURCE_STORE_LOCATION,
  catalogPath,
} from './panorama-constants.mjs';

const INDEX_FILE_NAME = COLLECTION_COLLECTOR.indexFileName;
const INDEX_MEMBERS_FIELD = COLLECTION_COLLECTOR.membersField;
const INDEX_MEMBER_NAME_FIELD = COLLECTION_COLLECTOR.memberNameField;

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = join(MODULE_DIR, '..');
const REPO_SKILLS_ROOT = join(SKILL_ROOT, '..');
const MAX_DIAGNOSTIC_LENGTH = 4096;

function boundedDiagnostic(result, fallback) {
  const raw = [result.stderr, result.error?.message]
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?? fallback;
  return String(raw).trim().slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function nonzeroBlocker(collector, result, extra = {}) {
  return {
    collector,
    kind: 'nonzero_exit_with_parseable_json',
    exit_status: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal ?? null,
    diagnostic: boundedDiagnostic(result, `${collector} exited ${result.status ?? 'without status'}`),
    ...extra,
  };
}

/**
 * 解析 skill-hygiene 安装/仓库根。
 * @param {{ home: string, hygieneRoot?: string }} options
 * @returns {string | null}
 */
export function resolveHygieneRoot(options) {
  if (options.hygieneRoot && existsSync(options.hygieneRoot)) {
    return realpathSync(options.hygieneRoot);
  }
  const candidates = [
    join(REPO_SKILLS_ROOT, SCAN_COLLECTOR.hygieneSkillDirName),
    join(options.home, '.agents', 'skills', SCAN_COLLECTOR.hygieneSkillDirName),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, SCAN_COLLECTOR.relativeBinFromHygiene))) {
      return realpathSync(candidate);
    }
  }
  return null;
}

/**
 * 调用 skill-scan.sh --json（可选跳过 provenance tree）。
 * @param {{ home: string, hygieneRoot: string, skipProvenanceTree?: boolean, env?: NodeJS.ProcessEnv }} options
 * @returns {{ ok: boolean, scan: object | null, error: string | null, command: string }}
 */
export function collectSkillScan(options) {
  const script = join(options.hygieneRoot, SCAN_COLLECTOR.relativeBinFromHygiene);
  const args = [script, SCAN_COLLECTOR.jsonFlag];
  if (options.skipProvenanceTree !== false) {
    args.push(SCAN_COLLECTOR.skipProvenanceFlag);
  }
  const result = spawnSync('bash', args, {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}), HOME: options.home },
    maxBuffer: 64 * 1024 * 1024,
  });
  const command = `bash ${args.join(' ')}`;
  try {
    const scan = JSON.parse(result.stdout);
    if (scan?.metadata?.schema_version !== SCAN_COLLECTOR.schemaVersion) {
      const diagnostic = `skill-scan schema 不兼容: ${scan?.metadata?.schema_version ?? 'missing'}`;
      return {
        ok: false,
        complete: false,
        scan: null,
        error: diagnostic,
        blocker: {
          collector: 'skill_scan', kind: 'schema_mismatch', exit_status: result.status ?? null,
          signal: result.signal ?? null, diagnostic,
        },
        exitStatus: result.status,
        command,
      };
    }
    const collectionIndexBlockers = Array.isArray(scan.collection_index_blockers)
      ? scan.collection_index_blockers : [];
    const runtimeLoadBlockers = Array.isArray(scan.runtime_load_blockers)
      ? scan.runtime_load_blockers : [];
    const complete = result.status === 0
      && collectionIndexBlockers.length === 0
      && runtimeLoadBlockers.length === 0;
    const blocker = complete ? null : result.status === 0 ? {
      collector: 'skill_scan',
      kind: 'reported_blocker_with_zero_exit',
      exit_status: 0,
      signal: result.signal ?? null,
      diagnostic: 'skill_scan reported collection INDEX or runtime-load blockers despite a zero exit status',
      reported_blockers: { collection_index: collectionIndexBlockers, runtime_load: runtimeLoadBlockers },
    } : nonzeroBlocker('skill_scan', result, {
      reported_blockers: {
        collection_index: collectionIndexBlockers,
        runtime_load: runtimeLoadBlockers,
      },
    });
    return {
      ok: true,
      complete,
      scan,
      error: null,
      blocker,
      exitStatus: result.status,
      command,
    };
  } catch (error) {
    const diagnostic = boundedDiagnostic(result, `skill-scan JSON 解析失败: ${error.message}`);
    return {
      ok: false,
      complete: false,
      scan: null,
      error: `skill-scan JSON 解析失败: ${error.message}; ${diagnostic}`,
      blocker: {
        collector: 'skill_scan', kind: 'unparseable_output', exit_status: result.status ?? null,
        signal: result.signal ?? null, diagnostic,
      },
      exitStatus: result.status,
      command,
    };
  }
}

/**
 * 调用 skills-refiner collection list --fresh --json（可选；失败不阻断全景）。
 * @param {{ home: string, hygieneRoot: string, nodeBin?: string, env?: NodeJS.ProcessEnv }} options
 * @returns {{ ok: boolean, list: object | null, error: string | null, command: string | null }}
 */
export function collectCollectionList(options) {
  const launcher = join(options.hygieneRoot, COLLECTION_COLLECTOR.relativeLauncherFromHygiene);
  if (!existsSync(launcher)) {
    return {
      ok: false,
      complete: false,
      list: null,
      error: 'skills-refiner launcher 不存在',
      blocker: { collector: 'collection_list', kind: 'launcher_missing', diagnostic: 'skills-refiner launcher 不存在' },
      exitStatus: null,
      command: null,
    };
  }
  const nodeBin = options.nodeBin || process.env.SKILLS_REFINER_NODE_BIN || process.execPath;
  const args = [
    COLLECTION_COLLECTOR.subcommand,
    COLLECTION_COLLECTOR.listCommand,
    COLLECTION_COLLECTOR.freshFlag,
    COLLECTION_COLLECTOR.jsonFlag,
  ];
  const result = spawnSync('bash', [launcher, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env ?? {}),
      HOME: options.home,
      SKILLS_REFINER_NODE_BIN: nodeBin,
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  const command = `SKILLS_REFINER_NODE_BIN=${nodeBin} bash ${launcher} ${args.join(' ')}`;
  try {
    const list = JSON.parse(result.stdout);
    if (list?.schema_version !== COLLECTION_COLLECTOR.listSchema) {
      const diagnostic = `collection list schema 不兼容: ${list?.schema_version ?? 'missing'}`;
      const reportedError = list?.schema_version === 'skills-refiner.collection.error.v1' ? list : null;
      return {
        ok: false,
        complete: false,
        list: null,
        error: diagnostic,
        blocker: {
          collector: 'collection_list', kind: reportedError ? 'reported_error' : 'schema_mismatch',
          exit_status: result.status ?? null, signal: result.signal ?? null,
          diagnostic: reportedError?.diagnostic ?? diagnostic, reported_error: reportedError,
        },
        exitStatus: result.status,
        command,
      };
    }
    const complete = result.status === 0;
    return {
      ok: true,
      complete,
      list,
      error: null,
      blocker: complete ? null : nonzeroBlocker('collection_list', result),
      exitStatus: result.status,
      command,
    };
  } catch (error) {
    const diagnostic = boundedDiagnostic(result, `collection list JSON 解析失败: ${error.message}`);
    return {
      ok: false,
      complete: false,
      list: null,
      error: `collection list JSON 解析失败: ${error.message}; ${diagnostic}`,
      blocker: {
        collector: 'collection_list', kind: 'unparseable_output', exit_status: result.status ?? null,
        signal: result.signal ?? null, diagnostic,
      },
      exitStatus: result.status,
      command,
    };
  }
}

/** Read-only runtime/profile state. Non-zero is a valid drift signal when JSON is parseable. */
export function collectRuntimeState(options) {
  const launcher = join(options.hygieneRoot, COLLECTION_COLLECTOR.relativeLauncherFromHygiene);
  if (!existsSync(launcher)) return {
    ok: false,
    complete: false,
    runtime: null,
    profile: null,
    notes: ['runtime launcher 不存在'],
    blockers: [{ collector: 'runtime_state', kind: 'launcher_missing', diagnostic: 'runtime launcher 不存在' }],
    commands: [],
  };
  const nodeBin = options.nodeBin || process.env.SKILLS_REFINER_NODE_BIN || process.execPath;
  const commands = [];
  const notes = [];
  const invoke = (collector, args, schema, factualExitStatuses) => {
    const result = spawnSync('bash', [launcher, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...(options.env ?? {}), HOME: options.home, SKILLS_REFINER_NODE_BIN: nodeBin },
      maxBuffer: 32 * 1024 * 1024,
    });
    commands.push(`SKILLS_REFINER_NODE_BIN=${nodeBin} bash ${launcher} ${args.join(' ')}`);
    try {
      const value = JSON.parse(result.stdout);
      if (value?.schema_version !== schema) {
        notes.push(`${args.join(' ')} schema 不兼容: ${value?.schema_version ?? 'missing'}`);
        const reportedError = value?.schema_version === 'skills-refiner.runtime-error.v1' ? value : null;
        return {
          value: null,
          complete: false,
          blocker: {
            collector, kind: reportedError ? 'reported_error' : 'schema_mismatch', exit_status: result.status ?? null,
            signal: result.signal ?? null,
            diagnostic: reportedError?.diagnostic ?? `schema 不兼容: ${value?.schema_version ?? 'missing'}`,
            reported_error: reportedError,
          },
        };
      }
      const factualStatus = factualExitStatuses.has(result.status);
      if (result.status === 10) {
        notes.push(`${args.join(' ')} 返回事实状态 10（未达运行时/部署资格），已保留完整可解析事实`);
      } else if (result.status === 3 && factualStatus) {
        notes.push(`${args.join(' ')} 返回事实状态 3（运行时不支持），已保留完整可解析事实`);
      } else if (result.status !== 0) {
        notes.push(`${args.join(' ')} 返回收集失败状态 ${result.status}，已保留可解析事实`);
      }
      return {
        value,
        complete: factualStatus,
        blocker: factualStatus ? null : nonzeroBlocker(collector, result),
      };
    } catch (error) {
      const diagnostic = boundedDiagnostic(result, `${args.join(' ')} 无法解析: ${error.message}`);
      notes.push(`${args.join(' ')} 无法解析: ${error.message}`);
      return {
        value: null,
        complete: false,
        blocker: {
          collector, kind: 'unparseable_output', exit_status: result.status ?? null,
          signal: result.signal ?? null, diagnostic,
        },
      };
    }
  };
  const runtimeResult = invoke(
    'runtime_status',
    ['runtime', 'status', '--json'],
    'skills-refiner.runtime-status.v1',
    new Set([0, 3, 10]),
  );
  const profileResult = invoke(
    'runtime_profile_status',
    ['runtime', 'profile', 'status', '--json'],
    'skills-refiner.runtime-profile.status.v1',
    new Set([0, 10]),
  );
  return {
    ok: runtimeResult.value !== null && profileResult.value !== null,
    complete: runtimeResult.complete && profileResult.complete,
    runtime: runtimeResult.value,
    profile: profileResult.value,
    notes,
    blockers: [runtimeResult.blocker, profileResult.blocker].filter(Boolean),
    commands,
  };
}

/**
 * 只读加载权威 catalog.json（若存在）。
 * @param {string} home
 * @returns {{ present: boolean, catalog: object | null, path: string }}
 */
export function loadCatalogArtifact(home) {
  const path = catalogPath(home);
  if (!existsSync(path)) {
    return { present: false, catalog: null, path, error: null };
  }
  try {
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    if (catalog?.schema_version !== COLLECTION_COLLECTOR.catalogSchema) {
      return {
        present: true,
        catalog: null,
        path,
        error: `catalog schema 不兼容: ${catalog?.schema_version ?? 'missing'}`,
      };
    }
    return { present: true, catalog, path, error: null };
  } catch (error) {
    return { present: true, catalog: null, path, error: `catalog 无法解析: ${error.message}` };
  }
}

/**
 * 从 collection list 与/或权威 catalog.json 声明的 collection_root 读取 INDEX 成员。
 * 只读单文件 INDEX，不遍历 skills 树。
 * @param {object | null} collectionList
 * @param {object | null} catalog
 * @returns {{ approvedNames: Set<string>, approvedMembers: Map<string, object[]>, collectionRoots: string[], notes: string[] }}
 */
export function approvedMembersFromCollectionArtifacts(collectionList, catalog = null) {
  const approvedNames = new Set();
  const approvedMembers = new Map();
  const collectionRoots = [];
  const notes = [];
  const ingestedRoots = new Set();

  /**
   * @param {string | null | undefined} root
   * @param {string} label
   */
  function ingestRoot(root, label) {
    if (typeof root !== 'string' || root.length === 0) return;
    if (ingestedRoots.has(root)) return;
    ingestedRoots.add(root);
    try {
      const stat = lstatSync(root);
      if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(root) !== root) {
        notes.push(`${label} collection_root 不是 canonical real directory`);
        return;
      }
    } catch {
      notes.push(`${label} collection_root 不可用`);
      return;
    }
    if (!collectionRoots.includes(root)) collectionRoots.push(root);
    const indexPath = join(root, INDEX_FILE_NAME);
    if (!existsSync(indexPath)) {
      notes.push(`${label} 缺少 ${INDEX_FILE_NAME}`);
      return;
    }
    try {
      const indexStat = lstatSync(indexPath);
      if (indexStat.isSymbolicLink() || !indexStat.isFile()) {
        notes.push(`${label} ${INDEX_FILE_NAME} 不是 real file`);
        return;
      }
      const index = JSON.parse(readFileSync(indexPath, 'utf8'));
      const acceptedSchemas = new Set([
        COLLECTION_COLLECTOR.indexSchemaV1,
        COLLECTION_COLLECTOR.indexSchemaV2,
      ]);
      if (!acceptedSchemas.has(index?.schema_version)) {
        notes.push(`${label} ${INDEX_FILE_NAME} schema 不兼容: ${index?.schema_version ?? 'missing'}`);
        return;
      }
      const members = Array.isArray(index?.[INDEX_MEMBERS_FIELD])
        ? index[INDEX_MEMBERS_FIELD]
        : [];
      for (const member of members) {
        const memberName = member?.[INDEX_MEMBER_NAME_FIELD];
        const memberRelativePath = member?.relative_path;
        if (typeof memberName !== 'string' || memberName.length === 0) continue;
        if (typeof memberRelativePath !== 'string' || memberRelativePath.length === 0
            || isAbsolute(memberRelativePath) || memberRelativePath.split('/').includes('..')) {
          notes.push(`${label} 成员 ${memberName} 的 relative_path 不安全`);
          continue;
        }
        const memberPath = resolve(root, memberRelativePath);
        const rel = relative(root, memberPath);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          notes.push(`${label} 成员 ${memberName} 越出 collection_root`);
          continue;
        }
        let present = false;
        let absenceReason = null;
        try {
          const memberStat = lstatSync(memberPath);
          const skillStat = lstatSync(join(memberPath, 'SKILL.md'));
          present = !memberStat.isSymbolicLink() && memberStat.isDirectory()
            && !skillStat.isSymbolicLink() && skillStat.isFile();
          if (!present) absenceReason = 'member_or_skill_file_not_real';
        } catch {
          absenceReason = 'declared_member_path_missing';
        }
        const observation = {
          collection_id: index.collection_id ?? label,
          source_provider: index.source?.provider ?? null,
          repository_id: index.source?.repository_id ?? null,
          repository_url: index.source?.source_url ?? null,
          resolved_revision: index.source?.resolved_revision ?? null,
          source_path: memberRelativePath,
          artifact_digest: index.artifact_digest ?? index.source?.tree_digest ?? null,
          operation_id: index.operation_id ?? null,
          index_schema: index.schema_version,
          collection_root: root,
          member_path: memberPath,
          relative_path: memberRelativePath,
          tree_digest: member.tree_digest ?? null,
          present,
          absence_reason: absenceReason,
        };
        approvedNames.add(memberName);
        if (!approvedMembers.has(memberName)) approvedMembers.set(memberName, []);
        approvedMembers.get(memberName).push(observation);
      }
    } catch {
      notes.push(`${label} ${INDEX_FILE_NAME} 无法解析`);
    }
  }

  const collections = collectionList?.collections;
  if (Array.isArray(collections)) {
    for (const entry of collections) {
      ingestRoot(entry?.physical_collection_root, `集合 ${entry.collection_id ?? '?'}`);
    }
  } else {
    notes.push('无 collection list，尝试仅用 catalog.json 声明根');
  }

  const catalogCollections = catalog?.collections;
  if (catalogCollections && typeof catalogCollections === 'object') {
    for (const [id, entry] of Object.entries(catalogCollections)) {
      ingestRoot(entry?.collection_root, `catalog:${id}`);
    }
  }

  return { approvedNames, approvedMembers, collectionRoots, notes };
}

/**
 * 编排入口：只调用现有收集器并读取其声明产物。
 * @param {{ home: string, hygieneRoot?: string, skipProvenanceTree?: boolean, nodeBin?: string }} options
 */
export function collectPanoramaInputs(options) {
  const hygieneRoot = resolveHygieneRoot(options);
  if (!hygieneRoot) {
    return {
      ok: false,
      error: '找不到 skill-hygiene（需要 skill-scan.sh）',
      hygieneRoot: null,
      scan: null,
      collectionList: null,
      catalog: null,
      approvedNames: new Set(),
      approvedMembers: new Map(),
      collectorNotes: [],
      commands: [],
    };
  }
  const scanResult = collectSkillScan({
    home: options.home,
    hygieneRoot,
    skipProvenanceTree: options.skipProvenanceTree,
  });
  const commands = [scanResult.command];
  if (!scanResult.ok) {
    return {
      ok: false,
      error: scanResult.error,
      hygieneRoot,
      scan: null,
      collectionList: null,
      catalog: null,
      approvedNames: new Set(),
      approvedMembers: new Map(),
      collectorNotes: [],
      collectorBlockers: scanResult.blocker ? [scanResult.blocker] : [],
      commands,
    };
  }
  const listResult = collectCollectionList({
    home: options.home,
    hygieneRoot,
    nodeBin: options.nodeBin,
  });
  if (listResult.command) commands.push(listResult.command);
  const runtimeResult = collectRuntimeState({
    home: options.home,
    hygieneRoot,
    nodeBin: options.nodeBin,
  });
  commands.push(...runtimeResult.commands);
  const catalogArtifact = loadCatalogArtifact(options.home);
  const memberInfo = approvedMembersFromCollectionArtifacts(
    listResult.ok ? listResult.list : null,
    catalogArtifact.catalog,
  );
  const collectorNotes = [...memberInfo.notes];
  if (!listResult.ok) {
    collectorNotes.push(`collection list 不可用: ${listResult.error}`);
  } else if (!listResult.complete) {
    collectorNotes.push('collection list 返回非零状态；保留可解析事实并标记 DEGRADED');
  }
  if (catalogArtifact.present && !catalogArtifact.catalog) {
    collectorNotes.push(catalogArtifact.error ?? 'catalog.json 存在但无法解析');
  }
  collectorNotes.push(...runtimeResult.notes);
  const degradedReasons = [];
  if (!scanResult.complete) {
    degradedReasons.push(scanResult.exitStatus === 0 ? 'skill_scan_reported_blockers' : 'skill_scan_nonzero');
  }
  if (!listResult.ok) degradedReasons.push('collection_list_unavailable');
  else if (!listResult.complete) degradedReasons.push('collection_list_nonzero');
  if (!runtimeResult.ok) degradedReasons.push('runtime_state_unavailable');
  else if (!runtimeResult.complete) degradedReasons.push('runtime_state_nonzero');
  if (catalogArtifact.present && !catalogArtifact.catalog) degradedReasons.push('catalog_artifact_invalid');
  const collectorBlockers = [
    scanResult.blocker,
    listResult.blocker,
    ...runtimeResult.blockers,
    catalogArtifact.present && !catalogArtifact.catalog ? {
      collector: 'catalog_artifact', kind: 'invalid_artifact', diagnostic: catalogArtifact.error,
      path: catalogArtifact.path,
    } : null,
  ].filter(Boolean);
  return {
    ok: true,
    error: null,
    hygieneRoot,
    scan: scanResult.scan,
    collectionList: listResult.ok ? listResult.list : null,
    catalog: catalogArtifact,
    approvedNames: memberInfo.approvedNames,
    approvedMembers: memberInfo.approvedMembers,
    collectionRoots: memberInfo.collectionRoots,
    collectorNotes,
    collectorBlockers,
    collectorStatus: degradedReasons.length === 0 ? 'COMPLETE' : 'DEGRADED',
    completeness: degradedReasons.length === 0 ? 'FULL' : 'PARTIAL',
    degradedReasons,
    runtimeStatus: runtimeResult.runtime,
    runtimeProfileStatus: runtimeResult.profile,
    commands,
    sourceStoreLocation: SOURCE_STORE_LOCATION,
  };
}
