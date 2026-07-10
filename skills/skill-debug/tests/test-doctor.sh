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
    echo "$REPO_SCAN" | jq -e --arg n "$skill_name" '.skills[] | select(.name == $n and .runtime_contract.status == "unknown" and .runtime_contract.loadable == null and .runtime_contract.runtime_verified == false and (.runtime_contract.load_blockers | length == 0))' >/dev/null
done
echo "$REPO_SCAN" | jq -e '[.skills[] | select(.runtime_contract.description_length > 1024)] | length == 0' >/dev/null
[ -f "$REPO_ROOT/skills/skills-appreciation/references/editorial-checklist.md" ]
[ -f "$REPO_ROOT/skills/skills-refiner/references/skill-creator-collaboration.md" ]

JSON=$(bash "$DOCTOR" --json --cwd "$REPO_ROOT" --days 7)
echo "$JSON" | jq -e '.schema == "skills-refiner.doctor.v2"' >/dev/null
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

set +e
INVALID_DAYS_OUTPUT=$(bash "$DOCTOR" --json --cwd "$REPO_ROOT" --days nope 2>"$SANDBOX/invalid-days.stderr")
INVALID_DAYS_RC=$?
MISSING_CWD_OUTPUT=$(bash "$DOCTOR" --json --cwd "$SANDBOX/does-not-exist" 2>"$SANDBOX/missing-cwd.stderr")
MISSING_CWD_RC=$?
UNKNOWN_OUTPUT=$(bash "$DOCTOR" --definitely-unknown 2>"$SANDBOX/unknown.stderr")
UNKNOWN_RC=$?
set -e
[ "$INVALID_DAYS_RC" -eq 2 ]
[ -z "$INVALID_DAYS_OUTPUT" ]
grep -q -- '--days requires a non-negative integer' "$SANDBOX/invalid-days.stderr"
[ "$MISSING_CWD_RC" -eq 2 ]
[ -z "$MISSING_CWD_OUTPUT" ]
grep -q -- '--cwd must be a readable directory' "$SANDBOX/missing-cwd.stderr"
[ "$UNKNOWN_RC" -eq 2 ]
[ -z "$UNKNOWN_OUTPUT" ]

UNREADABLE_CWD="$SANDBOX/unreadable-cwd"
mkdir -p "$UNREADABLE_CWD"
chmod 000 "$UNREADABLE_CWD"
set +e
UNREADABLE_CWD_OUTPUT=$(bash "$DOCTOR" --json --cwd "$UNREADABLE_CWD" 2>"$SANDBOX/unreadable-cwd.stderr")
UNREADABLE_CWD_RC=$?
set -e
chmod 700 "$UNREADABLE_CWD"
[ "$UNREADABLE_CWD_RC" -eq 2 ]
[ -z "$UNREADABLE_CWD_OUTPUT" ]
grep -q -- '--cwd must be a readable directory' "$SANDBOX/unreadable-cwd.stderr"

FAKE_TOOLS_ROOT="$SANDBOX/fake-tools"
mkdir -p "$FAKE_TOOLS_ROOT/skill-debug/bin" "$FAKE_TOOLS_ROOT/skill-hygiene/bin"
cat >"$FAKE_TOOLS_ROOT/skill-debug/bin/skill-probe.sh" <<'EOF'
#!/usr/bin/env bash
case "${FAKE_PROBE_MODE:-ok}" in
    ok) printf '%s\n' '{"probe":"ok"}' ;;
    empty) ;;
    invalid) echo 'not-json' ;;
    multi) printf '%s\n' '{}' '{}' ;;
    nonzero) echo '{"error":"boom"}'; echo 'probe exploded' >&2; exit 3 ;;
    no_data) echo '{"error":"no_activation_log"}'; exit 1 ;;
esac
EOF
cat >"$FAKE_TOOLS_ROOT/skill-debug/bin/skill-dashboard.sh" <<'EOF'
#!/usr/bin/env bash
case "${FAKE_DASH_MODE:-ok}" in
    ok) printf '%s\n' '{"dashboard":"ok"}' ;;
    empty) ;;
    invalid) echo 'not-json' ;;
    multi) printf '%s\n' '{}' '{}' ;;
    nonzero) echo '{"error":"boom"}'; echo 'dashboard exploded' >&2; exit 3 ;;
    no_data) echo '{"error":"no_activation_log"}'; exit 1 ;;
esac
EOF
cat >"$FAKE_TOOLS_ROOT/skill-hygiene/bin/skill-scan.sh" <<'EOF'
#!/usr/bin/env bash
case "${FAKE_SCAN_MODE:-ok}" in
    ok) printf '%s\n' '{"hygiene":"ok"}' ;;
    empty) ;;
    invalid) echo 'not-json' ;;
    multi) printf '%s\n' '{}' '{}' ;;
    nonzero) echo '{"error":"boom"}'; echo 'hygiene exploded' >&2; exit 3 ;;
    no_data) echo '{"error":"no_activation_log"}'; exit 1 ;;
