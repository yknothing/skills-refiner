# macOS Skill Disposition CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fail-closed macOS CLI that turns local skill-scan evidence into explicit review decisions, immutable plans, reversible single-item quarantine transactions, status, and conflict-safe undo without ever mutating source repositories.

**Architecture:** Keep the installed `skill-hygiene` package as the public boundary. A thin Bash launcher selects a dependency-free Node.js 24 LTS engine; pure domain modules compile candidates and plans, while a small native macOS helper binds traversal and mutation to verified directory file descriptors and owns structured metadata, durable publication, and exclusive rename. The coordinator preflights the full plan, executes independent item transactions serially, and exposes the same versioned JSON contract to TTY, Agent, and IDE clients.

**Tech Stack:** Bash 3.2 launcher, exactly Node.js 24 LTS built-ins (`node:fs`, `node:crypto`, `node:readline/promises`, `node:test`), `jq`, and a dependency-free C17 macOS helper compiled with Apple Clang and native APIs (`openat`, `fstatat`, `renameatx_np(RENAME_EXCL)`, ACL, xattr, flags, `fsync`). No npm runtime dependencies and no shell mutation primitive.

---

The runtime choice is intentionally narrow: Node 24 is the current LTS line and
its built-in test runner avoids a package-manager dependency. CI pins the official
`actions/setup-node` action by full commit SHA. Reference contracts:

- `https://nodejs.org/en/about/previous-releases`
- `https://nodejs.org/api/fs.html`
- `https://nodejs.org/api/test.html`
- `https://github.com/actions/setup-node/releases`

## Scope and release boundary

This plan implements only the first certified macOS slice from
`docs/superpowers/specs/2026-07-14-skill-disposition-cli-design.md`.

- Existing read-only scan, probe, dashboard, doctor, and trace behavior remains
  compatible.
- Cleanup requires Node.js major 24 and Apple Command Line Tools for the native
  helper; read-only tools do not acquire those dependencies. Other Node majors
  fail closed until their own compatibility gate exists.
- Mutation remains disabled on Linux, WSL, Git Bash, and native Windows.
- Windows receives a separate native PowerShell/.NET plan only after the macOS
  schema, transaction, and fault gates are stable.
- No active entry is permanently deleted. The only mutation is a same-volume,
  no-clobber move into owner-only quarantine or its inverse during undo.
- The first certification covers graceful cancellation, process interruption,
  and `SIGKILL`; it does not claim sudden-power-loss durability.
- The safety model covers accidental concurrency and cooperating CLI/installer
  races. It does not claim to resist a malicious process already running as the
  same user, which can replace binaries, inspect memory, or bypass CLI locks.
- Passing unit tests is insufficient. Tasks 4 and 5 are promotion gates: if
  no-follow metadata, directory `fsync`, no-clobber move, or reconciliation
  cannot be proven on the macOS runner, stop the implementation and retain the
  read-only review/plan slice.

## Public contracts locked by this plan

Schemas:

```text
skills-refiner.cleanup.review.v1
skills-refiner.cleanup.decisions.v1
skills-refiner.cleanup.plan.v1
skills-refiner.cleanup.transaction.v1
skills-refiner.cleanup.error.v1
```

Exit codes:

```text
0    completed, idempotent target state, or intentional no-op
2    invalid invocation, confirmation, or schema
3    unsupported platform or missing cleanup dependency
10   blocked or drifted; the command made zero active-entry mutations
20   partial command result, ambiguous state, or recovery required
21   restore conflict; no path overwritten
130  handled cancellation before mutation
```

Machine commands:

```bash
skills-refiner cleanup
skills-refiner cleanup review --json
skills-refiner cleanup plan --review review.json --decisions decisions.json --json
skills-refiner cleanup apply --plan plan.json --confirm sha256:PLAN_HASH --json
skills-refiner cleanup status TRANSACTION_ID --json
skills-refiner cleanup undo TRANSACTION_ID --confirm TRANSACTION_ID --json
```

`cleanup` and `cleanup review --json` invoke the selectively installed sibling
`skill-scan.sh --json` themselves and therefore start from a fresh scan.
`--scan FILE` is an explicit test/offline-review option: its result is marked
`execution_eligible: false` and cannot feed `plan`. Before compiling a plan, the
CLI runs another fresh scan and requires its fingerprint to match the review;
otherwise it exits `10` with zero mutation. `--json` writes exactly one JSON
object to stdout. Progress and diagnostics go to stderr without ANSI. Non-TTY
execution never prompts. `apply` accepts only a validated cleanup plan, never
raw scan output.

## Planned production files

```text
skills/skill-hygiene/bin/skills-refiner
skills/skill-hygiene/native/cleanup-macos-helper.c
skills/skill-hygiene/lib/cleanup-contract.mjs
skills/skill-hygiene/lib/cleanup-core.mjs
skills/skill-hygiene/lib/cleanup-macos.mjs
skills/skill-hygiene/lib/cleanup-transaction.mjs
skills/skill-hygiene/lib/cleanup-cli.mjs
```

## Planned test files

```text
skills/skill-hygiene/tests/cleanup-fixtures.mjs
skills/skill-hygiene/tests/test-cleanup-contract.mjs
skills/skill-hygiene/tests/test-cleanup-core.mjs
skills/skill-hygiene/tests/test-cleanup-macos.mjs
skills/skill-hygiene/tests/test-cleanup-transaction.mjs
skills/skill-hygiene/tests/test-cleanup-cli.sh
```

## Task 1: Expose exact scanner entry identity

**Files:**

- Modify: `skills/skill-hygiene/bin/skill-scan.sh`
- Modify: `skills/skill-hygiene/tests/test-scan.sh`
- Modify: `skills/skill-debug/tests/test-install-layout.sh`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/install-smoke-test-plan.md`
- Modify: `docs/superpowers/specs/2026-07-14-skill-disposition-cli-design.md`

- [x] **Step 1: Add failing scanner contract assertions**

Add fixtures for a symlink whose raw target contains a literal `|`, a broken
symlink, a native directory, and a sandboxed `.agents/.skill-lock.json` with one
exact installer receipt. Assert that every emitted skill record has an absolute
`entry_path` and `active_root`, that the raw target's authoritative Base64 form
is byte-preserved, that only the receipt-backed real directory has direct
`installed_copy` provenance, and that the schema is `skill-scan.v5`.

`skill-scan.v5` adds one unified `entries[]` execution-input view while
preserving the existing `skills`, `skill_links`, and `broken_symlinks` arrays
for compatibility. The assertions must include:

```bash
assert_eq "Scanner schema" "skill-scan.v5" "$(jq -r '.metadata.schema_version' <<<"$json_output")"
assert_eq "Native entry path" "$SANDBOX/.agents/skills/healthy-skill" "$(jq -r '.entries[] | select(.dir_name == "healthy-skill" and .location == ".agents/skills") | .entry_path' <<<"$json_output")"
assert_eq "Broken-link active root" "$SANDBOX/.claude/skills" "$(jq -r '.entries[] | select(.dir_name == "broken-link") | .active_root' <<<"$json_output")"
assert_eq "Pipe link target preserved" "../../vendor/pipe|target" "$(jq -r '.entries[] | select(.dir_name == "pipe-link") | .link_target' <<<"$json_output")"
assert_eq "Invalid UTF-8 target bytes preserved" "$invalid_target_b64" "$(jq -r '.entries[] | select(.dir_name == "invalid-utf8-link") | .raw_link_target_base64' <<<"$json_output")"
assert_eq "Receipt-backed copy provenance" "installed_copy" "$(jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind' <<<"$json_output")"
assert_eq "Receipt binds installed tree" "true" "$(jq '.entries[] | select(.dir_name == "receipt-backed") | (.mutation_provenance.evidence.installed_tree_sha1 | test("^[0-9a-f]{40}$"))' <<<"$json_output")"
assert_eq "Unproven real directory provenance" "unknown" "$(jq -r '.entries[] | select(.dir_name == "healthy-skill") | .mutation_provenance.kind' <<<"$json_output")"
```

Run:

```bash
bash skills/skill-hygiene/tests/test-scan.sh
```

Expected: non-zero with failures for `skill-scan.v5`, `entry_path`,
`active_root`, and the literal-pipe target.

- [x] **Step 2: Remove delimiter-based symlink classification**

Replace any intermediate `type|target` record with direct classification of
the current directory entry. `entry_path` is the physical immediate child being
reported; `canonical_dir` remains informational and may resolve elsewhere.

Build each record with explicit `jq --arg` fields:

```bash
jq -n \
  --arg entry_path "$entry_path" \
  --arg active_root "$agent_root" \
  --arg entry_kind "$entry_kind" \
  --arg raw_link_target "$raw_link_target" \
  --arg raw_link_target_base64 "$raw_link_target_base64" \
  '{entry_path: $entry_path, active_root: $active_root,
    entry_kind: $entry_kind,
    link_target: $raw_link_target,
    raw_link_target: (if $raw_link_target == "" then null else $raw_link_target end),
    raw_link_target_base64: (if $entry_kind == "directory" then null else $raw_link_target_base64 end)}'
