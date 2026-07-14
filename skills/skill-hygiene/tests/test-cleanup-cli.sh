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
        /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*)
            find "$SANDBOX" -depth -mindepth 1 -delete 2>/dev/null || true
            rmdir "$SANDBOX" 2>/dev/null || true
            ;;
    esac
}

set -e
SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/skills-refiner-cleanup-cli.XXXXXX")
SANDBOX=$(cd "$SANDBOX" && pwd -P)
trap safe_cleanup EXIT
stdout_file="$SANDBOX/stdout"
stderr_file="$SANDBOX/stderr"
scan_file="$SANDBOX/scan.json"
review_file="$SANDBOX/review.json"
decisions_file="$SANDBOX/decisions.json"
plan_file="$SANDBOX/plan.json"

[ -x "$NODE24_BIN" ] || { echo "Node 24 test runtime missing: $NODE24_BIN" >&2; exit 1; }
assert_eq "certified Node major" "24" "$($NODE24_BIN -p 'process.versions.node.split(".")[0]')"

cat >"$scan_file" <<'JSON'
{"metadata":{"schema_version":"skill-scan.v5"},"topology":{},"entries":[],"skills":[],"skill_links":[],"broken_symlinks":[]}
JSON

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$SANDBOX/missing-node" "$LAUNCHER" cleanup review --json
assert_eq "missing Node exits unsupported" "3" "$RUN_STATUS"
assert_eq "missing Node emits one JSON object" "1" "$(jq -s 'length' "$stdout_file")"
assert_eq "missing Node error schema" "skills-refiner.cleanup.error.v1" "$(jq -r '.schema_version' "$stdout_file")"
assert_eq "missing Node has no mutation" "false" "$(jq -r '.mutation_occurred' "$stdout_file")"
assert_eq "missing Node mutation outcome is explicit" "unchanged" "$(jq -r '.mutation_outcome' "$stdout_file")"
assert_eq "missing Node has no historical mutation" "false" "$(jq -r '.transaction_has_mutated' "$stdout_file")"
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
assert_eq "macOS retirement plan exits cleanly" "0" "$RUN_STATUS"
assert_eq "macOS retirement plan has one item" "1" "$(jq '.items | length' "$stdout_file")"
assert_eq "macOS plan uses native helper identity" "macos-native.v1" "$(jq -r '.items[0].execution_identity.adapter' "$stdout_file")"
assert_eq "macOS plan binds helper protocol" "skills-refiner.macos-helper.v1" "$(jq -r '.items[0].execution_identity.helper_protocol' "$stdout_file")"
cp "$stdout_file" "$plan_file"
plan_hash=$(jq -r '.plan_hash' "$plan_file")
transaction_id=$(jq -r '.items[0].transaction_id' "$plan_file")

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm wrong --json
assert_eq "wrong apply confirmation exits invalid" "2" "$RUN_STATUS"
assert_eq "wrong apply confirmation has no mutation" "false" "$(jq -r '.mutation_occurred' "$stdout_file")"
assert_eq "wrong apply confirmation preserves entry" "true" "$([ -L "$SANDBOX/home/.claude/skills/source-skill" ] && echo true || echo false)"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    SKILLS_REFINER_TEST_FAULT=before_state_planned SKILLS_REFINER_TEST_ROOT=/ \
    "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$plan_hash" --json
assert_eq "unsafe fault root exits invalid" "2" "$RUN_STATUS"
assert_eq "unsafe fault root has stable error" "unsafe_test_fault_root" "$(jq -r '.error_code' "$stdout_file")"
assert_eq "unsafe fault root preserves entry" "true" "$([ -L "$SANDBOX/home/.claude/skills/source-skill" ] && echo true || echo false)"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$plan_hash" --json
assert_eq "single-item apply commits" "0" "$RUN_STATUS"
assert_eq "apply status is committed" "committed" "$(jq -r '.status' "$stdout_file")"
assert_eq "legacy apply keeps its exact transaction v1 keys" \
    "command,committed_transaction_ids,location,mutation_occurred,mutation_outcome,overall_status,schema_version,state,status,transaction_has_mutated,transaction_id" \
    "$(jq -r 'keys | sort | join(",")' "$stdout_file")"
assert_eq "apply reports current mutation" "true" "$(jq -r '.mutation_occurred' "$stdout_file")"
assert_eq "apply removes active link" "false" "$([ -e "$SANDBOX/home/.claude/skills/source-skill" ] || [ -L "$SANDBOX/home/.claude/skills/source-skill" ] && echo true || echo false)"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup status --json "$transaction_id"
assert_eq "status reads historical helper" "0" "$RUN_STATUS"
assert_eq "status reports committed" "committed" "$(jq -r '.status' "$stdout_file")"
assert_eq "status does not claim current mutation" "false" "$(jq -r '.mutation_occurred' "$stdout_file")"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup undo "$transaction_id" --confirm "$transaction_id" --evil --json
assert_eq "undo rejects an unconsumed trailing option" "2" "$RUN_STATUS"
assert_eq "invalid undo does not mutate" "false" "$(jq -r '.mutation_occurred' "$stdout_file")"

