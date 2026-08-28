# 11 — Live Upgrade Adversarial Follow-up

## Trigger

The previous packet described a candidate control plane. The user required a real latest-version upgrade, so Better Skills was
upgraded on the actual `$HOME/.agents/skills` surface. This follow-up treats any new finding as evidence against the prior design,
not as an exception to be explained away.

## Attack A — Drift and upstream advance happen together

### Observation

- old active operation: `better-skills-11c77e3a11da`；
- observed issue: `MEMBER_DRIFT:bs-reflect-loop`；
- latest candidate: remote main `2198c88d55383f97e47ea51d914dc7703051091b`，13 members；
- direct successor planning: rejected with `predecessor_drift` before mutation。

### Adversarial question

Can “upgrade to latest” overwrite or silently absorb the drift because every old byte will be replaced anyway?

### Result

No. The old generation was repaired first through attempt
`repair-0b081b1d-7965-4712-8b4d-03766e41c9b9`，bound to the old operation and plan hash. The actual pre-state
inode `276252082` / manifest `sha256:5d6e89...cd0bde` was quarantined. The reconstructed old generation was published as
inode `276868419` / manifest `sha256:9eb833...1b18d` and the repair record committed. Only then was successor
`better-skills-627a600ad94b` compiled and applied. Its predecessor quarantine retained the same `276868419` inode；the repair
quarantine also remained.

**Disposition:** P1 closed. The two-stage flow preserves user bytes, old desired state and new candidate authority separately.

## Attack B — Collision snapshots across generations

### Observation

After the successor was active and byte-exact, all 13 Claude preserved symlink paths and resolved targets were unchanged；only
`bs-reflect-loop` had a legitimate target digest change. Because the old comparison required the entire 13-entry set to remain
byte-for-byte equal, that single difference raised aggregate `PRESERVED_COLLISION_SET_CHANGED` attention.

### Adversarial question

Can the controller avoid this false positive without creating a digest bypass that hides retargeting or content drift?

### Fix boundary

Commit `e680b8d` permits digest normalization only when all of these predicates hold:

1. planned and observed collision counts and all non-digest fields are canonical-equal；
2. both entries are resolved symlinks；
3. the resolved target is exactly the current member root, not a descendant；
4. collection root and INDEX match the active plan；
5. the member is a real 0755 directory and its deployed digest equals the INDEX member digest。

Negative cases keep their original behavior: member drift becomes `DRIFTED` and attention；retarget to another member, external
target change and member-descendant target remain attention.

### Verification

- managed-collection suite: 85/85 PASS；
- installed-layout suite: 146/146 PASS；
- syntax and `git diff --check`: PASS；
- live Better status: `FILESYSTEM_READY`，`name_collision_status=OBSERVED`，13 collisions，
  `management_attention=[]`，`issues=[]`。

**Disposition:** P1 closed. The exception is derived from the verified active generation rather than from a name or path-prefix
heuristic.

## Final live evidence cut

| Surface | Evidence |
|---|---|
| remote main equality | 4/4 at `2026-08-28T17:08:33Z` |
| collections | 4/4 `FILESYSTEM_READY`；69 source-qualified members |
| full scan | 217 canonical / 767 entries / 550 links；broken/runtime/collection blockers all 0 |
| runtime profile | `runtime-profile-a26f9a00fcfd`，`DEPLOYMENT_READY` |
| Codex | `sha256:02cef6...109b7`，147 observed，16/16 canonical-path，`CATALOG_ONLY` |
| Claude | `sha256:b56667...dae99`，167 observed，16/16 name-only，`CATALOG_ONLY` |
| Cursor | `sha256:bb9895...6b2e1`，not logged in / timeout，`BLOCKED` |
| Panorama | generation `764f2a87-4681-4cac-92b7-05b17f1354ea`，`COMPLETE/FULL` |

## Residual findings

| Severity | Finding | Promotion effect |
|---|---|---|
| P2 | Active successor status does not audit every historical predecessor repair quarantine. | Retain as history-audit limitation；current active/undo chain remains verified. |
| P2 | Panorama top-level summary does not aggregate collection `management_attention`. | Operators must read detailed collection rows；add bounded summary aggregation later. |
| P2 | Direct relative-vs-absolute raw-target test variants could be expanded. | Non-blocking；exact raw/resolved target equality already enforces the boundary. |

## Reviewer verdict

P0 = 0，P1 = 0。The live upgrade strengthened the design because it forced a real drift/upgrade interleaving and exposed a
generation-sensitive invariant that fixture-only acceptance had missed. Promotion remains `OWNER-DECISION-REQUIRED` solely for
the five active exact hashes；this follow-up does not broaden runtime, cleanup or context claims.
