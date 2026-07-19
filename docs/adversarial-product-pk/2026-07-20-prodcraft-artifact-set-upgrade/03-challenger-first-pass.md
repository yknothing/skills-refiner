# Challenger First Pass

## Verdict

**Recommendation: veto canonical promotion of ADR-0004 as currently written.**

The design has useful safety intentions, but three critical claims are not merely unimplemented; they are internally or externally inconsistent:

1. the pinned upstream `prodcraft-runtime-locator.v1` contract does not carry or enforce the artifact/generation/digest fields that ADR-0004 says will fail closed;
2. one collection-wide `active` generation and one `profile_id` do not model heterogeneous Agent roots that need different profiles at the same time;
3. exact rollback bytes, active artifacts and generations remain in a common control-root failure domain, so manual deletion can destroy both the active state and the material needed to prove or restore it.

The highest severity is **critical**. This is a veto on canonical promotion, implementation authority and filesystem mutation until the critical objections below are resolved by an allowed resolution type. It is not a claim that the overall store/projection direction is unsalvageable.

## Role declaration

- Role: Challenger.
- Review level: L2 agent-separated, shared evidence packet.
- Visibility: ADR-0004, `00-evidence-map.md`, `01-role-and-independence-declaration.md`, related ADRs/current transaction seams, and the two pinned upstream repositories named by the packet.
- Hidden during this pass: the current task's Champion first pass, synthesis, Judge decision and acceptance output.
- Contamination: inherited awareness of ADR-0003 is declared in `01-role-and-independence-declaration.md`; no current Champion reasoning was used.
- Evidence boundary: architecture and fixed-source contracts only. A stated gate is not treated as proof that the gate passes.

## Not validated

- No collection store, generation manager, projection manager or managed collection CLI was run; the evidence map says they do not exist.
- No real Agent loaded `gateway-only` or `full-compatibility`.
- No 46→40 dry-run, collision rehearsal, kill matrix, rollback rehearsal or context measurement ran.
- No complete participating-root inventory exists.
- No claim is made that the pinned ProdCraft commit is stable or that migration may begin.

## Severe objections

### O-01 — The locator fail-closed contract is stronger than the pinned upstream contract

- **Severity:** critical
- **Claim attacked:** ADR-0004 §§5.2 and 8 claim that an unmodified pinned gateway plus generated `prodcraft-runtime.json` can bind `artifact_digest`, `generation_id` and locator digest, and fail closed on generation mismatch, repository mismatch, path escape or content digest mismatch.
- **Evidence class:** source conflict
- **Evidence:** the pinned upstream `scripts/install_prodcraft_global_skill.py::runtime_locator_payload` emits `schema_version`, skill/install-surface and absolute root paths, but no resolved revision, artifact digest, generation ID, per-root digest or signature. The pinned `pc-prodcraft/SKILL.md` tells the Agent to read those paths and check repository identity files; it does not define a cryptographic or controller-mediated validation step. Its locator contract test checks rendered guidance, not post-install tamper enforcement. ADR-0004 nevertheless requires generation/digest mismatch to fail closed while also prohibiting a gateway patch.
- **Allowed resolution type:** new evidence; test/gate added and runnable; scope removed
- **Remaining risk:** extra private fields in the JSON can be ignored by the unchanged gateway, and a locator or stored tree modified after controller preflight can still be consumed by an Agent before the next reconcile.
- **Required next proof:** publish the exact locator schema and verifier boundary; then demonstrate with the unmodified pinned gateway in a real Agent that wrong generation, wrong artifact digest, path escape, missing identity file and post-activation mutation all stop before any downstream instruction is read. If enforcement requires a host adapter or gateway change, make that dependency explicit and remove the contrary upstream-fidelity claim.
- **Veto:** veto

### O-02 — `gateway-only` installs one discoverable Skill, not forty available Agent Skills

