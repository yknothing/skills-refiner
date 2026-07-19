# ADR-0004: 受管 Collection Store 与可恢复 Artifact-Set 升级

- **Status:** Proposed — adversarially revised; Owner review required
- **Date:** 2026-07-20
- **Deciders:** Product owner (host machine) + skills-refiner maintainers
- **Amends:** ADR-0003 §§1, 8, 9, 11（ProdCraft 目标拓扑、gateway/profile、集合升级协议）
- **Related:** ADR-0002（On-demand Pack Catalog）；ADR-0003（版本资格化控制面）
- **Adversarial review:** `docs/adversarial-product-pk/2026-07-20-prodcraft-artifact-set-upgrade/`

## 1. Proposed decision

skills-refiner 的 V1 将安装、升级和迁移统一建模为 **version-qualified artifact-set replacement**，而不是逐目录覆盖。ProdCraft 是唯一 V1 collection；目标是用 Owner 批准的上游 `pc-*` public surface，物理替换本机来源与身份均可证明的旧无前缀 ProdCraft Skills。

最短操作解释如下：

1. `latest/main` 只发现候选，立即解析为 immutable commit；
2. 在所有 Agent discovery root 之外保存并验证完整上游 artifact；
3. 生成 46→40 的逐项 disposition plan、目标 Agent/profile matrix 和独立 recovery copy；
4. 未通过真实 Agent、引用、碰撞、durability 和 undo gate 时只能 dry-run；
5. 维护窗口内将旧实体移入 quarantine，并按每个 Agent/root 的已批准 profile 建立新投影；
6. 任一步失败时恢复 exact pre-state，无法证明时进入 `RECOVERY_REQUIRED`；
7. 手工删除或 raw installer 改写只会改变 observed state，不会被静默吸收为 desired state。

这不是 multi-root 的瞬时原子切换。本文的“事务化”严格指：**single-writer、precondition-bound、journaled、crash-consistent、可确定恢复分类**。外部 reader 可能在维护窗口内看到中间态，所以 participating Agent 必须停止，新 session 必须在 commit 后启动。

## 2. Owner intent and reviewed fixture

Owner 已明确：旧无前缀 ProdCraft 集合不是目标版本，应升级为审核后批准的上游最新 `pc-*` 集合；“最新”不等于“稳定”，也不自动获得 activation authority。

本次评审固定的 upstream candidate 为：

```text
yknothing/prodcraft@fd05978dbbbf5a064205a695af47c8a550f1b224
reviewed public surface: 40 pc-* Skills
```

这只是 review-pinned candidate，不是 qualified、stable 或 active 版本。评审时没有观察到 publisher release/tag signal；该时间性观察既不证明 candidate 不稳定，也不是永久事实。

本机 46 个旧目录是 `legacy machine deployment snapshot, source revision unresolved`：receipt 声称它们来自 `yknothing/prodcraft`，但 46 条记录均无 `resolvedRevision`。对旧 receipt 名称与 pinned upstream public ID 去除 `pc-` 后做集合运算得到：

```text
legacy receipt names:                 46
upstream public pc-* names:           40
lexical basename candidate pairs:     39
legacy-only basenames:                 7
new-only upstream basenames:           1
net public-name change:               -6
```

39 只是 lexical candidate pairs，不是 semantic rename/replacement 证据。七个 legacy-only 名称是 Owner 预期退役项，但 apply 前仍需逐项身份门禁与明确 disposition；`pc-requirements-engineering` 是新增 public ID，不得推断它与任何旧项或第三方 `bs-requirements-engineering` 等价。

## 3. Fact-domain authorities: no false universal source of truth

“唯一事实源”按事实域划分，而不是让一个文件冒充所有真相：

| Fact domain | Authority | Does not prove |
|---|---|---|
| Authoring/content | Owner-approved forge repository identity + immutable revision | publisher cryptographic identity, stability, local installation |
| Artifact identity | source tree/package/profile digests | environment suitability |
| Environment qualification | target Agent/version + OS/runtime + policy + evidence record | desired activation |
| Desired deployment | external skills-refiner ledger and approved plan | current disk/runtime reality |
| Observed deployment | fresh direct filesystem and loader observation | user intent |
| External installer history | `.skill-lock.json` and its upstream writer | desired/active generation |
| Recovery availability | independently retained, digest-verified recovery bytes | authoring authority |

