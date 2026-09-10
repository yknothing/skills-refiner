# Collection operations

Read this for declared managed collection upgrades, repair, recovery or undo.
Command paths are relative to the installed `skill-hygiene` root.

## Managing declared physical collections

Use `collection` for an artifact-set upgrade when several source-owned Skills
must move as one physical and recoverable unit. Do not substitute manual `mv`,
wildcard deletion, ad-hoc symlinks, or direct `.skill-lock.json` edits.

The current declarative managed profiles are `loopos`, `langcraft`, and
`better-skills`. A reviewed source must be a Git worktree whose HEAD selects the exact
40-character revision and approved origin. A branch or `latest` is only a
candidate discovery input; resolve it before `check`. Use a dedicated checkout for operator clarity.
`check` materializes and validates only the selected commit's Git objects;
it directly verifies commit, tree, and blob object IDs, portable paths, entry
types, executable bits, and the final written bytes inside a controller-owned
staging directory before atomic publication. Symlinks, submodules, unresolved
Git LFS pointers, reserved or colliding paths, and inputs beyond the bounded
node/depth/byte budgets fail closed. Consequently,
ignored files, empty local directories, smudge-filter output, hidden worktree
overrides, visible tracked modifications, untracked files, and local permission
drift cannot enter the artifact. The controller does not execute repository-configured
clean filters or filesystem monitors to classify worktree state. Current plans require
the revision to be contained by a local `origin/*` remote-tracking ref. That is a content-bound
local attestation, not a live remote fetch or signed release proof; record a
separate point-in-time remote check when that stronger claim matters.

```bash
NODE24=/absolute/path/to/node24
LAUNCHER=/absolute/path/to/reviewed/skills-refiner/skills/skill-hygiene/bin/skills-refiner
COLLECTION=loopos # or langcraft / better-skills
SOURCE=/absolute/path/to/clean-reviewed-repository
REVISION=full-40-character-reviewed-commit
PLAN=/private/tmp/$COLLECTION-collection-plan.json

SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection check "$COLLECTION" \
  --source "$SOURCE" --revision "$REVISION" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection plan "$COLLECTION" \
  --source "$SOURCE" --revision "$REVISION" --output "$PLAN" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection apply \
  --plan "$PLAN" --confirm 'sha256:...' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection status "$COLLECTION" \
  --fresh --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection list --fresh --json
```

V2 keeps four sets separate: installer receipt history, fresh active
filesystem entries, the immutable upstream candidate, and the exact approved
disposition. A missing historical receipt directory is not automatically a
failure, and a receipt is never proof that an entity still exists. An active
directory enters the mutation set only when repository, exact source path,
receipt evidence, filesystem path, and plan-time digest jointly qualify it.
An unqualified same-name directory is preserved unless it occupies the required
collection/exposure path. An unplanned receipt-owned name or a source-scoped
receipt rewrite fails closed.

Never use a flat Skill name as a cross-repository ownership key. Qualified
identity binds repository, immutable revision, source path, and declared name.
Same-name Skills from different repositories may coexist inside their physical
collections. A flat same-name path that is not qualified to this collection is
reported in `name_collisions` with `disposition: preserve`; do not move, unlink,
or reinterpret it without an explicit user disposition. A preserved historical
name from the same repository may justify publishing the new collection
exposure to that Agent root, but still does not authorize deleting the old path.
Current plans bind the complete preserved collision snapshot into `plan_hash`,
including raw/resolved target, target health/digest, and the receipt claim as a
claim rather than ownership. Apply re-observes it before mutation. Status keeps
collection drift separate from `name_collision_status` and
`management_attention`; a broken preserved symlink is visible but is never
silently redirected, deleted, or adopted.

`loopos` and `langcraft` use a nested gateway projection because their
collection id and gateway Skill name are identical. `better-skills` has no
upstream gateway and uses a collection projection; never fabricate a gateway
or rewrite third-party frontmatter to make the topology look uniform. Selected
members must pass portable YAML frontmatter checks; a source member that fails
is excluded by the reviewed packaging profile rather than patched in the
artifact. Shared files/directories are spec-bound, their references are checked
from both members and resources, and declared authoring-example exclusions are
explicit in the spec.

The external current-generation catalog lives under
`~/Library/Application Support/skills-refiner/`; its view under
`~/.agents/skill-control/catalog.json` is reconstructable. It records the exact
repository/revision/artifact selection plus receipt install/update history and
activation lifecycle; `collection list --fresh` also derives these fields for
ProdCraft V1. If collection-local control is manually deleted, direct status
reports `ORPHANED_CONTROL` rather than silently downgrading the deployment to
`UNMANAGED`.

Planning against an already active V2 collection creates a predecessor-bound
generation replacement, not another legacy migration. The plan binds the prior
active record, catalog entry, collection bytes, exposure identities, and
independent recovery bytes. Interrupted upgrades must surface the new operation
id even before the active pointer changes; exact recovery restores the prior
generation, and undo returns the catalog and active pointer to that generation.

Use the exact operation id for missing-object repair, interrupted-operation
recovery, or exact undo:

```bash
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection repair "$COLLECTION" \
  --confirm '<collection>-............' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection recover \
  '<collection>-............' --confirm '<collection>-............' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection undo \
  '<collection>-............' --confirm '<collection>-............' --json
```

For generic managed collections, `collection repair` can restore missing entries and
replace a drifted member, resource, index, locator, or collection root only
while the active plan, immutable controller artifact, catalog authority,
receipt scope, quarantine, and independent recovery evidence remain exact. A
content replacement never overwrites the observed collection: it creates an
independent repair WAL below the active operation, moves the exact observed
pre-state to a unique repair quarantine, and publishes only bytes materialized
from the plan-bound artifact. The V3 repair result exposes `repair_id`,
`quarantined_pre_state`, `pre_state_manifest`, `post_state_manifest`, and
`artifact_digest`. If status
reports `REPAIR_ATTEMPT_PENDING:<repair-id>:<state>` after interruption, rerun
the same `collection repair ... --confirm <operation-id>` command; do not use
installation-generation `collection recover` for a repair transaction.

`FILESYSTEM_READY` still means only that the plan-bound collection, index,
members, shared resources, exposure projections, quarantine, recovery, catalog,
operation and scoped receipt evidence are exact. It does not prove real Agent
recursive discovery, gateway routing, cache invalidation, runtime loadability,
or context-window reduction. Keep `runtime_status: UNVERIFIED` until separate
fresh-session profile probes pass.

A missing preserved symlink has two distinct meanings. A historical name that
is proven related to the same repository is reported as
`STALE_SAME_REPOSITORY_PROJECTION`; it may be selected by a separate cleanup
review, but collection apply never retires it implicitly. A foreign or
unqualified same-name path remains `BROKEN_PRESERVED_SYMLINK`/collision evidence
and preserve-by-default. Never let cleanup of the former sweep up the latter.

Collection status may expose `source.upstream_release`, but only from a strict
field selected in the immutable upstream artifact. The evidence includes value,
source path, source digest and extraction rule. `not_declared` means the
upstream did not provide a selected release field; do not invent one from the
commit, date, plan generation or any skills-refiner `schema_version`.

Deployment comparison ignores only the exact Finder metadata basename
`.DS_Store` at any collection depth. Source, immutable artifact, predecessor,
quarantine, and recovery identities remain exact, and every other unknown file
still causes drift. Do not delete `.DS_Store` merely to manufacture a green
status. Controller-owned copies restore every source permission explicitly, so
plan, apply, repair, and status identity do not depend on the invoking shell's
ambient `umask`.
Persisted collection digests retain their historical Node 24 locale comparator
for schema compatibility. Do not change that comparator without an explicit
digest-schema migration and predecessor compatibility proof.

## Managing the ProdCraft V1 physical collection

Use the `collection` flow for the revision-pinned ProdCraft artifact-set
upgrade. It is separate from single-entry cleanup: never replace it with manual
`mv`, wildcard deletion, or direct `.skill-lock.json` edits.

```bash
NODE24=/absolute/path/to/node24
LAUNCHER="$HOME/.agents/skills/skill-hygiene/bin/skills-refiner"
SOURCE=/absolute/path/to/reviewed/prodcraft-repository
REVISION=full-40-character-reviewed-commit
PLAN=/private/tmp/prodcraft-collection-plan.json

SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection check prodcraft \
  --source "$SOURCE" --revision "$REVISION" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection plan prodcraft \
  --source "$SOURCE" --revision "$REVISION" --output "$PLAN" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection apply \
  --plan "$PLAN" --confirm 'sha256:...' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection status prodcraft \
  --fresh --json
```

`check` proves source/revision structure and the bounded Markdown-link reference
graph; prose/backtick repository references remain covered only by separately
recorded upstream validators. It returns
`STRUCTURALLY_VALID`, not runtime qualification. Take the apply confirmation
from that exact plan's full `plan_hash`. The physical deployment is healthy only
when direct status returns `FILESYSTEM_READY`; this still reports
`runtime_status: UNVERIFIED` until separate fresh-session Agent probes pass.
Ledger or index state alone is not proof. `status` re-observes the physical
collection, all 40 plan-bound member digests, locator, top-level gateway, every
discovered physical Agent projection root, scoped legacy absence, quarantine,
independent recovery, operation state, and external receipt drift.

If an interrupted operation reports `RECOVERY_REQUIRED`, use its exact operation
ID twice to reconcile a stale lock and restore the exact pre-state:

```bash
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection recover \
  'prodcraft-............' --confirm 'prodcraft-............' --json
```

If a managed member or projection is accidentally deleted and status reports
only missing-object drift, repair from the exact active artifact:

```bash
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection repair prodcraft \
  --confirm 'prodcraft-............' --json
```

To restore the pre-upgrade deployment, use the exact active operation ID twice:

```bash
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" collection undo \
  'prodcraft-............' --confirm 'prodcraft-............' --json
```

The controller leaves `.skill-lock.json` under its native installer's
ownership. Its digest and old ProdCraft receipts are evidence; they are not the
desired-state writer. Recovery copies and same-device quarantine remain until a
separate, explicit retention decision.
