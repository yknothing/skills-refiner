# Champion First Pass

## Review posture

- **Role:** Champion. This pass argues for the strongest coherent version of ADR-0004; it is not a synthesis or acceptance decision.
- **Declared review level:** This artifact participates in the planned **L2 agent-separated review**. It is not independent, external, implementation validation or market validation.
- **Visibility:** ADR-0004, `00-evidence-map.md`, `01-role-and-independence-declaration.md`, and the Champion process rules in `adversarial-product-pk`. I did not read the Challenger's pass, cross-examination, final judgment, acceptance record, or any other new role output.
- **Hidden until first pass:** Challenger reasoning and conclusions.
- **Inherited-context caveat:** The packet declares possible inherited ADR-0003 context. This prevents L3 wording even though this pass was produced by a separate Champion agent.

### Evidence boundary

This pass is bound to the following exact inputs:

| Input | SHA-256 |
|---|---|
| `docs/adr/0004-managed-collection-store-and-transactional-artifact-set-upgrades.md` | `d80bf02c030ad451ee0d34b0aa1a32f57b6c1785634b7d6ec951e0fdaaa54f8d` |
| `00-evidence-map.md` | `10477cb4f635d551c60eee161e0b208b9ddb8e021ece47a932a2e0f9bf8cd660` |
| `01-role-and-independence-declaration.md` | `143d73a71f76cedcc8a56d76b9b8c54ee06e98ffd42356b542900544b4a1bbe8` |

Repository, upstream and machine facts below are accepted only to the extent recorded in the shared evidence map. I did not independently re-run its GitHub, filesystem, receipt, Agent-root or upstream-snapshot observations. Statements about what the architecture should guarantee are design claims, not current implementation facts.

### Not validated

- No collection store, generation manager, projection manager or managed collection CLI was run.
- No real Agent loaded `gateway-only` or `full-compatibility`.
- No new-session discovery/context measurement was made.
- No 46→40 apply, phase-kill, repair or byte-for-byte undo rehearsal ran.
- The completeness of participating mutation roots and affected Agent consumers was not established.
- The pinned upstream commit was not qualified for this host and is not vendor-declared stable.
- Durability across process crash, host crash, power loss, filesystem boundaries or permission failures was not demonstrated.
- `.skill-lock.json` reconciliation through its native writer was not validated.

Therefore this pass must not be cited as proof that ProdCraft is migrated, `gateway-only` works, context is reduced, the pinned candidate is stable, the receipt is synchronized, or implementation/mutation is authorized.

## Core thesis

**[Opinion] Adopt ADR-0004's selected architecture, with the protocol clarifications below, because the unit of safe change is the entire source-qualified collection while the unit of Agent exposure is an environment-qualified projection. Those are different identities and must not share one mutable directory.**

The winning topology is deliberately three-layered:

1. An **immutable artifact** answers: “What exact upstream repository content was approved and qualified?”
2. An **environment-bound generation** answers: “How is that artifact adapted for this host, profile and participating Agent set?”
3. An **Agent-facing projection** answers: “What may this runtime discover now?”

The 46→40 migration is then one precondition-bound replacement of a set, not 86 loosely related package operations. `latest` discovers a candidate; an immutable commit and artifact digest define the plan; one approved plan hash authorizes a quiescent transaction; fresh observation decides whether the intended post-state is effective.

This is not a generic plugin framework. It is a narrow desired-state controller for one breaking, source-bound collection migration where false deletion and unrecoverable mixed state are worse than added operational machinery.

## User, job and product contract

- **ICP [Repo-derived inference]:** the host owner/skills-refiner maintainer operating multiple Agent discovery roots and needing to replace a provenance-ambiguous local collection with a pinned upstream public surface.
- **Job to be done [Repo-derived inference]:** “Upgrade a breaking Skill collection as one reviewable unit without deleting unrelated same-name Skills, patching upstream content, exposing every member by default, or losing the exact pre-state.”
- **Product contract [Opinion]:** given an approved repository/ref, observed local state and explicit projection profile, produce a deterministic candidate, immutable plan and recoverable apply whose outcome is provably exact pre-state, exact post-state, or fail-closed `RECOVERY_REQUIRED`.
- **Differentiation [Repo-derived inference]:** raw package installation and its receipt provide package history; this controller adds set identity, desired-state authority, source/identity deletion gates, environment-bound projection policy, synchronous drift reconciliation and transaction-grade recovery.

