# 当 AI 开始问"我们该怎么工作"：四个 Skills 系统的深度剖析

> 不是更聪明的模型，而是更有纪律的工作方式。

---

## 引言：一个被忽视的断层

今天你打开 Claude Code 或者 Cursor，让 AI 帮你写一段代码，它会写。让它帮你修 bug，它会修。但如果你问它——

"这个功能该不该做？"
"这个架构有没有问题？"
"你昨天帮我踩过的坑今天还记得吗？"

它会沉默，或者给你一个泛泛的答案。

这不是模型能力的问题。GPT-5、Claude Opus 4.6、Gemini 2.5 Pro 都足够聪明。问题出在另一个层面：**工作方式**。

人类软件工程师之所以有效，不只是因为他们会写代码，而是因为他们知道什么时候该停下来想清楚再动手、什么时候该让别人看一眼、什么时候该把踩过的坑写成文档让下一个人少走弯路。这些工作习惯和工程纪律，是软件工程几十年积累下来的东西。模型不缺计算能力，缺的是这些工程常识被系统化地注入到它的工作流程中。

**Agent Skills**，就是把这些工作方式装进 AI 里的尝试。

一个"skill"，本质上是一套写给 AI 的工作指南。它告诉 AI：遇到这种情况，应该先做什么、再做什么、什么不能跳过。它不是让 AI 更聪明，而是让 AI **更有纪律**。

过去一年，出现了几个认真做这件事的开源仓库。截至 2026 年 4 月，它们都已经历了多轮真实使用中的迭代打磨——gstack 迭代到 v0.16，拥有 32+ 个 skill；Superpowers 迭代到 v5.0.7，覆盖 14 个核心 skill；Compound Engineering 发展到 v2.42，内含 40+ 个技能和完整的多 agent 管线；Prodcraft 则构建了一个 47 个 skill 的全生命周期框架。

但如果你把它们放在一起仔细看，会发现一件有意思的事——

**它们解决的，根本不是同一个问题。**

---

## 一个有用的分析框架

想象你正在和 AI 一起做一个真实的软件项目。问自己：**最容易出问题的地方在哪里？**

- 是 AI 不问为什么就动手写？→ gstack
- 是 AI 明知道该先写测试，但每次都跳过？→ Superpowers
- 是上周踩的坑这周又踩了，因为没地方记录？→ Compound Engineering
- 是 skill 数量一多，AI 就不知道该用哪个了？→ Prodcraft

不同的人，对这个问题的答案不同。这四个系统，分别针对四种不同的答案——而且随着各自在真实生产环境中的打磨，它们各自的答案都变得越来越具体、越来越有深度。

---

## gstack：给 AI 装上产品判断力

**核心问题**：AI 会执行，但不会判断这件事值不值得做。

**仓库**：`garrytan/gstack` · v0.16.2.0 · 32+ skills · MIT 协议

### 设计哲学

Garry Tan 是 Y Combinator 的总裁，投资和评审过数百个创业项目。他对 AI 编程助手有一个锋利的判断：**最大的风险不是 AI 写错代码，而是 AI 帮你认真地做了一件不该做的事**。

gstack 的整套设计建立在一个洞察之上：对于独立开发者或小团队创始人来说，产品判断力是最稀缺的资源，而 AI 恰恰在这个维度上最弱。它不会质疑你的需求，只会执行。这意味着你犯的每一个方向性错误，AI 都会帮你高效地放大。

### 核心 skill 深度解析

#### `/office-hours`：YC 式的强制追问（1,825 行）

这是 gstack 的灵魂 skill。它不是一个泛泛的"帮你想清楚"指令，而是一个角色极其具体的追问引擎。它有两种模式：

**Startup 模式**——用六个强制性问题逼你暴露需求的真实面目：

1. **需求真实性**（Demand Reality）：谁在感受这个痛点？你怎么知道的？——把你从假设推向证据。
2. **现状分析**（Status Quo）：他们现在怎么做？哪里坏了？——理解你要替代的是什么。
3. **绝望的具体性**（Desperate Specificity）：给我一个具体的例子。谁？什么时候？发生了什么？——逼你从抽象走向具象。
4. **最窄楔子**（Narrowest Wedge）：最小的可交付版本是什么？你能在一周内发布吗？——阻止范围膨胀。
5. **观察**（Observation）：你注意到了什么让你惊讶的事？——寻找用户研究中的 eureka moment。
6. **未来适配**（Future-Fit）：这如何规模化？不公平的优势在哪里？——确保方向有长期价值。

这六个问题完成后，AI 会提取你自己都没意识到的五个核心能力，提出四个需要挑战的前提假设，给出三种实现路径和工作量估算，最终生成一份设计文档。这份文档会成为**所有下游 skill 的锚点**。

**Builder 模式**——适用于 side project 和开源项目，压力更轻，聚焦学习而非商业化。

一个特别值得注意的最新更新（v0.16.2.0）：**`/office-hours` 现在会记住你**。它根据你的使用次数调整交互方式——第一次是完整的 YC 式面谈；第二次开始会说"欢迎回来，你上次在做 X"；到第四次以后，它能回调你整个 builder 旅程的叙事弧线。这些信息存储在 `.gstack/projects/{SLUG}/builder-profile.jsonl` 中——一个只追加、按项目隔离的个人 builder 档案。

