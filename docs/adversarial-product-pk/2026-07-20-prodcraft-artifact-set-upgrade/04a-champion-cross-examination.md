# Champion Cross-Examination

## Review posture and evidence lock

- **Role:** Champion, second-round response to the blind Challenger pass.
- **Review level:** L2 agent-separated first passes followed by disclosed cross-examination. This artifact is no longer blind because it answers the Challenger directly; it does not upgrade the package to independent review.
- **Visibility:** ADR-0004, shared evidence map and role declaration, my Champion first pass, and the complete Challenger first pass including O-01 through O-12.
- **Not validated:** I did not independently replay the Challenger's pinned-source inspections or run any implementation, locator, Agent-loader, migration, recovery, receipt, context or fault-injection test.

| Input | SHA-256 |
|---|---|
| ADR-0004 | `d80bf02c030ad451ee0d34b0aa1a32f57b6c1785634b7d6ec951e0fdaaa54f8d` |
| Champion first pass | `595cc49ec0d0848ed30fc318a4bb00774fd45302845f39a613bbc4283a4a91ca` |
| Challenger first pass | `207b25e399f4ccfacc3aa86cb48feed8f8968e16c008d858bceade9b82ef2bda` |

## Cross-examination conclusion

**[Opinion] The Challenger defeats several claims as worded but does not defeat the three-layer architecture.** The coherent revision is narrower and more explicit:

1. the upstream locator is a path-transport/routing contract, not an integrity verifier;
2. `gateway-only` means one projected and metadata-discoverable entry Skill, never forty installed/discoverable Skills;
3. profile choice is per projection root, qualified per adapter, and a generation binds the complete root/profile/adapter matrix;
4. “transactional” means managed-writer serialization plus crash-consistent recovery, not atomic namespace visibility;
5. exact recovery depends on a sealed byte copy outside the collection/control mutation failure domain, not on digests alone.

The minimum ADR changes below can remove the **canonical-document veto** by correcting the architectural contract. They do not remove the separate **implementation/live-migration veto**, which requires runnable passing evidence against the exact host, artifact and participating adapters.

## O-01 — Locator verifier ownership

- **Disposition:** **concede and modify**; **resolution:** scope removed + test/gate added and runnable; **evidence:** source conflict, as reported by the Challenger.

The ADR currently assigns enforcement to the wrong object. The unchanged upstream gateway and `prodcraft-runtime-locator.v1` can carry trusted roots and instruct identity checks; they do not cryptographically bind or reject `generation_id` and `artifact_digest`. Adding private JSON fields would not create enforcement.

The corrected ownership is:

| Boundary | Owns | Does not own |
|---|---|---|
| Upstream gateway/locator | upstream routing and repository-root discovery semantics | generation/digest enforcement |
| Generation manifest | binding locator bytes, root paths, artifact/generation IDs and expected digests | runtime interception |
| Controller `LocatorVerifier` | verify locator schema, path containment, repository identity and expected digests during materialization, plan revalidation, activation and reconcile | continuous post-check integrity |
| Agent adapter launch/load preflight, when available | re-run verifier before a new session can consume routed content | universal enforcement for unsupported Agents |

**Minimal ADR insertion for §§5.2 and 8:**

> `prodcraft-runtime.json` remains an exact instance of the pinned upstream locator schema; private generation or digest fields are not treated as Agent-enforced controls. The generation manifest separately binds the locator file digest, resolved roots, artifact digest and generation ID. A controller-owned `LocatorVerifier` validates those bindings at materialization, apply revalidation, activation and reconcile. Consumption-time fail-closed behavior may be claimed only for an Agent adapter with a proven launch/load preflight that invokes the verifier before downstream content is read. Without that hook, status is observation-scoped and the ADR does not claim continuous or Agent-enforced tamper rejection.

- **Remaining risk:** an unsupported Agent can read content mutated after the last controller check. **Required proof:** tamper each bound field/root before launch and between activation and consumption; prove the adapter stops before downstream instructions are read. Otherwise exclude that adapter from `gateway-only` consumption-time integrity claims.
- **Canonical-document veto:** **yes until the ownership and claim narrowing above are in ADR; no after that scope removal.** **Implementation/live-migration veto:** **yes** until the exact verifier and per-adapter preflight gates pass.

