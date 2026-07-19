# Objections and Preserved Disagreements

## Objection disposition ledger

`Draft resolution` means the revised ADR contains a coherent boundary; it does not mean runnable proof exists.

| ID | Severity | Revised draft resolution | ADR binding | Live implementation/migration veto |
|---|---|---|---|---|
| O-01 locator overclaim | Critical | Upstream locator is routing/path data; controller owns observation-time validation; no continuous/load-time claim without adapter hook | §§6.2–6.3 | Remains |
| O-02 gateway-only equivocation | Critical | `gateway-routed` projects/discovers one entry; routed members are separately qualified | §§3, 5.2, 6.3 | Remains per Agent/profile |
| O-03 source artifact called installation | High | Stored, qualified, projected, discoverable, routable and loaded states are separate | §§3–4 | Remains for status implementation |
| O-04 39/7/1 semantic overreach | Critical | Lexical evidence has no mutation authority; exact 46-row disposition and seven retirement decisions required | §§2, 7 | Remains |
| O-05 atomicity illusion | Critical | Transaction means managed-writer serialization and crash consistency inside a maintenance window | §§1, 8 | Remains |
| O-06 raw installer competing writer | High | Raw global installer is prohibited but not prevented; it may change observed surface until reconcile | §9 | Owner decision + replay required |
| O-07 common-root recovery loss | Critical | Independent byte-bearing recovery root and failure-scope limit are P0 | §§4, 7.2, 8 | Remains |
| O-08 command/runtime freshness | High | Observation is timestamped/expiring; no continuous health claim without load hook | §9 | Owner decision + tests required |
| O-09 rollback identity undefined | Critical | v1 capture contract includes bytes, raw links, modes and required macOS metadata; unsupported objects block | §7.2 | Remains |
| O-10 one global profile | Critical | Generation binds a target/root/profile/adapter matrix; a shared root has one explicit profile | §5.2 | Remains |
| O-11 context effect unmeasured | High | Context claim removed from architecture acceptance and bound to fresh-session evidence | §§5.1, 12, 14 | Remains for any claim |
| O-12 V1 big bang | High | Four staged promotion boundaries precede live mutation | §10 | Remains at every stage |

## Evidence Clerk conflict disposition

| ID | Conflict | Draft treatment | Remaining evidence |
|---|---|---|---|
| EC4-01 exact-one mapping | `renamed/replaced` contradicted exact-one rule | Separate lexical evidence from one final plan disposition | 46-row content/compatibility ledger |
| EC4-02 locator fields overclaimed | locator v1 has no generation/artifact digest | Controller owns checks; runtime guarantee withheld | validator fixture + Agent hook evidence |
| EC4-03 curated gateway composition | curated bytes + local locator unqualified | Require upstream global rendering or pinned composition fixture | real-Agent replay |
| EC4-04 receipt not byte identity | source/basename insufficient | Require versioned current identity and independent adopted snapshot | actual capture/re-read proof |
| EC4-05 no release/tag signal | volatile observation was overinterpreted | Narrowed to time-bound publisher signal; no stability inference | preserved API evidence if reused later |
| EC4-06 registry parity | packaging evidence was conflated with qualification | Separate artifact membership from environment qualification | per-member/Agent/policy evidence |

## Pending Owner decisions

The architecture cannot silently choose these product tradeoffs:

1. accept raw global installer and manual-drift detection windows in V1;
2. accept observation-scoped rather than continuous runtime health;
3. accept a maintenance window and attestational quiescence for unknown consumers;
4. approve the per-Agent fallback matrix when `gateway-routed` fails;
5. approve each of the seven legacy-only capability retirements in the eventual plan;
6. accept stale external receipt UX until a native-writer adapter is proven;
7. accept that the independent recovery root protects against bounded accidental deletion, not whole-home/device loss.

## Preserved promotion disagreement

- Champion: after the revised contracts are incorporated, canonical-document veto may be withdrawn while implementation remains blocked.
- Challenger: canonical promotion should wait for Owner decisions and at least runnable architecture fixtures; named gates alone are paper closures.
- Evidence Clerk first pass: keep `Proposed` until source/mapping/gateway/projection conflicts are corrected and promotion evidence is re-audited.
- Judge: accept this package as a first design draft, keep ADR-0004 `Proposed`, and request Owner review before implementation planning.

This preserves the disagreement instead of laundering it into consensus.
