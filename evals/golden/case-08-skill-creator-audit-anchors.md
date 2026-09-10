# Golden anchors — Case 08: auditing a skill-creator output

## What a strong answer must do

### Collaboration awareness
- Acknowledge the reported functional assertion results within their three-case
  scope, then focus on the requested design audit without rerunning them.
- In this design-audit request, do not run tests, generate assertions or tune
  the description; prepare concrete refinements for the existing workflow.
- Frame the top refinement actions as items the user can take directly back into skill-creator's iteration loop.

### Object identification
- Identify the target as a **code-reading and documentation-generation skill** with multiple output format support.
- Recognize that it was produced through skill-creator's iteration process and arrived with passing test results.
- Note that the test set covers only three frameworks (Express, FastAPI, Spring Boot) and all are REST-based HTTP APIs.

### Design-level judgment (what tests miss)
A strong answer identifies consequential concerns supported by this input and
explains a usable refinement. The following are candidate concerns, not a quota
or a requirement to expand scope:

- **Boundary ambiguity**: the broad API claim is not aligned with its HTTP
  extraction instructions. State the supported boundary and behavior outside
  it; adding support for GraphQL, gRPC or other styles is not automatically needed.
- **Context engineering gap**: the skill instructs the agent to "read the source files" but provides no strategy for large codebases — no guidance on context window management, file prioritization, or how to handle a directory with hundreds of source files.
- **Output-format distinction**: the shown Markdown template does not define
  the promised OpenAPI/HTML behavior. Clarify the relevant output requirements;
  do not split the Skill unless the actual workflow justifies the extra entities.
- **Framework fragility**: "adapt the extraction logic to that framework's patterns" delegates the hardest part of the job without any structure. As frameworks evolve or when uncommon frameworks appear, the skill provides no fallback behavior.
- **Missing failure modes**: no guidance on what to do when the code has no clear endpoint patterns, when the framework is unrecognized, when documentation in the code contradicts the actual behavior, or when endpoints are dynamically generated.
- **Test coverage uncertainty**: the supplied summaries describe three HTTP
  API successes; they do not establish whether edge cases, mixed styles or
  failure scenarios were checked. The 100% pass rate supports those reported
  results, not broad robustness; the actual assertions and outputs are absent.

### Refinement actions
Selected actions should be concrete enough to feed directly into skill-creator's
iteration loop. Useful choices include:

- Define explicit scope boundaries: state which API styles are supported and what the skill should do when encountering unsupported patterns.
- Add a context management strategy: guidance on how to handle large codebases, prioritize which files to read, and recognize when the codebase is too large for a single pass.
- Separate or clarify output format handling: either split into focused sub-modes or add clear per-format instructions that prevent OpenAPI structural errors.
- Add failure and fallback behavior: what happens when the framework is unrecognized or endpoints cannot be reliably extracted.

---

## Failure signals

Treat the answer as **failing** if it:
- Runs tests, generates assertions or tunes the description instead of the
  requested design audit
- Only addresses surface issues visible from the test results rather than digging into design-level concerns
- Treats the 100% pass rate as evidence that the skill is well-designed
- Produces generic advice not specific to this skill's actual design gaps
- Fails to frame refinement actions in terms the user can take to skill-creator

## Quality boundary

An answer must identify a material purpose/mechanism mismatch, offer a usable
bounded refinement, and preserve source fidelity and the supported use case.
Reject fabricated source/runtime evidence or changes justified only by a need
to list more problems. Apply the shared rubric without a report-shape score or
an average that can mask a critical failure.
