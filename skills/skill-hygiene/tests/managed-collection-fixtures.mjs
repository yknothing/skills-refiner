import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { collectionSpec } from '../lib/collection-specs.mjs';

const roots = new Set();

export function makeManagedRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skills-refiner-managed-')));
  roots.add(root);
  return root;
}

export function removeManagedRoot(root) {
  if (!roots.has(root)) throw new Error('refusing to remove unknown fixture root');
  rmSync(root, { recursive: true, force: true });
  roots.delete(root);
}

function write(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function skill(path, name, { folded = false, brokenSourceLink = false } = {}) {
  const description = folded
    ? 'description: >\n  Use when a folded description is required for\n  a managed collection fixture.'
    : `description: Use when testing managed collection member ${name}.`;
  write(join(path, 'SKILL.md'), `---\nname: ${name}\n${description}\n---\n\n# ${name}\n`);
  if (brokenSourceLink) write(join(path, 'references/tdd-for-skills.md'), '[Patterns](../../../docs/patterns/README.md)\n');
}

export function makeManagedSource(root, collectionId) {
  const spec = collectionSpec(collectionId);
  const source = join(root, 'source');
  for (const member of spec.members) {
    skill(join(source, member.sourcePath), member.name, {
      folded: collectionId === 'langcraft' && member.name === 'langcraft',
      brokenSourceLink: collectionId === 'better-skills' && member.name === 'bs-skill-forge',
    });
  }
  for (const rejected of spec.rejectedMembers) {
    write(join(source, rejected.sourcePath, 'SKILL.md'), `---\nname: ${rejected.name}\ndescription: Use when testing a rejected member. Portability: invalid.\n---\n\n# Rejected\n`);
  }
  if (collectionId === 'better-skills') {
    write(join(source, 'docs/patterns/README.md'), '# Patterns\n\n[Research](../research/)\n[Checker](../../tools/check-patterns.sh)\n[Registry](../../skills.json)\n');
    write(join(source, 'docs/research/README.md'), '# Research\n');
    write(join(source, 'tools/check-patterns.sh'), '#!/bin/sh\nexit 0\n');
  }
  if (spec.manifestPath === 'pyproject.toml') write(join(source, spec.manifestPath), '[project]\nname="fixture"\nversion="0.2.1"\n');
  else if (spec.manifestPath === 'skills.json') write(join(source, spec.manifestPath), '{"name":"better-skills","version":"0.2.0-dev"}\n');
  else write(join(source, spec.manifestPath), `# ${collectionId}\n`);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-07-20T00:00:00Z', GIT_COMMITTER_DATE: '2026-07-20T00:00:00Z',
  };
  for (const args of [
    ['init', '-q', source], ['-C', source, 'add', '.'], ['-C', source, 'commit', '-q', '-m', 'fixture'],
    ['-C', source, 'branch', '-M', 'main'], ['-C', source, 'remote', 'add', 'origin', spec.sourceUrl],
  ]) {
    const result = spawnSync('/usr/bin/git', args, { encoding: 'utf8', env });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  return source;
}

export function managedRevision(source) {
  const result = spawnSync('/usr/bin/git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

export function makeManagedHome(root, collectionId = 'better-skills') {
  const spec = collectionSpec(collectionId);
  const home = join(root, 'home');
  const skillsRoot = join(home, '.agents/skills');
  const agentRoots = [join(home, '.claude/skills'), join(home, '.factory/skills')];
  for (const path of [skillsRoot, ...agentRoots]) mkdirSync(path, { recursive: true });
  const activeMembers = spec.members.slice(0, -1);
  const receipts = { unrelated: { source: 'example/other', skillPath: 'skills/unrelated/SKILL.md', installedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } };
  skill(join(skillsRoot, 'unrelated'), 'unrelated');
  for (const member of activeMembers) {
    skill(join(skillsRoot, member.name), member.name);
    receipts[member.name] = {
      source: spec.repositoryId, sourceType: 'github', sourceUrl: spec.sourceUrl,
      skillPath: `${member.sourcePath}/SKILL.md`, skillFolderHash: 'a'.repeat(64),
      installedAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    };
    for (const agentRoot of agentRoots) symlinkSync(`../../.agents/skills/${member.name}`, join(agentRoot, member.name));
  }
  for (const alias of spec.preservedNames.slice(0, 7)) {
    receipts[alias] = {
      source: spec.repositoryId, sourceType: 'github', sourceUrl: spec.sourceUrl,
      skillPath: `skills/${alias}/SKILL.md`, skillFolderHash: 'b'.repeat(40),
      installedAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
    };
    for (const agentRoot of agentRoots) symlinkSync(`../../.agents/skills/${alias}`, join(agentRoot, alias));
  }
  write(join(home, '.agents/.skill-lock.json'), `${JSON.stringify({ version: 3, skills: receipts, lastSelectedAgents: [], dismissed: {} }, null, 2)}\n`);
  return { home, skillsRoot, agentRoots, activeMembers, aliases: spec.preservedNames.slice(0, 7) };
}
