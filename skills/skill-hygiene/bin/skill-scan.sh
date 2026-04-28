#!/usr/bin/env bash
# skill-scan.sh — Agent Skills fact collector for AI-driven hygiene analysis
#
# Collects structured data about installed skills. Does NOT score or judge.
# The AI reads this output and applies expert judgment.
#
# Usage:
#   bash skill-scan.sh                    # Full scan, table + JSON output
#   bash skill-scan.sh --stale-days 365   # Custom staleness threshold
#   bash skill-scan.sh --json             # JSON only (for AI consumption)
#   bash skill-scan.sh --scope all        # Include non-global directories

set -o pipefail

# ── Config ────────────────────────────────────────────────────────────
HOME_DIR="${HOME:-$(eval echo ~$(whoami))}"
REPORT_DIR="$HOME_DIR/.agents/skills-report"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
REPORT_JSON="$REPORT_DIR/scan-$TIMESTAMP.json"
STALE_DAYS=180
JSON_ONLY=false

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Agent directories to scan (these are the ACTIVE directories)
AGENT_DIRS=(
    "$HOME_DIR/.agents/skills"
    "$HOME_DIR/.claude/skills"
    "$HOME_DIR/.cursor/skills"
    "$HOME_DIR/.cursor/skills-cursor"
    "$HOME_DIR/.codex/skills"
    "$HOME_DIR/.warp/skills"
    "$HOME_DIR/.gemini/skills"
    "$HOME_DIR/.copilot/skills"
    "$HOME_DIR/.factory/skills"
    "$HOME_DIR/.github/skills"
    "$HOME_DIR/.opencode/skills"
)

# ── Parse Args ────────────────────────────────────────────────────────
show_help() {
    echo "skill-scan.sh — Agent Skills fact collector for AI-driven hygiene analysis"
    echo ""
    echo "Usage:"
    echo "  bash skill-scan.sh                    # Full scan, table + JSON output"
    echo "  bash skill-scan.sh --stale-days 365   # Custom staleness threshold"
    echo "  bash skill-scan.sh --json             # JSON only (for AI consumption)"
    echo ""
    echo "Options:"
    echo "  --stale-days N   Override stale threshold (default: 180 days)"
    echo "  --json           Output JSON only (for programmatic use)"
    echo "  --help           Show this help message"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stale-days) STALE_DAYS="$2"; shift 2 ;;
        --json) JSON_ONLY=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) shift ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────
mkdir -p "$REPORT_DIR"

get_frontmatter() {
    local file="$1" key="$2"
    sed -n '/^---$/,/^---$/p' "$file" 2>/dev/null | grep "^${key}:" | head -1 | sed "s/^${key}:[[:space:]]*//" | sed 's/^["'"'"']//' | sed 's/["'"'"']$//' | head -c 300
}

count_content_words() {
    sed '1,/^---$/d; 1,/^---$/d' "$1" 2>/dev/null | wc -w | tr -d ' '
}

get_mtime() {
    stat -f "%m" "$1" 2>/dev/null || stat -c "%Y" "$1" 2>/dev/null || echo 0
}

