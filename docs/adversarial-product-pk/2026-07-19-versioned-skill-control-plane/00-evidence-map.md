# Evidence Map — Versioned Skill Control Plane

**Artifact target:** `docs/adr/0003-versioned-skill-control-plane-and-physical-collections.md`
**Repository snapshot:** `d26690da0e62a68e77e09db6e3b91d6905f0f5fe`
**Machine snapshot:** 2026-07-19 Asia/Singapore
**Review scope:** architecture artifact only; no physical migration or installer mutation

## Canonical and supporting sources

| Source | Evidence class | Status | Use |
|---|---|---|---|
| Product-owner instructions in current task | Product-owner decision | Current | Git/version authority, ProdCraft physical migration, first-version quality bar |
| `docs/adr/0002-on-demand-pack-catalog.md` | Fact | Current repo | S0/S1/S2 context and claim boundary |
| `docs/superpowers/specs/2026-07-14-skill-disposition-cli-design.md` | Fact | Current repo | locking, immutable plan, quarantine, recovery semantics |
| `docs/verification/2026-07-15-skill-disposition-macos.md` | Fact | Bound historical verification | Existing macOS mutation evidence; not ADR-0003 implementation evidence |
| `docs/REVIEW.md` | Expert review | Current repo | catalog authority, validator, evidence and backlog risks |
| `~/.agents/.skill-lock.json` | External installer receipt | Current machine snapshot | Source/path/hash/time evidence; not desired-state authority |
| installed `skill-scan.sh --json --no-write --skip-provenance-tree` | Direct observation | Ran 2026-07-19 | topology and conservative runtime snapshot |
| Vercel Labs `skills` CLI source | External primary source | `777599e1159e401b11ce4c8a57c20f09a8f1596e` queried 2026-07-19 | lock schema and install/update behavior |
| `yknothing/prodcraft` repository and public registry | External primary source | `fd05978dbbbf5a064205a695af47c8a550f1b224` queried 2026-07-19 | current upstream membership/naming counterexample |
| Installed `prodcraft/SKILL.md` | Direct observation | Current machine snapshot | current gateway runtime-resolution contract |

## Direct observations

| Observation | Result | Evidence boundary |
|---|---:|---|
| Top-level `~/.agents/skills/*/SKILL.md` | 129 | Direct filesystem |
| `.skill-lock.json` schema | v3 | Direct file read |
| `.skill-lock.json` entries | 173 | Direct file read |
| Actual top-level with same-name receipt | 122 | Direct join |
| Actual top-level without receipt | 7 | Direct join |
| Receipt without same-name top-level | 51 | Direct join |
| `yknothing/prodcraft` receipt entries | 46 | Direct receipt filter |
| ProdCraft receipt entries physically present top-level | 46/46 | Direct filesystem |
| ProdCraft non-gateway description characters | 10,317 | Parsed frontmatter |
| Projected top-level after hiding 45 members | 84 | Arithmetic projection, not runtime proof |
| Static runtime load blockers | 0 | Scanner static preflight only |
| Receipt SHA-256 | `193a3540064e00a9b0b20444ba9a75b6d81ba18c38619508c80a8db300597900` | Direct hash |
| Common resolved revision recorded by 46 receipts | none | Direct receipt field audit |
| Known ProdCraft distribution symlinks | 92 | Bounded roots: Claude 46 + Factory 46; not a machine-global total |
| Migration-induced relative `SKILL.md` breaks | 10 | Read-only lower-bound simulation |
| Current upstream public set at pinned snapshot | 40, all `pc-*` | Direct public registry read |
| Current installed/receipt set | 46, old unprefixed names | Direct filesystem + receipt join |

## Verified constraints

1. ADR-0002 explicitly forbids claiming context savings before a real mount/discovery mechanism is implemented and measured.
2. Existing disposition design already has exact-identity, no-follow, immutable-plan, quarantine and recovery contracts worth reusing.
3. The upstream lock is not converged with the current top-level filesystem and cannot alone represent current deployment truth.
4. The installed scanner's `runtime_contract.status=unknown` means the real Agent loader was not executed; zero blockers is not loader certification.
5. The current installed gateway explicitly forbids searching for downstream members inside its own directory; an `INDEX.json` writer does not satisfy that reader contract.
6. Upstream current membership/naming is incompatible with the local receipt set, providing a direct counterexample to latest-as-stable update semantics.
7. No observed storage-runtime fact proves that a file ledger is superior to SQLite; the V1 storage choice remains an architecture decision subject to durability gates.

## Initial assumptions and disposition

- **Unproven; hard gate:** a hidden `.members` subtree will not be included in each target Agent's default discovery context.
- **Unproven; fitness gate:** a file-based append-only ledger can meet the durability and query needs at local-machine scale.
- **Current version contradicted; eligibility prerequisite:** a future approved ProdCraft gateway can resolve a generated runtime locator/index without unsafe content rewriting.
- **Rejected:** Owner approval alone is sufficient to call a revision stable; approval selects risk, while qualification evidence remains separately labeled.
- **Narrowed to V1 Git/GitHub adapter:** staging may reuse external fetch/resolution behavior only outside managed targets.

## Missing evidence

- No ADR-0003 implementation exists.
- No actual ProdCraft migration/dry-run has run.
- No Agent-specific before/after context capture exists.
- No V1 ledger performance, corruption or kill-injection result exists.
- No complete internal-reference migration graph for the 46 ProdCraft members exists.
- No external human or multi-model architecture review exists.
- No common upstream revision has been found that explains the current 46-member machine snapshot.
- No compatibility manifest has been found for the upstream 40 `pc-*` set and the installed 46 old-name set.

## Claims forbidden at this stage

- ProdCraft is migrated.
- Context usage is reduced by a measured amount.
- The control ledger is implementation-ready or proven durable.
- New upstream releases can be automatically classified as stable.
- All manual or external mutations are intercepted.
- This package is L3/L4 independent or externally verified.
- The current 46-member set is an upstream-authoritative coherent release.
- Current or upstream-latest ProdCraft can be physically activated under `.members` without a new gateway/reference contract.

## Reproducibility notes

- The 92-link observation is deliberately bounded to known Claude and Factory top-level symlinks. A broader home-directory glob sees more same-name links, but those roots have not been classified as managed Agent projections and are not used as a migration claim.
- The Challenger lower-bound probe counts 163 relative Markdown targets ending in `/SKILL.md`: 156 resolve in the flat layout, 146 in the simulated nested layout, leaving 10 migration regressions in addition to seven pre-existing breaks.
- A broader Evidence Clerk link parser counted 176 relative Markdown links. The differing totals come from probe scope; both independently identify the same ten new `bs-requirements-engineering` regressions. The final migration gate must use a versioned, complete reference extractor rather than either ad-hoc review probe.
- Primary-source anchors:
  - <https://github.com/vercel-labs/skills/blob/777599e1159e401b11ce4c8a57c20f09a8f1596e/src/skill-lock.ts>
  - <https://github.com/vercel-labs/skills/blob/777599e1159e401b11ce4c8a57c20f09a8f1596e/src/add.ts>
  - <https://github.com/yknothing/prodcraft/commit/fd05978dbbbf5a064205a695af47c8a550f1b224>
  - <https://github.com/yknothing/prodcraft/blob/fd05978dbbbf5a064205a695af47c8a550f1b224/schemas/distribution/public-skill-registry.json>
