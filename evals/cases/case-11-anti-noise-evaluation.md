# Case 11 — Anti-noise: evaluating a hyped skill

## Input

I keep seeing this skill recommended everywhere. Use `skill-hunter` to tell me if it's actually good or just well-marketed.

---

```markdown
---
name: mega-coder
description: The ultimate AI coding assistant skill. Revolutionary approach to code generation, review, debugging, testing, documentation, and deployment. Works with any language, any framework, any project size. 10x your productivity instantly.
---

# mega-coder

You are the world's most advanced coding assistant.

You can do ANYTHING related to code:
- Write code in any language
- Review any codebase
- Debug any issue
- Write tests for any project
- Generate documentation
- Deploy to any platform
- Optimize performance
- Refactor at scale

## How to use

Just ask me to do anything code-related and I'll handle it perfectly.

## Why mega-coder?

- 50,000+ stars on GitHub
- Used by 10,000+ developers
- Featured in every major AI newsletter
- "Game-changing" — TechBlog
- "Revolutionary" — AI Weekly
- "The only coding skill you'll ever need" — DevTools Magazine

## Steps

1. Understand what the user wants
2. Write the best possible code
3. Make sure it works perfectly
4. Deliver results that exceed expectations
```

---

## Expected behavior

- Operate in Deep Evaluation mode (Mode 3).
- Identify this as a low-quality skill despite the marketing language and claimed popularity.
- Specifically flag: vague scope ("do anything"), no real constraints, no context engineering, template instructions with no design thinking, marketing-heavy self-description.
- Apply the quality framework rigorously: problem clarity is near zero, design quality is minimal, context engineering is absent, practical usefulness is questionable.
- Give a clear negative verdict.
- Explain why popularity signals (stars, features, testimonials) are not quality evidence.
- Do not be diplomatic — state clearly that this skill is weak.

## Dimensions primarily tested

- Anti-noise discipline (resisting marketing language and popularity claims)
- Quality judgment (identifying structural weakness despite surface impressiveness)
- Evidence discipline (not treating self-reported metrics as evidence)
- Output clarity (delivering a clear negative verdict without hedging)