```

Do not infer an entry path by reversing `canonical_dir`. For broken links, use
the path passed to `lstat`/`readlink` even though the target cannot resolve.
Keep the legacy `link_target` string unchanged for compatibility; the new
`raw_link_target` field is nullable for real directories and remains a
best-effort human-readable UTF-8 view. `raw_link_target_base64` is the
authoritative byte-preserving identity for symlink entries, including invalid
UTF-8 and trailing newlines. Planning, apply, and undo must use the Base64 form.
Read `.agents/.skill-lock.json` only as installer evidence: validate its owner,
non-group/world-writable regular-file kind, schema, exact skill key, source
fields, and bounded size from one stable snapshot. For a GitHub receipt with a
40-hex `skillFolderHash`, recompute the installed directory's Git tree SHA-1 in
a private temporary object database with system/global Git config disabled.
The hash must match exactly. Unsupported receipt hash algorithms, unavailable
Git, malformed metadata, and changed installed content fail closed to
`unknown`.
Emit `mutation_provenance.kind: installed_copy` with `confidence: direct` only
for an exact, content-bound receipt-backed real entry. Missing, malformed,
stale-name, ambiguous, or content-mismatched receipts emit `unknown`; they
never become negative evidence or an automatic action.

- [x] **Step 3: Bump and document scanner compatibility**

Change only the scan schema version needed for the added identity fields and
raw-target correctness. Populate `entries` as the deterministic concatenation
of native directories, valid links, and broken links. Preserve all existing
arrays, fields, and enums so current readers that tolerate additive fields keep
working.

- [x] **Step 4: Run focused and existing scanner tests**

Run:

```bash
bash skills/skill-hygiene/tests/test-scan.sh
bash -n skills/skill-hygiene/bin/skill-scan.sh
shellcheck --severity=error skills/skill-hygiene/bin/skill-scan.sh skills/skill-hygiene/tests/test-scan.sh
git diff --check
```

Expected: all scanner assertions pass; Bash and ShellCheck produce no output;
`git diff --check` produces no output.

- [x] **Step 5: Commit the scanner contract batch**

```bash
test -z "$(git diff --cached --name-only)"
git add README.md README.zh-CN.md docs/install-smoke-test-plan.md docs/superpowers/plans/2026-07-14-skill-disposition-macos.md docs/superpowers/specs/2026-07-14-skill-disposition-cli-design.md skills/skill-debug/tests/test-install-layout.sh skills/skill-hygiene/bin/skill-scan.sh skills/skill-hygiene/tests/test-scan.sh
git diff --cached --check
git commit -m "feat(hygiene): expose exact scan entry identities"
```

Expected: one focused commit containing the scanner, compatibility assertions,
and aligned implementation-plan contract.

## Task 2: Establish the launcher and machine contract

**Files:**

- Create: `skills/skill-hygiene/bin/skills-refiner`
- Create: `skills/skill-hygiene/lib/cleanup-contract.mjs`
- Create: `skills/skill-hygiene/lib/cleanup-cli.mjs`
- Create: `skills/skill-hygiene/tests/test-cleanup-contract.mjs`
- Create: `skills/skill-hygiene/tests/test-cleanup-cli.sh`
- Modify: `.gitattributes`

- [x] **Step 1: Write failing contract tests**

Use `node:test` and real serialized JSON. Cover:

- canonical object-key ordering used for hashes;
- unsupported schema major before any adapter call;
- non-finite numbers and duplicate semantic IDs rejected;
- unsafe strings containing control bytes rejected;
- `--json` stdout is one object and contains no ANSI or prose;
- missing Node or Node 23/25 under `--json` returns exit `3`, one fixed
  `skills-refiner.cleanup.error.v1` object on stdout, and diagnostics on stderr;
- redirected stdin does not trigger a prompt;
- `cleanup apply` rejects a `skill-scan.v5` document with exit `2`;
- `cleanup review --json` launches the installed scanner, while offline
  `--scan FILE` review cannot compile an executable plan.

The canonicalizer contract starts as:

```js
assert.equal(
  canonicalJson({ z: 1, a: { y: 2, x: 3 } }),
  '{"a":{"x":3,"y":2},"z":1}'
);
assert.throws(
  () => validatePlan({ schema_version: 'skill-scan.v5' }),
  /expected skills-refiner\.cleanup\.plan\.v1/
);
```

Run:

```bash
node --test skills/skill-hygiene/tests/test-cleanup-contract.mjs
bash skills/skill-hygiene/tests/test-cleanup-cli.sh
```

Expected: failing imports because the launcher and contract modules do not yet
exist.

- [x] **Step 2: Add the LF-only launcher**

Add these `.gitattributes` rules:

```gitattributes
*.mjs text eol=lf
*.c text eol=lf
skills/skill-hygiene/bin/skills-refiner text eol=lf
```

The Bash launcher must resolve its own installed directory, require exactly
Node major 24, and use `exec` so signals reach the engine:

```bash
#!/usr/bin/env bash
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${SKILLS_REFINER_NODE_BIN:-node}"
JSON_REQUESTED=false
for arg in "$@"; do [ "$arg" = "--json" ] && JSON_REQUESTED=true; done

bootstrap_error() {
    if $JSON_REQUESTED; then
        printf '%s\n' '{"schema_version":"skills-refiner.cleanup.error.v1","status":"unsupported","error_code":"node_runtime_unavailable","mutation_occurred":false}'
    fi
    echo "[ERROR] cleanup requires Node.js major 24" >&2
    exit 3
}

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
    bootstrap_error
fi

NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" || bootstrap_error
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || [ "$NODE_MAJOR" -ne 24 ]; then
    bootstrap_error
fi

