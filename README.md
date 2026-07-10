# skills-refiner

**Languages:** English | [简体中文](README.zh-CN.md)

A skill governance toolkit for analyzing, interpreting, evaluating, and debugging agent skills systems.

Version 1.0 focused on design judgment after skill creation: whether a single skill is well positioned, scoped, portable, and context-efficient.

Version 2.0 extends that judgment from individual skills to installed skill systems: topology, provenance, symlink distribution, local evidence, and conservative governance.

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
2. **No operational visibility.** Users install dozens of skills across multiple agent directories and have no way to tell which are locally visible, observed through local evidence, stale, broken, or worth deeper review.

This repository addresses both:

- `skills-refiner` and `skills-appreciation` handle the **analysis** problem — deep design audit and publishable interpretation.
- `skill-hygiene` and `skill-debug` handle the **governance** problem — topology scanning, version/provenance fact collection, activation canary tracing, and observation analytics.

Together with a skill-creation tool such as `skill-creator`, they form a complete skill lifecycle: creation → testing → design audit → governance → observability → interpretation.

The first governance question is now deliberately blunt: can static evidence prove a load blocker? `skill-scan.sh` reports a reliably parsed description longer than the 1024-character limit as `runtime_contract.status: "fail"`. A required field that the lightweight parser does not observe is recorded under `unverified_requirements`, not declared missing. Otherwise status is `"unknown"`, `loadable` is `null`, and `runtime_verified` is `false`—the scanner does not pretend it executed an agent's real loader or a complete YAML validator.

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

Use when you need local evidence about likely skill discovery surfaces, observed canary events, and installed skill identities with no local canary evidence. Three layers:

- **Discovery diagnostics** (`skill-probe`) — what local skill surfaces are likely discoverable from the current working directory?
- **Activation canary tracing** (`skill-trace`) — inject/remove lightweight canary blocks to observe when agents follow skills.
- **Canary observation dashboard** (`skill-dashboard`) — canary event frequency, not-observed skill identity detection, context distribution, canary observed identity rate.

Combine with `skill-hygiene` for a full governance workflow: probe discovery → check canary observations → evaluate quality → triage.

## Design principles

Across all four skills:

