# ADR-0006: 声明式 Managed Collections 与可调和管理目录

- **Status:** Accepted with limitations
- **Date:** 2026-07-20
- **Deciders:** Product owner (host machine) + skills-refiner maintainers
- **Amends:** ADR-0003 §§5–9；ADR-0004 §§4–12
- **Preserves:** ADR-0005 / ProdCraft V1 live generation and undo identity
- **Related:** `skills/skill-hygiene/lib/collection-specs.mjs`；`managed-collection-contract.mjs`；`managed-collection.mjs`
- **Review level:** L2 Agent-separated architecture, implementation and verification review

## 1. Decision

skills-refiner 采用 **schema-versioned transaction engine + declarative `CollectionSpec` + source/profile adapters** 管理多组物理 Skills collection。ProdCraft V1 保持原 schema、operation identity、quarantine 与 recovery，不通过重写历史 plan 来伪装升级；LoopOS、LangCraft、Better Skills 使用 managed engine。初始 generation 的 plan.v2 继续可验证/恢复，新计划使用 plan.v3，把 preserved collision snapshot 纳入批准身份。

四类事实严格分域：

| 问题 | 权威 | 说明 |
|---|---|---|
| 上游版本包含什么 | 经 Owner 审核的 repository identity + immutable commit + packaging profile | branch/latest 仅发现候选 |
| 本机批准激活什么 | deploy root 外的 reconciliation catalog 中的 exact plan/operation identity | catalog 不拥有第三方内容 |
| 当前磁盘有什么 | fresh filesystem observation | index、receipt、catalog 都不能替代直接观察 |
| installer 曾声称做过什么 | `.skill-lock.json` source-scoped receipt history | receipt 不是 desired state 或 actual state |

因此“GitHub 是天然唯一事实源”在这里被精确定义为：GitHub immutable revision 是 **content authority**；本机 catalog 只记录哪个已审核 artifact 被批准激活；filesystem observation 决定它现在是否真的存在且 exact。

上游 release version 也必须属于 content authority，而不是 controller 的本地命名。每个 collection profile 只能选择一个明确、严格的上游字段提取规则；status 同时返回字段值、字段所在文件、该文件 digest 与 extraction rule。上游没有声明版本时返回 `not_declared`，不得从日期、commit message、controller schema、operation id 或本地迁移次数合成版本。`schema_version` 只描述 skills-refiner 自己的数据协议，绝不是第三方 Skill 版本。

## 2. Why V1 was not copied

ProdCraft controller 是一次成功但高度专用的 vertical slice：source registry、40 个 `pc-*`、46→40 disposition、gateway、operation ID 与路径均写死。复制 1,286 行再替换字符串会制造四套恢复协议和四种漂移语义。

V2 改用声明式边界：

```text
CollectionSpec
├── repositoryId + approved origin
├── exact member names + source paths
├── manifest path
├── shared packaging resources
├── preserved historical names
├── compatible member/resource profiles
├── explicit reference-example exclusions
└── exposure profile: gateway | collection
```

V1/V2 plan 与 index 使用不同 schema。CLI 根据 plan schema 分派，避免新版 validator 对已提交 V1 plan 重新解释。

## 3. Four sets must remain distinct

每次计划必须显式区分：

1. `receipt_history_set`：installer 历史声称；允许包含已不存在的旧名称。
2. `observed_active_set`：fresh filesystem 中真实存在、且能绑定可信 receipt 的当前实体。
3. `candidate_member_set`：approved immutable upstream revision 的 packaging profile。
4. `approved_disposition`：本次迁移实际移动、替换、保留或新增的对象。

Better Skills 证明了不能合并这些集合：本机 receipt 同时保留旧无前缀与新 `bs-*` 两代，旧目录已经消失但仍有 broken projections。更重要的是，Better Skills 历史 `prose-craft` 与 LangCraft 当前 `prose-craft` 同名但不是同一实体。V2 因此只迁移能由当前 repository receipt、source path 和 fresh filesystem identity 共同证明拥有的对象；无前缀历史名称和跨仓库同名路径进入 `preservedNames` / `name_collisions` 观察面，默认 `preserve`，不得按名称自动清退。

