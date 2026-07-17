# Evidence Map — Observability + Pack Catalog ADRs

**Artifact target:** `docs/adr/0001-*.md`, `docs/adr/0002-*.md`, `docs/adr/artifacts/*`  
**Snapshot date:** 2026-07-17  
**Deploy root observed:** `~/.agents/skills` (129 skills post-Lark retire)

## Canonical sources (current)

| Source | Status | Use |
|---|---|---|
| Claude Code Monitoring docs (OTel / `claude_code.skill_activated`) | Verified via public docs fetch 2026-07-17 | ADR-0001 platform fact |
| Cursor Analytics API `/analytics/team/skills` | Verified via public docs | Enterprise-gated adoption metrics |
| Cursor forum “Hook on Skill usage” | Verified | No skill-use hook today |
| Codex OTel docs + PreSkillUse issue | Verified as public | Incomplete skill lifecycle hooks |
| `skill-debug` SKILL.md accuracy contract | On disk | Canary = proxy only |
| Agent Skills PD / Microsoft Skills / Cloudflare discovery RFC | Public | ADR-0002 industry alignment |
| `SCALE-ANALYSIS-2026-07-17.md` | Machine deploy docs | Scale targets |
| Catalog validator run | Ran 2026-07-17 | `PASS` core=34 listed=129 deploy=129 |

## Verified facts

1. Canary inject modifies `SKILL.md` and is reversible only via strip; it is not platform-proof activation.  
2. Claude emits skill activation OTel events when telemetry enabled; names may redact to `custom_skill` without `OTEL_LOG_TOOL_DETAILS`.  
3. Cursor skills analytics exist for Enterprise; no documented personal local exporter equivalent.  
4. Catalog YAML covers all 129 deploy skills with no duplicates (validator PASS).  
5. Catalog `enforcement: none` — no mount runtime shipped in this change.

## Assumptions

- Owner wants architecture docs + draft catalog before mount tooling (S1).  
- L1 adversarial review is acceptable for promoting ADRs to `docs/adr/` with limitations.

## Missing / out of authority

- Live Claude OTel session capture on this host (Appendix B not executed end-to-end here).  
- Market proof that pack UX won’t increase “skill not found” support load.  
- Cursor non-Enterprise usage metrics.

## Stale risks

- Do not cite pre-Lark “156 skills” as current without noting retire.  
- Do not claim canary dashboard = usage analytics product.
