# ProdCraft Physical Collection Migration Implementation Plan

> **Execution:** Run inline with the `executing-plans` workflow on the existing `codex/adr-skill-control-plane` branch. Do not mutate the live home until the synthetic-HOME gates pass.

**Goal:** Replace the 46 receipt-owned legacy ProdCraft skills in `/Users/whatsup/.agents/skills` with the reviewed 40-package `pc-*` public surface physically stored under `/Users/whatsup/.agents/skills/prodcraft`, while preserving provenance, drift detection, and exact recoverability.

**Architecture:** Add an isolated `collection` command family beside the existing cleanup command. The planner binds direct filesystem observations and a fixed upstream source tree into a canonical plan hash. The transaction layer materializes an immutable artifact and staged collection outside discovery, publishes independent recovery evidence, moves only identity-matched legacy objects to quarantine, publishes the collection by rename, and records a durable operation journal. Status always re-observes the filesystem; ledger and `INDEX.json` are desired-state/materialized views, not substitutes for physical truth.

**Tech stack:** Bash launcher, Node.js 24 ESM, built-in `node:test`, POSIX/macOS filesystem operations, upstream Python validators as acceptance probes only.

## Fixed contracts

- Physical collection: `$HOME/.agents/skills/prodcraft` (real directory, no root `SKILL.md`).
- Direct members: exactly the 40 names in the pinned upstream `skills/.curated/index.json`.
- Default projection: `$HOME/.agents/skills/pc-prodcraft -> prodcraft/pc-prodcraft`.
- Known Agent projections: replace receipt-owned legacy links in existing `.claude/skills` and `.factory/skills` roots with one `pc-prodcraft` link per participating root.
- External installer receipt: observe and snapshot `$HOME/.agents/.skill-lock.json`; do not rewrite it.
- Control data: `$HOME/.agents/skill-control/collections/prodcraft`.
- Same-device quarantine: `$HOME/.agents/skills-quarantine/collections/<operation-id>`.
- Independent recovery: `${SKILLS_REFINER_RECOVERY_ROOT:-$HOME/Library/Application Support/skills-refiner/recovery}/operations/<operation-id>`.
- Candidate source: an absolute, non-symlink repository root whose public registry, curated index, curated packages, and gateway all validate.
- Live reviewed revision: `fd05978dbbbf5a064205a695af47c8a550f1b224`, unless a fresh upstream check proves `main` moved and a new candidate is reviewed.

## Task 1: Define and test the collection contracts

**Files:**

- Create: `skills/skill-hygiene/lib/collection-contract.mjs`
- Create: `skills/skill-hygiene/tests/test-collection-contract.mjs`

1. Write failing tests for canonical plan hashing, unknown-key rejection, absolute contained paths, exact ProdCraft member names, receipt-owned legacy entries, raw symlink targets, and operation states.
2. Run:

   ```bash
   /Users/whatsup/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test skills/skill-hygiene/tests/test-collection-contract.mjs
   ```

   Expect failure because the module does not exist.
3. Implement `buildCollectionPlan`, `validateCollectionPlan`, `computeCollectionPlanHash`, `validateCollectionIndex`, and `validateOperationRecord` using the existing canonical JSON implementation.
4. Re-run the test and require all assertions to pass.

## Task 2: Build source and installed-state observation

**Files:**

- Create: `skills/skill-hygiene/lib/prodcraft-collection.mjs`
- Create: `skills/skill-hygiene/tests/prodcraft-collection-fixtures.mjs`
- Create: `skills/skill-hygiene/tests/test-prodcraft-collection.mjs`

1. Create fixtures that copy the pinned upstream curated surface and synthesize a HOME containing:
   - 46 legacy directories;
   - a `.skill-lock.json` with source `yknothing/prodcraft`;
   - matching Claude and Factory raw symlinks;
   - unrelated skills and links that must remain byte-for-byte unchanged.
2. Write failing tests for `inspectProdcraftSource` and `observeProdcraftInstall`:
   - reject symlinked source roots and member paths;
   - require registry/index/member equality and 40 unique `pc-*` names;
   - verify every member frontmatter `name` and `description` length;
   - bind per-member tree digests and the source tree digest;
   - classify only receipt entries whose source is exactly `yknothing/prodcraft` as legacy;
   - record absent, conflicting, and raw Agent projection states.
3. Run the narrow test and confirm RED.
4. Implement deterministic tree hashing without following symlinks, direct observation, and source validation.
5. Re-run and require GREEN.

## Task 3: Compile a complete 46-to-40 migration plan

**Files:**

- Modify: `skills/skill-hygiene/lib/prodcraft-collection.mjs`
- Modify: `skills/skill-hygiene/tests/test-prodcraft-collection.mjs`

1. Add failing tests that require:
   - all 46 receipt-owned entities receive one disposition;
   - 39 lexical successors are `replaced` only when identity evidence is present;
   - seven legacy-only packages are `retired_by_owner`;
   - `pc-requirements-engineering` is an upstream-only addition;
   - unrelated `bs-requirements-engineering` is preserved;
   - plan hash changes for source revision, digest, path, receipt, legacy identity, or raw link drift;
   - created timestamps do not change the plan hash.
2. Implement `compileProdcraftPlan` and require a fixed absolute HOME, candidate revision, source observation, legacy observation, target topology, projection matrix, and expected postconditions.
3. Re-run the narrow test and require GREEN.

## Task 4: Implement recoverable apply and status

**Files:**

- Modify: `skills/skill-hygiene/lib/prodcraft-collection.mjs`
- Modify: `skills/skill-hygiene/tests/test-prodcraft-collection.mjs`

