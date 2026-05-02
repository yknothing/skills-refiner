# skills-refiner

A skill governance toolkit for analyzing, interpreting, evaluating, and debugging agent skills systems.

Four skills across two layers:

**Analysis & Interpretation** — judgment and understanding:
1. **`skills-refiner`** — audit, refine, extract, and integrate a skill repository, single skill, or workflow framework
2. **`skills-appreciation`** — interpret and explain a skill or skills system in a deep, teaching-grade style

**Governance & Observability** — health and visibility:
3. **`skill-hygiene`** — evaluate health, quality, and topology of installed skills (AI judges; shell scripts collect facts)
4. **`skill-debug`** — three-layer observability: local discovery diagnostics, activation canary tracing, canary observation dashboards

## Why this exists

Agent skills grow fast and degrade silently. Most skill ecosystems face two intertwined problems:

1. **No deep design review.** Skills pass assertion tests but suffer from scope creep, poor context engineering, or hidden fragility. Surface-level praise or criticism does not help.
2. **No operational visibility.** Users install dozens of skills across multiple agent directories and have no way to tell which are locally visible, observed in use, effective, stale, or broken.

This repository addresses both:

- `skills-refiner` and `skills-appreciation` handle the **analysis** problem — deep design audit and publishable interpretation.
- `skill-hygiene` and `skill-debug` handle the **governance** problem — topology scanning, version/provenance fact collection, activation canary tracing, and observation analytics.

Together with `skill-creator` (the official Claude skill-creation tool), they form a complete skill lifecycle: creation → testing → design audit → governance → observability → interpretation.

## The four skills

### 1) `skills-refiner` — design-level audit

Use when the main job is to:
- diagnose a repository, skill, or framework;
- judge strengths, weaknesses, structure, context engineering, reuse, safety, governance, and maturity;
- separate what should be preserved, improved, simplified, removed, or rejected;
- continue into compatibility review and integration planning when a destination repository is provided.

This skill is decision-oriented. It complements `skill-creator` by covering what assertion-based testing cannot reach.

### 2) `skills-appreciation` — teaching-grade interpretation

Use when the main job is to:
- explain what a skill or skills system really is;
- unpack why its design works or fails;
- teach readers what is genuinely worth learning;
- produce a publishable appreciation article with clear structure, technical depth, and low "AI flavor".

This skill is interpretation-oriented. It does **not** force engineering-style criteria onto every target — a creative skill is judged differently from an infrastructure skill.

### 3) `skill-hygiene` — installed skill evaluation

Use when you need to:
- audit the health and quality of installed skills across all agent directories;
- identify broken symlinks, backup remnants, security indicators, stale or stub skills;
- understand the skill topology: canonical sources, symlinked distributions, native agent skills, same-name content/version collisions;
- get a structured inventory for governance review.

This skill follows the "AI judges, scripts collect" philosophy. The shell script (`bin/skill-scan.sh`) gathers structured facts; the AI applies expert judgment. It respects the standard skill installation model: skills installed to `~/.agents/skills/` and symlinked to agent directories are distribution links, not duplicates.

### 4) `skill-debug` — skill observability

Use when you cannot tell whether a skill was discovered, loaded, or followed by the agent. Three layers:

- **Discovery diagnostics** (`skill-probe`) — what local skill surfaces are likely discoverable from the current working directory?
- **Activation canary tracing** (`skill-trace`) — inject/remove lightweight canary blocks to observe when agents follow skills.
- **Canary observation dashboard** (`skill-dashboard`) — canary event frequency, not-observed skill identity detection, context distribution, observed rate.

Combine with `skill-hygiene` for a full governance workflow: probe discovery → check canary observations → evaluate quality → triage.

## Design principles

Across all four skills:

