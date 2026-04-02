# Golden anchors — Case 08: auditing a skill-creator output

## What a strong answer must do

### Collaboration awareness
- Acknowledge that the skill passes its functional assertion tests — then move past functional testing entirely.
- Not attempt to run tests, generate assertions, optimize the description, or do any work that belongs to skill-creator.
- Frame the top refinement actions as items the user can take directly back into skill-creator's iteration loop.

### Object identification
- Identify the target as a **code-reading and documentation-generation skill** with multiple output format support.
- Recognize that it was produced through skill-creator's iteration process and arrived with passing test results.
- Note that the test set covers only three frameworks (Express, FastAPI, Spring Boot) and all are REST-based HTTP APIs.

### Design-level judgment (what tests miss)
A strong answer must identify at least 3 of the following design concerns:

- **Boundary ambiguity**: the skill says "API documentation from code" but gives no guidance on non-REST APIs (GraphQL, gRPC, WebSocket, event-driven APIs). A user invoking it for GraphQL will get unpredictable behavior.
- **Context engineering gap**: the skill instructs the agent to "read the source files" but provides no strategy for large codebases — no guidance on context window management, file prioritization, or how to handle a directory with hundreds of source files.
- **Scope creep across output formats**: supporting Markdown, OpenAPI YAML, and HTML in a single skill without clear separation creates three maintenance surfaces. The OpenAPI format has strict structural requirements that differ fundamentally from the Markdown and HTML formats.
- **Framework fragility**: "adapt the extraction logic to that framework's patterns" delegates the hardest part of the job without any structure. As frameworks evolve or when uncommon frameworks appear, the skill provides no fallback behavior.
- **Missing failure modes**: no guidance on what to do when the code has no clear endpoint patterns, when the framework is unrecognized, when documentation in the code contradicts the actual behavior, or when endpoints are dynamically generated.
- **Test coverage gap**: all three passing tests are REST APIs with clear endpoint patterns — the tests do not cover edge cases, mixed API styles, or failure scenarios. The 100% pass rate is uninformative about real robustness.

### Refinement actions
The top 3 actions should be concrete enough to feed directly into skill-creator's iteration loop. At least 2 should be from:

- Define explicit scope boundaries: state which API styles are supported and what the skill should do when encountering unsupported patterns.
- Add a context management strategy: guidance on how to handle large codebases, prioritize which files to read, and recognize when the codebase is too large for a single pass.
- Separate or clarify output format handling: either split into focused sub-modes or add clear per-format instructions that prevent OpenAPI structural errors.
- Add failure and fallback behavior: what happens when the framework is unrecognized or endpoints cannot be reliably extracted.

---

## Failure signals

Treat the answer as **failing** if it:
- Attempts to run tests, generate assertions, or optimize the skill's description (these are skill-creator's responsibilities)
- Only addresses surface issues visible from the test results rather than digging into design-level concerns
- Treats the 100% pass rate as evidence that the skill is well-designed
- Produces generic advice not specific to this skill's actual design gaps
- Fails to frame refinement actions in terms the user can take to skill-creator

## Score floor to pass

- Judgment quality: ≥ 4 (must surface design-level issues invisible to assertion tests)
- Evidence discipline: ≥ 4 (must correctly handle the combination of skill file + eval results as evidence)
- Report structure: ≥ 4
- Stage control: 5 (Stage 1 only, no forced integration)
- Overall: ≥ 4.0 average across all applicable dimensions
