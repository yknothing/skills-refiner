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
  JSON schema versions are API versions; product_version is the skills-refiner release line.
EOF
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --help|-h) USAGE ;;
        --cwd)
            [ -z "${2:-}" ] && { echo "[ERROR] --cwd requires a path" >&2; exit 1; }
            TARGET_CWD="$2"
            shift 2
            ;;
        --days)
            [ -z "${2:-}" ] && { echo "[ERROR] --days requires a number" >&2; exit 1; }
            DAYS="$2"
            shift 2
            ;;
        --json) JSON_MODE=true; shift ;;
        --lang)
            [ -z "${2:-}" ] && { echo "[ERROR] --lang requires en, zh, or auto" >&2; exit 1; }
            LANGUAGE="$2"
            shift 2
            ;;
        --raw) INCLUDE_TEXT=true; shift ;;
        --include-text) INCLUDE_TEXT=true; shift ;;
        --with-trace-status) WITH_TRACE_STATUS=true; shift ;;
        --no-color) shift ;;
        *) echo "[ERROR] Unknown argument: $1" >&2; exit 1 ;;
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
    *) echo "[ERROR] --lang must be en, zh, or auto" >&2; exit 1 ;;
esac

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

for f in "$PROBE" "$DASH" "$SCAN"; do
    [ -f "$f" ] || { echo "[ERROR] Missing script: $f" >&2; exit 1; }
done

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

step_status() {
    local rc="$1" file="$2"
    if [ "$rc" -eq 0 ]; then
        echo "ok"
    elif jq -e '.error == "no_activation_log"' "$file" >/dev/null 2>&1; then
        echo "no_data"
    else
        echo "error"
    fi
}

probe_tmp=$(mktemp)
dash_tmp=$(mktemp)
scan_tmp=$(mktemp)
trace_tmp=""
probe_text_tmp=""
dash_text_tmp=""
scan_text_tmp=""

cleanup() {
    rm -f "$probe_tmp" "$dash_tmp" "$scan_tmp"
    [ -n "$trace_tmp" ] && rm -f "$trace_tmp"
    [ -n "$probe_text_tmp" ] && rm -f "$probe_text_tmp"
    [ -n "$dash_text_tmp" ] && rm -f "$dash_text_tmp"
    [ -n "$scan_text_tmp" ] && rm -f "$scan_text_tmp"
}
trap cleanup EXIT

bash "$PROBE" --json --cwd "$TARGET_CWD" >"$probe_tmp"
probe_rc=$?

bash "$DASH" --json --days "$DAYS" >"$dash_tmp"
dash_rc=$?

bash "$SCAN" --json >"$scan_tmp"
scan_rc=$?

if $WITH_TRACE_STATUS; then
    trace_tmp=$(mktemp)
    run_trace_status >"$trace_tmp" 2>&1 || true
fi

probe_status=$(step_status "$probe_rc" "$probe_tmp")
dash_status=$(step_status "$dash_rc" "$dash_tmp")
scan_status=$(step_status "$scan_rc" "$scan_tmp")

if $INCLUDE_TEXT; then
    probe_text_tmp=$(mktemp)
    dash_text_tmp=$(mktemp)
    scan_text_tmp=$(mktemp)
    bash "$PROBE" --cwd "$TARGET_CWD" --no-color >"$probe_text_tmp" 2>&1 || true
    bash "$DASH" --days "$DAYS" >"$dash_text_tmp" 2>&1 || true
    bash "$SCAN" --no-write >"$scan_text_tmp" 2>&1 || true
fi

if [ "$probe_status" = "error" ] || [ "$scan_status" = "error" ]; then
    exit_code=1
else
    exit_code=0
fi

