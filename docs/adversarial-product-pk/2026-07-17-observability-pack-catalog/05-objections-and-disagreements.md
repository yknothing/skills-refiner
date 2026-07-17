# Objections and Disagreements

| ID | Severity | Claim attacked | Evidence class | Resolution type | Remaining risk | Required next proof | Veto |
|---|---|---|---|---|---|---|---|
| O1 | high | “On-demand already saves context” | missing evidence | scope removed — S0 forbids savings claim | Readers still misread ADR titles | S1 mount demo + before/after description token count | no-veto (scoped) |
| O2 | high | TOOL_DETAILS casually enabled with telemetry | hypothesis | test/gate added — separate consent gate text in ADR-0001 | Process drift | Ops note template when first enabling TOOL_DETAILS | no-veto |
| O3 | medium | Core=34 is correct forever | opinion | accepted unresolved | Bad Core locks | ADR-0001 signals → revise catalog | no-veto |
| O4 | medium | `residual_library` is coherent architecture | repo-derived inference | accepted unresolved + S4 stage | Landfill pack | Split proposal ADR or catalog revision | no-veto |
| O5 | medium | Unified cross-agent observability ready | missing evidence | scope removed — adapters + gaps listed | Vendor drift | Per-agent adapter acceptance | no-veto |
| O6 | low | Validator proves PD works | fact | rejected with evidence — validator only proves membership/schema | False confidence in CI | Keep acceptance wording narrow | no-veto |

## Preserved disagreements

```text
Disagreement: Whether S0 catalog should live under docs/adr/artifacts vs only machine ~/.agents until S1 exists.
Why unresolved: Prefer repo-canonical architecture vs deploy-local truth; both valid.
Decision owner: Product owner
Evidence needed: First successful S1 mount using the repo catalog as input
What must not be claimed yet: Repo catalog is the live mount source of truth for agents
```

```text
Disagreement: Whether residual_library should be empty before accepting ADR-0002.
Why unresolved: Emptying requires many subjective pack splits now; delays S0.
Decision owner: Product owner
Evidence needed: Usage clusters or explicit owner pack map
What must not be claimed yet: Pack taxonomy is complete
```

## False-consensus probe

What would make this consensus dangerously wrong?

1. Teams enable TOOL_DETAILS broadly and leak secrets via tool args in OTel.  
2. Operators believe catalog YAML alone unmounted skills (no savings, false security of “we fixed sprawl”).  
3. Core omits a daily-used skill; users disable pack discipline and remount everything.  

Survives only with: separate consent gate, S0 honesty banner, Core revision loop via ADR-0001.