- **Severity:** critical
- **Claim attacked:** ADR-0004 §§1, 5.3 and 8 imply that a complete stored repository plus locator makes the 40-member artifact set operational while only `pc-prodcraft` is projected.
- **Evidence class:** source conflict and missing evidence
- **Evidence:** Agent Skills discovery exposes `name` and `description` only for discovered Skill directories; unprojected members are absent from the Agent's catalog and cannot metadata-trigger. The pinned upstream gateway does allow a singleton gateway, but it also says to start with `pc-intake`, use actually present sibling packages when available, and stay honest about partial-entry behavior when downstream context cannot be resolved. Its packaged routing map contains sibling-relative links such as `../../pc-intake/SKILL.md`; those siblings do not exist in a `gateway-only` projection. The evidence map explicitly says no real Agent has loaded this topology.
- **Allowed resolution type:** new evidence; test/gate added and runnable; scope removed
- **Remaining risk:** a capable model may manually traverse the locator in one client while another client exposes only the gateway body or a dedicated activation tool that cannot activate undiscovered member names. Success in one ad hoc prompt would not establish Agent Skills availability.
- **Required next proof:** per participating Agent, run should-trigger and routed-handoff evals showing that the gateway discovers, reads and follows at least `pc-intake`, one planning Skill and one quality Skill from the pinned repository without sibling projection, false completion or manual operator path injection. Record unavailable-member behavior. Otherwise rename `gateway-only` to an entry-only mode and do not call the 40 members installed/available.
- **Veto:** veto

### O-03 — A complete repo snapshot is a managed source artifact, not by itself an installation

- **Severity:** high
- **Claim attacked:** ADR-0004 §§1 and 5.1 call `artifacts/<digest>/repo` a complete physical installation.
- **Evidence class:** repo-derived inference
- **Evidence:** ADR-0004 itself separates storage from Agent discovery, and the Agent Skills contract treats a Skill as a discoverable directory containing `SKILL.md`. A repository snapshot outside all discovery roots is content-addressed source/cache material. Only its qualified projections or a proven host load mechanism create Agent-facing installation semantics.
- **Allowed resolution type:** scope removed; new evidence
- **Remaining risk:** status, UI and operators can conflate `stored`, `qualified`, `projected`, `discoverable`, `routable` and `loaded`, recreating the false-`installed` state that ADR-0003 was intended to eliminate.
- **Required next proof:** define machine states and CLI output that keep those six predicates separate, and show a truth table for gateway-only, full-compatibility, broken locator, missing projection and unsupported Agent. The artifact store must not report `installed` or `READY` without the Agent-specific projection/loader predicate.
- **Veto:** veto

### O-04 — The 46→40 arithmetic does not prove semantic replacement or complete collision safety

- **Severity:** critical
- **Claim attacked:** ADR-0004 §§2, 6 and 14 treat 39 basename mappings, seven retirements and one addition as a sufficient review fixture for safe replacement.
- **Evidence class:** missing evidence
- **Evidence:** E-11 proves only a deterministic basename comparison; it explicitly withholds mutation identity. The 46 receipts have no common resolved revision, and the complete Agent-root inventory is missing. Source binding can justify whether an old path may be moved, but it does not prove that a same-basename `pc-*` package preserves the old capability, that a legacy-only capability is intentionally sacrificed, or that case-folded names, symlink aliases, project overrides and unparticipating roots do not collide.
- **Allowed resolution type:** new evidence; test/gate added and runnable; explicit owner decision required
- **Remaining risk:** deletion can be provenance-correct yet product-wrong; an old Skill can disappear safely from disk while its required capability has no successor. Excluded roots may continue exposing old names and create split behavior after the claimed migration.
- **Required next proof:** a 46-row disposition ledger with old digest/frontmatter/source, semantic successor or explicit retirement rationale, every target path across all inventoried roots, case-normalized collision result, and Owner approval for the seven capability retirements. Any unknown root or unmatched identity must remain `conflict` and block apply.
- **Veto:** veto

### O-05 — The protocol is recoverable multi-step cutover, not atomic artifact-set replacement

- **Severity:** critical
- **Claim attacked:** the title and ADR-0004 §§1 and 7 present a transactional artifact-set replacement whose `active` switch yields one post-generation across participating projections.
- **Evidence class:** source conflict and missing evidence
- **Evidence:** ADR-0003 already states that a 46+multi-root batch is not one atomic rename. ADR-0004 still performs sequential legacy quarantine, projection publication, `active` switch, per-root verification and later ledger sealing. The current reusable cleanup batch also commits items sequentially. A central `active` symlink can atomically change resolution for links already pointing through it, but it cannot atomically create/remove every legacy/new basename across several roots or invalidate Agent caches. `RECOVERY_REQUIRED` is a safe classification, not atomicity.
- **Allowed resolution type:** scope removed; test/gate added and runnable
- **Remaining risk:** crash, concurrent raw installer activity, an undiscovered reader or a client cache can observe a mixed namespace even if the eventual CLI state is classified correctly. Quiescing known sessions does not prove quiescence of every filesystem reader.
- **Required next proof:** define the exact isolation property without using batch-atomic language, enumerate every visible rename/link/unlink/fsync boundary, and pass kill injection plus concurrent-reader tests at each boundary across all participating roots. Prove that new sessions cannot start until commit or explicitly scope the guarantee to recoverability rather than invisibility.
- **Veto:** veto

