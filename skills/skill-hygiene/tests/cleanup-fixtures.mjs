import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sandboxRoots = new Set();

export function makeSandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skills-refiner-cleanup-')));
  sandboxRoots.add(root);
  return root;
}

export function removeSandbox(root) {
  if (typeof root !== 'string' || !sandboxRoots.has(root)) {
    throw new Error('refusing to remove an unverified cleanup sandbox');
  }
  rmSync(root, { recursive: true, force: true });
  sandboxRoots.delete(root);
}

export function onlyTransactionId(plan) {
  if (!plan || !Array.isArray(plan.items) || plan.items.length !== 1) {
    throw new Error('expected exactly one transaction item');
  }
  return plan.items[0].transaction_id;
}

export function writeSkill(directory, name = 'demo-skill') {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Use when exercising cleanup fixtures.\n---\n\n# ${name}\n`,
  );
  return directory;
}

function entry(root, relativePath, overrides = {}) {
  const entryPath = join(root, relativePath);
  const activeRoot = entryPath.slice(0, entryPath.lastIndexOf('/'));
  return {
    name: overrides.name ?? relativePath.split('/').at(-1),
    dir_name: overrides.dir_name ?? relativePath.split('/').at(-1),
    location: overrides.location ?? '.agents/skills',
    entry_path: entryPath,
    active_root: activeRoot,
    entry_kind: overrides.entry_kind ?? 'directory',
    type: overrides.entry_kind ?? 'directory',
    link_target: overrides.link_target ?? '',
    raw_link_target: overrides.raw_link_target ?? null,
    raw_link_target_base64: overrides.raw_link_target_base64 ?? null,
    canonical_dir: overrides.canonical_dir ?? entryPath,
    canonical_skill_file: join(overrides.canonical_dir ?? entryPath, 'SKILL.md'),
    normalized_content_sha256: overrides.normalized_content_sha256 ?? 'a'.repeat(64),
    mutation_provenance: overrides.mutation_provenance ?? {
      kind: 'unknown',
      confidence: 'none',
      evidence: null,
    },
    provenance: overrides.provenance ?? {
      kind: 'canonical_global',
      source_url: '',
      git_root: '',
      git_branch: '',
      confidence: 'heuristic',
    },
    runtime_contract: overrides.runtime_contract ?? {
      status: 'unknown',
      loadable: null,
      load_blockers: [],
    },
    risk_indicators: overrides.risk_indicators ?? [],
    flags: overrides.flags ?? [],
  };
}

export function scanFixture(root, { changedSignal = false } = {}) {
  const sourceRoot = writeSkill(join(root, 'workspace/source-skill'), 'source-skill');
  const gitResult = spawnSync('/usr/bin/git', ['init', '-q', sourceRoot], { encoding: 'utf8' });
  if (gitResult.status !== 0) throw new Error('git fixture setup failed');

  const installedPath = writeSkill(join(root, '.agents/skills/installed-copy'), 'installed-copy');
  const authoringPath = writeSkill(join(root, '.agents/skills/authoring-copy'), 'authoring-copy');
  const backupPath = writeSkill(join(root, '.agents/skills/legacy.backup.2025'), 'legacy');

  const entries = [
    entry(root, '.claude/skills/broken-link', {
      location: '.claude/skills',
      entry_kind: 'broken_symlink',
      link_target: '../../missing',
      raw_link_target: '../../missing',
      raw_link_target_base64: 'Li4vLi4vbWlzc2luZw==',
      canonical_dir: '',
      flags: ['broken_symlink'],
    }),
    entry(root, '.claude/skills/source-skill', {
      name: 'source-skill',
      location: '.claude/skills',
      entry_kind: 'symlink',
      link_target: sourceRoot,
      raw_link_target: sourceRoot,
      raw_link_target_base64: Buffer.from(sourceRoot).toString('base64'),
      canonical_dir: sourceRoot,
      provenance: {
        kind: 'symlink_distribution',
        source_url: '',
        git_root: sourceRoot,
        git_branch: 'main',
        confidence: 'direct',
      },
    }),
    entry(root, '.cursor/skills/source-skill', {
      name: 'source-skill',
      location: '.cursor/skills',
      entry_kind: 'symlink',
      link_target: sourceRoot,
      raw_link_target: sourceRoot,
      raw_link_target_base64: Buffer.from(sourceRoot).toString('base64'),
      canonical_dir: sourceRoot,
      provenance: {
        kind: 'symlink_distribution',
        source_url: '',
        git_root: sourceRoot,
        git_branch: 'main',
        confidence: 'direct',
      },
    }),
    entry(root, '.agents/skills/installed-copy', {
      canonical_dir: installedPath,
      mutation_provenance: {
        kind: 'installed_copy',
        confidence: 'direct',
        evidence: {
          kind: 'content_bound_installer_receipt',
          receipt_sha256: 'b'.repeat(64),
          installed_tree_sha1: 'c'.repeat(40),
        },
      },
      runtime_contract: {
        status: changedSignal ? 'fail' : 'unknown',
        loadable: changedSignal ? false : null,
        load_blockers: changedSignal ? ['description_too_long'] : [],
      },
    }),
    entry(root, '.agents/skills/authoring-copy', {
      canonical_dir: authoringPath,
    }),
    entry(root, '.agents/skills/legacy.backup.2025', {
      canonical_dir: backupPath,
      flags: ['backup_remnant'],
    }),
    entry(root, 'workspace/source-skill', {
      location: 'workspace',
      canonical_dir: sourceRoot,
      provenance: {
        kind: 'native_agent',
        source_url: '',
        git_root: sourceRoot,
        git_branch: 'main',
        confidence: 'direct',
      },
      risk_indicators: [{ id: 'source_repository', severity: 'review' }],
    }),
  ];

  return {
    metadata: {
      schema_version: 'skill-scan.v5',
      product_version: '2.0',
      scanned_at: '2026-07-14T00:00:00Z',
      runtime_validation_mode: 'static-preflight',
      hash_normalization: 'strip-canary-crlf-bom.v1',
    },
    topology: {
      '.agents/skills': { total: 3, symlinks: 0, native: 3, broken_symlinks: 0 },
      '.claude/skills': { total: 2, symlinks: 1, native: 0, broken_symlinks: 1 },
      '.cursor/skills': { total: 1, symlinks: 1, native: 0, broken_symlinks: 0 },
    },
    entries,
    skills: entries.filter((item) => item.entry_kind === 'directory'),
    skill_links: entries.filter((item) => item.entry_kind === 'symlink'),
    broken_symlinks: entries.filter((item) => item.entry_kind === 'broken_symlink'),
    runtime_load_blockers: changedSignal ? [entries[3]] : [],
    name_collisions: [{ name: 'source-skill', locations: ['.claude/skills', '.cursor/skills'] }],
  };
}

export function decisionsFor(review, action = 'later') {
  return {
    schema_version: 'skills-refiner.cleanup.decisions.v1',
    review_fingerprint: review.review_fingerprint,
    decisions: review.candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      action,
    })),
  };
}
