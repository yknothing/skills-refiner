# 全局 Agent Skills 治理：从“改了仓库”到“证明真实安装面”

- **Date:** 2026-08-28
- **Scope:** skills-refiner mechanism、ProdCraft/Better Skills/LoopOS/LangCraft live collections、global installed surface、runtime evidence
- **Implementation baseline:** `0d2b853..e680b8d`
- **Review level:** L2 Agent-separated

## 结论

任务拖长的根因不是移动目录，而是早期没有把交付契约锁定为同一个垂直闭环：**机制代码、真实
`$HOME/.agents/skills`、immutable upstream/version、Agent 当前发现、可恢复性与验收必须同时成立。**

早期曾轮流把 repo green、设计正确、目录已变化当作阶段完成，因此用户才会反复看到旧 ProdCraft、怀疑版本
来源、指出 Better/LangCraft 同名误判。后续的高价值工作，是把这些纠正固化成 controller、scanner、runtime
evidence、Panorama 与 fail-closed tests，而不是继续靠人工记忆。

## 1. 为什么执行低效

### 1.1 把 authoring tree 与 live root 混成一个 surface

仓库 `skills/` 的改动不会自动改变全局 `$HOME/.agents/skills`。早期缺少 installed-payload diff、fresh status 和
native catalog 验收，导致“仓库完成”与用户实际看到的目录脱节。

**沉淀：** 每次开工先写死 authoring repo、upstream candidate、live installed root、controller root、runtime
discovery roots；每条结论标注它属于哪一层。

### 1.2 横向铺机制，垂直切片太晚

索引、receipt、cleanup、runtime、Panorama 同时展开，ProdCraft 的真实物理升级却没有最先闭环。抽象越多，简单
可见错误越晚暴露。

**沉淀：** 先完成一个 collection 的 resolve → exact-object materialize → plan → apply → fresh status → rollback/
recover → native probe，再推广通用控制器。

### 1.3 名称被误当成身份和删除授权

Better Skills 的旧 `prose-craft` 与 LangCraft 的 `prose-craft` 是不同仓库、不同内容。名字冲突需要报告，但不等于
其中一个应该被清退。

**沉淀：** identity 至少绑定 repository、revision、source path、declared name、tree digest、canonical path；
跨仓同名默认 `preserve + collision`，只有 exact qualified disposition 才可进入 mutation plan。

### 1.4 版本与安装历史混为一谈

controller schema、plan generation、installer receipt 与 upstream release 曾出现在同一视图却没有标明 authority，
容易让人误以为 `1.0.0`、`0.2.0-dev`、`0.2.1` 是本地定义。

**沉淀：** 上游版本只能来自 immutable artifact manifest；LangCraft 未声明就输出 `not_declared`。receipt 的
`installedAt/updatedAt` 固定标为 `installer_declared`，不包装成独立验证的安装事件。

### 1.5 cleanup 从一开始没有足够明确地 fail closed

历史 receipt、broken projection、旧 alias 与真正的 active entity 混在一起时，“看起来旧”很容易被误当成
“允许删除”。漏清和误清表面相反，根因都是缺少 identity-bound disposition。

**沉淀：** scan 只发现；cleanup review 只分组；Owner selected decision 才授权；executable plan 再绑定 current
identity/precondition。本轮 0 selected、plan `null`，所以没有清理任何未获授权实体。

### 1.6 runtime truth 成为一等公民太晚

嵌套目录可能仍被宿主递归发现，catalog、body、route、context 又是不同能力。没有 native probe 时，
`FILESYSTEM_READY` 和“节省 context”都不能代表真实运行结果。

**沉淀：** filesystem、deployment、catalog、body、route、context 正交报告。`CATALOG_ONLY` 是事实状态，不是
不完整的“通过”。

### 1.7 第三方 CLI 的副作用边界判断不严

一次把 `npx skills ... --help` 当纯帮助命令，实际产生了本地安装副作用。意外产物随后被隔离，没有混进全局
治理事实，但暴露了命令审计缺口。

**沉淀：** 第三方 CLI 先在隔离临时目录运行；显式 target；pre/post inventory；不把 `--help` 自动视为只读。

## 2. 本轮真实运行额外发现了什么

### 2.1 历史 recovery compatibility false drift

当前 plan.v3 新增 `predecessor_digest` 等恢复证据后，初版实现把新要求回套到历史 plan.v1/v2，导致一个真实、
健康的旧 ProdCraft generation 被错误报告为 drift。

**根因：** compatibility tests 只覆盖“旧 schema 能解析”，没有覆盖“真实历史落盘形态能通过 fresh status 并作为
successor predecessor”。

**修复：** 当前 v3 严格验证；只有 literal allowlist 中的历史 v1/v2 缺失字段可兼容。未来 v4 不会自动继承
放宽。真实旧 generation 先恢复为 `FILESYSTEM_READY`，随后再升级到当前 successor。完整 ProdCraft suite 87/87。

### 2.2 exact revision 不等于可信上游来源

本地仓库可以存在未 push commit。只把 40 位 SHA 写进 plan 仍可能把本地工作冒充上游。

**修复：** candidate 必须被本地 approved origin-tracking refs 包含，并从 exact Git object 物化；未 push commit
负例失败。边界仍然明确：这是 local origin containment，不是在线远端实时或签名证明。

### 2.3 “统一管理中心”缺了逐 Skill lifecycle

旧 Panorama 只在四个 collection 聚合层展示 lifecycle；receipt-bound 直接安装项没有逐 identity 的来源、版本、
安装/更新时间视图。它能盘点，却还不能真正“一目了然”管理。

**修复原则：** scanner 只输出 receipt snapshot 中的 installer-declared timestamps；Panorama 复用 scanner 和
collection status，不直接另读 lock file。source-qualified revision、artifact version、controller activation、
receipt-bound timestamp 分别标注 authority；同名 variants 不压扁成一个记录。

### 2.4 derived latest 会在外部 config 变化后立刻过期

最终归档前 fresh `runtime status` 捕获到 Codex config 已变化，旧 Codex evidence 变为 `STALE`，而旧 Panorama
仍引用先前 evidence id。如果只看 `latest.json` 就会报告过期结论。

**修复流程：** fresh status 是 promotion 前置；发现 stale 后重新 native probe/record，再重建 Panorama。任何
collection、policy、runtime config、executable 或 discovery-root 变化都必须使对应 evidence 失效。

### 2.5 exact plan hash 的机器门禁不等于人审留痕

apply 函数严格要求 `--confirm` 等于 full `plan_hash`，operation 也绑定该 hash；但当前 operation schema 没有
独立记录 reviewer、decision 和 review time。

**沉淀：** 技术上说“exact-hash gate passed”，治理上仍需 promotion packet 绑定 Owner decision。不能从 operation
存在反推出用户看过 hash。

### 2.6 上游前进与本地 drift 会在真实升级中相交

Better active generation 已出现 `MEMBER_DRIFT:bs-reflect-loop`，与此同时远端 main 前进到新增第 13 个 member 的
revision。若直接用 latest 覆盖，既会吞掉未知本地字节，也会让 successor quarantine 的语义不再可信。

**修复流程：** direct successor 必须因 `predecessor_drift` 零 mutation 失败；先对 old generation 建立独立
repair attempt，把实际 pre-state identity-bound quarantine，再重新编译 successor。repair quarantine 与 successor
predecessor quarantine 同时保留。这个两阶段流程比“升级顺便修复”多一步，但把用户数据、旧批准状态和新候选
三个 authority 分开了。

### 2.7 碰撞 identity 中存在 generation-derived 字段

Better 升级成功后，13 个 Claude symlink 的路径和目标 identity 都没有变化；只有 `bs-reflect-loop` 的目标摘要
随 successor 合法变化。旧比较器要求整个 13-entry set byte-for-byte 不变，因此这一个合法差异产生
`PRESERVED_COLLISION_SET_CHANGED` aggregate 假阳性。

**修复：** 只在其他 collision 字段完全一致、目标精确是当前已验证 member 根、INDEX/tree/mode/digest 全部通过时
归一化 target digest。retarget、external target、member descendant 和 member drift 都保留负例。85/85 suite 与
live `FILESYSTEM_READY / OBSERVED / management_attention=[]` 共同验收，不能只靠测试 fixture。

### 2.8 归档必须有稳定切面，而不是不断移动的 latest

最终重装 controller 后重新编译 runtime profile，exact plan 返回 `mutation_required=false`，active operation 保持
不变；仍重新采集 Codex/Claude/Cursor evidence 并重建 Panorama。随后再次查询四个远端 main，确认它们在
2026-08-28T17:08:33Z 仍等于 active revision。

**沉淀：** “latest”只能作为带观察时间的候选事实；归档切面由 active generation + no-op revalidation + fresh
evidence + point-in-time remote comparison 组成。任何一个随后变化都应产生新一轮审查，而不是改写历史结论。

## 3. 固化后的标准工作流

1. **Evidence lock**：记录 live root、receipt、controller、projections、runtime config、上游 remote/revision；
2. **Resolve candidate**：校验 origin containment，读取 exact Git object 与真实上游版本；
3. **One vertical slice**：先完成一个 collection 的 plan/apply/status/undo 或 recover proof；
4. **Drift gate**：active drift 时先 repair/quarantine old generation，再重新规划 successor；
5. **Qualified migration**：按 repository-qualified identity 迁移，跨仓同名默认 preserve；
6. **Installed-surface verification**：直接在 `$HOME/.agents/skills` scan、payload diff、doctor；
7. **Runtime profile**：只修改 policy-owned config/projection，外部条目 preserve/block；
8. **Fresh native probe**：分别记录 catalog/body/route/context，旧会话不复用；
9. **Cleanup review**：Owner 逐 identity 选择后才编译 executable plan；
10. **Panorama reconciliation**：最后生成派生视图，并再次确认 evidence 未 stale；
11. **Adversarial promotion**：攻击 authority、history schema、race/recovery、identity、隐私与 claims；
12. **Owner hash decision**：把 exact plan hashes 与 scope/exclusions 绑定；
13. **Clean batches**：机制、实机 hardening、ADR/验收分别 commit/push。

## 4. Definition of done

- physical root 是用户指定的真实全局目录；
- active collection 与 immutable revision/tree 一致，candidate 有 local origin containment；
- upstream version 有 artifact manifest 或明确 `not_declared`；
- old aliases 与未知实体有逐 identity disposition，跨仓同名不误删；
- receipt/tree 可调和，缺 revision 不补造，时间只称 installer-declared；
- repository 与 installed payload 直接比较；
- frontmatter、description budget、references、static runtime contract 完成；
- native runtime 各层独立报告，stale/unknown/blocker 不染绿；
- cleanup 只有 exact decision + exact plan 才执行；
- rollback/recover 覆盖当前与历史支持 schema；
- L2 评审等级、P0/P1 与 contamination 如实记录；
- exact hashes 获得可审计 Owner decision；
- docs、commit、push 完成，用户自有未跟踪文件保持原样。

## 5. 当前仍需保留的边界

- Codex/Claude 只证明 catalog；body、route、context 未验证；
- Cursor 当前 `not_logged_in`/probe timeout，保持 `BLOCKED`；
- `npx skills` v3 receipt 不含 immutable revision，通用 wrapper/adoption transaction 尚未实现；
- physical indexing 的管理收益已验证，context token reduction 未验证；
- local origin containment 不是在线远端或签名证明；
- collection controller 是 current-view recovery evidence，不是 WAL；整棵 active collection 丢失不会自动重建；
- active successor status 不遍历全部历史 predecessor repair quarantine；当前 repair/undo 链可验证，长期 history audit
  仍是后续项；
- Panorama 顶层 summary 尚未聚合 collection `management_attention`，详细 collection rows 才是当前权威视图；
- Better exact artifact 本机可按 digest 复核，但另一个当前 checkout 不保留该 revision object；若需要离线跨机重放，
  应归档 Git bundle/object store；
- 本机 evidence 不是宿主签名的防恶意篡改证明；
- L3/L4 或外部认证未执行。