No market size, user demand, willingness-to-pay or general multi-collection demand is claimed.

## Why the selected architecture is internally necessary

| Constraint | Install all 40 at top level | Private `pc-prodcraft/.members` | Complete immutable store + projections |
|---|---:|---:|---:|
| Preserve the pinned upstream gateway/source-repository contract | Partial | No | Yes, subject to locator qualification |
| Avoid claiming all 40 are directly discoverable by default | No | Unclear/private behavior | Yes |
| Bind content once while supporting Agent-specific exposure | No | No | Yes |
| Replace 46→40 as one recoverable set transaction | Not supplied | Not supplied | Yes, if the journal protocol passes |
| Undo without resolving `latest` again | Not supplied | Not supplied | Yes |
| Detect external mutation without treating receipt as desired state | Not supplied | Not supplied | Yes |

The conclusion follows from the conjunction of the constraints, not from directory-layout preference:

1. **Repository completeness is a fidelity requirement.** The pinned gateway can use trusted repository context and explicitly does not define a private nested-member contract. Flattening only the 40 packages discards repository-grade context; `.members` invents a downstream runtime contract. A complete pinned repository is therefore the faithful artifact boundary.
2. **Complete storage must not imply complete discovery.** The default profile intentionally exposes only `pc-prodcraft`; otherwise physical collection management and context containment collapse into the same concern. Projection is the necessary host-adapter boundary.
3. **Projection is environment state, not source content.** Locator paths, profile membership and Agent adapters vary by host. Keeping them in a generation preserves upstream bytes and makes local adaptation independently digestible and replaceable.
4. **Breaking membership changes require set semantics.** Thirty-nine mapped replacements, seven retirements and one addition have one shared precondition and one rollback boundary. Per-directory success cannot represent collection success.
5. **Desired, observed and effective state must remain separate.** The ledger records approved intent; the filesystem supplies current evidence; the controller derives availability. This is the only consistent way to make manual deletion or raw installer writes produce drift/conflict instead of a false fresh `READY`.

## Deliberate sacrifices

The strategy wins by refusing several attractive promises:

- It sacrifices raw-installer simplicity for a narrow control plane, journal and projection layer.
- It sacrifices metadata-first discovery of all 40 members in the default profile; Agents unable to route through the locator must use a separately qualified `full-compatibility` profile.
- It sacrifices zero-downtime and loaded-session rollback. The first cutover requires a maintenance window, and claims begin only for new sessions after commit.
- It sacrifices automatic `latest`, unattended promotion and per-prompt hot mounting. Candidate discovery and activation remain separate explicit acts.
- It sacrifices immediate genericity: one approved source, one collection, macOS and verified Agent adapters only.
- It sacrifices receipt tidiness: `.skill-lock.json` may truthfully remain stale evidence rather than being silently rewritten as deployment authority.
- It accepts extra disk usage by retaining a complete pinned repository plus prior generation/quarantine needed for exact recovery.

These are not temporary omissions to hide in “future work.” They are scope controls that keep the safety claim testable.

## Architectural invariants

The architecture should be considered coherent only while all of these hold:

1. **Immutable resolution:** a compiled plan binds one repository identity, resolved commit, source-tree digest and artifact digest. Apply and undo never re-resolve a moving ref.
2. **Source fidelity:** stored upstream bytes are complete and unpatched. Generated locators/manifests are separately identified generation bytes and cannot alter the artifact digest.
3. **Artifact/generation separation:** artifacts express portable source truth; generations bind artifact, qualification, profile, locator, projections and Agent adapters for one environment.
4. **No basename authority:** an old path can be retired only after source binding, path/type/containment checks and observed identity match. Any mismatch is a blocking conflict; similar third-party names remain untouched.
5. **Plan immutability:** the plan hash covers candidate, full scoped pre-state, receipt/policy evidence, profile, projection inventory and every mutation. Revalidation failure invalidates the plan rather than recompiling it under the same approval.
6. **Set-level success:** 46→40 is committed only when every planned retirement/addition/projection and the activation/ledger binding reaches the same post-generation. A per-member partial success is never reported as deployed.
7. **One committed generation:** all participating projections resolve to one generation at commit. `gateway-only` exposes exactly its approved projection set; an unprojected member is never described as directly discoverable.
8. **Fresh health:** `READY` is derived only after synchronous observation of all authority-bearing paths and relevant loader evidence. Missing, modified, unreadable or identity-mismatched state fails closed.
9. **Bounded recovery states:** after any interruption, recovery proves exact pre-state, proves exact post-state, or enters `RECOVERY_REQUIRED` and blocks new mutation. There is no “mostly upgraded” success state.
10. **Identity-preserving undo:** rollback restores the adopted legacy snapshot's bytes, path types and raw symlink targets from retained evidence; it never fabricates history from the current upstream head.
11. **External-installer non-authority:** raw `npx/npm` mutation and `.skill-lock.json` changes cannot silently change desired deployment or active generation.
12. **Session boundary:** no runtime/context guarantee applies to already-loaded sessions, and no new participating session may start during the uncommitted cutover interval.