#### `/plan-ceo-review`（1,837 行）与 `/plan-eng-review`（1,431 行）：双重审查管线

CEO review 提供四种 scope 模式：Expansion（做大梦）、Selective Expansion（保持核心+精选扩展）、Hold Scope（最大严格性）、Reduction（剥离到本质）。创始人选择模式，AI 按模式的约束重新审视整个设计文档。

Eng review 则走完全不同的路线：它强迫 AI 画数据流图、定义状态机、枚举所有错误路径、填写测试覆盖矩阵。任何在矩阵中标记为 `✗ MISSING` 的测试用例，会在代码还没写的时候就变成 `/qa` 的工作项。**逼着 AI 画系统图，会把很多藏在模糊语言里的假设暴露出来**——这是这个 skill 的核心洞察。

#### `/learn`：个人化的机构记忆

`/learn` 管理一个 JSONL 格式的知识文件（`~/.gstack/projects/{SLUG}/learnings.jsonl`），记录五种类型的 learnings：

| 类型 | 示例 | 用途 |
|------|------|------|
| pattern | "REST 到 GraphQL 迁移时总是要批量查询" | 复现的解法 |
| pitfall | ".gitignore 变更不会自动 untrack 已提交的文件" | 常见陷阱 |
| preference | "这个 codebase 用 vanilla CSS，不用 Tailwind" | 本地风格 |
| architecture | "认证走 nextauth.js，不是自定义中间件" | 系统设计 |
| tool | "这个 repo 用 vitest，不是 jest" | 工具链选择 |

每条 learning 带有置信度评分（1-10）、来源 skill、关联文件路径和标签。每次运行任何 skill 时，preamble 会自动加载最近 3 条相关 learnings——**这意味着 gstack 的每一次对话，都是在它上一次对话的基础之上的**。

`/learn prune` 会检测过时的 learnings（引用的文件已被删除）和矛盾的 learnings（相同 key 但相反结论），然后请你决定是删除、保留还是更新。

#### 完整的 skill 版图

gstack 不只是一个规划工具。它的 32+ 个 skill 覆盖了从构思到生产监控的完整闭环：

- **思考层**：`/office-hours`、`/plan-ceo-review`、`/plan-eng-review`、`/plan-design-review`、`/plan-devex-review`、`/autoplan`（一键跑完 CEO→设计→工程评审管线）
- **设计层**：`/design-consultation`（设计合伙人）、`/design-shotgun`（一次生成 4-6 个设计变体让你比较）、`/design-html`（mockup→可工作的 HTML，30KB 零依赖）、`/design-review`
- **执行层**：`/review`（Staff 工程师级代码审查）、`/ship`（2,543 行，最大的 skill，从测试→版本号→CHANGELOG→PR→文档更新全自动）、`/land-and-deploy`
- **质量层**：`/qa`（真实浏览器自动化测试，自动生成回归测试）、`/cso`（首席安全官，OWASP Top 10 + STRIDE，17 条内建假阳性排除规则）
- **观察层**：`/browse`（持久化 Chromium 守护进程，~100ms 每条命令）、`/benchmark`（Core Web Vitals 性能基线）
- **安全层**：`/careful`（破坏性命令警告）、`/freeze`（编辑锁定）、`/guard`（安全组合）

这是一个**一个人当一整支团队用**的系统设计。

### 架构亮点：亚秒级浏览器架构

gstack 做了一件大多数 skill 系统不敢做的事：给 AI 装了一个真正的浏览器。

不是截图分析，而是一个**持久化的 Chromium 守护进程**，通过 CDP 协议与 Bun.serve() 服务器通信。第一次调用 3-5 秒启动，之后每次 ~100-200ms。Cookie 保持登录态，localStorage 持久化，Tab 一直开着。

元素寻址不靠 CSS 选择器（CSP 可能拦截，React/Svelte hydration 会清除），而是走无障碍树（accessibility tree）生成 `@e1`、`@e2` 这样的引用——外部于 DOM，不受页面框架干扰。

这意味着 gstack 的 QA skill 可以真正像人一样打开浏览器、点击、输入、验证——而不是猜测页面长什么样。

### 适合谁 / 代价

**最适合**：独立开发者，或一个人带着 AI 快速把想法推进到产品。产品判断力是稀缺资源的场景。

**代价**：强烈的个人风格（Garry Tan 的偏好深度嵌入系统），32 个 skill 之间高度耦合——是一套完整的驾驶舱，零件不容易单独拆用。它假设你会 all-in 使用整个系统。

---

## Superpowers：把工程纪律写成硬约束

**核心问题**：AI 天然倾向于走最短路径，而软件工程的门槛恰恰是反最短路径的。

**仓库**：`obra/superpowers` · v5.0.7 · 14 skills · MIT 协议

### 设计哲学

Jesse Vincent（Prime Radiant 的创始人）对 AI 编程的核心观察可以用一句话概括：**AI 不是不够聪明，而是太擅长走捷径了。**

你说"帮我实现这个功能"，它会跳过需求澄清直接写代码。你说"先写测试"，它假装没听见。Review 环节？象征性过一遍，然后说"没问题"。

软件工程里那些真正重要的门槛——先设计再编码、先写测试再实现、合并前必须过真正的 review——这些门槛的存在价值就在于**给过程人为加摩擦**。它们违反最短路径，这是设计使然。期待 AI 自觉遵守，就是在和它的天性对抗。

