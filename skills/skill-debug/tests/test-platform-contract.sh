#!/usr/bin/env bash
# Cross-platform contract tests with a Windows-safe subset for Git Bash CI.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMMON_SH="$REPO_ROOT/skills/skill-debug/lib/common.sh"

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

assert_json() {
    local label="$1" value="$2"
    if echo "$value" | jq -e -s 'length == 1 and (.[0] | type == "object")' >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — output is not one JSON object"
        FAIL=$((FAIL + 1))
    fi
}

assert_jq() {
    local label="$1" value="$2" filter="$3"
    if echo "$value" | jq -e "$filter" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $label"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $label — jq assertion failed: $filter"
        FAIL=$((FAIL + 1))
    fi
}

if ! command -v jq >/dev/null 2>&1; then
    echo "[ERROR] jq is required for platform contract tests." >&2
    exit 127
fi

SANDBOX=$(mktemp -d) || exit 1
cleanup() {
    if [ -n "$SANDBOX" ] && [ "$SANDBOX" != "/" ] && [ -d "$SANDBOX" ]; then
        rm -rf -- "$SANDBOX"
    fi
}
trap cleanup EXIT

HOME_DIR="$SANDBOX/Windows User"
TOOLS_ROOT="$HOME_DIR/.agents/skills"
WORK_DIR="$SANDBOX/work tree/with spaces"
mkdir -p "$TOOLS_ROOT" "$WORK_DIR"
cp -R "$REPO_ROOT/skills/skill-debug" "$TOOLS_ROOT/"
cp -R "$REPO_ROOT/skills/skill-hygiene" "$TOOLS_ROOT/"

SCAN="$TOOLS_ROOT/skill-hygiene/bin/skill-scan.sh"
PROBE="$TOOLS_ROOT/skill-debug/bin/skill-probe.sh"
DASH="$TOOLS_ROOT/skill-debug/bin/skill-dashboard.sh"
TRACE="$TOOLS_ROOT/skill-debug/bin/skill-trace.sh"
CANARY="$TOOLS_ROOT/skill-debug/bin/skill-canary.sh"
DOCTOR="$TOOLS_ROOT/skill-debug/bin/skills-refiner-doctor.sh"

FIXTURE_DIR="$TOOLS_ROOT/windows-crlf-skill"
FIXTURE="$FIXTURE_DIR/SKILL.md"
mkdir -p "$FIXTURE_DIR"
printf '\357\273\277---\r\nname: windows-crlf-skill\r\ndescription: Use when validating Windows CRLF and spaced-path handling.\r\n---\r\n\r\n# windows-crlf-skill\r\n' > "$FIXTURE"

echo -e "${BOLD}── Platform Classification ──${NC}"
assert_eq "Darwin maps to macOS" "macos" "$(bash -c '. "$1"; sr_platform_family_from_kernel Darwin' _ "$COMMON_SH")"
assert_eq "MINGW maps to Windows POSIX" "windows-posix" "$(bash -c '. "$1"; sr_platform_family_from_kernel MINGW64_NT-10.0' _ "$COMMON_SH")"
assert_eq "MSYS maps to Windows POSIX" "windows-posix" "$(bash -c '. "$1"; sr_platform_family_from_kernel MSYS_NT-10.0' _ "$COMMON_SH")"
actual_family=$(bash -c '. "$1"; sr_platform_family' _ "$COMMON_SH")
if [ -n "${EXPECTED_PLATFORM_FAMILY:-}" ]; then
    assert_eq "Runner platform family is explicit" "$EXPECTED_PLATFORM_FAMILY" "$actual_family"
fi
bash -c '. "$1"; sr_platform_family() { echo windows-wsl; }; sr_canary_storage_supported /mnt/c/Users/test' _ "$COMMON_SH"
assert_eq "WSL rejects canary storage on a mounted Windows drive" "1" "$?"
bash -c '. "$1"; sr_platform_family() { echo windows-wsl; }; sr_canary_storage_supported /home/test' _ "$COMMON_SH"
assert_eq "WSL accepts canary storage on its Linux filesystem" "0" "$?"
NO_HASH_BIN="$SANDBOX/no-hash-bin"
mkdir -p "$NO_HASH_BIN"
BASH_BIN="${BASH:-$(command -v bash)}"
PATH="$NO_HASH_BIN" "$BASH_BIN" -c '. "$1"; sr_require_sha256' _ "$COMMON_SH" >/dev/null 2>"$SANDBOX/no-hash.stderr"
assert_eq "Missing SHA-256 implementation fails explicitly" "127" "$?"
assert_eq "Missing SHA-256 implementation names the identity contract" "1" "$(grep -c 'normalized_content_sha256' "$SANDBOX/no-hash.stderr" || true)"
echo ""

