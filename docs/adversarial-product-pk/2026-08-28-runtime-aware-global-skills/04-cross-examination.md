# 04 — Cross-examination

| Objection | Evidence tested | Disposition |
|---|---|---|
| O1 upstream authority | `origin-tracking-containment.v1`, exact Git-object materialization, unpushed-commit negative test | Closed for local origin containment; online remote/signature claim withheld |
| O2 review proof | CLI requires exact plan hash; active/operation bind that hash; no separate reviewer/time field | Machine gate closed; human-review gate remains Owner decision |
| O3 global scope | Panorama: 69 source-qualified, 145 path-qualified, 4 ambiguous | Closed by narrowing promotion scope; global inventory remains observational |
| O4 runtime promotion | Codex/Claude `CATALOG_ONLY`; Cursor `BLOCKED`; body/route/context unverified | Runtime-ready claim vetoed; filesystem/control slice may proceed |
| O5 collision determinism | Better preserves 13 observed collisions; Claude identity is name-only | Preserve behavior accepted; route determinism remains unverified |
| O6 context savings | no fresh-session token/context comparison | Claim withheld |
| O7 cleanup | 0 selected decisions; executable plan `null` | No cleanup authorized or executed |
| O8 recovery | plan.v3 successor, exact historical v1/v2 allowlist, 87/87 ProdCraft suite | Closed for tested schemas/fault model; no universal disaster-recovery claim |
| O9 operability | current local status, one 1.19 s fresh-list sample | Local manual operability supported; cross-machine/SLO claim withheld |

Live Better upgrade added two concrete cross-examinations after the first pass: a drifted predecessor had to reject direct
successor planning and preserve its bytes through an independent repair quarantine; a legal member-target digest change had to
avoid false collision attention without weakening retarget/external/descendant/drift detection。两项均已由真实状态与负例
tests 关闭，详见 [`11-live-upgrade-follow-up.md`](./11-live-upgrade-follow-up.md)。

The cross-examination also found a management-center gap: collection lifecycle was visible only at collection aggregate level,
while receipt-bound individual entries lacked a clearly typed lifecycle view. The implementation now preserves typed per-variant
lifecycle evidence in Panorama；the promotion scope also explicitly withholds any claim of complete provenance/lifecycle for every
global identity. The original P1 mismatch is therefore closed by implementation plus scope removal, not by claiming unavailable
evidence.
