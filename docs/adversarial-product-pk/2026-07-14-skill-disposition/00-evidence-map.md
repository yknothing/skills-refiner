# Evidence Map

## Snapshot and authority

- Repository: `/Users/whatsup/workspace/2026/skills-refiner`
- Source revision: `b7ae763af59fba031810d954b2fec5d6207fae29`
- Review target: proposed local installed-skill disposition flow, not current implementation
- Canonical current-state sources: repository code and docs at the revision above
- Product-owner decisions in this conversation:
  - CLI is the only execution core; Agent/IDE is a thin client.
  - First release governs only local installed and distribution surfaces.
  - Default disposition is reversible quarantine; active surfaces are never permanently deleted.
  - Interaction model B was selected: interactive review backed by immutable plan/apply.
  - The visible four-step user flow was approved.

## Verified current facts

1. No cleanup/disposition command exists in the repository. Current executable governance surfaces are scan, probe, dashboard, doctor, trace, and canary.
2. `skill-scan.v4` is a fact collector, not an execution plan. It emits topology, local path, normalized `SKILL.md` hash, provenance, runtime signals, symlink target, and canonical target.
3. The scanner resolves a symlink to `canonical_dir`; using that field as a mutation path could move an external source repository. The future executor must act on an explicit surface `entry_path` and treat canonical target as informational.
4. Broken-symlink records currently omit an absolute `entry_path`.
5. The scanner fingerprint covers normalized `SKILL.md`, not an entire skill tree and not filesystem identity across plan/apply.
6. Existing governance rules say staleness, backup remnants, security indicators, and other scanner flags are review signals; no automatic delete/archive is allowed.
7. macOS read-only governance is supported. Windows Git Bash does not certify symlink/junction topology. Native PowerShell is not currently implemented. A native Windows mutation adapter is future capability, not current truth.
8. Existing tests and CI verify read-only governance and bounded Windows Git Bash contracts; they do not verify a cleanup transaction, rollback, quarantine, or native Windows ACL/reparse behavior.

## Proposed design under review

- Human path: fresh scan -> grouped review -> decisions -> immutable plan preview -> explicit confirmation -> quarantine -> post-scan verification -> undo command.
- Stable decisions: retire, keep-until-fingerprint-change, later, inspect.
- Machine path: JSON-only review/plan/apply/undo contract with diagnostics on stderr and stable exit codes.
- Transaction direction: fail closed; exact entry identity; write-ahead journal; same-filesystem rename; no-follow symlink semantics; explicit partial/recovery state; restore never overwrites a new path.
- Platform direction: macOS/POSIX adapter plus a native Windows PowerShell/.NET adapter; Git Bash may host UI but must delegate mutation to the native adapter; WSL Linux filesystem may use POSIX semantics while DrvFS remains blocked until proven.

## Review artifacts

- `content/cli-flow-options.html`
- `content/b-flow-detail.html`
- `content/architecture-contract.html`

## Missing or unvalidated evidence

- No external user research or market evidence.
- No implementation spike for native Windows ACL, reparse point, file-ID, packaging, or crash recovery behavior.
- No decision yet on exact command name and installed PATH exposure.
- No verified whole-tree fingerprint algorithm or durable-journal implementation.
- No dedicated WSL runner evidence.
- No proof that a multi-platform mutation surface fits the first implementation batch safely.

## Forbidden claims

- Do not claim the feature exists, is implementation-ready, or is safe on Windows today.
- Do not claim scanner signals prove that a skill is unused or should be removed.
- Do not claim quarantine prevents an installer from re-deploying a skill.
- Do not call this review external, independent, market-validated, or human-verified.
