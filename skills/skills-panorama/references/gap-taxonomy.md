# 八类缺口

Markdown 主导航**只使用**下列中文类名。推导规则由六列原子字段可逆得出；实现见 `lib/panorama-gaps.mjs`。  
稳定英文 id 仅供代码/契约对照（禁止 `installed` / `ready`）。

| 类名 | 稳定英文 id | 含义 | 主要谓词 |
|---|---|---|---|
| 齐全 | `complete` | 源里有、**全部**所选且目录存在的 Agent 均有健康投影；无清单或清单一致 | `stored` + 全投影 + `link_health` 正常；清单非漂移 |
| 仅在源目录 | `source_only` | 源里有，所选 Agent 都没出现 | `stored` 且无投影 |
| 仅在 Agent | `agent_only` | Agent 里有，对不上源 | 有投影且 `stored=false` |
| 链接损坏 | `broken_link` | 有投影但失效，或权威计划证明目标偏移 | `link_health` 为 broken / unexpected_target；外部但可达不算损坏 |
| 清单与现实不符 | `catalog_drift` | 批准了但磁盘没有，或受管宇宙内未批准却在盘上 | 仅 `catalog_mode=members` |
| 命名冲突 | `name_collision` | 同名对应多个实体；包括同内容但跨仓来源 | `collision.status=conflict` |
| 部分 Agent 已出现 | `partial_projection` | 源里有；所选且目录存在的 Agent 中有的出现、有的没有 | `stored` + 部分投影 |
| 暂无法判定 | `unknown` | 上游字段不足 | `unknown` 谓词 |

## 特判

- **无控制清单：** `catalog_active=absent`，**不得**归入「清单与现实不符」；拓扑一致仍可「齐全」。
- **部分 Agent 已出现（第八类，O9=C）：** 独立缺口位；**不得**标「齐全」，也**不得**笼统归「暂无法判定」。
- **优先级覆盖：** 链接若损坏 →「链接损坏」；命名冲突 →「命名冲突」；二者均优先于「部分 Agent 已出现」。
- **同名同内容跨仓：** 内容相同不等于身份相同；不同仓库/canonical target 仍保留为多个 `identity.variants`，默认处置为 `preserve`。
- **分类优先级：** 链接损坏 > 命名冲突 > 清单与现实不符 > 部分 Agent 已出现 > 仅在 Agent > 仅在源目录 > 暂无法判定 > 齐全。