# Resolve symlink chain and classify entry type
classify_entry() {
    local path="$1"
    if [ -L "$path" ]; then
        local target
        target=$(readlink "$path" 2>/dev/null)
        local resolved
        resolved=$(cd "$(dirname "$path")" && cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")
        if [ -d "$resolved" ] || [ -d "$path" ]; then
            echo "symlink|$target"
        else
            echo "broken_symlink|$target"
        fi
    elif [ -d "$path" ]; then
        echo "directory|"
    else
        echo "file|"
    fi
}

# ── Topology Scanner ──────────────────────────────────────────────────
scan_directory() {
    local dir="$1"
    local dir_label="$2"
    local results="[]"

    [ ! -d "$dir" ] && echo "$results" && return

    # List all entries (including broken symlinks) using a single pass
    local _seen=""
    for entry_path in "$dir"/*; do
        [ -e "$entry_path" ] || [ -L "$entry_path" ] || continue
        # Only process directories and symlinks (skip regular files)
        [ -d "$entry_path" ] || [ -L "$entry_path" ] || continue
        local entry_name
        entry_name=$(basename "$entry_path")
        # Dedup (in case glob expands same entry twice)
        echo "$_seen" | grep -qx "$entry_name" && continue
        _seen="${_seen}${entry_name}
"

        # Skip hidden entries
        [[ "$entry_name" == .* ]] && continue

        local classification
        classification=$(classify_entry "$entry_path")
        local entry_type="${classification%%|*}"
        local link_target="${classification#*|}"

        # For broken symlinks, record and skip (no SKILL.md to read)
        if [ "$entry_type" = "broken_symlink" ]; then
            local entry_json
            entry_json=$(jq -n \
                --arg name "$entry_name" \
                --arg dir_name "$entry_name" \
                --arg location "$dir_label" \
                --arg entry_type "broken_symlink" \
                --arg link_target "$link_target" \
                '{name: $name, dir_name: $dir_name, location: $location, type: $entry_type, link_target: $link_target, description: "", word_count: 0, age_days: 0, flags: ["broken_symlink"]}')
            results=$(echo "$results" | jq --argjson e "$entry_json" '. + [$e]')
            continue
        fi

        local entry="${entry_path%/}/"
        local skill_file="$entry/SKILL.md"
        [ -f "${entry_path}/SKILL.md" ] && skill_file="${entry_path}/SKILL.md"
        [ ! -f "$skill_file" ] && continue

        local name
        name=$(get_frontmatter "$skill_file" "name")
        local desc
        desc=$(get_frontmatter "$skill_file" "description")
        local word_count
        word_count=$(count_content_words "$skill_file")
        local mtime
        mtime=$(get_mtime "$skill_file")
        local now
        now=$(date +%s)
        local age_days=$(( (now - mtime) / 86400 ))

        # Detect known patterns
        local flags=()

        # Backup/archive remnant
        if echo "$entry_name" | grep -qE '\.backup\.|\.disabled|\.tmp|\.old'; then
            flags+=("backup_remnant")
        fi

        # Check frontmatter
        [ -z "$name" ] && flags+=("no_name")
        [ -z "$desc" ] && flags+=("no_description")

        # Size flags (informational only)
        [ "$word_count" -lt 30 ] && flags+=("very_small")
        [ "$word_count" -gt 5000 ] && flags+=("very_large")

        # Age flag
        [ "$age_days" -gt "$STALE_DAYS" ] && flags+=("stale_${age_days}d")

        # Security quick-check (informational flags)
        local content
        content=$(cat "$skill_file" 2>/dev/null)
        echo "$content" | grep -qE 'curl.*\| ?bash|wget.*\| ?sh' && flags+=("pipe_to_shell")
        echo "$content" | grep -qE 'rm -rf /|sudo ' && flags+=("dangerous_cmd")
        echo "$content" | grep -qE 'API_KEY=|TOKEN=|SECRET=' && flags+=("possible_secret")

        # Broken internal references
        local broken_refs=()
        local refs
        refs=$(grep -oE '@[a-zA-Z0-9_.-]+\.(md|sh|py|js)' "$skill_file" 2>/dev/null)
        if [ -n "$refs" ]; then
            while IFS= read -r ref; do
                local ref_path="$(dirname "$skill_file")/${ref#@}"
                [ ! -f "$ref_path" ] && broken_refs+=("$ref")
            done <<< "$refs"
        fi
        [ ${#broken_refs[@]} -gt 0 ] && flags+=("broken_refs:${broken_refs[*]}")

        local flags_json
        if [ ${#flags[@]} -eq 0 ]; then
            flags_json='[]'
        else
            flags_json=$(printf '%s\n' "${flags[@]}" | jq -R . 2>/dev/null | jq -s . 2>/dev/null || echo '[]')
        fi

        local entry_json
        entry_json=$(jq -n \
            --arg name "${name:-$entry_name}" \
            --arg dir_name "$entry_name" \
            --arg location "$dir_label" \
            --arg entry_type "$entry_type" \
            --arg link_target "$link_target" \
            --arg desc "${desc:0:200}" \
            --argjson words "$word_count" \
            --argjson age "$age_days" \
            --argjson flags "$flags_json" \
            '{
                name: $name, dir_name: $dir_name, location: $location,
                type: $entry_type, link_target: $link_target,
                description: $desc, word_count: $words, age_days: $age,
                flags: $flags
            }')

        results=$(echo "$results" | jq --argjson e "$entry_json" '. + [$e]')
    done

    echo "$results"
}

# ── Main ──────────────────────────────────────────────────────────────
main() {
    if ! $JSON_ONLY; then
        echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}║     Agent Skills Inventory Scanner v2.0      ║${NC}"
        echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  ${DIM}Staleness threshold: ${STALE_DAYS} days${NC}"
        echo ""
    fi

    # ── Collect data from each directory ──
    local all_data='{"topology":{},"skills":[],"broken_symlinks":[]}'

    for dir in "${AGENT_DIRS[@]}"; do
        [ ! -d "$dir" ] && continue
        local label="${dir#$HOME_DIR/}"
        local dir_data
        dir_data=$(scan_directory "$dir" "$label")

        # Count entries by type
        local total
        total=$(echo "$dir_data" | jq 'length')
        local symlinks
        symlinks=$(echo "$dir_data" | jq '[.[] | select(.type == "symlink")] | length')
        local native
        native=$(echo "$dir_data" | jq '[.[] | select(.type == "directory")] | length')
        local broken
        broken=$(echo "$dir_data" | jq '[.[] | select(.type == "broken_symlink")] | length')

        # Add to topology
        all_data=$(echo "$all_data" | jq \
            --arg label "$label" \
            --argjson total "$total" \
            --argjson symlinks "$symlinks" \
            --argjson native "$native" \
            --argjson broken "$broken" \
            '.topology[$label] = {total: $total, symlinks: $symlinks, native: $native, broken_symlinks: $broken}')

        # Add skills (only canonical + native, skip symlinks to avoid double-counting)
        all_data=$(echo "$all_data" | jq --argjson d "$dir_data" '
            .skills += [$d[] | select(.type != "symlink")] |
            .broken_symlinks += [$d[] | select(.type == "broken_symlink")]
        ')
    done

    # Save JSON
    echo "$all_data" | jq '.' > "$REPORT_JSON"

    if $JSON_ONLY; then
        cat "$REPORT_JSON"
        return
    fi

    # ── Terminal Output ──

    # Topology map
    echo -e "${BOLD}── Topology Map ──${NC}"
    echo "$all_data" | jq -r '.topology | to_entries[] | "\(.key)|\(.value.total)|\(.value.native)|\(.value.symlinks)|\(.value.broken_symlinks)"' | while IFS='|' read -r loc total native sym broken; do
        printf "  %-30s %3d total  (%d native, %d symlinks" "$loc" "$total" "$native" "$sym"
        if [ "$broken" -gt 0 ]; then
            printf ", ${RED}%d broken${NC}" "$broken"
        fi
        echo ")"
    done
    echo ""

    # Canonical skills summary
    local canonical_count
    canonical_count=$(echo "$all_data" | jq '[.skills[] | select(.location == ".agents/skills")] | length')
    local total_skills
    total_skills=$(echo "$all_data" | jq '.skills | length')
    echo -e "${BOLD}── Skill Inventory ──${NC}"
    echo -e "  Canonical skills (in .agents/skills): ${BOLD}$canonical_count${NC}"
    echo -e "  Native agent-specific skills:         ${BOLD}$((total_skills - canonical_count))${NC}"
    echo -e "  Total unique skills:                  ${BOLD}$total_skills${NC}"
    echo ""

    # Findings table — flags
    local flagged
    flagged=$(echo "$all_data" | jq '[.skills[] | select(.flags | length > 0)]')
    local flagged_count
    flagged_count=$(echo "$flagged" | jq 'length')

    if [ "$flagged_count" -gt 0 ]; then
        echo -e "${BOLD}── Flagged Skills ──${NC}"
        printf "  ${DIM}%-30s %-20s %-8s %s${NC}\n" "NAME" "LOCATION" "WORDS" "FLAGS"
        printf "  ${DIM}%-30s %-20s %-8s %s${NC}\n" "----" "--------" "-----" "-----"
        echo "$flagged" | jq -r '.[] | "\(.name)|\(.location)|\(.word_count)|\(.flags | join(", "))"' | while IFS='|' read -r name loc words flags; do
            # Color based on severity
            local color="$YELLOW"
            echo "$flags" | grep -qE 'broken_|dangerous_|pipe_to_shell|possible_secret' && color="$RED"
            echo "$flags" | grep -qE 'backup_remnant' && color="$YELLOW"
            printf "  ${color}%-30s${NC} %-20s %-8s %s\n" "${name:0:30}" "${loc:0:20}" "$words" "$flags"
        done
        echo ""
    fi

    # Broken symlinks
    local broken_count
    broken_count=$(echo "$all_data" | jq '.broken_symlinks | length')
    if [ "$broken_count" -gt 0 ]; then
        echo -e "${RED}${BOLD}── Broken Symlinks ──${NC}"
        echo "$all_data" | jq -r '.broken_symlinks[] | "  \(.dir_name) in \(.location) → \(.link_target)"'
        echo ""
    fi

    # Backup remnants
    local backups
    backups=$(echo "$all_data" | jq -r '[.skills[] | select(.flags[] | startswith("backup"))] | .[] | "  \(.dir_name) in \(.location) (\(.age_days)d old, \(.word_count)w)"')
    if [ -n "$backups" ]; then
        echo -e "${YELLOW}${BOLD}── Backup/Archive Remnants ──${NC}"
        echo "$backups"
        echo ""
    fi

    # Size distribution
    echo -e "${BOLD}── Size Distribution ──${NC}"
    local tiny
    tiny=$(echo "$all_data" | jq '[.skills[] | select(.word_count < 30)] | length')
    local small
    small=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 30 and .word_count < 200)] | length')
    local medium
    medium=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 200 and .word_count < 1000)] | length')
    local large
    large=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 1000 and .word_count < 5000)] | length')
    local xlarge
    xlarge=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 5000)] | length')
    echo "  <30w (stub?):     $tiny"
    echo "  30-200w (compact): $small"
    echo "  200-1000w (typical): $medium"
    echo "  1000-5000w (large):  $large"
    echo "  >5000w (very large): $xlarge"
    echo ""

    # Age distribution
    echo -e "${BOLD}── Age Distribution ──${NC}"
    local fresh
    fresh=$(echo "$all_data" | jq --argjson s "$STALE_DAYS" '[.skills[] | select(.age_days <= 30)] | length')
    local recent
    recent=$(echo "$all_data" | jq '[.skills[] | select(.age_days > 30 and .age_days <= 90)] | length')
    local mature
    mature=$(echo "$all_data" | jq --argjson s "$STALE_DAYS" '[.skills[] | select(.age_days > 90 and .age_days <= $s)] | length')
    local stale
    stale=$(echo "$all_data" | jq --argjson s "$STALE_DAYS" '[.skills[] | select(.age_days > $s)] | length')
    echo "  ≤30 days (fresh):   $fresh"
    echo "  31-90 days:         $recent"
    echo "  91-${STALE_DAYS} days:       $mature"
    echo "  >${STALE_DAYS} days (stale):  $stale"
    echo ""

    echo -e "${GREEN}[OK]${NC} Scan complete. JSON: ${CYAN}$REPORT_JSON${NC}"
    echo -e "${DIM}Feed this JSON to the AI for expert analysis.${NC}"
}

main "$@"
