# macOS Skill Disposition CLI Verification

## Decision

The local implementation and installed-surface gates are approved for review.
No P0, P1, or P2 finding remains open. Merge remains blocked until the current
pull-request head passes the required `macos-latest`, `ubuntu-latest`, and
`windows-latest` jobs.

This record covers the product revision
`effa96e84b46cc2facf20b67832e115effc8c23d`. The verification record itself is
documentation-only and is committed after that tested revision. The exact
merge-candidate revision is certified by its GitHub pull-request check suite
rather than by backfilling remote results into this local record.

## Scope and claim boundary

- Mutation authority: native macOS only.
- Mutation targets: locally installed or distributed skill entries only.
- Source and authoring repositories: review-only and byte/Git-object preserved.
- Linux/Ubuntu: read-only review plus explicit unsupported mutation/status
  responses; exit `3`, zero mutation.
- WSL 2 with a Linux-filesystem `HOME`: existing read-only/Linux boundary is
  design-supported, but Windows-host integration is not certified; a dedicated
  WSL runner remains pending.
- Windows Git Bash: existing bounded read-only/trace contract only.
- Native Windows, PowerShell, and `cmd.exe` mutation: not implemented.
- Permanent purge: not implemented. Retire moves the exact reviewed entry into
  a recoverable, no-clobber quarantine transaction.
- Quarantine does not terminate skill state cached by a running Agent. An
  installer may rehydrate the active entry, and the system never automatically
  re-quarantines it.
- Undo never overwrites an occupied active path. An occupied path, missing or
  changed quarantine payload, or identity drift returns conflict or
  recovery-required instead of claiming restoration.

## Observed environment

| Fact | Observed value |
|---|---|
| Date/time boundary | 2026-07-15, Asia/Singapore local host |
| `sw_vers -productVersion` | `27.0` |
| `sw_vers -buildVersion` | `26A5378j` |
| `uname -m` | `arm64` |
| Node.js | `v24.18.0` |
| jq | `jq-1.7.1-apple` |
| Bash | `GNU bash 3.2.57(1)-release` |
| ShellCheck | `0.11.0` |
| Apple Clang | `21.0.0 (clang-2100.1.1.101)` |
| Clang target | `arm64-apple-darwin27.0.0` |
| Git | `2.51.0` |

This is evidence for the exact observed host, not every macOS release or
architecture. `macos-latest` is a moving CI label. Although the helper accepts
`x86_64`, that architecture is not certified by this local run.

## Commands and results

All commands below ran from a clean worktree at the tested product revision.

| Command/gate | Exit | Observed result |
|---|---:|---|
| `node --test` over cleanup contract/core/macOS/transaction suites | `0` | 99 passed, 0 failed |
| `test-cleanup-cli.sh` with Node 24 and expected macOS family | `0` | 267 passed |
| `test-install-layout.sh` with Node 24 | `0` | 145 passed |
| `test-scan.sh` | `0` | 94 passed |
| `test-doctor.sh` | `0` | smoke pass |
| `test-trace.sh` | `0` | 99 passed |
| `test-probe.sh` | `0` | 27 passed |
| `test-dashboard.sh` | `0` | 21 passed |
| `test-observability-regressions.sh` | `0` | 14 passed |
| `test-platform-contract.sh` | `0` | 26 passed |
| shared `common.sh` byte comparison | `0` | exact match |
| all shell entrypoints through `bash -n` | `0` | no syntax failures |
| all shell entrypoints through `shellcheck --severity=error` | `0` | no findings |
| every cleanup `.mjs` through Node 24 `--check` | `0` | no syntax failures |
| Clang C17 `-Wall -Wextra -Werror -fsyntax-only` | `0` | silent pass |
| Clang static analyzer with text output | `0` | silent pass |
| `npx --yes skills@latest add . --list` | `0` | all four skills discovered |
| frontmatter description byte checks | `0` | all four below loader limit; `skill-hygiene` 260 bytes excluding newline |
| isolated `skill-scan.sh --json` over installed `skill-hygiene` | `0` | correct name; static runtime state `unknown`, `loadable:null`, no proven blocker |
| local Markdown-reference validation | `0` | all relative references exist |
| `git diff --check b7ae763af59fba031810d954b2fec5d6207fae29...effa96e84b46cc2facf20b67832e115effc8c23d` | `0` | no whitespace errors |
| `git show --check` for `b7ae763af59fba031810d954b2fec5d6207fae29..effa96e84b46cc2facf20b67832e115effc8c23d` | `0` | all 22 commits clean |

Static loader preflight intentionally remains `unknown`; it does not impersonate
a real host Agent loader. Selective-install runtime behavior is instead covered
by the 145-test installed-layout suite.

## Supplementary installed-surface transaction observation

An additional uncommitted, one-use harness copied only `skill-hygiene` into an
isolated HOME, created one Git-backed source skill and one distributed symlink,
then executed `review -> decisions -> plan -> apply -> status -> undo`. It
removed its entire `/tmp` sandbox and transcript afterward and left the
repository worktree clean. The exact values below are therefore an
operator-attested local observation, not a retained or independently
reproducible release gate. The checked-in 99-test native suite, 267-test CLI
suite, 145-test installed-layout suite, and remote CI remain the reproducible
gates.

