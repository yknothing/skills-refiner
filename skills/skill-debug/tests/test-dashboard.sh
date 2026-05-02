#!/usr/bin/env bash
# test-dashboard.sh — Integration tests for skill-dashboard.sh
# Creates sandboxed activation logs and skill directories, then verifies dashboard output.
#
# Usage: bash test-dashboard.sh

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DASHBOARD_SCRIPT="$SCRIPT_DIR/bin/skill-dashboard.sh"
PASS=0
FAIL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'

assert_eq() {
    local label="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — expected: '$expected', got: '$actual'"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    local label="$1" haystack="$2" needle="$3"
    if echo "$haystack" | grep -q "$needle"; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — '$needle' not found in output"
        FAIL=$((FAIL + 1))
    fi
}

hash_string() {
    local value="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$value" | sha256sum | awk '{print $1}'
    else
        printf '%s' "$value" | shasum -a 256 | awk '{print $1}'
    fi
}

hash_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    else
        shasum -a 256 "$file" | awk '{print $1}'
    fi
}

canonical_file() {
    local file="$1"
    local dir base
    dir=$(cd -P "$(dirname "$file")" && pwd)
    base=$(basename "$file")
    printf '%s/%s\n' "$dir" "$base"
}

identity_for() {
    local file="$1"
    local canonical content_hash
    canonical=$(canonical_file "$file")
    content_hash=$(hash_file "$canonical")
    hash_string "$canonical|$content_hash"
}

# ── Setup ─────────────────────────────────────────────────────────────
SANDBOX=$(mktemp -d)
trap "rm -rf $SANDBOX" EXIT

setup_sandbox() {
    # Create skill directories
    mkdir -p "$SANDBOX/.agents/skills/skill-a"
    cat > "$SANDBOX/.agents/skills/skill-a/SKILL.md" << 'EOF'
---
name: skill-a
description: Test skill A.
---
# skill-a
EOF

    mkdir -p "$SANDBOX/.agents/skills/skill-b"
    cat > "$SANDBOX/.agents/skills/skill-b/SKILL.md" << 'EOF'
---
name: skill-b
description: Test skill B.
---
# skill-b
EOF

    mkdir -p "$SANDBOX/.agents/skills/skill-c"
    cat > "$SANDBOX/.agents/skills/skill-c/SKILL.md" << 'EOF'
---
name: skill-c
    description: Test skill C (never observed activated).
---
# skill-c
EOF

    mkdir -p "$SANDBOX/.codex/skills/skill-a"
    cat > "$SANDBOX/.codex/skills/skill-a/SKILL.md" << 'EOF'
---
name: skill-a
description: Test skill A from a different source.
---
# skill-a codex variant
EOF

    # Create activation log with recent timestamps
    mkdir -p "$SANDBOX/.agents/debug"
    local now_ts
    now_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local skill_a_file skill_b_file skill_a_id skill_b_id
    skill_a_file=$(canonical_file "$SANDBOX/.agents/skills/skill-a/SKILL.md")
    skill_b_file=$(canonical_file "$SANDBOX/.agents/skills/skill-b/SKILL.md")
    skill_a_id=$(identity_for "$skill_a_file")
    skill_b_id=$(identity_for "$skill_b_file")

    cat > "$SANDBOX/.agents/debug/activation.jsonl" << LOGEOF
{"event":"skill_canary_observed","trace_schema":"skill-debug.identity.v1","trace_kind":"canary","skill":"skill-a","identity_key":"$skill_a_id","ts":"$now_ts","cwd":"/tmp/project-x"}
{"event":"skill_canary_observed","trace_schema":"skill-debug.identity.v1","trace_kind":"canary","skill":"skill-a","identity_key":"$skill_a_id","ts":"$now_ts","cwd":"/tmp/project-x"}
{"event":"skill_canary_observed","trace_schema":"skill-debug.identity.v1","trace_kind":"canary","skill":"skill-a","identity_key":"$skill_a_id","ts":"$now_ts","cwd":"/tmp/project-y"}
{"event":"skill_canary_observed","trace_schema":"skill-debug.identity.v1","trace_kind":"canary","skill":"skill-b","identity_key":"$skill_b_id","ts":"$now_ts","cwd":"/tmp/project-x"}
LOGEOF
}

