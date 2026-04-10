# Example usage

These examples show the intended invocation style. The skill is designed to keep the explicit input surface small.

Both Chinese and English invocations are supported. The skill infers the output language from the language you use.

## 1) Audit and refine the current repository

Use `skills-refiner` on this repository.

Expected behavior:
- infer the source object from the current repository page or attached content;
- run Stage 1 only;
- return a structured review plus top refinement actions.

## 2) Review a single skill file

Use `skills-refiner` on this skill. Focus on boundaries, reuse, context engineering, and improvement opportunities.

Expected behavior:
- treat the current skill file or pasted content as the source object;
- assess whether it is too broad, too vague, too platform-bound, or too hard to maintain;
- return a refinement-oriented report.

## 3) Audit a repository and integrate into another repository

Use `skills-refiner`, and treat `yknothing/prodcraft` as `target_repo`.

Expected behavior:
- complete Stage 1 first;
- then run compatibility and integration analysis for `yknothing/prodcraft`;
- provide a Minimum Viable Integration Plan and a High-Leverage Enhancement Plan.

## 4) Compare what should be preserved versus rejected

Use `skills-refiner` on this repository. I care most about what should be preserved, what should be simplified, and what should be rejected.

Expected behavior:
- keep the report tight;
- emphasize refinement judgment and four-way extraction;
- do not force integration planning unless the context clearly calls for it.

---

## 中文调用示例

以下示例展示中文调用方式。使用中文提问时，`skills-refiner` 会全程以中文输出。

### 5）审查并优化当前仓库

用 `skills-refiner` 分析这个仓库。

预期行为：
- 从当前仓库页面或附加内容推断分析对象；
- 仅执行第一阶段（审查与优化）；
- 返回结构化报告和优化建议。

### 6）审查一个 skill 文件

用 `skills-refiner` 分析这个 skill。重点关注边界清晰度、可复用性、上下文工程质量和改进机会。

预期行为：
- 以当前 skill 文件或粘贴内容作为分析对象；
- 判断其是否过于宽泛、模糊、平台绑定或难以维护；
- 返回面向优化的分析报告。

### 7）审查仓库并整合到目标仓库

用 `skills-refiner` 分析这个仓库，目标仓库为 `yknothing/prodcraft`。

预期行为：
- 先完成第一阶段审查；
- 再针对 `yknothing/prodcraft` 执行兼容性与整合分析；
- 提供最小可行整合方案和高价值增强方案。

### 8）判断应该保留上游引用，还是吸收融合进目标仓库

用 `skills-refiner` 分析这个 skill，目标仓库为 `acme/team-skills`。如果这个 skill 本身已经足够优秀，而且我希望持续跟随上游更新，就不要建议吸收改写；如果必须改造或我只想吸收精华，再给我吸收融合方案。

预期行为：
- 先完成第一阶段审查；
- 第二阶段明确判断更适合“保留上游链接”还是“吸收融合”；
- 如果保留上游链接更合理，要说明为什么不该本地改写；
- 如果吸收融合更合理，要给出面向目标仓库的提炼与改造方案。

---

## Notes

- `target_repo` is optional.
- If `target_repo` is not provided, the skill should stop after Stage 1 and return refinement actions.
- If `target_repo` is provided or clearly implied, the skill should continue into Stage 2 automatically.
- Stage 2 may conclude that the best move is to keep a source skill upstream-linked rather than absorb it locally.
- Output language follows: explicit user instruction > current configuration > dominant conversation language > default.

---

## Collaboration with skill-creator

### 9) Audit a skill just created by skill-creator

I just finished creating this skill with skill-creator. All tests pass. Use `skills-refiner` to audit the design quality — focus on structure, boundaries, context engineering, and anything the tests might have missed.

Expected behavior:
- acknowledge that functional tests pass, then move past functional testing;
- focus on design-level concerns: scope clarity, context engineering, edge cases, maintainability;
- frame the top 3 refinement actions for direct use in skill-creator's next iteration.

### 10) Audit both a skill and its eval set

Use `skills-refiner` on this skill and its eval set. Are the tests covering the right risk surface?

Expected behavior:
- audit the skill's design quality as usual;
- also audit the eval set: are the assertions discriminating, are edge cases covered, is the test set balanced?
- return refinement actions for both the skill and its evals.

### 11) 审查一个由 skill-creator 创建的 skill

我刚用 skill-creator 创建了这个 skill，所有测试都通过了。用 `skills-refiner` 审查它的设计质量——重点关注结构、边界、上下文工程，以及测试可能遗漏的问题。

预期行为：
- 确认功能测试已通过，然后跳过功能测试层面；
- 聚焦设计层面的问题：范围清晰度、上下文工程、边界情况、可维护性；
- 将前 3 项优化建议格式化为可直接用于 skill-creator 下一轮迭代的行动项。
