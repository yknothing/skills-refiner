# ADR-0008：运行时感知的全局 Agent Skills 管理

- **Status:** Proposed — Owner decision required
- **Date:** 2026-08-28
- **Deciders:** Product owner（host machine）+ skills-refiner maintainers
- **Supersedes:** ADR-0002 的 S1/S2 实现方案；ADR-0002 仍保留为问题定义与历史决策
- **Depends on:** ADR-0001、ADR-0003、ADR-0004、ADR-0005、ADR-0006、ADR-0007
- **Scope:** `$HOME/.agents/skills` 的全量观察面；四个显式 collection 的 source-qualified 控制面；Agent 发现面与 skills-refiner 本机控制面
- **Promotion scope:** 本机单用户信任边界内的 69 个 source-qualified collection members；其余 identity 只保留 inventory/path/receipt 证据等级

## 1. 结论

skills-refiner 采用“**上游不可变制品 + 已批准 active generation + 运行时 exposure policy + 实际观测**”的分层管理模型。

1. GitHub 或同类上游仓库的**精确 revision 与内容树**是 Skill 内容的权威来源；`latest` 只能用于发现候选，不能直接等同于稳定版本。
2. collection controller 的 active record 表示本机已批准部署的 generation；它不重新定义上游版本，也不替代实际磁盘检查。
3. `runtime-policy.json` 表示各宿主期望暴露哪些 identity；它不证明宿主已发现、已读取或已执行 Skill。
4. 磁盘、Agent 原生 catalog、body access、gateway route 与 context pressure 分层观测；任何一层不得替另一层报绿。
5. 物理 collection 解决组织、升级与溯源问题；**仅嵌套目录不会自动节省 context**。真正减少 description 路由税必须由宿主原生 profile/config 或可验证投影控制实现。
6. 同名不同仓库是合法状态。默认 `preserve + collision`，除非 Owner 明确批准替换；不得以名字相同自动清退。
7. 所有由 skills-refiner 发起或显式接管的安装、升级、迁移和 exposure 变更采用
   plan/confirm/apply/status/undo/recover 流程，并在锁内重验 precondition。外部 `npx`/`npm` installer
   在被显式 adoption 前只作为可审计输入，不伪装成已受控制面事务管理。

本 ADR 不选择一个可漂移的 `skill-lock.json` 或数据库快照作为“万能唯一事实源”。唯一事实按职责分层；任何摘要文件都必须能由更权威事实重新验证，不能靠自身声称正确。

## 2. 为什么 ADR-0002 不足

ADR-0002 正确识别了 description 路由税，并提出 pack/catalog 渐进披露；但当时只有 S0 契约，没有真实 mount/runtime 机制。实机验证进一步证明：

- Codex 会递归发现受管 collection 内的成员；物理嵌套并未隔离 description。
- Claude、Codex、Cursor 的发现机制、可观测能力和配置入口不同，不能用一组 symlink 布局宣称三者等价。
- “catalog 里批准了”只表示意图；手动删除成员、改写 INDEX、替换软链或缓存旧会话都会使实际状态漂移。
- 单个名字无法长期标识 Skill；仓库、revision、source path、tree digest 与 canonical path 都属于 identity。

因此，ADR-0008 将 ADR-0002 的 S1/S2 收敛为可事务化、可验证、按宿主分层的 runtime profile，而不是继续扩展静态 pack 清单。

## 3. 事实与权威边界

### 3.1 内容权威

内容 identity：

```text
provider
+ repository_id
+ resolved_revision
+ source_path
+ declared_name
+ tree_digest
```

- `resolved_revision` 必须是不可变 revision；tag/release 名仅作为附加可读信息。
- 第三方版本只可从该 immutable artifact 中的明确声明读取，并记录声明文件路径与摘要；未声明就是 `not_declared`。
- skills-refiner 的产品版本、JSON schema 版本、本机迁移批次不得冒充第三方版本。

### 3.2 本机 desired generation

每个受管 collection 的 active controller record 选择一个已批准 generation，并与 plan、operation、INDEX 和必要的 catalog entry 绑定。

