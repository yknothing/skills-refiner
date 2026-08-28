#!/usr/bin/env bash
# test-panorama-cli.sh — 沙箱集成：编排真实 skill-scan，验证五类金样落盘。

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PANORAMA_BIN="$SCRIPT_DIR/bin/skill-panorama.sh"
HYGIENE_ROOT="$(cd "$SCRIPT_DIR/../skill-hygiene" && pwd)"
PASS=0
FAIL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

NODE24="${SKILLS_REFINER_NODE_BIN:-}"
if [ -z "$NODE24" ]; then
  if [ -x "$HOME/.nvm/versions/node/v24.4.1/bin/node" ]; then
    NODE24="$HOME/.nvm/versions/node/v24.4.1/bin/node"
  else
    NODE24="$(command -v node)"
  fi
fi

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo -e "  ${GREEN}✓${NC} $label"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $label — expected: '$expected', got: '$actual'"
    FAIL=$((FAIL + 1))
  fi
}

assert_true() {
  local label="$1"
  shift
  if "$@"; then
    echo -e "  ${GREEN}✓${NC} $label"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $label"
    FAIL=$((FAIL + 1))
  fi
}

safe_delete_tree() {
  local target="$1" tmp_root="${TMPDIR:-/tmp}"
  tmp_root="${tmp_root%/}"
  [ -z "$target" ] || [ ! -d "$target" ] && return 0
  case "$target" in
    "$tmp_root"/*|/tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
      find "$target" -depth -mindepth 1 -delete 2>/dev/null || return 1
      rmdir "$target" 2>/dev/null || true
      ;;
    *)
      echo "[WARN] Refusing to clean unexpected sandbox path: $target" >&2
      return 1
      ;;
  esac
}

SANDBOX_RAW=$(mktemp -d)
SANDBOX=$(cd "$SANDBOX_RAW" && pwd -P)
trap 'safe_delete_tree "$SANDBOX"' EXIT

write_skill() {
  local dir="$1" name="$2"
  mkdir -p "$dir"
  cat > "$dir/SKILL.md" << EOF
---
name: $name
description: Use when testing panorama golden fixture for $name.
---

# $name

Panorama golden body for $name with enough content for the scanner.
EOF
}

setup_sandbox() {
  # 齐全：源 + 三 Agent 投影
  write_skill "$SANDBOX/.agents/skills/complete-skill" "complete-skill"
  mkdir -p "$SANDBOX/.claude/skills" "$SANDBOX/.cursor/skills" "$SANDBOX/.codex/skills"
  ln -s "$SANDBOX/.agents/skills/complete-skill" "$SANDBOX/.claude/skills/complete-skill"
  ln -s "$SANDBOX/.agents/skills/complete-skill" "$SANDBOX/.cursor/skills/complete-skill"
  ln -s "$SANDBOX/.agents/skills/complete-skill" "$SANDBOX/.codex/skills/complete-skill"

  # 仅源
  write_skill "$SANDBOX/.agents/skills/source-only-skill" "source-only-skill"

  # 部分投影：仅 Claude 有投影（第八类）
  write_skill "$SANDBOX/.agents/skills/partial-skill" "partial-skill"
  ln -s "$SANDBOX/.agents/skills/partial-skill" "$SANDBOX/.claude/skills/partial-skill"

  # 断链
  write_skill "$SANDBOX/.agents/skills/broken-link-skill" "broken-link-skill"
  ln -s "$SANDBOX/.agents/skills/does-not-exist" "$SANDBOX/.claude/skills/broken-link-skill"

  # 撞名：两个真实目录同名异内容（备份名不同路径 — scan 用同名 real dirs）
  write_skill "$SANDBOX/.agents/skills/collision-skill" "collision-skill"
  mkdir -p "$SANDBOX/.claude/skills-extra"
  # 放在另一发现根下的真实目录以触发 name_collisions（.gemini/skills）
  write_skill "$SANDBOX/.gemini/skills/collision-skill" "collision-skill"
  # 改内容制造异哈希
  echo "different body for collision" >> "$SANDBOX/.gemini/skills/collision-skill/SKILL.md"

  # 清单漂移：写入 catalog + 假 collection INDEX（批准 ghost-member，磁盘无）
  mkdir -p "$SANDBOX/Library/Application Support/skills-refiner"
  mkdir -p "$SANDBOX/.agents/collections/demo-collection"
  cat > "$SANDBOX/.agents/collections/demo-collection/INDEX.json" << 'EOF'
{
  "schema_version": "skills-refiner.managed-collection.index.v2",
  "members": [{ "name": "ghost-member", "relative_path": "ghost-member", "tree_digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000" }],
  "resources": []
}
EOF
  cat > "$SANDBOX/Library/Application Support/skills-refiner/catalog.json" << EOF
{
  "schema_version": "skills-refiner.collection-catalog.v1",
  "updated_at": "2026-07-22T00:00:00.000Z",
  "collections": {
    "demo": {
      "collection_id": "demo",
      "operation_id": "demo-aaaaaaaaaaaa",
      "plan_hash": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "source": {
        "provider": "github",
        "repository_id": "example/demo",
        "resolved_revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "artifact_digest": "sha256:2222222222222222222222222222222222222222222222222222222222222222"
      },
      "collection_root": "$SANDBOX/.agents/collections/demo-collection",
      "recovery_plan": "$SANDBOX/Library/Application Support/skills-refiner/recovery/operations/demo-aaaaaaaaaaaa/plan.json",
      "lifecycle": {
        "receipt_history": "absent",
        "plan_created_at": "2026-07-22T00:00:00.000Z",
        "first_activated_at": "2026-07-22T00:00:00.000Z",
        "current_generation_activated_at": "2026-07-22T00:00:00.000Z"
      }
    }
  }
}
EOF
}

echo "=== skills-panorama CLI sandbox ==="
setup_sandbox

# 直接用 Node 跑 CLI，注入假 collection list 较难；集成路径：
# 1) 跑真实 scan 编排（catalog INDEX 通过 collect 的 collection list 可能拿不到 demo）
# 2) 因此对 ghost-member：用纯函数路径已在 node:test 覆盖；此处验证 scan 编排 + 落盘 + 四类磁盘金样

export SKILLS_REFINER_NODE_BIN="$NODE24"
export HOME="$SANDBOX"

OUT=$("$PANORAMA_BIN" --yes --agents claude,cursor,codex --hygiene-root "$HYGIENE_ROOT" 2>&1)
CLI_STATUS=$?
echo "$OUT"
assert_eq "incomplete collector exits nonzero after writing evidence" "3" "$CLI_STATUS"

LATEST_JSON="$SANDBOX/Library/Application Support/skills-refiner/panorama/latest.json"
LATEST_MD="$SANDBOX/Library/Application Support/skills-refiner/panorama/latest.md"

assert_true "latest.json exists" test -f "$LATEST_JSON"
assert_true "latest.md exists" test -f "$LATEST_MD"

SCHEMA=$("$NODE24" -e "const d=require('fs').readFileSync(process.argv[1],'utf8'); console.log(JSON.parse(d).schema_version)" "$LATEST_JSON")
assert_eq "schema_version" "skills-refiner.panorama.v2" "$SCHEMA"

COLLECTOR_STATUS=$("$NODE24" -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log(d.collectors.status)" "$LATEST_JSON")
assert_eq "collector status preserves incomplete state" "DEGRADED" "$COLLECTOR_STATUS"

has_forbidden=$("$NODE24" -e "
const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
const bad=[];
(function walk(v){ if(!v||typeof v!=='object')return; for(const k of Object.keys(v)){ if(k==='installed'||k==='ready') bad.push(k); walk(v[k]); } })(d);
console.log(bad.length?bad.join(','):'none');
" "$LATEST_JSON")
assert_eq "no installed/ready fields" "none" "$has_forbidden"

gap_of() {
  local name="$1"
  "$NODE24" -e "
const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
const row=d.entries.find(e=>e.identity.name===process.argv[2]);
console.log(row?row.gap_class:'MISSING');
" "$LATEST_JSON" "$name"
}

assert_eq "complete → 齐全" "齐全" "$(gap_of complete-skill)"
assert_eq "source-only → 仅在源目录" "仅在源目录" "$(gap_of source-only-skill)"
assert_eq "partial → 部分 Agent 已出现" "部分 Agent 已出现" "$(gap_of partial-skill)"
assert_eq "broken → 链接损坏" "链接损坏" "$(gap_of broken-link-skill)"
assert_eq "collision → 命名冲突" "命名冲突" "$(gap_of collision-skill)"
assert_eq "ghost catalog → 清单与现实不符" "清单与现实不符" "$(gap_of ghost-member)"

assert_true "markdown has 八类导航" grep -q "部分 Agent 已出现" "$LATEST_MD"
assert_true "markdown has 字段对照" grep -q "字段对照" "$LATEST_MD"
if grep -q "rm -rf" "$LATEST_MD"; then
  echo -e "  ${RED}✗${NC} markdown forbids rm -rf"
  FAIL=$((FAIL + 1))
else
  echo -e "  ${GREEN}✓${NC} markdown forbids rm -rf"
  PASS=$((PASS + 1))
fi

# --share 脱敏
"$PANORAMA_BIN" --yes --agents claude,cursor,codex --hygiene-root "$HYGIENE_ROOT" --share >/dev/null 2>&1
SHARE_JSON="$SANDBOX/Library/Application Support/skills-refiner/panorama/share.json"
assert_true "share.json exists" test -f "$SHARE_JSON"
share_has_sandbox=$("$NODE24" -e "
const t=require('fs').readFileSync(process.argv[1],'utf8');
console.log(t.includes(process.argv[2])?'yes':'no');
" "$SHARE_JSON" "$SANDBOX")
assert_eq "share redacts sandbox home" "no" "$share_has_sandbox"

for private_output in "$LATEST_JSON" "$LATEST_MD" "$SHARE_JSON" "$SANDBOX/Library/Application Support/skills-refiner/panorama/share.md"; do
  mode=$("$NODE24" -e "console.log((require('fs').statSync(process.argv[1]).mode & 0o777).toString(8))" "$private_output")
  assert_eq "private output mode 0600: $(basename "$private_output")" "600" "$mode"
done

# 零交互 --stdout-only
STDOUT_JSON=$("$PANORAMA_BIN" --yes --agents claude --hygiene-root "$HYGIENE_ROOT" --stdout-only 2>/dev/null)
assert_true "stdout-only emits JSON" "$NODE24" -e "JSON.parse(process.argv[1])" "$STDOUT_JSON"

# `all` 必须来自 scanner topology，且不能把权威源目录误当成 Agent。
ALL_STDOUT_JSON=$("$PANORAMA_BIN" --yes --agents all --hygiene-root "$HYGIENE_ROOT" --stdout-only 2>/dev/null)
assert_true "--agents all discovers every present Agent root" "$NODE24" -e '
const d=JSON.parse(process.argv[1]);
const locations=d.agents.map((agent)=>agent.location);
for (const expected of [".claude/skills", ".cursor/skills", ".codex/skills", ".gemini/skills"]) {
  if (!locations.includes(expected)) process.exit(1);
}
if (locations.includes(".agents/skills")) process.exit(1);
' "$ALL_STDOUT_JSON"

# 大型 stdout 必须完整排空。真实全机矩阵会轻易超过 pipe buffer；过去
# direct-entrypoint 在 write 后立即 process.exit，产生可复现的截断 JSON。
large_index=1
while [ "$large_index" -le 260 ]; do
  write_skill "$SANDBOX/.agents/skills/large-output-$large_index" "large-output-$large_index"
  large_index=$((large_index + 1))
done
LARGE_STDOUT_JSON=$("$PANORAMA_BIN" --yes --agents claude,cursor,codex \
  --hygiene-root "$HYGIENE_ROOT" --stdout-only 2>/dev/null)
assert_true "large stdout-only JSON is complete" "$NODE24" -e \
  "const d=JSON.parse(process.argv[1]); if(d.entries.length < 260) process.exit(1)" \
  "$LARGE_STDOUT_JSON"

echo ""
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
