#!/usr/bin/env bash
# skill-probe.sh — Skill discovery diagnostics
# Simulates Warp's skill discovery logic to show what skills
# an agent CAN see from the current working directory.
#
# Usage:
#   bash skill-probe.sh                    # Probe from current cwd
#   bash skill-probe.sh --cwd /path/to/project
#   bash skill-probe.sh --verbose          # Show full details
#   bash skill-probe.sh --doctor           # Combined health check

set -o pipefail

# ── Config ────────────────────────────────────────────────────────────
HOME_DIR="${HOME:-/Users/$(whoami)}"
TARGET_CWD="${PWD}"
VERBOSE=false
DOCTOR=false

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Warp-supported skill directories (in priority order)
SKILL_DIRS=(".warp/skills" ".agents/skills" ".claude/skills" ".codex/skills"
            ".cursor/skills" ".gemini/skills" ".copilot/skills" ".factory/skills"
            ".github/skills" ".opencode/skills")

# ── Parse Args ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --cwd) TARGET_CWD="$2"; shift 2 ;;
        --verbose) VERBOSE=true; shift ;;
        --doctor) DOCTOR=true; shift ;;
        *) shift ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────
get_frontmatter() {
    local file="$1" key="$2"
    sed -n '/^---$/,/^---$/p' "$file" 2>/dev/null | grep "^${key}:" | head -1 | sed "s/^${key}:[[:space:]]*//" | sed 's/^["'"'"']//' | sed 's/["'"'"']$//'
}

validate_frontmatter() {
    local file="$1"
    local has_start has_end
    has_start=$(head -1 "$file" 2>/dev/null)
    has_end=$(sed -n '2,/^---$/p' "$file" 2>/dev/null | tail -1)
    if [[ "$has_start" == "---" ]] && [[ "$has_end" == "---" ]]; then
        return 0
    fi
    return 1
}

# ── Discovery Logic ──────────────────────────────────────────────────

# Find git root from a path
find_git_root() {
    local dir="$1"
    while [ "$dir" != "/" ] && [ "$dir" != "$HOME_DIR" ]; do
        if [ -d "$dir/.git" ]; then
            echo "$dir"
            return
        fi
        dir=$(dirname "$dir")
    done
    echo ""
}

# Discover project-level skills (cwd → repo root)
discover_project_skills() {
    local cwd="$1"
    local git_root
    git_root=$(find_git_root "$cwd")
    local search_root="${git_root:-$cwd}"

    for dir_name in "${SKILL_DIRS[@]}"; do
        local skill_base="$search_root/$dir_name"
        if [ -d "$skill_base" ]; then
            find "$skill_base" -maxdepth 2 -name "SKILL.md" -type f 2>/dev/null | while IFS= read -r f; do
                local name
                name=$(get_frontmatter "$f" "name")
                local desc
                desc=$(get_frontmatter "$f" "description")
                local dir_n
                dir_n=$(basename "$(dirname "$f")")
                echo "project|$dir_name|${name:-$dir_n}|$f|${desc:0:80}"
            done
        fi
    done
}

# Discover global skills (~/...)
discover_global_skills() {
    for dir_name in "${SKILL_DIRS[@]}"; do
        local skill_base="$HOME_DIR/$dir_name"
        if [ -d "$skill_base" ]; then
            find "$skill_base" -maxdepth 2 -name "SKILL.md" -type f 2>/dev/null | while IFS= read -r f; do
                local name
                name=$(get_frontmatter "$f" "name")
                local desc
                desc=$(get_frontmatter "$f" "description")
                local dir_n
                dir_n=$(basename "$(dirname "$f")")
                echo "global|$dir_name|${name:-$dir_n}|$f|${desc:0:80}"
            done
        fi
    done
}

