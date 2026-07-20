# ADR-0005: `.agents/skills/prodcraft` 物理 Collection 与 `pc-*` 投影

- **Status:** Accepted and implemented for filesystem scope — Agent runtime/context qualification remains open
- **Date:** 2026-07-20
- **Deciders:** Product owner (host machine) + skills-refiner maintainers
- **Supersedes in part:** ADR-0004 §§1, 4, 5.2, 8（ProdCraft active physical topology and projection publication）
- **Preserves:** ADR-0004 的 authority、qualification、recovery、transaction、reconciliation 和 non-claim boundaries
- **Owner direction:** 将旧无前缀 ProdCraft Skills 实际升级为最新审核后的 `pc-*`，并物理集中到 `~/.agents/skills/prodcraft/`

## 1. Decision

ProdCraft V1 的 active physical collection 必须实际位于：

```text
~/.agents/skills/prodcraft/
```

该目录是 collection 容器，不是一个 Skill；根目录不得存在 `SKILL.md`。审核后的 40 个 upstream public packages 以原始 `pc-*` ID 作为直接子目录。Agent-facing top-level surface 通过 projection 指向这些实体。

目标形态：

```text
~/.agents/skills/
├── prodcraft/                              # physical collection; no SKILL.md
│   ├── INDEX.json                          # generated materialized view
│   ├── pc-prodcraft/
│   │   ├── SKILL.md
│   │   └── prodcraft-runtime.json
│   ├── pc-intake/
│   ├── pc-code-review/
│   └── ...                                 # exactly 40 pc-* packages
└── pc-prodcraft -> prodcraft/pc-prodcraft  # default gateway projection
```

迁移后不得继续存在任何来源与身份均确认属于旧 ProdCraft 的顶层无前缀实体。近似名但属于其他 source 的 Skill 必须保留。

## 2. Why ADR-0004 topology changes

ADR-0004 将完整 active content 放在 `~/.agents/skill-control/collections/prodcraft/`，只在 discovery root 投影。该方案便于隔离，但没有满足 Owner 对物理目录的明确要求：ProdCraft collection 本身必须能在 `~/.agents/skills/prodcraft/` 下直接查看和管理。

本决策保留 control root，但改变其职责：

```text
~/.agents/skill-control/                    # desired state, source artifacts, journals
~/Library/Application Support/skills-refiner/recovery/
                                             # independent recovery bytes
~/.agents/skills/prodcraft/                  # active physical public packages
```

因此 repository artifact、control-plane state、recovery bytes 和 active physical packages 仍是四个不同事实面。

## 3. Upstream fidelity and gateway boundary

Reviewed upstream `pc-prodcraft` 明确要求：

- 不在 `pc-prodcraft` 自身目录内搜索 downstream Skills；
- 优先使用 beside-gateway `prodcraft-runtime.json`；
- locator 可指向 trusted full source repository；
- sibling `pc-*` packages 只提供 portable public guidance。

本拓扑不把成员放进 `pc-prodcraft/`，而是把它们作为 collection root 下的 siblings：

```text
prodcraft/pc-prodcraft
prodcraft/pc-intake
prodcraft/pc-code-review
```

所以从 nested gateway 的物理路径看，upstream sibling contract 保持成立。顶层 `pc-prodcraft` 只是指向该 gateway 的 projection，不复制或 patch upstream `SKILL.md`。

`prodcraft-runtime.json` 必须由 upstream-compatible renderer 生成，并指向 digest-bound full source artifact：

```text
~/.agents/skill-control/collections/prodcraft/artifacts/<artifact-digest>/repo
```

Locator 是 runtime routing data，不是 integrity authority；controller 在 publish/status/repair 时验证路径、repository identity 和 digests。无 Agent load hook 时不声明连续 tamper prevention。

## 4. Discovery and context contract

Physical nesting 与 Agent discovery 是两个独立问题。V1 必须在隔离 root 真实探测每个 participating Agent 的：

```text
top-level discovery
recursive discovery
symlink resolution
root precedence
catalog caching/reload
fresh-session metadata surface
```

Profile 规则：

