#!/usr/bin/env bash
# Shared helpers for skills-refiner governance scripts.

SR_TRACE_START_RE='^<!-- SKILL-DEBUG-TRACE-START( v[0-9]+)? -->[[:space:]]*$'
SR_TRACE_END_RE='^<!-- SKILL-DEBUG-TRACE-END( v[0-9]+)? -->[[:space:]]*$'

sr_agent_skill_dirs() {
    cat <<'EOF'
.warp/skills
.agents/skills
.claude/skills
.codex/skills
.cursor/skills
.cursor/skills-cursor
.gemini/skills
.copilot/skills
.factory/skills
.github/skills
.opencode/skills
EOF
}

sr_detect_home_dir() {
    if [ -n "${HOME:-}" ]; then
        printf '%s\n' "$HOME"
        return 0
    fi

    local user home
    user=$(id -un 2>/dev/null || whoami 2>/dev/null || true)

    if [ -n "$user" ] && command -v getent >/dev/null 2>&1; then
        home=$(getent passwd "$user" 2>/dev/null | awk -F: '{print $6; exit}')
        [ -n "$home" ] && { printf '%s\n' "$home"; return 0; }
    fi

    if [ -n "$user" ] && command -v dscl >/dev/null 2>&1; then
        home=$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | awk '{print $2; exit}')
        [ -n "$home" ] && { printf '%s\n' "$home"; return 0; }
    fi

    if [ -n "$user" ]; then
        for home in "/Users/$user" "/home/$user"; do
            [ -d "$home" ] && { printf '%s\n' "$home"; return 0; }
        done
    fi

    return 1
}

sr_canonical_dir() {
    cd -P "$1" 2>/dev/null && pwd
}

sr_canonical_file() {
    local file="$1" dir base resolved_dir
    dir=$(dirname "$file")
    base=$(basename "$file")
    resolved_dir=$(sr_canonical_dir "$dir") || return 1
    printf '%s/%s\n' "$resolved_dir" "$base"
}

sr_resolve_symlink_target() {
    local path="$1" target="$2" base_dir target_dir target_name resolved_dir
    if [ -z "$target" ]; then
        return 1
    fi
    if [ "${target#/}" != "$target" ]; then
        target_dir=$(dirname "$target")
        target_name=$(basename "$target")
        resolved_dir=$(sr_canonical_dir "$target_dir") || return 1
        printf '%s/%s\n' "$resolved_dir" "$target_name"
        return 0
    fi
    base_dir=$(sr_canonical_dir "$(dirname "$path")") || return 1
    target_dir=$(dirname "$target")
    target_name=$(basename "$target")
    resolved_dir=$(sr_canonical_dir "$base_dir/$target_dir") || return 1
    printf '%s/%s\n' "$resolved_dir" "$target_name"
}

sr_hash_string() {
    local value="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$value" | sha256sum | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        printf '%s' "$value" | shasum -a 256 | awk '{print $1}'
    else
        printf '%s' "$value" | cksum | awk '{print $1}'
    fi
}

sr_hash_stream() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 | awk '{print $1}'
    else
        cksum | awk '{print $1}'
    fi
}

sr_hash_file_raw() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" 2>/dev/null | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" 2>/dev/null | awk '{print $1}'
    else
        echo ""
    fi
}

sr_normalize_skill_content() {
    local file="$1"
    awk '
        function clean(line) {
            sub(/\r$/, "", line)
            return line
        }
        {
            line=clean($0)
            if (NR == 1) {
                if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
            }
            if (skip) {
                if (line ~ /^<!-- SKILL-DEBUG-TRACE-END( v[0-9]+)? -->[[:space:]]*$/) {
                    skip=0
                }
                next
            }
            if (pending_header) {
                if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v[0-9]+)? -->[[:space:]]*$/) {
                    skip=1
                    pending_header=0
                    next
                }
                print pending_header_text
                pending_header=0
            }
            if (line ~ /^```/) {
                in_fence = !in_fence
                print line
                next
            }
            if (!in_fence && line ~ /^## Activation (Canary )?Trace \(auto-injected by skill-debug\)[[:space:]]*$/) {
                pending_header=1
                pending_header_text=line
                next
            }
            if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v[0-9]+)? -->[[:space:]]*$/) {
                skip=1
                next
            }
            print line
        }
        END {
            if (pending_header) {
                print pending_header_text
            }
        }
    ' "$file" 2>/dev/null
}

sr_hash_skill_file() {
    local file="$1"
    sr_normalize_skill_content "$file" | sr_hash_stream
}

sr_skill_has_trace() {
    local file="$1"
    awk '
        {
            line=$0
            sub(/\r$/, "", line)
            if (line ~ /^```/) {
                in_fence = !in_fence
                next
            }
            if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v[0-9]+)? -->[[:space:]]*$/) {
                found=1
                exit
            }
        }
        END { exit found ? 0 : 1 }
    ' "$file" 2>/dev/null
}

