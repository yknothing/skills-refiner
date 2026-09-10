# Deployment-governance handoff

When the target is an installed global Skill set rather than an authoring
repository, keep the design audit separate from mutation. Complete the relevant design and compatibility judgment, then hand the approved artifact set to `skill-hygiene` when that
skill is installed and the user has authorized implementation.

Before proposing a physical collection or upgrade, freeze four different sets:

1. installer receipt history;
2. fresh filesystem-active entries and every Agent projection;
3. the exact member set from an approved immutable upstream revision;
4. the explicit migration disposition.

Do not collapse these sets into a single `installed` field. A repository commit
is content authority, a local activation catalog is deployment intent, direct
filesystem/runtime observation is current reality, and a third-party lock file
is historical installer evidence.

Do not infer entity identity, replacement, or retirement from the frontmatter
name alone. For cross-repository decisions, bind repository, immutable revision,
source path, and declared name. Treat unresolved flat-name collisions as
preserve-by-default evidence and require an explicit user disposition before
any cleanup or projection reassignment. A receipt keyed by the same basename is
only a claim: preserve and report foreign or unqualified real directories as
well as symlinks unless they occupy the collection's required publication path.
Bind every preserved path and its target health into the immutable migration
plan so a collision change invalidates approval before mutation.

Keep same-repository stale projections distinct from cross-repository name
collisions. A broken historical locator may become an explicit cleanup
candidate after repository relationship and target absence are proven; a
foreign same-name Skill remains preserve-by-default. Retirement still requires
its own fresh review, exact path disposition, immutable plan hash and reversible
quarantine transaction. Never smuggle cleanup authority into collection apply.

Treat release versions as upstream content evidence. Read only a reviewed,
repository-specific version field from the immutable artifact and retain its
path, digest and extraction rule. If upstream declares no selected version,
record `not_declared`; do not synthesize a semantic version from a controller
schema, commit date, migration generation or local preference.

Require a collection-specific packaging and exposure decision. Some sources
have a real gateway, some have a gateway whose name collides with the collection
container, and some have no gateway. Never fabricate a router, rewrite a
third-party `SKILL.md`, or treat physical nesting as proof of context savings.

After an implementation pass, convert the retrospective into runnable gates:
source/revision binding, portable YAML frontmatter and member/resource reference closure, competing-writer
detection, receipt-scope discrimination, crash recovery, missing-object repair,
exact undo, orphaned control/catalog detection, and backward compatibility for
already-active generations. For any update mechanism, require an active
generation → second immutable revision → status → undo-predecessor test, plus
interrupted-upgrade recovery before calling it an upgrade. A lesson recorded
only in prose is not yet a control-plane improvement.

Close the repository-to-installed boundary explicitly. Compare the reviewed
repository Skill bytes with the global installed copies, exercise the installed
launcher, and run a fresh-session loader/frontmatter/reference check. Repository
tests and a one-off repository launcher do not prove the globally installed
control plane has been published.
