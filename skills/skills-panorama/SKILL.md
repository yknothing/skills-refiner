---
name: skills-panorama
description: Use when the user wants a readable map of locally installed Agent Skills — what exists in the source store, which Agents see them, whether links and control-catalog intent match reality, and how to triage gaps without mutating anything. Triggers include 技能全景, installed skills overview, topology map, projection drift, and “what is on this machine”.
---

# 技能全景（skills-panorama）

你是本机已部署 Agent Skills 的**只读向导**：先把拓扑摊开，再按缺口分诊该交给谁。

## 硬边界

1. **只读。** 禁止输出删除、修改软链、修改控制清单的具体命令。
2. **不塌缩。** 禁止用「已安装 / 就绪」一类总标签概括多层事实。
3. **不重扫。** 事实来自编排 `skill-scan` 与 collection/catalog；你不发明第二套磁盘遍历。
4. **按任务交接。** 处置评估与可变操作建议属于 `skill-hygiene`。已有授权覆盖的只读评估直接交接并继续；实际变更遵守对应工具的精确计划与确认要求，评估授权不包含变更授权。

## 何时运行收集器

有 shell 且用户要看本机全景时，直接跑：

```bash
SKILLS_REFINER_NODE_BIN=/absolute/path/to/node24 \
  bash ~/.agents/skills/skills-panorama/bin/skill-panorama.sh --yes
```

仓库内开发路径：

```bash
SKILLS_REFINER_NODE_BIN=/absolute/path/to/node24 \
  bash skills/skills-panorama/bin/skill-panorama.sh --yes \
  --hygiene-root skills/skill-hygiene
```

常用逃逸：

| 场景 | 参数 |
|---|---|
| 指定 Agent | `--agents claude,cursor,codex` |
| 零提问 | `--yes` 或非 TTY 或 `--agents` |
| 仅终端 | `--stdout-only` |
| 可分享脱敏 | `--share`（写出 `share.json` / `share.md` / `share.html`） |

权威落盘（本机，覆盖写）：

- `~/Library/Application Support/skills-refiner/panorama/latest.json`
- `~/Library/Application Support/skills-refiner/panorama/latest.md`
- `~/Library/Application Support/skills-refiner/panorama/latest.html`

JSON 是契约权威；Markdown 和 HTML 给人读，三者携带同一 `generation_id`。

先展示收集完整性、缺口数量与下一步，再展示运行时事实；完整来源和生命周期
明细放在报告末尾按需展开。不要让全量明细掩盖需要复核的事项。

`latest.*` 与 `share.*` 都以私有 `0600` 文件逐文件原子替换，并携带同一个 `generation_id` 供跨文件代次核对；既有目标若是 symlink 或非普通文件则拒绝写入。`--share` 会递归脱敏 URL、SSH endpoint、query/fragment、当前 HOME 与其它主机绝对路径。

若任一收集器未完整成功，CLI 仍会在事实可解析时生成报告，但写明 `collectors.status: DEGRADED`、保留结构化 blocker，并以退出码 `3` 结束。调用方不得把“报告已生成”误当成“收集完整”。

## 固定页面 / Canvas 模板

生成或更新全景页面时，使用 [templates/report.html](templates/report.html) 与
[lib/panorama-html.mjs](lib/panorama-html.mjs)，模板标识为 `panorama-report.v1`。
不要另写一次性页面、复制历史数据充当新诊断，或在每次报告中重新设计配色和结构。
同一模板可放入网页或支持 HTML 的 Canvas 宿主；不同报告只替换权威数据。

- 固定浅色背景、深绿色文字和强调色、系统字体、间距、焦点状态及信息层级。
- 页面使用通用技术语言：流程统一为“问题定位 → 修复与优化 → 结果验证”；
  用“来源与路径”“Agent 技能目录”“报告 ID”说明具体对象，避免“拓扑分诊”
  “身份变体”“报告代次”等内部术语。原始 JSON 字段与状态值保持原样。
- 时间统一显示为 `YYYY-MM-DD HH:mm:ss UTC`，不根据本机设置添加城市或地区说明。
- 安装入口按实际文件和来源分组，明确区分实体目录、软链接、链接目标与上游仓库。
  多个软链接指向同一目录时，说明它们共享文件；不要重复显示成多份独立安装。
  上游仓库缺失只表示没有仓库记录。安装历史标明对应路径，不把源目录的安装时间
  当作软链接创建时间；未声明版本号或没有安装记录时，用一句说明代替重复空字段。
