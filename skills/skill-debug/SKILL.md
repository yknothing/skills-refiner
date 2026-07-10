---
name: skill-debug
description: Use when you need local evidence about whether agent skills are on likely discovery surfaces, whether activation canaries were observed, and which installed skill identities have no local canary evidence.
---

# skill-debug

You are a skill observability advisor. Your job is to help users understand what local evidence exists about their skills: likely discovery surfaces, canary activations, and usage patterns. Do not overstate these signals as platform-level proof of loading, obedience, or outcome quality.

## Philosophy

1. **Observe, don't assume.** The tools collect facts about skill discovery and activation. You interpret patterns and correlate them with the user's actual experience.
2. **Respect the topology.** Skills are installed to `~/.agents/skills/` and symlinked to agent directories. Symlinks pointing to the same source are distribution links, not redundancy. The probe must distinguish symlinks from real duplicates.
3. **No false alarms.** A skill with no observed activation may simply not have been needed. "Not observed" is an observation, not a verdict. Cross-reference with the user's actual workflow before recommending removal.

## Running tools from an agent session

When you have **shell access** and the user asks for discovery diagnostics, activation statistics, or a general skills health snapshot:

- Prefer executing **read-only** scripts yourself (`skills-refiner-doctor.sh`, `skill-probe.sh`, `skill-dashboard.sh`) rather than instructing the user to run them manually.
- **Do not** run `skill-trace.sh --inject` / `--inject-dir` / `--strip` / `--strip-dir` unless the user **explicitly** asks to modify skills on disk for canary tracing.

One-shot read-only snapshot:

```bash
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --json
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --lang zh
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh --raw
```

## The Problem

Agent skills are "fire and forget" by design. You install them, hope the agent finds them, and have limited ways to verify:
- Is the skill present on a local discovery surface this diagnostic knows how to scan?
- Was the canary command observed during a skill-guided run?
- Did the agent appear to follow the skill's instructions?
- Which installed skill identities have observed canary events vs. no local canary evidence?

This skill provides a three-layer debug architecture to collect evidence for these questions. You apply judgment.

## Quick Start

```bash
# Read-only bundle: probe + dashboard + hygiene scan (does not inject traces)
bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh
```

The default doctor terminal output is a compact governance summary. Use `--raw`
only when you need full subtool terminal reports. Use `--lang zh` for Chinese
terminal labels. JSON output keeps stable English keys and includes
`product_version: "2.0"`; schema strings such as `skills-refiner.doctor.v2` are
compatibility versions, not product release numbers.

Selective-install contract: `skill-debug` is self-contained for probe,
dashboard, trace, and canary operations. `doctor` also uses `skill-hygiene` when
that skill is installed. Without it, `doctor --json` still returns a valid
partial object with `steps.hygiene.status: "unavailable"` and exits `1`; do not
present that partial snapshot as a complete governance scan.

```bash

# Layer 1: What local skill surfaces are likely discoverable right now?
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh

# Layer 2: Inject activation canaries into skills
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject ~/.agents/skills/my-skill/SKILL.md

# Layer 3: View canary observation dashboard
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh
```

## Three-Layer Debug Architecture

### Native Platform Signals First

Prefer native agent signals when they exist. This skill fills the local evidence gap; it does not replace platform telemetry.

| Platform | Native signal | This repo's boundary |
| --- | --- | --- |
| Claude Code | OpenTelemetry metrics/events/traces, including skill activation and tool spans when configured | `skill-probe --doctor` reports local OTel env state; canary remains a fallback/proxy |
| Codex | Native skill discovery from `.agents/skills`, `~/.agents/skills`, admin/system scopes, symlink following, and `agents/openai.yaml` invocation policy | Report local surfaces and metadata; do not claim runtime activation |
| OpenAI Agents SDK | App-workflow tracing for SDK runs: generations, tools, handoffs, guardrails, custom spans | Separate SDK signal; not evidence of Codex/IDE skill loading |
| Cursor | Rules, memories, MCP config, Agent Skills, and agent terminal context | Report local rules/skills/MCP presence; no documented full trace exporter is assumed |

### Accuracy Contract

This skill can produce accurate counts for local evidence: discoverable files on scanned paths, canonical skill identities, symlink distributions, broken links, and recorded canary JSONL events. It cannot accurately count true discovery, loading, obedience, or usefulness unless the platform exports those runtime events. Without native telemetry, canary statistics are proxy observations only.

### Layer 1: Discovery Diagnostics (`skill-probe`)

Answers: "Which local skill files are on likely discovery surfaces from here?"

```bash
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh [--cwd /path/to/project] [--verbose]
```

What it does:
- Scans common local skill directories (`.warp/skills/`, `.agents/skills/`, `.claude/skills/`, `.codex/skills/`, `.cursor/skills/`, `.gemini/skills/`, `.copilot/skills/`, `.factory/skills/`, `.github/skills/`, `.opencode/skills/`)
- Checks both project-level (cwd → repo root) and global (`~/`) locations
- Reports skill name conflicts (same name, different paths)
- Shows the diagnostic's discovery priority order
- Validates frontmatter is parseable

Output: color-coded terminal report showing local skill files this diagnostic can see. Platform-specific runtime discovery can differ.

### Layer 2: Activation Tracing (`skill-trace`)

Answers: "Did the agent follow the injected canary command for this skill?"

```bash
# Inject trace into one skill
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject ~/.agents/skills/my-skill/SKILL.md

# Inject trace into all skills in a directory
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/

# Remove traces
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --strip ~/.agents/skills/my-skill/SKILL.md

# Remove all traces
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --strip-dir ~/.agents/skills/
```

