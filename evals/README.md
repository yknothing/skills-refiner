# Evaluations

This directory contains the evaluation set for `skills-refiner` and `skills-appreciation`.

The purpose is to check whether the Skill produces useful, evidence-grounded
judgments and improvements for the actual task. For `skills-refiner`, quality
and retained capability come first; token cost is secondary. Its exact wording,
report shape and finding counts are not success criteria. `skills-appreciation`
uses its separate rubric and case anchors.

## What is being evaluated

The evaluation set covers two skills and focuses on:

**`skills-refiner`**
1. **Object identification** — does the skill correctly identify whether the target is a repository, a single skill, a pattern, or a workflow framework?
2. **Task and stage control** — does it reuse valid prior work, adapt to user corrections, and integrate only when there is a real destination?
3. **Communication** — is the response clear and proportionate to the requested decision or artifact?
4. **Judgment and improvement quality** — does it find consequential issues, preserve needed capabilities and propose concrete better behavior?
5. **Transfer discipline** — does it separate direct reuse, redesign-required reuse, general patterns, and explicit rejections?
6. **Evidence discipline** — when evidence is partial, does it avoid repository-wide overclaiming?
7. **Collaboration awareness** — when auditing a skill-creator output, does it focus on design-level concerns rather than duplicating functional testing?
8. **System composition and closure** — does it check producers, consumers,
   handoff requirements and a finite acceptance boundary?
9. **Quality-first comparisons** — does it distinguish quality gains, retained
   quality with measured cost reduction, regressions and insufficient evidence?

**`skills-appreciation`**
1. **Purpose fit** — does the skill judge the target using criteria that match its actual purpose?
2. **Writing quality and low "AI flavor"** — does the output read like a shaped article or like assembled template prose?
3. **Mechanism explanation** — does the piece explain why design choices matter, not just what they are?
4. **Evidence discipline under uncertainty** — when evidence is thin, does the skill still form a real thesis without overclaiming?

## Evaluation philosophy

These are **anchor-based evals**, not strict string-match tests.

A strong answer does not need to use the same wording as the golden notes. It does need to arrive at the same class of judgment, respect the same boundaries, and keep the report understandable.

## Layout

- `rubric.md` — scoring rubric for `skills-refiner`
- `skills-appreciation-rubric.md` — scoring rubric for `skills-appreciation`
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
  - `case-10-session-continuation.md` — four reconstructed decision snapshots:
    concrete refinement, scoped continuation, finite acceptance and deployment handoff
  - `case-11-quality-and-cost.md` — six synthetic transfer snapshots:
    repaired regressions, useful added guidance, indirect contribution, no-change
    judgment, selective anti-pattern edits and mixed runtime/content attribution
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
  - `case-10-session-continuation-anchors.md` — anchors for snapshots 10A–10D
  - `case-11-quality-and-cost-anchors.md` — anchors for snapshots 11A–11F

## How to use

For `skills-refiner` cases (01–03, 08, 10–11), provide only the case input or
selected snapshot to the executor, along with the Skill and its accessible
resources. Keep expected behavior, later turns and evaluator notes hidden.
Then compare the preserved response against:

1. `rubric.md`;
2. the matching golden file;
3. the intended stage behavior.

For `skills-appreciation` cases (04–07, 09), run `skills-appreciation` on the case input, then compare the result against:

1. `skills-appreciation-rubric.md`;
2. the matching golden file.

For original/candidate comparisons, use identical inputs and freeze both
versions with their referenced resources. The session snapshots are reconstructed
decision exercises, not a full replay of the source session or evidence that a
particular Skill caused its events. Shared-context batches and single runs must
be labeled; they do not establish fresh-session repeatability or live workflow
improvement. Add unseen transfer cases where needed for the proposed change.

A clear report with weak decisions is not a strong result. Nor is a terse answer
that omits the guidance required to implement the change. Check per-case quality
and critical failures before comparing actual cost; unavailable token usage
stays unavailable. See `rubric.md` for comparison outcomes and evidence limits.

The goal is useful, transferable judgment for `skills-refiner`, and publishable,
teaching-grade interpretation for `skills-appreciation`.
