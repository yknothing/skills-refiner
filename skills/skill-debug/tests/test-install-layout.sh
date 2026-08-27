#!/usr/bin/env bash
# test-install-layout.sh — smoke tests for the per-skill installed layout.
#
# This test copies only directories that contain SKILL.md into a sandboxed
# ~/.agents/skills tree. It intentionally does not copy the repository root or
# loose files under skills/, because npx skills add installs per-skill
# directories rather than the checkout layout.
#
# Usage: bash test-install-layout.sh

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NODE24_BIN="${NODE24_BIN:-/tmp/skills-refiner-node24/bin/node}"

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
    if echo "$haystack" | grep -Fq -- "$needle"; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — '$needle' not found in output"
        FAIL=$((FAIL + 1))
    fi
}

assert_not_contains() {
    local label="$1" haystack="$2" needle="$3"
    if echo "$haystack" | grep -Fq -- "$needle"; then
        echo -e "  ${RED}✗${NC} $label — unexpected '$needle' found in output"
        FAIL=$((FAIL + 1))
    else
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    fi
}

assert_json() {
    local label="$1" json="$2"
    if echo "$json" | jq -e -s 'length == 1 and (.[0] | type == "object")' >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — output is not valid JSON"
        echo "$json"
        FAIL=$((FAIL + 1))
    fi
}

assert_jq() {
    local label="$1" json="$2"
    shift 2
    if echo "$json" | jq -e "$@" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — jq assertion failed: $*"
        FAIL=$((FAIL + 1))
    fi
}

