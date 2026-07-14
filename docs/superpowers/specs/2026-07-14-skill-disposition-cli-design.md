# Interactive Skill Disposition CLI Design

Status: approved design

Date: 2026-07-14

Source revision reviewed: `b7ae763af59fba031810d954b2fec5d6207fae29`

Adversarial review: `docs/adversarial-product-pk/2026-07-14-skill-disposition/`

## 1. Decision

Add a CLI-first disposition workflow after skill detection. The workflow lets a
user review local installed and distribution entries, make explicit decisions,
preview immutable plans, quarantine selected entries, inspect transaction
status, and restore entries without touching their source repositories.

The CLI is the only execution authority. Agent and IDE conversations consume
the same JSON schemas and exit codes; they may explain evidence and prepare
decisions, but they do not reproduce filesystem logic.

The approved delivery order is staged:

1. certify and ship macOS mutation after its transaction gates pass;
2. implement and certify a native Windows adapter in the immediately following
   batch;
3. do not infer Windows safety from macOS, Linux, WSL, or Git Bash evidence.

## 2. Problem and real user intent

The repository can detect topology, runtime-contract signals, broken links,
provenance, collisions, and local observation evidence. It does not close the
loop after detection. Users still need to translate uncertain findings into
safe actions across several agent directories.

The real job is not “delete old skills.” It is:

> Reduce local Agent Skill conflicts and noise quickly, while preserving the
> ability to understand, audit, and reverse every filesystem change.

That implies four non-negotiable properties:

- detection signals are evidence, not retirement verdicts;
- the mutation target is the exact installed or distribution entry, never a
  resolved external source;
- the default action is reversible quarantine;
- partial progress, drift, unsupported platforms, and recovery conflicts are
  explicit states rather than silent failures.

## 3. Goals

- Provide a low-friction TTY review flow after a fresh scan.
- Support the same workflow non-interactively through versioned JSON.
- Allow batch review while executing independent item transactions serially.
- Prevent source-repository mutation and symlink-target traversal.
- Detect plan drift before mutation and again before each item.
- Preserve enough identity and journal evidence to reconcile interrupted work.
- Restore entries without overwriting or merging newly-created paths.
- Keep existing read-only scan, probe, dashboard, doctor, and trace behavior
  unchanged.
- Preserve selective installation: `skill-hygiene` remains independently
  usable without `skill-debug`.

## 4. Non-goals

- Automatically deciding that a skill is unused, obsolete, unsafe, or bad.
- Treating stale age, no canary observation, a security regex, size, or a name
  collision as an automatic quarantine rule.
- Permanently deleting an entry from an active skill surface.
- Modifying a Git source repository or remote repository.
- Terminating or invalidating skills already cached by a running Agent session.
- Preventing an installer or updater from re-deploying an entry later.
- Claiming batch atomicity across several filesystem entries.
- Shipping a full-screen TUI in the first release.
- Sharing mutation semantics between POSIX and Windows without native platform
  evidence.

Permanent purge may be designed later, but it may only operate on quarantine
payloads and must never become a shortcut for deleting active entries.

## 5. Current repository boundary

`skill-scan.v5` is a conservative fact collector, not an execution plan. It
exposes useful candidate facts such as topology role, exact active-entry path,
source and canonical paths, normalized `SKILL.md` content hash, provenance,
human-readable link target plus an authoritative byte-preserving Base64 form,
runtime-contract signals, and collisions. Its
additive `entries` view has the stable grouped order
`skills + skill_links + broken_symlinks`.

It is insufficient for mutation because:

- `canonical_dir` is informational and may identify a different filesystem
  object than the exact `entry_path` that may be moved;
- the normalized hash covers `SKILL.md`, not the complete entry tree;
- content-bound installer receipt evidence is only an eligibility fact and
  does not pin the complete filesystem identity through apply;
- the snapshot does not pin filesystem identity across plan and apply;
- Git Bash symlink, junction, and reparse-point topology is not certified;
- no transaction, journal, quarantine, status, or restore contract exists.

The disposition feature therefore consumes scanner evidence but compiles a new
execution-safe identity and plan. Raw scan JSON is never accepted as an apply
plan.

## 6. User experience

### 6.1 Default TTY flow

Running `skills-refiner cleanup` performs these stages:

1. **Fresh scan** — collect current local facts and group review candidates.
2. **Review** — select groups or entries and choose `Retire`, `Keep`, `Later`,
   or `Inspect`.
3. **Preview** — show exact entry paths, topology impact, blocked items,
   transaction order, and a short plan hash. No mutation has occurred.