## O-02 — `gateway-only` semantics

- **Disposition:** **concede and modify**; **resolution:** scope removed + test/gate added and runnable; **evidence:** source conflict + missing evidence.

`gateway-only` is an entry profile, not evidence that forty Skills are installed, metadata-discoverable or activatable. The complete artifact preserves forty source members; only `pc-prodcraft` is projected.

**Minimal ADR insertion for §§1, 5.3 and 8:**

> `gateway-only` has the following exact semantics: `stored_members = 40`, `projected_members = {pc-prodcraft}`, and `metadata_discoverable_members = {pc-prodcraft}`. Other members are neither directly installed nor metadata-discoverable. For each Agent adapter, `routable_members` is a separately qualified subset proven by routed-handoff tests against the trusted repository locator; `loaded_members` is session evidence only. The control plane must not summarize these predicates as “all 40 installed/available.” A failed or absent routing qualification makes the adapter/profile pair unsupported, not partially successful.

The profile ID may remain `gateway-only` if this truth table is normative. Renaming it to `gateway-entry` would reduce operator ambiguity but is not architecturally required.

- **Remaining risk:** a model/client may discover the gateway but fail to follow repository-routed handoffs. **Required proof:** per adapter, run should-trigger and routed-handoff evals through `pc-intake`, one planning Skill and one quality Skill without operator path injection; record unavailable members.
- **Canonical-document veto:** **yes until “installed/available” equivocation is removed; no after the state semantics are normative.** **Implementation/live-migration veto:** **yes for that adapter's `gateway-only` binding** until routed-handoff evidence passes.

## O-03 — Stored source is not installation

- **Disposition:** **concede**; **resolution:** scope removed; **evidence:** repo-derived inference.

**Minimal ADR replacement for §§1 and 5.1:**

> `artifacts/` stores a complete immutable **managed source artifact**, not a physical installation. State is reported as independent predicates: `STORED(artifact)`, `QUALIFIED(artifact, policy)`, `PROJECTED(root, generation)`, `DISCOVERABLE(adapter, root, members)`, `ROUTABLE(adapter, profile, members)` and `LOADED(session, evidence)`. No aggregate `installed` or `READY` label may collapse unknown predicates. A missing/broken locator can leave an artifact stored and projected while not routable.

- **Remaining risk:** CLI/UI may later reintroduce a misleading aggregate green state. **Required proof:** deterministic truth-table tests for gateway-only, full compatibility, broken locator, missing projection and unsupported Agent.
- **Canonical-document veto:** **yes until “physical installation” is removed and predicates are separated; no afterward.** **Implementation/live-migration veto:** **yes** until machine-readable status implements the state vector without aggregate false green.

## O-04 — 46→40 is a structural diff, not semantic proof

- **Disposition:** **concede and modify**; **resolution:** scope removed + test/gate added and runnable + explicit Owner decision required; **evidence:** missing evidence.

The 39/7/1 arithmetic is useful only as a completeness fixture. It does not prove semantic equivalence. Source identity proves mutation authority, not product substitutability.

**Minimal ADR insertion for §§2, 6 and 14:**

> The `39 mapped / 7 proposed retirements / 1 addition` result is a structural basename fixture only. It grants no semantic-equivalence or deletion authority. Before apply, a 46-row disposition ledger must bind each old receipt/path digest/frontmatter/source, proposed successor or explicit no-successor retirement, Owner disposition, every scoped target root, case-normalized collision result, symlink/alias result and project/global override result. The seven capability retirements require explicit Owner approval. Unknown identities or mutation roots are blocking conflicts. If all host discovery roots are not inventoried, status and claims are scoped to the named roots and must not say “host migrated.”

