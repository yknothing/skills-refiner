# Role and Independence Declaration

**Task:** Adversarially review ADR-0003 before canonical promotion.

| Field | Value |
|---|---|
| Independence level | **L2 — separate subagents using the same evidence packet** |
| Allowed wording | Agent-separated adversarial review; not independent/external/L3 |
| Champion | Separate subagent, blind to Challenger first pass |
| Challenger | Separate subagent, blind to Champion first pass |
| Evidence Clerk | Separate subagent, blind to role conclusions at first pass |
| Judge | Root agent after first passes and cross-examination |
| Shared visibility | ADR draft, evidence map, current repository and read-only machine evidence |
| Hidden during first pass | Other roles' conclusions and objections |
| Contamination | All subagents inherit the user request and conversation context unless otherwise noted; they do not see sibling outputs before first pass |
| Artifact authority | Architecture artifact only; no implementation or production readiness certification |

## Role boundaries

- Champion must produce the strongest coherent architecture and name sacrifices/non-goals.
- Challenger must attack source authority, version promotion, false single-truth claims, physical migration, recovery and context-savings assumptions.
- Evidence Clerk must audit claim labels, current-vs-future boundaries, replayable evidence and forbidden claims.
- Judge must preserve unresolved severe objections and may return `accept-with-limitations`, `incomplete`, `reject` or `escalate`; no average-by-consensus.
