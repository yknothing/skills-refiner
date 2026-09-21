#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SUPPORTED_VERSION = '0.86.0';
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

// Use Pi's resolver as well as its loader. loadSkillsFromDir alone does not
// reproduce discovery of ordinary Markdown in shared .agents grouping folders.
export async function inspectPiSkills({ packageRoot, settingsPath }) {
  const root = realpathSync(packageRoot);
  const manifestBytes = readFileSync(join(root, 'package.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.name !== '@earendil-works/pi-coding-agent' || manifest.version !== SUPPORTED_VERSION) {
    fail('unsupported_pi_version', `This probe requires @earendil-works/pi-coding-agent@${SUPPORTED_VERSION}`);
  }
  const load = (file) => import(pathToFileURL(join(root, 'dist', file)).href);
  const [{ getAgentDir }, { DefaultPackageManager }, { SettingsManager }, native] = await Promise.all([
    load('config.js'), load('core/package-manager.js'), load('core/settings-manager.js'), load('core/skills.js'),
  ]);
  const agentDir = getAgentDir();
  const configPath = settingsPath ? resolve(settingsPath) : join(agentDir, 'settings.json');
  let configBytes;
  try { configBytes = readFileSync(configPath); } catch (error) {
    if (settingsPath || error.code !== 'ENOENT') throw error;
    configBytes = null;
  }
  const settings = configBytes ? JSON.parse(configBytes.toString('utf8').replace(/^\uFEFF/u, '')) : {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
      || (settings.skills !== undefined && (!Array.isArray(settings.skills)
        || !settings.skills.every((entry) => typeof entry === 'string' && entry.length > 0)))) {
    fail('invalid_settings', 'Pi settings must be an object with an optional string[] skills field');
  }
  // Package resolution may install or update packages. Do not run it, or quietly
  // omit those resources and report an apparently complete user catalog.
  if (settings.packages !== undefined && (!Array.isArray(settings.packages) || settings.packages.length > 0)) {
    fail('packages_not_supported', 'Configured Pi packages require a separate native session probe');
  }
  const manager = new DefaultPackageManager({
    cwd: process.cwd(), agentDir,
    settingsManager: SettingsManager.inMemory({ skills: settings.skills ?? [] }, { projectTrusted: false }),
  });
  const resolved = await manager.resolve();
  const enabled = resolved.skills.filter((entry) => entry.enabled);
  const loaded = native.loadSkills({
    cwd: process.cwd(), agentDir, includeDefaults: false,
    skillPaths: enabled.map((entry) => entry.path),
  });
  return {
    schema_version: 'skills-refiner.pi-skill-catalog.v1',
    status: 'CATALOG_ONLY',
    scope: 'user_auto_and_configured_skills',
    observed_at: new Date().toISOString(),
    runtime: {
      package_root: root, version: manifest.version, package_manifest_digest: digest(manifestBytes),
      node_version: process.version,
    },
    settings: { path: configPath, digest: configBytes ? digest(configBytes) : null, agent_dir: agentDir },
    skills: loaded.skills.map((skill) => ({
      name: skill.name, path: skill.filePath, canonical_path: realpathSync(skill.filePath),
      content_digest: digest(readFileSync(skill.filePath)),
      description_length: skill.description.length,
      entry_file: basename(skill.filePath) === 'SKILL.md',
      model_visible: !skill.disableModelInvocation,
    })),
    diagnostics: loaded.diagnostics,
    disabled_paths: resolved.skills.filter((entry) => !entry.enabled).map((entry) => entry.path),
    runtime_qualified: false,
    limitations: [
      'User auto-discovery and configured local skill paths only; project and CLI resources are excluded.',
      'The native resolver and loader ran; no extension, model, or skill workflow was executed.',
      'Catalog metadata does not establish body access, routing, or instruction compliance.',
      'Ordinary Markdown entries and validation warnings are observations, not automatic retirement verdicts.',
    ],
  };
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node pi-skill-catalog.mjs --pi-package DIR [--settings FILE] [--json]\n'
      + 'Read-only Pi 0.86.0 user skill discovery. Exit 0 means collection succeeded, not runtime qualification.\n'
      + 'Configured packages are unsupported (exit 3); other failures exit 2. No files are written.\n');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!['--pi-package', '--settings', '--json'].includes(key) || Object.hasOwn(options, key)) {
      fail('invalid_invocation', `Unsupported or duplicate option: ${key}`);
    }
    if (key === '--json') { options[key] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) fail('invalid_invocation', `Missing value for ${key}`);
    options[key] = value;
  }
  if (!options['--pi-package']) fail('invalid_invocation', '--pi-package is required');
  const result = await inspectPiSkills({ packageRoot: options['--pi-package'], settingsPath: options['--settings'] });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stdout.write(`${JSON.stringify({
      schema_version: 'skills-refiner.pi-skill-catalog.error.v1',
      status: ['unsupported_pi_version', 'packages_not_supported'].includes(error.code) ? 'UNSUPPORTED' : 'ERROR',
      error_code: error.code ?? 'probe_failed', mutation_occurred: false,
    })}\n`);
    process.exitCode = ['unsupported_pi_version', 'packages_not_supported'].includes(error.code) ? 3 : 2;
  });
}
