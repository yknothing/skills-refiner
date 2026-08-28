---
name: skill-hygiene
description: Use when you need to audit, evaluate, govern, safely retire, or transactionally upgrade locally installed or distributed agent skills. Triggers include skill sprawl, stale, broken, or conflicting skills, local cleanup or quarantine, managed physical collections, pre-migration review, and periodic inventory checks.
---

# skill-hygiene

You are a senior agent-skills governance advisor. Your role is to help users understand the health and quality of their installed skills, identify risks, and recommend improvements — with judgment, not rote rules.

## Philosophy

1. **AI judges, scripts collect.** The shell script (`bin/skill-scan.sh`) gathers structured facts. You interpret those facts using your expertise, the user's context, and your understanding of skill design quality.
2. **Conservative by default.** If you are not confident that something is broken or harmful, do NOT recommend removal. Flag it as an observation or advisory warning. Only recommend action when the evidence is clear.
3. **Respect the topology.** Skills installed via npx/npm to `~/.agents/skills/` and symlinked to agent directories (`.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, etc.) are the standard installation pattern. Symlinks are NOT duplicates — they are distribution links.
4. **Scope matters.** Only skills in agent-recognized directories (`~/.<agent>/skills/`) are "active". Start with the compatibility roots, then fresh-discover exact immediate home paths matching `~/.<agent>/skills`; do not assume an old static root list is complete. Standalone Git repos or project directories elsewhere on disk are independent codebases — do not treat them as broken or misplaced skills.

## Running tools from an agent session

When you have **shell access** and the user asks for a skills health check, inventory, or governance triage (without insisting on paste-only mode):

- Prefer running the self-contained, **read-only** `skill-scan.sh` collector directly instead of asking the user to copy-paste output — unless the environment forbids shell execution or the user opts out.
- Use `skills-refiner-doctor.sh`, `skill-probe.sh`, or `skill-dashboard.sh` only when `skill-debug` is also installed. `skill-hygiene` does not require `skill-debug` for its own scan.
- **Never** run `skill-trace.sh --inject`, `--inject-dir`, `--strip`, or `--strip-dir` without **explicit user confirmation** (those modify `SKILL.md` files on disk).

Optional combined bundle (requires `skill-debug`):

```bash
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --json
```

## Reviewing and Safely Retiring Local Entries

Scanner evidence is not a retirement verdict. Use the cleanup flow only when the
user asks to govern skills already installed or distributed on this machine.
Standalone authoring/source repositories are review-only and must never become
mutation targets.

For a human terminal on a supported macOS host, use the guided flow:

```bash
SKILLS_REFINER_NODE_BIN=/absolute/path/to/node24 \
  bash ~/.agents/skills/skill-hygiene/bin/skills-refiner cleanup
```

If a verified launcher has already been installed with `setup-cli`, the shorter
form is `skills-refiner cleanup`. Present the evidence and preserve the command's
four choices:

- **Keep** records an observation-bound decision. It remains current only while
  the entry identity and topology still match.
- **Later** is session-local and is the blank/default response. Nothing is
  selected for retirement by default.
- **Inspect** shows more evidence without deciding.
- **Retire** creates a recoverable quarantine transaction and requires a second,
  exact confirmation. It is not deletion or purge.

For an Agent/IDE or any non-TTY workflow, use the JSON commands instead. Never
write review, decision, or plan artifacts into the current project/source
repository; keep them in a private temporary session directory:

```bash
SESSION_DIR=$(mktemp -d /tmp/skills-refiner-cleanup.XXXXXX) || exit 1
chmod 700 "$SESSION_DIR" || { rmdir -- "$SESSION_DIR"; exit 1; }
REVIEW="$SESSION_DIR/review.json"
SELECTOR="$SESSION_DIR/retire-paths.json"
PLAN="$SESSION_DIR/plan.json"
NODE24=/absolute/path/to/node24
LAUNCHER="$HOME/.agents/skills/skill-hygiene/bin/skills-refiner"
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" cleanup review \
  --output "$REVIEW" --json
# Build "$SELECTOR" from that exact review using schema
# skills-refiner.cleanup.retire-paths.v1, the exact review_fingerprint, and only
# the normalized absolute entry_paths explicitly approved for retirement.
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" cleanup plan \
  --review "$REVIEW" --retire-paths "$SELECTOR" --output "$PLAN" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" cleanup apply \
  --plan "$PLAN" --confirm 'sha256:...' --post-scan --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" cleanup status 'sha256:...' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" cleanup undo \
  'sha256:...' --confirm 'sha256:...' --json
rm -f -- "$REVIEW" "$SELECTOR" "$PLAN"
rmdir -- "$SESSION_DIR"
```

Use `--decisions` instead when the workflow must persist explicit Keep/Later
choices for every candidate. `--decisions` and `--retire-paths` are mutually
exclusive. A retire-path selector retires only the exact reviewed eligible
paths it lists; all other reviewed candidates become Later. Never select by
basename or repository-wide glob.

Take the apply confirmation from the exact `plan_hash` and status/undo identity
from the exact item `transaction_id`; never synthesize either value. Add
`--persist-keep` to `cleanup plan` only when the user explicitly wants Keep
decisions stored. Without it, Agent/IDE planning does not persist Keep.
If the flow stops early, remove only the three files and private session
directory created above; never clean up by deleting the current working tree.

Executable cleanup plans are bounded to 8 items so the exact native-helper
request remains below its input contract. For a larger approved subset, create
an owner-private mode `0700` partition directory and use `cleanup plan
--partition-dir DIR` instead of `--output`; apply the emitted child plans in
manifest order and stop on the first failure. Every item keeps an independent
transaction and undo identity. `cleanup partition --plan OLD_PLAN --output-dir
DIR` may convert an already compiled oversized plan without rescanning, but it
only writes revalidated, content-addressed child plans and never applies them.

Mutation is currently supported only by the macOS adapter and requires Node.js
major 24; the first native-helper compilation also requires Apple Command Line
Tools. Linux/Ubuntu may review, but plan/apply/status/undo fail closed with exit
`3` and zero mutation. Windows Git Bash retains only the documented bounded
read-only surface; native Windows cleanup and `setup-cli` are not implemented.

Retired payloads and transaction records live under
`~/.agents/skills-quarantine/transactions/` and remain individually undoable.
A multi-entry plan stops on the first failure; transactions committed before the
failure retain their original quarantined payloads and must be handled
individually. Post-apply evidence uses `QUARANTINED`, `REHYDRATED`,
`RESTORE_CONFLICT`, or `INDETERMINATE`. Installers may repopulate an active path
while that original payload remains quarantined, and running Agents may cache
old skill state. Never automatically re-quarantine a rehydrated entry; review it
again.

## Managing declared physical collections

Use `collection` for an artifact-set upgrade when several source-owned Skills
must move as one physical and recoverable unit. Do not substitute manual `mv`,
wildcard deletion, ad-hoc symlinks, or direct `.skill-lock.json` edits.

The current declarative managed profiles are `loopos`, `langcraft`, and
`better-skills`. A reviewed source must be a clean Git worktree at the exact
40-character revision and approved origin. A branch or `latest` is only a
candidate discovery input; resolve it before `check`.

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
status.

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

## Managing runtime exposure and evidence

Physical collection layout is not runtime isolation. Codex may recursively
discover nested members, so context reduction requires a host-specific runtime
profile and a fresh native catalog observation. Keep these truth layers
separate:

- `FILESYSTEM_READY` — the approved collection bytes and control generation are exact;
- `DEPLOYMENT_READY` — the host profile/config/projections match policy;
- `CATALOG_ONLY` — a fresh native session enumerated the expected identities;
- `QUALIFIED` — catalog, body-access, gateway-route, and context predicates all have qualifying evidence.

The default policy exposes all 13 Better Skills members and only the
`pc-prodcraft`, `loopos`, and `langcraft` gateways for their collections to
Codex and Claude. Cursor remains observe-only until a trustworthy native
catalog/profile mechanism is available. Never infer runtime qualification from
filesystem layout or source code inspection.

Use owner-private temporary files, inspect the exact profile plan, and confirm
only the returned `plan_hash`:

```bash
SESSION_DIR=$(mktemp -d /tmp/skills-refiner-runtime.XXXXXX) || exit 1
chmod 700 "$SESSION_DIR" || { rmdir -- "$SESSION_DIR"; exit 1; }
PROFILE_PLAN="$SESSION_DIR/profile-plan.json"
EVIDENCE="$SESSION_DIR/runtime-evidence.json"

SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile status --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile plan \
  --output "$PROFILE_PLAN" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile apply \
  --plan "$PROFILE_PLAN" --confirm 'sha256:...' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime probe \
  --adapter codex --output "$EVIDENCE" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime record \
  --evidence "$EVIDENCE" --confirm 'sha256:...' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime status --json
```

Probe and record deliberately return nonzero while evidence is only
catalog-level; exit `10` means incomplete/unqualified evidence as well as
blocked drift at this boundary. It does not mean a successfully confirmed
record write was rolled back. Evidence is exact-schema, content-addressed, and
bound to the active collection generation, actual collection/config bytes,
host, executable identity, and derived native output digests. Raw prompts,
transcripts, URL credentials, SSH hosts, and arbitrary extra fields are not
evidence and must never be persisted.

Only the active, attested profile operation owns its managed Codex block and
Claude projections. A marker without the active operation is unowned. External
Codex preferences for unrelated Skill names or paths are preserved; a
semantically equivalent managed path, or syntax whose ownership cannot be
resolved safely, fails closed. A same-path external projection is user-owned
and blocks mutation.
Undo/recover require the exact operation id twice:

```bash
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile undo \
  'runtime-profile-............' --confirm 'runtime-profile-............' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile recover \
  'runtime-profile-............' --confirm 'runtime-profile-............' --json
```

After any apply, start a fresh Agent session before probing; do not reuse a
pre-change catalog. Run Panorama after recording evidence so filesystem,
deployment, catalog, body, route, and context remain visible as independent
facts. The full authority and recovery model is archived in
ADR-0008 in the source repository; an independently installed Skill does not
depend on that document at runtime.

## Understanding the Skill Topology

Standard installation model:

```
~/.agents/skills/           ← canonical source (installed via npx/npm)
    ├── my-skill/SKILL.md   ← the actual skill
    └── ...

~/.claude/skills/           ← agent consumption directory
    ├── my-skill → ../../.agents/skills/my-skill  (symlink)
    └── geo-audit/SKILL.md  (native, not symlinked)

~/.cursor/skills/
    ├── my-skill → ../../.agents/skills/my-skill  (symlink)
    └── ...

~/.codex/skills/            ← may contain independently installed skills
    ├── atlas/SKILL.md      (native)
    └── ...
```

Key distinctions:
- **Canonical skills**: Real directories in `~/.agents/skills/` — the primary source
- **Symlinked skills**: Links in agent directories pointing to canonical source — NOT duplicates
- **Native agent skills**: Real directories in agent-specific dirs (e.g., `.claude/skills/geo-*`, `.codex/skills/atlas`) — independently installed
- **Project skills**: Skills inside standalone project repos — NOT global, NOT in scope for global hygiene

## Running the Scan

```bash
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh [OPTIONS]
```

Options:
- `--stale-days N` — Override stale threshold (default: 180 days)
- `--json` — Output JSON to stdout only; no report file is written
- `--no-write` — Show the terminal report without writing `~/.agents/skills-report/scan-*.json`
- `--skip-provenance-tree` — Skip content-bound Git tree reconstruction only when a deliberately truncated provenance result is acceptable. The default full scan uses a canonical-content cache and should remain the normal governance path.

The script outputs structured data. Your job is to **interpret** it.

The terminal report includes a severity summary, but the script still collects
facts rather than issuing cleanup verdicts. Active collisions exclude symlink
distribution links, backup/archive remnants, and same-content copies.

Accurate local statistics are limited to facts the filesystem can prove: skill file counts, canonical paths, symlink links, broken links, content hashes, source remotes when Git exposes them, and active name/content/version collisions. Runtime usage and outcome quality remain outside the scanner; combine with native telemetry or `skill-debug` canary evidence.

Key facts now include:
- `frontmatter` — local discovery contract facts: name and description, exact description length, UTF-8 byte length, and capped preview metadata
- `runtime_contract` — tri-state loader evidence. `fail` means a blocker was proven; `unknown` means static preflight found no blocker but did not execute the real runtime loader; `pass` is reserved for explicit runtime-validator evidence. In static mode, `loadable` is `false` for `fail` and `null` for `unknown`, never optimistically `true`. `unverified_requirements` records fields the lightweight parser did not observe without falsely claiming they are absent.
- `claude_code` — bounded Claude Code invocation signals such as model/user invocation controls, tool/path counts, and hook event names
- `openai` — bounded `agents/openai.yaml` facts: file presence, implicit-invocation policy, and tool dependency count; not runtime behavior proof
- `normalized_content_sha256` — local normalized content identity for same-name comparison without network access. Canary blocks, CRLF, and BOM are excluded from this hash, so it will differ from a raw `sha256sum` of the file whenever a canary is injected; compare normalized values with normalized values.
- `freshness` — mtime, age, stale threshold, and `is_stale` as a signal
- `provenance` — local source signals such as canonical-global, symlink-distribution, native-agent, and git remote when directly available. Repository/revision fields found only in a collection INDEX remain `index_claim` / `controller_unverified`; the scanner never lets an INDEX certify itself.
- `metadata.scan_efficiency` — per-scan canonical parse/cache-hit counts, useful for proving that aliases reused a securely identity-bound parse rather than being reparsed
- `risk_indicators` — structured, redacted review-required security signals with detector subtype, canonical file, line number, execution scope, and snippet digest
- `storage_relative_path` / `discovery_depth` / `collection_id` — direct entries plus bounded members declared by a managed collection `INDEX.json`; arbitrary nested documentation is not promoted into inventory
- `name_collisions` — same-name real directories with distinct canonical paths, versions, or content hashes
- `extra_frontmatter_keys` — non-core frontmatter keys as names only, not full values

## What to Analyze

Treat the repository as the source of truth and installed global directories as deployment artifacts. If repo and `~/.agents/skills` differ, report drift before trusting global scan results.

When reviewing scan results, apply your judgment across these dimensions. Not all apply to every skill — use the context.

### 1. Runtime Loadability
Can the skill be loaded before any design judgment starts?
- Is `runtime_contract.status` `fail`, `unknown`, or an explicitly runtime-verified `pass`?
- Are required frontmatter fields present?
- Is `description` within the loader limit?
- If this layer is `fail`, report it as a critical blocker before evaluating design quality.
- If it is `unknown`, say that runtime loadability remains unverified; do not upgrade absence of static blockers into a pass.

### 2. Frontmatter & Discoverability
Is the skill well-described? Can an agent find it when it's relevant?
- Does `description` contain clear triggering conditions?
- Does `name` follow conventions?
- Would you, as an agent, know when to invoke this skill based on its description alone?
- Do official invocation controls explain low canary observation, such as `disable-model-invocation` or user-only invocation?

### 3. Structural Quality
Does the skill communicate its purpose effectively?
- Is there a clear "when to use" signal?
- Are instructions actionable, not vague?
- Is the skill well-scoped (one job done well) or overloaded?

### 4. Size & Context Cost
Skills are loaded into agent context. Oversized skills waste tokens.
- Extremely small skills (<30 words of content) may be stubs or placeholders
- Very large skills (>5000 words) may need splitting
- These are heuristics, not rules — a reference skill legitimately needs more words

### 5. Freshness
Old doesn't mean bad. Many skills are stable and don't need updates.
- Staleness (configurable, default 180 days) is a **signal**, not a verdict
- Cross-reference with: is the skill still relevant? Does it reference deprecated tools?
- A 1-year-old skill that works perfectly is healthy

### 6. Link Integrity
- Symlinks: are they pointing to valid targets?
- Broken symlinks indicate uninstalled or moved source skills
- Internal references to other skills or files: do they resolve?

### 7. Backup & Archive Remnants
Directories with `.backup.`, `.disabled-`, `.old` in their names may be leftover from upgrades.
- These are **advisory findings** — the user may have kept them intentionally
- Report them; do not auto-remove

### 8. Security Indicators
Flag (do not auto-fix) skills that contain:
- Hardcoded secrets or tokens
- pipe-to-shell installer patterns, such as downloader output sent directly into `sh` or `bash`
- destructive filesystem commands rooted at `/`, or privileged shell commands in automated blocks
- These need human review, not automated removal

### 9. Provenance
Where did the skill come from?
- Installed via npx/npm (standard) — check if source repo is known
- Auto-generated (e.g., `.codex/memories/skills/`) — may be disposable
- Hand-crafted by user — treat with extra care before recommending changes
- Third-party (cursor built-in, etc.) — may have its own update mechanism
- The scanner only reports local provenance signals. Treat missing source URLs or unknown package metadata as uncertainty, not failure.

## How to Present Results

Use structured tables. Group findings by severity:

### Critical (requires attention)
Broken symlinks, security risks, references to non-existent dependencies.

### Advisory (worth reviewing)
Backup remnants, very old skills with no recent usage evidence, unusually large skills.

### Informational
Statistics, topology map, provenance distribution.

## Guardrails

- **NEVER delete, purge, or manually move a skill as a substitute for the
  transaction workflow.** Retire only through the cleanup CLI after exact user
  confirmation.
- Never mutate a standalone authoring/source repository. Only the installed or
  distributed entry identified by the review may be quarantined.
- Never automatically re-quarantine an entry reported as `REHYDRATED`.
- When uncertain, present the observation and let the user decide.
- Distinguish between "this is broken" (evidence-based) and "this might be stale" (heuristic).
- Respect that the user's skills may have workflows you don't fully understand.
- The scan script provides data; you provide wisdom.

## Integration

- Use `skill-debug probe` to verify which skills are discoverable from a specific cwd
- Use `skill-debug dashboard` to cross-reference with recorded canary activation evidence
- Use `skills-refiner` for deep design-quality analysis of individual skills
