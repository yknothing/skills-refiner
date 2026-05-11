#!/usr/bin/env bash
# skills-refiner-doctor.sh — One-shot read-only governance snapshot (probe + dashboard + hygiene scan).
#
# Does not inject/strip activation traces (those modify SKILL.md files). Optional --with-trace-status
# runs skill-trace.sh --status (read-only).
#
# Tool resolution order:
#   1) SKILLS_REFINER_TOOLS_ROOT — directory containing skill-debug/ and skill-hygiene/ (same layout as ~/.agents/skills)
#   2) ~/.agents/skills when probe script exists there
#   3) Development checkout: this file lives at skills/skill-debug/bin/ → ../.. is the skills/ tree root
#
# Usage:
#   bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh
#   bash skills/skill-debug/bin/skills-refiner-doctor.sh --json

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_TREE="$(cd "$SCRIPT_DIR/../.." && pwd)"

USAGE() {
    cat <<'EOF'
skills-refiner-doctor.sh — read-only governance snapshot (probe + dashboard + hygiene JSON scan).

Usage:
  bash ~/.agents/skills/skill-debug/bin/skills-refiner-doctor.sh [options]
  bash skills/skill-debug/bin/skills-refiner-doctor.sh [options]

Options:
  --cwd PATH           Probe from this directory (default: current directory)
  --days N             Dashboard window in days (default: 30)
  --json               Single JSON object on stdout (for agents / tooling)
  --with-trace-status  Append skill-trace.sh --status output (read-only)
  -h, --help           Show this help

Environment:
  SKILLS_REFINER_TOOLS_ROOT   Directory containing skill-debug/ and skill-hygiene/
                              (defaults to ~/.agents/skills or this checkout's skills/ tree)

Notes:
  Does not inject or strip activation traces (those modify SKILL.md files).
EOF
    exit 0
}

TOOLS_ROOT=""
TARGET_CWD="${PWD:-.}"
DAYS=30
JSON_MODE=false
WITH_TRACE_STATUS=false

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
        --with-trace-status) WITH_TRACE_STATUS=true; shift ;;
        *) echo "[ERROR] Unknown argument: $1" >&2; exit 1 ;;
    esac
done

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
    echo "[ERROR] Could not locate skill-debug/skill-hygiene scripts. Install skills-refiner (npx skills add ...) or set SKILLS_REFINER_TOOLS_ROOT to the directory that contains skill-debug/ and skill-hygiene/." >&2
    return 1
}

resolve_tools_root || exit 1

PROBE="$TOOLS_ROOT/skill-debug/bin/skill-probe.sh"
DASH="$TOOLS_ROOT/skill-debug/bin/skill-dashboard.sh"
SCAN="$TOOLS_ROOT/skill-hygiene/bin/skill-scan.sh"
TRACE="$TOOLS_ROOT/skill-debug/bin/skill-trace.sh"

for f in "$PROBE" "$DASH" "$SCAN"; do
    if [ ! -f "$f" ]; then
        echo "[ERROR] Missing script: $f" >&2
        exit 1
    fi
done

run_trace_status() {
    if [ ! -f "$TRACE" ]; then
        echo "[WARN] skill-trace.sh not found at $TRACE — skipping trace status." >&2
        return 0
    fi
    bash "$TRACE" --status
}

if $JSON_MODE; then
    probe_tmp=$(mktemp)
    dash_tmp=$(mktemp)
    scan_tmp=$(mktemp)
    trace_tmp=""
    cleanup_json() {
        rm -f "$probe_tmp" "$dash_tmp" "$scan_tmp"
        [ -n "${trace_tmp:-}" ] && rm -f "$trace_tmp"
    }
    trap cleanup_json EXIT

    bash "$PROBE" --cwd "$TARGET_CWD" >"$probe_tmp" || exit 1
    bash "$DASH" --json --days "$DAYS" >"$dash_tmp" || exit 1
    bash "$SCAN" --json >"$scan_tmp" || exit 1

    if $WITH_TRACE_STATUS; then
        trace_tmp=$(mktemp)
        run_trace_status >"$trace_tmp" 2>&1 || true
    fi

    if $WITH_TRACE_STATUS && [ -n "$trace_tmp" ]; then
        jq -n \
            --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --arg tools_root "$TOOLS_ROOT" \
            --arg cwd "$TARGET_CWD" \
            --argjson days "$DAYS" \
            --rawfile probe_text "$probe_tmp" \
            --rawfile dashboard_json "$dash_tmp" \
            --rawfile hygiene_json "$scan_tmp" \
            --rawfile trace_status_text "$trace_tmp" \
            '{
                schema: "skills-refiner.doctor.v1",
                generated_at: $generated_at,
                tools_root: $tools_root,
                cwd: $cwd,
                days: $days,
                probe_terminal_report: $probe_text,
                dashboard: ($dashboard_json | fromjson),
                hygiene: ($hygiene_json | fromjson),
                trace_status_text: $trace_status_text
            }'
    else
        jq -n \
            --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --arg tools_root "$TOOLS_ROOT" \
            --arg cwd "$TARGET_CWD" \
            --argjson days "$DAYS" \
            --rawfile probe_text "$probe_tmp" \
            --rawfile dashboard_json "$dash_tmp" \
            --rawfile hygiene_json "$scan_tmp" \
            '{
                schema: "skills-refiner.doctor.v1",
                generated_at: $generated_at,
                tools_root: $tools_root,
                cwd: $cwd,
                days: $days,
                probe_terminal_report: $probe_text,
                dashboard: ($dashboard_json | fromjson),
                hygiene: ($hygiene_json | fromjson)
            }'
    fi
    exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " skills-refiner doctor — read-only snapshot"
echo " tools_root: $TOOLS_ROOT"
echo " cwd:        $TARGET_CWD"
echo " dashboard:  last $DAYS days"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "── skill-probe (discovery) ──"
bash "$PROBE" --cwd "$TARGET_CWD" || exit 1
echo ""
echo "── skill-dashboard (activation log summary) ──"
bash "$DASH" --days "$DAYS" || exit 1
echo ""
echo "── skill-hygiene scan (terminal only, no JSON report file) ──"
bash "$SCAN" --no-write || exit 1
echo ""
if $WITH_TRACE_STATUS; then
    echo "── skill-trace --status (read-only) ──"
    run_trace_status || true
    echo ""
fi
echo "━━ Notes ━━"
echo " • Probe/dashboard reflect local filesystem + JSONL evidence; platform runtime may differ."
echo " • Dashboard/canary counts are proxy signals — not proof of loading or instruction obedience."
echo " • To persist hygiene JSON for tooling: bash \"$SCAN\" --json"
echo " • Trace inject/strip is intentionally not run here (modifies skills); confirm before using skill-trace."