- ProdCraft 当前写入 `collection.plan.v3`、`collection.active.v2`、`collection.operation.v1`；为读取历史 generation，兼容 `plan.v1/v2/v3` 与 `active.v1/v2`。
- Better Skills、LoopOS、LangCraft 当前写入 `managed-collection.plan.v5`、`collection.active.v2`、`managed-collection.operation.v2`；为读取历史 generation，兼容 `plan.v2/v3/v4/v5`。
- managed collection repair 使用 operation-bound `collection.repair-attempt.v1` ledger record：先 exclusive create，
  后续状态以 identity/content CAS 更新，并绑定 pre-state quarantine、stage/published identity 与 plan hash。它是独立
  repair attempt 的可恢复 current view，不是 append-only WAL，也不覆盖原 operation 的身份。
- 这些 schema 数字是控制协议代次，不是第三方 release version。
- reconstructable catalog view 不是独立权威；必须与 canonical catalog 一致。

ProdCraft 的历史兼容是显式 allowlist：当前 `plan.v3` 必须具备完整 recovery evidence；只有精确的历史
`plan.v1/v2` 格式可接受其当时尚不存在的字段。未来 schema 不会自动继承该放宽规则。

### 3.3 实际状态

实际状态始终重新观测：

| 层 | 问题 | 证据 |
|---|---|---|
| Filesystem | 批准成员与资源是否按精确摘要存在 | no-follow 路径检查、INDEX、tree/resource digest |
| Deployment | profile/config/projection 是否达到 desired state | active profile、append-only operation journal、native identity/CAS |
| Catalog | 新会话是否枚举正确 identity | 宿主原生 catalog/init 输出 |
| Body | Skill 正文是否被完整读取 | 宿主可证明的 body-access 事件；没有就 `unverified` |
| Route | gateway 是否路由到目标成员 | 宿主可证明的 route 事件；没有就 `unverified` |
| Context | 是否截断或触发预算压力 | 宿主事件或明确 warning |

状态只能由同层证据给出。`FILESYSTEM_READY`、`DEPLOYMENT_READY`、`CATALOG_ONLY`、`QUALIFIED` 是不同结论。

现有 ProdCraft v1 status contract 仍以一个保守的 `FILESYSTEM_READY/DRIFTED` 聚合当前部署与
quarantine/recovery 完整性：恢复副本受损会降级整体状态，绝不会产生 false ready。首版保持这一兼容语义；
它不得被解读为已经分别证明了 activation readiness 与 recovery readiness。若后续拆分，必须发布新的
status schema，并显式输出各层状态与 observation scope，不能把未检查的恢复面标成 ready。

## 4. 物理 collection 与目录索引

受管 collection 必须位于：

```text
~/.agents/skills/<collection-id>/
  INDEX.json
  <member>/SKILL.md
  <bounded shared resources>
```

INDEX 是 collection 边界内的声明式成员清单，不是全 home 搜索索引。scanner 只能展开 INDEX 声明的安全相对路径，并重新计算：

- member tree digest；
- resource digest；
- locator/gateway digest；
- collection root inventory/tree digest。

任一未索引 `SKILL.md`、越界路径、重复成员、摘要不一致或 rogue resource 都使整个 collection fail closed；不得只隐藏坏成员后继续把 collection 报为 ready。

INDEX 也不能自证其来源字段真实。scanner 对 INDEX 中的 repository、revision 与 source path 只输出
`index_claim` / `controller_unverified`；只有 active controller、canonical catalog、实际树摘要与 runtime
evidence 能共同将该声明提升为受控事实。这样即使有人同时改写 INDEX 与成员树，也不会仅凭两者自洽而获得
`controller_verified` 结论。

## 5. 安装、升级与迁移流程

统一流程：

```text
discover candidate
  → resolve immutable upstream revision
  → validate source/index/version evidence
  → compare active generation and actual filesystem
  → build immutable plan + precondition digest
  → explicit confirmation of exact plan hash
  → native exclusive/CAS mutation under shared writer lease
  → postcondition + controller activation
  → fresh runtime probe
  → panorama reconciliation
```

### 5.1 “上游最新”不是自动稳定

- 工具可以发现上游最新 revision，但必须先作为 candidate。
- promotion 至少要求结构/引用/loadability gates、差异审查、来源与 revision 固定、可回滚 pre-state。
- 自动更新不得静默越过重大删除、同名跨仓冲突、runtime exposure 扩张或未声明版本。

### 5.2 真实迁移能力

