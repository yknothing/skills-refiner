#!/usr/bin/env bash
# test-trace.sh — Integration tests for skill-trace.sh
# Verifies injection, stripping, and idempotency of activation traces.
#
# Usage: bash test-trace.sh

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TRACE_SCRIPT="$SCRIPT_DIR/bin/skill-trace.sh"
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

# ── Setup ─────────────────────────────────────────────────────────────
SANDBOX=$(mktemp -d)
trap "rm -rf $SANDBOX" EXIT

create_test_skill() {
    local dir="$SANDBOX/$1"
    mkdir -p "$dir"
    cat > "$dir/SKILL.md" << 'EOF'
---
name: test-skill
description: Use when testing trace injection.
---

# test-skill

## Instructions
Do something useful.
EOF
}

# ── Tests ─────────────────────────────────────────────────────────────
run_tests() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║     skill-trace.sh Test Suite             ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""

    # Test 1: Inject trace into clean skill
    echo -e "${BOLD}── Inject ──${NC}"
    create_test_skill "skill-a"
    local skill_file="$SANDBOX/skill-a/SKILL.md"

    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$skill_file" > /dev/null 2>&1
    local has_marker
    has_marker=$(grep -c "SKILL-DEBUG-TRACE-START" "$skill_file")
    assert_eq "Trace marker injected" "1" "$has_marker"

    local has_skill_name
    has_skill_name=$(grep -c '"test-skill"' "$skill_file")
    assert_eq "Correct skill name in trace" "1" "$has_skill_name"

    local has_canary_kind
    has_canary_kind=$(grep -c '"trace_kind":"canary"' "$skill_file")
    assert_eq "Trace is labeled as canary" "1" "$has_canary_kind"

    local has_identity_schema
    has_identity_schema=$(grep -c '"trace_schema":"skill-debug.identity.v1"' "$skill_file")
    assert_eq "Trace has identity schema" "1" "$has_identity_schema"

    local has_identity_key
    has_identity_key=$(grep -c '"identity_key":"' "$skill_file")
    assert_eq "Trace records identity key" "1" "$has_identity_key"

    local has_canonical_file
    has_canonical_file=$(grep -c '"canonical_skill_file":"' "$skill_file")
    assert_eq "Trace records canonical file" "1" "$has_canonical_file"

    # Frontmatter should still be intact
    local fm_start
    fm_start=$(head -1 "$skill_file")
    assert_eq "Frontmatter preserved after inject" "---" "$fm_start"

    echo ""

    # Test 2: Idempotency — inject again should skip
    echo -e "${BOLD}── Idempotency ──${NC}"
    local before_lines
    before_lines=$(wc -l < "$skill_file" | tr -d ' ')
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$skill_file" > /dev/null 2>&1
    local after_lines
    after_lines=$(wc -l < "$skill_file" | tr -d ' ')
    assert_eq "Second inject is no-op (same line count)" "$before_lines" "$after_lines"

    echo ""

    # Test 3: Strip trace
    echo -e "${BOLD}── Strip ──${NC}"
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$skill_file" > /dev/null 2>&1
    local marker_after_strip
    marker_after_strip=$(grep -c "SKILL-DEBUG-TRACE-START" "$skill_file" 2>/dev/null)
    [ -z "$marker_after_strip" ] && marker_after_strip=0
    assert_eq "Trace marker removed after strip" "0" "$marker_after_strip"

    # Original content should survive
    local has_instructions
    has_instructions=$(grep -c "## Instructions" "$skill_file")
    assert_eq "Original content preserved after strip" "1" "$has_instructions"

    echo ""

    # Test 4: Strip on clean skill is no-op
    echo -e "${BOLD}── Strip Clean ──${NC}"
    create_test_skill "skill-b"
    local clean_file="$SANDBOX/skill-b/SKILL.md"
    local clean_before
    clean_before=$(cat "$clean_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$clean_file" > /dev/null 2>&1
    local clean_after
    clean_after=$(cat "$clean_file")
    assert_eq "Strip on clean skill preserves content" "$clean_before" "$clean_after"

    echo ""

    # Test 5: Inject on non-existent file
    echo -e "${BOLD}── Error Handling ──${NC}"
    local err_output
    err_output=$(HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "/nonexistent/SKILL.md" 2>&1)
    local err_code=$?
    assert_eq "Non-existent file returns error" "1" "$err_code"

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
