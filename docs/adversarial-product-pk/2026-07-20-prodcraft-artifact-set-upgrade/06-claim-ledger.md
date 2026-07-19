# Claim Ledger

| ID | Claim | Label | Evidence/confidence | Validation or reversal | Must not claim yet |
|---|---|---|---|---|---|
| CL4-01 | Review base before ADR-0004 draft was `8af4c408…` | Fact | Direct Git; high | Rebuild if base changes materially | Uncommitted draft was already in that commit |
| CL4-02 | Receipt snapshot is v3/173 at SHA-256 `193a3540…` | Fact, machine-bounded | Direct prior/final read; high | Receipt write invalidates | Receipt is desired/active truth |
| CL4-03 | 46 receipt entries claim `yknothing/prodcraft`, all 46 paths existed, none had `resolvedRevision` | Fact, machine-bounded | Receipt/filesystem join; high | Topology/receipt changes | One coherent qualified legacy release |
| CL4-04 | Reviewed ProdCraft candidate is commit `fd05978…`; fixed tar digest starts `0a4a7251…` | Fact, source-bounded | Fixed snapshot; high | Artifact changes | Stable, qualified or active |
| CL4-05 | Reviewed registry/index public surface is 40 `pc-*` Skills | Fact, commit-bounded | Pinned files/validator; high | Revision changes | All repository Skills or environment suitability |
| CL4-06 | No publisher release/tag signal was observed during review | Fact, time-bounded | Live API without preserved response metadata; medium | Re-query only proves later state | Permanent absence or instability |
| CL4-07 | Set arithmetic is 39 lexical pairs, 7 legacy-only, 1 upstream-only | Fact, deterministic | Receipt names vs registry; high | Input set changes | Semantic rename/replacement |
| CL4-08 | Owner intends to replace proven old ProdCraft items with an approved current `pc-*` surface | Product-owner decision | Current task; high authority | Owner reverses/narrows | Basename authorizes deletion |
| CL4-09 | Upstream locator v1 lacks artifact/generation digest enforcement | Fact, pinned source | Evidence Clerk + pinned source; high | Locator schema changes | Current gateway fails closed on those fields |
| CL4-10 | `gateway-routed` can make downstream members usable while only one entry is projected | Hypothesis | Static upstream prose only; low/medium | Real-Agent routed-handoff tests | All 40 are installed/discoverable/available |
| CL4-11 | A target/root/profile matrix can express heterogeneous Agent exposure | Architecture decision | Revised ADR; medium | Schema/fixture falsifies | Implementation exists |
| CL4-12 | Independent recovery bytes plus a durable journal can support exact bounded recovery | Hypothesis | Revised contract; medium | Deletion/kill/undo gates | Exact recovery is proven |
| CL4-13 | Observation expiry + synchronous reconcile prevents stale managed-command success | Hypothesis | Revised contract; medium | Drift/clock/permission tests | Continuous runtime health |
| CL4-14 | `.skill-lock.json` is reusable external receipt evidence, not control-plane authority | Repo-derived inference | Pinned writer/schema + needed fact domains; high | Upstream contract materially changes | Lock has no value or never gains features |
| CL4-15 | Known 92 links are Claude 46 + Factory 46 only | Fact, bounded | Prior direct inventory; high | Root topology changes | Machine-global total |
| CL4-16 | Revised ADR resolves original claim contradictions in prose | Judge assessment | Cross-examination mapping; medium/high | Final audit finds contradiction | Runnable gates pass |
| CL4-17 | ADR-0004 is a reviewed first design draft | Judge decision | L2 package; high for document status | Owner accepts/rejects/supersedes | Canonical architecture already accepted |
| CL4-18 | ProdCraft is migrated, candidate stable, runtime working or context reduced | Out of scope | No evidence; high | Separate implementation/runtime acceptance | Any completion form |
| CL4-19 | Review is independent/external | Out of scope | L2 shared packet; high | L3/L4 review | Expert independence claim |

## Claim-use rule

Downstream documents must preserve these labels. Design contracts and specified gates are future requirements, not current runtime facts. Machine, upstream, Agent version, policy or topology drift invalidates the corresponding bounded observation until re-run.