迁移不是增加一份元数据，而是将已批准成员物理部署到 collection 根，并处理旧实体：

- 旧路径先精确识别来源和内容；
- 与上游新 identity 对应的旧成员由 plan 显式替换/隔离；
- 无法证明对应关系的同名实体默认保留并报告 collision；
- 所有移除采用 identity-bound quarantine/rollback，不做名字级裸删除。

### 5.3 手工删除或改写

管理状态不会“自动相信” active record。每次 fresh status、probe 或 panorama 都从磁盘重算摘要并与 controller/index 比对：

- 手工删除 member → `MEMBER_DRIFT` / `DEPLOYMENT_DRIFT`；
- 手工增加未索引 Skill → `collection_root_drift`；
- 改写 INDEX 与树使二者自洽但不匹配 active generation → `collection_control_drift`；
- profile marker 存在但无可验证 active operation → `unowned_managed_block`。

修复必须回到 controller 的 repair/upgrade 流程，runtime evidence 层不得猜造或回填控制面事实。

### 5.4 Drifted predecessor 的升级

successor plan 不得把“将被新版本替换”当作忽略 active drift 的理由。若 active generation 已漂移，直接升级必须
以 `predecessor_drift` 在 mutation 前失败；否则 successor quarantine 会把未审阅的漂移混同为正常 predecessor。

标准流程是两阶段：

1. 从 active immutable artifact 重建 desired old generation，把实际 drifted pre-state 放入独立、identity-bound
   repair quarantine；
2. repair status 回到 `FILESYSTEM_READY` 后，再针对新的 immutable candidate 编译 successor plan；
3. successor 继续保留 repaired predecessor，repair quarantine 也不被隐式删除。

本轮 Better Skills 从 12-member 旧 generation 升级到 13-member latest candidate 时真实走通该流程。它还暴露出一个
重要不变式：受管 member 内容随 successor 合法变化时，指向该 member 根的 preserved symlink 目标摘要也会变化。
只有在 symlink 其他 identity 字段完全一致、目标精确为当前已验证 member 根、INDEX/member/tree 均通过时，摘要
变化才可视为 generation-derived；retarget、外部目标、member descendant 或 member drift 仍必须告警。

## 6. Runtime profile

### 6.1 Default profile

首版对四个受管 collection 使用封闭策略：

| Collection | Codex | Claude | Cursor |
|---|---|---|---|
| ProdCraft | gateway `pc-prodcraft` | gateway `pc-prodcraft` | observe-only |
| Better Skills | 13 个批准成员 | 13 个批准成员 | observe-only |
| LoopOS | gateway `loopos` | gateway `loopos` | observe-only |
| LangCraft | gateway `langcraft` | gateway `langcraft` | observe-only |

Cursor 在缺少可信 native catalog/profile probe 前零 mutation；不能用静态实现推断替代运行时证据。

### 6.2 Codex

- 通过受管 `[[skills.config]]` block 禁用 gateway collection 的非 gateway 成员。
- block 外 bytes 原样保留。
- 外部已有同 path 配置视为 user-owned conflict，不覆盖。
- block 必须由 active operation、plan hash 与 block digest 证明所有权；仅写同名 marker 不会被接管。
- candidate config 必须通过真实 Codex strict config 与 catalog loader 验证后才可发布。

### 6.3 Claude

- 只创建 policy 所需的 top-level projection。
- 目标不存在时才 exclusive create；已有同 identity 是 no-op；其他 file/dir/symlink 均 preserve/block。
- rollback 只删除本 operation 创建且 raw target、canonical target、device、inode 全部匹配的 symlink。

### 6.4 会话与缓存

profile apply 只证明磁盘 deployment；运行中的 Agent 可能缓存旧 catalog。runtime qualification 必须来自 apply 后启动的 fresh session，不得复用变更前会话证据。

## 7. 事务、安全与恢复

1. collection mutation 与 runtime profile 使用同一全局 writer-lock namespace，不能并发改写同一受管 surface。
2. operation root、journal file、lock 与 projection 使用 native no-follow/exclusive primitive。
3. config 与 active record 使用 content CAS；发布前后均绑定摘要与 identity。
4. runtime profile 的 operation journal 是 append-only WAL，记录合法状态迁移与 digest chain；其
   `operation.json` 只是可校验的 current view。