exec "$NODE_BIN" "$SCRIPT_DIR/../lib/cleanup-cli.mjs" "$@"
```

Include `--help` and `-h`. Do not use `eval`, shell-built JSON, or profile edits.

- [x] **Step 3: Implement strict schema and hash primitives**

Export frozen constants, `canonicalJson`, `sha256Json`, and validators from
`cleanup-contract.mjs`. Validators must whitelist object keys, require exact
schema strings, reject unknown actions, reject control bytes, and avoid
embedding skill content in validation errors.

The hash format is:

```js
export function sha256Json(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}
```

Hash inputs exclude `created_at` and the hash field itself. Arrays retain order;
object keys sort by Unicode code point. Only JSON-compatible values are
accepted. After calculating the plan hash, derive each transaction ID from
`sha256Json({ plan_hash, item_id })`; the validator recomputes it, avoiding a
circular hash input while keeping retry IDs stable.

- [x] **Step 4: Implement the read-only CLI skeleton**

Parse argv without a third-party library. Route only documented commands.
Return one result object through one presenter. Dependency injection must keep
the filesystem adapter out of schema-validation tests.

For machine mode, use one write:

```js
process.stdout.write(`${JSON.stringify(result)}\n`);
```

Catch domain errors once, map them to the locked exit codes, write diagnostics
to stderr, and set `process.exitCode`. In machine mode, every failure emits one
`skills-refiner.cleanup.error.v1` object containing `mutation_occurred`,
`overall_status`, and any committed transaction IDs. Do not print a second JSON
object from an error handler.

- [x] **Step 5: Make contract tests pass**

Run:

```bash
node --test skills/skill-hygiene/tests/test-cleanup-contract.mjs
bash skills/skill-hygiene/tests/test-cleanup-cli.sh
bash -n skills/skill-hygiene/bin/skills-refiner
shellcheck --severity=error skills/skill-hygiene/bin/skills-refiner skills/skill-hygiene/tests/test-cleanup-cli.sh
git diff --check
```

Expected: all tests pass; static checks and whitespace checks are silent.

- [x] **Step 6: Commit the public contract batch**

```bash
test -z "$(git diff --cached --name-only)"
git add .gitattributes docs/superpowers/plans/2026-07-14-skill-disposition-macos.md skills/skill-hygiene/bin/skills-refiner skills/skill-hygiene/lib/cleanup-contract.mjs skills/skill-hygiene/lib/cleanup-cli.mjs skills/skill-hygiene/tests/test-cleanup-contract.mjs skills/skill-hygiene/tests/test-cleanup-cli.sh
git diff --cached --check
git commit -m "feat(cleanup): establish CLI and JSON contracts"
```

Expected: one commit with the launcher, contract, CLI skeleton, their tests,
and the aligned execution checklist.

## Task 3: Compile conservative candidates and immutable plans

**Files:**

- Create: `skills/skill-hygiene/lib/cleanup-core.mjs`
- Create: `skills/skill-hygiene/tests/cleanup-fixtures.mjs`
- Create: `skills/skill-hygiene/tests/test-cleanup-core.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-contract.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-cli.mjs`
- Modify: `skills/skill-hygiene/tests/test-cleanup-cli.sh`

- [ ] **Step 1: Write failing candidate tests**

Build fixtures entirely under `mkdtempSync(join(tmpdir(),
'skills-refiner-cleanup-'))`; never point a test at the real home directory.
Assert:

- scanner signals group and rank candidates but select no action;
- broken links are reviewable with their exact `entry_path`;
- same-name entries with different identities remain distinct;
- a real Git working tree is `review_only`;
- any real directory without direct `installed_copy` provenance is
  `review_only`, including non-Git authoring directories;
- a receipt-backed installed copy remains eligible only while the receipt
  digest and entry identity are unchanged;
- a symlink to that Git tree may quarantine only the link;
- `Later` is omitted from persisted decisions;
- `Keep` includes entry identity, topology, relevant signals, scanner schema,
  and policy version in its key;
- a changed signal or fingerprint re-surfaces a kept candidate;
- each machine review candidate includes the entry/source distinction,
  distribution consumers, relevant evidence, uncertainty, and expected action
  scope needed to implement `Inspect` without parsing terminal prose.

Use this invariant:

```js
const review = compileReview(scanFixture());
assert.equal(review.schema_version, 'skills-refiner.cleanup.review.v1');
assert.ok(review.candidates.length > 0);
assert.ok(review.candidates.every((candidate) => candidate.selected_action === null));
```

Run:

```bash
node --test skills/skill-hygiene/tests/test-cleanup-core.mjs
```

Expected: failing import for `cleanup-core.mjs`.

- [ ] **Step 2: Implement the candidate compiler**

Validate `skill-scan.v5` before reading evidence. Map facts to stable groups:

```js
const GROUP_ORDER = Object.freeze([
  'broken_distributions',
  'backup_remnants',
  'runtime_load_blockers',
  'active_topology_conflicts',
  'security_provenance_review',
  'other_advisory_signals',
]);
```

Candidate IDs derive from canonical, non-secret identity facts; display labels
are not IDs. Do not turn staleness, absence of canary events, regex findings,
size, or collisions into an automatic retirement decision.

- [ ] **Step 3: Write failing plan-compiler tests**

Assert that the compiler:

- requires explicit `retire`, `keep`, or `later` decisions by candidate ID;
- emits only `retire` items into an apply plan;
- refuses `review_only` retirement;
- requires adapter-provided execution identity before planning mutation;
- orders distribution links before native copies and installed directories;
- calculates deterministic item hashes and a deterministic plan hash;
- excludes `created_at` from hash input;
- derives each opaque transaction ID from the validated plan hash and item ID,
  embeds it after hash calculation, and rejects any non-matching embedded ID;
- keeps full paths in plans but no skill content or detected secret values;
- rejects decision/review fingerprint mismatch.

The determinism assertion is:

```js
const first = await compilePlan(planInput, fixedPlatformFacts);
const second = await compilePlan({ ...planInput, created_at: '2099-01-01T00:00:00Z' }, fixedPlatformFacts);
assert.equal(first.plan_hash, second.plan_hash);
assert.deepEqual(first.items.map((item) => item.item_hash), second.items.map((item) => item.item_hash));
```

- [ ] **Step 4: Implement plan compilation and CLI routing**

`cleanup` and `cleanup review --json` launch the sibling installed
`skill-scan.sh --json` with argv arrays and no shell, validate `skill-scan.v5`,
and emit a fresh review document. An explicit `--scan FILE` is only for tests
and offline inspection and sets `execution_eligible: false`.

`cleanup plan --review FILE --decisions FILE --json` first launches another
fresh scanner pass and rejects a changed fingerprint, then emits a plan only
after the platform adapter enriches each retired entry with an execution-safe
identity. Keep the adapter interface injected:

```js
export async function compilePlan(input, platform) {
  const identities = [];
  for (const decision of input.decisions.filter(({ action }) => action === 'retire')) {
    identities.push(await platform.inspectForPlan(decision.entry_path, decision.active_root));
  }
  return finalizePlan(input, identities);
}
```

The CLI skeleton may use a deliberately unsupported adapter until Task 4. That
adapter returns exit `3`; it must not fabricate identity facts.

- [ ] **Step 5: Run core and contract tests**

```bash
node --test skills/skill-hygiene/tests/test-cleanup-contract.mjs skills/skill-hygiene/tests/test-cleanup-core.mjs
bash skills/skill-hygiene/tests/test-cleanup-cli.sh
git diff --check
```

Expected: candidate, plan, schema, and CLI tests pass; whitespace check is
silent.

- [ ] **Step 6: Commit the compiler batch**

```bash
test -z "$(git diff --cached --name-only)"
git add skills/skill-hygiene/lib/cleanup-contract.mjs skills/skill-hygiene/lib/cleanup-core.mjs skills/skill-hygiene/lib/cleanup-cli.mjs skills/skill-hygiene/tests/cleanup-fixtures.mjs skills/skill-hygiene/tests/test-cleanup-core.mjs skills/skill-hygiene/tests/test-cleanup-cli.sh
git diff --cached --check
git commit -m "feat(cleanup): compile conservative disposition plans"
```

Expected: one commit containing read-only candidate and plan compilation.

## Task 4: Prove macOS no-follow identity and durability primitives

**Files:**

- Create: `skills/skill-hygiene/native/cleanup-macos-helper.c`
- Create: `skills/skill-hygiene/lib/cleanup-macos.mjs`
- Create: `skills/skill-hygiene/tests/test-cleanup-macos.mjs`
- Modify: `skills/skill-hygiene/tests/cleanup-fixtures.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-cli.mjs`

- [ ] **Step 1: Add real-filesystem identity fixtures**

Create, inside a sandboxed `HOME`, these immediate children of recognized
active roots:

- a normal directory containing spaces and Unicode;
- relative, absolute, chained, external, and broken symlinks;
- a directory containing an internal symlink that must not be followed;
- active-root and quarantine ancestors containing a symlink component;
- a nested Git repository, a tracked subtree of an ancestor repository, a
  `.git` file/worktree, a submodule, and a dirty tracked subtree;
- read-only content;
- nested files, directories, and symlinks carrying
  `com.skills-refiner.test` extended metadata;
- nested files and directories with ACL entries added by `chmod +a`;
- a movable entry using the `hidden` flag and an immutable `uchg` entry that
  must block before mutation;
- a FIFO created by `mkfifo`, which must be blocked as a special file;
- an active root that is itself a symlink, which must be blocked.

Fixture helpers must export `makeSandbox`, `writeSkill`, `onlyTransactionId`,
and `removeSandbox`. `removeSandbox` must verify that the target is beneath the
recorded `mkdtempSync` root before recursive deletion.

- [ ] **Step 2: Write failing path-authorization tests**

Test `inspectForPlan(entryPath, activeRoot)` against actual filesystem objects.
Require:

- both inputs are absolute paths represented by valid UTF-8 without control
  characters;
- the helper starts from one verified home-directory fd and opens every active,
  quarantine, lock, transaction, and Keep-store component with `openat` and
  `O_NOFOLLOW`; a symlink in any component blocks the operation;
- `entryPath` is an immediate child by structured path comparison;
- `fstatat(..., AT_SYMLINK_NOFOLLOW)` classifies the leaf without following it;
- raw symlink target bytes come from `readlink`, not `realpath`, and cross the
  JSON boundary only as Base64;
- Git-managed directories, including tracked ancestor subtrees, `.git` files,
  worktrees, submodules, and dirty trees, return `review_only`;
- scanner provenance that proves an authoring source also returns
  `review_only` even when Git evidence is absent;
- symlinks pointing to source Git directories remain link-only eligible;
- sockets, devices, FIFOs, nested mounts, unreadable trees, and metadata
  inspection failures return `blocked`.

The boundary assertion is:

```js
await assert.rejects(
  adapter.inspectForPlan(join(activeRoot, 'skill', 'nested'), activeRoot),
  (error) => error.code === 'blocked' && error.reason === 'not_immediate_child'
);
```

Run:

```bash
node --test skills/skill-hygiene/tests/test-cleanup-macos.mjs
```

Expected: failing import for `cleanup-macos.mjs`.

- [ ] **Step 3: Define and compile the native-helper contract**

`cleanup-macos.mjs` locates Apple Clang only through `/usr/bin/xcrun --find
clang`, compiles the checked-in C17 source into a fresh mode-`0700` temporary
directory, and verifies the output is a regular owner-only executable. Before
any active-entry mutation, that bootstrap helper securely installs itself into
an owner-only, non-discovery, content-addressed runtime cache:

```text
~/.agents/skills-refiner/runtime/macos/ARCH/BINARY_SHA256/cleanup-macos-helper
```

The bootstrap helper creates every cache component with fd-bound `mkdirat`,
publishes its own bytes exclusively, `fsync`s file and parent directories, and
then reopens and verifies the cached binary. The transaction records source
hash, binary hash, architecture, compiler path/version, helper protocol, and
cache identity. `status` and `undo` reuse and revalidate that exact cached
binary even if Command Line Tools or the installed source later disappears.
The runtime cache is not purged while any transaction references it; automatic
helper purge is out of scope for this release.

To bootstrap recovery from only a transaction ID, Node enumerates only
owner-only content-addressed cache leaves, verifies each candidate's regular
file kind, mode, and hash, and invokes `probe-transaction`. The helper fd-walks
the quarantine root and returns membership only when the transaction's recorded
helper hash, protocol, and architecture match its own identity. Node does not
open transaction metadata directly. Zero or multiple matching helpers returns
`RECOVERY_REQUIRED` without mutation.

Missing Command Line Tools returns exit `3` only when no valid referenced
cached helper exists. A missing or changed referenced helper blocks status/undo
without changing either path; if the original source and compiler are still
available, the CLI may rebuild only when the binary hash exactly matches the
transaction. There is no `/bin/mv`, copy/delete, or path-string mutation
fallback.

Compile with:

```bash
/usr/bin/xcrun clang -std=c17 -Wall -Wextra -Werror -O2 \
  skills/skill-hygiene/native/cleanup-macos-helper.c \
  -o "$HELPER_BUILD_DIR/cleanup-macos-helper"
