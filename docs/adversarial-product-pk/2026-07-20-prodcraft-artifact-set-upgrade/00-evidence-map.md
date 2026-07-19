# Evidence Map

## Review target

- Target: `docs/adr/0004-managed-collection-store-and-transactional-artifact-set-upgrades.md`
- Repository base before draft: `8af4c408919de54442ae5f59f24576ad25317435`
- Review date: 2026-07-20
- Review scope: architecture document and evidence package only
- Forbidden actions: no mutation of `~/.agents/skills`, Agent projections, `.skill-lock.json` or upstream repositories

## Current facts

| ID | Fact | Evidence | Scope/limit |
|---|---|---|---|
| E-01 | Current branch is `codex/adr-skill-control-plane`, one commit ahead of `origin/main` before this draft | `git status`, `git log` | repository only |
| E-02 | Existing ADR-0003 is accepted with limitations and explicitly blocks implementation/migration | ADR-0003 review and acceptance package | architecture history, not runtime proof |
| E-03 | `~/.agents/.skill-lock.json` schema is v3 with 173 receipts at the prior evidence lock | direct JSON inspection | may drift; must refresh before final acceptance |
| E-04 | 46 receipt entries have `source == yknothing/prodcraft`; all 46 names currently existed at the prior lock | receipt/filesystem join | legacy machine snapshot, not coherent upstream release |
| E-05 | Those 46 receipts contain no resolved revision | receipt field audit | exact historical upstream version unknown |
| E-06 | Review-pinned upstream candidate is `fd05978dbbbf5a064205a695af47c8a550f1b224`; fixed tar SHA-256 is `0a4a72513d15b126e6eb395b2824b347d0110407ba91972a881492bee76b5ae3` | GitHub commit API and downloaded exact tarball | review input only; not qualified/stable/active |
| E-07 | GitHub API returned no publisher release/tag signal during the 2026-07-20 observation | GitHub releases/tags API | volatile observation; response metadata was not preserved, so final acceptance may not treat it as a durable snapshot fact |
| E-08 | Upstream public registry/index contains exactly 40 names, all prefixed `pc-*` | pinned registry and curated index | public surface only |
| E-09 | Upstream declares unprefixed → `pc-*` an intentionally breaking beta migration and warns not to delete by basename | pinned `docs/distribution/npx-skills-compat.md` | source-authoritative migration guidance |
| E-10 | Upstream `pc-prodcraft` forbids searching inside its own directory and resolves trusted repo/locator/sibling packages | pinned curated gateway | contradicts ADR-0003 `.members` target |
| E-11 | Set comparison yields 39 lexical basename candidate pairs, 7 legacy-only names and 1 new upstream basename | deterministic local JSON comparison | no semantic rename/replacement or deletion authority |
| E-12 | Prior bounded inventory found 46 Claude and 46 Factory symlinks | ADR-0003 evidence package | not a machine-global projection total |
| E-13 | Prior direct-nesting simulation found 10 new relative-reference regressions for the old set | ADR-0003 evidence package | irrelevant to exact upstream repository layout, but disproves direct old-tree nesting |

## Owner decisions

1. The target is to replace the old messy ProdCraft Skills with upstream latest `pc-*`, not preserve all 46 legacy packages.
2. Physical collection management remains required.
3. The recommended split between managed physical store and Agent discovery projections is approved for a design draft.
4. The draft must receive adversarial review and an acceptance record.
5. Artifact acceptance must not be presented as implementation or migration completion.

## Source boundaries

### Canonical repository sources

- ADR-0002 and ADR-0003 in this repository.
- Current implementation under `skills/skill-hygiene/` for reusable transaction concepts only.
- Pinned ProdCraft repository snapshot for public set, gateway and migration contract.
- Pinned Vercel Labs `skills` snapshot for external receipt semantics.

### Machine-attested sources

- `~/.agents/.skill-lock.json`.
- Direct filesystem and bounded Agent-root inventory captured in ADR-0003's package.

Machine-attested facts are not portable project defaults and may not be embedded as the repository's desired catalog instance.

## Missing or unproven evidence

- No collection store, generation manager, projection manager or managed update CLI exists.
- No real Agent has loaded the proposed `gateway-only` projection.
- The pinned upstream commit is not yet environment-qualified as stable.
- No crash/kill matrix or exact 46→40 rollback rehearsal has run.
- Participating Agent-root inventory is not yet complete.
- No 46-row semantic disposition ledger or independent recovery copy exists.
- No component currently enforces locator generation/artifact digests at Agent load time.
- External `.skill-lock.json` native-writer reconciliation is not designed as a V1 mutation capability.
- Context reduction is not measured.

## Forbidden claims

- ProdCraft has been migrated.
- The 40-package upstream commit is stable for every Agent/environment.
- `gateway-only` works in a real Agent.
- Context has been reduced.
- `.skill-lock.json` is synchronized.
- The review is independent/external.
- Implementation may begin solely because the architecture package is accepted.
