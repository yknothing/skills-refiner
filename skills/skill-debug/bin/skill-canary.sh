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
debug_dir="$home_dir/.agents/debug"
mkdir -p "$debug_dir" || exit 1

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
event_cwd=$(pwd)

if command -v jq >/dev/null 2>&1; then
    jq -cn \
        --arg skill "$skill_name" \
        --arg identity_key "$identity_key" \
        --arg ts "$ts" \
        --arg cwd "$event_cwd" \
        '{event:"skill_canary_observed",trace_schema:"skill-debug.identity.v1",trace_kind:"canary",skill:$skill,identity_key:$identity_key,ts:$ts,cwd:$cwd}' \
        >> "$debug_dir/activation.jsonl"
else
    # Fallback without jq: only safe because skill name, identity key, ts, and
    # cwd are locally derived; names/paths containing double quotes are rare
    # but would corrupt this line, so jq is strongly preferred.
    printf '{"event":"skill_canary_observed","trace_schema":"skill-debug.identity.v1","trace_kind":"canary","skill":"%s","identity_key":"%s","ts":"%s","cwd":"%s"}\n' \
        "$skill_name" "$identity_key" "$ts" "$event_cwd" >> "$debug_dir/activation.jsonl"
fi
