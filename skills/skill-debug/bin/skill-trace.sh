#!/usr/bin/env bash
# skill-trace.sh — Skill activation canary injection/removal
# Injects lightweight canary blocks into skills to observe when agents follow them.
#
# Usage:
#   bash skill-trace.sh --inject <SKILL.md>      # Inject trace into one skill
#   bash skill-trace.sh --inject-dir <dir>        # Inject into all skills in dir
#   bash skill-trace.sh --strip <SKILL.md>        # Remove trace from one skill
#   bash skill-trace.sh --strip-dir <dir>         # Remove all traces in dir
#   bash skill-trace.sh --status                  # Show which skills have traces

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_SH="$SCRIPT_DIR/../lib/common.sh"
[ -f "$COMMON_SH" ] || { echo "[ERROR] Missing shared helper: $COMMON_SH" >&2; exit 1; }
# shellcheck source=../lib/common.sh
. "$COMMON_SH"

detect_home_dir() {
    sr_detect_home_dir
}

HOME_DIR=""
DEBUG_DIR=""
LOG_FILE=""

init_home_paths() {
    if [ -n "$HOME_DIR" ]; then
        return 0
    fi

    HOME_DIR="$(detect_home_dir)" || {
        echo "[ERROR] Unable to determine home directory. Set HOME and retry." >&2
        return 2
    }
    DEBUG_DIR="$HOME_DIR/.agents/debug"
    LOG_FILE="$DEBUG_DIR/activation.jsonl"
}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

TRACE_START="<!-- SKILL-DEBUG-TRACE-START v1 -->"
TRACE_END="<!-- SKILL-DEBUG-TRACE-END v1 -->"

# ── Helpers ───────────────────────────────────────────────────────────
has_trace() {
    sr_skill_has_trace "$1"
}

get_skill_name() {
    local file="$1"
    local name
    name=$(sr_get_frontmatter_field "$file" "name")
    if [ -z "$name" ]; then
        name=$(basename "$(dirname "$file")")
    fi
    echo "$name"
}

resolve_canonical_file() {
    local file="$1"
    sr_canonical_file "$file"
}

write_preserving_metadata() {
    local source_tmp="$1" target="$2"
    local target_dir atomic_tmp
    target_dir=$(dirname "$target")
    atomic_tmp=$(mktemp "$target_dir/.skill-trace.XXXXXX") || return 1
    cp -p "$target" "$atomic_tmp" 2>/dev/null || {
        rm -f "$atomic_tmp"
        return 1
    }
    cat "$source_tmp" > "$atomic_tmp" || {
        rm -f "$atomic_tmp"
        return 1
    }
    touch -r "$target" "$atomic_tmp" 2>/dev/null || {
        rm -f "$atomic_tmp"
        return 1
    }
    mv -f "$atomic_tmp" "$target" || {
        rm -f "$atomic_tmp"
        return 1
    }
}

shell_quote() {
    printf '%q' "$1"
}

