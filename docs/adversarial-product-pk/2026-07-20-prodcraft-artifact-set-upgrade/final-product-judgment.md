# Final Architecture Judgment

## Conclusion

The revised ADR-0004 is a coherent **first design draft**, not yet a canonical architecture decision. The package is accepted for Owner review; the ADR remains `Proposed`.

The mechanism is now concrete:

> Pin one upstream artifact set; store it outside discovery roots; qualify it per Agent/root/profile; compile one identity-gated 46→40 plan; preserve independent recovery bytes; perform a journaled maintenance-window cutover; derive health from fresh observation; and treat external receipts/writes as evidence or drift, never silent desired-state changes.

## Decisions changed under attack

1. “Physical installation” became managed source artifact plus separate Agent projection/runtime predicates.
2. `gateway-only` became `gateway-routed`, a one-entry profile with no automatic 40-member availability claim.
3. Locator v1 lost invented generation/digest enforcement; controller/adapter boundaries now own only the checks they can actually run.
4. One global profile became a target/root/profile/adapter matrix.
5. 39 mappings became lexical candidates requiring 46-row semantic dispositions.
6. “Transactional” became single-writer crash consistency, not multi-root atomic visibility.
7. Exact recovery gained independently addressed byte copies and a bounded failure scope.
8. `READY` became observation-scoped state; continuous runtime integrity is withheld.
9. Raw installer writes are acknowledged as immediate competing filesystem writes with a detection window.
10. V1 became four gated stages before any live 46→40 mutation.

## Why canonical promotion is withheld

The design still needs Owner decisions about fallback profiles, capability retirement, quiescence, drift windows, stale receipts and recovery scope. No locator verifier, recovery archive, journal, target inventory, semantic disposition ledger or real-Agent replay exists. A future gate is not current evidence.

## Promotion boundary

| Surface | Judgment |
|---|---|
| Architecture package completeness | Accepted for first-draft review |
| ADR-0004 canonical status | Proposed; Owner review required |
| Implementation-plan drafting | Blocked until Owner approves/revises the draft |
| Implementation authority | Blocked |
| Global filesystem mutation | Veto |
| ProdCraft physical migration | Veto |
| Candidate stability/qualification | Not proven |
| Agent routed availability/context reduction | Not proven |
| Independent/external review | Not claimed |

## Reversal evidence

Reject or redesign this draft if the Owner does not accept the operational tradeoffs, if an official host load API makes projections unnecessary, if upstream gateway composition cannot pass real-Agent qualification, or if independent recovery/durability cannot meet the stated failure contract.
