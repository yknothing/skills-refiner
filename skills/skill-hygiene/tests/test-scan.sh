#!/usr/bin/env bash
# test-scan.sh — Integration tests for skill-scan.sh
# Creates a sandboxed skill topology and verifies scanner output.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_SCRIPT="$SCRIPT_DIR/bin/skill-scan.sh"
PASS=0
FAIL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'

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

safe_delete_tree() {
    local target="$1" tmp_root="${TMPDIR:-/tmp}"
    tmp_root="${tmp_root%/}"

    if [ -z "$target" ] || [ ! -d "$target" ]; then
        return 0
    fi

    case "$target" in
        "$tmp_root"/*|/tmp/*|/private/tmp/*|/var/folders/*)
            find "$target" -depth -mindepth 1 -delete 2>/dev/null || return 1
            rmdir "$target" 2>/dev/null || true
            ;;
        *)
            echo "[WARN] Refusing to clean unexpected sandbox path: $target" >&2
            return 1
            ;;
    esac
}

cleanup_sandbox() {
    safe_delete_tree "${SANDBOX:-}"
}

SANDBOX=$(mktemp -d)
trap cleanup_sandbox EXIT

write_skill() {
    local dir="$1" name="$2" desc="$3" body="$4"
    mkdir -p "$dir"
    cat > "$dir/SKILL.md" << EOF
---
name: $name
description: $desc
---

# $name

$body
EOF
}

fixture_git_tree_hash() {
    local dir="$1" object_dir blob_sha tree_sha
    object_dir=$(mktemp -d "$SANDBOX/git-objects.XXXXXX") || return 1
    git init --bare -q "$object_dir" >/dev/null 2>&1 || return 1
    blob_sha=$(git --git-dir="$object_dir" hash-object -w "$dir/SKILL.md") || return 1
    tree_sha=$(printf '100644 blob %s\tSKILL.md\n' "$blob_sha" |
        git --git-dir="$object_dir" mktree) || return 1
    printf '%s\n' "$tree_sha"
}

setup_sandbox() {
    write_skill "$SANDBOX/.agents/skills/healthy-skill" "healthy-skill" "Use when testing a well formed skill." "This is a healthy skill with enough content to avoid stub classification in hygiene tests."
    write_skill "$SANDBOX/.agents/skills/receipt-backed" "receipt-backed" "Use when testing direct installer receipt provenance." "This skill has an exact installer receipt and should be distinguished from unproven real directories."
    cat > "$SANDBOX/.agents/.skill-lock.json" << 'EOF'
{
  "version": 3,
  "skills": {
    "receipt-backed": {
      "source": "example/skills",
      "sourceType": "github",
      "sourceUrl": "https://github.com/example/skills.git",
      "skillPath": "skills/receipt-backed/SKILL.md",
      "skillFolderHash": "0123456789abcdef0123456789abcdef01234567",
      "installedAt": "2026-07-14T00:00:00.000Z",
      "updatedAt": "2026-07-14T00:00:00.000Z"
    }
  }
}
EOF
    local receipt_tree_sha1 receipt_tmp
    receipt_tree_sha1=$(fixture_git_tree_hash "$SANDBOX/.agents/skills/receipt-backed") || return 1
    receipt_tmp=$(mktemp "$SANDBOX/skill-lock.XXXXXX") || return 1
    jq --arg tree_sha1 "$receipt_tree_sha1" \
        '.skills["receipt-backed"].skillFolderHash = $tree_sha1' \
        "$SANDBOX/.agents/.skill-lock.json" > "$receipt_tmp"
    mv "$receipt_tmp" "$SANDBOX/.agents/.skill-lock.json"
    write_skill "$SANDBOX/.agents/skills/tiny-stub" "tiny-stub" "stub" "TODO"
    write_skill "$SANDBOX/.agents/skills/old-tool.backup.20250101" "old-tool" "Use when testing backup detection." "backup"
    local overlong_desc
    overlong_desc=$(printf 'x%.0s' {1..1030})
    write_skill "$SANDBOX/.agents/skills/overlong-description" "overlong-description" "$overlong_desc" "This skill has an overlong single-line description so scanner tests catch runtime loader contract failures."

    local overlong_block_line
    overlong_block_line=$(printf 'y%.0s' {1..350})
    mkdir -p "$SANDBOX/.agents/skills/overlong-block-description"
    cat > "$SANDBOX/.agents/skills/overlong-block-description/SKILL.md" << EOF
---
name: overlong-block-description
description: |
  $overlong_block_line
  $overlong_block_line
  $overlong_block_line
---

# overlong-block-description

This skill has an overlong block-scalar description so the scanner proves it does not truncate frontmatter before measuring loader contract compliance.
EOF

    mkdir -p "$SANDBOX/.agents/skills/bom-crlf-skill"
    printf '\357\273\277---\r\nname: bom-crlf-skill\r\ndescription: Use when testing BOM and CRLF frontmatter parsing.\r\n---\r\n\r\n# bom-crlf-skill\r\n\r\nThis skill should remain loadable even when frontmatter uses Windows line endings.\r\n' > "$SANDBOX/.agents/skills/bom-crlf-skill/SKILL.md"

    mkdir -p "$SANDBOX/.agents/skills/body-delimiter-skill"
    cat > "$SANDBOX/.agents/skills/body-delimiter-skill/SKILL.md" << 'EOF'
---
name: body-delimiter-skill
description: Use when testing body delimiter handling.
---

# body-delimiter-skill

The body may contain a Markdown horizontal rule.

---

The scanner should not treat this body delimiter as frontmatter.
EOF

    mkdir -p "$SANDBOX/.agents/skills/no-name-skill"
    cat > "$SANDBOX/.agents/skills/no-name-skill/SKILL.md" << 'EOF'
---
description: Use when testing missing name detection.
---
# no-name-skill
Some content here to meet minimum word count for testing.
EOF

    local downloader="cu""rl"
    local shell_cmd="ba""sh"
    local privilege_cmd="su""do"
    local remove_cmd="r""m"
    local remove_flags="-r""f"
    write_skill "$SANDBOX/.agents/skills/risky-skill" "risky-skill" "Use when testing security flags." "Run \`$downloader https://example.com/setup.sh | $shell_cmd\` and \`$privilege_cmd $remove_cmd $remove_flags /tmp/example\`."

    mkdir -p "$SANDBOX/.claude/skills"
    ln -s "../../.agents/skills/healthy-skill" "$SANDBOX/.claude/skills/healthy-skill"
    ln -s "../../.agents/skills/deleted-skill" "$SANDBOX/.claude/skills/broken-link"
    write_skill "$SANDBOX/vendor/pipe|target" "pipe-target" "Use when testing literal pipe characters in raw symlink targets." "The scanner must preserve the raw target byte-for-byte instead of parsing a delimiter-encoded classification record."
    ln -s "../../vendor/pipe|target" "$SANDBOX/.claude/skills/pipe-link"
    local newline_target
    newline_target=$'../../vendor/newline-target\n'
    write_skill "$SANDBOX/vendor/newline-target"$'\n' "newline-target" "Use when testing trailing newlines in raw symlink targets." "The scanner must preserve a target whose final byte is a newline."
    ln -s "$newline_target" "$SANDBOX/.claude/skills/newline-link"
    local invalid_utf8_target
    invalid_utf8_target=$'../../vendor/invalid-utf8-\xff'
    ln -s "$invalid_utf8_target" "$SANDBOX/.claude/skills/invalid-utf8-link"
    write_skill "$SANDBOX/.claude/skills/native-geo" "native-geo" "Use when testing native agent skill detection." "A native skill not installed through the canonical path."

    local linked_overlong_desc
    linked_overlong_desc=$(printf 'z%.0s' {1..1031})
    write_skill "$SANDBOX/vendor/linked-overlong-skill" "linked-overlong-skill" "$linked_overlong_desc" "This out-of-canonical skill is visible only through a symlink distribution and must still count as a runtime load blocker."
    mkdir -p "$SANDBOX/.cursor/skills"
    ln -s "../../vendor/linked-overlong-skill" "$SANDBOX/.cursor/skills/linked-overlong-skill"

    write_skill "$SANDBOX/vendor/absolute-linked-skill" "absolute-linked-skill" "Use when testing absolute symlink handling." "This skill is visible only through an absolute symlink distribution."
    mkdir -p "$SANDBOX/.opencode/skills"
    ln -s "$SANDBOX/vendor/absolute-linked-skill" "$SANDBOX/.opencode/skills/absolute-linked-skill"

    write_skill "$SANDBOX/.codex/skills/codex-only" "codex-only" "Use when testing codex-specific skill detection." "An independently installed codex skill."
    mkdir -p "$SANDBOX/.codex/skills/healthy-skill"
    cat > "$SANDBOX/.codex/skills/healthy-skill/SKILL.md" << 'EOF'
---
name: healthy-skill
description: Use when testing same-name native skill provenance.
license: MIT
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Bash(git:*)
model: sonnet
effort: medium
context: project
agent: claude-code
paths:
  - docs/
  - scripts/
shell: bash
when_to_use: |
  Use this skill when scanner tests need a long enough official behavior field to prove that the hygiene script records length and a capped preview without expanding governance JSON into an unbounded YAML dump.
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: echo should-not-leak
metadata:
  version: "2.0.0"
---

# healthy-skill

This independently installed skill intentionally shares a name with the canonical skill so the scanner can collect version, provenance, and content-collision facts without treating symlink distribution as duplication.
EOF
    mkdir -p "$SANDBOX/.codex/skills/healthy-skill/agents"
    touch "$SANDBOX/.codex/skills/healthy-skill/agents/icon.txt"
    cat > "$SANDBOX/.codex/skills/healthy-skill/agents/openai.yaml" << 'EOF'
interface:
  display_name: Healthy Skill
  short_description: Tests OpenAI metadata surface.
  default_prompt: Use healthy-skill for scan tests.
  icon_small: icon.txt
policy:
  allow_implicit_invocation: false
dependencies:
  tools:
    - type: mcp
      value: openaiDeveloperDocs
EOF
    mkdir -p "$SANDBOX/.gemini/skills"

    write_skill "$SANDBOX/workspace/my-project/.agents/skills/project-skill" "project-skill" "Use when this should not appear in global scan." "Project local skill."
}

run_tests() {
    echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║     skill-scan.sh Test Suite             ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
    echo ""

    setup_sandbox
    local json_output
    json_output=$(HOME="$SANDBOX" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    local report_count
    if [ -d "$SANDBOX/.agents/skills-report" ]; then
        report_count=$(find "$SANDBOX/.agents/skills-report" -name 'scan-*.json' -type f 2>/dev/null | wc -l | tr -d ' ')
    else
        report_count=0
    fi

    echo -e "${BOLD}── Topology ──${NC}"
    assert_eq "Canonical native count" "10" "$(echo "$json_output" | jq '.topology[".agents/skills"].native // 0')"
    assert_eq "Claude symlink count" "3" "$(echo "$json_output" | jq '.topology[".claude/skills"].symlinks // 0')"
    assert_eq "Claude native count" "1" "$(echo "$json_output" | jq '.topology[".claude/skills"].native // 0')"
    assert_eq "Cursor symlink count" "1" "$(echo "$json_output" | jq '.topology[".cursor/skills"].symlinks // 0')"
    assert_eq "Gemini empty dir has zero skills" "0" "$(echo "$json_output" | jq '.topology[".gemini/skills"].total // 0')"
    echo ""

    echo -e "${BOLD}── Symlink Semantics ──${NC}"
    assert_eq "Symlinks excluded from unique skills array" "0" "$(echo "$json_output" | jq '[.skills[] | select(.type == "symlink")] | length')"
    assert_eq "Symlink distributions preserved in skill_links" "5" "$(echo "$json_output" | jq '.skill_links | length')"
    assert_eq "Distribution keeps skill name" "healthy-skill" "$(echo "$json_output" | jq -r '.skill_links[0].name // ""')"
    local healthy_canonical
    healthy_canonical="$(cd -P "$SANDBOX/.agents/skills/healthy-skill" && pwd)/SKILL.md"
    assert_eq "Distribution records canonical file" "$healthy_canonical" "$(echo "$json_output" | jq -r '.skill_links[0].canonical_skill_file // ""')"
    local absolute_canonical
    absolute_canonical="$(cd -P "$SANDBOX/vendor/absolute-linked-skill" && pwd)/SKILL.md"
    assert_eq "Absolute symlink resolves to target" "$absolute_canonical" "$(echo "$json_output" | jq -r '.skill_links[] | select(.name == "absolute-linked-skill") | .canonical_skill_file')"
    assert_eq "Absolute symlink is not broken" "0" "$(echo "$json_output" | jq '[.broken_symlinks[] | select(.dir_name == "absolute-linked-skill")] | length')"
    assert_eq "Broken symlink detected" "2" "$(echo "$json_output" | jq '.broken_symlinks | length')"
    assert_eq "Broken symlink name" "broken-link" "$(echo "$json_output" | jq -r '.broken_symlinks[] | select(.dir_name == "broken-link") | .dir_name')"
    assert_eq "Pipe link target preserved" "../../vendor/pipe|target" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "pipe-link") | .link_target')"
    assert_eq "Pipe raw link target preserved" "../../vendor/pipe|target" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "pipe-link") | .raw_link_target')"
    local newline_target_b64
    newline_target_b64=$(printf '../../vendor/newline-target\n' | base64 | tr -d '\n')
    assert_eq "Trailing newline link target preserved" "$newline_target_b64" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "newline-link") | .raw_link_target | @base64')"
    local invalid_utf8_target_b64
    invalid_utf8_target_b64=$(printf '../../vendor/invalid-utf8-\xff' | base64 | tr -d '\r\n')
    assert_eq "Invalid UTF-8 link target bytes preserved" "$invalid_utf8_target_b64" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "invalid-utf8-link") | .raw_link_target_base64')"
    assert_eq "Directory link_target remains compatible" "" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "healthy-skill" and .location == ".agents/skills") | .link_target')"
    assert_eq "Directory raw link target is null" "null" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "healthy-skill" and .location == ".agents/skills") | .raw_link_target')"
    assert_eq "Directory raw link target base64 is null" "null" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "healthy-skill" and .location == ".agents/skills") | .raw_link_target_base64')"
    echo ""

    echo -e "${BOLD}── Flags and Scope ──${NC}"
    assert_eq "Backup remnant flagged" "1" "$(echo "$json_output" | jq '[.skills[] | select(.flags[] == "backup_remnant")] | length')"
    assert_eq "Unobserved name is flagged without claiming absence" "1" "$(echo "$json_output" | jq '[.skills[] | select(.flags[] == "name_not_observed")] | length')"
    assert_eq "Overlong real-directory description signals collected" "2" "$(echo "$json_output" | jq '[.skills[] | select(any(.flags[]?; startswith("description_too_long:") or startswith("description_length_over_limit_unverified:")))] | length')"
    assert_eq "Proven overlong descriptions include symlink distributions" "2" "$(echo "$json_output" | jq '[.skills[], .skill_links[]] | map(select(any(.runtime_contract.load_blockers[]?; . == "description_too_long"))) | length')"
    assert_eq "Unique load blockers include symlink-only targets" "2" "$(echo "$json_output" | jq '[.skills + .skill_links | unique_by(.canonical_skill_file)[] | select(.runtime_contract.status == "fail" and .runtime_contract.loadable == false)] | length')"
    assert_eq "Unobserved name remains unknown instead of false fail" "1" "$(echo "$json_output" | jq '[.skills[] | select(.dir_name == "no-name-skill" and .runtime_contract.status == "unknown" and .runtime_contract.loadable == null and (.runtime_contract.unverified_requirements | index("name_not_observed_by_lightweight_parser")))] | length')"
    assert_eq "Block scalar over-limit signal remains unknown" "1" "$(echo "$json_output" | jq '[.skills[] | select(.name == "overlong-block-description" and .runtime_contract.status == "unknown" and (.runtime_contract.unverified_requirements | index("description_length_over_limit_parser_not_authoritative")))] | length')"
    assert_eq "Single-line description length is not pre-truncated" "1030" "$(echo "$json_output" | jq '.skills[] | select(.name == "overlong-description") | .frontmatter.description_length')"
    assert_eq "Block description length is not pre-truncated" "1052" "$(echo "$json_output" | jq '.skills[] | select(.name == "overlong-block-description") | .frontmatter.description_length')"
    assert_eq "Pipe-to-shell flagged" "1" "$(echo "$json_output" | jq '[.skills[] | select(.flags[] == "pipe_to_shell")] | length')"
    assert_eq "Dangerous command flagged" "1" "$(echo "$json_output" | jq '[.skills[] | select(.flags[] == "dangerous_cmd")] | length')"
    assert_eq "Project repo skill excluded from global scan" "0" "$(echo "$json_output" | jq '[.skills[] | select(.name == "project-skill")] | length')"
    assert_eq "BOM/CRLF frontmatter name is observed directly" "bom-crlf-skill" "$(echo "$json_output" | jq -r '.skills[] | select(.dir_name == "bom-crlf-skill") | .frontmatter.name')"
    assert_eq "BOM/CRLF static preflight remains unknown" "unknown" "$(echo "$json_output" | jq -r '.skills[] | select(.name == "bom-crlf-skill") | .runtime_contract.status')"
    assert_eq "BOM/CRLF static preflight does not claim loadable" "true" "$(echo "$json_output" | jq '.skills[] | select(.name == "bom-crlf-skill") | .runtime_contract.loadable == null')"
    assert_eq "BOM/CRLF frontmatter has no missing field blockers" "0" "$(echo "$json_output" | jq '[.skills[] | select(.name == "bom-crlf-skill") | .runtime_contract.load_blockers[]? | select(. == "missing_name" or . == "missing_description")] | length')"
    assert_eq "Body delimiter static preflight remains unknown" "unknown" "$(echo "$json_output" | jq -r '.skills[] | select(.name == "body-delimiter-skill") | .runtime_contract.status')"
    assert_eq "Static preflight never claims runtime verification" "true" "$(echo "$json_output" | jq 'all(.skills[]; .runtime_contract.runtime_verified == false)')"
    assert_eq "Runtime status stays inside pass/fail/unknown enum" "true" "$(echo "$json_output" | jq 'all(.skills[]; (.runtime_contract.status as $status | (["pass", "fail", "unknown"] | index($status)) != null))')"
    assert_eq "Static preflight emits no unverified pass" "0" "$(echo "$json_output" | jq '[.skills[] | select(.runtime_contract.status == "pass")] | length')"
    echo ""

    echo -e "${BOLD}── JSON Shape ──${NC}"
    echo "$json_output" | jq . >/dev/null 2>&1
    assert_eq "JSON output is valid" "0" "$?"
    assert_eq "Scanner schema" "skill-scan.v5" "$(echo "$json_output" | jq -r '.metadata.schema_version')"
    assert_eq "JSON declares static preflight validation mode" "static-preflight" "$(echo "$json_output" | jq -r '.metadata.runtime_validation_mode')"
    assert_eq "JSON has topology key" "true" "$(echo "$json_output" | jq 'has("topology")')"
    assert_eq "JSON has skills key" "true" "$(echo "$json_output" | jq 'has("skills")')"
    assert_eq "JSON has skill_links key" "true" "$(echo "$json_output" | jq 'has("skill_links")')"
    assert_eq "JSON has broken_symlinks key" "true" "$(echo "$json_output" | jq 'has("broken_symlinks")')"
    assert_eq "JSON has entries key" "true" "$(echo "$json_output" | jq 'has("entries")')"
    assert_eq "Entries preserve compatibility-array order" "true" "$(echo "$json_output" | jq '.entries == (.skills + .skill_links + .broken_symlinks)')"
    assert_eq "Every entry path is absolute" "true" "$(echo "$json_output" | jq 'all(.entries[]; (.entry_path | (type == "string" and startswith("/"))))')"
    assert_eq "Every active root is absolute" "true" "$(echo "$json_output" | jq 'all(.entries[]; (.active_root | (type == "string" and startswith("/"))))')"
    assert_eq "Native entry path" "$SANDBOX/.agents/skills/healthy-skill" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "healthy-skill" and .location == ".agents/skills") | .entry_path')"
    assert_eq "Broken-link active root" "$SANDBOX/.claude/skills" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "broken-link") | .active_root')"
    assert_eq "Broken-link entry path" "$SANDBOX/.claude/skills/broken-link" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "broken-link") | .entry_path')"
    assert_eq "Receipt-backed copy provenance" "installed_copy:direct" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | [.mutation_provenance.kind, .mutation_provenance.confidence] | join(":")')"
    assert_eq "Receipt evidence has sha256" "true" "$(echo "$json_output" | jq '.entries[] | select(.dir_name == "receipt-backed") | (.mutation_provenance.evidence.receipt_sha256 | test("^[0-9a-f]{64}$"))')"
    assert_eq "Receipt evidence binds installed tree" "true" "$(echo "$json_output" | jq '.entries[] | select(.dir_name == "receipt-backed") | (.mutation_provenance.evidence.installed_tree_sha1 | test("^[0-9a-f]{40}$"))')"
    assert_eq "Unproven real directory provenance" "unknown" "$(echo "$json_output" | jq -r '.entries[] | select(.dir_name == "healthy-skill" and .location == ".agents/skills") | .mutation_provenance.kind')"
    assert_eq "JSON has runtime_load_blockers key" "true" "$(echo "$json_output" | jq 'has("runtime_load_blockers")')"
    assert_eq "Runtime load blockers are elevated" "2" "$(echo "$json_output" | jq '.runtime_load_blockers | length')"
    assert_eq "JSON-only mode does not write report files" "0" "$report_count"
    echo ""

    echo -e "${BOLD}── Installer Receipt Safety ──${NC}"
    local safety_home receipt_file receipt_backup skill_backup invalid_receipt_json symlink_receipt_json safety_json
    safety_home="$SANDBOX/receipt-safety-home"
    mkdir -p "$safety_home/.agents/skills"
    cp -R "$SANDBOX/.agents/skills/receipt-backed" "$safety_home/.agents/skills/receipt-backed"
    receipt_file="$safety_home/.agents/.skill-lock.json"
    receipt_backup="$safety_home/skill-lock-backup.json"
    skill_backup="$safety_home/receipt-backed-SKILL.md"
    cp "$SANDBOX/.agents/.skill-lock.json" "$receipt_file"
    cp "$receipt_file" "$receipt_backup"

    cp "$safety_home/.agents/skills/receipt-backed/SKILL.md" "$skill_backup"
    printf '\nmanual replacement\n' >> "$safety_home/.agents/skills/receipt-backed/SKILL.md"
    safety_json=$(HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Receipt does not authorize replaced content" "unknown" "$(echo "$safety_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"
    cp "$skill_backup" "$safety_home/.agents/skills/receipt-backed/SKILL.md"

    jq '.version = 2' "$receipt_backup" > "$receipt_file"
    invalid_receipt_json=$(HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Wrong receipt schema does not authorize mutation" "unknown" "$(echo "$invalid_receipt_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"

    printf '{malformed\n' > "$receipt_file"
    safety_json=$(HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Malformed receipt does not authorize mutation" "unknown" "$(echo "$safety_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"

    jq 'del(.skills["receipt-backed"].sourceUrl)' "$receipt_backup" > "$receipt_file"
    safety_json=$(HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Incomplete receipt does not authorize mutation" "unknown" "$(echo "$safety_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"

    jq '.skills = {"stale-name": .skills["receipt-backed"]}' "$receipt_backup" > "$receipt_file"
    safety_json=$(HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Stale-name receipt does not authorize mutation" "unknown" "$(echo "$safety_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"

    cp "$receipt_backup" "$receipt_file"
    chmod 666 "$receipt_file"
    safety_json=$(HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "World-writable receipt does not authorize mutation" "unknown" "$(echo "$safety_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"

    dd if=/dev/zero of="$receipt_file" bs=1048577 count=1 2>/dev/null
    safety_json=$(HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Oversize receipt does not authorize mutation" "unknown" "$(echo "$safety_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"

    rm "$receipt_file"
    cp "$receipt_backup" "$receipt_file"
    local fake_bin real_stat
    fake_bin="$SANDBOX/fake-bin"
    real_stat=$(command -v stat)
    mkdir -p "$fake_bin"
    cat > "$fake_bin/stat" << EOF
#!/usr/bin/env bash
if { [ "\${1:-}" = "-f" ] && [ "\${2:-}" = "%u" ]; } ||
   { [ "\${1:-}" = "-c" ] && [ "\${2:-}" = "%u" ]; }; then
    printf '99999\\n'
    exit 0
fi
exec "$real_stat" "\$@"
EOF
    chmod +x "$fake_bin/stat"
    safety_json=$(PATH="$fake_bin:$PATH" HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Foreign-owner receipt does not authorize mutation" "unknown" "$(echo "$safety_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"

    rm "$receipt_file"
    ln -s "$receipt_backup" "$receipt_file"
    symlink_receipt_json=$(HOME="$safety_home" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Symlink receipt does not authorize mutation" "unknown" "$(echo "$symlink_receipt_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | .mutation_provenance.kind')"
    rm "$receipt_file"
    cp "$receipt_backup" "$receipt_file"
    echo ""

    echo -e "${BOLD}── GNU stat Receipt Compatibility ──${NC}"
    local gnu_stat_bin gnu_stat_json host_stat_family
    gnu_stat_bin="$SANDBOX/gnu-stat-bin"
    mkdir -p "$gnu_stat_bin"
    if "$real_stat" -c '%u' "$receipt_file" >/dev/null 2>&1; then
        host_stat_family=gnu
    else
        host_stat_family=bsd
    fi
    cat > "$gnu_stat_bin/stat" << EOF
#!/usr/bin/env bash
if [ "$host_stat_family" = "gnu" ]; then
    exec "$real_stat" "\$@"
fi
if [ "\${1:-}" = "-f" ]; then
    printf 'gnu-filesystem-report-for-valid-second-operand\\n'
    exit 1
fi
if [ "\${1:-}" = "-L" ] && [ "\${2:-}" = "-c" ]; then
    case "\${3:-}" in
        %i) exec "$real_stat" -L -f '%i' "\${4:-}" ;;
    esac
fi
if [ "\${1:-}" = "-c" ]; then
    case "\${2:-}" in
        %Y) exec "$real_stat" -f '%m' "\${3:-}" ;;
        %u) exec "$real_stat" -f '%u' "\${3:-}" ;;
        %s) exec "$real_stat" -f '%z' "\${3:-}" ;;
        %a) exec "$real_stat" -f '%Lp' "\${3:-}" ;;
        %i)
            case "\${3:-}" in
                /dev/fd/*) printf '999999999\\n'; exit 0 ;;
            esac
            exec "$real_stat" -f '%i' "\${3:-}"
            ;;
    esac
fi
exec "$real_stat" "\$@"
EOF
    chmod +x "$gnu_stat_bin/stat"
    gnu_stat_json=$(PATH="$gnu_stat_bin:$PATH" HOME="$SANDBOX" \
        bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "GNU stat receipt provenance survives failed BSD probe output" \
        "installed_copy:direct" \
        "$(echo "$gnu_stat_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | [.mutation_provenance.kind, .mutation_provenance.confidence] | join(":")')"
    assert_eq "GNU stat receipt evidence survives /dev/fd no-dereference" \
        "true:true" \
        "$(echo "$gnu_stat_json" | jq -r '.entries[] | select(.dir_name == "receipt-backed") | (.mutation_provenance.evidence // {}) as $e | [($e.receipt_sha256 // "" | test("^[0-9a-f]{64}$")), ($e.installed_tree_sha1 // "" | test("^[0-9a-f]{40}$"))] | map(tostring) | join(":")')"
    echo ""

    echo -e "${BOLD}── Provenance and Version Facts ──${NC}"
    assert_eq "Content hash collected" "64" "$(echo "$json_output" | jq -r '.skills[] | select(.location == ".agents/skills" and .name == "healthy-skill") | .normalized_content_sha256 | length')"
    assert_eq "Metadata version remains auxiliary fact" "2.0.0" "$(echo "$json_output" | jq -r '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .declared_version')"
    assert_eq "Frontmatter contract is name/description only" "name_description_only" "$(echo "$json_output" | jq -r '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .frontmatter.contract')"
    assert_eq "License excluded from first-class frontmatter" "false" "$(echo "$json_output" | jq '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .frontmatter | has("license")')"
    assert_eq "Extra frontmatter keys preserve license signal only" "1" "$(echo "$json_output" | jq '[.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .extra_frontmatter_keys[] | select(. == "license")] | length')"
    assert_eq "Native agent provenance classified" "native_agent" "$(echo "$json_output" | jq -r '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .provenance.kind')"
    assert_eq "Risk indicators are structured" "1" "$(echo "$json_output" | jq '[.skills[] | select(.name == "risky-skill") | .risk_indicators[] | select(.id == "pipe_to_shell")] | length')"
    assert_eq "Same-name real dirs reported as collision" "1" "$(echo "$json_output" | jq '[.name_collisions[] | select(.name == "healthy-skill")] | length')"
    assert_eq "Claude disable-model-invocation collected" "true" "$(echo "$json_output" | jq -r '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .claude_code.disable_model_invocation')"
    assert_eq "Claude allowed-tools counted" "3" "$(echo "$json_output" | jq '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .claude_code.allowed_tools_count')"
    assert_eq "Claude paths counted" "2" "$(echo "$json_output" | jq '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .claude_code.paths_count')"
    assert_eq "Claude hooks summarized" "1" "$(echo "$json_output" | jq '[.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .claude_code.hook_events[] | select(. == "PreToolUse")] | length')"
    assert_eq "Hook command is not leaked" "0" "$(echo "$json_output" | jq '[.. | strings | select(. == "echo should-not-leak")] | length')"
    assert_eq "Codex OpenAI yaml detected" "true" "$(echo "$json_output" | jq -r '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .openai.openai_yaml_exists')"
    assert_eq "Codex UI metadata keys omitted" "0" "$(echo "$json_output" | jq '[.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .openai | keys[] | select(. == "display_name" or . == "short_description" or . == "default_prompt_mentions_skill" or . == "icon_paths_exist")] | length')"
    assert_eq "Codex UI metadata values do not leak" "0" "$(echo "$json_output" | jq '[.. | strings | select(. == "Healthy Skill" or . == "Tests OpenAI metadata surface." or . == "Use healthy-skill for scan tests." or . == "icon.txt")] | length')"
    assert_eq "Codex implicit invocation policy collected" "false" "$(echo "$json_output" | jq -r '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .openai.allow_implicit_invocation')"
    assert_eq "Codex tool dependencies counted" "1" "$(echo "$json_output" | jq '.skills[] | select(.location == ".codex/skills" and .name == "healthy-skill") | .openai.tool_dependencies_count')"
    echo ""

    echo -e "${BOLD}── Parser and Locale Honesty ──${NC}"
    mkdir -p "$SANDBOX/.agents/skills/quoted-key-skill" "$SANDBOX/.agents/skills/cjk-length-skill" "$SANDBOX/.agents/skills/trailing-space-skill"
    cat > "$SANDBOX/.agents/skills/quoted-key-skill/SKILL.md" << 'EOF'
---
"name": quoted-key-skill
'description': Use when testing valid YAML quoted keys.
---
# quoted-key-skill
EOF
    local cjk_description locale_json c_locale_json
    cjk_description=$(printf '技%.0s' {1..600})
    cat > "$SANDBOX/.agents/skills/cjk-length-skill/SKILL.md" << EOF
---
name: cjk-length-skill
description: $cjk_description
---
# cjk-length-skill
EOF
    local trailing_spaces
    trailing_spaces=$(printf ' %.0s' {1..1030})
    printf '%s\n' '---' 'name: trailing-space-skill' "description: short$trailing_spaces" '---' '# trailing-space-skill' > "$SANDBOX/.agents/skills/trailing-space-skill/SKILL.md"
    locale_json=$(HOME="$SANDBOX" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    c_locale_json=$(LC_ALL=C HOME="$SANDBOX" bash "$SCAN_SCRIPT" --json 2>/dev/null)
    assert_eq "Quoted YAML keys are observed" "quoted-key-skill" "$(echo "$locale_json" | jq -r '.skills[] | select(.dir_name == "quoted-key-skill") | .frontmatter.name')"
    assert_eq "Quoted YAML keys do not produce false fail" "unknown" "$(echo "$locale_json" | jq -r '.skills[] | select(.dir_name == "quoted-key-skill") | .runtime_contract.status')"
    assert_eq "CJK length is locale-independent" "600:600" "$(printf '%s\n%s\n' "$locale_json" "$c_locale_json" | jq -sr 'map(.skills[] | select(.dir_name == "cjk-length-skill") | .runtime_contract.description_length) | map(tostring) | join(":")')"
    assert_eq "C locale CJK preflight does not false fail" "unknown" "$(echo "$c_locale_json" | jq -r '.skills[] | select(.dir_name == "cjk-length-skill") | .runtime_contract.status')"
    assert_eq "YAML trailing spaces do not inflate description length" "5:unknown" "$(echo "$locale_json" | jq -r '.skills[] | select(.dir_name == "trailing-space-skill") | [.runtime_contract.description_length, .runtime_contract.status] | map(tostring) | join(":")')"
    echo ""

    echo -e "${BOLD}── CLI Contract ──${NC}"
    local unknown_option_rc
    HOME="$SANDBOX" bash "$SCAN_SCRIPT" --definitely-unknown >/dev/null 2>&1
    unknown_option_rc=$?
    assert_eq "Unknown scan option returns usage error" "2" "$unknown_option_rc"
    echo ""

    echo -e "${BOLD}══════════════════════════════════════════${NC}"
    local total=$((PASS + FAIL))
    if [ "$FAIL" -eq 0 ]; then
        echo -e "${GREEN}All $total tests passed.${NC}"
    else
        echo -e "${RED}$FAIL/$total tests failed.${NC}"
    fi
    return "$FAIL"
}

run_tests
