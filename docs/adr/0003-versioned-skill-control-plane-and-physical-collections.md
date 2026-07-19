# ADR-0003: 版本资格化的 Skill 控制面与物理 Collection

- **Status:** Accepted with limitations
- **Date:** 2026-07-19
- **Deciders:** Product owner (host machine) + skills-refiner maintainers
- **Amends:** ADR-0002（On-demand Pack Catalog）
- **Related:** skill disposition transaction design; `~/.agents/.skill-lock.json`; `docs/REVIEW.md`
- **Adversarial review:** `docs/adversarial-product-pk/2026-07-19-versioned-skill-control-plane/`

## 1. Decision

skills-refiner 将演进为**版本资格化的本机 Agent Skills 部署控制面**。它不创建一个本地文件来取代 GitHub，也不把 GitHub 上的 latest 误当成本机正确状态。每一类事实只有一个明确裁决者：

| 问题 | 唯一权威 | 不能替代它的对象 |
|---|---|---|
| 一个上游版本应包含哪些内容？ | Owner 批准的版本化仓库身份、immutable revision、source subpath 与 artifact digest | branch、latest、mtime、receipt、目录名 |
| 来源发布者是否可信？ | versioned trust policy、forge repository identity、Owner origin approval，以及可用时的签名/attestation | URL 或 commit identity 本身 |
| 该版本是否适合当前环境？ | 绑定 Agent/profile、OS/runtime、policy 与 evidence 的 qualification record | upstream tag/release 名称或 Owner 意愿本身 |
| 本机批准部署哪个版本、放在哪里？ | deploy root 外的 Owner-approved deployment ledger | upstream default branch、scanner、第三方 installer |
| 当前磁盘与 Agent 表面实际有什么？ | 带 scope 与 freshness 的直接文件系统和真实 loader 观测 | ledger、receipt、历史 dashboard |
| 当前是否可以向 Agent 提供？ | control plane 基于以上权威在读取时派生的 effective state | 任一可被单独写入的 `installed`/`READY` 字段 |

GitHub、GitLab 或等价版本化仓库仍是 Skill 的天然 authoring/content authority；但可部署身份必须解析到不可变版本，发布者信任和环境稳定性必须分别证明。新的 commit、tag、release 或默认分支变化只产生 candidate，绝不自动替换 active revision。

ProdCraft 是 V1 的唯一物理 collection vertical slice。V1 必须真正把经过资格化的成员退出顶层默认发现面并放入 gateway collection，而不只生成逻辑 catalog；但**当前本机 46 个旧名实体不具备直接迁移资格**。它们与当前 gateway contract、相对引用和上游当前 40 个 `pc-*` public set 均存在已证冲突。只有本 ADR 的 migration eligibility gates 全部通过后，才允许执行物理迁移。

## 2. Why this decision exists

ADR-0002 已确认：100+ 个顶层 Skill 的 description 会形成目录级路由税；S0 catalog 只表达部署意图，不改变真实发现面。要兑现收益，必须改变物理部署或宿主挂载面。

本机只读快照（2026-07-19）：

- `~/.agents/skills` 有 129 个顶层 Skill；静态 frontmatter preflight 没有发现确定的 runtime load blocker，但真实 Agent loader 未执行。
- `~/.agents/.skill-lock.json` 为 schema v3，含 173 条 receipt；122 条与当前顶层实体同名，7 个当前实体没有 receipt，51 条 receipt 已无同名顶层实体。
- `yknothing/prodcraft` 有 46 条 receipt，46/46 当前实体存在于顶层；receipt 不含共同 resolved commit，不能证明它们是一个 coherent release。
- 除 gateway 外的 45 个当前 ProdCraft 实体合计 10,317 个 description 字符；若它们退出默认发现面，顶层数理论上从 129 降至 84。该投影不是 Agent context 实测。
- 已知有 92 个 Agent distribution symlink 指向这 46 个实体：Claude 46 个、Factory 46 个。迁移不是单个目录内的一次 rename。
- 当前 `prodcraft/SKILL.md` 明确要求不要在 `prodcraft` 目录内寻找下游 Skill，并通过 `../intake/SKILL.md` 一类 sibling package 路由；它不具备已验证的 `.members` / `INDEX.json` contract。
- 只读 reference simulation 发现：将当前实体直接移入 `.members/<name>` 会新增 10 个 broken relative `SKILL.md` reference，均指向 collection 外的 `bs-requirements-engineering`。
- 2026-07-19 查询的 ProdCraft upstream `main` commit `fd05978dbbbf5a064205a695af47c8a550f1b224` 发布 40 个 `pc-*` public skills；本机 receipt 是 46 个旧名称。这里的 latest 是 namespace、membership 和 routing contract 的非兼容候选，不是可直接更新版本。

这组证据同时否定三种错误的“唯一事实源”：

1. GitHub 有某版本，因此本机已经正确安装；
2. receipt 或 registry 写着 installed，因此实体仍存在且可加载；
3. 文件系统当前有一组目录，因此它们来自同一个可靠上游版本。

## 3. Owner decisions

1. GitHub 或等价版本化仓库是通常的 Skill 内容来源，也是 authoring/content 的天然权威。
2. 权威必须绑定不可变版本；新版本不自动等于稳定、可靠或应部署。
3. ProdCraft 必须作为物理目录迁移样本，而不只是逻辑 pack。
4. skills-refiner 必须治理安装、更新、迁移、漂移、修复、恢复与审计。
5. canonical 目录的手工删除不自动成为正式卸载，也不允许继续显示为健康。
6. V1 必须窄而完整、可恢复、低摩擦；不能靠扩大功能清单伪装成熟度。

## 4. Authority and version model

### 4.1 Artifact identity

可部署 artifact identity 只包含决定内容的字段：

```text
source_kind
forge_repository_id
canonical_owner_repo
source_url                  # locator, not durable publisher identity
requested_ref               # branch/tag/release/commit as requested
resolved_revision           # immutable commit object ID
source_subpath
upstream_tree_digest
packaging_profile_digest
packaged_artifact_digest
```

`fetched_at`、`installed_at`、`activated_at`、`last_verified_at` 是 lifecycle evidence，不属于 content identity。

Binding rules：

- Git 必须解析到 immutable commit；branch、moving tag、default branch 只能是 `requested_ref`。
- tag/release 可作为 candidate discovery 信号，但不写 qualification 或 activation state。
- 没有 SemVer 的仓库直接使用 commit identity，不虚构版本号。
- symlink、file mode、submodule、Git LFS、大小写、extraction 与 normalization 必须由 versioned packaging profile 定义；无法确定时 fail closed。
- 本地 recovery artifact 是上游 artifact 的 digest-bound 镜像，不获得 authoring authority。

### 4.2 Publisher/source trust

Content identity 不证明 publisher 可信。V1 trust record 至少包含：

```text
provider
forge_repository_id when available
observed owner/repo
approved origin event
allowed transport
signature/attestation evidence when available
revocation state
trust_policy_digest
```

没有密码学签名或 attestation 时，系统只能显示 `Owner-approved observed origin`，不得显示 `cryptographically verified publisher`。Repository rename、transfer、URL alias、force-push、deletion 或 revocation 都必须重新进入 trust evaluation；URL 不是永久 publisher identity。

### 4.3 Orthogonal version states

`pinned`、`stable`、`candidate` 不再建模为一个互斥 channel。V1 使用正交维度：

| Dimension | States | Meaning |
|---|---|---|
| Artifact lifecycle | `candidate`, `retired` | artifact 是否仍在资格化/保留流程 |
| Qualification | `unverified`, `qualified`, `failed`, `revoked` | 对特定环境和 policy 的验证结论 |
| Selection policy | `pinned` | V1 active revision 必须固定；`tracked` 延后 |
| Activation | `inactive`, `active` | 是否是当前批准部署 |

`stable` 只允许作为 `qualified` 的用户界面别名，而且必须显示作用域：

```text
artifact_digest
target_agent_and_version
os_runtime
policy_digest
gate_and_evidence_digests
qualified_at
valid_until_or_revalidation_trigger
approver
```

Agent 版本、OS/runtime、policy 或关键 evidence 发生变化时，旧 qualification 不得无条件沿用。

### 4.4 Update is three separate operations

```text
check
→ resolve immutable candidate
→ isolate and validate
→ propose promotion

promote
→ explicit Owner/policy approval
→ record scoped qualification

apply
→ transactional activation of the exact promoted artifact
```

`check`、`promote`、`apply` 必须可分别调用、审计和失败；任何一步都不能隐式 fetch/apply latest。

## 5. Why `.skill-lock.json` is reused but not extended