- **Remaining risk:** an Owner-approved retirement can still remove a useful capability; that is a product decision, not a filesystem inference. **Required proof:** complete ledger, collision fixture and Owner signature over seven retirements and any non-equivalent mappings.
- **Canonical-document veto:** **yes until the arithmetic claim is narrowed and the ledger/Owner gate is normative; no once those are in the contract.** **Implementation/live-migration veto:** **yes** until the actual 46-row ledger, root inventory and approvals exist.

## O-05 — Definition of “transactional”

- **Disposition:** **concede and modify**; **resolution:** scope removed + test/gate added and runnable; **evidence:** source conflict + missing evidence.

The design cannot promise one atomic filesystem transition across legacy removals, new names, multiple roots, caches and ledger sealing. `RECOVERY_REQUIRED` is a safe terminal classification, not atomic visibility.

**Minimal ADR insertion at the start of §7:**

> In V1, “transactional artifact-set replacement” means: (a) serializable execution among managed writers under one mutation lock; (b) an immutable approved plan with compare-and-swap preconditions; (c) write-ahead durability before each destructive boundary; (d) no successful ledger commit until every scoped postcondition is verified; and (e) deterministic recovery to rollback-identity-equivalent pre-state, exact committed post-state, or blocking `RECOVERY_REQUIRED`. It does **not** mean atomic namespace visibility across multiple paths/roots, isolation from raw external writers, cache invalidation, or invisibility to unknown filesystem readers. Transient mixed paths are permitted only inside the declared maintenance interval while participating sessions are quiescent; they are never a committed success state.

Add an explicit list of every `rename/link/unlink/fsync` boundary and state transition to the protocol appendix/implementation plan.

- **Remaining risk:** unknown readers or competing writers can observe intermediate state despite managed serialization. **Required proof:** kill and concurrent-reader/writer injection at every visible boundary; enforce or explicitly attest the new-session barrier.
- **Canonical-document veto:** **yes until atomic-visibility implications are removed and the property is defined; no afterward.** **Implementation/live-migration veto:** **yes** until the state machine and fault matrix pass.

## O-06 — Raw installer is a competing writer

- **Disposition:** **concede and narrow**; **resolution:** scope removed + test/gate added and runnable + explicit Owner decision required; **evidence:** fact + repo-derived inference, as reported by the Challenger.

The ledger can prevent a raw installer from changing **desired state**; it cannot prevent that installer from immediately replacing the Agent-facing projection and therefore changing observed/effective state.

**Minimal ADR replacement for §9:**

> While a collection is managed, its projection names are under an **exclusive-writer operational policy**: raw global `npx/npm` add, update or remove against those names is unsupported and prohibited. Such commands can immediately replace/remove projection objects and change effective Agent behavior; they do not change ledger desired state. V1 provides no transparent prevention and therefore has a bounded-but-unprevented exposure window until the next controller/adapter preflight. Reconcile must classify the mutation as drift/conflict and bounded repair must use the pinned generation. Live adoption requires explicit Owner acceptance of this exposure window and operational prohibition.

- **Remaining risk:** users or automation can violate the policy between checks. **Required proof:** sandbox replay of pinned add/update/remove covering symlink replacement, removal and unmanaged addition; deterministic detection and repair.
- **Canonical-document veto:** **yes until the false “cannot change active” implication is removed; no after scope removal and explicit risk ownership are recorded.** **Implementation/live-migration veto:** **owner-decision-required**, plus passing replay/repair gates.

## O-07 — Independent recovery copy

- **Disposition:** **concede and modify**; **resolution:** scope removed + test/gate added and runnable; **evidence:** source conflict.

Digests prove identity, not byte availability. Quarantine inside the same collection/control subtree cannot support the promised recovery boundary.

**Minimal ADR insertion for §§5, 7, 10 and 14:**