```

The helper accepts fixed subcommands and root roles, never arbitrary shell
commands. It writes exactly one bounded JSON object to stdout and diagnostics to
stderr:

```text
install-self
install-launcher
inspect
hash-install-receipt
probe-transaction
publish-state
rename-exclusive
reconcile
lock-acquire
lock-isolate-stale
```

Node validates a separately versioned helper response before using any field.
Test missing compiler with valid cache, missing compiler without cache, compiler
failure, output path with spaces, sanitized PATH, cache tampering, cache loss,
exact rebuild, malformed helper JSON, oversized output, unknown helper version,
and unsupported Node 23 or 25. A `SIGKILL` during bootstrap occurs before
mutation; the next launch removes only owner-matching, mode-`0700`,
skills-refiner-prefixed build directories after verifying they are not
symlinks. Only Node 24 and a verified persistent helper may reach mutation.

- [ ] **Step 4: Implement fd-bound no-follow manifests**

In C, open `/` once, walk every absolute home-path component with `openat(...,
O_RDONLY | O_DIRECTORY | O_NOFOLLOW)`, and verify the resulting home fd's owner
and mode. From that fd, walk every allowed relative component the same way and
verify it with `fstat`. Classify leaves with
`fstatat(..., AT_SYMLINK_NOFOLLOW)`. Traverse directories from their open fds;
never reopen a child through a reconstructed absolute path. Read regular files
through `openat(..., O_RDONLY | O_NOFOLLOW)` and symlinks through `readlinkat`.
Sort names by raw bytes and reject invalid UTF-8/control bytes before emitting
JSON. Manifest records use relative paths and include:

```js
{
  relative_path: 'bin/tool',
  kind: 'file',
  content_digest: 'sha256:...',
  mode: 0o755,
  uid: 501,
  gid: 20,
  size: 123,
  object_id: 'dev:inode',
  security_metadata_digest: 'sha256:...'
}
```

For symlinks, omit content and record only the Base64-encoded raw link target
bytes plus link-object metadata. Detect a nested filesystem by comparing every opened object's device
to the selected entry's device. Reject unsupported kinds before calculating an
apply identity. At final apply preflight, repeat the Git/proven-authoring-source
check and bind its result into the expected identity. The read-only Git probe
uses argv arrays and verifies repository ancestry and tracking:

```bash
/usr/bin/git -C "$ENTRY_PATH" rev-parse --show-toplevel
/usr/bin/git -C "$GIT_ROOT" ls-files --error-unmatch -- "$ENTRY_RELATIVE_PATH"
```

Any enclosing worktree is conservatively `review_only`, whether the subtree is
tracked, untracked, dirty, a worktree, or a submodule. Immediately before an
exclusive move of a real directory, the helper also refuses a `.git` directory
or file at the entry or any fd-walked ancestor. Symlink entries never traverse
their targets for this check.

A real directory is mutation-eligible only when the fresh scanner supplied
`mutation_provenance.kind: installed_copy`, `confidence: direct`, and a receipt
digest plus the matching installed Git tree SHA-1. The helper opens
`.agents/.skill-lock.json` from the verified home fd, hashes its current bounded
bytes, recomputes the current entry's Git tree SHA-1 in its private transaction
temporary store with system/global Git config disabled, and requires the
receipt digest, receipt `skillFolderHash`, installed tree hash, and entry
identity to match the plan immediately before move. Unknown, changed, or
unsupported receipt evidence is `review_only`/`DRIFTED`; it never degrades to
location heuristics.

For a symlink leaf, use this fixed contract:

```text
openat(parent_fd, leaf, O_SYMLINK)
-> fstat(link_fd)
-> readlinkat(parent_fd, leaf)
-> fstatat(parent_fd, leaf, AT_SYMLINK_NOFOLLOW)
-> require both identities to match
```

`O_NOFOLLOW` is deliberately omitted with `O_SYMLINK`: the verified target
macOS returns `ELOOP` for that combination, while `O_SYMLINK` opens the link
object itself. No absolute or reconstructed path is allowed. If `O_SYMLINK`,
the link-fd metadata APIs, or the identity recheck is unavailable or
inconsistent on the target macOS runner, block symlink mutation rather than
falling back to a path.

- [ ] **Step 5: Collect structured native security metadata fail-closed**

Do not parse `/bin/ls` or `/usr/bin/xattr` text. For every manifest object, the
helper emits a normalized metadata record from native APIs: `stat` ownership,
mode and flags; ACL entries from fd-aware ACL APIs; and sorted xattr names and
raw-value digests from fd operations. A symlink uses its `O_SYMLINK` fd with
`fstat`, `flistxattr`, `fgetxattr`, and `acl_get_fd_np`, followed by a second
`fstat` identity check. It never uses `XATTR_NOFOLLOW` with a reconstructed
path. The record excludes display paths, mtimes, and locale-dependent text:

```js
{
  uid: 501,
  gid: 20,
  mode: 0o755,
  flags: ['hidden'],
  acl_digest: 'sha256:...',
  xattrs: [{ name: 'com.skills-refiner.test', value_digest: 'sha256:...' }]
}
```

Unknown flags, truncated metadata, ACL/xattr API errors, or permission failures
block the item. Native macOS CI must compare nested file, directory, and symlink
metadata before quarantine and after undo with no ACL/xattr/flag skip. The
`hidden` fixture must survive; the `uchg` fixture must fail before intent is
published and remain untouched. If Darwin rejects any required symlink fd API,
the tested and documented behavior is an explicit symlink-mutation block, not a
weaker path-based implementation.

For `acl_get_fd_np(fd, ACL_TYPE_EXTENDED)`, `NULL` with `errno == ENOENT` means
the object has no extended ACL and normalizes to an empty ACL list. Other ACL
errors remain blocking. Fixtures must cover both the empty-ACL case and a
symlink carrying an ACL created with `chmod -h +a`.

- [ ] **Step 6: Implement fd-bound durable publication**

Send canonical JSON to the helper over bounded stdin. From verified directory
fds, the helper opens a unique temp leaf with `openat(O_CREAT | O_EXCL |
O_WRONLY | O_NOFOLLOW, 0600)`, writes all bytes, calls `fsync`, closes, atomically
publishes within the same directory, and calls `fsync` on an
`O_RDONLY | O_DIRECTORY | O_NOFOLLOW` parent fd after verifying it with
`fstat`. Every descriptor closes in a cleanup block.

Required sequence:

```text
open temp exclusively -> write all bytes -> fsync temp -> close temp
-> rename temp to target -> fsync parent directory
```

Tests must prove mode `0600`, parent mode `0700`, no leftover temp file after a
handled error, and fail-closed behavior when file or directory `fsync` fails.

The same helper performs a real capability probe in the actual transaction
parent before apply. A unit-test double cannot satisfy the release gate.

- [ ] **Step 7: Implement atomic exclusive rename for apply and undo**

From already verified source/destination parent fds, call
`renameatx_np(source_fd, source_leaf, destination_fd, destination_leaf,
RENAME_EXCL)`. Require equal device IDs first and treat `EXDEV` as blocked.
Use this exact primitive for quarantine, restore, and stale-lock isolation.
After invocation, inspect both leaves from the same parent fds:

- source absent and destination matches expected identity: moved;
- `EEXIST` with source still matching and destination untouched: conflict;
- both, neither, or changed identity: recovery required.

Add occupied-destination and concurrent-creator tests that assert the
competitor's bytes are never replaced. Also test cross-device `EXDEV`. If the
native exclusive primitive, fd-bound postconditions, or helper compilation
cannot pass on the real macOS runner, stop; do not introduce a check-then-rename
fallback.

- [ ] **Step 8: Run the macOS adapter gate**

Run on native macOS:

```bash
/usr/bin/xcrun clang -std=c17 -Wall -Wextra -Werror -fsyntax-only skills/skill-hygiene/native/cleanup-macos-helper.c
node --test skills/skill-hygiene/tests/test-cleanup-macos.mjs
node --test skills/skill-hygiene/tests/test-cleanup-contract.mjs skills/skill-hygiene/tests/test-cleanup-core.mjs
git diff --check
```

Expected: all fixtures pass, including real directory `fsync`, metadata
preservation without skip, ancestor no-follow, authoring-source protection,
occupied destination, atomic no-clobber race, and cross-device blocking. On
non-macOS, mutation tests must report an explicit skip reason while contract
tests prove exit `3`; non-macOS skips are not macOS evidence.

- [ ] **Step 9: Commit the platform adapter batch**

```bash
test -z "$(git diff --cached --name-only)"
git add skills/skill-hygiene/native/cleanup-macos-helper.c skills/skill-hygiene/lib/cleanup-macos.mjs skills/skill-hygiene/lib/cleanup-cli.mjs skills/skill-hygiene/tests/cleanup-fixtures.mjs skills/skill-hygiene/tests/test-cleanup-macos.mjs
git diff --cached --check
git commit -m "feat(cleanup): add macOS execution identities"
```

Expected: one commit containing the adapter and its real-filesystem tests. Do
not proceed to Task 5 unless the native macOS gate is green.

## Task 5: Implement recoverable single-item transactions

**Files:**

- Create: `skills/skill-hygiene/lib/cleanup-transaction.mjs`
- Create: `skills/skill-hygiene/tests/test-cleanup-transaction.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-cli.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-contract.mjs`
- Modify: `skills/skill-hygiene/tests/cleanup-fixtures.mjs`
- Modify: `skills/skill-hygiene/tests/test-cleanup-cli.sh`

- [ ] **Step 1: Write failing state-machine tests**

Use one-item plans and a sandboxed quarantine root. Assert only these forward
transitions:

```text
PLANNED -> CONFIRMED -> PREPARED -> APPLYING -> COMMITTED
PLANNED|CONFIRMED|PREPARED -> BLOCKED|ABORTED
APPLYING -> RECOVERY_REQUIRED when reconciliation is ambiguous
```

Reject unknown, missing, repeated, and backward transitions. A committed apply
must be idempotent and return exit `0` with status `already_committed`.

- [ ] **Step 2: Write failing storage and lock tests**

Verify this owner-only layout outside every discovery root:

```text
~/.agents/skills-quarantine/
  lock/
  transactions/TRANSACTION_ID/
    plan.json
    manifest.json
    state.json
    events.jsonl
    payload/OPAQUE_ITEM_ID
