# Claim Ledger

| ID | Claim | Label | Evidence | Confidence | Validation / reversal | Must not claim yet |
|---|---|---|---|---|---|---|
| CL-01 | Review source snapshot is `d26690d…` | Fact | `git rev-parse HEAD` at evidence lock | High | Rebuild packet if base changes materially | Later commits were reviewed |
| CL-02 | Machine has 129 top-level real Skill directories | Fact | Direct bounded filesystem inventory | High | Re-scan after topology change | All Agents discover exactly 129 |
| CL-03 | Top-level frontmatter preflight has 129/129 name+description and no proven static blocker | Fact, scope-limited | Installed scanner/static parser | High | Re-run after content change | Real Agent loader is certified |
| CL-04 | Receipt is v3 with 173 entries and actual/receipt join 122/7/51 | Fact | Exact receipt hash + direct join | High | Receipt or filesystem digest changes | Receipt is deployment truth |
| CL-05 | Machine ProdCraft receipt/entity set is 46/46 | Fact | Direct filter + filesystem | High | Machine drift | 46 is current upstream public set |
| CL-06 | Those 46 receipts record no common resolved revision | Fact | Receipt field audit | High | Historical source binding is found | 46 is a coherent approved release |
| CL-07 | 45 non-gateway descriptions total 10,317 characters | Fact | Parsed frontmatter | High | Recompute on content change | Equivalent context/token savings |
| CL-08 | Removing 45 top-level entries gives arithmetic count 84 | Fact, arithmetic | `129 - 45` | High | Baseline changes | Agent context necessarily decreases |
| CL-09 | GitHub/equivalent repo is natural authoring/content authority | Product-owner decision | Current task | High authority | Owner reverses | URL/latest proves trust or stability |
| CL-10 | Active versions must bind approved immutable revisions | Product-owner decision + architecture decision | Current task and ADR | High | Owner changes governance | Latest can auto-activate |
| CL-11 | Upstream reviewed snapshot publishes 40 `pc-*` Skills | Fact | `yknothing/prodcraft@fd05978…` registry | High | New revision queried | Local 46 equals upstream 40 |
| CL-12 | Local 46 is a legacy, unresolved-source machine deployment set | Repo-derived inference | Old names + no revision + upstream incompatibility | High | Exact historical revision/manifest is found and approved | It is already qualified/stable |
| CL-13 | Current installed gateway can consume `.members/INDEX.json` | Hypothesis, contradicted | Installed gateway text | Low | New versioned gateway passes contract | Current gateway supports nested collection |
| CL-14 | `.members` is absent from default Agent discovery | Hypothesis | No loader evidence | Low | Per-Agent discovery/context capture | Context is saved |
| CL-15 | `.skill-lock.json` is valuable external receipt, not deploy authority | Repo-derived inference | Local divergence + pinned upstream writer semantics | High | Upstream authority contract materially changes | Lock has no reuse value |
| CL-16 | 92 known ProdCraft symlinks are Claude 46 + Factory 46 | Fact, scope-limited | Direct bounded link inventory | High | Root topology changes | 92 is a machine-global total |
| CL-17 | Direct nesting of current members adds 10 broken relative references | Fact, lower-bound probe | Two read-only simulations with differing total scopes but same regressions | High for the ten regressions | Versioned complete extractor supersedes probe | Full reference graph is complete |
| CL-18 | File ledger can meet V1 durability | Hypothesis / architecture choice | Existing transaction design plus proposed gates | Medium | Corruption, concurrency and kill tests | Durability is proven |
| CL-20 | Read-time freshness plus synchronous reconcile can prevent emitted false-READY | Hypothesis / future contract | ADR state model | Medium | Watcher-off/deletion/clock and mutation tests | Current state engine exists |
| CL-21 | Existing disposition semantics are reusable inputs to migration | Repo-derived inference | Existing design/historical verification | Medium | Concrete migration adapter tests | Migration transaction is proven |
| CL-22 | ADR-0003 is accepted as canonical architecture with limitations | Judge decision | Rubric, objection ledger and final judgment | High for document status | New contradictory evidence or Owner reversal | Implementation/migration is authorized |
| CL-23 | ProdCraft is migrated or context is reduced | Out of scope | No implementation/runtime evidence | High | Migration + Agent-specific proof | Any completion statement |
| CL-24 | Review is independent/external | Out of scope | L2 shared-packet subagents | High | L3/L4 review | Independent expert verification |

## Claim-use rule

Downstream documents must preserve these labels. A future contract, gate or desired behavior may not be rewritten as current implementation fact. Any source/runtime/topology change invalidates the corresponding bounded fact until re-observed.
