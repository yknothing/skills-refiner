# Runtime exposure and evidence

Read this for host profile changes or native runtime evidence. Set `NODE24` to
an absolute Node.js 24 executable and `LAUNCHER` to the installed
`skill-hygiene/bin/skills-refiner` before running the commands below.

Physical collection layout is not runtime isolation. Codex may recursively
discover nested members, so context reduction requires a host-specific runtime
profile and a fresh native catalog observation. Keep these truth layers
separate:

- `FILESYSTEM_READY` — the approved collection bytes and control generation are exact;
- `DEPLOYMENT_READY` — the host profile/config/projections match policy;
- `CATALOG_ONLY` — a fresh native session enumerated the expected identities;
- `QUALIFIED` — catalog, body-access, gateway-route, and context predicates all have qualifying evidence.

The default policy exposes all 13 Better Skills members and only the
`pc-prodcraft`, `loopos`, and `langcraft` gateways for their collections to
Codex and Claude. Cursor remains observe-only until a trustworthy native
catalog/profile mechanism is available. Never infer runtime qualification from
filesystem layout or source code inspection.

Use owner-private temporary files, inspect the exact profile plan, and confirm
only the returned `plan_hash`:

```bash
SESSION_DIR=$(mktemp -d /tmp/skills-refiner-runtime.XXXXXX) || exit 1
chmod 700 "$SESSION_DIR" || { rmdir -- "$SESSION_DIR"; exit 1; }
PROFILE_PLAN="$SESSION_DIR/profile-plan.json"
EVIDENCE="$SESSION_DIR/runtime-evidence.json"

SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile status --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile plan \
  --output "$PROFILE_PLAN" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile apply \
  --plan "$PROFILE_PLAN" --confirm 'sha256:...' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime probe \
  --adapter codex --output "$EVIDENCE" --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime record \
  --evidence "$EVIDENCE" --confirm 'sha256:...' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime status --json
```

Probe and record deliberately return nonzero while evidence is only
catalog-level; exit `10` means incomplete/unqualified evidence as well as
blocked drift at this boundary. It does not mean a successfully confirmed
record write was rolled back. Evidence is exact-schema, content-addressed, and
bound to the active collection generation, actual collection/config bytes,
host, executable identity, and derived native output digests. Raw prompts,
transcripts, URL credentials, SSH hosts, and arbitrary extra fields are not
evidence and must never be persisted.

Only the active, attested profile operation owns its managed Codex block and
Claude projections. A marker without the active operation is unowned. External
Codex preferences for unrelated Skill names or paths are preserved; a
semantically equivalent managed path, or syntax whose ownership cannot be
resolved safely, fails closed. A same-path external projection is user-owned
and blocks mutation.
Undo/recover require the exact operation id twice:

```bash
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile undo \
  'runtime-profile-............' --confirm 'runtime-profile-............' --json
SKILLS_REFINER_NODE_BIN="$NODE24" bash "$LAUNCHER" runtime profile recover \
  'runtime-profile-............' --confirm 'runtime-profile-............' --json
```

After any apply, start a fresh Agent session before probing; do not reuse a
pre-change catalog. Run Panorama after recording evidence so filesystem,
deployment, catalog, body, route, and context remain visible as independent
facts. The full authority and recovery model is archived in
ADR-0008 in the source repository; an independently installed Skill does not
depend on that document at runtime.