1. Add failing tests for:
   - confirmation mismatch and preflight drift cause zero mutation;
   - staged tree contains exactly 40 members plus `INDEX.json`;
   - nested gateway locator points to the digest-bound artifact repository;
   - recovery copy and quarantine are readable before active mutation;
   - old 46 directories and known old projections leave active roots;
   - new physical collection and projections have exact raw targets;
   - unrelated paths are unchanged;
   - operation journal reaches `COMMITTED` only after fresh status is `READY`;
   - injected failure at each mutation boundary restores the complete old state or reports `RECOVERY_REQUIRED`.
2. Implement a fail-closed global mutation lock, durable JSON writes, immutable artifact copy, collection materialization, recovery verification, identity-checked moves, projection publication, rollback, and direct `statusProdcraftCollection` reconciliation.
3. Re-run the narrow test, including all fault phases, and require GREEN.

## Task 5: Implement repair and undo

**Files:**

- Modify: `skills/skill-hygiene/lib/prodcraft-collection.mjs`
- Modify: `skills/skill-hygiene/tests/test-prodcraft-collection.mjs`

1. Add failing tests for:
   - deleting one member makes fresh status `DRIFTED` with `MISSING` evidence;
   - repair restores only missing/managed content from the exact active artifact;
   - a conflicting user-created replacement blocks repair;
   - undo first verifies the committed post-state identity;
   - undo restores all 46 old directories and exact raw Claude/Factory links;
   - a conflicting externally replaced active path blocks undo without overwrite.
2. Implement `repairProdcraftCollection` and `undoProdcraftOperation` with operation-id confirmation and durable state transitions.
3. Re-run the narrow test and require GREEN.

## Task 6: Expose the CLI without regressing cleanup

**Files:**

- Create: `skills/skill-hygiene/lib/collection-cli.mjs`
- Modify: `skills/skill-hygiene/bin/skills-refiner`
- Create: `skills/skill-hygiene/tests/test-collection-cli.sh`

1. Add failing CLI tests for:

   ```text
   collection check prodcraft --source <root> --revision <sha> --json
   collection plan prodcraft --source <root> --revision <sha> --output <file> --json
   collection apply --plan <file> --confirm <sha256:...> --json
   collection status prodcraft --fresh --json
   collection repair prodcraft --confirm <operation-id> --json
   collection undo <operation-id> --confirm <operation-id> --json
   ```

   Assert one JSON object, stable schema/status/error codes, exit `2` for invalid input, `10` for deterministic conflict, and `20` for recovery-required ambiguity.
2. Dispatch only first argument `collection` to the new CLI; leave `cleanup` and `setup-cli` behavior unchanged.
3. Run the CLI test and the complete existing cleanup suite.

## Task 7: Prove the isolated migration and upstream package integrity

**Files:**

- Create: `docs/verification/2026-07-20-prodcraft-physical-collection-migration.md`

1. Run all Node and shell tests:

   ```bash
   NODE24=/Users/whatsup/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
   "$NODE24" --test skills/skill-hygiene/tests/test-*.mjs
   bash skills/skill-hygiene/tests/test-scan.sh
   bash skills/skill-hygiene/tests/test-cleanup-cli.sh
   bash skills/skill-hygiene/tests/test-collection-cli.sh
   ```

2. Run the upstream candidate validator and tests from the fixed snapshot:

   ```bash
   python3 scripts/validate_prodcraft.py
   python3 -m unittest tests.test_install_prodcraft_global_skill
   ```

3. Run collection `check`, `plan`, `apply`, `status`, manual-delete/repair, and `undo` against a disposable synthetic HOME copied from the live 46-entry topology.
4. Record exact commands, hashes, counts, fault results, and any unverified Agent-runtime claims in the verification document.

## Task 8: Fresh upstream check and live cutover

**Files:**

- Modify: `docs/verification/2026-07-20-prodcraft-physical-collection-migration.md`

1. Query the authoritative GitHub repository for current `main`.
2. If `main` differs from the reviewed revision, stop live apply, audit the new candidate, regenerate the plan, and record the decision. Do not call an older revision “latest.”
3. Generate the live read-only plan from `/Users/whatsup/.agents/.skill-lock.json`, `/Users/whatsup/.agents/skills`, existing Claude/Factory roots, and the fixed source artifact.
4. Review the exact legacy disposition list, unrelated-preservation set, projection matrix, recovery destination, and plan hash.
5. Apply using the exact plan hash, then run fresh status.
6. Verify directly:

   ```text
   /Users/whatsup/.agents/skills/prodcraft is a real directory
   /Users/whatsup/.agents/skills/prodcraft/SKILL.md is absent
   direct pc-* member count is 40
   /Users/whatsup/.agents/skills/pc-prodcraft is the approved symlink
   top-level receipt-owned legacy directory count is 0
   INDEX.json, artifact, members, locator, and projections match
   unrelated skills and receipt bytes are unchanged
   recovery and undo evidence are readable
   ```

7. Run fresh Agent discovery/load probes where the installed clients expose a safe non-mutating interface. Record each Agent result independently; do not infer runtime/context success from filesystem layout.
8. Update ADR-0005 status to `Accepted — implemented` only after the live filesystem and recovery gates pass.

## Self-review checklist

- Every ADR-0005 acceptance condition maps to a test or live evidence item.
- The plan does not treat `.skill-lock.json` as desired state or rewrite it.
- No wildcard or basename-only deletion is permitted.
- Every live mutation is identity-bound, confirmation-bound, serialized, recoverable, and re-observed.
- No placeholder path, revision, command, or expected result remains.
- Existing cleanup contracts and tests remain independent.
- Runtime loadability is reported per actual probe; static checks remain `unknown` when no real loader runs.
