#!/usr/bin/env bash
# skill-probe.sh - Local skill discovery-surface diagnostics.
# Shows skill files this diagnostic can find from the current working directory.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_SH="$SCRIPT_DIR/../../lib/common.sh"
[ -f "$COMMON_SH" ] || { echo "[ERROR] Missing shared helper: $COMMON_SH" >&2; exit 1; }
# shellcheck source=../../lib/common.sh
. "$COMMON_SH"

PRODUCT_VERSION="2.0"
TARGET_CWD="${PWD}"
VERBOSE=false
DOCTOR=false
JSON_MODE=false
FIELD_SEP=$'\037'

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

if [ -n "${NO_COLOR:-}" ]; then
    RED=''; YELLOW=''; GREEN=''; CYAN=''; DIM=''; BOLD=''; NC=''
fi

SKILL_DIRS=()
while IFS= read -r _skill_dir; do
    SKILL_DIRS+=("$_skill_dir")
done < <(sr_agent_skill_dirs)

detect_home_dir() {
    sr_detect_home_dir
}

show_help() {
    cat <<EOF
skill-probe.sh - Local skill discovery-surface diagnostics

Usage:
  bash skill-probe.sh
  bash skill-probe.sh --cwd /path/to/project
  bash skill-probe.sh --verbose
  bash skill-probe.sh --doctor
  bash skill-probe.sh --json

Options:
  --cwd PATH     Probe discovery from PATH instead of current directory
  --verbose      Show paths, descriptions, and frontmatter validation
  --doctor       Include activation-log and native-signal cross-checks
  --json         Emit a compact structured summary
  --no-color     Disable terminal colors
  --help, -h     Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --cwd)
            [ -z "${2:-}" ] && { echo "[ERROR] --cwd requires a path" >&2; exit 2; }
            TARGET_CWD="$2"
            shift 2
            ;;
        --verbose) VERBOSE=true; shift ;;
        --doctor) DOCTOR=true; shift ;;
        --json) JSON_MODE=true; shift ;;
        --no-color)
            RED=''; YELLOW=''; GREEN=''; CYAN=''; DIM=''; BOLD=''; NC=''
            shift
            ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "[WARN] Unknown option ignored: $1" >&2; shift ;;
    esac
done

HOME_DIR="$(detect_home_dir)" || {
    echo "[ERROR] Unable to determine home directory. Set HOME and retry." >&2
    exit 2
}

get_frontmatter() {
    local file="$1" key="$2"
    sr_get_frontmatter_field "$file" "$key"
}

validate_frontmatter() {
    local file="$1"
    awk '
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { start=1; next }
        start && line ~ /^---[[:space:]]*$/ { end=1; exit }
        END { exit !(start && end) }
    ' "$file" 2>/dev/null
}

canonical_file() {
    local file="$1"
    sr_canonical_file "$file"
}

hash_file() {
    local file="$1"
    sr_hash_skill_file "$file"
}

is_backup_entry_name() {
    local entry_name="$1"
    echo "$entry_name" | grep -qE '\.backup\.|\.disabled|\.tmp|\.old|\.archive'
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

        local name desc dir_n entry_type canon content_hash
        name=$(get_frontmatter "$skill_file" "name")
        desc=$(get_frontmatter "$skill_file" "description")
        dir_n=$(basename "$entry")
        entry_type="directory"
        [ -L "$entry" ] && entry_type="symlink"
        canon=$(canonical_file "$skill_file" 2>/dev/null || echo "$skill_file")
        content_hash=$(hash_file "$canon")

        printf '%s%s%s%s%s%s%s%s%s%s%s%s%s%s%s\n' \
            "$scope" "$FIELD_SEP" \
            "$dir_name" "$FIELD_SEP" \
            "${name:-$dir_n}" "$FIELD_SEP" \
            "$skill_file" "$FIELD_SEP" \
            "${desc:0:80}" "$FIELD_SEP" \
            "$entry_type" "$FIELD_SEP" \
            "$canon" "$FIELD_SEP" \
            "$content_hash"
    done
}

