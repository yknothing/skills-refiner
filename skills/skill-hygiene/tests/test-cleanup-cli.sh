#!/usr/bin/env bash
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$SCRIPT_DIR/../bin/skills-refiner"
NODE24_BIN="${NODE24_BIN:-/tmp/skills-refiner-node24/bin/node}"
NODE22_BIN="${NODE22_BIN:-/Users/whatsup/.nvm/versions/node/v22.19.0/bin/node}"
PASS=0
FAIL=0

assert_eq() {
    local label="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        printf 'ok - %s\n' "$label"
        PASS=$((PASS + 1))
    else
        printf 'not ok - %s (expected=%s actual=%s)\n' "$label" "$expected" "$actual"
        FAIL=$((FAIL + 1))
    fi
}

run_capture() {
    local stdout_file="$1" stderr_file="$2"
    shift 2
    set +e
    "$@" >"$stdout_file" 2>"$stderr_file"
    RUN_STATUS=$?
    set -e
}

safe_cleanup() {
    [ -n "${SANDBOX:-}" ] || return 0
    case "$SANDBOX" in
        /tmp/*|/private/tmp/*|/var/folders/*)
            find "$SANDBOX" -depth -mindepth 1 -delete 2>/dev/null || true
            rmdir "$SANDBOX" 2>/dev/null || true
            ;;
    esac
}

set -e
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/skills-refiner-cleanup-cli.XXXXXX")
trap safe_cleanup EXIT
stdout_file="$SANDBOX/stdout"
stderr_file="$SANDBOX/stderr"
scan_file="$SANDBOX/scan.json"
review_file="$SANDBOX/review.json"
decisions_file="$SANDBOX/decisions.json"

[ -x "$NODE24_BIN" ] || { echo "Node 24 test runtime missing: $NODE24_BIN" >&2; exit 1; }
assert_eq "certified Node major" "24" "$($NODE24_BIN -p 'process.versions.node.split(".")[0]')"

cat >"$scan_file" <<'JSON'
{"metadata":{"schema_version":"skill-scan.v5"},"entries":[],"skills":[],"skill_links":[],"broken_symlinks":[]}
JSON

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$SANDBOX/missing-node" "$LAUNCHER" cleanup review --json
assert_eq "missing Node exits unsupported" "3" "$RUN_STATUS"
assert_eq "missing Node emits one JSON object" "1" "$(jq -s 'length' "$stdout_file")"
assert_eq "missing Node error schema" "skills-refiner.cleanup.error.v1" "$(jq -r '.schema_version' "$stdout_file")"
assert_eq "missing Node has no mutation" "false" "$(jq -r '.mutation_occurred' "$stdout_file")"
assert_eq "missing Node has overall status" "unsupported" "$(jq -r '.overall_status' "$stdout_file")"
assert_eq "missing Node has no committed transactions" "0" "$(jq '.committed_transaction_ids | length' "$stdout_file")"
assert_eq "missing Node diagnostics stay on stderr" "1" "$(grep -c 'requires Node.js major 24' "$stderr_file")"

if [ -x "$NODE22_BIN" ]; then
    run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE22_BIN" "$LAUNCHER" cleanup review --json
    assert_eq "Node 22 exits unsupported" "3" "$RUN_STATUS"
    assert_eq "Node 22 emits fixed error code" "node_runtime_unavailable" "$(jq -r '.error_code' "$stdout_file")"
fi

for major in 23 25; do
    fake_node="$SANDBOX/node-$major"
    cat >"$fake_node" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "-p" ]; then printf '%s\\n' '$major'; exit 0; fi
exit 99
EOF
    chmod +x "$fake_node"
    run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$fake_node" "$LAUNCHER" cleanup review --json
    assert_eq "Node $major exits unsupported" "3" "$RUN_STATUS"
    assert_eq "Node $major stdout remains one JSON object" "1" "$(jq -s 'length' "$stdout_file")"
done

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" "$LAUNCHER" cleanup apply --plan "$scan_file" --json
assert_eq "raw scan apply exits invalid schema" "2" "$RUN_STATUS"
assert_eq "raw scan apply error code" "invalid_schema" "$(jq -r '.error_code' "$stdout_file")"
assert_eq "machine error contains no ANSI" "0" "$(LC_ALL=C grep -c $'\033' "$stdout_file" || true)"

mkdir -p "$SANDBOX/home"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" "$LAUNCHER" cleanup review --json
assert_eq "live review exits cleanly" "0" "$RUN_STATUS"
assert_eq "live review schema" "skills-refiner.cleanup.review.v1" "$(jq -r '.schema_version' "$stdout_file")"
assert_eq "live review is execution eligible" "true" "$(jq -r '.execution_eligible' "$stdout_file")"
assert_eq "live review stdout is one object" "1" "$(jq -s 'length' "$stdout_file")"

cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"later"}]}' \
    "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
assert_eq "empty live plan exits cleanly" "0" "$RUN_STATUS"
assert_eq "empty live plan uses plan schema" "skills-refiner.cleanup.plan.v1" "$(jq -r '.schema_version' "$stdout_file")"
assert_eq "empty live plan has no mutation items" "0" "$(jq '.items | length' "$stdout_file")"

mkdir -p "$SANDBOX/source-one" "$SANDBOX/source-two" "$SANDBOX/home/.claude/skills"
cat >"$SANDBOX/source-one/SKILL.md" <<'YAML'
---
name: source-skill
description: Use when testing cleanup plan routing.
---

# Source skill
YAML
cp "$SANDBOX/source-one/SKILL.md" "$SANDBOX/source-two/SKILL.md"
ln -s "$SANDBOX/source-one" "$SANDBOX/home/.claude/skills/source-skill"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"retire"}]}' \
    "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
assert_eq "retirement plan requires certified adapter" "3" "$RUN_STATUS"
assert_eq "unsupported adapter has fixed error code" "platform_adapter_unavailable" "$(jq -r '.error_code' "$stdout_file")"

rm "$SANDBOX/home/.claude/skills/source-skill"
ln -s "$SANDBOX/source-two" "$SANDBOX/home/.claude/skills/source-skill"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
assert_eq "changed live state returns drift exit" "10" "$RUN_STATUS"
assert_eq "changed live state has fingerprint error" "fingerprint_mismatch" "$(jq -r '.error_code' "$stdout_file")"
assert_eq "changed live state is classified as drift" "drifted" "$(jq -r '.overall_status' "$stdout_file")"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" "$LAUNCHER" cleanup review --scan "$scan_file" --json
assert_eq "offline review exits cleanly" "0" "$RUN_STATUS"
assert_eq "offline review cannot execute" "false" "$(jq -r '.execution_eligible' "$stdout_file")"
assert_eq "offline review has no executable plan" "null" "$(jq -r '.executable_plan' "$stdout_file")"

set +e
printf '' | env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" "$LAUNCHER" cleanup >"$stdout_file" 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "redirected stdin never prompts" "2" "$RUN_STATUS"
assert_eq "redirected stdin prints no prompt marker" "0" "$(grep -Ec '\?|Select|Choose|Confirm' "$stdout_file" || true)"

assert_eq "all cleanup CLI assertions" "0" "$FAIL"
printf '%s tests passed\n' "$PASS"
[ "$FAIL" -eq 0 ] || exit 1
