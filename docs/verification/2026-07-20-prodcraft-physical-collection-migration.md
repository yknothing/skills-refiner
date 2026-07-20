# ADR-0005 ProdCraft Physical Collection Migration Acceptance

- **Date:** 2026-07-20
- **Decision scope:** local filesystem deployment and recoverability
- **Live root:** `/Users/whatsup/.agents/skills`
- **Upstream:** `yknothing/prodcraft@fd05978dbbbf5a064205a695af47c8a550f1b224`
- **Final plan SHA-256:** `aafeaa9ee7fb0a958847f88efd81a7f92189572f2f21e6e4baf585fb191cdb31`
- **Final plan hash:** `sha256:de2875ed96300db11c1ce44f66784a44faadf85cbf5b15de28d06753c4961418`
- **Operation:** `prodcraft-de2875ed9630`
- **Decision:** filesystem migration accepted; runtime/context qualification remains `UNVERIFIED`

## Outcome

The requested physical migration is complete. The active deployment is now:

```text
/Users/whatsup/.agents/skills/
├── prodcraft/                         # real collection directory; no SKILL.md
│   ├── INDEX.json
│   ├── pc-prodcraft/
│   └── 39 other direct pc-* members
└── pc-prodcraft -> prodcraft/pc-prodcraft
```

Direct observation after commit proved:

| Acceptance fact | Result |
|---|---|
| Collection root is a real directory | PASS |
| Collection-root `SKILL.md` absent | PASS |
| Direct `pc-*` member count | 40 |
| Member set equals pinned public registry | PASS |
| Old ProdCraft top-level entities active | 0 |
| Old Agent-root ProdCraft projections active | 0 |
| Top-level gateway target | `prodcraft/pc-prodcraft` |
| Agent gateway roots | 15/15 exact |
| Quarantine pre-state | 46 entities + 585 raw symlinks |
| Independent recovery pre-state | 46 entities + 585 raw symlinks |
| `.skill-lock.json` SHA-256 | unchanged: `193a3540064e00a9b0b20444ba9a75b6d81ba18c38619508c80a8db300597900` |
| Direct controller status | `FILESYSTEM_READY`, issues `[]` |
| External receipt state | `superseded` |

The 46 legacy entities were dispositioned as 39 replacements and seven Owner-approved retirements. The upstream-only `pc-requirements-engineering` was added without touching the unrelated `bs-requirements-engineering` Skill.

## Live execution record

The first live attempt used v3 and stopped before active mutation with:

```text
recovery_copy_failed: recovery copy mismatch for acceptance-criteria
mutation_occurred: false
```

The cause was macOS rewriting `com.apple.provenance` during `ditto`/`cp`. The native helper was corrected so the portable security digest still binds mode, owner, flags, ACL and every stable xattr, but excludes only this OS-generated telemetry xattr. A real provenanced-file regression passed. v3 was invalidated.

v4 then committed successfully, but direct post-commit status observed Finder-created `.DS_Store` and correctly exposed a false drift. The operation was returned to `FILESYSTEM_READY`, then exact undo restored all 46 entities and 585 raw links. The controller was narrowed to ignore only root `.DS_Store`; a test proved another unknown entry still produces `DRIFTED`. v4 was invalidated.

The final v5 plan was freshly compiled from the restored live pre-state and committed as `prodcraft-de2875ed9630`. `.DS_Store` reappeared in the live collection, while direct status remained correctly `FILESYSTEM_READY`.

## Verification evidence

| Gate | Current result |
|---|---|
| Upstream `main` network recheck | exact `fd05978dbbbf5a064205a695af47c8a550f1b224` |
| Upstream source structure | `STRUCTURALLY_VALID`; 40 members |
| Upstream scoped validator | PASS: curated surface, frontmatter, gateway/workflow references |
| Native macOS transaction suite | 35/35 PASS outside sandbox |
| Critical collection transaction group | 15/15 PASS |
| Real partial-loop process kills | projection loop PASS; legacy loop PASS |
| Durable phase process kills | 5/5 `SIGKILL → RECOVERY_REQUIRED → recover` PASS |
| Exception rollback phases | 5/5 PASS |
| Independent recovery with corrupt/missing quarantine | PASS |
| Finder metadata exception | `.DS_Store` READY; `.unexpected` DRIFTED |
| Skill scanner regression | 100/100 PASS |
| Installed member loader contract | 40/40 names exact; descriptions present and ≤1024 |
| Installed Markdown references | 166 files, 182 local links, 0 missing |
| `npx skills list -g` | lists `pc-prodcraft` at global gateway |

The static scanner reports no `pc-prodcraft` load blocker, but correctly returns `runtime_verified: false` and `unknown_reason: runtime_loader_not_executed`.

## Adversarial review disposition

Agent-separated reviews found and caused fixes for fake source binding, plan rehash divergence, index/member co-tamper, artifact and quarantine drift, symlink/path escape, missing projection roots, crash recovery, compiler environment, missing index/locator repair, macOS provenance drift and Finder metadata drift.

The release reviewer withheld runtime GO because the 15 roots have only `filesystem_only` qualification. ADR-0005 explicitly separates physical cutover from fresh-session Agent qualification. This acceptance therefore makes no gateway-routing, context-reduction, catalog-cache or runtime-success claim. The reviewer also found that the controller's reference graph covers Markdown links rather than arbitrary prose/backtick repository references; the documentation was narrowed accordingly, while the upstream repository validator evidence remains separately recorded.

## Authority and reconciliation

The immutable upstream commit is content authority. The committed plan, active record, direct filesystem observation, quarantine and independent recovery bytes define the managed local generation. `.skill-lock.json` remains the upstream installer's historical receipt and was not rewritten.

Manual deletion or replacement does not change desired state. `collection status prodcraft --fresh` detects it; bounded missing-object repair uses the active digest-bound artifact, and exact undo uses operation identity plus quarantine/recovery evidence. Raw installer writes remain competing writes and must be reconciled rather than silently adopted.

## Remaining boundary

- Fresh-session Agent discovery, recursive loading, cache invalidation and routed handoff are not yet qualified per Agent.
- Context-window reduction is not claimed until those probes exist.
- Recovery/quarantine retention remains in force; no purge was performed.
- `.skill-lock.json` still describes the superseded installer history by design.
