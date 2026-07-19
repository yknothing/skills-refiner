# Role and Independence Declaration

## Declared level

Planned review level: **L2 agent-separated, shared evidence packet**.

Champion, Challenger and Evidence Clerk receive the same ADR draft and `00-evidence-map.md`. Champion and Challenger must produce first passes before seeing each other's new pass. They may have inherited earlier thread context about ADR-0003; this contamination is recorded and prevents L3 wording.

The primary agent acts as Judge and package editor after blind first passes. This is not independent or external verification.

## Role visibility

| Role | Visible | Hidden until first pass | Not validated by role |
|---|---|---|---|
| Champion | ADR-0004 draft, shared evidence map, repository and pinned snapshots | Challenger's new pass | implementation/runtime/context claims |
| Challenger | ADR-0004 draft, shared evidence map, repository and pinned snapshots | Champion's new pass | implementation/runtime/context claims |
| Evidence Clerk | ADR-0004 draft, shared evidence map, repository and pinned snapshots | role synthesis | product preferences outside evidence |
| Judge/editor | all first passes after completion | none | independent/external truth |

## Promotion ceiling

This L2 package may support `canonical architecture with limitations` if the rubric and severe-objection rules pass. It cannot certify implementation authority, filesystem mutation, upstream stability, Agent runtime behavior, context savings, or independent review.
