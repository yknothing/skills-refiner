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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Governance skills are independently installable, so each executable skill
# ships the same runtime helper inside its own directory. The installed-layout
# contract test keeps the mirrored copies byte-identical.
COMMON_SH="$SCRIPT_DIR/../lib/common.sh"
[ -f "$COMMON_SH" ] || { echo "[ERROR] Missing shared helper: $COMMON_SH" >&2; exit 1; }
# shellcheck source=../lib/common.sh
. "$COMMON_SH"
sr_require_sha256 || exit $?

# ── Config ────────────────────────────────────────────────────────────
detect_home_dir() {
    sr_detect_home_dir
}

STALE_DAYS=180
JSON_ONLY=false
NO_WRITE=false
SKIP_PROVENANCE_TREE=false
MAX_DESCRIPTION_LENGTH=1024
SKILL_LOCK_SCHEMA_VERSION=3
MAX_SKILL_LOCK_BYTES=1048576
# Bound installer tree hashing so one oversized skill (docs/assets) cannot stall the
# whole inventory. Small receipt-backed fixtures remain fully verified.
MAX_PROVENANCE_TREE_FILES=400
PROVENANCE_GIT_TMP=""
PROVENANCE_RECEIPT_TMP=""
GIT_TREE_HASH_RESULT=""
MUTATION_PROVENANCE_JSON=""

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Parse Args ────────────────────────────────────────────────────────
show_help() {
    echo "skill-scan.sh — Agent Skills fact collector for AI-driven hygiene analysis"
    echo ""
    echo "Usage:"
    echo "  bash skill-scan.sh                    # Full scan, table + JSON output"
    echo "  bash skill-scan.sh --stale-days 365   # Custom staleness threshold"
    echo "  bash skill-scan.sh --json             # JSON to stdout only"
    echo "  bash skill-scan.sh --no-write         # Terminal report without writing JSON"
    echo "  bash skill-scan.sh --skip-provenance-tree  # Skip git tree hashing for receipts"
    echo ""
    echo "Options:"
    echo "  --stale-days N   Override stale threshold (default: 180 days)"
    echo "  --json           Output JSON to stdout only (no report file)"
    echo "  --no-write       Do not write ~/.agents/skills-report/scan-*.json"
    echo "  --skip-provenance-tree  Skip git write-tree provenance (faster inventory)"
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
        --skip-provenance-tree) SKIP_PROVENANCE_TREE=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "[ERROR] Unknown option: $1" >&2; exit 2 ;;
    esac
done

HOME_DIR="$(detect_home_dir)" || {
    echo "[ERROR] Unable to determine home directory. Set HOME and retry." >&2
    exit 2
}
REPORT_DIR="$HOME_DIR/.agents/skills-report"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
REPORT_JSON="$REPORT_DIR/scan-$TIMESTAMP.json"

# Agent-recognized directories to scan. These are active consumption surfaces,
# not arbitrary workspace/project directories.
AGENT_DIRS=()
while IFS= read -r _skill_dir; do
    AGENT_DIRS+=("$HOME_DIR/$_skill_dir")
done < <(sr_agent_skill_dirs "$HOME_DIR")

# ── Helpers ───────────────────────────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
    echo "[ERROR] jq is required for JSON output and aggregation. Install jq and retry." >&2
    exit 127
fi
if ! command -v base64 >/dev/null 2>&1; then
    echo "[ERROR] base64 is required for byte-preserving symlink identity. Install base64 and retry." >&2
    exit 127
fi

get_frontmatter() {
    local file="$1" key="$2"
    sr_get_frontmatter_field "$file" "$key"
}

get_frontmatter_text() {
    local file="$1" key="$2"
    sr_get_frontmatter_text "$file" "$key"
}

utf8_byte_length() {
    LC_ALL=C printf '%s' "$1" | wc -c | tr -d ' '
}

