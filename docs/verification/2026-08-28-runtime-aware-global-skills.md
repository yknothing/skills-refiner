# 2026-08-28 运行时感知的全局 Agent Skills 治理与实机验收

- **Target:** `$HOME/.agents/skills`
- **Repository:** `<repository-root>`
- **Implementation baseline:** `0d2b853..e680b8d`
- **ADR:** [`../adr/0008-runtime-aware-global-skills-management.md`](../adr/0008-runtime-aware-global-skills-management.md)
- **Decision:** `OWNER-DECISION-REQUIRED`
- **Supersedes as current snapshot:** `2026-08-27-global-agent-skills-governance.md`（旧文保留作历史证据）

## 1. 结论

本轮完成了用户要求的两个真实闭环：

1. 本机全局 Skills 已形成可重建的观察面；ProdCraft、Better Skills、LoopOS、LangCraft 四个 collection
   物理收敛在 `$HOME/.agents/skills/<collection>/`，共 69 个成员绑定 immutable revision 与 artifact tree；
2. 最新 skills-refiner 已在自己的真实安装面、四个 live collection、三个宿主原生命令和最终 Panorama 上接受验证；
   live upgrade 暴露的 member drift 与 preserved-collision 代际误报已被修复并回归测试。

当前不是“全部运行时绿”：四个 collection 为 `FILESYSTEM_READY`，runtime profile 为
`DEPLOYMENT_READY`；Codex、Claude 只到 `CATALOG_ONLY`，Cursor 为 `BLOCKED`；body、route、context
仍为 `unverified`。这组边界是证据结论，不是完成度包装。

当前 identity coverage：

| Coverage axis | Current fact |
|---|---:|
| source-qualified collection members | 69 |
| Panorama path-qualified rows | 145 |
| Panorama ambiguous-name rows | 4 |
| global canonical Skills | 217 |
| cross-Agent observed entries | 767 |

因此，“管理好本机所有 Skills”在本版本中表示全量 inventory、差异发现和安全分诊；只有具备上游与 controller
证据的 69 个 collection members 获得 source-qualified mutation authority。

## 2. 唯一事实源与一致性

本机制不把一个 lock file 或数据库快照设为万能事实源，而是让每类事实只有一个裁决者：

| 事实 | 裁决者 | 当前校验 |
|---|---|---|
| Skill 内容 | 上游 immutable revision + artifact tree | exact Git object、tree/resource digest |
| 上游版本 | 同一 artifact 内的明确声明 | 声明路径、值与摘要；无声明即 `not_declared` |
| 本机批准 generation | controller active record | plan hash、operation、INDEX、catalog record |
| 当前安装状态 | 实际文件系统 | fresh no-follow observation 与 digest 重算 |
| installer 历史 | content-bound `.skill-lock.json` receipt | source/path/tree 闭合；revision 不补造 |
| Agent 当前发现 | fresh native probe | content-addressed runtime evidence |
| 总览 | Panorama 派生视图 | 每次重收上述事实；自身不成为 writer |

手工删除或改写 member 后，active record 仍只表达 desired generation；fresh status 会以实际磁盘为准报告 drift。
即使同时改写 INDEX 与目录使二者自洽，也不能绕过 active plan、artifact digest 和 controller binding。

## 3. 四个物理 collection

2026-08-28T17:08:33Z 再次执行 `git ls-remote ... refs/heads/main`；四个远端 main 均与 active revision
一致。这里的“最新”是该时间点的候选事实，不构成以后自动追新的承诺。
Better artifact 自身声明 `0.2.0-dev`；“与 main 一致”不等于签名 release 或稳定版认证。

| Collection | Physical root | Active operation | Exact plan hash | Remote main / active revision | Upstream version | Members |
|---|---|---|---|---|---|---:|
| ProdCraft | `~/.agents/skills/prodcraft` | `prodcraft-cdbfdef5b445` | `sha256:cdbfdef5b445b4b937d9397e505345753c9c02c54436385a12e76c6c1c8faf93` | `fd05978dbbbf5a064205a695af47c8a550f1b224` | `manifest.yml`: `1.0.0` | 40 |
| Better Skills | `~/.agents/skills/better-skills` | `better-skills-627a600ad94b` | `sha256:627a600ad94b3284e6cfd8f08645d4a423d1da9ee7e8ceff9da1e3705a084d0d` | `2198c88d55383f97e47ea51d914dc7703051091b` | `skills.json`: `0.2.0-dev` | 13 |
| LoopOS | `~/.agents/skills/loopos` | `loopos-43762096a5d3` | `sha256:43762096a5d3e8c1e13558687b5580323778564a9c0287251ad8b33b4991a9a4` | `f4454019414143e976edac5a250eca58d92ed12d` | `pyproject.toml`: `0.2.1` | 10 |
| LangCraft | `~/.agents/skills/langcraft` | `langcraft-1cd7aae0f9ee` | `sha256:1cd7aae0f9ee8144210d58ec65710eb2ca8433191d7355dcea99ee6656aef8b8` | `fa31c4b85a7400c53abee3bd19c278395a0df3fa` | `not_declared` | 6 |

版本全部来自 exact upstream artifact，不是 skills-refiner 自定义。ProdCraft 的 40 个 current members 使用
`pc-*`，物理位于 `prodcraft/`；顶层 `pc-prodcraft` 只是指向 gateway 的预期投影。Better 的
`bs-prose-master` 与 LangCraft 的 `prose-craft` 是不同仓库 identity，继续并存，不按名称清退。

四个 fresh status 均为 `FILESYSTEM_READY`、`issues=[]`。Better 的 13 个 Claude symlink 被记录为
`name_collision_status=OBSERVED`，但它们精确指向当前受管 member，故 `management_attention=[]`。

## 4. Better 最新升级的 drift → repair → successor 闭环

直接从旧 active generation 规划 successor 时，工具发现 `MEMBER_DRIFT:bs-reflect-loop`，以
`predecessor_drift` 拒绝生成可应用升级；没有绕过 precondition。

随后执行两阶段流程：

1. 对旧 operation `better-skills-11c77e3a11da` 创建独立 repair attempt
   `repair-0b081b1d-7965-4712-8b4d-03766e41c9b9`；其
   `skills-refiner.collection.repair-attempt.v1` record 最终为 `COMMITTED`；
2. pre-state inode `276252082`、manifest
   `sha256:5d6e89fbda5af3b5d398aba826eb675e90a7677974d4829e2a54bdf5afcd0bde` 被 identity-bound quarantine；
3. 修复发布 inode `276868419`、manifest
   `sha256:9eb833ebaadaa43249dde3368794f6e763101bc922b67a78544387680b51b18d`；
4. 再编译并应用 latest successor `better-skills-627a600ad94b`；successor predecessor quarantine 保留同一
   `276868419` inode，旧 repair quarantine 也继续存在；
5. active 13-member tree 与 revision `2198c88...` exact match，`bs-reflect-loop` 与该 candidate byte-exact。

这证明升级不会因为旧 generation 已 drift 就覆盖或丢失用户字节。repair attempt 是 operation-bound、CAS 更新的
独立 ledger record；它不是 append-only state WAL。active successor status 当前不会遍历所有历史 predecessor 的
repair quarantine，这是保留的 P2 history-audit 边界，不影响当前 active/undo evidence。

## 5. Live P1：preserved collision 的代际摘要误报

升级后实际 collection 已 ready，13 条 Claude preserved projection 的路径与目标均未变化；其中只有
`bs-reflect-loop` 的 target digest 随 successor 合法更新。旧实现对整个 13-entry aggregate set 做 byte-for-byte
比较，因此单项合法变化触发 `PRESERVED_COLLISION_SET_CHANGED`。根因是“symlink identity 未变”和“其合法目标
member 可随 generation 更新”被压成了同一摘要不变式。

提交 `e680b8d` 将例外收窄为：只有 collision 的其他字段完全一致、symlink 仍 resolved、目标精确等于当前
member 根、collection/INDEX/member mode 与 digest 均已验证时，才把 target digest 视为 generation-derived。
retarget、外部目标变化、member descendant、member drift 仍会告警。

最终 managed-collection suite 85/85 PASS；真实 Better status 为 `FILESYSTEM_READY / OBSERVED / []`。这一问题若
没有先做真实最新升级，不会从静态设计评审中暴露。

## 6. skills-refiner 自身的真实安装面