esac
EOF

for CASE_SPEC in 'probe:probe:FAKE_PROBE_MODE' 'dashboard:dashboard:FAKE_DASH_MODE' 'hygiene:hygiene:FAKE_SCAN_MODE'; do
    IFS=: read -r STEP_NAME PAYLOAD_NAME MODE_VAR <<<"$CASE_SPEC"
    for BAD_MODE in empty invalid multi nonzero; do
        set +e
        FAILED_STEP_JSON=$(env "$MODE_VAR=$BAD_MODE" SKILLS_REFINER_TOOLS_ROOT="$FAKE_TOOLS_ROOT" bash "$DOCTOR" --json --cwd "$REPO_ROOT" 2>"$SANDBOX/failed-step.stderr")
        FAILED_STEP_RC=$?
        set -e
        [ "$FAILED_STEP_RC" -eq 1 ]
        echo "$FAILED_STEP_JSON" | jq -e --arg step "$STEP_NAME" --arg payload "$PAYLOAD_NAME" \
            '.steps[$step].status == "error" and .[$payload].error == "subtool_failed"' >/dev/null
        if [ "$BAD_MODE" = "nonzero" ]; then
            echo "$FAILED_STEP_JSON" | jq -e --arg payload "$PAYLOAD_NAME" '.[$payload].exit_code == 3' >/dev/null
        else
            echo "$FAILED_STEP_JSON" | jq -e --arg payload "$PAYLOAD_NAME" '.[$payload].exit_code == 0' >/dev/null
        fi
    done
done

set +e
DASH_NO_DATA_JSON=$(FAKE_DASH_MODE=no_data SKILLS_REFINER_TOOLS_ROOT="$FAKE_TOOLS_ROOT" bash "$DOCTOR" --json --cwd "$REPO_ROOT")
DASH_NO_DATA_RC=$?
PROBE_FALSE_NO_DATA_JSON=$(FAKE_PROBE_MODE=no_data SKILLS_REFINER_TOOLS_ROOT="$FAKE_TOOLS_ROOT" bash "$DOCTOR" --json --cwd "$REPO_ROOT")
PROBE_FALSE_NO_DATA_RC=$?
SCAN_FALSE_NO_DATA_JSON=$(FAKE_SCAN_MODE=no_data SKILLS_REFINER_TOOLS_ROOT="$FAKE_TOOLS_ROOT" bash "$DOCTOR" --json --cwd "$REPO_ROOT")
SCAN_FALSE_NO_DATA_RC=$?
set -e
[ "$DASH_NO_DATA_RC" -eq 0 ]
echo "$DASH_NO_DATA_JSON" | jq -e '.steps.dashboard.status == "no_data"' >/dev/null
[ "$PROBE_FALSE_NO_DATA_RC" -eq 1 ]
echo "$PROBE_FALSE_NO_DATA_JSON" | jq -e '.steps.probe.status == "error"' >/dev/null
[ "$SCAN_FALSE_NO_DATA_RC" -eq 1 ]
echo "$SCAN_FALSE_NO_DATA_JSON" | jq -e '.steps.hygiene.status == "error"' >/dev/null

for TEXT_CASE_SPEC in 'probe:FAKE_PROBE_MODE:probe exploded' 'dashboard:FAKE_DASH_MODE:dashboard exploded' 'hygiene:FAKE_SCAN_MODE:hygiene exploded'; do
    IFS=: read -r STEP_NAME MODE_VAR ERROR_DETAIL <<<"$TEXT_CASE_SPEC"
    set +e
    FAILED_STEP_TEXT=$(env "$MODE_VAR=nonzero" SKILLS_REFINER_TOOLS_ROOT="$FAKE_TOOLS_ROOT" bash "$DOCTOR" --cwd "$REPO_ROOT")
    FAILED_STEP_TEXT_RC=$?
    set -e
    [ "$FAILED_STEP_TEXT_RC" -eq 1 ]
    echo "$FAILED_STEP_TEXT" | grep -q "$STEP_NAME: error (exit_code=3): $ERROR_DETAIL"
    case "$STEP_NAME" in
        probe) ! echo "$FAILED_STEP_TEXT" | grep -q 'probe: 0 visible entries' ;;
        dashboard) ! echo "$FAILED_STEP_TEXT" | grep -q 'dashboard: 0 events' ;;
        hygiene) ! echo "$FAILED_STEP_TEXT" | grep -q 'hygiene: 0 canonical skills' ;;
    esac
done

echo "[OK] skills-refiner-doctor smoke test passed."
