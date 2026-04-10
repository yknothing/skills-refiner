# Case 10 — Targeted Hunt: find the best skill for a specific need

## Input

Use `skill-hunter` to find the best skills for writing commit messages. I want something that actually understands code changes, not just a template filler.

---

## Expected behavior

- Operate in Targeted Hunt mode (Mode 1).
- Interpret the need precisely: the user wants a skill that reads diffs and generates meaningful, context-aware commit messages — not a skill that applies conventional-commit templates blindly.
- Search across relevant sources, with major skill platforms/apps and X as discovery channels, then GitHub/author repositories for verification.
- Evaluate candidates using the quality framework, with emphasis on practical usefulness and context engineering.
- Return a curated shortlist (typically 3–5) with clear quality assessments.
- Identify a top pick with reasoning.
- If nothing fully meets the bar, say so and describe the gap.

## Dimensions primarily tested

- Need interpretation (distinguishing "understands code changes" from "applies templates")
- Quality judgment (structural quality assessment, not popularity)
- Curation quality (small, high-signal shortlist)
- Anti-noise discipline (not recommending the most-starred option by default)
- Gap identification (honest about ecosystem limitations)
