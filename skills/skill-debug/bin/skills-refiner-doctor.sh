#!/usr/bin/env bash
# skills-refiner-doctor.sh - One-shot read-only governance snapshot.

set -o pipefail

PRODUCT_VERSION="2.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_TREE="$(cd "$SCRIPT_DIR/../.." && pwd)"

TOOLS_ROOT=""
TARGET_CWD="${PWD:-.}"
DAYS=30
JSON_MODE=false
WITH_TRACE_STATUS=false
INCLUDE_TEXT=false
LANGUAGE="${SKILLS_REFINER_LANG:-auto}"

USAGE() {
    cat <<'EOF'
skills-refiner-doctor.sh - read-only governance snapshot.

Usage:
  bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh [options]
  bash skills/skill-debug/bin/skills-refiner-doctor.sh [options]

Options:
  --cwd PATH           Probe from this directory (default: current directory)
  --days N             Dashboard window in days (default: 30)
  --json               Single structured JSON object on stdout
  --lang en|zh|auto    Terminal language (default: auto)
  --raw                Append raw subtool terminal reports after the summary
  --include-text       Include raw subtool text in --json output
  --with-trace-status  Append skill-trace.sh --status output (read-only)
  --no-color           Reserved for subtool compatibility; doctor summary is plain text
  -h, --help           Show this help

Environment:
  SKILLS_REFINER_TOOLS_ROOT   Directory containing skill-debug/ and skill-hygiene/
                              (defaults to ~/.agents/skills or this checkout's skills/ tree)
  SKILLS_REFINER_LANG         en, zh, or auto

Notes:
  This command does not inject or strip activation traces.
  If skill-hygiene is not installed, output is a structured partial result
  with hygiene unavailable and exit status 1.
  JSON schema versions are API versions; product_version is the skills-refiner release line.
EOF
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h) USAGE ;;
        --cwd)
            [ -z "${2:-}" ] && { echo "[ERROR] --cwd requires a path" >&2; exit 2; }
            TARGET_CWD="$2"
            shift 2
            ;;
        --days)
            [ -z "${2:-}" ] && { echo "[ERROR] --days requires a non-negative integer" >&2; exit 2; }
            DAYS="$2"
            shift 2
            ;;
        --json) JSON_MODE=true; shift ;;
        --lang)
            [ -z "${2:-}" ] && { echo "[ERROR] --lang requires en, zh, or auto" >&2; exit 2; }
            LANGUAGE="$2"
            shift 2
            ;;
        --raw) INCLUDE_TEXT=true; shift ;;
        --include-text) INCLUDE_TEXT=true; shift ;;
        --with-trace-status) WITH_TRACE_STATUS=true; shift ;;
        --no-color) shift ;;
        *) echo "[ERROR] Unknown argument: $1" >&2; exit 2 ;;
    esac
done

case "$LANGUAGE" in
    auto)
        case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
            zh*) LANGUAGE="zh" ;;
            *) LANGUAGE="en" ;;
        esac
        ;;
    en|zh) ;;
    *) echo "[ERROR] --lang must be en, zh, or auto" >&2; exit 2 ;;
esac

if ! echo "$DAYS" | grep -Eq '^[0-9]+$'; then
    echo "[ERROR] --days requires a non-negative integer" >&2
    exit 2
fi

if [ ! -d "$TARGET_CWD" ] || [ ! -r "$TARGET_CWD" ] || [ ! -x "$TARGET_CWD" ]; then
    echo "[ERROR] --cwd must be a readable directory: $TARGET_CWD" >&2
    exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "[ERROR] jq is required for doctor output." >&2
    exit 127
fi

