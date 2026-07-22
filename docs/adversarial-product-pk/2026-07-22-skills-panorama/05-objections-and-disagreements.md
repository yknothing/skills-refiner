# 05 — Objections and Disagreements

| ID | Severity | Claim attacked | Resolution | Veto |
|---|---|---|---|---|
| O1 | critical | 可能第二套遍历 | **test/gate added**：CLI 只编排 scan；INDEX 单文件读；L2 复核无 skills 树 walk | no-veto |
| O2 | critical | installed/ready 塌缩 | **test/gate added**：`assertNoCollapsedFields` + CLI 扫描 | no-veto |
| O3 | critical | 输出突变命令 | **test/gate added**：MD 禁 `rm -rf`；skill 文案禁令 | no-veto |
| O4 | high | 默扫项目仓 | **scope removed / ADR**：仅 HOME 全局源与 Agent 根 | no-veto |
| O5 | high | 无清单误判漂移 | **test/gate added**：absent + 齐全金样 | no-veto |
| O6 | medium | 读 catalog INDEX 依赖旁路 | **accepted unresolved** → 上游 `approved_members[]` | no-veto（限制） |
| O7 | medium | Node 24 + hygiene 路径耦合 | **accepted unresolved**：文档要求 `SKILLS_REFINER_NODE_BIN` | no-veto |
| O8 | high | 部分投影标「齐全」 | **new evidence + test/gate added**（L2 发现并修复） | **no-veto**（修复后） |
| O9 | medium | 部分投影归「暂无法判定」是否过宽 | **owner-decision: O9=C** — ADR §7 增第八类「部分 Agent 已出现」；实现+金样已落地 | **no-veto**（已关闭） |
| O10 | low | `--copy-cwd` 真名误分享 | **accepted unresolved** | no-veto |
| O11 | low | 反向清单漂移缺金样 | **accepted unresolved** | no-veto |

## Preserved disagreement

**O9：** ~~待 Owner 拍板~~ → **已拍板选项 C**：新增「部分 Agent 已出现」，禁止标齐全或笼统暂无法判定；冲突/损坏优先。

## False-consensus probe

1. 生产 catalog 根与 INDEX 不一致 → 幽灵批准成员。  
2. `unexpected_target` 过敏感。  
3. 用户把全景当处置工具跳过 hygiene。  
4. ~~Owner 本意 partial=齐全 → 本修复与产品意图冲突（O9）~~ → **O9=C 已否决该本意**。