`.skill-lock.json` 是 Vercel Labs `skills` CLI 维护的 installer receipt/update-tracking store。在本 ADR 固定审阅的 upstream commit `777599e1159e401b11ce4c8a57c20f09a8f1596e` 中，`skills add` 在 global install 成功后调用 `addSkillToLock`，保留 `installedAt` 并更新 `updatedAt`；lock 写入失败不会令安装失败。上游 schema、兼容策略、原子性和写入时机不由 skills-refiner 控制，而且未来可能继续演进。

本机 173 receipts 与 129 个实际顶层实体已经分叉，所以 V1 的决定是：

- 只读导入并保留 receipt 的 `source`、`sourceUrl`、`skillPath`、folder hash 和 timestamps；
- 每次受管操作前后保存 receipt digest 与必要的脱敏快照；
- 不向该文件添加私有字段，不让它单独写 desired/qualification/effective state；
- adapter 可以复用上游 source resolution/fetch 能力，但只能写隔离 staging，不能直接写受管 global target。

直接扩展它虽然少一个文件，却无法表达 collection、environment-scoped qualification、projection、drift、recovery 和 Owner-approved placement；更重要的是，它会把第三方 receipt 的 eventual consistency 错当成本机部署权威。

## 6. Local control plane

### 6.1 Separation from deploy root

Deployment intent、journal 与 recovery cache 必须与 `~/.agents/skills` 物理分离，避免误删 deploy root 时出现共因失效：

```text
~/.agents/skill-control/
├── lock/
├── events/<sequence>-<event-id>.json
├── operations/<operation-id>/
│   ├── plan.json
│   ├── state.json
│   └── evidence.json
├── views/current.json
├── catalogs/
├── staging/<operation-id>/
├── cache/<artifact-digest>/
└── backups/

~/Library/Application Support/skills-refiner/anchor/
└── ledger-head.json
```

Machine-specific catalog instances live in the local control root. The repository owns schemas, validators, examples and architecture rules; it does not publish one Owner machine's full catalog as the project default.

### 6.2 Durable event protocol

V1 uses a file ledger compatible with the existing disposition transaction model. A committed generation requires：

1. single-writer global lock and stale-lock recovery contract；
2. immutable operation plan and write-ahead operation state；
3. event temp write、file `fsync`、atomic rename、event parent-directory `fsync`；
4. independently addressed sealed head containing sequence + head digest，采用相同 durable publish protocol；
5. materialized view update after sealed-head commit；
6. event schema major/minor；unsupported major fail closed；
7. recovery to exact pre-state、exact post-state 或 `RECOVERY_REQUIRED`。

Event hash chain 只在可信 sealed head 下检测内部缺失、重排或局部损坏。V1 threat model 不声称抵抗同一用户恶意同时重写 ledger 与 anchor，也不把它称为 tamper-proof log。Anchor 的作用是检测常见的 event tail/view/control-root 意外回退；ledger 与 anchor 不一致时禁止 mutation。

Backup 只允许作为 recovery source，不是第二 writer，也不是并行事实源。

### 6.3 Desired, observed, effective

| Plane | States |
|---|---|
| Desired | `present`, `absent`, `quarantined`; expected artifact/path/projections |
| Observed | `exact`, `missing`, `modified`, `unexpected`, `type_changed`, `permission_denied`, `unverified` |
| Effective | `READY`, `MISSING`, `DRIFTED`, `UNMANAGED`, `CONFLICT`, `STALE`, `RECOVERY_REQUIRED` |

`READY` 不是可独立编辑或永久持久化的事实。每次 observation 必须保存：

```text
observed_at
valid_until
scope
policy_digest
filesystem_and_loader_evidence
```

CLI/dashboard 在**读取时**重新计算 freshness；超过 `valid_until` 即显示 `STALE`，不需要 daemon 写回。所有 mutation 和默认 `status` 在给出结果前执行同步 bounded reconcile；缓存快速模式必须显式命名为 `status --cached` 并显示 freshness。

FSEvents/watcher 可以作为后续降低检测延迟的优化，但不是 V1 correctness authority，也不在 V1 scope 内。

## 7. Manual deletion and external mutation

手工删除 canonical member 时：

```text
status or command preflight
→ direct lstat/tree observation
→ append drift_detected event
→ observed=missing, effective=MISSING
→ recompile runtime index with availability=false
→ offer restore-exact / accept-removal / inspect
```

- canonical content 默认不自动恢复，因为删除可能表达 Owner intent。
- `restore-exact` 优先使用已验证 recovery artifact，其次 fetch exact resolved revision；禁止用 latest 替代。
- `accept-removal` 是显式 desired-state transaction，并清理 projections；scanner 不能猜测。
- 纯派生 projection 在 canonical target exact 且 policy 允许时可以重建。

裸跑 `npx/npm` 或手工 copy/move/delete 是 unsupported external mutation。它不能改变 desired set、qualification 或 active revision。Reconciliation 必须按 artifact-set diff 表达：

```text
added | removed | renamed | split | merged
source_path_changed | namespace_changed | content_changed
```

单路径 `REHYDRATED` 只适用于 artifact identity 完全不变的重现。像 ProdCraft `46 old names → 40 pc-*` 的变化必须进入 candidate/conflict，不能被自动吸收。

“低摩擦”的 V1 含义仅为：受管命令不要求手工编辑 registry、update discovery 与 apply 分离、status/repair 动作明确；不承诺透明拦截所有 shell 中的 `npx/npm`。

## 8. ProdCraft physical collection

### 8.1 Versioned collection manifest

物理 collection 是一个 release/migration unit，不是按 receipt source 临时聚合目录。Eligibility manifest 必须由同一个 approved immutable upstream revision 提供并绑定：

```text
forge_repository_id
resolved_revision
collection_manifest_digest
gateway_id + source_path + digest
member_ids + source_paths + digests
compatibility_generation
runtime_index_schema
portable_reference_contract
```

如果本机现存实体无法绑定共同 upstream revision，只能标为 `adopted_snapshot/unverified_source_binding`，不得晋级为 qualified collection。

### 8.2 Target layout

实际 gateway/member 名称由 approved manifest 决定；示意布局为：

```text
~/.agents/skills/
└── <prodcraft-gateway-id>/
    ├── SKILL.md
    ├── INDEX.json
    ├── prodcraft-runtime.json
    └── .members/
        ├── <member-id>/
        │   ├── SKILL.md
        │   └── ... assets/references/scripts
        └── ...
```

Gateway 是默认发现入口。成员必须真实位于 `.members`，而不是用逻辑 catalog 冒充物理迁移。`INDEX.json` 与 locator 是可重建 projection，不能自行发明 Skill 语义；routing cue 必须来自 versioned manifest/frontmatter 或 Owner-approved catalog，并受独立 schema/context-budget gate。

`.members` 的 dot-prefix 不是 ignore contract。若某 Agent 递归发现成员，那个 Agent 的 context-saving claim 失败，直到 adapter 提供并验证正式 discovery boundary。

### 8.3 Collection-aware gateway prerequisite

当前 installed gateway 不合格，因为它明确禁止在自身目录寻找成员并只识别 sibling packages。ProdCraft activation 必须等待 approved immutable upstream revision 提供 collection-aware gateway：

1. 显式读取 versioned runtime locator；
2. 定义 `member_root` 与 index schema；
3. 在 collection root 内无路径逃逸地解析 member；
4. locator generation、member digest 或 availability 不匹配时 fail closed；
5. collection contract 不可用时保留诚实的 partial-entry 语义。

Control plane 禁止 patch 已安装第三方 `SKILL.md` 来伪造该能力。40 个 `pc-*` gateway 也不得直接路由本机 46 个旧名成员，除非同一 manifest 提供明确 compatibility mapping 并通过 qualification。

### 8.4 Reference-closure decision

V1 **选择 upstream portable reference** 作为 collection 外依赖的唯一允许解法：eligible revision 必须把成员引用表达为 collection-aware locator/manifest contract，或移除该成员的迁移资格。

V1 不创建 ad-hoc compatibility symlink，不自动扩大 collection closure，也不重写 installed Skill。Activation gate 要求：

```text
newly_broken_references == 0
```

Reference graph 必须 machine-readable，并区分 member-local、collection-internal、external-canonical；已有 broken reference 与迁移新增 regression 必须分别报告。

### 8.5 Discovery-isolated staging

所有 candidate 与 migration staging 位于 `~/.agents/skill-control/staging/<operation-id>/`，不在任何 Agent discovery root 中。Candidate validation 使用隔离临时 discovery root；在以下条件满足前，不得 link/copy/rename 到 active surface：

- collection-aware gateway contract 通过；
- reference closure 通过；
- target Agent recursion/cache/reload 行为已直接验证；
- immutable activation/rollback plan 已批准；
- quiescence gate 已建立。

