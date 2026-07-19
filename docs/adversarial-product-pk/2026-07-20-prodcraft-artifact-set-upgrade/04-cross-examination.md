# Cross-examination Synthesis

## Procedure

Champion and Challenger completed first passes before reading each other's new output. In the disclosed second round:

- Champion answered Challenger O-01..O-12 with `concede/modify/defend`, a minimum ADR change and separate document/live-migration vetoes.
- Challenger examined Champion's eight amendments and invariants for paper-gate closure.
- Evidence Clerk independently audited source/fact boundaries and the original draft.
- The primary agent acted as Judge/editor and rewrote ADR-0004; it did not convert a named future gate into passing evidence.

Review level remains **L2 agent-separated, shared evidence packet**. It is not independent/external review.

## Cross-examination convergence

| Question | Champion answer | Challenger test | Judge revision |
|---|---|---|---|
| Who enforces locator generation/digest integrity? | Not upstream gateway; controller/adapter verifier | Naming a verifier is insufficient for runtime enforcement | §6.3 assigns controller-time checks and explicitly withholds continuous/load-time claims without an adapter hook |
| Does one projected gateway mean 40 Skills are installed? | No; only one entry is projected/discoverable | Routed availability is Agent-specific evidence | §§3, 5.2 split stored/projected/discoverable/routable/loaded; `gateway-routed` is ineligible until replay passes |
| Is stored repo content an installation? | No; it is managed source artifact | UI/status must not collapse predicates | §§3–4 forbid aggregate installed/READY authority |
| Are 39 basename pairs semantic replacements? | No; structural fixture only | Seven retirements and every successor need decisions | §7 requires an exact 46-row disposition and Owner-approved capability retirements |
| Is multi-root cutover atomic? | No; transaction means serialization and crash recovery | Unknown readers can see mixed state | §§1, 8 scope the guarantee to maintenance-window crash consistency |
| Can raw `npx` alter active reality? | Yes, immediately; desired ledger remains unchanged | Exposure window needs Owner acceptance | §9 states exclusive-writer policy, detection window and no continuous prevention |
| What restores a deleted control subtree? | Independent byte-bearing recovery root | Digests alone are not recovery | §§4, 7.2, 8 require durable recovery bytes before quarantine and narrow the failure scope |
| Is health continuous? | No; observation-scoped only | Command freshness is not runtime enforcement | §9 records observation expiry and withholds continuous health |
| What is exact rollback equality? | Publish a filesystem identity schema | Undefined metadata cannot be called byte-for-byte | §7.2 specifies required bytes/link/mode/xattr/ACL identity and blocking unsupported objects |
| Can one profile serve heterogeneous Agents? | Profile intent per root; qualification per adapter | Shared roots still require one profile and consumer inventory | §5.2 binds one target/profile matrix per generation and exposes unknown-consumer risk |
| Does one projection prove context saving? | No | Claim must remain target/version-specific | §§5.1, 12, 14 prohibit unmeasured context claims |
| Is V1 still a first-run big bang? | Must be staged | Priority labels alone are not stages | §10 defines four promotion-stopped stages before any live 46→40 mutation |

## Judge decisions

1. Keep complete upstream repository as managed source artifact, not as an installed-state claim.
2. Replace collection-global profile with a root/adapter/profile matrix.
3. Rename the low-exposure profile to `gateway-routed` to avoid equating one entry with forty available Skills.
4. Attribute digest/path checks to a controller validator and state its temporal boundary; do not attribute them to locator v1.
5. Define `transactional` as single-writer, precondition-bound and crash-consistent, not atomically visible to all readers.
6. Make independent recovery bytes P0 and explicitly exclude whole-home/device loss.
7. Preserve raw-installer and between-command drift as visible residual risks requiring Owner acceptance.
8. Keep ADR status `Proposed` until Owner reviews the changed product contract.

## What prose did not prove

No cross-examination response or ADR edit proves:

- a real Agent can route from `pc-prodcraft` to unprojected members;
- the reviewed upstream commit is stable or qualified;
- all mutation roots or consumers are inventoried;
- a recovery archive, journal, locator verifier or managed CLI exists;
- crash, concurrent-reader, external-writer or exact-undo gates pass;
- context usage is reduced;
- a live migration is authorized.

The revised ADR resolves internal claim conflicts by narrowing or selecting architecture contracts. Implementation and migration vetoes remain.
