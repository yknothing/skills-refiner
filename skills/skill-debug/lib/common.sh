#!/usr/bin/env bash
# Shared helpers for skills-refiner governance scripts.

SR_TRACE_START_RE='^<!-- SKILL-DEBUG-TRACE-START( v1)? -->[[:space:]]*$'
SR_TRACE_END_RE='^<!-- SKILL-DEBUG-TRACE-END( v1)? -->[[:space:]]*$'

sr_platform_family_from_kernel() {
    case "${1:-}" in
        Darwin) echo "macos" ;;
        Linux) echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows-posix" ;;
        *) echo "unknown" ;;
    esac
}

sr_platform_family() {
    local kernel family kernel_release=""
    kernel=$(uname -s 2>/dev/null) || {
        echo "unknown"
        return 0
    }
    family=$(sr_platform_family_from_kernel "$kernel")
    if [ "$family" = "linux" ] && [ -r /proc/sys/kernel/osrelease ]; then
        IFS= read -r kernel_release </proc/sys/kernel/osrelease || kernel_release=""
        case "$kernel_release" in
            *Microsoft*|*microsoft*|*WSL*|*wsl*) family="windows-wsl" ;;
        esac
    fi
    echo "$family"
}

sr_canary_storage_supported() {
    local home_dir="$1" family
    family=$(sr_platform_family)
    case "$family" in
        macos|linux)
            return 0
            ;;
        windows-wsl)
            # WSL can only make the 0700/0600 contract meaningful on a Linux
            # filesystem. DrvFs paths may ignore or emulate chmod unless the
            # mount was explicitly configured with metadata.
            case "$home_dir" in
                /mnt/?|/mnt/?/*) return 1 ;;
                *) return 0 ;;
            esac
            ;;
        *)
            return 1
            ;;
    esac
}

sr_path_has_symlink_component() {
    local current="$1" stop_at="${2:-/}" parent
    [ -n "$current" ] || return 1
    while :; do
        [ -L "$current" ] && return 0
        [ "$current" = "$stop_at" ] && break
        [ "$current" = "/" ] && return 0
        parent=$(dirname "$current") || return 0
        [ "$parent" = "$current" ] && break
        current="$parent"
    done
    return 1
}

sr_file_mode() {
    local path="$1" mode
    mode=$(stat -c '%a' "$path" 2>/dev/null) || mode=$(stat -f '%Lp' "$path" 2>/dev/null) || return 1
    printf '%s\n' "$mode"
}

sr_file_mode_is() {
    local path="$1" expected="$2" actual
    actual=$(sr_file_mode "$path") || return 1
    [ "$actual" = "$expected" ]
}

sr_require_sha256() {
    if command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1; then
        return 0
    fi
    echo "[ERROR] sha256sum or shasum is required for normalized_content_sha256 identity." >&2
    return 127
}

sr_agent_skill_dirs() {
    local home_dir="${1:-}"
    {
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
        if [ -n "$home_dir" ] && [ -d "$home_dir" ]; then
            local root
            for root in "$home_dir"/.[!.]*/skills; do
                [ -d "$root" ] || continue
                printf '%s\n' "${root#"$home_dir"/}"
            done
        fi
    } | awk '!seen[$0]++'
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
    local file="$1" dir base resolved_dir current target hops=0
    dir=$(dirname "$file")
    base=$(basename "$file")
    resolved_dir=$(sr_canonical_dir "$dir") || return 1
    current="$resolved_dir/$base"

    while [ -L "$current" ]; do
        hops=$((hops + 1))
        [ "$hops" -le 40 ] || return 1
        target=$(readlink "$current" 2>/dev/null) || return 1
        if [ "${target#/}" != "$target" ]; then
            current="$target"
        else
            current="$(dirname "$current")/$target"
        fi
        resolved_dir=$(sr_canonical_dir "$(dirname "$current")") || return 1
        current="$resolved_dir/$(basename "$current")"
    done

    printf '%s\n' "$current"
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
        echo "[ERROR] sha256sum or shasum is required for normalized_content_sha256 identity." >&2
        return 127
    fi
}

sr_hash_stream() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 | awk '{print $1}'
    else
        echo "[ERROR] sha256sum or shasum is required for normalized_content_sha256 identity." >&2
        return 127
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

sr_json_escape() {
    LC_ALL=C awk '
        BEGIN {
            ORS=""
            controls=""
            for (i = 1; i <= 31; i++) controls=controls sprintf("%c", i)
        }
        {
            if (NR > 1) printf "\\n"
            for (i = 1; i <= length($0); i++) {
                ch=substr($0, i, 1)
                if (ch == "\\") printf "\\\\"
                else if (ch == "\"") printf "\\\""
                else {
                    control=index(controls, ch)
                    if (control > 0) printf "\\u%04x", control
                    else printf "%s", ch
                }
            }
        }
    '
}

