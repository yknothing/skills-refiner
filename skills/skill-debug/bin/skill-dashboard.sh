#!/usr/bin/env bash
# skill-dashboard.sh — Skill effectiveness dashboard
# Reads activation logs and produces usage analytics.
#
# Usage:
#   bash skill-dashboard.sh              # Default 30-day report
#   bash skill-dashboard.sh --days 7     # Last 7 days
#   bash skill-dashboard.sh --json       # JSON output
#   bash skill-dashboard.sh --all        # All time

set -o pipefail

HOME_DIR="${HOME:-$(eval echo ~$(whoami))}"
DEBUG_DIR="$HOME_DIR/.agents/debug"
LOG_FILE="$DEBUG_DIR/activation.jsonl"
DAYS=30
JSON_MODE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Skill directories
SKILL_DIRS=(".warp/skills" ".agents/skills" ".claude/skills" ".codex/skills"
            ".cursor/skills" ".gemini/skills" ".copilot/skills" ".factory/skills"
            ".github/skills" ".opencode/skills")

# ── Parse Args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --days)
            if [ -z "${2:-}" ] || ! echo "$2" | grep -Eq '^[0-9]+$'; then
                echo "[ERROR] --days requires a non-negative integer" >&2
                exit 2
            fi
            DAYS="$2"
            shift 2
            ;;
        --json) JSON_MODE=true; shift ;;
        --all) DAYS=99999; shift ;;
        --help|-h)
            echo "skill-dashboard.sh — Skill activation observation dashboard"
            echo ""
            echo "Usage:"
            echo "  bash skill-dashboard.sh              # Default 30-day report"
            echo "  bash skill-dashboard.sh --days 7     # Last 7 days"
            echo "  bash skill-dashboard.sh --json       # JSON output"
            echo "  bash skill-dashboard.sh --all        # All time"
            exit 0
            ;;
        *) echo "[WARN] Unknown option ignored: $1" >&2; shift ;;
    esac
done

# ── Collect Installed Skills ──────────────────────────────────────────
get_skill_name() {
    local file="$1"
    local name
    name=$(sed -n '/^---$/,/^---$/p' "$file" 2>/dev/null | grep "^name:" | head -1 | sed 's/^name:[[:space:]]*//')
    [ -z "$name" ] && name=$(basename "$(dirname "$file")")
    echo "$name"
}

