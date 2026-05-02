---
name: skill-debug
description: Use when you cannot tell whether a skill was discovered, loaded, or followed by the agent. Use for skill observability, activation tracing, discovery diagnostics, and effectiveness analysis. Also use when troubleshooting why a skill seems to have no effect.
---

# skill-debug

You are a skill observability advisor. Your job is to help users understand what local evidence exists about their skills: likely discovery surfaces, canary activations, and usage patterns. Do not overstate these signals as platform-level proof of loading or effectiveness.

## Philosophy

1. **Observe, don't assume.** The tools collect facts about skill discovery and activation. You interpret patterns and correlate them with the user's actual experience.
2. **Respect the topology.** Skills are installed to `~/.agents/skills/` and symlinked to agent directories. Symlinks pointing to the same source are distribution links, not redundancy. The probe must distinguish symlinks from real duplicates.
3. **No false alarms.** A skill with no observed activation may simply not have been needed. "Not observed" is an observation, not a verdict. Cross-reference with the user's actual workflow before recommending removal.

## The Problem

Agent skills are "fire and forget" by design. You install them, hope the agent finds them, and have limited ways to verify:
- Is the skill present on a local discovery surface this diagnostic knows how to scan?
- Was the canary command observed during a skill-guided run?
- Did the agent appear to follow the skill's instructions?
- How often is it used vs. sitting idle?

This skill provides a three-layer debug architecture to collect evidence for these questions. You apply judgment.

## Quick Start

```bash
# Layer 1: What local skill surfaces are likely discoverable right now?
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh

# Layer 2: Inject activation tracing into skills
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject ~/.agents/skills/my-skill/SKILL.md

# Layer 3: View usage dashboard
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh
```

## Three-Layer Debug Architecture

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
- Injects a lightweight "canary" preamble block into skills:

```markdown
## Activation Canary Trace (auto-injected by skill-debug)
<!-- SKILL-DEBUG-TRACE-START -->
When this skill is used, run this canary command first:
\`\`\`bash
echo '{"event":"skill_canary_observed","trace_kind":"canary","skill":"SKILL_NAME","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","cwd":"'$(pwd)'","agent":"'${AGENT_NAME:-unknown}'"}' >> ~/.agents/debug/activation.jsonl
\`\`\`
<!-- SKILL-DEBUG-TRACE-END -->
```

- The trace is a standard bash block that can be observed if the agent follows the injected instruction
- Minimal overhead: one `echo` append per activation
- All traces are clearly marked for easy removal
- Presence means the canary command was followed. Absence is inconclusive; it is not proof that the skill was not discovered, loaded, or useful.

### Layer 3: Effectiveness Dashboard (`skill-dashboard`)

Answers: "Which skills have observed canary activations, and which have not been observed?"

```bash
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh [--json] [--days 30]
```

What it reports:
- **Activation frequency** — how many times each skill was triggered
- **Last activation** — when each skill was last used
- **Context distribution** — which projects/directories trigger which skills
- **Active rate** — installed skills vs. actually-used skills ratio
- **Not-observed list** — installed skills with zero recorded canary activations
- **Hot skills** — most frequently used skills

## Comprehensive Health Check

```bash
# Run all three layers + hygiene scan
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh --doctor
```

The `--doctor` mode combines:
1. Discovery probe (Layer 1)
2. Activation log analysis (Layer 3)
3. Cross-reference with `skill-hygiene` scan results if available

## Interpreting Results

### Discovery Issues
- **"Skill not in discovery path"** — Skill exists outside the local paths this diagnostic scans from the current cwd
- **"Name conflict"** — Two+ skills with same name; agent picks by priority, may get wrong one
- **"Invalid frontmatter"** — Agent may skip skill due to parse error

### Activation Issues
- **Zero observed canaries after 7+ days** — Skill may not be triggering, may not have been needed, or the canary may not have been followed
- **Observed canary but weak output** — Skill instructions may be unclear or too broad
- **High canary count, low effectiveness** — Skill is likely being invoked but may need design improvements

### Usage Patterns
- **Active rate < 30%** — Low observed usage; review workflow context with `skill-hygiene`
- **Single-project skills in global path** — Review whether project-level scope would be clearer
- **Global skills not observed** — Advisory candidates for human review, not automatic archival

## Guardrails

- Trace injection is reversible with `--strip`
- All log data stays local in `~/.agents/debug/`
- No data is sent externally
- Dashboard reads only; never modifies skill files
- Activation logs are append-only JSONL; rotate with `--rotate` flag

## Integration

- Combine with `skill-hygiene` for a complete governance workflow:
  1. `skill-debug probe` → verify discovery
  2. `skill-debug dashboard` → check usage
  3. `skill-hygiene` scan → evaluate quality
  4. Triage: fix, archive, or delete based on combined evidence
