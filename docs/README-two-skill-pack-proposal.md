# Proposed README rewrite — two-skill pack positioning

This file contains the proposed replacement content for the repository root `README.md`.

It exists because the current GitHub file-write tool in this session can create new files cleanly but cannot update an existing file in-place without an exposed blob SHA argument.

---

# skills-refiner

`skills-refiner` is now a small two-skill pack for analyzing, interpreting, and upgrading skills systems.

It contains two closely related but deliberately different skills:

1. **`skills-refiner`** — audit, refine, extract, and, when appropriate, integrate a skill repository, a single skill, or a workflow framework.
2. **`skills-appreciation`** — interpret and explain a skill, a skills repository, or a skills system in a deep yet accessible teaching style, with output strong enough to serve as a high-quality technology blog article.

The first skill optimizes for **judgment**.
The second optimizes for **understanding**.

Together, they help users not only decide what is strong, weak, reusable, or rejectable, but also understand *why* a skill or skills system works the way it does and what serious designers should learn from it.

## Why this exists

Most skill-analysis prompts fail in one of two ways:

- they stop at surface praise or criticism;
- they produce decent analysis but weak writing, so readers do not actually learn much.

This repository is meant to fix both problems.

- `skills-refiner` treats a repository, skill pack, or framework as a capability asset under review.
- `skills-appreciation` turns deep analysis into a readable, publishable, teaching-grade appreciation piece.

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

- `skills/skills-refiner/SKILL.md` — audit / refine / extract / integrate skill
- `skills/skills-appreciation/SKILL.md` — teaching-grade appreciation / interpretation skill
- `skills/skills-appreciation/references/editorial-checklist.md` — final-pass article quality checklist
- `examples/README.md` — examples for `skills-refiner`
- `examples/skills-appreciation.md` — examples for `skills-appreciation`
- `evals/` — evaluation rubrics, cases, and anchor judgments

## Quick usage examples

### Audit a repository and decide what should carry over

> Use `skills-refiner` on this repository.

### Audit and integrate into a destination repository

> Use `skills-refiner`, and treat `yknothing/prodcraft` as `target_repo`.

### Write a publishable appreciation article for a skills system

> Use `skills-appreciation` on this repository. Write a deep but readable appreciation article for serious AI tooling readers.

### Explain a single skill in a teaching style

> Use `skills-appreciation` on this skill. I want to understand why it is designed this way and what skill designers should learn from it.

## Evaluation

The repository now contains two evaluation surfaces:

- `evals/` for `skills-refiner`
- `evals/skills-appreciation-rubric.md` plus dedicated appreciation cases and golden anchors for `skills-appreciation`

The goal is not to reward verbosity or pretty structure alone. The goal is stable, transferable judgment for `skills-refiner`, and publishable, teaching-grade interpretation for `skills-appreciation`.

## License

MIT
