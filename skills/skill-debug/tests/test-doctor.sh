#!/usr/bin/env bash
# test-doctor.sh — Smoke test for skills-refiner-doctor.sh (fast HOME sandbox).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DOCTOR="$REPO_ROOT/bin/skills-refiner-doctor.sh"

SANDBOX=$(mktemp -d)
cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

export HOME="$SANDBOX"
mkdir -p "$HOME/.agents/skills/minimal-skill"
mkdir -p "$HOME/.agents/debug"
: >"$HOME/.agents/debug/activation.jsonl"
cat >"$HOME/.agents/skills/minimal-skill/SKILL.md" <<'EOF'
---
name: minimal-skill
description: smoke test skill for doctor harness
---

# minimal-skill

Smoke test body.
EOF

export SKILLS_REFINER_TOOLS_ROOT="$REPO_ROOT/skills"

JSON=$(bash "$DOCTOR" --json --cwd "$REPO_ROOT" --days 7)
echo "$JSON" | jq -e '.schema == "skills-refiner.doctor.v1"' >/dev/null
echo "$JSON" | jq -e '.product_version == "2.0"' >/dev/null
echo "$JSON" | jq -e '.steps.probe.status == "ok"' >/dev/null
echo "$JSON" | jq -e '.steps.dashboard.status == "ok"' >/dev/null
echo "$JSON" | jq -e '.dashboard | type == "object"' >/dev/null
echo "$JSON" | jq -e '.hygiene | type == "object"' >/dev/null
echo "$JSON" | jq -e '.hygiene.skills | length >= 1' >/dev/null
echo "$JSON" | jq -e '.probe | type == "object"' >/dev/null
echo "$JSON" | jq -e 'has("probe_terminal_report") | not' >/dev/null

rm -f "$HOME/.agents/debug/activation.jsonl"
NO_LOG_JSON=$(bash "$DOCTOR" --json --cwd "$REPO_ROOT" --days 7)
echo "$NO_LOG_JSON" | jq -e '.steps.dashboard.status == "no_data"' >/dev/null
echo "$NO_LOG_JSON" | jq -e '.dashboard.error == "no_activation_log"' >/dev/null
echo "$NO_LOG_JSON" | jq -e '.hygiene.skills | length >= 1' >/dev/null

ZH_OUTPUT=$(bash "$DOCTOR" --cwd "$REPO_ROOT" --days 7 --lang zh)
echo "$ZH_OUTPUT" | grep -q "只读快照"

echo "[OK] skills-refiner-doctor smoke test passed."