Superpowers 的回答很简单：**不要期待自觉，直接写成强制规则。**

### 核心 skill 深度解析

#### `writing-plans`：禁止一切占位符

这个 skill 的目标受众被明确定义为：**一个有技术能力、但对代码库零上下文、品味可疑、没有测试经验的开发者**。换句话说，它假设执行者（无论是子 agent 还是人）只会按字面意思做事，不会自行补全任何信息。

基于这个假设，每个实现步骤必须包含：

1. **完整的代码**——不是"参考上面的实现"，而是可以直接复制粘贴的完整代码块
2. **精确的文件路径**——不是"在某个地方"，而是精确到行号（如 `src/models/user.ts:123-145`）
3. **可直接运行的命令**——不是"运行测试"，而是 `pytest tests/path/test.py::test_name -v`
4. **预期结果**——"Expected: FAIL with 'function not defined'" 或 "Expected: PASS"

明确的禁止清单：

- ❌ `TBD`
- ❌ `TODO`
- ❌ "添加适当的错误处理"
- ❌ "类似上面的做法"
- ❌ "参考 Task N 的实现"
- ❌ "implement later"
- ❌ 任何不完整的代码块

**任何占位符，都是计划失败的标志。**

每个 task 结构强制遵循 TDD 循环：写失败测试→验证它失败→写最小实现→验证它通过→提交。这不是建议，是写在 skill 里的硬性步骤顺序。

v5.0.6 的一个重要更新：plan review 从子 agent review loop 改为**内联自查清单**。之前用子 agent 做 review 需要约 25 分钟，改成内联自查后降到约 30 秒——而回归测试显示质量评分没有下降。这个优化本身就是 Superpowers 设计哲学的体现：**用最简单的手段达到同样的效果**。

#### `subagent-driven-development`：两轮独立评审

执行过程被分解为三个独立角色：

1. **Implementer**（实现者）——一个全新的 AI agent，不继承之前会话的任何上下文。它拿到的只有当前 task 的完整描述和必要的代码库上下文。**上下文隔离是刻意的——防止惯性**。

2. **Spec Compliance Reviewer**（规格符合性审查者）——实现者完成后，一个独立的 reviewer 被派去检查：实现是否完全符合规格？有没有遗漏？有没有多做？有没有理解错？关键指令：**"不要信任实现者的报告——读实际代码，逐行验证。"**

3. **Code Quality Reviewer**（代码质量审查者）——**只有在规格审查通过后才触发**。检查文件职责是否清晰、单元是否可独立理解和测试、文件结构是否符合计划的架构。

**顺序不能颠倒**。这背后有一个关键判断：如果同时检查"做对了吗"和"写得好吗"，AI 会在两者之间模糊处理——它会以"代码质量不错"来模糊"其实没完全按规格来"的事实。拆开后，每个维度上的审查都无处偷懒。

当子 agent 返回状态为 `BLOCKED` 时，system 会评估原因：是缺少上下文？换一个更强的模型？还是任务需要拆分？如果是计划本身的问题，**直接上报人类决策，而不是自己猜着修**。

#### 其他核心 skill

**`test-driven-development`**——铁律：**没有失败测试就没有产品代码**。如果你先写了代码再补测试？删掉代码，从头来。Skill 里内建了对"合理化"的防御：明确列举并反驳"太简单了不用测试""我之后再补""就这一次"这类借口。

**`systematic-debugging`**——铁律：**没有根因调查就没有修复**。四个阶段：根因定位→模式分析→假设与验证→修复与确认。强制科学方法：形成假设→设计实验→验证结果→如果假设错了就回到假设阶段。

**`verification-before-completion`**——门控 skill。任何声称"完成"的操作必须经过：识别验证命令→运行（必须是新鲜运行，不是引用之前的结果）→读取输出→确认声明属实。红旗词："should"、"probably"、"seems"——如果 AI 在声称完成时用了这些词，就是没做验证。

**`brainstorming`**——苏格拉底式对话。一次只问一个问题，根据答案调整下一个问题。探索完毕后提出 2-3 种方案及其取舍。可以启动一个可视化伙伴（零依赖的 Node.js 服务器，30 分钟空闲自动退出）来展示 mockup 和图表。最终输出是一份保存在 `docs/superpowers/specs/` 目录下的设计规格文档，**必须经过用户批准才能进入 writing-plans**。

### 工程实践亮点：零依赖设计

Superpowers 对第三方依赖有近乎偏执的排斥。v5.0.2 把 brainstorm server 从基于 Express + Chokidar + WebSocket 的实现完全重写为只使用 Node.js 内建模块的版本，删掉了约 1,200 行 vendored node_modules。

原因不只是包大小。Skill 系统的设计约束是：它必须在任何环境下都能工作——Claude Code、Cursor、Codex、OpenCode、Gemini CLI、GitHub Copilot CLI——每个平台对依赖的处理方式不同。零依赖意味着不存在"在 A 平台能用但在 B 平台装不上"的问题。

PR 审核率也值得一提：**94% 的 PR 被拒绝**。主要原因是"slop"——agent 没有认真阅读贡献指南就提交的低质量 PR。CLAUDE.md 里对贡献者（包括 AI 贡献者）的要求极其具体：先搜索已有 PR（包括已关闭的）确认不是重复；确认问题是真实的而非推测性的；确认变更属于核心功能而非领域特定；在提交前完整展示 diff 给人类审阅。

