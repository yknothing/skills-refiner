# Challenger First Pass

**Visibility:** evidence map + Champion outline  
**Evidence boundary:** same  
**Not validated:** whether installers will re-link retired names tomorrow

## Attacks

1. **False completeness:** Policy docs do not enforce installs. `npx skills add` can still recreate non-bs names unless humans obey POLICY.  
   Evidence class: fact (no installer hook) + hypothesis (reinstall risk).

2. **`bs-skill-health` still present:** Name similarity to retired `skill-health` and to `skill-hygiene` can re-confuse governance routing despite CONTROL-PLANE.md.  
   Evidence class: opinion / hypothesis.

3. **Scan “fixed” by skipping work:** `--skip-provenance-tree` makes inventory finish by weakening mutation provenance confidence. Oversized trees become `unknown`, which is correct fail-closed for mutation auth — but operators may think governance is “green” when provenance is truncated.  
   Evidence class: fact (flag behavior) + high severity for misuse.

4. **RECOVERY_REQUIRED debt:** Physical quarantine is fine; status CLI still emits recovery noise. Future operators may “fix” by deleting transaction dirs or re-applying.  
   Evidence class: fact.

5. **Copilot was missed initially:** P1-6 claimed cross-agent cleanup while `.copilot` still had three broken links until a late pass. Process gap.  
   Evidence class: fact.

## Required proof

- Live scan shows 0 broken symlinks after Copilot unlink.
- Acceptance checklist must forbid treating `skip-provenance-tree` as proof of installer integrity.
- POLICY must state reinstall prohibition explicitly (already does) and recovery archive must say “do not delete/re-apply” (already does).