### 8.6 Quiescent migration transaction

ProdCraft V1 migration 是 maintenance operation，不承诺 zero downtime 或跨 46+92 路径的 batch atomicity：

1. 锁定共同 upstream revision、collection manifest、所有本机 source identities、完整 reference graph 和全部 Agent projections；当前已知 92 个 raw symlink 必须纳入。
2. 在 discovery roots 外编译并验证 exact collection、runtime index、locator、recovery artifact 与 immutable cutover/rollback plan。
3. Owner 确认受影响 Agent sessions 已停止，未验证 adapter 的 Agent 保持原拓扑并退出此次 cutover。
4. 获取 global mutation lock，再次验证所有 identities 与 quiescence。
5. 按 journal 逐步切换 canonical topology 和 projections；每一步可恢复，但不宣称整个 batch 是单 rename 原子操作。
6. 验证每个参与 Agent 只能看到完整 post-generation；发现 mixed generation 即阻断 commit 并 rollback/recover。
7. 将旧 flat topology 移入 transaction quarantine，不永久删除。
8. 在 Agent sessions 重启前完成 topology、broken-link、runtime、gateway、undo evidence gates，并提交 ledger generation。
9. 任一步失败都收敛到 exact pre-state、exact post-state 或 `RECOVERY_REQUIRED`。

已加载 session 的 metadata 不会因 rename 被撤回；context before/after 只对 cutover 后的新 session 测量。

## 9. V1 scope

V1 只交付一个 ProdCraft end-to-end vertical slice：

```text
one approved Git/GitHub origin
→ resolve one immutable collection revision
→ import Vercel receipt as evidence
→ isolated stage
→ qualify gateway + members + references + Agent adapters
→ explicit promotion
→ quiescent physical migration
→ command-time reconcile
→ exact restore / accept-removal / undo
```

| Capability | V1 contract | Required gate | Rollback |
|---|---|---|---|
| Source | one Git/GitHub adapter + read-only Vercel receipt import | immutable repo/revision/artifact binding | keep prior active pin |
| Qualification | explicit, environment-scoped | gateway/reference/Agent/evidence digests | no activation |
| Ledger | durable file journal + independent anchor | durability, schema and kill injection | exact pre/post/recovery-required |
| Status | synchronous command-time reconcile | no false-READY, read-time freshness | projection rebuild |
| Migration | ProdCraft plan/dry-run/apply | eligibility + quiescence + complete topology | quarantine-backed undo |
| Repair | exact artifact only | digest and desired-state precondition | retain prior evidence |

Deferred beyond V1：generic npm-package adapter、generic local-import promotion、multi-collection framework、resident FSEvents daemon、policy-driven auto-promotion、Windows/Linux mutation、zero-downtime cutover。

## 10. Alternatives rejected

### Filesystem-only truth

能观察现状，但无法保存批准版本、信任、placement、promotion 历史与 rollback intent。

### Registry-only truth

外部删除或修改后会制造 false-READY，并诱导危险的静默自愈。

### Extend `.skill-lock.json` as the management center

复用价值保留为 adapter；拒绝作为 authority，因为 schema/writer 不受控、receipt 与实况已分叉，也无法表达 collection、qualification、projection、drift 和 recovery。

### Logical catalog only

能组织认知，但不改变物理 discovery surface，无法兑现 ADR-0002 的收益。

### Latest auto-update

把“发现新内容”错误等同于“可信、兼容、稳定且应部署”。ProdCraft 46 旧名到 40 `pc-*` 已提供反例。

### Global content-addressed migration

一次性迁移全部 Skills 的兼容和恢复风险过高；先用 ProdCraft vertical slice 证明控制闭环。

### Database-first

存储技术不能替代事务语义。V1 复用现有 file-transaction 经验；未来只有在相同 durability/fitness gates 下才允许更换。

## 11. Fitness functions and promotion boundary