### 适合谁 / 代价

**最适合**：团队已明显感受到 AI 的"漂移"——计划与实现脱节、测试被跳过、review 走形式。

**代价**：流程更重。每个 task 都要经过 TDD 循环 + 两轮独立 review，这在需要快速原型验证的场景可能显得过度。但正如 Jesse Vincent 的判断：**可预测性比强大更重要。**

---

## Compound Engineering：让教训不随对话消失

**核心问题**：AI 把这次任务做完了，但上次学到的东西它完全不知道。

**仓库**：`EveryInc/compound-engineering-plugin` · v2.42 · 40+ skills · Claude marketplace 插件

### 设计哲学

Every 是一家 AI 原生媒体公司，由 Trevin Chow 推动工程实践。他们的核心公式是：

> **传统开发积累技术债。每个 feature 增加复杂度。代码库随时间变得越来越难维护。Compound engineering 反转这个逻辑：80% 投入在规划和评审，20% 在执行。目标是让每一次工程工作都使后续工作变得更容易——而不是更难。**

这不只是一个口号。它有一个非常具体的机制支撑：**`docs/solutions/` 目录**——一个结构化的项目知识库，每次解决问题后自动沉淀，每次规划前自动检索。

### 核心 skill 深度解析

#### `/ce:plan`：规划前先检索历史

`/ce:plan` 的第一个动作不是开始规划，而是**发射三个并行的研究 agent**：

1. **`repo-research-analyst`**——分析代码库的架构、模式和约定
2. **`learnings-researcher`**——在 `docs/solutions/` 中搜索是否有相关的过往经验
3. **`slack-researcher`**（可选）——如果用户需要，搜索 Slack 中的组织上下文（决策记录、讨论弧线）

三个 agent 并行运行，各自返回结构化文本。然后主协调器综合这些信息来制定计划。

计划本身**不包含预写的代码**。这是一个刻意的设计决策：计划记录的是决策（decisions）、边界（boundaries）、依赖关系（dependencies）、风险（risks）和测试场景（test scenarios）——而不是实现。原因是：预写代码会在执行阶段造成"锚定效应"，让执行者倾向于照搬而非思考。

一个关键的质量约束：**所有文件引用必须使用仓库相对路径**（如 `src/models/user.rb`），绝对不能用绝对路径。这保证了计划在不同机器、worktree、和团队成员之间的可移植性。

v2.42 的最新更新增加了 scope 子分类和输出结构文档，说明 `ce:plan` 还在持续演化中。

#### `/ce:review`：17+ 个 reviewer persona 的并行管线

这是整个 Compound Engineering 系统中工程量最大的 skill。它不是"一个 reviewer 看一遍代码"，而是一条完整的**多 agent 并行审查管线**。

**永远启用的 6 个 reviewer**（每次 review 都会运行）：
- `correctness-reviewer`：逻辑错误、边界情况、状态 bug
- `testing-reviewer`：覆盖率空白、弱断言
- `maintainability-reviewer`：耦合度、复杂度、命名、死代码
- `project-standards-reviewer`：CLAUDE.md 和 AGENTS.md 合规性
- `agent-native-reviewer`：功能是否对 agent 可访问
- `learnings-researcher`：搜索 `docs/solutions/` 中的相关历史问题

**条件启用的 reviewer**（根据 diff 内容动态选择）：
- `security-reviewer`（涉及认证、公开端点、用户输入时触发）
- `performance-reviewer`（涉及 DB 查询、数据变换、缓存时触发）
- `api-contract-reviewer`（涉及路由、序列化器、类型签名时触发）
- `data-migrations-reviewer`（涉及迁移和 schema 变更时触发）
- `adversarial-reviewer`（diff ≥ 50 行，或涉及认证、支付、数据变更时触发）
- 还有 `reliability-reviewer`、`cli-readiness-reviewer`、`previous-comments-reviewer`、以及多个**技术栈特定 reviewer**（DHH 风格 Rails、Kieran 风格 Python/TypeScript、前端竞态条件检测等）

所有 reviewer 并行运行，各自返回结构化 JSON。然后进入关键的合并阶段：

**去重和置信度标定**——这是这个系统最精妙的设计之一。多人评审真正的问题不是"评审意见太少"，而是"评审意见太多、互相重复、彼此矛盾、噪声满天飞、最后没人知道该听哪条"。去重解决重复，置信度解决"该听谁的"。每条发现（finding）被分为四个严重级别（P0-P3）和四种处置方式（safe_auto: 自动修复安全的、gated_auto: 需确认后自动修复、manual: 需要人工处理、advisory: 仅供参考）。

四种运行模式也体现了对不同场景的精确适配：
- **interactive**（默认）：review + 自动修复安全项 + 呈现发现 + 请求决策
- **autofix**：无交互，只做安全项自动修复，把剩余工作输出为残留清单
- **report-only**：纯只读，可以和浏览器测试并行运行
- **headless**：程序化模式，用于 skill 间调用

#### `/ce:compound`：问题解决后的知识结晶

当一个问题被解决之后，`/ce:compound` 启动一条**四 agent 并行管线**来提取和结构化知识：