> Before any legacy quarantine or projection mutation, the controller must seal a byte-bearing recovery set in a configured `recovery_root` that is outside every collection store, generation, projection, quarantine and `skill-control` mutation root. It must not use hard links to those roots and must have independent retention/GC authority. The recovery set contains the adopted 46-item pre-state, raw projection identities, operation/rollback manifest, required ledger head, and byte copies of the candidate plus active/previous artifact and generation. Publication order is copy → fsync files/directories → rehash from recovery root → seal manifest → prove readable → only then authorize mutation. Exact undo/repair is claimed only while this recovery set is present and verified.
>
> The guaranteed failure scope is recursive loss/corruption of projection, collection or `skill-control` roots. Whole-home, recovery-root or device loss is outside V1 unless the configured recovery root is on a separately protected failure domain. Loss of both operational and recovery copies yields honest `RECOVERY_REQUIRED`, not an exact-repair claim.

- **Remaining risk:** a same-device catastrophe can destroy both roots unless the Owner chooses an external protected recovery target. **Required proof:** with network disabled, delete projection, locator, active link, generation, artifact, collection subtree and entire `skill-control` root independently; restore from the recovery root and match the rollback identity schema.
- **Canonical-document veto:** **yes until an independent byte-bearing recovery root and failure scope are specified; no afterward.** **Implementation/live-migration veto:** **yes** until deletion/recovery tests pass for the actual configured root.

## O-08 — Observation freshness is not continuous runtime freshness

- **Disposition:** **concede and narrow**; **resolution:** scope removed + explicit Owner decision required; **evidence:** repo-derived inference.

**Minimal ADR replacement for §§3 and 10:**

> The controller reports `OBSERVED_HEALTHY` only as a tuple of artifact, generation, projection roots, adapter, observation timestamp and verifier/policy digest. It is true only for that observation and must not be persisted or displayed as continuous `READY`. Command-time reconcile prevents stale command output, not between-command Agent reads. Continuous runtime integrity is claimed only where a qualified adapter performs launch/load preflight; otherwise the external-mutation detection window is an explicit accepted limitation.

- **Remaining risk:** an Agent without a loader hook may consume mutated bytes before the next observation. **Required proof:** UI/API truth-table tests and, where claimed, loader-time mutation tests.
- **Canonical-document veto:** **yes until continuous-health wording is removed; no after observation scope is normative.** **Implementation/live-migration veto:** **owner-decision-required** for the detection window; continuous-health claims remain vetoed without loader enforcement.

## O-09 — Rollback identity contract

- **Disposition:** **concede and modify**; **resolution:** scope removed + test/gate added and runnable; **evidence:** missing evidence.

“Byte-for-byte entity restoration” is underspecified and overbroad for filesystem objects. The architecture needs a published equality relation.

**Minimal ADR insertion for §§6.1 and 14:**

> `rollback-identity.v1` records, for every scoped object: relative path, object type, regular-file content digest, raw symlink target, directory/file mode, uid/gid where restorable, macOS ACL and xattr digests/payloads, hardlink group where present, and the ordered directory/object manifest. Success means equality under this schema. Inode numbers, atime/ctime, physical sparse/block allocation and other explicitly excluded storage-layout metadata are not part of equality and therefore must not be described as byte-for-byte restoration. Any required field that cannot be captured or restored blocks apply; any mismatch returns `RECOVERY_REQUIRED`.

- **Remaining risk:** the chosen schema could omit metadata relevant to an actual loader or policy. **Required proof:** fixture with directories, files, relative/absolute symlinks, modes, ACLs, xattrs, hardlinks, Unicode/case collisions and denied paths; apply/undo and kill at every phase.
- **Canonical-document veto:** **yes until the equality schema and exclusions replace the vague promise; no afterward.** **Implementation/live-migration veto:** **yes** until filesystem-faithful rehearsal passes.

## O-10 — Per-root profiles, per-adapter qualification

- **Disposition:** **concede and redesign the binding, while preserving one generation commit.**; **resolution:** scope removed + test/gate added and runnable; **evidence:** source conflict.

A profile cannot be collection-global when Agent capabilities differ. The physical projection root is the policy boundary; adapter evidence qualifies whether that root/profile pairing works.

**Minimal ADR replacement for §5.2–5.3 and CLI profile semantics:**

