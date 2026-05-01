#!/usr/bin/env bash
# skill-probe.sh — Skill discovery diagnostics
# Shows what skills an agent can see from the current working directory.
#
# Usage:
#   bash skill-probe.sh                    # Probe from current cwd
#   bash skill-probe.sh --cwd /path/to/project
#   bash skill-probe.sh --verbose          # Show full details
#   bash skill-probe.sh --doctor           # Combined health check

set -o pipefail

# ── Config ────────────────────────────────────────────────────────────
HOME_DIR="${HOME:-$(eval echo ~$(whoami))}"
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

# Agent-recognized skill directories, in discovery priority order used by this diagnostic.
SKILL_DIRS=(".warp/skills" ".agents/skills" ".claude/skills" ".codex/skills"
            ".cursor/skills" ".gemini/skills" ".copilot/skills" ".factory/skills"
            ".github/skills" ".opencode/skills")

# ── Parse Args ────────────────────────────────────────────────────────
show_help() {
    echo "skill-probe.sh — Skill discovery diagnostics"
    echo ""
    echo "Usage:"
    echo "  bash skill-probe.sh"
    echo "  bash skill-probe.sh --cwd /path/to/project"
    echo "  bash skill-probe.sh --verbose"
    echo "  bash skill-probe.sh --doctor"
    echo ""
    echo "Options:"
    echo "  --cwd PATH     Probe discovery from PATH instead of current directory"
    echo "  --verbose      Show paths, descriptions, and frontmatter validation"
    echo "  --doctor       Include activation-log and hygiene-scan cross-checks"
    echo "  --help, -h     Show this help message"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --cwd)
            if [ -z "${2:-}" ]; then
                echo "[ERROR] --cwd requires a path" >&2
                exit 2
            fi
            TARGET_CWD="$2"
            shift 2
            ;;
        --verbose) VERBOSE=true; shift ;;
        --doctor) DOCTOR=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "[WARN] Unknown option ignored: $1" >&2; shift ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────
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
    ' "$file" 2>/dev/null
}

validate_frontmatter() {
    local file="$1"
    awk '
        NR == 1 && $0 == "---" { start=1; next }
        start && $0 == "---" { end=1; exit }
        END { exit !(start && end) }
    ' "$file" 2>/dev/null
}

canonical_file() {
    local file="$1"
    local dir base resolved_dir
    dir=$(dirname "$file")
    base=$(basename "$file")
    resolved_dir=$(cd -P "$dir" 2>/dev/null && pwd) || return 1
    printf '%s/%s\n' "$resolved_dir" "$base"
}

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