resolve_tools_root() {
    if [ -n "${SKILLS_REFINER_TOOLS_ROOT:-}" ]; then
        TOOLS_ROOT="${SKILLS_REFINER_TOOLS_ROOT%/}"
        return 0
    fi
    local home="${HOME:-}"
    if [ -n "$home" ] && [ -f "$home/.agents/skills/skill-debug/bin/skill-probe.sh" ]; then
        TOOLS_ROOT="$home/.agents/skills"
        return 0
    fi
    if [ -f "$SKILLS_TREE/skill-debug/bin/skill-probe.sh" ]; then
        TOOLS_ROOT="$SKILLS_TREE"
        return 0
    fi
    echo "[ERROR] Could not locate skill-debug/skill-hygiene scripts. Install skills-refiner or set SKILLS_REFINER_TOOLS_ROOT." >&2
    return 1
}

resolve_tools_root || exit 1

PROBE="$TOOLS_ROOT/skill-debug/bin/skill-probe.sh"
DASH="$TOOLS_ROOT/skill-debug/bin/skill-dashboard.sh"
SCAN="$TOOLS_ROOT/skill-hygiene/bin/skill-scan.sh"
TRACE="$TOOLS_ROOT/skill-debug/bin/skill-trace.sh"

for f in "$PROBE" "$DASH"; do
    [ -f "$f" ] || { echo "[ERROR] Missing script: $f" >&2; exit 1; }
done

scan_available=true
if [ ! -f "$SCAN" ]; then
    scan_available=false
fi

run_trace_status() {
    if [ ! -f "$TRACE" ]; then
        echo "[WARN] skill-trace.sh not found at $TRACE; skipping trace status." >&2
        return 0
    fi
    bash "$TRACE" --status
}

json_escape() {
    jq -Rs . 2>/dev/null
}

is_single_json_object() {
    local file="$1"
    jq -e -s 'length == 1 and (.[0] | type == "object")' "$file" >/dev/null 2>&1
}

step_status() {
    local step="$1" rc="$2" file="$3"
    if ! is_single_json_object "$file"; then
        echo "error"
    elif [ "$rc" -eq 0 ]; then
        echo "ok"
    elif [ "$step" = "dashboard" ] && [ "$rc" -eq 1 ] && jq -e '.error == "no_activation_log"' "$file" >/dev/null 2>&1; then
        echo "no_data"
    else
        echo "error"
    fi
}

prepare_step_payload() {
    local status="$1" rc="$2" raw_file="$3" stderr_file="$4" output_file="$5"
    if [ "$status" != "error" ] && is_single_json_object "$raw_file"; then
        cp "$raw_file" "$output_file"
        return 0
    fi

    local detail
    detail=$(cat "$stderr_file")
    if [ -z "$detail" ]; then
        if is_single_json_object "$raw_file"; then
            detail=$(jq -c . "$raw_file")
        else
            detail=$(cat "$raw_file")
        fi
    fi
    jq -n \
        --arg error "subtool_failed" \
        --argjson exit_code "$rc" \
        --arg detail "$detail" \
        '{error: $error, exit_code: $exit_code, detail: $detail}' >"$output_file"
}

probe_tmp=$(mktemp)
dash_tmp=$(mktemp)
scan_tmp=$(mktemp)
probe_stderr_tmp=$(mktemp)
dash_stderr_tmp=$(mktemp)
scan_stderr_tmp=$(mktemp)
probe_json_tmp=$(mktemp)
dash_json_tmp=$(mktemp)
scan_json_tmp=$(mktemp)
trace_tmp=""
probe_text_tmp=""
dash_text_tmp=""
scan_text_tmp=""

cleanup() {
    rm -f "$probe_tmp" "$dash_tmp" "$scan_tmp"
    rm -f "$probe_stderr_tmp" "$dash_stderr_tmp" "$scan_stderr_tmp"
    rm -f "$probe_json_tmp" "$dash_json_tmp" "$scan_json_tmp"
    [ -n "$trace_tmp" ] && rm -f "$trace_tmp"
    [ -n "$probe_text_tmp" ] && rm -f "$probe_text_tmp"
    [ -n "$dash_text_tmp" ] && rm -f "$dash_text_tmp"
    [ -n "$scan_text_tmp" ] && rm -f "$scan_text_tmp"
}
trap cleanup EXIT

bash "$PROBE" --json --cwd "$TARGET_CWD" >"$probe_tmp" 2>"$probe_stderr_tmp"
probe_rc=$?

