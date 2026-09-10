# Case 08 — Auditing a skill-creator output

## Input

I just finished building this skill with skill-creator. All assertion tests pass and user feedback was positive. Use `skills-refiner` to audit the design quality — focus on what the tests might have missed.

---

```markdown
---
name: api-docs-generator
description: Generate API documentation from code. Use when the user wants to create or update API docs, document endpoints, generate OpenAPI specs, or produce developer-facing reference documentation from source code.
---

# api-docs-generator

Generate structured API documentation from source code files.

## Steps

1. Ask the user which files or directories contain the API code.
2. Read the source files and identify:
   - HTTP endpoints (routes, methods, paths)
   - Request parameters (query, path, body)
   - Response formats
   - Authentication requirements
3. Generate documentation in the requested format:
   - Markdown (default)
   - OpenAPI 3.0 YAML
   - HTML page
4. Group endpoints by resource or domain.
5. Include example request/response pairs when inferable from the code.
6. Flag endpoints that have unclear or missing parameter documentation in the source.

## Output format

# API Documentation

## [Resource Name]

### [METHOD] [path]

**Description:** ...

**Parameters:**
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| ...  | ...| ...  | ...      | ...         |

**Response:**
```json
{ ... }
```

## Notes

- If the codebase uses a framework (Express, FastAPI, Spring, etc.), adapt the extraction logic to that framework's patterns.
- Prefer accuracy over completeness: do not invent parameters or responses that are not visible in the code.
- When documentation already exists in the code (JSDoc, docstrings, annotations), incorporate it.
```

---

**Eval results provided by skill-creator:**
- 3 test cases run, all passing (100% pass rate)
- Test 1: Express.js REST API → generated correct endpoint docs
- Test 2: FastAPI Python service → generated correct OpenAPI YAML
- Test 3: Spring Boot controller → generated correct grouped docs
- Average generation time: 45 seconds
- User feedback: "Looks good, does what I need"

---

## Expected behavior

- Acknowledge the supplied passing test results within their stated scope; do
  not claim to have independently verified them.
- Examine consequential design questions beyond those samples: source and
  protocol boundaries, required context, output-format instructions, framework
  adaptation, uncertainty and unsupported input handling.
- Distinguish an observed instruction conflict from a plausible untested risk.
  Supporting several formats does not by itself require splitting the Skill;
  unsupported protocols may be explicitly excluded rather than implemented.
- Preserve source accuracy and useful extraction guidance. Propose concrete
  changes for material findings without requiring a fixed issue count.
- Make refinements usable by the creation/evaluation owner. This request is a
  design audit; do not run tests, generate assertions or tune the description.

## Dimensions primarily tested

- Judgment quality (design-level issues invisible to assertion tests)
- Evidence discipline (skill file + eval results as evidence, not full repository)
- Collaboration awareness (does not duplicate skill-creator's job, frames actions for skill-creator's iteration loop)
- Report structure (structured, readable, decision-oriented)
