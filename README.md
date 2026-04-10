# skills-refiner

`skills-refiner` is now a three-skill pack for discovering, analyzing, interpreting, and upgrading skills systems.

It contains three closely related but deliberately different skills:

1. **`skill-hunter`** — discover and identify the best Agent Skills across the ecosystem, cutting through noise and hype to surface genuinely excellent skills worth adopting, and route adoption into a target skills repository when needed.
2. **`skills-refiner`** — audit, refine, extract, and, when appropriate, decide whether a skill should stay upstream-linked or be absorbed into a target repository.
3. **`skills-appreciation`** — interpret and explain a skill, a skills repository, or a skills system in a deep yet accessible teaching style, with output strong enough to serve as a high-quality technology blog article.

The first skill optimizes for **discovery**.
The second optimizes for **judgment**.
The third optimizes for **understanding**.

Together, they cover the full skill intelligence lifecycle: find the best skills, decide what is strong or weak about them, and understand *why* they work the way they do.

## Why this exists

Most skill-analysis prompts fail in one of two ways:

- they stop at surface praise or criticism;
- they produce decent analysis but weak writing, so readers do not actually learn much.

And most skill-discovery methods fail in one more way:

- they rely on popularity signals that measure visibility, not quality.

This repository is meant to fix all three problems.

- `skill-hunter` finds the skills worth paying attention to — the ones with real quality, not just marketing.
- `skills-refiner` treats a repository, skill pack, or framework as a capability asset under review.
- `skills-appreciation` turns deep analysis into a readable, publishable, teaching-grade appreciation piece.

Together with `skill-creator` (the official Claude skill-creation and iteration tool), they form a complete skill lifecycle: skill-hunter discovers the best skills in the ecosystem; skill-creator handles creation, testing, iteration, and packaging; skills-refiner provides the design-level audit that assertion-based testing cannot reach; and skills-appreciation turns the results into explanations that teams and communities can learn from.

## The three skills

### 1) `skill-hunter`

Use this when the main job is to:
- find the best skills for a specific need or across the ecosystem;
- cut through marketing noise and popularity bias to surface real quality;
- evaluate whether a specific skill is genuinely worth adopting;
- discover hidden gems and rising-quality skills that most people have not noticed;
- compare candidates head-to-head with clear verdicts;
- when `target_repo` context is present, classify whether a pick should stay upstream-linked or be handed to `skills-refiner` for absorb-and-refine work.

This skill is discovery-oriented.

### 2) `skills-refiner`

Use this when the main job is to:
- diagnose a repository, skill, or framework;
- judge strengths, weaknesses, structure, context engineering, reuse, safety, governance, and maturity;
- separate what should be preserved, improved, simplified, removed, reused, redesigned, or rejected;
- continue into compatibility review, integration-mode choice, and integration planning when a destination repository is provided.

This skill is decision-oriented.

### 3) `skills-appreciation`

Use this when the main job is to:
- explain what a skill or skills system really is;
- unpack why its design works or fails;
- teach readers what is genuinely worth learning;
- write a strong appreciation article with clear structure, technical depth, readability, and low obvious "AI flavor".

This skill is interpretation-oriented.

It does **not** force engineering-style criteria onto every target. A repository-grade workflow skill should be judged differently from a creative writing skill, a teaching skill, or a research-analysis skill.

## Design principles

Across all three skills:

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

- `skills/skill-hunter/SKILL.md` — discover and identify the best skills in the ecosystem
- `skills/skill-hunter/references/quality-signals.md` — concrete quality signals for evaluating skill candidates
- `skills/skills-refiner/SKILL.md` — audit / refine / extract / integrate skill
- `skills/skills-refiner/references/skill-creator-collaboration.md` — how to use skills-refiner alongside skill-creator
- `skills/skills-appreciation/SKILL.md` — teaching-grade appreciation / interpretation skill
- `skills/skills-appreciation/references/editorial-checklist.md` — final-pass article quality checklist
- `examples/README.md` — examples for `skills-refiner` (including skill-creator collaboration)
- `examples/skills-appreciation.md` — examples for `skills-appreciation` (including post-creation interpretation)
- `examples/skill-hunter.md` — examples for `skill-hunter`
- `evals/` — evaluation rubrics, cases, and anchor judgments (14 cases, 3 rubrics)

## Quick usage examples

### Find the best skills for a specific need

> Use `skill-hunter` to find the best code review skills. I need something with real design quality, not just popularity.

### Hunt and route the result into a target skills repository

> Use `skill-hunter` to find the best research-synthesis skills for my skills repo. Treat `acme/team-skills` as `target_repo`. If a skill should stay intact and keep following upstream, say that. If it needs adaptation, route it to `skills-refiner`.

> For upstream-linked outcomes, the expectation is not "just symlink it." The expectation is a reference-preserving adoption path with clear source-of-truth, provenance, update, and wrapper boundaries.

### Discover hidden gems across the ecosystem

> Use `skill-hunter` in open scout mode. What skills are genuinely excellent but underrated right now?

### Evaluate whether a specific skill is worth adopting

> Use `skill-hunter` to evaluate this skill. Is it actually good, or just well-marketed?

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

The repository contains three evaluation surfaces:

- `evals/rubric.md` for `skills-refiner` (cases 01–03, 08)
- `evals/skills-appreciation-rubric.md` plus dedicated appreciation cases and golden anchors for `skills-appreciation` (cases 04–07, 09)
- `evals/skill-hunter-rubric.md` plus dedicated hunting cases and golden anchors for `skill-hunter` (cases 10–14)

Cases 08 and 09 specifically test the collaboration scenario: auditing a skill-creator output (case 08) and writing a post-creation interpretation for a team (case 09). Cases 10–14 test skill-hunter's discovery quality, anti-noise discipline, deep evaluation capabilities, and adoption-routing judgment.

The goal is not to reward verbosity or pretty structure alone. The goal is stable, transferable judgment for `skills-refiner`, sharp discovery taste for `skill-hunter`, and publishable, teaching-grade interpretation for `skills-appreciation`.

## License

MIT