# ── Tests ─────────────────────────────────────────────────────────────
run_tests() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║   skill-dashboard.sh Test Suite           ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""

    # Test 1: No log file — graceful error
    echo -e "${BOLD}── No Log File ──${NC}"
    local empty_sandbox
    empty_sandbox=$(mktemp -d)
    mkdir -p "$empty_sandbox/.agents/skills/dummy"
    cat > "$empty_sandbox/.agents/skills/dummy/SKILL.md" << 'EOF'
---
name: dummy
description: dummy
---
# dummy
EOF

    local no_log_output
    no_log_output=$(HOME="$empty_sandbox" bash "$DASHBOARD_SCRIPT" 2>&1)
    assert_contains "Shows no-log message" "$no_log_output" "No activation log"

    local no_log_json
    no_log_json=$(HOME="$empty_sandbox" bash "$DASHBOARD_SCRIPT" --json 2>&1)
    assert_contains "JSON error for no log" "$no_log_json" "no_activation_log"

    rm -rf "$empty_sandbox"
    echo ""

    # Set up full sandbox for remaining tests
    setup_sandbox

    # Test 2: Terminal output mode
    echo -e "${BOLD}── Terminal Output ──${NC}"
    local term_output
    term_output=$(HOME="$SANDBOX" bash "$DASHBOARD_SCRIPT" --all 2>&1)

    assert_contains "Shows overview section" "$term_output" "Overview"
    assert_contains "Shows total canary events" "$term_output" "Total canary events"
    assert_contains "Shows observed canary section" "$term_output" "Most Observed Canary Events"
    assert_contains "Shows not-observed section" "$term_output" "Not Observed Skills"

    echo ""

    # Test 3: JSON output mode
    echo -e "${BOLD}── JSON Output ──${NC}"
    local json_output
    json_output=$(HOME="$SANDBOX" bash "$DASHBOARD_SCRIPT" --json --all 2>&1)

    # Validate it's valid JSON
    echo "$json_output" | jq . > /dev/null 2>&1
    assert_eq "JSON output is valid" "0" "$?"

    local total_events
    total_events=$(echo "$json_output" | jq '.total_events')
    assert_eq "Total events is 4" "4" "$total_events"

    local observed_count
    observed_count=$(echo "$json_output" | jq '.observed_canary_identities')
    assert_eq "Observed canary identities is 2" "2" "$observed_count"

    local observed_rate
    observed_rate=$(echo "$json_output" | jq '.canary_observed_identity_rate_pct')
    assert_eq "Canary observed identity rate is 50%" "50" "$observed_rate"

    local installed_count
    installed_count=$(echo "$json_output" | jq '.installed_skills')
    assert_eq "Installed identities include same-name variant" "4" "$installed_count"

    echo ""

    # Test 4: Not-observed detection
    echo -e "${BOLD}── Not Observed Detection ──${NC}"
    local not_observed
    not_observed=$(echo "$json_output" | jq -r '.not_observed_skills[].name' 2>/dev/null)
    assert_contains "skill-c is not observed" "$not_observed" "skill-c"

    local not_observed_count
    not_observed_count=$(echo "$json_output" | jq '.not_observed_skills | length')
    assert_eq "Exactly 2 not-observed identities" "2" "$not_observed_count"

    local unobserved_same_name_variant
    unobserved_same_name_variant=$(echo "$json_output" | jq '[.not_observed_skills[] | select(.name == "skill-a" and (.canonical_skill_file | contains(".codex/skills/skill-a")))] | length')
    assert_eq "Same-name different-source variant remains not observed" "1" "$unobserved_same_name_variant"

    echo ""

    # Test 5: Frequency ranking
    echo -e "${BOLD}── Frequency Ranking ──${NC}"
    local top_skill
    top_skill=$(echo "$json_output" | jq -r '.frequency[0].skill')
    assert_eq "skill-a is most frequent" "skill-a" "$top_skill"

    local top_count
    top_count=$(echo "$json_output" | jq '.frequency[0].count')
    assert_eq "skill-a has 3 activations" "3" "$top_count"

    echo ""

    # Summary
    echo -e "${BOLD}══════════════════════════════════════════${NC}"
    local total=$((PASS + FAIL))
    if [ "$FAIL" -eq 0 ]; then
        echo -e "${GREEN}All $total tests passed.${NC}"
    else
        echo -e "${RED}$FAIL/$total tests failed.${NC}"
    fi
    return "$FAIL"
}

run_tests
