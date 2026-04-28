#!/usr/bin/env bash
# test-probe.sh — Integration tests for skill-probe.sh
# Creates a sandboxed environment to test skill discovery logic.
#
# Usage: bash test-probe.sh

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROBE_SCRIPT="$SCRIPT_DIR/bin/skill-probe.sh"
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

assert_not_contains() {
    local label="$1" haystack="$2" needle="$3"
    if ! echo "$haystack" | grep -q "$needle"; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — '$needle' unexpectedly found in output"
        FAIL=$((FAIL + 1))
    fi
}

# ── Setup ─────────────────────────────────────────────────────────────
SANDBOX=$(mktemp -d)
trap "rm -rf $SANDBOX" EXIT

setup_sandbox() {
    # Global skills in ~/.agents/skills/
    mkdir -p "$SANDBOX/.agents/skills/global-skill"
    cat > "$SANDBOX/.agents/skills/global-skill/SKILL.md" << 'EOF'
---
name: global-skill
description: Use when testing global skill discovery.
---

# global-skill
A properly formed global skill for testing discovery.
EOF

    # Another global skill in ~/.claude/skills/
    mkdir -p "$SANDBOX/.claude/skills/claude-native"
    cat > "$SANDBOX/.claude/skills/claude-native/SKILL.md" << 'EOF'
---
name: claude-native
description: Use when testing agent-specific skill discovery.
---

# claude-native
A native Claude skill.
EOF

    # Skill with invalid frontmatter
    mkdir -p "$SANDBOX/.agents/skills/bad-frontmatter"
    cat > "$SANDBOX/.agents/skills/bad-frontmatter/SKILL.md" << 'EOF'
# no-frontmatter
This skill has no YAML frontmatter at all.
EOF

    # Create a project with project-level skills
    mkdir -p "$SANDBOX/projects/my-app/.git"  # fake git repo
    mkdir -p "$SANDBOX/projects/my-app/.agents/skills/project-tool"
    cat > "$SANDBOX/projects/my-app/.agents/skills/project-tool/SKILL.md" << 'EOF'
---
name: project-tool
description: Use when testing project-level skill discovery.
---

# project-tool
A project-level skill.
EOF

    # Name conflict: same name in two locations
    mkdir -p "$SANDBOX/.codex/skills/global-skill"
    cat > "$SANDBOX/.codex/skills/global-skill/SKILL.md" << 'EOF'
---
name: global-skill
description: A conflicting skill with the same name in codex.
---

# global-skill (codex version)
Different content, same name.
EOF

    # Empty agent directory (should not crash)
    mkdir -p "$SANDBOX/.gemini/skills"
}

# ── Tests ─────────────────────────────────────────────────────────────
run_tests() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║     skill-probe.sh Test Suite             ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""

    setup_sandbox

    # Test 1: Global skill discovery
    echo -e "${BOLD}── Global Discovery ──${NC}"
    local output
    output=$(HOME="$SANDBOX" bash "$PROBE_SCRIPT" --cwd "$SANDBOX" 2>&1)

    assert_contains "Finds global-skill" "$output" "global-skill"
    assert_contains "Finds claude-native" "$output" "claude-native"
    assert_contains "Shows global count" "$output" "Global Skills"

    echo ""

    # Test 2: Project-level skill discovery
    echo -e "${BOLD}── Project-Level Discovery ──${NC}"
    local project_output
    project_output=$(HOME="$SANDBOX" bash "$PROBE_SCRIPT" --cwd "$SANDBOX/projects/my-app" 2>&1)

    assert_contains "Finds project-tool" "$project_output" "project-tool"
    assert_contains "Shows project skills section" "$project_output" "Project-Level Skills"

    echo ""

    # Test 3: Git root detection
    echo -e "${BOLD}── Git Root Detection ──${NC}"
    assert_contains "Detects git root" "$project_output" "Git root:"

    # From a non-git directory
    local no_git_output
    no_git_output=$(HOME="$SANDBOX" bash "$PROBE_SCRIPT" --cwd "$SANDBOX" 2>&1)
    assert_contains "No git root outside repo" "$no_git_output" "not in a git repo"

    echo ""

    # Test 4: Name conflict detection
    echo -e "${BOLD}── Name Conflicts ──${NC}"
    assert_contains "Detects name conflict" "$output" "global-skill"
    # The conflict section should appear since global-skill exists in both .agents and .codex
    assert_contains "Shows conflict warning" "$output" "Name Conflicts"

    echo ""

    # Test 5: Frontmatter validation
    echo -e "${BOLD}── Frontmatter Validation ──${NC}"
    local verbose_output
    verbose_output=$(HOME="$SANDBOX" bash "$PROBE_SCRIPT" --cwd "$SANDBOX" --verbose 2>&1)
    # bad-frontmatter should show ✗ for frontmatter validation
    assert_contains "Verbose output shows paths" "$verbose_output" "$SANDBOX"

    echo ""

    # Test 6: Empty directory handling
    echo -e "${BOLD}── Edge Cases ──${NC}"
    # Should not crash with empty gemini dir
    local exit_code
    HOME="$SANDBOX" bash "$PROBE_SCRIPT" --cwd "$SANDBOX" > /dev/null 2>&1
    exit_code=$?
    assert_eq "Handles empty directories without crash" "0" "$exit_code"

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