ln -s "$SANDBOX/source-two" "$SANDBOX/home/.claude/skills/source-skill"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup undo --json "$transaction_id" --confirm "$transaction_id"
assert_eq "occupied undo exits conflict" "21" "$RUN_STATUS"
assert_eq "occupied undo reports stable error" "restore_destination_occupied" "$(jq -r '.error_code' "$stdout_file")"
assert_eq "occupied undo reports no current mutation" "false" "$(jq -r '.mutation_occurred' "$stdout_file")"
assert_eq "occupied undo preserves historical mutation" "true" "$(jq -r '.transaction_has_mutated' "$stdout_file")"
assert_eq "occupied undo reports its committed transaction" "$transaction_id" "$(jq -r '.committed_transaction_ids[0]' "$stdout_file")"
assert_eq "occupied undo reports command context" "undo" "$(jq -r '.command' "$stdout_file")"
assert_eq "occupied undo reports durable state" "COMMITTED" "$(jq -r '.state' "$stdout_file")"
assert_eq "occupied undo reports observed location" "rehydrated" "$(jq -r '.location' "$stdout_file")"
rm "$SANDBOX/home/.claude/skills/source-skill"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup undo --json "$transaction_id" --confirm "$transaction_id"
assert_eq "undo restores transaction" "0" "$RUN_STATUS"
assert_eq "undo status is restored" "restored" "$(jq -r '.status' "$stdout_file")"
assert_eq "undo restores raw symlink" "$SANDBOX/source-one" "$(readlink "$SANDBOX/home/.claude/skills/source-skill")"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" \
    "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$plan_hash" --json
assert_eq "restored transaction rejects replay" "10" "$RUN_STATUS"
assert_eq "replay reports stable error" "replay_protected" "$(jq -r '.error_code' "$stdout_file")"
assert_eq "replay reports no current mutation" "false" "$(jq -r '.mutation_occurred' "$stdout_file")"
assert_eq "replay preserves historical mutation" "true" "$(jq -r '.transaction_has_mutated' "$stdout_file")"
assert_eq "replay has no currently committed transaction" "0" "$(jq '.committed_transaction_ids | length' "$stdout_file")"
assert_eq "replay reports durable state" "RESTORED" "$(jq -r '.state' "$stdout_file")"

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

post_scan_home="$SANDBOX/post-scan-home"
mkdir -p "$post_scan_home/.claude/skills"
ln -s "$SANDBOX/source-one" "$post_scan_home/.claude/skills/source-skill"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$post_scan_home" \
    "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"retire"}]}' \
    "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$post_scan_home" \
    "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
cp "$stdout_file" "$plan_file"
post_scan_hash=$(jq -r '.plan_hash' "$plan_file")
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$post_scan_home" \
    "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$post_scan_hash" --post-scan --json
assert_eq "post-scan apply exits cleanly" "0" "$RUN_STATUS"
assert_eq "post-scan apply emits one JSON object" "1" "$(jq -s 'length' "$stdout_file")"
assert_eq "post-scan apply uses exact wrapper" "skills-refiner.cleanup.apply-report.v1" "$(jq -r '.schema_version' "$stdout_file")"
assert_eq "post-scan wrapper preserves transaction outcome" "skills-refiner.cleanup.transaction.v1" "$(jq -r '.apply_outcome.schema_version' "$stdout_file")"
assert_eq "post-scan document uses exact Agent keys" \
    "error_code,items,observation_status,scanner_schema,schema_version,warnings" \
    "$(jq -r '.post_scan | keys | sort | join(",")' "$stdout_file")"
assert_eq "post-scan item uses exact identity keys" \
    "baseline_identity_hash,entry_path,item_id,location,observed_identity_hash,status,transaction_id" \
    "$(jq -r '.post_scan.items[0] | keys | sort | join(",")' "$stdout_file")"
assert_eq "post-scan observation completes" "COMPLETE" "$(jq -r '.post_scan.observation_status' "$stdout_file")"
assert_eq "post-scan confirms absent committed entry" "QUARANTINED" "$(jq -r '.post_scan.items[0].status' "$stdout_file")"
assert_eq "quarantined report has stable base warnings" \
    'installer_may_redeploy,running_agent_may_cache' \
    "$(jq -r '.post_scan.warnings | join(",")' "$stdout_file")"
assert_eq "post-scan report exposes hashes but no semantic source object" "false" "$(jq 'has("semantic_identity") or (.post_scan.items[0] | has("semantic_identity"))' "$stdout_file")"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$post_scan_home" \
    "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$post_scan_hash" --post-scan --json