echo -e "${BOLD}── Read-Only Governance on Spaced and CRLF Paths ──${NC}"
scan_json=$(cd "$WORK_DIR" && HOME="$HOME_DIR" bash "$SCAN" --json); scan_rc=$?
probe_json=$(cd "$WORK_DIR" && HOME="$HOME_DIR" bash "$PROBE" --json --cwd "$WORK_DIR"); probe_rc=$?
dash_json=$(cd "$WORK_DIR" && HOME="$HOME_DIR" bash "$DASH" --json 2>/dev/null); dash_rc=$?
doctor_json=$(cd "$WORK_DIR" && HOME="$HOME_DIR" SKILLS_REFINER_TOOLS_ROOT="$TOOLS_ROOT" bash "$DOCTOR" --json --cwd "$WORK_DIR"); doctor_rc=$?
assert_eq "Scan exits 0" "0" "$scan_rc"
assert_json "Scan returns one JSON object" "$scan_json"
assert_jq "Scan parses BOM and CRLF frontmatter" "$scan_json" 'any(.skills[]; .name == "windows-crlf-skill" and .runtime_contract.status == "unknown")'
assert_eq "Probe exits 0" "0" "$probe_rc"
assert_json "Probe returns one JSON object" "$probe_json"
assert_jq "Probe preserves the Windows-style spaced HOME path" "$probe_json" 'any(.entries[]; .name == "windows-crlf-skill" and (.canonical_skill_file | contains("Windows User")))'
assert_eq "Dashboard no-data exit remains 1" "1" "$dash_rc"
assert_jq "Dashboard no-data output remains structured" "$dash_json" '.error == "no_activation_log"'
assert_eq "Doctor treats dashboard no-data as non-fatal" "0" "$doctor_rc"
assert_jq "Doctor returns all read-only steps" "$doctor_json" '.steps.probe.status == "ok" and .steps.dashboard.status == "no_data" and .steps.hygiene.status == "ok"'
echo ""

echo -e "${BOLD}── Windows Canary Permission Boundary ──${NC}"
FAKE_BIN="$SANDBOX/fake-windows-bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/uname" <<'EOF'
#!/usr/bin/env bash
echo MINGW64_NT-10.0
EOF
chmod +x "$FAKE_BIN/uname"

canary_stderr="$SANDBOX/canary.stderr"
HOME="$HOME_DIR" PATH="$FAKE_BIN:$PATH" bash "$CANARY" "$FIXTURE" >/dev/null 2>"$canary_stderr"
canary_rc=$?
assert_eq "Canary fails closed under Git Bash semantics" "2" "$canary_rc"
assert_eq "Canary explains the POSIX permission requirement" "1" "$(grep -c 'requires enforceable POSIX file permissions' "$canary_stderr" || true)"
assert_eq "Rejected canary does not create an activation log" "no" "$([ -e "$HOME_DIR/.agents/debug/activation.jsonl" ] && echo yes || echo no)"
echo ""

echo -e "${BOLD}── CRLF Trace Round Trip and Degraded Guard ──${NC}"
ORIGINAL="$SANDBOX/windows-crlf.original"
COMMAND_FILE="$SANDBOX/degraded-canary.sh"
cp "$FIXTURE" "$ORIGINAL"
HOME="$HOME_DIR" bash "$TRACE" --inject "$FIXTURE" >/dev/null 2>&1
inject_rc=$?
awk '/^```bash$/ { in_block=1; next } in_block && /^```$/ { exit } in_block { print }' "$FIXTURE" > "$COMMAND_FILE"
CANARY_BACKUP="$CANARY.platform-test.bak"
mv "$CANARY" "$CANARY_BACKUP"
(cd "$WORK_DIR" && HOME="$HOME_DIR" PATH="$FAKE_BIN:$PATH" bash "$COMMAND_FILE") >/dev/null 2>"$SANDBOX/degraded.stderr"
degraded_rc=$?
mv "$CANARY_BACKUP" "$CANARY"
HOME="$HOME_DIR" bash "$TRACE" --strip "$FIXTURE" >/dev/null 2>&1
strip_rc=$?
assert_eq "Trace inject handles BOM, CRLF, and spaced paths" "0" "$inject_rc"
assert_eq "Degraded canary also fails closed on Git Bash" "1" "$degraded_rc"
assert_eq "Degraded path explains the permission boundary" "1" "$(grep -c 'requires enforceable POSIX file permissions' "$SANDBOX/degraded.stderr" || true)"
assert_eq "Trace strip succeeds" "0" "$strip_rc"
assert_eq "BOM/CRLF trace round trip is byte-identical" "0" "$(cmp -s "$FIXTURE" "$ORIGINAL"; echo $?)"
assert_eq "Degraded rejection does not create an activation log" "no" "$([ -e "$HOME_DIR/.agents/debug/activation.jsonl" ] && echo yes || echo no)"
echo ""

total=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    echo -e "${GREEN}All $total platform contract tests passed.${NC}"
else
    echo -e "${RED}$FAIL/$total platform contract tests failed.${NC}"
fi
exit "$FAIL"