1. **Context Analyzer**（上下文分析器）——读取 `references/schema.yaml` 获取规范的枚举值和 track 分类，决定这个问题属于 **bug track**（有 symptoms、root_cause、resolution_type）还是 **knowledge track**（有 applies_when）。确定输出目录路径和文件名。**关键约束：不得凭记忆发明枚举值，必须从 schema 文件中读取。**

2. **Solution Extractor**（解法提取器）——根据 track 类型提取不同结构的内容：

   Bug track 包含：
   - 问题描述（1-2 句话）
   - 症状（可观察的行为、错误信息）
   - **尝试过但无效的方法**（以及为什么无效）
   - 解法（含代码示例，before/after 对照）
   - 为什么有效（根因解释）
   - 预防策略（测试用例、最佳实践）

   Knowledge track 包含：
   - 上下文（促成这条指导的情境）
   - 指导内容（模式/实践 + 代码示例）
   - 为什么重要（理由和影响）
   - 何时适用（条件/情境）
   - 示例（before/after 或用法示例）

3. **Related Docs Finder**（关联文档查找器）——搜索 `docs/solutions/` 中的既有文档。先用 grep 预过滤，再进行深度比较。从五个维度评估重叠度：问题描述、根因、解法方法、引用的文件、预防规则。高重叠（4-5 维度匹配）的文档会被标记为可能需要合并或更新。**它还会检查既有文档是否已经过时、被矛盾或范围过广。**

4. **Session Historian**（会话历史学家，可选）——搜索 Claude Code、Codex、Cursor 的历史会话，通过 repo 名称跨平台关联。如果同一个问题之前被讨论过但没有形成文档，这里能找到。

四个 agent 的结果汇总到主协调器，由主协调器写入**唯一的一个文件**（子 agent 只返回文本，不写文件——这保证了输出的一致性）。

一个对新用户容易忽视的细节：`/ce:compound` 还有一个 **Phase 0.5: Auto Memory Scan**。它会检查 MEMORY.md 中是否有相关笔记，把相关内容传递给研究 agent，并标记来源为 "(auto memory [claude])"——确保记忆来源可追踪。

#### `/ce:compound-refresh`：知识库的主动维护

这个 skill 解决一个真实的问题：**知识库如果只写不读、只增不减，最终会变成垃圾堆**。

它支持两种模式：批量刷新（扫描整个 `docs/solutions/` 目录）和单文档刷新（聚焦特定 learning）。对每篇文档做出五种决策之一：保留、更新、合并（将多篇重叠文档合并为一）、替换、或归档。使用方式类似 `/ce:review` 的置信度标定——不是一刀切，而是基于评估给出推荐。

推荐在以下时机运行：重构后、迁移后、依赖升级后、当检索到的 learning 感觉过时或错误时、当新解决的问题与既有 learning 矛盾时。

### 完整的 skill 版图

除了核心的 plan/review/compound 循环，Compound Engineering 还包含：

- **构思**：`/ce:ideate`（主动发现高影响力改进机会）、`/ce:brainstorm`（交互式需求精化，输出到 `docs/brainstorms/`）
- **执行**：`/ce:work`（系统化执行，管理 worktree 和任务跟踪）
- **会话考古**：`/ce-sessions`（跨 Claude Code / Codex / Cursor 搜索历史会话）
- **协作**：`/resolve-pr-feedback`（并行解决 PR review 意见）、`/todo-resolve`（并行处理 TODO）
- **开发框架**：`dhh-rails-style`（DHH 风格 Rails 代码）、`andrew-kane-gem-writer`（Andrew Kane 风格 Ruby gem）、`dspy-ruby`（DSPy.rb 类型安全 LLM 应用）
- **跨平台转换**：整个插件可以转换为 Codex、OpenCode、Droid、Pi、Gemini、Copilot、Kiro、Windsurf、OpenClaw、Qwen 格式——技能是自包含单元，不存在跨目录引用

### 适合谁 / 代价

**最适合**：规模不大但项目持续时间长的团队，尤其是那些已经开始感受到"同样的问题总是重复出现"的团队。

**代价**：`/ce:compound` 步骤需要额外时间和 token。赶 deadline 时最容易被跳过——但这恰恰是最不应该被跳过的时候，因为赶 deadline 时犯的错最有可能在下次 deadline 再犯。这个悖论没有技术解，只有团队纪律解。

---

## Prodcraft：在混乱开始之前解决路由问题

**核心问题**：其他系统假设你已经知道该干什么了，但混乱往往发生在这之前。

**仓库**：`yknothing/prodcraft` · 47 skills · 9 个生命周期阶段 · 6 种工作流 · 8 种角色

### 设计哲学

前三个系统有一个共同的隐含假设：工作已经进入执行阶段。

但在真实的开发环境里，很多混乱恰恰发生在执行开始之前：这个需求到底是新功能、bug 修复、重构请求、还是技术债？应该从需求讨论开始还是直接进架构设计？走快速迭代还是先写清楚规格？**判断做错了，后面执行越认真，偏差就越大。**

Prodcraft 的回答是：构建一个覆盖软件开发全生命周期的框架，用**入口控制**和**方法学适配器**来确保每一项工作都从正确的起点、用正确的方式开始。

它的四个结构性创新：

