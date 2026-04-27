# skills-refiner

A skill governance toolkit for analyzing, interpreting, evaluating, and debugging agent skills systems.

It contains four skills across two layers:

**Analysis & Interpretation:**
1. **`skills-refiner`** — audit, refine, extract, and, when appropriate, integrate a skill repository, a single skill, or a workflow framework.
2. **`skills-appreciation`** — interpret and explain a skill or skills system in a deep yet accessible teaching style, producing publishable-quality articles.

**Governance & Observability:**
3. **`skill-hygiene`** — evaluate the health, quality, and topology of installed agent skills. AI judges; shell scripts collect structured facts.
4. **`skill-debug`** — three-layer observability: discovery diagnostics, activation tracing, and effectiveness dashboards for installed skills.

The first two skills optimize for **judgment** and **understanding**.
The latter two optimize for **governance** and **observability**.

## Why this exists

Most skill-analysis prompts fail in one of two ways:

- they stop at surface praise or criticism;
- they produce decent analysis but weak writing, so readers do not actually learn much.

This repository is meant to fix both problems.

- `skills-refiner` treats a repository, skill pack, or framework as a capability asset under review.
- `skills-appreciation` turns deep analysis into a readable, publishable, teaching-grade appreciation piece.

Together with `skill-creator` (the official Claude skill-creation and iteration tool), they form a complete skill lifecycle: skill-creator handles creation, testing, iteration, and packaging; skills-refiner provides the design-level audit that assertion-based testing cannot reach; and skills-appreciation turns the results into explanations that teams and communities can learn from.

## The two skills

### 1) `skills-refiner`

Use this when the main job is to:
- diagnose a repository, skill, or framework;
- judge strengths, weaknesses, structure, context engineering, reuse, safety, governance, and maturity;
- separate what should be preserved, improved, simplified, removed, reused, redesigned, or rejected;
- continue into compatibility review and integration planning when a destination repository is provided.

This skill is decision-oriented.

### 2) `skills-appreciation`

Use this when the main job is to:
- explain what a skill or skills system really is;
- unpack why its design works or fails;
- teach readers what is genuinely worth learning;
- write a strong appreciation article with clear structure, technical depth, readability, and low obvious "AI flavor".

This skill is interpretation-oriented.

It does **not** force engineering-style criteria onto every target. A repository-grade workflow skill should be judged differently from a creative writing skill, a teaching skill, or a research-analysis skill.

## Design principles

Across both skills:

- keep the input surface small;
- infer mode and depth from context when possible;
- ground judgment in evidence;
- distinguish direct evidence, inference, and uncertainty;
- avoid generic praise and inflated claims;
- prefer visible reasoning structure over shapeless analysis;
- optimize for transfer value, not just clever observations.

### Additional principle for `skills-appreciation`

A strong appreciation piece must combine:
- the rigor of a serious technical blog;
- the clarity of a teaching text;
- the readability of a publishable article.

## Installation

Install the repository using the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add yknothing/skills-refiner
```

This works with Claude Code, Cursor, Codex, OpenCode, and [many other agents](https://github.com/vercel-labs/skills#supported-agents).

## Repository layout

**Analysis & Interpretation skills:**
- `skills/skills-refiner/SKILL.md` — audit / refine / extract / integrate skill
- `skills/skills-refiner/references/skill-creator-collaboration.md` — how to use skills-refiner alongside skill-creator
- `skills/skills-appreciation/SKILL.md` — teaching-grade appreciation / interpretation skill
- `skills/skills-appreciation/references/editorial-checklist.md` — final-pass article quality checklist

**Governance & Observability skills:**
- `skills/skill-hygiene/SKILL.md` — AI-driven skill evaluation and cleanup framework
- `skills/skill-hygiene/bin/skill-scan.sh` — automated fact collector (topology, symlinks, flags)
- `skills/skill-hygiene/tests/test-scan.sh` — 17 integration tests
- `skills/skill-debug/SKILL.md` — three-layer skill observability
- `skills/skill-debug/bin/skill-probe.sh` — discovery diagnostics
- `skills/skill-debug/bin/skill-trace.sh` — activation trace injection/removal
- `skills/skill-debug/bin/skill-dashboard.sh` — effectiveness dashboard
- `skills/skill-debug/tests/test-trace.sh` — 8 integration tests

**Supporting materials:**
- `examples/` — usage examples for skills-refiner and skills-appreciation
- `evals/` — evaluation rubrics, cases, and anchor judgments (9 cases, 2 rubrics)

## Quick usage examples

### Audit a repository and decide what should carry over

> Use `skills-refiner` on this repository.

### Audit and integrate into a destination repository

> Use `skills-refiner`, and treat `yknothing/prodcraft` as `target_repo`.

### Write a publishable appreciation article for a skills system

> Use `skills-appreciation` on this repository. Write a deep but readable appreciation article for serious AI tooling readers.

### Explain a single skill in a teaching style

> Use `skills-appreciation` on this skill. I want to understand why it is designed this way and what skill designers should learn from it.

### Audit a skill that was just created with skill-creator

> I just finished creating this skill with skill-creator. Use `skills-refiner` to audit the design quality — focus on what the assertion tests might have missed.

### Explain a newly built skill to the team

> We just built this skill with skill-creator. Use `skills-appreciation` to write an explanation that helps our team understand the design.

## Evaluation

The repository contains two evaluation surfaces:

- `evals/` for `skills-refiner` (cases 01–03, 08)
- `evals/skills-appreciation-rubric.md` plus dedicated appreciation cases and golden anchors for `skills-appreciation` (cases 04–07, 09)

Cases 08 and 09 specifically test the collaboration scenario: auditing a skill-creator output (case 08) and writing a post-creation interpretation for a team (case 09).

The goal is not to reward verbosity or pretty structure alone. The goal is stable, transferable judgment for `skills-refiner`, and publishable, teaching-grade interpretation for `skills-appreciation`.

## License

MIT
