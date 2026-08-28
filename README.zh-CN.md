# skills-refiner

面向 Agent Skills 体系的分析、解读、评估与调试工具集。

**语言：** [English](README.md) | 简体中文

1.x 聚焦 skill 创建后的**设计判断**：单个 skill 的定位是否清晰、范围是否合理、是否便于迁移、上下文是否克制。

2.x 将判断从「单个 skill」延伸到「已安装的 skills 系统」：拓扑、来源、软链接分发、本地证据与保守式治理。

两套能力、五个 skill：

**分析与解读** — 判断与理解：
1. **`skills-refiner`** — 审计、精炼、抽取与整合 skill 仓库、单个 skill、工作流框架或评测集
2. **`skills-appreciation`** — 以可发表的技术随笔风格，解读 skill 或 skills 体系

**治理与可观测性** — 健康度与可见性：
3. **`skills-panorama`** — **技能全景**：只读摊开本机拓扑与八类缺口，分诊到 hygiene（不输出突变命令）
4. **`skill-hygiene`** — 评估已安装 skills 的健康与拓扑（**AI 判断，脚本收集事实**）
5. **`skill-debug`** — 三层轻量可观测：本地发现面诊断、激活探针注入、探针观测面板

## 为什么需要它

Agent skills 增长快、退化安静。常见两类交织问题：

1. **缺少深度设计评审。** Skill 能通过断言测试，却可能存在范围蔓延、上下文工程薄弱或隐性脆弱；泛泛夸奖或批评没有用。
2. **缺少运行层面可见性。** 用户在多个 agent 目录装了几十个 skill，却不清楚哪些本地可见、有哪些本地证据、是否陈旧、链接是否断裂、是否值得深入审查。

本仓库同时应对二者：

- `skills-refiner` 与 `skills-appreciation` 处理**分析**问题 — 设计层审计与可传播的解读。
- `skills-panorama`、`skill-hygiene` 与 `skill-debug` 处理**治理**问题 — 先全景看清，再 hygiene 评估与处置，辅以探针观测。

配合 `skill-creator` 等创建工具，可形成完整生命周期：创建 → 测试 → 设计审计 → 治理 → 可观测性 → 解读。

治理的第一问现在必须更精确：静态证据能否证明存在加载阻断？`skill-scan.sh` 只会把可靠解析到且超过 1024 字符上限的 `description` 标为 `runtime_contract.status: "fail"`。轻量解析器没有观察到的必填字段会进入 `unverified_requirements`，不会被直接宣判为缺失。其余情况是 `"unknown"`、`loadable: null`、`runtime_verified: false`；scanner 不会假装自己执行过 agent 的真实 loader 或完整 YAML validator。

## 五个 skill

### 1) `skills-refiner` — 设计层审计

适用于：
- 诊断仓库、skill 或框架；
- 评判优劣、结构、上下文工程、复用、安全、治理与工程成熟度；
- 区分应保留、改进、简化、移除或拒绝的部分；
- 在提供目标仓库时延续到兼容性评审、抽取与整合规划。

面向决策，补足断言测试无法覆盖的设计层。

### 2) `skills-appreciation` — 教学级解读

适用于：
- 说明某个 skill 或体系究竟是什么；
- 拆开「为何有效 / 为何失效」的机制；
- 告诉读者真正值得学什么；
- 产出结构清晰、有技术深度、少「AI 味」的可发表赏析。

面向解读，**不会**对创意类 skill 强行套用纯工程标尺。

### 3) `skills-panorama` — 技能全景（只读地图）

适用于：
- 第一眼看清本机已部署 Skills：源目录有什么、各 Agent 出现了什么、链接与控制清单是否一致；
- 按八类缺口分诊（齐全 / 仅源 / 仅 Agent / 断链 / 清单不符 / 撞名 / 部分 Agent 已出现 / 暂无法判定）；
- 需要中文报告与低打字决策卡，且**不**在此步骤执行删除或重链。

编排现有 `skill-scan` 与 collection/catalog，不新增第二套磁盘遍历。详见 ADR-0007 与 `skills/skills-panorama/SKILL.md`。

```bash
SKILLS_REFINER_NODE_BIN=/absolute/path/to/node24 \
  bash ~/.agents/skills/skills-panorama/bin/skill-panorama.sh --yes
```

### 4) `skill-hygiene` — 已安装 skill 评估

适用于：
- 跨 agent 目录审计已安装 skills 的健康与质量；
- 发现失效软链接、备份残留、安全信号、陈旧或占位 skill；
- 理解拓扑：原始来源、软链接分发、各 agent 独立安装、同名内容/版本碰撞；
- 获得结构化清单供治理评审。

遵循 **「AI judges, scripts collect」**：`bin/skill-scan.sh` 收集结构化事实，由 AI 结合上下文解释。尊重常见安装模型：`~/.agents/skills/` 为原始目录，各 agent 目录中的软链接为分发而非重复。

### 5) `skill-debug` — Skill 可观测性

适用于：了解本地**可能**的发现面、是否观测到探针事件、哪些已安装标识缺少本地探针证据等。三层能力：

- **发现诊断**（`skill-probe`）— 从当前工作目录看，本地哪些 skill 文件落在诊断器会扫描的路径上？
- **激活探针**（`skill-trace`）— 注入/移除轻量探针块，观察 agent 是否按 skill 指令执行。
- **探针面板**（`skill-dashboard`）— 事件频次、未观测标识、上下文分布、观测率等。

与 `skill-hygiene` 组合的典型流程：probe → 看探针观测 → hygiene 评估 → 分级处理。

## 设计原则

五个 skill 共通：

- **AI judges, scripts collect.** 脚本收集结构化数据、不做裁决；AI 结合专业与上下文解释。脚本不得架空 AI 的判断空间。
- **先可加载，再谈优雅。** 不能满足运行时加载契约的 skill 是阻断问题，即使文档和工作流写得再完整也一样。
- **默认保守。** 证据不清时只标注观察，不建议删除或贸然动作。
- **尊重拓扑。** 常见模型：`~/.agents/skills/` 为原始来源，软链接到 `.claude/skills/`、`.cursor/skills/`、`.codex/skills/` 等为分发，不是重复。独立项目仓库不是「坏掉的全局 skill」。
- **把安装目录当部署产物。** 本仓库为事实来源（source of truth）；全局安装可能漂移，对比哈希/提交后再当作当前版本。哈希对比请两侧都使用扫描器的 `normalized_content_sha256`（已剔除 canary 块/CRLF/BOM），不要用注入 canary 后文件的原始 `sha256sum`。
- **原生信号优先。** 在具备 Claude Code OpenTelemetry、Codex skill 元数据、Cursor Rules/Skills/MCP、SDK 追踪等处优先使用平台能力；探针是本地补充，不是平台追踪替代品。
- **判断扎根证据。** 区分直接证据、推断与未决不确定性。
- **缩小输入面。** 尽量从上下文推断模式、深度与语言。
- **追求可迁移的收获。** 目标是可行动的洞察，而非机巧表述。

### 分层补充

**分析与解读：** 偏好可见的推理结构；强的赏析文章应兼具技术博客的严谨、教材的清晰与成稿可读性。

**治理与可观测性：** 不误报；零观测不等于没用。「未观测」是观察，不是裁决。操作可逆：探针可逐字节剥离，包括末尾无换行的文件；扫描默认不改 skill 文件（`--json` / `--no-write` 控制）；dashboard 只读。Canary 日志只写入非软链接的 `~/.agents/debug/`（`0700`）与 `activation.jsonl`（`0600`）；遇到软链接日志路径会拒绝写入，不会跟随或修改目标权限。

**统计准确性契约：**
- **精确本地统计：** skill 清单、原始路径、软链接分发、断链、内容哈希、同名/内容/版本碰撞、报告时间与 JSONL 探针事件等。
- **代理统计：** 探针观测率、未观测标识、`cwd` 分布与频次等 — 统计的是本地证据，不是真实运行时用量。
- **无原生遥测则不在范围内：** 无法在本地轻量脚本中可靠回答 agent 是否发现、加载、遵守 skill 或对产出质量的贡献。

## 安装

