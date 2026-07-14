# Cross-examination

## Challenger on Champion

1. Windows scope: the Challenger lifted the O1 veto after the Champion removed Windows mutation from P0. All P0 claims must say macOS-only; native Windows remains a separately gated next track.
2. Transaction reliability: the O2 veto remains because a state diagram is not runnable recovery evidence. The minimum proof is a macOS fault-injection harness covering external and broken links, directory entries, occupied restore paths, pre-apply drift, journal-before-mutation, interruption after each state boundary, no-follow behavior, undo conflict, and post-scan consistency.
3. Product flow: low friction remains a hypothesis. It needs representative maintainer and Agent task evidence before promotion.

## Champion responses

1. Accepted `scope removed`: P0 mutation is macOS-only. Windows requires native reparse/ACL/file-ID, runner, and packaging gates.
2. Accepted `test/gate added and runnable`: immutable plans and journals are only design direction until replay, fault injection, idempotent recover/undo, concurrency, and drift gates pass. If batch recovery cannot be proven, scope contracts to single-item transactions.
3. Accepted `new evidence`: user-task thresholds must be registered before testing; inability to explain entry-versus-source or failure to reduce unsafe decisions falsifies the flow.
4. Accepted `scope removed`: JSON is not an AI-native moat. Installation, PATH, schema negotiation, and non-TTY harness move into P0 because otherwise there is no real Agent-callable product.

## Durable invariant answer

Before each mutation, write and persist an intent. Recovery compares original path, quarantine path, and the planned identity. Exactly one matching location allows a derived state; two matches, zero matches, or identity mismatch produces `RECOVERY_REQUIRED`. No automatic overwrite or optimistic continuation is allowed.

## Fingerprint direction

- Directory: root filesystem identity, no-follow sorted tree manifest of relative path/type/content digest, and security-relevant owner/mode/ACL/flags/xattr digest.
- Symlink or broken symlink: link object's identity and raw target; never read the target.
- Noisy metadata such as mtime does not block.
- Unknown security-relevant metadata changes block until an allowlisted fixture proves them observational only.

## Challenger final answers

- If only single-item recovery can be proven, P0 must be single-item transaction semantics. Review may remain batched; apply serializes independent item transactions and stops on first failure.
- Planning-input usability threshold proposal: five representative maintainers, ten-minute quarantine-and-undo task, at least 80 percent unassisted completion, zero source mutation or restore overwrite, and 100 percent Agent harness operation without parsing natural language. This is task evidence, not demand or market validation.
- Final role decision: no veto for constrained planning input; veto canonical promotion; no veto only for bounded single-item implementation spikes; veto full production implementation until gates pass.
