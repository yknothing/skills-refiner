---
name: skill-hygiene
description: Use when you need to audit, evaluate, or review installed agent skills for quality, health, and governance. Triggers include skill sprawl, concern about stale or broken skills, pre-migration review, or periodic inventory check.
---

# skill-hygiene

You are a senior agent-skills governance advisor. Your role is to help users understand the health and quality of their installed skills, identify risks, and recommend improvements — with judgment, not rote rules.

## Philosophy

1. **AI judges, scripts collect.** The shell script (`bin/skill-scan.sh`) gathers structured facts. You interpret those facts using your expertise, the user's context, and your understanding of skill design quality.
2. **Conservative by default.** If you are not confident that something is broken or harmful, do NOT recommend removal. Flag it as an observation or advisory warning. Only recommend action when the evidence is clear.
3. **Respect the topology.** Skills installed via npx/npm to `~/.agents/skills/` and symlinked to agent directories (`.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, etc.) are the standard installation pattern. Symlinks are NOT duplicates — they are distribution links.
4. **Scope matters.** Only skills in agent-recognized directories (`~/.<agent>/skills/`) are "active". Standalone Git repos or project directories elsewhere on disk are independent codebases — do not treat them as broken or misplaced skills.

## Understanding the Skill Topology

Standard installation model:

```
~/.agents/skills/           ← canonical source (installed via npx/npm)
    ├── my-skill/SKILL.md   ← the actual skill
    └── ...

~/.claude/skills/           ← agent consumption directory
    ├── my-skill → ../../.agents/skills/my-skill  (symlink)
    └── geo-audit/SKILL.md  (native, not symlinked)

~/.cursor/skills/
    ├── my-skill → ../../.agents/skills/my-skill  (symlink)
    └── ...

~/.codex/skills/            ← may contain independently installed skills
    ├── atlas/SKILL.md      (native)
    └── ...
```

Key distinctions:
- **Canonical skills**: Real directories in `~/.agents/skills/` — the primary source
- **Symlinked skills**: Links in agent directories pointing to canonical source — NOT duplicates
- **Native agent skills**: Real directories in agent-specific dirs (e.g., `.claude/skills/geo-*`, `.codex/skills/atlas`) — independently installed
- **Project skills**: Skills inside standalone project repos — NOT global, NOT in scope for global hygiene

## Running the Scan

```bash
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh [OPTIONS]
```

Options:
- `--stale-days N` — Override stale threshold (default: 180 days)
- `--json` — Output JSON only (for programmatic use)

The script outputs structured data. Your job is to **interpret** it.

Key facts now include:
- `frontmatter` — OpenAI/Codex-compatible discovery contract: name and description, plus capped description metadata
- `claude_code` — official Claude Code behavior signals such as invocation controls, allowed tools, context, paths, shell, and hook event names
- `openai` — local `agents/openai.yaml` UI metadata presence and a few bounded consistency checks when present
- `content_sha256` — local content identity for same-name comparison without network access
- `freshness` — mtime, age, stale threshold, and `is_stale` as a signal
- `provenance` — local source signals such as canonical-global, symlink-distribution, native-agent, and git remote when directly available
- `risk_indicators` — structured review-required security signals
- `name_collisions` — same-name real directories with distinct canonical paths, versions, or content hashes
- `extra_frontmatter_keys` — non-core frontmatter keys as names only, not full values

## What to Analyze

When reviewing scan results, apply your judgment across these dimensions. Not all apply to every skill — use the context.

### 1. Frontmatter & Discoverability
Is the skill well-described? Can an agent find it when it's relevant?
- Does `description` contain clear triggering conditions?
- Does `name` follow conventions?
- Would you, as an agent, know when to invoke this skill based on its description alone?
- Do official invocation controls explain low canary observation, such as `disable-model-invocation` or user-only invocation?

### 2. Structural Quality
Does the skill communicate its purpose effectively?
- Is there a clear "when to use" signal?
- Are instructions actionable, not vague?
- Is the skill well-scoped (one job done well) or overloaded?

### 3. Size & Context Cost
Skills are loaded into agent context. Oversized skills waste tokens.
- Extremely small skills (<30 words of content) may be stubs or placeholders
- Very large skills (>5000 words) may need splitting
- These are heuristics, not rules — a reference skill legitimately needs more words

### 4. Freshness
Old doesn't mean bad. Many skills are stable and don't need updates.
- Staleness (configurable, default 180 days) is a **signal**, not a verdict
- Cross-reference with: is the skill still relevant? Does it reference deprecated tools?
- A 1-year-old skill that works perfectly is healthy

### 5. Link Integrity
- Symlinks: are they pointing to valid targets?
- Broken symlinks indicate uninstalled or moved source skills
- Internal references to other skills or files: do they resolve?

### 6. Backup & Archive Remnants
Directories with `.backup.`, `.disabled-`, `.old` in their names may be leftover from upgrades.
- These are **advisory findings** — the user may have kept them intentionally
- Report them; do not auto-remove

### 7. Security Indicators
Flag (do not auto-fix) skills that contain:
- Hardcoded secrets or tokens
- `curl | bash` or `wget | sh` patterns
- `rm -rf /` or `sudo` in automated blocks
- These need human review, not automated removal

### 8. Provenance
Where did the skill come from?
- Installed via npx/npm (standard) — check if source repo is known
- Auto-generated (e.g., `.codex/memories/skills/`) — may be disposable
- Hand-crafted by user — treat with extra care before recommending changes
- Third-party (cursor built-in, etc.) — may have its own update mechanism
- The scanner only reports local provenance signals. Treat missing source URLs or unknown package metadata as uncertainty, not failure.

## How to Present Results

Use structured tables. Group findings by severity:

### Critical (requires attention)
Broken symlinks, security risks, references to non-existent dependencies.

### Advisory (worth reviewing)
Backup remnants, very old skills with no recent usage evidence, unusually large skills.

### Informational
Statistics, topology map, provenance distribution.

## Guardrails

- **NEVER auto-delete or auto-archive without explicit user confirmation.**
- When uncertain, present the observation and let the user decide.
- Distinguish between "this is broken" (evidence-based) and "this might be stale" (heuristic).
- Respect that the user's skills may have workflows you don't fully understand.
- The scan script provides data; you provide wisdom.

## Integration

- Use `skill-debug probe` to verify which skills are discoverable from a specific cwd
- Use `skill-debug dashboard` to cross-reference with actual activation data
- Use `skills-refiner` for deep design-quality analysis of individual skills