### O-06 — Stale receipt plus raw `npx` remains a competing writer with a destructive overwrite path

- **Severity:** high
- **Claim attacked:** ADR-0004 §9 says raw `npx skills update` cannot change desired or active generation and that explicit receipt-drift display is sufficient for V1.
- **Evidence class:** fact and repo-derived inference
- **Evidence:** the pinned Vercel updater reads `.skill-lock.json` and invokes its add path for updates. Its installer cleans the canonical destination with recursive removal before recreating/copying it. Therefore a raw add/update targeting a managed `pc-*` name can replace the projection symlink under `~/.agents/skills` with an unmanaged directory. The ledger's desired generation remains unchanged, but the actual Agent-facing surface changes immediately and remains changed until a managed command reconciles it.
- **Allowed resolution type:** test/gate added and runnable; explicit owner decision required; accepted unresolved
- **Remaining risk:** between external write and the next reconcile, Agents may load unmanaged bytes. A stale receipt also keeps presenting a third-party history that does not match the active managed topology and can induce unsafe operator repair attempts.
- **Required next proof:** replay pinned `npx skills update`, `add` and `remove` against a sandboxed managed projection for all three outcomes: symlink replaced, member removed, and new package added. Demonstrate deterministic detection and bounded repair. If transparent prevention remains excluded, require explicit Owner acceptance of the exposure window and make raw global commands a documented operational veto while a collection is managed.
- **Veto:** owner-decision-required

### O-07 — Manual deletion can remove both deployment and its recovery material

- **Severity:** critical
- **Claim attacked:** ADR-0004 §10 says deletion of a stored artifact or generation cannot uninstall it and that repair uses the exact active artifact/generation; §14 claims exact undo.
- **Evidence class:** source conflict
- **Evidence:** artifacts and generations are both located below `~/.agents/skill-control/collections/prodcraft`. The adopted 46-item pre-state has no common upstream revision and therefore cannot be reconstructed from Git. The new layout does not identify an independently durable copy of those bytes. Deleting the collection subtree can simultaneously break `active`, all projections and the material needed to repair them. A ledger or digest can prove loss but cannot recreate bytes.
- **Allowed resolution type:** new evidence; test/gate added and runnable; scope removed
- **Remaining risk:** `RECOVERY_REQUIRED` may be honest but it does not satisfy exact repair/undo. A control-root loss can also erase the only cached new commit if upstream later becomes unavailable.
- **Required next proof:** specify independent recovery placement and retention for the adopted pre-state and every active/previous artifact, including durability ordering before quarantine. Run deletion tests for projection only, locator only, active link, generation, artifact, collection subtree and control root; prove exact restoration without resolving `latest`, or narrow the guarantee to detectable unrecoverable loss.
- **Veto:** veto

### O-08 — Command-time freshness is not runtime freshness

- **Severity:** high
- **Claim attacked:** ADR-0004 §§3 and 10 suggest that synchronous reconcile prevents stale `READY` after manual deletion or raw installer mutation.
- **Evidence class:** repo-derived inference
- **Evidence:** reconcile runs before managed status/mutation commands, while Agents read the filesystem independently. Between two managed commands, a projection can be removed or replaced and an Agent can load it before the controller observes the change. The evidence map has no loader hook, watcher or real Agent evidence; V1 explicitly excludes a correctness-dependent watcher.
- **Allowed resolution type:** scope removed; explicit owner decision required; new evidence
- **Remaining risk:** CLI truth can be fresh at observation time while Agent runtime truth is already different. Persisted or displayed `READY` is especially misleading if its scope is not restricted to the observation instant and target loader.
- **Required next proof:** define `READY` as an observation-scoped result with target Agent, root set, timestamp and expiry, and prove the UI never implies continuous health. If continuous runtime freshness is required, add a loader-time enforcement mechanism; otherwise explicitly accept the detection window.
- **Veto:** owner-decision-required

### O-09 — Exact rollback is not yet specified at the identity level it promises

