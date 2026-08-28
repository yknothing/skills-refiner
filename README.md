# skills-refiner

**Languages:** English | [简体中文](README.zh-CN.md)

A skill governance toolkit for analyzing, interpreting, evaluating, and debugging agent skills systems.

Version 1.0 focused on design judgment after skill creation: whether a single skill is well positioned, scoped, portable, and context-efficient.

Version 2.0 extends that judgment from individual skills to installed skill systems: topology, provenance, symlink distribution, local evidence, and conservative governance.

Five skills across two layers:

**Analysis & Interpretation** — judgment and understanding:
1. **`skills-refiner`** — audit, refine, extract, and integrate a skill repository, single skill, or workflow framework
2. **`skills-appreciation`** — interpret and explain a skill or skills system in a deep, teaching-grade style

**Governance & Observability** — health and visibility:
3. **`skills-panorama`** — read-only topology map and eight-class governance triage
4. **`skill-hygiene`** — evaluate health, quality, and topology of installed skills (AI judges; shell scripts collect facts)
5. **`skill-debug`** — three-layer observability: local discovery diagnostics, activation canary tracing, canary observation dashboards

## Why this exists

Agent skills grow fast and degrade silently. Most skill ecosystems face two intertwined problems:

1. **No deep design review.** Skills pass assertion tests but suffer from scope creep, poor context engineering, or hidden fragility. Surface-level praise or criticism does not help.
2. **No operational visibility.** Users install dozens of skills across multiple agent directories and have no way to tell which are locally visible, observed through local evidence, stale, broken, or worth deeper review.

This repository addresses both:

- `skills-refiner` and `skills-appreciation` handle the **analysis** problem — deep design audit and publishable interpretation.
- `skills-panorama`, `skill-hygiene`, and `skill-debug` handle the **governance** problem — first map the topology, then evaluate and triage it, with activation evidence as a separate observation layer.

Together with a skill-creation tool such as `skill-creator`, they form a complete skill lifecycle: creation → testing → design audit → governance → observability → interpretation.

The first governance question is now deliberately blunt: can static evidence prove a load blocker? `skill-scan.sh` reports a reliably parsed description longer than the 1024-character limit as `runtime_contract.status: "fail"`. A required field that the lightweight parser does not observe is recorded under `unverified_requirements`, not declared missing. Otherwise status is `"unknown"`, `loadable` is `null`, and `runtime_verified` is `false`—the scanner does not pretend it executed an agent's real loader or a complete YAML validator.

## The five skills

### 1) `skills-refiner` — design-level audit

Use when the main job is to:
- diagnose a repository, skill, or framework;
- judge strengths, weaknesses, structure, context engineering, reuse, safety, governance, and maturity;
- separate what should be preserved, improved, simplified, removed, or rejected;
- continue into compatibility review and integration planning when a destination repository is provided.

This skill is decision-oriented. It complements `skill-creator` by covering what assertion-based testing cannot reach.

### 2) `skills-appreciation` — teaching-grade interpretation

Use when the main job is to:
- explain what a skill or skills system really is;
- unpack why its design works or fails;
- teach readers what is genuinely worth learning;
- produce a publishable appreciation article with clear structure, technical depth, and low "AI flavor".

This skill is interpretation-oriented. It does **not** force engineering-style criteria onto every target — a creative skill is judged differently from an infrastructure skill.

### 3) `skills-panorama` — read-only skills map

Use when you need a first-look inventory of canonical storage, per-Agent exposure, link health, catalog intent, collisions, and eight mutually exclusive topology gap classes. It orchestrates the existing scanner and collection/catalog facts; it does not delete, relink, or mutate the catalog.

```bash
SKILLS_REFINER_NODE_BIN=/absolute/path/to/node24 \
  bash ~/.agents/skills/skills-panorama/bin/skill-panorama.sh --yes --agents all
```

### 4) `skill-hygiene` — installed skill evaluation

Use when you need to:
- audit the health and quality of installed skills across all agent directories;
- identify broken symlinks, backup remnants, security indicators, stale or stub skills;
- understand the skill topology: canonical sources, symlinked distributions, native agent skills, same-name content/version collisions;
- get a structured inventory for governance review.

