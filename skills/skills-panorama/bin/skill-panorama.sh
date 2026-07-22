#!/usr/bin/env bash
# skill-panorama — 技能全景只读入口（编排 skill-scan / collection，不写突变）。

set -o pipefail

SCRIPT_PARENT="${BASH_SOURCE[0]%/*}"
[ "$SCRIPT_PARENT" = "${BASH_SOURCE[0]}" ] && SCRIPT_PARENT=.
SCRIPT_DIR="$(cd "$SCRIPT_PARENT" && pwd)"
LIB_DIR="$(cd "$SCRIPT_DIR/../lib" && pwd)"

JSON_REQUESTED=false
for arg in "$@"; do
    [ "$arg" = "--json" ] && JSON_REQUESTED=true
    [ "$arg" = "--stdout-only" ] && JSON_REQUESTED=true
done

bootstrap_error() {
    if $JSON_REQUESTED; then
        printf '%s\n' '{"schema_version":"skills-refiner.panorama.v1","status":"unsupported","error_code":"node_runtime_unavailable"}'
    fi
    echo "[ERROR] skill-panorama 需要 Node.js major 24" >&2
    exit 3
}

print_help() {
    cat <<'EOF'
技能全景 (skill-panorama)

只读编排现有收集器，生成已安装 Agent Skills 全景报告。
不删除、不改软链、不改控制清单。

用法:
  skill-panorama [--agents claude,cursor,codex] [--yes] [--json]
                 [--stdout-only] [--share] [--copy-cwd] [--help]

详见: skills/skills-panorama/SKILL.md
EOF
}

for arg in "$@"; do
    case "$arg" in
        --help|-h)
            print_help
            exit 0
            ;;
    esac
done

NODE_BIN="${SKILLS_REFINER_NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
    bootstrap_error
fi

NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)" || bootstrap_error
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || [ "$NODE_MAJOR" -ne 24 ]; then
    bootstrap_error
fi

exec "$NODE_BIN" "$LIB_DIR/panorama-cli.mjs" "$@"
