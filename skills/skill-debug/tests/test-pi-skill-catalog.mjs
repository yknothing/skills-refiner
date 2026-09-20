import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pi-skill-catalog.mjs');
const PI_PACKAGE = process.env.SKILLS_REFINER_PI_PACKAGE;

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skills-refiner-pi-')));
  t.after(() => {
    assert.ok(root.startsWith(`${realpathSync(tmpdir())}/skills-refiner-pi-`));
    rmSync(root, { recursive: true });
  });
  const put = (path, content) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  };
  const skill = (name, description = 'Use for a fixture task.') => `---\nname: ${name}\ndescription: ${description}\n---\n`;
  put('.agents/skills/better-skills/bs-example/SKILL.md', `${skill('bs-example')}Read ../docs/patterns/proposed.md\n`);
  put('.agents/skills/better-skills/docs/patterns/proposed.md', `${skill('proposed-pattern')}Reference material.\n`);
  put('.agents/skills/better-skills/docs/patterns/_template.md', skill('<kebab-case-slug>'));
  put('.agents/skills/shared-only/SKILL.md', skill('shared-only'));
  put('.agents/skills/impeccable/SKILL.md', `${skill('impeccable')}Shared host variant.\n`);
  put('.pi/agent/skills/impeccable/SKILL.md', `${skill('impeccable')}Pi host variant.\n`);
  put('.pi/agent/skills/loose.md', skill('intentional-loose-skill'));
  put('.pi/skills/project-only/SKILL.md', skill('project-only'));
  put('.pi/agent/extensions/do-not-run.js', 'throw new Error("Extensions must not execute during catalog collection");');
  symlinkSync(join(root, '.agents/skills/shared-only'), join(root, '.pi/agent/skills/shared-alias'));
  const config = put('.pi/agent/settings.json', '{}\n');
  const run = (args = []) => {
    const result = spawnSync(process.execPath, [SCRIPT, '--pi-package', PI_PACKAGE, ...args], {
      cwd: root, encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: join(root, '.pi/agent') },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, '');
    return { code: result.status, value: JSON.parse(result.stdout) };
  };
  return { root, put, skill, config, run };
}

function snapshot(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? snapshot(path) : entry.isSymbolicLink() ? [[path, realpathSync(path)]]
      : [[path, readFileSync(path).toString('base64')]];
  });
}

test('native Pi integration requires an explicit installed package (never a mocked loader)', () => {
  assert.ok(PI_PACKAGE, 'Set SKILLS_REFINER_PI_PACKAGE to the installed @earendil-works/pi-coding-agent@0.86.0 directory');
});

test('host exclusions remove reference documents and the shadowed variant while preserving real skills', { skip: !PI_PACKAGE }, (t) => {
  const f = fixture(t);
  const beforeFiles = snapshot(f.root);
  const before = f.run();
  assert.equal(before.code, 0);
  assert.equal(before.value.status, 'CATALOG_ONLY');
  assert.equal(before.value.runtime_qualified, false);
  assert.ok(before.value.skills.some((entry) => entry.name === '<kebab-case-slug>'));
  assert.ok(before.value.skills.some((entry) => entry.name === 'proposed-pattern'));
  assert.equal(before.value.diagnostics.length, 2);
  assert.equal(before.value.skills.filter((entry) => entry.name === 'shared-only').length, 1);
  assert.ok(!before.value.skills.some((entry) => entry.name === 'project-only'));
  assert.deepEqual(snapshot(f.root), beforeFiles, 'native observation must not modify the fixture');

  const rules = [
    `!${f.root}/.agents/skills/better-skills/docs/**`,
    `-${f.root}/.agents/skills/impeccable/SKILL.md`,
  ];
  const candidate = f.put('candidate.json', JSON.stringify({ skills: rules }));
  const candidateFiles = snapshot(f.root);
  const after = f.run(['--settings', candidate]);
  assert.equal(after.code, 0);
  assert.deepEqual(after.value.diagnostics, []);
  assert.deepEqual(after.value.skills, before.value.skills.filter((entry) => !entry.path.includes('/better-skills/docs/')));
  assert.ok(after.value.skills.some((entry) => entry.name === 'intentional-loose-skill'), 'ordinary Markdown can be an intentional Pi skill');
  assert.equal(after.value.skills.find((entry) => entry.name === 'impeccable').path, `${f.root}/.pi/agent/skills/impeccable/SKILL.md`);
  assert.ok(after.value.disabled_paths.includes(`${f.root}/.agents/skills/impeccable/SKILL.md`));
  assert.deepEqual(snapshot(f.root), candidateFiles, 'candidate validation must be read-only');
  assert.match(readFileSync(`${f.root}/.agents/skills/better-skills/docs/patterns/proposed.md`, 'utf8'), /Reference material/);

  writeFileSync(f.config, readFileSync(candidate));
  assert.deepEqual(f.run().value.skills, after.value.skills, 'the actual settings path must yield the same catalog');
});

test('native Pi warnings do not masquerade as skipped skills or body-access evidence', { skip: !PI_PACKAGE }, (t) => {
  const f = fixture(t);
  f.put('.agents/skills/long-description/SKILL.md', f.skill('long-description', 'x'.repeat(1025)));
  const result = f.run();
  assert.equal(result.code, 0);
  assert.equal(result.value.skills.find((entry) => entry.name === 'long-description').description_length, 1025);
  assert.ok(result.value.diagnostics.some((entry) => entry.message.includes('description exceeds 1024')));
  assert.equal(result.value.runtime_qualified, false);
});

test('candidate settings preserve the actual user agent directory as the relative path base', { skip: !PI_PACKAGE }, (t) => {
  const f = fixture(t);
  const local = f.put('.pi/agent/extra/explicit.md', f.skill('explicit-local'));
  const candidate = f.put('elsewhere/candidate.json', JSON.stringify({ skills: ['extra/explicit.md'] }));
  const result = f.run(['--settings', candidate]);
  assert.equal(result.code, 0);
  assert.equal(result.value.skills.find((entry) => entry.name === 'explicit-local').path, local);
});

test('missing, malformed, or package-bearing settings fail without running installation', { skip: !PI_PACKAGE }, (t) => {
  const f = fixture(t);
  assert.equal(f.run(['--settings', join(f.root, 'missing.json')]).code, 2);
  for (const content of ['{', 'null', '[]', '{"skills":"wrong"}']) {
    writeFileSync(f.config, content);
    const before = snapshot(f.root);
    assert.equal(f.run().code, 2);
    assert.deepEqual(snapshot(f.root), before);
  }
  writeFileSync(f.config, '{"packages":["npm:must-not-install"]}');
  const before = snapshot(f.root);
  const result = f.run();
  assert.equal(result.code, 3);
  assert.equal(result.value.error_code, 'packages_not_supported');
  assert.deepEqual(snapshot(f.root), before);
});

test('unsupported versions and invalid options never become successful empty catalogs', { skip: !PI_PACKAGE }, (t) => {
  const f = fixture(t);
  const unsupported = f.put('unsupported/package.json', '{"name":"@earendil-works/pi-coding-agent","version":"0.0.0"}');
  const result = spawnSync(process.execPath, [SCRIPT, '--pi-package', dirname(unsupported)], { encoding: 'utf8' });
  assert.equal(result.status, 3);
  assert.equal(JSON.parse(result.stdout).error_code, 'unsupported_pi_version');
  assert.equal(f.run(['--unknown']).code, 2);
  assert.equal(f.run(['--json', '--json']).code, 2);
  const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /not runtime qualification/);
});