- **Severity:** critical
- **Claim attacked:** ADR-0004 §§6.1, 7 and 14 promise restoration of 46 legacy entities and participating raw symlink identities byte-for-byte.
- **Evidence class:** missing evidence
- **Evidence:** the legacy adoption record lists receipt digest, lstat type/raw symlink target, tree/content digest, frontmatter and projections, but does not state a complete preservation contract for modes, ownership, ACLs, xattrs, hardlinks, normalization, sparse files or directory metadata. No exact 46→40 rollback rehearsal has run. The existing cleanup transaction seam moves individual entries and cannot by itself prove the new multi-root generation/ledger protocol.
- **Allowed resolution type:** test/gate added and runnable; new evidence; scope removed
- **Remaining risk:** a restored tree can match file contents while differing in loader-relevant permissions, raw link identity or filesystem metadata; a partially restored root can be mistaken for exact pre-state.
- **Required next proof:** publish the rollback identity schema and comparison command, then rehearse apply/undo and kill-after-every-phase on a filesystem-faithful fixture containing directories, relative/absolute symlinks, permissions, xattrs, collisions and denied paths. Report exact mismatch as `RECOVERY_REQUIRED`, never success.
- **Veto:** veto

### O-10 — One generation profile cannot express heterogeneous Agent requirements

- **Severity:** critical
- **Claim attacked:** ADR-0004 §§5.2–5.3 bind one `profile_id + profile_digest` into a generation, expose one collection-wide `active` pointer, and offer `full-compatibility` for Agents that cannot use locator routing.
- **Evidence class:** source conflict
- **Evidence:** the fallback exists precisely because Agent capabilities differ, yet the generation model carries a singular profile. A collection-wide profile switch therefore either exposes all 40 to every participating Agent or only the gateway to every participating Agent. `target_agent_adapter_digests` do not define whether different roots may project different profiles from one active artifact, and the proposed CLI accepts one collection profile rather than an Agent/profile matrix.
- **Allowed resolution type:** scope removed; explicit owner decision required; new evidence
- **Remaining risk:** optimizing one Agent's context can make another Agent functionally partial, while choosing full compatibility for the weakest Agent destroys the default context objective for all others.
- **Required next proof:** define whether profile is collection-global, generation-global, adapter-specific or root-specific. Provide a deterministic matrix for at least one locator-capable and one locator-incapable Agent, including undo and mixed-profile status. Otherwise restrict V1 to one explicitly named Agent/profile and leave all other roots unchanged and outside the success claim.
- **Veto:** veto

### O-11 — Profile and context semantics are underspecified even where the ADR withholds the savings claim

- **Severity:** high
- **Claim attacked:** ADR-0004 §§1, 5.3 and 14 treat `gateway-only` membership as the controllable context surface.
- **Evidence class:** missing evidence
- **Evidence:** ADR-0002 says context depends on host discovery behavior, and E-12 is only a bounded Claude/Factory inventory. Project-level overrides, recursive discovery, duplicate names, root precedence, cached catalogs and unparticipating roots can all change what a fresh session sees. Counting one projection is not equivalent to measuring one Skill's metadata in context.
- **Allowed resolution type:** test/gate added and runnable; new evidence
- **Remaining risk:** the topology can pass filesystem checks while providing no context reduction, hiding needed skills, or exposing both old and new copies through another root.
- **Required next proof:** per Agent/profile, capture root inventory, discovery list, precedence, recursion behavior, fresh-session metadata/context before and after, and duplicate-name resolution. Bind this evidence to Agent version and adapter digest. Until then, only projection membership—not context or effective availability—may be claimed.
- **Veto:** no-veto

### O-12 — V1 is an overloaded first mutation boundary

- **Severity:** high
- **Claim attacked:** ADR-0004 §§4, 7, 9–14 present resolver, qualifier, immutable store, migration planner, projection manager, reconciler, durable ledger/journal, receipt adapter, two profiles, multi-Agent adapters, repair and exact undo as one narrow V1 vertical slice.
- **Evidence class:** fact and opinion
- **Evidence:** the evidence map's “Missing or unproven evidence” section states that none of the collection/generation/projection/CLI components exists. Repository search finds only reusable cleanup transaction concepts, whose batch is sequential and whose identity model is for disposition, not collection activation. Every new boundary is coupled in the first irreversible 46→40 migration, so no smaller proven seam contains failure.
- **Allowed resolution type:** scope removed; test/gate added and runnable
- **Remaining risk:** implementation pressure will turn specified gates into TODOs, reuse cleanup semantics beyond their proof, or perform a real migration before locator/profile/rollback contracts are independently falsified.
- **Required next proof:** stage delivery as (1) read-only resolver/qualifier/46→40 plan and fixtures, (2) sandbox single-root generation/projection/rollback, (3) one real Agent gateway-only qualification, and only then (4) multi-root quiescent migration. Each stage must have a promotion veto and must not mutate the live root before the prior stage passes.
- **Veto:** veto

