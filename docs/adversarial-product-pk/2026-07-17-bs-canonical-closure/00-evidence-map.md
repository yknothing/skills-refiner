# Evidence Map — bs-* Canonical Closure

**Snapshot:** 2026-07-17  
**Independence level:** L1 (same-session, role-separated; not independent)

## Canonical sources

| Source | Role |
|---|---|
| `~/.agents/skills/POLICY-BS-CANONICAL.md` | Frozen Policy A |
| `~/.agents/skills/CONTROL-PLANE.md` | Governance / entry priority |
| `~/.agents/skills/ARCHITECTURE.md` v3.0.0 | Deploy-surface map |
| `~/.agents/skills/SYMLINKS.md` | Distribution rules |
| `~/.agents/skills-quarantine/authoring-retired/2026-07-17-bs-canonical/` | Shelved non-bs twins |
| `~/.agents/skills-quarantine/recovery-archive/2026-07-17-bs-canonical/RECOVERY_REQUIRED.md` | Transaction debt disposition |
| git `main` @ `5cd2ace` / `cee340e` (pushed) | Helper + scan fixes |
| `/tmp/skill-scan-acceptance.json` | Live scan (97s, `--skip-provenance-tree`) |

## Verified facts

- Claude/Factory: 14 non-bs twin discovery links absent; 8 `bs-*` present.
- Agents authoring: 7 non-bs dirs shelved; `bs-*` present.
- Gemini `prose-craft` → `../../.agents/skills/bs-prose-craft`.
- Cross-agent broken discovery links: 0 after Copilot unlink.
- `skill-scan` completes within 120s with skip-provenance-tree; schema `skill-scan.v5`.
- `test-scan.sh`: 100 passed (includes provenance tree bounds).

## Assumptions

- Agents that only read `~/.agents/skills` by directory listing will see `bs-*` only for this twin family.
- `bs-skill-health` remaining as content auditor does not reintroduce topology governance (CONTROL-PLANE.md).

## Missing / out of authority

- No L3/L4 external review.
- No activation-probe proof that models prefer `bs-*` descriptions in live traffic.
- Full scan without `--skip-provenance-tree` not timed in this acceptance window.
