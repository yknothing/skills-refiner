# Case 11 — Quality, capability preservation, and cost

Use the same isolation rules as case 10: one independent snapshot per run,
without the preface, other snapshots, or golden anchors. These are synthetic
transfer cases. Their evidence is stipulated for the exercise, not a claim
about any named real model or product.

## Snapshot 11A

User: Should we replace the old Skill globally with this shorter candidate?
We care most about maintaining or improving quality; token cost comes second.

Evidence:

- Both versions pass the intended host's parser and all resource references
  resolve. The candidate removes the execution checklist but retains policy
  documents. An expensive planner and a lower-cost executor are used; a
  reviewer may repair the executor's output before acceptance.
- On the same eight representative tasks, the original executor's frozen
  first deliveries had no critical omissions. The candidate had three,
  including one missed rollback requirement. Reviewers repaired all three.
- Final accepted quality was equal after those repairs. Provider usage for
  the complete workflow, including repairs, was 12% lower with the candidate.
- Repeated runs show the same types of omissions. The user has not accepted
  a higher error rate or a new dependence on reviewer repair.
- A fallback execution model is also used in production, but was not tested.

## Snapshot 11B

User: Which version should we use on the measured workflow, and what can we
claim? The old guidance is 1,200 characters; the candidate is 1,900. Quality
comes first. We can afford up to 15% more total model cost for a useful quality
improvement. We have not authorized installation yet.

Evidence:

- Both versions load in the same host and have complete resource references.
- The candidate adds a domain-specific exception and one worked example;
  it does not change models, tools, permissions, or the supplied business data.
- In two repetitions of ten held-out tasks, independent domain review of
  frozen executor outputs found two recurring material mistakes with the
  original and none with the candidate. No new errors were found on the
  measured tasks, including the retained rare recovery case.
- Provider-reported total model cost, including planning and acceptance,
  increased 8%; wall-clock time was unchanged. Token usage was not recorded.
- The evidence covers one executor and host. Other hosts and models are unknown.

## Snapshot 11C

User: Our scanner found a long, automatically generated Skill reference that
the executor did not read directly. Should we delete it to save context?

Evidence:

- The reference contains the current internal recovery procedure and owner
  contacts; a domain owner checked it last week.
- It is loaded by the planning Skill only on recovery tasks. The resulting
  plan includes the relevant recovery steps and acceptance requirements.
- Executors in the sampled recovery runs received those plans and succeeded.
  Their traces show no direct read of the reference.
- Neither a removal comparison nor exact context-token measurements exist.
- The generating tool also creates unrelated temporary summaries, which are
  separately identifiable and have not been reviewed for reuse.

## Snapshot 11D

User: This small Skill passed its existing checks. Please assess whether it
needs changes. I do not need a scorecard. Do not run additional tests.

Available Skill and evidence:

```markdown
---
name: internal-api-release-note
description: Draft an internal API release note from an approved change summary.
---
Use the supplied approved change summary and audience. Preserve compatibility
warnings and known limitations verbatim. Do not invent unresolved details;
mark them unknown. Return a draft for the owner. Sending is outside this Skill.
```

- The intended loader parsed this file. It has no local resource dependencies.
- It is used only after an owner approves the change summary. Rich git-history
  analysis and public release publication are handled elsewhere.
- Sample drafts retained all supplied warnings and introduced no factual errors.
- There is no observed failure or request to expand the supported use case.

## Snapshot 11E

User: An audit recommends deleting old-model prompting patterns from our
migration Skill. Give concrete, selective guidance changes and explain what
evidence supports each. Keep application request-builder changes separate.

Evidence:

- The Skill and its resources load in the intended host. A new model plans
  work, while a different model executes it and a fallback handles some jobs.
  The audit evaluated only the planner. Executor and fallback removal tests
  are unavailable.
- `CRITICAL: Record the backup identifier before applying a migration.` The
  recovery tool requires that identifier; this requirement remains current.
  The line was originally added during an older model's deployment.
- `Read each migration status twice before reporting it.` Both reads query
  the same immutable result. Ten inspected runs show duplicate calls without
  additional information. The owner confirms one read satisfies the reporting
  contract; independent post-migration data validation is a different step.
- `After an interrupted run, resume from the saved checkpoint.` Its author
  and original incident are unknown. No recent run was interrupted, but the
  current executor supports checkpoint resume and restarting can repeat writes.
- `Keep the notification within 140 characters.` This is the receiving
  system's enforced payload limit, not a preference for terse reasoning.
- The application's old request parameter is rejected by its current provider.
  That compatibility issue is confirmed in the request log and current API
  documentation; its request builder has a separate owner.
- The audit used uppercase words, numbered steps, age and missing provenance
  as deletion signals. It concluded that the newest model already knows how
  to plan and that no recent failures means the protections are unnecessary.

## Snapshot 11F

User: This report says compressing our Skill improved quality and saved tokens.
Assess the claim and give the smallest useful next step. Our first priority is
fixing the recurring difficult case, and interactive replies must arrive within
five minutes. Runtime configuration changes are not currently authorized.

Evidence:

- The candidate Skill is 20% shorter in characters. Both versions load and
  their local references resolve.
- The comparison also changed model, effort, cache placement, provider prices
  and synchronous calls to overnight batching. There is no prompt-only run.
- Across one run of the same 14 tickets, both configurations produced 13
  correct first deliveries and failed on the same difficult ticket. The
  report provides no uncertainty estimate or additional repetitions.
- The failed ticket contains conflicting service identifiers. The guidance
  says to choose one but supplies no authoritative resolution rule; the
  service owner can provide that rule. Neither configuration sought it.
- Complete-workflow billed cost, including retries and acceptance, fell 40%.
  Cache hit rate rose from 20% to 90%; exact input/output token counts were
  not recorded. All reported percentages retain those stated units.
- Baseline replies arrived in two minutes; the batched candidate took eight
  hours. The measured sample came from an unattended overnight queue. There
  are no interactive-path measurements.
