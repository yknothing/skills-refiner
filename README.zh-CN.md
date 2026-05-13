# skills-refiner

面向 Agent Skills 体系的分析、解读、评估与调试工具集。

**语言：** [English](README.md) | 简体中文

1.x 聚焦 skill 创建后的**设计判断**：单个 skill 的定位是否清晰、范围是否合理、是否便于迁移、上下文是否克制。

2.x 将判断从「单个 skill」延伸到「已安装的 skills 系统」：拓扑、来源、软链接分发、本地证据与保守式治理。

两套能力、四个 skill：

**分析与解读** — 判断与理解：
1. **`skills-refiner`** — 审计、精炼、抽取与整合 skill 仓库、单个 skill、工作流框架或评测集
2. **`skills-appreciation`** — 以可发表的技术随笔风格，解读 skill 或 skills 体系

**治理与可观测性** — 健康度与可见性：
3. **`skill-hygiene`** — 评估已安装 skills 的健康与拓扑（**AI 判断，脚本收集事实**）
4. **`skill-debug`** — 三层轻量可观测：本地发现面诊断、激活探针注入、探针观测面板

## 为什么需要它

Agent skills 增长快、退化安静。常见两类交织问题：

1. **缺少深度设计评审。** Skill 能通过断言测试，却可能存在范围蔓延、上下文工程薄弱或隐性脆弱；泛泛夸奖或批评没有用。
2. **缺少运行层面可见性。** 用户在多个 agent 目录装了几十个 skill，却不清楚哪些本地可见、有哪些本地证据、是否陈旧、链接是否断裂、是否值得深入审查。

本仓库同时应对二者：

- `skills-refiner` 与 `skills-appreciation` 处理**分析**问题 — 设计层审计与可传播的解读。
- `skill-hygiene` 与 `skill-debug` 处理**治理**问题 — 拓扑扫描、版本/来源事实收集、激活探针追踪与观测汇总。

配合 `skill-creator` 等创建工具，可形成完整生命周期：创建 → 测试 → 设计审计 → 治理 → 可观测性 → 解读。

治理的第一问现在必须很直接：这个 skill 能不能被加载？`skill-scan.sh` 会把缺少 frontmatter 必填字段、`description` 超过 1024 字符运行时上限等问题标为加载阻断，再进入更软的设计评审。

## 四个 skill

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

### 3) `skill-hygiene` — 已安装 skill 评估

适用于：
- 跨 agent 目录审计已安装 skills 的健康与质量；
- 发现失效软链接、备份残留、安全信号、陈旧或占位 skill；
- 理解拓扑：原始来源、软链接分发、各 agent 独立安装、同名内容/版本碰撞；
- 获得结构化清单供治理评审。

遵循 **「AI judges, scripts collect」**：`bin/skill-scan.sh` 收集结构化事实，由 AI 结合上下文解释。尊重常见安装模型：`~/.agents/skills/` 为原始目录，各 agent 目录中的软链接为分发而非重复。

### 4) `skill-debug` — Skill 可观测性

适用于：了解本地**可能**的发现面、是否观测到探针事件、哪些已安装标识缺少本地探针证据等。三层能力：

- **发现诊断**（`skill-probe`）— 从当前工作目录看，本地哪些 skill 文件落在诊断器会扫描的路径上？
- **激活探针**（`skill-trace`）— 注入/移除轻量探针块，观察 agent 是否按 skill 指令执行。
- **探针面板**（`skill-dashboard`）— 事件频次、未观测标识、上下文分布、观测率等。

与 `skill-hygiene` 组合的典型流程：probe → 看探针观测 → hygiene 评估 → 分级处理。

## 设计原则

四个 skill 共通：

- **AI judges, scripts collect.** 脚本收集结构化数据、不做裁决；AI 结合专业与上下文解释。脚本不得架空 AI 的判断空间。
- **先可加载，再谈优雅。** 不能满足运行时加载契约的 skill 是阻断问题，即使文档和工作流写得再完整也一样。
- **默认保守。** 证据不清时只标注观察，不建议删除或贸然动作。
- **尊重拓扑。** 常见模型：`~/.agents/skills/` 为原始来源，软链接到 `.claude/skills/`、`.cursor/skills/`、`.codex/skills/` 等为分发，不是重复。独立项目仓库不是「坏掉的全局 skill」。
- **把安装目录当部署产物。** 本仓库为事实来源（source of truth）；全局安装可能漂移，对比哈希/提交后再当作当前版本。
- **原生信号优先。** 在具备 Claude Code OpenTelemetry、Codex skill 元数据、Cursor Rules/Skills/MCP、SDK 追踪等处优先使用平台能力；探针是本地补充，不是平台追踪替代品。
- **判断扎根证据。** 区分直接证据、推断与未决不确定性。
- **缩小输入面。** 尽量从上下文推断模式、深度与语言。
- **追求可迁移的收获。** 目标是可行动的洞察，而非机巧表述。

### 分层补充

**分析与解读：** 偏好可见的推理结构；强的赏析文章应兼具技术博客的严谨、教材的清晰与成稿可读性。

**治理与可观测性：** 不误报；零观测不等于没用。「未观测」是观察，不是裁决。操作可逆：探针可剥离；扫描默认不改 skill 文件（`--json` / `--no-write` 控制）；dashboard 只读。

**统计准确性契约：**
- **精确本地统计：** skill 清单、原始路径、软链接分发、断链、内容哈希、同名/内容/版本碰撞、报告时间与 JSONL 探针事件等。
- **代理统计：** 探针观测率、未观测标识、`cwd` 分布与频次等 — 统计的是本地证据，不是真实运行时用量。
- **无原生遥测则不在范围内：** 无法在本地轻量脚本中可靠回答 agent 是否发现、加载、遵守 skill 或对产出质量的贡献。

## 安装

使用 [skills CLI](https://github.com/vercel-labs/skills)：

```bash
npx skills add yknothing/skills-refiner
```

适用于 Claude Code、Cursor、Codex、OpenCode 及 [多种 agent](https://github.com/vercel-labs/skills#supported-agents)。

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

版本说明：当前产品线是 `skills-refiner 2.0`。`skills-refiner.doctor.v1`、`skill-dashboard.identity.v1`、`skill-scan.v2` 等字段是 JSON schema / 事件协议版本，不是产品发布号。

## 仓库布局

**分析与解读：**
- `skills/skills-refiner/SKILL.md` — 审计 / 精炼 / 抽取 / 整合
- `skills/skills-refiner/references/skill-creator-collaboration.md` — 与 skill-creator 的协作模型
- `skills/skills-appreciation/SKILL.md` — 赏析 / 解读
- `skills/skills-appreciation/references/editorial-checklist.md` — 文章质检清单

**治理与可观测性：**
- `skills/skill-hygiene/SKILL.md` — AI 驱动的评估框架
- `skills/skill-hygiene/bin/skill-scan.sh` — 拓扑与事实收集
- `skills/skill-hygiene/tests/test-scan.sh` — 集成测试
- `skills/skill-debug/SKILL.md` — 三层可观测性
- `skills/skill-debug/bin/skill-probe.sh` — 发现诊断
- `skills/skill-debug/bin/skill-trace.sh` — 探针注入/移除
- `skills/skill-debug/bin/skill-dashboard.sh` — 探针观测面板
- `skills/skill-debug/bin/skills-refiner-doctor.sh` — 只读 probe + 面板 + hygiene 快照
- `skills/skill-debug/tests/test-doctor.sh` — doctor 冒烟测试（隔离 `HOME`）
- `skills/skill-debug/tests/test-trace.sh` — 集成测试
- `skills/skill-debug/tests/test-probe.sh` — probe 集成测试
- `skills/skill-debug/tests/test-dashboard.sh` — dashboard 集成测试
- `skills/skill-debug/tests/test-observability-regressions.sh` — 保守语义回归测试

**辅助材料：**
- `bin/skills-refiner-doctor.sh` — 贡献者包装脚本，转发至 `skills/skill-debug/bin/skills-refiner-doctor.sh`
- `examples/` — 四个 skill 的用法示例
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

# 扫描已安装 skills
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh

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

治理类 skill（`skill-hygiene`、`skill-debug`）通过沙箱拓扑下的集成测试验证扫描器/追踪器行为；`skills/skill-debug/tests/test-doctor.sh` 在隔离 `HOME` 下对只读 `skills-refiner-doctor.sh` 做冒烟验证。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT
