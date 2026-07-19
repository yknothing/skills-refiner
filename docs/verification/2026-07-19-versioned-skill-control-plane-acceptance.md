# ADR-0003 Acceptance Record

- **Date:** 2026-07-19
- **Target:** `docs/adr/0003-versioned-skill-control-plane-and-physical-collections.md`
- **Source base:** `d26690da0e62a68e77e09db6e3b91d6905f0f5fe`
- **Review package:** `docs/adversarial-product-pk/2026-07-19-versioned-skill-control-plane/`
- **Review level:** L2 agent-separated, shared evidence packet; not independent/external
- **Decision:** Accepted with limitations

## What is accepted

ADR-0003 is canonical for these architecture boundaries:

1. remote immutable revision is authoring/content authority, not deployment truth;
2. source trust, artifact identity, environment qualification, deployment intent and observed reality are separate fact domains;
3. `.skill-lock.json` is reused as version-bound external receipt evidence, not extended into the control authority;
4. local ledger/catalog/journal live outside `~/.agents/skills`;
5. effective health is derived from fresh observation, not stored as timeless `READY`;
6. V1 is one ProdCraft physical-collection vertical slice;
7. current local 46 old-name entities and upstream 40 `pc-*` entities are incompatible sets and neither auto-updates the other;
8. external staging, portable references, qualified gateway, Agent-specific discovery and quiescent cutover are mandatory;
9. raw global `npx/npm` writes are external drift, not implicit desired-state edits.

## What is not accepted or proven

- No ProdCraft revision is selected or qualified by this acceptance.
- No physical migration is authorized or performed.
- No file ledger, anchor, reconciliation engine or managed installer exists.
- No runtime loader or context before/after result exists.
- The 92 links are a bounded Claude+Factory observation, not all machine projections.
- The review is L2, not independent or externally verified.

## Evidence summary

| Evidence | Result |
|---|---|
| Top-level actual Skills | 129 |
| Receipt schema / entries | v3 / 173 |
| Actual/receipt intersection | 122 |
| Actual-only / receipt-only | 7 / 51 |
| ProdCraft receipt/actual | 46 / 46 |
| ProdCraft receipt resolved revisions | 0 / 46 |
| Known Claude+Factory links | 92 |
| Direct-nesting regressions | 10 new broken relative Skill links |
| Reviewed ProdCraft upstream | `fd05978dbbbf5a064205a695af47c8a550f1b224`, 40 `pc-*` public Skills |
| Reviewed Vercel Labs skills upstream | `777599e1159e401b11ce4c8a57c20f09a8f1596e` |

## Gates run

All commands were read-only and exited 0 during the 2026-07-19T15:42Z–15:44Z verification window:

- repository base and receipt digest;
- direct actual/receipt/ProdCraft inventory;
- bounded Claude+Factory symlink inventory;
- lower-bound target-layout reference simulation;
- pinned upstream commit/registry fetch;
- static frontmatter/description/reference preflight for the five used/inspected Skills;
- local Markdown link check;
- `git diff --check` and placeholder scan.

The full replay scopes and exact observed values are preserved in the review package's `00-evidence-map.md`, `06-claim-ledger.md` and `acceptance.md`.

## Promotion boundary

| Level | Decision |
|---|---|
| Architecture truth | Accepted with limitations |
| Planning input for a separate implementation design | Allowed |
| Implementation authority | Blocked |
| Filesystem mutation | Blocked |
| ProdCraft migration | Blocked |
| Stable-version claim | Blocked until qualification |
| Context-saving claim | Blocked until per-Agent evidence |

The first implementation plan must treat every migration fitness function in ADR-0003 as a hard acceptance gate and must receive a separate adversarial review before any global Skill mutation.
