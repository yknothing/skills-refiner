# Claim Ledger

| Claim | Label | Evidence | Confidence | Validation | Reversal |
|---|---|---|---|---|---|
| Non-bs twins absent on Claude/Factory discovery | Fact | path checks | high | re-list mounts | twin path reappears |
| Non-bs authoring shelved under quarantine | Fact | shelf dirs + MANIFEST | high | ls shelf | dirs restored to `~/.agents/skills` |
| Gemini prose-craft points at bs-prose-craft | Fact | readlink | high | readlink | retarget elsewhere |
| POLICY + CONTROL-PLANE + ARCH + SYMLINKS present | Fact | files exist | high | cat files | files deleted/drift |
| Helper fix pushed (`cee340e`) | Fact | `git log origin/main` | high | git fetch/log | revert |
| Scan bound + skip flag pushed (`5cd2ace`) | Fact | remote main | high | git log | revert |
| skill-scan completes ≤120s with skip flag | Fact | 97s run, valid JSON | high | rerun timed scan | hangs/fails |
| Broken discovery links = 0 on scanned agents | Fact | python walk after Copilot unlink | high | rescan | new broken links |
| RECOVERY_REQUIRED archived, not auto-committed | Fact | archive md + state files | high | read archive | illegal state rewrite |
| Models will obey CONTROL-PLANE without hooks | Hypothesis | — | low | probe/canary | observed mis-routes |
| Installer cannot recreate twins | Out of scope / false | no hook | — | — | — |