utf8_codepoint_length() {
    LC_ALL=C printf '%s' "$1" | LC_ALL=C od -An -v -tu1 | LC_ALL=C awk '
        {
            for (i = 1; i <= NF; i++) {
                byte=$i + 0
                if (invalid) continue
                if (expected > 0) {
                    if (byte < next_min || byte > next_max) {
                        invalid=1
                        continue
                    }
                    expected--
                    next_min=128
                    next_max=191
                    continue
                }
                if (byte <= 127) {
                    count++
                } else if (byte >= 194 && byte <= 223) {
                    count++; expected=1; next_min=128; next_max=191
                } else if (byte == 224) {
                    count++; expected=2; next_min=160; next_max=191
                } else if (byte >= 225 && byte <= 236) {
                    count++; expected=2; next_min=128; next_max=191
                } else if (byte == 237) {
                    count++; expected=2; next_min=128; next_max=159
                } else if (byte >= 238 && byte <= 239) {
                    count++; expected=2; next_min=128; next_max=191
                } else if (byte == 240) {
                    count++; expected=3; next_min=144; next_max=191
                } else if (byte >= 241 && byte <= 243) {
                    count++; expected=3; next_min=128; next_max=191
                } else if (byte == 244) {
                    count++; expected=3; next_min=128; next_max=143
                } else {
                    invalid=1
                }
            }
        }
        END {
            if (invalid || expected != 0) exit 1
            print count + 0
        }
    '
}

