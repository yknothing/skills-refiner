# Evaluations

This directory contains the evaluation set for `skills-refiner`, `skills-appreciation`, and `skill-hunter`.

The purpose is not to check whether the model reproduces one exact output. That would be brittle and easy to game. The purpose is to check whether the skill produces the right kind of judgment, structure, boundary control, and integration logic.

## What is being evaluated

The evaluation set covers three skills and focuses on:

**`skills-refiner`**
1. **Object identification** — does the skill correctly identify whether the target is a repository, a single skill, a pattern, or a workflow framework?
2. **Mode control** — does it stop at Audit & Refine when no `target_repo` is given, and continue into Extract & Integrate only when appropriate?
3. **Structural stability** — does it follow the intended report structure instead of drifting into a raw analysis dump?
4. **Judgment quality** — are the main strengths, weaknesses, and boundaries actually meaningful?
5. **Transfer discipline** — does it separate direct reuse, redesign-required reuse, general patterns, and explicit rejections?
6. **Evidence discipline** — when evidence is partial, does it avoid repository-wide overclaiming?
7. **Collaboration awareness** — when auditing a skill-creator output, does it focus on design-level concerns rather than duplicating functional testing?

**`skills-appreciation`**
8. **Purpose fit** — does the skill judge the target using criteria that match its actual purpose?
9. **Writing quality and low "AI flavor"** — does the output read like a shaped article or like assembled template prose?
10. **Mechanism explanation** — does the piece explain why design choices matter, not just what they are?
11. **Evidence discipline under uncertainty** — when evidence is thin, does the skill still form a real thesis without overclaiming?

**`skill-hunter`**
12. **Need interpretation** — does the skill understand the real requirement behind the user's request?
13. **Quality judgment** — does it assess skills based on structural quality rather than popularity signals?
14. **Anti-noise discipline** — does it successfully resist popularity bias, marketing language, and surface impressions?
15. **Curation quality** — does it produce a focused, high-signal shortlist rather than an unfiltered dump?
16. **Gap identification** — does it honestly report when nothing meets the quality bar?

## Evaluation philosophy

These are **anchor-based evals**, not strict string-match tests.

A strong answer does not need to use the same wording as the golden notes. It does need to arrive at the same class of judgment, respect the same boundaries, and keep the report understandable.

## Layout

- `rubric.md` — scoring rubric for `skills-refiner`
- `skills-appreciation-rubric.md` — scoring rubric for `skills-appreciation`
- `skill-hunter-rubric.md` — scoring rubric for `skill-hunter`
- `cases/` — evaluation case inputs
  - `case-01-stage1-single-skill.md` — Stage 1 only: analyze a single pasted skill file
  - `case-02-stage1-partial-evidence.md` — Stage 1 only: analyze a repository from README-only evidence
  - `case-03-stage2-with-target.md` — Stage 2 active: analyze a repository and integrate into a target
  - `case-04-appreciation-engineering-repo.md` — `skills-appreciation`: engineering repository appreciation
  - `case-05-appreciation-creative-skill.md` — `skills-appreciation`: creative skill appreciation
  - `case-06-appreciation-partial-evidence.md` — `skills-appreciation`: appreciation under thin evidence
  - `case-07-appreciation-low-ai-flavor.md` — `skills-appreciation`: resisting the "correct but stiff" failure mode
  - `case-08-skill-creator-audit.md` — `skills-refiner`: auditing a skill produced by skill-creator, focusing on design-level issues beyond assertion tests
  - `case-09-post-creation-interpretation.md` — `skills-appreciation`: writing a team-facing interpretation of a skill after creation and audit
  - `case-10-targeted-hunt.md` — `skill-hunter`: targeted hunt for the best skill to solve a specific need
  - `case-11-anti-noise-evaluation.md` — `skill-hunter`: evaluating a hyped skill and resisting marketing noise
  - `case-12-open-scout-chinese.md` — `skill-hunter`: open ecosystem scout with Chinese output
  - `case-13-social-card-hunt-chinese.md` — `skill-hunter`: targeted hunt in Chinese for multi-card social-media share skills
  - `case-14-target-repo-routing.md` — `skill-hunter`: targeted hunt with target-repo routing between upstream-linked adoption and absorb-and-refine handoff
- `golden/` — anchor judgments, expected strengths, expected failure modes
  - `case-01-anchors.md` — anchors for case 01
  - `case-02-anchors.md` — anchors for case 02
  - `case-03-anchors.md` — anchors for case 03
  - `case-04-appreciation-engineering-repo-anchors.md` — anchors for case 04
  - `case-05-appreciation-creative-skill-anchors.md` — anchors for case 05
  - `case-06-appreciation-partial-evidence-anchors.md` — anchors for case 06
  - `case-07-appreciation-low-ai-flavor-anchors.md` — anchors for case 07
  - `case-08-skill-creator-audit-anchors.md` — anchors for case 08
  - `case-09-post-creation-interpretation-anchors.md` — anchors for case 09
  - `case-10-targeted-hunt-anchors.md` — anchors for case 10
  - `case-11-anti-noise-evaluation-anchors.md` — anchors for case 11
  - `case-12-open-scout-chinese-anchors.md` — anchors for case 12
  - `case-13-social-card-hunt-chinese-anchors.md` — anchors for case 13
  - `case-14-target-repo-routing-anchors.md` — anchors for case 14

## How to use

For `skills-refiner` cases (01–03, 08), run `skills-refiner` on the case input, then compare the result against:

1. `rubric.md`;
2. the matching golden file;
3. the intended stage behavior.

For `skills-appreciation` cases (04–07, 09), run `skills-appreciation` on the case input, then compare the result against:

1. `skills-appreciation-rubric.md`;
2. the matching golden file.

For `skill-hunter` cases (10–14), run `skill-hunter` on the case input, then compare the result against:

1. `skill-hunter-rubric.md`;
2. the matching golden file.

If an answer is insightful but structurally unstable, it should not get a high score. If an answer is well-structured but shallow or credulous, it should not get a high score either.

The goal is not verbosity. The goal is stable, transferable judgment for `skills-refiner`, sharp discovery taste for `skill-hunter`, and publishable, teaching-grade interpretation for `skills-appreciation`.