## False-consensus probe

The following are plausible ways all reviewers could agree and still be dangerously wrong:

1. **Gate-as-proof failure:** the package feels safe because every risk has a named fitness function, but no runnable collection gate exists. Consensus promotes prose completeness into implementation readiness.
2. **Singleton-gateway equivocation:** upstream says a singleton gateway is valid, so reviewers infer that all 40 Skills are available. In reality only `pc-prodcraft` is metadata-discoverable, routed references may be unavailable, and client activation semantics differ.
3. **Symlink-atomicity illusion:** one atomic rename of `active` is mistaken for an atomic migration, while legacy removals, new namespace publication, Agent-root projections, cache invalidation and ledger sealing remain multi-step.
4. **Ledger-authority illusion:** raw `npx` cannot change desired state, so reviewers say it cannot change active state. It can replace the actual projection symlink immediately; the ledger merely becomes stale relative to the surface.
5. **Digest-equals-recovery failure:** reviewers see complete digests and quarantine and infer rollback is guaranteed. A common-root manual deletion can leave perfect proof of what was lost but no surviving bytes from which to restore it.
6. **One-profile-for-all failure:** the locator works in the Agent used for acceptance, so `gateway-only` becomes the machine default. A second Agent that requires metadata-first siblings silently degrades to partial entry, or forces all Agents back to 40 exposed Skills.

## Questions that must be answered before synthesis

1. Which exact component—not prose in `SKILL.md`—rejects a locator whose generation or artifact digest is wrong?
2. How does an Agent activate `pc-intake` when only `pc-prodcraft` exists in its discovered Skill catalog and the packaged sibling-relative link is absent?
3. Is `profile_id` global, per generation, per adapter or per root? What is the desired state when two Agents need different profiles simultaneously?
4. What independently durable bytes restore the 46 adopted legacy directories after the collection/control subtree is deleted?
5. What prevents or bounds the interval in which raw `npx skills add/update/remove` has replaced a managed projection but reconcile has not run?
6. What exact property is called transactional: atomic visibility, serializable mutation, crash consistency, or merely deterministic recovery classification?
7. Which evidence proves that every one of the seven retirements is an approved capability loss rather than just a missing basename?
8. What is the smallest live mutation that can prove the store/projection/rollback seam before the irreversible 46→40 migration?

## Promotion boundary

This pass supports further architecture work only. It does not support canonical promotion, implementation authority, live filesystem mutation, a context-savings claim, a claim that all 40 Skills are available under `gateway-only`, or a claim of exact rollback. Critical disagreement must be preserved unless resolved with new evidence, removed scope, or a runnable passing gate; restating the intent in synthesis is not resolution.

## Evidence used

- `docs/adr/0004-managed-collection-store-and-transactional-artifact-set-upgrades.md`
- `docs/adversarial-product-pk/2026-07-20-prodcraft-artifact-set-upgrade/00-evidence-map.md`
- `docs/adversarial-product-pk/2026-07-20-prodcraft-artifact-set-upgrade/01-role-and-independence-declaration.md`
- `docs/adr/0002-on-demand-pack-catalog.md`
- `docs/adr/0003-versioned-skill-control-plane-and-physical-collections.md`
- `skills/skill-hygiene/lib/cleanup-transaction.mjs`
- `yknothing/prodcraft@fd05978dbbbf5a064205a695af47c8a550f1b224`: `skills/.curated/pc-prodcraft/SKILL.md`, `skills/.curated/pc-prodcraft/references/routing-map.md`, `docs/distribution/npx-skills-compat.md`, `scripts/install_prodcraft_global_skill.py`, `tests/test_prodcraft_gateway_locator_contract.py`
- `vercel-labs/skills@777599e1159e401b11ce4c8a57c20f09a8f1596e`: `src/update.ts`, `src/installer.ts`, `src/remove.ts`, `src/skill-lock.ts`
- Agent Skills specification and client implementation guidance referenced by ADR-0003