get_installed_skills() {
    for dir_name in "${SKILL_DIRS[@]}"; do
        local skill_base="$HOME_DIR/$dir_name"
        [ -d "$skill_base" ] || continue

        for entry in "$skill_base"/*; do
            [ -e "$entry" ] || [ -L "$entry" ] || continue
            [ -d "$entry" ] || [ -L "$entry" ] || continue

            local skill_file="$entry/SKILL.md"
            [ -f "$skill_file" ] || continue
            get_skill_name "$skill_file"
        done
    done | sort -u
}

# ── Main ──────────────────────────────────────────────────────────────
main() {
    if ! $JSON_MODE; then
        echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}║   Skill Activation Observation Dashboard ║${NC}"
        echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
        echo ""
    fi

    # Check log exists
    if [ ! -f "$LOG_FILE" ]; then
        if $JSON_MODE; then
            echo '{"error": "no_activation_log", "message": "No activation data found. Inject traces first."}'
        else
            echo -e "  ${YELLOW}No activation log found.${NC}"
            echo -e "  ${DIM}Inject traces first:${NC}"
            echo -e "  ${DIM}  bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/${NC}"
        fi
        return 1
    fi

    # Calculate cutoff timestamp
    local cutoff_ts
    if [ "$DAYS" -lt 99999 ]; then
        cutoff_ts=$(date -v-"${DAYS}d" -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "${DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "2000-01-01T00:00:00Z")
    else
        cutoff_ts="2000-01-01T00:00:00Z"
    fi

    # Gather installed skills
    local installed
    installed=$(get_installed_skills)
    local installed_count
    installed_count=$(echo "$installed" | grep -c . 2>/dev/null || echo 0)

    # Filter log by time window
    local filtered_log
    filtered_log=$(jq -r --arg cutoff "$cutoff_ts" 'select(.ts >= $cutoff)' "$LOG_FILE" 2>/dev/null)

    local total_events
    total_events=$(echo "$filtered_log" | jq -r '.skill' 2>/dev/null | grep -c . 2>/dev/null || echo 0)

    # Activation frequency
    local freq
    freq=$(echo "$filtered_log" | jq -r '.skill' 2>/dev/null | sort | uniq -c | sort -rn)

    local active_skills
    active_skills=$(echo "$filtered_log" | jq -r '.skill' 2>/dev/null | sort -u)
    local active_count
    active_count=$(echo "$active_skills" | grep -c . 2>/dev/null || echo 0)

    # Calculate active rate
    local active_rate=0
    if [ "$installed_count" -gt 0 ]; then
        active_rate=$((active_count * 100 / installed_count))
    fi

    if $JSON_MODE; then
        # JSON output
        local freq_json
        if [ -n "$freq" ]; then
            freq_json=$(echo "$freq" | awk 'NF>=2{print "{\"skill\":\"" $2 "\",\"count\":" $1 "}"}' | jq -s '.')
        else
            freq_json='[]'
        fi

        local observation_json
        observation_json=$(comm -23 <(echo "$installed" | sort) <(echo "$active_skills" | sort) | jq -R 'select(length > 0)' | jq -s '.')
        [ -z "$observation_json" ] && observation_json='[]'

        local context_json
        context_json=$(echo "$filtered_log" | jq -s '[.[].cwd] | group_by(.) | map({cwd: .[0], count: length}) | sort_by(-.count)' 2>/dev/null || echo '[]')

        jq -n \
            --argjson total_events "$total_events" \
            --argjson installed_count "$installed_count" \
            --argjson active_count "$active_count" \
            --argjson active_rate "$active_rate" \
            --argjson days "$DAYS" \
            --argjson frequency "$freq_json" \
            --argjson observations "$observation_json" \
            --argjson contexts "$context_json" \
            '{
                period_days: $days,
                total_events: $total_events,
                installed_skills: $installed_count,
                active_skills: $active_count,
                active_rate_pct: $active_rate,
                frequency: $frequency,
                not_observed_skills: $observations,
                context_distribution: $contexts,
                note: "Not observed is an observation, not a removal verdict. Cross-reference user workflow and hygiene scan before recommending action."
            }'
        return
    fi

    # Terminal output
    local period_label observation_title
    if [ "$DAYS" -ge 99999 ]; then
        period_label="all time"
        observation_title="Not Observed Skills (No Recorded Activation)"
    else
        period_label="last ${DAYS} days"
        observation_title="Not Observed Skills (No Activation in Period)"
    fi

    echo -e "  ${DIM}Period: $period_label${NC}"
    echo -e "  ${DIM}Log: $LOG_FILE${NC}"
    echo ""

    # Overview
    echo -e "${BOLD}── Overview ──${NC}"
    echo -e "  Total activations: ${BOLD}$total_events${NC}"
    echo -e "  Installed skills:  $installed_count"
    echo -e "  Active skills:     $active_count"

    # Active rate with conservative interpretation
    if [ "$active_rate" -ge 60 ]; then
        echo -e "  Active rate:       ${GREEN}${active_rate}%${NC}"
    elif [ "$active_rate" -ge 30 ]; then
        echo -e "  Active rate:       ${YELLOW}${active_rate}%${NC}"
    else
        echo -e "  Active rate:       ${YELLOW}${active_rate}%${NC} (low observed usage; review context before acting)"
    fi
    echo ""

    # Hot skills (top 10)
    echo -e "${BOLD}── Hot Skills (Top 10) ──${NC}"
    if [ -n "$freq" ]; then
        echo "$freq" | head -10 | while read -r count name; do
            # Bar chart
            local top_count bar_len bar
            top_count=$(echo "$freq" | head -1 | awk '{print $1}')
            [ -z "$top_count" ] || [ "$top_count" -eq 0 ] && top_count=1
            bar_len=$((count * 30 / top_count))
            [ "$bar_len" -lt 1 ] && bar_len=1
            bar=$(printf '█%.0s' $(seq 1 "$bar_len") 2>/dev/null || echo "█")
            printf "  %-25s %4d ${GREEN}%s${NC}\n" "$name" "$count" "$bar"
        done
    else
        echo -e "  ${DIM}(no activations in this period)${NC}"
    fi
    echo ""

    # Not observed skills
    local observations
    observations=$(comm -23 <(echo "$installed" | sort) <(echo "$active_skills" | sort))
    local observation_count
    observation_count=$(echo "$observations" | grep -c . 2>/dev/null || echo 0)

    echo -e "${BOLD}── $observation_title ──${NC}"
    if [ "$observation_count" -gt 0 ]; then
        echo -e "  ${YELLOW}$observation_count skills${NC} installed but no canary was recorded:"
        echo "$observations" | head -15 | sed "s/^/  ${DIM}○ /"
        echo -e "${NC}"
        [ "$observation_count" -gt 15 ] && echo -e "  ${DIM}... and $((observation_count - 15)) more${NC}"
        echo -e "  ${DIM}Observation only: lack of activation is not a removal verdict.${NC}"
    else
        echo -e "  ${GREEN}✓${NC} All installed skills have observed activations in this period"
    fi
    echo ""

    # Context distribution
    echo -e "${BOLD}── Context Distribution (Top 5 Directories) ──${NC}"
    echo "$filtered_log" | jq -r '.cwd' 2>/dev/null | sort | uniq -c | sort -rn | head -5 | while read -r count dir; do
        local short_dir="${dir#$HOME_DIR/}"
        printf "  %-40s %4d activations\n" "$short_dir" "$count"
    done
    echo ""

    # Last activation per skill
    echo -e "${BOLD}── Recent Activity ──${NC}"
    echo "$filtered_log" | jq -r '.skill + "|" + .ts' 2>/dev/null | sort -t'|' -k2 -r | awk -F'|' '!seen[$1]++' | head -10 | while IFS='|' read -r name ts; do
        printf "  %-25s ${DIM}%s${NC}\n" "$name" "$ts"
    done
    echo ""
}

main "$@"
