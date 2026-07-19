# Challenger First Pass

## Declaration

- **Role:** Challenger / architecture red team
- **Review level:** L2 agent-separated first pass
- **Visibility:** initial ADR, shared evidence map, role declaration, Owner decisions, repository and read-only machine state
- **Hidden:** Champion conclusions
- **Initial verdict:** `incomplete`
- **Canonical promotion:** veto
- **Implementation/migration authority:** veto

## New direct observations

1. The installed gateway says: `Do not search for downstream skills inside the prodcraft directory.` It recognizes a source-repository locator or sibling packages, not `.members`/`INDEX.json`.
2. A bounded Markdown reference simulation found 10 references that are valid in the current flat topology but break after the proposed physical move. They point from ten ProdCraft members to the external `bs-requirements-engineering` Skill.
3. At least 92 known Agent distribution symlinks point to the 46 current entities: Claude 46 and Factory 46.

The reference probe scanned only relative Markdown links ending in `/SKILL.md`; it is a lower bound, not a complete asset/script/runtime dependency graph.

## Objections

### O-01 — Gateway cannot consume `.members` or `INDEX.json`

- **Severity:** Critical
- **Attacked claim:** Gateway plus nested members is currently executable without changing third-party Skill content.
- **Evidence class:** Direct fact + source conflict
- **Resolution required:** scope removal or new upstream evidence
- **Remaining risk:** gateway/upstream contract drift
- **Proof required:** pinned collection-aware gateway; versioned locator/index; real Agent loads at least three members; path escape/missing/digest/generation mismatch fail closed
- **Veto:** Yes

Moving siblings causes the current gateway to enter partial-entry mode. Generating an index does not create a reader for it.

### O-02 — Physical move breaks cross-collection relative references

- **Severity:** High
- **Attacked claim:** Moving member directories preserves references.
- **Evidence class:** Direct read-only simulation
- **Resolution required:** selected reference-closure contract plus runnable gate
- **Remaining risk:** aliases can re-enter recursive discovery; widening closure can expand without bound
- **Proof required:** machine-readable categorized graph and `newly_broken_references == 0`
- **Veto:** Yes

Ten currently valid `../bs-requirements-engineering/SKILL.md` links resolve inside `.members` after the move and become invalid.

### O-03 — Staging inside an active discovery root is not isolated

- **Severity:** Critical
- **Attacked claim:** Staging under `prodcraft/.members` does not change discovery before activation.
- **Evidence class:** Missing loader evidence + topology inference
- **Resolution required:** external staging and Agent-specific discovery/cutover contract
- **Remaining risk:** Agent version changes recursion/cache behavior
- **Proof required:** discovery probes, concurrent-reader phases, cache/restart evidence
- **Veto:** Yes

Dot-prefix is not a loader contract, and 45 paths plus 92 links cannot switch as one filesystem rename.

### O-04 — Commit identity does not prove publisher trust or stability

- **Severity:** High
- **Attacked claim:** URL + revision + digest is sufficient content authority for deployment.
- **Evidence class:** Architecture inference + missing evidence
- **Resolution required:** split artifact identity, source trust and qualification
- **Remaining risk:** unsigned Owner-approved sources and compromised providers
- **Proof required:** repo transfer/rename/deletion, force-push, moving tag, signature/attestation, submodule/LFS and URL alias matrix
- **Veto:** Yes for canonical wording; implementation remains gated

### O-05 — `pinned` and `stable` are not one channel

- **Severity:** High
- **Attacked claim:** One channel enum can express selection and reliability.
- **Evidence class:** Architecture inference
- **Resolution required:** orthogonal state model
- **Remaining risk:** Owner can explicitly accept low evidence, which must not be relabeled verified
- **Proof required:** legal/illegal transition tests, target-profile qualification, policy revalidation and exact rollback
- **Veto:** Yes until model changes

### O-06 — File hash chain overclaims loss/tamper detection

- **Severity:** High
- **Attacked claim:** sequence + previous digest detects all missing/reordered/tampered events.
- **Evidence class:** Architecture inference + missing evidence
- **Resolution required:** durable publish protocol, independent head or narrower threat model
- **Remaining risk:** no local same-user mechanism prevents deliberate simultaneous ledger/anchor rewrite
- **Proof required:** tail/middle deletion, reorder, truncate, disk full, permission loss, schema upgrade/downgrade and phase kill injection
- **Veto:** Yes

### O-07 — Freshness has no correctness actor

- **Severity:** High
- **Attacked claim:** watcher + periodic scan prevents stale `READY`.
- **Evidence class:** Missing evidence
- **Resolution required:** read-time expiry plus mandatory synchronous preflight; watcher optional
- **Remaining risk:** exact `MISSING` remains eventual between direct observations
- **Proof required:** watcher-off, sleep, clock change and offline deletion tests
- **Veto:** Yes

### O-08 — V1 is overloaded

- **Severity:** High
- **Attacked claim:** four adapters, promotion, ledger, watcher, generic collection, migration, repair and projection can all form a robust first version.
- **Evidence class:** Scope judgment grounded in unresolved contracts
- **Resolution required:** ProdCraft-only vertical slice
- **Remaining risk:** gateway and reference blockers remain even after narrowing
- **Proof required:** capability matrix with command, owner, exit code, gate and rollback for every included capability
- **Veto:** Yes

### O-09 — Bare `npx` conflicts with low-friction management

- **Severity:** Medium in first pass; raised to High after upstream-set evidence
- **Attacked claim:** common raw installer use can remain transparent after physical collection migration.
- **Evidence class:** Architecture inference + missing experiment
- **Resolution required:** managed wrapper path; external mutation modeled as artifact-set drift
- **Remaining risk:** external writes can only be detected later, not prevented everywhere
- **Proof required:** isolation replay of add/remove/rename/namespace migration without active-set change
- **Veto:** No in first pass; conditional canonical veto after cross-examination

## Requested scope change

1. Treat the upstream revision as artifact/authoring authority, not as proof of publisher or stability.
2. Split selection, qualification and lifecycle.
3. Require a version-bound collection-aware ProdCraft gateway and manifest.
4. Choose a reference-closure solution.
5. Stage outside all Agent discovery roots.
6. Narrow V1 to one ProdCraft end-to-end path.
7. Add durable ledger, sealed-head, schema and read-time freshness contracts.

## False-consensus probes

1. Immutable commit is mistaken for trusted and stable release.
2. `.members` is assumed hidden without loader proof.
3. Generated index is mistaken for a gateway reader.
4. Digest round-trip is mistaken for semantic migration success.
5. Naming a watcher is mistaken for freshness correctness.
6. More V1 features are mistaken for greater robustness.
7. Owner approval is mistaken for qualification evidence.
8. Existing contract conflicts are dismissed as implementation details.

## First-pass decision

Keep the architecture direction, block canonical promotion of the initial draft, and block all implementation/migration authority until the gateway, reference, discovery, trust, version, ledger, freshness and scope objections are contractually resolved.
