---
name: skill-debug
description: Use when you cannot tell whether a skill was discovered, loaded, or followed by the agent. Use for skill observability, activation tracing, discovery diagnostics, and effectiveness analysis. Also use when troubleshooting why a skill seems to have no effect.
---

# skill-debug

You are a skill observability advisor. Your job is to help users understand whether their skills are actually working — are they discovered, loaded, activated, and effective?

## Philosophy

1. **Observe, don't assume.** The tools collect facts about skill discovery and activation. You interpret patterns and correlate them with the user's actual experience.
2. **Respect the topology.** Skills are installed to `~/.agents/skills/` and symlinked to agent directories. Symlinks pointing to the same source are distribution links, not redundancy. The probe must distinguish symlinks from real duplicates.
3. **No false alarms.** A skill that hasn't been activated may simply not have been needed. "Zombie" is an observation, not a verdict. Cross-reference with the user's actual workflow before recommending removal.

## The Problem

Agent skills are "fire and forget" by design. You install them, hope the agent finds them, and have no way to verify:
- Was the skill discovered by the agent?
- Was it loaded into the conversation context?
- Did the agent actually follow its instructions?
- How often is it used vs. sitting idle?

This skill provides a three-layer debug architecture to collect evidence for these questions. You apply judgment.

## Quick Start

```bash
# Layer 1: What skills can the agent see right now?
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh

# Layer 2: Inject activation tracing into skills
bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject ~/.agents/skills/my-skill/SKILL.md

# Layer 3: View usage dashboard
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh
```

## Three-Layer Debug Architecture

### Layer 1: Discovery Diagnostics (`skill-probe`)

Answers: "What skills CAN the agent see from here?"

```bash
bash ~/.agents/skills/skill-debug/bin/skill-probe.sh [--cwd /path/to/project] [--verbose]
```

What it does:
- Scans all 10 Warp-supported skill directories (`.warp/skills/`, `.agents/skills/`, `.claude/skills/`, `.codex/skills/`, `.cursor/skills/`, `.gemini/skills/`, `.copilot/skills/`, `.factory/skills/`, `.github/skills/`, `.opencode/skills/`)
- Checks both project-level (cwd → repo root) and global (`~/`) locations
- Reports skill name conflicts (same name, different paths)
- Shows discovery priority order
- Validates frontmatter is parseable

Output: color-coded terminal report showing discovered skills with priority ranking.

### Layer 2: Activation Tracing (`skill-trace`)

Answers: "Was this skill actually loaded and executed?"

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
## Activation Trace (auto-injected by skill-debug)
<!-- SKILL-DEBUG-TRACE-START -->
When this skill is activated, run this command first:
\`\`\`bash
echo '{"event":"skill_activated","skill":"SKILL_NAME","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","cwd":"'$(pwd)'","agent":"'${AGENT_NAME:-unknown}'"}' >> ~/.agents/debug/activation.jsonl
\`\`\`
<!-- SKILL-DEBUG-TRACE-END -->
```

- The trace is a standard bash block that agents naturally execute when following skill instructions
- Minimal overhead: one `echo` append per activation
- All traces are clearly marked for easy removal

### Layer 3: Effectiveness Dashboard (`skill-dashboard`)

Answers: "Which skills are actually being used, and which are zombies?"

```bash
bash ~/.agents/skills/skill-debug/bin/skill-dashboard.sh [--json] [--days 30]
```

What it reports:
- **Activation frequency** — how many times each skill was triggered
- **Last activation** — when each skill was last used
- **Context distribution** — which projects/directories trigger which skills
- **Active rate** — installed skills vs. actually-used skills ratio
- **Zombie list** — installed skills with zero activations
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
- **"Skill not in discovery path"** — Skill exists but agent won't find it from current cwd
- **"Name conflict"** — Two+ skills with same name; agent picks by priority, may get wrong one
- **"Invalid frontmatter"** — Agent may skip skill due to parse error

### Activation Issues
- **Zero activations after 7+ days** — Skill may not be triggering; check description quality
- **Activated but not followed** — Description triggers loading but instructions are unclear
- **High activation, low effectiveness** — Skill is found but may need design improvements

### Usage Patterns
- **Active rate < 30%** — Too many skills installed; consider cleanup with `skill-hygiene`
- **Single-project skills in global path** — Should be moved to project-level
- **Global skills never used** — Candidates for archival

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
