# Final Evidence Clerk Audit

## Evidence lock

- **Target:** `docs/adr/0004-managed-collection-store-and-transactional-artifact-set-upgrades.md`
- **Target SHA-256:** `ba9305741bc491147ade85aabe66333560c7c3f83bc879a6a267db088d7b150f`
- **Review inputs:** revised ADR-0004, `00-evidence-map.md`, `01-role-and-independence-declaration.md`, `04a-champion-cross-examination.md`, `04b-challenger-cross-examination.md`, and `09-evidence-clerk-audit.md`
- **Review level:** L2 agent-separated package; this final reconciliation is not independent or external verification
- **Evidence boundary:** architecture document and package only; no implementation, Agent-runtime, migration, recovery, context, or fault-injection evidence was added
- **Mutation boundary:** no ADR edit, network write, global Skill mutation, receipt write, projection change, or upstream mutation was performed

The `04a`/`04b` artifacts assessed an earlier ADR hash. Their objection contracts remain review input; this audit decides whether the revised hash above incorporated the required scope removals and architecture boundaries.

## Final result

| Decision surface | Result |
|---|---|
| Target hash | **PASS** — exact requested SHA-256 observed |
| Fact accuracy and authority boundaries | **PASS** |
| Current-vs-future truthfulness | **PASS** |
| EC4-01..EC4-06 canonical-document conflicts | **PASS** — all six are resolved at architecture-document level |
| O-01..O-12 canonical-document conflicts | **PASS WITH OWNER DECISIONS PENDING** |
| Evidence Clerk current-reality veto on canonical architecture candidate | **NO VETO** |
| Canonical promotion now | **BLOCKED** — ADR remains `Proposed`; Judge decision and explicit Owner review/approval are still required |
| Implementation plan authority | **BLOCKED by this ADR alone** — only a separately reviewed implementation plan may be authorized |
| Live implementation, global mutation, or 46→40 migration | **BLOCKED** |
| Environment qualification, real-Agent routing, exact recovery, stable-version, or context-saving claims | **BLOCKED** |

The revised ADR is now an evidence-honest candidate for **canonical architecture with limitations**. It no longer launders named gates, proposed components, or desired recovery behavior into current implementation facts. This pass certifies only the document's truth surface, not feasibility proof or runtime readiness.

## EC4 conflict ledger

| Conflict | Revised ADR disposition | Canonical-document result | Remaining veto |
|---|---|---|---|
| EC4-01 exact-one mapping conflict | §§2 and 7 separate `lexical_candidate_pair` evidence from one final disposition; `replaced`, `retired_by_owner`, `unmapped`, and `conflict` are no longer collapsed as `renamed/replaced` | **Resolved by scope removal and explicit two-stage contract** | Apply blocked until the real 46-row ledger and Owner retirement approvals exist |
| EC4-02 upstream locator narrower than fail-closed claim | §6.3 states locator v1 lacks artifact/generation digests, assigns checks to the control-plane validator, and denies continuous enforcement without a load hook | **Resolved by authority correction and scope removal** | Runtime/profile activation blocked until validator and per-Agent negative replay pass |
| EC4-03 curated gateway plus locator was unqualified composition | §6.2 explicitly rejects that assumption and requires upstream global rendering or a pinned composition fixture plus real-Agent replay | **Resolved by removing the current qualification claim** | `gateway-routed` runtime claim blocked |
| EC4-04 receipt provenance did not prove current bytes or rollback | §7.2 says the 46 items are not adopted, defines required identity capture, makes mismatches conflicts, and requires independently published/re-read recovery bytes before quarantine | **Resolved as a future precondition contract** | Mutation/undo blocked until capture, comparator, recovery publication, and rehearsal exist |
| EC4-05 release/tag absence was volatile and semantically narrow | §2 calls it a time-bound unobserved publisher signal and explicitly denies stability inference or permanence | **Resolved by claim narrowing** | No stable-release inference allowed |
| EC4-06 registry parity was packaging evidence, not qualification | §§2, 3, 6 and 12 separate public membership, artifact identity, environment qualification, activation and runtime evidence | **Resolved by authority separation** | Qualification/runtime/migration blocked |

## Challenger O-01..O-12 resolution ledger

The resolution column below applies only to canonical-document truth. A future gate named in the ADR is not counted as evidence and remains explicitly `specified, unimplemented` under §12.