sr_normalize_skill_content() {
    local file="$1"
    if ! sr_validate_trace_structure "$file"; then
        LC_ALL=C awk '
            {
                line=$0
                sub(/\r$/, "", line)
                if (NR == 1 && substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
                print line
            }
        ' "$file" 2>/dev/null
        return
    fi
    LC_ALL=C awk '
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
                if (line ~ /^<!-- SKILL-DEBUG-TRACE-END( v1)? -->[[:space:]]*$/) {
                    skip=0
                }
                next
            }
            if (pending_header) {
                if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v1)? -->[[:space:]]*$/) {
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
            if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v1)? -->[[:space:]]*$/) {
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
    LC_ALL=C awk '
        {
            line=$0
            sub(/\r$/, "", line)
            if (line ~ /^```/) {
                in_fence = !in_fence
                next
            }
            if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v1)? -->[[:space:]]*$/) {
                found=1
                exit
            }
        }
        END { exit found ? 0 : 1 }
    ' "$file" 2>/dev/null
}

sr_validate_trace_structure() {
    local file="$1"
    LC_ALL=C awk '
        {
            line=$0
            sub(/\r$/, "", line)
            if (line ~ /^```/) {
                in_fence = !in_fence
                next
            }
            if (in_fence) next
            if (line ~ /^<!-- SKILL-DEBUG-TRACE-START/) {
                version=""
                if (line ~ /^<!-- SKILL-DEBUG-TRACE-START -->[[:space:]]*$/) version="legacy"
                else if (line ~ /^<!-- SKILL-DEBUG-TRACE-START v1 -->[[:space:]]*$/) version="v1"
                else invalid=1
                if (depth != 0 || blocks != 0) invalid=1
                depth=1
                start_version=version
                blocks++
                next
            }
            if (line ~ /^<!-- SKILL-DEBUG-TRACE-END/) {
                version=""
                if (line ~ /^<!-- SKILL-DEBUG-TRACE-END -->[[:space:]]*$/) version="legacy"
                else if (line ~ /^<!-- SKILL-DEBUG-TRACE-END v1 -->[[:space:]]*$/) version="v1"
                else invalid=1
                if (depth != 1) invalid=1
                else {
                    if (version != start_version) invalid=1
                    depth=0
                }
            }
        }
        END {
            if (depth != 0) invalid=1
            exit invalid ? 1 : 0
        }
    ' "$file" 2>/dev/null
}

sr_file_eof_state() {
    local file="$1" byte_tmp od_tmp last_byte
    [ -f "$file" ] && [ -r "$file" ] || return 2
    if [ ! -s "$file" ]; then
        echo "none"
        return 0
    fi
    byte_tmp=$(mktemp) || return 2
    od_tmp=$(mktemp) || { rm -f "$byte_tmp"; return 2; }
    if ! LC_ALL=C tail -c 1 "$file" >"$byte_tmp" 2>/dev/null \
        || ! LC_ALL=C od -An -tu1 <"$byte_tmp" >"$od_tmp" 2>/dev/null; then
        rm -f "$byte_tmp" "$od_tmp"
        return 2
    fi
    last_byte=$(tr -d '[:space:]' <"$od_tmp") || {
        rm -f "$byte_tmp" "$od_tmp"
        return 2
    }
    rm -f "$byte_tmp" "$od_tmp"
    [ -n "$last_byte" ] || return 2
    if [ "$last_byte" = "10" ]; then
        echo "newline"
    else
        echo "none"
    fi
}

sr_strip_trace_blocks() {
    local file="$1"
    local source_final_newline=0 source_eof_state
    source_eof_state=$(sr_file_eof_state "$file") || return 1
    [ "$source_eof_state" = "newline" ] && source_final_newline=1
    # GNU awk on Git Bash otherwise applies text-mode CRLF translation. Other
    # awk implementations treat BINMODE as an ordinary, harmless variable.
    LC_ALL=C awk -v BINMODE=3 -v source_final_newline="$source_final_newline" '
        function clean(line) {
            sub(/\r$/, "", line)
            return line
        }
        function emit(line) {
            if (have_output) printf "%s\n", buffered
            buffered=line
            have_output=1
        }
        {
            line=clean($0)
            if (skip) {
                if (line == "<!-- SKILL-DEBUG-ORIGINAL-EOF none -->") {
                    original_no_newline=1
                }
                if (line ~ /^<!-- SKILL-DEBUG-TRACE-END( v1)? -->[[:space:]]*$/) {
                    skip=0
                }
                next
            }
            if (pending_header) {
                if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v1)? -->[[:space:]]*$/) {
                    skip=1
                    pending_header=0
                    next
                }
                emit(pending_header_text)
                pending_header=0
            }
            if (line ~ /^```/) {
                in_fence = !in_fence
                emit($0)
                next
            }
            if (!in_fence && line ~ /^## Activation (Canary )?Trace \(auto-injected by skill-debug\)[[:space:]]*$/) {
                pending_header=1
                pending_header_text=$0
                next
            }
            if (!in_fence && line ~ /^<!-- SKILL-DEBUG-TRACE-START( v1)? -->[[:space:]]*$/) {
                skip=1
                next
            }
            emit($0)
        }
        END {
            if (pending_header) {
                emit(pending_header_text)
            }
            if (have_output) {
                printf "%s", buffered
                if (source_final_newline && !original_no_newline) printf "\n"
            }
        }
    ' "$file" 2>/dev/null
}

sr_get_frontmatter_field() {
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
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { exit }
        in_fm && top_key(line) == key {
            value=line
            sub(/^[^:]*:[[:space:]]*/, "", value)
            sub(/[[:space:]]+$/, "", value)
            gsub(/^['\''\"]|['\''\"]$/, "", value)
            print value
            exit
        }
    ' "$file" 2>/dev/null | head -c 300
}

sr_get_frontmatter_text() {
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
            if (NR == 1) if (substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { exit }
        in_fm && top_key(line) != "" {
            if (capture) { exit }
            if (top_key(line) == key) {
                value=line
                sub(/^[^:]*:[[:space:]]*/, "", value)
                sub(/[[:space:]]+$/, "", value)
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
    LC_ALL=C awk -v key="$key" '
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
    LC_ALL=C awk '
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
    LC_ALL=C awk -v key="$key" '
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
    LC_ALL=C awk '
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
