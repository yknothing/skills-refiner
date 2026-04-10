# Golden anchors — Case 14: Target-repo routing after discovery

## What a strong answer must do

### Need interpretation
- Recognize that the user wants **both discovery and routing**, not just discovery.
- Treat `acme/team-skills` as the target context that determines what should happen after the hunt.
- Keep the two strategies distinct:
  - preserve strong source skills through an upstream-linked path;
  - use `skills-refiner` when adaptation or selective absorption is needed.

### Routing judgment
- Recommend at least one candidate with an explicit adoption path.
- Explain why a strong intact skill should stay upstream-linked instead of being rewritten locally.
- Explain why a promising but imperfect skill should go through `skills-refiner` rather than being imported verbatim.
- Avoid treating "integration" as one undifferentiated bucket.
- For upstream-linked picks, explain the boundary between acceptable local wrapping and a real local fork.
- For upstream-linked picks, identify who remains the source of truth and what would force reclassification into absorb-and-refine.

### Discovery discipline
- Still perform a real targeted hunt: multiple relevant sources, quality filtering, shortlist, and a top pick.
- Do not let target-repo routing replace normal quality judgment.

---

## Key judgment anchors

### A strong answer will
- Produce a curated shortlist rather than one winner with no alternatives.
- Mark each serious candidate as one of:
  - upstream-linked;
  - absorb-and-refine via `skills-refiner`;
  - reject.
- Explicitly note that a filesystem symlink is only one possible mechanism and should not be assumed by default.
- Clarify that local metadata, wrappers, or usage notes may still be compatible with upstream-linked adoption, but silent source edits are not.
- Make clear that once the imported skill itself is locally edited beyond that thin layer, it is no longer upstream-linked.
- Give one clear next move for the user.

### A strong answer may also
- Note that some of the best candidates may be too opinionated to absorb cleanly, which is exactly why they should stay upstream-linked.
- Note that some candidates contain strong extraction logic but weak packaging, making them better absorb-and-refine inputs than direct imports.
- Identify a broader ecosystem gap: many skills are either too generic to preserve intact or too rigid to adapt cleanly.

---

## Failure signals

Treat the answer as **failing** if it:
- gives only discovery recommendations with no routing guidance;
- says everything should be copied into the target repository;
- says everything should remain external with no judgment about fit;
- treats upstream-linked adoption and absorb-and-refine as interchangeable;
- assumes a literal symlink is obviously the right solution;
- uses `skills-refiner` as a generic label without explaining why handoff is needed.

## Score floor to pass

- Need interpretation: ≥ 4
- Quality judgment: ≥ 4
- Curation quality: ≥ 4
- Output clarity: ≥ 4
- Overall: ≥ 3.8 average across all applicable dimensions
