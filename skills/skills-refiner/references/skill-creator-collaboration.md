# Collaborating with skill-creator

This reference describes how `skills-refiner` and `skills-appreciation` work
alongside an available `skill-creator` creation and evaluation workflow. Exact
tools and packaging support depend on the installed implementation. These are
cooperation boundaries, not claims that another tool cannot make design judgments.

## Division of labor

### skill-creator owns

- Gathering requirements and drafting a new skill from scratch.
- Running with-skill vs baseline A/B test executions.
- Functional and behavioral evaluation, including quality, timing and exact
  token usage when available.
- Iterating on the skill based on user feedback and test results.
- Description optimization for triggering accuracy.
- Packaging and distributing `.skill` files.

### skills-refiner owns

- Deep structural audit and concrete improvements to a Skill's design quality,
  including the guidance needed by its actual execution workflow.
- Purpose-sensitive evaluation: judging engineering skills, creative skills, teaching skills, and research skills by criteria that actually fit their intent.
- Evidence discipline: separating what is directly observable from inference and uncertainty.
- Four-way extraction: classifying findings into directly adoptable, adoptable after redesign, valuable as pattern, and should-not-adopt.
- Integration planning when a skill needs to fit into an existing repository or workflow.
- Quality-first judgment of capability preservation and improvement, with cost
  assessed separately. Use only the dimensions and output depth relevant to
  the requested decision; no fixed scorecard is required.

### skills-appreciation owns

- Turning analysis into a publishable, teaching-grade article that helps readers understand why a skill works.
- Purpose-sensitive interpretation that does not flatten creative or exploratory skills into engineering checklists.
- Surfacing transferable design lessons that generalize beyond the specific skill under review.
- Low-AI-flavor writing in both English and Chinese.

## Where they connect

### After skill-creator finishes a skill → skills-refiner audits it

skill-creator's iteration loop produces a skill that passes its assertion tests and satisfies the user's feedback. But passing assertions does not guarantee strong design. A skill can pass every test case while still being:

- over-scoped or under-scoped for its stated purpose;
- fragile under inputs the test set did not cover;
- tightly coupled to one ecosystem with no portability;
- well-structured but missing important boundary constraints;
- suffering from context engineering problems invisible to assertion-based testing.

When a user finishes iterating with skill-creator, `skills-refiner` can run a design-level audit that covers what assertions cannot: structural coherence, reuse potential, governance gaps, context engineering quality, and whether the skill's stated purpose matches its actual center of gravity.

The typical handoff:

1. User creates and iterates a skill with skill-creator until tests pass and feedback is positive.
2. User invokes `skills-refiner` on the finished skill.
3. skills-refiner supplies the relevant design judgment, preserved capabilities,
   concrete guidance changes and acceptance scope.
4. The authorized implementation/evaluation workflow consumes those changes.
   Reuse applicable evidence; do not restart the whole cycle unnecessarily.

### After skills-refiner audits → skills-appreciation explains

When the audit is done and the skill is finalized, `skills-appreciation` can write an interpretation piece that:

- helps team members understand why the skill is designed the way it is;
- documents the design rationale in a readable, publication-quality format;
- surfaces transferable lessons for other skill builders;
- serves as onboarding material or internal documentation.

### After skill-creator runs evals → skills-refiner reviews eval quality

skill-creator generates assertion-based evals and measures pass rates. But the quality of the evals themselves matters: are the assertions meaningful, or do they test surface features that any response would satisfy? Are edge cases covered? Is the test set balanced?

skills-refiner can audit the eval set as a capability asset: is it testing the right things, is it discriminating enough, and is it covering the skill's actual risk surface?

## What skills-refiner should NOT do when collaborating

- In a design-audit request, do not duplicate existing functional testing or
  automatically launch model comparisons, description tuning or packaging.
- Treat reported passing tests as evidence for their actual cases and revision,
  not as an unconditional assumption that every required behavior works.
- When the user requests implementation or a comparison, continue within that
  authority using the available creation/evaluation workflow. Prepare any
  separately owned work with exact inputs, acceptance and unresolved questions.
- Deployment remains a separate authority and qualification boundary. Use the
  applicable packaging/governance mechanism rather than making this review a
  second installer.

Focus on the complementary work: deep design judgment, purpose-sensitive
evaluation, evidence-grounded structural analysis and integration planning.
Tests, reports and handoffs are useful when they improve or establish quality;
their existence alone is not the outcome.

## Practical invocation patterns

### Audit a skill-creator output

> I just finished creating this skill with skill-creator. Use `skills-refiner` to audit the design quality — focus on structure, boundaries, context engineering, and anything the assertion tests might have missed.

### Audit then iterate

> Use `skills-refiner` on this skill. Give me the top 3 refinement actions so I can take them back to skill-creator for the next iteration.

### Post-creation interpretation

> Use `skills-appreciation` on this skill we just built. Write an explanation that helps my team understand why it is designed this way and what they should know before using it.

### Audit eval quality

> Use `skills-refiner` on this eval set. Are the assertions testing the right things? What edge cases are missing?
