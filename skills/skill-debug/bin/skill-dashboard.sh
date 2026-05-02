#!/usr/bin/env bash
# skill-dashboard.sh — Skill canary observation dashboard
# Reads activation-canary logs and produces identity-aware observation analytics.
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

hash_string() {
    local value="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$value" | sha256sum | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        printf '%s' "$value" | shasum -a 256 | awk '{print $1}'
    else
        printf '%s' "$value" | cksum | awk '{print $1}'
    fi
}

hash_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" 2>/dev/null | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" 2>/dev/null | awk '{print $1}'
    else
        echo ""
    fi
}

canonical_file() {
    local file="$1"
    local dir base resolved_dir
    dir=$(dirname "$file")
    base=$(basename "$file")
    resolved_dir=$(cd -P "$dir" 2>/dev/null && pwd) || return 1
    printf '%s/%s\n' "$resolved_dir" "$base"
}

source_kind_for_entry() {
    local dir_name="$1" entry_type="$2"
    if [ "$entry_type" = "symlink" ]; then
        echo "symlink_distribution"
    elif [ "$dir_name" = ".agents/skills" ]; then
        echo "canonical_global"
    else
        echo "native_agent"
    fi
}

get_installed_identities() {
    local rows="[]"
    for dir_name in "${SKILL_DIRS[@]}"; do
        local skill_base="$HOME_DIR/$dir_name"
        [ -d "$skill_base" ] || continue

        for entry in "$skill_base"/*; do
            [ -e "$entry" ] || [ -L "$entry" ] || continue
            [ -d "$entry" ] || [ -L "$entry" ] || continue

            local skill_file="$entry/SKILL.md"
            [ -f "$skill_file" ] || continue

            local name canonical_skill_file canonical_dir content_sha256 identity_key entry_type top_version metadata_version declared_version provenance_kind row_json
            name=$(get_skill_name "$skill_file")
            canonical_skill_file=$(canonical_file "$skill_file" 2>/dev/null || echo "$skill_file")
            canonical_dir=$(dirname "$canonical_skill_file")
            content_sha256=$(hash_file "$canonical_skill_file")
            identity_key=$(hash_string "$canonical_skill_file|$content_sha256")
            entry_type="directory"
            [ -L "$entry" ] && entry_type="symlink"
            top_version=$(get_frontmatter "$canonical_skill_file" "version")
            metadata_version=$(get_metadata_value "$canonical_skill_file" "version")
            declared_version="${metadata_version:-$top_version}"
            provenance_kind=$(source_kind_for_entry "$dir_name" "$entry_type")

            row_json=$(jq -n \
                --arg identity_key "$identity_key" \
                --arg name "$name" \
                --arg location "$dir_name" \
                --arg entry_type "$entry_type" \
                --arg source_skill_file "$skill_file" \
                --arg canonical_skill_file "$canonical_skill_file" \
                --arg canonical_dir "$canonical_dir" \
                --arg content_sha256 "$content_sha256" \
                --arg declared_version "$declared_version" \
                --arg provenance_kind "$provenance_kind" \
                '{identity_key:$identity_key, name:$name, location:$location, type:$entry_type, source_skill_file:$source_skill_file, canonical_skill_file:$canonical_skill_file, canonical_dir:$canonical_dir, content_sha256:$content_sha256, declared_version:$declared_version, provenance_kind:$provenance_kind}')
            rows=$(echo "$rows" | jq --argjson row "$row_json" '. + [$row]')
        done
    done

    echo "$rows" | jq 'group_by(.identity_key) | map(.[0]) | sort_by(.name, .canonical_skill_file)'
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
            echo '{"error": "no_activation_log", "message": "No canary observation data found. Inject traces first."}'
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

    # Gather installed skill identities. Symlink distributions collapse to the
    # same identity as their canonical source.
    local installed
    installed=$(get_installed_identities)
    local installed_count
    installed_count=$(echo "$installed" | jq 'length')

    # Filter log by time window
    local filtered_log
    filtered_log=$(jq --arg cutoff "$cutoff_ts" 'select(.ts >= $cutoff)' "$LOG_FILE" 2>/dev/null)

    local total_events
    total_events=$(echo "$filtered_log" | jq -r '.skill // .skill_name // empty' 2>/dev/null | grep -c . 2>/dev/null || echo 0)

    local filtered_json observed_identities observed_count observed_rate frequency_json context_json not_observed_json legacy_ambiguous_json
    filtered_json=$(echo "$filtered_log" | jq -s '.')
    observed_identities=$(jq -n --argjson installed "$installed" --argjson events "$filtered_json" '
        def name_counts:
            $installed | group_by(.name) | map({key: .[0].name, value: length}) | from_entries;
        def legacy_names:
            [$events[] | select((.identity_key // "") == "" and (.skill // .skill_name // "") != "") | (.skill // .skill_name)] | unique;
        def active_ids:
            [$events[] | select((.identity_key // "") != "") | .identity_key] | unique;
        (name_counts) as $counts |
        (legacy_names) as $legacy |
        (active_ids) as $ids |
        $installed
        | map(. as $skill | $skill + {
            observed: ((($ids | index($skill.identity_key)) != null) or ((($legacy | index($skill.name)) != null) and (($counts[$skill.name] // 0) == 1))),
            observation_source: (
                if (($ids | index($skill.identity_key)) != null) then "identity"
                elif ((($legacy | index($skill.name)) != null) and (($counts[$skill.name] // 0) == 1)) then "legacy_name"
                else "none" end
            )
        })
    ')
    observed_count=$(echo "$observed_identities" | jq '[.[] | select(.observed)] | length')

    observed_rate=0
    if [ "$installed_count" -gt 0 ]; then
        observed_rate=$((observed_count * 100 / installed_count))
    fi

    frequency_json=$(jq -n --argjson events "$filtered_json" '
        [$events[] | select((.skill // .skill_name // "") != "") | {
            identity_key: (.identity_key // ""),
            skill: (.skill // .skill_name),
            canonical_skill_file: (.canonical_skill_file // ""),
            count_key: (if (.identity_key // "") != "" then .identity_key else "legacy:" + (.skill // .skill_name) end)
        }]
        | group_by(.count_key)
        | map({identity_key: .[0].identity_key, skill: .[0].skill, canonical_skill_file: .[0].canonical_skill_file, count: length, legacy: (.[0].identity_key == "")})
        | sort_by(-.count, .skill)
    ')
    [ -z "$frequency_json" ] && frequency_json='[]'

    not_observed_json=$(echo "$observed_identities" | jq '[.[] | select(.observed | not)]')
    legacy_ambiguous_json=$(jq -n --argjson installed "$installed" --argjson events "$filtered_json" '
        ($installed | group_by(.name) | map(select(length > 1) | .[0].name)) as $ambiguous_names |
        [$events[] | select((.identity_key // "") == "" and ((.skill // .skill_name // "") as $n | $ambiguous_names | index($n) != null)) | (.skill // .skill_name)] | unique
    ')
    context_json=$(echo "$filtered_log" | jq -s '[.[].cwd] | group_by(.) | map({cwd: .[0], count: length}) | sort_by(-.count)' 2>/dev/null || echo '[]')

    if $JSON_MODE; then
        jq -n \
            --argjson total_events "$total_events" \
            --argjson installed_count "$installed_count" \
            --argjson observed_count "$observed_count" \
            --argjson observed_rate "$observed_rate" \
            --argjson days "$DAYS" \
            --argjson installed "$observed_identities" \
            --argjson frequency "$frequency_json" \
            --argjson observations "$not_observed_json" \
            --argjson contexts "$context_json" \
            --argjson legacy_ambiguous "$legacy_ambiguous_json" \
            '{
                schema_version: "skill-dashboard.identity.v1",
                period_days: $days,
                total_events: $total_events,
                installed_skills: $installed_count,
                observed_canary_identities: $observed_count,
                canary_observed_identity_rate_pct: $observed_rate,
                installed_identities: $installed,
                frequency: $frequency,
                not_observed_skills: $observations,
                legacy_ambiguous_observations: $legacy_ambiguous,
                context_distribution: $contexts,
                note: "Not observed is an observation, not a removal verdict. Identity-aware canary events are stronger than legacy name-only events."
            }'
        return
    fi

    # Terminal output
    local period_label observation_title
    if [ "$DAYS" -ge 99999 ]; then
        period_label="all time"
        observation_title="Not Observed Skills (No Recorded Canary)"
    else
        period_label="last ${DAYS} days"
        observation_title="Not Observed Skills (No Canary in Period)"
    fi

    echo -e "  ${DIM}Period: $period_label${NC}"
    echo -e "  ${DIM}Log: $LOG_FILE${NC}"
    echo ""

    # Overview
    echo -e "${BOLD}── Overview ──${NC}"
    echo -e "  Total canary events: ${BOLD}$total_events${NC}"
    echo -e "  Installed skill identities:  $installed_count"
    echo -e "  Observed canary identities:  $observed_count"

    # Canary observation rate with conservative interpretation
    if [ "$observed_rate" -ge 60 ]; then
        echo -e "  Canary observed identity rate: ${GREEN}${observed_rate}%${NC}"
    elif [ "$observed_rate" -ge 30 ]; then
        echo -e "  Canary observed identity rate: ${YELLOW}${observed_rate}%${NC}"
    else
        echo -e "  Canary observed identity rate: ${YELLOW}${observed_rate}%${NC} (low canary observation; review context before acting)"
    fi
    echo ""

    echo -e "${BOLD}── Most Observed Canary Events (Top 10) ──${NC}"
    if [ "$(echo "$frequency_json" | jq 'length')" -gt 0 ]; then
        echo "$frequency_json" | jq -r '.[:10][] | "\(.count)|\(.skill)|\(.identity_key)|\(.legacy)"' | while IFS='|' read -r count name identity legacy; do
            local top_count bar_len bar
            top_count=$(echo "$frequency_json" | jq '.[0].count')
            [ -z "$top_count" ] || [ "$top_count" -eq 0 ] && top_count=1
            bar_len=$((count * 30 / top_count))
            [ "$bar_len" -lt 1 ] && bar_len=1
            bar=$(printf '█%.0s' $(seq 1 "$bar_len") 2>/dev/null || echo "█")
            local suffix=""
            [ "$legacy" = "true" ] && suffix=" ${DIM}(legacy name-only)${NC}"
            [ -n "$identity" ] && suffix=" ${DIM}(${identity:0:8})${NC}"
            printf "  %-25s %4d ${GREEN}%s${NC}%b\n" "$name" "$count" "$bar" "$suffix"
        done
    else
        echo -e "  ${DIM}(no canary events in this period)${NC}"
    fi
    echo ""

    # Not observed skills
    local observation_count
    observation_count=$(echo "$not_observed_json" | jq 'length')

    echo -e "${BOLD}── $observation_title ──${NC}"
    if [ "$observation_count" -gt 0 ]; then
        echo -e "  ${YELLOW}$observation_count skill identities${NC} installed but no canary was recorded:"
        echo "$not_observed_json" | jq -r '.[:15][] | "\(.name)  [" + (.identity_key[0:8]) + "] " + .canonical_skill_file' | sed "s/^/  ${DIM}○ /"
        echo -e "${NC}"
        [ "$observation_count" -gt 15 ] && echo -e "  ${DIM}... and $((observation_count - 15)) more${NC}"
        echo -e "  ${DIM}Observation only: lack of activation is not a removal verdict.${NC}"
    else
        echo -e "  ${GREEN}✓${NC} All installed skill identities have observed canaries in this period"
    fi
    local legacy_ambiguous_count
    legacy_ambiguous_count=$(echo "$legacy_ambiguous_json" | jq 'length')
    if [ "$legacy_ambiguous_count" -gt 0 ]; then
        echo -e "  ${YELLOW}Legacy name-only events were ambiguous for:${NC} $(echo "$legacy_ambiguous_json" | jq -r 'join(", ")')"
    fi
    echo ""

    # Context distribution
    echo -e "${BOLD}── Context Distribution (Top 5 Directories) ──${NC}"
    echo "$filtered_log" | jq -r '.cwd' 2>/dev/null | sort | uniq -c | sort -rn | head -5 | while read -r count dir; do
        local short_dir="${dir#$HOME_DIR/}"
        printf "  %-40s %4d canary events\n" "$short_dir" "$count"
    done
    echo ""

    # Last canary per skill identity
    echo -e "${BOLD}── Recent Activity ──${NC}"
    echo "$filtered_log" | jq -r '(.identity_key // ("legacy:" + (.skill // .skill_name // ""))) + "|" + (.skill // .skill_name // "") + "|" + .ts' 2>/dev/null | sort -t'|' -k3 -r | awk -F'|' '!seen[$1]++' | head -10 | while IFS='|' read -r identity name ts; do
        local suffix=""
        [[ "$identity" == legacy:* ]] && suffix=" (legacy name-only)" || suffix=" (${identity:0:8})"
        printf "  %-25s ${DIM}%s%s${NC}\n" "$name" "$ts" "$suffix"
    done
    echo ""
}

main "$@"
