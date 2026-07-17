# ADR-0002: On-demand Pack Catalog（目录级渐进披露）

- **Status:** Accepted with limitations  
- **Date:** 2026-07-17  
- **Deciders:** Product owner (host machine) + skills-refiner maintainers  
- **Depends on:** ADR-0001（观测不依赖改 skill；pack mount 可作为治理信号）  
- **Related:** machine `SCALE-ANALYSIS-2026-07-17.md`; Agent Skills progressive disclosure  

## Context

单个 skill 内部已有业界共识的三层渐进披露：

1. `name` + `description`（发现）  
2. `SKILL.md` 正文（激活）  
3. references / scripts（执行）  

但当全局 deploy 面达到 **~100+ skills** 时，**仅做 skill 内 PD 不够**：所有 description 仍会进入路由上下文（本机曾达 ~7k+ tokens）。需要 **目录级（catalog / pack）披露** 作为补充。

业界对齐形态包括：Cloudflare `index.json` discovery RFC、Microsoft `skill://index.json` + `load_skill`、以及运维侧的 profile/pack 挂载。

## Decision

引入 **Pack Catalog** 作为部署编排契约（不是改写 skill 正文）：

```text
会话 / 工作域
  → 读短 Catalog（Core + 可选包列表）
  → 命中域 → 挂载对应 pack（发现面 symlink / profile）
  → 宿主对已挂载 skill 做标准 L1/L2/L3
  → 未挂载 skill 不进入 description 预算
```

### Binding rules

1. Catalog 是 **部署意图**；在挂载工具落地前，不得声称“已节省 context”。  
2. **禁止** 把全量 skill description 再抄进一个“超级索引 skill”（税换抽屉）。  
3. Pack 边界必须可叙述（单一职责域）；路由器/索引文本保持短。  
4. 不修改第三方 skill 正文以实现 On-demand。  
5. 退役包（如 Lark）只出现在 Archive 引用，不出现在可挂载 pack。  
6. Core 名单是 Owner 可修订的假设，须用 ADR-0001 的非侵入信号迭代，而非臆测永久正确。

### Artifact

权威草稿：

[`artifacts/skills-pack-catalog.yaml`](artifacts/skills-pack-catalog.yaml)

校验门禁：

```bash
node docs/adr/artifacts/validate-skills-pack-catalog.mjs
```

## Pack model

| 层 | 名称 | 行为 |
|---|---|---|
| Core | `profile: core` | 默认应出现在主 Agent 发现面 |
| On-demand | `packs.*.mount: on_demand` | 按工作域挂载 |
| Archive | `archive` | 仅 shelf / 策略引用，不挂载 |

### Design constraints (Done 方向)

- 主发现面 skill 数目标：**≤ 80**，或 description 预算目标：**≤ ~4k tokens**（与机器侧 SCALE 分析一致，属目标而非当前事实）。  
- Catalog 自身（不含全量 description）应保持可读、可人工 diff。

## Consequences

### Positive

- 与 Agent Skills PD 互补，直击“description 路由税”。  
- 与隔离/退役策略同构（Lark shelf 即 Archive）。  
- 为未来 mount CLI / profile 切换提供稳定输入。

### Negative / limitations

- **当前未实施挂载运行时**：今日 Claude/Factory 仍可能看到几乎全量 symlink；Catalog  alone 不改变行为。  
- Core 名单在缺少真实用量数据时带有主观性（鸡生蛋：观测 ADR-0001）。  
- 切错 pack 会导致“skill 找不到”，需 UX/文档说明。  
- 部分 Agent（Cursor）本就不是全量镜像 `~/.agents/skills`，pack 模型收益因宿主而异。

### Non-goals

- 本 ADR 不交付语义检索引擎。  
- 不强制合并 `prodcraft` / `loopos` / `grilling` 控制面（见机器 `CONTROL-PLANE.md`）。  
- 不自动删除 On-demand 包磁盘副本。

## Implementation stages

| Stage | Deliverable | Context savings? |
|---|---|---|
| S0 (本交付) | Catalog YAML + 校验 + ADR | 否（契约） |
| S1 | `skills-pack-mount`（或等价）按 profile 增删发现面 symlink | 是（对支持全量发现的宿主） |
| S2 | 会话启动读短索引 / 可选 router meta-skill | 是（若索引足够短） |
| S3 | 用 ADR-0001 信号反馈修订 Core | 质量提升 |
| S4 | 拆分 `residual_library` 为有界域包 | 降低“垃圾桶 pack”风险 |

> **S0 诚实声明：** 在 S1 完成前，不得在对外叙述中声称“已通过 On-demand 节省 context”。

## Validation

- 对抗性评审：`docs/adversarial-product-pk/2026-07-17-observability-pack-catalog/`  
- 验收记录：`docs/verification/2026-07-17-observability-pack-catalog-acceptance.md`  
- 门禁：`node docs/adr/artifacts/validate-skills-pack-catalog.mjs`  

## References

- agentskills.io — progressive disclosure  
- Microsoft Learn — Agent Skills / `load_skill`  
- Cloudflare `agent-skills-discovery-rfc`  
- `~/.agents/skills/SCALE-ANALYSIS-2026-07-17.md`  
- ADR-0001  
