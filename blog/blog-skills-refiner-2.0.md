# skills-refiner 2.0：从 Skill 设计判断，到 Skills 系统治理

skills-refiner 1.0 的主题是：skill-creator 能帮你创建和测试 skill，但测试通过不等于设计正确。一个 skill 的定位、边界、上下文工程、可移植性和整合价值，需要另一层判断。

2.0 不是推翻这个定位，而是把它推进了一层。

当你只有一个 skill，问题是它写得好不好。当你有几十个 skills，分布在 `.agents/skills`、`.claude/skills`、`.cursor/skills`、`.codex/skills`，其中有些是 canonical source，有些是 symlink distribution，有些是 native agent skill，有些是旧版本残留，问题就变了。

这时真正的问题不再是“一个 skill 设计得好不好”。

问题是：这个 skills 系统是否仍然可理解、可观察、可治理。

这就是 skills-refiner 2.0 的出发点。

## Skill 变成系统以后，问题的性质变了

一个单独的 skill，更像一个能力单元。你关心它的触发条件是否清楚，指令是否克制，是否浪费上下文，是否把一个问题讲透，是否能被别的项目复用。

这正是 1.0 解决的问题：测试只能证明它在几个已知场景里能跑通，却不能证明它的定位正确、边界清楚、上下文工程合理。一个通过测试的 skill，仍然可能太宽、太模糊、太依赖作者习惯，或者根本不值得长期维护。

但当 skills 变多以后，问题不再只是单体质量。

你会遇到另一类更像软件工程的问题：

- 这个 skill 的真实来源在哪里？
- `.claude/skills/foo` 是一个独立安装，还是指向 `~/.agents/skills/foo` 的分发链接？
- 两个同名 skill 是同一个版本，还是来自不同仓库、不同内容？
- 一个半年没更新的 skill 是稳定，还是已经过时？
- 没有观测到 canary 的 skill，是没被需要，没被发现，还是 agent 没有执行 canary？
- 全局安装目录和仓库源码是否已经漂移？

这些问题不是“多装了几个 skills”那么简单。它们说明 Agent Skills 正在从个人 prompt-like 配置，变成长期存在的本地能力资产。能力资产一旦变多，就需要治理。

## 2.0 的核心原则：AI judges, scripts collect

skills-refiner 2.0 没有选择把治理做成一个粗暴的自动清理器。

它的核心原则是：

> AI judges, scripts collect.

脚本负责收集事实。AI 负责解释事实。人做最终决定。

这是一个很重要的分工。

脚本擅长回答确定性问题：哪些目录存在 `SKILL.md`，哪些 symlink 断了，canonical path 是什么，content hash 是否相同，frontmatter 是否完整，是否出现 `curl | bash` 这类风险信号，canary JSONL 里记录过哪些事件。

脚本不应该回答需要上下文判断的问题：这个 skill 是否应该删除？180 天没更新是不是过期？零 canary 观测是不是异常？某个大 skill 是过度膨胀，还是本来就是一份必要的参考资料？

这些判断需要结合使用场景、团队习惯、来源可信度、上下文成本和实际工作流。硬编码规则很容易制造误报。AI 在有结构化事实输入时，更适合做这类专家判断，但最终动作仍然应该由人确认。

这也是 2.0 不做自动删除的原因。清理是结果，不是起点。治理工具应该先让系统变得可理解，再让判断变得有证据。

## 两层架构：设计判断 + 系统治理

2.0 之后，skills-refiner 不是一组零散脚本，而是两层能力。

第一层是分析与解读。

`skills-refiner` 继续负责单个 skill、skill 仓库或 workflow framework 的设计审计。它关心定位、结构、上下文工程、边界、复用性、成熟度，以及哪些内容应该保留、简化、拆分或拒绝。

`skills-appreciation` 则把这种判断转成可读、可教学、可传播的解释。它不是营销文案生成器，而是帮助读者理解一个 skill 或 skills 系统为什么这样设计，什么值得学习，什么不值得模仿。

第二层是治理与本地证据级可观测性。

`skill-hygiene` 负责安装态治理。它扫描常见 agent-recognized skill directories，区分 canonical skills、symlink distributions、native agent skills 和 project skills；收集 content hash、mtime、provenance、risk indicators、name collisions、broken symlinks 等事实；输出结构化数据，让 AI 基于证据做判断。

`skill-debug` 负责本地证据。它提供三层轻量机制：`skill-probe` 诊断当前目录下可能可见的 skill surfaces；`skill-trace` 注入可逆的 activation canary；`skill-dashboard` 读取本地 JSONL，按 identity 聚合 canary observation。

这四个 skills 组合起来，形成一个完整工作流：

```text
probe：从这里可能看到哪些 skills？
dashboard：本地记录过哪些 canary observation？
scan：安装态拓扑和健康事实是什么？
AI 判断：哪些值得保留、修复、重构、归档或继续观察？
```

这个流程的重点不是“脚本替你做决定”，而是把原本散落在磁盘里的状态，变成 AI 和人都能讨论的证据。

## 拓扑比数量更重要