Git URL 是 locator，不是 durable publisher identity。V1 必须记录 provider repository ID（forge 提供时）、approved owner/repo、exact commit、manifest/artifact digest 和 Owner approval。无签名或 attestation 时只能声明 `Owner-approved observed origin`，不能声称 cryptographically authenticated publisher。

状态维度保持正交：

```text
selection:       tracked | pinned
artifact:        absent | stored | corrupt
qualification:   unverified | candidate | approved | blocked | revoked
activation:      inactive | active
deployment:      unprojected | projected | drifted | missing | conflict
runtime:         unknown | discoverable | routable | loaded | unavailable
```

`approved` 只对记录的 Agent/profile、Agent version、OS/runtime、policy digest 和 evidence digest 有效。任一绑定改变都使旧 qualification 失效或需要显式再认证。

## 4. Physical topology and failure domains

目标拓扑将 portable source、host generation、Agent projection 和 recovery 分开：

```text
~/.agents/skill-control/collections/prodcraft/
├── artifacts/<artifact-digest>/repo/       # immutable reviewed upstream source
├── generations/<generation-id>/
│   ├── generation.json                     # artifact + target/profile matrix
│   └── views/<target-id>/                   # generated per-root view
├── operations/<operation-id>/              # write-ahead journal/quarantine manifest
└── active -> generations/<generation-id>   # desired deployment generation

~/Library/Application Support/skills-refiner/recovery/
├── artifacts/<artifact-digest>/            # independently addressed recovery copy
└── operations/<operation-id>/pre-state/    # adopted legacy bytes + fs identity

~/Library/Application Support/skills-refiner/anchor/
└── ledger-head.json                         # accidental-tail-loss detection anchor

~/.agents/skills/                            # shared Agent-facing projection surface
~/<agent-specific-root>/skills/              # adapter-scoped projection surfaces
```

`artifacts/` 是 stored source/cache，不等于 Agent-installed 或 available。只有 target-qualified projection 加上 loader evidence 才能分别声明 `projected`、`discoverable`、`routable` 或 `loaded`。

Recovery root 与 collection subtree 分址，防止一次误删 collection subtree 同时摧毁唯一恢复材料；它不是异机 disaster backup，也不抵抗同一用户同时删除两个根。若 recovery bytes 不可用，系统必须诚实返回 `RECOVERY_REQUIRED`，不得承诺 exact undo。

Artifact publish 必须采用 write-once 目录、digest verification、只读权限策略与引用可达性 GC。active、previous、pending operation 和 rollback-retained artifact 均为 GC roots；未知引用或 corrupt artifact 阻断 GC/activation。

## 5. Directory index and target/profile model

### 5.1 Index role

目录索引属于控制面，而不是 Agent Skill：

```text
collection catalog
  collection id
  approved origin/repository identity
  candidate/active artifact identities
  upstream public member IDs and source paths
  qualification records
  target Agent/root/profile matrix
  desired/observed/effective state
  provenance and operation history
  first_observed_at / fetched_at / qualified_at
  planned_at / activated_at / updated_at / last_observed_at
```

它不复制全量 Skill descriptions，不放入 discovery roots，也不会自动进入 context window。Agent 只看到所选 projection；索引本身的存在不构成 context-saving 证据。

这些时间字段是不同事件的审计时间，不能互相覆盖或把 filesystem mtime 冒充 install time。版本显示优先使用 exact resolved revision + artifact digest；tag/branch 仅作为 candidate discovery metadata。

### 5.2 Per-target profiles

Profile 不是 collection-wide 单值。一个 deployment generation 必须绑定 `target-id → profile` matrix；`target-id` 至少包含 Agent adapter/version、discovery root 和 consumer scope。

| Profile | Projection | Semantics |
|---|---|---|
| `gateway-routed` | only `pc-prodcraft` | entry point only until real Agent proves downstream routing; does not imply all 40 are discoverable |
| `full-compatibility` | all 40 `pc-*` | metadata-first sibling surface; no context-reduction claim |
| `excluded` | unchanged by operation | unverified/unsupported target; outside success claim |