This skill follows the "AI judges, scripts collect" philosophy. The shell script (`bin/skill-scan.sh`) gathers structured facts; the AI applies expert judgment. It respects the standard skill installation model: skills installed to `~/.agents/skills/` and symlinked to agent directories are distribution links, not duplicates.

### 5) `skill-debug` — skill observability

Use when you need local evidence about likely skill discovery surfaces, observed canary events, and installed skill identities with no local canary evidence. Three layers:

- **Discovery diagnostics** (`skill-probe`) — what local skill surfaces are likely discoverable from the current working directory?
- **Activation canary tracing** (`skill-trace`) — inject/remove lightweight canary blocks to observe when agents follow skills.
- **Canary observation dashboard** (`skill-dashboard`) — canary event frequency, not-observed skill identity detection, context distribution, canary observed identity rate.

Combine with `skill-hygiene` for a full governance workflow: probe discovery → check canary observations → evaluate quality → triage.

## Design principles

Across all five skills:

- **AI judges, scripts collect.** Shell scripts gather structured data without making decisions. The AI interprets evidence using expertise and context. Scripts must not strip AI's judgment capability.
- **Loadability before elegance.** A skill that cannot satisfy the runtime loader contract is a blocker, no matter how polished its docs or workflow are.
- **Conservative by default.** If evidence is unclear, flag observations — do not recommend removal or action. Only act when evidence is unambiguous.
- **Respect the topology.** The standard model is: canonical skills in `~/.agents/skills/`, symlinked to agent directories (`.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, etc.). Symlinks are distribution links, not duplicates. Standalone project repos are not broken global skills.
- **Treat installs as deployment artifacts.** This repository is the source of truth. Global installed skills may drift; compare hashes/commits before treating an installed skill as current. For hash comparison use the scanner’s `normalized_content_sha256` on both sides (it excludes canary blocks/CRLF/BOM), not a raw `sha256sum` of a canary-injected file.
- **Use native signals first.** Prefer Claude Code OpenTelemetry, Codex skill metadata, Cursor Rules/Skills/MCP surfaces, and SDK-native traces where they exist. Canary tracing is a local fallback, not a platform trace.
- **Ground judgment in evidence.** Distinguish direct evidence, inference, and uncertainty. Avoid generic praise, inflated claims, or rote rules.
- **Keep the input surface small.** Infer mode, depth, and language from context when possible.
- **Optimize for transfer value.** The goal is not clever observations but actionable insight.

### Additional principles by layer

**Analysis & Interpretation:**
- Prefer visible reasoning structure over shapeless analysis.
- A strong appreciation piece must combine the rigor of a technical blog, the clarity of a teaching text, and the readability of a publishable article.

**Governance & Observability:**
- No false alarms. A skill with zero observed activations may simply not have been needed. Treat "not observed" as an observation, not a verdict.
- All operations are reversible. Trace injection can be stripped byte-for-byte, including files without a final newline. Scans never modify skill files; use `--json` or `--no-write` for stdout-only/no-report runs. Dashboard never modifies skill files.
- All data stays local. No data is sent externally. Canary logs use a non-symlink `~/.agents/debug/` directory (`0700`) and `activation.jsonl` (`0600`); symlinked log paths are rejected rather than followed or chmodded.

**Statistics accuracy contract:**
- Exact local statistics: skill file inventory, canonical paths, symlink distribution links, broken symlinks, content hashes, same-name/content/version collisions, report freshness, and recorded canary JSONL events.
- Proxy statistics: canary observed rate, not-observed identities, cwd distribution, and observation frequency. These count local evidence, not true runtime use.
- Out of scope without native telemetry: whether an agent discovered, loaded, obeyed, or benefited from a skill in a real conversation.

## Installation

Install all five skills globally with the [skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add yknothing/skills-refiner --skill skills-refiner --skill skills-appreciation --skill skills-panorama --skill skill-hygiene --skill skill-debug -g
```

Works with Claude Code, Cursor, Codex, OpenCode, and [many other agents](https://github.com/vercel-labs/skills#supported-agents).

The read-only governance scripts require Bash, `jq`, and a SHA-256
implementation. Local cleanup additionally requires Node.js major 24. Its
mutation adapter is currently macOS-only and needs Apple Command Line Tools the
first time it compiles the native helper. Linux/Ubuntu can review installed
entries but cleanup mutation fails closed. Windows Git Bash retains its bounded
read-only and trace-transform contract; `setup-cli` and cleanup mutation are not
implemented on Windows. Native PowerShell/cmd is not implemented. See the
[platform support contract](docs/platform-support.md) for exact boundaries.

Each skill is independently installable. For example:

```bash
# Design audit only (no runtime dependency on the other skills)
npx skills add yknothing/skills-refiner --skill skills-refiner -g

# Standalone installed-skill scanner
npx skills add yknothing/skills-refiner --skill skill-hygiene -g

# Complete governance bundle: observability + aggregate hygiene snapshot
npx skills add yknothing/skills-refiner --skill skill-debug --skill skill-hygiene -g
```

`skill-debug` works by itself for probe, dashboard, and trace operations. Its
aggregate `doctor` command reports `hygiene` as structured `unavailable` and
returns a partial-result exit code (`1`) until `skill-hygiene` is also installed.

### One-shot health snapshot (`doctor`)

Read-only aggregate (discovery probe -> activation dashboard -> hygiene scan). Does **not** inject activation traces (those edit skill files). The default report is a compact governance summary; pass `--raw` when you need the full subtool terminal output.

```bash
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh
# Machine-readable bundle for agents / tooling:
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --json
# Chinese terminal report:
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --lang zh
# From a git checkout (wrapper):
bash bin/skills-refiner-doctor.sh --help
```

Optional env: `SKILLS_REFINER_TOOLS_ROOT` — directory that contains `skill-debug/` and `skill-hygiene/` (same layout as `~/.agents/skills`).

### Review and safely retire local entries

`skill-scan.sh` supplies evidence, not a retirement verdict. The cleanup flow
governs only locally installed or distributed entries under agent skill roots;
standalone authoring/source repositories are review-only and are never mutation
targets.

On macOS with Node.js 24, start from the installed package and optionally install
a verified `skills-refiner` launcher into an existing, safe, user-owned directory
already on `PATH`:

```bash
bash ~/.agents/skills/skill-hygiene/bin/skills-refiner setup-cli --node /absolute/path/to/node24
skills-refiner cleanup
```

`setup-cli` never edits a shell profile and never overwrites an unrelated file.
In a TTY, one safe `PATH` directory is selected automatically; multiple safe
directories are listed and require `--target`. The command displays a digest
bound to the source launcher, exact Node binary, and destination, then requires
that exact digest. Blank input, EOF, a mismatch, or Ctrl-C writes nothing. If no
safe `PATH` directory exists, it makes no wrapper write and prints a full-path
fallback invocation that sets `SKILLS_REFINER_NODE_BIN` to the selected Node 24
binary before running the installed launcher.

For a non-TTY Agent/IDE flow, make every decision explicit and use JSON:

```bash
bash ~/.agents/skills/skill-hygiene/bin/skills-refiner setup-cli \
  --node /absolute/path/to/node24 --target /absolute/safe/PATH/directory --json
# Exit 2 returns a preview. Repeat the identical command with its confirmation.digest:
bash ~/.agents/skills/skill-hygiene/bin/skills-refiner setup-cli \
  --node /absolute/path/to/node24 --target /absolute/safe/PATH/directory \
  --confirm 'sha256:...' --json

SESSION_DIR=$(mktemp -d /tmp/skills-refiner-cleanup.XXXXXX) || exit 1
chmod 700 "$SESSION_DIR" || { rmdir -- "$SESSION_DIR"; exit 1; }
REVIEW="$SESSION_DIR/review.json"
SELECTOR="$SESSION_DIR/retire-paths.json"
PLAN="$SESSION_DIR/plan.json"
skills-refiner cleanup review --output "$REVIEW" --json
```

Never place these artifacts in the current project/source repository. For an
exact reviewed subset, create `$SELECTOR` inside the private session directory:

```json
{
  "schema_version": "skills-refiner.cleanup.retire-paths.v1",
  "review_fingerprint": "<copy the exact review_fingerprint value>",
  "entry_paths": ["<copy an exact normalized absolute entry_path>"]
}
```

Then compile and apply the immutable plan:

```bash
skills-refiner cleanup plan --review "$REVIEW" --retire-paths "$SELECTOR" --output "$PLAN" --json
skills-refiner cleanup apply --plan "$PLAN" --confirm 'sha256:...' --post-scan --json
skills-refiner cleanup status 'sha256:...' --json
skills-refiner cleanup undo 'sha256:...' --confirm 'sha256:...' --json
rm -f -- "$REVIEW" "$SELECTOR" "$PLAN"
rmdir -- "$SESSION_DIR"
```

Use the exact `plan_hash` from `$PLAN` for apply and each item's exact
`transaction_id` for status/undo. `--persist-keep` on `cleanup plan` is the only
Agent/IDE path that persists Keep decisions; without it, planning has no Keep
side effect. Use the mutually exclusive `--decisions` form when every candidate
needs an explicit `keep`, `later`, or `retire` action. The selector form retires
only its reviewed eligible paths and assigns Later to everything else.
`Inspect` is a TTY-only view, not a JSON action. If the flow stops early, delete
only those three session files and then remove their private directory; never
clean up by deleting the current working tree.

An executable cleanup plan is deliberately bounded to 8 items so its exact
native-helper request remains below the helper input contract. For a larger
approved subset, replace `--output "$PLAN"` with
`--partition-dir "$SESSION_DIR/parts"` after creating that owner-private mode
`0700` directory. Apply the emitted child plans in manifest order and stop on
the first failure; every item still has its own transaction and undo identity.
`cleanup partition --plan OLD_PLAN --output-dir DIR` exists only to convert a
previously compiled oversized plan without rescanning. It revalidates the old
plan and writes new, content-addressed child plans; it never applies them.

The TTY presents **Keep / Later / Inspect / Retire**. Blank input means Later,
so nothing is selected for retirement by default. Keep is persisted only while
the observed entry identity and topology still match; Later is session-local;
Inspect shows evidence; Retire requires a second exact confirmation. Retire is a
recoverable quarantine transaction under
`~/.agents/skills-quarantine/transactions/`, not permanent deletion. There is no
purge command.

A multi-entry plan executes as ordered, independently undoable transactions and
stops at the first failure. The original payloads of earlier committed
transactions remain quarantined unless restored, and their IDs are reported in
`committed_transaction_ids`; handle each transaction independently. With
`--post-scan`, each committed item is reported as `QUARANTINED`, `REHYDRATED`,
`RESTORE_CONFLICT`, or `INDETERMINATE`. An installer may repopulate the active
path while the original payload remains quarantined, and a running Agent may
retain cached state. Rehydrated entries are never automatically quarantined
again—review the new evidence first.

### Runtime-aware exposure and evidence

Physical collections organize source-owned Skills, but nesting alone does not
reduce an Agent's catalog or context cost. The default runtime profile exposes
the 12 approved Better Skills members plus the `pc-prodcraft`, `loopos`, and
`langcraft` gateways to Codex and Claude. Cursor remains observe-only until a
native catalog/profile probe is available. The profile never rewrites a
same-name user-owned entry.

Use a private directory, inspect the exact plan, and confirm its hash:

```bash
SESSION_DIR=$(mktemp -d /tmp/skills-refiner-runtime.XXXXXX) || exit 1
chmod 700 "$SESSION_DIR" || { rmdir -- "$SESSION_DIR"; exit 1; }
PROFILE_PLAN="$SESSION_DIR/profile-plan.json"
CODEX_EVIDENCE="$SESSION_DIR/codex-evidence.json"

skills-refiner runtime profile status --json
skills-refiner runtime profile plan --output "$PROFILE_PLAN" --json
skills-refiner runtime profile apply \
  --plan "$PROFILE_PLAN" --confirm 'sha256:...' --json

# Start from the post-apply state. A catalog-only observation intentionally exits 10.
skills-refiner runtime probe --adapter codex --output "$CODEX_EVIDENCE" --json
skills-refiner runtime record \
  --evidence "$CODEX_EVIDENCE" --confirm 'sha256:...' --json
skills-refiner runtime status --json
skills-refiner runtime profile status --json
```

The confirmation for `profile apply` is the exact `plan_hash`; the confirmation
for `runtime record` is the exact `evidence_id`. Evidence binds immutable
upstream identity, active controller generation, actual collection bytes,
runtime configuration, host and executable identity, and derived native probe
facts. It never stores raw prompts or transcripts. `FILESYSTEM_READY`,
`DEPLOYMENT_READY`, `CATALOG_ONLY`, and `QUALIFIED` are deliberately different
states. Missing body-access or gateway-route proof remains `UNVERIFIED`; a
successful evidence write does not turn catalog-only evidence into runtime
qualification. Accordingly, `runtime record` returns exit `10` after a
successful `RECORDED` result that is still incomplete/unqualified; this is not
a persistence failure.

New probes emit `skills-refiner.runtime-evidence.v2` with independent, bounded
`probe_result.execution` and `probe_result.decoding` facts. A nonzero Codex
process therefore cannot be reduced to a downstream JSON parse error, and even
parseable output remains blocked after a nonzero Codex exit. Claude retains its
documented ability to use a complete parsed `system.init` event as catalog
evidence even when the process later exits nonzero; v2 calls that state
`post_init_nonzero` and does not guess that authentication caused the exit. Raw
probe streams and native exception messages are never copied into runtime
evidence; probe diagnostics retain only allowlisted classifications and stream
digests, and unexpected CLI failures use a fixed diagnostic. Evidence necessarily retains bounded structured paths for executable,
configuration, discovery, and catalog identity; share output redacts them.
Adapter version discovery accepts only bounded stdout from a successful
`--version` process and never falls back to stderr. Historical v1 evidence
remains readable and recordable.

Use the exact operation id for reversible deployment changes:

```bash
skills-refiner runtime profile undo 'runtime-profile-............' \
  --confirm 'runtime-profile-............' --json
skills-refiner runtime profile recover 'runtime-profile-............' \
  --confirm 'runtime-profile-............' --json
rm -f -- "$PROFILE_PLAN" "$CODEX_EVIDENCE"
rmdir -- "$SESSION_DIR"
```

See [ADR-0008](docs/adr/0008-runtime-aware-global-skills-management.md) for the
authority model, transaction boundary, same-name preservation rule, and runtime
truth matrix.

Machine-readable commands write one JSON document to stdout and diagnostics to
stderr. Exit codes are stable at this boundary:

| Exit | Meaning |
|---:|---|
| `0` | Success or a verified idempotent result |
| `2` | Invalid/incomplete input, confirmation required/mismatched, or safe cancellation |
| `3` | Unsupported runtime, platform, or mutation adapter; no mutation |
| `10` | Blocked safety check, detected drift, or an honestly incomplete/unqualified runtime result |
| `20` | Recovery required or mutation outcome cannot be proven |
| `21` | Restore/transaction conflict |
| `130` | Interactive interruption |

Version note: the current product line is `skills-refiner 2.0`. JSON fields such as `skills-refiner.doctor.v2`, `skill-dashboard.identity.v2`, `skill-scan.v7`, and `skills-refiner.runtime-evidence.v2` are schema versions, not product release numbers. Runtime evidence v2 separates sanitized execution outcome from decoder outcome while continuing to accept historical v1 records. Doctor v2 adds the explicit `unavailable` step status used by selective installs. Scan v6 introduced bounded `INDEX.json` collection-member inventory, identity-bound canonical-content caching, and redacted risk evidence while preserving v5's conservative runtime semantics and compatibility order. Scan v7 adds a content-bound `installer_receipt_claim` without inventing an immutable revision; INDEX-only repository/revision values remain unverified claims. Cleanup accepts historical v5/v6 evidence and current v7 evidence.

Managed third-party collection versions are a separate namespace: skills-refiner reports only values extracted from an approved immutable upstream artifact, together with source path/digest, or `not_declared`. It never derives a third-party release version from these local schema/product numbers.

## Repository layout

**Analysis & Interpretation:**
- `skills/skills-refiner/SKILL.md` — audit / refine / extract / integrate
- `skills/skills-refiner/references/skill-creator-collaboration.md` — collaboration model with skill-creator
- `skills/skills-appreciation/SKILL.md` — teaching-grade appreciation / interpretation
- `skills/skills-appreciation/references/editorial-checklist.md` — article quality checklist

**Governance & Observability:**
- `skills/skills-panorama/SKILL.md` — read-only topology map and triage
- `skills/skills-panorama/bin/skill-panorama.sh` — scan/catalog orchestration → `latest.json` / `latest.md`
- `skills/skill-hygiene/SKILL.md` — AI-driven skill evaluation framework
- `skills/skill-hygiene/bin/skill-scan.sh` — topology and fact collector
- `skills/skill-hygiene/bin/skills-refiner` — Node 24 bootstrap and cleanup/collection/runtime CLI launcher
- `skills/skill-hygiene/lib/cleanup-*.mjs` — review, contract, planning, platform, and transaction logic
- `skills/skill-hygiene/lib/runtime-*.mjs` — runtime policy, profile transaction, native probe, and evidence binding
- `skills/skill-hygiene/native/cleanup-macos-helper.c` — fail-closed macOS filesystem mutation helper
- `skills/skill-hygiene/tests/test-scan.sh` and `test-cleanup-*` — scan and cleanup gates
- `skills/skill-debug/SKILL.md` — three-layer observability
- `skills/skill-debug/bin/skill-probe.sh` — discovery diagnostics
- `skills/skill-debug/bin/skill-trace.sh` — activation trace injection/removal
- `skills/skill-debug/bin/skill-dashboard.sh` — canary observation dashboard
- `skills/skill-debug/bin/skills-refiner-doctor.sh` — read-only probe + dashboard + hygiene snapshot
- `skills/skill-debug/tests/test-doctor.sh` — smoke test for doctor (`HOME` sandbox)
- `skills/skill-debug/tests/test-trace.sh` — integration tests
- `skills/skill-debug/tests/test-probe.sh` — integration tests for discovery probe
- `skills/skill-debug/tests/test-dashboard.sh` — integration tests for dashboard
- `skills/skill-debug/tests/test-install-layout.sh` — selective installed-layout contract
- `skills/skill-debug/tests/test-platform-contract.sh` — macOS/Windows path, CRLF, and permission-boundary contract
- `skills/skill-debug/tests/test-observability-regressions.sh` — regression tests for conservative observability semantics

**Supporting materials:**
- `skills/{skill-debug,skill-hygiene}/lib/common.sh` — mirrored runtime helpers; each executable governance skill ships its own copy so selective installs remain self-contained (the installed-layout test enforces byte equality)
- `bin/skills-refiner-doctor.sh` — contributor wrapper → `skills/skill-debug/bin/skills-refiner-doctor.sh`
- `docs/platform-support.md` — explicit macOS, Windows WSL 2, Git Bash, and native PowerShell support boundaries
- `examples/` — usage examples for all five skills
- `evals/` — evaluation rubrics, cases, and anchor judgments (9 cases, 2 rubrics)

## Quick usage examples

### Analysis & Interpretation

```text
# Audit a repository
Use skills-refiner on this repository.

# Audit and integrate into another repo
Use skills-refiner, and treat yknothing/prodcraft as target_repo.

# Write an appreciation article
Use skills-appreciation on this repository. Write a deep but readable article.

# Explain a single skill
Use skills-appreciation on this skill. I want to understand why it is designed this way.
```

### Governance & Observability

```bash
# One-shot read-only snapshot (probe + dashboard + hygiene terminal report)
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh

# Scan installed skills for health issues
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh

# Optional fast inventory only; provenance tree evidence is deliberately truncated
bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh --skip-provenance-tree

# Guided local review; blank keeps retirement unselected (Later)
skills-refiner cleanup

# What local skill surfaces are likely discoverable from here?
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh

# Inject activation canaries into all skills
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/

# View canary observation dashboard (last 30 days)
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh

# Combined health check
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh --doctor
```

## Evaluation

The `evals/` directory contains anchor-based evaluations for the analysis skills:

- `skills-refiner` (cases 01–03, 08) — object identification, stage control, judgment quality, evidence discipline
- `skills-appreciation` (cases 04–07, 09) — thesis clarity, mechanism explanation, writing quality, low "AI flavor"

Cases 08–09 test the collaboration scenario with skill-creator.

The governance skills (`skill-hygiene`, `skill-debug`) are validated through sandboxed integration tests. Portable scan/observability and cleanup contract/CLI gates run on macOS and Ubuntu; real cleanup mutation, native-helper fault injection, and successful transaction status/undo run only on macOS. `test-install-layout.sh` proves the selectively installed package works outside the checkout and preserves source Git state. `windows-latest` remains a bounded Git Bash read-only/trace contract and does not certify cleanup mutation.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT
