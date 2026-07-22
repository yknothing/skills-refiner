# 09 — Independent Challenger Pass（L2）

**Date:** 2026-07-22  
**Role:** Challenger / Evidence Clerk（独立子代理；与实现者会话分离）  
**Independence:** **L2**（agent-separated；**不是** L3 外部专家 / L4 人工外审）  
**Visibility:** ADR-0007、对抗包既有 L1 产物、`skills/skills-panorama/**`、本轮真实测试输出  
**Contamination:** 可见 Champion L1 自述与验收；**不采信**其结论，仅作对照靶；证据以代码审查 + 本轮命令输出为准

## Evidence boundary

| 验证项 | 本轮结果 |
|---|---|
| `node --test skills/skills-panorama/tests/test-panorama-gaps.mjs` | 11 pass / 0 fail（含第八类金样） |
| `bash skills/skills-panorama/tests/test-panorama-cli.sh` | Passed 16 / Failed 0 |

## 否决点复核

| 否决点 | 独立结论 | 证据 |
|---|---|---|
| 第二套 skills 树遍历 | **清除虚主张风险：未发现** | `panorama-collect.mjs` 仅 spawn `skill-scan` + 读声明根上单文件 `INDEX.json`；无 `readdir`/`find` skills 树 |
| installed/ready 塌缩 | **PASS** | 禁字段常量 + CLI 扫描；报告标题「已安装…全景」属 ADR §3.1 产品名，非谓词塌缩 |
| 越权突变命令 | **PASS** | SKILL / MD 禁令；测试禁 `rm -rf`/`ln -s` |
| 默扫项目仓 | **PASS** | 编排 `skill-scan`，scope 为 agent-recognized HOME 目录；无默认 cwd 仓库扫描 |
| 无清单误判齐全/漂移 | **PASS** | 金样 + `catalog_mode=absent` |
| 隐私分享路径 | **PASS（带限制）** | `--share` 脱敏；`--copy-cwd` 为显式真名副本（ADR §9.2 允许），帮助文案未强调「不可当分享」→ 保留限制 |
| **部分投影标齐全** | **曾 P1 违规 → 已修复；O9=C 升第八类** | 仅 `allPresentAgentsProjected` 才齐全；部分投影 →「部分 Agent 已出现」（`partial_projection`）；补金样 |

## 新异议

| ID | Severity | Claim attacked | Resolution | Veto |
|---|---|---|---|---|
| O8 | high→resolved | 部分投影塌缩为「齐全」 | **new evidence + test/gate added**：代码修复 + 单测 | **no-veto**（修复后） |
| O9 | medium→resolved | 七类无「部分投影」位，暂归 UNKNOWN 过宽 | **owner-decision O9=C**：ADR §7 增第八类「部分 Agent 已出现」；实现+金样落地 | **no-veto**（已关闭） |
| O10 | low | `--copy-cwd` 真名副本误当分享 | **accepted unresolved**：默认分享仍是 `--share`；建议帮助文案强化 | no-veto |
| O11 | low | 反向清单漂移（磁盘有、未批准）缺独立金样 | **accepted unresolved**：逻辑在 `isCatalogDrift(inactive)`；建议补测 | no-veto |

## 已清除的 Champion 虚主张

1. 「L1 自审即可当作 V1 验收闭环」→ **降级**：本轮升为 L2 Challenger；仍不得称独立外部验收。  
2. 「齐全 = 任一可工作投影即可」→ **否决并修复**（与 ADR/taxonomy 冲突）。  
3. 其余 critical 否决点：Champion 主张与代码一致，**未发现伪装通过**。

## False-consensus probe（本轮）

若仍危险错误，可能因为：

1. ~~Owner 本意就是「部分投影算齐全」~~ → **已否决（O9=C）**。  
2. `unexpected_target` 启发式仍可能误报合法非 `.agents` 源。  
3. INDEX 单文件读取在 catalog 根漂移时产生幽灵批准成员（O6 仍在）。

## Challenger 判决倾向

**accept-with-limitations**（O8 修复 + **O9=C** 第八类落地后）：V1 Done 主路径可验收；限制见 `07-rubric-decision.md`。  
**不得宣称：** L3/L4、市场验证、loader 实测、收集器接口已完美。
