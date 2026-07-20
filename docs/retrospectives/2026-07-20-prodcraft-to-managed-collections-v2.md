# 从 ProdCraft 一次性迁移到 Managed Collections V2

- **Date:** 2026-07-20
- **Scope:** architecture, controller implementation, live filesystem migration, verification discipline
- **Evidence boundary:** repository commits `8af4c40..d7a2509`、ProdCraft live operation `prodcraft-de2875ed9630`、本轮三组 read-only inventory 与 upstream-pinned fixtures
- **Review level:** L2 Agent-separated；不是外部或多模型独立验证

## 结论

ProdCraft 迁移达成了真正的物理 cutover、可恢复事务和直接状态核验，但它也把 V1 的最大问题暴露得非常清楚：**可靠的一次性垂直切片，不等于可复用的 Skills 管理机制。**

本轮沉淀不是再写一份“经验总结”，而是把经验转换为 V2 的 schema、声明式 specs、catalog reconciliation、故障门禁和三组真实迁移计划。没有进入代码、测试或状态语义的教训，不算完成沉淀。

## 1. 上一轮实际发生了什么

### 做对的部分

1. 没有把 `.skill-lock.json` 当 desired state writer；迁移前后保持其 bytes 不变，并把 source receipts 降级为历史证据。
2. 46→40 不是机械 rename，而是 plan-bound disposition；旧实体与 585 个投影进入 quarantine 和独立 recovery。
3. 使用 exact plan hash 与 operation id 双重确认；apply、repair、recover、undo 都重新观察 filesystem。
4. 故障验证不是单一 happy path：5 个 durable phases、projection/legacy partial loop SIGKILL、corrupt/missing quarantine recovery 均被实际演练。
5. 最终 acceptance 明确停在 filesystem：真实 Agent routing、recursive discovery 与 context reduction 没有被绿色静态检查冒充。

### 真实失败与修正

| 事件 | 暴露的问题 | 最终处理 |
|---|---|---|
| v3 在 mutation 前因 recovery copy mismatch 停止 | macOS 会重写 `com.apple.provenance`；“全部 xattr byte-identical”不是可移植身份 | portable security digest 排除这一项 OS telemetry，继续绑定 mode/uid/gid/flags/ACL/稳定 xattrs，并加真实 provenance regression |
| v4 apply 后 `.DS_Store` 导致 DRIFTED | observer 把宿主 metadata 与业务漂移混为一谈 | 只忽略 collection root `.DS_Store`；任意其他 unknown entry 仍 DRIFTED；v4 exact undo 后重做 v5 |
| 全局 `skill-hygiene` 与仓库实现不同 | 本地 repo green 不等于 installed control plane 已发布 | live 操作明确使用仓库 launcher；未伪造 `npx skills add <local>` provenance receipt |
| controller bundle 绑定 CLI/contract | 任何 observer 增强都可能把 unchanged ProdCraft 误报为 drift | V1 status 将 historical mutation identity 与 current observer compatibility 分离；V1 plan/schema 不被 V2 重释 |
| LangCraft 首次 live apply 在 postcondition 回滚 | `prose-craft` 被按字符串误判为本 collection 的待清退投影；同名不等于同一实体 | 自动回滚成功；ownership 改为 qualified identity，跨仓库/历史同名路径默认 preserve，并增加真实交叉仓库回归 |

## 2. 五个根因

### 根因 A：把 vertical slice 的业务常量留在 transaction core

ProdCraft V1 同时写死 repository、member set、legacy count、disposition、gateway、paths 与 operation ID。这样做让第一版更容易 fail closed，但也意味着复制代码是唯一“扩展”方式。

**沉淀：** V2 用 `CollectionSpec` 表达 repository、members、manifest、shared resources、preserved historical names 和 exposure；transaction engine 只处理 plan-bound qualified identities。

### 根因 B：receipt history、active filesystem 与 candidate set 没有一等分离

ProdCraft 正好有 46 条 receipt 和 46 个 active entities，掩盖了数据模型缺陷。Better Skills 直接打破这个假设：15 条同源 receipts 同时包含两代名称，旧 7 个实体已不存在，但 broken projections 仍存在。

**沉淀：** V2 从 fresh filesystem 选择 active migration payload；receipt 只提供 source/timestamp/hash claim；candidate 由 immutable upstream spec 决定。历史别名与跨仓库同名路径进入只读 collision observation，未经显式用户 disposition 不进入 mutation plan。

### 根因 C：per-collection active record 被误当成完整管理中心

如果整个 `~/.agents/skill-control/collections/<id>` 被删，V1 只能返回 `UNMANAGED`，无法区分“从未管理”与“管理记录丢失但部署仍在”。

**沉淀：** V2 把 current-generation catalog 与 recovery plan 放到 `~/Library/Application Support/skills-refiner/`；status 从 catalog、control、recovery 与 physical deployment 交叉派生 `ORPHANED_CONTROL` / `ORPHANED_CATALOG`。

### 根因 D：一个 gateway topology 被错误外推为通用 topology

ProdCraft 的 container `prodcraft` 与 gateway `pc-prodcraft` 不同名。LoopOS/LangCraft 的 gateway 与 collection id 同名；Better Skills 根本没有 upstream gateway。

**沉淀：** V2 明确 `gateway_projection` 与 `collection_projection`。不得生成 synthetic gateway，也不得通过改 frontmatter 回避同名冲突。

### 根因 E：把平面名称误当成了跨仓库实体主键

首次 LangCraft live apply 暴露：Better Skills receipt/projection 中的 `prose-craft` 与 LangCraft upstream 的 `prose-craft` 同名，但没有 replacement 关系。合成 fixture 只覆盖单仓库所有权，导致 postcondition 才发现这些路径。

**沉淀：** identity 至少绑定 repository、revision、source path 与 declared name。Collection 内允许同名实体物理共存；平面 locator 冲突只报告为 `preserve`，除非用户给出明确 disposition。Receipt scope 仍用于竞争写检测，但不能单独授权删除。

## 3. 本轮三组 evidence lock

| Collection | Receipt history | Current active | Projection facts | Reviewed upstream |
|---|---:|---:|---:|---|
| LoopOS | 10 | 10 | 160 symlinks / 16 roots | `f4454019414143e976edac5a250eca58d92ed12d` / 10 members |
| LangCraft | 5 | 5 | 60 symlinks / 12 roots；Gemini 5 条直连 upstream workspace | `fa31c4b85a7400c53abee3bd19c278395a0df3fa` / 6 members |
| Better Skills | 15（8 `bs-*` + 7 old aliases） | 8 | 77 managed alias/member symlinks / 15 roots | `8e8d2af4c5cb2099e27fdea9c723befe91701593` / 8 qualified members；1 rejected member |

重要冲突：

- LoopOS 本机 installed bytes 与 reviewed commit 的 skill trees 一致，但现有 workspace worktree dirty，因此使用隔离 clean clone，不用 workspace 作为 source。
- LangCraft installed router 有本地 `../bs-prose-craft` overlay；reviewed upstream 已带自己的 `prose-craft`，V2 以完整 upstream collection 替换 overlay，避免跨 collection 相对路径逃逸。
- Better Skills installed `bs-skill-bootstrap` 在扁平安装态有一个缺失 `../../docs/patterns/README.md`；初稿只绑定 `docs/patterns` 又漏掉该 resource 自己声明的 `docs/research`、`tools/check-patterns.sh`、`skills.json`。最终 profile 绑定四项输入，并从 members 与 shared resources 双向重跑 reference closure；四个明确的 authoring-example 文档 exclusion 写入 spec，不靠静默忽略全部缺链。
- Upstream `bs-visual-design` 的 plain-scalar description 含未引号 `Deep-tier: `，严格 YAML 无法解析。Controller 不修改 artifact bytes，而是在 portable-YAML gate 拒绝该 member；active selection 为同一 immutable commit 的 8-member reviewed profile，旧 9-member generation 仍保留 exact predecessor/recovery 解释。

## 4. 对抗性异议如何改变实现

| 异议 | 处理类型 | 实现/门禁 |
|---|---|---|
| V1 hard-coded，禁止直接复制 | scope removed + runnable gate | schema V2 + declarative specs；V1 分派保留 |
| controller upgrade 会误报 ProdCraft drift | test/gate added | live V1 status must remain `FILESYSTEM_READY` |
| control root 删除会变成假 `UNMANAGED` | architecture revision | external catalog + recovery plan + orphan status test |
| 同名 flat path 被误归属于当前 collection | ownership revision + test | qualified identity；`name_collisions[].disposition=preserve`；真实 LangCraft/Better Skills cross-repository fixture |
| 外仓库同名真实全局目录仍阻断计划 | ownership revision + test | 非 required publication path 的 foreign/unqualified directory 进入 preserve snapshot，不进 mutation；真实目录 fixture apply/undo |
| collision 只在 status 临时生成 | schema revision | plan.v3 将 raw/resolved target、health/digest、receipt claim 与 disposition 纳入 plan hash，apply 前重新观察 |
| broken historical locator 被 READY 隐藏 | truth-surface revision | `name_collision_status` + `management_attention`；不把 unowned locator 混入 collection drift，也不自动“修复” |
| 宽松 parser 接受非法 portable YAML | loader gate + selection revision | invalid member rejected，禁止 silent artifact patch；旧 member profile 仅用于 generation compatibility |
| shared resource 自身缺链 | packaging revision + gate | directories/files 都是一等 resource；closure 扫描 resource Markdown；四项 exact packaging inputs |
| nested `.DS_Store` 造成 apply 后假 drift | observer policy + regression | deployment member/resource digest 递归忽略 exact `.DS_Store`；source/artifact/recovery exact；任意其他 unknown file 仍 drift |
| receipts 40/64 hash 与历史 tombstone 混杂 | data model revision | opaque receipt hash；active/history/candidate/disposition 分离 |
| gateway/container 同名、Better 无 gateway | owner topology decision | gateway vs collection exposure profiles |
| nesting 不等于 context reduction | claim scope removed | runtime/context 保持 `UNVERIFIED` |
| management center 缺统一总览 | implementation added with limitation | `collection list --fresh` + external current-generation catalog；append-only event chain deferred |
| “首次迁移成功”等同于“支持更新” | architecture veto + generation test | predecessor-bound generation replacement；second revision apply/status/undo；upgrade SIGKILL recovery |
| status 只重放 plan-time roots | observer revision | fresh 枚举新增 collection exposure；同名平面路径独立报告且默认 preserve |
| catalog 丢失时 repair 假绿 | acceptance revision | repair 以 full reconciled status 为前后置；缺失 catalog 从全部 committed active controls 重建 |
| lock 竞争制造 phantom operation | transaction ordering fix | mutation lease 先于 operation publication；零 mutation 无 pending record |

