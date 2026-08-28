import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  RUNTIME_SCHEMAS, collectRuntimeBinding, computeEvidenceId, currentRuntimeAdapterVersion,
  resolveRuntimeAdapterExecutable, runRuntimeExecutable, runtimeEntityId, sha256,
  validateRuntimeEvidence,
} from './runtime-evidence.mjs';

const MAX_OUTPUT = 16 * 1024 * 1024;

class ProbeDecodeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProbeDecodeError';
    this.code = code;
  }
}

function decodeFailure(code, message) {
  throw new ProbeDecodeError(code, message);
}

function failureClassFor(errorCode, stderr = '') {
  if (errorCode === 'ENOENT') return 'not_found';
  if (errorCode === 'EPERM' || errorCode === 'EACCES'
      || /Operation not permitted \(os error 1\)/u.test(stderr)) return 'permission_denied';
  if (errorCode === 'ETIMEDOUT') return 'timeout';
  if (errorCode === 'ENOBUFS') return 'output_limit';
  return 'unknown';
}

function executionResult(result) {
  const errorCode = typeof result?.error?.code === 'string' ? result.error.code : null;
  if (errorCode) {
    return {
      outcome: 'spawn_error', exit_code: null, signal: null,
      failure_class: failureClassFor(errorCode),
    };
  }
  if (Number.isSafeInteger(result?.status) && result.status >= 0 && result.status <= 255) {
    if (result.status === 0) {
      return { outcome: 'exit_zero', exit_code: 0, signal: null, failure_class: 'none' };
    }
    return {
      outcome: 'exit_nonzero', exit_code: result.status, signal: null,
      failure_class: failureClassFor(null, String(result.stderr ?? '')),
    };
  }
  if (typeof result?.signal === 'string' && /^SIG[A-Z0-9]{1,24}$/u.test(result.signal)) {
    return { outcome: 'signaled', exit_code: null, signal: result.signal, failure_class: 'unknown' };
  }
  return { outcome: 'spawn_error', exit_code: null, signal: null, failure_class: 'unknown' };
}

function decodingResult(error, notApplicable = false) {
  if (notApplicable) return { outcome: 'not_applicable', error_code: null };
  return error
    ? { outcome: 'invalid', error_code: error.code ?? 'unknown' }
    : { outcome: 'parsed', error_code: null };
}