- 先展示观察时间、范围、完整性和数量，再展示条目、身份/生命周期证据及复诊条件。
- 默认全部条目；筛选明确显示匹配数/总数，并提供清除筛选。
- 完整报告先写入 HTML。JavaScript 仅增强搜索、筛选与选择，禁用时仍能按名称展开阅读。
- 分栏由容器可用宽度决定；长路径换行，正文使用页面滚动，不固定列表高度或裁切溢出内容。
- 运行时六层事实以可换行的卡片呈现；不使用无法收缩的宽表。
- 模板改动应检查内容完整性、窄面板/宽窗口、底部可达、键盘操作和无脚本阅读。
  静态契约通过不等于完成视觉验收；宿主访问受限时明确未验证项。

## 对人说的六列

| 对人显示 | JSON 键 |
|---|---|
| 身份 | `identity` |
| 源目录里有没有 | `stored` |
| 在哪个 Agent 里出现 | `projected`（按 Agent 分列） |
| 控制清单是否批准启用 | `catalog_active`（无清单为 `absent`） |
| 链接是否完好 | `link_health` |
| 同名记录与加载冲突 | `collision` |

无控制清单时：**不要**把条目判成「清单与现实不符」；仍可归「齐全」。

同名时必须查看 `identity.variants`：每个 variant 独立携带来源身份、内容指纹、canonical target、`catalog_active` 与 `catalog_conformance`。软链接、源码目录、不同仓库或内容差异都不能单独证明命名冲突。静态扫描保留同名记录，标为 `collision.status=unknown`、`assessment=inventory_only`，默认 `preserve`；只有同一宿主加载空间内的冲突证据才能确认 `conflict`。

运行时事实见顶层 `runtime_truth_matrix`，按 Agent 分开呈现 `filesystem`、`deployment`、`catalog`、`body`、`route`、`context`。六层不得互相代证；目录嵌套本身不证明节省 context。

## 八类缺口导航

详见 [references/gap-taxonomy.md](references/gap-taxonomy.md)。

齐全 · 仅在源目录 · 仅在 Agent · 链接损坏 · 清单与现实不符 · 命名冲突 · 部分 Agent 已出现 · 暂无法判定

## 按用户意图继续

用户已要求阅览、继续评估或指定 Agent 时，直接完成对应任务，不重复展示选择菜单。意图未定且下一步会改变范围时，再提供以下选择：

1. **只阅览** — 解说 `latest.md` 总览与分组，结束。
2. **按缺口继续评估** — 进入下方决策卡；继续则**引导打开 `skill-hygiene`**，不代执行突变。
3. **调整 Agent 覆盖范围** — 提示用户下次交互运行（去掉 `--yes`）或使用 `--agents`；全景自身只改本机覆盖配置，不改技能文件。

## 决策卡（需要选择下一步时）

对与任务相关的缺口类或点名条目给出下列信息；已授权继续评估时，把现状、证据、范围和未验证点交给 `skill-hygiene`，无需让用户再次选「继续」：

交接保留 `generation_id`、观察时间、canonical target/identity variant、内容指纹、
所选 Agent 和收集参数；写清待确认的失败条件及预期复诊结果。复诊前保存基线，
避免 `latest.*` 覆盖后只剩新报告。缺口数下降、目标不再出现或命令成功本身不证明修复；
变更后的同一对象与范围、原失败条件和受影响消费者都需相应证据。

| 字段 | 要求 |
|---|---|
| 现状 | 一句人话 |
| 若继续，会做什么 | 明确交给谁（通常是 skill-hygiene） |
| 风险 | 无 / 低 / 中 / 高 + 半句原因 |
| 选择 | 继续评估 / 稍后再说 / 忽略此类 |

默认选择**仅当前会话有效**。仅当用户明确说「记住我的选择」时，才写入本机 triage 偏好。

风险默认见 [references/decision-cards.md](references/decision-cards.md)。

## 解说要点

- 源目录有、Agent 里软链指向它 = 正常分发，不是重复副本。
- `catalog_active: absent` = 未使用成员级控制清单，不是「未批准」。
- `暂无法判定` = 上游收集器字段不足；全景不猜测补全。
- `部分 Agent 已出现` = 源里有，但所选且存在的 Agent 中仅部分有投影；不是齐全，也不是笼统无法判定。
- 分享报告用 `--share` 脱敏副本；本机 `latest.*` 保留真名真路径便于排障。
- `identity_status: ambiguous_name` 表示一个名字对应多个实体；单实体但只有路径证据时是 `path_qualified`，不要退回模糊的 `ambiguous` / `qualified`。

## 相关能力

| 能力 | 岗位 |
|---|---|
| 技能全景（本 skill） | 看清 + 分诊 |
| `skill-hygiene` | 只读评估；实际变更按对应工具的计划与确认要求执行 |
| `skill-debug` | 探针/观测补充（非 V1 必需） |

字段对照全文：[references/field-glossary.md](references/field-glossary.md)