| Profile | Agent-facing projection | Eligibility |
|---|---|---|
| `gateway-routed` | only top-level `pc-prodcraft` | Agent does not recursively discover collection members and routed handoff passes |
| `full-compatibility` | top-level projections for all 40 `pc-*` in that Agent-specific root | metadata-first Agent or routed handoff fails |
| `excluded` | no mutation in that root | adapter/root is unknown or unsafe |

如果某 Agent 会递归发现 `prodcraft/pc-*`，物理迁移仍可被验证，但该 Agent 的 context-containment claim 失败。若 context containment 是该 target 的硬要求，则 live apply 必须阻断，而不是隐藏结果。

实现中的 `filesystem_only` 是显式的未资格化状态，不等于上述三个 runtime profile。Planner 必须先枚举所有物理依赖 root，避免迁走 canonical 实体后留下断链；截至本次 live plan，共发现 15 个 root、585 个精确指向旧 ProdCraft 实体的 symlink。V1 对这些 root 发布单一 `pc-prodcraft` gateway，但在 fresh-session probe 完成前只声明 filesystem projection 成功，不声明 Agent runtime/context 成功。

## 5. Collection index

`~/.agents/skills/prodcraft/INDEX.json` 是只读 generated view，不是 desired-state writer。其 schema 最少包含：

```text
schema_version
collection_id
source.provider
source.repository_id
source.owner_repo
source.resolved_revision
source.tree_digest
artifact_digest
public_registry_digest
members[].name
members[].relative_path
members[].tree_digest
gateway.name
gateway.locator_digest
profile_matrix_digest
receipt_snapshot_digest
plan_created_at
operation_id
```

约束：

- `members` 必须与 pinned public registry 精确相等；
- 每个成员名必须以 `pc-` 开头；
- index 不复制 description 或正文，避免成为 context payload；
- filesystem mtime 不得冒充 install/update time；
- index 可由 ledger + direct observation 重建；手工编辑不能改变 desired state；
- index digest 被 generation/operation manifest 绑定。
- collection root 可忽略唯一的 macOS Finder metadata `.DS_Store`；任何其他未知直接条目仍是 drift。该例外不进入 member set、index 或 runtime surface。

## 6. Source selection and qualification

`latest/main` 只用于 candidate discovery。Plan 编译前必须固定：

```text
provider repository identity
approved owner/repo
resolved commit
source tree digest
registry/index digests
40 member IDs and per-member digests
gateway/rendering/locator digests
qualification policy/evidence digests
```

本次 reviewed candidate 是：

```text
yknothing/prodcraft@fd05978dbbbf5a064205a695af47c8a550f1b224
public surface: 40 pc-* packages
```

它仍需在 implementation-time preflight 重新确认 upstream latest。如果 upstream `main` 已移动，则产生新的 candidate，重新审核并固定；不得把旧 review pin 自动称为最新或 stable。

## 7. Legacy 46 → public 40 disposition

当前 46 个旧 receipt/entity 构成 unresolved-version legacy deployment，不构成一个已认证的 upstream release。

Evidence stage 只允许：

```text
lexical_candidate_pair
legacy_only
upstream_only
```

Apply plan 必须为每个旧实体给出 exactly one disposition：

```text
replaced
retired_by_owner
preserved_unrelated
conflict
```

39 个 basename pair 需要 source、current identity 和 successor evidence 才能 `replaced`。七个 legacy-only 名称按 Owner 的 breaking-upgrade 意图进入 proposed retirement，但仍需在 exact plan 中逐项显示。`pc-requirements-engineering` 是 upstream-only addition，不得覆盖或删除第三方 `bs-requirements-engineering`。

## 8. Transaction and path transition

旧 `~/.agents/skills/prodcraft/` 当前是 legacy gateway Skill，和目标 collection container 占用同一路径。它必须像其他 45 个旧实体一样先进入 recovery/quarantine，之后才能发布新容器。

Live operation 顺序：

