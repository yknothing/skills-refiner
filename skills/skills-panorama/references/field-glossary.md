# 字段对照

| 对人显示 | JSON 键 | 说明 |
|---|---|---|
| 身份 | `identity` | 名字、路径、内容指纹；可知时含仓库/版本 |
| 源目录里有没有 | `stored` | 全局源或物理集合中是否有实体 |
| 在哪个 Agent 里出现 | `projected` | **按 Agent 分列**，不是单个「已分发」布尔 |
| 控制清单是否批准启用 | `catalog_active` | `active` / `inactive` / `absent` / `unknown` |
| 链接是否完好 | `link_health` | `ok` / `broken` / `unexpected_target` / `not_applicable` / `unknown` |
| 是否撞名/撞内容 | `collision` | `none` / `conflict` / `unknown` |
| 缺口类（衍生） | `gap_class` | 八类中文名之一（稳定英文 id 见 gap-taxonomy）；由上表可逆推导 |

## 禁止字段

不得出现：`installed`、`ready`，或任何把未知谓词塌缩成单一绿灯的汇总枚举。
