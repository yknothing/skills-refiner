# Acceptance — ADR-0001 / ADR-0002 / Pack Catalog (S0)

**Date:** 2026-07-17  
**Judge:** accept-with-limitations  
**Independence:** L1 (role-separated; **not** independent)

## Scope checklist

| ID | Item | Result | Evidence |
|---|---|---|---|
| A1 | ADR-0001 written with layered model + non-goals | PASS | `docs/adr/0001-non-invasive-skill-observability.md` |
| A2 | Appendix B (Claude OTel → local JSONL) inside ADR-0001 | PASS | § Appendix B + consent gate |
| A3 | ADR-0002 pack catalog decision + stages | PASS | `docs/adr/0002-on-demand-pack-catalog.md` |
| A4 | Catalog artifact A covers deploy membership | PASS | validator listed=129 deploy=129 |
| A5 | ADR index README | PASS | `docs/adr/README.md` |
| A6 | Adversarial package complete | PASS | `docs/adversarial-product-pk/2026-07-17-observability-pack-catalog/` |
| A7 | Severe objections addressed or preserved | PASS | O1–O6 in `05-objections-and-disagreements.md` |

## Runnable gate executed

```bash
node docs/adr/artifacts/validate-skills-pack-catalog.mjs
# Observed 2026-07-17: PASS skills-pack-catalog validation
# core_count: 34  listed_count: 129  deploy_count: 129
# Paths in tool output are home-redacted (e.g. ~/.agents/skills), not absolute usernames.
```

## Explicit non-claims

- No claim that On-demand mounts are active on Claude/Factory/Cursor.  
- No claim that Claude OTel JSONL capture was run end-to-end on this host.  
- No claim of L3/L4 independent review.  
- No claim that canary inject is retired from the codebase — only demoted as default analytics path in architecture.

## Falsification monitors

1. Docs or marketing state “context saved by catalog” before S1 exists.  
2. `OTEL_LOG_TOOL_DETAILS` enabled in shared/CI defaults without consent record.  
3. Catalog validator fails (membership drift) and is ignored.  
4. `residual_library` grows without S4 split plan after new installs.

## Next recommended proofs (optional)

1. Owner runs Appendix B.6 once; attach redacted event sample to verification note.  
2. Prototype S1 mount for `profile: core` only; measure description token delta.
