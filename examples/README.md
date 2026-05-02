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

---

## Notes

- `target_repo` is optional.
- If `target_repo` is not provided, the skill should stop after Stage 1 and return refinement actions.
- If `target_repo` is provided or clearly implied, the skill should continue into Stage 2 automatically.
- Output language follows: explicit user instruction > current configuration > dominant conversation language > default.

---

## Collaboration with skill-creator

### 8) Audit a skill just created by skill-creator

I just finished creating this skill with skill-creator. All tests pass. Use `skills-refiner` to audit the design quality — focus on structure, boundaries, context engineering, and anything the tests might have missed.

Expected behavior:
- acknowledge that functional tests pass, then move past functional testing;
- focus on design-level concerns: scope clarity, context engineering, edge cases, maintainability;
- frame the top 3 refinement actions for direct use in skill-creator's next iteration.

### 9) Audit both a skill and its eval set

Use `skills-refiner` on this skill and its eval set. Are the tests covering the right risk surface?

Expected behavior:
- audit the skill's design quality as usual;
- also audit the eval set: are the assertions discriminating, are edge cases covered, is the test set balanced?
- return refinement actions for both the skill and its evals.

### 10) 审查一个由 skill-creator 创建的 skill

我刚用 skill-creator 创建了这个 skill，所有测试都通过了。用 `skills-refiner` 审查它的设计质量——重点关注结构、边界、上下文工程，以及测试可能遗漏的问题。

预期行为：
- 确认功能测试已通过，然后跳过功能测试层面；
- 聚焦设计层面的问题：范围清晰度、上下文工程、边界情况、可维护性；
- 将前 3 项优化建议格式化为可直接用于 skill-creator 下一轮迭代的行动项。

---

## Governance & Observability examples

These examples demonstrate the `skill-hygiene` and `skill-debug` skills.

### 11) Scan installed skills for health issues

```bash
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh
```

Expected behavior:
- scans all agent skill directories (`~/.agents/skills/`, `~/.claude/skills/`, etc.);
- reports topology: native skills, symlinks, broken symlinks per directory;
- records discovery contract fields, bounded native-platform signals, content hash, freshness, provenance, and same-name collision facts when available;
- flags issues: missing frontmatter, backup remnants, security indicators, stale or stub skills;
- outputs both terminal-friendly table and JSON report.

### 12) Scan with custom staleness threshold

```bash
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh --stale-days 365
```

### 13) JSON-only output for AI consumption

```bash
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh --json
```

Feed the stdout JSON to an AI advisor for expert judgment on the scan results. This mode does not write a report file.

### 14) Inspect local skill discovery surfaces from a project directory

```bash
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh --cwd ~/projects/my-app
```

Expected behavior:
- finds project-level skills (cwd → repo root);
- finds global skills (`~/.*agent*/skills/`);
- detects name conflicts (same skill name in multiple locations);
- validates frontmatter.

### 15) Inject activation canaries to observe skill following

```bash
# Inject into all global skills
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/

# Check which skills have traces
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --status

# Remove traces when done
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --strip-dir ~/.agents/skills/
```

### 16) View the canary observation dashboard

```bash
# Last 30 days (default)
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh

# Last 7 days
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh --days 7

# JSON output
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh --json --all
```

Expected output: observed canary ranking, not-observed skill identities (installed but no recorded canary), observed rate, context distribution.

### 17) Combined health check

```bash
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh --doctor
```

Combines discovery probe, native platform signal checks, activation log analysis, and hygiene scan cross-reference.

### 18) Full governance workflow

```text
# Step 1: What local skill surfaces are likely discoverable?
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh

# Step 2: Which have observed canary activity?
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh

# Step 3: What is the overall health?
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh

# Step 4: Ask AI to interpret and recommend
Use skill-hygiene to evaluate the scan results and recommend improvements.
```