4. **Apply** — require `apply <short-plan-hash>`, preflight all items, then
   execute independent item transactions in order.
5. **Verify** — re-scan, report per-item terminal states, and print exact undo
   commands for committed items.

Nothing is selected by default. Pressing Enter repeatedly cannot quarantine an
entry.

### 6.2 Candidate grouping

The default review groups are:

- broken distributions;
- backup or archive remnants;
- proven runtime load blockers;
- active topology conflicts;
- security and provenance review;
- other advisory signals.

Group names describe why review is useful. They do not say “safe to delete.”

### 6.3 Stable decisions

- `Retire` — schedule the exact selected installed/distribution entries for
  quarantine.
- `Keep` — suppress the same candidate only while its entry fingerprint,
  topology, scanner policy version, and relevant signals remain unchanged.
- `Later` — skip for this session; show again on the next review.
- `Inspect` — show entry path, topology role, source/canonical distinction,
  distribution consumers, evidence, uncertainty, and expected effects.

`Keep` decisions are local preferences, not evidence that a skill is healthy.

### 6.4 Topology presentation

The UI presents a skill as a topology group, not as a single ambiguous path:

```text
example-skill
Installed entry: ~/.agents/skills/example-skill
Distributed to: Claude, Cursor, Codex
Evidence: runtime contract blocker
Action scope: 3 distribution entries + 1 installed entry
```

For a symlink, the UI distinguishes the movable entry from its informational
target. A symlink to an external source may be retired by moving the link
itself; the external target is never moved.

### 6.5 Honest sequential execution

Users may review many items together, but apply does not claim batch atomicity:

```text
item-01  COMMITTED
item-02  COMMITTED
item-03  DRIFTED — zero changes
item-04  NOT_STARTED
```

The first failure stops subsequent items. Previously committed items remain
committed and have independent undo commands.

## 7. Command surface and installation

The canonical installed entrypoint lives inside the independently installable
`skill-hygiene` package:

```text
~/.agents/skills/skill-hygiene/bin/skills-refiner
```

The initial invocation is always available through its full path:

```bash
bash ~/.agents/skills/skill-hygiene/bin/skills-refiner setup-cli
```

`setup-cli` may create a thin `skills-refiner` launcher only in a writable
directory that is already on `PATH`. It must:

- show the source and destination before writing;
- require explicit confirmation;
- avoid modifying `.zshrc`, `.bashrc`, PowerShell profiles, or other shell
  configuration;
- refuse to replace an unrelated existing executable;
- verify the installed launcher resolves to the expected installed skill;
- provide a full-path fallback when no safe `PATH` directory exists.

The public command surface is:

```bash
skills-refiner cleanup
skills-refiner cleanup review --json
skills-refiner cleanup plan --decisions decisions.json --json
skills-refiner cleanup apply --plan plan.json --confirm <plan-hash> --json
skills-refiner cleanup status <transaction-id> --json
skills-refiner cleanup undo <transaction-id> --confirm <transaction-id> --json
```

TTY mode may combine review, plan preview, and apply confirmation. Non-TTY mode
must never prompt; it requires explicit subcommands, files, and confirmations.

The launcher is public contract. The transaction engine's implementation
language is not. The implementation plan must choose the smallest runtime that
can prove no-follow traversal, exact structured data, per-file and parent
directory journal durability, and crash reconciliation. A pure-shell engine is
not accepted if it cannot prove those properties without delimiter or encoding
shortcuts.

## 8. Component boundaries

These are behavioral boundaries; the implementation should use the fewest files
that keep them independently testable.

### 8.1 Candidate compiler

Consumes a fresh scan and emits review candidates. It may rank and group
evidence, but it cannot preselect an action or produce an apply plan.

### 8.2 Decision store

Stores explicit `Keep` decisions outside all Agent discovery roots. A decision
key includes the execution-safe entry identity, topology fingerprint, relevant
signal set, and policy/schema version. Any change re-surfaces the candidate.

`Later` is session-only and is not persisted.

### 8.3 Plan compiler

Combines a fresh candidate snapshot with explicit decisions and platform facts.
It emits immutable item plans plus a deterministic plan hash. It rejects raw
scanner input as an executable plan.

### 8.4 Transaction coordinator

Validates schemas and compatibility, acquires the global disposition lock,
preflights all selected items, executes item transactions serially, stops on
the first failure, and emits a machine-readable result summary.

### 8.5 Platform adapter

Owns all filesystem-specific facts and mutations:

- `lstat`-equivalent no-follow inspection;
- raw link-target collection;
- filesystem and object identity;
- tree and security-metadata fingerprinting;
- same-filesystem atomic rename;
- durable journal write and directory synchronization;
- restore conflict detection;
- postcondition verification.

The coordinator never infers platform safety from path strings or POSIX-like
shell behavior.

### 8.6 Presenter

Renders either TTY text or strict JSON from the same domain result. It owns no
filesystem mutation.

## 9. Execution-safe identity

Every item plan includes:

- `entry_path` — the absolute path of the object in a recognized active root;
- `active_root` — the recognized root that authorizes the path;
- `entry_kind` — directory, symlink, broken symlink, or a platform-native
  classified kind;
- best-effort UTF-8 `raw_link_target` for display and authoritative
  `raw_link_target_base64` for identity and restore when applicable;
- `canonical_target` for explanation only;
- filesystem identifier and device/volume identifier;
- object identifier such as inode or native file ID where available;
- a no-follow tree manifest digest;
- a security-metadata digest;
- scanner policy and schema versions;
- expected preconditions and postconditions.

Before accepting an item, the adapter must prove that `entry_path` is an
immediate child of an allowed active root. String-prefix checks are
insufficient. Active roots that are symlinks, unexpected mounts, or unsupported
reparse points are blocked.

Paths containing invalid UTF-8, control characters, or platform-ambiguous
representations are blocked in the first release. This avoids unsafe conversion
through shell variables or JSON strings. The error must identify the entry
without echoing unsafe control bytes to the terminal.

### 9.1 Directory manifest

Directory traversal is no-follow and deterministic. The manifest records each
relative entry's path, kind, content digest or Base64-encoded raw link target, and
security-relevant metadata. It rejects:

- nested mounts;
- sockets, device nodes, and other unsupported special files;
- traversal that escapes the selected entry;
- unreadable entries that prevent a complete manifest.

Modification time alone does not trigger drift. Content, topology, object
identity, ownership, permission, ACL, flags, filesystem, and unknown
security-relevant extended-attribute changes do.

### 9.2 Source-repository boundary

Real directories that are themselves Git working trees or are proven authoring
sources are `review_only` in the first release. The CLI may recommend source
maintenance commands, but it cannot quarantine the directory. Distribution
links pointing to such sources remain eligible because only the link object is
moved.

## 10. Plan schemas and machine output

Schemas are independently versioned:

- `skills-refiner.cleanup.review.v1`;
- `skills-refiner.cleanup.decisions.v1`;
- `skills-refiner.cleanup.plan.v1`;
- `skills-refiner.cleanup.transaction.v1`.

A plan contains:

```json
{
  "schema_version": "skills-refiner.cleanup.plan.v1",
  "product_version": "2.0",
  "platform": "macos",
  "scan_fingerprint": "sha256:...",
  "plan_hash": "sha256:...",
  "created_at": "...",
  "items": [
    {
      "item_id": "opaque-id",
      "action": "quarantine",
      "entry_path": "/absolute/active/root/example-skill",
      "entry_kind": "directory",
      "preconditions": {},
      "expected_postconditions": {},
      "risk": "reviewed"
    }
  ]
}
```

Plans do not embed skill file content, detected secrets, or raw terminal escape
sequences.

For `--json`:

- stdout contains exactly one JSON object;
- diagnostics and progress go to stderr;
- ANSI is disabled;
- localized terminal text does not change enum values or keys;
- the executor rejects unsupported schema majors, product compatibility, or
  platform adapters before mutation;
- repeated apply or undo returns an explicit idempotent status.

## 11. Exit-code contract

```text
0    completed, already in target state, or intentionally no changes
2    invalid invocation, confirmation, or schema
3    unsupported platform or missing required dependency
10   blocked or drifted; zero mutation for the affected transaction
20   partial state or recovery required
21   restore conflict; nothing overwritten
130  handled user cancellation before mutation
```

JSON status is authoritative within an exit-code class. Human text is not an
API. An unhandled process kill may not return a structured result or stable exit
code; the next `status` invocation must reconcile it through the journal and
return `20` when human recovery is required.

## 12. Transaction and journal model

### 12.1 Storage

Transaction metadata and payloads live outside Agent discovery roots:

```text
~/.agents/skills-quarantine/
  lock/
  transactions/
    <transaction-id>/
      plan.json
      manifest.json
      events.jsonl
      payload/
```

