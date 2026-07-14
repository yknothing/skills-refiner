# Challenger First Pass

## Boundaries

- Visibility: shared evidence map, L2 declaration, and three design artifacts; no Champion first pass.
- Evidence boundary: revision `b7ae763` and design package; no deep implementation proof.
- Not validated: user need, full-tree fingerprint, crash recovery, Windows semantics, packaging/PATH, or end-to-end tests.
- Forbidden claims: feature exists, safely implementable, Windows-ready, users want it, scanner signal proves retirement, quarantine prevents redeploy.

## Objections

### O1 - Critical: cross-platform first release

- Claim attacked: first release covers POSIX and Windows with shared safe transaction semantics.
- Evidence class: missing evidence.
- Resolution type: scope removed.
- Remaining risk: PowerShell/.NET adapter, ACL/reparse/file-ID, locked paths, and packaging expand the first release beyond a verifiable slice.
- Required proof: macOS-first release; independent Windows spike, native runner, and packaging gate before promotion.
- Veto: veto.

### O2 - Critical: transaction reliability

- Claim attacked: immutable plan, journal, and rename are enough for reliable recovery.
- Evidence class: fact plus missing evidence; current scanner lacks whole-tree identity and broken-link absolute entry paths.
- Resolution type: runnable tests and gates.
- Remaining risk: interrupted per-item rename, failed journal persistence, destination conflicts, and concurrent reinstall create partial states.
- Required proof: replayable journal schema, fault injection at every state boundary, idempotent recovery/undo, installer concurrency and drift tests.
- Veto: veto.

### O3 - High: low-friction user flow

- Claim attacked: four-step flow reduces mistakes for target users.
- Evidence class: missing evidence.
- Resolution type: new evidence.
- Remaining risk: undefined ICP and technical language can turn signals into implied deletion advice.
- Required proof: novice, maintainer, and Agent task tests measuring decision correctness, abandonment, and restore success.
- Veto: owner decision required.

### O4 - High: AI-native differentiation

- Claim attacked: a JSON thin client is AI-native differentiation.
- Evidence class: opinion plus missing evidence.
- Resolution type: scope removed.
- Remaining risk: without command installation, version negotiation, and schema compatibility, it is an undistributed CLI wrapper.
- Required proof: CLI installation, version negotiation, and non-TTY Agent harness.
- Veto: no veto if AI-differentiation claim is removed.

## False-consensus failures

1. Owner flow approval is misreported as validated user need.
2. A polished state diagram is misreported as crash-safe implementation evidence.
3. A JSON interface is misreported as an AI-native moat.

## First-pass decision

Veto canonical promotion and implementation authority until O1 and O2 are resolved by scope removal and runnable gates.