1. acquire global mutation lock；
2. fresh-observe receipt、46 legacy entities、known Agent projections and target paths；
3. materialize exact artifact and target `prodcraft/` tree outside discovery roots；
4. run source/package/Markdown-link-reference/index/locator gates and separately record upstream repository validators；
5. durable-publish independent pre-state recovery bytes and re-read them；
6. compile and approve immutable plan hash；
7. record that already-running Agent sessions may retain stale catalog/context state and require a fresh session after cutover；
8. move identity-approved legacy entities and projections into operation quarantine；
9. rename the verified same-filesystem staged collection into `~/.agents/skills/prodcraft/`；
10. create top-level and Agent-root projections from the approved profile matrix；
11. verify exact 40-member tree, index, locator, raw symlink targets and absence of old scoped names；
12. seal filesystem operation/ledger only after all scoped filesystem postconditions pass；
13. run fresh-session discovery/runtime probes as a separate qualification stage；
14. on failure, restore the old 46 entities and exact raw projection links；otherwise return `RECOVERY_REQUIRED`。

“transactional” continues to mean managed-writer serialization and crash-consistent recovery, not multi-root atomic visibility.

所有 active/quarantine/publish rename 和 gateway symlink mutation 通过 macOS no-follow native helper 执行；helper 使用已打开 parent directory identity、`openat`、`renameatx_np(RENAME_EXCL)`/`symlinkat` 和 parent `fsync`。五个 durable apply phase 必须各自通过真实 `SIGKILL → RECOVERY_REQUIRED → recover → exact pre-state` 验收。

## 9. Receipt and provenance handling

`.skill-lock.json` 仍由其 upstream CLI 管理，不注入 skills-refiner 私有字段。V1 将其完整 digest 和 46 条 old-source evidence 写入 operation manifest，并在 status 中显示：

```text
external_receipt_state: superseded | drifted | aligned | unknown
```

首版 live migration 不直接伪造 native receipt updates。新的 control-plane ledger/index 是 managed desired-state authority；receipt 是 installer history。后续只有通过 pinned native-writer adapter 测试后，才能同步或清理 receipt。

Raw `npx/npm` 对 managed names 仍是 competing writer；status/apply 前必须 reconcile，且不得静默 adoption。

## 10. Reconcile, repair and manual deletion

`collection status prodcraft --fresh` 必须直接检查：

- collection root 是 real directory 且根无 `SKILL.md`；
- exactly 40 direct `pc-*` member directories；
- names/digests match `INDEX.json` and active artifact；
- `pc-prodcraft` projection raw target 正确；
- per-Agent projection matrix matches desired generation；
- locator paths remain contained in the approved artifact/root；
- no scoped old unprefixed ProdCraft entity has reappeared；
- external receipt drift is explicit。

`FILESYSTEM_READY` 只表示上述直接物理检查通过；响应必须同时显示 `scope: filesystem` 和 `runtime_status: UNVERIFIED`，直到独立 Agent probe evidence 可用。不得以该状态替代 Agent loadability/context 结论。

手工删除一个 member、index、locator 或 projection 会产生 `MISSING`/`DRIFTED`，不会成为 formal uninstall。`repair` 只从 exact active artifact/recovery bytes 恢复；`accept-removal` 是独立 approved transaction。

## 11. CLI implementation surface

V1 adds to the existing launcher:

```text
skills-refiner collection check prodcraft --track main --json
skills-refiner collection plan prodcraft --candidate <commit> --profile-matrix <file> --json
skills-refiner collection apply --plan <file> --confirm <plan-hash> --json
skills-refiner collection status prodcraft --fresh --json
skills-refiner collection repair prodcraft --confirm <operation-id> --json
skills-refiner collection recover <operation-id> --confirm <operation-id> --json
skills-refiner collection undo <operation-id> --confirm <operation-id> --json
```

实现必须复用现有 cleanup transaction 的 identity、quarantine、confirmation 和 fail-closed concepts，但不能把 sequential cleanup batch 冒充 collection transaction。Collection schemas/modules/tests 独立于 cleanup，避免扩大既有稳定 surface。

## 12. Required implementation stages