discover_project_skills() {
    local cwd="$1"
    local git_root search_root
    git_root=$(find_git_root "$cwd")
    search_root="${git_root:-$cwd}"

    # Running from $HOME otherwise duplicates the global scan exactly.
    [ "$search_root" = "$HOME_DIR" ] && return

    local bases=("$search_root")
    if [ -n "$git_root" ]; then
        local current="$cwd"
        while [ "$current" != "$git_root" ] && [ "$current" != "/" ] && [ "$current" != "$HOME_DIR" ]; do
            bases+=("$current")
            current=$(dirname "$current")
        done
    fi

    local base
    for base in "${bases[@]}"; do
        for dir_name in "${SKILL_DIRS[@]}"; do
            local label="$dir_name"
            if [ "$base" != "$search_root" ]; then
                local rel="${base#$search_root/}"
                label="$rel/$dir_name"
            fi
            emit_skills_from_base "project" "$label" "$base/$dir_name"
        done
    done
}

discover_global_skills() {
    local dir_name
    for dir_name in "${SKILL_DIRS[@]}"; do
        emit_skills_from_base "global" "$dir_name" "$HOME_DIR/$dir_name"
    done
}

count_skill_files() {
    local dir="$1"
    [ -d "$dir" ] || { echo 0; return; }
    find "$dir" -maxdepth 2 -name SKILL.md -type f 2>/dev/null | wc -l | tr -d ' '
}

count_cursor_rules() {
    local dir="$1"
    [ -d "$dir" ] || { echo 0; return; }
    find "$dir" -maxdepth 1 -name '*.mdc' -type f 2>/dev/null | wc -l | tr -d ' '
}

cursor_mcp_state() {
    if [ -f "$TARGET_CWD/.cursor/mcp.json" ] || [ -d "$TARGET_CWD/.cursor/mcp" ] || \
       [ -f "$HOME_DIR/.cursor/mcp.json" ] || [ -d "$HOME_DIR/.cursor/mcp" ]; then
        echo "present"
    else
        echo "absent"
    fi
}

show_native_observability() {
    echo -e "${BOLD}-- Native Platform Signals --${NC}"

    if [ "${CLAUDE_CODE_ENABLE_TELEMETRY:-}" = "1" ]; then
        echo -e "  Claude Code telemetry: ${GREEN}enabled${NC}"
        echo -e "    metrics exporter: ${OTEL_METRICS_EXPORTER:-unset}"
        echo -e "    logs exporter:    ${OTEL_LOGS_EXPORTER:-unset}"
        if { [ "${CLAUDE_CODE_ENHANCED_TELEMETRY_BETA:-}" = "1" ] || [ "${ENABLE_ENHANCED_TELEMETRY_BETA:-}" = "1" ]; } && [ -n "${OTEL_TRACES_EXPORTER:-}" ] && [ "${OTEL_TRACES_EXPORTER:-}" != "none" ]; then
            echo -e "    traces:           ${GREEN}configured${NC} (${OTEL_TRACES_EXPORTER})"
        else
            echo -e "    traces:           ${DIM}not configured${NC}"
        fi
        if [ "${OTEL_LOG_TOOL_DETAILS:-}" = "1" ]; then
            echo -e "    tool details:     enabled (skill names may be exported)"
        else
            echo -e "    tool details:     disabled (custom skill names may be redacted)"
        fi
    else
        echo -e "  Claude Code telemetry: ${DIM}not detected${NC}"
    fi

    local codex_user_count codex_config cursor_rule_count cursor_skill_count cursor_mcp
    codex_user_count=$(count_skill_files "$HOME_DIR/.agents/skills")
    if [ -f "$HOME_DIR/.codex/config.toml" ]; then
        codex_config="present"
    else
        codex_config="absent"
    fi
    echo -e "  Codex native skill surface: ${DIM}~/.agents/skills=${codex_user_count}, ~/.codex/config.toml=${codex_config}${NC}"

    if [ "${OPENAI_AGENTS_DISABLE_TRACING:-}" = "1" ]; then
        echo -e "  OpenAI Agents SDK tracing: ${YELLOW}disabled by env${NC} ${DIM}(app workflow signal, not Codex skill runtime)${NC}"
    else
        echo -e "  OpenAI Agents SDK tracing: ${DIM}app-level default when using SDK apps; no Codex runtime trace reader here${NC}"
    fi

    cursor_rule_count=$(count_cursor_rules "$TARGET_CWD/.cursor/rules")
    cursor_skill_count=$(count_skill_files "$TARGET_CWD/.cursor/skills")
    cursor_mcp=$(cursor_mcp_state)
    if [ -n "${CURSOR_AGENT:-}" ]; then
        echo -e "  Cursor native context: ${GREEN}agent terminal detected${NC}"
    else
        echo -e "  Cursor native context: ${DIM}agent terminal not detected${NC}"
    fi
    echo -e "    rules:            ${cursor_rule_count} .mdc files in cwd/.cursor/rules"
    echo -e "    skills:           ${cursor_skill_count} SKILL.md files in cwd/.cursor/skills"
    echo -e "    mcp config:       ${cursor_mcp}"
    echo -e "  ${DIM}Boundary: this reports local config/signals only; it does not prove runtime loading or effectiveness.${NC}"
    echo ""
}