emit_skills_from_base() {
    local scope="$1" dir_name="$2" skill_base="$3"
    [ ! -d "$skill_base" ] && return

    for entry in "$skill_base"/*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        [ -d "$entry" ] || [ -L "$entry" ] || continue

        local skill_file="$entry/SKILL.md"
        [ ! -f "$skill_file" ] && continue

        local name desc dir_n entry_type canon
        name=$(get_frontmatter "$skill_file" "name")
        desc=$(get_frontmatter "$skill_file" "description")
        dir_n=$(basename "$entry")
        entry_type="directory"
        [ -L "$entry" ] && entry_type="symlink"
        canon=$(canonical_file "$skill_file" 2>/dev/null || echo "$skill_file")

        echo "$scope|$dir_name|${name:-$dir_n}|$skill_file|${desc:0:80}|$entry_type|$canon"
    done
}

# ── Discovery Logic ──────────────────────────────────────────────────
discover_project_skills() {
    local cwd="$1"
    local git_root search_root
    git_root=$(find_git_root "$cwd")
    search_root="${git_root:-$cwd}"

    for dir_name in "${SKILL_DIRS[@]}"; do
        emit_skills_from_base "project" "$dir_name" "$search_root/$dir_name"
    done
}

discover_global_skills() {
    for dir_name in "${SKILL_DIRS[@]}"; do
        emit_skills_from_base "global" "$dir_name" "$HOME_DIR/$dir_name"
    done
}

# ── Main Report ──────────────────────────────────────────────────────
main() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║       Skill Discovery Probe v1.2         ║${NC}"
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

    local skill_entries=()
    local symlink_distribution_count=0

    echo -e "${BOLD}── Project-Level Skills ──${NC}"
    local project_count=0
    while IFS='|' read -r scope source name path desc entry_type canonical_path; do
        [ -z "$scope" ] && continue
        project_count=$((project_count + 1))
        [ "$entry_type" = "symlink" ] && symlink_distribution_count=$((symlink_distribution_count + 1))
        skill_entries+=("$name|$path|project|$source|$entry_type|$canonical_path")

        local valid_fm="✓"
        if ! validate_frontmatter "$path"; then valid_fm="${RED}✗${NC}"; fi
        local type_label=""
        [ "$entry_type" = "symlink" ] && type_label=" ${DIM}(symlink distribution)${NC}"

        if $VERBOSE; then
            echo -e "  ${GREEN}●${NC} ${BOLD}$name${NC} ${DIM}[$source]${NC}$type_label fm:$valid_fm"
            echo -e "    ${DIM}$path${NC}"
            [ "$path" != "$canonical_path" ] && echo -e "    ${DIM}canonical: $canonical_path${NC}"
            [ -n "$desc" ] && echo -e "    ${DIM}$desc${NC}"
        else
            echo -e "  ${GREEN}●${NC} $name ${DIM}[$source]${NC}$type_label"
        fi
    done < <(discover_project_skills "$TARGET_CWD")

    if [ "$project_count" -eq 0 ]; then
        echo -e "  ${DIM}(none found)${NC}"
    fi
    echo -e "  ${DIM}Total: $project_count${NC}"
    echo ""

    echo -e "${BOLD}── Global Skills ──${NC}"
    local global_count=0
    while IFS='|' read -r scope source name path desc entry_type canonical_path; do
        [ -z "$scope" ] && continue
        global_count=$((global_count + 1))
        [ "$entry_type" = "symlink" ] && symlink_distribution_count=$((symlink_distribution_count + 1))
        skill_entries+=("$name|$path|global|$source|$entry_type|$canonical_path")

        local valid_fm="✓"
        if ! validate_frontmatter "$path"; then valid_fm="${RED}✗${NC}"; fi
        local type_label=""
        [ "$entry_type" = "symlink" ] && type_label=" ${DIM}(symlink distribution)${NC}"

        if $VERBOSE; then
            echo -e "  ${CYAN}●${NC} ${BOLD}$name${NC} ${DIM}[$source]${NC}$type_label fm:$valid_fm"
            echo -e "    ${DIM}$path${NC}"
            [ "$path" != "$canonical_path" ] && echo -e "    ${DIM}canonical: $canonical_path${NC}"
            [ -n "$desc" ] && echo -e "    ${DIM}$desc${NC}"
        else
            echo -e "  ${CYAN}●${NC} $name ${DIM}[$source]${NC}$type_label"
        fi
    done < <(discover_global_skills)

    if [ "$global_count" -eq 0 ]; then
        echo -e "  ${DIM}(none found)${NC}"
    fi
    echo -e "  ${DIM}Total: $global_count${NC}"
    echo ""

    echo -e "${BOLD}── Name Conflicts ──${NC}"
    local conflict_found=false
    local seen_names=()
    local entry
    for entry in "${skill_entries[@]}"; do
        local name="${entry%%|*}"
        seen_names+=("$name")
    done

    local duplicate_names
    duplicate_names=$(printf '%s\n' "${seen_names[@]}" | sort | uniq -d)
    if [ -n "$duplicate_names" ]; then
        while IFS= read -r dup_name; do
            [ -z "$dup_name" ] && continue
            local canonical_paths canonical_count
            canonical_paths=$(for entry in "${skill_entries[@]}"; do
                IFS='|' read -r name path scope source entry_type canonical_path <<< "$entry"
                if [ "$name" = "$dup_name" ]; then
                    echo "$canonical_path"
                fi
            done | sort -u)
            canonical_count=$(echo "$canonical_paths" | grep -c . 2>/dev/null || echo 0)

            if [ "$canonical_count" -gt 1 ]; then
                conflict_found=true
                echo -e "  ${YELLOW}⚠${NC} ${BOLD}$dup_name${NC} — same skill name resolves to different canonical sources:"
                for entry in "${skill_entries[@]}"; do
                    IFS='|' read -r name path scope source entry_type canonical_path <<< "$entry"
                    if [ "$name" = "$dup_name" ]; then
                        echo -e "    ${DIM}[$scope/$source/$entry_type]${NC} $path"
                        echo -e "      ${DIM}canonical: $canonical_path${NC}"
                    fi
                done
            elif $VERBOSE; then
                echo -e "  ${GREEN}✓${NC} ${BOLD}$dup_name${NC} appears in multiple locations but resolves to one canonical source"
            fi
        done <<< "$duplicate_names"
    fi

    if ! $conflict_found; then
        echo -e "  ${GREEN}✓${NC} No name conflicts detected"
    fi
    echo ""

    local total=$((project_count + global_count))
    echo -e "${BOLD}── Summary ──${NC}"
    echo -e "  Discoverable skill entries: ${BOLD}$total${NC} (project: $project_count, global: $global_count)"
    echo -e "  Symlink distribution entries: ${BOLD}$symlink_distribution_count${NC}"
    echo -e "  Scanned directories: ${#SKILL_DIRS[@]} patterns × 2 scopes"
    if $conflict_found; then
        echo -e "  ${YELLOW}⚠ Name conflicts detected — agent may pick an unexpected version depending on discovery priority${NC}"
    fi
    echo ""

    if $DOCTOR; then
        echo -e "${BOLD}── Doctor Mode ──${NC}"
        echo ""

        local log_file="$HOME_DIR/.agents/debug/activation.jsonl"
        if [ -f "$log_file" ]; then
            local log_count activated_skills installed_names active_names zombies zombie_count
            log_count=$(wc -l < "$log_file" | tr -d ' ')
            activated_skills=$(jq -r '.skill' "$log_file" 2>/dev/null | sort -u | wc -l | tr -d ' ')
            echo -e "  Activation log: ${GREEN}$log_count${NC} events, ${GREEN}$activated_skills${NC} unique skills"

            installed_names=$(printf '%s\n' "${seen_names[@]}" | sort -u)
            active_names=$(jq -r '.skill' "$log_file" 2>/dev/null | sort -u)
            zombies=$(comm -23 <(echo "$installed_names") <(echo "$active_names"))
            zombie_count=$(echo "$zombies" | grep -c . 2>/dev/null || echo 0)

            if [ "$zombie_count" -gt 0 ]; then
                echo -e "  ${YELLOW}Installed but not observed activated:${NC} $zombie_count"
                echo "$zombies" | head -10 | sed 's/^/    - /'
                [ "$zombie_count" -gt 10 ] && echo "    ... and $((zombie_count - 10)) more"
                echo -e "  ${DIM}Observation only: lack of activation is not a removal verdict.${NC}"
            else
                echo -e "  ${GREEN}✓${NC} All installed skills have been observed at least once"
            fi
        else
            echo -e "  ${DIM}No activation log found. Inject traces with:${NC}"
            echo -e "  ${DIM}  bash ~/.agents/skills/skill-debug/bin/skill-trace.sh --inject-dir ~/.agents/skills/${NC}"
        fi
        echo ""

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