`gateway-routed` 是期望的低暴露 profile，但不是未经验证的默认值。每个 Agent adapter 必须先完成 fresh-session discovery、locator traversal、routed handoff 和 negative-case qualification；失败时使用 `full-compatibility` 或 `excluded`。

共享 root（如 `~/.agents/skills`）只能有一个明确 profile，但它可能有多个未知消费者。计划必须分别声明：

- mutation-root inventory 是否完整；
- known consumer inventory 是否完整；
- 对残余 unknown consumers 的 Owner 风险决定。

未知 consumer 不能被包装成“全机已迁移”或“所有 Agent context 已减少”。

## 6. Artifact, packaging and locator contracts

### 6.1 Artifact identity

Eligible artifact contract 必须绑定：

```text
provider_repository_id
approved_owner_repo
requested_ref
resolved_revision
source_tree_digest
public_registry_digest
public_member_ids + source paths
per-member tree digests
curated_index_digest
upstream_gateway_source_digest
packaging_profile_id + digest
artifact_digest
```

完整 pinned repository 是 source artifact，因为 gateway 可能需要 repository-owned contracts、validators、workflows 和 evidence paths。它保持 upstream bytes 不变。

### 6.2 Generated composition

Generation 保存 host-specific bytes，并分别记录：

```text
artifact_digest
qualification_record_digest
target/profile matrix digest
upstream_gateway_source_digest
rendered_gateway_digest
generated_locator_digest
projection_manifest digest
adapter digests
generation_id
```

V1 不把“curated gateway bytes + local locator”假设成已获 upstream qualification。Packaging profile 必须选择 upstream 已定义的 global rendering，或提供 pinned composition fixture；两者都需要真实 Agent replay。

### 6.3 Verifier ownership

Pinned `prodcraft-runtime-locator.v1` 只提供现有 path/repository ownership fields；它没有 artifact/generation digest 字段，也不是 load-time cryptographic verifier。

因此责任明确分开：

- control-plane validator 在 materialize、pre-apply、post-apply 和 status 时检查 path containment、repository identity、artifact/generation digest；
- unmodified gateway 仅按其 upstream contract 使用 locator/repository/siblings；
- 没有 host load-time hook 时，controller 无法保证外部改写后、下一次 reconcile 前的连续 fail-closed。

`gateway-routed` activation 只有在真实 Agent 证明错误 locator、path escape、missing identity、missing member 与 post-activation drift 的可接受行为后才合格。若 Agent 仍可能读取错误内容，该 target 不得使用此 profile。

### 6.4 Reference closure

控制面必须生成完整 reference graph，并至少分类：

```text
member-local
collection-internal
repository-context
external-canonical
unresolved
```

V1 选择 **upstream portable/repository-context reference**，不创建 ad-hoc compatibility alias、不扩大隐藏 closure、不 patch 第三方 Skill。每个 target profile 必须满足 `newly_broken_references == 0`；已有旧 broken reference 与迁移新增 regression 必须分开报告。

## 7. Breaking-set plan and deletion authority

### 7.1 Two-stage classification

Evidence collection 可产生无 mutation authority 的：

```text
lexical_candidate_pair
legacy_only
upstream_only
```

Immutable apply plan 必须把 46 个 legacy item 和 40 个 upstream item 归入明确 disposition：

```text
retained
replaced
added
retired_by_owner
split
merged
unmapped
conflict
```

一个实体只能有一个最终 disposition。`unmapped` 或 `conflict` 必须阻断 apply。39 个 lexical pairs 需要 content/compatibility evidence 后才能标为 `replaced`；七个 legacy-only 项需要 Owner 明确接受 capability retirement；新增项不得与近似名第三方 Skill 合并。

### 7.2 Legacy adoption and rollback identity

旧 46 项尚未被 adopted。单独批准的 preflight 必须为每个路径记录并验证：

```text
receipt entry + full receipt digest
source-binding verdict
lstat type + raw symlink target
tree/file byte digests using a versioned algorithm
POSIX mode and required xattrs/ACLs
frontmatter identity
known projections and raw targets
case-normalized collision result
```

Hardlinks、special files、unsupported metadata 或 identity mismatch 必须成为 `conflict`。在任何 quarantine 前，完整 pre-state bytes 和 manifest 必须 durable-publish 到独立 recovery root，并重新读取验证。