| Gate | Pass rule | ADR state |
|---|---|---|
| Authority identity | moving tag/branch/repo rename 不改变 active digest，只产生 candidate/trust review | specified, unimplemented |
| Version-set incompatibility | `46 old → 40 pc-*` 进入 candidate/conflict，不改 desired/active set | specified, unimplemented |
| Gateway | real Agent 从 pinned gateway 读取至少 3 个 nested members；missing/digest/generation/path escape fail closed | migration veto |
| Reference closure | `newly_broken_references == 0`，pre-existing 与 regression 分报 | migration veto |
| Agent discovery | 每个参与 adapter 证明 recursion、symlink、cache/reload contract | migration/context veto |
| No false READY | 删除、修改、权限阻断后同步 reconcile 不返回 `READY`；过期 view 读取为 `STALE` | specified, unimplemented |
| Ledger durability | middle/tail delete、truncate、reorder、disk-full、schema mismatch 和各阶段 kill 可检测并 fail closed | mutation veto |
| Recovery | 每个 migration phase kill 后为 exact pre、exact post 或 `RECOVERY_REQUIRED` | mutation veto |
| Topology round trip | 46 canonical entries 和 92 known projections 的 raw link/digest identity 可恢复 | migration veto |
| Context claim | 每个 target Agent 的新 session 有 before/after discovery/context evidence | claim veto |
| Raw external update | 隔离重放 artifact-set rename/remove/add 不改变 approved active set | mutation veto |

本 ADR 经对抗性评审后最多可以成为 **canonical architecture decision with limitations**。它不授权 implementation mutation，也不代表 ProdCraft 已迁移、ledger 已可靠、context 已减少或新版本已稳定。

只有 implementation plan、runnable gates、fault injection、真实迁移 dry-run、Agent-specific runtime/context evidence 与独立验收完成后，才允许执行受管物理迁移。

## 12. Consequences

### Positive

- Git authoring authority、本机部署意图和实时实况不再互相冒充。
- “有新版本”“来源可信”“环境合格”“已激活”被强制分离。
- ProdCraft 物理 collection 仍是明确交付目标，但错误的 46→1 直接搬移被 fail closed。
- 手工删除、外部 installer、namespace migration、symlink drift 和部分事务都有明确状态。
- 管理中心与 deploy root 分离，machine catalog 不再污染公共仓库 authority。

### Cost and accepted limitations

- V1 只支持一个 ProdCraft vertical slice，需要 maintenance window。
- 受管目录不能继续把裸 `npx skills update -g` 当作安全写入口；只能事后检测外部 mutation。
- 没有签名时只能证明 Owner-approved observed origin，不能证明密码学 publisher 身份。
- 不同 Agent 的 discovery/cache 语义必须逐一验证。
- 控制面成为本机 mutation 的关键组件，必须先通过 ledger/recovery fault injection。
- 两次同步观测之间只能最终一致；read-time expiry 防止陈旧绿灯，但确切 `MISSING` 仍需直接扫描。

## 13. Reconsideration triggers

重新评审本 ADR，当：

- 主要 Agent 提供官方 catalog/load-skill API，可替代 symlink projection；
- upstream `skills` CLI 提供事务化 custom target、stable migration API 或可扩展 receipt schema；
- ProdCraft 发布新的 authoritative collection distribution contract；
- file ledger 无法通过规模、durability 或 recovery gates；
- scope 扩展到其他 collection、Windows/Linux mutation 或 policy auto-promotion；
- Owner 要求 zero-downtime cutover 或恶意攻击者下的 tamper-evident audit。

## References

- [ADR-0002: On-demand Pack Catalog](0002-on-demand-pack-catalog.md)
- [`docs/REVIEW.md`](../REVIEW.md)
- [Interactive Skill Disposition CLI Design](../superpowers/specs/2026-07-14-skill-disposition-cli-design.md)
- [Vercel Labs skills snapshot](https://github.com/vercel-labs/skills/commit/777599e1159e401b11ce4c8a57c20f09a8f1596e)（queried 2026-07-19）
- [Vercel Labs lock writer at reviewed snapshot](https://github.com/vercel-labs/skills/blob/777599e1159e401b11ce4c8a57c20f09a8f1596e/src/skill-lock.ts)
- [Vercel Labs global receipt update call at reviewed snapshot](https://github.com/vercel-labs/skills/blob/777599e1159e401b11ce4c8a57c20f09a8f1596e/src/add.ts)
- [ProdCraft pinned upstream snapshot](https://github.com/yknothing/prodcraft/commit/fd05978dbbbf5a064205a695af47c8a550f1b224)
- [ProdCraft public registry at pinned snapshot](https://github.com/yknothing/prodcraft/blob/fd05978dbbbf5a064205a695af47c8a550f1b224/schemas/distribution/public-skill-registry.json)
- [Agent Skills specification](https://agentskills.io/)