# ── Main Report ──────────────────────────────────────────────────────
main() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║       Skill Discovery Probe v1.0         ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${DIM}CWD:${NC} $TARGET_CWD"

    local git_root
    git_root=$(find_git_root "$TARGET_CWD")
    if [ -n "$git_root" ]; then
        echo -e "  ${DIM}Git root:${NC} $git_root"
    else
        echo -e "  ${DIM}Git root:${NC} ${YELLOW}not in a git repo${NC}"
    fi
    echo ""

    # Collect all discoverable skills
    local all_skills=()
    local skill_names=()

    echo -e "${BOLD}── Project-Level Skills ──${NC}"
    local project_count=0
    while IFS='|' read -r scope source name path desc; do
        [ -z "$scope" ] && continue
        project_count=$((project_count + 1))
        all_skills+=("$name")
        skill_names+=("$name|$path|project|$source")

        local valid_fm="✓"
        if ! validate_frontmatter "$path"; then valid_fm="${RED}✗${NC}"; fi

        if $VERBOSE; then
            echo -e "  ${GREEN}●${NC} ${BOLD}$name${NC} ${DIM}[$source]${NC} fm:$valid_fm"
            echo -e "    ${DIM}$path${NC}"
            [ -n "$desc" ] && echo -e "    ${DIM}$desc${NC}"
        else
            echo -e "  ${GREEN}●${NC} $name ${DIM}[$source]${NC}"
        fi
    done < <(discover_project_skills "$TARGET_CWD")

    if [ "$project_count" -eq 0 ]; then
        echo -e "  ${DIM}(none found)${NC}"
    fi
    echo -e "  ${DIM}Total: $project_count${NC}"
    echo ""

    echo -e "${BOLD}── Global Skills ──${NC}"
    local global_count=0
    while IFS='|' read -r scope source name path desc; do
        [ -z "$scope" ] && continue
        global_count=$((global_count + 1))
        all_skills+=("$name")
        skill_names+=("$name|$path|global|$source")

        local valid_fm="✓"
        if ! validate_frontmatter "$path"; then valid_fm="${RED}✗${NC}"; fi

        if $VERBOSE; then
            echo -e "  ${CYAN}●${NC} ${BOLD}$name${NC} ${DIM}[$source]${NC} fm:$valid_fm"
            echo -e "    ${DIM}$path${NC}"
            [ -n "$desc" ] && echo -e "    ${DIM}$desc${NC}"
        else
            echo -e "  ${CYAN}●${NC} $name ${DIM}[$source]${NC}"
        fi
    done < <(discover_global_skills)

    if [ "$global_count" -eq 0 ]; then
        echo -e "  ${DIM}(none found)${NC}"
    fi
    echo -e "  ${DIM}Total: $global_count${NC}"
    echo ""

    # Detect name conflicts
    echo -e "${BOLD}── Name Conflicts ──${NC}"
    local conflict_found=false
    local seen_names=()
    for entry in "${skill_names[@]}"; do
        local name="${entry%%|*}"
        seen_names+=("$name")
    done

    local sorted_names
    sorted_names=$(printf '%s\n' "${seen_names[@]}" | sort | uniq -d)
    if [ -n "$sorted_names" ]; then
        conflict_found=true
        while IFS= read -r dup_name; do
            echo -e "  ${YELLOW}⚠${NC} ${BOLD}$dup_name${NC} — found in multiple locations:"
            for entry in "${skill_names[@]}"; do
                IFS='|' read -r name path scope source <<< "$entry"
                if [ "$name" = "$dup_name" ]; then
                    echo -e "    ${DIM}[$scope/$source]${NC} $path"
                fi
            done
        done <<< "$sorted_names"
    fi

    if ! $conflict_found; then
        echo -e "  ${GREEN}✓${NC} No name conflicts detected"
    fi
    echo ""

    # Summary
    local total=$((project_count + global_count))
    echo -e "${BOLD}── Summary ──${NC}"
    echo -e "  Discoverable skills: ${BOLD}$total${NC} (project: $project_count, global: $global_count)"
    echo -e "  Scanned directories: ${#SKILL_DIRS[@]} patterns × 2 scopes"
    if $conflict_found; then
        echo -e "  ${YELLOW}⚠ Name conflicts detected — agent may pick unexpected version${NC}"
    fi
    echo ""

    # Doctor mode
    if $DOCTOR; then
        echo -e "${BOLD}── Doctor Mode ──${NC}"
        echo ""

        # Check activation logs
        local log_file="$HOME_DIR/.agents/debug/activation.jsonl"
        if [ -f "$log_file" ]; then
            local log_count
            log_count=$(wc -l < "$log_file" | tr -d ' ')
            local activated_skills
            activated_skills=$(jq -r '.skill' "$log_file" 2>/dev/null | sort -u | wc -l | tr -d ' ')
            echo -e "  Activation log: ${GREEN}$log_count${NC} events, ${GREEN}$activated_skills${NC} unique skills"

            # Find zombies
            local installed_names
            installed_names=$(printf '%s\n' "${seen_names[@]}" | sort -u)
            local active_names
            active_names=$(jq -r '.skill' "$log_file" 2>/dev/null | sort -u)
            local zombies
            zombies=$(comm -23 <(echo "$installed_names") <(echo "$active_names"))
            local zombie_count
            zombie_count=$(echo "$zombies" | grep -c . 2>/dev/null || echo 0)

            if [ "$zombie_count" -gt 0 ]; then
                echo -e "  ${YELLOW}Zombie skills (installed but never activated):${NC} $zombie_count"
                echo "$zombies" | head -10 | sed 's/^/    - /'
                [ "$zombie_count" -gt 10 ] && echo "    ... and $((zombie_count - 10)) more"
            else
                echo -e "  ${GREEN}✓${NC} All installed skills have been activated at least once"
            fi
        else
            echo -e "  ${DIM}No activation log found. Inject traces with:${NC}"
            echo -e "  ${DIM}  bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/${NC}"
        fi
        echo ""

        # Check hygiene report
        local latest_report
        latest_report=$(ls -t "$HOME_DIR/.agents/skills-report"/scan-*.json 2>/dev/null | head -1)
        if [ -n "$latest_report" ]; then
            local flagged_count
            flagged_count=$(jq '[.skills[] | select(.flags | length > 0)] | length' "$latest_report" 2>/dev/null || echo "?")
            echo -e "  Latest hygiene scan: ${DIM}$latest_report${NC}"
            echo -e "  Flagged skills: $flagged_count"
        else
            echo -e "  ${DIM}No hygiene scan found. Run:${NC}"
            echo -e "  ${DIM}  bash ~/.agents/skills/skill-hygiene/bin/skill-scan.sh${NC}"
        fi
        echo ""
    fi
}

main "$@"