assert_eq "already-committed post-scan retry exits cleanly" "0" "$RUN_STATUS"
assert_eq "already-committed outcome remains unchanged" "already_committed" "$(jq -r '.apply_outcome.status' "$stdout_file")"
assert_eq "already-committed retry never invents a current baseline" "null" "$(jq -r '.post_scan.items[0].baseline_identity_hash' "$stdout_file")"
assert_eq "already-committed absent entry remains quarantined" "QUARANTINED" "$(jq -r '.post_scan.items[0].status' "$stdout_file")"

rehydrated_home="$SANDBOX/rehydrated-home"
mkdir -p "$rehydrated_home/.claude/skills"
ln -s "$SANDBOX/source-one" "$rehydrated_home/.claude/skills/source-skill"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$rehydrated_home" \
    "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"retire"}]}' \
    "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$rehydrated_home" \
    "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
cp "$stdout_file" "$plan_file"
rehydrated_hash=$(jq -r '.plan_hash' "$plan_file")
rehydrated_transaction_key=$(jq -r '.items[0].transaction_id | sub("^sha256:"; "")' "$plan_file")
(
    while [ -L "$rehydrated_home/.claude/skills/source-skill" ]; do :; done
    ln -s "$SANDBOX/source-one" "$rehydrated_home/.claude/skills/source-skill"
) &
redeployer_pid=$!
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$rehydrated_home" \
    "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$rehydrated_hash" --post-scan --json
wait "$redeployer_pid"
assert_eq "same semantic redeploy remains a successful apply" "0" "$RUN_STATUS"
assert_eq "stable same-semantic redeploy is explicitly rehydrated" "REHYDRATED" "$(jq -r '.post_scan.items[0].status' "$stdout_file")"
assert_eq "semantic comparison remains hash-equal" "true" "$(jq '.post_scan.items[0] | .baseline_identity_hash == .observed_identity_hash' "$stdout_file")"
assert_eq "rehydrated report disables automatic requarantine" "automatic_requarantine_disabled" "$(jq -r '.post_scan.warnings[-1]' "$stdout_file")"
assert_eq "rehydrated entry is never automatically quarantined again" "true" "$([ -L "$rehydrated_home/.claude/skills/source-skill" ] && echo true || echo false)"
assert_eq "rehydrated flow retains exactly the original quarantine payload" "1" "$(find "$rehydrated_home/.agents/skills-quarantine/transactions/$rehydrated_transaction_key/payload" -type l | wc -l | tr -d ' ')"

set +e
printf '' | env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$SANDBOX/home" "$LAUNCHER" cleanup >"$stdout_file" 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "redirected stdin never prompts" "2" "$RUN_STATUS"
assert_eq "redirected stdin prints no prompt marker" "0" "$(grep -Ec '\?|Select|Choose|Confirm' "$stdout_file" || true)"

guided_source="$SANDBOX/guided-source"
guided_home="$SANDBOX/guided-home"
mkdir -p "$guided_source" "$guided_home/.claude/skills"
cat >"$guided_source/SKILL.md" <<'YAML'
---
name: guided-skill
description: Use when testing the guided cleanup flow.
---

# Guided skill
YAML
ln -s "$guided_source" "$guided_home/.claude/skills/guided-skill"

expect_script="$SANDBOX/guided-keep.exp"
cat >"$expect_script" <<EOF
set timeout 20
log_file -noappend "$stdout_file"
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$guided_home "$LAUNCHER" cleanup
expect "guided-skill"
expect "Choose"
send "k\r"
expect "Saved 1 Keep decision"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >/dev/null 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "TTY Keep-only flow exits cleanly" "0" "$RUN_STATUS"
assert_eq "TTY Keep-only flow preserves active entry" "true" "$([ -L "$guided_home/.claude/skills/guided-skill" ] && echo true || echo false)"
keep_file="$guided_home/.agents/skills-refiner/cleanup/keep-decisions.json"
assert_eq "TTY Keep-only flow persists one decision" "1" "$(jq '.kept | length' "$keep_file")"
assert_eq "TTY output contains no ANSI" "0" "$(LC_ALL=C grep -c $'\033' "$stdout_file" || true)"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$guided_home" \
    "$LAUNCHER" cleanup review --json
assert_eq "machine review retains kept candidate" "1" "$(jq '.candidates | length' "$stdout_file")"
assert_eq "machine review overlays valid Keep" "keep" "$(jq -r '.candidates[0].persisted_decision' "$stdout_file")"

cat >"$expect_script" <<EOF
set timeout 20
log_file -noappend "$stdout_file"
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$guided_home "$LAUNCHER" cleanup
expect "Already kept: 1"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >/dev/null 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "valid Keep skips repeated prompt" "0" "$RUN_STATUS"
assert_eq "valid Keep run has no choice prompt" "0" "$(grep -c 'Choose' "$stdout_file" || true)"