1. **Intake-First Design**（入口优先设计）：每个交互都从 `intake` 开始分诊
2. **Phase-Aware Skills**（阶段感知的 skill）：每个 skill 知道自己在生命周期中的位置
3. **Methodology Adapters**（方法学适配器）：相同的 skill 在不同方法学下被不同地编排
4. **Quality Gates**（质量门）：阶段转换有显式的入口/出口标准

### 核心 skill 深度解析

#### `intake`：系统的入口控制点

`intake` 是 Prodcraft 的灵魂。它的工作不是帮你做设计，而是**决定路由**。

任何新工作进入系统，都必须先经过 intake。它的处理流程：

**Step 1: 静默探索上下文**——读项目文档（CLAUDE.md、README、最近的 commit）、识别项目状态、检查已有的规格、架构文档、设计决策，注意技术栈、团队惯例、约束。

**Step 2: 分类工作类型**——这是 intake 最核心的输出：

| 工作类型 | 入口阶段 | 默认工作流 |
|----------|----------|-----------|
| 新产品 | 00-discovery | agile-sprint (greenfield overlay) |
| 新功能 | 01-specification | agile-sprint |
| 增强 | 03-planning | agile-sprint |
| Bug 修复 | 04-implementation | agile-sprint |
| 热修复 | 04-implementation | agile-sprint (hotfix overlay) |
| 重构 | 04-implementation | agile-sprint |
| 迁移 | 00-discovery | agile-sprint (brownfield overlay) |
| 技术债 | 03-planning | agile-sprint (brownfield overlay) |
| Spike/调研 | 00-discovery | agile-sprint |
| 文档 | cross-cutting | agile-sprint |

**Step 3: 提问**——一次一个问题，根据回答调适下一个问题。预算：通常 1-3 个问题，最多 5 个。优先级：目标→范围→紧急程度→约束→质量标准。

**Step 4: 提议方案**——产出结构化的 `intake-brief`，包含：工作类型、入口阶段、推荐的工作流（主工作流 + overlay）、3-7 个具体需要的 Prodcraft skill、范围评估、路由理由、关键风险、**明确的下一步应调用哪个 skill**。

**Step 5: 获得批准**——等待用户确认后才进入下一步。接受批准、调整或"跳转到 X"。

**Step 6: 移交**——如果路由清晰但问题/方案方向还模糊，移交给 `problem-framing`，而不是自己膨胀成设计会议。

intake 的三种模式很能说明它对不同场景的适配力：
- **full**——新工作、模糊需求、高影响力任务，做完整的路由分析
- **fast-track**——小的、清晰的工作，路由显而易见（但必须记录快速通道理由）
- **resume**——继续已批准的路由，不改变方向

**硬门禁规则**：在 intake 决策完成、intake-brief 被批准、下一个 skill 被明确命名之前，不得开始任何实现、架构或规划工作。

#### `_gateway.md`：系统的路由逻辑（288 行）

这个文件定义了整个 Prodcraft 系统的寻路规则。核心规则：

> **每个交互都从 skill matching 开始。无例外。**

它定义了三个优先级层：

**Priority 1: 流程门控（阻塞性的）**

| 触发条件 | 必须调用的 Skill | 原因 |
|----------|-----------------|------|
| 任何新工作 | `intake` | 分诊和路由 |
| Bug/测试失败→修复之前 | `systematic-debugging` | 先找根因 |
| 即将开始实现 | `tdd` | 测试在代码之前 |
| 代码完成，准备合并 | `code-review` | 质量门控 |
| 即将声称"完成" | `verification-before-completion` | 验证声明 |

**Priority 2: 阶段特定 skill**——按生命周期阶段匹配：
- 00-discovery → problem-framing, market-analysis, user-research, feasibility-study
- 01-specification → requirements-engineering, domain-modeling, spec-writing
- 02-architecture → system-design, api-design, data-modeling, security-design, tech-selection
- 03-planning → task-breakdown, estimation, risk-assessment, sprint-planning
- 04-implementation → task-execution, systematic-debugging, tdd, feature-development, refactoring
- 05-quality → code-review, receiving-code-review, testing-strategy, security-audit
- 06-delivery → ci-cd, deployment-strategy, release-management, delivery-completion
- 07-operations → monitoring-observability, incident-response
- 08-evolution → retrospective, tech-debt-management

**Priority 3: 跨阶段 skill**——任何阶段都可能用到：documentation, observability, accessibility, internationalization, compliance

最具设计哲学代表性的是**八对跨阶段课程更正跳转**（course-correction jumps）：

```
04-implementation → 01-specification
04-implementation → 02-architecture
05-quality        → 02-architecture
07-operations     → 02-architecture
07-operations     → 03-planning
08-evolution      → 01-specification
08-evolution      → 02-architecture
08-evolution      → 03-planning
```

**这就是完整的允许列表。** 任何超出这 8 对的跳转都是无效的。每次课程更正必须记录：触发原因和证据、被阻塞的产出物、仍然有效的约束、推荐的下一个 skill、用户是否需要重新批准路由。

为什么要把它限定为 8 对而不是让它自由跳转？因为**自由跳转会让系统在不知不觉间退化为无序状态**。当一个系统有 47 个 skill 和 9 个阶段时，如果任何阶段可以跳转到任何阶段，那路由规则就等于没有。8 对跳转是经过反复评估确定的——它们覆盖了真实工程中确实会发生的"发现上游问题"的场景，同时排除了那些"走捷径绕过流程"的滥用场景。

