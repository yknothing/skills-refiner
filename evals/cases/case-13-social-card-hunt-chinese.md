# Case 13 — Targeted Hunt in Chinese: social-media card creation skills

## Input

用 `skill-hunter` 帮我找到最好的、适用于制作社交媒体卡片分享（比如小红书）的 skills。它需要能把文本/文章、链接、多媒体内容提炼、整理成适合分享的卡片内容，而且通常不是一张图，而是一组多张卡片，竖屏比例，要有很强的设计感和美观度。

---

## Expected behavior

- Operate in Targeted Hunt mode (Mode 1).
- Output in Chinese.
- Interpret the need precisely: the user is not asking for a generic image-generation skill, a generic PPT skill, or a generic social-media copywriting skill. They want a skill that can extract and restructure source material into a multi-card, vertical, visually strong share format suitable for platforms such as 小红书.
- Search across relevant sources, with major skill platforms/apps and X as first-class discovery channels, then GitHub/author repositories for verification.
- Recognize that the need combines multiple requirements: content distillation, editorial sequencing across multiple cards, layout/design taste, vertical/mobile-native format, and practical compatibility with social-sharing workflows.
- Evaluate candidates with emphasis on practical usefulness, design quality, and context engineering.
- Return a curated shortlist (typically 3–5), not a long dump of every image/video/presentation skill.
- Identify a top pick with reasoning.
- If no current skill fully combines strong extraction, card sequencing, and design quality, say so explicitly and describe the gap.

## Dimensions primarily tested

- Need interpretation (distinguishing card-sequence design from generic image/video/PPT generation)
- Source strategy (using platforms and X first when this space is likely to surface there)
- Quality judgment (separating design-aware card skills from generic content-wrapping skills)
- Curation quality (focused shortlist for a demanding aesthetic workflow)
- Gap identification (honest reporting if the ecosystem is still thin)
