# Evaluations

This directory contains the first evaluation set for `skills-refiner`.

The purpose is not to check whether the model reproduces one exact output. That would be brittle and easy to game. The purpose is to check whether the skill produces the right kind of judgment, structure, boundary control, and integration logic.

## What is being evaluated

The current evaluation set focuses on six things:

1. **Object identification** — does the skill correctly identify whether the target is a repository, a single skill, a pattern, or a workflow framework?
2. **Mode control** — does it stop at Audit & Refine when no `target_repo` is given, and continue into Extract & Integrate only when appropriate?
3. **Structural stability** — does it follow the intended report structure instead of drifting into a raw analysis dump?
4. **Judgment quality** — are the main strengths, weaknesses, and boundaries actually meaningful?
5. **Transfer discipline** — does it separate direct reuse, redesign-required reuse, general patterns, and explicit rejections?
6. **Evidence discipline** — when evidence is partial, does it avoid repository-wide overclaiming?

## Evaluation philosophy

These are **anchor-based evals**, not strict string-match tests.

A strong answer does not need to use the same wording as the golden notes. It does need to arrive at the same class of judgment, respect the same boundaries, and keep the report understandable.

## Layout

- `rubric.md` — scoring rubric and pass/fail signals
- `cases/` — evaluation case inputs
  - `case-01-stage1-single-skill.md` — Stage 1 only: analyze a single pasted skill file
  - `case-02-stage1-partial-evidence.md` — Stage 1 only: analyze a repository from README-only evidence
  - `case-03-stage2-with-target.md` — Stage 2 active: analyze a repository and integrate into a target
- `golden/` — anchor judgments, expected strengths, expected failure modes
  - `case-01-anchors.md` — anchors for case 01
  - `case-02-anchors.md` — anchors for case 02
  - `case-03-anchors.md` — anchors for case 03

## How to use

Run `skills-refiner` on a case input, then compare the result against:

1. the rubric;
2. the matching golden file;
3. the intended stage behavior.

If an answer is insightful but structurally unstable, it should not get a high score. If an answer is well-structured but shallow or credulous, it should not get a high score either.

The goal is not verbosity. The goal is stable, transferable judgment.
