# Managed Collections V2 与三组全局 Skills 迁移验收

- **Date:** 2026-07-20
- **Scope:** repository implementation + `/Users/whatsup/.agents/skills` live filesystem
- **Controller:** repository launcher on Node `v24.4.1`
- **Decision:** Filesystem acceptance PASS；runtime/context claims 以本文件的独立边界为准
- **Review level:** L2 Agent-separated，非外部独立审计

## 1. 验收对象

| Collection | Content authority | Active operation | Plan hash | Members |
|---|---|---|---|---:|
| ProdCraft | `yknothing/prodcraft@fd05978dbbbf5a064205a695af47c8a550f1b224` | `prodcraft-de2875ed9630` | `sha256:de2875ed96300db11c1ce44f66784a44faadf85cbf5b15de28d06753c4961418` | 40 |
| LoopOS | `yknothing/loopos@f4454019414143e976edac5a250eca58d92ed12d` | `loopos-68d42695ec42` | `sha256:68d42695ec42fdea67392892c43a56edc4c72ba643e787b5c9b2f142ed732c8c` | 10 |
| Better Skills | `yknothing/better-skills@8e8d2af4c5cb2099e27fdea9c723befe91701593` | `better-skills-e5f86050663e` | `sha256:e5f86050663e4530de03158e95708581a59413655c7955eb2989498ee673d8a8` | 8 |
| LangCraft | `yknothing/langcraft@fa31c4b85a7400c53abee3bd19c278395a0df3fa` | `langcraft-bd83a590fea1` | `sha256:bd83a590fea1e78c4e4aa60ffad4c3c73ac61f266656ef4a5d5e7b70cb1642ed` | 6 |

四个 physical roots 均为 `~/.agents/skills/<collection>/` 下的真实目录，container 根没有 `SKILL.md`。LoopOS/LangCraft 的同名 gateway 位于第二层；Better Skills 没有 synthetic gateway。

## 2. Source 与 packaging gates

三组 managed source 均来自 clean Git clone、approved GitHub origin 和 exact 40-character HEAD。Controller `collection check` 对三组均返回 `STRUCTURALLY_VALID`；repository 自带门禁另行通过：

- LoopOS `scripts/check_release.py`：version `0.2.1`，10 Skills；
- LangCraft `scripts/validate-skills.py`：6 Skills，2 shared resources；
- Better Skills upstream：9/9 per-Skill validator，CLI tests 49/49，peer review 9/9，pattern alignment 0 fail；这些门禁未发现 `bs-visual-design` 的 invalid portable YAML，因此只作为补充证据，不能覆盖 controller loader gate。

Collection status 的版本字段直接从 immutable artifact 重建，不采用本地版本号。验收还对 active artifact 中的原始文件直接执行 `shasum -a 256`，所得 digest 与 status 一致：

| Collection | Result | Exact upstream field | Evidence digest |
|---|---|---|---|
| ProdCraft | `1.0.0` | `manifest.yml` root `version` | `sha256:4ea575142b7304d3bb049949f7dd4f7d20146665ff17bd7106a3a1f5d1d1b6fc` |
| LoopOS | `0.2.1` | `pyproject.toml` `[project].version` | `sha256:fd6389655b80b415f2d8b509ef6c4c605524bb2804c57a05609e71bdeba1eeb5` |
| Better Skills | `0.2.0-dev` | `skills.json` root `version` | `sha256:08a658afd0eb0582b511da8ea0da553a698c69e86d03ce53863b89a12dc02ba4` |
| LangCraft | `not_declared` | no selected upstream version field | n/a; exact commit remains `fa31c4b85a7400c53abee3bd19c278395a0df3fa` |

这里的 `skills-refiner.collection.status.v1/v2` 是 controller response schema，不是上游 Skill 版本。没有 `version` frontmatter 时也没有补写或生成版本。

Materialized installed surface 的 fresh-host loader preflight 直接读取 64 个 `SKILL.md`：

```text
ProdCraft 40 + LoopOS 10 + LangCraft 6 + Better Skills 8 = 64
name/description missing or mismatched: 0
portable YAML scalar blockers: 0
maximum description length: 765 characters (limit 1024)
Better local Markdown: 82 files / 310 edges / 0 errors
ProdCraft local Markdown: 166 files / 182 edges / 0 errors
LangCraft + LoopOS local reference errors: 0
```