export function parseCodexPromptCatalogEntries(stdout) {
  let value;
  try { value = JSON.parse(stdout); } catch { decodeFailure('not_json', 'codex prompt-input output is not JSON'); }
  if (!Array.isArray(value)) decodeFailure('wrong_shape', 'codex prompt-input output must be an array');
  const entries = [];
  const catalogs = value.filter((message) => message?.role === 'developer')
    .flatMap((message) => message?.content ?? []).filter((content) => (
      content?.type === 'input_text' && typeof content.text === 'string'
      && content.text.includes('<skills_instructions>') && content.text.includes('### Available skills')
    ));
  if (catalogs.length !== 1) {
    decodeFailure('catalog_count_mismatch', `expected exactly one Codex skills catalog, observed ${catalogs.length}`);
  }
  for (const content of catalogs) {
    const roots = new Map();
    for (const line of content.text.split(/\r?\n/u)) {
      const root = /^- `([A-Za-z0-9_-]+)` = `([^`]+)`$/u.exec(line);
      if (root && isAbsolute(root[2]) && resolve(root[2]) === root[2]) roots.set(root[1], root[2]);
    }
    let inSkills = false;
    for (const line of content.text.split(/\r?\n/u)) {
      if (line === '### Available skills') { inSkills = true; continue; }
      if (inSkills && line.startsWith('</skills_instructions>')) break;
      if (!inSkills) continue;
      const match = /^- ([A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?):\s+.*\(file:\s+([^\u0000-\u001f]+\/SKILL\.md)\)$/u.exec(line);
      if (!match) continue;
      const [rootId, ...tail] = match[2].split('/');
      let catalogPath = match[2];
      if (!isAbsolute(catalogPath) && roots.has(rootId)
          && tail.length > 0 && !tail.some((part) => part === '' || part === '.' || part === '..')) {
        const candidate = resolve(roots.get(rootId), ...tail);
        if (candidate.startsWith(`${roots.get(rootId)}/`)) catalogPath = candidate;
      }
      if (!isAbsolute(catalogPath) || resolve(catalogPath) !== catalogPath) continue;
      let canonicalPath = null;
      try { if (existsSync(catalogPath)) canonicalPath = realpathSync(catalogPath); } catch {}
      entries.push({ name: match[1], catalog_path: catalogPath, canonical_path: canonicalPath });
    }
  }
  if (entries.length === 0) decodeFailure('catalog_missing', 'Codex skills catalog was not found');
  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.catalog_path.localeCompare(b.catalog_path));
}

export function parseCodexPromptCatalog(stdout) {
  return [...new Set(parseCodexPromptCatalogEntries(stdout).map(({ name }) => name))].sort();
}

export function parseClaudeInitCatalog(stdout) {
  const initEvents = [];
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === 'system' && event?.subtype === 'init') initEvents.push(event);
  }
  if (initEvents.length === 0) decodeFailure('init_missing', 'Claude system.init.skills was not found');
  if (initEvents.length !== 1) {
    decodeFailure('init_count_mismatch', `expected exactly one Claude system.init event, observed ${initEvents.length}`);
  }
  const [init] = initEvents;
  if (!Array.isArray(init.skills)
      || !init.skills.every((name) => typeof name === 'string' && name.length <= 512
        && /^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/u.test(name))
      || new Set(init.skills).size !== init.skills.length
      || typeof init.claude_code_version !== 'string'
      || !/^[0-9]+(?:\.[0-9]+){2}(?:[-+][A-Za-z0-9.-]+)?$/u.test(init.claude_code_version)) {
    decodeFailure('init_invalid', 'Claude system.init.skills is invalid');
  }
  const names = new Set(init.skills);
  return { names: [...names].sort(), runtimeVersion: init.claude_code_version ?? 'unknown' };
}

function contextPressureFromFile(path) {
  if (!path) return 'unverified';
  const text = readFileSync(path, 'utf8');
  return text.includes('Skill descriptions were shortened to fit the skills context budget.') ? true : 'unverified';
}

function resultForCatalog(observedEntries, binding, baseResult = 'pass', { identityCapable = false } = {}) {
  const observedNames = [...new Set(observedEntries.map(({ name }) => name))].sort();
  const observed = new Set(observedNames);
  const expected = new Set(binding.expected_names);
  const universe = new Set(binding.managed_universe);
  const missing = [...expected].filter((name) => !observed.has(name)).sort();
  const underManagedRoot = (entry) => {
    const candidate = entry.canonical_path ?? entry.catalog_path;
    return typeof candidate === 'string' && binding.managed_roots.find(({ collection_root }) => (
      candidate === collection_root || candidate.startsWith(`${collection_root}/`)
    ));
  };
  const canonicalEntity = (entity) => {
    let canonicalPath = entity.skill_file;
    try { canonicalPath = realpathSync(entity.skill_file); } catch {}
    return {
      ...entity,
      canonical_path: canonicalPath,
      entity_id: runtimeEntityId(entity, canonicalPath),
    };
  };
  const expectedEntities = binding.expected_entities.map(canonicalEntity);
  const managedEntities = binding.managed_entities.map(canonicalEntity);
  const managedObserved = observedEntries.filter((entry) => universe.has(entry.name) || underManagedRoot(entry)).map((entry) => {
    const matched = managedEntities.find((entity) => entity.name === entry.name && entity.canonical_path === entry.canonical_path);
    const root = underManagedRoot(entry);
    const unmatchedId = identityCapable && !matched
      ? sha256(JSON.stringify(['unmatched-managed-runtime-entity', entry.name, entry.canonical_path ?? entry.catalog_path, root?.collection_id ?? null]))
      : null;
    return {
      name: entry.name,
      catalog_path: entry.catalog_path ?? null,
      canonical_path: entry.canonical_path ?? null,
      entity_id: matched?.entity_id ?? unmatchedId,
      collection_id: matched?.collection_id ?? root?.collection_id ?? null,
      match_status: matched ? 'matched' : identityCapable ? 'unmatched' : 'name_only',
    };
  });
  const managedObservedNames = new Set(managedObserved.map(({ name }) => name));
  const unexpected = [...managedObservedNames].filter((name) => !expected.has(name)).sort();
  const wrongIdentity = [];
  const missingExpectedEntities = [];
  const expectedEntityIds = new Set(expectedEntities.map(({ entity_id }) => entity_id));
  const observedManagedEntityIds = new Set(managedObserved.map(({ entity_id }) => entity_id).filter(Boolean));
  if (identityCapable) {
    for (const entity of expectedEntities) {
      if (!observedManagedEntityIds.has(entity.entity_id)) {
        missingExpectedEntities.push(entity.entity_id);
        if (observed.has(entity.name)) wrongIdentity.push(entity.name);
      }
    }
  }
  const unexpectedManagedEntities = [...observedManagedEntityIds].filter((id) => !expectedEntityIds.has(id)).sort();
  const unmatchedManagedEntities = managedObserved.filter(({ match_status }) => match_status === 'unmatched')
    .map(({ entity_id }) => entity_id).sort();
  const counts = new Map();
  for (const entity of expectedEntities) counts.set(entity.name, (counts.get(entity.name) ?? 0) + 1);
  const ambiguousExpectedNames = [...counts].filter(([, count]) => count > 1).map(([name]) => name).sort();
  const identityConformance = baseResult !== 'pass' || !identityCapable ? 'unverified'
    : missingExpectedEntities.length === 0 && unexpectedManagedEntities.length === 0
      && unmatchedManagedEntities.length === 0 ? 'pass' : 'fail';
  const policyConformant = baseResult === 'pass' && missing.length === 0 && unexpected.length === 0
    && identityConformance !== 'fail' && (identityCapable || ambiguousExpectedNames.length === 0);
  return {
    probe_outcome: baseResult,
    result: baseResult === 'pass' && missing.length === 0 ? 'pass' : baseResult === 'pass' ? 'fail' : baseResult,
    policy_conformance: baseResult === 'pass' ? policyConformant ? 'pass' : 'fail' : baseResult,
    identity_conformance: identityConformance,
    identity_capability: identityCapable ? 'canonical_path' : baseResult === 'pass' ? 'name_only' : 'none',
    observed_count: observed.size,
    observed_names: observedNames,
    observed_names_digest: sha256(JSON.stringify(observedNames)),
    observed_entities_digest: sha256(JSON.stringify(managedObserved)),
    expected_names: binding.expected_names,
    managed_universe: binding.managed_universe,
    expected_entity_ids: [...expectedEntityIds].sort(),
    expected_present: binding.expected_names.filter((name) => observed.has(name)),
    missing_expected: missing,
    unexpected_managed: unexpected,
    missing_expected_entities: missingExpectedEntities.sort(),
    unexpected_managed_entities: unexpectedManagedEntities,
    unmatched_managed_entities: unmatchedManagedEntities,
    ambiguous_expected_names: ambiguousExpectedNames,
    wrong_identity: [...new Set(wrongIdentity)].sort(),
    observed_managed_entities: managedObserved,
    recursion_observed: 'unverified',
    symlink_following_observed: 'unverified',
    description_truncated: 'unverified',
    context_budget_pressure: 'unverified',
  };
}

function baseEvidence({
  adapter, adapterVersion, runtimeBuild = adapterVersion, commandContract, binding, catalog,
  executableIdentity, raw, authState, sourceKind, limitations, probeResult,
}) {
  const evidence = {
    schema_version: RUNTIME_SCHEMAS.evidence,
    evidence_id: null,
    observed_at: new Date().toISOString(),
    probe: {
      adapter_id: adapter,
      adapter_version: adapterVersion,
      runtime_build: runtimeBuild,
      probe_contract_version: 'skills-refiner.runtime-probe.v2',
      executable_identity: executableIdentity,
      host_environment: { platform: platform(), architecture: arch(), os_release: release(), node_version: process.version },
      command_contract: commandContract,
      session_kind: adapter === 'codex' ? 'native_prompt_render' : adapter === 'claude' ? 'fresh_no_persistence' : 'native_status_only',
      cwd: process.cwd(),
      auth_state: authState,
      sandbox_mode: 'read_only_probe',
    },
    artifact_binding: {
      collections: binding.collections.map((collection) => ({
        collection_id: collection.collection_id,
        operation_id: collection.operation_id,
        resolved_revision: collection.resolved_revision,
        artifact_digest: collection.artifact_digest,
        index_digest: collection.index_digest,
        member_set_digest: collection.member_set_digest,
        root_tree_digest: collection.root_tree_digest,
        root_inventory_digest: collection.root_inventory_digest,
      })),
    },
    deployment_binding: binding.deployment,
    observations: {
      catalog,
      body_access: { result: 'unverified', requested_skill: null, resolved_skill_path: null, normalized_content_sha256: null, complete_read_observed: false },
      route: { result: 'unverified', requested_gateway: null, routed_member: null },
    },
    evidence: {
      source_kind: sourceKind,
      command_argv_redacted: commandContract,
      stdout_sha256: sha256(raw.stdout ?? ''),
      stderr_sha256: sha256(raw.stderr ?? ''),
    },
    probe_result: probeResult,
    limitations,
    effective_predicates: {
      metadata_discoverable: catalog.result,
      policy_conformant: catalog.policy_conformance,
      body_access_observed: false,
      route_observed: false,
      runtime_qualified: false,
    },
  };
  evidence.evidence_id = computeEvidenceId(evidence);
  return validateRuntimeEvidence(evidence);
}

export function probeRuntime({
  home, adapter, policyPath, contextEventsPath = null, runner = spawnSync,
  versionResolver = currentRuntimeAdapterVersion,
  executableResolver = resolveRuntimeAdapterExecutable,
}) {
  const binding = collectRuntimeBinding({ home, adapter, policyPath });
  const executable = executableResolver(adapter);
  const adapterVersion = versionResolver(adapter, executable);
  if (adapter === 'codex') {
    const args = ['debug', 'prompt-input', 'Runtime catalog probe. Do not execute tools.'];
    const result = runRuntimeExecutable(
      executable, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: MAX_OUTPUT }, runner,
    );
    let entries = [];
    let parseError = null;
    try { entries = parseCodexPromptCatalogEntries(result.stdout ?? ''); } catch (error) { parseError = error; }
    const execution = executionResult(result);
    const decoding = decodingResult(parseError);
    const baseResult = execution.outcome === 'exit_zero' && decoding.outcome === 'parsed'
      ? 'pass' : execution.failure_class === 'not_found' ? 'unsupported' : 'blocked';
    const catalog = resultForCatalog(entries, binding, baseResult, { identityCapable: true });
    catalog.recursion_observed = decoding.outcome === 'parsed'
      ? entries.some((entry) => binding.collections.some((collection) => (
        entry.catalog_path?.startsWith(`${join(home, '.agents', 'skills', collection.collection_id)}/`)
      )))
      : 'unverified';
    catalog.context_budget_pressure = contextPressureFromFile(contextEventsPath);
    catalog.description_truncated = catalog.context_budget_pressure === true ? true : 'unverified';
    return baseEvidence({
      adapter, adapterVersion, executableIdentity: executable,
      commandContract: ['codex', ...args], binding, catalog,
      raw: { stdout: result.stdout, stderr: result.stderr }, authState: 'not_required_for_prompt_render', sourceKind: 'native_prompt',
      limitations: ['catalog metadata does not prove body access or instruction compliance'],
      probeResult: { execution, decoding },
    });
  }
  if (adapter === 'claude') {
    const args = ['-p', '--output-format', 'stream-json', '--no-session-persistence', 'Runtime catalog probe. Return exactly ok.'];
    const result = runRuntimeExecutable(
      executable, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: MAX_OUTPUT }, runner,
    );
    let parsed = { names: [], runtimeVersion: 'unobserved' };
    let parseError = null;
    try { parsed = parseClaudeInitCatalog(result.stdout ?? ''); } catch (error) { parseError = error; }
    const hasInit = !parseError;
    const execution = executionResult(result);
    const decoding = decodingResult(parseError);
    const baseResult = hasInit && ['exit_zero', 'exit_nonzero'].includes(execution.outcome)
      ? 'pass' : execution.failure_class === 'not_found' ? 'unsupported' : 'blocked';
    const catalog = resultForCatalog(parsed.names.map((name) => ({ name, catalog_path: null, canonical_path: null })), binding, baseResult);
    const authState = hasInit && execution.outcome === 'exit_zero' ? 'available'
      : hasInit && execution.outcome === 'exit_nonzero' ? 'post_init_nonzero' : 'blocked';
    return baseEvidence({
      adapter, adapterVersion, runtimeBuild: parsed.runtimeVersion, executableIdentity: executable,
      commandContract: ['claude', '-p', '--output-format', 'stream-json', '--no-session-persistence', '<probe>'], binding, catalog,
      raw: { stdout: result.stdout, stderr: result.stderr }, authState, sourceKind: 'native_init',
      limitations: ['system.init proves metadata enumeration only; body access is unverified'],
      probeResult: { execution, decoding },
    });
  }
  const result = runRuntimeExecutable(
    executable, ['status'], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 }, runner,
  );
  const execution = executionResult(result);
  const catalog = resultForCatalog([], binding, execution.failure_class === 'not_found' ? 'unsupported' : 'blocked');
  return baseEvidence({
    adapter, adapterVersion, executableIdentity: executable,
    commandContract: ['cursor-agent', 'status'], binding, catalog,
    raw: { stdout: result.stdout, stderr: result.stderr }, authState: /not logged in/iu.test(`${result.stdout}\n${result.stderr}`) ? 'not_logged_in' : 'blocked', sourceKind: 'native_status',
    limitations: ['Cursor CLI exposes no native catalog command in this build', 'static implementation evidence does not qualify current runtime discovery'],
    probeResult: { execution, decoding: decodingResult(null, true) },
  });
}
