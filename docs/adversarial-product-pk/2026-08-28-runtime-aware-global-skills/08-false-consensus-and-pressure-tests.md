# 08 — False Consensus and Pressure Tests

| False consensus mode | Pressure test | Expected fail-closed outcome |
|---|---|---|
| “A revision string is upstream.” | Plan from an unpushed commit not contained by approved origin-tracking refs. | Candidate rejected before mutation. |
| “Plan hash exists, so a human reviewed it.” | Require reviewer, exact hash, decision and time in promotion packet. | Human-review gate remains pending when record is absent. |
| “Catalog means runtime works.” | Use divergent unique body markers and record actual body/route/context events. | Current evidence cannot advance past `CATALOG_ONLY`. |
| “Receipt time is a verified event.” | Supply a format-valid but false installer timestamp. | It remains `installer_declared`, never `verified`. |
| “Same name means same Skill.” | Present two repositories with one name and divergent bodies. | Preserve both; no mutation or source-qualified merge by name. |
| “Delete active root and controller will reconstruct it.” | Remove the whole active physical collection in an isolated fixture. | Status reports recovery required; no silent ready or automatic network rebuild. |
| “Latest upgrade may overwrite existing drift because the new tree supersedes it.” | Drift one active member, then plan a newer successor. | Direct plan fails before mutation；repair preserves drifted pre-state before successor is replanned. |
| “A preserved symlink target digest must never change.” | Upgrade the exact managed member while preserving the same symlink target identity. | Verified member-root digest change is generation-derived；retarget/external/descendant/drift remains attention. |
| “Review list authorizes cleanup.” | Compile cleanup with 0 selected decisions. | `executable_plan` remains `null`. |
| “Nesting saves context.” | Compare fresh sessions with identical task/runtime and measured prompt/context usage. | Claim stays withheld until repeatable measurement exists. |

These tests are designed to attack attractive summaries, not only malformed JSON.