- **AI judges, scripts collect.** Shell scripts gather structured data without making decisions. The AI interprets evidence using expertise and context. Scripts must not strip AI's judgment capability.
- **Conservative by default.** If evidence is unclear, flag observations — do not recommend removal or action. Only act when evidence is unambiguous.
- **Respect the topology.** The standard model is: canonical skills in `~/.agents/skills/`, symlinked to agent directories (`.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, etc.). Symlinks are distribution links, not duplicates. Standalone project repos are not broken global skills.
- **Treat installs as deployment artifacts.** This repository is the source of truth. Global installed skills may drift; compare hashes/commits before treating an installed skill as current.
- **Use native signals first.** Prefer Claude Code OpenTelemetry, Codex skill metadata, Cursor Rules/Skills/MCP surfaces, and SDK-native traces where they exist. Canary tracing is a local fallback, not a platform trace.
- **Ground judgment in evidence.** Distinguish direct evidence, inference, and uncertainty. Avoid generic praise, inflated claims, or rote rules.
- **Keep the input surface small.** Infer mode, depth, and language from context when possible.
- **Optimize for transfer value.** The goal is not clever observations but actionable insight.

### Additional principles by layer

**Analysis & Interpretation:**
- Prefer visible reasoning structure over shapeless analysis.
- A strong appreciation piece must combine the rigor of a technical blog, the clarity of a teaching text, and the readability of a publishable article.

**Governance & Observability:**
- No false alarms. A skill with zero observed activations may simply not have been needed. Treat "not observed" as an observation, not a verdict.
- All operations are reversible. Trace injection can be stripped. Scans never modify skill files; use `--json` or `--no-write` for stdout-only/no-report runs. Dashboard never modifies skill files.
- All data stays local. No data is sent externally.

## Installation

Install with the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add yknothing/skills-refiner
```

Works with Claude Code, Cursor, Codex, OpenCode, and [many other agents](https://github.com/vercel-labs/skills#supported-agents).

## Repository layout

**Analysis & Interpretation:**
- `skills/skills-refiner/SKILL.md` — audit / refine / extract / integrate
- `skills/skills-refiner/references/skill-creator-collaboration.md` — collaboration model with skill-creator
- `skills/skills-appreciation/SKILL.md` — teaching-grade appreciation / interpretation
- `skills/skills-appreciation/references/editorial-checklist.md` — article quality checklist

**Governance & Observability:**
- `skills/skill-hygiene/SKILL.md` — AI-driven skill evaluation framework
- `skills/skill-hygiene/bin/skill-scan.sh` — topology and fact collector
- `skills/skill-hygiene/tests/test-scan.sh` — integration tests
- `skills/skill-debug/SKILL.md` — three-layer observability
- `skills/skill-debug/bin/skill-probe.sh` — discovery diagnostics
- `skills/skill-debug/bin/skill-trace.sh` — activation trace injection/removal
- `skills/skill-debug/bin/skill-dashboard.sh` — canary observation dashboard
- `skills/skill-debug/tests/test-trace.sh` — integration tests
- `skills/skill-debug/tests/test-probe.sh` — integration tests for discovery probe
- `skills/skill-debug/tests/test-dashboard.sh` — integration tests for dashboard

**Supporting materials:**
- `examples/` — usage examples for all four skills
- `evals/` — evaluation rubrics, cases, and anchor judgments (9 cases, 2 rubrics)

## Quick usage examples

### Analysis & Interpretation

```text
# Audit a repository
Use skills-refiner on this repository.

# Audit and integrate into another repo
Use skills-refiner, and treat yknothing/prodcraft as target_repo.

# Write an appreciation article
Use skills-appreciation on this repository. Write a deep but readable article.

# Explain a single skill
Use skills-appreciation on this skill. I want to understand why it is designed this way.
```

### Governance & Observability

```bash
# Scan installed skills for health issues
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh

# What local skill surfaces are likely discoverable from here?
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh

# Inject activation canaries into all skills
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/

# View canary observation dashboard (last 30 days)
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh

# Combined health check
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh --doctor
```

## Evaluation

The `evals/` directory contains anchor-based evaluations for the analysis skills:

- `skills-refiner` (cases 01–03, 08) — object identification, stage control, judgment quality, evidence discipline
- `skills-appreciation` (cases 04–07, 09) — thesis clarity, mechanism explanation, writing quality, low "AI flavor"

Cases 08–09 test the collaboration scenario with skill-creator.

The governance skills (`skill-hygiene`, `skill-debug`) are validated through integration tests that create sandboxed skill topologies and verify scanner/tracer correctness.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT
