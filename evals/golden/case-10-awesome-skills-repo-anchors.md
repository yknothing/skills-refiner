# Golden anchors — Case 10: awesome-list 风格 skills 仓库评估

## What a strong answer must do

### 对象识别

- 正确识别仓库的双重身份：**awesome-list（发现资源）** + **元技能系统（自我维护工具）**，而非单纯的技能仓库。
- 明确指出 README.md 是核心产品，`.claude/skills/` 是维护辅助层。
- 不将条目数量（数百个链接）等同于技能设计质量或仓库成熟度。

### Stage 控制

- 仅执行 Stage 1。
- 不引入 Stage 2 内容（无 integration planning、无 target_repo 分析）。
- 以 Refinement Judgment 和 Top 3 行动收尾。

### 结构输出

- 必须包含：Executive Summary、定位、核心优势（至少 2 个）、核心弱点（至少 2 个）、Full Review、Refinement Judgment。
- Scorecard 可选但受欢迎。
- 输出需结构清晰，不是 chain-of-thought dump。

---

## Key judgment anchors

### 优势必须识别（至少 2 个）

- README 分类体系清晰，发现效率高（30+ 分类，一致的表格格式）
- 跨平台兼容性覆盖完整（14+ 工具的路径和文档链接）
- 内置贡献约束（无重复 URL 规则、分类决策逻辑）对 agent 辅助维护有价值

### 弱点必须识别（至少 2 个）

- 元技能使用 WebFetch 跳转替代正文内容，破坏渐进式披露合约（至少提到这一点）
- 双重身份（发现工具 vs 技能系统）边界不清，导致设计目标模糊
- 缺乏质量筛选标准，数百个条目无法帮助用户判断设计质量

### Refinement actions（Top 3 中至少包含 1 个）

- 明确仓库身份（discovery index vs skill system）
- 重构元技能正文，去掉 WebFetch 跳转，加入真正可执行的指令和 references/ 子目录
- 在 README 中引入质量分层（featured 区、经过审查的标注等）

---

## Failure signals

以下情况视为**失败**：

- 将链接数量多等同于设计成熟度高
- 未识别出 WebFetch 跳转是结构性缺陷
- 将仓库误判为"设计良好的技能系统"而非"发现资源"
- 激活 Stage 2（无 target_repo）
- 输出无标题结构，呈现为流水文字分析
- 给出"这个仓库覆盖面广，是很好的学习资源"类的模糊结论，未作结构性判断

## Score floor to pass

- 对象识别：≥ 4（必须识别出双重身份）
- Stage 控制：5（不可妥协）
- 判断质量：≥ 3（必须区分 README 价值与元技能质量）
- 证据纪律：≥ 3（不因链接数量多就高分）
- 平均分：≥ 3.5