inspect_home="$SANDBOX/inspect-home"
mkdir -p "$inspect_home/.claude/skills"
ln -s "$guided_source" "$inspect_home/.claude/skills/guided-skill"
cat >"$expect_script" <<EOF
set timeout 20
log_file -noappend "$stdout_file"
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$inspect_home "$LAUNCHER" cleanup
expect "Choose"
send "i\r"
expect "Installed entry:"
expect "Canonical target:"
expect "Action scope:"
expect "Kind:"
expect "Scope:"
expect "Eligibility:"
expect "Review reason:"
expect "Primary group:"
expect "Distribution consumers:"
expect "Relevant signals:"
expect "Uncertainty:"
expect "Choose"
send "\r"
expect "No changes applied"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >/dev/null 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "Inspect loops and blank means session Later" "0" "$RUN_STATUS"
assert_eq "Later creates no Keep store" "false" "$([ -e "$inspect_home/.agents/skills-refiner/cleanup/keep-decisions.json" ] && echo true || echo false)"
assert_eq "Presenter never prints undefined" "0" "$(grep -c 'undefined' "$stdout_file" || true)"

review_only_home="$SANDBOX/review-only-home"
mkdir -p "$review_only_home/.agents/skills/local-authored"
cat >"$review_only_home/.agents/skills/local-authored/SKILL.md" <<'YAML'
---
name: local-authored
description: Use when testing a review-only installed copy.
---

# Local authored
YAML
cat >"$expect_script" <<EOF
set timeout 20
log_file -noappend "$stdout_file"
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$review_only_home "$LAUNCHER" cleanup
expect "review_only: unproven_installed_copy"
expect "Choose"
send "r\r"
expect "Retire unavailable"
expect "Choose"
send "\r"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >/dev/null 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "review-only installed candidate is prompted" "0" "$RUN_STATUS"
assert_eq "review-only Retire is rejected without mutation" "true" "$([ -d "$review_only_home/.agents/skills/local-authored" ] && echo true || echo false)"

for unsafe_case in paste multiline; do
    unsafe_home="$SANDBOX/unsafe-$unsafe_case-home"
    mkdir -p "$unsafe_home/.claude/skills"
    ln -s "$guided_source" "$unsafe_home/.claude/skills/guided-skill"
    if [ "$unsafe_case" = paste ]; then unsafe_input='send "\033\[200~k\033\[201~\r"'; else unsafe_input='send "k\rk\r"'; fi
    cat >"$expect_script" <<EOF
set timeout 20
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$unsafe_home "$LAUNCHER" cleanup
expect "Choose"
$unsafe_input
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
    set +e
    /usr/bin/expect "$expect_script" >"$stdout_file" 2>"$stderr_file"
    RUN_STATUS=$?
    set -e
    assert_eq "$unsafe_case input cancels the whole session" "2" "$RUN_STATUS"
    assert_eq "$unsafe_case cancellation preserves active entry" "true" "$([ -L "$unsafe_home/.claude/skills/guided-skill" ] && echo true || echo false)"
    assert_eq "$unsafe_case cancellation writes no Keep store" "false" "$([ -e "$unsafe_home/.agents/skills-refiner/cleanup/keep-decisions.json" ] && echo true || echo false)"
done

typeahead_home="$SANDBOX/typeahead-home"
mkdir -p "$typeahead_home/.claude/skills"
ln -s "$guided_source" "$typeahead_home/.claude/skills/guided-skill"
cat >"$expect_script" <<EOF
set timeout 20
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$typeahead_home "$LAUNCHER" cleanup
expect "Choose"
send "l\r"
after 1
send "l\r"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >"$stdout_file" 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "split-chunk typeahead cancels the whole session" "2" "$RUN_STATUS"
assert_eq "split-chunk typeahead preserves active entry" "true" "$([ -L "$typeahead_home/.claude/skills/guided-skill" ] && echo true || echo false)"
assert_eq "split-chunk typeahead writes no Keep store" "false" "$([ -e "$typeahead_home/.agents/skills-refiner/cleanup/keep-decisions.json" ] && echo true || echo false)"

ctrl_home="$SANDBOX/ctrl-home"
mkdir -p "$ctrl_home/.claude/skills"
ln -s "$guided_source" "$ctrl_home/.claude/skills/guided-skill"
cat >"$expect_script" <<EOF
set timeout 20
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$ctrl_home "$LAUNCHER" cleanup
expect "Choose"
send "\003"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >"$stdout_file" 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "Ctrl-C exits 130" "130" "$RUN_STATUS"
assert_eq "Ctrl-C preserves active entry" "true" "$([ -L "$ctrl_home/.claude/skills/guided-skill" ] && echo true || echo false)"
assert_eq "Ctrl-C writes no Keep store" "false" "$([ -e "$ctrl_home/.agents/skills-refiner/cleanup/keep-decisions.json" ] && echo true || echo false)"

