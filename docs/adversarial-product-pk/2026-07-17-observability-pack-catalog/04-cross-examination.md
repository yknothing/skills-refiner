# Cross-Examination

## Challenger → Champion

**Q1:** Without S1, why accept ADR-0002 as architecture rather than a backlog note?  
**A1:** Because the decision (catalog-level PD + pack mounts) changes what we refuse to build (super-index skill, canary-as-metrics). S0 is a binding non-goal set + artifact contract. **Label:** Product-owner decision + Repo-derived inference.  
**Limitation accepted:** No context savings claim until S1.

**Q2:** Does Appendix B create pressure to enable TOOL_DETAILS?  
**A2:** Risk acknowledged. ADR-0001 updated with **separate consent gate** and ban on claiming named adoption without it. **Label:** Fact (doc update) + Opinion (process will be followed).

**Q3:** Is `residual_library` fatal?  
**A3:** Not fatal for S0 if marked debt (S4) and not marketed as elegant taxonomy. **Label:** Opinion. Challenger retains medium severity as accepted unresolved risk.

## Champion → Challenger

**Q4:** Should we block ADR promotion until live OTel capture succeeds on this host?  
**A4 (Challenger):** Block **production telemetry rollout** claims; do not block S0 architecture docs if Appendix B remains “procedure not executed.” **Resolution:** scope removed for e2e OTel from this acceptance.

**Q5:** Is Enterprise-only Cursor a reason to reject host-first strategy?  
**A5:** No — it strengthens host-first *with adapters and honesty about gaps*. Reject only if docs claim parity. **Label:** Fact (Enterprise gate) + Opinion (strategy still sound).
