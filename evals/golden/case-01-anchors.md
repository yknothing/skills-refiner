# Golden anchors — Case 01: Stage 1, single skill analysis

## What a strong answer must do

### Object identification
- Correctly identify the input as a **single skill file**, not a repository or a collection.
- Recognize the skill's scope: a simple, linear workflow for generating release notes.
- Note that the skill's center of gravity is procedural task execution, not judgment or inference.

### Stage control
- Run Stage 1 only.
- Must **not** introduce integration planning or Stage 2 content.
- The output should end with a refinement plan or top 3 refinement actions.

### Structural output
- Must include at least: Executive Summary, Positioning, Core Strengths, Core Weaknesses, Full Review, Refinement Judgment.
- The Scorecard is optional but welcome.
- The output should be structured and readable, not a chain-of-thought dump.

---

## Key judgment anchors

### Strengths to identify (at least 2 of these)
- Clear invocation trigger (the "When to use" section reduces ambiguity)
- Concrete output format (the release notes template reduces agent drift)
- Simple, well-scoped single-task skill (no overreach)

### Weaknesses to identify (at least 2 of these)
- No handling of commit message quality variation (messy history breaks the grouping step)
- Grouping logic ("features, fixes, chores") is not explained — the agent must infer commit type from freeform messages, which is error-prone
- No guidance on tone, audience, or detail level for the release notes
- Missing: what to do when `<start>` or `<end>` refs cannot be resolved

### Refinement actions (at least 1 of these in the top 3)
- Add a fallback or clarification step for unparseable or ambiguous commits
- Specify how to classify commits (e.g., by conventional commit prefix or by heuristic)
- Add a tone/audience parameter to support different release note styles

---

## Failure signals

Treat the answer as **failing** if it:
- Treats this as a repository rather than a single skill
- Activates Stage 2 without any prompt
- Gives generic praise without identifying the grouping ambiguity
- Overclaims about "full test coverage" or "maturity" from a small skill file
- Produces an unstructured response without section headings

## Score floor to pass

- Object identification: ≥ 4
- Stage control: 5 (non-negotiable)
- Judgment quality: ≥ 3
- Evidence discipline: ≥ 4
- Overall: ≥ 3.5 average across all applicable dimensions
