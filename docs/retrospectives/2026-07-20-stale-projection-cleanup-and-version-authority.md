# 旧投影漏清理与上游版本权威复盘

- **Date:** 2026-07-20
- **Scope:** `/Users/whatsup/.agents/skills` 及全部 fresh-discovered `~/.<agent>/skills`
- **Evidence:** cleanup review/plan/quarantine records、managed collection artifacts、fresh collection status
- **Decision:** 漏清理是控制面闭环缺陷，不是单个目录疏忽；版本必须由 immutable upstream artifact 声明

## 结论

前一轮把 collection 的新物理内容部署正确，却没有完成“所有实际 Agent roots 的旧投影 disposition”。根因是 scanner、collection planner、native mutation authorization 各自维护了不同的 Agent-root 列表；同时 `preserve` 将“跨仓库名称冲突”和“同仓库已退役 broken projection”合并成一种状态。仓库实现与全局已安装 controller 又发生版本差异，导致 repo 内已修正并不等于本机所有 Agent 会使用修正版。

本轮修复将这些问题变成同一条可执行链：fresh dynamic root discovery → repository-qualified collision classification → review-fingerprint-bound exact path selector → durable batch plan → recoverable quarantine → one fresh post-scan → same-revision collection reconciliation。任何一步缺失都不能称为完成清理。

## 1. 现场事实

修正 scanner 后共发现 27 个实际 Agent skill roots。第一份 fresh review 暴露 538 条 broken projections：

- 37 条属于 Better-Skills 旧无前缀名称，分布在 13 个此前未完整纳入审核闭环的 roots；
- 501 条属于更早已移除的 Lark、TopBrains、Skywork、gstack、Superpowers 等 canonical Skills 的残留投影；
- 这些对象全部是指向不存在 canonical path 的 symlink，没有真实 Skill bytes；
- LangCraft `langcraft/prose-craft` 与 Better-Skills `better-skills/bs-prose-craft` 是两个真实、不同、继续保留的实体。

37 条 Better historical projections 使用 plan `sha256:03f5ac0e62405e870940a565827e8befc850d643e094e19aa3e5e872e9dd2970` 独立隔离，batch `sha256:3cb0ba01835f16163cbaf25b9d1816ed15a2949143878c568e52a687292ba100` 为 37/37 `COMMITTED`。其后 Better-Skills 和 LangCraft 分别以原 upstream commit 重新生成 current generation，collision 与 management attention 均归零。

剩余 501 条使用另一份 review 和 parent plan `sha256:249987c83776d7da0630788803a0db4ab72e6bc9277ff12757744af28745f181`，避免把不同来源、不同审核时点的 disposition 混成一批。最终 batch identity 与 post-scan 结果记录在本文件第 7 节。

## 2. 为什么会漏清理

### A. Root discovery 不是共享事实

旧 scanner 只遍历固定列表，但 installer 和 managed collection 已向更多 `~/.<agent>/skills` roots 发布。Collection status 能看到部分新 roots，cleanup review 却看不到，形成“新 collection 绿、旧链接仍在”的假完成。

**控制改进：** scanner 以保守静态列表为基线，再 fresh-discover home 下 exact `~/.<agent>/skills` 形态并去重；JavaScript adapter 与 native C helper 使用同一形态约束，并保留 no-follow、owner 与 immediate-child 检查。动态发现不是放宽到任意项目目录。

### B. `preserve` 缺少关系语义

为了避免错误删除 LangCraft/Better-Skills 同名实体，早期实现把所有不确定平面路径都 preserve。这个安全默认是对的，但 status 没有区分：

1. `other_repository_name`：跨仓库同名，必须保持 preserve；
2. `same_repository_name + missing target`：同仓库历史 projection，可进入显式 cleanup disposition。

**控制改进：** 后者报告 `STALE_SAME_REPOSITORY_PROJECTION`，前者继续是 collision / `BROKEN_PRESERVED_SYMLINK`。分类只生成审核候选，不自动授权删除。

### C. Repo green 被误当成 deployed green

