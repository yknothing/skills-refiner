#!/usr/bin/env bash
# skill-scan.sh — Agent Skills fact collector for AI-driven hygiene analysis
#
# Collects structured data about installed skills. Does NOT score or judge.
# The AI reads this output and applies expert judgment.
#
# Usage:
#   bash skill-scan.sh                    # Full scan, table + JSON output
#   bash skill-scan.sh --stale-days 365   # Custom staleness threshold
#   bash skill-scan.sh --json             # JSON to stdout only

set -o pipefail

# ── Config ────────────────────────────────────────────────────────────
HOME_DIR="${HOME:-$(eval echo ~$(whoami))}"
REPORT_DIR="$HOME_DIR/.agents/skills-report"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
REPORT_JSON="$REPORT_DIR/scan-$TIMESTAMP.json"
STALE_DAYS=180
JSON_ONLY=false
NO_WRITE=false

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
    echo "  bash skill-scan.sh --json             # JSON to stdout only"
    echo "  bash skill-scan.sh --no-write         # Terminal report without writing JSON"
    echo ""
    echo "Options:"
    echo "  --stale-days N   Override stale threshold (default: 180 days)"
    echo "  --json           Output JSON to stdout only (no report file)"
    echo "  --no-write       Do not write ~/.agents/skills-report/scan-*.json"
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
        --no-write) NO_WRITE=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "[WARN] Unknown option ignored: $1" >&2; shift ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────
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

