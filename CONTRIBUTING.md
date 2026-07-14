# Contributing to skills-refiner

## Repository structure

```
skills/
├── skills-refiner/       # Design-level audit skill
├── skills-appreciation/  # Teaching-grade interpretation skill
├── skill-hygiene/        # Installed skill evaluation
│   ├── bin/skill-scan.sh
│   ├── bin/skills-refiner # Node 24 cleanup CLI bootstrap
│   ├── lib/common.sh      # Deployment mirror for standalone installs
│   ├── lib/cleanup-*.mjs  # Cleanup contracts, planning, adapter, transactions
│   ├── native/cleanup-macos-helper.c
│   └── tests/             # Scan, CLI, contract, adapter, transaction gates
└── skill-debug/          # Skill observability
    ├── bin/skill-probe.sh
    ├── bin/skill-trace.sh
    ├── bin/skill-dashboard.sh
    ├── lib/common.sh      # Canonical authoring source
    └── tests/
        ├── test-doctor.sh
        ├── test-trace.sh
        ├── test-probe.sh
        ├── test-dashboard.sh
        ├── test-install-layout.sh
        ├── test-platform-contract.sh
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

- Read-only shell behavior targets native macOS and POSIX Bash on Linux. WSL 2 with a Linux-filesystem `HOME` remains design-supported for those existing tools, pending a dedicated runner. Windows Git Bash has a narrower read-only/trace contract. Cleanup mutation and `setup-cli` are macOS-only; do not broaden that claim from portable contract tests. See `docs/platform-support.md`.
- Test BSD/GNU differences with both `stat -f` (macOS) and `stat -c` (Linux/Git Bash) variants. Keep shell entrypoints LF-only through `.gitattributes`.
- Resolve HOME without `eval`: prefer `$HOME`, then `getent passwd`, then macOS `dscl`, then common home roots; fail clearly if no home directory can be determined.
- Treat `skills/skill-debug/lib/common.sh` as the canonical authoring source for shared filesystem, frontmatter, topology, canonical path, and normalized-hash behavior.
- `skills/skill-hygiene/lib/common.sh` is a byte-identical deployment mirror required because skills CLI can install `skill-hygiene` without `skill-debug`. After changing the canonical source, update the mirror in the same change; do not fork behavior. `test-install-layout.sh` fails when the copies differ.
- Include `--help` / `-h` support in all user-facing scripts.
- Use `set -o pipefail` but not `set -e` (handled by callers).
- Require `jq` for JSON processing. Check availability gracefully.

### Cleanup CLI and native helper

- Cleanup runs on Node.js major 24. Do not silently accept another major or add a
  runtime fallback with different filesystem semantics.
- `cleanup-macos-helper.c` is the only mutation authority in this release. Keep
  planning and contracts portable, but make non-macOS mutation fail closed with
  exit `3` and zero filesystem change.
- The first helper build requires Apple Command Line Tools. Status and undo must
  remain bound to the verified persistent helper cache and must not silently
  compile or select a different helper after a transaction exists.
- Preserve the product boundary: installed/distributed entries may be
  quarantined; standalone source/authoring repositories are never mutation
  targets.
- Keep batch items as independent transactions. Stop at the first failure and
  preserve exact truth for any already committed prefix.

### Testing

- Every shell script in `bin/` should have a matching test file in `tests/`.
- Every user-facing Bash launcher must be exercised by a matching shell test.
- Run every `.mjs` test suite with `node --test`; any cleanup `.mjs` behavior
  change must add or update focused node:test coverage.
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
bash skills/skill-debug/tests/test-platform-contract.sh
cmp skills/skill-debug/lib/common.sh skills/skill-hygiene/lib/common.sh

# Node 24 cleanup contracts and CLI
node --test skills/skill-hygiene/tests/test-cleanup-contract.mjs
node --test skills/skill-hygiene/tests/test-cleanup-core.mjs
NODE24_BIN="$(command -v node)" bash skills/skill-hygiene/tests/test-cleanup-cli.sh

# macOS-only mutation, recovery, and native-helper gates
node --test skills/skill-hygiene/tests/test-cleanup-macos.mjs
node --test skills/skill-hygiene/tests/test-cleanup-transaction.mjs
/usr/bin/xcrun clang -std=c17 -Wall -Wextra -Werror -fsyntax-only \
  skills/skill-hygiene/native/cleanup-macos-helper.c
```

All tests must use a path-checked sandbox `HOME` and exercise the real SUT. Mock
only external boundaries; do not mock the cleanup planner, transaction engine,
or adapter being asserted. macOS fault-injection and installed-layout mutation
tests are release gates, not optional local probes. On Ubuntu, assert the exact
unsupported JSON/exit `3`/zero-mutation boundary. Windows remains a bounded
read-only Git Bash gate.

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
- Keep commits independently clean and reviewable; do not mix contracts,
  mutation mechanics, CLI UX, installed-layout certification, and documentation
  unless the change cannot be verified separately.
- Update `README.md` and `examples/` when adding or changing skill behavior.
- If adding a new shell script, add corresponding tests.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
