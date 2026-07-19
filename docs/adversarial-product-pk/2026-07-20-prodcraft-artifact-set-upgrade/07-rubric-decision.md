# Rubric Decision

Scoring follows the `adversarial-product-pk` 0–3 rubric. This decision evaluates the architecture draft/review package, not implementation or migration.

| Dimension | Score | Reason |
|---|---:|---|
| Evidence | 3 | Machine, receipt, pinned source and set-diff facts are bounded; contrary evidence changed the design. |
| Independence honesty | 3 | L2 shared-packet limits and inherited-context contamination are explicit. |
| Strategic sharpness | 3 | The draft separates upstream artifact, qualification, desired state, observed reality, target projections and recovery. |
| User truth | 3 | It targets the requested physical ProdCraft breaking upgrade and directory-index/context pressure. |
| Differentiation | 3 | Artifact-set planning, identity-gated retirement, per-target projection and recovery exceed a package receipt/catalog. |
| Commercial reality | 2 | This is local governance architecture; market/pricing claims are withheld. |
| Feasibility | 1 | The model is implementable in principle, but every new control-plane component and live gate is unbuilt. |
| AI-native integrity | 2 | Agent discovery/routing/profile behavior is central, but no real Agent replay exists. |
| Trust and safety | 3 | Trust domains, explicit approval, no basename deletion, independent recovery and fail-closed states are normative. |
| Scope discipline | 3 | ProdCraft-only V1 is split into four stages; generic adapters/watchers/platforms are deferred. |
| Adversarial force | 3 | Critical attacks changed locator ownership, profile cardinality, transaction semantics and recovery placement. |
| Decision quality | 2 | A coherent first draft exists, but material Owner tradeoffs and runnable fixtures remain pending. |
| Falsifiability | 2 | Gates and reversal conditions are concrete but currently specified/unimplemented. |

## Threshold and decision

- No dimension scores 0.
- The package is complete enough to expose architecture choices and blockers.
- Critical objections are not hidden or mislabeled as passing tests.
- Owner decisions and runnable proof still block canonical promotion.

**Decision: accept the artifact as an adversarially reviewed first design draft; keep ADR-0004 `Proposed`.**

Allowed:

```text
Owner review of the proposed architecture
further document correction
implementation-plan drafting only after Owner approval
```

Not allowed:

```text
canonical architecture claim
implementation or live-migration authority
stable-version claim
Agent availability/context claim
independent/external review claim
```