sr_strip_trace_blocks() {
    local file="$1"
    awk '
        function clean(line) {
            sub(/\r$/, "", line)
            return line
        }
        {
            line=clean($0)
            if (skip) {
                if (line ~ /^<!-- SKILL-DEBUG-TRACE-END( v[0-9]+)? -->[[:space:]]*$/) {
                    skip=0
                }
                next
            }
            if (pending_header) {
                if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v[0-9]+)? -->[[:space:]]*$/) {
                    skip=1
                    pending_header=0
                    next
                }
                print pending_header_text
                pending_header=0
            }
            if (line ~ /^```/) {
                in_fence = !in_fence
                print $0
                next
            }
            if (!in_fence && line ~ /^## Activation (Canary )?Trace \(auto-injected by skill-debug\)[[:space:]]*$/) {
                pending_header=1
                pending_header_text=$0
                next
            }
            if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v[0-9]+)? -->[[:space:]]*$/) {
                skip=1
                next
            }
            print $0
        }
        END {
            if (pending_header) {
                print pending_header_text
            }
        }
    ' "$file" 2>/dev/null
}

sr_get_frontmatter_field() {
    local file="$1" key="$2"
    awk -v key="$key" '
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { exit }
        in_fm && line ~ "^" key ":[[:space:]]*" {
            sub("^" key ":[[:space:]]*", "", line)
            gsub(/^['\''\"]|['\''\"]$/, "", line)
            print line
            exit
        }
    ' "$file" 2>/dev/null | head -c 300
}

sr_get_frontmatter_text() {
    local file="$1" key="$2"
    awk -v key="$key" '
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { exit }
        in_fm && line ~ "^[A-Za-z0-9_-]+:" {
            if (capture) { exit }
            if (line ~ "^" key ":[[:space:]]*") {
                value=line
                sub("^" key ":[[:space:]]*", "", value)
                gsub(/^['\''\"]|['\''\"]$/, "", value)
                if (value ~ /^[|>][+-]?$/) { capture=1; next }
                print value
                exit
            }
        }
        capture {
            if (line ~ /^[^[:space:]]/) { exit }
            sub(/^[[:space:]]+/, "", line)
            print line
        }
    ' "$file" 2>/dev/null
}

sr_get_metadata_value() {
    local file="$1" key="$2"
    awk -v key="$key" '
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { exit }
        in_fm && line == "metadata:" { in_meta=1; next }
        in_meta && line ~ /^[^[:space:]]/ { exit }
        in_meta && line ~ "^[[:space:]]+" key ":[[:space:]]*" {
            sub("^[[:space:]]+" key ":[[:space:]]*", "", line)
            gsub(/^['\''\"]|['\''\"]$/, "", line)
            print line
            exit
        }
    ' "$file" 2>/dev/null | head -c 300
}

sr_frontmatter_keys_json() {
    local file="$1"
    awk '
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { exit }
        in_fm && line ~ /^[A-Za-z0-9_-]+:/ {
            key=line
            sub(/:.*/, "", key)
            print key
        }
    ' "$file" 2>/dev/null | jq -R 'select(length > 0)' | jq -s .
}

sr_frontmatter_list_json() {
    local file="$1" key="$2"
    awk -v key="$key" '
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { exit }
        in_fm && line ~ "^[A-Za-z0-9_-]+:" {
            if (capture) { exit }
            if (line ~ "^" key ":[[:space:]]*") {
                value=line
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
        capture && line ~ /^[[:space:]]*-[[:space:]]*/ {
            item=line
            sub(/^[[:space:]]*-[[:space:]]*/, "", item)
            gsub(/^['\''\"]|['\''\"]$/, "", item)
            if (item != "") print item
            next
        }
        capture && line ~ /^[^[:space:]]/ { exit }
    ' "$file" 2>/dev/null | jq -R 'select(length > 0)' | jq -s .
}

sr_hook_events_json() {
    local file="$1"
    awk '
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { exit }
        in_fm && line == "hooks:" { in_hooks=1; next }
        in_hooks && line ~ /^[^[:space:]]/ { exit }
        in_hooks && line ~ /^[[:space:]]{2}[A-Za-z0-9_-]+:/ {
            event=line
            sub(/^[[:space:]]+/, "", event)
            sub(/:.*/, "", event)
            print event
        }
    ' "$file" 2>/dev/null | jq -R 'select(length > 0)' | jq -s 'unique'
}