> A generation binds one artifact to a deterministic `projection_bindings[]` matrix, not one `profile_id`:
>
> ```text
> projection_bindings[] = {
>   projection_root_id,
>   profile_id + profile_digest,
>   adapter_ids + adapter_digests,
>   projection_manifest_digest,
>   locator_verification_mode
> }
> generation_id = digest(artifact, qualification, ordered projection_bindings)
> ```
>
> Profile intent is per projection root and qualification is per adapter/root/profile tuple. Distinct roots may simultaneously use `gateway-only` and `full-compatibility` within one committed generation. If multiple adapters consume the same physical root, that root can have only one profile; incompatible requirements are a blocking conflict unless the Owner chooses a common profile and accepts its exposure. No collection-global profile switch is implied.
>
> Planning and profile commands must name the target root/binding explicitly. Status reports the complete matrix and never summarizes a heterogeneous generation as one profile.

- **Remaining risk:** shared roots can force the least-contained common profile, and cached Agent catalogs can still differ from filesystem truth. **Required proof:** one locator-capable and one locator-incapable adapter on distinct roots, plus a shared-root conflict fixture; test plan/apply/status/undo for mixed profiles.
- **Canonical-document veto:** **yes until the singular profile model is replaced; no after the matrix is normative.** **Implementation/live-migration veto:** **yes** until heterogeneous and shared-root fixtures pass.

## O-11 — Projection containment versus context savings

- **Disposition:** **defend only the narrow topology claim; concede every context/runtime implication.**; **resolution:** scope removed + test/gate added and runnable; **evidence:** missing evidence.

The controller can deterministically assert which objects it projected into named roots. It cannot infer discovery, precedence, caching or context tokens from that count.

**Minimal ADR insertion for §§3, 5.3 and 14:**

> `projection membership` is a controller-owned filesystem fact. `metadata discoverability`, duplicate-name precedence, recursive discovery and `context contribution` are adapter/version-specific observed facts. A profile may claim only projection containment until fresh-session evidence binds the stronger predicates to an adapter version, root inventory and adapter digest. Context reduction is never inferred from projection count.

- **Remaining risk:** other roots or caches can expose old/new duplicates or erase the expected context benefit. **Required proof:** per adapter/profile root inventory, discovery list, precedence/recursion behavior, fresh-session before/after evidence and duplicate-name resolution.
- **Canonical-document veto:** **no**, provided the ADR keeps context savings withheld and adds the predicate boundary. **Implementation/live-migration veto:** **no solely from context measurement**, but `gateway-only` use remains vetoed until its discoverability/routing gate passes; any context-savings claim remains vetoed.

## O-12 — Stage the first mutation boundary

- **Disposition:** **concede and modify delivery sequencing**; **resolution:** scope removed + test/gate added and runnable; **evidence:** fact + opinion.

The ADR may define the target architecture, but V1 cannot be one approval that jumps from prose to the live 46→40 mutation.

**Minimal ADR insertion for §13:**

> Delivery is staged, with a separate promotion veto at each boundary:
>
> 0. **Read-only:** resolver, qualifier, exact 46-row disposition/collision plan, state predicates and fixtures; no discovery-root writes.
> 1. **Sandbox:** immutable store, independent recovery root, one-root generation/projection, external-writer replay, phase-kill and rollback identity; no live names.
> 2. **Real-Agent isolated root:** qualify `gateway-only` routing and `full-compatibility` discovery against an explicitly isolated non-default root; no legacy retirement.
> 3. **Optional smallest live canary:** add only `pc-prodcraft` from a sealed generation to one explicitly named, quiescent participating root, with recovery copy and immediate undo; retire zero legacy paths and claim no migration. If the root is shared or cannot be isolated, this canary is prohibited rather than broadened.
> 4. **Live migration:** only after stages 0–3 pass or stage 3 is explicitly judged inapplicable, approve the exact multi-root 46→40 plan hash. This is a new Owner decision, not inherited implementation authority.

