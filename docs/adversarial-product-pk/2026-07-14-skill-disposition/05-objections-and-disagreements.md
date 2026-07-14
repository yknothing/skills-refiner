# Objections and Disagreements

## O1 - Cross-platform first release

- Severity: critical.
- Resolution: scope removed.
- Decision: P0 mutation truth is macOS-only. Windows becomes the next native adapter gate, not a current or first-slice claim.
- Remaining risk: macOS evidence must not be generalized to Windows.
- Veto: lifted for planning input and macOS spike; remains for any Windows-safe claim before native evidence.

## O2 - Transaction safety without executable proof

- Severity: critical.
- Resolution: test/gate added and runnable, but not yet run.
- Decision: only bounded single-item spikes have implementation authority. Full P0 and canonical promotion remain blocked until the fault-injection and recovery gates pass.
- Remaining risk: real crash/fsync and installer concurrency semantics.
- Veto: remains for canonical promotion and production implementation.

## O3 - Unvalidated low-friction flow

- Severity: high.
- Resolution: new evidence required.
- Decision: retain the flow as a product-owner-approved design hypothesis; do not call it user-validated.
- Remaining risk: technical labels may still imply deletion advice.
- Veto: no veto for design and task testing; veto for user-demand or usability claims.

## O4 - AI-native differentiation

- Severity: high.
- Resolution: scope removed.
- Decision: remove AI-native moat language. JSON/non-TTY is a compatibility contract; differentiation is conservative, auditable disposition.
- Veto: lifted after claim removal.

## O5 - Misleading batch transaction semantics

- Severity: high.
- Resolution: scope removed.
- Decision: batch review, serial single-item apply, stop on first failure. UI reports item transaction results, never fictional batch atomicity.
- Veto: lifted for planning input.

## Resolved platform-order disagreement

Disagreement: whether Windows mutation must ship in the first user-visible release.

Resolution: product-owner decision on 2026-07-14 selected staged delivery. macOS ships after its transaction gates pass; the native Windows adapter is the immediately following batch.

Decision owner: product owner.

Evidence still needed for Windows: native spike, reparse/ACL/file-ID fixtures, native runner, and packaging gate.

What must not be claimed yet: Windows cleanup support or equal platform readiness.