| Objection | Revised ADR handling | Canonical-document status | Residual status |
|---|---|---|---|
| O-01 locator enforcement exceeds upstream contract | §6.3 gives enforcement to the controller and limits load-time claims to qualified adapters | **Resolved by scope removal + explicit verifier ownership** | Implementation/runtime veto |
| O-02 gateway profile is not forty discoverable Skills | §5.2 renames/narrows it to `gateway-routed`: only `pc-prodcraft` is projected; downstream routing is separately qualified | **Resolved by scope removal** | Per-adapter profile veto until real routing evidence |
| O-03 stored repo is not Agent installation | §§3–5 separate stored, qualified, projected, discoverable, routable and loaded state; §4 expressly denies store-only availability | **Resolved by state-boundary contract** | Status truth-table implementation veto |
| O-04 46→40 arithmetic is not semantic proof | §§2 and 7 make 39/7/1 structural only and require content evidence, collisions, full dispositions, and Owner approval for seven retirements | **Resolved by scope removal + Owner-decision contract** | Apply veto; Owner decision pending |
| O-05 multi-root cutover is not atomically visible | §§1 and 8 define transactional as managed-writer serialization and crash-consistent recovery, explicitly permit maintenance-window intermediate visibility, and forbid mixed success | **Resolved by narrowing the transaction guarantee** | Fault/concurrent-reader proof veto; Owner must accept maintenance-window boundary |
| O-06 raw installer is a competing writer | §9 admits immediate observed/effective drift, no transparent prevention, and a detection window; ledger authority is the only protected plane | **Resolved for architecture by scope removal** | Owner acceptance and sandbox replay/repair gate pending |
| O-07 deletion can destroy recovery material | §§4, 7.2 and 8 place byte-bearing pre-state recovery outside collection/`skill-control`, define GC roots/failure limits, and return `RECOVERY_REQUIRED` when unavailable | **Resolved by independent recovery boundary and narrowed failure claim** | Deletion/recovery implementation veto |
| O-08 command-time freshness is not continuous runtime freshness | §§6.3 and 9 explicitly deny continuous health without a qualified load hook | **Resolved for architecture by scope removal** | Owner acceptance of detection latency; continuous-runtime claim veto |
| O-09 exact rollback identity was underspecified | §7.2 defines the minimum captured identity and makes hardlinks, special files, unsupported metadata, or mismatch blocking conflicts; §12 keeps undo unproven | **Resolved at architecture level with fail-closed scope** | A versioned comparator/schema and rehearsal remain implementation gates; “exact” must not exceed the supported recorded identity |
| O-10 one profile could not model heterogeneous Agents | §§5.2 and 6.2 bind a target/root/profile/adapter matrix in one generation and treat shared-root incompatibility as conflict or explicit Owner risk | **Resolved by matrix redesign** | Per-root/adapter qualification and shared-root fixture veto |
| O-11 context/profile effect was unmeasured | §§5, 10, 12 and 14 withhold context reduction and separate projection membership from discovery/runtime evidence | **Resolved by scope removal** | Any later context claim remains vetoed |
| O-12 V1 overloaded the first live mutation | §10 creates four hard stages: read-only, sandbox, Agent qualification, then separately authorized quiescent migration | **Resolved by staged scope** | Each later stage blocked until the previous evidence exists; live plan needs new approval |

## Current-vs-future and internal-consistency audit

### Passed boundaries

- Status is `Proposed — adversarially revised; Owner review required`.
- §1 is explicitly a proposed decision and defines rather than claims transactional behavior.
- §2 labels the upstream revision a review-pinned candidate, not qualified/stable/active.
- §§4–9 use target topology and normative `必须` contracts; they do not claim the store, generation manager, validator, reconciler, journal, recovery system, or CLI exists.
- §7.2 explicitly says the legacy 46 have **not** been adopted.
- §5.1 separates `first_observed_at`, `fetched_at`, `qualified_at`, `planned_at`, `activated_at`, `updated_at`, and `last_observed_at`; it forbids overwriting event times or treating filesystem mtime as install time, and binds version display to resolved revision plus artifact digest rather than a moving tag/branch.
- §10 is explicitly proposed staged delivery.
- §11 says command names are design interfaces, not implementation facts.
- §12 is titled `specified, unimplemented` and states that no gate is runnable or passing; a named gate is not evidence.
- §14 makes positive consequences conditional on implementation and passing gates.
- §15 keeps implementation, mutation, migration, stable-version, and context claims outside architecture acceptance.

