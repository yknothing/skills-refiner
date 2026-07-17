# Cross-Examination

## Challenger → Champion

**Q1:** What stops tomorrow’s bulk install from restoring `requirements-engineering`?  
**A1:** POLICY-BS-CANONICAL.md rule 2–3; no technical installer lock. Residual risk accepted as owner process control. Label: product-owner decision + accepted unresolved (medium).

**Q2:** Is scan completability a true fix or a skip?  
**A2:** Both: hard ceiling `MAX_PROVENANCE_TREE_FILES=400` fails closed to `provenance_tree_too_large`; optional `--skip-provenance-tree` for inventory speed. Mutation authorization still requires matching tree when not skipped. Tests cover both. Label: fact.

**Q3:** Why keep `bs-skill-health`?  
**A3:** Better-Skills family auditor for skill *content*; topology governance stays `skill-hygiene`. Documented in CONTROL-PLANE.md. Residual naming confusion risk accepted. Label: product-owner decision.

## Champion → Challenger

**Q1:** Does Copilot miss invalidate P1-6?  
**A1:** It invalidated the first claim of completion; after unlink, broken_count=0. Scope must include all AGENT_DIRS the scanner knows (including `.copilot`). Resolved with new evidence.

**Q2:** Should RECOVERY_REQUIRED transactions be deleted?  
**A2:** No — protocol terminal; archive file is disposition authority. Veto on auto-deletion.