全局 `skill-hygiene` / `skills-refiner` 一度与仓库实现不一致。直接使用仓库 launcher 可以完成一次操作，但不能证明后续 Agent 调用的全局 Skill 已更新。

**控制改进：** acceptance 增加 repository bytes 与 installed bytes 的 exact comparison、全局 launcher smoke test 和 fresh host loadability gate。发布闭环必须单独报告，不能藏在代码测试结果里。

### D. 大批次的人工 JSON 流程诱发低效与误操作

把 1,000+ candidate review 输出到对话或命令行，再手写每个 decision，既占 context 又容易漏项。一次误用 `npx skills add <local> --help` 还证明 mutation CLI 的 help 位置不能靠猜。

**控制改进：** `cleanup review/plan --output` 使用 exclusive、owner-only file 写入并只返回 digest receipt；`cleanup plan --retire-paths` 只接受 exact absolute paths、review fingerprint、唯一集合与 eligible installed/distributed candidates，其余全部默认 `later`。已有 output file 绝不覆盖或误删。

### E. 陈旧 batch lease 让零 mutation 计划永久阻塞

现场存在一份旧 batch：batch `READY/sequence=0`、所有 item `NOT_STARTED`、transaction `PLANNED/sequence=0`，owner PID 已不存在，且没有 mutation evidence。旧 status 先看到 source path 后续消失便返回 recovery，而没有机会隔离 stale lease。

**控制改进：** 只有完整满足“从未启动”的可证明状态才允许隔离 stale lock；任何 mutation truth、durable phase 或 outcome 都继续 fail closed 为 recovery。旧 record 保留，不伪造 commit/abort。

### F. 大计划超过 native helper 契约，却在 durable header 之后才失败

501 项 plan 的 JSON 为 1,334,667 bytes，超过 native helper 的 1 MiB 输入上限。旧流程先初始化 durable batch header，再为每个 transaction 复制整份 parent plan；第一项 transaction 尚未开始就被 helper 拒绝，留下 `READY/sequence=0`、501 项全部 `NOT_STARTED` 的失败审计记录。与此同时，每一项提交后重新验证完整 batch，形成不必要的 O(n²) 成本。

**控制改进：** executable plan 上限固定为 8 项，并在任何 batch/transaction durable write 之前计算 native helper 的精确请求 bytes；超限直接 fail closed 且零落盘。大审核集合通过确定性 partition 生成 content-addressed child plans 与 manifest，按序执行、首次失败停止。每项仍使用独立 transaction/undo identity，partition 不削弱恢复边界。旧超大 plan 可离线重分片，无需重新扫描或改写原 plan。

## 3. 版本为什么不是本地定义

版本证据直接来自每个 approved immutable artifact：

| Collection | Upstream field | Observed value | Rule |
|---|---|---|---|
| ProdCraft | `manifest.yml` root `version` | `1.0.0` | `yaml_root_version` |
| LoopOS | `pyproject.toml` `[project].version` | `0.2.1` | `pep621_project_version` |
| Better-Skills | `skills.json` root `version` | `0.2.0-dev` | `json_root_version` |
| LangCraft | no selected upstream declaration | `not_declared` | none |

Status 同时返回 source path、source digest 和 extraction rule。Controller 的 `schema_version`、plan generation、operation suffix 与迁移日期都不能作为第三方版本。上游未声明就保持 `not_declared`，exact commit 是可复现内容身份，但不伪装成 semantic version。

## 4. 不采用的方案

- **按 basename 批量 unlink：** 无 repository identity，会再次伤害跨仓库同名实体；不可恢复。
- **让 collection apply 自动清理 preserved collisions：** 把 deployment 与用户 disposition 混成一个权限边界。
- **直接编辑 `.skill-lock.json`：** receipt 是第三方 installer history，不是实际 filesystem 或本机 desired-state writer。
- **给 LangCraft 自定义 `0.x`：** 没有上游字段支持，属于编造。
- **为追求速度取消逐项 transaction：** 501 个链接仍需要独立 undo identity；性能优化只能复用 scan/review，不得删除 durable evidence。
- **简单提高 native helper 输入上限：** 会掩盖整份 parent plan 被重复复制和 O(n²) 验证问题，也扩大单批故障域；不采用。