How it works:
- Injects a lightweight "canary" preamble block into skills. The following is
  conceptual structure, not an executable copy of the generated command:

```markdown
## Activation Canary Trace (auto-injected by skill-debug)
<!-- SKILL-DEBUG-TRACE-START v1 -->
<!-- SKILL-DEBUG-ORIGINAL-EOF newline|none -->
When this skill is used, run this canary command first:
\`\`\`text
_skill_debug_helper="/abs/path/to/skill-debug/bin/skill-canary.sh"
if [ -f "$_skill_debug_helper" ]; then
  bash "$_skill_debug_helper" "/abs/path/to/SKILL.md"
else
  # Generated block uses a compact secure fallback: require real, non-symlink
  # debug/log paths; set 0700/0600; append one degraded JSON event or fail closed.
  secure_degraded_append_or_fail_closed
fi
\`\`\`
<!-- SKILL-DEBUG-TRACE-END v1 -->
```

- The trace is a short bash block that can be observed if the agent follows the injected instruction
- The block delegates to `bin/skill-canary.sh`, the single implementation of identity hashing. Injected files never carry a frozen copy of the normalization algorithm, so the algorithm can evolve without orphaning previously injected canaries.
- Each event includes a local identity key derived from canonical `SKILL.md` path plus normalized content hash. Auto-injected canary blocks are excluded from that hash, so inject/strip cycles do not orphan prior observations.
- If the helper is missing (for example skill-debug was uninstalled after injection), the block appends a degraded name-only event (`trace_kind: "canary_degraded"`, empty `identity_key`) instead of failing silently.
- Canary writes fail closed if `~/.agents/debug` or `activation.jsonl` is a symlink; the helper never follows those links or changes their targets' permissions.
- Canary writes also fail closed on Windows Git Bash/MSYS2/Cygwin and when WSL 2 places `HOME` under `/mnt/<drive>`; those environments cannot prove the documented `0700`/`0600` privacy contract. On supported POSIX filesystems the helper rejects symlinked path components and verifies effective modes after `chmod`. WSL 2 with a Linux-filesystem `HOME` is the intended Windows full-observability target, pending dedicated runner certification.
- Minimal overhead: one hash calculation and one append per observed canary
- All traces are clearly marked for on-disk removal
- Presence means the canary command was followed. Absence is inconclusive; it is not proof that the skill was not discovered, loaded, or useful.

### Layer 3: Canary Observation Dashboard (`skill-dashboard`)

Answers: "Which skills have observed canary activations, and which have not been observed?"

```bash
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh [--json] [--days 30]
```

What it reports:
- **Canary event frequency** — observed canary event count per skill identity
- **Last observed canary** — most recent recorded canary timestamp
- **Context distribution** — cwd distribution for recorded canary events
- **Canary observed identity rate** — installed skill identities vs. identities with recorded canary events
- **Not-observed list** — installed skill identities with zero recorded canary events
- **Most observed skills** — identities with the most observed canary events

## Comprehensive Health Check

```bash
# Run all three layers + hygiene scan
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh --doctor
```

The `--doctor` mode combines:
1. Discovery probe (Layer 1)
2. Native platform signal check (Claude Code OTel env, Codex/Cursor local surfaces, OpenAI Agents SDK tracing env)
3. Activation log analysis (Layer 3)
4. Cross-reference with `skill-hygiene` scan results if available

## Interpreting Results

### Discovery Issues
- **"Skill not in discovery path"** — Skill exists outside the local paths this diagnostic scans from the current cwd
- **"Name conflict"** — Two+ skills with same name; agent picks by priority, may get wrong one
- **"Invalid frontmatter"** — Agent may skip skill due to parse error

### Activation Issues
- **Zero observed canaries after 7+ days** — Skill may not be triggering, may not have been needed, or the canary may not have been followed
- **Observed canary but weak output** — Skill instructions may be unclear or too broad
- **High canary count, weak output** — Skill may be followed often but still need design improvements

### Usage Patterns
- **Canary observed identity rate < 30%** — Low canary observation; review workflow context with `skill-hygiene`. This threshold is triage-only, not a quality or outcome threshold.
- **Single-project skills in global path** — Review whether project-level scope would be clearer
- **Global skills not observed** — Advisory candidates for human review, not automatic archival

## Guardrails

- Trace injection is byte-reversible on disk with `--strip`, including files without a final newline; transform or metadata-restoration failures leave the target untouched. Current agent sessions may retain already-loaded skill text until the conversation context is refreshed.
- All log data stays local in the real (non-symlink) `~/.agents/debug/` directory. The directory is mode `0700` and `activation.jsonl` is mode `0600`.
- Full shell support is verified natively on macOS. WSL 2 with a Linux-filesystem `HOME` is design-supported but not yet certified on a dedicated runner. Git Bash coverage is limited to real-directory read-only governance and trace file transforms; symlink/junction topology, canary logging, and native PowerShell/cmd are not supported claims.
- No data is sent externally
- Dashboard reads only; never modifies skill files
- Activation logs are append-only JSONL; rotate with `--rotate` flag

## Integration

- Combine with `skill-hygiene` for a complete governance workflow:
  1. `skill-debug probe` → verify discovery
  2. `skill-debug dashboard` → check canary observations
  3. `skill-hygiene` scan → evaluate quality
  4. Triage: fix, archive, or delete based on combined evidence
