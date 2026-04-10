# Example usage — `skill-hunter`

These examples show the intended invocation style for `skill-hunter`.

The goal is not a search engine dump. The goal is a sharp, curated recommendation from a scout with excellent taste.

Both Chinese and English invocations are supported. The skill infers the output language from the language you use.

## 1) Find the best skill for a specific need

Use `skill-hunter` to find the best code review skills. I need something with real design quality, not just popularity.

Expected behavior:
- interpret the need precisely;
- search across relevant sources, especially major skill platforms plus GitHub/X;
- return a curated shortlist with quality assessments;
- identify a top pick with clear reasoning;
- flag popular but mediocre options if relevant.

## 2) Discover what's genuinely good right now

Use `skill-hunter` in open scout mode. What skills are genuinely excellent but underrated right now?

Expected behavior:
- scan the ecosystem broadly;
- treat X and mainstream platforms as primary discovery surfaces, not side inputs;
- surface hidden gems, rising quality, and mature underrated skills;
- identify overrated patterns;
- resist producing a popularity ranking.

## 3) Evaluate a specific skill

Use `skill-hunter` to evaluate this skill. Is it actually good, or just well-marketed?

Expected behavior:
- apply the full quality framework to the specified skill;
- give a clear verdict: adopt, watch, or skip;
- explain the verdict with specific evidence;
- identify the main quality and the main concern.

## 4) Compare candidates head-to-head

Use `skill-hunter` to compare these three skills. Which one is actually the best and why?

Expected behavior:
- evaluate all candidates against the same quality dimensions;
- identify the clear winner or explain the trade-off;
- surface the single most important difference between them;
- do not produce a balanced "they're all good in different ways" non-answer.

## 5) Find skills in an emerging space

Use `skill-hunter` to find the best skills for agent-to-agent communication. This space is new so I expect the options might be thin.

Expected behavior:
- acknowledge the emerging nature of the space;
- apply the quality framework even when options are limited;
- if nothing meets the bar, say so explicitly;
- describe what an ideal skill would look like;
- identify the most promising early-stage options if any exist.

---

## 中文调用示例

以下示例展示中文调用方式。使用中文提问时，`skill-hunter` 会全程以中文输出。

### 6）帮我找最好的 code review skill

用 `skill-hunter` 帮我找最好的 code review skill。我要的是真正有设计质量的，不是 star 最多的。

预期行为：
- 精准理解需求；
- 搜索相关源；
- 返回精选列表，附带质量评估；
- 识别首选项并说明原因；
- 指出流行但质量一般的选项。

### 7）最近有什么值得关注的 skills

用 `skill-hunter` 帮我看看最近有什么值得关注的 skills。不要给我热门排行榜，我要真正有质量的。

预期行为：
- 扫描生态系统；
- 把 X 和主流 skill 平台放在重要位置；
- 按质量分类呈现：隐藏精品、品质上升中、成熟但被低估；
- 识别被高估的 skills 或模式；
- 拒绝生成热门排行榜。

### 8）帮我评估这个 skill 到底怎么样

用 `skill-hunter` 评估一下这个 skill。我想知道它到底是真的好，还是只是营销做得好。

预期行为：
- 应用完整质量框架评估；
- 给出清晰判断：采用、观望或跳过；
- 用具体证据支撑判断；
- 不因为它很火就手下留情。

---

## Collaboration with other skills

### 9) Hunt then audit

Use `skill-hunter` to find the best skills for structured logging. Then I'll use `skills-refiner` to do a deep audit on your top pick.

Expected behavior:
- complete the hunt with a curated shortlist;
- identify the top pick clearly so the user can pass it to `skills-refiner`;
- keep the quality assessment at scout level — do not attempt a deep structural audit.

### 10) Hunt then explain to the team

Use `skill-hunter` to find the best documentation generation skill. Once I pick one, I'll use `skills-appreciation` to write an explanation for my team.

Expected behavior:
- complete the hunt with a curated shortlist;
- provide enough context about each pick so the user can decide which to explain;
- do not write the appreciation article — that is skills-appreciation's job.

---

## Notes

- The default output is a curated recommendation, not a search result list.
- If nothing meets the quality bar, the skill should say so rather than stretching mediocre options.
- Popularity signals (stars, downloads, trending) are noise until verified by structural quality.
- Mainstream platforms and X are discovery accelerators; GitHub remains the structural verification layer.
- Output language follows: explicit user instruction > current configuration > dominant conversation language > English.
