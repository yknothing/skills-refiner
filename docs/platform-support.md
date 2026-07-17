# Platform support contract

This repository has three distinct runtime surfaces: host-agent `SKILL.md`
loading, Bash-based read-only governance/observability, and the local cleanup
CLI. Support on one surface does not imply support on another.

Architecture supplements for **non-invasive usage telemetry** and **on-demand
pack catalogs** live under [`docs/adr/`](adr/README.md) (ADR-0001, ADR-0002).
Those ADRs do not expand the cleanup mutation support matrix below.

## Support matrix

| Environment | Skill content | Read-only governance (`scan`, `probe`, `dashboard`, `doctor`) | Trace transform / canary | Cleanup review | Cleanup mutation (`plan`, `apply`, `status`, `undo`) | `setup-cli` |
|---|---|---|---|---|---|---|
| macOS, native Bash | Host-agent dependent | Supported | Supported | Supported | Supported by the macOS adapter on the certified/observed release surfaces below | Supported |
| Linux / Ubuntu | Host-agent dependent | Supported | Supported | Supported | Unsupported; exit `3`, zero mutation | Unsupported; exit `3` |
| Windows 11 + WSL 2, Linux-filesystem `HOME` | Host-agent dependent | Design-supported; dedicated runner pending | Mode-verified/fail-closed design; dedicated runner pending | Same Linux boundary | Unsupported; exit `3`, zero mutation | Unsupported; exit `3` |
| Windows Git Bash | Host-agent dependent | Real-directory/copy layouts only; symlink/junction topology not certified | BOM/CRLF transform gated; canary logging rejected | No cleanup support claim beyond the existing bounded scanner | Not implemented | Not implemented |
| Native PowerShell or `cmd.exe` | Host-agent dependent | Not implemented | Not implemented | Not implemented | Not implemented | Not implemented |

“Host-agent dependent” is deliberate: static checks can identify proven load
blockers, but only the target Agent can prove runtime loading.

## Cleanup safety boundary

- Cleanup governs only locally installed or distributed entries under recognized
  Agent skill roots. Standalone source/authoring repositories may be reviewed but
  are never mutation targets.
- Scanner evidence is not a retirement verdict. Every candidate receives an
  explicit `keep`, `later`, or `retire` decision; retirement is never selected by
  default.
- Retire moves the exact reviewed entry into a recoverable transaction under
  `~/.agents/skills-quarantine/transactions/`. Permanent purge is not
  implemented.
- A batch is an ordered set of independent transactions. Execution stops at the
  first failure; an already committed prefix remains independently undoable.
- `--post-scan` distinguishes `QUARANTINED`, `REHYDRATED`, `RESTORE_CONFLICT`,
  and `INDETERMINATE`. Installer redeployment is never automatically
  re-quarantined, and running Agents may retain cached state until restarted.

## macOS cleanup requirements and certification

- Node.js major 24 is mandatory for the cleanup launcher and modules. The local
  implementation pass used Node `v24.18.0`.
- Apple Command Line Tools (`xcrun` + `clang` + macOS SDK) are required the first
  time the native helper is compiled. The verified helper is installed in a
  private, content-addressed cache under
  `~/.agents/skills-refiner/runtime/macos/<arch>/...`.
- Existing transactions bind the exact helper identity. Status and undo can use
  that verified persistent cache even if the distributed helper source or
  compiler later becomes unavailable.
- The directly observed local release surface is **macOS 27.0 arm64**. GitHub
  Actions is configured to run mutation gates on `macos-latest`; that label is a
  moving CI target, not a promise for every macOS version or architecture.
- The helper currently accepts `arm64` and `x86_64`, but an accepted architecture
  is not by itself a release certification. Add runner evidence before widening
  the supported-release statement.

`setup-cli` is also macOS-only. It installs a verified launcher only into an
existing, safe, user-owned directory already on `PATH`; it does not edit shell
profiles or overwrite an unrelated file. TTY and non-TTY flows both require an
exact, context-bound digest. If no safe `PATH` destination exists, the result is
a copyable full-path invocation bound to the selected Node 24 binary in human
output, with no filesystem write. JSON keeps the stable schema and returns the
same components separately as `node_binary` and `full_path_launcher`.

## Existing Windows and WSL rules

- Bash interfaces do not accept raw Windows paths such as `C:\Users\name`; use
  `/mnt/c/Users/name` in WSL or `/c/Users/name` in Git Bash.
- For WSL observability, keep `HOME` and
  `~/.agents/debug/activation.jsonl` on the WSL Linux filesystem. Canary logging
  rejects `/mnt/<drive>/...`, symlinked path components, and unprovable effective
  modes.
- Canary logging rejects Git Bash/MSYS2/Cygwin because POSIX mode emulation is
  not an ACL proof. The failure is explicit and occurs before a log is created.
- `.gitattributes` keeps shell entrypoints LF-only. Git Bash trace tests preserve
  BOM/CRLF skill bytes across inject/strip, but do not certify Windows
  symlink/junction identity.

## Dependencies

- Bash 3.2 or newer for shell tools.
- `jq` for scan, probe, dashboard, doctor, and trace status when a log exists.
- A SHA-256 implementation (`sha256sum` or `shasum`) for identity-producing shell
  commands.
- Node.js major 24 for cleanup commands on every platform, including explicit
  unsupported-platform responses.
- Apple Command Line Tools for the first macOS helper compilation only.

## Verification tiers

- `macos-latest` and `ubuntu-latest` run portable scan/observability suites,
  cleanup contracts/core, cleanup CLI boundaries, and selective installed-layout
  checks under Node 24.
- Only `macos-latest` runs real cleanup mutation, transaction recovery/fault
  tests, and the native helper compiler gate.
- Ubuntu asserts that setup/plan/apply/status/undo return exact unsupported truth
  (exit `3`, `mutation_occurred:false`, unchanged outcome, no transaction
  artifacts).
- `windows-latest` runs the existing bounded Git Bash syntax/platform contract.
  It does not run or certify cleanup mutation.
- Local evidence does not substitute for a runner. A platform is CI-verified for
  a revision only after its required job succeeds for that committed revision.

## Recorded follow-ups

1. Native Windows cleanup needs a separate filesystem/ACL adapter, native
   launcher, and dedicated tests. Translating the macOS/Bash implementation
   line-for-line is not an acceptable design.
2. A dedicated WSL runner is still required to certify Windows-host integration
   beyond the Linux semantic reference and explicit DrvFs guard.
3. Git Bash symlink, junction, broken-link, and canonical-identity behavior needs
   a dedicated Windows fixture before entering the support contract.
4. Additional fixed macOS release/architecture combinations require their own
   mutation and recovery evidence before the certification statement expands.
