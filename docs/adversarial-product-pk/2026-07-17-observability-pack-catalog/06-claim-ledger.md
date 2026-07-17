# Claim Ledger

| Claim | Label | Evidence | Confidence | Validation path | Reversal condition | Must not claim yet |
|---|---|---|---|---|---|---|
| Canary inject is invasive and proxy-only | Fact | skill-debug accuracy contract | high | Re-read SKILL.md | Platform makes canary unnecessary | Canary proves usefulness |
| Claude has skill_activated OTel | Fact | Claude monitoring docs 2026-07-17 | high | Re-fetch docs / run local capture | Docs remove event | Works without TELEMETRY=1 |
| Cursor skills analytics are Enterprise | Fact | Cursor Analytics API docs | high | Re-fetch docs | API opens to all plans | Personal Cursor has same API |
| Codex lacks stable skill hooks | Fact / Hypothesis | Public issue + OTel docs | medium | Track Codex releases | Hooks ship | Codex equals Claude skill events |
| Host-first layered observability is the architecture bet | Product-owner decision | ADR-0001 | high | Owner reject | Owner reverts to canary-default | Implemented on all agents |
| Catalog-level PD complements skill PD | Repo-derived inference | Industry PD + scale analysis | high | S1 token budget experiment | Experiment shows no savings | Already saving tokens today |
| Catalog lists all 129 deploy skills once | Fact | validator PASS | high | Re-run validator | Deploy drift | Mounts match catalog |
| Core size 34 is a good permanent set | Opinion / Hypothesis | Draft catalog | low | Usage signals | Data contradicts | Empirically optimal |
| Appendix B is executable procedure | Fact (text) | ADR-0001 appendix | medium | Live capture on host | Steps fail on current Claude | Capture already done in this acceptance |
| This review is independent L3 | Out of scope | Independence = L1 | high | N/A | N/A | “Independent expert review” |