append_entry_json() {
    local entries_json="$1" scope="$2" source="$3" name="$4" path="$5" desc="$6" entry_type="$7" canonical_path="$8" content_hash="$9"
    jq -n \
        --argjson entries "$entries_json" \
        --arg scope "$scope" \
        --arg source "$source" \
        --arg name "$name" \
        --arg path "$path" \
        --arg description "$desc" \
        --arg type "$entry_type" \
        --arg canonical_skill_file "$canonical_path" \
        --arg content_sha256 "$content_hash" \
        '$entries + [{
            scope:$scope,
            source:$source,
            name:$name,
            path:$path,
            description:$description,
            type:$type,
            canonical_skill_file:$canonical_skill_file,
            content_sha256:$content_sha256
        }]'
}

build_conflicts_json() {
    local entries_json="$1"
    echo "$entries_json" | jq '
        def is_backup:
            (.path | split("/")[-2] | test("\\.backup\\.|\\.disabled|\\.tmp|\\.old|\\.archive"));
        group_by(.name)
        | map(select(length > 1) | {
            name: .[0].name,
            entries: .,
            active_real_entries: [.[] | select(.type != "symlink" and (is_backup | not))],
            symlink_distribution_count: ([.[] | select(.type == "symlink")] | length),
            backup_or_archive_count: ([.[] | select(is_backup)] | length)
        })
        | map(. + {
            active_real_count: (.active_real_entries | length),
            active_hashes: ([.active_real_entries[].content_sha256 | select(length > 0)] | unique),
            has_project_variant: ([.active_real_entries[] | select(.scope == "project")] | length > 0)
        })
        | map(. + {
            classification: (
                if (.active_real_count > 1 and (.active_hashes | length) > 1 and (.has_project_variant | not)) then "active_conflict"
                elif (.active_real_count > 1 or .symlink_distribution_count > 0 or .backup_or_archive_count > 0) then "topology_variant"
                else "same_canonical_source" end
            )
        })
    '
}

