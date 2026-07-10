# Platform support contract

This repository has two different runtime surfaces. The `SKILL.md` instruction
files are consumed by the host agent. The governance utilities under `bin/` are
Bash programs with filesystem and permission semantics of their own. A skill
being discoverable does not prove that every governance command is supported on
the same operating system.

## Support matrix

| Environment | Skill content | Read-only governance (`scan`, `probe`, `dashboard`, `doctor`) | Trace file transform (`inject` / `strip`) | Canary logging |
|---|---|---|---|---|
| macOS, native Bash | Host-agent dependent | Supported | Supported | Supported |
| Windows 11 + WSL 2, `HOME` on the WSL Linux filesystem | Host-agent dependent | Design-supported; dedicated runner pending | Design-supported; dedicated runner pending | Mode-verified and fail-closed; dedicated runner pending |
| Windows Git Bash | Host-agent dependent | Real-directory/copy layouts only; symlink/junction topology not certified | BOM/CRLF round trip gated on `windows-latest` | Intentionally rejected |
| Native PowerShell or `cmd.exe` | Host-agent dependent | Not implemented | Not implemented | Not implemented |
| Linux | Host-agent dependent | Supported as the WSL/reference CI environment | Supported | Supported |

“Host-agent dependent” is deliberate: this repository can validate frontmatter
and packaging, but only the target agent can prove runtime loading.

## Windows rules

- Install and execute the shell tools from WSL 2 or Git Bash. Raw Windows paths
  such as `C:\Users\name` are not accepted by the Bash interface; use
  `/mnt/c/Users/name` in WSL or `/c/Users/name` in Git Bash.
- For full observability on WSL 2, keep `HOME` and
  `~/.agents/debug/activation.jsonl` on the WSL Linux filesystem, normally under
  `/home/<user>`. Canary logging rejects `/mnt/<drive>/...` because `chmod 0700`
  and `0600` cannot prove privacy on DrvFs without mount-specific metadata. It
  also rejects symlinked path components and checks the effective directory/file
  modes after `chmod`; a successful `chmod` exit code alone is not accepted.
- Canary logging also rejects Git Bash/MSYS2/Cygwin. Their POSIX mode emulation is
  not an ACL proof. The failure is explicit and occurs before a log path is
  created.
- `.gitattributes` forces LF for shell scripts so a Windows checkout cannot make
  the Bash entrypoints unloadable through CRLF shebangs.

## Required dependencies

- Bash 3.2 or newer.
- `jq` for scan, probe, dashboard, doctor, and trace status when an activation
  log exists. The canary helper retains a no-`jq` JSON fallback.
- Standard POSIX tools used by the scripts: `awk`, `sed`, `grep`, `find`, `od`,
  `head`, `tail`, `mktemp`, `readlink`, `uname`, `stat`, `chmod`, `cp`, `mv`, and
  either `sha256sum` or `shasum`. Identity-producing commands fail explicitly if
  neither SHA-256 implementation exists; they never substitute `cksum` under a
  SHA-256 field name.

## Verification tiers

- `macos-latest` and `ubuntu-latest` run the complete integration suite.
- `windows-latest` runs Git Bash syntax checks plus
  `test-platform-contract.sh`. This exercises installed layouts under paths with
  spaces, BOM/CRLF parsing, byte-identical CRLF trace round trips, and fail-closed
  canary storage. It does not certify Windows symlink/junction topology.
- A local macOS pass does not count as a Windows pass. Windows is only verified
  after the `windows-latest` job succeeds for the committed revision.

## Recorded follow-ups

These are intentionally recorded rather than hidden behind broad compatibility
claims:

1. A native PowerShell implementation would need a separate filesystem/ACL
   adapter and dedicated tests; translating the Bash scripts line-for-line is
   not an acceptable design.
2. The current CI uses Ubuntu as the Linux/WSL semantic reference. A dedicated
   WSL runner would be needed to certify Windows-host integration details beyond
   the explicit `/mnt/<drive>` guard and runtime mode checks.
3. Git Bash canary logging remains unsupported until a Windows ACL-native writer
   can prove the privacy and symlink/reparse-point invariants enforced on POSIX.
4. Git Bash symlink, junction, broken-link, and canonical-identity behavior needs
   a dedicated Windows topology fixture before it enters the support contract.
