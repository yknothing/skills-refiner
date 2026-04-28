# Contributing to skills-refiner

## Repository structure

```
skills/
├── skills-refiner/       # Design-level audit skill
├── skills-appreciation/  # Teaching-grade interpretation skill
├── skill-hygiene/        # Installed skill evaluation
│   ├── bin/skill-scan.sh
│   └── tests/test-scan.sh
└── skill-debug/          # Skill observability
    ├── bin/skill-probe.sh
    ├── bin/skill-trace.sh
    ├── bin/skill-dashboard.sh
    └── tests/
examples/                 # Usage examples for all four skills
evals/                    # Evaluation rubrics and cases
```

## Development guidelines

### Skill design

- **SKILL.md files** are the primary skill interface. Keep instructions clear and actionable.
- Follow the project's core principle: **AI judges, scripts collect.** Shell scripts gather facts; the AI applies judgment.
- Do not add hardcoded rules that override AI judgment. Prefer heuristic flags that the AI interprets in context.
- Respect the standard skill topology: canonical source in `~/.agents/skills/`, symlinked to agent directories.

### Shell scripts

- All scripts must work on both macOS and Linux. Test with both `stat -f` (macOS) and `stat -c` (Linux) variants.
- Use `${HOME:-$(eval echo ~$(whoami))}` for HOME directory fallback — do not hardcode OS-specific paths.
- Include `--help` / `-h` support in all user-facing scripts.
- Use `set -o pipefail` but not `set -e` (handled by callers).
- Require `jq` for JSON processing. Check availability gracefully.

### Testing

- Every shell script in `bin/` should have a matching test file in `tests/`.
- Tests create sandboxed environments in temp directories to avoid affecting the user's actual skill installation.
- Override `HOME` to the sandbox directory when running tests.
- Use `assert_eq`, `assert_contains`, `assert_not_contains` helpers for consistent test output.
- Clean up temp directories with `trap "rm -rf $SANDBOX" EXIT`.

### Running tests

```bash
# Run all tests
bash skills/skill-hygiene/tests/test-scan.sh
bash skills/skill-debug/tests/test-trace.sh
bash skills/skill-debug/tests/test-probe.sh
bash skills/skill-debug/tests/test-dashboard.sh
```

### SKILL.md files

- Must have YAML frontmatter with `name` and `description` fields.
- `description` should contain clear trigger conditions so agents know when to activate the skill.
- Keep the skill well-scoped: one clear job per skill.

### Evals

- Eval cases go in `evals/cases/`, golden anchors in `evals/golden/`.
- Cases are anchor-based, not string-match. The goal is stable judgment, not exact output reproduction.
- Both `skills-refiner` and `skills-appreciation` have separate rubrics.

## Pull request guidelines

- Run all tests before submitting.
- Keep changes focused: one logical change per PR.
- Update `README.md` and `examples/` when adding or changing skill behavior.
- If adding a new shell script, add corresponding tests.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