confirm_home="$SANDBOX/confirm-home"
mkdir -p "$confirm_home/.claude/skills"
ln -s "$guided_source" "$confirm_home/.claude/skills/guided-skill"
cat >"$expect_script" <<EOF
set timeout 20
log_file -noappend "$stdout_file"
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$confirm_home "$LAUNCHER" cleanup
expect "Choose"
send "r\r"
expect -re {Type apply [0-9a-f]{12}}
send "wrong\r"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >/dev/null 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "wrong short confirmation exits invalid" "2" "$RUN_STATUS"
assert_eq "wrong short confirmation preserves active entry" "true" "$([ -L "$confirm_home/.claude/skills/guided-skill" ] && echo true || echo false)"
assert_eq "wrong confirmation creates no transaction" "false" "$([ -e "$confirm_home/.agents/skills-refiner/cleanup/transactions" ] && echo true || echo false)"
assert_eq "wrong confirmation writes no Keep store" "false" "$([ -e "$confirm_home/.agents/skills-refiner/cleanup/keep-decisions.json" ] && echo true || echo false)"

eof_home="$SANDBOX/eof-home"
mkdir -p "$eof_home/.claude/skills"
ln -s "$guided_source" "$eof_home/.claude/skills/guided-skill"
cat >"$expect_script" <<EOF
set timeout 20
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$eof_home "$LAUNCHER" cleanup
expect "Choose"
send "\004"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >"$stdout_file" 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "EOF exits cancelled" "2" "$RUN_STATUS"
assert_eq "EOF preserves active entry" "true" "$([ -L "$eof_home/.claude/skills/guided-skill" ] && echo true || echo false)"
assert_eq "EOF writes no Keep store" "false" "$([ -e "$eof_home/.agents/skills-refiner/cleanup/keep-decisions.json" ] && echo true || echo false)"

agent_home="$SANDBOX/agent-home"
mkdir -p "$agent_home/.claude/skills"
ln -s "$guided_source" "$agent_home/.claude/skills/guided-skill"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$agent_home" "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"keep"}]}' "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$agent_home" "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
assert_eq "Agent plan without persist flag exits cleanly" "0" "$RUN_STATUS"
assert_eq "Agent plan without persist flag has no Keep side effect" "false" "$([ -e "$agent_home/.agents/skills-refiner/cleanup/keep-decisions.json" ] && echo true || echo false)"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$agent_home" "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --persist-keep --json
assert_eq "Agent explicit Keep persistence exits cleanly" "0" "$RUN_STATUS"
assert_eq "Agent explicit Keep persistence writes one record" "1" "$(jq '.kept | length' "$agent_home/.agents/skills-refiner/cleanup/keep-decisions.json")"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$review_only_home" "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"keep"}]}' "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$review_only_home" "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --persist-keep --json
assert_eq "review-only Keep is persisted explicitly" "1" "$(jq '.kept | length' "$review_only_home/.agents/skills-refiner/cleanup/keep-decisions.json")"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$review_only_home" "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"retire"}]}' "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$review_only_home" "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --persist-keep --json
assert_eq "invalid Agent retirement is blocked" "10" "$RUN_STATUS"
assert_eq "invalid Agent plan cannot erase prior Keep" "1" "$(jq '.kept | length' "$review_only_home/.agents/skills-refiner/cleanup/keep-decisions.json")"

malformed_home="$SANDBOX/malformed-home"
mkdir -p "$malformed_home/.claude/skills" "$malformed_home/.agents"
install -d -m 700 "$malformed_home/.agents/skills-refiner" "$malformed_home/.agents/skills-refiner/cleanup"
ln -s "$guided_source" "$malformed_home/.claude/skills/guided-skill"
printf '%s' '{broken' >"$malformed_home/.agents/skills-refiner/cleanup/keep-decisions.json"
chmod 600 "$malformed_home/.agents/skills-refiner/cleanup/keep-decisions.json"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$malformed_home" "$LAUNCHER" cleanup review --json
assert_eq "malformed Keep store does not hide candidate" "1" "$(jq '.candidates | length' "$stdout_file")"
assert_eq "malformed Keep store resurfaces candidate" "resurfaced" "$(jq -r '.candidates[0].keep_status' "$stdout_file")"
assert_eq "malformed Keep store is never repaired" "{broken" "$(cat "$malformed_home/.agents/skills-refiner/cleanup/keep-decisions.json")"

