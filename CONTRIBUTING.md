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
        ├── test-trace.sh
        ├── test-probe.sh
        ├── test-dashboard.sh
        ├── test-install-layout.sh
        └── test-observability-regressions.sh
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
- Resolve HOME without `eval`: prefer `$HOME`, then `getent passwd`, then macOS `dscl`, then common home roots; fail clearly if no home directory can be determined.
- Keep shared filesystem, frontmatter, topology, canonical path, and normalized hash behavior in `skills/skill-debug/lib/common.sh` (it ships inside the skill-debug skill so per-skill installs carry it); do not fork those facts across individual scripts.
- Include `--help` / `-h` support in all user-facing scripts.
- Use `set -o pipefail` but not `set -e` (handled by callers).
- Require `jq` for JSON processing. Check availability gracefully.

### Testing

- Every shell script in `bin/` should have a matching test file in `tests/`.
- Tests create sandboxed environments in temp directories to avoid affecting the user's actual skill installation.
- Override `HOME` to the sandbox directory when running tests.
- Use `assert_eq`, `assert_contains`, `assert_not_contains` helpers for consistent test output.
- Clean up temp directories through a path-checked cleanup function that only operates on known temporary roots.

### Running shell integration tests

```bash
# Run shell integration tests
bash skills/skill-hygiene/tests/test-scan.sh
bash skills/skill-debug/tests/test-doctor.sh
bash skills/skill-debug/tests/test-trace.sh
bash skills/skill-debug/tests/test-probe.sh
bash skills/skill-debug/tests/test-dashboard.sh
bash skills/skill-debug/tests/test-install-layout.sh
bash skills/skill-debug/tests/test-observability-regressions.sh
```

The `evals/` directory contains human/model review anchors, not an automated release gate. Add an explicit runner before treating evals as required CI.

### SKILL.md files

- Must have YAML frontmatter with `name` and `description` fields.
- `description` must stay within the runtime loader limit of 1024 characters. Put extended trigger lists and examples in the body, not the frontmatter.
- `description` should contain clear trigger conditions so agents know when to activate the skill.
- Keep the skill well-scoped: one clear job per skill.

### Evals

- Eval cases go in `evals/cases/`, golden anchors in `evals/golden/`.
- Cases are anchor-based, not string-match. The goal is stable judgment, not exact output reproduction.
- Both `skills-refiner` and `skills-appreciation` have separate rubrics.

## Pull request guidelines

- Run the shell integration tests before submitting.
- Keep changes focused: one logical change per PR.
- Update `README.md` and `examples/` when adding or changing skill behavior.
- If adding a new shell script, add corresponding tests.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
