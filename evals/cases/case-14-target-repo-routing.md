# Case 14 — Targeted Hunt with target-repo routing

## Input

Use `skill-hunter` to find the best skills for research synthesis and long-form source distillation. Treat `acme/team-skills` as `target_repo`.

I want two different outcomes depending on what you find:
- if a source skill is already excellent as-is and it would be better to preserve it and keep following upstream improvements, tell me that clearly;
- if a skill needs modification, localization, or I only want its strongest ideas, route it to `skills-refiner` for absorb-and-refine work instead of pretending it should be imported unchanged.

Do not collapse these into one generic "integration" answer.

---

## Expected behavior

- Operate in Targeted Hunt mode (Mode 1).
- Complete the hunt first: understand the need, search relevant sources, and produce a curated shortlist.
- Treat `target_repo` as a routing context, not as a reason to skip discovery.
- Distinguish two adoption paths clearly:
  - upstream-linked adoption for skills that should remain intact and keep tracking upstream;
  - absorb-and-refine handoff for skills that are promising but need redesign or selective extraction.
- Identify a top pick and classify its path.
- Avoid assuming that a literal symlink is the right default implementation.
- For upstream-linked picks, state what local customization is still acceptable without turning the result into a hidden fork.
- If nothing deserves either path, say so honestly.

## Dimensions primarily tested

- Need interpretation (understanding the hunt plus adoption-routing intent)
- Quality judgment (which skills are strong enough to preserve intact versus only worth partial extraction)
- Curation quality (small shortlist with explicit routing, not generic integration advice)
- Gap identification (honest when the ecosystem does not cleanly satisfy either path)
- Output clarity (visible, actionable distinction between the two strategies)