bash "$DASH" --json --days "$DAYS" >"$dash_tmp" 2>"$dash_stderr_tmp"
dash_rc=$?

if $scan_available; then
    bash "$SCAN" --json >"$scan_tmp" 2>"$scan_stderr_tmp"
    scan_rc=$?
else
    jq -n \
        --arg error "skill_unavailable" \
        --arg required_skill "skill-hygiene" \
        --arg expected_path "$SCAN" \
        '{error: $error, required_skill: $required_skill, expected_path: $expected_path}' >"$scan_tmp"
    : >"$scan_stderr_tmp"
    scan_rc=3
fi

if $WITH_TRACE_STATUS; then
    trace_tmp=$(mktemp)
    run_trace_status >"$trace_tmp" 2>&1 || true
fi

probe_status=$(step_status "probe" "$probe_rc" "$probe_tmp")
dash_status=$(step_status "dashboard" "$dash_rc" "$dash_tmp")
if $scan_available; then
    scan_status=$(step_status "hygiene" "$scan_rc" "$scan_tmp")
else
    scan_status="unavailable"
fi

prepare_step_payload "$probe_status" "$probe_rc" "$probe_tmp" "$probe_stderr_tmp" "$probe_json_tmp"
prepare_step_payload "$dash_status" "$dash_rc" "$dash_tmp" "$dash_stderr_tmp" "$dash_json_tmp"
prepare_step_payload "$scan_status" "$scan_rc" "$scan_tmp" "$scan_stderr_tmp" "$scan_json_tmp"

if $INCLUDE_TEXT; then
    probe_text_tmp=$(mktemp)
    dash_text_tmp=$(mktemp)
    scan_text_tmp=$(mktemp)
    bash "$PROBE" --cwd "$TARGET_CWD" --no-color >"$probe_text_tmp" 2>&1 || true
    bash "$DASH" --days "$DAYS" >"$dash_text_tmp" 2>&1 || true
    if $scan_available; then
        bash "$SCAN" --no-write >"$scan_text_tmp" 2>&1 || true
    else
        echo "[UNAVAILABLE] skill-hygiene is not installed; hygiene report omitted." >"$scan_text_tmp"
    fi
fi

if [ "$probe_status" = "error" ] || [ "$dash_status" = "error" ] || [ "$scan_status" = "error" ] || [ "$scan_status" = "unavailable" ]; then
    exit_code=1
else
    exit_code=0
fi

if $JSON_MODE; then
    jq_args=(
        -n
        --arg schema "skills-refiner.doctor.v2"
        --arg product_version "$PRODUCT_VERSION"
        --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        --arg tools_root "$TOOLS_ROOT"
        --arg cwd "$TARGET_CWD"
        --arg language "$LANGUAGE"
        --arg probe_status "$probe_status"
        --arg dashboard_status "$dash_status"
        --arg hygiene_status "$scan_status"
        --argjson days "$DAYS"
        --rawfile probe_json "$probe_json_tmp"
        --rawfile dashboard_json "$dash_json_tmp"
        --rawfile hygiene_json "$scan_json_tmp"
    )

    jq_filter='{
        schema: $schema,
        product_version: $product_version,
        generated_at: $generated_at,
        tools_root: $tools_root,
        cwd: $cwd,
        language: $language,
        days: $days,
        steps: {
            probe: {status: $probe_status},
            dashboard: {status: $dashboard_status},
            hygiene: {status: $hygiene_status}
        },
        probe: ($probe_json | fromjson),
        dashboard: ($dashboard_json | fromjson),
        hygiene: ($hygiene_json | fromjson)
    }'

    if $INCLUDE_TEXT; then
        jq_args+=(--rawfile probe_text "$probe_text_tmp" --rawfile dashboard_text "$dash_text_tmp" --rawfile hygiene_text "$scan_text_tmp")
        jq_filter="$jq_filter | .raw_text = {probe: \$probe_text, dashboard: \$dashboard_text, hygiene: \$hygiene_text}"
    fi
    if $WITH_TRACE_STATUS && [ -n "$trace_tmp" ]; then
        jq_args+=(--rawfile trace_status_text "$trace_tmp")
        jq_filter="$jq_filter | .trace_status_text = \$trace_status_text"
    fi

    if ! jq "${jq_args[@]}" "$jq_filter"; then
        exit 1
    fi
    exit "$exit_code"