```

Start two apply processes for the same plan behind a barrier. Assert exactly
one wins exclusive transaction creation, the loser performs no pre-lock write,
both observe the same immutable plan bytes, and only the lock owner may advance
state. Repeat with altered existing bytes and require
`RECOVERY_REQUIRED` before lock acquisition.

Acquire the global lock through exclusive directory creation. Record owner PID,
process start facts, transaction ID, plan hash, and a random nonce durably. A
live or identity-ambiguous lock returns `blocked`. Each item transaction ID is
derived deterministically from the validated plan hash and item ID, is embedded
in the plan after hash calculation, and is recomputed by the validator. This
makes it available to the caller even if apply is killed before stdout.

Create and durably publish the transaction's `PLANNED` metadata before lock
acquisition; this does not touch an active entry. The native helper creates the
deterministic transaction directory with exclusive `mkdirat`. The winner writes
immutable `plan.json` and the initial state. A concurrent loser opens the
existing directory read-only, verifies owner, mode, schema, canonical plan
hash projection, item hash, transaction ID, platform, and execution identity,
then waits for the global lock without rewriting any file. It does not compare
excluded presentation fields such as `created_at`. Any semantic mismatch is
`RECOVERY_REQUIRED`.

`status TRANSACTION_ID` may
isolate and clear a stale lock only through the native exclusive-rename helper,
after the OS process identity proves the owner cannot be live, the transaction
ID/plan hash/nonce match, and journal/path reconciliation is unambiguous;
otherwise it returns `RECOVERY_REQUIRED`. Transaction and payload names use
opaque IDs, not skill names.

- [ ] **Step 3: Implement write-ahead apply**

`applyItem` must perform exactly:

```text
validate schema and confirmation
-> derive and validate transaction ID
-> exclusively create or read-only verify transaction and payload parent
-> durably publish PLANNED plan and identity
-> acquire lock
-> preflight current identity and same device
-> durably publish CONFIRMED
-> durably publish PREPARED intent
-> revalidate identity
-> durably publish APPLYING intent
-> renameExclusive(active entry, opaque payload)
-> verify source absence and complete payload identity
-> durably publish COMMITTED result
-> release lock
```

The transaction document uses schema
`skills-refiner.cleanup.transaction.v1`. `events.jsonl` is diagnostic history;
the durably replaced `state.json` is the authoritative state. Never declare
commit before the postcondition and committed-state directory sync both pass.
All transaction directory creation, metadata publication, diagnostic append,
and lock operations go through the fd-bound native helper; Node never opens a
path below active, quarantine, transaction, lock, or Keep roots directly.

- [ ] **Step 4: Write failing reconciliation tests**

For each state, compare no-follow identities at the original and quarantine
paths:

```text
only original matches   -> UNCHANGED
only quarantine matches -> QUARANTINED
both match              -> RECOVERY_REQUIRED
neither matches         -> RECOVERY_REQUIRED
either identity differs -> RECOVERY_REQUIRED
```

`status` may finalize `COMMITTED` only when the durable intent proves mutation
was authorized and the quarantine payload exactly matches the plan. It must not
auto-move, auto-delete, auto-restore, overwrite, or merge an ambiguous state.

- [ ] **Step 5: Add deterministic fault seams and a real kill harness**

Expose fault points only through an injected callback in the coordinator. The
callback receives a phase and state so tests enumerate every boundary rather
than relying on six hand-picked examples:

```js
await publishState('PLANNED', fault);   // before and after durable publication
await fault('before_lock_acquire');
await fault('after_lock_acquire');
await publishState('CONFIRMED', fault); // before and after durable publication
await publishState('PREPARED', fault);  // before and after durable publication
await publishState('APPLYING', fault);  // before and after durable publication
await fault('before_move');
await fault('after_move');
await fault('before_postcondition_verify');
await fault('after_postcondition_verify');
await publishState('COMMITTED', fault); // before and after durable publication
```

Unit tests may inject thrown errors for fast branch checks, but those results do
not count toward promotion. The process-level harness parameterizes
`SKILLS_REFINER_TEST_FAULT` across the complete declared apply and restore seam
tables. The CLI recognizes that variable only when
`SKILLS_REFINER_TEST_ROOT` is an existing sandbox beneath the system temp
directory, then sends real `SIGKILL` to itself at the named seam. A new process
must perform every subsequent status/reconciliation/undo step. The test gets
the preallocated transaction ID from the plan and cross-checks it with
`onlyTransactionId(quarantineRoot)`; no undefined or hard-coded ID is used.

The same before/after publication, move, and verification seams apply to the
restore state machine. Build the expected seam table from the declared forward
and restore state lists, then assert every expected seam ran; adding a future
durable state without a fault case must fail the suite.

For every fault point, including before and after lock acquisition, every
durable forward/restore publication, move, postcondition verification, and
committed/restored publication, invoke a fresh `cleanup status ID --json`,
record the exit code and state, then converge with status or undo. Assert that
no source repository content and no unrelated active entry changes.

- [ ] **Step 6: Write failing undo and conflict tests**

Undo has its own confirmation, preflight, write-ahead intent, no-clobber move,
verification, and durable result. Assert:

- wrong transaction confirmation returns exit `2` before mutation;
- occupied original path returns exit `21` and preserves both objects exactly;
- changed payload returns exit `20` and remains quarantined;
- repeated successful undo returns exit `0` with `already_restored`;
- relative symlink raw targets are restored byte-for-byte;
- the restore state machine is exactly `RESTORE_PREPARED -> RESTORING ->
  RESTORED`, with `RESTORE_CONFLICT` and `RECOVERY_REQUIRED` terminal failures;
- a single transaction restores safely without implying batch order.

- [ ] **Step 7: Implement status and undo**

Use the helper-backed `renameExclusive` for restore; never use `rm`,
copy-and-delete, merge, or an overwriting rename. Keep committed transaction
evidence after undo. Record a new durable restore state rather than deleting the
quarantine history.

- [ ] **Step 8: Run the transaction promotion gate**

Run on native macOS:

```bash
node --test skills/skill-hygiene/tests/test-cleanup-transaction.mjs
node --test skills/skill-hygiene/tests/test-cleanup-macos.mjs
bash skills/skill-hygiene/tests/test-cleanup-cli.sh
git diff --check
```

Expected: all state, idempotency, conflict, injected-fault, real-`SIGKILL`,
reconciliation, and undo tests pass. Any severe or ambiguous failure blocks
mutation promotion; do not weaken assertions or success language.

- [ ] **Step 9: Commit the single-item transaction batch**

```bash
test -z "$(git diff --cached --name-only)"
git add skills/skill-hygiene/lib/cleanup-contract.mjs skills/skill-hygiene/lib/cleanup-cli.mjs skills/skill-hygiene/lib/cleanup-transaction.mjs skills/skill-hygiene/tests/cleanup-fixtures.mjs skills/skill-hygiene/tests/test-cleanup-cli.sh skills/skill-hygiene/tests/test-cleanup-transaction.mjs
git diff --cached --check
git commit -m "feat(cleanup): quarantine entries with recoverable transactions"
```

Expected: one commit containing the certified single-item transaction engine.

## Task 6: Add sequential apply, TTY review, and stable Keep decisions

**Files:**

- Modify: `skills/skill-hygiene/native/cleanup-macos-helper.c`
- Modify: `skills/skill-hygiene/lib/cleanup-macos.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-core.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-cli.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-transaction.mjs`
- Modify: `skills/skill-hygiene/tests/test-cleanup-core.mjs`
- Modify: `skills/skill-hygiene/tests/test-cleanup-macos.mjs`
- Modify: `skills/skill-hygiene/tests/test-cleanup-transaction.mjs`
- Modify: `skills/skill-hygiene/tests/test-cleanup-cli.sh`

- [ ] **Step 1: Write failing durable batch-coordinator tests**

Before lock acquisition, durably publish
`~/.agents/skills-quarantine/batches/BATCH_ID/plan.json` and `state.json`.
`BATCH_ID` derives from the validated plan hash. The batch document maps every
item ID to its preallocated transaction ID and terminal status. Creation uses
the same exclusive-`mkdirat` winner/read-only-loser protocol as item
transactions; no loser writes before acquiring the global lock. Assert:

- retrying the same plan reuses the same batch and transaction IDs;
- an existing batch is compared through the validated plan-hash projection,
  item hashes, transaction IDs, platform, and execution identities rather than
  complete bytes; a semantic mismatch is `RECOVERY_REQUIRED`;
- a retry differing only in excluded `created_at` reuses the existing batch and
  performs no pre-lock rewrite;
- each item commit is followed by a durable batch-state update;
- reconciliation rebuilds a batch summary from item transaction truth when
  killed after item commit but before batch update;
- kill seams exist after item N commit, before its batch update, after that
  update, and before item N+1 starts;
- an already committed item is never turned into drift or a duplicate
  transaction on retry.
- `status TRANSACTION_ID` loads the immutable item transaction, follows its
  validated batch ID, proves the item-to-transaction mapping, verifies the
  batch lock nonce plus PID/start facts, reconciles every started item, rebuilds
  batch truth, and only then uses native exclusive rename to isolate a stale
  batch-owned lock;
- a transaction absent from the batch mapping, a nonce mismatch, a live or
  ambiguous owner, or any ambiguous item returns `RECOVERY_REQUIRED` and leaves
  the lock in place.

- [ ] **Step 2: Write failing full-plan preflight tests**

Assert that every selected item is inspected before the first mutation. If one
item drifted during full-plan preflight, return exit `10`, mark it `DRIFTED`,
mark later items `NOT_STARTED`, and mutate zero items.

Then simulate drift after item 1 commits but before item 2 starts. Assert:

```json
{
  "items": [
    {"item_id": "item-01", "status": "COMMITTED"},
    {"item_id": "item-02", "status": "DRIFTED"},
    {"item_id": "item-03", "status": "NOT_STARTED"}
  ]
}
```

The coordinator stops on first failure and never describes the batch as atomic.
If no item mutated, drift returns exit `10`. If any earlier item committed,
the command returns exit `20` with `overall_status: "PARTIAL"`, a non-empty
`committed_transaction_ids` array, ordered `undo_commands`, the failed item,
and later `NOT_STARTED` items. Add an Agent test that rejects any partial JSON
reported with exit `10`.

- [ ] **Step 3: Implement durable serial coordination**

Publish or validate the deterministic batch document, acquire one coordinating
lock referencing that batch, run full-plan preflight, then call the existing
single-item transaction path in topology order while passing the same lock
lease; an item must not reacquire or release the batch-owned lock. Revalidate
immediately before each item, durably update the batch after each result, and on
retry reconcile transaction truth before continuing. Preserve committed
transaction IDs and exact undo commands in the result if a later item stops the
run. Batch directory creation and every batch-state publication use the same
fd-bound helper as item transactions. The public recovery entry remains
`status TRANSACTION_ID`; its JSON includes `batch_id` and the reconciled batch
summary so Agent clients need no hidden batch command.

- [ ] **Step 4: Write failing TTY safety tests**

Drive the launcher through a pseudo-terminal. Cover:

- pressing Enter at every review prompt selects nothing;
- `Inspect` performs no mutation and returns to the same candidate;
- `Later` is session-only;
- `Retire` is not applied until preview and exact `apply SHORT_HASH` input;
- `Ctrl-C` before the first mutation exits `130` with zero changes;
- EOF before confirmation exits without mutation;
- non-TTY stdin never renders a prompt or waits for input;
- bracketed paste and multi-line input cannot carry an extra newline into the
  next prompt or satisfy `apply SHORT_HASH`;
- machine review JSON carries all evidence rendered by `Inspect`, so Agent/IDE
  clients never need to parse terminal text.

- [ ] **Step 5: Implement the line-oriented presenter**

Use `node:readline/promises` only when both stdin and stdout are TTYs. Present
`Retire`, `Keep`, `Later`, and `Inspect`; default is no action. Escape control
characters and distinguish:

```text
Installed entry: /absolute/active/root/example-skill
Canonical target: /informational/source/example-skill
Action scope: installed entry only
```

The presenter owns no filesystem operations. It produces the same decision and
plan objects used by machine mode.

- [ ] **Step 6: Implement fingerprint-sensitive Keep persistence**

Store decisions outside discovery roots under
`~/.agents/skills-refiner/cleanup/keep-decisions.json`, owner-only and through
the `durableWriteJson` wrapper that delegates to the helper's fd-bound
`publish-state` primitive. The persisted key must include:

```js
sha256Json({
  candidate_id,
  execution_identity,
  topology_fingerprint,
  relevant_signals,
  scanner_schema,
  policy_version,
})
```

Do not persist `Later`. A mismatch re-surfaces the candidate. A malformed or
symlinked Keep store is blocked and never repaired by changing permissions.
Before persisting `Keep`, call the same read-only `inspectForPlan` adapter for
that candidate and include its execution identity in the key. If identity
inspection is blocked or unsupported, report the reason and leave the candidate
unpersisted; do not degrade to a scan-only Keep key.

- [ ] **Step 7: Generate reverse-topology undo guidance**

For every serial apply result, generate an ordered `undo_commands` array from
the committed transaction identities: installed real directories first,
explicitly selected native copies next, and distribution links last. Test a
three-item topology and require the Agent harness to execute commands in that
order. This proves reverse dependency restoration without inventing a
batch-undo command or claiming cross-item atomicity.

- [ ] **Step 8: Add rehydration reporting**

After committed apply, run a fresh scan. If an entry with the same source,
provenance, and content identity reappears, report `REHYDRATED` without deleting
it again. Explain that an installer may redeploy and a running Agent session may
still cache the skill.

- [ ] **Step 9: Run interaction and coordinator tests**

```bash
node --test skills/skill-hygiene/tests/test-cleanup-core.mjs skills/skill-hygiene/tests/test-cleanup-transaction.mjs
bash skills/skill-hygiene/tests/test-cleanup-cli.sh
git diff --check
```

Expected: zero-default TTY, strict non-TTY, sequential stop, Keep invalidation,
reverse-topology undo guidance, and rehydration tests pass.

- [ ] **Step 10: Commit the guided-flow batch**

```bash
test -z "$(git diff --cached --name-only)"
git add skills/skill-hygiene/native/cleanup-macos-helper.c skills/skill-hygiene/lib/cleanup-macos.mjs skills/skill-hygiene/lib/cleanup-core.mjs skills/skill-hygiene/lib/cleanup-cli.mjs skills/skill-hygiene/lib/cleanup-transaction.mjs skills/skill-hygiene/tests/test-cleanup-macos.mjs skills/skill-hygiene/tests/test-cleanup-core.mjs skills/skill-hygiene/tests/test-cleanup-transaction.mjs skills/skill-hygiene/tests/test-cleanup-cli.sh
git diff --cached --check
git commit -m "feat(cleanup): add guided sequential disposition flow"
```

Expected: one commit containing only coordination, TTY, Keep, and associated
tests.

## Task 7: Certify installed layout, setup-cli, documentation, and CI

**Files:**

- Modify: `skills/skill-hygiene/bin/skills-refiner`
- Modify: `skills/skill-hygiene/native/cleanup-macos-helper.c`
- Modify: `skills/skill-hygiene/lib/cleanup-macos.mjs`
- Modify: `skills/skill-hygiene/lib/cleanup-cli.mjs`
- Modify: `skills/skill-hygiene/tests/test-cleanup-cli.sh`
- Modify: `skills/skill-hygiene/tests/test-cleanup-macos.mjs`
- Modify: `skills/skill-debug/tests/test-install-layout.sh`
- Modify: `.github/workflows/governance-tests.yml`
- Modify: `skills/skill-hygiene/SKILL.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/platform-support.md`
- Modify: `docs/install-smoke-test-plan.md`

- [ ] **Step 1: Write failing setup-cli tests**

Use a PATH composed only of sandbox directories plus explicitly linked system
tools. Test:

- no writable directory already on PATH: print full-path fallback, zero writes;
- one writable PATH directory: show source and destination, then require exact
  confirmation before writing;
- unrelated existing `skills-refiner`: refuse without overwrite;
- launcher installed by this command and still pointing to the same installed
  `skill-hygiene`: report idempotent success;
- a selectively installed source outside `~/.agents` delegates to that actual
  source, never a fixed conventional path;
- sanitized Agent PATH cannot see Node, but an explicitly confirmed absolute
  Node 24 path, including one containing spaces, still launches successfully;
- Node 23 and 25 are rejected even when their absolute paths are supplied;
- symlinked or world-writable destination directory: block;
- an ancestor swapped to a symlink between confirmation and helper execution:
  block with zero wrapper write;
- EOF, non-TTY, or wrong confirmation: zero writes;
- no shell profile or rc file changes in every case.

The setup command never chooses a PATH destination silently. Non-TTY setup uses
explicit `--target /absolute/already-on-path/directory --confirm
sha256:SOURCE_DESTINATION_HASH` arguments.

- [ ] **Step 2: Implement safe setup-cli**

Keep the installed launcher thin. Resolve the actual installed source path from
the running script; never substitute a fixed `~/.agents` source. Show and
confirm that source, the exact absolute Node 24 binary, and the destination
already present on PATH. Then use the persistent native helper's
`install-launcher` command to walk every destination ancestor from `/` with
directory fds, reject empty/symlinked/world-writable components, and create the
wrapper exclusively with file and parent-directory sync. A check-then-string
write in Bash or Node is forbidden. The generated file sets
`SKILLS_REFINER_NODE_BIN` to the quoted absolute binary and delegates to the
confirmed actual installed launcher. Do not hard-code a username, edit
`.zshrc`, `.bashrc`, PowerShell profiles, or overwrite any unrelated file.

- [ ] **Step 3: Extend installed-layout tests**

After copying only per-skill directories, assert that `skill-hygiene` contains
the launcher, native helper source, and all five cleanup modules. Run:

```bash
HOME="$SANDBOX" bash "$tools_root/skill-hygiene/bin/skills-refiner" --help
```

Assert exit `0` and documented cleanup commands. On native macOS with Node 24,
also run an isolated `review -> decisions -> plan -> apply -> status -> undo`
smoke against one sandbox entry. The smoke must compare the source Git fixture
before and after and confirm it is byte-identical. After apply, make the
installed helper source unavailable and use a sandbox-gated test override that
makes compiler discovery fail; `status` and `undo` must still succeed through
the transaction's verified persistent helper cache.

- [ ] **Step 4: Pin Node 24 in CI**

Add this step to `unix-integration` after checkout:

```yaml
- name: Set up Node.js 24 LTS
  uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
  with:
    node-version: 24