`preserve` 不是永久豁免。Fresh observation 若证明一个 broken projection 指向同一 repository 已退役的历史名称，status 将其分类为 `STALE_SAME_REPOSITORY_PROJECTION`；这仍然只是 disposition candidate，必须经过独立 cleanup review、exact path selector、plan hash 和 recoverable quarantine 才能退役。跨仓库同名实体继续是 `BROKEN_PRESERVED_SYMLINK` 或 collision evidence，绝不能被前述规则连带清退。

Skill 的 qualified identity 至少是 `(repository_id, resolved_revision, source_path, declared_name)`。平面部署名称只是 locator，不是实体主键。两个仓库的同名 Skill 可以分别存在于各自 collection 物理目录；若某个 Agent 只支持平面 locator，管理中心报告冲突并要求用户明确选择投影策略，不能替用户推导 replacement。

Receipt folder hash 被视为 opaque installer evidence，接受已观测到的 40/64 hex 形态；它不是 commit identity。Receipt keyed by basename 只形成 `receipt_claim`，不能单独证明路径所有权。Plan.v3 对每个 preserved collision 绑定 path、kind、raw target、resolved target、target health/digest、receipt claim 与 preserve disposition；apply 在 mutation 前重新观察，集合变化会使批准失效。

## 4. Physical topology and exposure profiles

### 4.1 Gateway projection

LoopOS 和 LangCraft 的 collection id 与 gateway Skill 同名，不能让同一路径同时是无 `SKILL.md` 的 container 和 Skill。V2 使用：

```text
~/.agents/skills/loopos/          # container; no SKILL.md
└── loopos/SKILL.md               # upstream gateway

~/.<agent>/skills/loopos
  -> ../../.agents/skills/loopos/loopos
```

LangCraft 同理。其 upstream `langcraft-router` 被按 frontmatter identity `langcraft` 打包为 member `langcraft`；最新候选同时包含 `prose-craft`，使 router 的 sibling dependency 在 collection 内闭合。

### 4.2 Collection projection

Better Skills 没有已证上游总入口，禁止任取一个成员或生成 synthetic `SKILL.md` 冒充 gateway：

```text
~/.agents/skills/better-skills/   # container; no SKILL.md
├── INDEX.json
├── bs-*/SKILL.md                 # eight qualified source-owned members
├── docs/{patterns,research}/     # packaging-bound shared resources
├── tools/check-patterns.sh
└── skills.json

~/.<agent>/skills/better-skills
  -> ../../.agents/skills/better-skills
```

这是 filesystem exposure profile，不自动证明某个 Agent 会递归发现 members，也不证明 context 减少。没有 fresh-session loader evidence 时必须显示 `runtime_status: UNVERIFIED`。

## 5. Reconciliation catalog and orphan detection

V2 的 activation catalog 位于 deploy root 之外：

```text
~/Library/Application Support/skills-refiner/catalog.json
```

其 materialized view 位于：

```text
~/.agents/skill-control/catalog.json
```

每个 active entry 保存 collection id、operation/plan identity、repository/revision/artifact digest、collection root、recovery plan locator，以及 receipt entry count、首次安装时间、最近 receipt 更新时间、plan time、首次 activation 和 current-generation activation。完整 plan 还会 durable-copy 到独立 recovery root。`collection list --fresh` 把 ProdCraft V1 与全部 V2 collection 放进同一总览；V1 的生命周期由 plan、operation 与 receipts 派生，V2 由 catalog 与 fresh status 交叉给出。

`status` 同时读取 catalog、per-collection control record、recovery plan、physical collection/index、artifact、quarantine、recovery、Agent projections 与 source-scoped receipts：

- control root 丢失但 catalog/recovery 尚在：`ORPHANED_CONTROL`，不能降级为 `UNMANAGED`；
- catalog 丢失但 control 尚在：`ORPHANED_CATALOG`；
- member、root、index、locator、projection 丢失：`DRIFTED`；
- source-scoped receipt 改写：`SCOPED_RECEIPT_DRIFT`；
- unrelated receipt 改写只显示 `unrelated_history_changed`，不伪造 deployment drift。
- primary catalog、materialized view 或任一声明字段不一致：`CATALOG_*_DRIFT`；
- plan 后新增 collection exposure：`UNPLANNED_AGENT_EXPOSURE`；
- 其他仓库、历史 receipt 或无 receipt 的平面同名路径：`name_collisions[].disposition=preserve`，不作为本 collection 的 mutation target 或 deployment drift。
- preserved symlink target 缺失或 plan-time collision set 改变：collection readiness 与 `name_collision_status: ATTENTION_REQUIRED` 分层报告，不自动删除、重定向或接管。
- 同仓库历史名称的缺失投影：`STALE_SAME_REPOSITORY_PROJECTION`；只授权生成审核候选，不授权 collection apply 自动清理。

