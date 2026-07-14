# Champion First Pass

## Boundaries

- Visibility: shared evidence map, L2 declaration, three B-design artifacts, and repository sources at `b7ae763`; no Challenger first pass.
- Evidence boundary: future disposition strategy, not current capability.
- Not validated: user or market demand, whole-tree fingerprint, durable journal, crash recovery, native Windows reparse/ACL/file-ID behavior, WSL runner, or PATH packaging.
- Forbidden claims: feature exists, implementation-ready, Windows-safe, not-observed means unused, quarantine terminates cached use or prevents reinstall, externally validated.

## Thesis

Build a local skill disposition transaction layer, not a deletion utility: compile ambiguous signals into human decisions, then execute an auditable, replayable, recoverable CLI transaction. The value is `signal != verdict`, exact `entry_path`, immutable plan, drift-before-mutation exit, journal/undo, and one Human/Agent contract.

## ICP and JTBD

Advanced developers and tool maintainers managing multiple Agent distribution surfaces. When topology noise accumulates, they need to reduce local load conflicts without touching source repositories or pretending to know whether a skill is useful.

## Scope

- P0: macOS mutation; fresh scan -> grouped decisions -> plan preview -> explicit confirmation -> same-filesystem quarantine -> post-scan; JSON plan/apply/status/undo; stable exit codes; full entry identity; no-follow; write-ahead journal; explicit partial/recovery; restore never overwrites.
- P1: history/inspect, fingerprint-sensitive keep decisions, installation/PATH, native Windows adapter spike and release only after ACL/reparse/file-ID/crash fixtures pass.
- P2: IDE clients, policy templates, redeploy drift hints, dedicated WSL certification.
- Non-goals: automatic retirement verdicts, active-surface permanent delete, source-repo changes, full-screen TUI, cross-machine policy, terminating cached sessions.

## Sacrifices

First-release Windows mutation, rich visuals, one-click automatic cleanup, and full lifecycle coverage are sacrificed for a narrower trustworthy transaction.

## Falsification

1. A target user cannot quarantine and undo within ten minutes or cannot explain that an entry, not source, moved.
2. Any drift/crash/symlink fixture moves an external target, produces unjournaled partial success, or lets restore overwrite a new path.
3. An Agent must parse ANSI or natural language to safely plan/apply.
4. Evidence shows Windows mutation is a launch-critical requirement, invalidating the macOS-first ICP assumption.