- **Remaining risk:** the canary proves only one additive projection seam, not the full breaking migration. **Required proof:** stage-specific artifacts and passing gates; no stage may turn a failed proof into a TODO for the next stage.
- **Canonical-document veto:** **yes until staged promotion boundaries replace one-shot V1 implications; no afterward.** **Implementation/live-migration veto:** **yes** until all applicable earlier stages pass and the exact live plan receives new approval.

## Veto ledger after the proposed corrections

| Objection | Champion disposition | Canonical-document veto after minimal ADR correction | Implementation/live-migration veto |
|---|---|---|---|
| O-01 | concede/modify verifier ownership | no | yes, until verifier + adapter gate |
| O-02 | concede/narrow gateway semantics | no | yes per `gateway-only` adapter |
| O-03 | concede installation terminology | no | yes, until state-vector truth tests |
| O-04 | concede structural-only arithmetic | no | yes, until ledger/inventory/Owner approvals |
| O-05 | concede non-atomic visibility | no | yes, until state machine + kill/concurrency tests |
| O-06 | concede competing-writer window | no, if scope removal and risk are explicit | owner-decision-required + replay gate |
| O-07 | concede common failure domain | no | yes, until independent recovery deletion tests |
| O-08 | concede observation-only freshness | no | owner-decision-required; continuous claim vetoed |
| O-09 | concede incomplete equality contract | no | yes, until filesystem-faithful rehearsal |
| O-10 | concede singular-profile model | no | yes, until root/profile/adapter matrix tests |
| O-11 | defend projection fact only | no | no for migration solely; stronger claims vetoed |
| O-12 | concede overloaded rollout | no | yes, until staged gates and new approval |

This ledger does **not** declare the objections resolved now. It says what exact scope removal, architecture change, test gate or Owner decision would resolve each one. Until ADR text is actually changed, the Challenger's current canonical-document veto remains intact. Until runnable evidence exists, live migration remains vetoed even if the document is corrected.

## Direct answers to the Challenger's synthesis questions

1. **Which component rejects a wrong locator binding?** The controller-owned `LocatorVerifier`; at consumption time only a qualified Agent adapter launch/load preflight can enforce it. The upstream gateway does not own this guarantee.
2. **How is `pc-intake` activated under `gateway-only`?** It is not metadata-activated. It is repository-routed only if that adapter passes the routed-handoff eval; otherwise `pc-intake` is stored but unavailable under that profile.
3. **What is profile scope?** Per physical projection root, qualified per adapter/root/profile tuple, all bound in one generation matrix. Shared-root capability conflict blocks or requires one explicit common-profile Owner decision.
4. **What bytes survive control-root deletion?** A sealed, independently retained recovery set outside collection/projection/quarantine/`skill-control` mutation roots, containing adopted pre-state, manifests/ledger evidence and candidate/active/previous bytes.
5. **What bounds raw `npx` drift?** No transparent prevention exists in V1. An exclusive-writer operational policy, optional adapter preflight, command-time reconcile and bounded repair reduce—but do not eliminate—the exposure window; live use needs Owner acceptance.
6. **What does transactional mean?** Serializable managed mutation plus write-ahead crash consistency and deterministic terminal recovery; not atomic multi-root namespace visibility.
7. **Who approves seven retirements?** The Owner, against a 46-row semantic disposition ledger; basename arithmetic does not approve them.
8. **What is the smallest live proof?** After read-only, sandbox and isolated real-Agent stages, an additive `pc-prodcraft` projection to one isolated participating root with zero legacy retirement and immediate exact undo. If isolation is unavailable, no live canary is safe.

## Champion position after cross-examination

**[Opinion] Preserve the architecture direction, but withdraw the earlier `accept-with-limitations` recommendation for the ADR as currently written.** The correct current decision is **incomplete** until the canonical-contract changes for O-01, O-02, O-03, O-04, O-05, O-07, O-09, O-10 and O-12 are incorporated and the O-06/O-08 exposure boundaries are made explicit.

After those document changes, canonical architecture with limitations can be reconsidered without pretending the live gates have passed. Implementation authority and the 46→40 live migration must remain vetoed until the staged evidence and Owner decisions in this response exist.