#### `problem-framing`：intake 之后、执行之前

当 intake 完成了路由，但问题/方案方向还不够清晰时，`problem-framing` 介入。它的工作是把批准的路由转化为清晰的问题陈述和少量可决策的选项。

输出三个产出物：
1. **problem-frame**——问题描述、约束、非目标、假设、开放问题
2. **options-brief**——2-3 个可行方向，每个注明为什么可行、优化了什么、风险和推迟了什么、什么情况下应该否决
3. **design-direction**——推荐选项、为什么胜出、下游 skill 需要知道什么、下一个生命周期目的地

它不做具体设计——只做**方向性决策**。"保持在产品/方案方向的层面，不要下沉到低层实现细节。"

### 完整的生命周期

Prodcraft 定义了一个完整的九阶段生命周期，每个阶段之间有显式的质量门控：

```
Discovery ──[可行性批准]──> Specification
    ──[规格审查签核]──> Architecture
    ──[设计评审通过]──> Planning
    ──[任务估算并分配]──> Implementation
    ──[全部测试通过，代码已 review]──> Quality
    ──[QA 签核，安全审查通过]──> Delivery
    ──[部署验证，回滚已测试]──> Operations
    ──[SLO 满足，运行手册已验证]──> Evolution
    ──[回顾完成]──> Discovery（下一个周期）
```

六种工作流（3 主 + 3 叠加层）适配不同的方法学：
- **spec-driven**：里程碑驱动、深度前期文档、适合受监管/安全关键/合同约束的工作
- **agile-sprint**：1-2 周冲刺、just-enough 规划、适合产品团队和 SaaS
- **iterative-waterfall**：阶段门控、适合企业和大型团队
- **greenfield overlay**：新项目从零开始
- **brownfield overlay**：遗留系统现代化
- **hotfix overlay**：生产紧急事件

### Skill 成熟度管理

Prodcraft 对 47 个 skill 做了三级成熟度分类：

- **TESTED**（24 个）：有基准测试证据，生产就绪
- **REVIEW**（7 个）：高级测试进行中
- **EXPERIMENTAL**（16 个）：新增或开发中

每个 skill 在 `manifest.yml` 中跟踪结构验证路径、评估策略路径、基准计划、基准结果、集成测试、发现记录、重设计笔记、重验证计划。`scripts/validate_prodcraft.py` 做结构化验证。

从最近的提交历史来看（2026 年 4 月），Prodcraft 正在密集地推进 skill 成熟度毕业——从 experimental 到 review 到 tested——这说明系统正在从"框架搭建完毕"过渡到"逐一验证每个零件确实能用"的阶段。

### 适合谁 / 代价

**最适合**：团队规模够大、工作类型够多元、已经开始认真考虑"如何让 skills 系统稳定运转"的阶段。47 个 skill 需要有足够的工作量来喂养。

**代价**：前期学习曲线是四个系统中最陡的。你需要理解生命周期框架、工作流适配器、质量门控体系、路由逻辑——然后才能开始有效使用。但一旦理解了框架，它提供的是其他系统无法匹敌的**可预期性和可审计性**。

---

## 四个系统的横向对比

### 规模与覆盖范围

| 维度 | gstack | Superpowers | Compound Engineering | Prodcraft |
|------|--------|-------------|---------------------|-----------|
| Skill 数量 | 32+ | 14 | 40+ | 47 |
| 最新版本 | v0.16.2.0 | v5.0.7 | v2.42 | 持续迭代 |
| 覆盖范围 | 构思→生产监控 | 设计→交付 | 构思→知识沉淀 | 发现→演进（全生命周期） |
| 浏览器集成 | 是（Chromium 守护进程） | 否 | 是（agent-browser） | 否 |
| 多平台 | Claude Code 原生 | Claude/Cursor/Codex/OpenCode/Gemini/Copilot | 11+ 平台转换 | Claude Code 原生 |
| 生命周期阶段 | 隐式（Think→Plan→Build→Ship→Reflect） | 隐式（Brainstorm→Plan→Execute→Review） | 隐式（Brainstorm→Plan→Work→Review→Compound） | 显式（9 阶段 + 质量门控） |

### 核心设计决策的对比

| 设计问题 | gstack | Superpowers | Compound Engineering | Prodcraft |
|----------|--------|-------------|---------------------|-----------|
| 如何确保 AI 做对的事？ | 角色扮演+强制追问 | 禁止清单+硬约束 | 历史检索+知识复用 | 入口分类+路由控制 |
| 如何处理 review？ | 单 agent Staff 级 review | 两轮独立 review | 17+ persona 并行管线 | 多模式 code-review skill |
| 如何处理知识积累？ | `/learn` JSONL 文件 | 无（依赖 skill 本身的约束） | `docs/solutions/` 结构化知识库 | `_quality-assurance.md` 成熟度跟踪 |
| 如何处理过时知识？ | `/learn prune` | N/A | `/ce:compound-refresh` | manifest.yml 跟踪 + 定期评估 |
| 子 agent 策略 | 无（单 agent 闭环） | 每 task 一个隔离子 agent | 并行多 persona agent | 角色 persona 协作模式 |
| 方法学适配 | 固定（YC 式）| 固定（TDD + 两轮 review） | 灵活（但无显式框架） | 显式适配器（6 种工作流） |

### 对"AI 最缺什么"的不同判断

| 系统 | 核心诊断 | 解决方案 |
|------|----------|----------|
| gstack | 缺**产品判断力** | 给 AI 装上 YC 合伙人的视角 |
| Superpowers | 缺**过程纪律** | 把建议变成约束 |
| Compound Engineering | 缺**知识留存** | 让知识沉淀成为工作流标配 |
| Prodcraft | 缺**入口治理** | 所有工作先过分诊台 |

---

## 这四个系统教给 skill 设计者的事

把这四个系统放在一起看，最有价值的不是"哪个更好用"，而是它们各自揭示了一个 skill 设计的核心命题。

### 命题一：判断力可以编码，但需要具体的角色（gstack）

"帮我想清楚"太抽象。`/office-hours` 之所以有效，是因为它给 AI 装了一个极其具体的视角：**YC 合伙人用来拆解创业项目的六个问题**。这个视角有明确的提问策略、有历史锚点、有可预期的质疑角度。

推广到 skill 设计：**如果你想让 AI 在某个维度上做出判断，不要写"请仔细思考"，要定义一个角色、一套问题框架、一个预期的输出格式**。角色越具体，追问越有效。

### 命题二：建议会被忽略，约束不会（Superpowers）

"应当先写测试"和"测试必须在实现之前，违反则任务不通过"——这两句话的效果天差地别。

Superpowers 的贡献是：它证明了**把工程实践写成显式的硬门槛，比写成建议有效得多**。这不仅对 AI 成立，对人也成立。关键的区别在于：建议留给执行者一个"这次情况特殊"的出口，约束堵死了这个出口。

推广到 skill 设计：**对于你真正在乎的工程实践，写成约束而不是建议。定义"违反约束时应该发生什么"。如果你不定义违反后果，就等于没有约束。**

### 命题三：知识沉淀要是流程的标配，不是附加项（Compound Engineering）

`/ce:compound` 在解决问题之后**立刻运行**，是整个循环的标准收尾步骤，不是"如果有时间就做"的额外工作。这个设计选择的意义在于：只有把沉淀嵌入到流程中——让它成为"完成"的定义的一部分——它才能真正积累起来。

而 `/ce:compound-refresh` 的存在揭示了另一面：**知识库不是只写的，需要主动维护**。不被维护的知识库不仅没价值，还有害——因为它给人（和 AI）一种"这里有答案"的虚假信心，而答案可能已经过时。

推广到 skill 设计：**如果你希望 AI 具有长期记忆，你不仅需要"写入"机制，还需要"清理"机制。而且两者都必须是工作流的一部分，不能是可选的。**

### 命题四：系统规模越大，入口控制越关键（Prodcraft）

当 skill 数量超过十几个，"让 AI 自己判断该用哪个"会开始失灵——触发条件模糊、技能相互干扰、同一类工作每次走不同路径。

Prodcraft 的 `intake` 和 `_gateway.md` 本质上是一个**路由层**。它的存在不是为了增加步骤，而是为了让路由变得可预期、可审计——当一个 bug fix 每次都走相同的路径，你才能有信心说"这个路径是对的"；当它每次走不同路径，你连哪次对了都不知道。

八对跨阶段跳转被写成**机器验证的约束而不是文档建议**，是因为 Prodcraft 的设计者深刻理解一个现实：**文档建议的边界会随时间悄悄扩展，直到系统在不知不觉间失控**。只有可机器验证的约束才能抵抗这种熵增。

推广到 skill 设计：**如果你的 skill 系统超过 15 个技能，你需要一个显式的路由层。如果你有流程规则，尽可能把它们写成可机器检查的约束，而不是自然语言的建议。**

---

## 组合的可能性

这四个判断都有道理，也可以同时成立。

一个足够成熟的团队可能会发现自己同时需要：
- gstack 的**产品追问**——在动手之前确保方向正确
- Superpowers 的**过程纪律**——在执行中确保步骤不被跳过
- Compound Engineering 的**知识复利**——在完成后确保经验不丢失
- Prodcraft 的**入口治理**——在一切开始之前确保路由正确

事实上，如果你仔细看这四个系统的演化方向，会发现它们正在向彼此靠近——gstack 加了 `/learn`（知识积累），Compound Engineering 加了 `/ce:brainstorm`（前期追问），Prodcraft 加了 `verification-before-completion`（过程约束），Superpowers 加了 `brainstorming`（方向探索）。

但它们各自的**重心**仍然不同，这意味着你的选择取决于你的**最紧迫的问题**。

**真正的问题不是"哪个系统更好"，而是"我们团队现在最缺哪一种"。**

这个问题想清楚了，后面的选择才有方向。

---

*本文基于以下仓库的最新主分支版本分析（2026 年 4 月）：[garrytan/gstack](https://github.com/garrytan/gstack) v0.16.2.0 的 32+ skill 文件与 ARCHITECTURE.md、ETHOS.md；[obra/superpowers](https://github.com/obra/superpowers) v5.0.7 的 14 个 skill 目录、CLAUDE.md 与 RELEASE-NOTES.md；[EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) v2.42 的 40+ skill 目录、agents/ 目录与 README.md；[yknothing/prodcraft](https://github.com/yknothing/prodcraft) 的 47 skill 文件、skills/\_gateway.md、workflows/ 目录与 manifest.yml。*