## 5. 新增验收门禁

1. 新出现的 `~/.qoder/skills` 类 root 同时被 scanner 发现并被 native helper 精确授权；相邻或更深路径仍拒绝。
2. 同仓库 stale projection 与跨仓库 collision 得到不同 status code。
3. `retire-paths` 的 wrong fingerprint、重复/相对/未审核路径全部 fail closed。
4. `--output` 为 mode `0600`、exclusive create；目标已存在时 bytes 保持不变。
5. 上游版本字段缺失、格式错误或 source 不是 regular file 时 qualification fail closed；明确无版本的 profile 返回 `not_declared`。
6. stale batch 只有零 mutation 完整证据才释放 lease。
7. oversized plan 必须在 durable batch 初始化之前失败；partition child 每份最多 8 项、hash 可复算、顺序由 manifest 固定。
8. 清理后重新生成同一 immutable revision 的 collection generation，collision/attention 必须为 0。
9. fresh scan 的 broken symlink 必须为 0；所有真实 managed collection members 必须继续通过 loader/frontmatter/reference gates。

## 6. 软件工程结论

这次 bug 的本质是 **truth surface 不一致**：同一个“全局 Skills 目录”被三个模块用三个列表解释。修复重点不是增加更多 if，而是让 discovery、authorization、classification、disposition 与 reconciliation 的输入和证据可追踪地衔接。

第二个结论是 **安全默认与完成语义必须分开**。`preserve` 避免误删，是默认决策；但若系统不能把已证明的同仓库 stale projection 提升为显式、可撤销的待办，它就会把安全性变成永久垃圾。正确机制是 preserve-by-default、classify-with-evidence、mutate-only-after-disposition。

## 7. 最终结果

**PASS。** 501-item parent plan 的首次 apply 在任何 transaction 开始前因 native input capacity 失败；零 mutation batch `sha256:b2a85d2f5e7524d06c2eb0de91430c1632d600a17524fb08a1483dfe42189a76` 作为审计记录保留。随后：

- compatibility child batch `sha256:c49b5a0129f22c2f7a62c63747f8fde835f1ea28017b6380399715cfebc34684`：64/64 `COMMITTED`；
- 其余 437 项：55 个确定性 child batches，55/55 `committed`，每批最多 8 项；result receipt digest `sha256:cd9d35d81ded964d2c687e8e7844338f2c2c9c8e8b0e8013bcbe0bed4d6af420`；
- 加上独立的 Better historical batch，538/538 broken projections 全部进入 recoverable quarantine，没有永久删除。

Fresh post-cleanup review fingerprint 为 `sha256:94dd99ece7d773586c2a7df43b083be8b74a766f0ea8ee0fbd1f17751733d6e8`：27 个实际 Agent roots、`broken_symlink_count=0`、`eligible_count=0`。`collection list --fresh` 再次确认 ProdCraft、LoopOS、Better Skills、LangCraft 均为 `FILESYSTEM_READY`；三组 managed collections 的 `issues=[]`、`name_collisions=[]`、`management_attention=[]`。Better `bs-prose-craft` 与 LangCraft `prose-craft` 均存在于各自物理 collection，未发生跨仓库代替或清退。

回归门禁：collection controller 90/90、cleanup contract/core/native/transaction 104/104、cleanup CLI 284/284、scanner 101/101，全部 PASS。版本证据由 active immutable artifact 原文件与 digest 直接复核；未向任何 installed `SKILL.md` 写入自定义版本。

全局 controller 最终从 repository commit `ed00ede64b53c5292c070ecbc7d1436bea472bbb` 发布，`skill-hygiene` / `skills-refiner` installed trees 与 repository skill trees byte-exact；installed launcher、fresh collection list、scanner 均通过，`.skill-lock.json` 未被改写。仓库实现完成与全局部署完成因此有各自独立证据，不再互相替代。
