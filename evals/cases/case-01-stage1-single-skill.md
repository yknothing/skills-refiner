# Case 01 — Stage 1 only: single skill analysis

## Input

Use `skills-refiner` on the following skill.

---

```markdown
---
name: release-notes
description: Generate structured release notes from git history between two refs.
---

# release-notes

Generate release notes from the git commit history between two refs.

## When to use

Use this skill when:
- Asked to write release notes
- Preparing a changelog entry
- Summarizing recent changes for stakeholders

## Steps

1. Ask for the start ref and end ref if not provided.
2. Run `git log <start>..<end> --oneline` to get the commit list.
3. Group commits by type: features, fixes, chores.
4. Write release notes in the following format:

## Release Notes

### Features
- ...

### Bug Fixes
- ...

### Chores
- ...
```

---

## Expected behavior

- Treat the pasted skill file as the source object.
- Run Stage 1 only (no `target_repo` is present).
- Return a structured review with a refinement judgment and top 3 actions.
- Do not force Stage 2.

## Dimensions primarily tested

- Object identification (single skill file, not a repository)
- Stage control (Stage 1 only)
- Judgment quality (strength and weakness of this simple skill)
- Evidence discipline (limited to what is in the file)
