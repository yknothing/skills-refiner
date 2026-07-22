# 04 — Cross Examination

### C→Champ：读 INDEX 算不算第二套遍历？

**答（证据）：** ADR §8 禁止的是「第二套磁盘遍历**算法**」重扫 skills 树。实现只 `spawn skill-scan`，并对收集器已声明的 `physical_collection_root` / `catalog.collection_root` 做 **单文件** `INDEX.json` 读取。沙箱测试未对 `~/.agents/skills` 做二次 `find`。  
**标签：** Fact + Repo-derived inference  
**剩余风险：** 若未来在 panorama 内 glob 全 home `SKILL.md`，则违规。

### C→Champ：个人技能会不会被清单误伤？

**答：** `catalog_active` 仅对批准集命中标 `active`；落在 collection 根未批准标 `inactive`；其余个人技能保持 `absent`。漂移判定要求 `catalog_mode=members` 且 active/inactive 语义，不因 absent 触发。单测「无清单仍齐全」与集成 ghost-member 金样通过。  
**标签：** Fact

### Champ→C：零交互是否削弱产品？

**答：** ADR 明确非 TTY/`--yes`/`--agents` 零提问；报告 notes 写明「未做交互确认」。属接受的 CI/Agent 路径，不是隐藏缺陷。  
**标签：** Product-owner decision（已锁定于 ADR）

### C→Champ：薄 skill 会不会滑向处置命令？

**答：** `SKILL.md` 与 MD 渲染硬编码禁止突变命令；测试断言无 `rm -rf`；决策卡只写 handoff 到 hygiene。  
**标签：** Fact