只有占用 collection required publication path 的外部实体才阻断计划；其他仓库或无资格证据的真实同名全局目录与平面 symlink 一样默认 preserve。这样允许 `better-skills/bs-prose-craft` 与 `langcraft/prose-craft` 物理共存，也不会把 Better 的历史 `prose-craft` locator 误归给 LangCraft。

Catalog 是本机 approved selection 的权威，不是 content authority；`INDEX.json` 是可重建部署投影，不是第二 writer。

## 6. Transaction and recovery contract

V2 继续使用 macOS native exclusive move/symlink primitives、Node 24、single global collection mutation lock、precondition-bound plan hash、independent recovery bytes 和 same-device quarantine。

Apply 顺序：

```text
verify source + installed facts + controller
→ publish plan/operation
→ publish artifact + independent recovery + staged collection
→ quarantine all observed legacy projections
→ quarantine all observed active members
→ publish collection
→ publish bounded exposure projections
→ publish active record + external catalog
→ fresh status
→ COMMITTED
```

每个 durable phase 均有 exception fault gate；进程被杀后不得猜测成功，必须由 exact operation id 驱动 recovery。Undo 只接受 active `FILESYSTEM_READY` post-state，防止覆盖第三方并发变化。

V2 同时支持 generation replacement。第二代 plan 必须绑定 exact predecessor active record、catalog entry、collection digest、exposure identities 和 independent recovery bytes。Apply 先隔离 predecessor exposure/collection，再发布新 generation；rollback/recover 恢复 predecessor selection，undo 将 catalog/active pointer 精确退回上一代。历史 generation 不通过重新解释旧 plan 伪造升级。

Managed plan.v3 还绑定 preserved collision snapshot。Plan.v2 作为 compatibility profile 保持 strict validation；controller 不在旧 JSON 上补字段或重算 hash。成员与共享资源 profile 也采用显式兼容集合，使不合格 candidate 的后续剔除不会破坏旧 generation 的 recovery/undo 解释。

全局 collection mutation lock 必须先于 `PLANNED` operation 落盘；锁竞争属于零 mutation 阻塞，不得制造 phantom `RECOVERY_REQUIRED`。Interrupted upgrade 即使 predecessor active pointer 尚未切换，也必须被 pending-operation scan 发现并返回新 operation id。

Cleanup batch 若遗留 lease，只能在可证明完全未启动时自动隔离 stale lock：batch 必须仍为 `READY/sequence=0`、每项 `NOT_STARTED`，所有 transaction 必须仍为 `PLANNED/sequence=0`、绑定同一 owner，且没有任何 mutation truth。任一 durable phase、outcome 或 mutation evidence 出现后都必须保持 `RECOVERY_REQUIRED`，禁止以“owner PID 已消失”为由释放锁。

Cleanup executable plan 固定最多 8 项，并在任何 durable write 前校验 native helper 的精确输入 bytes。更大的已审核集合必须确定性 partition 为 content-addressed child plans；manifest 固定执行顺序，首次失败停止，每项 transaction/undo identity 保持独立。Partition 只改变调度批次，不改变 review fingerprint、条目证据、授权路径或恢复语义。

`repair` 只处理明确的 missing-object drift：missing member、collection/index/locator 或 projection。Modified、unexpected、receipt/source conflict 必须先审查，不能自动覆盖。

## 7. Controller upgrade compatibility

历史 ProdCraft V1 plan 绑定 mutation controller bundle。Observer 升级不应把 unchanged deployment 误报成 member drift；因此 V1 status 不再把 current observer bundle 与 historical apply bundle 不同作为 filesystem issue。V1 apply 仍绑定 plan-time controller identity，历史 plan/schema 仍由 V1 validator 解释。

这不是声明任意新版 controller 都与旧 mutation protocol 兼容。Repair/undo/recover 仍必须通过对应 schema、operation identity、direct post/pre-state gates。需要破坏 schema 的未来版本必须新增 adapter，而不是就地重释旧 plan。

## 8. Current collection specs

