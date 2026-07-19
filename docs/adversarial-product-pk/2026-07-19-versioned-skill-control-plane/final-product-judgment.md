# Final Architecture Judgment

## Conclusion

ADR-0003 is accepted as **canonical architecture with limitations**. The original draft is not accepted; the accepted artifact is the adversarially revised version.

The winning thesis is:

> A remote immutable revision is authoring/content authority; trust policy decides origin trust; environment-bound qualification decides whether a version is acceptable; the external local ledger decides deployment intent; fresh direct observation decides runtime reality; only the controller derives effective health.

This directly answers the single-source-of-truth concern without inventing a false universal database. One fact class has one authority.

## Decisions that changed under attack

1. `stable` and `pinned` became orthogonal qualification and selection states.
2. The ledger moved from the deploy root to `~/.agents/skill-control`, with a separately addressed macOS head anchor.
3. The current installed gateway was declared ineligible for nested collection.
4. Current local 46 old-name entities were reclassified as an unresolved legacy deployment snapshot, not a coherent upstream release.
5. The upstream 40 `pc-*` set was classified as an incompatible candidate, not latest-as-stable.
6. Staging moved outside all Agent discovery roots.
7. V1 changed from broad multi-source management to one ProdCraft vertical slice.
8. Watcher correctness was removed; freshness is computed at read and mutations synchronously reconcile.
9. Cutover became an explicit maintenance operation rather than implied batch atomicity.
10. Reference handling chose upstream portable contracts and forbids ad-hoc symlink/content rewrites.
11. Raw `npx/npm` became unsupported external mutation, modeled as artifact-set drift rather than silently absorbed state.

## Why acceptance does not authorize migration

The architecture is decision-ready because every observed conflict now has a chosen boundary and a falsifiable gate. The implementation is not ready because those gates have not been built or passed.

ProdCraft activation is blocked until all of the following exist:

- exact approved upstream collection revision and manifest;
- collection-aware gateway;
- zero new unresolved references;
- complete participating Agent projection inventory;
- per-Agent recursion/cache/reload evidence;
- durable ledger/anchor and phase kill evidence;
- quiescent cutover and exact rollback rehearsal;
- real Agent runtime proof.

Context savings additionally require post-cutover new-session before/after evidence per Agent.

## Reversal evidence

Reopen or supersede the decision if:

- an official Agent catalog/load API removes the need for physical discovery projections;
- upstream installers provide a transactional custom target and sufficient qualification/recovery authority;
- no eligible collection-aware ProdCraft revision can be produced without unsafe content transformation;
- the file ledger cannot pass durability/recovery gates;
- Agent recursive discovery defeats the physical collection benefit;
- the Owner changes the version trust or automatic-promotion policy.

## Final veto status

| Promotion level | Status |
|---|---|
| Architecture package | No veto; accepted with limitations |
| Implementation plan | Blocked pending a separate reviewed plan |
| Filesystem mutation | Veto |
| ProdCraft physical migration | Veto |
| Context-saving claim | Veto |
| Independent/external verification claim | Veto |