Any implementation that weakens one of these is a different architecture and requires a new decision, not a “small implementation detail.”

## Priority and scope

Priorities below govern a later implementation plan; they do not authorize implementation.

### P0 — required before the first mutation

- Immutable candidate resolution, complete artifact storage and digest verification.
- Exact 46→40 classifier with the 39 mapped / 7 retired / 1 added fixture and fail-closed collision handling.
- Per-old-path source, identity, containment and type preconditions; complete scoped mutation/projection inventory.
- Exact adopted pre-state and rollback manifest, including raw symlink identity.
- Qualification of registry/index/package parity, gateway bytes, generated locator and both declared profiles.
- Content-addressed plan, explicit plan-hash approval and revalidation under a global mutation lock.
- Durable journal state machine, same-filesystem or explicitly durable cross-filesystem quarantine protocol, cutover ordering, recovery and mutation blockade.
- Quiescence/new-session barrier with an explicit, auditable authority model.
- Fresh reconcile/status semantics and deterministic machine-readable error states.
- Phase-kill, corruption, drift, false-deletion, projection, real-Agent loader and byte-for-byte undo gates.

### P1 — after one safe, measured cutover

- Native `.skill-lock.json` writer adapter, only if it preserves the authority split and passes rollback tests.
- More Agent adapters and additional Owner-approved curated profiles, each separately qualified.
- Retention/garbage-collection policy with reachability proofs for active, rollback and recovery artifacts.
- Operational telemetry for check/apply/recovery duration and storage cost; telemetry must not become a correctness dependency.

### P2 — reconsideration territory

- Official runtime load APIs replacing filesystem projections.
- Session-level profile mounting or automatic context selection.
- Signed/versioned upstream release policy and stronger supply-chain attestations.
- Generalization beyond ProdCraft, multiple concurrent collections, or non-macOS mutation.

### Non-goals

- Transparent interception of arbitrary installers.
- Unattended promotion from `main`/`latest`.
- A generic marketplace, plugin framework or “super Skill” containing all descriptions.
- Zero-downtime cutover or rollback of already-loaded sessions.
- Editing upstream `SKILL.md` or introducing private `.members` behavior.
- Claiming all 40 Skills are metadata-first discoverable under `gateway-only`.
- Proving context savings without fresh-session measurements.

## Validation and falsification plan

### Required validation ladder

1. **Determinism:** replay candidate resolution and plan compilation against fixed fixtures; changing upstream `main` after compilation must not change the plan.
2. **Set correctness:** assert exactly 40 pinned public members, 39 mappings, seven explicit retirements, one explicit addition, and zero silent drops or unrelated mutations.
3. **Fidelity:** rehash the complete stored repository and every public package; prove upstream gateway bytes are unchanged and generated generation bytes are outside the artifact identity.
4. **Gateway contract:** test locator success only for the bound repository/generation and fail closed on path escape, wrong repository, missing identity file, missing member and digest mismatch.
5. **Real runtime:** in a fresh participating Agent session, prove `gateway-only` exposes only the approved projection, routes to unprojected content through the trusted locator where promised, and does not recurse into the store. Separately qualify `full-compatibility`.
6. **Ownership safety:** inject stale receipts, same-name third-party Skills, symlinks, modified trees, missing paths, unreadable paths and collisions; every unsafe retirement must block with zero unrelated mutation.
7. **Crash/power-loss model:** kill after every journal, quarantine, projection, activation and ledger-seal boundary; each replay must converge to exact pre, exact post or explicit `RECOVERY_REQUIRED`.
8. **Cross-root consistency:** exercise every supported filesystem topology and Agent root. No committed result may contain mixed generations; unsupported topology must fail before mutation.
9. **Drift truth:** delete/modify the artifact, generation, gateway, locator and projections, and replay raw installer add/remove/replace; the next status/mutation preflight must never emit fresh `READY` or silently adopt it.
10. **Undo:** after successful cutover and after recoverable interruptions, restore all 46 adopted legacy entities and all participating projection identities byte-for-byte without network access or moving-ref resolution.