| Stage | Required evidence | Global mutation |
|---|---|---|
| 1. Read-only | check/status/plan schemas, source pin, 46→40 disposition, target tree simulation | forbidden |
| 2. Isolated transaction | apply/status/repair/undo against synthetic HOME and copied upstream fixture | forbidden |
| 3. Live filesystem cutover | exact approved plan, recovery proof, isolated transaction gates green, explicit `runtime_status: UNVERIFIED` | separately authorized by Owner's implementation command |
| 4. Agent qualification | fresh-session nesting, recursion, symlink and gateway routing evidence per target | only bounded repair/rollback if a qualification result requires it |

The Owner's `实施` command authorizes progressing through these stages and, after the specified filesystem gates pass, performing Stage 3 without a second design discussion. Exact plan-hash confirmation remains a machine safety precondition, not a new product decision. Stage 4 controls runtime/context claims; it is not allowed to retroactively make the physical filesystem result untrue, and its absence is always surfaced as `UNVERIFIED`.

## 13. Acceptance criteria

Physical migration is complete only when fresh evidence proves：

```text
physical_collection_root == ~/.agents/skills/prodcraft
collection_root/SKILL.md does_not_exist
direct_member_count == 40
all_direct_member_names match ^pc-
member_set == pinned_public_registry
top_level_scoped_legacy_prodcraft_count == 0
default_top_level_projection_set == {pc-prodcraft}
INDEX/artifact/member/locator digests match
known unrelated Skills unchanged
manual_member_delete -> non-FILESYSTEM_READY
raw_installer_rewrite -> DRIFTED or CONFLICT
undo -> old 46 entities and known raw links restored under rollback identity schema
runtime_status == UNVERIFIED until fresh-session evidence is recorded per participating Agent
```

Context reduction may be claimed only for Agent/profile pairs whose discovery evidence proves it.

## 14. Rollback and recovery scope

No old entity is permanently deleted during apply. Pre-state bytes, modes, xattrs/ACLs where required, raw link targets, receipt digest and topology manifest must be preserved under the independently addressed recovery root before mutation.

macOS may rewrite `com.apple.provenance` when copying an entry. The recovery identity therefore binds content plus stable mode/owner/flags/ACL/xattrs and explicitly excludes only this OS-generated telemetry xattr; the active pre-state native manifest is still bound until quarantine. This exclusion must be regression-tested with a real provenanced file and must not generalize to other xattrs.

Undo removes only objects whose post-state identity matches the committed operation, then restores the exact approved pre-state. A user-created or externally replaced conflicting path blocks undo instead of being overwritten.

Whole-home/device loss remains outside V1; loss of both operational and recovery roots is `RECOVERY_REQUIRED` and not an exact-undo claim.

## 15. Non-goals

- generic multi-collection support；
- automatic unattended upstream promotion；
- transparent interception of arbitrary shell commands；
- rewriting upstream Skill content；
- claiming every Agent ignores nested collection members；
- claiming runtime/context success from filesystem counts alone；
- purging quarantine in the migration transaction。

## 16. Reconsideration triggers

Reopen when：

- participating Agents recursively discover nested members and context containment is mandatory；
- upstream changes the public registry, gateway, locator or breaking-migration contract；
- an official Agent load/catalog API removes filesystem projections；
- exact collection publish/undo cannot pass crash, collision or metadata tests；
- Owner changes the literal physical-root requirement。

## References

- [ADR-0004: Managed collection store and recoverable artifact-set upgrade](0004-managed-collection-store-and-transactional-artifact-set-upgrades.md)
- [ADR-0004 acceptance](../verification/2026-07-20-prodcraft-artifact-set-upgrade-acceptance.md)
- [ADR-0005 live migration acceptance](../verification/2026-07-20-prodcraft-physical-collection-migration.md)
- [ProdCraft pinned upstream snapshot](https://github.com/yknothing/prodcraft/commit/fd05978dbbbf5a064205a695af47c8a550f1b224)
- [ProdCraft global/npx compatibility contract](https://github.com/yknothing/prodcraft/blob/fd05978dbbbf5a064205a695af47c8a550f1b224/docs/distribution/npx-skills-compat.md)