Controller 没有注入、删除或改写 canary。`bs-visual-design` 上游 description 的 plain scalar 包含未引号 `Deep-tier: `，严格 YAML 解析失败；controller 未修改 GitHub artifact，而是通过 reviewed 8-member packaging profile 将该 member 从新 generation 排除。旧 9-member V2 generation 仍由 compatibility profile、predecessor quarantine 与 recovery plan exact 保留。

Better materialized resources 为 `docs/patterns`、`docs/research`、`tools/check-patterns.sh`、`skills.json`。Shared Markdown 的本地引用与 member 引用一起闭包；4 个明确的 authoring/example 文档由 spec 精确排除，不是通用 missing-link 豁免。

## 3. Qualified identity 与同名冲突

首次 LangCraft live apply 使用旧 basename 归属规则，将 Better Skills 历史 `prose-craft` 投影误当成本 collection 的 postcondition drift。Apply 自动回滚，operation `langcraft-eb42744eb6fd` 最终为 `ROLLED_BACK`，LangCraft 回到迁移前状态。

修正后的 identity 至少绑定 `(repository_id, resolved_revision, source_path, declared_name)`。两代 durable plans 必须分开解释：

| Collection / generation | Mutation payload | Preserved collision evidence |
|---|---|---|
| Better Skills V2 predecessor `better-skills-ca20b82e4151` | 8 legacy directories + 40 qualified `bs-*` projections | V2 尚未把 preserved snapshot 纳入 plan |
| Better Skills V3 predecessor `better-skills-30597d9f086e` | 8-member collection + 4 shared resources；`legacy=[]`、`projections=[]` | 37 historical flat projections，全部 `same_repository_name / preserve` |
| LangCraft V3 predecessor `langcraft-1c6ef7cb054d` | 6-member collection；`legacy=[]`、`projections=[]` | 10 `prose-craft` projections，全部 `other_repository_name / preserve` |
| Better Skills V3 current `better-skills-e5f86050663e` | same immutable artifact; collision snapshot reconciled after explicit cleanup | empty |
| LangCraft V3 current `langcraft-bd83a590fea1` | same immutable artifact; no cross-repository entity mutation | empty |

这些 preserved paths 不在 quarantine、recovery mutation payload 或删除集合内；LangCraft V3 upgrade 前后 10 个 `prose-craft` projections 的 `raw_target + mtime_ns` canonical digest 均为 `sha256:50c543935147c071a012d22bfa300fcfe9afa7106d2a11206c52fd3413db7329`。它们可以为 management UI 提供冲突证据，但不能自动授权 replacement、retirement 或 projection reassignment。Predecessor-owned gateway exposures 会作为 predecessor transaction state 处理，不得伪装为 `preserve` collision。

Plan.v3 进一步把 preserved collision snapshot 纳入 plan hash：`path/kind/raw_target/resolved_target/target_status/target_tree_digest/receipt_claim/relation/disposition`。Apply 前重新观察，snapshot 变化会得到 `installed_facts_drift`。真实 foreign `~/.agents/skills/prose-craft` directory fixture 已证明：LangCraft 能发布自己的 nested `langcraft/prose-craft`，foreign entity 保留在原位，不进入 legacy/projection/quarantine。

## 4. Transaction、upgrade 与 reconciliation gates

Collection controller 回归：90/90 PASS；cleanup contract/core/native/transaction：104/104 PASS；cleanup CLI：284/284 PASS；scanner：101/101 PASS（均使用适用的 repository launcher / nvm Node `v24.4.1`）。覆盖：

- initial apply/status/undo；
- same-name container/gateway topology；
- historical 9-member/1-resource V2 profile interpretation，以及动态 V2 → V3 → status → undo predecessor；
- exception rollback 的全部 8 phases；
- 全部 8 durable phases 的 real `SIGKILL` discovery/recovery；
- interrupted upgrade before/after catalog publication；
- linked Git worktree `.git` pointer；
- multi-collection catalog coexistence；
- catalog primary/view exactness 与 second-generation lifecycle exact reconstruction；
- missing member/shared resource repair；
- global lock contention 不生成 phantom operation；
- cross-repository same-name preserve regression。
- portable YAML rejection、旧 member/resource profile compatibility、shared-resource-origin reference closure；
- plan-bound preserved collision precondition、broken target attention；
- nested `.DS_Store` portable host-metadata policy，以及 arbitrary unknown entry drift。
- dynamically discovered `~/.<agent>/skills` roots across scanner, planner and native path authorization；
- strict upstream version extraction and `not_declared` semantics；
- exact review-bound retire-path selectors, exclusive owner-only artifacts and stale untouched-batch lease isolation；
- oversized plan 在 durable initialization 前拒绝，8-item child partition 的 hash/manifest/离线转换与逐批 transaction 语义。

