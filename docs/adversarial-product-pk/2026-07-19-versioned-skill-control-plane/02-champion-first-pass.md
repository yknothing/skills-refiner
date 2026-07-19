# Champion First Pass

## Declaration

- **Role:** Champion
- **Review level:** L2 agent-separated first pass
- **Repository snapshot:** `d26690da0e62a68e77e09db6e3b91d6905f0f5fe`
- **Artifact:** ADR-0003 initial draft
- **Hidden:** Challenger conclusions and objections
- **Mutation boundary:** Read-only review; no install, update, migration or canary mutation

## Evidence boundary

### Facts used

- `~/.agents/skills` contains 129 top-level Skills.
- 46 current top-level entities have `yknothing/prodcraft` receipts; the receipts do not contain a common resolved revision.
- The 45 non-gateway descriptions total 10,317 characters; this is not measured Agent context.
- `.skill-lock.json` and the live filesystem have diverged, so the receipt cannot decide current deployment health.
- The installed `prodcraft/SKILL.md` says not to search inside the gateway directory and routes to sibling packages.
- No physical migration, real loader test, ledger fault injection or context capture has run.

### Not validated

- Whether the 46 local entities came from one immutable upstream revision.
- Whether any current gateway can resolve `.members` safely.
- Whether target Agents recursively discover `.members`.
- The complete reference/dependency graph.
- File-ledger durability, concurrency or performance.
- Stable qualification for any new ProdCraft revision.

## Sharp thesis

skills-refiner should become a version-qualified local Skill deployment controller:

1. an approved remote immutable revision decides artifact content;
2. an Owner-approved local ledger decides deployment intent;
3. fresh direct observation decides runtime reality;
4. only the controller may derive effective `READY` from those authorities.

These are not three competing sources of truth. Each answers a different question and cannot substitute for another.

## Strongest architecture case

### Content identity

The deployable identity should bind:

```text
approved origin
+ resolved commit
+ source subpath
+ upstream tree digest
+ packaged artifact digest
+ packaging profile digest
```

Branch, tag, release or default branch may discover a candidate; none can activate it. Lifecycle timestamps are evidence, not content identity.

### Stability is qualification, not a tag

`stable` must be environment-scoped:

```text
artifact revision
+ Agent/profile
+ OS/runtime
+ policy version
+ validation evidence
```

`pinned` is an activation selection property and must not share one enum with `stable` or `candidate`.

### Runtime truth

`READY` must be computed from exact desired path/digest, current direct observation, required projections, loader gates and freshness. A missing canonical member becomes `MISSING`; the controller offers exact restore or explicit accept-removal instead of guessing intent.

### Physical collection

ProdCraft is strategically suitable because it has a gateway, common source and routed lifecycle model. A valid collection nevertheless requires a versioned manifest binding the gateway, member set, source paths, digests, compatibility generation and runtime index schema.

## Champion's own objections to the initial draft

### Critical

1. **Gateway conflict:** the installed gateway does not read `.members` or `INDEX.json` and explicitly prefers sibling packages.
2. **Common-failure domain:** putting control ledger, journal and recovery cache under `~/.agents/skills/.control` allows deploy-root deletion to destroy intent and recovery evidence together.
3. **No coherent release proof:** same receipt source does not prove 46 entities belong to one commit.

### High

4. `pinned` and `stable` were incorrectly modeled as mutually exclusive channels.
5. Per-path atomic rename was described too close to batch atomicity.
6. An unanchored hash chain cannot detect an attacker or accident that rewrites/deletes both tail and head.
7. Lifecycle timestamps were mixed into artifact identity.
8. `stable` lacked Agent/OS/policy/evidence scope.

### Medium

9. Runtime-index routing text had no authoritative semantic source.
10. Ledger durability omitted parent-directory `fsync`, stale-lock and schema evolution.
11. Exact restore cannot rely only on continued upstream reachability.
12. `.members` dot-prefix is not a cross-Agent discovery contract.

## Required priority decisions

1. Move the control root outside the deploy root.
2. Require an immutable, collection-aware upstream gateway and manifest.
3. Prove common revision, member set and reference closure.
4. Split artifact identity, source trust, qualification and activation.
5. Stage outside all discovery roots.
6. Use a maintenance/quiescence contract or generation indirection; do not claim batch atomicity.
7. Add exact rollback, no-false-READY, raw updater drift, corruption and kill-injection gates.
8. Withhold every context-saving claim until Agent-specific before/after evidence exists.

## Falsifiers

- The pinned gateway cannot deterministically load nested members.
- A target Agent recursively includes `.members` metadata in default discovery.
- The member set cannot bind one approved immutable collection manifest.
- Manual deletion still yields `READY` after synchronous reconcile.
- A migration kill cannot converge to exact pre, exact post or `RECOVERY_REQUIRED`.
- Raw update changes active digest without candidate/promotion.
- Exact restore silently substitutes latest.
- Corruption or concurrent writers create two accepted current generations.

## First-pass recommendation

The direction is stronger than filesystem-only, registry-only or `.skill-lock.json`-as-authority alternatives. The initial draft was nevertheless only a promising proposal. Champion did not support canonical promotion before the gateway, control-root, coherent-release and migration-contract defects were resolved in the ADR.
