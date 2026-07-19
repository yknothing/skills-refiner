# ADR-0004 First-Draft Acceptance Record

- **Date:** 2026-07-20
- **Target:** `docs/adr/0004-managed-collection-store-and-transactional-artifact-set-upgrades.md`
- **Target SHA-256:** `ba9305741bc491147ade85aabe66333560c7c3f83bc879a6a267db088d7b150f`
- **Source base:** `8af4c408919de54442ae5f59f24576ad25317435`
- **Review package:** `docs/adversarial-product-pk/2026-07-20-prodcraft-artifact-set-upgrade/`
- **Review level:** L2 agent-separated, shared evidence packet; not independent/external
- **Decision:** First design draft accepted for Owner review; ADR remains Proposed

## Accepted in this record

The draft now gives a coherent, evidence-honest answer to the requested mechanism:

1. upstream immutable artifact is authoring/content authority, not local runtime truth;
2. directory catalog stays outside discovery/context and records provenance, exact revision/digest, distinct lifecycle timestamps, target profiles and observed state;
3. full source artifact, host generation, per-target Agent projection and independent recovery bytes are separate;
4. ProdCraft 46→40 is one identity-gated artifact-set plan, not per-folder update;
5. 39 basename matches are lexical candidates only; semantic dispositions and seven retirements require explicit approval;
6. `gateway-routed` exposes only `pc-prodcraft` and requires per-Agent routing evidence; fallback is `full-compatibility` or exclusion;
7. “transactional” means single-writer crash consistency and deterministic recovery classification, not multi-root atomic visibility;
8. `.skill-lock.json` remains its upstream CLI's receipt and is reused as evidence, not extended into desired-state authority;
9. manual deletion/raw installer writes become observed drift/conflict, never silent desired-state change;
10. V1 progresses through read-only, sandbox, Agent qualification and separately authorized live-migration stages.

## Not accepted or proven

- ADR-0004 is not yet canonical; Owner risk decisions remain pending.
- No implementation plan or implementation is authorized.
- No global Skill, receipt or Agent projection was changed.
- The reviewed upstream commit is not stable/environment-qualified.
- No locator verifier, recovery store, journal, reconciler, managed CLI or 46-row semantic plan exists.
- No real Agent routing, crash/kill, external-writer, exact-undo or context evidence exists.

## Evidence summary

| Evidence | Result |
|---|---|
| Top-level real Skills | 129 |
| Receipt schema / entries / digest | v3 / 173 / `193a3540…` |
| Actual/receipt join | 122 intersection; 7 actual-only; 51 receipt-only |
| ProdCraft receipt/entity/revision | 46 / 46 / 0 resolved revisions |
| Known projections | Claude 46 + Factory 46 = 92, bounded |
| Reviewed upstream | `fd05978…`, 40 `pc-*` public Skills |
| Set diff | 39 lexical pairs / 7 legacy-only / 1 upstream-only |
| Fixed tar / registry / index / gateway | SHA-256 locked |
| Upstream checks | curated validator pass; 25 tests pass |
| Used Skill surface | 5 frontmatter/description checks; 19 local links; 0 missing; runtime unknown |
| Final Evidence Clerk result | PASS WITH LIMITATIONS |

## Promotion boundary

| Level | Decision |
|---|---|
| First-draft package | Accepted for Owner review |
| Canonical architecture | Proposed; blocked pending Owner decision |
| Implementation planning | Blocked until Owner review |
| Implementation/mutation | Blocked |
| ProdCraft migration | Veto |
| Stable-version/context claim | Blocked |
| Independent/external review claim | Blocked |

The next gate is human review of the architecture tradeoffs, not filesystem mutation.
