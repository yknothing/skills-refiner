# 字段对照

| 对人显示 | JSON 键 | 说明 |
|---|---|---|
| 身份 | `identity` | 名字、路径、内容指纹；可知时含仓库/版本 |
| 源目录里有没有 | `stored` | 全局源或物理集合中是否有实体 |
| 在哪个 Agent 里出现 | `projected` | **按 Agent 分列**，不是单个「已分发」布尔 |
| 控制清单是否批准启用 | `catalog_active` | `active` / `inactive` / `absent` / `unknown` |
| 链接是否完好 | `link_health` | `ok` / `broken` / `unexpected_target` / `not_applicable` / `unknown`；外部但可达仍是 `ok`，只有权威计划给出期望目标时才可判 `unexpected_target` |
| 是否撞名/撞内容 | `collision` | `none` / `conflict` / `unknown` |
| 缺口类（衍生） | `gap_class` | 八类中文名之一（稳定英文 id 见 gap-taxonomy）；由上表可逆推导 |

`identity.catalog_members` 保存受管 `INDEX.json` 声明的成员路径、tree digest 与 no-follow 存在性观察。它仍属于「身份」原子列，用于区分「集合成员未被 scanner 展开」和「声明路径真实缺失」。

`identity.variants[]` 是同名身份的精确事实面。每个 variant 单独保存 `entity_id`、仓库/修订/source path、canonical target、内容指纹、`catalog_active` 和 `catalog_conformance`。顶层 `catalog_active` 只有在所有 variant 一致时才复述该值；混合状态为 `unknown`，不会把一个仓库的批准误套到另一个同名仓库。`identity_status` 使用 `ambiguous_name`、`source_qualified`、`collection_qualified`、`path_qualified` 或 `unqualified`。

`identity.review_signals` 原样聚合 scanner 已给出的 `risk_indicators` 与 `hygiene_flags`；它是可追溯的治理复核证据，不参与八类拓扑缺口推导。`review_required` 只表示需要人工查看，不等于已确认漏洞。

顶层 `managed_collections` 不是技能行的第七个布尔字段，而是集合控制面的独立状态：文件系统、运行时、上游版本证据与 issues 不得相互塌缩。

顶层 `runtime_truth_matrix` 按 Agent 将 `filesystem` / `deployment` / `catalog` / `body` / `route` / `context` 六层分开。`context.result=unverified` 时禁止推断目录索引已经节省 context；`cursor.deployment.result=observe_only` 也不得冒充已部署。

顶层 `collectors` 保存 `status`、`completeness`、`degraded_reasons` 与结构化 `blockers`。可解析的非零收集器输出会保留事实并标记 `DEGRADED`，CLI 返回 3。

## 禁止字段

不得出现：`installed`、`ready`，或任何把未知谓词塌缩成单一绿灯的汇总枚举。