### Non-blocking residual wording/package issues

1. Earlier package artifacts use the superseded profile name `gateway-only`; the revised ADR's authoritative name is `gateway-routed`. Final ledgers must treat the old term as historical, not as a second supported profile.
2. `exact pre-state` is bounded by §7.2's supported identity capture and fail-closed handling of unsupported metadata. Until a versioned identity schema/comparator exists, no report may expand “exact” to inode/time/storage-layout identity or claim a rehearsal passed.

No remaining internal contradiction in the revised ADR requires an Evidence Clerk canonical-document veto.

## Residual objections

### R-FINAL-01 — Owner decisions are not yet recorded

- **Severity:** High for promotion/live adoption
- **Status:** `owner-decision-required`
- **Required decisions:** per-target fallback/exclusion, seven capability retirements, maintenance-window/non-atomic visibility, unknown consumers on shared roots, raw-installer exposure window, command-time freshness, and receipt drift UX.
- **Effect:** blocks promotion from `Proposed` until Judge/Owner records the accepted boundaries; blocks live adoption independently.

### R-FINAL-02 — All novel enforcement and recovery evidence is missing

- **Severity:** Critical for implementation/mutation, no canonical-document veto
- **Status:** unresolved implementation proof
- **Required evidence:** controller locator validator; packaging fixture; real-Agent routed/full profile qualification; complete 46-row disposition/collision/root inventory; independent recovery bytes; versioned rollback comparator; phase-kill, `EXDEV`, disk-full, permission, concurrent-reader, external-writer, freshness and undo replays.
- **Effect:** blocks implementation acceptance and every live mutation claim.

### R-FINAL-03 — Package terminology must converge on the revised ADR

- **Severity:** Medium
- **Status:** package-hygiene limitation
- **Required action:** later Judge/claim-ledger/acceptance artifacts must cite target SHA `ba930574…`, use `gateway-routed`, and preserve the distinction between document-level resolution and passing runtime evidence.
- **Effect:** does not veto the revised ADR; does block a misleading final acceptance record.

## Forbidden claims

- Any §12 gate exists, is runnable, passed, or proves feasibility.
- ProdCraft has been migrated, activated, repaired, or made recoverable by current code.
- The 39 lexical pairs are semantic renames or the seven retirements are already approved.
- The reviewed upstream commit is stable, environment-qualified, or active.
- Registry/index parity proves runtime compatibility.
- The upstream locator enforces artifact/generation digests.
- `gateway-routed` makes all 40 Skills metadata-discoverable or works in any real Agent.
- Multi-root cutover is atomically visible or continuous health is enforced.
- Raw installers cannot change what an Agent sees before reconcile.
- Exact rollback has been rehearsed or covers identity outside the future supported schema.
- Context has been reduced.
- The L2 review is independent/external.
- Architecture acceptance authorizes implementation or filesystem mutation.

## Promotion ceiling

| Surface | Final Evidence Clerk ceiling |
|---|---|
| Revised ADR truth surface | **PASS WITH LIMITATIONS** |
| Current ADR status | `Proposed` |
| Next allowed decision | Judge/Owner may consider `canonical architecture with limitations` after explicit Owner-risk decisions |
| Planning use | Architecture input for a separately reviewed implementation plan |
| Implementation authority | Blocked by this ADR/package alone |
| Upstream candidate | Review-pinned candidate only |
| Environment qualification | Blocked |
| Agent/profile availability | Blocked per adapter/root/profile until evidence |
| Global Skills mutation / 46→40 apply | Blocked; separately authorized Stage 4 only |
| Exact recovery/undo reliability | Blocked until schema, bytes, and fault evidence pass |
| Stable-version and context-saving claims | Blocked |
| Independent/external wording | Blocked at L2 |

**Evidence Clerk final decision:** no current-reality conflict remains in the revised ADR that independently vetoes canonical architecture with limitations. Canonical promotion is nevertheless not complete: it remains blocked until the Judge records an acceptable decision and the Owner explicitly approves the stated risk boundaries. All implementation, runtime, recovery, and migration authority remains blocked.
