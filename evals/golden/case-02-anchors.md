# Golden anchors — Case 02: Stage 1, partial evidence (README only)

## What a strong answer must do

### Object identification
- Correctly identify the input as a **multi-skill repository** seen only through its README.
- Recognize the five skill names and their high-level descriptions.
- Note that no actual skill file content is available.

### Stage control
- Run Stage 1 only.
- Must **not** introduce integration planning or Stage 2 content.
- Output should end with a refinement plan or top 3 refinement actions.

### Evidence discipline (critical for this case)
- Must **explicitly state** that the only evidence available is the README.
- Must **not** make definitive claims about skill file quality, context engineering, or output format.
- May make reasonable inferences from the README (e.g., skill names suggest scope) but must flag these as inferences.
- Must **not** treat a skill list in a README as proof that those skills are well-designed.

### Structural output
- Must include at least: Executive Summary, Positioning, Core Strengths (with appropriate hedging), Core Weaknesses, Full Review (with explicit evidence limits), Refinement Judgment.

---

## Key judgment anchors

### What can legitimately be said from the README alone
- The repository has broad scope: five different skill types across PR review, testing, documentation, refactoring, and security.
- Installation is manual (copy-paste), not automated — a structural signal worth noting.
- There is no versioning, no update mechanism, and no skill invocation examples in the README.
- The skill descriptions are one-line summaries, which tells us nothing about skill quality.

### What cannot be said from the README alone
- Whether the skills are well-structured.
- Whether they have clear triggers, output formats, or boundaries.
- Whether the repository is actively maintained.
- Whether the skills work reliably in practice.

### Reasonable inferences (must be flagged as inferences)
- The breadth of coverage (5 domains) suggests this may be a personal utility collection rather than a purpose-built toolkit.
- Manual installation suggests the repository may not be following current skill ecosystem conventions.

---

## Failure signals

Treat the answer as **failing** if it:
- Makes definitive statements about skill quality or maturity from README evidence alone
- Does not acknowledge the evidence limitation
- Treats the five skill titles as proof of strong coverage
- Activates Stage 2 without any prompt
- Produces a confident scorecard as if full repository access was available

## Score floor to pass

- Object identification: ≥ 4
- Stage control: 5 (non-negotiable)
- Evidence discipline: ≥ 4 (critical for this case)
- Judgment quality: ≥ 3
- Overall: ≥ 3.5 average across all applicable dimensions
