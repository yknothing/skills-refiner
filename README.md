# skills-refiner

`skills-refiner` is a repository-grade skill for two closely related jobs:

1. **Audit & Refine** — diagnose, review, sharpen, and improve a skill repository, a single skill, or a workflow framework.
2. **Extract & Integrate** — when a destination repository is specified or clearly implied, continue from the audit into transfer, redesign, compatibility review, and integration planning.

The point is not to praise a repository because it is popular, nor to copy it because it looks sophisticated. The point is to decide, with structure and evidence, what should be preserved, improved, abstracted, rejected, or absorbed.

## Why this exists

Most repository-analysis prompts have three recurring failures:

- they confuse popularity with design quality;
- they stop at surface strengths and weaknesses;
- they do not separate local workflow tricks from transferable repository assets.

`skills-refiner` is meant to solve that.

It treats an external repository, skill pack, or workflow framework as a capability asset under review. It first produces a clear diagnostic pass. Only when the context calls for it does it continue into repository-to-repository integration work.

## Operating model

### Stage 1 — Audit & Refine
This stage always runs.

Use it to:
- identify what the source object actually is;
- judge what problem it really solves;
- assess strengths, weaknesses, structure, context engineering, reuse potential, safety, governance, and maturity;
- decide what should be kept, improved, simplified, or removed.

If no destination repository is specified, the skill stops here and returns a refinement-oriented report.

### Stage 2 — Extract & Integrate
This stage only runs when a destination repository is specified or clearly implied by the surrounding context.

Use it to:
- separate directly reusable parts from parts that require redesign;
- detect conflicts with the destination repository;
- identify what should be rejected rather than imported;
- produce a practical integration and upgrade plan.

## Input model

Only one explicit input is modeled:

- `target_repo` — the destination repository to absorb findings into.

The source object under analysis is inferred from the current page, repository link, attached content, quoted skill text, or the user’s instruction.

That design is intentional. This skill is supposed to be easy to invoke and hard to misuse.

## Output shape

The report follows a stable structure:

1. Executive Summary
2. Positioning
3. Core Strengths
4. Core Weaknesses
5. Full Review
6. Scorecard
7. Refinement Judgment
8. Four-way Extraction
9. Compatibility with `target_repo` (if applicable)
10. Integration Plan or Refinement Plan
11. Final Conclusion

## Installation

Install this skill using the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add yknothing/skills-refiner
```

This works with Claude Code, Cursor, Codex, OpenCode, and [many other agents](https://github.com/vercel-labs/skills#supported-agents).

## Repository layout

- `skills/skills-refiner/SKILL.md` — main skill file
- `examples/README.md` — example invocations and usage patterns
- `evals/` — evaluation rubric, cases, and anchor judgments

## Design principles

- Keep the input surface small.
- Infer mode and depth from context instead of asking for a form.
- Keep analysis, refinement, and integration logically separate.
- Prefer concrete judgment over generic praise.
- Prefer report structure over chain-of-thought style sprawl.
- Do not force integration work when the context does not justify it.

## Quick usage examples

### Diagnose and refine the current repository

> Use `skills-refiner` on this repository.

### Diagnose and then integrate into another repository

> Use `skills-refiner`, and treat `yknothing/prodcraft` as `target_repo`.

### Review a single skill file

> Use `skills-refiner` on this skill. Focus on structure, boundaries, reuse, and improvement opportunities.

## License

MIT
