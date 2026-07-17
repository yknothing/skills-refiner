# Champion First Pass

**Visibility:** Evidence map + prior product discussion; not Challenger conclusions.  
**Evidence boundary:** Public platform docs + local deploy inventory + ADR drafts intent.  
**Not validated:** End-to-end OTel JSONL capture on this host; mount CLI.

## Thesis

The correct architecture split is:

1. **Observe at the host** (ADR-0001), with Claude local OTel as the first concrete adapter (Appendix B).  
2. **Disclose at the catalog/pack layer** (ADR-0002), because skill-internal progressive disclosure cannot cap description tax at 100+ skills.  
3. Ship **S0 artifacts now** (ADRs + catalog + validator) without pretending S1 mount exists.

## Why this bet

- Matches industry PD + discovery index patterns without inventing a new skill format.  
- Removes the unsafe default of rewriting third-party `SKILL.md` for metrics.  
- Gives a falsifiable Core size (34) under the ≤80 discoverable target **once mounts exist**.  
- Keeps control-plane skills distinct (no mega-skill merge).

## Claims that must not be made yet

- “Context window already saved.”  
- “We have cross-agent usage analytics in production.”  
- “Core list is empirically optimal.”  

## P0 scope Champion defends

- ADR texts + Appendix B privacy tree.  
- Catalog covering 100% deploy membership.  
- Validator gate green.  
- Explicit limitations + stages S0→S3.