get_frontmatter_text() {
    local file="$1" key="$2"
    awk -v key="$key" '
        NR == 1 && $0 == "---" { in_fm=1; next }
        in_fm && $0 == "---" { exit }
        in_fm && $0 ~ "^[A-Za-z0-9_-]+:" {
            if (capture) { exit }
            if (index($0, key ":") == 1) {
                value=$0
                sub("^" key ":[[:space:]]*", "", value)
                gsub(/^['\''\"]|['\''\"]$/, "", value)
                if (value == "|" || value == ">") { capture=1; next }
                print value
                exit
            }
        }
        capture {
            line=$0
            sub(/^[[:space:]]+/, "", line)
            print line
        }
    ' "$file" 2>/dev/null | head -c 1000
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

frontmatter_keys_json() {
    local file="$1"
    awk '
        NR == 1 && $0 == "---" { in_fm=1; next }
        in_fm && $0 == "---" { exit }
        in_fm && $0 ~ /^[A-Za-z0-9_-]+:/ {
            key=$0
            sub(/:.*/, "", key)
            print key
        }
    ' "$file" 2>/dev/null | jq -R 'select(length > 0)' | jq -s .
}

frontmatter_list_json() {
    local file="$1" key="$2"
    awk -v key="$key" '
        NR == 1 && $0 == "---" { in_fm=1; next }
        in_fm && $0 == "---" { exit }
        in_fm && $0 ~ "^[A-Za-z0-9_-]+:" {
            if (capture) { exit }
            if (index($0, key ":") == 1) {
                value=$0
                sub("^" key ":[[:space:]]*", "", value)
                gsub(/^\[/, "", value)
                gsub(/\]$/, "", value)
                gsub(/,/, " ", value)
                gsub(/^['\''\"]|['\''\"]$/, "", value)
                if (value != "") {
                    n=split(value, items, /[[:space:]]+/)
                    for (i=1; i<=n; i++) if (items[i] != "") print items[i]
                    exit
                }
                capture=1
                next
            }
        }
        capture && $0 ~ /^[[:space:]]*-[[:space:]]*/ {
            item=$0
            sub(/^[[:space:]]*-[[:space:]]*/, "", item)
            gsub(/^['\''\"]|['\''\"]$/, "", item)
            if (item != "") print item
            next
        }
        capture && $0 ~ /^[^[:space:]]/ { exit }
    ' "$file" 2>/dev/null | jq -R 'select(length > 0)' | jq -s .
}

hook_events_json() {
    local file="$1"
    awk '
        NR == 1 && $0 == "---" { in_fm=1; next }
        in_fm && $0 == "---" { exit }
        in_fm && $0 == "hooks:" { in_hooks=1; next }
        in_hooks && $0 ~ /^[^[:space:]]/ { exit }
        in_hooks && $0 ~ /^[[:space:]]{2}[A-Za-z0-9_-]+:/ {
            event=$0
            sub(/^[[:space:]]+/, "", event)
            sub(/:.*/, "", event)
            print event
        }
    ' "$file" 2>/dev/null | jq -R 'select(length > 0)' | jq -s 'unique'
}

yaml_scalar() {
    local file="$1" key="$2"
    awk -v key="$key" '
        $0 ~ "^[[:space:]]*" key ":[[:space:]]*" {
            sub("^[[:space:]]*" key ":[[:space:]]*", "")
            gsub(/^['\''\"]|['\''\"]$/, "")
            print
            exit
        }
    ' "$file" 2>/dev/null | head -c 300
}

yaml_section_scalar() {
    local file="$1" section="$2" key="$3"
    awk -v section="$section" -v key="$key" '
        $0 ~ "^" section ":[[:space:]]*$" { in_section=1; next }
        in_section && $0 ~ /^[^[:space:]]/ { exit }
        in_section && $0 ~ "^[[:space:]]+" key ":[[:space:]]*" {
            sub("^[[:space:]]+" key ":[[:space:]]*", "")
            gsub(/^['\''\"]|['\''\"]$/, "")
            print
            exit
        }
    ' "$file" 2>/dev/null | head -c 300
}

yaml_sequence_count() {
    local file="$1" key="$2"
    awk -v key="$key" '
        $0 ~ "^[[:space:]]*" key ":[[:space:]]*$" { in_seq=1; next }
        in_seq && $0 ~ /^[^[:space:]]/ { exit }
        in_seq && $0 ~ /^[[:space:]]*-[[:space:]]*/ { count++ }
        END { print count + 0 }
    ' "$file" 2>/dev/null
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

iso_from_epoch() {
    local epoch="$1"
    date -u -r "$epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo ""
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

git_root_for_dir() {
    local dir="$1"
    command -v git >/dev/null 2>&1 || return 0
    git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true
}

git_remote_for_root() {
    local root="$1"
    [ -z "$root" ] && return 0
    git -C "$root" config --get remote.origin.url 2>/dev/null || true
}

git_branch_for_root() {
    local root="$1"
    [ -z "$root" ] && return 0
    git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || true
}

source_kind_for_entry() {
    local location="$1" entry_type="$2"
    if [ "$entry_type" = "symlink" ]; then
        echo "symlink_distribution"
    elif [ "$location" = ".agents/skills" ]; then
        echo "canonical_global"
    else
        echo "native_agent"
    fi
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

        local name desc_full desc top_version metadata_version declared_version word_count mtime mtime_iso now age_days
        name=$(get_frontmatter "$skill_file" "name")
        desc_full=$(get_frontmatter_text "$skill_file" "description")
        desc="${desc_full:0:200}"
        top_version=$(get_frontmatter "$skill_file" "version")
        metadata_version=$(get_metadata_value "$skill_file" "version")
        declared_version="${metadata_version:-$top_version}"
        word_count=$(count_content_words "$skill_file")
        mtime=$(get_mtime "$skill_file")
        mtime_iso=$(iso_from_epoch "$mtime")
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

        local risk_json content_sha256 git_root git_remote git_branch source_kind
        risk_json=$(printf '%s\n' "${flags[@]}" | jq -R 'select(. == "pipe_to_shell" or . == "dangerous_cmd" or . == "possible_secret") | {id: ., severity: "review_required"}' | jq -s .)
        [ -z "$risk_json" ] && risk_json='[]'

        content_sha256=$(hash_file "$skill_file")
        git_root=$(git_root_for_dir "$canonical_dir")
        git_remote=$(git_remote_for_root "$git_root")
        git_branch=$(git_branch_for_root "$git_root")
        source_kind=$(source_kind_for_entry "$dir_label" "$entry_type")

        local when_to_use when_to_use_preview disable_model_invocation user_invocable model effort context agent shell_value
        local allowed_tools_json paths_json hook_events_json_value has_hooks extra_keys_json fm_keys_json openai_yaml openai_yaml_exists
        local display_name short_description default_prompt icon_path icon_paths_exist default_prompt_mentions_skill allow_implicit_invocation tool_dependencies_count
        local desc_length desc_truncated when_to_use_length when_to_use_truncated allowed_tools_count paths_count

        when_to_use=$(get_frontmatter_text "$skill_file" "when_to_use")
        when_to_use_preview="${when_to_use:0:200}"
        disable_model_invocation=$(get_frontmatter "$skill_file" "disable-model-invocation")
        user_invocable=$(get_frontmatter "$skill_file" "user-invocable")
        model=$(get_frontmatter "$skill_file" "model")
        effort=$(get_frontmatter "$skill_file" "effort")
        context=$(get_frontmatter "$skill_file" "context")
        agent=$(get_frontmatter "$skill_file" "agent")
        shell_value=$(get_frontmatter "$skill_file" "shell")
        allowed_tools_json=$(frontmatter_list_json "$skill_file" "allowed-tools")
        paths_json=$(frontmatter_list_json "$skill_file" "paths")
        hook_events_json_value=$(hook_events_json "$skill_file")
        has_hooks=false
        [ "$(echo "$hook_events_json_value" | jq 'length')" -gt 0 ] && has_hooks=true
        fm_keys_json=$(frontmatter_keys_json "$skill_file")
        extra_keys_json=$(echo "$fm_keys_json" | jq 'map(. as $key | select((["name","description","when_to_use","disable-model-invocation","user-invocable","allowed-tools","model","effort","context","agent","paths","shell","hooks"] | index($key)) | not))')

        desc_length=${#desc_full}
        desc_truncated=false
        [ "$desc_length" -gt 200 ] && desc_truncated=true
        when_to_use_length=${#when_to_use}
        when_to_use_truncated=false
        [ "$when_to_use_length" -gt 200 ] && when_to_use_truncated=true
        allowed_tools_count=$(echo "$allowed_tools_json" | jq 'length')
        paths_count=$(echo "$paths_json" | jq 'length')

        openai_yaml="$canonical_dir/agents/openai.yaml"
        openai_yaml_exists=false
        display_name=""
        short_description=""
        default_prompt=""
        icon_path=""
        icon_paths_exist=null
        default_prompt_mentions_skill=false
        allow_implicit_invocation=""
        tool_dependencies_count=0
        if [ -f "$openai_yaml" ]; then
            openai_yaml_exists=true
            display_name=$(yaml_section_scalar "$openai_yaml" "interface" "display_name")
            [ -z "$display_name" ] && display_name=$(yaml_scalar "$openai_yaml" "display_name")
            short_description=$(yaml_section_scalar "$openai_yaml" "interface" "short_description")
            [ -z "$short_description" ] && short_description=$(yaml_scalar "$openai_yaml" "short_description")
            default_prompt=$(yaml_section_scalar "$openai_yaml" "interface" "default_prompt")
            [ -z "$default_prompt" ] && default_prompt=$(yaml_scalar "$openai_yaml" "default_prompt")
            icon_path=$(yaml_section_scalar "$openai_yaml" "interface" "icon_small")
            [ -z "$icon_path" ] && icon_path=$(yaml_section_scalar "$openai_yaml" "interface" "icon_large")
            [ -z "$icon_path" ] && icon_path=$(yaml_scalar "$openai_yaml" "icon_path")
            [ -z "$icon_path" ] && icon_path=$(yaml_scalar "$openai_yaml" "icon")
            allow_implicit_invocation=$(yaml_section_scalar "$openai_yaml" "policy" "allow_implicit_invocation")
            tool_dependencies_count=$(yaml_sequence_count "$openai_yaml" "tools")
            if [ -n "$default_prompt" ] && [ -n "$name" ] && printf '%s' "$default_prompt" | grep -q "$name"; then
                default_prompt_mentions_skill=true
            fi
            if [ -n "$icon_path" ]; then
                icon_paths_exist=false
                [ -f "$canonical_dir/$icon_path" ] || [ -f "$canonical_dir/agents/$icon_path" ] && icon_paths_exist=true
            fi
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
            --arg canonical_dir "$canonical_dir" \
            --arg desc "${desc:0:200}" \
            --arg declared_version "$declared_version" \
            --arg metadata_version "$metadata_version" \
            --arg content_sha256 "$content_sha256" \
            --arg mtime_iso "$mtime_iso" \
            --arg source_kind "$source_kind" \
            --arg git_root "$git_root" \
            --arg git_remote "$git_remote" \
            --arg git_branch "$git_branch" \
            --arg when_to_use_preview "$when_to_use_preview" \
            --arg disable_model_invocation "$disable_model_invocation" \
            --arg user_invocable "$user_invocable" \
            --arg model "$model" \
            --arg effort "$effort" \
            --arg context "$context" \
            --arg agent "$agent" \
            --arg shell "$shell_value" \
            --arg display_name "$display_name" \
            --arg short_description "$short_description" \
            --arg allow_implicit_invocation "$allow_implicit_invocation" \
            --argjson words "$word_count" \
            --argjson mtime "$mtime" \
            --argjson age "$age_days" \
            --argjson stale_days "$STALE_DAYS" \
            --argjson desc_length "$desc_length" \
            --argjson desc_truncated "$desc_truncated" \
            --argjson when_to_use_length "$when_to_use_length" \
            --argjson when_to_use_truncated "$when_to_use_truncated" \
            --argjson allowed_tools "$allowed_tools_json" \
            --argjson allowed_tools_count "$allowed_tools_count" \
            --argjson paths "$paths_json" \
            --argjson paths_count "$paths_count" \
            --argjson has_hooks "$has_hooks" \
            --argjson hook_events "$hook_events_json_value" \
            --argjson extra_keys "$extra_keys_json" \
            --argjson openai_yaml_exists "$openai_yaml_exists" \
            --argjson default_prompt_mentions_skill "$default_prompt_mentions_skill" \
            --argjson icon_paths_exist "$icon_paths_exist" \
            --argjson tool_dependencies_count "$tool_dependencies_count" \
            --argjson flags "$flags_json" \
            --argjson risks "$risk_json" \
            '{
                name: $name,
                dir_name: $dir_name,
                location: $location,
                type: $entry_type,
                link_target: $link_target,
                source_skill_file: $source_skill_file,
                canonical_skill_file: $canonical_skill_file,
                canonical_dir: $canonical_dir,
                description: $desc,
                frontmatter: {
                    contract: "name_description_only",
                    name: $name,
                    description: $desc,
                    description_length: $desc_length,
                    description_truncated: $desc_truncated
                },
                claude_code: {
                    when_to_use_length: $when_to_use_length,
                    when_to_use_preview: $when_to_use_preview,
                    when_to_use_truncated: $when_to_use_truncated,
                    disable_model_invocation: $disable_model_invocation,
                    user_invocable: $user_invocable,
                    allowed_tools_count: $allowed_tools_count,
                    allowed_tools_preview: ($allowed_tools[:5]),
                    model: $model,
                    effort: $effort,
                    context: $context,
                    agent: $agent,
                    paths_count: $paths_count,
                    paths_preview: ($paths[:5]),
                    shell: $shell,
                    has_hooks: $has_hooks,
                    hook_events: $hook_events
                },
                openai: {
                    skill_md_contract: "name_description_only",
                    openai_yaml_exists: $openai_yaml_exists,
                    display_name: $display_name,
                    short_description: $short_description,
                    allow_implicit_invocation: $allow_implicit_invocation,
                    tool_dependencies_count: $tool_dependencies_count,
                    default_prompt_mentions_skill: $default_prompt_mentions_skill,
                    icon_paths_exist: $icon_paths_exist
                },
                extra_frontmatter_keys: $extra_keys,
                declared_version: $declared_version,
                metadata_version: $metadata_version,
                content_sha256: $content_sha256,
                word_count: $words,
                age_days: $age,
                freshness: {
                    mtime_epoch: $mtime,
                    mtime_iso: $mtime_iso,
                    age_days: $age,
                    stale_threshold_days: $stale_days,
                    is_stale: ($age > $stale_days)
                },
                provenance: {
                    kind: $source_kind,
                    source_url: $git_remote,
                    git_root: $git_root,
                    git_branch: $git_branch,
                    confidence: (if $git_remote != "" then "direct" else "heuristic" end)
                },
                risk_indicators: $risks,
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
    all_data=$(jq -n --arg scanned_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson stale_days "$STALE_DAYS" '{metadata:{schema_version:"skill-scan.v2", scanned_at:$scanned_at, stale_days:$stale_days, scope:"agent-recognized-directories"}, topology:{}, skills:[], skill_links:[], broken_symlinks:[], name_collisions:[]}')

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

    all_data=$(echo "$all_data" | jq '
        .name_collisions = (
            .skills
            | sort_by(.name)
            | group_by(.name)
            | map(select(length > 1) | {
                name: .[0].name,
                real_directory_count: length,
                distinct_canonical_dirs: ([.[].canonical_dir] | unique | length),
                distinct_versions: ([.[].declared_version | select(length > 0)] | unique),
                distinct_hashes: ([.[].content_sha256 | select(length > 0)] | unique),
                entries: [.[] | {
                    location,
                    canonical_dir,
                    canonical_skill_file,
                    declared_version,
                    content_sha256,
                    provenance
                }]
            })
            | map(select(.distinct_canonical_dirs > 1 or (.distinct_versions | length) > 1 or (.distinct_hashes | length) > 1))
        )
    ')

    if $JSON_ONLY; then
        echo "$all_data" | jq '.'
        return
    fi

    local report_written=false
    if ! $NO_WRITE; then
        if ! mkdir -p "$REPORT_DIR"; then
            echo "[ERROR] Cannot create report directory: $REPORT_DIR" >&2
            exit 1
        fi
        if ! echo "$all_data" | jq '.' > "$REPORT_JSON"; then
            echo "[ERROR] Cannot write report JSON: $REPORT_JSON" >&2
            exit 1
        fi
        report_written=true
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

    echo -e "${BOLD}── Provenance Signals ──${NC}"
    echo "$all_data" | jq -r '.skills | group_by(.provenance.kind) | .[] | "\(.[0].provenance.kind)|\(length)"' | while IFS='|' read -r kind count; do
        printf "  %-24s %3d\n" "$kind" "$count"
    done
    local collision_count
    collision_count=$(echo "$all_data" | jq '.name_collisions | length')
    if [ "$collision_count" -gt 0 ]; then
        echo -e "  ${YELLOW}Name/version/content collisions:${NC} $collision_count"
    else
        echo "  Name/version/content collisions: 0"
    fi
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

    if $report_written; then
        echo -e "${GREEN}[OK]${NC} Scan complete. JSON: ${CYAN}$REPORT_JSON${NC}"
    else
        echo -e "${GREEN}[OK]${NC} Scan complete. JSON report not written (--json/--no-write)."
    fi
    echo -e "${DIM}Feed this JSON to the AI for expert analysis. Findings are signals, not verdicts.${NC}"
}

main "$@"