旧路径只可在以下条件同时成立时移入 quarantine：receipt source 正确、当前实体身份匹配 approved snapshot、目标 collision 为零、逐项 disposition 已批准、participating root inventory 完整。basename similarity 从不构成删除权限。

## 8. Crash-consistent operation protocol

### 8.1 Phase protocol

1. 同步 observe scoped roots，获得 single-writer mutation lock；
2. resolve moving ref once，绑定 immutable commit 和 repository identity；
3. fetch/qualify outside all discovery roots；
4. compile 46-row disposition、40-row target set、reference graph、target/profile matrix 与 collision report；
5. durable-publish artifact、generation candidate、pre-state recovery copy 和 immutable plan；
6. Owner 批准 exact plan hash；
7. 进入 maintenance window，停止 participating Agent sessions，并重验全部 preconditions；
8. write-ahead operation phase，逐项把 approved legacy entities/projections移入 quarantine；
9. 逐 target materialize 新 projections；每一步均记录并 durability-sync；
10. 更新 collection active generation，验证所有 participating targets；
11. 新 session replay 和 synchronous reconcile 通过后 seal ledger/head；
12. 失败时根据 durable phase table 恢复 pre-state，无法证明则停止在 `RECOVERY_REQUIRED`。

### 8.2 Durability contract

同 filesystem publish 使用 temp path、file fsync、atomic rename 和 parent-directory fsync。若目标跨 filesystem（`EXDEV`），不得把 rename 当作原子操作；必须先 copy 到目标 filesystem 的 temp path、逐文件验证并 sync，再 rename publish。任一 durability primitive 在目标平台不可证明时，live mutation 保持 veto。

Ledger event 使用 schema major/minor；unsupported major fail closed。Hash chain + separately addressed sealed head 只用于检测 accidental truncation/reorder/internal break，不宣称 tamper-proof，也不抵抗同一用户同时改写 ledger 与 anchor。Recovery copy 是恢复来源，不是第二 desired-state writer。

### 8.3 Recovery states

| Last durable phase | Allowed recovery result |
|---|---|
| before quarantine | exact pre-state |
| quarantine in progress | resume rollback to exact pre-state |
| projection publication in progress | rollback to exact pre-state or `RECOVERY_REQUIRED` |
| active switched, targets not verified | rollback to exact pre-state or `RECOVERY_REQUIRED` |
| targets verified, ledger unsealed | resume exact post-state verification then seal, otherwise rollback/`RECOVERY_REQUIRED` |
| ledger/head sealed | exact post-state; undo is a new approved transaction |

任何阶段都不得把 mixed state 报告为 success。该协议承诺 crash consistency 和恢复分类，不承诺维护窗口中的外部 reader 原子可见性。

## 9. Reconciliation, manual deletion and external installers

Observation record 必须包含：

```text
target/root scope
observed_at
valid_until
observed digests/topology
observer/adapter version
```

Effective state 在读取时计算；过期 observation 只能是 `STALE`。每次 mutation 前必须同步 reconcile。没有 watcher 时，controller 不宣称 continuous runtime health；Agent 仍可能在两次 observation 之间读取被手工或外部命令改写的内容。

手工删除 projection、generation 或 artifact 不会变成 formal uninstall：desired ledger 不变，下一次 observation 产生 `MISSING`、`DRIFTED`、`CONFLICT` 或 `RECOVERY_REQUIRED`。`repair` 只能使用 exact active artifact/recovery copy；`accept-removal` 是另一个需要批准的 desired-state transaction。

`.skill-lock.json` 由 Vercel Labs `skills` CLI 的版本化 writer 维护。V1 必须复用它的 receipt evidence，但不写私有字段、不把它作为 desired/active authority。原因不是假设上游 CLI 永远缺少 restore，而是其 authority ownership 与 schema 不表达本控制面的 qualification、profile、generation、target matrix、recovery 和 fresh observation。

Raw global `npx/npm` 对 managed names 是 unsupported competing writer。它可以立即把 projection symlink 替换为 unmanaged directory，所以本文只保证：

- 它不能修改 skills-refiner ledger 中的 approved intent；
- 下一次 managed status/mutation 必须检测完整 artifact-set drift；
- drift 不得被静默 adoption 或 promotion；
- 暴露窗口必须在 CLI/runbook 中明确，managed collection 活跃时禁止裸全局 update/remove；
- exact repair 不重新解析 `latest`。

