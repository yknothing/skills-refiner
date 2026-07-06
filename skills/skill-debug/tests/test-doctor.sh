#!/usr/bin/env bash
# test-doctor.sh — Smoke test for skills-refiner-doctor.sh (fast HOME sandbox).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DOCTOR="$REPO_ROOT/bin/skills-refiner-doctor.sh"

SANDBOX=$(mktemp -d)
REPO_SURFACE_SANDBOX=$(mktemp -d)
cleanup() { rm -rf "$SANDBOX" "$REPO_SURFACE_SANDBOX"; }
trap cleanup EXIT

export HOME="$SANDBOX"
mkdir -p "$HOME/.agents/skills/minimal-skill"
mkdir -p "$HOME/.agents/skills/overlong-skill"
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
OVERLONG_DESC=$(printf 'x%.0s' {1..1030})
cat >"$HOME/.agents/skills/overlong-skill/SKILL.md" <<EOF
---
name: overlong-skill
description: $OVERLONG_DESC
---

# overlong-skill

Smoke test body for doctor runtime load blocker reporting.
EOF

export SKILLS_REFINER_TOOLS_ROOT="$REPO_ROOT/skills"

mkdir -p "$REPO_SURFACE_SANDBOX/.agents/skills"
cp -R "$REPO_ROOT/skills/skill-debug" "$REPO_SURFACE_SANDBOX/.agents/skills/"
cp -R "$REPO_ROOT/skills/skill-hygiene" "$REPO_SURFACE_SANDBOX/.agents/skills/"
cp -R "$REPO_ROOT/skills/skills-appreciation" "$REPO_SURFACE_SANDBOX/.agents/skills/"
cp -R "$REPO_ROOT/skills/skills-refiner" "$REPO_SURFACE_SANDBOX/.agents/skills/"
REPO_SCAN=$(HOME="$REPO_SURFACE_SANDBOX" bash "$REPO_ROOT/skills/skill-hygiene/bin/skill-scan.sh" --json)
for skill_name in skill-debug skill-hygiene skills-appreciation skills-refiner; do
    echo "$REPO_SCAN" | jq -e --arg n "$skill_name" '.skills[] | select(.name == $n and .runtime_contract.loadable == true)' >/dev/null
done
echo "$REPO_SCAN" | jq -e '[.skills[] | select(.runtime_contract.description_length > 1024)] | length == 0' >/dev/null
[ -f "$REPO_ROOT/skills/skills-appreciation/references/editorial-checklist.md" ]
[ -f "$REPO_ROOT/skills/skills-refiner/references/skill-creator-collaboration.md" ]

JSON=$(bash "$DOCTOR" --json --cwd "$REPO_ROOT" --days 7)
echo "$JSON" | jq -e '.schema == "skills-refiner.doctor.v1"' >/dev/null
echo "$JSON" | jq -e '.product_version == "2.0"' >/dev/null
echo "$JSON" | jq -e '.steps.probe.status == "ok"' >/dev/null
echo "$JSON" | jq -e '.steps.dashboard.status == "ok"' >/dev/null
echo "$JSON" | jq -e '.dashboard | type == "object"' >/dev/null
echo "$JSON" | jq -e '.hygiene | type == "object"' >/dev/null
echo "$JSON" | jq -e '.hygiene.skills | length >= 1' >/dev/null
echo "$JSON" | jq -e '.hygiene.runtime_load_blockers | length == 1' >/dev/null
echo "$JSON" | jq -e '.hygiene.runtime_load_blockers[0].load_blockers | index("description_too_long")' >/dev/null
echo "$JSON" | jq -e '.probe | type == "object"' >/dev/null
echo "$JSON" | jq -e 'has("probe_terminal_report") | not' >/dev/null

rm -f "$HOME/.agents/debug/activation.jsonl"
NO_LOG_JSON=$(bash "$DOCTOR" --json --cwd "$REPO_ROOT" --days 7)
echo "$NO_LOG_JSON" | jq -e '.steps.probe.status == "ok"' >/dev/null
echo "$NO_LOG_JSON" | jq -e '.steps.dashboard.status == "no_data"' >/dev/null
echo "$NO_LOG_JSON" | jq -e '.steps.hygiene.status == "ok"' >/dev/null
echo "$NO_LOG_JSON" | jq -e '.dashboard.error == "no_activation_log"' >/dev/null
echo "$NO_LOG_JSON" | jq -e '.hygiene.skills | length >= 1' >/dev/null

ZH_OUTPUT=$(bash "$DOCTOR" --cwd "$REPO_ROOT" --days 7 --lang zh)
echo "$ZH_OUTPUT" | grep -q "只读快照"
echo "$ZH_OUTPUT" | grep -q "没有 activation log（无数据，不是失败）"
echo "$ZH_OUTPUT" | grep -q "load_blockers=1"

echo "[OK] skills-refiner-doctor smoke test passed."
