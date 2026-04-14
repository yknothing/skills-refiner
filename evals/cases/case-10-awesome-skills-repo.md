# Case 10 — Stage 1: awesome-list 风格 skills 仓库评估

## Input

使用 `skills-refiner` 对以下仓库进行评估。无 `target_repo`。

---

**源仓库：** `gmh5225/awesome-skills`

**可用证据：** README.md（55KB）及 `.claude/skills/` 下 8 个元技能的 SKILL.md 文件。

**仓库概述：**

`gmh5225/awesome-skills` 是一个 awesome-list 风格的资源聚合仓库，收录了 AI 编程 agent（Claude Code、Codex、Gemini CLI、GitHub Copilot、Cursor 等）可用的技能资源和工具。

仓库包含两个主要组成部分：

1. **README.md（核心产品）**：55KB，涵盖官方技能（Anthropic、OpenAI、HuggingFace）、团队技能（Trail of Bits、Vercel、Sentry、Expo）、社区技能（30+ 子分类）、工具和教程。每条目均附有一句描述。

2. **`.claude/skills/`（元技能层）**：8 个技能目录：
   - `overview` — 项目概述与贡献指导
   - `skill-creation` — SKILL.md 格式与最佳实践
   - `claude-code` — Claude Code 安装与使用
   - `security-skills` — 安全相关技能的分类指导
   - `ai-llm-skills`、`dev-tools-skills`、`marketing-skills`、`platforms` — 其他主题技能

各元技能均以相同的 WebFetch 模板结尾，指向 README 的 raw URL 作为"完整资源列表"。

---

## Expected behavior

- 正确识别对象：这是一个 awesome-list，同时附带自我维护用的元技能层，不是纯粹的技能系统。
- 仅执行 Stage 1，不激活 Stage 2（无 target_repo）。
- 输出包含：Executive Summary、定位分析、核心优势、核心弱点、完整评审、Scorecard、Refinement Judgment、四象限提取、Top 3 行动。
- 不因条目数量多（数百个链接）而误判为"设计成熟的技能系统"。
- 识别 WebFetch 跳转模式对渐进式披露的破坏。
- 区分 README 作为发现资源的价值，与元技能作为技能设计的价值。

## Dimensions primarily tested

- 对象识别（识别出这是 awesome-list，而非普通技能仓库）
- Stage 控制（Stage 1 only）
- 判断质量（区分 README 价值与元技能设计质量）
- 证据纪律（不因链接数量多就等同于设计成熟度高）
- 双重身份识别（同一仓库两种功能的边界分析）
