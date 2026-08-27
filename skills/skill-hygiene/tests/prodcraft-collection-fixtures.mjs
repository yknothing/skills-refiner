import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { LEGACY_ONLY_NAMES, PUBLIC_MEMBER_NAMES } from '../lib/prodcraft-collection.mjs';

const roots = new Set();

export function makeRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skills-refiner-prodcraft-')));
  roots.add(root);
  return root;
}

export function removeRoot(root) {
  if (!roots.has(root)) throw new Error('refusing to remove unknown fixture root');
  // Newer Git may finish an auto-maintenance bookkeeping write immediately
  // after the spawning command returns. Let recursive removal retry the narrow
  // ENOTEMPTY race instead of turning a passing contract test flaky.
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  roots.delete(root);
}

function skill(directory, name) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\n\n# ${name}\n`);
}

export function makeSource(root) {
  const source = join(root, 'source');
  const curated = join(source, 'skills/.curated');
  mkdirSync(curated, { recursive: true });
  const publicSkills = PUBLIC_MEMBER_NAMES.map((name) => ({
    name,
    source: name === 'pc-prodcraft' ? 'generated:prodcraft' : `skills/source/${name}`,
    stability: 'beta',
    readiness: 'beta',
    manual_allowlist: true,
  }));
  const curatedSkills = publicSkills.map((entry) => ({
    ...entry,
    portability: 'portable_with_caveat',
    public_caveat_text: 'Fixture caveat.',
  }));
  mkdirSync(join(source, 'schemas/distribution'), { recursive: true });
  writeFileSync(join(source, 'schemas/distribution/public-skill-registry.json'), `${JSON.stringify({ schema_version: 'public-skill-registry.v1', public_skills: publicSkills }, null, 2)}\n`);
  writeFileSync(join(curated, 'index.json'), `${JSON.stringify({ schema_version: 'prodcraft-curated-index.v1', skills: curatedSkills }, null, 2)}\n`);
  for (const name of PUBLIC_MEMBER_NAMES) skill(join(curated, name), name);
  mkdirSync(join(source, 'workflows'), { recursive: true });
  writeFileSync(join(source, 'skills/_gateway.md'), '# Gateway\n');
  writeFileSync(join(source, 'CLAUDE.md'), '# Prodcraft\n');
  writeFileSync(join(source, 'manifest.yml'), 'name: prodcraft\nversion: 1.0.0\n');
  const environment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-07-20T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-07-20T00:00:00Z',
  };
  for (const args of [
    ['init', '-q', source],
    ['-C', source, 'add', '.'],
    ['-C', source, 'commit', '-q', '-m', 'fixture'],
    ['-C', source, 'branch', '-M', 'main'],
    ['-C', source, 'remote', 'add', 'origin', 'https://github.com/yknothing/prodcraft.git'],
  ]) {
    const result = spawnSync('/usr/bin/git', args, { encoding: 'utf8', env: environment });
    if (result.status !== 0) throw new Error(`fixture git failed: ${result.stderr}`);
  }
  return source;
}

export function sourceRevision(source) {
  const result = spawnSync('/usr/bin/git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

export function makeLegacyHome(root) {
  const home = join(root, 'home');
  const skillsRoot = join(home, '.agents/skills');
  const agentRoots = [join(home, '.claude/skills'), join(home, '.factory/skills')];
  mkdirSync(skillsRoot, { recursive: true });
  for (const agentRoot of agentRoots) mkdirSync(agentRoot, { recursive: true });

  const matched = PUBLIC_MEMBER_NAMES.filter((name) => name !== 'pc-requirements-engineering').map((name) => name.slice(3));
  const legacyNames = [...matched, ...LEGACY_ONLY_NAMES].sort();
  const receiptSkills = {
    unrelated: { source: 'example/other', skillPath: 'skills/unrelated/SKILL.md', installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  };
  skill(join(skillsRoot, 'unrelated'), 'unrelated');
  for (const name of legacyNames) {
    skill(join(skillsRoot, name), name);
    receiptSkills[name] = {
      source: 'yknothing/prodcraft',
      sourceType: 'github',
      sourceUrl: 'https://github.com/yknothing/prodcraft.git',
      skillPath: `skills/.curated/${name}/SKILL.md`,
      skillFolderHash: 'a'.repeat(40),
      installedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    };
    for (const agentRoot of agentRoots) symlinkSync(`../../.agents/skills/${name}`, join(agentRoot, name));
  }
  writeFileSync(join(home, '.agents/.skill-lock.json'), `${JSON.stringify({ version: 3, skills: receiptSkills, dismissed: {}, lastSelectedAgents: [] }, null, 2)}\n`);
  return { home, skillsRoot, agentRoots, legacyNames };
}