“skills 装太多了”只是现象。真正的问题是拓扑不可理解。

2.0 明确区分几类对象：

- canonical skills：通常位于 `~/.agents/skills/`，是安装后的主要来源。
- symlink distributions：位于 `.claude/skills/`、`.cursor/skills/`、`.codex/skills/` 等 agent 目录，指向 canonical source。它们是分发关系，不是重复。
- native agent skills：某个 agent 目录里的真实 skill 目录，可能独立安装、独立维护。
- project skills：项目仓库内部的 skills。它们属于项目上下文，不应被误判成坏掉的全局 skill。

这个区分看起来基础，但它决定了治理工具是否可信。

如果一个扫描器把 symlink 当重复，把 workspace 里的 GitHub 项目当坏 skill，把同名 skill 全部合并成一个名字，它就会给出错误建议。错误建议比没有建议更危险，因为它给误删、误归档、误重构披上了“自动化治理”的外衣。

2.0 的身份模型因此不只看 name。它会结合 canonical path 和 content hash 来识别 skill identity。这样，同一个 canonical source 通过多个 symlink 分发时不会被误算成重复；同名但不同来源、不同内容的 skill 也不会被混在一起。

## 可观测性要诚实：canary 是证据，不是证明

Agent Skills 的可观测性很难做。普通用户很难知道 agent 是否真的发现了某个 skill、是否加载了它、是否遵守了它、它对最终输出贡献了多少。

2.0 没有假装能解决完整 Agent Runtime Observability。

`skill-debug` 提供的是本地证据级可观测性。canary 被执行，说明那条 canary 命令被执行过；canary 没有被观察到，不说明 skill 没被发现、没被加载、没被需要，也不说明 skill 没价值。

这条边界必须写清楚。

能准确统计的，是本地可证明的事实：文件拓扑、canonical path、symlink、broken link、content hash、name collision，以及已经写入 JSONL 的 canary events。

不能靠本地轻量脚本准确统计的，是平台运行时内部事实：agent 是否真正加载了 skill，是否严格遵循了全部指令，skill 对输出质量产生了多少贡献。这样的信息应该优先依赖平台原生 telemetry。没有原生 telemetry 时，canary 只能作为 proxy evidence。

这不是缺点。恰恰相反，这是 2.0 比许多“智能治理工具”更可信的地方：它知道自己能证明什么，也知道自己不能证明什么。

## 治理的价值在于克制

skills-refiner 2.0 最值得强调的，不是它扫描了多少字段，也不是它生成了多漂亮的 dashboard，而是它的克制。

它不把 stale 当作坏。默认的 staleness threshold 可以调整，而且旧不等于错。一个一年没更新的 skill 可能已经稳定，也可能已经引用了过时工具。脚本只能报告事实，不能直接下结论。

它不把 not observed 当作 unused。没有 canary observation 只是一条观察，不是删除建议。

它不把 symlink 当 duplicate。symlink 是当前 Agent Skills 安装模型里的分发机制。

它不把安装目录当唯一真相。仓库源码是 source of truth，全局安装目录可能只是 deployment artifact，也可能已经漂移。

它也不自动清理。安全的治理流程应该是：先扫描，再解释，再给出建议，最后由人确认。删除、归档、重构这类动作，应该带着证据发生，而不是被某条规则触发。

## 工程化不是多写脚本，而是建立边界

2.0 的实现里有 shell integration tests，也有 anchor-based evals。前者验证本地拓扑、symlink、broken link、canary injection、dashboard 聚合等行为；后者评估分析类 skills 的判断质量、结构控制、证据纪律和写作质量。

但这些验证本身也有边界。

沙箱测试能证明脚本在模拟拓扑下行为稳定，不能证明所有 agent 平台的运行时发现规则。anchor-based evals 能帮助保持判断质量，不能替代真实团队场景里的使用反馈。

这仍然回到同一个原则：治理系统要建立证据链，也要标注证据链的边界。

## 为什么这件事现在重要

Agent Skills 正在变成一种新的软件资产。

它们不是传统意义上的库，也不是纯文本 prompt。它们介于文档、工具、流程和上下文工程之间。它们会被安装、分发、更新、软链接、复制、修改、废弃。它们会进入 agent 的工作方式，也会影响团队的工程习惯。

只要它们长期存在，就会出现软件工程里熟悉的问题：版本、来源、拓扑、漂移、冲突、安全、可见性、清理、审计。

一个 skill 的时代，关键是把它写好。

一套 skills 系统的时代，关键是知道它们从哪里来，在哪里可见，有什么证据，哪些值得信任，哪些需要继续观察。

skills-refiner 2.0 的价值就在这里：它把 Agent Skills 从“装完就忘”的个人配置，推向可审计、可解释、可治理的本地基础设施。

它不是让 AI 代替人做决定。

它是让 AI 和人终于有足够清楚的事实，去做一个不草率的决定。

## 安装

```bash
npx skills add yknothing/skills-refiner
```

仓库地址：[yknothing/skills-refiner](https://github.com/yknothing/skills-refiner)