main() {
    local skill_entries=()
    local entries_json="[]"
    local symlink_distribution_count=0
    local project_count=0
    local global_count=0

    while IFS="$FIELD_SEP" read -r scope source name path desc entry_type canonical_path content_hash; do
        [ -z "$scope" ] && continue
        project_count=$((project_count + 1))
        [ "$entry_type" = "symlink" ] && symlink_distribution_count=$((symlink_distribution_count + 1))
        skill_entries+=("$name$FIELD_SEP$path$FIELD_SEP$scope$FIELD_SEP$source$FIELD_SEP$entry_type$FIELD_SEP$canonical_path$FIELD_SEP$content_hash")
        entries_json=$(append_entry_json "$entries_json" "$scope" "$source" "$name" "$path" "$desc" "$entry_type" "$canonical_path" "$content_hash")
    done < <(discover_project_skills "$TARGET_CWD")

    while IFS="$FIELD_SEP" read -r scope source name path desc entry_type canonical_path content_hash; do
        [ -z "$scope" ] && continue
        global_count=$((global_count + 1))
        [ "$entry_type" = "symlink" ] && symlink_distribution_count=$((symlink_distribution_count + 1))
        skill_entries+=("$name$FIELD_SEP$path$FIELD_SEP$scope$FIELD_SEP$source$FIELD_SEP$entry_type$FIELD_SEP$canonical_path$FIELD_SEP$content_hash")
        entries_json=$(append_entry_json "$entries_json" "$scope" "$source" "$name" "$path" "$desc" "$entry_type" "$canonical_path" "$content_hash")
    done < <(discover_global_skills)

    local total conflicts_json active_conflict_count topology_variant_count
    total=$((project_count + global_count))
    conflicts_json=$(build_conflicts_json "$entries_json")
    active_conflict_count=$(echo "$conflicts_json" | jq '[.[] | select(.classification == "active_conflict")] | length')
    topology_variant_count=$(echo "$conflicts_json" | jq '[.[] | select(.classification == "topology_variant")] | length')

    local git_root
    git_root=$(find_git_root "$TARGET_CWD")

    if $JSON_MODE; then
        jq -n \
            --arg schema "skill-probe.v2" \
            --arg product_version "$PRODUCT_VERSION" \
            --arg cwd "$TARGET_CWD" \
            --arg git_root "$git_root" \
            --argjson total "$total" \
            --argjson project_count "$project_count" \
            --argjson global_count "$global_count" \
            --argjson symlink_distribution_count "$symlink_distribution_count" \
            --argjson active_conflict_count "$active_conflict_count" \
            --argjson topology_variant_count "$topology_variant_count" \
            --argjson conflicts "$conflicts_json" \
            --argjson entries "$entries_json" \
            '{
                schema_version: $schema,
                product_version: $product_version,
                cwd: $cwd,
                git_root: $git_root,
                counts: {
                    discoverable_entries: $total,
                    project_entries: $project_count,
                    global_entries: $global_count,
                    symlink_distribution_entries: $symlink_distribution_count,
                    active_name_conflicts: $active_conflict_count,
                    topology_variants: $topology_variant_count
                },
                conflicts: $conflicts,
                entries: $entries
            }'
        return
    fi

    echo -e "${BOLD}+------------------------------------------+${NC}"
    echo -e "${BOLD}|  Skill Discovery Surface Probe v$PRODUCT_VERSION      |${NC}"
    echo -e "${BOLD}+------------------------------------------+${NC}"
    echo ""
    echo -e "  ${DIM}CWD:${NC} $TARGET_CWD"
    echo -e "  ${DIM}Mode:${NC} best-effort local filesystem diagnostic"
    if [ -n "$git_root" ]; then
        echo -e "  ${DIM}Git root:${NC} $git_root"
    else
        echo -e "  ${DIM}Git root:${NC} ${YELLOW}not in a git repo${NC}"
    fi
    echo ""

    echo -e "${BOLD}-- Project-Level Skills --${NC}"
    local entry
    for entry in "${skill_entries[@]}"; do
        IFS="$FIELD_SEP" read -r name path scope source entry_type canonical_path content_hash <<< "$entry"
        [ "$scope" = "project" ] || continue
        local valid_fm="ok"
        validate_frontmatter "$path" || valid_fm="bad"
        local type_label=""
        [ "$entry_type" = "symlink" ] && type_label=" ${DIM}(symlink distribution)${NC}"
        if $VERBOSE; then
            echo -e "  ${GREEN}*${NC} ${BOLD}$name${NC} ${DIM}[$source]${NC}$type_label fm:$valid_fm"
            echo -e "    ${DIM}$path${NC}"
            [ "$path" != "$canonical_path" ] && echo -e "    ${DIM}canonical: $canonical_path${NC}"
        else
            echo -e "  ${GREEN}*${NC} $name ${DIM}[$source]${NC}$type_label"
        fi
    done
    [ "$project_count" -eq 0 ] && echo -e "  ${DIM}(none found)${NC}"
    echo -e "  ${DIM}Total: $project_count${NC}"
    echo ""

    echo -e "${BOLD}-- Global Skills --${NC}"
    for entry in "${skill_entries[@]}"; do
        IFS="$FIELD_SEP" read -r name path scope source entry_type canonical_path content_hash <<< "$entry"
        [ "$scope" = "global" ] || continue
        local valid_fm="ok"
        validate_frontmatter "$path" || valid_fm="bad"
        local type_label=""
        [ "$entry_type" = "symlink" ] && type_label=" ${DIM}(symlink distribution)${NC}"
        if $VERBOSE; then
            echo -e "  ${CYAN}*${NC} ${BOLD}$name${NC} ${DIM}[$source]${NC}$type_label fm:$valid_fm"
            echo -e "    ${DIM}$path${NC}"
            [ "$path" != "$canonical_path" ] && echo -e "    ${DIM}canonical: $canonical_path${NC}"
        else
            echo -e "  ${CYAN}*${NC} $name ${DIM}[$source]${NC}$type_label"
        fi
    done
    [ "$global_count" -eq 0 ] && echo -e "  ${DIM}(none found)${NC}"
    echo -e "  ${DIM}Total: $global_count${NC}"
    echo ""

    echo -e "${BOLD}-- Name Conflicts --${NC}"
    if [ "$active_conflict_count" -gt 0 ]; then
        echo "$conflicts_json" | jq -r '.[] | select(.classification == "active_conflict") | .name' | while IFS= read -r dup_name; do
            echo -e "  ${YELLOW}!${NC} ${BOLD}$dup_name${NC} - active real directories have different content/version surfaces:"
            echo "$entries_json" | jq -r --arg n "$dup_name" '.[] | select(.name == $n) | "\(.scope)|\(.source)|\(.type)|\(.path)|\(.canonical_skill_file)|\(.content_sha256)"' | while IFS='|' read -r scope source entry_type path canonical_path content_hash; do
                echo -e "    ${DIM}[$scope/$source/$entry_type]${NC} $path"
                echo -e "      ${DIM}canonical: $canonical_path${NC}"
                [ -n "$content_hash" ] && echo -e "      ${DIM}sha256: ${content_hash:0:12}${NC}"
            done
        done
    else
        echo -e "  ${GREEN}ok${NC} No name conflicts detected"
        if [ "$topology_variant_count" -gt 0 ]; then
            echo -e "  ${DIM}Topology variants seen: $topology_variant_count. Symlink distributions, backups, same-content copies, and project/source variants are not conflicts.${NC}"
        fi
        if $VERBOSE; then
            echo "$conflicts_json" | jq -r '.[] | select(.classification != "active_conflict") | "\(.name)|\(.classification)"' | while IFS='|' read -r name classification; do
                [ -n "$name" ] && echo -e "  ${GREEN}ok${NC} ${BOLD}$name${NC} appears in multiple locations but resolves to one canonical source or a non-conflict topology variant (${classification})"
            done
        fi
    fi
    echo ""

    echo -e "${BOLD}-- Summary --${NC}"
    echo -e "  Discoverable skill entries: ${BOLD}$total${NC} (project: $project_count, global: $global_count)"
    echo -e "  Symlink distribution entries: ${BOLD}$symlink_distribution_count${NC}"
    echo -e "  Active name conflicts: ${BOLD}$active_conflict_count${NC}"
    echo -e "  Topology variants (not conflicts): ${BOLD}$topology_variant_count${NC}"
    echo -e "  Scanned directories: ${#SKILL_DIRS[@]} patterns x 2 scopes"
    echo -e "  ${DIM}Note: platform runtime discovery can differ from this filesystem scan.${NC}"
    [ "$active_conflict_count" -gt 0 ] && echo -e "  ${YELLOW}! Active name conflicts detected - agent may pick an unexpected version depending on discovery priority${NC}"
    echo ""

    if $DOCTOR; then
        echo -e "${BOLD}-- Doctor Mode --${NC}"
        echo ""
        show_native_observability

        local log_file="$HOME_DIR/.agents/debug/activation.jsonl"
        if [ -f "$log_file" ]; then
            local log_count activated_skills installed_names active_names not_observed not_observed_count
            log_count=$(wc -l < "$log_file" | tr -d ' ')
            activated_skills=$(jq -r '.skill' "$log_file" 2>/dev/null | sort -u | wc -l | tr -d ' ')
            echo -e "  Activation log: ${GREEN}$log_count${NC} events, ${GREEN}$activated_skills${NC} unique skills"

            installed_names=$(printf '%s\n' "${skill_entries[@]}" | awk -v FS="$FIELD_SEP" '{print $1}' | sort -u)
            active_names=$(jq -r '.skill' "$log_file" 2>/dev/null | sort -u)
            not_observed=$(comm -23 <(echo "$installed_names") <(echo "$active_names"))
            not_observed_count=$(echo "$not_observed" | grep -c . 2>/dev/null || true)
            not_observed_count=${not_observed_count:-0}

            if [ "$not_observed_count" -gt 0 ]; then
                echo -e "  ${YELLOW}Installed but no canary recorded:${NC} $not_observed_count"
                echo "$not_observed" | head -10 | sed 's/^/    - /'
                [ "$not_observed_count" -gt 10 ] && echo "    ... and $((not_observed_count - 10)) more"
                echo -e "  ${DIM}Observation only: lack of activation is not a removal verdict.${NC}"
            else
                echo -e "  ${GREEN}ok${NC} All installed skills have been observed at least once"
            fi
        else
            echo -e "  ${DIM}No activation log found. This is no-data, not a doctor failure.${NC}"
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
