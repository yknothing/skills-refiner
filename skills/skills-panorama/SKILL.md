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
4. **不代替 hygiene。** 处置评估与可变操作建议属于 `skill-hygiene`，且需用户二次确认。

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
| 可分享脱敏 | `--share`（写出 `share.json` / `share.md`） |

权威落盘（本机，覆盖写）：

`~/Library/Application Support/skills-refiner/panorama/latest.json`  
`~/Library/Application Support/skills-refiner/panorama/latest.md`

JSON 是契约权威；Markdown 给人读。

## 对人说的六列

| 对人显示 | JSON 键 |
|---|---|
| 身份 | `identity` |
| 源目录里有没有 | `stored` |
| 在哪个 Agent 里出现 | `projected`（按 Agent 分列） |
| 控制清单是否批准启用 | `catalog_active`（无清单为 `absent`） |
| 链接是否完好 | `link_health` |
| 是否撞名/撞内容 | `collision` |

无控制清单时：**不要**把条目判成「清单与现实不符」；仍可归「齐全」。

## 八类缺口导航

详见 [references/gap-taxonomy.md](references/gap-taxonomy.md)。

齐全 · 仅在源目录 · 仅在 Agent · 链接损坏 · 清单与现实不符 · 命名冲突 · 部分 Agent 已出现 · 暂无法判定

## 总菜单（少打字）

向用户展示三选一：

1. **只阅览** — 解说 `latest.md` 总览与分组，结束。
2. **按缺口继续评估** — 进入下方决策卡；继续则**引导打开 `skill-hygiene`**，不代执行突变。
3. **调整 Agent 覆盖范围** — 提示用户下次交互运行（去掉 `--yes`）或使用 `--agents`；全景自身只改本机覆盖配置，不改技能文件。

## 决策卡（选「按缺口继续」后）

对每一类（或用户点名的条目）给出：

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

## 相关能力

| 能力 | 岗位 |
|---|---|
| 技能全景（本 skill） | 看清 + 分诊 |
| `skill-hygiene` | 评估 + 可变操作建议（需确认） |
| `skill-debug` | 探针/观测补充（非 V1 必需） |

字段对照全文：[references/field-glossary.md](references/field-glossary.md)
