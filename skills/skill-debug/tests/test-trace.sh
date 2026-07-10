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

file_mtime() {
    stat -c "%Y" "$1" 2>/dev/null || stat -f "%m" "$1" 2>/dev/null
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
    has_skill_name=$(grep -c '_skill_debug_name=test-skill' "$skill_file")
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
    local crlf_original crlf_inject_rc crlf_strip_rc
    mkdir -p "$crlf_dir"
    printf '\357\273\277---\r\nname: crlf-skill\r\ndescription: Use when testing CRLF frontmatter.\r\n---\r\n\r\n# crlf-skill\r\n' > "$crlf_dir/SKILL.md"
    crlf_original="$crlf_dir/SKILL.md.original"
    cp "$crlf_dir/SKILL.md" "$crlf_original"
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$crlf_dir/SKILL.md" > /dev/null 2>&1
    crlf_inject_rc=$?
    local crlf_marker_line
    crlf_marker_line=$(grep -n '^<!-- SKILL-DEBUG-TRACE-START v1 -->$' "$crlf_dir/SKILL.md" | cut -d: -f1)
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$crlf_dir/SKILL.md" > /dev/null 2>&1
    crlf_strip_rc=$?
    assert_eq "CRLF/BOM trace inject succeeds" "0" "$crlf_inject_rc"
    assert_eq "CRLF/BOM trace inserted after frontmatter" "6" "$crlf_marker_line"
    assert_eq "CRLF/BOM trace strip succeeds" "0" "$crlf_strip_rc"
    assert_eq "CRLF/BOM round trip is byte-identical" "0" "$(cmp -s "$crlf_dir/SKILL.md" "$crlf_original"; echo $?)"

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

    # Test 9: Malformed marker structures fail closed without modifying bytes or metadata
    echo -e "${BOLD}── Malformed Marker Safety ──${NC}"
    local malformed_dir="$SANDBOX/malformed"
    mkdir -p "$malformed_dir"

    local unclosed_file="$malformed_dir/unclosed.md"
    cat > "$unclosed_file" << 'EOF'
---
name: unclosed
description: Use when testing an unclosed trace marker.
---
# unclosed
<!-- SKILL-DEBUG-TRACE-START v1 -->
This content must survive.
EOF
    chmod 640 "$unclosed_file"
    local unclosed_hash_before unclosed_mode_before unclosed_mtime_before unclosed_rc
    unclosed_hash_before=$(hash_file "$unclosed_file")
    unclosed_mode_before=$(file_mode "$unclosed_file")
    unclosed_mtime_before=$(file_mtime "$unclosed_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$unclosed_file" >/dev/null 2>&1
    unclosed_rc=$?
    assert_eq "Unclosed marker is rejected" "1" "$unclosed_rc"
    assert_eq "Unclosed marker preserves bytes" "$unclosed_hash_before" "$(hash_file "$unclosed_file")"
    assert_eq "Unclosed marker preserves mode" "$unclosed_mode_before" "$(file_mode "$unclosed_file")"
    assert_eq "Unclosed marker preserves mtime" "$unclosed_mtime_before" "$(file_mtime "$unclosed_file")"

    local orphan_end_file="$malformed_dir/orphan-end.md"
    cat > "$orphan_end_file" << 'EOF'
---
name: orphan-end
description: Use when testing an orphan trace end marker.
---
<!-- SKILL-DEBUG-TRACE-END v1 -->
This content must survive.
EOF
    local orphan_hash_before orphan_rc
    orphan_hash_before=$(hash_file "$orphan_end_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$orphan_end_file" >/dev/null 2>&1
    orphan_rc=$?
    assert_eq "Orphan end marker is rejected" "1" "$orphan_rc"
    assert_eq "Orphan end marker preserves bytes" "$orphan_hash_before" "$(hash_file "$orphan_end_file")"

    local nested_file="$malformed_dir/nested.md"
    cat > "$nested_file" << 'EOF'
---
name: nested
description: Use when testing nested trace markers.
---
<!-- SKILL-DEBUG-TRACE-START v1 -->
<!-- SKILL-DEBUG-TRACE-START v1 -->
<!-- SKILL-DEBUG-TRACE-END v1 -->
<!-- SKILL-DEBUG-TRACE-END v1 -->
EOF
    local nested_hash_before nested_rc
    nested_hash_before=$(hash_file "$nested_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$nested_file" >/dev/null 2>&1
    nested_rc=$?
    assert_eq "Nested markers are rejected" "1" "$nested_rc"
    assert_eq "Nested markers preserve bytes" "$nested_hash_before" "$(hash_file "$nested_file")"

    local mismatched_file="$malformed_dir/mismatched-version.md"
    cat > "$mismatched_file" << 'EOF'
---
name: mismatched-version
description: Use when testing mismatched trace marker versions.
---
<!-- SKILL-DEBUG-TRACE-START v1 -->
This content must survive.
<!-- SKILL-DEBUG-TRACE-END v2 -->
EOF
    local mismatched_hash_before mismatched_rc
    mismatched_hash_before=$(hash_file "$mismatched_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$mismatched_file" >/dev/null 2>&1
    mismatched_rc=$?
    assert_eq "Mismatched marker versions are rejected" "1" "$mismatched_rc"
    assert_eq "Mismatched marker versions preserve bytes" "$mismatched_hash_before" "$(hash_file "$mismatched_file")"

    local unknown_file="$malformed_dir/unknown-version.md"
    cat > "$unknown_file" << 'EOF'
---
name: unknown-version
description: Use when testing an unknown trace marker version.
---
<!-- SKILL-DEBUG-TRACE-START v2 -->
This future-version content must survive.
<!-- SKILL-DEBUG-TRACE-END v2 -->
EOF
    local unknown_hash_before unknown_rc
    unknown_hash_before=$(hash_file "$unknown_file")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$unknown_file" >/dev/null 2>&1
    unknown_rc=$?
    assert_eq "Unknown marker versions are rejected" "1" "$unknown_rc"
    assert_eq "Unknown marker versions preserve bytes" "$unknown_hash_before" "$(hash_file "$unknown_file")"

    local hash_prefix_file="$malformed_dir/hash-prefix.md"
    local hash_malformed_file="$malformed_dir/hash-malformed.md"
    printf '%s\n' 'prefix' > "$hash_prefix_file"
    printf '%s\n' 'prefix' '<!-- SKILL-DEBUG-TRACE-START v1 -->' 'tail-must-affect-hash' > "$hash_malformed_file"
    local prefix_normalized_hash malformed_normalized_hash
    prefix_normalized_hash=$(bash -c '. "$1"; sr_hash_skill_file "$2"' _ "$SCRIPT_DIR/lib/common.sh" "$hash_prefix_file")
    malformed_normalized_hash=$(bash -c '. "$1"; sr_hash_skill_file "$2"' _ "$SCRIPT_DIR/lib/common.sh" "$hash_malformed_file")
    assert_eq "Malformed trace tail remains part of normalized identity" "different" "$([ "$prefix_normalized_hash" != "$malformed_normalized_hash" ] && echo different || echo same)"

    echo ""

    # Test 10: Injected paths are shell-safe and remain one exact argument
    echo -e "${BOLD}── Shell-Safe Canary Paths ──${NC}"
    local special_tools_dir special_skill_dir special_trace special_file special_command special_work special_rc special_skill_name
    special_tools_dir="$SANDBOX/"'tools "$(touch HELPER_PWNED)" `touch HELPER_PWNED_2`'
    special_skill_dir="$SANDBOX/"'skill "$(touch SKILL_PWNED)" `touch SKILL_PWNED_2`'
    special_work="$SANDBOX/special-work"
    special_skill_name='shell"safe\skill'
    mkdir -p "$special_tools_dir" "$special_skill_dir" "$special_work"
    cp -R "$SCRIPT_DIR"/. "$special_tools_dir"/
    special_trace="$special_tools_dir/bin/skill-trace.sh"
    special_file="$special_skill_dir/SKILL.md"
    cat > "$special_file" << EOF
---
name: '$special_skill_name'
description: Use when testing shell-safe trace paths.
---
# shell-safe-skill
EOF
    special_command="$SANDBOX/special-canary.sh"
    HOME="$SANDBOX" bash "$special_trace" --inject "$special_file" >/dev/null 2>&1
    awk '
        /^<!-- SKILL-DEBUG-TRACE-START v1 -->[[:space:]]*$/ { in_trace=1; next }
        in_trace && /^```bash[[:space:]]*$/ { in_code=1; next }
        in_trace && in_code && /^```[[:space:]]*$/ { exit }
        in_trace && in_code { print }
    ' "$special_file" > "$special_command"
    (cd "$special_work" && HOME="$SANDBOX" bash "$special_command") >/dev/null 2>&1
    special_rc=$?
    assert_eq "Special-character canary path executes" "0" "$special_rc"
    assert_eq "Helper path does not execute substitutions" "no" "$([ -e "$special_work/HELPER_PWNED" ] || [ -e "$special_work/HELPER_PWNED_2" ] && echo yes || echo no)"
    assert_eq "Skill path does not execute substitutions" "no" "$([ -e "$special_work/SKILL_PWNED" ] || [ -e "$special_work/SKILL_PWNED_2" ] && echo yes || echo no)"
    assert_eq "Special-character path reaches exact skill" "$special_skill_name" "$(tail -n 1 "$SANDBOX/.agents/debug/activation.jsonl" | jq -r '.skill')"

    local degraded_special_work degraded_special_event degraded_special_rc special_helper_backup
    degraded_special_work="$SANDBOX/"$'cwd "quoted" \\slash\nline\bbackspace\fformfeed\vvertical\001unit'
    mkdir -p "$degraded_special_work"
    special_helper_backup="$special_tools_dir/bin/skill-canary.sh.bak"
    mv "$special_tools_dir/bin/skill-canary.sh" "$special_helper_backup"
    (cd "$degraded_special_work" && HOME="$SANDBOX" bash "$special_command") >/dev/null 2>&1
    degraded_special_rc=$?
    mv "$special_helper_backup" "$special_tools_dir/bin/skill-canary.sh"
    degraded_special_event=$(tail -n 1 "$SANDBOX/.agents/debug/activation.jsonl")
    assert_eq "Degraded special-character event exits 0" "0" "$degraded_special_rc"
    assert_eq "Degraded special-character event is valid JSON" "true" "$(echo "$degraded_special_event" | jq -e . >/dev/null 2>&1 && echo true || echo false)"
    assert_eq "Degraded event preserves special skill name" "$special_skill_name" "$(echo "$degraded_special_event" | jq -r '.skill' 2>/dev/null)"
    assert_eq "Degraded event preserves special cwd" "$degraded_special_work" "$(echo "$degraded_special_event" | jq -r '.cwd' 2>/dev/null)"

    echo ""

    # Test 11: Batch operations report partial failure and return non-zero
    echo -e "${BOLD}── Batch Failure Semantics ──${NC}"
    local batch_dir="$SANDBOX/batch"
    mkdir -p "$batch_dir/good" "$batch_dir/bad"
    cp "$clean_file" "$batch_dir/good/SKILL.md"
    cp "$unclosed_file" "$batch_dir/bad/SKILL.md"
    local batch_output batch_rc missing_dir_rc
    batch_output=$(HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip-dir "$batch_dir" 2>&1)
    batch_rc=$?
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject-dir "$SANDBOX/does-not-exist" >/dev/null 2>&1
    missing_dir_rc=$?
    assert_eq "Batch returns non-zero on partial failure" "1" "$batch_rc"
    assert_eq "Batch reports one failed file" "1" "$(echo "$batch_output" | sed -n 's/.*failed=\([0-9][0-9]*\).*/\1/p' | tail -1)"
    assert_eq "Missing batch directory returns usage error" "2" "$missing_dir_rc"

    local fake_bin="$SANDBOX/fake-find-bin"
    mkdir -p "$fake_bin"
    cat > "$fake_bin/find" << 'EOF'
#!/usr/bin/env bash
exit 1
EOF
    chmod +x "$fake_bin/find"
    local discovery_output discovery_rc
    discovery_output=$(HOME="$SANDBOX" PATH="$fake_bin:$PATH" bash "$TRACE_SCRIPT" --inject-dir "$batch_dir" 2>&1)
    discovery_rc=$?
    assert_eq "Batch returns non-zero when discovery fails" "1" "$discovery_rc"
    assert_eq "Batch discovery failure is counted" "1" "$(echo "$discovery_output" | sed -n 's/.*failed=\([0-9][0-9]*\).*/\1/p' | tail -1)"

    echo ""

    # Test 12: File-level symlinks survive atomic inject and strip
    echo -e "${BOLD}── File-Level Symlink Safety ──${NC}"
    local symlink_target_dir="$SANDBOX/symlink-target"
    local symlink_entry_dir="$SANDBOX/symlink-entry"
    mkdir -p "$symlink_target_dir" "$symlink_entry_dir"
    cp "$clean_file" "$symlink_target_dir/SKILL.md"
    chmod 640 "$symlink_target_dir/SKILL.md"
    ln -s ../symlink-target/SKILL.md "$symlink_entry_dir/SKILL.md"
    local symlink_target_before symlink_bytes_before symlink_mode_before symlink_mtime_before
    local symlink_inject_rc symlink_strip_rc symlink_marker_after_inject symlink_marker_after_strip
    symlink_target_before=$(readlink "$symlink_entry_dir/SKILL.md")
    symlink_bytes_before=$(hash_file "$symlink_target_dir/SKILL.md")
    symlink_mode_before=$(file_mode "$symlink_target_dir/SKILL.md")
    symlink_mtime_before=$(file_mtime "$symlink_target_dir/SKILL.md")
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$symlink_entry_dir/SKILL.md" >/dev/null 2>&1
    symlink_inject_rc=$?
    symlink_marker_after_inject=$(grep -c '^<!-- SKILL-DEBUG-TRACE-START v1 -->$' "$symlink_target_dir/SKILL.md" || true)
    assert_eq "Inject through file-level symlink exits 0" "0" "$symlink_inject_rc"
    assert_eq "Inject writes marker to canonical symlink target" "1" "$symlink_marker_after_inject"
    assert_eq "Inject preserves file-level symlink" "yes" "$([ -L "$symlink_entry_dir/SKILL.md" ] && echo yes || echo no)"
    assert_eq "Inject preserves file-level symlink target" "$symlink_target_before" "$(readlink "$symlink_entry_dir/SKILL.md" 2>/dev/null)"
    assert_eq "Inject preserves canonical target mode" "$symlink_mode_before" "$(file_mode "$symlink_target_dir/SKILL.md")"
    assert_eq "Inject preserves canonical target mtime" "$symlink_mtime_before" "$(file_mtime "$symlink_target_dir/SKILL.md")"
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$symlink_entry_dir/SKILL.md" >/dev/null 2>&1
    symlink_strip_rc=$?
    symlink_marker_after_strip=$(grep -c '^<!-- SKILL-DEBUG-TRACE-START v1 -->$' "$symlink_target_dir/SKILL.md" || true)
    assert_eq "Strip through file-level symlink exits 0" "0" "$symlink_strip_rc"
    assert_eq "Strip removes marker from canonical symlink target" "0" "$symlink_marker_after_strip"
    assert_eq "Strip preserves file-level symlink" "yes" "$([ -L "$symlink_entry_dir/SKILL.md" ] && echo yes || echo no)"
    assert_eq "Strip preserves file-level symlink target" "$symlink_target_before" "$(readlink "$symlink_entry_dir/SKILL.md" 2>/dev/null)"
    assert_eq "Symlink round trip restores target bytes" "$symlink_bytes_before" "$(hash_file "$symlink_target_dir/SKILL.md")"
    assert_eq "Symlink round trip preserves target mode" "$symlink_mode_before" "$(file_mode "$symlink_target_dir/SKILL.md")"
    assert_eq "Symlink round trip preserves target mtime" "$symlink_mtime_before" "$(file_mtime "$symlink_target_dir/SKILL.md")"

    echo ""

    # Test 13: Unknown options fail closed instead of printing successful help
    echo -e "${BOLD}── CLI Contract ──${NC}"
    local unknown_option_rc trailing_status_rc trailing_inject_rc
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --definitely-unknown >/dev/null 2>&1
    unknown_option_rc=$?
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --status --definitely-unknown >/dev/null 2>&1
    trailing_status_rc=$?
    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$clean_file" --definitely-unknown >/dev/null 2>&1
    trailing_inject_rc=$?
    assert_eq "Unknown trace option returns usage error" "2" "$unknown_option_rc"
    assert_eq "Trailing status option returns usage error" "2" "$trailing_status_rc"
    assert_eq "Trailing inject option returns usage error" "2" "$trailing_inject_rc"

    echo ""

    # Test 14: Strip is byte-reversible when the original has no final newline
    echo -e "${BOLD}── EOF Newline Reversibility ──${NC}"
    local eof_root eof_body_file eof_frontmatter_file eof_plain_file eof_original inject_rc strip_rc
    eof_root="$SANDBOX/eof-cases"
    mkdir -p "$eof_root/body" "$eof_root/frontmatter-only" "$eof_root/plain"
    eof_body_file="$eof_root/body/SKILL.md"
    eof_frontmatter_file="$eof_root/frontmatter-only/SKILL.md"
    eof_plain_file="$eof_root/plain/SKILL.md"
    printf '%s' $'---\nname: eof-body\ndescription: Use when testing EOF byte preservation.\n---\n\n# eof-body\nbody-without-newline' > "$eof_body_file"
    printf '%s' $'---\nname: eof-frontmatter-only\ndescription: Use when testing an EOF immediately after frontmatter.\n---' > "$eof_frontmatter_file"
    printf '%s' 'plain-body-without-frontmatter-or-newline' > "$eof_plain_file"
    for eof_original in "$eof_body_file" "$eof_frontmatter_file" "$eof_plain_file"; do
        cp "$eof_original" "$eof_original.original"
        HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$eof_original" >/dev/null 2>&1
        inject_rc=$?
        HOME="$SANDBOX" bash "$TRACE_SCRIPT" --strip "$eof_original" >/dev/null 2>&1
        strip_rc=$?
        assert_eq "No-newline inject succeeds for $(basename "$(dirname "$eof_original")")" "0" "$inject_rc"
        assert_eq "No-newline strip succeeds for $(basename "$(dirname "$eof_original")")" "0" "$strip_rc"
        assert_eq "No-newline round trip is byte-identical for $(basename "$(dirname "$eof_original")")" "0" "$(cmp -s "$eof_original" "$eof_original.original"; echo $?)"
    done

    local manual_trace manual_expected manual_stripped manual_helper_rc
    manual_trace="$eof_root/manual-trace.md"
    manual_expected="$eof_root/manual-expected.md"
    manual_stripped="$eof_root/manual-stripped.md"
    printf '%s' $'prefix\n## Activation Canary Trace (auto-injected by skill-debug)\n<!-- SKILL-DEBUG-TRACE-START v1 -->\ntrace payload\n<!-- SKILL-DEBUG-TRACE-END v1 -->\nsuffix' > "$manual_trace"
    printf '%s' $'prefix\nsuffix' > "$manual_expected"
    bash -c '. "$1"; sr_strip_trace_blocks "$2"' _ "$SCRIPT_DIR/lib/common.sh" "$manual_trace" > "$manual_stripped"
    manual_helper_rc=$?
    assert_eq "Pure strip helper succeeds without EOF newline" "0" "$manual_helper_rc"
    assert_eq "Pure strip helper preserves EOF newline state" "0" "$(cmp -s "$manual_expected" "$manual_stripped"; echo $?)"

    echo ""

    # Test 15: Transform failures never cross the atomic replacement boundary
    echo -e "${BOLD}── Transform Transaction Boundary ──${NC}"
    local failure_file failure_hash failure_mode failure_mtime failure_rc fake_tool_dir real_awk
    create_test_skill "transform-failure"
    failure_file="$SANDBOX/transform-failure/SKILL.md"
    failure_hash=$(hash_file "$failure_file")
    failure_mode=$(file_mode "$failure_file")
    failure_mtime=$(file_mtime "$failure_file")

    fake_tool_dir="$SANDBOX/fake-head"
    mkdir -p "$fake_tool_dir"
    printf '%s\n' '#!/usr/bin/env bash' 'exit 42' > "$fake_tool_dir/head"
    chmod +x "$fake_tool_dir/head"
    HOME="$SANDBOX" PATH="$fake_tool_dir:$PATH" bash "$TRACE_SCRIPT" --inject "$failure_file" >/dev/null 2>&1
    failure_rc=$?
    assert_eq "Inject returns non-zero when head fails" "1" "$failure_rc"
    assert_eq "Head failure preserves target bytes" "$failure_hash" "$(hash_file "$failure_file")"
    assert_eq "Head failure preserves target mode" "$failure_mode" "$(file_mode "$failure_file")"
    assert_eq "Head failure preserves target mtime" "$failure_mtime" "$(file_mtime "$failure_file")"

    fake_tool_dir="$SANDBOX/fake-tail"
    mkdir -p "$fake_tool_dir"
    printf '%s\n' '#!/usr/bin/env bash' 'exit 42' > "$fake_tool_dir/tail"
    chmod +x "$fake_tool_dir/tail"
    HOME="$SANDBOX" PATH="$fake_tool_dir:$PATH" bash "$TRACE_SCRIPT" --inject "$failure_file" >/dev/null 2>&1
    failure_rc=$?
    assert_eq "Inject returns non-zero when tail fails" "1" "$failure_rc"
    assert_eq "Tail failure preserves target bytes" "$failure_hash" "$(hash_file "$failure_file")"
    assert_eq "Tail failure preserves target mode" "$failure_mode" "$(file_mode "$failure_file")"
    assert_eq "Tail failure preserves target mtime" "$failure_mtime" "$(file_mtime "$failure_file")"

    fake_tool_dir="$SANDBOX/fake-od"
    mkdir -p "$fake_tool_dir"
    printf '%s\n' '#!/usr/bin/env bash' 'exit 42' > "$fake_tool_dir/od"
    chmod +x "$fake_tool_dir/od"
    HOME="$SANDBOX" PATH="$fake_tool_dir:$PATH" bash "$TRACE_SCRIPT" --inject "$failure_file" >/dev/null 2>&1
    failure_rc=$?
    assert_eq "Inject returns non-zero when EOF inspection fails" "1" "$failure_rc"
    assert_eq "EOF inspection failure preserves target bytes" "$failure_hash" "$(hash_file "$failure_file")"
    assert_eq "EOF inspection failure preserves target mode" "$failure_mode" "$(file_mode "$failure_file")"
    assert_eq "EOF inspection failure preserves target mtime" "$failure_mtime" "$(file_mtime "$failure_file")"

    fake_tool_dir="$SANDBOX/fake-frontmatter-awk"
    mkdir -p "$fake_tool_dir"
    real_awk=$(command -v awk)
    cat > "$fake_tool_dir/awk" << EOF
#!/usr/bin/env bash
for arg in "\$@"; do
    case "\$arg" in
        *'if(c==2)'*) exit 42 ;;
    esac
done
exec "$real_awk" "\$@"
EOF
    chmod +x "$fake_tool_dir/awk"
    HOME="$SANDBOX" PATH="$fake_tool_dir:$PATH" bash "$TRACE_SCRIPT" --inject "$failure_file" >/dev/null 2>&1
    failure_rc=$?
    assert_eq "Inject returns non-zero when frontmatter locator fails" "1" "$failure_rc"
    assert_eq "Frontmatter locator failure preserves target bytes" "$failure_hash" "$(hash_file "$failure_file")"
    assert_eq "Frontmatter locator failure preserves target mode" "$failure_mode" "$(file_mode "$failure_file")"
    assert_eq "Frontmatter locator failure preserves target mtime" "$failure_mtime" "$(file_mtime "$failure_file")"

    fake_tool_dir="$SANDBOX/fake-touch"
    mkdir -p "$fake_tool_dir"
    printf '%s\n' '#!/usr/bin/env bash' 'exit 42' > "$fake_tool_dir/touch"
    chmod +x "$fake_tool_dir/touch"
    HOME="$SANDBOX" PATH="$fake_tool_dir:$PATH" bash "$TRACE_SCRIPT" --inject "$failure_file" >/dev/null 2>&1
    failure_rc=$?
    assert_eq "Inject returns non-zero when metadata restore fails" "1" "$failure_rc"
    assert_eq "Metadata restore failure preserves target bytes" "$failure_hash" "$(hash_file "$failure_file")"
    assert_eq "Metadata restore failure preserves target mode" "$failure_mode" "$(file_mode "$failure_file")"
    assert_eq "Metadata restore failure preserves target mtime" "$failure_mtime" "$(file_mtime "$failure_file")"

    HOME="$SANDBOX" bash "$TRACE_SCRIPT" --inject "$failure_file" >/dev/null 2>&1
    failure_hash=$(hash_file "$failure_file")
    failure_mode=$(file_mode "$failure_file")
    failure_mtime=$(file_mtime "$failure_file")
    fake_tool_dir="$SANDBOX/fake-awk"
    mkdir -p "$fake_tool_dir"
    real_awk=$(command -v awk)
    cat > "$fake_tool_dir/awk" << EOF
#!/usr/bin/env bash
for arg in "\$@"; do
    case "\$arg" in
        *pending_header_text*) exit 42 ;;
    esac
done
exec "$real_awk" "\$@"
EOF
    chmod +x "$fake_tool_dir/awk"
    HOME="$SANDBOX" PATH="$fake_tool_dir:$PATH" bash "$TRACE_SCRIPT" --strip "$failure_file" >/dev/null 2>&1
    failure_rc=$?
    assert_eq "Strip returns non-zero when transform fails" "1" "$failure_rc"
    assert_eq "Strip transform failure preserves target bytes" "$failure_hash" "$(hash_file "$failure_file")"
    assert_eq "Strip transform failure preserves target mode" "$failure_mode" "$(file_mode "$failure_file")"
    assert_eq "Strip transform failure preserves target mtime" "$failure_mtime" "$(file_mtime "$failure_file")"

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
