# 06 — Claim Ledger

| ID | Type | Claim | Evidence | Status |
|---|---|---|---|---|
| C1 | Fact | Four collections contain 69 source-qualified members at exact revisions. | active plans, INDEX, fresh status | Supported |
| C2 | Fact | ProdCraft is physically under `prodcraft/` with 40 current `pc-*` members; legacy flat names are absent from active root. | live filesystem and fresh status | Supported |
| C3 | Fact | Versions are upstream declarations: `1.0.0`, `0.2.0-dev`, `0.2.1`, `not_declared`. | immutable artifact manifests | Supported |
| C4 | Fact | Static load blockers are zero, but static loadability result is `unknown`. | `skill-scan.v7` runtime contracts | Supported |
| C5 | Fact | Codex/Claude enumerate expected managed gateways/members at catalog level. | current runtime evidence | Supported as `CATALOG_ONLY` |
| C6 | Hypothesis | Physical indexing reduces context use. | no measurement | Withheld |
| C7 | Fact | No cleanup is authorized. | 0 selected, `executable_plan: null` | Supported |
| C8 | Fact | Same-name cross-repository entities are preserved. | plans/collisions/live payload | Supported; route choice unverified |
| C9 | Fact | Installer receipts bind source/path/tree but not immutable revision. | `skill-scan.v7`, receipt v3 | Supported |
| C10 | Governance | The Owner reviewed all five exact plan hashes. | no hash-specific human record yet | Pending Owner decision |
| C11 | Fact | Candidate revisions are contained in local origin-tracking refs. | attestation + negative tests | Supported; not online remote proof |
| C12 | Fact | Tested successor/history recovery is schema-aware and fail closed. | 87/87 ProdCraft suite and live upgrade | Supported within tested fault model |
| C13 | Fact | Cursor catalog is unavailable in the current probe. | native status/probe timeout | Supported as `BLOCKED` |
| C14 | Inference | The first version is a useful local management baseline. | C1–C5, C7–C13 | Plausible only within promotion boundary |
| C15 | Fact | Better latest main is active as a 13-member generation after a drift→repair→successor flow. | remote main, repair attempt, quarantines, active plan/status | Supported at 2026-08-28T17:08:33Z |
| C16 | Fact | Legitimate in-collection successor digest changes no longer create false collision attention. | `e680b8d`, 85/85 suite, live Better status | Supported |
| C17 | Fact | Final global scan has 217 canonical Skills, 767 entries, 550 links and zero broken/runtime/collection blockers. | fresh full `skill-scan.v7` | Supported |
| C18 | Fact | Final runtime evidence is current for the active generations and final Panorama. | three evidence ids + generation `764f2a87-...` | Supported at catalog/blocker scopes only |

No claim may be promoted by replacing an `unknown`, `unverified`, `blocked` or `pending` cell with an optimistic synonym.
