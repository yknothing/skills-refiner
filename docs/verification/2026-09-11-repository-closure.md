# Repository refinement, CI and installed artifact verification

Date: 2026-09-11 (Asia/Singapore).

The user approved the three recommendations from the repository retrospective:
connect omitted tests, align guidance across Skills, and verify real artifacts
through execution, independent review and publication. The accepted September 10
refinements are included; unrelated July 23 artifacts remain outside this change.

## Implemented scope

| Area | Change and preserved behavior |
|---|---|
| CI | All 23 existing test files are now referenced. Portable collection/source/runtime and panorama checks run on macOS and Ubuntu. Native collection transactions and runtime profile lifecycle run on macOS. Windows retains its bounded Git Bash contract. |
| Hygiene | Generated and hand-authored guidance use the same evidence standard. Length, age and low observed use do not justify removal. The entry shrank from 564 to 305 lines by moving collection and runtime procedures into two reachable references. |
| Operational references | All 6 collection Bash blocks and 2 runtime Bash blocks were preserved. Exact source/plan/operation identities, collisions, platform limits and recovery requirements remain. The runtime reference explicitly establishes its Node and launcher prerequisites. |
| Panorama | Existing authorization for read-only evaluation carries into hygiene. The menu is conditional; actual mutation retains its own exact-plan and confirmation requirements. |
| Appreciation | Short formats may explain one useful mechanism. No quota of weaknesses or overrated claims; the editorial checklist uses the same rule. |
| Maintenance docs | CONTRIBUTING includes all five Skills and platform-specific test commands; both READMEs and examples describe the behavior changes. |

The guidance/eval batch is `cf311da`; initial CI integration is `c5f2ef3`.
No runtime qualification schema, deployment controller, host profile or canary
behavior was changed. ADR-0009 remains Proposed; this does not complete its
entire multi-model evaluation program.

## Real artifact tasks and independent review

1. **Refine the actual hygiene package.** The reviewer compared the original
   entry with the changed entry and both references, including every moved
   command block, input prerequisite, identity and recovery rule. Ordinary
   health review now routes directly to scan/analysis; specialist procedures
   remain available when required. Only trailing blank lines were removed after
   the initial byte comparison. This verifies the resulting files and their
   task separation; it is not a measurement of token savings or model benefit.
2. **Collect and hand off the real local panorama.** The actual collector
   returned 222 entries and `COMPLETE` for the selected Codex/Claude view. Five
   target packages were present, without collisions, with healthy Claude
   projections. The independent reviewer checked the scoped facts against the
   original JSON and required one correction: installer receipts *claim* source
   ownership; the report must not call that claim a source attestation. The
   wording was corrected and rechecked. A separate full-byte comparison then
   proved all five installed predecessor packages matched commit
   `580ee1c4ef6bde931cb72678c78bafe598246026`.

The resulting handoff continues the authorized five-package review without a
second menu. Codex's absent dedicated-directory projection does not establish
absence from its shared discovery root and does not authorize adding links.
Panorama's `FULL` collector status also does not undo its default
`--skip-provenance-tree` limit. Existing collection profile conflicts and stale
runtime evidence stay separate from this ordinary-package release.

Independent artifact review found no remaining P0–P2 issue in this bounded scope.
These are two real artifact tasks, not a blinded behavioral A/B benchmark; no
general quality improvement, causality or cost reduction is claimed.

## Verification performed

- Local macOS, Node.js 24.4.1: all 23 test files passed. The nine newly connected
  Node suites passed 284 tests; the newly connected panorama shell suite passed
  26 checks. Existing CLI/native tests initially encountered sandbox restrictions
  on hardlinks, sockets, disk images and compiler temporary files; their isolated
  reruns passed. These failed attempts are not counted as passes.
- All 19 shell files passed `bash -n` and ShellCheck error checks. The common
  shell helper mirrors matched, and the native helper passed strict C syntax
  checking. Installed-layout tests exercised packages outside the checkout.
- The first remote run passed Windows and exposed 26 Unix runtime-evidence
  failures: tests stubbed CLI output but still resolved real Codex/Claude
  executables from the developer's PATH. The test now creates process-local CLI
  fixtures and restores PATH/temporary files afterward. Executable identity,
  evidence validation, recording and status remain real SUT operations. All 40
  runtime-evidence tests passed with `PATH=/usr/bin:/bin`, without host AI CLIs.
  Remote outcomes can be inspected in the
  [governance workflow](https://github.com/yknothing/skills-refiner/actions/workflows/governance-tests.yml);
  local success is not presented as remote success.

## Publication and installed checks

The initial published package set at `c5f2ef3` matched all 77 installed file bytes
and modes. All 65 previously observed source/projection paths retained their
types and raw link targets. Native installer receipts changed only for these
five names; their Git tree hashes matched the source revision.

The existing `skills` installer version 1.5.18 selects copy mode for a single
Agent. The first Claude-only invocation therefore produced five independent
Claude copies. Their exact bytes were checked, then the same installer was run
with `--agent codex --agent claude-code`, updating the shared source and restoring
the original Claude symlinks. No additional Agent directory was created.
Subsequent receipt/manifests belong to the same private release record; a
test-fixture-only successor must still be compared before claiming whole-package
equality with its newer commit.

The installed panorama launcher executed the installed scanner and collection/
runtime launchers and returned `COMPLETE`. This does not qualify body/route/context
predicates or resolve unrelated existing host profile conflicts.

| Skill | description characters | Portable YAML |
|---|---:|---|
| skills-refiner | 464 | pass |
| skills-appreciation | 250 | pass |
| skills-panorama | 349 | pass |
| skill-hygiene | 315 | pass |
| skill-debug | 204 | pass |

Names matched their directories; references were readable. Gemini CLI 0.39.1's
native parser returned exact installed bodies through both canonical and Claude
projection paths. This was an **offline parser/body-read check**, not Gemini or
Claude configured discovery, triggering or instruction-following. Other global
packages emitted unrelated parser warnings; they are outside this five-package
acceptance and were not edited.

Codex CLI failed before discovery at `config.toml:20:1`, with
`invalid type: map, expected a boolean` in `features`. This does not diagnose the
current desktop runtime. The proposed fresh Claude model session was rejected
by automatic approval review because it could send local internal context to an
external service; it was not executed or bypassed. Native model execution and
general behavior benefit therefore remain unverified.

## Recovery and evidence retention

Five predecessor packages and the native installer receipt were backed up,
extracted into a separate temporary directory, and checked against their original
hashes and modes. The private release directory is
`~/Library/Application Support/skills-refiner/releases/2026-09-11-c5f2ef3/`.
It retains the backup, original plan, scoped facts, independent review, test
receipts and installed manifests. Preserve it for rollback; re-observe current
state before restoring, especially if another installer has changed receipts.
No live rollback was performed and the installer is not claimed to provide an
atomic multi-package transaction. Scratch directories are removed after these
intentional recovery and verification artifacts are retained.
