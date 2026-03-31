# Case 03 — Stage 2: repository analysis with target_repo

## Input

Use `skills-refiner` on the following repository snapshot. Treat `yknothing/prodcraft` as `target_repo`.

---

**Source repository:** `yknothing/skills-refiner`

**Evidence available:** README.md and main skill file.

The repository contains a single skill, `skills-refiner`, designed to audit and refine skill repositories. It operates in two stages:

- Stage 1 (always): Audit & Refine — structural diagnosis, quality review, scorecard, four-way extraction.
- Stage 2 (conditional): Extract & Integrate — integration planning for a target repository.

The skill uses a structured 11-section report format and enforces strict stage separation.

---

**Target repository:** `yknothing/prodcraft`

This is a product management and workflow skills repository. It contains skills for:
- writing product specs
- creating roadmaps
- generating stakeholder updates
- reviewing PRDs for completeness

The target repository currently has no audit, refinement, or quality-review skills.

---

## Expected behavior

- Complete Stage 1 first: diagnose `skills-refiner` as a source object.
- Then continue to Stage 2: analyze compatibility with `yknothing/prodcraft`.
- Identify what parts of `skills-refiner` are directly adoptable, need redesign, are useful as patterns, or should be rejected.
- Produce a Minimum Viable Integration Plan and a High-Leverage Enhancement Plan.
- Return the top 3 next actions.

## Dimensions primarily tested

- Stage control (must activate Stage 2 because `target_repo` is given)
- Transfer discipline (meaningful four-way extraction relative to the target)
- Integration quality (concrete, actionable plan for `yknothing/prodcraft`)
- Judgment quality (how `skills-refiner` fits — or doesn't fit — a product management context)
