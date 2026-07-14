# Role and Independence Declaration

- Declared level: L2, agent-separated review.
- Evidence Clerk: root agent; prepared the shared evidence map from the repository and owner decisions.
- Champion: isolated subagent; receives the evidence map and current design artifacts, not the Challenger first pass.
- Challenger: isolated subagent; receives the evidence map and current design artifacts, not the Champion first pass.
- Judge: root agent; sees both first passes only after completion and applies the rubric.
- Contamination: both subagents inherit the conversation's chosen direction and approved visible flow. They are independent of each other's first-pass reasoning, but not fresh-context or multi-model reviewers.
- Allowed wording: agent-separated adversarial review.
- Forbidden wording: independent expert verification, external validation, market validation.
