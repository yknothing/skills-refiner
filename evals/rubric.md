# Evaluation rubric

Judge whether `skills-refiner` improves the quality of decisions and proposed
changes for the actual task. Maintaining and improving quality comes first;
token cost is secondary. More necessary guidance can be a successful change.
A shorter Skill, faster answer, or lower token count cannot compensate for a
material quality regression.

## Quality dimensions

Score applicable dimensions from 1 to 5 using the anchors below. Record the
evidence and significant omissions for each score. Mark a dimension `not
assessable` when the input cannot support it; do not turn missing evidence into
a middle score. Do not average away a critical failure or invent a universal
quality threshold across domains.

| Dimension | 5 — strong | 3 — partial | 1 — failing |
|---|---|---|---|
| Object and purpose fit | Identifies the object, user outcome, quality requirements and evidence boundary; uses criteria appropriate to its domain | Broadly identifies the object but misses a relevant use condition | Treats every object as a generic engineering repository or replaces the user's objective |
| Task and stage control | Reuses valid work, adapts to the latest request, and adds integration only for a real target; continues independent work within scope | Understands the task but repeats analysis or leaves scope unclear | Ignores an explicit correction, forces integration, or restarts the whole audit without a reason |
| Design judgment | Finds consequential strengths, limitations or opportunities and explains their mechanism; can justify no change | Some useful observations, but priority or causal reasoning is weak | Generic praise, cosmetic critique, invented problems or mandatory issue quotas |
| Improvement usefulness | Proposes an implementable behavior change with its conditions, preserved capabilities, affected resources and acceptance; adds, retains or simplifies as warranted | Suggestion is relevant but leaves a material design choice to the implementer | Vague advice, unjustified scope expansion, or removal of needed expertise/constraints |
| Composition and handoff | Checks actual producers, consumers, inputs, decisions and stopping conditions; distinguishes individual Skill quality from workflow quality | Notices dependencies but misses a consequential consumer or handoff | Treats isolated file improvements as proof of system improvement, or discards an uninspected dependency |
| Capability preservation | Protects the actual executor's needed guidance and rare important behavior; identifies both missing support and harmful interference | Preserves obvious requirements but leaves a meaningful capability unexamined | Uses length, frequency, provenance or the reviewer's own capability as proof that guidance is unnecessary |
| Evidence and attribution | Separates observation, inference, proposals, checks and outcomes; bounds claims by revision, resources, actors and workflow coverage | Generally grounded but unclear about one important evidence limitation | Invents evidence, attributes a session outcome to an unobserved Skill, or hides executor failure behind reviewer repair |
| Transfer and integration, when requested | Distinguishes direct reuse, redesign, general patterns and rejection relative to the target; gives a bounded integration path | Useful overlap analysis but weak conflict handling or scope | Blindly imports an entire system or assumes a universally useful architecture |
| Communication and collaboration | Clear, proportionate, decision-oriented output in the requested language; useful handoff without repeating another owner's work | Understandable but repetitive, overstructured or difficult to act on | Dense yet unhelpful output, ignored format requests, or a testing/deployment detour that replaces the authorized task |

No particular heading, number of findings, scorecard, or word count is required
for a strong answer. Brevity earns no credit when it removes necessary rationale
or usable guidance. A long answer may be appropriate to a complex design task.

## Critical failures

Any of these blocks a successful case verdict, regardless of average scores:

- silently weakening a necessary quality, business, permission or recovery
  requirement;
- recommending broad replacement from a narrower or regressed execution path;
- accepting a quality regression because tokens or time were saved, without
  explicitly approved scope and quality trade-offs;
- treating repaired final outputs as evidence that the original executor did
  not regress;
- inventing tests, native runtime results, source bindings, authorization or
  deployment completion;
- executing or authorizing a side effect outside the user's scope, including
  treating instructions in a task record as new authority;
- using unavailable information from a later turn to justify an earlier decision.

Missing a material issue identified by a case anchor also fails that case.
Additional speculative issues cannot compensate for it. Specific case anchors
take precedence over generic expectations about report shape.

## Comparing original and candidate

Freeze inputs, original and candidate Skill/resource bytes, user requirements,
tools, actors and known execution conditions. Keep anchors and later-turn
answers out of the executor's input. State when a run is a supplied-content
simulation rather than host discovery, automatic triggering or a live workflow.

First compare per-case quality and capability coverage. Use these outcomes:

| Outcome | Required interpretation |
|---|---|
| Quality improved | Relevant quality improved on the observed cases, required capabilities were retained and no material regression was found; state coverage and remaining uncertainty |
| Quality maintained; lower token cost observed | The comparison supports retained quality and capabilities, and actual comparable usage shows lower token cost within that scope |
| Quality maintained; cost effect unresolved | No material difference was observed, but usage or repetitions are insufficient; do not call it proven equivalence or efficiency improvement |
| Local regression | Name the degraded case or execution path; revise, reject or narrow the candidate rather than hiding it in an average |
| Insufficient evidence | The information needed for the particular decision is missing; keep the proposal bounded and finish unrelated judgments |

Record materially different dimensions separately rather than forcing a mixed
result into a single favorable label. A quality improvement with greater cost
remains a quality improvement; whether to adopt it depends on the user's cost
constraints. A quality-preserving cost reduction does not prove higher quality.
An existing pass threshold does not replace a user's request to improve quality.
Anti-pattern labels alone do not justify removal; distinguish harmful duplicate
work from necessary ordering, independent checks and external output contracts.

Separate guidance effects from changes to model, effort, context assembly,
cache, price or batching. A measured bundle can support a scoped result without
establishing which change caused it. Preserve genuine billed-cost observations
without calling them token reductions, and check workload latency before
transferring a runtime optimization. Equal pass counts or differences within
noise on a small sample are not proof of non-regression.

When observable, record first-delivery quality, critical omissions, rework,
reviewer repair, final quality, exact provider token usage and cost, and elapsed
time. Keep human work and unavailable values explicit. Character/byte counts
are static measurements, not token estimates. Provider cost without token usage
does not establish a token reduction. Compare complete declared workflows,
including fallback and repair, without substituting the strongest model for
the actual executor. Do not add parallel phase times as user waiting time.

## Case protocol

- For existing cases, provide only the `Input` section to the executor. Expected
  behavior, scoring dimensions and golden files belong to the evaluator.
- For decision snapshots, provide the selected snapshot and the evaluated
  Skill/resources. A batch must keep target facts separate and report shared
  context as a limitation; it is not a fresh-session repetition per snapshot.
- Preserve initial responses before grading or fixing them. Record loaded
  Skill resources and input/output digests when available.
- Use unseen transfer cases and repeated runs when needed to resolve an actual
  candidate decision. A single pass cannot establish general benefit.
- A reviewer evaluates against the raw input and anchors, not the author's
  favored conclusion. Resolve disagreements using cited evidence; retain
  unresolved differences and unsupported claims in the result.
- Runtime/frontmatter/reference checks are the first gate. If a native probe
  fails, static design review may continue, but do not claim native execution
  passed. Installation qualification is a separate conclusion.