if $JSON_MODE; then
    jq_args=(
        -n
        --arg schema "skills-refiner.doctor.v1"
        --arg product_version "$PRODUCT_VERSION"
        --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        --arg tools_root "$TOOLS_ROOT"
        --arg cwd "$TARGET_CWD"
        --arg language "$LANGUAGE"
        --arg probe_status "$probe_status"
        --arg dashboard_status "$dash_status"
        --arg hygiene_status "$scan_status"
        --argjson days "$DAYS"
        --rawfile probe_json "$probe_tmp"
        --rawfile dashboard_json "$dash_tmp"
        --rawfile hygiene_json "$scan_tmp"
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

    jq "${jq_args[@]}" "$jq_filter"
    exit "$exit_code"
fi

metric() {
    local file="$1" expr="$2" fallback="${3:-0}"
    jq -r "$expr // \"$fallback\"" "$file" 2>/dev/null
}

probe_entries=$(metric "$probe_tmp" '.counts.discoverable_entries')
probe_symlinks=$(metric "$probe_tmp" '.counts.symlink_distribution_entries')
active_conflicts=$(metric "$probe_tmp" '.counts.active_name_conflicts')
topology_variants=$(metric "$probe_tmp" '.counts.topology_variants')

broken_symlinks=$(metric "$scan_tmp" '.broken_symlinks | length')
scan_collisions=$(metric "$scan_tmp" '.name_collisions | length')
flagged_skills=$(metric "$scan_tmp" '[.skills[] | select(.flags | length > 0)] | length')
load_blockers=$(metric "$scan_tmp" '.runtime_load_blockers | length')
security_flags=$(metric "$scan_tmp" '[.skills[] | select(any(.flags[]?; . == "pipe_to_shell" or . == "dangerous_cmd" or . == "possible_secret"))] | length')
backup_flags=$(metric "$scan_tmp" '[.skills[] | select(any(.flags[]?; startswith("backup")))] | length')
canonical_count=$(metric "$scan_tmp" '[.skills[] | select(.location == ".agents/skills")] | length')
native_count=$(metric "$scan_tmp" '([.skills[] | select(.location != ".agents/skills")] | length)')
link_count=$(metric "$scan_tmp" '.skill_links | length')

if [ "$dash_status" = "no_data" ]; then
    dash_line_en="dashboard: no activation log (no-data, not a failure)"
    dash_line_zh="观测面板：没有 activation log（无数据，不是失败）"
else
    total_events=$(metric "$dash_tmp" '.total_events')
    installed_ids=$(metric "$dash_tmp" '.installed_skills')
    observed_ids=$(metric "$dash_tmp" '.observed_canary_identities')
    observed_rate=$(metric "$dash_tmp" '.canary_observed_identity_rate_pct')
    dash_line_en="dashboard: $total_events events, $observed_ids/$installed_ids identities observed (${observed_rate}%)"
    dash_line_zh="观测面板：$total_events 条事件，$observed_ids/$installed_ids 个 identity 有观测（${observed_rate}%）"
fi

if [ "$LANGUAGE" = "zh" ]; then
    echo "skills-refiner doctor v$PRODUCT_VERSION - 只读快照"
    echo "tools_root: $TOOLS_ROOT"
    echo "cwd:        $TARGET_CWD"
    echo "window:     last $DAYS days"
    echo ""
    echo "概览"
    echo "  probe: $probe_entries 个可见条目，$probe_symlinks 个软链接分发，$active_conflicts 个主动命名冲突，$topology_variants 个拓扑变体"
    echo "  hygiene: $canonical_count 个 canonical skill，$native_count 个 agent-native skill，$link_count 个分发链接"
    echo "  $dash_line_zh"
    echo ""
    echo "信号分层"
    echo "  critical signals: load_blockers=$load_blockers, broken_symlinks=$broken_symlinks, security_review_flags=$security_flags, active_name_conflicts=$active_conflicts"
    echo "  advisory signals: topology_variants=$topology_variants, backup_or_archive_remnants=$backup_flags, scan_name_collisions=$scan_collisions"
    echo "  informational: flagged_skills=$flagged_skills, dashboard_status=$dash_status"
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
    echo "  probe: $probe_entries visible entries, $probe_symlinks symlink distributions, $active_conflicts active name conflicts, $topology_variants topology variants"
    echo "  hygiene: $canonical_count canonical skills, $native_count agent-native skills, $link_count distribution links"
    echo "  $dash_line_en"
    echo ""
    echo "Signal Levels"
    echo "  critical signals: load_blockers=$load_blockers, broken_symlinks=$broken_symlinks, security_review_flags=$security_flags, active_name_conflicts=$active_conflicts"
    echo "  advisory signals: topology_variants=$topology_variants, backup_or_archive_remnants=$backup_flags, scan_name_collisions=$scan_collisions"
    echo "  informational: flagged_skills=$flagged_skills, dashboard_status=$dash_status"
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