5. runtime profile undo 先写 `UNDOING` WAL；SIGKILL 后 recover 继续完成 undo，而不是误作 apply rollback。
6. 现有 ProdCraft specialized controller 与 managed-collection controller 保持兼容 current-view 协议：lock 与 operation
   使用 native exclusive/no-follow，更新使用 identity/content CAS，并把释放或 stale lock 移入绑定身份的
   audit；managed collection 的每次 repair 另有 operation-bound attempt ledger，但同样不是逐状态 append-only WAL。
   首版不声称 collection operation 或 repair 已具有 runtime profile WAL 的历史完整性。
7. lock 释放/隔离使用 inode/device/manifest 绑定移动，不裸 `unlink`。
8. 任一结果不确定时返回 `RECOVERY_REQUIRED`；不得重试为看似成功。
9. 输出、evidence 与 share 文件必须拒绝 symlink/非普通文件，owner-private、原子写。

## 8. Evidence 与隐私

- 原生 probe 只保存结构化派生事实与 stdout/stderr digest，不保存 raw prompt/transcript。
- evidence schema 必须 exact-key、bounded，并拒绝额外 raw 字段。
- 新 probe 使用 `runtime-evidence.v2` / `runtime-probe.v2`，分别记录 allowlist 化的 execution 与 decoding
  结果；非零 Codex 退出即使输出可解析也不得晋升为 catalog proof。Claude 只可保留“已解析到完整
  `system.init` 后发生非零退出”的 catalog 例外，并以 `post_init_nonzero` 明示未知退出原因。历史 v1
  evidence 继续可验证、record 与 status，不强制迁移。
- v2 producer 在 stdout/`--output` 前必须通过同一 exact validator；validator 必须绑定 adapter-specific
  version/build、identity capability、context/topology 可达状态，并闭合 `observed_names` 与受管 entity 集合，
  防止 self-hash 把 name-only、unknown 或 policy failure 提升为更高权威证明。
- probe stderr 只参与摘要和低权威 allowlist 诊断分类；probe 原文与 native exception message 不得进入 evidence，
  非预期 CLI failure 使用固定 diagnostic。executable/config/discovery/catalog identity 所需的有界结构化路径必须保留，share 输出负责脱敏。adapter
  version discovery 只接受成功 `--version` 进程的有界 stdout，不得回退到 stderr。
- 分享报告必须移除 HOME、用户名、URL userinfo/query/fragment、SSH user/host 与本机绝对路径。
- 同一用户可自行编辑本机文件，因此 evidence 提供的是可验证的一致性与防误用，不声称抵抗已完全控制该账户的恶意伪造。需要更高信任等级时必须引入宿主签名/系统证明，不能用自哈希 JSON 冒充。

## 9. Panorama v2

Panorama v2 使用当前证据可支持的最强 identity 对齐 scanner、controller、runtime profile 与 evidence：有
repository/source/revision 证据时为 `source_qualified`；证据不足时显式降级为 `path_qualified` 或
`ambiguous_name`。后两类只用于观察与分诊，绝不授予跨仓 cleanup/migration authority。Panorama 并输出：

- `collector_status` 与 `completeness`；
- per-variant catalog conformance；
- filesystem/deployment/catalog/body/route/context runtime matrix；
- 同名同内容但不同 repository/source path 的 collision；
- `DEGRADED` 时非零退出，同时仍可写部分报告供排障。

非零 scanner 若带可解析 blocker JSON，Panorama 必须保留该事实，不能丢弃后再生成“完整”报告。

## 10. 与 skill-lock.json 的关系

`skill-lock.json` 常由安装器写入，适合作为“安装器曾声明什么”的 receipt evidence；它的问题是：

- 可能由多个安装器以不同语义维护；
- 手工删除/移动 Skill 后不会自动更新；
- branch/tag 可漂移，版本字段也可能不是上游声明；
- 名字级键无法表达跨仓同名 identity；
- 它通常不了解 Agent runtime exposure。

因此本机制**消费但不复用它作为唯一权威**：receipt 被内容摘要绑定后参与来源审计；当前状态仍由 upstream revision、controller、实际树和 runtime probe 交叉验证。这样可以利用安装来源信息，同时避免 lock file 自己漂移后继续授予错误结论。

