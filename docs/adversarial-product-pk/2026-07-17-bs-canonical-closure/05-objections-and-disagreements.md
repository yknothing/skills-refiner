# Objections and Disagreements

| ID | Severity | Claim attacked | Evidence class | Resolution | Remaining risk | Veto |
|---|---|---|---|---|---|---|
| O1 | medium | “Policy fully prevents twin reinstall” | missing evidence (no installer hook) | accepted unresolved / owner process | bulk install recreates twins | no-veto |
| O2 | high | “Scan fix restores full provenance fidelity” | fact | scope removed: acceptance only claims completability + fail-closed unknown; not full tree verify when skipped/capped | operators misuse skip flag | no-veto (scope limited) |
| O3 | medium | “`bs-skill-health` cannot confuse governance” | hypothesis | accepted unresolved; CONTROL-PLANE forbids using it for topology | model mis-route | no-veto |
| O4 | high | “All agent broken links cleaned” (pre-Copilot) | fact | new evidence: Copilot unlinked; re-verified 0 | new agent dirs unknown to scanner | no-veto |
| O5 | medium | “RECOVERY_REQUIRED is closed” | fact | scope removed: closed as *archived disposition*, not state→COMMITTED | CLI noise / human mishandle | no-veto |

## Preserved disagreement

Champion wants to call the machine “Policy A complete.”  
Challenger allows “discovery+authoring+docs complete for listed agents,” not “installer-enforced forever.”