fi

metric() {
    local file="$1" expr="$2" fallback="${3:-0}"
    jq -r "$expr // \"$fallback\"" "$file" 2>/dev/null
}

step_error_summary() {
    local file="$1" rc detail
    rc=$(jq -r '.exit_code // "unknown"' "$file" 2>/dev/null)
    detail=$(jq -r '.detail // "subtool failed"' "$file" 2>/dev/null | tr '\r\n\t' '   ')
    printf 'error (exit_code=%s): %s' "$rc" "$detail"
}

if [ "$probe_status" = "error" ]; then
    probe_line_en="probe: $(step_error_summary "$probe_json_tmp")"
    probe_line_zh="probe：$(step_error_summary "$probe_json_tmp")"
else
    probe_entries=$(metric "$probe_json_tmp" '.counts.discoverable_entries')
    probe_symlinks=$(metric "$probe_json_tmp" '.counts.symlink_distribution_entries')
    active_conflicts=$(metric "$probe_json_tmp" '.counts.active_name_conflicts')
    topology_variants=$(metric "$probe_json_tmp" '.counts.topology_variants')
    probe_line_en="probe: $probe_entries visible entries, $probe_symlinks symlink distributions, $active_conflicts active name conflicts, $topology_variants topology variants"
    probe_line_zh="probe：$probe_entries 个可见条目，$probe_symlinks 个软链接分发，$active_conflicts 个主动命名冲突，$topology_variants 个拓扑变体"
fi

if [ "$scan_status" = "unavailable" ]; then
    hygiene_line_en="hygiene: unavailable (install skill-hygiene for the aggregate scan)"
    hygiene_line_zh="hygiene：不可用（安装 skill-hygiene 后才能运行聚合扫描）"
elif [ "$scan_status" = "error" ]; then
    hygiene_line_en="hygiene: $(step_error_summary "$scan_json_tmp")"
    hygiene_line_zh="hygiene：$(step_error_summary "$scan_json_tmp")"
else
    broken_symlinks=$(metric "$scan_json_tmp" '.broken_symlinks | length')
    scan_collisions=$(metric "$scan_json_tmp" '.name_collisions | length')
    flagged_skills=$(metric "$scan_json_tmp" '[.skills[] | select(.flags | length > 0)] | length')
    load_blockers=$(metric "$scan_json_tmp" '.runtime_load_blockers | length')
    security_flags=$(metric "$scan_json_tmp" '[.skills[] | select((.risk_indicators // []) | length > 0)] | length')
    backup_flags=$(metric "$scan_json_tmp" '[.skills[] | select(any(.flags[]?; startswith("backup")))] | length')
    canonical_count=$(metric "$scan_json_tmp" '[.skills[] | select(.location == ".agents/skills")] | length')
    native_count=$(metric "$scan_json_tmp" '([.skills[] | select(.location != ".agents/skills")] | length)')
    link_count=$(metric "$scan_json_tmp" '.skill_links | length')
    hygiene_line_en="hygiene: $canonical_count canonical skills, $native_count agent-native skills, $link_count distribution links"
    hygiene_line_zh="hygiene：$canonical_count 个 canonical skill，$native_count 个 agent-native skill，$link_count 个分发链接"
fi

if [ "$dash_status" = "error" ]; then
    dash_line_en="dashboard: $(step_error_summary "$dash_json_tmp")"
    dash_line_zh="观测面板：$(step_error_summary "$dash_json_tmp")"
elif [ "$dash_status" = "no_data" ]; then
    dash_line_en="dashboard: no activation log (no-data, not a failure)"
    dash_line_zh="观测面板：没有 activation log（无数据，不是失败）"