`skill-scan.v7` 将这条边界固化为独立 claim：只有 owner-private、非 symlink 的 `.skill-lock.json` v3
记录，其 `skillFolderHash` 与当前目录 Git tree 完全一致，且 `source` / public GitHub `sourceUrl` /
安全 `skillPath` 冗余字段彼此一致时，才输出 `installer_receipt_claim` / `receipt_bound`。该 claim：

- 保留实际 `git_root`，因此不会把 authoring/worktree 误升级为可清理 installed copy；
- 必须同时具有 `installed_copy/direct/content_bound_installer_receipt` mutation evidence；
- cleanup plan 在 mutation 前从 identity-bound receipt 原文重新规范化 source 并 exact compare；
- 不向 symlink/cache alias 传播，也不在跳过/截断 tree validation 时产生；
- `resolved_revision` 始终为 `null`，因为 npx skills v3 receipt 没有记录 immutable Git revision。

最后一点是有意的 fail-closed limitation：本次安装来自已推送的仓库提交，且可在本次发布流程中做 payload
比对，但不能把运行时已知 commit 反向伪装成安装器收据本身记录的字段。后续若要让任意 npx/npm 安装都具备
可重建的 immutable revision，必须由 skills-refiner 包装 discover/resolve/install 流程并写入独立、操作绑定的
controller record；不能修改或“补全”第三方 lock 来制造来源权威。

## 11. 失败与回滚语义

| 场景 | 行为 |
|---|---|
| 上游候选校验失败 | 不生成可应用计划 |
| plan 后状态变化 | stale，零 mutation 或进入明确 recovery |
| active member 已 drift 时请求升级 | successor plan fail closed；先独立 repair/quarantine，再重新规划 upgrade |
| 同名外部实体 | preserve/block，等待 Owner 决策 |
| apply 中断 | identity-bound rollback；不确定则 `RECOVERY_REQUIRED` |
| undo 中断 | 从 `UNDOING` journal 恢复至 pre-state |
| runtime 只证实 catalog | `CATALOG_ONLY`，CLI 非零 |
| Cursor 无原生证据 | `BLOCKED`/`UNSUPPORTED`，零 mutation |
| collector 部分失败 | Panorama `DEGRADED/PARTIAL`，非零退出 |

## 12. 验收门禁

转为 Accepted 前必须同时满足：

1. scanner 的受管 INDEX strict validation、rogue member/resource、同名跨仓 identity 与隐私回归测试通过。
2. runtime profile 的 CAS/race/SIGKILL/apply/undo/recover/no-op/ownership/journal 测试通过。
3. runtime evidence v2 exact schema、v1 compatibility、execution/decoding 分类与脱敏、control generation binding、config symlink、stale/future、foreign identity 测试通过。
4. Panorama v2 的 partial/degraded、per-variant、runtime matrix、redaction 与 safe output 测试通过。
5. 五个仓库 Skills 完成 frontmatter、description budget、引用文件与 installed-layout gates。
6. 在真实 HOME 只应用 CLI exact-hash confirmation 通过的 plan；promotion packet 还必须把 exact hash、operation、
   reviewer、review time 与 decision 绑定。机器接受 hash 不自动证明 Owner 已人审该 hash。
7. 全局重新扫描证明受管 collection 与 installed skills 无未解释 drift；任何 `UNVERIFIED`/`BLOCKED` 保留原样。
8. Agent-separated 架构 Challenger 关闭全部 P0/P1，或将无法关闭项明确列为 Owner 接受的 limitation；只有
   L3/L4 fresh-context、multi-model 或外部评审完成后才可使用 independent/external wording。

## 13. Consequences

### Positive

- 大量 Skills 可以物理集中管理，同时 runtime 暴露面可单独控制。
- 手工删除、旧成员残留、同名跨仓、版本来源混淆都能被分层发现。
- 计划、实际变更、恢复和 runtime 证据形成可复核链路。
- 上游版本权威与本机部署选择不再混为一谈。

### Costs / limitations

- 首版 policy 对四个 collection 封闭建模，不宣称已成为任意仓库的通用自动分类器。
- Codex/Claude 当前原生探针主要证明 catalog；body/route 缺少宿主证据时仍不 qualified。
- Cursor 仍是 observe-only。
- ProdCraft v1 与 managed-collection v2 controller 已获得 native no-follow/exclusive 与 CAS 加固，但仍使用
  兼容 current-view operation 协议；逐状态 append-only WAL 首版只覆盖 runtime profile。
