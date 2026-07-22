# 03 — Challenger First Pass

**Visibility:** 同 Evidence Map（角色分离；非盲审独立）  
**Evidence boundary:** ADR 否决点 + 实现代码审查意图  
**Not validated:** 生产机极端拓扑

## 攻击面

1. **第二套遍历伪装：** 读 `INDEX.json` / `catalog.json` 是否滑向旁路重算拓扑？  
2. **installed 塌缩：** JSON 衍生字段或 Markdown 是否偷偷出现「已安装/就绪」？  
3. **越权突变：** skill 文案或报告是否包含 `rm`/`ln`/改 catalog 命令？  
4. **默扫项目仓：** 是否扫描 cwd 仓库 skills？  
5. **无清单误判：** `catalog_active=absent` 是否被当成漂移？  
6. **清单漂移误伤：** 批准集存在时，是否把全部个人技能判成「清单与现实不符」？  
7. **依赖 Node 24 / hygiene 共存：** 选择性安装场景下 launcher 是否脆？

## 初步结论倾向

若测试门禁覆盖 1–5 且 normalize 对个人技能保持 `absent`，可接受-with-limitations；否则 veto 晋升 canonical 完成态宣传。
