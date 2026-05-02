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

HOME_DIR="${HOME:-$(eval echo ~$(whoami))}"
DEBUG_DIR="$HOME_DIR/.agents/debug"
LOG_FILE="$DEBUG_DIR/activation.jsonl"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

TRACE_START="<!-- SKILL-DEBUG-TRACE-START -->"
TRACE_END="<!-- SKILL-DEBUG-TRACE-END -->"

# ── Helpers ───────────────────────────────────────────────────────────
mkdir -p "$DEBUG_DIR"

has_trace() {
    grep -q "$TRACE_START" "$1" 2>/dev/null
}

get_skill_name() {
    local file="$1"
    local name
    name=$(sed -n '/^---$/,/^---$/p' "$file" 2>/dev/null | grep "^name:" | head -1 | sed 's/^name:[[:space:]]*//')
    if [ -z "$name" ]; then
        name=$(basename "$(dirname "$file")")
    fi
    echo "$name"
}

get_frontmatter() {
    local file="$1" key="$2"
    awk -v key="$key" '
        NR == 1 && $0 == "---" { in_fm=1; next }
        in_fm && $0 == "---" { exit }
        in_fm && index($0, key ":") == 1 {
            sub("^" key ":[[:space:]]*", "")
            gsub(/^['\''\"]|['\''\"]$/, "")
            print
            exit
        }
    ' "$file" 2>/dev/null | head -c 300
}

get_metadata_value() {
    local file="$1" key="$2"
    awk -v key="$key" '
        NR == 1 && $0 == "---" { in_fm=1; next }
        in_fm && $0 == "---" { exit }
        in_fm && $0 == "metadata:" { in_meta=1; next }
        in_meta && $0 ~ /^[^[:space:]]/ { exit }
        in_meta && $0 ~ "^[[:space:]]+" key ":[[:space:]]*" {
            sub("^[[:space:]]+" key ":[[:space:]]*", "")
            gsub(/^['\''\"]|['\''\"]$/, "")
            print
            exit
        }
    ' "$file" 2>/dev/null | head -c 300
}

resolve_canonical_file() {
    local file="$1"
    local dir base resolved_dir
    dir=$(dirname "$file")
    base=$(basename "$file")
    resolved_dir=$(cd -P "$dir" 2>/dev/null && pwd) || return 1
    printf '%s/%s\n' "$resolved_dir" "$base"
}

source_kind_for_canonical_dir() {
    local canonical_dir="$1"
    if [[ "$canonical_dir" == "$HOME_DIR/.agents/skills/"* ]]; then
        echo "canonical_global"
    elif [[ "$canonical_dir" == "$HOME_DIR/."*"/skills/"* ]]; then
        echo "native_agent"
    else
        echo "direct_file"
    fi
}

# ── Inject Trace ──────────────────────────────────────────────────────
inject_trace() {
    local skill_file="$1"

    if [ ! -f "$skill_file" ]; then
        echo -e "${RED}[ERROR]${NC} File not found: $skill_file"
        return 1
    fi

    if has_trace "$skill_file"; then
        echo -e "${DIM}[SKIP]${NC} Already has trace: $skill_file"
        return 0
    fi

    local skill_name
    skill_name=$(get_skill_name "$skill_file")

    local source_skill_file canonical_skill_file canonical_dir top_version metadata_version declared_version provenance_kind
    source_skill_file=$(cd "$(dirname "$skill_file")" 2>/dev/null && pwd)/$(basename "$skill_file")
    canonical_skill_file=$(resolve_canonical_file "$skill_file" 2>/dev/null || echo "$skill_file")
    canonical_dir=$(dirname "$canonical_skill_file")
    top_version=$(get_frontmatter "$skill_file" "version")
    metadata_version=$(get_metadata_value "$skill_file" "version")
    declared_version="${metadata_version:-$top_version}"
    provenance_kind=$(source_kind_for_canonical_dir "$canonical_dir")

    # Build the trace block
    local trace_block
    trace_block=$(cat << 'TRACEEOF'

## Activation Canary Trace (auto-injected by skill-debug)
<!-- SKILL-DEBUG-TRACE-START -->
When this skill is used, run this canary command first:
```bash
_skill_debug_file="__CANONICAL_SKILL_FILE__"
_skill_debug_hash=""
if command -v sha256sum >/dev/null 2>&1; then
  _skill_debug_hash=$(sha256sum "$_skill_debug_file" 2>/dev/null | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  _skill_debug_hash=$(shasum -a 256 "$_skill_debug_file" 2>/dev/null | awk '{print $1}')
fi
if command -v sha256sum >/dev/null 2>&1; then
  _skill_debug_id=$(printf '%s|%s' "$_skill_debug_file" "$_skill_debug_hash" | sha256sum | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  _skill_debug_id=$(printf '%s|%s' "$_skill_debug_file" "$_skill_debug_hash" | shasum -a 256 | awk '{print $1}')
else
  _skill_debug_id="$_skill_debug_file|$_skill_debug_hash"
fi
mkdir -p ~/.agents/debug && echo '{"event":"skill_canary_observed","trace_schema":"skill-debug.identity.v1","trace_kind":"canary","skill":"__SKILL_NAME__","skill_name":"__SKILL_NAME__","identity_key":"'"$_skill_debug_id"'","canonical_skill_file":"__CANONICAL_SKILL_FILE__","canonical_dir":"__CANONICAL_DIR__","declared_version":"__DECLARED_VERSION__","content_sha256":"'"$_skill_debug_hash"'","provenance_kind":"__PROVENANCE_KIND__","entry_path":"__SOURCE_SKILL_FILE__","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","cwd":"'$(pwd)'"}' >> ~/.agents/debug/activation.jsonl
```
<!-- SKILL-DEBUG-TRACE-END -->
TRACEEOF
)

    # Replace placeholder with actual skill name
    trace_block="${trace_block//__SKILL_NAME__/$skill_name}"
    trace_block="${trace_block//__CANONICAL_SKILL_FILE__/$canonical_skill_file}"
    trace_block="${trace_block//__CANONICAL_DIR__/$canonical_dir}"
    trace_block="${trace_block//__DECLARED_VERSION__/$declared_version}"
    trace_block="${trace_block//__PROVENANCE_KIND__/$provenance_kind}"
    trace_block="${trace_block//__SOURCE_SKILL_FILE__/$source_skill_file}"

    # Find the end of frontmatter and inject after it
    local fm_end
    fm_end=$(awk '/^---$/{c++; if(c==2){print NR; exit}}' "$skill_file")

    if [ -n "$fm_end" ]; then
        # Insert after the second --- line
        local tmp
        tmp=$(mktemp)
        head -n "$fm_end" "$skill_file" > "$tmp"
        echo "$trace_block" >> "$tmp"
        tail -n "+$((fm_end + 1))" "$skill_file" >> "$tmp"
        mv "$tmp" "$skill_file"
    else
        # No frontmatter, prepend
        local tmp
        tmp=$(mktemp)
        echo "$trace_block" > "$tmp"
        cat "$skill_file" >> "$tmp"
        mv "$tmp" "$skill_file"
    fi

    echo -e "${GREEN}[INJECTED]${NC} $skill_name → $skill_file"
}

# ── Strip Trace ───────────────────────────────────────────────────────
strip_trace() {
    local skill_file="$1"

    if [ ! -f "$skill_file" ]; then
        echo -e "${RED}[ERROR]${NC} File not found: $skill_file"
        return 1
    fi

    if ! has_trace "$skill_file"; then
        echo -e "${DIM}[SKIP]${NC} No trace found: $skill_file"
        return 0
    fi

    local skill_name
    skill_name=$(get_skill_name "$skill_file")

    # Remove everything between trace markers (inclusive), plus the preceding header
    local tmp
    tmp=$(mktemp)
    awk '
        /## Activation (Canary )?Trace \(auto-injected/ { skip=1; next }
        /<!-- SKILL-DEBUG-TRACE-START -->/ { skip=1; next }
        /<!-- SKILL-DEBUG-TRACE-END -->/ { skip=0; next }
        !skip { print }
    ' "$skill_file" > "$tmp"

    # Clean up any trailing blank lines from removal
    sed -i '' -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$tmp" 2>/dev/null || true
    mv "$tmp" "$skill_file"

    echo -e "${YELLOW}[STRIPPED]${NC} $skill_name → $skill_file"
}

# ── Directory Operations ──────────────────────────────────────────────
inject_dir() {
    local dir="$1"
    local count=0

    echo -e "${BOLD}Injecting traces into: $dir${NC}"
    while IFS= read -r f; do
        inject_trace "$f"
        count=$((count + 1))
    done < <(find "$dir" -maxdepth 3 -name "SKILL.md" -type f 2>/dev/null)

    echo -e "\n${GREEN}Done.${NC} Processed $count skill files."
}

strip_dir() {
    local dir="$1"
    local count=0

    echo -e "${BOLD}Stripping traces from: $dir${NC}"
    while IFS= read -r f; do
        strip_trace "$f"
        count=$((count + 1))
    done < <(find "$dir" -maxdepth 3 -name "SKILL.md" -type f 2>/dev/null)

    echo -e "\n${YELLOW}Done.${NC} Processed $count skill files."
}

# ── Status ────────────────────────────────────────────────────────────
show_status() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║        Skill Trace Status v1.0           ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""

    local traced=0
    local total=0

    echo -e "${BOLD}── Traced Skills ──${NC}"
    # Only scan agent-recognized skill directories, not all of $HOME
    for _sd in .agents/skills .claude/skills .cursor/skills .codex/skills .warp/skills .gemini/skills .copilot/skills .factory/skills .github/skills .opencode/skills; do
        [ -d "$HOME_DIR/$_sd" ] || continue
        find "$HOME_DIR/$_sd" -maxdepth 3 -name "SKILL.md" -type f 2>/dev/null
    done | while IFS= read -r f; do
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
case "${1:-}" in
    --inject)
        [ -z "$2" ] && { echo "Usage: skill-trace.sh --inject <SKILL.md>"; exit 1; }
        inject_trace "$2"
        ;;
    --inject-dir)
        [ -z "$2" ] && { echo "Usage: skill-trace.sh --inject-dir <directory>"; exit 1; }
        inject_dir "$2"
        ;;
    --strip)
        [ -z "$2" ] && { echo "Usage: skill-trace.sh --strip <SKILL.md>"; exit 1; }
        strip_trace "$2"
        ;;
    --strip-dir)
        [ -z "$2" ] && { echo "Usage: skill-trace.sh --strip-dir <directory>"; exit 1; }
        strip_dir "$2"
        ;;
    --status)
        show_status
        ;;
    --rotate)
        if [ -f "$LOG_FILE" ]; then
            rotated="$DEBUG_DIR/activation-$(date +%Y%m%d-%H%M%S).jsonl"
            mv "$LOG_FILE" "$rotated"
            echo -e "${GREEN}Rotated to:${NC} $rotated"
        else
            echo "No log file to rotate."
        fi
        ;;
    *)
        echo "skill-trace.sh — Skill activation trace manager"
        echo ""
        echo "Usage:"
        echo "  --inject <SKILL.md>     Inject trace into one skill"
        echo "  --inject-dir <dir>      Inject into all skills in directory"
        echo "  --strip <SKILL.md>      Remove trace from one skill"
        echo "  --strip-dir <dir>       Remove all traces in directory"
        echo "  --status                Show trace status and log info"
        echo "  --rotate                Rotate activation log file"
        ;;
esac
