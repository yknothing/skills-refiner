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

# Agent-recognized directories to scan. These are active consumption surfaces,
# not arbitrary workspace/project directories.
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
    echo "  bash skill-scan.sh --json             # JSON only (for programmatic use)"
    echo ""
    echo "Options:"
    echo "  --stale-days N   Override stale threshold (default: 180 days)"
    echo "  --json           Output JSON only (for programmatic use)"
    echo "  --help, -h       Show this help message"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stale-days)
            if [ -z "${2:-}" ] || ! echo "$2" | grep -Eq '^[0-9]+$'; then
                echo "[ERROR] --stale-days requires a non-negative integer" >&2
                exit 2
            fi
            STALE_DAYS="$2"
            shift 2
            ;;
        --json) JSON_ONLY=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "[WARN] Unknown option ignored: $1" >&2; shift ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────
mkdir -p "$REPORT_DIR"

if ! command -v jq >/dev/null 2>&1; then
    echo "[ERROR] jq is required for JSON output and aggregation. Install jq and retry." >&2
    exit 127
fi

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

count_content_words() {
    awk '
        NR == 1 && $0 == "---" { in_fm=1; next }
        in_fm && $0 == "---" { in_fm=0; next }
        !in_fm { print }
    ' "$1" 2>/dev/null | wc -w | tr -d ' '
}

get_mtime() {
    # GNU stat first, then BSD/macOS stat.
    stat -c "%Y" "$1" 2>/dev/null || stat -f "%m" "$1" 2>/dev/null || echo 0
}

resolve_symlink_target() {
    local path="$1" target="$2"
    local base_dir target_dir target_name resolved_dir
    base_dir=$(cd "$(dirname "$path")" 2>/dev/null && pwd) || return 1
    target_dir=$(dirname "$target")
    target_name=$(basename "$target")
    resolved_dir=$(cd "$base_dir/$target_dir" 2>/dev/null && pwd) || return 1
    printf '%s/%s\n' "$resolved_dir" "$target_name"
}

canonical_dir_for_entry() {
    local path="$1" entry_type="$2" link_target="$3"
    if [ "$entry_type" = "symlink" ]; then
        resolve_symlink_target "$path" "$link_target" 2>/dev/null || return 1
    else
        cd "$path" 2>/dev/null && pwd
    fi
}