| Evidence | Exact value |
|---|---|
| Review schema | `skills-refiner.cleanup.review.v1` |
| Review fingerprint | `sha256:6cfff9c6b741b8190f334c98347d2ed5b2807e6ea745584eeeaa920a917dc6f1` |
| Plan schema | `skills-refiner.cleanup.plan.v1` |
| Plan hash | `sha256:29dc892b85762227c3deaa0e102b5eb04adac68eb6b44d02ecea0484be4ef4fe` |
| Transaction ID | `sha256:f35d4578d4523589a0e38e032a0b4ea26e3a6d104776c0f8cf479da279853c66` |
| Execution identity hash | `sha256:ee9bc745b596a4dc3d945f197466c390bc87a8f441d35903e7ba3c0e03994cd5` |
| Manifest hash before apply | `sha256:4eae4bc5e149ec8939d6382c48f3645a198e6e1df2dcbd9c16aea028ed61339e` |
| Manifest hash after undo | `sha256:4eae4bc5e149ec8939d6382c48f3645a198e6e1df2dcbd9c16aea028ed61339e` |
| Persistent helper binary hash | `sha256:1805b942b43f29c96e4fef2a15850c26f5649893b5ff1c59ba97ae471735d0d6` |
| Source fixture commit | `4ddadf91a4c043c672ac13b9b78b8c895cc7fcf7` |
| Source SHA-256 before/after | `sha256:40837289a268b00b0f36543b3dc785ca5a917e0bbad6a44e4ca5261c976645ce` |
| Source Git object before/after | `ff6cef294c83b12054e6bb0a21872573edc045d6` |
| Final source Git status | empty/clean |

The original, quarantined, and restored symlink all had device `16777234`, inode
`209456054`, and raw-link-target Base64
`L3ByaXZhdGUvdG1wL3NraWxscy1yZWZpbmVyLXZlcmlmaWNhdGlvbi5GNXk0UFkvc291cmNlLXJlcG8vZGlzdHJpYnV0ZWQtc2tpbGw=`.
The apply result was `committed`, status remained `committed` after the installed
helper source was made unavailable, and undo returned `restored`. Object
identity, raw target, manifest hash, source bytes, and source Git object all
matched exactly.

## Fault and recovery evidence

- All 16 declared apply seams and all 12 declared restore seams were terminated
  with real `SIGKILL`; status plus apply/undo replay converged without false
  success.
- Native post-rename crash seams reconciled without overwriting or replaying a
  completed move.
- Batch status reconciled a real `SIGKILL` gap read-only; retry did not replay a
  committed item.
- Occupied restore, identity drift, mount/cross-device paths, symlinked
  ancestors, FIFO/socket/unreadable inputs, helper tampering, journal ambiguity,
  and post-publication failure paths all failed closed in the 99-test native
  suite.
- The installed-layout flow proved status and undo continue through the exact
  transaction-bound helper cache after helper source/compiler discovery becomes
  unavailable.

Sudden-power-loss durability is not claimed. The verified boundary is process
interruption/termination and the recorded durability primitives.

## Adversarial review and resolutions

Agent-separated platform/security and product/Agent adversarial reviewers
repeatedly reviewed the concrete diffs and reran gates. This was an L2 review:
the reviewers were separated from each other's first-pass reasoning, but were
not fresh-context, multi-model, or external reviewers. Resolved findings
included:

- FIFO blocking, hardlink acceptance, and ambiguous launcher temp cleanup;
- batch reconciliation losing authoritative failure truth;
- rehydration races, duplicate/malformed semantic identities, and false baseline
  reuse;
- non-macOS empty decisions and incomplete zero-mutation assertions;
- unsafe or ambiguous `setup-cli` PATH selection and a non-executable fallback;
- Agent examples depending on Node 22/PATH, relative JSON artifacts polluting a
  source checkout, untrusted `TMPDIR`, unchecked temp-directory creation, and
  persistent `umask` changes;
- misleading platform, status, schema, rehydration, and committed-payload claims.

Final reviewer result: APPROVED, no open P0/P1/P2 findings.

## Remote CI status

At the time of this local record, the branch has not yet been pushed. The
following gates are therefore pending, not passed:

| Required runner | Current status |
|---|---|
| `macos-latest` full suite and native mutation/fault gate | pending push |
| `ubuntu-latest` portable contracts and exit-3/zero-mutation boundary | pending push |
| `windows-latest` bounded Git Bash contract | pending push |

This timestamped local record intentionally remains immutable. Authoritative run
URLs and conclusions belong to the pull request and its check suite, which are
bound to the exact merge-candidate head. A pending or skipped macOS mutation job
is not acceptance.

## Directional usability evaluation (not a release claim)

A future five-maintainer exercise should ask each participant to quarantine and
undo a supplied sandbox candidate within ten minutes. The directional target is
at least four completions without assistance, zero source mutation, zero restore
overwrite, and correct explanation of entry-versus-source scope. Record
mis-selection, abandonment, and recovery behavior.

No participant study was run for this release. This protocol does not prove
demand, product-market fit, or willingness to pay.