| Collection | Approved candidate | Upstream version evidence | Members | Exposure | Candidate changes from live active set |
|---|---|---|---:|---|---|
| ProdCraft | `yknothing/prodcraft@fd05978dbbbf5a064205a695af47c8a550f1b224` | `manifest.yml` root `version` = `1.0.0` | 40 | gateway | exact `pc-*` generation |
| LoopOS | `yknothing/loopos@f4454019414143e976edac5a250eca58d92ed12d` | `pyproject.toml` `[project].version` = `0.2.1` | 10 | gateway | content upgrade; exact set |
| LangCraft | `yknothing/langcraft@fa31c4b85a7400c53abee3bd19c278395a0df3fa` | `not_declared`; commit is the only release identity used here | 6 | gateway | adds upstream `prose-craft`; removes local router overlay |
| Better Skills | `yknothing/better-skills@8e8d2af4c5cb2099e27fdea9c723befe91701593` | `skills.json` root `version` = `0.2.0-dev` | 8 | collection | rejects invalid portable-YAML `bs-visual-design`; packages four shared inputs |

这些 commit 是本次 reviewed candidates；后续 upstream `main` 变化不会自动更新 active revision。

## 9. Acceptance gates

Live apply 前至少需要：

1. exact source origin/revision/clean worktree；
2. portable YAML frontmatter、name/description、description ≤1024；
3. member + shared-resource packaging-state Markdown reference closure；
4. complete active/receipt/alias/projection disposition；
5. sandbox initial apply/status/repair/undo，以及 active generation → second revision → undo predecessor；
6. every exception phase rollback、every durable phase `SIGKILL`、partial projection/member loop、interrupted-upgrade recovery；
7. scoped-vs-unrelated receipt drift discrimination；
8. qualified-identity ownership checks, real-directory collision coexistence, plan-bound preserve snapshot and target-health reporting；
9. control/catalog orphan detection、catalog/view exactness、catalog rebuild 的 full post-status；
10. ProdCraft V1 live status remains `FILESYSTEM_READY`；
11. fresh enumeration of newly added collection exposures and same-name flat collisions；
12. multi-collection catalog coexistence and per-collection undo；
13. post-live direct status, nested Finder-metadata policy and static/fresh-runtime loader/reference checks。
14. static roots 与 fresh `~/.<agent>/skills` discovery 的集合一致；新增 Agent root 必须同时进入 scanner 与 native path authorization regression。
15. stale same-repository projection 与 cross-repository collision 分开分类；cleanup 的 retire-path selector 必须绑定 exact review fingerprint。
16. declared upstream version 的 path/value/digest/extractor，以及无声明时的 `not_declared`，必须从 immutable artifact 重建。
17. cleanup plan 的 item/input capacity 必须在 durable initialization 前 fail closed；partition manifest、child hash、8-item 上限与首次失败停止语义必须有回归测试。

## 10. Limitations and non-claims

- Fresh Codex-host discovery is a bounded runtime fact only; other Agent/profile routing, cache invalidation and loader behavior remain unqualified.
- No measured context-window reduction yet.
- V2 external catalog is a durable current-generation registry, not a cryptographically sealed append-only event ledger. Event-chain hardening remains future work and must not be described as implemented.
- Collection mutation and cleanup transaction families still require a future shared global lease audit; current collection operations serialize against other collection operations only.
- Upstream validation quality differs by repository. Repository-provided validators supplement but do not replace controller packaging validation.
- Deployment content comparison ignores only exact basename `.DS_Store` recursively. Source/artifact/predecessor/recovery digests remain exact; any other unknown entry is drift.
- Dynamic root discovery intentionally accepts only an immediate hidden home directory followed by `/skills`；project-local `.agents` trees and deeper arbitrary repositories remain outside the global scan.

## 11. Consequences

Positive:

- adding a collection now changes a reviewed spec instead of cloning a transaction engine；
- history、desired selection、observed reality 与 candidate membership 不再混为一个 lock file；
- accidental deletion of control state is visible；
- non-gateway repositories can be grouped without fabricating Skill semantics；
- V1 remains recoverable while V2 evolves。

Cost:

- every collection still needs an explicit packaging/exposure decision；
- collection projection requires per-Agent runtime qualification before availability/context claims；
- recovery/quarantine retention remains mandatory until a separate GC decision。