safe_delete_tree() {
    local target="$1" tmp_root="${TMPDIR:-/tmp}"
    tmp_root="${tmp_root%/}"

    if [ -z "$target" ] || [ ! -d "$target" ]; then
        return 0
    fi

    case "$target" in
        "$tmp_root"/*|/tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
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

file_mode() {
    stat -c "%a" "$1" 2>/dev/null || stat -f "%Lp" "$1" 2>/dev/null
}

file_mtime() {
    stat -c "%Y" "$1" 2>/dev/null || stat -f "%m" "$1" 2>/dev/null
}

file_inode() {
    stat -c "%i" "$1" 2>/dev/null || stat -f "%i" "$1" 2>/dev/null
}

block_line_count() {
    local file="$1"
    awk '
        /^## Activation Canary Trace \(auto-injected by skill-debug\)[[:space:]]*$/ { in_block=1 }
        in_block { count++ }
        in_block && /^<!-- SKILL-DEBUG-TRACE-END v1 -->[[:space:]]*$/ { print count; exit }
    ' "$file"
}

extract_canary_command() {
    local skill_file="$1" output_file="$2"
    awk '
        /^<!-- SKILL-DEBUG-TRACE-START v1 -->[[:space:]]*$/ { in_trace=1; next }
        in_trace && /^```bash[[:space:]]*$/ { in_code=1; next }
        in_trace && in_code && /^```[[:space:]]*$/ { exit }
        in_trace && in_code { print }
    ' "$skill_file" > "$output_file"
}

copy_skill_dirs_to_install_layout() {
    mkdir -p "$SANDBOX/.agents/skills"
    for skill_dir in "$REPO_ROOT"/skills/*; do
        [ -d "$skill_dir" ] || continue
        [ -f "$skill_dir/SKILL.md" ] || continue
        cp -R "$skill_dir" "$SANDBOX/.agents/skills/"
    done
}

create_demo_skill() {
    local name="$1"
    local dir="$SANDBOX/.agents/skills/$name"
    mkdir -p "$dir"
    cat > "$dir/SKILL.md" << EOF
---
name: $name
description: Test installed-layout smoke skill.
---

# $name

Do the smoke-test action.
EOF
}

make_no_jq_path() {
    local bin_dir="$1"
    mkdir -p "$bin_dir"

    local tool path
    for tool in dirname basename awk date mkdir head touch chmod uname stat; do
        path=$(command -v "$tool" 2>/dev/null || true)
        [ -n "$path" ] || { echo "[ERROR] Required tool not found: $tool" >&2; return 1; }
        ln -s "$path" "$bin_dir/$tool"
    done

    if path=$(command -v sha256sum 2>/dev/null); then
        ln -s "$path" "$bin_dir/sha256sum"
    elif path=$(command -v shasum 2>/dev/null); then
        ln -s "$path" "$bin_dir/shasum"
    else
        echo "[ERROR] Neither sha256sum nor shasum found" >&2
        return 1
    fi
}

run_tests() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║  Installed Layout Smoke Test Suite       ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""

    SANDBOX=$(mktemp -d)
    SANDBOX=$(cd "$SANDBOX" && pwd -P)
    trap cleanup_sandbox EXIT

    local tools_root scan_script probe_script dash_script trace_script doctor_script canary_script
    tools_root="$SANDBOX/.agents/skills"

    echo -e "${BOLD}── T1 Install Layout ──${NC}"
    copy_skill_dirs_to_install_layout
    scan_script="$tools_root/skill-hygiene/bin/skill-scan.sh"
    probe_script="$tools_root/skill-debug/bin/skill-probe.sh"
    dash_script="$tools_root/skill-debug/bin/skill-dashboard.sh"
    trace_script="$tools_root/skill-debug/bin/skill-trace.sh"
    doctor_script="$tools_root/skill-debug/bin/skills-refiner-doctor.sh"
    canary_script="$tools_root/skill-debug/bin/skill-canary.sh"

    assert_eq "Shared helper ships inside skill-debug" "yes" "$([ -f "$tools_root/skill-debug/lib/common.sh" ] && echo yes || echo no)"
    assert_eq "Shared helper ships inside skill-hygiene" "yes" "$([ -f "$tools_root/skill-hygiene/lib/common.sh" ] && echo yes || echo no)"
    assert_eq "Per-skill helper mirrors stay byte-identical" "yes" "$(cmp -s "$tools_root/skill-debug/lib/common.sh" "$tools_root/skill-hygiene/lib/common.sh" && echo yes || echo no)"
    assert_eq "No loose skills/lib is present" "no" "$([ -d "$tools_root/lib" ] && echo yes || echo no)"
    assert_eq "Five repo skills installed" "5" "$(find "$tools_root" -mindepth 2 -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')"
    echo ""

    echo -e "${BOLD}── T2 Script Runtime ──${NC}"
    local work_dir stderr_file all_stderr
    local scan_json probe_json dash_no_log_json doctor_json trace_status
    local scan_rc probe_rc dash_no_log_rc doctor_rc trace_rc
    work_dir="$SANDBOX/work"
    mkdir -p "$work_dir"
    stderr_file="$SANDBOX/stderr.log"
    : > "$stderr_file"

    scan_json=$(cd "$work_dir" && HOME="$SANDBOX" bash "$scan_script" --json 2>>"$stderr_file"); scan_rc=$?
    probe_json=$(cd "$work_dir" && HOME="$SANDBOX" bash "$probe_script" --json 2>>"$stderr_file"); probe_rc=$?
    dash_no_log_json=$(cd "$work_dir" && HOME="$SANDBOX" bash "$dash_script" --json 2>>"$stderr_file"); dash_no_log_rc=$?
    trace_status=$(cd "$work_dir" && HOME="$SANDBOX" bash "$trace_script" --status 2>>"$stderr_file"); trace_rc=$?
    doctor_json=$(cd "$work_dir" && HOME="$SANDBOX" bash "$doctor_script" --json 2>>"$stderr_file"); doctor_rc=$?
    all_stderr=$(cat "$stderr_file")

    assert_eq "scan exits 0" "0" "$scan_rc"
    assert_eq "probe exits 0" "0" "$probe_rc"
    local dash_no_log_status_ok
    if [ "$dash_no_log_rc" -eq 0 ] || [ "$dash_no_log_rc" -eq 1 ]; then
        dash_no_log_status_ok="yes"
    else
        dash_no_log_status_ok="no"
    fi
    assert_eq "dashboard no-log exits 0 or 1" "yes" "$dash_no_log_status_ok"
    assert_eq "trace status exits 0" "0" "$trace_rc"
    assert_eq "doctor exits 0" "0" "$doctor_rc"
    assert_not_contains "No script reports missing shared helper" "$all_stderr" "Missing shared helper"
    assert_json "scan JSON is valid" "$scan_json"
    assert_json "probe JSON is valid" "$probe_json"
    assert_json "dashboard no-log JSON is valid" "$dash_no_log_json"
    assert_json "doctor JSON is valid" "$doctor_json"
    assert_contains "trace status prints installed status" "$trace_status" "Skill Trace Status"
    assert_jq "doctor probe step ok" "$doctor_json" '.steps.probe.status == "ok"'
    assert_jq "doctor hygiene step ok" "$doctor_json" '.steps.hygiene.status == "ok"'
    assert_jq "doctor dashboard step is ok or no_data" "$doctor_json" '.steps.dashboard.status == "ok" or .steps.dashboard.status == "no_data"'
    echo ""

    echo -e "${BOLD}── T3 Schema Contract ──${NC}"
    assert_jq "scan schema is v5" "$scan_json" '.metadata.schema_version == "skill-scan.v5" and .metadata.runtime_validation_mode == "static-preflight"'
    assert_jq "scan declares hash normalization" "$scan_json" '.metadata.hash_normalization == "strip-canary-crlf-bom.v1"'
    assert_jq "probe schema is v3" "$probe_json" '.schema_version == "skill-probe.v3"'
    assert_jq "scan has no content_sha256 key" "$scan_json" '[.. | objects | select(has("content_sha256"))] | length == 0'
    assert_jq "probe has no content_sha256 key" "$probe_json" '[.. | objects | select(has("content_sha256"))] | length == 0'
    assert_jq "scan normalized hashes are sha256-shaped" "$scan_json" 'all(.skills[]; (.normalized_content_sha256 | test("^[0-9a-f]{64}$")))'
    echo ""

    echo -e "${BOLD}── T4 Canary Round Trip ──${NC}"
    create_demo_skill "demo"
    local demo_file demo_original demo_command demo_json demo_json_after_strip
    local demo_mode_before demo_mode_after demo_mtime_before demo_mtime_after
    local block_lines helper_refs log_lines demo_identity
    demo_file="$tools_root/demo/SKILL.md"
    demo_original="$SANDBOX/demo.original"
    demo_command="$SANDBOX/demo-canary.sh"
    cp "$demo_file" "$demo_original"
    demo_mode_before=$(file_mode "$demo_file")
    demo_mtime_before=$(file_mtime "$demo_file")

    HOME="$SANDBOX" bash "$trace_script" --inject "$demo_file" >/dev/null 2>&1
    block_lines=$(block_line_count "$demo_file")
    helper_refs=$(grep -Fc "$canary_script" "$demo_file" || true)
    extract_canary_command "$demo_file" "$demo_command"
    (cd "$work_dir" && HOME="$SANDBOX" bash "$demo_command")
    log_lines=$(wc -l < "$SANDBOX/.agents/debug/activation.jsonl" | tr -d ' ')
    demo_identity=$(tail -n 1 "$SANDBOX/.agents/debug/activation.jsonl" | jq -r '.identity_key')
    demo_json=$(HOME="$SANDBOX" bash "$dash_script" --json --all)

    HOME="$SANDBOX" bash "$trace_script" --strip "$demo_file" >/dev/null 2>&1
    demo_mode_after=$(file_mode "$demo_file")
    demo_mtime_after=$(file_mtime "$demo_file")
    demo_json_after_strip=$(HOME="$SANDBOX" bash "$dash_script" --json --all)

    assert_jq "canary event schema remains v1" "$(tail -n 1 "$SANDBOX/.agents/debug/activation.jsonl")" '.trace_schema == "skill-debug.identity.v1"'
    assert_jq "canary event has identity" "$(tail -n 1 "$SANDBOX/.agents/debug/activation.jsonl")" '.trace_kind == "canary" and (.identity_key | length > 0)'
    assert_eq "Trace block stays small" "yes" "$([ "$block_lines" -le 13 ] && echo yes || echo no)"
    assert_eq "Trace block embeds installed helper absolute path" "1" "$helper_refs"
    assert_eq "Canary command appends one event" "1" "$log_lines"
    assert_eq "Canary debug directory is private" "700" "$(file_mode "$SANDBOX/.agents/debug")"
    assert_eq "Canary activation log is private" "600" "$(file_mode "$SANDBOX/.agents/debug/activation.jsonl")"
    assert_jq "dashboard schema is identity v2" "$demo_json" '.schema_version == "skill-dashboard.identity.v2"'
    assert_jq "dashboard has no content_sha256 key" "$demo_json" '[.. | objects | select(has("content_sha256"))] | length == 0'
    assert_jq "dashboard marks demo observed" "$demo_json" 'any(.installed_identities[]; .name == "demo" and .observed == true)'
    assert_eq "Strip restores original bytes" "0" "$(cmp -s "$demo_file" "$demo_original"; echo $?)"
    assert_eq "Strip preserves file mode" "$demo_mode_before" "$demo_mode_after"
    assert_eq "Strip preserves file mtime" "$demo_mtime_before" "$demo_mtime_after"
    assert_jq "strip does not orphan canary event" "$demo_json_after_strip" 'any(.installed_identities[]; .name == "demo" and .observed == true)'
    echo ""

    echo -e "${BOLD}── T5 Missing Helper Degraded Path ──${NC}"
    create_demo_skill "degraded"
    local degraded_file degraded_command helper_backup degraded_rc degraded_event degraded_json degraded_observed
    degraded_file="$tools_root/degraded/SKILL.md"
    degraded_command="$SANDBOX/degraded-canary.sh"
    HOME="$SANDBOX" bash "$trace_script" --inject "$degraded_file" >/dev/null 2>&1
    extract_canary_command "$degraded_file" "$degraded_command"
    helper_backup="$canary_script.bak"
    mv "$canary_script" "$helper_backup"
    (cd "$work_dir" && HOME="$SANDBOX" bash "$degraded_command"); degraded_rc=$?
    mv "$helper_backup" "$canary_script"
    degraded_event=$(tail -n 1 "$SANDBOX/.agents/debug/activation.jsonl")
    degraded_json=$(HOME="$SANDBOX" bash "$dash_script" --json --all)
    degraded_observed=$(echo "$degraded_json" | jq 'any(.installed_identities[]; .name == "degraded" and .observed == true)')

    assert_eq "Degraded command exits 0" "0" "$degraded_rc"
    assert_jq "Degraded event is valid legacy canary" "$degraded_event" '.trace_kind == "canary_degraded" and .identity_key == ""'
    assert_eq "Dashboard handles degraded event by unique name" "true" "$degraded_observed"
    assert_eq "Degraded path keeps debug directory private" "700" "$(file_mode "$SANDBOX/.agents/debug")"
    assert_eq "Degraded path keeps activation log private" "600" "$(file_mode "$SANDBOX/.agents/debug/activation.jsonl")"
    echo ""

    echo -e "${BOLD}── T6 Canary Without jq ──${NC}"
    local no_jq_bin no_jq_event no_jq_identity no_jq_rc no_jq_stderr bash_bin no_jq_status_rc
    no_jq_bin="$SANDBOX/no-jq-bin"
    no_jq_stderr="$SANDBOX/no-jq.stderr"
    make_no_jq_path "$no_jq_bin"
    bash_bin="${BASH:-$(command -v bash)}"
    (cd "$work_dir" && HOME="$SANDBOX" PATH="$no_jq_bin" "$bash_bin" "$canary_script" "$demo_file") 2>"$no_jq_stderr"; no_jq_rc=$?
    no_jq_event=$(tail -n 1 "$SANDBOX/.agents/debug/activation.jsonl")
    no_jq_identity=$(echo "$no_jq_event" | jq -r '.identity_key')
    assert_eq "No-jq canary exits 0" "0" "$no_jq_rc"
    assert_eq "No-jq canary emits no stderr" "" "$(cat "$no_jq_stderr")"
    assert_json "No-jq canary emits valid JSON" "$no_jq_event"
    assert_eq "No-jq identity matches jq identity" "$demo_identity" "$no_jq_identity"

    local special_json_dir special_json_file special_json_name special_json_cwd special_json_event special_json_rc
    special_json_dir="$tools_root/special-json"
    special_json_file="$special_json_dir/SKILL.md"
    special_json_name=$'json"safe\\skill\bbackspace\fformfeed\vvertical\001unit'
    special_json_cwd="$SANDBOX/"$'cwd "quoted" \\slash\nline\bbackspace\fformfeed\vvertical\001unit'
    mkdir -p "$special_json_dir" "$special_json_cwd"
    cat > "$special_json_file" << EOF
---
name: '$special_json_name'
description: Use when testing JSON escaping without jq.
---
# special-json
EOF
    (cd "$special_json_cwd" && HOME="$SANDBOX" PATH="$no_jq_bin" "$bash_bin" "$canary_script" "$special_json_file") 2>>"$no_jq_stderr"
    special_json_rc=$?
    special_json_event=$(tail -n 1 "$SANDBOX/.agents/debug/activation.jsonl")
    assert_eq "Special no-jq canary exits 0" "0" "$special_json_rc"
    assert_json "Special no-jq canary emits valid JSON" "$special_json_event"
    assert_eq "Special no-jq canary preserves skill name" "$special_json_name" "$(echo "$special_json_event" | jq -r '.skill')"
    assert_eq "Special no-jq canary preserves cwd" "$special_json_cwd" "$(echo "$special_json_event" | jq -r '.cwd')"
    (cd "$work_dir" && HOME="$SANDBOX" PATH="$no_jq_bin" "$bash_bin" "$trace_script" --status) >/dev/null 2>"$SANDBOX/no-jq-status.stderr"
    no_jq_status_rc=$?
    assert_eq "Trace status fails explicitly without jq when a log exists" "127" "$no_jq_status_rc"
    assert_contains "Trace status explains its jq dependency" "$(cat "$SANDBOX/no-jq-status.stderr")" "jq is required"
    echo ""

    echo -e "${BOLD}── T7 Selective Install Contract ──${NC}"
    local selective_root selective_work hygiene_home debug_home refiner_home appreciation_home panorama_home
    local hygiene_only_json hygiene_only_stderr hygiene_only_rc
    local hygiene_launcher hygiene_help_json hygiene_help_text hygiene_help_rc hygiene_review_json hygiene_review_rc
    local debug_probe_json debug_probe_rc debug_dash_json debug_dash_rc debug_trace_status debug_trace_rc
    local debug_doctor_json debug_doctor_rc debug_doctor_stderr
    local debug_doctor_text debug_doctor_text_rc debug_doctor_raw debug_doctor_raw_rc
    selective_root="$SANDBOX/selective"
    selective_work="$selective_root/work"
    hygiene_home="$selective_root/hygiene"
    debug_home="$selective_root/debug"
    refiner_home="$selective_root/refiner"
    appreciation_home="$selective_root/appreciation"
    panorama_home="$selective_root/panorama"
    mkdir -p "$selective_work" "$hygiene_home/.agents/skills" "$debug_home/.agents/skills" "$refiner_home/.agents/skills" "$appreciation_home/.agents/skills" "$panorama_home/.agents/skills"
    cp -R "$REPO_ROOT/skills/skill-hygiene" "$hygiene_home/.agents/skills/"
    cp -R "$REPO_ROOT/skills/skill-debug" "$debug_home/.agents/skills/"
    cp -R "$REPO_ROOT/skills/skills-refiner" "$refiner_home/.agents/skills/"
    cp -R "$REPO_ROOT/skills/skills-appreciation" "$appreciation_home/.agents/skills/"
    cp -R "$REPO_ROOT/skills/skills-panorama" "$panorama_home/.agents/skills/"

    hygiene_launcher="$hygiene_home/.agents/skills/skill-hygiene/bin/skills-refiner"
    assert_eq "skill-hygiene selective install ships CLI launcher" "yes" \
        "$([ -f "$hygiene_launcher" ] && [ -x "$hygiene_launcher" ] && echo yes || echo no)"
    assert_eq "skill-hygiene selective install ships native helper source" "yes" \
        "$([ -f "$hygiene_home/.agents/skills/skill-hygiene/native/cleanup-macos-helper.c" ] && echo yes || echo no)"
    assert_eq "skill-hygiene selective install ships exactly five cleanup modules" \
        $'cleanup-cli.mjs\ncleanup-contract.mjs\ncleanup-core.mjs\ncleanup-macos.mjs\ncleanup-transaction.mjs' \
        "$(find "$hygiene_home/.agents/skills/skill-hygiene/lib" -maxdepth 1 -type f -name 'cleanup-*.mjs' -exec basename {} \; | LC_ALL=C sort)"

    if [ ! -x "$NODE24_BIN" ]; then
        echo "[ERROR] Node 24 test runtime missing: $NODE24_BIN" >&2
        return 1
    fi
    assert_eq "selective installed-layout runtime is Node 24" "24" \
        "$("$NODE24_BIN" -p 'process.versions.node.split(".")[0]')"
    hygiene_help_json=$(cd "$selective_work" && HOME="$hygiene_home" \
        SKILLS_REFINER_TOOLS_ROOT="" SKILLS_REFINER_NODE_BIN="$NODE24_BIN" \
        "$hygiene_launcher" --help --json 2>"$selective_root/hygiene-help.stderr")
    hygiene_help_rc=$?
    assert_eq "selective launcher help runs outside checkout" "0" "$hygiene_help_rc"
    assert_json "selective launcher help emits one JSON object" "$hygiene_help_json"
    assert_jq "selective launcher help schema is exact" "$hygiene_help_json" \
        '.schema_version == "skills-refiner.cleanup.help.v1" and .overall_status == "ok"'
    hygiene_help_text=$(cd "$selective_work" && HOME="$hygiene_home" \
        SKILLS_REFINER_TOOLS_ROOT="" SKILLS_REFINER_NODE_BIN="$NODE24_BIN" \
        "$hygiene_launcher" --help 2>"$selective_root/hygiene-help-text.stderr")
    hygiene_help_rc=$?
    assert_eq "selective human help runs outside checkout" "0" "$hygiene_help_rc"
    for command_help in \
        'skills-refiner setup-cli' \
        'skills-refiner cleanup review' \
        'skills-refiner cleanup plan' \
        'skills-refiner cleanup apply' \
        'skills-refiner cleanup status' \
        'skills-refiner cleanup undo'; do
        assert_contains "selective human help exposes $command_help" \
            "$hygiene_help_text" "$command_help"
    done

    hygiene_review_json=$(cd "$selective_work" && HOME="$hygiene_home" \
        SKILLS_REFINER_TOOLS_ROOT="" SKILLS_REFINER_NODE_BIN="$NODE24_BIN" \
        "$hygiene_launcher" cleanup review --json 2>"$selective_root/hygiene-review.stderr")
    hygiene_review_rc=$?
    assert_eq "selective cleanup review runs outside checkout" "0" "$hygiene_review_rc"
    assert_json "selective cleanup review emits one JSON object" "$hygiene_review_json"
    assert_jq "selective cleanup review schema is exact" "$hygiene_review_json" \
        '.schema_version == "skills-refiner.cleanup.review.v1"'
    assert_eq "selective cleanup review creates no transaction" "false" \
        "$([ -e "$hygiene_home/.agents/skills-refiner/cleanup/transactions" ] && echo true || echo false)"

    hygiene_only_stderr="$selective_root/hygiene.stderr"
    hygiene_only_json=$(cd "$selective_work" && HOME="$hygiene_home" SKILLS_REFINER_TOOLS_ROOT="" bash "$hygiene_home/.agents/skills/skill-hygiene/bin/skill-scan.sh" --json 2>"$hygiene_only_stderr")
    hygiene_only_rc=$?
    assert_eq "skill-hygiene runs when installed alone" "0" "$hygiene_only_rc"
    assert_json "skill-hygiene standalone output is valid JSON" "$hygiene_only_json"
    assert_not_contains "skill-hygiene standalone has no sibling-helper failure" "$(cat "$hygiene_only_stderr")" "Missing shared helper"

    debug_probe_json=$(cd "$selective_work" && HOME="$debug_home" SKILLS_REFINER_TOOLS_ROOT="" bash "$debug_home/.agents/skills/skill-debug/bin/skill-probe.sh" --json --cwd "$selective_work" 2>/dev/null); debug_probe_rc=$?
    debug_dash_json=$(cd "$selective_work" && HOME="$debug_home" SKILLS_REFINER_TOOLS_ROOT="" bash "$debug_home/.agents/skills/skill-debug/bin/skill-dashboard.sh" --json 2>/dev/null); debug_dash_rc=$?
    debug_trace_status=$(cd "$selective_work" && HOME="$debug_home" SKILLS_REFINER_TOOLS_ROOT="" bash "$debug_home/.agents/skills/skill-debug/bin/skill-trace.sh" --status 2>/dev/null); debug_trace_rc=$?
    debug_doctor_stderr="$selective_root/debug-doctor.stderr"
    debug_doctor_json=$(cd "$selective_work" && HOME="$debug_home" SKILLS_REFINER_TOOLS_ROOT="" bash "$debug_home/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh" --json --cwd "$selective_work" 2>"$debug_doctor_stderr"); debug_doctor_rc=$?
    debug_doctor_text=$(cd "$selective_work" && HOME="$debug_home" SKILLS_REFINER_TOOLS_ROOT="" bash "$debug_home/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh" --cwd "$selective_work" 2>/dev/null); debug_doctor_text_rc=$?
    debug_doctor_raw=$(cd "$selective_work" && HOME="$debug_home" SKILLS_REFINER_TOOLS_ROOT="" bash "$debug_home/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh" --raw --cwd "$selective_work" 2>/dev/null); debug_doctor_raw_rc=$?
    assert_eq "skill-debug probe runs when installed alone" "0" "$debug_probe_rc"
    assert_json "skill-debug standalone probe output is valid JSON" "$debug_probe_json"
    assert_eq "skill-debug dashboard keeps no-data protocol when installed alone" "1" "$debug_dash_rc"
    assert_json "skill-debug standalone dashboard output is valid JSON" "$debug_dash_json"
    assert_eq "skill-debug trace status runs when installed alone" "0" "$debug_trace_rc"
    assert_contains "skill-debug standalone trace prints status" "$debug_trace_status" "Skill Trace Status"
    assert_eq "skill-debug standalone doctor reports partial result" "1" "$debug_doctor_rc"
    assert_json "skill-debug standalone doctor output is valid JSON" "$debug_doctor_json"
    assert_jq "skill-debug standalone doctor uses v2 schema" "$debug_doctor_json" '.schema == "skills-refiner.doctor.v2"'
    assert_jq "skill-debug standalone doctor marks hygiene unavailable" "$debug_doctor_json" '.steps.hygiene.status == "unavailable" and .hygiene.error == "skill_unavailable" and .hygiene.required_skill == "skill-hygiene"'
    assert_jq "skill-debug standalone doctor preserves available steps" "$debug_doctor_json" '.steps.probe.status == "ok" and .steps.dashboard.status == "no_data"'
    assert_eq "skill-debug standalone doctor reports isolated cwd" "$selective_work" "$(echo "$debug_doctor_json" | jq -r '.cwd')"
    assert_eq "skill-debug standalone doctor reports isolated tools root" "$debug_home/.agents/skills" "$(echo "$debug_doctor_json" | jq -r '.tools_root')"
    assert_not_contains "skill-debug standalone doctor does not fall back to checkout" "$debug_doctor_json" "$REPO_ROOT"
    assert_eq "skill-debug standalone text doctor reports partial result" "1" "$debug_doctor_text_rc"
    assert_contains "skill-debug standalone text marks hygiene unavailable" "$debug_doctor_text" "hygiene: unavailable"
    assert_not_contains "skill-debug standalone text does not print false hygiene zeroes" "$debug_doctor_text" "hygiene: 0 canonical skills"
    assert_eq "skill-debug standalone raw doctor reports partial result" "1" "$debug_doctor_raw_rc"
    assert_contains "skill-debug standalone raw explains omitted hygiene report" "$debug_doctor_raw" "[UNAVAILABLE] skill-hygiene is not installed"

    assert_eq "skills-refiner standalone reference is packaged" "yes" "$([ -f "$refiner_home/.agents/skills/skills-refiner/references/skill-creator-collaboration.md" ] && echo yes || echo no)"
    assert_eq "skills-appreciation standalone reference is packaged" "yes" "$([ -f "$appreciation_home/.agents/skills/skills-appreciation/references/editorial-checklist.md" ] && echo yes || echo no)"
    assert_eq "skills-panorama standalone launcher is packaged" "yes" "$([ -x "$panorama_home/.agents/skills/skills-panorama/bin/skill-panorama.sh" ] && echo yes || echo no)"
    assert_contains "README documents official selective install flag" "$(cat "$REPO_ROOT/README.md")" "--skill skill-debug --skill skill-hygiene -g"
    echo ""

    echo -e "${BOLD}── T8 Canary Log Symlink Boundary ──${NC}"
    local symlink_log_root symlink_debug_home symlink_log_home symlink_agents_home symlink_target_dir symlink_target_log symlink_target_agents
    local mode_check_home fake_chmod_bin mode_check_log
    local target_dir_mode target_log_mode canary_symlink_rc degraded_symlink_rc helper_symlink_backup mode_check_rc degraded_mode_check_rc
    symlink_log_root="$SANDBOX/log-symlink-cases"
    symlink_debug_home="$symlink_log_root/debug-dir-home"
    symlink_log_home="$symlink_log_root/log-file-home"
    symlink_agents_home="$symlink_log_root/agents-dir-home"
    symlink_target_dir="$symlink_log_root/debug-target"
    symlink_target_log="$symlink_log_root/activation-target.jsonl"
    symlink_target_agents="$symlink_log_root/agents-target"
    mkdir -p "$symlink_debug_home/.agents" "$symlink_log_home/.agents/debug" "$symlink_agents_home" "$symlink_target_dir" "$symlink_target_agents"
    chmod 750 "$symlink_target_dir"
    target_dir_mode=$(file_mode "$symlink_target_dir")
    ln -s "$symlink_target_dir" "$symlink_debug_home/.agents/debug"
    HOME="$symlink_debug_home" bash "$canary_script" "$demo_file" >/dev/null 2>&1
    canary_symlink_rc=$?
    assert_eq "Canary rejects symlink debug directory" "1" "$canary_symlink_rc"
    assert_eq "Canary does not chmod symlink directory target" "$target_dir_mode" "$(file_mode "$symlink_target_dir")"
    assert_eq "Canary does not append through symlink directory" "no" "$([ -e "$symlink_target_dir/activation.jsonl" ] && echo yes || echo no)"

    printf '%s\n' 'sentinel' > "$symlink_target_log"
    chmod 640 "$symlink_target_log"
    target_log_mode=$(file_mode "$symlink_target_log")
    ln -s "$symlink_target_log" "$symlink_log_home/.agents/debug/activation.jsonl"
    HOME="$symlink_log_home" bash "$canary_script" "$demo_file" >/dev/null 2>&1
    canary_symlink_rc=$?
    assert_eq "Canary rejects symlink activation log" "1" "$canary_symlink_rc"
    assert_eq "Canary does not chmod symlink log target" "$target_log_mode" "$(file_mode "$symlink_target_log")"
    assert_eq "Canary does not append through symlink log" "sentinel" "$(cat "$symlink_target_log")"

    ln -s "$symlink_target_agents" "$symlink_agents_home/.agents"
    HOME="$symlink_agents_home" bash "$canary_script" "$demo_file" >/dev/null 2>&1
    canary_symlink_rc=$?
    assert_eq "Canary rejects a symlinked .agents ancestor" "1" "$canary_symlink_rc"
    assert_eq "Canary does not create a log through a symlinked ancestor" "no" "$([ -e "$symlink_target_agents/debug/activation.jsonl" ] && echo yes || echo no)"

    helper_symlink_backup="$canary_script.symlink-test.bak"
    mv "$canary_script" "$helper_symlink_backup"
    (cd "$work_dir" && HOME="$symlink_debug_home" bash "$degraded_command") >/dev/null 2>&1
    degraded_symlink_rc=$?
    mv "$helper_symlink_backup" "$canary_script"
    assert_eq "Degraded canary rejects symlink debug directory" "1" "$degraded_symlink_rc"
    assert_eq "Degraded canary does not chmod symlink target" "$target_dir_mode" "$(file_mode "$symlink_target_dir")"
    assert_eq "Degraded canary does not append through symlink directory" "no" "$([ -e "$symlink_target_dir/activation.jsonl" ] && echo yes || echo no)"

    mode_check_home="$symlink_log_root/mode-check-home"
    mode_check_log="$mode_check_home/.agents/debug/activation.jsonl"
    fake_chmod_bin="$symlink_log_root/fake-chmod-bin"
    mkdir -p "$mode_check_home/.agents/debug" "$fake_chmod_bin"
    printf '%s\n' 'sentinel' > "$mode_check_log"
    chmod 755 "$mode_check_home/.agents/debug"
    chmod 644 "$mode_check_log"
    cat > "$fake_chmod_bin/chmod" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$fake_chmod_bin/chmod"
    HOME="$mode_check_home" PATH="$fake_chmod_bin:$PATH" bash "$canary_script" "$demo_file" >/dev/null 2>&1
    mode_check_rc=$?
    assert_eq "Canary rejects chmod success without mode enforcement" "1" "$mode_check_rc"
    assert_eq "Mode verification failure does not append" "sentinel" "$(cat "$mode_check_log")"

    mv "$canary_script" "$helper_symlink_backup"
    (cd "$work_dir" && HOME="$mode_check_home" PATH="$fake_chmod_bin:$PATH" bash "$degraded_command") >/dev/null 2>&1
    degraded_mode_check_rc=$?
    mv "$helper_symlink_backup" "$canary_script"
    assert_eq "Degraded canary verifies effective directory mode" "1" "$degraded_mode_check_rc"
    assert_eq "Degraded mode verification failure does not append" "sentinel" "$(cat "$mode_check_log")"
    echo ""

    if [ "$(uname -s)" = "Darwin" ]; then
        echo -e "${BOLD}── T9 macOS Installed Cleanup Transaction ──${NC}"
        local installed_root installed_home installed_work installed_skill installed_launcher
        local source_repo source_skill source_file source_before source_hash_before source_status_before
        local installed_review installed_decisions installed_plan installed_stdout installed_stderr
        local installed_rc installed_entry installed_plan_hash installed_transaction_id
        local installed_cache installed_cache_hash installed_cache_inode installed_cache_mode
        local installed_helper_source installed_link_target
        installed_root="$SANDBOX/installed-cleanup"
        installed_home="$installed_root/home"
        installed_work="$installed_root/work-outside-checkout"
        installed_skill="$installed_home/.agents/skills/skill-hygiene"
        installed_launcher="$installed_skill/bin/skills-refiner"
        source_repo="$installed_root/source-repo"
        source_skill="$source_repo/distributed-skill"
        source_file="$source_skill/SKILL.md"
        source_before="$installed_root/source-before"
        installed_entry="$installed_home/.claude/skills/distributed-skill"
        installed_review="$installed_root/review.json"
        installed_decisions="$installed_root/decisions.json"
        installed_plan="$installed_root/plan.json"
        installed_stdout="$installed_root/stdout.json"
        installed_stderr="$installed_root/stderr.log"

        mkdir -p "$installed_home/.agents/skills" "$installed_home/.claude/skills" \
            "$installed_work" "$source_skill"
        cp -R "$REPO_ROOT/skills/skill-hygiene" "$installed_home/.agents/skills/"
        cat > "$source_file" <<'EOF'
---
name: distributed-skill
description: Use when testing an installed cleanup transaction.
---

# Distributed skill
EOF
        git -C "$source_repo" init -q \
            || { echo "[ERROR] Failed to initialize source Git fixture" >&2; return 1; }
        git -C "$source_repo" add . \
            || { echo "[ERROR] Failed to stage source Git fixture" >&2; return 1; }
        git -C "$source_repo" -c user.name='Installed Layout Test' \
            -c user.email='installed-layout@example.invalid' commit -qm 'fixture' \
            || { echo "[ERROR] Failed to commit source Git fixture" >&2; return 1; }
        cp "$source_file" "$source_before"
        source_hash_before=$(git -C "$source_repo" hash-object "$source_file")
        source_status_before=$(git -C "$source_repo" status --porcelain=v1 --untracked-files=all)
        assert_eq "installed-copy source Git fixture starts clean" "" "$source_status_before"
        ln -s "$source_skill" "$installed_entry"
        installed_link_target=$(readlink "$installed_entry")

        set +e
        (cd "$installed_work" && HOME="$installed_home" SKILLS_REFINER_TOOLS_ROOT="" \
            SKILLS_REFINER_NODE_BIN="$NODE24_BIN" \
            "$installed_launcher" cleanup review --json) \
            >"$installed_review" 2>"$installed_stderr"
        installed_rc=$?
        set -e
        assert_eq "installed-copy review exits 0" "0" "$installed_rc"
        assert_eq "installed-copy review emits exactly one JSON object" "1" \
            "$(jq -s 'length' "$installed_review")"
        assert_eq "installed-copy review uses exact top-level keys" \
            "candidates,executable_plan,execution_eligible,groups,observed_entry_count,overall_status,product_version,review_fingerprint,scan_fingerprint,scan_schema_version,schema_version,source" \
            "$(jq -r 'keys | sort | join(",")' "$installed_review")"
        assert_jq "installed-copy review finds exact governed entry" "$(cat "$installed_review")" \
            --arg entry "$installed_entry" \
            '.schema_version == "skills-refiner.cleanup.review.v1"
             and .execution_eligible == true
             and ([.candidates[] | select(.entry_path == $entry and .governance_scope == "installed_or_distributed")] | length == 1)'

        jq --arg entry "$installed_entry" \
            '{schema_version:"skills-refiner.cleanup.decisions.v1",
              review_fingerprint:.review_fingerprint,
              decisions:[.candidates[] | {
                candidate_id,
                action:(if .entry_path == $entry then "retire" else "later" end)
              }]}' "$installed_review" > "$installed_decisions"
        set +e
        (cd "$installed_work" && HOME="$installed_home" SKILLS_REFINER_TOOLS_ROOT="" \
            SKILLS_REFINER_NODE_BIN="$NODE24_BIN" \
            "$installed_launcher" cleanup plan --review "$installed_review" \
            --decisions "$installed_decisions" --json) \
            >"$installed_plan" 2>"$installed_stderr"
        installed_rc=$?
        set -e
        assert_eq "installed-copy plan exits 0" "0" "$installed_rc"
        assert_eq "installed-copy plan uses exact top-level keys" \
            "authorization_id,created_at,items,plan_hash,platform,product_version,scan_fingerprint,schema_version" \
            "$(jq -r 'keys | sort | join(",")' "$installed_plan")"
        assert_jq "installed-copy plan contains only exact fixture" "$(cat "$installed_plan")" \
            --arg entry "$installed_entry" \
            '.schema_version == "skills-refiner.cleanup.plan.v1"
             and (.items | length) == 1
             and .items[0].entry_path == $entry
             and .items[0].execution_identity.adapter == "macos-native.v1"'
        installed_plan_hash=$(jq -r '.plan_hash' "$installed_plan")
        installed_transaction_id=$(jq -r '.items[0].transaction_id' "$installed_plan")
        installed_cache=$(jq -r '.items[0].execution_identity.cache_path' "$installed_plan")
        installed_cache_hash=$(jq -r '.items[0].execution_identity.binary_hash' "$installed_plan")
        local installed_cache_bound
        case "$installed_cache" in
            "$installed_home"/*) installed_cache_bound=yes ;;
            *) installed_cache_bound=no ;;
        esac
        assert_eq "installed-copy helper cache is sandbox-bound" "yes" \
            "$installed_cache_bound"
        assert_eq "installed-copy cache is a regular executable" "yes" \
            "$([ -f "$installed_cache" ] && [ ! -L "$installed_cache" ] && [ -x "$installed_cache" ] && echo yes || echo no)"
        installed_cache_mode=$(file_mode "$installed_cache")
        installed_cache_inode=$(file_inode "$installed_cache")
        assert_eq "installed-copy cache mode is 700" "700" "$installed_cache_mode"
        assert_eq "installed-copy cache hash matches plan identity" "$installed_cache_hash" \
            "sha256:$(shasum -a 256 "$installed_cache" | awk '{print $1}')"

        set +e
        (cd "$installed_work" && HOME="$installed_home" SKILLS_REFINER_TOOLS_ROOT="" \
            SKILLS_REFINER_NODE_BIN="$NODE24_BIN" \
            "$installed_launcher" cleanup apply --plan "$installed_plan" \
            --confirm "$installed_plan_hash" --json) \
            >"$installed_stdout" 2>"$installed_stderr"
        installed_rc=$?
        set -e
        assert_eq "installed-copy apply exits 0" "0" "$installed_rc"
        assert_eq "installed-copy apply uses exact transaction keys" \
            "command,committed_transaction_ids,location,mutation_occurred,mutation_outcome,overall_status,schema_version,state,status,transaction_has_mutated,transaction_id" \
            "$(jq -r 'keys | sort | join(",")' "$installed_stdout")"
        assert_jq "installed-copy apply commits exact transaction" "$(cat "$installed_stdout")" \
            --arg transaction "$installed_transaction_id" \
            '.schema_version == "skills-refiner.cleanup.transaction.v1"
             and .status == "committed"
             and .state == "COMMITTED"
             and .location == "quarantine"
             and .mutation_occurred == true
             and .transaction_id == $transaction'
        assert_eq "installed-copy apply removes active entry" "false" \
            "$([ -e "$installed_entry" ] || [ -L "$installed_entry" ] && echo true || echo false)"
        assert_eq "installed-copy apply preserves source bytes" "0" \
            "$(cmp -s "$source_file" "$source_before"; echo $?)"

        installed_helper_source="$installed_skill/native/cleanup-macos-helper.c"
        mv "$installed_helper_source" "$installed_helper_source.unavailable"
        assert_eq "installed helper source is unavailable after apply" "false" \
            "$([ -e "$installed_helper_source" ] && echo true || echo false)"

        set +e
        (cd "$installed_work" && HOME="$installed_home" SKILLS_REFINER_TOOLS_ROOT="" \
            SKILLS_REFINER_NODE_BIN="$NODE24_BIN" \
            "$installed_launcher" cleanup status "$installed_transaction_id" --json) \
            >"$installed_stdout" 2>"$installed_stderr"
        installed_rc=$?
        set -e
        assert_eq "installed-copy status survives unavailable helper source" "0" "$installed_rc"
        assert_eq "installed-copy status uses exact transaction keys" \
            "command,committed_transaction_ids,location,mutation_occurred,mutation_outcome,next_safe_command,overall_status,schema_version,state,status,transaction_has_mutated,transaction_id" \
            "$(jq -r 'keys | sort | join(",")' "$installed_stdout")"
        assert_jq "installed-copy status reads committed transaction" "$(cat "$installed_stdout")" \
            --arg transaction "$installed_transaction_id" \
            '.schema_version == "skills-refiner.cleanup.transaction.v1"
             and .status == "committed"
             and .mutation_occurred == false
             and .transaction_id == $transaction'
        assert_eq "transaction-bound helper cache inode stays stable" "$installed_cache_inode" \
            "$(file_inode "$installed_cache")"
        assert_eq "transaction-bound helper cache mode stays 700" "$installed_cache_mode" \
            "$(file_mode "$installed_cache")"
        assert_eq "transaction-bound helper cache bytes stay exact" "$installed_cache_hash" \
            "sha256:$(shasum -a 256 "$installed_cache" | awk '{print $1}')"

        set +e
        (cd "$installed_work" && HOME="$installed_home" SKILLS_REFINER_TOOLS_ROOT="" \
            SKILLS_REFINER_NODE_BIN="$NODE24_BIN" \
            "$installed_launcher" cleanup undo "$installed_transaction_id" \
            --confirm "$installed_transaction_id" --json) \
            >"$installed_stdout" 2>"$installed_stderr"
        installed_rc=$?
        set -e
        assert_eq "installed-copy undo survives unavailable helper source" "0" "$installed_rc"
        assert_eq "installed-copy undo uses exact transaction keys" \
            "command,committed_transaction_ids,location,mutation_occurred,mutation_outcome,overall_status,schema_version,state,status,transaction_has_mutated,transaction_id" \
            "$(jq -r 'keys | sort | join(",")' "$installed_stdout")"
        assert_jq "installed-copy undo rolls transaction back" "$(cat "$installed_stdout")" \
            --arg transaction "$installed_transaction_id" \
             '.schema_version == "skills-refiner.cleanup.transaction.v1"
             and .status == "restored"
             and .state == "RESTORED"
             and .location == "original"
             and .mutation_occurred == true
             and .transaction_id == $transaction'
        assert_eq "installed-copy undo restores symlink" "true" \
            "$([ -L "$installed_entry" ] && echo true || echo false)"
        assert_eq "installed-copy undo restores exact raw target" "$installed_link_target" \
            "$(readlink "$installed_entry")"
        assert_eq "installed-copy flow preserves source bytes" "0" \
            "$(cmp -s "$source_file" "$source_before"; echo $?)"
        assert_eq "installed-copy flow preserves source Git object" "$source_hash_before" \
            "$(git -C "$source_repo" hash-object "$source_file")"
        assert_eq "installed-copy flow preserves clean source Git fixture" "$source_status_before" \
            "$(git -C "$source_repo" status --porcelain=v1 --untracked-files=all)"
        assert_eq "installed-copy flow never recreates helper source" "false" \
            "$([ -e "$installed_helper_source" ] && echo true || echo false)"
        echo ""
    fi

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