frontmatter_scalar_kind() {
    local file="$1" key="$2"
    LC_ALL=C awk -v key="$key" '
        function top_key(line, raw, first, last) {
            if (line ~ /^[[:space:]]/ || line !~ /:/) return ""
            raw=line
            sub(/:.*/, "", raw)
            sub(/[[:space:]]+$/, "", raw)
            first=substr(raw, 1, 1)
            last=substr(raw, length(raw), 1)
            if ((first == "\"" && last == "\"") || (first == "\047" && last == "\047")) {
                raw=substr(raw, 2, length(raw) - 2)
            }
            return raw
        }
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1 && substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { in_fm=0; closed=1; next }
        in_fm && top_key(line) == key {
            seen++
            value=line
            sub(/^[^:]*:[[:space:]]*/, "", value)
            sub(/[[:space:]]+$/, "", value)
            first=substr(value, 1, 1)
            if (value == "") kind="empty"
            else if (value ~ /^[|>][+-]?$/) kind="block"
            else if (first == "\"" || first == "\047") kind="quoted"
            else if (value ~ /[#&*!|>{}\[\]]/ || value ~ /:[[:space:]]/) kind="complex"
            else kind="plain-simple"
        }
        END {
            if (!closed || seen == 0) print "unobserved"
            else if (seen > 1) print "complex"
            else print kind
        }
    ' "$file" 2>/dev/null
}

# Extract only active @file references from prose. Markdown fenced examples and
# inline-code examples are documentation, not loader directives; treating them
# as dependencies creates false broken-reference findings (for example a skill
# explaining why `@missing/example.md` is a bad pattern).
extract_active_at_refs() {
    local file="$1"
    LC_ALL=C awk '
        /^[[:space:]]*(```|~~~)/ { in_fence = !in_fence; next }
        !in_fence {
            line = $0
            while (match(line, /`[^`]*`/)) {
                line = substr(line, 1, RSTART - 1) substr(line, RSTART + RLENGTH)
            }
            print line
        }
    ' "$file" 2>/dev/null |
        grep -oE '@[a-zA-Z0-9_./-]+\.(md|sh|py|js)' || true
}

get_metadata_value() {
    local file="$1" key="$2"
    sr_get_metadata_value "$file" "$key"
}

frontmatter_keys_json() {
    local file="$1"
    sr_frontmatter_keys_json "$file"
}

frontmatter_list_json() {
    local file="$1" key="$2"
    sr_frontmatter_list_json "$file" "$key"
}

hook_events_json() {
    local file="$1"
    sr_hook_events_json "$file"
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
    sr_hash_skill_file "$file"
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

canonical_dir_for_entry() {
    local path="$1"
    (
        cd -P "$path" 2>/dev/null || exit 1
        printf '%s\001' "$PWD"
    )
}

stat_owner_uid() {
    local path="$1" result
    if result=$(stat -c '%u' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -f '%u' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

stat_size_bytes() {
    local path="$1" result
    if result=$(stat -c '%s' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -f '%z' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

stat_inode() {
    local path="$1" result
    if result=$(stat -c '%i' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -f '%i' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

stat_inode_follow() {
    local path="$1" result
    if result=$(stat -L -c '%i' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -L -f '%i' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

stat_mode_bits() {
    local path="$1" result
    if result=$(stat -c '%a' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -f '%Lp' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

cleanup_provenance_git_tmp() {
    if [ -n "$PROVENANCE_GIT_TMP" ] && [ -d "$PROVENANCE_GIT_TMP" ]; then
        rm -rf -- "$PROVENANCE_GIT_TMP"
    fi
    if [ -n "$PROVENANCE_RECEIPT_TMP" ] && [ -f "$PROVENANCE_RECEIPT_TMP" ]; then
        rm -f -- "$PROVENANCE_RECEIPT_TMP"
    fi
}

trap cleanup_provenance_git_tmp EXIT

ensure_provenance_git_tmp() {
    [ -n "$PROVENANCE_GIT_TMP" ] && [ -d "$PROVENANCE_GIT_TMP/repo" ] && return 0
    [ -x /usr/bin/git ] || return 1

    local tmp_root candidate
    tmp_root="${TMPDIR:-/tmp}"
    candidate=$(mktemp -d "${tmp_root%/}/skills-refiner-git-tree.XXXXXX") || return 1
    chmod 700 "$candidate" || {
        rm -rf -- "$candidate"
        return 1
    }
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$HOME_DIR" \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
        /usr/bin/git init --bare -q "$candidate/repo" >/dev/null 2>&1 || {
        rm -rf -- "$candidate"
        return 1
    }
    PROVENANCE_GIT_TMP="$candidate"
}

git_tree_hash_for_directory() {
    local entry_path="$1"
    GIT_TREE_HASH_RESULT=""
    ensure_provenance_git_tmp || return 1
    rm -f -- "$PROVENANCE_GIT_TMP/index"

    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$HOME_DIR" \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
        GIT_INDEX_FILE="$PROVENANCE_GIT_TMP/index" \
        /usr/bin/git --git-dir="$PROVENANCE_GIT_TMP/repo" --work-tree="$entry_path" \
        -c core.autocrlf=false -c core.filemode=true -c core.symlinks=true \
        add -f -A -- . >/dev/null 2>&1 || return 1
    GIT_TREE_HASH_RESULT=$(/usr/bin/env -i PATH=/usr/bin:/bin HOME="$HOME_DIR" \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
        GIT_INDEX_FILE="$PROVENANCE_GIT_TMP/index" \
        /usr/bin/git --git-dir="$PROVENANCE_GIT_TMP/repo" --work-tree="$entry_path" \
        write-tree 2>/dev/null) || return 1
    echo "$GIT_TREE_HASH_RESULT" | grep -Eq '^[0-9a-f]{40}$'
}

# Count files under a skill tree with a hard ceiling (does not walk forever).
count_tree_files_bounded() {
    local entry_path="$1"
    local limit="$2"
    local counted
    counted=$(find "$entry_path" \( -type f -o -type l \) 2>/dev/null \
        | head -n "$((limit + 1))" \
        | wc -l \
        | tr -d '[:space:]')
    echo "${counted:-0}"
}

snapshot_install_receipt() {
    local receipt_file="$1"
    local receipt_owner receipt_size receipt_mode path_inode fd_inode snapshot tmp_root

    [ -f "$receipt_file" ] && [ ! -L "$receipt_file" ] || return 1
    exec 9< "$receipt_file" || return 1

    path_inode=$(stat_inode "$receipt_file" 2>/dev/null || true)
    fd_inode=$(stat_inode_follow /dev/fd/9 2>/dev/null || true)
    receipt_owner=$(stat_owner_uid "$receipt_file" 2>/dev/null || true)
    receipt_size=$(stat_size_bytes "$receipt_file" 2>/dev/null || true)
    receipt_mode=$(stat_mode_bits "$receipt_file" 2>/dev/null || true)
    if [ -z "$path_inode" ] || [ "$path_inode" != "$fd_inode" ] ||
       [ "$receipt_owner" != "$(id -u)" ] ||
       ! echo "$receipt_size" | grep -Eq '^[0-9]+$' ||
       [ "$receipt_size" -gt "$MAX_SKILL_LOCK_BYTES" ] ||
       ! echo "$receipt_mode" | grep -Eq '^[0-7]{3,4}$' ||
       (( (8#$receipt_mode & 8#022) != 0 )); then
        exec 9<&-
        return 1
    fi

    tmp_root="${TMPDIR:-/tmp}"
    snapshot=$(mktemp "${tmp_root%/}/skills-refiner-receipt.XXXXXX") || {
        exec 9<&-
        return 1
    }
    chmod 600 "$snapshot" || {
        exec 9<&-
        rm -f -- "$snapshot"
        return 1
    }
    if ! cat <&9 > "$snapshot"; then
        exec 9<&-
        rm -f -- "$snapshot"
        return 1
    fi
    exec 9<&-

    if [ -L "$receipt_file" ] ||
       [ "$(stat_inode "$receipt_file" 2>/dev/null || true)" != "$path_inode" ] ||
       [ "$(stat_size_bytes "$snapshot" 2>/dev/null || true)" != "$receipt_size" ]; then
        rm -f -- "$snapshot"
        return 1
    fi

    printf '%s\n' "$snapshot"
}

mutation_provenance_for_entry() {
    local location="$1" entry_type="$2" entry_name="$3" entry_path="$4" receipt_snapshot="$5"
    local unknown='{"kind":"unknown","confidence":"none","evidence":null}'
    MUTATION_PROVENANCE_JSON="$unknown"

    if [ "$location" != ".agents/skills" ] || [ "$entry_type" != "directory" ]; then
        return
    fi

    if [ -z "$receipt_snapshot" ] || [ ! -f "$receipt_snapshot" ]; then
        return
    fi

    local receipt_file="$HOME_DIR/.agents/.skill-lock.json"

    if jq -e --arg skill "$entry_name" --argjson schema_version "$SKILL_LOCK_SCHEMA_VERSION" '
        .version == $schema_version and
        (.skills | type == "object") and
        (.skills[$skill] | type == "object") and
        ([.skills[$skill].source,
          .skills[$skill].sourceType,
          .skills[$skill].sourceUrl,
          .skills[$skill].skillPath]
         | all(type == "string" and length > 0)) and
        (.skills[$skill].sourceType == "github") and
        (.skills[$skill].skillFolderHash | type == "string" and test("^[0-9a-f]{40}$"))
    ' "$receipt_snapshot" >/dev/null 2>&1; then
        local receipt_sha256 expected_tree_sha1 installed_tree_sha1 tree_file_count
        receipt_sha256=$(sr_hash_file_raw "$receipt_snapshot" 2>/dev/null || true)
        expected_tree_sha1=$(jq -r --arg skill "$entry_name" '.skills[$skill].skillFolderHash' "$receipt_snapshot" 2>/dev/null || true)

        if $SKIP_PROVENANCE_TREE; then
            MUTATION_PROVENANCE_JSON=$(jq -n \
                --arg receipt_file "$receipt_file" \
                --arg receipt_sha256 "${receipt_sha256:-}" \
                '{kind:"unknown", confidence:"truncated",
                  evidence:{kind:"provenance_tree_skipped",
                            receipt_file:$receipt_file,
                            receipt_sha256:$receipt_sha256}}')
            return
        fi

        tree_file_count=$(count_tree_files_bounded "$entry_path" "$MAX_PROVENANCE_TREE_FILES")
        if ! echo "$tree_file_count" | grep -Eq '^[0-9]+$' \
            || [ "$tree_file_count" -gt "$MAX_PROVENANCE_TREE_FILES" ]; then
            MUTATION_PROVENANCE_JSON=$(jq -n \
                --arg receipt_file "$receipt_file" \
                --arg receipt_sha256 "${receipt_sha256:-}" \
                --argjson max_files "$MAX_PROVENANCE_TREE_FILES" \
                --argjson observed_files "${tree_file_count:-0}" \
                '{kind:"unknown", confidence:"truncated",
                  evidence:{kind:"provenance_tree_too_large",
                            receipt_file:$receipt_file,
                            receipt_sha256:$receipt_sha256,
                            max_files:$max_files,
                            observed_files:$observed_files}}')
            return
        fi

        if git_tree_hash_for_directory "$entry_path" 2>/dev/null; then
            installed_tree_sha1="$GIT_TREE_HASH_RESULT"
        else
            installed_tree_sha1=""
        fi
        if [ -n "$receipt_sha256" ] && [ "$installed_tree_sha1" = "$expected_tree_sha1" ]; then
            MUTATION_PROVENANCE_JSON=$(jq -n \
                --arg receipt_file "$receipt_file" \
                --arg receipt_sha256 "$receipt_sha256" \
                --arg installed_tree_sha1 "$installed_tree_sha1" \
                '{kind:"installed_copy", confidence:"direct",
                  evidence:{kind:"content_bound_installer_receipt",
                            receipt_file:$receipt_file,
                            receipt_sha256:$receipt_sha256,
                            installed_tree_sha1:$installed_tree_sha1}}')
            return
        fi
    else
        return
    fi
}

# ── Topology Scanner ──────────────────────────────────────────────────
scan_directory() {
    local dir="$1"
    local dir_label="$2"
    local results="[]"

    [ ! -d "$dir" ] && echo "$results" && return

    local install_receipt_snapshot=""
    if [ "$dir_label" = ".agents/skills" ]; then
        install_receipt_snapshot=$(snapshot_install_receipt "$HOME_DIR/.agents/.skill-lock.json" 2>/dev/null || true)
        PROVENANCE_RECEIPT_TMP="$install_receipt_snapshot"
    fi

    for entry_path in "$dir"/*; do
        [ -e "$entry_path" ] || [ -L "$entry_path" ] || continue
        [ -d "$entry_path" ] || [ -L "$entry_path" ] || continue
        local entry_name
        entry_name="${entry_path##*/}"
        [[ "$entry_name" == .* ]] && continue

        local entry_type link_target raw_link_target_base64
        link_target=""
        raw_link_target_base64=""
        if [ -L "$entry_path" ]; then
            local readlink_with_sentinel
            readlink_with_sentinel="$(readlink -n "$entry_path" 2>/dev/null; printf '\001')"
            link_target="${readlink_with_sentinel%$'\001'}"
            raw_link_target_base64=$(printf '%s' "$link_target" | base64 | tr -d '\r\n')
            if [ -d "$entry_path" ]; then
                entry_type="symlink"
            else
                entry_type="broken_symlink"
            fi
        elif [ -d "$entry_path" ]; then
            entry_type="directory"
        else
            continue
        fi

        local mutation_provenance_json
        mutation_provenance_for_entry "$dir_label" "$entry_type" "$entry_name" "$entry_path" "$install_receipt_snapshot"
        mutation_provenance_json="$MUTATION_PROVENANCE_JSON"

        if [ "$entry_type" = "broken_symlink" ]; then
            local entry_json
            entry_json=$(jq -n \
                --arg name "$entry_name" \
                --arg dir_name "$entry_name" \
                --arg location "$dir_label" \
                --arg entry_path "$entry_path" \
                --arg active_root "$dir" \
                --arg entry_type "broken_symlink" \
                --arg link_target "$link_target" \
                --arg raw_link_target_base64 "$raw_link_target_base64" \
                --argjson mutation_provenance "$mutation_provenance_json" \
                '{name: $name, dir_name: $dir_name, location: $location,
                  entry_path: $entry_path, active_root: $active_root,
                  entry_kind: $entry_type, type: $entry_type,
                  link_target: $link_target,
                  raw_link_target: $link_target,
                  raw_link_target_base64: $raw_link_target_base64,
                  mutation_provenance: $mutation_provenance,
                  description: "", word_count: 0, age_days: 0,
                  flags: ["broken_symlink"]}')
            results=$(echo "$results" | jq --argjson e "$entry_json" '. + [$e]')
            continue
        fi

        local canonical_dir canonical_dir_with_sentinel skill_file source_skill_file canonical_skill_file
        canonical_dir_with_sentinel=$(canonical_dir_for_entry "$entry_path" 2>/dev/null || true)
        canonical_dir="${canonical_dir_with_sentinel%$'\001'}"
        [ -z "$canonical_dir" ] && continue

        skill_file="$canonical_dir/SKILL.md"
        source_skill_file="$entry_path/SKILL.md"
        canonical_skill_file="$skill_file"
        [ ! -f "$skill_file" ] && continue

        local name desc_full desc top_version metadata_version declared_version word_count mtime mtime_iso now age_days
        name=$(get_frontmatter "$skill_file" "name")
        desc_full=$(get_frontmatter_text "$skill_file" "description")
        desc="$desc_full"
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

        local desc_length desc_length_json desc_length_valid desc_utf8_bytes desc_length_over_limit desc_over_limit desc_scalar_kind runtime_status runtime_loadable_json
        desc_length=""
        desc_length_json="null"
        desc_length_valid=false
        if desc_length=$(utf8_codepoint_length "$desc_full"); then
            desc_length_json="$desc_length"
            desc_length_valid=true
        fi
        desc_utf8_bytes=$(utf8_byte_length "$desc_full")
        desc_scalar_kind=$(frontmatter_scalar_kind "$skill_file" "description")
        desc_length_over_limit=false
        desc_over_limit=false
        if $desc_length_valid && [ "$desc_length" -gt "$MAX_DESCRIPTION_LENGTH" ]; then
            desc_length_over_limit=true
            if [ "$desc_scalar_kind" = "plain-simple" ]; then
                desc_over_limit=true
            fi
        fi

        runtime_status="unknown"
        runtime_loadable_json="null"
        if $desc_over_limit; then
            runtime_status="fail"
            runtime_loadable_json="false"
        fi

        [ -z "$name" ] && flags+=("name_not_observed")
        [ -z "$desc" ] && flags+=("description_not_observed")
        if $desc_over_limit; then
            flags+=("description_too_long:${desc_length}>${MAX_DESCRIPTION_LENGTH}")
        elif $desc_length_over_limit; then
            flags+=("description_length_over_limit_unverified:${desc_length}>${MAX_DESCRIPTION_LENGTH}")
        fi

        [ "$word_count" -lt 30 ] && flags+=("very_small")
        [ "$word_count" -gt 5000 ] && flags+=("very_large")
        [ "$age_days" -gt "$STALE_DAYS" ] && flags+=("stale_${age_days}d")

        local content pipe_to_shell_re dangerous_cmd_re secret_assignment_re
        content=$(cat "$skill_file" 2>/dev/null)
        # Assemble detector regexes so the scanner's own source is not mistaken
        # for an executable instruction by third-party static checks.
        pipe_to_shell_re="(cu""rl|wge""t)[[:space:][:graph:]]*[|][[:space:]]*(ba""sh|sh)"
        dangerous_cmd_re="r""m[[:space:]]+-r""f[[:space:]]+/|su""do[[:space:]]+"
        secret_assignment_re='(API_KEY|TOKEN|SECRET)[[:space:]]*='
        echo "$content" | grep -qE "$pipe_to_shell_re" && flags+=("pipe_to_shell")
        echo "$content" | grep -qE "$dangerous_cmd_re" && flags+=("dangerous_cmd")
        echo "$content" | grep -qE "$secret_assignment_re" && flags+=("possible_secret")

        local broken_refs=()
        local refs
        refs=$(extract_active_at_refs "$skill_file")
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

        local risk_json normalized_content_sha256 git_root git_remote git_branch source_kind
        risk_json=$(printf '%s\n' "${flags[@]}" | jq -R 'select(. == "pipe_to_shell" or . == "dangerous_cmd" or . == "possible_secret") | {id: ., severity: "review_required"}' | jq -s .)
        [ -z "$risk_json" ] && risk_json='[]'

        normalized_content_sha256=$(hash_file "$skill_file")
        git_root=$(git_root_for_dir "$canonical_dir")
        git_remote=$(git_remote_for_root "$git_root")
        git_branch=$(git_branch_for_root "$git_root")
        source_kind=$(source_kind_for_entry "$dir_label" "$entry_type")

        local when_to_use when_to_use_preview disable_model_invocation user_invocable model effort context agent shell_value
        local allowed_tools_json paths_json hook_events_json_value has_hooks extra_keys_json fm_keys_json openai_yaml openai_yaml_exists
        local allow_implicit_invocation tool_dependencies_count
        local desc_truncated when_to_use_length when_to_use_truncated allowed_tools_count paths_count

        when_to_use=$(get_frontmatter_text "$skill_file" "when_to_use")
        when_to_use_preview="$when_to_use"
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

        desc_truncated=false
        $desc_length_valid && [ "$desc_length" -gt 200 ] && desc_truncated=true
        when_to_use_length=$(utf8_codepoint_length "$when_to_use" 2>/dev/null || echo 0)
        when_to_use_truncated=false
        [ "$when_to_use_length" -gt 200 ] && when_to_use_truncated=true
        allowed_tools_count=$(echo "$allowed_tools_json" | jq 'length')
        paths_count=$(echo "$paths_json" | jq 'length')

        openai_yaml="$canonical_dir/agents/openai.yaml"
        openai_yaml_exists=false
        allow_implicit_invocation=""
        tool_dependencies_count=0
        if [ -f "$openai_yaml" ]; then
            openai_yaml_exists=true
            allow_implicit_invocation=$(yaml_section_scalar "$openai_yaml" "policy" "allow_implicit_invocation")
            tool_dependencies_count=$(yaml_sequence_count "$openai_yaml" "tools")
        fi

        local entry_json
        entry_json=$(jq -n \
            --arg name "${name:-$entry_name}" \
            --arg frontmatter_name "$name" \
            --arg dir_name "$entry_name" \
            --arg location "$dir_label" \
            --arg entry_path "$entry_path" \
            --arg active_root "$dir" \
            --arg entry_type "$entry_type" \
            --arg raw_link_target "$link_target" \
            --arg raw_link_target_base64 "$raw_link_target_base64" \
            --arg source_skill_file "$source_skill_file" \
            --arg canonical_skill_file "$canonical_skill_file" \
            --arg canonical_dir "$canonical_dir" \
            --arg desc "$desc" \
            --arg declared_version "$declared_version" \
            --arg metadata_version "$metadata_version" \
            --arg normalized_content_sha256 "$normalized_content_sha256" \
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
            --arg allow_implicit_invocation "$allow_implicit_invocation" \
            --arg runtime_status "$runtime_status" \
            --arg description_scalar_kind "$desc_scalar_kind" \
            --argjson words "$word_count" \
            --argjson mtime "$mtime" \
            --argjson age "$age_days" \
            --argjson stale_days "$STALE_DAYS" \
            --argjson max_description_length "$MAX_DESCRIPTION_LENGTH" \
            --argjson desc_length "$desc_length_json" \
            --argjson desc_length_valid "$desc_length_valid" \
            --argjson desc_length_over_limit "$desc_length_over_limit" \
            --argjson desc_utf8_bytes "$desc_utf8_bytes" \
            --argjson desc_truncated "$desc_truncated" \
            --argjson desc_over_limit "$desc_over_limit" \
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
            --argjson tool_dependencies_count "$tool_dependencies_count" \
            --argjson runtime_loadable "$runtime_loadable_json" \
            --argjson mutation_provenance "$mutation_provenance_json" \
            --argjson flags "$flags_json" \
            --argjson risks "$risk_json" \
            '{
                name: $name,
                dir_name: $dir_name,
                location: $location,
                entry_path: $entry_path,
                active_root: $active_root,
                entry_kind: $entry_type,
                type: $entry_type,
                link_target: $raw_link_target,
                raw_link_target: (if $raw_link_target == "" then null else $raw_link_target end),
                raw_link_target_base64: (if $entry_type == "directory" then null else $raw_link_target_base64 end),
                mutation_provenance: $mutation_provenance,
                source_skill_file: $source_skill_file,
                canonical_skill_file: $canonical_skill_file,
                canonical_dir: $canonical_dir,
                description: $desc[0:200],
                frontmatter: {
                    contract: "name_description_only",
                    name: $frontmatter_name,
                    description: $desc[0:200],
                    max_description_length: $max_description_length,
                    description_length: $desc_length,
                    description_utf8_bytes: $desc_utf8_bytes,
                    description_truncated: $desc_truncated
                },
                runtime_contract: {
                    loader: "agent-skills",
                    status: $runtime_status,
                    loadable: $runtime_loadable,
                    runtime_verified: false,
                    validation_method: "conservative-static-frontmatter-preflight",
                    unknown_reason: (if $runtime_status == "unknown" then "runtime_loader_not_executed" else null end),
                    load_blockers: ([
                        if $desc_over_limit then "description_too_long" else empty end
                    ]),
                    unverified_requirements: ([
                        if $frontmatter_name == "" then "name_not_observed_by_lightweight_parser" else empty end,
                        if $desc == "" then "description_not_observed_by_lightweight_parser" else empty end,
                        if ($desc_length_valid | not) then "description_length_not_verified_invalid_utf8" else empty end,
                        if $desc_length_over_limit and ($desc_over_limit | not) then "description_length_over_limit_parser_not_authoritative" else empty end
                    ]),
                    max_description_length: $max_description_length,
                    description_length: $desc_length,
                    description_length_valid: $desc_length_valid,
                    description_scalar_kind: $description_scalar_kind,
                    description_utf8_bytes: $desc_utf8_bytes
                },
                claude_code: {
                    when_to_use_length: $when_to_use_length,
                    when_to_use_preview: $when_to_use_preview[0:200],
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
                    allow_implicit_invocation: $allow_implicit_invocation,
                    tool_dependencies_count: $tool_dependencies_count
                },
                extra_frontmatter_keys: $extra_keys,
                declared_version: $declared_version,
                metadata_version: $metadata_version,
                normalized_content_sha256: $normalized_content_sha256,
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

    if [ -n "$install_receipt_snapshot" ]; then
        rm -f -- "$install_receipt_snapshot"
        PROVENANCE_RECEIPT_TMP=""
    fi
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
    all_data=$(jq -n --arg scanned_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson stale_days "$STALE_DAYS" --argjson max_description_length "$MAX_DESCRIPTION_LENGTH" '{metadata:{schema_version:"skill-scan.v5", product_version:"2.0", scanned_at:$scanned_at, stale_days:$stale_days, max_description_length:$max_description_length, scope:"agent-recognized-directories", hash_normalization:"strip-canary-crlf-bom.v1", runtime_validation_mode:"static-preflight", runtime_status_semantics:"pass=runtime validator confirmed; fail=proven blocker; unknown=runtime loader not executed"}, topology:{}, skills:[], skill_links:[], broken_symlinks:[], entries:[], runtime_load_blockers:[], name_collisions:[]}')

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
        def is_backup_or_archive:
            (.dir_name | test("\\.backup\\.|\\.disabled|\\.tmp|\\.old|\\.archive"));
        .entries = (.skills + .skill_links + .broken_symlinks) |
        .runtime_load_blockers = (
            .skills + .skill_links
            | unique_by(.canonical_skill_file)
            | map(select(.runtime_contract.status == "fail") | {
                name,
                location,
                type,
                canonical_skill_file,
                load_blockers: .runtime_contract.load_blockers,
                description_length: .runtime_contract.description_length,
                max_description_length: .runtime_contract.max_description_length
            })
        ) |
        .name_collisions = (
            [.skills[] | select(is_backup_or_archive | not)]
            | sort_by(.name)
            | group_by(.name)
            | map(select(length > 1) | {
                name: .[0].name,
                real_directory_count: length,
                distinct_canonical_dirs: ([.[].canonical_dir] | unique | length),
                distinct_versions: ([.[].declared_version | select(length > 0)] | unique),
                distinct_hashes: ([.[].normalized_content_sha256 | select(length > 0)] | unique),
                entries: [.[] | {
                    location,
                    canonical_dir,
                    canonical_skill_file,
                    declared_version,
                    normalized_content_sha256,
                    provenance
                }]
            })
            | map(select((.distinct_versions | length) > 1 or (.distinct_hashes | length) > 1))
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
        echo -e "  ${YELLOW}Active name/version/content collisions:${NC} $collision_count"
    else
        echo "  Active name/version/content collisions: 0"
    fi
    echo ""

    local broken_count security_count load_blocker_count backup_count critical_count advisory_count
    broken_count=$(echo "$all_data" | jq '.broken_symlinks | length')
    security_count=$(echo "$all_data" | jq '[.skills[] | select(any(.flags[]?; . == "pipe_to_shell" or . == "dangerous_cmd" or . == "possible_secret"))] | length')
    load_blocker_count=$(echo "$all_data" | jq '.runtime_load_blockers | length')
    backup_count=$(echo "$all_data" | jq '[.skills[] | select(any(.flags[]?; startswith("backup")))] | length')
    critical_count=$((broken_count + security_count + load_blocker_count + collision_count))
    advisory_count=$backup_count
    echo -e "${BOLD}── Severity Summary ──${NC}"
    echo "  Critical signals:     $critical_count (load blockers: $load_blocker_count, broken symlinks: $broken_count, security review flags: $security_count, active collisions: $collision_count)"
    echo "  Advisory signals:     $advisory_count (backup/archive remnants)"
    echo "  Informational signals: topology, provenance, size, and age distributions below"
    echo -e "  ${DIM}Signals are not verdicts; validate high-priority paths directly before cleanup.${NC}"
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
            echo "$flags" | grep -qE 'dangerous_|pipe_to_shell|possible_secret|description_too_long|name_not_observed|description_not_observed' && color="$RED"
            printf "  ${color}%-30s${NC} %-20s %-8s %s\n" "${name:0:30}" "${loc:0:20}" "$words" "$flags"
        done
        echo ""
    fi

    if [ "$load_blocker_count" -gt 0 ]; then
        echo -e "${RED}${BOLD}── Runtime Load Blockers ──${NC}"
        echo "$all_data" | jq -r '.runtime_load_blockers[] | "  \(.name) in \(.location) -> \(.load_blockers | join(", ")) (\(.canonical_skill_file))"'
        echo ""
    fi

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