The root and transaction directories are owner-only. Metadata files are
owner-readable and owner-writable only. Payload directories use opaque IDs,
not skill names, to avoid case-folding, reserved-name, and path-length
collisions.

Before planning, the adapter verifies that the active entry and quarantine
payload are on the same filesystem or volume. Cross-device copy-and-delete is
not a fallback; the item is blocked with zero mutation.

### 12.2 Transaction states

```text
PLANNED
  -> CONFIRMED
  -> PREPARED
  -> APPLYING
  -> COMMITTED

Before mutation: BLOCKED or ABORTED
After ambiguous interruption: RECOVERY_REQUIRED
```

The coordinator also reports `NOT_STARTED` for later items after a previous
item fails.

### 12.3 Write-ahead protocol

Before every mutation:

1. write the next intent to a temporary journal file;
2. flush the file through the platform durability primitive;
3. atomically publish the journal state;
4. flush the containing directory;
5. revalidate the entry identity;
6. perform the same-filesystem rename;
7. verify source absence, destination presence, kind, identity, and manifest;
8. durably record the verified result.

If the adapter cannot prove the required durability primitive, apply is
unsupported. It must not silently downgrade to a weaker success claim.

The first certification covers process interruption and forced termination.
Sudden-power-loss durability is not claimed until a platform-specific test can
prove it.

### 12.4 Reconciliation

Recovery compares the original path, quarantine path, and planned identity:

- only the original path matches: `UNCHANGED`;
- only quarantine matches: `QUARANTINED`;
- both match, neither matches, or identity differs: `RECOVERY_REQUIRED`.

Ambiguous state is never automatically committed, reverted, overwritten, or
merged.

### 12.5 Restore

Restore has its own plan, confirmation, preflight, journal, and postconditions.
It restores installed directories before their distribution links. If an
original path exists, restore returns `21` and leaves both the existing path and
quarantine payload unchanged.

Relative symlinks may appear broken inside quarantine. This is expected; the
raw target is restored byte-for-byte at the original location.

## 13. Topology ordering

A review plan may contain several items for one skill. Apply orders them as:

1. distribution links and broken links;
2. native agent copies explicitly selected by the user;
3. installed real directory, if it is not a protected source repository.

Each item is a separate transaction. Failure stops later items. Restore uses
the reverse dependency order: installed directory first, distribution entries
last.

Same-name entries with different content or canonical targets are never selected
as a group by name alone. The user decides each execution-safe identity.

## 14. Drift, concurrency, and re-deployment

`apply` performs two levels of preflight:

1. verify every selected item before any item starts; if any item drifted,
   return zero mutation for the whole plan;
2. verify an item again immediately before its transaction; if it drifted after
   earlier items committed, stop and report prior committed items plus the
   drifted and not-started items.

An atomic disposition lock prevents two cooperating CLI instances from
mutating concurrently. It does not claim to stop a same-user installer or
malicious process. Fingerprints and post-scan reconciliation detect those
changes.

After commit, the CLI runs a fresh scan. If a later scan observes the same
source/provenance/content identity again, it reports `REHYDRATED`. The first
release does not create tombstones or fight the installer automatically.

## 15. Platform contract

### 15.1 macOS — first release

macOS is the first mutation authority. The platform adapter must prove:

- no-follow classification and traversal;
- raw relative, absolute, and broken-link behavior;
- same-filesystem rename;
- ownership, mode, ACL, flags, and extended-attribute preservation;
- object and filesystem identity;
- journal durability and parent-directory synchronization;
- process interruption reconciliation;
- case-sensitive and case-insensitive volume behavior;
- installed-layout operation from the distributed `skill-hygiene` package.

Passing current repository tests is necessary but not sufficient; the cleanup
fault-injection suite is a new release gate.

### 15.2 Windows — immediately following batch

Windows mutation uses a native PowerShell/.NET adapter. It must not be a
line-by-line Bash translation. Before support is declared, a real Windows runner
must verify:

- reparse points, symlinks, junctions, and broken links;
- native ACL and file-ID behavior;
- locked paths and antivirus interference;
- case-insensitive collisions and reserved names;
- long paths and cross-volume blocking;
- journal and crash reconciliation;
- launcher installation and Agent non-TTY use.

Git Bash may provide read-only review or call the native adapter. Git Bash is
not mutation authority.

### 15.3 WSL

WSL on a Linux filesystem follows the POSIX design only after a dedicated WSL
gate passes. DrvFS mutation remains fail-closed until its metadata and
permission semantics are independently certified.

## 16. Security and privacy