使用 [skills CLI](https://github.com/vercel-labs/skills) 全局安装五个 skill：

```bash
npx skills add yknothing/skills-refiner --skill skills-refiner --skill skills-appreciation --skill skills-panorama --skill skill-hygiene --skill skill-debug -g
```

适用于 Claude Code、Cursor、Codex、OpenCode 及 [多种 agent](https://github.com/vercel-labs/skills#supported-agents)。

只读治理脚本依赖 Bash、`jq` 与 SHA-256 实现。本机 cleanup 还要求 Node.js
major 24；mutation adapter 目前仅支持 macOS，第一次编译 native helper 时
需要 Apple Command Line Tools。Linux/Ubuntu 可以 review 已安装条目，但 cleanup
mutation 会 fail closed。Windows Git Bash 仍只支持既有的有界只读与 trace 文件
变换；Windows 尚未实现 `setup-cli` 与 cleanup mutation。原生 PowerShell/cmd
也未实现。精确边界见
[平台支持契约](docs/platform-support.md)。

五个 skill 均可独立选择安装。例如：

```bash
# 只安装设计审计能力（不依赖其他 skill 的运行时文件）
npx skills add yknothing/skills-refiner --skill skills-refiner -g

# 独立安装已安装 skill 扫描器
npx skills add yknothing/skills-refiner --skill skill-hygiene -g

# 完整治理组合：可观测性 + hygiene 聚合快照
npx skills add yknothing/skills-refiner --skill skill-debug --skill skill-hygiene -g
```

`skill-debug` 单独安装时，probe、dashboard 与 trace 均可运行。聚合
`doctor` 会把 `hygiene` 明确标记为结构化 `unavailable`，并以部分结果
退出码（`1`）结束；安装 `skill-hygiene` 后即可获得完整聚合结果。

### 一键健康快照（`doctor`）

只读聚合：**发现 probe -> 激活面板 -> hygiene 扫描**。**不会**注入探针（那会改写 skill 文件）。默认输出是压缩治理摘要；需要完整底层终端输出时使用 `--raw`。

```bash
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh
# 面向 agent / 工具的单文件 JSON：
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --json
# 中文终端报告：
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --lang zh
# 克隆本仓库后可用根目录包装脚本：
bash bin/skills-refiner-doctor.sh --help
```

可选环境变量：`SKILLS_REFINER_TOOLS_ROOT` — 包含 `skill-debug/` 与 `skill-hygiene/` 的目录（布局与 `~/.agents/skills` 相同）。

### Review 并安全退役本机条目

`skill-scan.sh` 提供证据，不做退役裁决。Cleanup 只治理 Agent skill root 中
本机已安装或已分发的条目；独立 authoring/source 仓库只能 review，永远不是
mutation target。

在 macOS + Node.js 24 上，从已安装包启动，并可选择把经过校验的
`skills-refiner` launcher 安装到一个已存在、位于 `PATH`、属于当前用户且安全的
目录：

```bash
bash ~/.agents/skills/skill-hygiene/bin/skills-refiner setup-cli --node /absolute/path/to/node24
skills-refiner cleanup
```

`setup-cli` 不修改 shell profile，也不会覆盖无关文件。TTY 下只有一个安全
`PATH` 目录时会自动选择；有多个时列出候选并要求 `--target`。命令会展示一个
绑定 source launcher、精确 Node binary 与 destination 的 digest，并要求逐字
输入。空输入、EOF、不匹配或 Ctrl-C 都是零写入。如果没有安全 `PATH` 目录，
则不写入 wrapper，并返回可直接复制的完整路径 invocation：它会先把
`SKILLS_REFINER_NODE_BIN` 设为已选定的 Node 24 binary，再运行已安装
launcher。

Agent/IDE 的非 TTY 流程必须显式决策并使用 JSON：

```bash
bash ~/.agents/skills/skill-hygiene/bin/skills-refiner setup-cli \
  --node /absolute/path/to/node24 --target /absolute/safe/PATH/directory --json
# 退出 2 返回 preview；用其中的 confirmation.digest 原样重复命令：
bash ~/.agents/skills/skill-hygiene/bin/skills-refiner setup-cli \
  --node /absolute/path/to/node24 --target /absolute/safe/PATH/directory \
  --confirm 'sha256:...' --json

SESSION_DIR=$(mktemp -d /tmp/skills-refiner-cleanup.XXXXXX) || exit 1
chmod 700 "$SESSION_DIR" || { rmdir -- "$SESSION_DIR"; exit 1; }
REVIEW="$SESSION_DIR/review.json"
SELECTOR="$SESSION_DIR/retire-paths.json"
PLAN="$SESSION_DIR/plan.json"
skills-refiner cleanup review --output "$REVIEW" --json
```

不要把这些产物写入当前 project/source repository。若只退役一个精确的审核子集，
在私有会话目录中创建 `$SELECTOR`：

```json
{
  "schema_version": "skills-refiner.cleanup.retire-paths.v1",
  "review_fingerprint": "<完整复制 review_fingerprint 的精确值>",
  "entry_paths": ["<完整复制审核过的规范化绝对 entry_path>"]
}
```

然后编译并执行不可变 plan：

```bash
skills-refiner cleanup plan --review "$REVIEW" --retire-paths "$SELECTOR" --output "$PLAN" --json
skills-refiner cleanup apply --plan "$PLAN" --confirm 'sha256:...' --post-scan --json
skills-refiner cleanup status 'sha256:...' --json
skills-refiner cleanup undo 'sha256:...' --confirm 'sha256:...' --json
rm -f -- "$REVIEW" "$SELECTOR" "$PLAN"
rmdir -- "$SESSION_DIR"
```

Apply 必须使用 `$PLAN` 中精确的 `plan_hash`，status/undo 必须使用对应 item
的精确 `transaction_id`。`cleanup plan --persist-keep` 是 Agent/IDE 路径中唯一会
持久化 Keep 的方式；不加该参数，plan 不会产生 Keep 副作用。需要为每个 candidate
显式选择 `keep`、`later` 或 `retire` 时，使用与 `--retire-paths` 互斥的
`--decisions` 形式；selector 只退役其中列出的已审核 eligible paths，其余全部视为
Later。`Inspect` 只存在于 TTY 展示中，不是 JSON action。如果流程中途停止，只删除上述三个
会话文件，再移除对应私有目录；切勿通过删除当前 working tree 来“清理”。

单个可执行 cleanup plan 被刻意限制为 8 项，保证提交给 native helper 的精确请求
不超过其输入契约。审核子集更大时，先创建 owner-private、mode `0700` 的
`$SESSION_DIR/parts`，再把 `--output "$PLAN"` 替换为
`--partition-dir "$SESSION_DIR/parts"`。必须按 manifest 顺序执行生成的 child plans，
首次失败即停止；每个条目仍保留独立 transaction 与 undo identity。
`cleanup partition --plan OLD_PLAN --output-dir DIR` 只用于把此前已经编译的超大 plan
离线转换成新的 content-addressed child plans；它会重新校验旧 plan，但绝不执行 mutation。

TTY 提供 **Keep / Later / Inspect / Retire**。空输入等于 Later，因此默认不会
选中任何退役动作。Keep 只在观测到的条目标识与拓扑仍匹配时持续生效；Later
仅作用于当前会话；Inspect 展示证据；Retire 还要第二次精确确认。Retire 是位于
`~/.agents/skills-quarantine/transactions/` 的可恢复 quarantine transaction，
不是永久删除；当前没有 purge 命令。

多条目 plan 按顺序执行为互相独立、可分别 undo 的 transaction，并在第一次
失败时停止。此前 committed transaction 的原始 payload 会继续留在 quarantine
（除非已 restore），其 ID 会出现在 `committed_transaction_ids` 中；应逐个独立处理。
使用 `--post-scan` 时，每个已提交条目会得到 `QUARANTINED`、
`REHYDRATED`、`RESTORE_CONFLICT` 或 `INDETERMINATE`。Installer 可能在原始
payload 仍处于 quarantine 时重新填充 active path，正在运行的 Agent 也可能保留
缓存。系统不会自动再次隔离 rehydrated 条目，必须先 review 新证据。

### 运行时暴露面与证据

物理 collection 解决来源与升级组织问题，但仅靠目录嵌套不会降低 Agent catalog
或 context 成本。默认 runtime profile 向 Codex 与 Claude 暴露 12 个批准的 Better
Skills 成员，以及 `pc-prodcraft`、`loopos`、`langcraft` 三个 gateway。Cursor 在
缺少可信原生 catalog/profile probe 前保持 observe-only。Profile 不会覆盖同名的
user-owned 条目。

使用私有目录，先审核精确 plan，再确认其 hash：

```bash
SESSION_DIR=$(mktemp -d /tmp/skills-refiner-runtime.XXXXXX) || exit 1
chmod 700 "$SESSION_DIR" || { rmdir -- "$SESSION_DIR"; exit 1; }
PROFILE_PLAN="$SESSION_DIR/profile-plan.json"
CODEX_EVIDENCE="$SESSION_DIR/codex-evidence.json"

skills-refiner runtime profile status --json
skills-refiner runtime profile plan --output "$PROFILE_PLAN" --json
skills-refiner runtime profile apply \
  --plan "$PROFILE_PLAN" --confirm 'sha256:...' --json

# 必须从 apply 后状态启动；仅 catalog 证据会有意返回退出码 10。
skills-refiner runtime probe --adapter codex --output "$CODEX_EVIDENCE" --json
skills-refiner runtime record \
  --evidence "$CODEX_EVIDENCE" --confirm 'sha256:...' --json
skills-refiner runtime status --json
skills-refiner runtime profile status --json
```

`profile apply` 的确认值必须是精确 `plan_hash`；`runtime record` 的确认值必须是
精确 `evidence_id`。证据绑定 immutable upstream identity、active controller
generation、实际 collection bytes、runtime config、host/executable identity 与原生
probe 派生事实；不保存 raw prompt 或 transcript。`FILESYSTEM_READY`、
`DEPLOYMENT_READY`、`CATALOG_ONLY` 与 `QUALIFIED` 是刻意分离的状态。缺少 body
access 或 gateway route 证据时必须保留 `UNVERIFIED`；成功落盘 evidence 也不会把
catalog-only 提升为 runtime qualification。因此，`runtime record` 在成功返回但仍
不完整/未资格化的 `RECORDED` 结果上返回退出码 `10`；这不表示持久化失败。

可逆 deployment 变更使用精确 operation id：

```bash
skills-refiner runtime profile undo 'runtime-profile-............' \
  --confirm 'runtime-profile-............' --json
skills-refiner runtime profile recover 'runtime-profile-............' \
  --confirm 'runtime-profile-............' --json
rm -f -- "$PROFILE_PLAN" "$CODEX_EVIDENCE"
rmdir -- "$SESSION_DIR"
```

权威事实分层、transaction 边界、同名保留规则与 runtime truth matrix 见
[ADR-0008](docs/adr/0008-runtime-aware-global-skills-management.md)。

机器可读命令在 stdout 只输出一个 JSON 文档，诊断写入 stderr。退出码边界如下：

| 退出码 | 含义 |
|---:|---|
| `0` | 成功或已验证的幂等结果 |
| `2` | 输入无效/不完整、需要或不匹配确认、或安全取消 |
| `3` | runtime、平台或 mutation adapter 不支持；零 mutation |
| `10` | 安全检查阻断、检测到 drift，或运行时结果真实地不完整/未资格化 |
| `20` | 需要恢复，或无法证明 mutation outcome |
| `21` | restore/transaction 冲突 |
| `130` | 交互被中断 |

版本说明：当前产品线是 `skills-refiner 2.0`。`skills-refiner.doctor.v2`、`skill-dashboard.identity.v2`、`skill-scan.v6` 等字段是 JSON schema / 事件协议版本，不是产品发布号。Doctor v2 新增选择性安装场景使用的显式 `unavailable` step 状态；Scan v6 保留 v5 的保守运行时语义与 `skills + skill_links + broken_symlinks` 顺序契约，并新增有界 `INDEX.json` collection member inventory、identity-bound canonical-content cache 与经过脱敏、内容绑定的风险证据。仅来自 INDEX 的 repository/revision 仍是未验证声明。Cleanup 同时接受历史 v5 与当前 v6 evidence。

受管第三方 collection 的版本属于另一命名空间：skills-refiner 只报告 approved immutable upstream artifact 中严格提取的值及其 source path/digest，或明确返回 `not_declared`；不会用这些本地 product/schema 版本推导第三方 release version。

## 仓库布局

**分析与解读：**
- `skills/skills-refiner/SKILL.md` — 审计 / 精炼 / 抽取 / 整合
- `skills/skills-refiner/references/skill-creator-collaboration.md` — 与 skill-creator 的协作模型
- `skills/skills-appreciation/SKILL.md` — 赏析 / 解读
- `skills/skills-appreciation/references/editorial-checklist.md` — 文章质检清单

**治理与可观测性：**
- `skills/skills-panorama/SKILL.md` — 技能全景（只读地图与分诊）
- `skills/skills-panorama/bin/skill-panorama.sh` — 编排 scan/catalog → `latest.json` / `latest.md`
- `skills/skill-hygiene/SKILL.md` — AI 驱动的评估框架
- `skills/skill-hygiene/bin/skill-scan.sh` — 拓扑与事实收集
- `skills/skill-hygiene/bin/skills-refiner` — Node 24 bootstrap 与 cleanup/collection/runtime CLI launcher
- `skills/skill-hygiene/lib/cleanup-*.mjs` — review、contract、planning、平台与 transaction 逻辑
- `skills/skill-hygiene/lib/runtime-*.mjs` — runtime policy、profile transaction、原生 probe 与 evidence binding
- `skills/skill-hygiene/native/cleanup-macos-helper.c` — fail-closed macOS 文件系统 mutation helper
- `skills/skill-hygiene/tests/test-scan.sh` 与 `test-cleanup-*` — scan 与 cleanup gates
- `skills/skill-debug/SKILL.md` — 三层可观测性
- `skills/skill-debug/bin/skill-probe.sh` — 发现诊断
- `skills/skill-debug/bin/skill-trace.sh` — 探针注入/移除
- `skills/skill-debug/bin/skill-dashboard.sh` — 探针观测面板
- `skills/skill-debug/bin/skills-refiner-doctor.sh` — 只读 probe + 面板 + hygiene 快照
- `skills/skill-debug/tests/test-doctor.sh` — doctor 冒烟测试（隔离 `HOME`）
- `skills/skill-debug/tests/test-trace.sh` — 集成测试
- `skills/skill-debug/tests/test-probe.sh` — probe 集成测试
- `skills/skill-debug/tests/test-dashboard.sh` — dashboard 集成测试
- `skills/skill-debug/tests/test-install-layout.sh` — 选择性安装布局契约
- `skills/skill-debug/tests/test-platform-contract.sh` — macOS/Windows 路径、CRLF 与权限边界契约
- `skills/skill-debug/tests/test-observability-regressions.sh` — 保守语义回归测试

**辅助材料：**
- `skills/{skill-debug,skill-hygiene}/lib/common.sh` — 镜像的运行时 helper；两个可执行治理 skill 各自携带一份，保证选择性安装自包含（installed-layout 测试强制校验字节一致）
- `bin/skills-refiner-doctor.sh` — 贡献者包装脚本，转发至 `skills/skill-debug/bin/skills-refiner-doctor.sh`
- `docs/platform-support.md` — macOS、Windows WSL 2、Git Bash 与原生 PowerShell 的明确支持边界
- `examples/` — 五个 skill 的用法示例
- `evals/` — 评测量表与锚点评析（9 cases，2 rubrics）

## 快速示例

### 分析与解读

```text
# 审计当前仓库
Use skills-refiner on this repository.

# 审计并整合到另一仓库
Use skills-refiner, and treat yknothing/prodcraft as target_repo.

# 写一篇赏析
Use skills-appreciation on this repository. Write a deep but readable article.

# 解读单个 skill
Use skills-appreciation on this skill. I want to understand why it is designed this way.
```

### 治理与可观测性

```bash
# 只读一键快照（probe + dashboard + hygiene 终端报告）
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh

# 技能全景（只读；零交互）
SKILLS_REFINER_NODE_BIN=/absolute/path/to/node24 \
  bash ~/.agents/skills/skills-panorama/bin/skill-panorama.sh --yes

# 扫描已安装 skills
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh

# 仅在接受 provenance tree 证据被明确截断时使用的快速 inventory
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh --skip-provenance-tree

# 本机交互式 review；空输入为 Later，不会默认选中退役
skills-refiner cleanup

# 当前目录附近哪些 skill 文件可能被诊断器看到？
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh

# 向全局 skills 注入激活探针
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/

# 查看探针面板（默认近 30 天）
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh

# probe 自带 doctor 模式（含多项交叉）
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh --doctor
```

## 评测

`evals/` 目录包含面向分析类 skill 的锚点评测：

- `skills-refiner`（cases 01–03、08）— 对象识别、阶段控制、判断质量、证据纪律
- `skills-appreciation`（cases 04–07、09）— 论点、机制阐述、文笔与「AI 味」控制

Cases 08–09 覆盖与 skill-creator 协作场景。

治理类 skill（`skill-hygiene`、`skill-debug`）通过隔离沙箱集成测试验证。可移植的 scan/observability 与 cleanup contract/CLI gates 在 macOS、Ubuntu 运行；真实 cleanup mutation、native-helper 故障注入，以及成功 transaction 的 status/undo 只在 macOS 运行。`test-install-layout.sh` 验证选择性安装包可在 checkout 外运行且不会改动 source Git。`windows-latest` 仍是有界的 Git Bash 只读/trace 契约，不认证 cleanup mutation。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT
