# skills-refiner

[English](README.md)

面向 agent skill 系统的治理工具包，提供分析、解读、评估与调试能力。

两个层次、四项技能：

**分析与解读层** — 判断与理解：
1. **`skills-refiner`** — 审查、优化、提取并整合 skill 仓库、单个 skill 或工作流框架
2. **`skills-appreciation`** — 以深度、教学级风格解读和阐释 skill 或 skills 系统

**治理与可观测层** — 健康状态与可见性：
3. **`skill-hygiene`** — 评估已安装 skill 的健康度、质量与拓扑结构（AI 判断，脚本收集事实）
4. **`skill-debug`** — 三层可观测能力：发现诊断、激活追踪、效果仪表盘

## 为什么需要这个工具包

Agent skill 增长迅速，却在无声中退化。大多数 skill 生态面临两个相互交织的问题：

1. **缺乏深度设计审查。** Skill 通过了断言测试，却存在范围蔓延、上下文工程薄弱或隐性脆弱性。表层的赞美或批评没有实际帮助。
2. **缺乏运维可见性。** 用户在多个 agent 目录中安装了几十个 skill，却无法判断哪些被发现、哪些被激活、哪些有效、哪些已过时或已损坏。

本仓库同时解决这两个问题：

- `skills-refiner` 和 `skills-appreciation` 解决**分析**问题 — 深度设计审查与可发表的解读文章。
- `skill-hygiene` 和 `skill-debug` 解决**治理**问题 — 拓扑扫描、事实收集、激活追踪与使用分析。

与 `skill-creator`（Claude 官方 skill 创建工具）共同构成完整的 skill 生命周期：创建 → 测试 → 设计审查 → 治理 → 可观测 → 解读。

## 四项技能

### 1) `skills-refiner` — 设计层审查

适用于以下主要场景：
- 诊断一个仓库、skill 或框架；
- 判断其优势、弱点、结构、上下文工程、复用性、安全性、治理能力与成熟度；
- 区分应当保留、改进、简化、移除或拒绝的内容；
- 在提供目标仓库时，继续执行兼容性审查与整合规划。

本技能面向决策。它与 `skill-creator` 互补，覆盖断言测试无法触达的设计层问题。

### 2) `skills-appreciation` — 教学级解读

适用于以下主要场景：
- 解释一个 skill 或 skills 系统究竟是什么；
- 剖析其设计为何有效或失效；
- 教导读者真正值得学习的内容；
- 输出结构清晰、技术深度到位、"AI 腔"极低的可发表赏析文章。

本技能面向解读。它**不会**将工程类标准强套到每个分析对象上 — 创意类 skill 与基础设施类 skill 的评判标准不同。

### 3) `skill-hygiene` — 已安装 skill 评估

适用于以下场景：
- 审计所有 agent 目录中已安装 skill 的健康度与质量；
- 识别损坏的符号链接、备份残留、安全风险标记、过期或空壳 skill；
- 理解 skill 拓扑：规范来源、符号链接分发、原生 agent skill；
- 获取结构化清单以供治理审查。

本技能遵循"AI 判断，脚本收集"哲学。脚本（`bin/skill-scan.sh`）收集结构化事实，AI 运用专业判断进行解读。它尊重标准 skill 安装模型：skill 安装至 `~/.agents/skills/` 并符号链接至各 agent 目录，这是分发链接，不是重复副本。

### 4) `skill-debug` — Skill 可观测性

适用于无法判断 skill 是否被发现、加载或被 agent 遵循的情况。三个层次：

- **发现诊断**（`skill-probe`）— 从当前工作目录，agent 能看到哪些 skill？
- **激活追踪**（`skill-trace`）— 注入/移除轻量级金丝雀块，追踪 skill 实际被使用的时机。
- **效果仪表盘**（`skill-dashboard`）— 使用频率、僵尸检测、上下文分布、激活率。

与 `skill-hygiene` 结合，形成完整的治理工作流：探测发现 → 检查使用 → 评估质量 → 分类处置。

## 设计原则

贯穿四项技能：

- **AI 判断，脚本收集。** 脚本收集结构化数据，不做决策。AI 凭借专业知识和上下文解读证据。脚本不得剥夺 AI 的判断能力。
- **默认保守。** 若证据不明确，标记观察而非直接建议移除或采取行动。只有在证据明确时才行动。
- **尊重拓扑结构。** 标准模型为：规范 skill 位于 `~/.agents/skills/`，符号链接至 agent 目录（`.claude/skills/`、`.cursor/skills/`、`.codex/skills/` 等）。符号链接是分发链接，不是重复副本。独立项目仓库不是损坏的全局 skill。
- **判断立足证据。** 区分直接证据、推断与不确定性。避免泛泛赞美、夸大声明或照本宣科的规则。
- **保持输入面小。** 尽量从上下文推断模式、深度和语言。
- **优化迁移价值。** 目标不是聪明的观察，而是可操作的洞见。

### 按层次的附加原则

**分析与解读层：**
- 优先选择可见的推理结构，而非无形的分析堆砌。
- 一篇优秀的赏析文章必须兼具技术博客的严谨、教学文本的清晰和可发表文章的可读性。

**治理与可观测层：**
- 不发假警报。一个零激活次数的 skill 可能只是暂时用不上 — "僵尸"是观察，不是判决。
- 所有操作均可撤销。追踪注入可以剥离。扫描只读。仪表盘不修改 skill 文件。
- 所有数据保留本地。不向外部发送任何数据。

## 安装

使用 [skills CLI](https://github.com/vercel-labs/skills) 安装：

```bash
npx skills add yknothing/skills-refiner
```

支持 Claude Code、Cursor、Codex、OpenCode 及[其他主流 agent](https://github.com/vercel-labs/skills#supported-agents)。

## 仓库结构

**分析与解读层：**
- `skills/skills-refiner/SKILL.md` — 审查 / 优化 / 提取 / 整合
- `skills/skills-refiner/references/skill-creator-collaboration.md` — 与 skill-creator 的协作模型
- `skills/skills-appreciation/SKILL.md` — 教学级赏析 / 解读
- `skills/skills-appreciation/references/editorial-checklist.md` — 文章质量检查清单

**治理与可观测层：**
- `skills/skill-hygiene/SKILL.md` — AI 驱动的 skill 评估框架
- `skills/skill-hygiene/bin/skill-scan.sh` — 拓扑与事实收集器
- `skills/skill-hygiene/tests/test-scan.sh` — 集成测试（17 个用例）
- `skills/skill-debug/SKILL.md` — 三层可观测能力
- `skills/skill-debug/bin/skill-probe.sh` — 发现诊断
- `skills/skill-debug/bin/skill-trace.sh` — 激活追踪注入/移除
- `skills/skill-debug/bin/skill-dashboard.sh` — 效果仪表盘
- `skills/skill-debug/tests/test-trace.sh` — 集成测试（8 个用例）
- `skills/skill-debug/tests/test-probe.sh` — 发现探针集成测试
- `skills/skill-debug/tests/test-dashboard.sh` — 仪表盘集成测试

**辅助资料：**
- `examples/` — 四项技能的使用示例
- `evals/` — 评估 rubric、用例与锚点判断（9 个用例，2 个 rubric）

## 快速使用示例

### 分析与解读

```text
# 审查当前仓库
用 skills-refiner 分析这个仓库。

# 审查并整合到目标仓库
用 skills-refiner 分析这个仓库，目标仓库为 yknothing/prodcraft。

# 撰写赏析文章
用 skills-appreciation 分析这个仓库。写一篇深入但可读的文章。

# 解读单个 skill
用 skills-appreciation 分析这个 skill。我想理解它为什么被设计成这个样子。
```

### 治理与可观测

```bash
# 扫描已安装 skill 的健康问题
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh

# 从当前目录，agent 能看到哪些 skill？
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh

# 向所有 skill 注入激活追踪
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/

# 查看使用仪表盘（最近 30 天）
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh

# 综合健康检查
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh --doctor
```

## 评估

`evals/` 目录包含分析类技能的锚点评估：

- `skills-refiner`（用例 01–03、08）— 对象识别、阶段控制、判断质量、证据纪律
- `skills-appreciation`（用例 04–07、09）— 论点清晰度、机制解释、写作质量、低"AI 腔"

用例 08–09 测试与 skill-creator 的协作场景。

治理类技能（`skill-hygiene`、`skill-debug`）通过集成测试验证，测试在沙盒 skill 拓扑中创建环境并验证扫描器/追踪器的正确性。

## 贡献

开发规范请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT
