# 00 — Evidence Map

**Date:** 2026-07-22  
**Artifact target:** ADR-0007 V1 实现 + 对抗包 + 验收  
**Source boundary:** 仓库工作区 `skills-refiner`（未要求 commit）  
**Review pass:** L2 Independent Challenger（见 `09-independent-challenger-pass.md`）

| 来源 | 类型 | 状态 | 用途 |
|---|---|---|---|
| `docs/adr/0007-skills-panorama.md` | Fact | Accepted with limitations | V1 Done / Non-goals / 谓词 / 八类 / 隐私 |
| `docs/adr/0001-*.md`、`0003`、`0006` | Fact | Accepted | 观测边界；禁止 installed/ready 塌缩；catalog 权威 |
| `skills/skill-hygiene/bin/skill-scan.sh` | Fact | 现网 | 拓扑收集器（编排对象） |
| `skills/skills-panorama/**` | Fact | 本轮复核+O8 修复 | CLI、归一化、缺口、薄 skill |
| `tests/test-panorama-gaps.mjs` + `test-panorama-cli.sh` | Fact | **本轮复跑** | 金样与沙箱集成 |
| L1 对抗包 02–08 | Contaminated prior | 可见不采信结论 | 对照靶 |
| 用量/加载率证据 | Missing | — | V1 Non-goal |
| 真实 Agent loader 行为 | Missing | — | V1 →「暂无法判定」 |

**验证命令（本机，2026-07-22 L2 复跑）：**

```bash
SKILLS_REFINER_NODE_BIN=$HOME/.nvm/versions/node/v24.4.1/bin/node \
  node --test skills/skills-panorama/tests/test-panorama-gaps.mjs
# 10 pass / 0 fail

SKILLS_REFINER_NODE_BIN=$HOME/.nvm/versions/node/v24.4.1/bin/node \
  bash skills/skills-panorama/tests/test-panorama-cli.sh
# Passed 15 / Failed 0
```