### Falsification conditions

The **`gateway-only` default is falsified for an Agent adapter** if a fresh real session cannot reliably route through the exact locator, unexpectedly discovers stored members, or requires patching upstream content. That adapter must use a qualified fallback profile or be excluded; the failure must not be averaged away.

The **transaction architecture is falsified** if any supported fault point can produce an unclassified mixed state, if exact pre/post identity cannot be proven, if an unmodeled consumer can observe a mutated shared root contrary to the declared maintenance boundary, or if external installer activity can silently change desired/active state.

The **need for this control plane should be reconsidered** if an upstream or host runtime supplies equivalent version-qualified set identity, transactional custom-target activation, exact rollback and projection policy. Redundancy would then outweigh differentiation.

## Required ADR modifications before promotion

I support the architecture direction, but the following gaps should be corrected before calling it canonical even with limitations:

1. **Specify the durable filesystem protocol.** The ADR names journal, quarantine and activation phases but not fsync/rename ordering, directory durability, same-filesystem requirements, cross-device behavior, or the recovery decision table. “Exact pre/post or `RECOVERY_REQUIRED`” is currently an acceptance target, not yet a complete protocol.
2. **Separate mutation-root completeness from Agent-consumer completeness.** “Unsupported/unverified Agent roots are excluded and left unchanged” is insufficient when multiple runtimes consume one shared `~/.agents/skills` root. The ADR must define the complete mutation scope, all known consumers of each mutated root, who can assert quiescence, and when unknown consumers block versus require explicit Owner risk acceptance.
3. **Make the new-session barrier enforceable or honestly attestational.** A stopped-session precondition and “loaded sessions are outside rollback authority” need an explicit maintenance-lock/Owner-attestation contract. The commit point must state when new sessions may resume after ledger/pointer reconciliation.
4. **Disambiguate “exact gateway.”** The projected `pc-prodcraft` directory contains exact upstream files plus generated `prodcraft-runtime.json`. Record separate upstream gateway subtree digest and projection wrapper digest so “gateway bytes match” cannot be misread as whole-directory byte identity.
5. **Define artifact immutability and corruption handling.** A digest-named directory is not immutable by itself. State write-once publication, permission policy, verification points, behavior on post-publication mutation, and retention/GC reachability for active and rollback generations.
6. **Define committed visibility during multi-path replacement.** The ADR should explicitly say whether transient mixed top-level paths are permitted only behind enforced quiescence, how projections reference `active`, and how profile membership additions/removals are hidden until the commit boundary.
7. **Tighten qualification-policy identity.** The plan binds `policy_digest`, but the ADR should define who approves that policy, which upstream tests are mandatory, and how a policy/tool version change invalidates prior qualification.
8. **Turn P0 fitness functions into a mutation hard stop.** Architecture acceptance may authorize a separate implementation plan only. Mutation authority must remain blocked until the real-Agent, crash matrix, false-deletion, drift and exact-undo gates pass for the exact artifact, host and participating adapters.

## Champion recommendation

**[Opinion] Recommend `accept-with-limitations` for the architectural direction after the eight modifications above are incorporated; retain an explicit implementation and mutation veto.**

The decisive strength is the identity split: upstream content, environment adaptation, desired deployment and observed runtime are represented separately and joined only by digests and a transaction. That makes the proposal capable of preserving upstream fidelity, minimizing default exposure and performing a source-safe 46→40 replacement without pretending package-manager receipts are deployment truth.

The decisive risk is also clear: the projection manager becomes critical infrastructure. Until the durable protocol and real fault/runtime gates exist, the ADR is a coherent target architecture, not a proven upgrade mechanism.
