#!/usr/bin/env bash
# skill-canary.sh — append one canary observation event for a skill.
#
# Called by the short canary block that skill-trace.sh injects into SKILL.md
# files. Keeping the normalized-hash identity computation here (single
# implementation, sourced from lib/common.sh) means injected files never carry
# a frozen copy of the normalization algorithm: when the algorithm evolves,
# every previously injected canary picks up the new behavior automatically.
#
# Usage:
#   bash skill-canary.sh <SKILL.md>

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_SH="$SCRIPT_DIR/../lib/common.sh"
[ -f "$COMMON_SH" ] || { echo "[ERROR] Missing shared helper: $COMMON_SH" >&2; exit 1; }
# shellcheck source=../lib/common.sh
. "$COMMON_SH"
sr_require_sha256 || exit $?

skill_file="${1:-}"
if [ -z "$skill_file" ]; then
    echo "Usage: skill-canary.sh <SKILL.md>" >&2
    exit 2
fi
if [ ! -f "$skill_file" ]; then
    echo "[ERROR] File not found: $skill_file" >&2
    exit 1
fi

canonical_skill_file=$(sr_canonical_file "$skill_file" 2>/dev/null) || canonical_skill_file="$skill_file"

skill_name=$(sr_get_frontmatter_field "$canonical_skill_file" "name")
[ -n "$skill_name" ] || skill_name=$(basename "$(dirname "$canonical_skill_file")")

normalized_hash=$(sr_hash_skill_file "$canonical_skill_file")
identity_key=$(sr_hash_string "${canonical_skill_file}|${normalized_hash}")

home_dir=$(sr_detect_home_dir) || {
    echo "[ERROR] Unable to determine home directory. Set HOME and retry." >&2
    exit 2
}
platform_family=$(sr_platform_family)
if ! sr_canary_storage_supported "$home_dir"; then
    echo "[ERROR] Canary logging requires enforceable POSIX file permissions; unsupported environment: $platform_family with HOME=$home_dir. On Windows, use WSL 2 with HOME on its Linux filesystem." >&2
    exit 2
fi
debug_dir="$home_dir/.agents/debug"
log_file="$debug_dir/activation.jsonl"
umask 077
sr_path_has_symlink_component "$debug_dir" "$home_dir" && { echo "[ERROR] Refusing canary path with a symlink component: $debug_dir" >&2; exit 1; }
mkdir -p "$debug_dir" || exit 1
[ -d "$debug_dir" ] || exit 1
sr_path_has_symlink_component "$debug_dir" "$home_dir" && { echo "[ERROR] Refusing canary path with a symlink component: $debug_dir" >&2; exit 1; }
chmod 700 "$debug_dir" || exit 1
sr_file_mode_is "$debug_dir" 700 || { echo "[ERROR] Unable to verify mode 0700 for canary directory: $debug_dir" >&2; exit 1; }
sr_path_has_symlink_component "$log_file" "$home_dir" && { echo "[ERROR] Refusing canary path with a symlink component: $log_file" >&2; exit 1; }
if [ ! -e "$log_file" ]; then
    (set -o noclobber; umask 077; : > "$log_file") 2>/dev/null || exit 1
fi
[ -f "$log_file" ] || exit 1
sr_path_has_symlink_component "$log_file" "$home_dir" && { echo "[ERROR] Refusing canary path with a symlink component: $log_file" >&2; exit 1; }
chmod 600 "$log_file" || exit 1
sr_file_mode_is "$log_file" 600 || { echo "[ERROR] Unable to verify mode 0600 for activation log: $log_file" >&2; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
event_cwd=$(pwd)

if command -v jq >/dev/null 2>&1; then
    jq -cn \
        --arg skill "$skill_name" \
        --arg identity_key "$identity_key" \
        --arg ts "$ts" \
        --arg cwd "$event_cwd" \
        '{event:"skill_canary_observed",trace_schema:"skill-debug.identity.v1",trace_kind:"canary",skill:$skill,identity_key:$identity_key,ts:$ts,cwd:$cwd}' \
        >> "$log_file"
else
    escaped_skill=$(printf '%s' "$skill_name" | sr_json_escape)
    escaped_cwd=$(printf '%s' "$event_cwd" | sr_json_escape)
    printf '{"event":"skill_canary_observed","trace_schema":"skill-debug.identity.v1","trace_kind":"canary","skill":"%s","identity_key":"%s","ts":"%s","cwd":"%s"}\n' \
        "$escaped_skill" "$identity_key" "$ts" "$escaped_cwd" >> "$log_file"
fi