五个治理 Skills 位于 `$HOME/.agents/skills`：

| Skill | Frontmatter name | Description bytes | References | Repository payload |
|---|---|---:|---|---|
| `skill-debug` | exact | 204 | PASS | byte-exact |
| `skill-hygiene` | exact | 315 | PASS | byte-exact at `e680b8d` |
| `skills-appreciation` | exact | 250 | PASS | byte-exact |
| `skills-panorama` | exact | 363 | PASS | only repository-only `tests/fixtures` omitted by installer |
| `skills-refiner` | exact | 466 | PASS | byte-exact |

五项 description 均不超过 1024 bytes。installed launcher 在 Node 24 下 `--help --json` loadability PASS；默认
shell 的较旧 Node 会以 `node_runtime_unavailable` fail closed。`npx skills add ... -g` 对 Codex 安装成功；
PromptScript 明确报告不支持 global installation，这个宿主限制没有被隐藏。

`.skill-lock.json` v3 仍只作为 installer receipt：能绑定 repository/path/tree 与 installer-declared 时间，但没有
immutable revision。本轮从已推送 `e680b8d` 重装并做 payload diff，不会把操作上下文反向伪造成 receipt 字段。

## 7. 全局扫描与清理审核

2026-08-28T17:02:49Z full-provenance `skill-scan.v7`：

| Metric | Value |
|---|---:|
| canonical Skills | 217 |
| observed entries | 767 |
| projection links | 550 |
| broken symlinks | 0 |
| runtime load blockers | 0 |
| collection index blockers | 0 |
| scanner collision groups | 2 (`impeccable`, `onboard`) |
| provenance: collection / canonical global / native agent | 69 / 70 / 78 |

`runtime load blockers=0` 只表示静态检查没有发现已证实 blocker；scanner 对 69 个 managed members 的 runtime
loadability 仍为 `unknown`，不会由静态检查提升为 `pass`。

cleanup review digest：`sha256:d24155e8c3f3e01af828aa5e04bdb1831cda42d26453f01df2c42c5c10f1963b`。

| Metric | Value |
|---|---:|
| observed/candidates | 767 |
| eligible for later exact decision | 554 |
| review-only | 213 |
| selected decisions | 0 |
| executable plan | `null` |

本轮没有清理任何未获授权的 Skill；authoring source、unproven installed copy 和跨仓同名 identity 都不会因为
“旧”“重复”或名字相同自动获得删除授权。

## 8. Runtime profile 与原生证据

active profile：

- operation `runtime-profile-a26f9a00fcfd`；
- exact plan hash `sha256:5f5c558c0e0b991d2146d7daa9faa4024f88d53836e4f37b1f538df248ba164f`；
- deployment digest `sha256:2cf064f91c9bb0e7a625e71c00712cfb8f16000620c0c181a03c35d6e64a3e80`；
- `DEPLOYMENT_READY`，53 个 Codex members disabled、16 个 Claude projections、Cursor observe-only。

安装最终 controller 后又编译 exact plan
`sha256:c68ee797176e2c6aea887449cc762f7a1c3a0d0aa015f1943e5d27e69eeee26c`；apply 返回
`mutation_occurred=false` 并保持 active operation `runtime-profile-a26f9a00fcfd`。这是 no-op revalidation，不是第六个
active generation。

| Agent | Evidence id | Native result | Managed expectation | Status |
|---|---|---|---|---|
| Codex | `sha256:02cef6a6293e4ae8dd4f92711d58f6bae4ee8e376576aa61741332512ca109b7` | exit 0 / parsed；147 observed；canonical-path identity PASS | 16/16 | `CATALOG_ONLY` |
| Claude | `sha256:b56667269b2564af45df61e08af576508f3912c58a1b78ae048edb01bb7dae99` | exit 0 / parsed；167 observed；name-only identity unverified | 16/16 | `CATALOG_ONLY` |
| Cursor | `sha256:bb9895cd1491f7f6e60436af035a0ea960b6deed87110345b5ae63c5cfc6b2e1` | `not_logged_in`；native status timeout | 0/69 | `BLOCKED` |

一次 sandbox 内 Codex probe 先因 `permission_denied` 生成 blocked evidence；随后同一只读 native probe 在本机允许的
执行域成功，只有成功 evidence 被设为 current。所有 adapter 的 body、route、context 仍为 `unverified`。