mixed_home="$SANDBOX/mixed-home"
mixed_keep_source="$SANDBOX/mixed-keep-source"
mixed_retire_source="$SANDBOX/mixed-retire-source"
mkdir -p "$mixed_home/.claude/skills" "$mixed_keep_source" "$mixed_retire_source"
sed 's/guided-skill/keep-guided/' "$guided_source/SKILL.md" >"$mixed_keep_source/SKILL.md"
sed 's/guided-skill/retire-guided/' "$guided_source/SKILL.md" >"$mixed_retire_source/SKILL.md"
ln -s "$mixed_keep_source" "$mixed_home/.claude/skills/keep-guided"
ln -s "$mixed_retire_source" "$mixed_home/.claude/skills/retire-guided"
cat >"$expect_script" <<EOF
set timeout 30
log_file -noappend "$stdout_file"
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$mixed_home "$LAUNCHER" cleanup
for {set index 0} {\$index < 2} {incr index} {
    expect -re {(keep-guided|retire-guided)}
    set name \$expect_out(1,string)
    expect "Choose"
    if {\$name eq "keep-guided"} { send "k\r" } else { send "r\r" }
}
expect -re {Type (apply [0-9a-f]{12}) to retire}
set confirmation \$expect_out(1,string)
send "\$confirmation\r"
expect "Retired 1 entry"
expect "Post-scan verification: COMPLETE (QUARANTINED)"
expect "Installers can redeploy retired skills"
expect "Running Agents may retain cached skill state"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >/dev/null 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "mixed Keep and Retire flow exits cleanly" "0" "$RUN_STATUS"
assert_eq "mixed flow preserves kept entry" "true" "$([ -L "$mixed_home/.claude/skills/keep-guided" ] && echo true || echo false)"
assert_eq "mixed flow retires selected entry" "false" "$([ -e "$mixed_home/.claude/skills/retire-guided" ] || [ -L "$mixed_home/.claude/skills/retire-guided" ] && echo true || echo false)"
assert_eq "mixed flow persists Keep before mutation" "1" "$(jq '.kept | length' "$mixed_home/.agents/skills-refiner/cleanup/keep-decisions.json")"

gate_home="$SANDBOX/gate-home"
gate_keep_source="$SANDBOX/gate-keep-source"
gate_retire_source="$SANDBOX/gate-retire-source"
mkdir -p "$gate_home/.claude/skills" "$gate_keep_source" "$gate_retire_source"
sed 's/guided-skill/gate-keep/' "$guided_source/SKILL.md" >"$gate_keep_source/SKILL.md"
sed 's/guided-skill/gate-retire/' "$guided_source/SKILL.md" >"$gate_retire_source/SKILL.md"
ln -s "$gate_keep_source" "$gate_home/.claude/skills/gate-keep"
ln -s "$gate_retire_source" "$gate_home/.claude/skills/gate-retire"
cat >"$expect_script" <<EOF
set timeout 30
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$gate_home "$LAUNCHER" cleanup
for {set index 0} {\$index < 2} {incr index} {
    expect -re {(gate-keep|gate-retire)}
    set name \$expect_out(1,string)
    expect "Choose"
    if {\$name eq "gate-keep"} { send "k\r" } else { send "r\r" }
}
expect -re {Type (apply [0-9a-f]{12}) to retire}
set confirmation \$expect_out(1,string)
file mkdir "$gate_home/.agents/skills-refiner/cleanup"
set store [open "$gate_home/.agents/skills-refiner/cleanup/keep-decisions.json" w]
puts -nonewline \$store "{broken"
close \$store
file attributes "$gate_home/.agents/skills-refiner/cleanup/keep-decisions.json" -permissions 0600
send "\$confirmation\r"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >"$stdout_file" 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "Keep persistence failure blocks Retire" "10" "$RUN_STATUS"
assert_eq "Keep gate failure preserves retire target" "true" "$([ -L "$gate_home/.claude/skills/gate-retire" ] && echo true || echo false)"
assert_eq "Keep gate failure creates no transaction" "false" "$([ -e "$gate_home/.agents/skills-refiner/cleanup/transactions" ] && echo true || echo false)"

partial_home="$SANDBOX/p"
partial_safe_source="$SANDBOX/partial-safe-source"
partial_fail_source="$SANDBOX/partial-fail-source"
partial_retire_source="$SANDBOX/partial-retire-source"
mkdir -p "$partial_home/.claude/skills" "$partial_home/.cursor/skills" "$partial_home/.codex/skills" \
    "$partial_safe_source" "$partial_fail_source" "$partial_retire_source"