V1 不承诺透明 shell interception；受管 wrapper 是推荐操作入口。Receipt native-writer 同步是独立 adapter capability，未证明前明确显示 receipt drift。

## 10. Proposed V1 delivery stages

V1 是 ProdCraft vertical slice，但必须分阶段晋级，不能第一次运行就触碰 live 46→40：

| Stage | Output | Live global mutation |
|---|---|---|
| 1. Read-only control plane | resolver, provenance, catalog, qualification, 46/40 disposition plan, status | forbidden |
| 2. Sandbox transaction | artifact/generation/projection/recovery/kill fixtures on isolated roots | forbidden |
| 3. Agent qualification | one target at a time; fresh-session profile and drift replay | forbidden |
| 4. Quiescent migration | only fully qualified participating roots and exact approved plan | separately authorized |

Proposed V1 scope includes only pinned Git/GitHub ProdCraft source、read-only receipt import、command-time reconcile、two explicit profiles、durable journal/recovery、plan/apply/undo for qualified targets。

V1 excludes generic multi-collection framework、generic npm/local source adapters、background watcher as correctness dependency、automatic prompt/session mounting、unattended promotion、Windows/Linux mutation、zero downtime、transparent interception of arbitrary shell commands and context-saving claims without evidence。

## 11. Operator contract

Proposed command surface：

```text
skills-refiner collection check prodcraft --track main
skills-refiner collection plan prodcraft --candidate <commit> --targets <matrix>
skills-refiner collection apply <plan-id> --confirm <plan-hash>
skills-refiner collection status prodcraft --fresh
skills-refiner collection repair prodcraft
skills-refiner collection undo <operation-id>
```

每个 command 必须同时返回 human summary、machine-readable record 和 deterministic exit code。Command names 是设计接口，不是当前实现事实。

## 12. Required fitness gates — specified, unimplemented

| Gate | Required pass rule | Blocks |
|---|---|---|
| Candidate identity | repository ID/approved owner/commit/tree/registry/artifact digest all bound; apply never re-resolves ref | qualification/apply |
| Artifact set | pinned registry/index/package set and per-member digests match | qualification |
| 46-row disposition | every legacy item has identity, semantic disposition and Owner-approved retirement where needed | apply |
| Collision inventory | all participating roots, case-folded paths, aliases and unrelated same-name Skills preserved | apply |
| Reference closure | complete graph; `newly_broken_references == 0` per profile | qualification/apply |
| Packaging composition | upstream global rendering or pinned composition fixture matches recorded digests | qualification |
| Gateway route | per target, route at least intake/planning/quality member; negative locator/member/drift cases behave safely | `gateway-routed` profile |
| Target/profile matrix | heterogeneous roots receive their approved profile; excluded roots unchanged | apply |
| Discovery/context | fresh-session roots, precedence, cache, recursion and discovered names captured per Agent/version | any discovery/context claim |
| Pre-state recovery | independent recovery copy verifies complete v1 identity schema before quarantine | apply |
| Durability | disk-full, permission, `EXDEV`, tail/middle deletion and kill-after-every-phase matrix passes | live mutation |
| Concurrent reader | observed intermediate states match declared maintenance-window boundary; no success from mixed state | live mutation |
| Reconcile freshness | expiry, manual deletion and raw installer replays never emit unqualified fresh `READY` | status/live mutation |
| Undo | restores legacy bytes, raw links and required metadata; mismatch is `RECOVERY_REQUIRED` | live migration |
| External writer | sandboxed add/update/remove cannot alter desired state or be silently adopted; repair bounded | live migration |
| Skill surface | used/changed Skills pass frontmatter, description, references and static loader smoke | document/implementation acceptance |

No gate is claimed runnable or passing in this ADR. A named gate is not evidence.

## 13. Alternatives

### A. Raw install all 40 at top level

Availability and sibling semantics最直接，但不解决 set-level recovery、qualification、drift authority 或 context pressure。保留为 per-target `full-compatibility` profile，不作为管理机制本身。

### B. `pc-prodcraft/.members/*`