```

Run contract, core, and CLI tests on macOS and Ubuntu. Run real macOS adapter,
transaction, fault, and installed mutation smoke tests only when
`runner.os == 'macOS'`. Ubuntu must assert mutation exits `3`; it is not a
substitute for macOS evidence.

On macOS, compile the helper once with the checked-in production flags and run
`/usr/bin/xcrun clang -std=c17 -Wall -Wextra -Werror -fsyntax-only` as a static
gate. The adapter tests must still compile and execute a fresh helper through
the installed path; a standalone compile green is insufficient.

Do not add a Windows mutation job. Preserve the existing Windows Git Bash
read-only contract job and state explicitly that native Windows mutation is the
next separate plan.

- [ ] **Step 5: Update contributor documentation**

Document:

- Node major 24 and Apple Command Line Tools are cleanup-only; existing
  read-only Bash tools retain current dependencies;
- every user-facing Bash launcher has a matching shell test and every `.mjs`
  module uses `node:test`;
- filesystem tests use sandboxed HOME and real SUT logic; injected adapters
  isolate OS failures but do not mock the transaction engine itself;
- macOS fault tests are mandatory release gates;
- implementation batches remain clean and independently reviewable.

- [ ] **Step 6: Update English and Chinese user documentation**

Add the full installed entrypoint, TTY workflow, JSON examples, exact exit-code
table, quarantine location, status/undo commands, and platform matrix. State in
both languages:

- scan evidence is not a retirement verdict;
- nothing is selected by default;
- source repositories are never mutation targets;
- batch review leads to serial independent transactions;
- permanent purge is not implemented;
- a running Agent may cache a moved skill;
- an installer may rehydrate it;
- macOS is the only mutation authority in this batch;
- the release names only the exact `sw_vers` and architecture combinations
  exercised by authoritative CI/verification; other macOS combinations remain
  capability-gated rather than implicitly certified;
- Windows native support is not yet implemented.

Update `skills/skill-hygiene/SKILL.md` so an Agent can discover when to use
`cleanup`, but keep frontmatter under the 1024-byte loader limit. Point lengthy
contracts to `docs/platform-support.md` instead of duplicating them in
frontmatter.

- [ ] **Step 7: Update the install smoke plan**

Add a selective-install scenario that installs only `skill-hygiene`, uses its
full-path launcher, verifies JSON stdout purity, quarantines a sandboxed local
distribution link, checks status, undoes it, and compares the Base64 raw-link
identity plus source-tree digest before/after. It must not inspect or mutate the operator's
real installed skills.

- [ ] **Step 8: Run documentation and installed-layout gates**

```bash
bash skills/skill-debug/tests/test-install-layout.sh
bash skills/skill-hygiene/tests/test-cleanup-cli.sh
node --test skills/skill-hygiene/tests/test-cleanup-*.mjs
npx --yes skills@latest add . --list
for file in skills/*/SKILL.md; do
  bytes=$(awk '/^description:/{sub(/^description:[[:space:]]*/, ""); print; exit}' "$file" | LC_ALL=C wc -c | tr -d ' ')
  test "$bytes" -le 1025 || exit 1