- `collection list/status --fresh` 首版没有状态缓存，始终执行完整 current + recovery 观察；本轮当前本机单次
  `collection list --fresh` 样本为 1.19 秒。单次样本不是 p95/SLO 或跨机保证；若规模继续上升，应新增 bounded
  no-follow batch inspect，不能通过跳过 recovery evidence 换取速度。
- 事务安全依赖 macOS native helper 与 Node 24；其他平台保持 fail closed。
- 外部 `npx skills` v3 receipt 能绑定 repository/path/tree 与安装时间，但没有 immutable revision；未经过
  skills-refiner candidate-resolution/controller 流程的 bootstrap 安装只能报告 `receipt_bound`，不能报告
  upstream-qualified。
- 通用 `npx`/`npm` wrapper 与 adoption transaction 尚未实现；外部 installer 的 mutation 当前只能事后审计，
  不具备 skills-refiner plan/undo/recover 保证。只有未来经显式接管的 generation 才能获得该保证。
- receipt 中的 `installedAt` / `updatedAt` 是 installer-declared timestamp；当前只校验结构、时间格式与内容绑定，
  不把它们表述为独立验证过的真实安装事件。
- local origin-tracking containment 证明 candidate revision 属于已配置 remote-tracking refs；它不是本轮在线查询
  上游、签名验证或远端实时状态证明。
- collection controller 是 current-view + recovery evidence，不是 append-only WAL；整棵 active collection 与其
  物理副本同时被删除时，fresh status 会 fail closed，但首版不会自动从上游重建。
- active successor status 验证当前 active、predecessor 与 undo/recovery evidence；它不遍历所有历史 predecessor
  的 repair quarantine。历史修复证据的 bounded audit 是后续增强项。
- Panorama 详细 collection rows 保留 `management_attention`，但当前顶层 summary 尚未聚合该字段；运维分诊不能
  只读取 summary。
- Better Skills 当前保留 13 个 collision/projection 观察实体，证明默认 preserve，不证明 name-only runtime 能
  在同名 divergent body 之间选中正确来源。

## 14. 非目标

- 不自动把任意最新 commit 晋升为稳定版本。
- 不根据名字自动合并或删除跨仓 Skill。
- 不扫描整个 HOME 猜测所有 Skill。
- 不把运行次数或“未观察到”当作质量/价值结论。
- 不声称能抵抗已完全控制同一用户账户的恶意 evidence 伪造。

## 15. 采纳记录

2026-08-28，经实现、全局安装面复验、Better 最新 successor 实际升级、真实 Codex/Claude/Cursor probe 与
L2 Agent-separated 对抗性评审，本 ADR 形成 promotion candidate。实现基线为 `0d2b853..e680b8d`；权威验收与
残余限制记录在：

- `docs/adversarial-product-pk/2026-08-28-runtime-aware-global-skills/`
- `docs/verification/2026-08-28-runtime-aware-global-skills.md`
- `docs/retrospectives/2026-08-28-runtime-aware-global-skills-management.md`

当前状态为 **Owner decision required**：四个 collection active plan 与一个 runtime profile active plan 已通过 CLI
exact-hash confirmation 并 committed，
但现有 operation schema 没有持久化 hash-specific human review record。Owner 明确确认 promotion packet 的五个
exact hash 后，状态可转为 **Accepted with limitations**；在此之前不得宣称 Gate 6 的人审部分通过。

本次真实升级还验证了一个不能由静态评审替代的交错场景：Better active generation 先出现 member drift，上游 main
同时前进到 13-member revision；系统先拒绝 direct successor，再 repair old generation，最后应用 reviewed latest
candidate。升级后发现的 preserved-collision 代际摘要误报已在 `e680b8d` 修复，85/85 managed suite 与 live status
共同关闭该 P1。

无论 Owner 是否采纳，以下边界不改变：Codex/Claude 目前只到 `CATALOG_ONLY`，Cursor probe 为 `BLOCKED`；
body、route、context pressure 均未被宿主证据证明；外部 `npx skills` v3 receipt 仍不含 immutable revision；
cleanup review 没有具体清理授权；物理嵌套节省 context 仍未验证。
