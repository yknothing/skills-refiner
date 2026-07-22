# 06 — Claim Ledger

| Claim | Label | Evidence | Confidence | Reversal |
|---|---|---|---|---|
| V1 CLI 写出 latest.json/md | Fact | test-panorama-cli.sh（本轮 15/0） | high | CLI 回归失败 |
| 六列原子字段存在且无 installed/ready | Fact | gaps 单测 + CLI | high | JSON 出现禁字段 |
| 八类缺口中文导航 | Fact | MD 渲染 + 金样（含部分 Agent 已出现） | high | 类名漂移 |
| 无清单不误判清单不符 | Fact | 单测 | high | classify 回归 |
| 金样覆盖断链/仅源/漂移/撞名/无清单齐全/部分投影第八类 | Fact | 单测+集成 | high | 任一金样失败 |
| 部分投影不得标齐全 | Fact | 单测「部分投影 → 部分 Agent 已出现」 | high | 第二分支回归 |
| 薄 skill 只读分诊 | Fact | SKILL.md | high | 文案出现突变命令 |
| 未默扫项目仓 | Fact | 收集路径仅 HOME scan | high | 增加默认 cwd 扫描 |
| 读 INDEX 非第二套遍历算法 | Repo-derived inference | 代码结构；O6 上游债 | med | 引入 find/walk skills |
| 需要 upstream approved_members | Opinion / 优化需求 | Challenger O6 | med | status 已暴露成员数组 |
| 部分投影 = 第八类「部分 Agent 已出现」 | Product-owner decision（已签 O9=C） | ADR §7 + 实现 | high | 静默改回齐全/UNKNOWN |
| 本包为 L3+ 独立验收 | — | — | — | **不得宣称**（现为 L2） |
