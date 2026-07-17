# Challenger First Pass

**Visibility:** Evidence map + Champion thesis known (same-session contamination — honesty requires noting this).  
**Evidence boundary:** Same as Evidence Clerk.  
**Not validated:** User willingness to enable OTel tool details; mount UX.

## Attack

### 1. Catalog theater (severity: high)

Publishing `skills-pack-catalog.yaml` with `enforcement: none` does **not** change Claude/Factory discovery. Calling this “On-demand 落地” would be false advertising. Without S1, description budget remains ~7k tokens.

### 2. Privacy bait-and-switch (severity: high)

Appendix B’s useful per-skill reports require `OTEL_LOG_TOOL_DETAILS=1`, which expands tool-detail exposure. Teams may “just enable it” and violate the ADR’s own privacy tree. ADR must treat TOOL_DETAILS as a **separate consent gate**, not a footnote.

### 3. Chicken-and-egg Core list (severity: medium)

Core=34 is an opinion without usage evidence. Wrong Core either wastes context or hides needed skills. ADR-0002 admits this but still risks social locking of a bad list.

### 4. Residual pack is a landfill (severity: medium)

`residual_library` holds ~50 skills. That recreates sprawl inside one on-demand bucket and undermines “pack = coherent domain.”

### 5. Cross-platform overclaim (severity: medium)

Cursor Enterprise analytics ≠ local JSONL; Codex hooks missing. A “unified observability architecture” doc can smuggle readiness across agents.

### 6. Validator false confidence (severity: low→medium)

Custom YAML parser + membership check proves **coverage**, not **mount correctness** or **token budget**. Passing validator ≠ progressive disclosure works.

## Demands

- Acceptance language must say **S0 contract only**.  
- Residual pack marked as **debt to split**, not a stable architecture end-state.  
- No promotion claiming measured context savings.  
- Preserve disagreement if Owner wants hard enforcement before telemetry.
