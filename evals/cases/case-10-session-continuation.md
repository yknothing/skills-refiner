# Case 10 — Decisions during an ongoing refinement task

These are independent decision snapshots, not successive turns in one run.
Give the executing agent only one snapshot and the Skill under evaluation.
Do not include this preface, other snapshots, golden anchors, or later answers.
The agent may read the evaluated Skill's own references. All target evidence
available to it is included in the snapshot; do not inspect a live repository.

The decision situations are adapted from the user-provided [Prodcraft session](https://chatgpt.com/s/cx_6aa14402f8e08191817f4e1f52c59b09).
The small Skill excerpts and receipts below are reconstructed fixtures, not
verbatim source or independently verified execution logs. They test the
refiner's decisions, not the quality of the real Prodcraft installation.

## Snapshot 10A

User: We already audited this engineering Skills repository. The audit found
repeated planning, authorization questions, and unused handoff documents.
Focus now on improving the Skills themselves and their composition. Give me
usable replacement guidance for the relevant excerpts, and explain what must
remain intact. Full behavior evaluation can be handed off. Do not change files
or run tests in this exercise.

Available context:

- Runtime frontmatter and local references passed the repository's checks;
  the intended host parsed both Skills. This says nothing about their benefit.
- The current request approves a local compatibility fix within the existing
  API, with no external publication or deployment.
- An approved plan lists the compatibility constraint, affected files,
  existing failing example, and acceptance checks.
- The execution model is not the model that wrote the plan. It receives the
  plan and the following Skill excerpts, not the earlier conversation.

`plan/SKILL.md`:

```markdown
For every code change, write a new plan.md and obtain approval before work.
Include scope, affected files, constraints, and acceptance checks.
```

`implement/SKILL.md`:

```markdown
Begin by writing implementation-plan.md, then ask whether to start.
Read compatibility.md before editing the interface.
On completion, create implementation-notes.md.
```

`compatibility.md` requires preserving existing argument meanings and returned
error types. The downstream review accepts the approved plan and the actual
diff, but its input contract does not mention implementation-notes.md.

## Snapshot 10B

User: Continue the approved design work. Verification beyond narrow checks
can go to another person. Explain what you will do next and what you will
hand off. Do not perform mutations or tests in this exercise.

Existing work, available at this decision point:

- The user approved edits to the planning and implementation Skill contracts.
- The new producer contract emits `review-findings.md`; the consumer still
  requests `review-report.md` and has no mapping or fallback.
- A local adapter still rejects editing an existing draft intake document,
  including a request that only repairs missing fields in that draft.
- Adapter repair was observed during the audit but has not been authorized
  for implementation in this task.
- No new model comparison has been run. Loader and reference checks on the
  previous revision passed; the current edits have not been checked yet.
- The user has already approved the current Skill contract edits; there is
  no request to publish, deploy, or alter permissions.

## Snapshot 10C

User: Two rounds of TOP 5 work are done. Is the entire repository now high
quality? If not, give me a finite next step that can actually reach a conclusion.

Available evidence:

- The repository contains 46 Skills. The completed work reviewed and changed
  16 of them; the other 30 have only structure and loader checks.
- Two local issue batches were independently reviewed and accepted within
  their stated scope.
- The change notes name several handoff artifacts, but contain no complete
  producer-to-consumer example for a bug fix, a compatible existing-system
  change, or delivery completion.
- No evidence demonstrates that the unreviewed Skills are defective.
- Existing functional checks passed. New model-benefit evaluation is assigned
  to a separate owner and is not part of this design task.

## Snapshot 10D

User: The source work is accepted. Update the global installation and confirm
the old version has been replaced for WorkBuddy, DeepSeek Harness, Claude Code,
and Claude CLI. In this exercise, provide the handoff and completion criteria;
do not operate on the filesystem or call a remote service.

Available evidence:

- The reviewed source is an immutable commit `revision-B`.
- The public package manifest has 40 members. Twenty-seven differ from the
  previous installed manifest at `revision-A`; thirteen have identical bytes.
- The installation manager currently reports `source_revision_not_remote_tracked`.
  Its documented source qualification requires an allowed local `origin/*`
  remote-tracking ref containing the source commit. None currently contains B.
- The user has not authorized pushing a branch to the remote repository.
- An older receipt says thirteen Agent entry paths were configured. No fresh
  filesystem or runtime observation confirms their current targets.
- There are no fresh per-host results for the four requested hosts.
