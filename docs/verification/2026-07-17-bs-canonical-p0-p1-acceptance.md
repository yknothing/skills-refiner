# Acceptance Record — P0 / P1 / P2-9 / P2-10

**Date:** 2026-07-17  
**Judge:** accept-with-limitations (see adversarial package)  
**Independence:** L1

## Scope checklist

| ID | Item | Result | Evidence |
|---|---|---|---|
| P0-1 | Push helper fix | PASS | `origin/main` includes `cee340e` |
| P0-2 | Freeze Policy A | PASS | `~/.agents/skills/POLICY-BS-CANONICAL.md` |
| P0-3 | Gemini prose-craft | PASS | `readlink` → `bs-prose-craft` |
| P1-4 | Archive RECOVERY_REQUIRED | PASS | `recovery-archive/.../RECOVERY_REQUIRED.md` |
| P1-5 | Rewrite ARCHITECTURE/SYMLINKS | PASS | v3 docs present; Copilot noted |
| P1-6 | Clear broken discovery links | PASS | 0 broken after Copilot unlink |
| P1-7 | Sync skill-hygiene install | PASS | agents install hashes match workspace for helper/scan |
| P2-9 | skill-scan completability | PASS | timed 97s JSON OK; 100 unit tests; `5cd2ace` pushed |
| P2-10 | Converge governance entries | PASS | `CONTROL-PLANE.md` |

## Runnable gates executed

```bash
# unit
bash skills/skill-hygiene/tests/test-scan.sh   # 100 passed

# live inventory (accepted command line for completability)
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh \
  --json --no-write --skip-provenance-tree
# observed: exit 0, ~97s, schema skill-scan.v5
```

## Explicit non-claims

- `--skip-provenance-tree` does **not** prove installer tree integrity.
- Policy does **not** block future `npx skills add` of retired names without human diligence.
- This acceptance is **not** L3 independent review.

## Falsification monitors

1. Twin name reappears under `.claude/skills` or `.factory/skills`.
2. Timed scan with the accepted flags exceeds 120s or fails JSON parse.
3. `skill-health` (non-bs) reappears on discovery mounts.
4. Broken symlinks count > 0 on scanner agent dirs.