# ── Inject Trace ──────────────────────────────────────────────────────
inject_trace() {
    local skill_file="$1"
    TRACE_RESULT="fail"

    if [ ! -f "$skill_file" ]; then
        echo -e "${RED}[ERROR]${NC} File not found: $skill_file"
        return 1
    fi

    if ! sr_validate_trace_structure "$skill_file"; then
        echo -e "${RED}[ERROR]${NC} Malformed trace markers; refusing to modify: $skill_file"
        return 1
    fi

    if has_trace "$skill_file"; then
        echo -e "${DIM}[SKIP]${NC} Already has trace: $skill_file"
        TRACE_RESULT="skip"
        return 0
    fi

    local skill_name
    skill_name=$(get_skill_name "$skill_file")

    local canonical_skill_file
    canonical_skill_file=$(resolve_canonical_file "$skill_file" 2>/dev/null || echo "$skill_file")

    # Build the trace block. The identity computation lives in
    # skill-canary.sh (single implementation sourced from lib/common.sh), so
    # injected files stay small and never freeze a copy of the normalization
    # algorithm.
    local trace_block helper_literal skill_file_literal skill_name_literal original_eof_state
    helper_literal=$(shell_quote "$SCRIPT_DIR/skill-canary.sh")
    skill_file_literal=$(shell_quote "$canonical_skill_file")
    skill_name_literal=$(shell_quote "$skill_name")
    original_eof_state=$(sr_file_eof_state "$canonical_skill_file") || {
        echo -e "${RED}[ERROR]${NC} Failed to inspect EOF state: $skill_file"
        return 1
    }
    trace_block=$(printf '%s\n' \
        '## Activation Canary Trace (auto-injected by skill-debug)' \
        '<!-- SKILL-DEBUG-TRACE-START v1 -->' \
        "<!-- SKILL-DEBUG-ORIGINAL-EOF $original_eof_state -->" \
        'When this skill is used, run this canary command first:' \
        '```bash' \
        '_skill_debug_json_escape() { LC_ALL=C awk '\''BEGIN { ORS=""; controls=""; for (i=1; i<=31; i++) controls=controls sprintf("%c", i) } { if (NR > 1) printf "\\n"; for (i=1; i<=length($0); i++) { ch=substr($0, i, 1); if (ch == "\\") printf "\\\\"; else if (ch == "\"") printf "\\\""; else { control=index(controls, ch); if (control > 0) printf "\\u%04x", control; else printf "%s", ch } } }'\''; }; _skill_debug_helper='"$helper_literal"'; _skill_debug_name='"$skill_name_literal" \
        'if [ -f "$_skill_debug_helper" ]; then' \
        '  bash "$_skill_debug_helper" '"$skill_file_literal" \
        'else' \
        '  _skill_debug_mode() { stat -c '\''%a'\'' "$1" 2>/dev/null || stat -f '\''%Lp'\'' "$1" 2>/dev/null; }; _skill_debug_name_json=$(printf '\''%s'\'' "$_skill_debug_name" | _skill_debug_json_escape); _skill_debug_cwd_json=$(pwd | _skill_debug_json_escape); _skill_debug_dir=~/.agents/debug; _skill_debug_log=$_skill_debug_dir/activation.jsonl; _skill_debug_platform=$(uname -s 2>/dev/null || true); case "$_skill_debug_platform:$_skill_debug_dir" in MINGW*:*|MSYS*:*|CYGWIN*:*|Linux:/mnt/?/*) printf '\''%s\n'\'' "[ERROR] Canary logging requires enforceable POSIX file permissions; on Windows use WSL 2 with HOME on its Linux filesystem." >&2; false ;; Darwin:*|Linux:*) umask 077; [ ! -L "$HOME" ] && [ ! -L "$HOME/.agents" ] && [ ! -L "$_skill_debug_dir" ] && mkdir -p "$_skill_debug_dir" && [ -d "$_skill_debug_dir" ] && [ ! -L "$_skill_debug_dir" ] && chmod 700 "$_skill_debug_dir" && [ "$(_skill_debug_mode "$_skill_debug_dir")" = 700 ] && [ ! -L "$_skill_debug_log" ] && { [ -e "$_skill_debug_log" ] || (set -o noclobber; : > "$_skill_debug_log") 2>/dev/null; } && [ -f "$_skill_debug_log" ] && [ ! -L "$_skill_debug_log" ] && chmod 600 "$_skill_debug_log" && [ "$(_skill_debug_mode "$_skill_debug_log")" = 600 ] && printf '\''{"event":"skill_canary_observed","trace_schema":"skill-debug.identity.v1","trace_kind":"canary_degraded","skill":"%s","identity_key":"","ts":"%s","cwd":"%s"}\n'\'' "$_skill_debug_name_json" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_skill_debug_cwd_json" >> "$_skill_debug_log" ;; *) printf '\''%s\n'\'' "[ERROR] Canary logging is unsupported on this platform." >&2; false ;; esac' \
        'fi' \
        '```' \
        '<!-- SKILL-DEBUG-TRACE-END v1 -->')

    # Find the end of frontmatter and inject after it
    local fm_end
    if ! fm_end=$(awk '{
        line=$0
        sub(/\r$/, "", line)
        if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        if (line ~ /^---[[:space:]]*$/) { c++; if(c==2){print NR; exit} }
    }' "$skill_file"); then
        echo -e "${RED}[ERROR]${NC} Failed to locate frontmatter boundary: $skill_file"
        return 1
    fi

    local tmp
    tmp=$(mktemp) || return 1
    if [ -n "$fm_end" ]; then
        # Insert after the second --- line
        if ! head -n "$fm_end" "$skill_file" > "$tmp"; then
            rm -f "$tmp"
            echo -e "${RED}[ERROR]${NC} Failed to read frontmatter: $skill_file"
            return 1
        fi
        local head_eof_state
        head_eof_state=$(sr_file_eof_state "$tmp") || {
            rm -f "$tmp"
            echo -e "${RED}[ERROR]${NC} Failed to inspect transformed frontmatter: $skill_file"
            return 1
        }
        if [ "$head_eof_state" != "newline" ]; then
            printf '\n' >> "$tmp" || { rm -f "$tmp"; return 1; }
        fi
        if ! printf '%s\n' "$trace_block" >> "$tmp"; then
            rm -f "$tmp"
            return 1
        fi
        if ! tail -n "+$((fm_end + 1))" "$skill_file" >> "$tmp"; then
            rm -f "$tmp"
            echo -e "${RED}[ERROR]${NC} Failed to read skill body: $skill_file"
            return 1
        fi
    else
        # No frontmatter, prepend
        if ! printf '%s\n' "$trace_block" > "$tmp" || ! cat "$skill_file" >> "$tmp"; then
            rm -f "$tmp"
            echo -e "${RED}[ERROR]${NC} Failed to build traced content: $skill_file"
            return 1
        fi
    fi
    if ! write_preserving_metadata "$tmp" "$canonical_skill_file"; then
        rm -f "$tmp"
        echo -e "${RED}[ERROR]${NC} Failed to atomically update: $skill_file"
        return 1
    fi
    rm -f "$tmp"

    TRACE_RESULT="success"
    echo -e "${GREEN}[INJECTED]${NC} $skill_name → $skill_file"
}

# ── Strip Trace ───────────────────────────────────────────────────────
strip_trace() {
    local skill_file="$1"
    TRACE_RESULT="fail"

    if [ ! -f "$skill_file" ]; then
        echo -e "${RED}[ERROR]${NC} File not found: $skill_file"
        return 1
    fi

    if ! sr_validate_trace_structure "$skill_file"; then
        echo -e "${RED}[ERROR]${NC} Malformed trace markers; refusing to modify: $skill_file"
        return 1
    fi

    if ! has_trace "$skill_file"; then
        echo -e "${DIM}[SKIP]${NC} No trace found: $skill_file"
        TRACE_RESULT="skip"
        return 0
    fi

    local skill_name
    skill_name=$(get_skill_name "$skill_file")

    local canonical_skill_file
    canonical_skill_file=$(resolve_canonical_file "$skill_file" 2>/dev/null || echo "$skill_file")

    # Remove real injected trace blocks. Literal examples inside fenced code are kept.
    local tmp
    tmp=$(mktemp) || return 1
    if ! sr_strip_trace_blocks "$skill_file" > "$tmp"; then
        rm -f "$tmp"
        echo -e "${RED}[ERROR]${NC} Failed to transform traced content: $skill_file"
        return 1
    fi
    if ! write_preserving_metadata "$tmp" "$canonical_skill_file"; then
        rm -f "$tmp"
        echo -e "${RED}[ERROR]${NC} Failed to atomically update: $skill_file"
        return 1
    fi
    rm -f "$tmp"

    TRACE_RESULT="success"
    echo -e "${YELLOW}[STRIPPED]${NC} $skill_name → $skill_file"
}

# ── Directory Operations ──────────────────────────────────────────────
inject_dir() {
    local dir="$1"
    local success=0 skipped=0 failed=0

    if [ ! -d "$dir" ]; then
        echo -e "${RED}[ERROR]${NC} Directory not found: $dir" >&2
        return 2
    fi

    local files_tmp
    files_tmp=$(mktemp) || return 1
    if ! find "$dir" -maxdepth 3 -name "SKILL.md" -type f >"$files_tmp" 2>/dev/null; then
        rm -f "$files_tmp"
        echo -e "${RED}[ERROR]${NC} Failed to enumerate skill files: $dir" >&2
        echo -e "${GREEN}Done.${NC} success=0 skipped=0 failed=1"
        return 1
    fi

    echo -e "${BOLD}Injecting traces into: $dir${NC}"
    while IFS= read -r f; do
        if inject_trace "$f"; then
            case "$TRACE_RESULT" in
                success) success=$((success + 1)) ;;
                skip) skipped=$((skipped + 1)) ;;
            esac
        else
            failed=$((failed + 1))
        fi
    done < "$files_tmp"
    rm -f "$files_tmp"

    echo -e "\n${GREEN}Done.${NC} success=$success skipped=$skipped failed=$failed"
    [ "$failed" -eq 0 ] || return 1
}

strip_dir() {
    local dir="$1"
    local success=0 skipped=0 failed=0

    if [ ! -d "$dir" ]; then
        echo -e "${RED}[ERROR]${NC} Directory not found: $dir" >&2
        return 2
    fi

    local files_tmp
    files_tmp=$(mktemp) || return 1
    if ! find "$dir" -maxdepth 3 -name "SKILL.md" -type f >"$files_tmp" 2>/dev/null; then
        rm -f "$files_tmp"
        echo -e "${RED}[ERROR]${NC} Failed to enumerate skill files: $dir" >&2
        echo -e "${YELLOW}Done.${NC} success=0 skipped=0 failed=1"
        return 1
    fi

    echo -e "${BOLD}Stripping traces from: $dir${NC}"
    while IFS= read -r f; do
        if strip_trace "$f"; then
            case "$TRACE_RESULT" in
                success) success=$((success + 1)) ;;
                skip) skipped=$((skipped + 1)) ;;
            esac
        else
            failed=$((failed + 1))
        fi
    done < "$files_tmp"
    rm -f "$files_tmp"

    echo -e "\n${YELLOW}Done.${NC} success=$success skipped=$skipped failed=$failed"
    [ "$failed" -eq 0 ] || return 1
}

# ── Status ────────────────────────────────────────────────────────────
show_status() {
    init_home_paths || exit 2

    if [ -f "$LOG_FILE" ] && ! command -v jq >/dev/null 2>&1; then
        echo "[ERROR] jq is required to read an existing activation log." >&2
        return 127
    fi

    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║        Skill Trace Status v2.0           ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""

    local traced=0
    local total=0

    echo -e "${BOLD}── Traced Skills ──${NC}"
    # Only scan agent-recognized skill directories, not all of $HOME
    while IFS= read -r _sd; do
        [ -d "$HOME_DIR/$_sd" ] || continue
        find "$HOME_DIR/$_sd" -maxdepth 3 -name "SKILL.md" -type f 2>/dev/null
    done < <(sr_agent_skill_dirs) | while IFS= read -r f; do
        total=$((total + 1))
        if has_trace "$f"; then
            traced=$((traced + 1))
            local name
            name=$(get_skill_name "$f")
            local rel="${f#$HOME_DIR/}"
            echo -e "  ${GREEN}◉${NC} $name ${DIM}($rel)${NC}"
        fi
    done

    echo ""

    # Log file status
    echo -e "${BOLD}── Activation Log ──${NC}"
    if [ -f "$LOG_FILE" ]; then
        local lines
        lines=$(wc -l < "$LOG_FILE" | tr -d ' ')
        local size
        size=$(du -sh "$LOG_FILE" 2>/dev/null | cut -f1)
        local oldest
        oldest=$(head -1 "$LOG_FILE" | jq -r '.ts' 2>/dev/null)
        local newest
        newest=$(tail -1 "$LOG_FILE" | jq -r '.ts' 2>/dev/null)

        echo -e "  File: ${CYAN}$LOG_FILE${NC}"
        echo -e "  Events: $lines ($size)"
        echo -e "  Range: $oldest → $newest"
    else
        echo -e "  ${DIM}No activation log yet. Inject traces and use skills to generate data.${NC}"
    fi
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────
show_help() {
    echo "skill-trace.sh — Skill activation trace manager"
    echo ""
    echo "Usage:"
    echo "  --inject <SKILL.md>     Inject trace into one skill"
    echo "  --inject-dir <dir>      Inject into all skills in directory"
    echo "  --strip <SKILL.md>      Remove trace from one skill"
    echo "  --strip-dir <dir>       Remove all traces in directory"
    echo "  --status                Show trace status and log info"
    echo "  --rotate                Rotate activation log file"
}

case "${1:-}" in
    --inject)
        [ "$#" -eq 2 ] || { echo "Usage: skill-trace.sh --inject <SKILL.md>" >&2; exit 2; }
        inject_trace "$2"
        ;;
    --inject-dir)
        [ "$#" -eq 2 ] || { echo "Usage: skill-trace.sh --inject-dir <directory>" >&2; exit 2; }
        inject_dir "$2"
        ;;
    --strip)
        [ "$#" -eq 2 ] || { echo "Usage: skill-trace.sh --strip <SKILL.md>" >&2; exit 2; }
        strip_trace "$2"
        ;;
    --strip-dir)
        [ "$#" -eq 2 ] || { echo "Usage: skill-trace.sh --strip-dir <directory>" >&2; exit 2; }
        strip_dir "$2"
        ;;
    --status)
        [ "$#" -eq 1 ] || { echo "Usage: skill-trace.sh --status" >&2; exit 2; }
        show_status
        ;;
    --rotate)
        [ "$#" -eq 1 ] || { echo "Usage: skill-trace.sh --rotate" >&2; exit 2; }
        init_home_paths || exit 2
        if [ -f "$LOG_FILE" ]; then
            rotated="$DEBUG_DIR/activation-$(date +%Y%m%d-%H%M%S).jsonl"
            mv "$LOG_FILE" "$rotated"
            echo -e "${GREEN}Rotated to:${NC} $rotated"
        else
            echo "No log file to rotate."
        fi
        ;;
    --help|-h|"")
        [ "$#" -le 1 ] || { echo "Usage: skill-trace.sh --help" >&2; exit 2; }
        show_help
        ;;
    *)
        echo "[ERROR] Unknown option: $1" >&2
        exit 2
        ;;
esac
