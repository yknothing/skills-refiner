# Acceptance

## Current decision

**`OWNER-DECISION-REQUIRED`.** Implementation and local evidence support a narrow `Accepted with limitations` candidate, but
hash-specific human review is not yet recorded. This document must not be read as runtime qualification or cleanup approval.

## Implementation gates

| Gate | Result |
|---|---:|
| ProdCraft current/historical successor suite | 87/87 PASS |
| historical v1 live status before upgrade | `FILESYSTEM_READY`, no false drift |
| four current collection fresh statuses | 4/4 `FILESYSTEM_READY`, issues `[]` |
| Better latest drift→repair→successor | PASS；13 members at `2198c88...` |
| managed successor/collision suite | 85/85 PASS |
| origin containment + exact Git object materialization | PASS |
| unpushed approved-repository commit negative test | PASS |
| cross-repository Better/LangCraft preservation | PASS |
| runtime profile deployment | `DEPLOYMENT_READY` |
| cleanup review | 0 selected; executable plan `null` |
| full global scan | 217 canonical / 767 entries / 550 links；0 blockers |
| final native evidence | Codex/Claude `CATALOG_ONLY`；Cursor `BLOCKED` |
| L2 Agent-separated review | P0 = 0；P1 = 0；Owner hash decision remains a governance gate |

## Truth boundary

| Surface | Accepted fact | Not accepted |
|---|---|---|
| Filesystem | 69 source-qualified collection members at exact revisions | all global identities source-qualified |
| Runtime exposure | profile deployment matches policy | body/route/context behavior |
| Codex | native catalog and canonical-path identity | runtime body/instruction compliance |
| Claude | native name-only catalog | repository/canonical-path identity or collision-safe route |
| Cursor | observe-only and blocked evidence | runtime support |
| Installer receipt | source/path/tree claim; installer-declared times | immutable revision or independently verified event time |
| Cleanup | review artifact exists | authorization or deletion |

## Promotion condition

The Owner must explicitly confirm the five hashes in [`10-promotion-boundary.md`](./10-promotion-boundary.md). After that record
is present, the ADR may move from `Proposed — Owner decision required` to `Accepted with limitations` without broadening scope.

## Evidence links

- [`00-evidence-map.md`](./00-evidence-map.md)
- [`06-claim-ledger.md`](./06-claim-ledger.md)
- [`08-false-consensus-and-pressure-tests.md`](./08-false-consensus-and-pressure-tests.md)
- [`11-live-upgrade-follow-up.md`](./11-live-upgrade-follow-up.md)
- [`../../verification/2026-08-28-runtime-aware-global-skills.md`](../../verification/2026-08-28-runtime-aware-global-skills.md)
