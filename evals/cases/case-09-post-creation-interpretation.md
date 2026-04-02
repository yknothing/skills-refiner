# Case 09 — Post-creation interpretation

## Input

We just built this skill with skill-creator and refined it based on a skills-refiner audit. Use `skills-appreciation` to write an explanation that helps our team understand why the skill is designed this way and what they should know before using it.

---

```markdown
---
name: incident-postmortem
description: Guide the creation of a structured incident postmortem document. Use when a production incident needs a postmortem, retrospective, or root cause analysis written up. Also use when someone mentions an outage review, incident review, or post-incident analysis.
---

# incident-postmortem

Help a team produce a clear, blame-free postmortem document after a production incident.

## Core behavior

- Ask for the incident summary if not provided: what happened, when, how long, who was affected.
- Establish the timeline: detection, response, mitigation, resolution.
- Guide root cause analysis:
  - ask "why" iteratively (5-whys or similar) until a systemic cause is visible
  - distinguish contributing factors from root cause
  - do not accept "human error" as a root cause — dig deeper into the system conditions that made the error possible or likely
- Identify what went well during the response.
- Identify what could be improved.
- Generate action items with owners and deadlines.
- Format the postmortem using the team's preferred template if one is provided, otherwise use a clean default structure.

## Constraints

- Never assign blame to individuals. Frame everything in terms of systems, processes, and conditions.
- Do not minimize the incident's impact to make the document more comfortable.
- Do not invent details. If something is unclear, flag it as needing investigation.
- Keep the document actionable: every finding should connect to an action item or an explicit decision to accept the risk.

## Default output structure

# Incident Postmortem: [Title]

**Date:** ...
**Duration:** ...
**Severity:** ...
**Author:** ...

## Summary

## Timeline

## Root Cause Analysis

## What Went Well

## What Could Be Improved

## Action Items

| Action | Owner | Deadline | Status |
|--------|-------|----------|--------|
| ...    | ...   | ...      | ...    |

## Lessons Learned
```

---

## Expected behavior

- Produce an article or teaching note, not an audit report or scorecard.
- Recognize this as a **workflow-discipline skill** — its value is in the process constraints (blame-free framing, iterative root cause analysis, mandatory action items) not in clever automation.
- Explain the mechanism: why refusing to accept "human error" as a root cause forces deeper systemic analysis, and why requiring every finding to connect to an action item prevents postmortems from becoming empty exercises.
- Surface at least one real limit: e.g., the skill does not handle recurring incidents that trace back to the same root cause, or it gives no guidance on prioritizing action items when there are too many.
- Frame the explanation for team members who will use the skill, not for skill designers.
- Keep the output readable and useful as team onboarding material.

## Dimensions primarily tested

- Target identification and purpose fit (workflow-discipline skill, not automation)
- Mechanism explanation (why the constraints create value)
- Writing quality (clear, team-readable)
- Transfer value (what the team learns about postmortem design, not just this specific skill)
- Low "AI flavor" (no hollow setup, no templated symmetry)
