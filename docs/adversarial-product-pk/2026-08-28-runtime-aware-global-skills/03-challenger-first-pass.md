# 03 — Challenger First Pass

The first Challenger pass raised nine objections before seeing the Champion answer.

| ID | Severity | Objection |
|---|---|---|
| O1 | High | A local checkout may contain an unpushed commit, so a revision string alone does not prove upstream authority. |
| O2 | High | Active/operation records bind a plan hash but do not prove a human reviewed that exact hash; review level may be overstated. |
| O3 | High | “Global Skills managed” can hide that only 69 identities are source-qualified. |
| O4 | Critical | `FILESYSTEM_READY` or catalog enumeration could be misrepresented as runtime readiness. |
| O5 | High | Preserving same-name entities does not prove a name-only runtime selects the correct repository/body. |
| O6 | Medium | Physical nesting may be advertised as context saving without measurement. |
| O7 | High | A cleanup review list may be mistaken for deletion authorization. |
| O8 | High | Recovery claims may ignore historical schemas, missing evidence or whole-directory loss. |
| O9 | Medium | One local success may be presented as cross-machine operability or performance SLO. |

The first-pass recommendation was veto promotion until O1/O2/O8 were answered and O3–O7/O9 were either narrowed or explicitly
retained as limitations.
