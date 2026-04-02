# Evaluation rubric

Use this rubric to judge whether a `skills-refiner` run is actually good.

## Scoring dimensions

Score each dimension from 1 to 5.

### 1. Object identification
Does the answer correctly identify what the target really is?

- **5**: identifies the object class accurately and explains the center of gravity clearly
- **3**: broadly correct but shallow or partially confused
- **1**: misclassifies the target or treats everything as a generic skills repository

### 2. Stage control
Does the answer behave correctly for the context?

- **5**: runs only Stage 1 when no `target_repo` is present; runs Stage 2 only when justified
- **3**: mostly correct, but integration logic appears too early or too weakly
- **1**: forces integration logic without justification, or fails to enter integration when clearly required

### 3. Report structure
Does the output follow the intended structure and remain understandable?

- **5**: stable structure, strong summary, clear strengths/weaknesses, no analysis sprawl
- **3**: structure is present but uneven or too dense
- **1**: reads like an unstructured analysis dump

### 4. Judgment quality
Are the main strengths, weaknesses, and boundaries actually insightful?

- **5**: identifies the real strengths and real problems, not generic talking points
- **3**: some useful judgment, but mixed with cliché or surface observations
- **1**: vague praise, generic criticism, or shallow restatement of README content

### 5. Transfer discipline
Does the answer separate what should be reused from what should not?

- **5**: four-way extraction is meaningful, specific, and boundary-aware
- **3**: categories are present but fuzzy
- **1**: treats everything as reusable or collapses the categories into vague advice

### 6. Evidence discipline
Does the answer respect the evidence available?

- **5**: clearly distinguishes direct evidence, inference, and uncertainty
- **3**: mostly grounded, but overclaims in places
- **1**: makes repository-wide judgments from thin or partial evidence without saying so

### 7. Integration quality (Stage 2 only)
If Stage 2 applies, is the integration work useful?

- **5**: identifies complementary parts, conflicts, direct imports, redesign-required imports, and explicit rejections, then produces an actionable plan
- **3**: some useful integration thinking, but not concrete enough
- **1**: generic advice or blind copy suggestions

### 8. Language discipline
Does the answer keep language, tone, and terminology under control?

- **5**: one consistent output language, clear headings, low AI-sounding phrasing, mature report tone
- **3**: mostly consistent, with some drift or stiffness
- **1**: mixed-language headings, obvious prompt-speak, or repetitive AI-style transitions

### 9. Collaboration awareness (when auditing skill-creator outputs)
Does the answer correctly position itself relative to skill-creator?

- **5**: focuses entirely on design-level concerns that assertion-based testing does not cover; frames refinement actions for skill-creator's iteration loop; does not duplicate functional testing
- **3**: mostly correct positioning, but slips into functional-testing territory or gives actions that do not map cleanly to skill-creator's workflow
- **1**: duplicates skill-creator's job (attempts to run tests, generate assertions, or optimize the description) or ignores the collaboration context entirely

## Quick pass/fail checks

A run should be considered **failing** if any of the following happens:

- it forces repository integration without a target repository or clear integration intent;
- it mistakes popularity or size for design quality;
- it fails to distinguish what should be rejected;
- it overclaims from README-only or partial evidence;
- it ignores the intended report structure;
- it produces a dense but low-understandability response.

A run should be considered **strong** if it does all of the following:

- identifies the real center of gravity of the target;
- surfaces the 2-3 most important strengths and weaknesses rather than listing everything;
- keeps the report readable;
- makes the four-way extraction useful;
- produces refinement or integration actions that someone could actually use.
