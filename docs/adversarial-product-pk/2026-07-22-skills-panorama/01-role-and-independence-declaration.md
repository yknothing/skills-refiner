# 01 — Role & Independence Declaration

| 项 | 值 |
|---|---|
| Independence level | **L2**（独立子代理 Challenger / Evidence Clerk；与实现者会话分离） |
| Prior level | L1（同会话角色分离；已降级标注，不得再当最终验收级别） |
| Champion | 实现/产品验收负责人（L1 包：主张 V1 可达 Done） |
| Challenger | **独立子代理**（本轮；见 `09-independent-challenger-pass.md`） |
| Judge | 独立 Challenger 代行裁决草案；**Owner 终签** |
| Evidence Clerk | 同 Challenger 子代理（本轮命令与 claim ledger） |
| Contamination | 可见 L1 Champion 产物；结论以代码 + 本轮金样为准，不采信自审口号 |

**Visibility：** ADR-0007、实现路径、L1 对抗包、本轮测试 stdout。  
**Not validated：** 市场需要、真实用户向导体验、生产 catalog 全量正确性、L3/L4 外审。  
**Allowed wording：** 「L2 agent-separated / 独立 Challenger 复核」。  
**Forbidden wording：** 「独立外部验收」「L3/L4」「市场验证通过」。
