# Pi user skill discovery repair

## Scope and result

Verified on macOS with the installed `@earendil-works/pi-coding-agent@0.86.0`.
Observations were taken on 2026-09-21 in Asia/Singapore (2026-09-20 UTC).
The user authorized the diagnosed repairs and submission. The deployed change
is two overrides in the user's Pi settings, plus the new `skill-debug` native
catalog helper and its instructions. No collection source, pattern document,
template, Impeccable variant, or activation canary was changed.

Implementation commit: `6ba8d74` (native probe, regression suite, Skill guidance,
and CI gate). The user settings are a separate local deployment; the repository
records the rules and verification, not the private settings file.

| Native user catalog observation | Before | After |
| --- | ---: | ---: |
| Selected skills | 210 | 153 |
| Better Skills pattern/template entries | 57 | 0 |
| Intended Better Skills members | 13 | 13 |
| Invalid-name warnings | 1 | 0 |
| Same-name collisions | 1 | 0 |

The candidate and live settings observations matched exactly. All 153 retained
entries initially kept their canonical paths and content hashes. Installing the
updated governance instructions then changed only the expected `skill-debug`
content hash; the other 152 selected entries remained identical.

## Cause and correction

Pi's package resolver discovers nested ordinary Markdown in shared `.agents`
grouping directories. Its skill loader accepts a non-empty description and
retains invalid names and overlong descriptions with warnings. Consequently,
`better-skills/docs/patterns/_template.md` became a skill named
`<kebab-case-slug>`. Another 56 pattern documents entered the same catalog,
including 36 documents whose frontmatter says `status: proposed`.

The two Impeccable installations both declare version `3.9.1`, but contain
different host paths and guidance. Pi already chose its dedicated variant.
The repair makes that selection explicit while preserving the shared variant
for other hosts. Raw SHA-256 values remained unchanged:

| Installed file | SHA-256 |
| --- | --- |
| `~/.pi/agent/skills/impeccable/SKILL.md` | `4e0bab72fc11296910a50c58dd4b371995766fd18a1b9c4d2b06c52333565419` |
| `~/.agents/skills/impeccable/SKILL.md` | `14c4642368557af1f7bbaaac0aa184b791e6d70665dfd8fc53d8d4124f81abb8` |

The user `settings.json` received these two rules, with actual absolute paths:

```json
[
  "!/absolute/home/.agents/skills/better-skills/docs/**",
  "-/absolute/home/.agents/skills/impeccable/SKILL.md"
]
```

All other settings were preserved. Candidate validation preceded a preimage-
checked atomic replacement. The raw settings digests are:

- Before: `sha256:bffb6cbce4556f978f4478de015fef0b1f8be22f7072530406dd48c0b6c558fb`
- After: `sha256:3b7b10985941f59e5277691c5667414268277ae1972f6dc7999c78dc13271c64`

To undo this host decision, remove only the two added overrides from the current
`skills` array and reload Pi. This intentionally re-exposes the original catalog
issues; restoring an old complete settings file could overwrite later settings.
The reference files remain readable and managed collection digests are untouched.

## Verification and review

- Native user catalog: real Pi `DefaultPackageManager` resolution followed by
  `loadSkills`, with complete retained-entry comparisons before/candidate/live.
- Installed helper: source and deployed bytes match for `SKILL.md` and
  `bin/pi-skill-catalog.mjs`; installed helper independently reproduced 153
  selected entries and zero diagnostics.
- Fresh interactive Pi startup: `pi --offline --no-session --no-extensions
  --no-tools`, with “Do not trust (this session only)” selected. The actual
  startup showed the corrected skill list without `[Skill conflicts]` or the
  template. No prompt/model invocation or persistent trust approval was made.
  Pi needed permission to create its normal temporary trust-file lock. The
  process then exited normally with Ctrl+D.
- Native regression suite: 6 tests passed with zero skips against a freshly
  installed Pi 0.86.0 package, installed with `--ignore-scripts`. Coverage includes
  the original failure, exact retained identities, symlink deduplication,
  intentional loose Markdown, relative settings paths, warning-versus-skipping,
  read-only snapshots, and unsupported/malformed inputs. The earlier local
  installed-package run also passed its five then-existing cases.
- Existing tests: installed layout 146 passed; discovery probe 27 passed;
  observability regression 14 passed; doctor smoke passed.
- Narrow skill scan: no static load blockers; `skill-debug` has a valid name
  and a 204-character description. Literal helper references exist. Static
  scan status remains `unknown`; native catalog loading supplies separate proof.
- Self-review checked scope, native resolver use, collision precedence,
  settings preservation, package-install avoidance, and result semantics.
  No independent-review claim is made. No blocking finding remains in this scope.

The helper is deliberately bound to Pi 0.86.0 and reports `CATALOG_ONLY` with
`runtime_qualified: false`. It excludes project and CLI resources and rejects
configured packages instead of initiating an install or silently omitting them.
An ordinary `.md` entry is an observation, not inherently invalid. Exit zero
means collection completed, including any warnings; it is not a quality gate.
Task execution, body access, gateway routing, and other Pi versions remain
unverified. The existing runtime evidence/profile schemas are not expanded or
given a false Pi qualification by this change.

## Routing record

```yaml
artifact: intake-brief
schema_version: intake-brief.v1
status: approved
approver: user
request_summary: Repair the diagnosed Pi skill discovery issues and submit the changes.
source_language: zh-CN
artifact_record_language: en
user_presentation_locale: zh-CN
work_type: Bug Fix
entry_phase: 04-implementation
intake_mode: fast-track
quality_target_context:
  runtime_context: host_runtime_tool
  exposure_profile: no_network_listener
  production_target: Local Pi user skill discovery and its native regression probe.
  non_targets: Collection source edits, skill retirement, workflow execution, and other host policies.
  evidence_refs: ["User startup transcript and repair authorization", "Scope and result above"]
scope_assessment: Two host overrides and a standalone read-only native catalog helper.
recommended_next_skill: pc-debug-expert
routing_rationale: Prior diagnosis and explicit repair authorization establish the bounded correction.
key_risks: ["Reference files must remain readable", "Same-name host variants must retain their bytes"]
questions_asked: 0
routing_changed_by_answers: false
```

Prodcraft was resolved through its installed runtime locator and managed sibling
packages. Its debugging, TDD, review, and verification guidance informed this
bounded fix; no strict-mode execution-state or full source-repository workflow
certification is claimed. Configuration/glue behavior used native boundary
characterization: the original failure was observed before deploying settings,
and preserved as the regression suite's negative control.
