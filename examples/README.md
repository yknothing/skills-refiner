# Example usage

These examples show the intended invocation style. The skill is designed to keep the explicit input surface small.

## 1) Audit and refine the current repository

Use `skills-refiner` on this repository.

Expected behavior:
- infer the source object from the current repository page or attached content;
- run Stage 1 only;
- return a structured review plus top refinement actions.

## 2) Review a single skill file

Use `skills-refiner` on this skill. Focus on boundaries, reuse, context engineering, and improvement opportunities.

Expected behavior:
- treat the current skill file or pasted content as the source object;
- assess whether it is too broad, too vague, too platform-bound, or too hard to maintain;
- return a refinement-oriented report.

## 3) Audit a repository and integrate into another repository

Use `skills-refiner`, and treat `yknothing/prodcraft` as `target_repo`.

Expected behavior:
- complete Stage 1 first;
- then run compatibility and integration analysis for `yknothing/prodcraft`;
- provide a Minimum Viable Integration Plan and a High-Leverage Enhancement Plan.

## 4) Compare what should be preserved versus rejected

Use `skills-refiner` on this repository. I care most about what should be preserved, what should be simplified, and what should be rejected.

Expected behavior:
- keep the report tight;
- emphasize refinement judgment and four-way extraction;
- do not force integration planning unless the context clearly calls for it.

## Notes

- `target_repo` is optional.
- If `target_repo` is not provided, the skill should stop after Stage 1 and return refinement actions.
- If `target_repo` is provided or clearly implied, the skill should continue into Stage 2 automatically.
- Output language should follow: explicit user instruction > current configuration > dominant conversation language > default.
