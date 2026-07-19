# Cross-examination

## Procedure

Champion and Challenger completed blind first passes before seeing each other's conclusions. Challenger then sent eight questions and nine objections to Champion. Champion answered with `concede`, `modify` or `defend core`; Challenger separately judged whether each answer could close a canonical-document veto and which gates must remain before implementation.

New evidence introduced during cross-examination:

- ProdCraft upstream `main` was pinned at `fd05978dbbbf5a064205a695af47c8a550f1b224` for review.
- Its public registry contains 40 `pc-*` Skills, while the machine has 46 old unprefixed receipts/entities.
- The Vercel Labs `skills` source was pinned at `777599e1159e401b11ce4c8a57c20f09a8f1596e`.
- The 92 known links are bounded to Claude and Factory, not asserted as a global projection total.

## Questions and responses

### Q1. What existing contract lets the unchanged gateway load `.members/intake`?

**Champion:** Concede. No such contract exists. The installed gateway explicitly rejects searching its own directory and routes to siblings. Require an immutable upstream collection-aware gateway and versioned locator/index. Do not patch installed third-party content.

**Challenger:** The canonical ADR may retain nested collection only if the current gateway is explicitly ineligible and the new gateway/manifest is a hard precondition. Implementation remains vetoed until a real Agent loads nested members and negative cases fail closed.

### Q2. Is `stable` global, and how can one channel express it with `pinned`?

**Champion:** Modify. `stable` is scoped qualification over artifact + Agent/profile + OS/runtime + policy + evidence. `pinned` is selection. Replace the channel with orthogonal lifecycle, qualification, selection and activation dimensions.

**Challenger:** Canonical veto closes when the formal model is in the ADR. Qualification implementation remains unproven.

### Q3. After repo transfer/deletion/force-push, what proves publisher and exact restore?

**Champion:** Modify. Split forge/repository trust, artifact identity and recovery availability. Record repository identity when available, Owner origin approval and signature/attestation when present. Retain a digest-bound immutable recovery artifact before activation.

**Challenger:** V1 may honestly support `Owner-approved observed origin`; it must not claim cryptographic publisher verification without attestation. Mutation remains blocked until exact recovery evidence exists.

### Q4. Why stage under an active discovery root before recursion behavior is known?

**Champion:** Concede. Staging must be outside all discovery roots. Dot-prefix is not an ignore contract.

**Challenger:** Canonical veto closes after external staging and Agent-adapter eligibility are binding. Migration and context claims remain blocked pending probes.

### Q5. What proves deletion of the event tail and `current.json`?

**Champion:** Concede. A hash chain without a trusted head cannot prove tail deletion. Require a separately addressed sealed head, file and parent-directory durability, schema versioning and crash-order tests; do not call the result tamper-proof.

**Challenger:** Canonical ADR must state the narrower accidental-corruption threat model. Mutation remains blocked until tail/middle deletion and phase kill tests pass.

### Q6. If a watcher stops for seven days, who changes `READY` after deletion?

**Champion:** Modify/defend core. No daemon is required if observations have `valid_until` and effective health is computed at read time. Expired observations render `STALE`; synchronous command preflight finds `MISSING`. Watcher is latency optimization only.

**Challenger:** Canonical veto closes with read-time freshness and removal of resident watcher from V1 correctness.

### Q7. How can 46 canonical paths and 92 links switch without mixed topology?

**Champion:** Concede. Per-path rename is not batch atomic. V1 must be a maintenance/quiescence operation; affected sessions stop, the transaction journals every step, all participating surfaces verify before restart, and inability to establish quiescence blocks activation.

**Challenger:** Canonical veto closes with the explicit non-zero-downtime contract. Migration remains blocked until adapter inventory, restart and rollback gates pass.

### Q8. Why put four adapters and a resident watcher in a robust V1?

**Champion:** Concede. Narrow V1 to one Git/GitHub-backed ProdCraft vertical slice with read-only Vercel receipt import, external staging, qualification, command-time reconcile, migration/undo and durable recovery.

**Challenger:** Generic npm/local adapters, resident watcher, auto-promotion, cross-platform mutation and generic multi-collection automation must leave V1 rather than remain permanently blocked placeholders.

## Cross-cutting reference objection

Champion conceded that the ten newly broken relative links are direct counter-evidence to the original target layout. Challenger required the ADR to select a solution rather than merely say “validate references.”

The final design selects **upstream portable references**:

- an eligible revision must express external dependencies through its collection-aware locator/manifest contract;
- V1 does not create ad-hoc compatibility symlinks;
- V1 does not silently enlarge the collection closure;
- V1 does not rewrite installed third-party Skill content;
- any unresolved new broken reference vetoes migration.

## Final cross-examination convergence

Both roles converged on:

1. the authority-domain direction is sound;
2. current 46 old-name ProdCraft entities are a legacy, unresolved-version machine snapshot, not an approved coherent release;
3. latest/upstream main is an incompatible candidate, not a stable update;
4. physical migration remains mandatory as the V1 target but currently blocked by explicit eligibility gates;
5. the ADR may become canonical with limitations after incorporating all contracts;
6. implementation, migration and context-saving claims remain vetoed until runnable evidence exists.