## 5. 哪些教训没有被过度泛化

1. `.DS_Store` 例外只作用于 collection root；不引入通用“隐藏文件忽略”。
2. `com.apple.provenance` 只从 portable security digest 中排除；不取消其他 xattr/ACL/flags 检查。
3. Better shared resources 是 versioned packaging inputs；只复制 `docs/patterns`、`docs/research`、`tools/check-patterns.sh` 与 `skills.json`，不允许 controller 任意把 repository 根复制进 active discovery surface。
4. LangCraft local overlay 被 upstream coherent set 取代；不建立永久跨 collection compatibility symlink。
5. Catalog 目前只承诺 current-generation reconciliation，不冒充 append-only tamper-evident ledger。

## 6. 反共识检查

最危险的三个错误共识：

1. **“目录已经嵌套，所以 context 已降低。”** 真实 loader 可能递归发现所有 nested Skills；没有 fresh-session evidence 时该结论被禁止。
2. **“上游最新就是最优版本。”** 本次只批准三个 exact commits；下一次 main 变化重新成为 candidate。
3. **“有 catalog 就不会漂移。”** catalog 只保存 approved selection；status 仍必须直接观察 filesystem、receipt scope、projections、quarantine 和 recovery。

## 7. 后续硬边界

- 为每个参与 Agent/root 建立 fresh-session discovery/routing/cache qualification；在此之前不宣传 context reduction。
- 统一 cleanup 与 collection 的 global mutation lease，并加并发故障测试。
- 将 external catalog 演进为 append-only events + sealed head；在完成前不宣称 tamper-evident。
- 正式发布 skills-refiner immutable revision 后再更新全局 `skill-hygiene`，保持 installer provenance；仓库 launcher 只是本轮受审 controller，不是已发布安装事实。

## 8. 最终 live 结果

首次 LangCraft apply 因旧 basename 规则在 postcondition 失败并自动回滚为 `ROLLED_BACK`；旧 LangCraft bytes、投影和 receipt 均恢复。修正 qualified identity 后重新编译全部受影响 plan，最终 active generations 为：

| Collection | Operation | Physical root | Members | Collision disposition | Final status |
|---|---|---|---:|---|---|
| ProdCraft | `prodcraft-de2875ed9630` | `~/.agents/skills/prodcraft` | 40 | n/a | `FILESYSTEM_READY` |
| LoopOS | `loopos-68d42695ec42` | `~/.agents/skills/loopos` | 10 | 0 | `FILESYSTEM_READY` |
| Better Skills | `better-skills-30597d9f086e` | `~/.agents/skills/better-skills` | 8 | 37 preserved；broken target 显式 `ATTENTION_REQUIRED` | `FILESYSTEM_READY` |
| LangCraft | `langcraft-1c6ef7cb054d` | `~/.agents/skills/langcraft` | 6 | plan.v3 binds 10 `other_repository_name / preserve` for `prose-craft` | `FILESYSTEM_READY` |

`.skill-lock.json` 在全部迁移前后保持 SHA-256 `193a3540064e00a9b0b20444ba9a75b6d81ba18c38619508c80a8db300597900`。这证明 controller 没有冒充第三方 installer writer；它不证明外部 installer 将来不会改写 receipt 或 flat projections。

最终同名处置边界是：Better Skills 的 `bs-prose-craft` 与 LangCraft 的 `prose-craft` 都保留在各自 repository-qualified collection 中。历史 flat `prose-craft` 只是冲突 locator；其 10 个 broken targets 被观察并报告，但本轮未删除、未重定向、未接管。用户关于“名称冲突不能替代清退授权”的纠正已从口头原则落到 plan schema、precondition、status 与真实目录回归。