目录紧凑，但 pinned upstream 明确禁止 gateway 在自身目录搜索 downstream，且 recursive discovery 未知。拒绝；不 patch upstream content，也不发明私有 member index runtime。

### C. Complete immutable source + per-target projections + independent recovery — selected

它把 source fidelity、host adaptation、Agent discovery 和 recovery 分离，并能表达异构 Agent。成本是 projection/controller complexity、额外磁盘、维护窗口和严格 qualification。

### D. 直接复用 `.skill-lock.json` 作为唯一控制文件

拒绝。它仍作为 upstream CLI receipt 被完整复用，但它的 writer authority、schema 和 lifecycle 不足以表达本决策的 desired state、environment qualification、artifact-set disposition、per-target profile、operation phase、recovery availability 与 observation freshness。向其注入私有字段会制造双 writer 和兼容性风险。

## 14. Consequences and limitations

如果实现并通过 gates，本决策将使 breaking namespace/membership change 成为一项可审核、可恢复的 set migration，并使完整物理存储不再必然等于全量默认 metadata exposure。它还会让 source、qualification、desired intent、observed reality 和 receipt history 可分别查询。

代价和已接受限制：

- V1 引入关键 projection/journal/recovery layer；其错误可能影响多个 Agent root；
- 完整 repository 与独立 recovery copy 消耗更多磁盘；
- `gateway-routed` 可能对部分 Agent 永远不合格；
- 维护窗口内不承诺外部 reader 的原子可见性；
- command-time reconcile 有 detection window，不是 runtime enforcement；
- bare raw installer 仍可暂时破坏 observed surface；
- L2 文档评审不是实现、迁移、稳定性、真实 Agent 或 context 验收。

## 15. Decision and promotion boundary

本稿经 L2 adversarial review 修订，但保持 `Proposed`，等待 Owner 对以下边界进行审阅：

1. `gateway-routed` 只在逐 Agent 资格化后使用，未通过时必须 full compatibility/excluded；
2. 七个 legacy-only capability 的退役必须在 immutable plan 中逐项批准；
3. live migration 是维护窗口内的 crash-consistent transaction，不是 multi-root atomic visibility；
4. command-time reconcile 接受 raw/manual drift 的检测窗口；
5. independent recovery root 防误删但不是异机 disaster backup。

即使 ADR 后续成为 `Accepted with limitations`，仍不授权实现、全局文件系统 mutation、ProdCraft migration、stable-version claim 或 context-saving claim。它只允许另行编写并评审 implementation plan。

## 16. Reconsideration triggers

Reopen when：

- ProdCraft 发布更强的 signed release、collection manifest、locator verifier 或 compatibility contract；
- Agent runtimes 提供 official catalog/load API 或 load-time integrity hook；
- Vercel Labs `skills` 提供足够的 transactional custom target、qualification 和 recovery authority；
- recovery/durability/reference/Agent gates 无法通过；
- `gateway-routed` 对目标 Agents 不能可靠工作；
- Owner 要求 zero-downtime、continuous enforcement、automatic session mounting 或异机 disaster recovery；
- scope 扩到多个 collection 或其他 OS。

## References

- [ADR-0002: On-demand Pack Catalog](0002-on-demand-pack-catalog.md)
- [ADR-0003: Version-qualified Skill control plane](0003-versioned-skill-control-plane-and-physical-collections.md)
- [ProdCraft pinned upstream snapshot](https://github.com/yknothing/prodcraft/commit/fd05978dbbbf5a064205a695af47c8a550f1b224)
- [ProdCraft breaking-upgrade contract](https://github.com/yknothing/prodcraft/blob/fd05978dbbbf5a064205a695af47c8a550f1b224/docs/distribution/npx-skills-compat.md)
- [ProdCraft public registry](https://github.com/yknothing/prodcraft/blob/fd05978dbbbf5a064205a695af47c8a550f1b224/schemas/distribution/public-skill-registry.json)
- [ProdCraft gateway](https://github.com/yknothing/prodcraft/blob/fd05978dbbbf5a064205a695af47c8a550f1b224/skills/.curated/pc-prodcraft/SKILL.md)
- [Vercel Labs `skills` reviewed snapshot](https://github.com/vercel-labs/skills/commit/777599e1159e401b11ce4c8a57c20f09a8f1596e)
