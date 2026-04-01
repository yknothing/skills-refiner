# Case 07 — `skills-appreciation`: resisting the "correct but stiff" failure mode

## Input

Use `skills-appreciation` on the following skill. Write a deep but accessible appreciation piece for readers who want to understand how this kind of skill creates value — and where it falls short.

---

```markdown
---
name: research-synthesizer
description: Help a researcher synthesize evidence from multiple sources into a clear, defensible position.
---

# research-synthesizer

Use this skill when you have gathered several sources on a topic and need to move from notes to a coherent argument.

## Core behavior

- Ask what claim or position the researcher is trying to support.
- Review the provided sources and identify:
  - supporting evidence
  - contradicting evidence
  - gaps not covered by any source
- Produce a synthesis draft that:
  - leads with the central claim
  - organizes supporting evidence by strength
  - acknowledges contradictions honestly
  - flags the most important gap
- Do not hide contradictions or smooth them over.
- Do not add sources the researcher has not provided.
```

---

## Expected behavior

- Write a real appreciation piece — not an audit grid, not a bullet-point review.
- Identify the skill's positioning clearly: what job it does, and for whom.
- Explain the mechanism: why the design choices (leading with claim, sorting by strength, requiring honest handling of contradictions) matter in practice.
- Surface real limits — what the skill cannot do, or where its model of "synthesis" may break.
- Avoid hollow opening sentences, symmetry padding, and machine-sounding transitions.
- Do not treat technically correct analysis as sufficient if the prose reads as stiff or template-driven.

## Dimensions primarily tested

- Low "AI flavor"
- Writing quality
- Mechanism explanation
- Thesis clarity
- Transfer value

## What makes this case a useful test

The `research-synthesizer` skill is technically clear and bounded enough that an AI can produce a correct-sounding appreciation without genuine insight.

This case is designed to catch output that:

- uses technically accurate language but reads as obviously machine-generated;
- opens with a hollow setup ("In the rapidly evolving landscape of AI-assisted research...");
- organizes every section into three symmetrical bullet points;
- uses inflated modifier phrases ("truly sophisticated", "remarkably well-structured") without grounding them;
- transitions between ideas with stock connectors ("It is worth noting that", "Furthermore", "Building on this");
- sounds like a polished summary rather than a genuine piece of thinking.

A strong answer does not need to be experimental or provocative. It does need to feel like it was shaped by a writer, not assembled from a template.