else
    total_events=$(metric "$dash_json_tmp" '.total_events')
    installed_ids=$(metric "$dash_json_tmp" '.installed_skills')
    observed_ids=$(metric "$dash_json_tmp" '.observed_canary_identities')
    observed_rate=$(metric "$dash_json_tmp" '.canary_observed_identity_rate_pct')
    dash_line_en="dashboard: $total_events events, $observed_ids/$installed_ids identities observed (${observed_rate}%)"
    dash_line_zh="观测面板：$total_events 条事件，$observed_ids/$installed_ids 个 identity 有观测（${observed_rate}%）"
fi

signals_available=true
if [ "$probe_status" = "error" ] || [ "$scan_status" = "error" ] || [ "$scan_status" = "unavailable" ]; then
    signals_available=false
fi

if [ "$LANGUAGE" = "zh" ]; then
    echo "skills-refiner doctor v$PRODUCT_VERSION - 只读快照"
    echo "tools_root: $TOOLS_ROOT"
    echo "cwd:        $TARGET_CWD"
    echo "window:     last $DAYS days"
    echo ""
    echo "概览"
    echo "  $probe_line_zh"
    echo "  $hygiene_line_zh"
    echo "  $dash_line_zh"
    echo ""
    echo "信号分层"
    if $signals_available; then
        echo "  critical signals: load_blockers=$load_blockers, broken_symlinks=$broken_symlinks, security_review_flags=$security_flags, active_name_conflicts=$active_conflicts"
        echo "  advisory signals: topology_variants=$topology_variants, backup_or_archive_remnants=$backup_flags, scan_name_collisions=$scan_collisions"
        echo "  informational: flagged_skills=$flagged_skills, dashboard_status=$dash_status"
    else
        echo "  probe 或 hygiene 步骤失败；不生成可能误导的聚合指标。"
    fi
    echo ""
    echo "边界"
    echo "  软链接分发、源码仓库变体、备份目录和同内容副本不会被当成主动冲突。"
    echo "  canary 缺失只是本地未观测，不是 skill 无用或可删除的证据。"
    echo "  JSON schema 版本不是产品版本；当前 product_version=${PRODUCT_VERSION}。"
else
    echo "skills-refiner doctor v$PRODUCT_VERSION - read-only snapshot"
    echo "tools_root: $TOOLS_ROOT"
    echo "cwd:        $TARGET_CWD"
    echo "window:     last $DAYS days"
    echo ""
    echo "Overview"
    echo "  $probe_line_en"
    echo "  $hygiene_line_en"
    echo "  $dash_line_en"
    echo ""
    echo "Signal Levels"
    if $signals_available; then
        echo "  critical signals: load_blockers=$load_blockers, broken_symlinks=$broken_symlinks, security_review_flags=$security_flags, active_name_conflicts=$active_conflicts"
        echo "  advisory signals: topology_variants=$topology_variants, backup_or_archive_remnants=$backup_flags, scan_name_collisions=$scan_collisions"
        echo "  informational: flagged_skills=$flagged_skills, dashboard_status=$dash_status"
    else
        echo "  probe or hygiene failed; aggregate metrics are withheld to avoid false zeroes."
    fi
    echo ""
    echo "Boundaries"
    echo "  Symlink distributions, source-repo variants, backups, and same-content copies are not active conflicts."
    echo "  Missing canary data means no local observation; it is not evidence that a skill is unused or removable."
    echo "  JSON schema versions are API versions; product_version=${PRODUCT_VERSION} is the release line."
fi

if $INCLUDE_TEXT; then
    echo ""
    echo "Raw Reports"
    echo "-- skill-probe --"
    cat "$probe_text_tmp"
    echo "-- skill-dashboard --"
    cat "$dash_text_tmp"
    echo "-- skill-hygiene --"
    cat "$scan_text_tmp"
fi

if $WITH_TRACE_STATUS && [ -n "$trace_tmp" ]; then
    echo ""
    echo "Trace Status"
    cat "$trace_tmp"
fi

exit "$exit_code"
