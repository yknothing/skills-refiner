# 08 — Owner Decision

**Product decision:** 接受 ADR-0007 V1 实现为可交付（**accept-with-limitations**），级别升为 **L2 独立 Challenger 复核**。

**O9 = 选项 C（已拍板）：** 部分投影**不再**归「暂无法判定」或「齐全」；新增对外固定第八类缺口 **「部分 Agent 已出现」**（稳定英文 id：`partial_projection`）。齐全 = 全部所选且目录存在的 Agent 均有健康投影。优先级：链接损坏 / 命名冲突 > 清单与现实不符 > 部分 Agent 已出现 > …。已修订 ADR-0007 §7 并落地实现与金样。

**Accepted limitations:**

1. 对抗级别 L2，不可称 L3/L4 外部验收。  
2. 批准成员暂时从 catalog/collection 声明根 `INDEX.json` 单文件读取；跟踪上游 `approved_members[]`。  
3. 发现面元数据与用量保持 Non-goals。  
4. ~~O9 待拍板~~ → **已关闭（选项 C）**。  
5. 分享路径以 `--share` 为准；`--copy-cwd` 仅为显式真名工作区副本。

**Rejected temptations:**

- 在 panorama 内直接输出删改命令。  
- 引入第二套 skills 目录遍历。  
- 默认扫描项目仓库。  
- 用 `installed`/`ready` 汇总灯。  
- 把「任一 Agent 有投影」或「部分投影」标成「齐全」。  
- 把部分投影笼统塞进「暂无法判定」。

**Promotion:** 实现与验收文档进入仓库文档树；ADR-0007 §7 已 amendment（七类→八类）；O9 语义锁定为第八类。

| 角色 | 结论 | 签名 | 日期 |
|---|---|---|---|
| Independent Challenger (L2) | accept-with-limitations | challenger-subagent | 2026-07-22 |
| Product Owner（主机） | **O9=C 已拍板**；其余 accept-with-limitations | owner | 2026-07-22 |
