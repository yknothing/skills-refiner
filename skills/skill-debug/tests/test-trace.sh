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

hash_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    else
        shasum -a 256 "$file" | awk '{print $1}'
    fi
}

file_mode() {
    stat -c "%a" "$1" 2>/dev/null || stat -f "%Lp" "$1" 2>/dev/null
}

safe_delete_tree() {
    local target="$1" tmp_root="${TMPDIR:-/tmp}"
    tmp_root="${tmp_root%/}"

    if [ -z "$target" ] || [ ! -d "$target" ]; then
        return 0
    fi

    case "$target" in
        "$tmp_root"/*|/tmp/*|/private/tmp/*|/var/folders/*)
            find "$target" -depth -mindepth 1 -delete 2>/dev/null || return 1
            rmdir "$target" 2>/dev/null || true
            ;;
        *)
            echo "[WARN] Refusing to clean unexpected sandbox path: $target" >&2
            return 1
            ;;
    esac
}

cleanup_sandbox() {
    safe_delete_tree "${SANDBOX:-}"
}

# ── Setup ─────────────────────────────────────────────────────────────
SANDBOX=$(mktemp -d)
trap cleanup_sandbox EXIT

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

create_self_documenting_skill() {
    local dir="$SANDBOX/$1"
    mkdir -p "$dir"
    cat > "$dir/SKILL.md" << 'EOF'
---
name: self-doc-skill
description: Use when testing trace marker examples in documentation.
---

# self-doc-skill

```markdown
## Activation Canary Trace (auto-injected by skill-debug)
<!-- SKILL-DEBUG-TRACE-START v1 -->
When this skill is used, run this canary command first:
```bash
echo canary
```
<!-- SKILL-DEBUG-TRACE-END v1 -->
```

The fenced marker example above is documentation, not an injected trace.
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
    has_marker=$(grep -c '^<!-- SKILL-DEBUG-TRACE-START v1 -->$' "$skill_file")
    assert_eq "Trace marker injected" "1" "$has_marker"

    local has_skill_name
    has_skill_name=$(grep -c '"test-skill"' "$skill_file")
    assert_eq "Correct skill name in trace" "1" "$has_skill_name"

    local has_canary_helper
    has_canary_helper=$(grep -c 'skill-canary.sh' "$skill_file")
    assert_eq "Trace calls canary helper" "1" "$has_canary_helper"

    local has_degraded_kind
    has_degraded_kind=$(grep -c '"trace_kind":"canary_degraded"' "$skill_file")
    assert_eq "Trace has degraded fallback" "1" "$has_degraded_kind"

    local has_identity_schema
    has_identity_schema=$(grep -c '"trace_schema":"skill-debug.identity.v1"' "$skill_file")
    assert_eq "Trace has identity schema" "1" "$has_identity_schema"

    local has_identity_key
    has_identity_key=$(grep -c '"identity_key":"' "$skill_file")
    assert_eq "Trace records identity key" "1" "$has_identity_key"

    local has_snapshot_fields
    has_snapshot_fields=$(grep -Ec '"canonical_skill_file"|"canonical_dir"|"content_sha256"|"declared_version"|"provenance_kind"|"entry_path"' "$skill_file" || true)
    assert_eq "Trace omits inventory snapshot fields" "0" "$has_snapshot_fields"

    # Frontmatter should still be intact
    local fm_start
    fm_start=$(head -1 "$skill_file")
    assert_eq "Frontmatter preserved after inject" "---" "$fm_start"

    echo ""

    # Test 2: Idempotency — inject again should skip
    echo -e "${BOLD}── Idempotency ──${NC}"
    local before_hash
    before_hash=$(hash_file "$skill_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$skill_file" > /dev/null 2>&1
    local after_hash
    after_hash=$(hash_file "$skill_file")
    assert_eq "Second inject is byte-for-byte no-op" "$before_hash" "$after_hash"

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

    local stripped_content
    stripped_content=$(cat "$skill_file")
    local expected_content
    expected_content=$(cat << 'EOF'
---
name: test-skill
description: Use when testing trace injection.
---

# test-skill

## Instructions
Do something useful.
EOF
)
    assert_eq "Inject then strip restores original content" "$expected_content" "$stripped_content"

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

    # Test 5: Documentation examples are not treated as injected traces
    echo -e "${BOLD}── Self Documentation Safety ──${NC}"
    create_self_documenting_skill "self-doc"
    local self_doc_file="$SANDBOX/self-doc/SKILL.md"
    local self_doc_before
    self_doc_before=$(hash_file "$self_doc_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$self_doc_file" > /dev/null 2>&1
    local self_doc_after
    self_doc_after=$(hash_file "$self_doc_file")
    assert_eq "Strip ignores fenced trace marker examples" "$self_doc_before" "$self_doc_after"

    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$self_doc_file" > /dev/null 2>&1
    local self_doc_markers
    self_doc_markers=$(grep -c '^<!-- SKILL-DEBUG-TRACE-START v1 -->$' "$self_doc_file")
    assert_eq "Inject adds one real marker and keeps documentation marker" "2" "$self_doc_markers"

    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$self_doc_file" > /dev/null 2>&1
    local self_doc_markers_after
    self_doc_markers_after=$(grep -c '^<!-- SKILL-DEBUG-TRACE-START v1 -->$' "$self_doc_file")
    assert_eq "Strip removes only real marker" "1" "$self_doc_markers_after"

    echo ""

    # Test 6: CRLF/BOM frontmatter is still recognized for insertion point
    echo -e "${BOLD}── Frontmatter Edge Cases ──${NC}"
    local crlf_dir="$SANDBOX/crlf-skill"
    mkdir -p "$crlf_dir"
    printf '\357\273\277---\r\nname: crlf-skill\r\ndescription: Use when testing CRLF frontmatter.\r\n---\r\n\r\n# crlf-skill\r\n' > "$crlf_dir/SKILL.md"
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$crlf_dir/SKILL.md" > /dev/null 2>&1
    local crlf_marker_line
    crlf_marker_line=$(grep -n '^<!-- SKILL-DEBUG-TRACE-START v1 -->$' "$crlf_dir/SKILL.md" | cut -d: -f1)
    assert_eq "CRLF/BOM trace inserted after frontmatter" "6" "$crlf_marker_line"

    echo ""

    # Test 7: Inject preserves permissions
    echo -e "${BOLD}── File Metadata ──${NC}"
    create_test_skill "mode-skill"
    local mode_file="$SANDBOX/mode-skill/SKILL.md"
    chmod 640 "$mode_file"
    local mode_before
    mode_before=$(file_mode "$mode_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$mode_file" > /dev/null 2>&1
    local mode_after
    mode_after=$(file_mode "$mode_file")
    assert_eq "Inject preserves file mode" "$mode_before" "$mode_after"

    echo ""

    # Test 8: Inject on non-existent file
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
