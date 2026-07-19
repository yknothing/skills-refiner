# Owner Decisions

## Explicit inputs already received

1. The target is a physical ProdCraft migration, not only a catalog/documentation exercise.
2. The expected upgrade replaces messy old unprefixed ProdCraft Skills with an approved upstream latest `pc-*` set.
3. GitHub or an equivalent versioned repository is the natural authoring/content authority, while version stability requires separate judgment.
4. A directory index/control plane must manage many Skills without itself consuming normal Agent context.
5. The mechanism must preserve provenance, install/update time, version, update history and actual-filesystem consistency.
6. Manual deletion and other out-of-band drift must not leave management state falsely healthy.
7. The management mechanism and migration must be robust, convenient, elegant and low-friction from the first real version.
8. The recommended source-store/projection split was approved for a first ADR draft with adversarial review and acceptance.

These decisions authorize this document package. They do not authorize implementation or mutation.

## Decisions requested before canonical promotion

1. Approve `gateway-routed` only per qualified Agent; use `full-compatibility` or `excluded` when routing cannot be proven.
2. Require the eventual immutable plan to list and separately approve all seven legacy-only capability retirements.
3. Accept that V1 cutover is a quiescent maintenance operation with crash consistency, not atomic visibility to every machine process.
4. Accept command-time detection windows for raw installer/manual drift, while prohibiting raw global commands against managed names.
5. Accept observation-scoped health rather than a continuous runtime guarantee for Agents without load hooks.
6. Accept explicit `.skill-lock.json` drift until a version-bound native-writer adapter is separately proven.
7. Accept the bounded recovery scope: independent local recovery root protects against collection/control-root deletion, not whole-home/device loss.

Until the Owner reviews these decisions, ADR-0004 remains `Proposed` and implementation-plan authoring remains paused by the brainstorming/design gate.
