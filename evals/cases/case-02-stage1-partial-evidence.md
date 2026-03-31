# Case 02 — Stage 1 only: partial evidence (README-only snapshot)

## Input

Use `skills-refiner` on this repository.

---

**Evidence available:** README.md only.

```markdown
# awesome-agent-skills

A collection of reusable skills for AI coding agents.

## Skills included

- `pr-review` — Review pull requests for common issues
- `test-generator` — Generate tests for existing code
- `doc-writer` — Write or update documentation
- `refactor-advisor` — Suggest and apply refactoring patterns
- `security-audit` — Check code for common security issues

## Installation

Copy the skill files into your agent's skills directory.

## Usage

Invoke the skill by name when talking to your agent.

## License

MIT
```

---

## Expected behavior

- Identify this as a multi-skill repository based on README evidence alone.
- Run Stage 1 only (no `target_repo` present).
- Explicitly flag that only README evidence is available.
- Avoid overclaiming about the actual quality, structure, or maturity of the individual skills.
- Still surface the most useful observations possible given the evidence.

## Dimensions primarily tested

- Object identification (multi-skill repo, README-only evidence)
- Evidence discipline (must not claim certainty about skill quality from README alone)
- Stage control (Stage 1 only, no forced integration)
- Judgment quality (what can and cannot be inferred)