done
git diff --check
```

Expected: installed-layout and cleanup tests pass; the skills CLI lists all four
skills; every description stays within the runtime limit including its newline;
whitespace check is silent.

- [ ] **Step 9: Commit the distribution and documentation batch**

```bash
test -z "$(git diff --cached --name-only)"
git add .github/workflows/governance-tests.yml CONTRIBUTING.md README.md README.zh-CN.md docs/install-smoke-test-plan.md docs/platform-support.md skills/skill-debug/tests/test-install-layout.sh skills/skill-hygiene/SKILL.md skills/skill-hygiene/bin/skills-refiner skills/skill-hygiene/native/cleanup-macos-helper.c skills/skill-hygiene/lib/cleanup-macos.mjs skills/skill-hygiene/lib/cleanup-cli.mjs skills/skill-hygiene/tests/test-cleanup-macos.mjs skills/skill-hygiene/tests/test-cleanup-cli.sh
git diff --cached --check
git commit -m "ci(cleanup): gate macOS installed disposition flow"
```

Expected: one commit containing setup-cli, distribution tests, CI, and matching
documentation.

## Task 8: Run acceptance, adversarial review, and delivery closure

**Files:**

- Create: `docs/verification/2026-07-14-skill-disposition-macos.md`
- Modify only if a reviewer finds a release-blocking defect: files introduced
  or modified in Tasks 1–7

- [ ] **Step 1: Run the narrow cleanup suite from a clean worktree**

```bash
test -z "$(git status --short)"
node --test skills/skill-hygiene/tests/test-cleanup-contract.mjs skills/skill-hygiene/tests/test-cleanup-core.mjs skills/skill-hygiene/tests/test-cleanup-macos.mjs skills/skill-hygiene/tests/test-cleanup-transaction.mjs
bash skills/skill-hygiene/tests/test-cleanup-cli.sh
bash skills/skill-debug/tests/test-install-layout.sh
```

Expected: clean starting state and all cleanup/installed-layout tests pass on
native macOS with no unexpected skip.

- [ ] **Step 2: Run the full repository regression suite**

```bash
bash skills/skill-hygiene/tests/test-scan.sh
bash skills/skill-debug/tests/test-doctor.sh
bash skills/skill-debug/tests/test-trace.sh
bash skills/skill-debug/tests/test-probe.sh
bash skills/skill-debug/tests/test-dashboard.sh
bash skills/skill-debug/tests/test-install-layout.sh
bash skills/skill-debug/tests/test-observability-regressions.sh
bash skills/skill-debug/tests/test-platform-contract.sh
cmp skills/skill-debug/lib/common.sh skills/skill-hygiene/lib/common.sh
find skills -type f -name '*.sh' -print0 | xargs -0 -n 1 bash -n
find skills -type f -name '*.sh' -print0 | xargs -0 shellcheck --severity=error
/usr/bin/xcrun clang -std=c17 -Wall -Wextra -Werror -fsyntax-only skills/skill-hygiene/native/cleanup-macos-helper.c
git diff --check
```

Expected: all suites pass; shared helpers are byte-identical; static and
whitespace checks are silent.

- [ ] **Step 3: Run the isolated installed-surface Agent harness**

Install only the current checkout's `skill-hygiene` into a temporary HOME. Use
the full-path launcher and JSON only to execute:

```text
scan -> review -> decisions -> plan -> apply -> status -> undo -> fresh scan
```

The harness must parse only JSON keys/enums, never localized prose, ANSI, or
prompt layout. Record command, exit code, schema, plan hash, transaction ID,
original manifest digest, quarantine manifest digest, restored manifest digest,
and source-tree digest. Expected: all three entry digests match and the source
digest never changes. For a multi-entry topology, execute the returned
`undo_commands` array in order and assert installed directories restore before
distribution links. After apply, make helper source and compiler discovery
unavailable inside the sandbox-gated harness; status and undo must use the
recorded persistent helper and still converge.

- [ ] **Step 4: Perform independent adversarial implementation review**

Assign two independent reviewers after implementation, not the implementer:

1. a platform/security reviewer attempts path escape, source mutation,
   no-clobber races, metadata loss, journal ambiguity, and false-success states;
2. a product/Agent reviewer attempts accidental Enter-driven retirement,
   non-TTY prompting, JSON contamination, unclear partial progress, unsafe
   setup-cli behavior, and misleading platform claims.

Require each reviewer to cite exact files, commands, and reproduction evidence.
The implementation owner triages findings by severity, fixes every release
blocker in the smallest applicable earlier batch, reruns that batch's tests,
and obtains reviewer re-verification. Disagreement remains recorded; it is not
silently averaged away.

- [ ] **Step 5: Record verification evidence without placeholders**

Create `docs/verification/2026-07-14-skill-disposition-macos.md` only after the
commands have run. Populate it from observed values obtained with:

```bash
git rev-parse HEAD
sw_vers -productVersion
uname -m
node --version
jq --version
```

The record must contain the exact tested revision, platform, architecture,
dependency versions, every command and exit code, fault-point results,
installed-surface manifest comparison, reviewer findings and resolutions,
unsupported platforms, and the explicit absence of sudden-power-loss and user
study claims. Do not write prospective pass statements.

- [ ] **Step 6: Define the directional usability evaluation without inflating it into a release claim**

Record a future five-maintainer protocol, not fabricated results:

- quarantine and undo a supplied sandbox candidate within ten minutes;
- at least four of five finish without assistance;
- zero source mutation and zero restore overwrite;
- participants correctly explain entry-versus-source scope;
- capture mis-selection, abandonment, and recovery behavior.

Label the protocol as directional task-usability evaluation. It does not prove
demand, product-market fit, or willingness to pay, and it does not block the
engineering release unless the team later promotes it to a release gate.

- [ ] **Step 7: Commit the observed verification record**

```bash
test -z "$(git diff --cached --name-only)"
git add docs/verification/2026-07-14-skill-disposition-macos.md
git diff --cached --check
git commit -m "docs(verification): record macOS disposition evidence"
```

Expected: one evidence-only commit containing observed results and explicit
limitations. If implementation fixes were required, commit them separately in
their owning logical batches before this evidence commit.

- [ ] **Step 8: Review commit cleanliness and history**

```bash
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
git diff --check main...HEAD
for revision in $(git rev-list --reverse main..HEAD); do git show --check --oneline "$revision"; done
```

Expected: empty worktree; focused batch history in Task order; no whitespace
errors in any commit.

- [ ] **Step 9: Push, open the review, and wait for authoritative CI**

```bash
git push -u origin codex/skill-disposition-cli
gh pr create --base main --head codex/skill-disposition-cli --title "feat: add reversible macOS skill disposition CLI" --body-file docs/verification/2026-07-14-skill-disposition-macos.md
gh pr checks --watch
```

Expected: branch push succeeds; PR references the observed verification record;
all required macOS, Ubuntu, and Windows boundary checks finish successfully.
Pending, skipped macOS mutation gates, or failed checks are not acceptance.

## Final acceptance checklist

- [ ] Exact installed/distribution entry identity comes from `skill-scan.v5`.
- [ ] Review defaults to no action and candidate evidence is never a verdict.
- [ ] Raw scan JSON cannot reach apply.
- [ ] Plans and item hashes are deterministic and schema-versioned.
- [ ] Source Git directories are review-only; external source targets remain
  byte-identical in all mutation tests.
- [ ] Real directories without unchanged direct installer-receipt provenance
  are review-only; location heuristics never authorize mutation.
- [ ] macOS no-follow traversal, metadata, directory `fsync`, same-device move,
  no-clobber race, journal, `SIGKILL`, reconciliation, and undo gates pass.
- [ ] Every committed transaction records a persistent content-addressed native
  helper; status/undo remain available when compiler/source discovery fails.
- [ ] Full-plan preflight happens before first mutation; per-item drift stops
  later work without rolling back prior commits.
- [ ] Restore never overwrites or merges an occupied path.
- [ ] JSON stdout contains one object; non-TTY never prompts.
- [ ] Exit `10` implies command-wide zero active-entry mutation; partial results
  use exit `20` and enumerate committed transactions plus undo commands.
- [ ] `setup-cli` writes only to an explicitly confirmed, safe directory already
  on PATH through the fd-bound helper and never edits profiles.
- [ ] Selective `skill-hygiene` installation works independently.
- [ ] Windows mutation remains unsupported and has no inferred success claim.
- [ ] Independent platform/security and product/Agent reviewers have no open
  release blockers.
- [ ] Every logical batch is committed separately and the worktree is clean.
