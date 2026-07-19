# Objections and Preserved Disagreements

## Objection disposition ledger

| ID | Severity | Final architecture resolution | ADR binding | Canonical veto | Implementation/migration veto |
|---|---|---|---|---|---|
| O-01 gateway contract | Critical | Current gateway declared ineligible; require pinned collection-aware upstream gateway and manifest | §8.1, §8.3 | Closed by scope removal | Remains |
| O-02 reference closure | High | Choose upstream portable-reference contract; no ad-hoc symlink, closure growth or installed-content rewrite; zero new breaks | §8.4 | Closed by selected design | Remains |
| O-03 discovery staging/cutover | Critical | Stage outside all roots; Agent-specific eligibility; quiescent non-zero-downtime cutover | §8.5, §8.6 | Closed by scope removal | Remains |
| O-04 identity/trust/stability | High | Split artifact identity, publisher/source trust and scoped qualification; URL is locator only | §4.1–§4.3 | Closed by contract and honest V1 trust limit | Remains |
| O-05 pinned/stable enum | High | Orthogonal lifecycle, qualification, selection and activation | §4.3 | Closed | Remains |
| O-06 ledger overclaim | High | Move ledger out of deploy root; separate anchor; file+directory durability; schema; narrow accidental-corruption threat model | §6.1–§6.2 | Closed by contract | Remains |
| O-07 freshness actor | High | `observed_at + valid_until`; compute at read; synchronous mutation preflight; watcher deferred | §6.3 | Closed | Remains |
| O-08 V1 overload | High | ProdCraft-only vertical slice; generic adapters/watcher/platform expansion deferred | §9 | Closed | Remains |
| O-09 raw installer drift | High after new evidence | Bare global update is unsupported external mutation; reconcile artifact-set add/remove/rename/split/merge/namespace changes | §7 | Closed | Remains |

## Evidence Clerk conflicts

| ID | Conflict | Disposition |
|---|---|---|
| EC-01 46 old vs 40 `pc-*` | Current set is explicitly `legacy/unresolved`; neither it nor latest can activate without manifest/qualification | Resolved for architecture; version choice remains migration gate |
| EC-02 gateway contradiction | Current gateway made ineligible; upstream collection-aware contract required | Resolved for architecture |
| EC-03 incomplete/broken graph | Reference graph and `newly_broken_references == 0` are hard gates; selected upstream portable-reference solution | Resolved for architecture; evidence gate remains |
| EC-04 projection scope | 92 limited to Claude+Factory; all active surfaces must come from adapter inventory | Resolved for architecture; inventory gate remains |
| EC-05 no receipt revision | Receipt cannot establish coherent release; unresolved source binding is ineligible | Resolved |
| EC-06 SQLite inference | Removed external-native-dependency claim; file ledger is a V1 decision subject to fitness tests | Resolved |
| EC-07 moving upstream source | Vercel and ProdCraft source observations pinned to exact commits | Resolved |
| EC-08 current/future laundering | ADR distinguishes specified/unimplemented/migration veto and states no current completion | Resolved |
| EC-09 natural authority overclaim | Owner decision narrowed to authoring/content authority; trust/qualification/observation split | Resolved |

## Preserved disagreements and Judge rulings

### D-01: Must an exact ProdCraft revision be selected before the ADR can be canonical?

- **Evidence Clerk position:** Yes; otherwise the 46→40 conflict remains unresolved.
- **Champion/Challenger convergence:** The architecture can be canonical if it explicitly refuses all candidates until exact version and compatibility gates pass.
- **Judge ruling:** Exact version selection is a deployment promotion decision, not a prerequisite for recording the authority and migration architecture. The ADR is accepted with limitations; no version is qualified or active by this decision, and migration authority remains blocked.

### D-02: Should the file ledger require a sealed head or only narrow its claim?

- **Option A:** No anchor; admit tail deletion is undetectable.
- **Option B:** Separate macOS anchor plus narrower non-malicious threat model.
- **Judge ruling:** Choose B for V1 mutation safety. `~/Library/Application Support/skills-refiner/anchor/ledger-head.json` is independently addressed from `~/.agents`; it is not claimed to resist malicious same-user rewriting. The backend and crash ordering remain implementation gates.

### D-03: How should existing external relative references be preserved?

- **Options:** generated alias, expand closure, patch installed content, or require upstream portable reference.
- **Judge ruling:** Require upstream portable reference. This is the smallest boundary that preserves authoring authority and avoids hidden discovery aliases. A member without it is excluded from eligibility.

### D-04: Is a resident watcher required for first-version consistency?

- **Judge ruling:** No. Correctness comes from read-time expiry and synchronous command preflight. Watcher is a future latency optimization, reducing V1 state space without weakening truthfulness.

## Unresolved risks accepted at ADR level

These are not unresolved architecture contradictions; they are explicit implementation blockers:

1. no collection-aware ProdCraft revision has been qualified;
2. no complete reference extractor or target graph exists;
3. no Agent recursion/cache/reload adapter has passed;
4. ledger/anchor durability and kill recovery are unimplemented;
5. no migration dry-run or 46+92 round-trip evidence exists;
6. no Agent-specific context before/after evidence exists;
7. bare external mutation remains detectable only at the next observation;
8. unsigned origins provide Owner-approved provenance, not cryptographic publisher identity.

None of these may be rewritten as completed, production-ready or stable in downstream documents.
