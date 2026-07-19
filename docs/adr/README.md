# Architecture Decision Records (ADR)

本目录记录 skills-refiner 在 **Agent Skills 部署拓扑、观测与渐进披露** 上的架构决策，作为 `ARCHITECTURE` / 机器侧策略文档的仓库内补充。

## 索引

| ID | 标题 | 状态 | 日期 |
|---|---|---|---|
| [0001](0001-non-invasive-skill-observability.md) | 非侵入式 Skill 用量观测 | Accepted with limitations | 2026-07-17 |
| [0002](0002-on-demand-pack-catalog.md) | On-demand Pack Catalog（目录级渐进披露） | Accepted with limitations | 2026-07-17 |
| [0003](0003-versioned-skill-control-plane-and-physical-collections.md) | 版本资格化的 Skill 控制面与物理 Collection | Accepted with limitations | 2026-07-19 |

## 产物

| 路径 | 说明 |
|---|---|
| [artifacts/skills-pack-catalog.yaml](artifacts/skills-pack-catalog.yaml) | Core / On-demand 包地图（ADR-0002） |
| [artifacts/validate-skills-pack-catalog.mjs](artifacts/validate-skills-pack-catalog.mjs) | Catalog 结构与存在性校验门禁 |

## 对抗性评审与验收

- 评审包：`docs/adversarial-product-pk/2026-07-17-observability-pack-catalog/`
- 验收：`docs/verification/2026-07-17-observability-pack-catalog-acceptance.md`
- ADR-0003 评审包：`docs/adversarial-product-pk/2026-07-19-versioned-skill-control-plane/`
- ADR-0003 验收：`docs/verification/2026-07-19-versioned-skill-control-plane-acceptance.md`

## 约定

1. ADR 编号单调递增；状态使用：`Proposed` / `Accepted` / `Accepted with limitations` / `Superseded` / `Rejected`。
2. 仓库持有公共 architecture/schema/validator authority；机器侧 control root 持有 Owner-approved deployment intent；直接观测持有 runtime reality。任何冲突必须按 authority domain 调和，不能让私人机器实例静默覆盖公共架构，也不能让仓库 catalog 冒充本机实况。
3. 本目录不替代平台厂商文档；引用外部能力时必须标注版本/门禁假设。