ProdCraft V1 的 source/linked-worktree、apply/repair/SIGKILL/status gates 保持通过；最终 live status 仍为 `FILESYSTEM_READY`。

## 5. Live reconciliation result

修正 dynamic root discovery 后，fresh review 在 27 个实际 Agent roots 中发现 538 条 broken projections：37 条 Better historical aliases，以及 501 条更早已移除 canonical Skills 的残留投影。所有对象均为指向不存在 target 的 symlink，没有真实 Skill bytes。它们经 exact review/path disposition 和 recoverable quarantine 处理；其中 501 条由 1 个已提交的 64-item compatibility batch 加 55 个最多 8 项的 child batches 完成，child result receipt digest 为 `sha256:cd9d35d81ded964d2c687e8e7844338f2c2c9c8e8b0e8013bcbe0bed4d6af420`，55/55 batch、437/437 item 均为 `COMMITTED`。

Fresh post-cleanup review fingerprint `sha256:94dd99ece7d773586c2a7df43b083be8b74a766f0ea8ee0fbd1f17751733d6e8` 重新观察到 27 个 roots，`broken_symlink_count=0`、`eligible_count=0`。LangCraft 对 Better 同名实体始终只持有 cross-repository preserve evidence；两个 repository-qualified `prose-craft` 均保留。其后再使用各自**同一个 immutable upstream commit**生成 current generation。`collection list --fresh --json` 最终返回：

```text
prodcraft      FILESYSTEM_READY  issues=[]
loopos         FILESYSTEM_READY  issues=[]  name_collisions=0  attention=[]
better-skills  FILESYSTEM_READY  issues=[]  name_collisions=0  attention=[]
langcraft      FILESYSTEM_READY  issues=[]  name_collisions=0  attention=[]
```

迁移前后 `.skill-lock.json` SHA-256 均为：

```text
193a3540064e00a9b0b20444ba9a75b6d81ba18c38619508c80a8db300597900
```

因此 external receipt 是历史证据而非 controller writer。每个 active operation 均有独立 recovery plan/bytes 和 quarantine root；本轮不执行 recovery GC。37 个 same-repository historical locators 经过显式 path disposition 进入 cleanup quarantine，而不是由 collection apply 自动清退；LangCraft 与 Better Skills 的两个物理 `prose-craft` 仍分别存在于自己的 collection。

Better v3 apply 后约 5 秒，Finder 在 `bs-dev-flow` 写入 `.DS_Store`，第一次 fresh status 正确暴露 `MEMBER_DRIFT`。最终 observer 将 deployment member/resource content digest 的 portable metadata policy 精确限定为递归忽略 basename `.DS_Store`；source/artifact/predecessor/quarantine/recovery digest 仍 exact，新增任意 `.unexpected` 文件仍触发 `MEMBER_DRIFT`。未删除现场 `.DS_Store` 来制造绿灯。

## 6. Runtime 与 non-claims

Filesystem、frontmatter 和 reference closure 通过不自动等于所有 Agent/profile 的运行时 qualification。独立 fresh Codex host 直接从真实 available-skills surface 发现 Better 8、LoopOS 10、LangCraft 6、ProdCraft 40；`bs-visual-design` 不可见，`bs-prose-craft` 与 LangCraft `prose-craft` 同时可见且 bytes 不同。这是当前 Codex 宿主的 bounded runtime PASS。

CLI 继续保守显示 `runtime_status: UNVERIFIED`，因为其他 Agent/profile 的 routing、cache invalidation 与 loader 尚未逐一执行。无论当前 Codex 结果如何，本轮都没有测量 context-window token reduction，因此禁止宣称“物理嵌套已经降低 context”。

## 7. Reversal conditions

出现以下任一情况应撤销本验收或进入 repair/review，而不是猜测成功：

- catalog、control、active record、artifact/index 或 physical root identity 漂移；
- source-scoped receipt 被外部 installer 改写；
- preserved same-name path 被自动纳入 mutation plan；
- fresh Agent session 无法发现预期 gateway/member；
- upstream revision 改变但没有重新 qualification；
- recovery/quarantine bytes 被修改或删除。
