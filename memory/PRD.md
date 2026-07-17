# PRD — skills-refiner 仓库深度评审

## 原始问题陈述
深度、客观评审仓库 `cee340e5..HEAD`（共 7 提交）的内容，尤其 ADR 与待完成事项。核心：1) 是否偏离仓库定位/真实意图；2) 架构与实现质量不妥协；3) 不足与修复最佳实践。

## 用户选择
- 产出写入仓库文件（docs/REVIEW.md）
- 只评审 + 给最佳实践建议，不改代码
- 优先级由评审者判断

## 已完成（2026-06）
- 审阅范围：cee340e（macOS provenance xattr 修复）、5cd2ace（scan tree hashing 有界化）、ADR-0001/0002、pack catalog + validator、两个对抗性评审包、两份验收记录、CI workflow、platform-support、CONTRIBUTING。
- 关键发现（已写入 docs/REVIEW.md）：
  - P1-1: validator 未接 CI、零测试、空 deploy root 时静默降级 PASS（实测复现）
  - P1-2: repo vs machine catalog 权威未裁决；Owner 机器 129-skill 实例嵌入公共仓库（定位裂缝）
  - P1-3: 待办碎片化（13 项散落 5 处，无台账）
  - P1-4: test-cleanup-macos.mjs:1478 恒真断言
  - P2: validator lines.indexOf 解析 bug（已构造最小复现）、write-tree 缺时间界、ADR-0001 快照腐烂/引用无 URL/"红acted" typo、xattr 排除应常量化、验收证据不可复核
- 产出：/app/docs/REVIEW.md（六章：总体结论、逐产物评审、待办审计、P0-P3 修复清单、非问题清单、结语）

## 待办（如用户后续要求）
- 按 REVIEW.md P1 清单实施修复（validator CI 化 + 测试、恒真断言修复、BACKLOG.md 台账、ADR-0003 裁决）
- P2 项：解析器索引 bug、timeout 界、ADR-0001 维护性修订
