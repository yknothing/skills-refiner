# 02 — Champion First Pass

**Visibility:** ADR-0007 + 本轮实现与测试  
**Evidence boundary:** 仓库内代码与沙箱金样  
**Not validated:** 独立多模型审查；全量本机生产 catalog 正确性

## 主张

1. 技能全景补齐「看清本机 Skills 长相」入口，岗位与 hygiene/debug 分离。  
2. V1 通过编排 `skill-scan` + catalog/INDEX 只读产物实现六列与七类，无第二套 skills 树遍历算法。  
3. 禁止 `installed`/`ready`；无清单不误判「清单与现实不符」。  
4. 薄 skill 提供总菜单/决策卡与风险，路由到 hygiene，不输出突变命令。  
5. `--agents` / `--yes` / 非 TTY / `--stdout-only` 满足零交互；`--share` 满足脱敏分享。  
6. 金样覆盖：断链、仅源、清单漂移、撞名、无清单仍齐全。

## 必须暂不宣称

- 全景能回答「哪些 skill 有用」（无用量）。  
- 发现面元数据或真实 loader 已验证。  
- 本评审为独立外部验收（仅为 L1）。
