#!/usr/bin/env bash
# test-observability-regressions.sh — focused regressions for 2.0 observability fixes.
# Covers symlink-aware discovery conflicts and conservative dashboard language.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROBE_SCRIPT="$SCRIPT_DIR/bin/skill-probe.sh"
DASHBOARD_SCRIPT="$SCRIPT_DIR/bin/skill-dashboard.sh"
PASS=0
FAIL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'

assert_contains() {
    local label="$1" haystack="$2" needle="$3"
    if echo "$haystack" | grep -q "$needle"; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — '$needle' not found"
        FAIL=$((FAIL + 1))
    fi
}

assert_not_contains() {
    local label="$1" haystack="$2" needle="$3"
    if ! echo "$haystack" | grep -q "$needle"; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — '$needle' unexpectedly found"
        FAIL=$((FAIL + 1))
    fi
}

assert_eq() {
    local label="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — expected '$expected', got '$actual'"
        FAIL=$((FAIL + 1))
    fi
}

write_skill() {
    local dir="$1" name="$2" desc="$3"
    mkdir -p "$dir"
    cat > "$dir/SKILL.md" << EOF
---
name: $name
description: $desc
---

# $name

Enough body content for regression testing.
EOF
}

run_probe_regression() {
    echo -e "${BOLD}── Probe: symlink distribution is not conflict ──${NC}"
    local sandbox
    sandbox=$(mktemp -d)

    write_skill "$sandbox/.agents/skills/shared-skill" "shared-skill" "Use when testing same-source symlink distribution."
    mkdir -p "$sandbox/.claude/skills" "$sandbox/.cursor/skills"
    ln -s "../../.agents/skills/shared-skill" "$sandbox/.claude/skills/shared-skill"
    ln -s "../../.agents/skills/shared-skill" "$sandbox/.cursor/skills/shared-skill"

    local output
    output=$(HOME="$sandbox" bash "$PROBE_SCRIPT" --cwd "$sandbox" --verbose 2>&1)
    assert_contains "Acknowledges same canonical source" "$output" "resolves to one canonical source"
    assert_contains "Reports no conflict" "$output" "No name conflicts detected"
    assert_contains "Probe uses best-effort language" "$output" "best-effort local filesystem diagnostic"
    assert_not_contains "Does not report canonical conflict" "$output" "same skill name resolves to different canonical sources"

    rm -rf "$sandbox"
    echo ""
}

run_dashboard_regression() {
    echo -e "${BOLD}── Dashboard: symlink-only discovery surface and conservative language ──${NC}"
    local sandbox
    sandbox=$(mktemp -d)

    write_skill "$sandbox/.agents/skills/shared-skill" "shared-skill" "Use when testing dashboard symlink handling."
    mkdir -p "$sandbox/.claude/skills" "$sandbox/.agents/debug"
    ln -s "../../.agents/skills/shared-skill" "$sandbox/.claude/skills/shared-skill"

    local now_ts
    now_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    cat > "$sandbox/.agents/debug/activation.jsonl" << EOF
{"event":"skill_canary_observed","trace_kind":"canary","skill":"shared-skill","ts":"$now_ts","cwd":"$sandbox/project"}
EOF

    local json_output
    json_output=$(HOME="$sandbox" bash "$DASHBOARD_SCRIPT" --json --all 2>&1)
    echo "$json_output" | jq . >/dev/null 2>&1
    assert_eq "Dashboard JSON is valid" "0" "$?"
    assert_eq "Symlinked/canonical skill counted once" "1" "$(echo "$json_output" | jq '.installed_skills')"
    assert_eq "Observed skill counted active" "1" "$(echo "$json_output" | jq '.active_skills')"
    assert_contains "JSON preserves conservative note" "$json_output" "not a removal verdict"

    local text_output
    text_output=$(HOME="$sandbox" bash "$DASHBOARD_SCRIPT" --all 2>&1)
    assert_contains "Uses observation language" "$text_output" "Not Observed Skills"
    assert_not_contains "Does not suggest cleanup directly" "$text_output" "consider cleanup"

    rm -rf "$sandbox"
    echo ""
}

main() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║  Observability Regression Test Suite     ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""

    run_probe_regression
    run_dashboard_regression

    echo -e "${BOLD}══════════════════════════════════════════${NC}"
    local total=$((PASS + FAIL))
    if [ "$FAIL" -eq 0 ]; then
        echo -e "${GREEN}All $total tests passed.${NC}"
    else
        echo -e "${RED}$FAIL/$total tests failed.${NC}"
    fi
    return "$FAIL"
}

main