chmod 777 "$partial_home/.cursor/skills"
sed 's/guided-skill/partial-safe/' "$guided_source/SKILL.md" >"$partial_safe_source/SKILL.md"
sed 's/guided-skill/partial-fail/' "$guided_source/SKILL.md" >"$partial_fail_source/SKILL.md"
sed 's/guided-skill/partial-retire/' "$guided_source/SKILL.md" >"$partial_retire_source/SKILL.md"
ln -s "$partial_safe_source" "$partial_home/.claude/skills/partial-safe"
ln -s "$partial_fail_source" "$partial_home/.cursor/skills/partial-fail"
ln -s "$partial_retire_source" "$partial_home/.codex/skills/partial-retire"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$partial_home" "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:(if .name == "partial-retire" then "retire" else "keep" end)}]}' "$review_file" >"$decisions_file"
partial_fail_id=$(jq -r '.candidates[] | select(.name == "partial-fail") | .candidate_id' "$review_file")
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$partial_home" "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --persist-keep --json
assert_eq "partial Keep identity failure exits blocked" "10" "$RUN_STATUS"
assert_eq "partial Keep failure stays machine-readable" "1" "$(jq '.failures | length' "$stdout_file")"
assert_eq "partial Keep failure preserves candidate identity" "$partial_fail_id" "$(jq -r '.failures[0].candidate_id' "$stdout_file")"
assert_eq "partial Keep failure preserves stable code" "blocked" "$(jq -r '.failures[0].code' "$stdout_file")"
assert_eq "partial Keep failure preserves stable reason" "unsafe_active_root" "$(jq -r '.failures[0].reason' "$stdout_file")"
assert_eq "safe Keep persists despite sibling failure" "1" "$(jq '.kept | length' "$partial_home/.agents/skills-refiner/cleanup/keep-decisions.json")"
assert_eq "partial Keep failure preserves active Retire target" "true" "$([ -L "$partial_home/.codex/skills/partial-retire" ] && echo true || echo false)"
assert_eq "partial Keep failure creates no transaction" "false" "$([ -e "$partial_home/.agents/skills-refiner/cleanup/transactions" ] && echo true || echo false)"

partial_tty_home="$SANDBOX/partial-tty-home"
mkdir -p "$partial_tty_home/.claude/skills" "$partial_tty_home/.cursor/skills" "$partial_tty_home/.codex/skills"
chmod 777 "$partial_tty_home/.cursor/skills"
ln -s "$partial_safe_source" "$partial_tty_home/.claude/skills/partial-safe"
ln -s "$partial_fail_source" "$partial_tty_home/.cursor/skills/partial-fail"
ln -s "$partial_retire_source" "$partial_tty_home/.codex/skills/partial-retire"
cat >"$expect_script" <<EOF
set timeout 30
log_file -noappend "$stdout_file"
spawn env SKILLS_REFINER_NODE_BIN=$NODE24_BIN HOME=$partial_tty_home "$LAUNCHER" cleanup
for {set index 0} {\$index < 3} {incr index} {
    expect -re {(partial-safe|partial-fail|partial-retire)}
    set name \$expect_out(1,string)
    expect "Choose"
    if {\$name eq "partial-retire"} { send "r\r" } else { send "k\r" }
}
expect -re {Type (apply [0-9a-f]{12}) to retire}
set confirmation \$expect_out(1,string)
send "\$confirmation\r"
expect "Keep failed"
expect "unsafe_active_root"
expect eof
lassign [wait] pid spawnid os_error status
exit \$status
EOF
set +e
/usr/bin/expect "$expect_script" >/dev/null 2>"$stderr_file"
RUN_STATUS=$?
set -e
assert_eq "TTY reports partial Keep failure and blocks Retire" "10" "$RUN_STATUS"
assert_eq "TTY partial failure persists safe Keep" "1" "$(jq '.kept | length' "$partial_tty_home/.agents/skills-refiner/cleanup/keep-decisions.json")"
assert_eq "TTY partial failure preserves active Retire target" "true" "$([ -L "$partial_tty_home/.codex/skills/partial-retire" ] && echo true || echo false)"
assert_eq "TTY partial failure creates no transaction" "false" "$([ -e "$partial_tty_home/.agents/skills-refiner/cleanup/transactions" ] && echo true || echo false)"

batch_home="$SANDBOX/batch-home"
mkdir -p "$batch_home/.claude/skills" "$SANDBOX/batch-source-one" "$SANDBOX/batch-source-two"
cp "$guided_source/SKILL.md" "$SANDBOX/batch-source-one/SKILL.md"
sed 's/guided-skill/guided-skill-two/' "$guided_source/SKILL.md" >"$SANDBOX/batch-source-two/SKILL.md"
ln -s "$SANDBOX/batch-source-one" "$batch_home/.claude/skills/guided-skill"
ln -s "$SANDBOX/batch-source-two" "$batch_home/.claude/skills/guided-skill-two"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$batch_home" "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"retire"}]}' "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$batch_home" "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
cp "$stdout_file" "$plan_file"
batch_hash=$(jq -r '.plan_hash' "$plan_file")
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$batch_home" "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$batch_hash" --json
assert_eq "multi-item CLI apply uses batch coordinator" "0" "$RUN_STATUS"
assert_eq "multi-item CLI apply emits batch result" "skills-refiner.cleanup.batch.v1" "$(jq -r '.schema_version' "$stdout_file")"
assert_eq "multi-item CLI apply retires both entries" "0" "$(find "$batch_home/.claude/skills" -type l | wc -l | tr -d ' ')"

drift_home="$SANDBOX/drift-home"
mkdir -p "$drift_home/.claude/skills"
ln -s "$SANDBOX/batch-source-one" "$drift_home/.claude/skills/guided-skill"
ln -s "$SANDBOX/batch-source-two" "$drift_home/.claude/skills/guided-skill-two"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$drift_home" "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"retire"}]}' "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$drift_home" "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
cp "$stdout_file" "$plan_file"
batch_hash=$(jq -r '.plan_hash' "$plan_file")
rm "$drift_home/.claude/skills/guided-skill-two"
ln -s "$SANDBOX/batch-source-one" "$drift_home/.claude/skills/guided-skill-two"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$drift_home" "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$batch_hash" --json
assert_eq "batch preflight drift exits blocked" "10" "$RUN_STATUS"
assert_eq "batch failure emits exact batch error" "skills-refiner.cleanup.batch-error.v1" "$(jq -r '.schema_version' "$stdout_file")"
assert_eq "batch preflight drift mutates no active entry" "2" "$(find "$drift_home/.claude/skills" -type l | wc -l | tr -d ' ')"

run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$drift_home" "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$batch_hash" --post-scan --json
assert_eq "zero-commit post-scan error preserves original exit" "10" "$RUN_STATUS"
assert_eq "zero-commit post-scan error is not wrapped" "skills-refiner.cleanup.batch-error.v1" "$(jq -r '.schema_version' "$stdout_file")"

partial_home="$SANDBOX/partial-home"
partial_source_one="$SANDBOX/partial-source-one"
partial_source_two="$SANDBOX/partial-source-two"
mkdir -p "$partial_home/.claude/skills" "$partial_source_one" "$partial_source_two"
chmod 755 "$partial_home" "$partial_home/.claude" "$partial_home/.claude/skills"
cp "$guided_source/SKILL.md" "$partial_source_one/SKILL.md"
sed 's/guided-skill/guided-skill-two/' "$guided_source/SKILL.md" >"$partial_source_two/SKILL.md"
ln -s "$partial_source_one" "$partial_home/.claude/skills/guided-skill"
ln -s "$partial_source_two" "$partial_home/.claude/skills/guided-skill-two"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$partial_home" "$LAUNCHER" cleanup review --json
cp "$stdout_file" "$review_file"
jq '{schema_version:"skills-refiner.cleanup.decisions.v1",review_fingerprint:.review_fingerprint,decisions:[.candidates[]|{candidate_id,action:"retire"}]}' "$review_file" >"$decisions_file"
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$partial_home" "$LAUNCHER" cleanup plan --review "$review_file" --decisions "$decisions_file" --json
cp "$stdout_file" "$plan_file"
assert_eq "partial wrapper fixture plan exits cleanly" "0" "$RUN_STATUS"
assert_eq "partial wrapper fixture has two items" "2" "$(jq '.items | length' "$plan_file")"
assert_eq "partial wrapper fixture has no planning error" "none" "$(jq -r '.error_code // "none"' "$plan_file")"
if [ "$(jq '.items | length' "$plan_file")" != "2" ]; then
    assert_eq "all cleanup CLI assertions" "0" "$FAIL"
    exit 1
fi
partial_hash=$(jq -r '.plan_hash' "$plan_file")
first_entry=$(jq -r '.items[0].entry_path' "$plan_file")
second_entry=$(jq -r '.items[1].entry_path' "$plan_file")
(
    while [ -L "$first_entry" ]; do :; done
    rm "$second_entry"
    ln -s "$partial_source_one" "$second_entry"
) &
drifter_pid=$!
run_capture "$stdout_file" "$stderr_file" env SKILLS_REFINER_NODE_BIN="$NODE24_BIN" HOME="$partial_home" "$LAUNCHER" cleanup apply --plan "$plan_file" --confirm "$partial_hash" --post-scan --json
wait "$drifter_pid"
assert_eq "committed-prefix post-scan preserves recovery exit" "20" "$RUN_STATUS"
assert_eq "committed-prefix post-scan emits one JSON object" "1" "$(jq -s 'length' "$stdout_file")"
assert_eq "committed-prefix post-scan uses apply wrapper" "skills-refiner.cleanup.apply-report.v1" "$(jq -r '.schema_version' "$stdout_file")"
assert_eq "committed-prefix wrapper preserves batch error" "skills-refiner.cleanup.batch-error.v1" "$(jq -r '.apply_outcome.schema_version' "$stdout_file")"
assert_eq "committed-prefix wrapper preserves exact committed IDs" "true" "$(jq '.apply_outcome.committed_transaction_ids == [.post_scan.items[].transaction_id]' "$stdout_file")"
assert_eq "committed-prefix post-scan verifies only one committed item" "1" "$(jq '.post_scan.items | length' "$stdout_file")"

assert_eq "all cleanup CLI assertions" "0" "$FAIL"
printf '%s tests passed\n' "$PASS"
[ "$FAIL" -eq 0 ] || exit 1
