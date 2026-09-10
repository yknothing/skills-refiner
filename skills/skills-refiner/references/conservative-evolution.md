# Quality-first Skill refinement

Read this when proposing content changes, comparing quality and cost, or
adapting guidance to a workflow's actors and stages. The aim is better work
while retaining required capabilities. Cost reduction is a secondary benefit,
not a reason to weaken the quality target. A baseline is a comparison point,
not a ceiling: pursue a material quality improvement when the task calls for
it, even when the current version already passes its minimum checks.

## Locate the useful behavior

Identify the purpose of the disputed guidance before editing it. It may contain
domain knowledge, a decision rule, an organization requirement, execution
support, an acceptance condition or a resource entry point. A paragraph can
contain more than one of these; modify the relevant part rather than discarding
the whole resource.

Ask who plans, executes and accepts the work, using only the identities and
conditions actually known. One model may perform all roles; another workflow
may use different models, people, effort settings or fallback routes. Do not
invent a mandatory multi-agent architecture. Record unknown actors only where
they limit the particular decision.

The executor may receive a plan derived from a Skill without reading that Skill
directly. Check the actual handoff: goal, decisions, scope, necessary resources,
acceptance requirements, unresolved questions and current state. Do not assume
it receives the planner's whole conversation. The reviewing model being able
to solve the task without an instruction does not show that the executor can.

## Diagnose before choosing the edit

| Situation | Useful response | What must not be lost |
|---|---|---|
| Executor lacks a consequential decision criterion or domain exception | Add the necessary rule or a worked example at the point of use | Existing scope, source fidelity and acceptance requirements |
| Valid approved work is repeated | Consume the existing artifact and check whether changed scope invalidates it | The actual planning information and authorization boundary |
| A rule works for one task but obstructs another | Clarify its preconditions and alternative behavior | The original task's legitimate protection |
| Two instructions supply the same protection | Check both callers; consolidate only if remaining access covers them | Required information for every affected consumer |
| A valuable reference is loaded for unrelated work | Adjust its exposure or retrieval condition | The content and discoverable access for tasks that need it |
| A coherent Skill has no observed gap or justified new requirement | Retain it and state the evidence boundary | Its working capabilities and simple scope |
| A failure may come from a host, tool, permission or missing handoff | Identify that layer and the specific missing evidence | Useful Skill guidance that is not implicated |

For example, an approved compatibility plan already names constraints, affected
files and acceptance checks. A downstream Skill that always creates another
plan can instead verify and consume that plan. It still needs the compatibility
rules and must surface material scope changes. Eliminating both the duplicate
planning step and the compatibility guidance would conflate overhead with
necessary execution support.

A new behavior proposal needs a causal rationale, not a claim of measured
benefit. Task summaries and user corrections can motivate a candidate, but
without loading/usage evidence they do not identify the causing instruction.
Consider a plausible alternative cause before turning one case into a rule.
Do not promote a project convention into a universal requirement.

Anti-pattern signals are hypotheses, not deletion evidence. Uppercase words,
numbered steps, repetition, age or unknown authorship can locate guidance to
inspect; classify its function and current execution conditions before editing.
An old workaround may still encode a live tool requirement. Missing provenance
or absent recent failures does not invalidate a protection for rare events.
Distinguish a model knowing how to plan from an executor reliably preserving
required decisions, ordering and recovery. Use the actual model and fallback
paths when known, not a presumed newest-model replacement.

Match specificity to the operation. Remove demonstrated duplicate work without
removing independent verification; retain ordering where later actions depend
on earlier evidence. Rewrite emphasis or prose when useful, preserving the
underlying requirement. Distinguish stylistic word limits from actual output
contracts: a receiving system's payload limit remains necessary even when a
model could produce a better explanation with more space.

## Preserve the behavior boundary

Bind the recommendation to the available source revision, the specific
instructions and their required resources. Check affected producers, consumers
and alternate paths. Main-file equality alone does not bind behavior when
referenced files contain rules. If a necessary resource or execution condition
changes, reassess the dependent recommendation; preserve unrelated established
facts and historical evidence.

For a proposed simplification, state what information and decision support
remains, how affected actors obtain it, and which important ordinary and rare
tasks it still supports. For an addition, state the observed or well-grounded
capability gap and how the extra guidance addresses it. Neither direction is
automatically safer or higher quality.

Content changes, exposure changes and lifecycle actions are distinct. Retaining
a Skill does not mean its value has been proven. Revising its guidance is not
installation authority. Retirement, isolation or replacement must use the
applicable qualified mechanism and exact approved scope; this reference
provides design judgment, not an execution protocol.

## Compare quality before cost

Use the user's quality requirements and domain standards, not compliance with
the Skill's own preferred sequence, as acceptance criteria. Freeze comparable
inputs and original/candidate resources. Keep models, tools, supplied knowledge
and permissions constant when attributing an effect to guidance; also control
effort and the request/context assembly. When changing planning guidance,
examine the resulting handoff and downstream behavior as well as the planner's
output.

Content refinement and runtime optimization need distinct evidence. If model,
effort, cache placement, pricing or batching also changed, report the measured
configuration bundle's result without assigning its benefit to shorter text.
Separate token volume from cache and price effects on billed cost. Validate
runtime proposals against the actual host's supported behavior and the task's
latency requirements; an overnight batch result does not qualify an interactive
path. Locate a confirmed API incompatibility in the guidance or code that
introduces it. Correct affected Skill guidance within scope; application
request-builder changes retain their own ownership and authorization boundary.

Evaluate the executor's original delivery before acceptance or repair. Record
material errors, omitted capabilities, reviewer intervention and final quality
separately. A reviewer who fixes every output can conceal an execution regression.
Report affected paths individually; a fallback failure cannot disappear into
the main path's average.

- Prefer a supported quality improvement when its cost fits the user's bounds,
  even if the candidate is longer or uses more tokens.
- Consider cost reductions only after examining retained quality and coverage.
  Do not silently accept more mistakes or dependence on reviewer repair to
  save tokens. Any proposed quality trade-off must be explicit and authorized.
- Missing quality evidence limits adoption claims; it does not prevent a
  bounded design proposal or unrelated improvements from being completed.
- One equal result is not proof of equivalence. Use unseen cases or repeated
  samples when they can resolve a material remaining uncertainty. A small
  sample or a difference within noise does not establish non-regression; use
  the task's tolerable degradation and important failure paths to decide what
  further evidence is needed, rather than demanding a universal sample count.

Track actual provider token usage and cost when available, including planning,
execution, acceptance, retries and repairs. Keep exact bytes/characters separate
from tokens. Preserve each measurement's stated unit: an undefined `usage`
field is neither a token count nor monetary cost. Do not relabel its change as
a token or financial saving. Cost without token usage does not establish token
counts. Report human work and unavailable values explicitly, and use actual
wall-clock time rather than summing concurrent stages.

Conclude at the supported level: observed quality improvement; retained quality
with observed cost reduction; no material difference with unresolved cost;
local regression; or insufficient evidence. Describe mixed results rather than
forcing a favorable aggregate. Design acceptance, behavioral evidence and
deployment readiness can close at different times.
