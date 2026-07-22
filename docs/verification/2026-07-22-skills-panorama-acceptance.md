# 验收 — ADR-0007 技能全景 V1

**Date:** 2026-07-22  
**Judge:** **accept-with-limitations**  
**Independence:** **L2**（独立子代理 Challenger / Evidence Clerk；**非** L1 自审；**非** L3/L4 外部验收）  
**对抗包：** `docs/adversarial-product-pk/2026-07-22-skills-panorama/`  
**独立意见：** `docs/adversarial-product-pk/2026-07-22-skills-panorama/09-independent-challenger-pass.md`  
**Owner 决策：** `docs/adversarial-product-pk/2026-07-22-skills-panorama/08-owner-decision.md`（**O9=C**）

## Done 清单（ADR §12）

| ID | 项 | Result | Evidence |
|---|---|---|---|
| D1 | 交互/逃逸确认 Agent → 编排收集器 → `latest.json`+`latest.md` | **PASS** | CLI 沙箱写出 Application Support 路径 |
| D2 | 中文报告八类缺口 + 文末字段对照 | **PASS** | `panorama-render.mjs`；MD 断言含「部分 Agent 已出现」 |
| D3 | JSON 六列；无 installed/ready | **PASS** | `assertNoCollapsedFields`；CLI 扫描 |
| D4 | 无控制清单不误判「清单与现实不符」 | **PASS** | 单测「无清单仍可齐全」 |
| D5 | 薄 skill 解说+总菜单/决策卡；标风险；无突变命令 | **PASS** | `SKILL.md` + references；MD 禁 rm |
| D6 | 非 TTY / `--agents` / `--yes` 零交互 | **PASS** | CLI 沙箱 `--yes --agents` |
| D7 | 金样：断链、仅源、清单漂移、撞名、无清单齐全、部分投影第八类 | **PASS** | O9=C 金样：部分投影 →「部分 Agent 已出现」 |

## 否决点门禁

| 否决点 | Result |
|---|---|
| 第二套 skills 树遍历 | **PASS**（仅 spawn scan + 读声明 INDEX） |
| installed 塌缩 | **PASS** |
| 越权突变命令 | **PASS** |
| 默扫项目仓 | **PASS** |
| 无清单误判 | **PASS** |
| 部分投影标齐全（O8） | **PASS（已修复）** |
| 部分投影语义（O9） | **PASS（Owner=C）** — 第八类「部分 Agent 已出现」 |

## 可运行门禁（O9=C 落地后）

```bash
node --test skills/skills-panorama/tests/test-panorama-gaps.mjs
bash skills/skills-panorama/tests/test-panorama-cli.sh
```

## Limitations（具体）

1. 评审级别 L2，不可称外部独立验收。  
2. INDEX 单文件读取批准成员（上游债 O6）。  
3. ~~部分投影 →「暂无法判定」（O9）~~ → **已关闭：第八类「部分 Agent 已出现」**。  
4. `--copy-cwd` 非脱敏分享路径；分享用 `--share`。  
5. 发现面/用量 Non-goals。

## 明确非宣称

- 未宣称用量/质量分/自动重链。  
- 未宣称真实 Agent loader 已验证。  
- 未宣称 L3/L4 独立对抗评审。  
- 未宣称 collection status 已原生提供 `approved_members[]`。

## 上游优化需求

1. `collection status|list` 增加只读 `approved_members: string[]`（或等价），避免 panorama 读 INDEX。  
2. `skill-scan` 可选稳定输出 `link_health` / 按 agent 的 `projections` 摘要。  
3. （可选）scan 支持 `--agents` 过滤——非 V1 阻断。

## Owner 签字栏

| 角色 | 结论 | 签名 | 日期 |
|---|---|---|---|
| Independent Challenger (L2) | **accept-with-limitations** | challenger-subagent | 2026-07-22 |
| Product Owner（主机） | **O9=C 已拍板**；accept-with-limitations | owner | 2026-07-22 |

**总体：accept-with-limitations** — ADR-0007 V1 Done 主路径满足；O9=C 已落地八类缺口。