# Resolve symlink chain and classify entry type.
classify_entry() {
    local path="$1"
    if [ -L "$path" ]; then
        local target resolved
        target=$(readlink "$path" 2>/dev/null)
        resolved=$(resolve_symlink_target "$path" "$target" 2>/dev/null || true)
        if [ -n "$resolved" ] && [ -d "$resolved" ]; then
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

    local _seen=""
    for entry_path in "$dir"/*; do
        [ -e "$entry_path" ] || [ -L "$entry_path" ] || continue
        [ -d "$entry_path" ] || [ -L "$entry_path" ] || continue
        local entry_name
        entry_name=$(basename "$entry_path")
        echo "$_seen" | grep -qx "$entry_name" && continue
        _seen="${_seen}${entry_name}
"

        [[ "$entry_name" == .* ]] && continue

        local classification entry_type link_target
        classification=$(classify_entry "$entry_path")
        entry_type="${classification%%|*}"
        link_target="${classification#*|}"

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

        local canonical_dir skill_file source_skill_file canonical_skill_file
        canonical_dir=$(canonical_dir_for_entry "$entry_path" "$entry_type" "$link_target" 2>/dev/null || true)
        [ -z "$canonical_dir" ] && continue

        skill_file="$canonical_dir/SKILL.md"
        source_skill_file="$entry_path/SKILL.md"
        canonical_skill_file="$skill_file"
        [ ! -f "$skill_file" ] && continue

        local name desc word_count mtime now age_days
        name=$(get_frontmatter "$skill_file" "name")
        desc=$(get_frontmatter "$skill_file" "description")
        word_count=$(count_content_words "$skill_file")
        mtime=$(get_mtime "$skill_file")
        now=$(date +%s)
        age_days=$(( (now - mtime) / 86400 ))

        local flags=()

        if echo "$entry_name" | grep -qE '\.backup\.|\.disabled|\.tmp|\.old'; then
            flags+=("backup_remnant")
        fi

        [ -z "$name" ] && flags+=("no_name")
        [ -z "$desc" ] && flags+=("no_description")

        [ "$word_count" -lt 30 ] && flags+=("very_small")
        [ "$word_count" -gt 5000 ] && flags+=("very_large")
        [ "$age_days" -gt "$STALE_DAYS" ] && flags+=("stale_${age_days}d")

        local content
        content=$(cat "$skill_file" 2>/dev/null)
        echo "$content" | grep -qE 'curl[[:space:][:graph:]]*\|[[:space:]]*(bash|sh)|wget[[:space:][:graph:]]*\|[[:space:]]*(bash|sh)' && flags+=("pipe_to_shell")
        echo "$content" | grep -qE 'rm[[:space:]]+-rf[[:space:]]+/|sudo[[:space:]]+' && flags+=("dangerous_cmd")
        echo "$content" | grep -qE '(API_KEY|TOKEN|SECRET)[[:space:]]*=' && flags+=("possible_secret")

        local broken_refs=()
        local refs
        refs=$(grep -oE '@[a-zA-Z0-9_./-]+\.(md|sh|py|js)' "$skill_file" 2>/dev/null || true)
        if [ -n "$refs" ]; then
            while IFS= read -r ref; do
                [ -z "$ref" ] && continue
                local ref_path="$(dirname "$skill_file")/${ref#@}"
                [ ! -f "$ref_path" ] && broken_refs+=("$ref")
            done <<< "$refs"
        fi
        [ ${#broken_refs[@]} -gt 0 ] && flags+=("broken_refs:${broken_refs[*]}")

        local flags_json
        if [ ${#flags[@]} -eq 0 ]; then
            flags_json='[]'
        else
            flags_json=$(printf '%s\n' "${flags[@]}" | jq -R . | jq -s .)
        fi

        local entry_json
        entry_json=$(jq -n \
            --arg name "${name:-$entry_name}" \
            --arg dir_name "$entry_name" \
            --arg location "$dir_label" \
            --arg entry_type "$entry_type" \
            --arg link_target "$link_target" \
            --arg source_skill_file "$source_skill_file" \
            --arg canonical_skill_file "$canonical_skill_file" \
            --arg desc "${desc:0:200}" \
            --argjson words "$word_count" \
            --argjson age "$age_days" \
            --argjson flags "$flags_json" \
            '{
                name: $name,
                dir_name: $dir_name,
                location: $location,
                type: $entry_type,
                link_target: $link_target,
                source_skill_file: $source_skill_file,
                canonical_skill_file: $canonical_skill_file,
                description: $desc,
                word_count: $words,
                age_days: $age,
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

    local all_data
    all_data=$(jq -n --arg scanned_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson stale_days "$STALE_DAYS" '{metadata:{scanned_at:$scanned_at, stale_days:$stale_days, scope:"agent-recognized-directories"}, topology:{}, skills:[], skill_links:[], broken_symlinks:[]}')

    for dir in "${AGENT_DIRS[@]}"; do
        [ ! -d "$dir" ] && continue
        local label="${dir#$HOME_DIR/}"
        local dir_data total symlinks native broken
        dir_data=$(scan_directory "$dir" "$label")
        total=$(echo "$dir_data" | jq 'length')
        symlinks=$(echo "$dir_data" | jq '[.[] | select(.type == "symlink")] | length')
        native=$(echo "$dir_data" | jq '[.[] | select(.type == "directory")] | length')
        broken=$(echo "$dir_data" | jq '[.[] | select(.type == "broken_symlink")] | length')

        all_data=$(echo "$all_data" | jq \
            --arg label "$label" \
            --argjson total "$total" \
            --argjson symlinks "$symlinks" \
            --argjson native "$native" \
            --argjson broken "$broken" \
            '.topology[$label] = {total: $total, symlinks: $symlinks, native: $native, broken_symlinks: $broken}')

        all_data=$(echo "$all_data" | jq --argjson d "$dir_data" '
            .skills += [$d[] | select(.type == "directory")] |
            .skill_links += [$d[] | select(.type == "symlink")] |
            .broken_symlinks += [$d[] | select(.type == "broken_symlink")]
        ')
    done

    echo "$all_data" | jq '.' > "$REPORT_JSON"

    if $JSON_ONLY; then
        cat "$REPORT_JSON"
        return
    fi

    echo -e "${BOLD}── Topology Map ──${NC}"
    echo "$all_data" | jq -r '.topology | to_entries[] | "\(.key)|\(.value.total)|\(.value.native)|\(.value.symlinks)|\(.value.broken_symlinks)"' | while IFS='|' read -r loc total native sym broken; do
        printf "  %-30s %3d total  (%d native, %d symlinks" "$loc" "$total" "$native" "$sym"
        if [ "$broken" -gt 0 ]; then
            printf ", ${RED}%d broken${NC}" "$broken"
        fi
        echo ")"
    done
    echo ""

    local canonical_count total_skills link_count
    canonical_count=$(echo "$all_data" | jq '[.skills[] | select(.location == ".agents/skills")] | length')
    total_skills=$(echo "$all_data" | jq '.skills | length')
    link_count=$(echo "$all_data" | jq '.skill_links | length')
    echo -e "${BOLD}── Skill Inventory ──${NC}"
    echo -e "  Canonical skills (in .agents/skills): ${BOLD}$canonical_count${NC}"
    echo -e "  Native agent-specific skills:         ${BOLD}$((total_skills - canonical_count))${NC}"
    echo -e "  Total unique real-directory skills:   ${BOLD}$total_skills${NC}"
    echo -e "  Symlink distribution links:           ${BOLD}$link_count${NC}"
    echo ""

    local flagged flagged_count
    flagged=$(echo "$all_data" | jq '[.skills[] | select(.flags | length > 0)]')
    flagged_count=$(echo "$flagged" | jq 'length')

    if [ "$flagged_count" -gt 0 ]; then
        echo -e "${BOLD}── Flagged Skills ──${NC}"
        printf "  ${DIM}%-30s %-20s %-8s %s${NC}\n" "NAME" "LOCATION" "WORDS" "FLAGS"
        printf "  ${DIM}%-30s %-20s %-8s %s${NC}\n" "----" "--------" "-----" "-----"
        echo "$flagged" | jq -r '.[] | "\(.name)|\(.location)|\(.word_count)|\(.flags | join(", "))"' | while IFS='|' read -r name loc words flags; do
            local color="$YELLOW"
            echo "$flags" | grep -qE 'dangerous_|pipe_to_shell|possible_secret' && color="$RED"
            printf "  ${color}%-30s${NC} %-20s %-8s %s\n" "${name:0:30}" "${loc:0:20}" "$words" "$flags"
        done
        echo ""
    fi

    local broken_count
    broken_count=$(echo "$all_data" | jq '.broken_symlinks | length')
    if [ "$broken_count" -gt 0 ]; then
        echo -e "${RED}${BOLD}── Broken Symlinks ──${NC}"
        echo "$all_data" | jq -r '.broken_symlinks[] | "  \(.dir_name) in \(.location) → \(.link_target)"'
        echo ""
    fi

    local backups
    backups=$(echo "$all_data" | jq -r '[.skills[] | select(any(.flags[]?; startswith("backup")))] | .[] | "  \(.dir_name) in \(.location) (\(.age_days)d old, \(.word_count)w)"')
    if [ -n "$backups" ]; then
        echo -e "${YELLOW}${BOLD}── Backup/Archive Remnants ──${NC}"
        echo "$backups"
        echo ""
    fi

    echo -e "${BOLD}── Size Distribution ──${NC}"
    local tiny small medium large xlarge
    tiny=$(echo "$all_data" | jq '[.skills[] | select(.word_count < 30)] | length')
    small=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 30 and .word_count < 200)] | length')
    medium=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 200 and .word_count < 1000)] | length')
    large=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 1000 and .word_count < 5000)] | length')
    xlarge=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 5000)] | length')
    echo "  <30w (possible stub): $tiny"
    echo "  30-200w (compact):   $small"
    echo "  200-1000w (typical): $medium"
    echo "  1000-5000w (large):  $large"
    echo "  >5000w (very large): $xlarge"
    echo ""

    echo -e "${BOLD}── Age Distribution ──${NC}"
    local fresh recent mature stale
    fresh=$(echo "$all_data" | jq '[.skills[] | select(.age_days <= 30)] | length')
    recent=$(echo "$all_data" | jq '[.skills[] | select(.age_days > 30 and .age_days <= 90)] | length')
    mature=$(echo "$all_data" | jq --argjson s "$STALE_DAYS" '[.skills[] | select(.age_days > 90 and .age_days <= $s)] | length')
    stale=$(echo "$all_data" | jq --argjson s "$STALE_DAYS" '[.skills[] | select(.age_days > $s)] | length')
    echo "  ≤30 days (fresh):      $fresh"
    echo "  31-90 days:            $recent"
    echo "  91-${STALE_DAYS} days:          $mature"
    echo "  >${STALE_DAYS} days (stale):     $stale"
    echo ""

    echo -e "${GREEN}[OK]${NC} Scan complete. JSON: ${CYAN}$REPORT_JSON${NC}"
    echo -e "${DIM}Feed this JSON to the AI for expert analysis. Findings are signals, not verdicts.${NC}"
}

main "$@"