- No network access is required for review, planning, apply, status, or undo.
- Logs contain paths, hashes, enum states, timestamps, platform facts, and
  error codes; they do not copy skill content or detected secret values.
- Unsafe terminal bytes are escaped or represented by opaque IDs.
- Active roots, quarantine roots, lock paths, and journal paths are checked for
  symlink/reparse traversal before use.
- The CLI never changes permissions on an unsafe or symlinked log path merely
  to make a check pass.
- Security-indicator candidates always require human review.

## 17. Error handling

Errors are classified as:

- `invalid_input` — malformed command, schema, plan, or confirmation;
- `unsupported` — missing platform adapter, dependency, or durability primitive;
- `blocked` — protected source, unsupported object, mount, encoding, metadata,
  cross-device target, or unsafe root;
- `drifted` — current identity differs from the plan;
- `conflict` — restore destination already exists;
- `recovery_required` — filesystem and journal cannot determine one safe state;
- `not_started` — a previous item stopped sequential execution.

Every error reports whether mutation occurred, which transaction IDs are
committed, and the next safe command. Success is printed only after postcondition
verification and durable journal completion.

## 18. Testing and acceptance

### 18.1 Automated contract tests

- candidate compiler never auto-selects from scanner flags;
- raw scan JSON is rejected by apply;
- TTY defaults to zero selected entries;
- non-TTY never prompts;
- JSON stdout is one object with no ANSI or prose contamination;
- schema-major and executor compatibility checks fail before mutation;
- repeated apply and undo return stable idempotent results;
- `Keep` reappears when fingerprint, topology, signals, or policy changes;
- installed layout works after selective `skill-hygiene` installation.

### 18.2 macOS filesystem fixtures

- normal directory;
- relative, absolute, chained, external, and broken symlink;
- source-repository directory protection;
- spaces, Unicode, case-only names, and safely rejected control bytes;
- read-only content, ACL, flags, and extended attributes;
- nested mount and cross-device destination;
- occupied restore path;
- installer recreating an entry between plan and apply;
- disk or permission failure before journal preparation.

Each fixture verifies no-follow behavior, source-repository safety, exact
postconditions, metadata preservation, and conflict-safe undo.

### 18.3 Fault injection

Force termination at:

- before and after lock acquisition;
- every durable journal publication;
- before and after rename;
- before and after postcondition verification;
- before committed-state publication.

For each interruption, replay `status` and `undo` and record exit code, journal
state, original and quarantine manifests, and final converged state. A severe
failure blocks mutation release.

### 18.4 Agent harness

An Agent must complete `review -> decisions -> plan -> apply -> status -> undo`
using JSON only. It must not parse localized prose, ANSI, prompts, or terminal
layout.

### 18.5 Directional usability evaluation

Before calling the flow validated, run a direction-setting task test with five
representative skill maintainers:

- complete quarantine and undo within ten minutes;
- at least 80 percent complete without assistance;
- zero source-repository mutation and restore overwrite;
- correctly explain that the entry moved while source remained untouched;
- record mis-selection, abandonment, and recovery success.

These results evaluate task usability only. They do not prove demand, market
fit, or willingness to pay.

## 19. Implementation sequence

The later implementation plan must preserve these clean gates:

1. **Contract and read-only review** — execution-safe identity, candidate,
   decision, plan, JSON, exit-code, and installed-launcher contracts; no mutation.
2. **Bounded macOS single-item spike** — platform adapter, journal, quarantine,
   status, undo, and fault-injection harness. No production claim until green.
3. **macOS product flow** — TTY review, sequential item coordination, `Keep`
   store, setup-cli, Agent harness, docs, and full gates.
4. **Native Windows adapter** — PowerShell/.NET implementation, native runner,
   Windows fixtures, launcher, and explicit platform support update.
5. **Later enhancements** — history UX, rehydration policy assistance,
   quarantine retention and explicit purge design, optional IDE presentation,
   and dedicated WSL certification.

Each batch must be independently reviewable, tested, and committed. A failed
gate reduces scope or blocks the next batch; it does not weaken the success
language.

## 20. Promotion boundary

This document authorizes implementation planning and bounded spikes after user
review. It does not certify the feature as implemented, user-validated,
production-ready, or Windows-supported.

The adversarial Judge decision remains `accept-with-limitations`:

- planning and bounded macOS single-item spikes: allowed;
- full mutation implementation: blocked until fault-injection gates pass;
- Windows support claims: blocked until native gates pass;
- user-validation claims: blocked until the directional task evidence exists.