## 9. Panorama v2 最终视图

Owner-private outputs：

```text
$HOME/Library/Application Support/skills-refiner/panorama/latest.json
$HOME/Library/Application Support/skills-refiner/panorama/latest.md
```

- generation `764f2a87-4681-4cac-92b7-05b17f1354ea`；generated at `2026-08-28T17:01:42.109Z`；
- JSON digest `sha256:83813e3b66fb7d52199f35d31ee25c1d88a63794c62f70dd68b1b7438e5e612c`；
  Markdown digest `sha256:968ed1ea7910fdda323059df9e624c29cbd518e932204669b9b8ae7be9445c72`；
- 两个文件均 mode 0600；collectors `COMPLETE/FULL`，blockers 0；
- 218 rows：69 `source_qualified`、145 `path_qualified`、4 `ambiguous_name`；
- gaps：broken 0、collision 4、catalog drift 0、partial 80、agent-only 55、source-only 55、unknown 23、complete 1；
- review signals：4 Skills；reference findings 0；possible secret 1、privileged command 3、pipe to shell 1。

Panorama 的四个 collision rows 为 `brainstorming`、`impeccable`、`onboard`、`review`；scanner 的两组 collision
采用更窄的 canonical-content scope，二者不是同一个统计口径。Panorama 当前不在顶层 summary 聚合 collection
`management_attention`；详细 collection rows 会保留它。这是 P2 可用性改进项，不能把 summary 当唯一告警面。

## 10. 验证矩阵

| Gate | Result |
|---|---:|
| managed collection full suite | 85/85 PASS |
| collection CLI | 4/4 PASS |
| scanner suite | 175/175 PASS |
| installed layout | 146/146 PASS |
| Node syntax + `git diff --check` | PASS |
| five governance Skills frontmatter/description/references | PASS |
| installed launcher Node 24 loadability | PASS |
| live collection fresh status | 4/4 `FILESYSTEM_READY` |
| live Better successor collision acceptance | PASS |
| fresh remote main equality | 4/4 PASS |
| full global scan blockers | 0 / 0 / 0 |
| adversarial review | P0 = 0；P1 = 0 |

没有对真实全局 Skills 注入或删除 canary；installed-layout 的 canary round trip 仅发生在临时 fixture。没有 mock
SUT，也没有清理真实用户文件来制造通过。

## 11. 对抗性评审与残余风险

L2 Agent-separated 评审覆盖 controller authority、latest-upgrade interleaving、repair identity chain、runtime evidence、
name collision 与 promotion claims。最终 P0 = 0、P1 = 0。live follow-up 关闭了唯一新 P1：合法 successor
generation 导致 preserved-collision digest 变化的误报。

保留的 P2/limitation：

1. active successor status 不自动遍历历史 predecessor 的 repair quarantine；未来可增加 bounded history audit；
2. Panorama summary 尚不聚合 collection `management_attention`；
3. relative/absolute raw-target 的直接 collision regression matrix 仍可扩充，但 exact raw/resolved target 比较已覆盖语义；
4. current-view collection/repair records不是 runtime profile 那样的 append-only state WAL；
5. Cursor、body/route/context、跨机 SLO、签名/在线远端证明均未晋升。

完整记录见
[`../adversarial-product-pk/2026-08-28-runtime-aware-global-skills/`](../adversarial-product-pk/2026-08-28-runtime-aware-global-skills/)。

## 12. Owner promotion boundary

机器 exact-hash gate 已通过四个 collection active plans 与一个 runtime profile active plan，但现有 operation schema
不记录 hash-specific human review。用户本轮授权“继续推进”与真实安装/升级，不等同于显式确认这五个 hash 为
ADR 的长期采纳记录。

因此 ADR 继续保持 `Proposed — Owner decision required`。Owner 明确确认
[`../adversarial-product-pk/2026-08-28-runtime-aware-global-skills/10-promotion-boundary.md`](../adversarial-product-pk/2026-08-28-runtime-aware-global-skills/10-promotion-boundary.md)
中的五个 active hashes 后，可在不扩大 scope 的前提下转为 `Accepted with limitations`。