- **AI judges, scripts collect.** Shell scripts gather structured data without making decisions. The AI interprets evidence using expertise and context. Scripts must not strip AI's judgment capability.
- **Loadability before elegance.** A skill that cannot satisfy the runtime loader contract is a blocker, no matter how polished its docs or workflow are.
- **Conservative by default.** If evidence is unclear, flag observations — do not recommend removal or action. Only act when evidence is unambiguous.
- **Respect the topology.** The standard model is: canonical skills in `~/.agents/skills/`, symlinked to agent directories (`.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, etc.). Symlinks are distribution links, not duplicates. Standalone project repos are not broken global skills.
- **Treat installs as deployment artifacts.** This repository is the source of truth. Global installed skills may drift; compare hashes/commits before treating an installed skill as current. For hash comparison use the scanner’s `normalized_content_sha256` on both sides (it excludes canary blocks/CRLF/BOM), not a raw `sha256sum` of a canary-injected file.
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
- All operations are reversible. Trace injection can be stripped byte-for-byte, including files without a final newline. Scans never modify skill files; use `--json` or `--no-write` for stdout-only/no-report runs. Dashboard never modifies skill files.
- All data stays local. No data is sent externally. Canary logs use a non-symlink `~/.agents/debug/` directory (`0700`) and `activation.jsonl` (`0600`); symlinked log paths are rejected rather than followed or chmodded.

**Statistics accuracy contract:**
- Exact local statistics: skill file inventory, canonical paths, symlink distribution links, broken symlinks, content hashes, same-name/content/version collisions, report freshness, and recorded canary JSONL events.
- Proxy statistics: canary observed rate, not-observed identities, cwd distribution, and observation frequency. These count local evidence, not true runtime use.
- Out of scope without native telemetry: whether an agent discovered, loaded, obeyed, or benefited from a skill in a real conversation.

## Installation

Install all four skills globally with the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add yknothing/skills-refiner --skill skills-refiner --skill skills-appreciation --skill skill-hygiene --skill skill-debug -g
```

Works with Claude Code, Cursor, Codex, OpenCode, and [many other agents](https://github.com/vercel-labs/skills#supported-agents).

The governance scripts require Bash, `jq`, and a SHA-256 implementation. Native
macOS supports the full toolchain. Windows WSL 2 with `HOME` on the WSL Linux
filesystem is the full-toolchain target: canary writes re-check actual modes and
fail closed, but dedicated WSL runner certification is still pending. Windows
Git Bash covers real-directory read-only governance and trace file transforms;
symlink/junction topology is not certified, and canary logging is rejected.
Native PowerShell/cmd is not implemented. See the
[platform support contract](docs/platform-support.md) for exact boundaries.

Each skill is independently installable. For example:

```bash
# Design audit only (no runtime dependency on the other skills)
npx skills add yknothing/skills-refiner --skill skills-refiner -g

# Standalone installed-skill scanner
npx skills add yknothing/skills-refiner --skill skill-hygiene -g

# Complete governance bundle: observability + aggregate hygiene snapshot
npx skills add yknothing/skills-refiner --skill skill-debug --skill skill-hygiene -g
```

`skill-debug` works by itself for probe, dashboard, and trace operations. Its
aggregate `doctor` command reports `hygiene` as structured `unavailable` and
returns a partial-result exit code (`1`) until `skill-hygiene` is also installed.

### One-shot health snapshot (`doctor`)

Read-only aggregate (discovery probe -> activation dashboard -> hygiene scan). Does **not** inject activation traces (those edit skill files). The default report is a compact governance summary; pass `--raw` when you need the full subtool terminal output.

```bash
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh
# Machine-readable bundle for agents / tooling:
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --json
# Chinese terminal report:
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --lang zh
# From a git checkout (wrapper):
bash bin/skills-refiner-doctor.sh --help
```

Optional env: `SKILLS_REFINER_TOOLS_ROOT` — directory that contains `skill-debug/` and `skill-hygiene/` (same layout as `~/.agents/skills`).

Version note: the current product line is `skills-refiner 2.0`. JSON fields such as `skills-refiner.doctor.v2`, `skill-dashboard.identity.v2`, and `skill-scan.v4` are schema versions, not product release numbers. Doctor v2 adds the explicit `unavailable` step status used by selective installs. Scan v4 replaces optimistic static `loadable: true` claims with `status: "unknown"` and `loadable: null` unless a blocker is proven.

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
- `skills/skill-debug/bin/skills-refiner-doctor.sh` — read-only probe + dashboard + hygiene snapshot
- `skills/skill-debug/tests/test-doctor.sh` — smoke test for doctor (`HOME` sandbox)
- `skills/skill-debug/tests/test-trace.sh` — integration tests
- `skills/skill-debug/tests/test-probe.sh` — integration tests for discovery probe
- `skills/skill-debug/tests/test-dashboard.sh` — integration tests for dashboard
- `skills/skill-debug/tests/test-install-layout.sh` — selective installed-layout contract
- `skills/skill-debug/tests/test-platform-contract.sh` — macOS/Windows path, CRLF, and permission-boundary contract
- `skills/skill-debug/tests/test-observability-regressions.sh` — regression tests for conservative observability semantics

**Supporting materials:**
- `skills/{skill-debug,skill-hygiene}/lib/common.sh` — mirrored runtime helpers; each executable governance skill ships its own copy so selective installs remain self-contained (the installed-layout test enforces byte equality)
- `bin/skills-refiner-doctor.sh` — contributor wrapper → `skills/skill-debug/bin/skills-refiner-doctor.sh`
- `docs/platform-support.md` — explicit macOS, Windows WSL 2, Git Bash, and native PowerShell support boundaries
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
# One-shot read-only snapshot (probe + dashboard + hygiene terminal report)
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh

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

The governance skills (`skill-hygiene`, `skill-debug`) are validated through integration tests that create sandboxed skill topologies and verify scanner/tracer correctness. `skills/skill-debug/tests/test-doctor.sh` smoke-tests the read-only `skills-refiner-doctor.sh` bundle under an isolated `HOME`; `test-platform-contract.sh` gates spaced paths, BOM/CRLF round trips, and Windows permission failures. GitHub Actions runs the full suite on macOS and Ubuntu plus the bounded Git Bash contract on `windows-latest`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT
