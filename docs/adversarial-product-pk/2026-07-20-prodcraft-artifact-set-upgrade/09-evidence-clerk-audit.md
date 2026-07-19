# Evidence Clerk Audit

## Verdict

The evidence supports a **Proposed architecture and migration-design input**, not an implemented or qualified collection upgrade.

The current 46-to-40 set arithmetic is reproducible: 39 names have a direct `old-name -> pc-old-name` lexical pair, seven old receipt names have no such upstream basename, and `pc-requirements-engineering` has no old ProdCraft receipt basename. This is only a name-set comparison. It does not prove semantic equivalence, content continuity, or that a pair is a `renamed` rather than a `replaced` artifact.

The pinned upstream snapshot is sufficient to establish the reviewed public packaging surface and the gateway's documented resolution order. It is not sufficient to establish environment qualification, real-Agent routing, generation/digest enforcement, or transaction safety. No global Skills mutation was performed.

**Evidence Clerk promotion recommendation:** keep ADR-0004 `Proposed`. The present package may be used as architecture review input. Promotion to canonical architecture with limitations remains possible only after the claim conflicts below are corrected and the remaining role/Judge gates pass. Implementation authority, migration authority, global filesystem mutation, stable-version selection, runtime success, and context-saving claims remain blocked.

## Evidence boundary and observed snapshot

| Item | Observation | Authority and limit |
|---|---|---|
| Repository review head | branch `codex/adr-skill-control-plane`; `HEAD=8af4c408919de54442ae5f59f24576ad25317435`; `origin/main=d26690da0e62a68e77e09db6e3b91d6905f0f5fe`; ahead 1 | Current repository fact at this audit; untracked review artifacts are not part of that commit |
| External receipt | `~/.agents/.skill-lock.json` schema v3, 173 entries, SHA-256 `193a3540064e00a9b0b20444ba9a75b6d81ba18c38619508c80a8db300597900` | Installer-history evidence only; not desired deployment or current-content authority |
| Local ProdCraft receipt set | 46 entries with `source == yknothing/prodcraft`; 46 corresponding top-level real directories exist; sampled/all enumerated frontmatter names match their basenames; none records `resolvedRevision` | Current bounded `~/.agents/skills` observation; current directory bytes were not proven equal to every `skillFolderHash` |
| Other similarly named Skill | `bs-requirements-engineering` is sourced from `yknothing/better-skills`; no top-level `requirements-engineering` exists | Confirms `bs-requirements-engineering` is outside this migration; does not complete all-Agent collision inventory |
| Reviewed upstream candidate | GitHub `main` resolved to `fd05978dbbbf5a064205a695af47c8a550f1b224`; fixed tar SHA-256 `0a4a72513d15b126e6eb395b2824b347d0110407ba91972a881492bee76b5ae3` | Review pin/candidate only; not qualified or active deployment |
| Release/tag query | live GitHub API replay returned 0 releases and 0 tags, and `main` still resolved to `fd05978…` | Volatile current observation. The shared packet did not preserve API payloads, headers, or response digests, so the original historical zero-result is not independently replayable as a fixed snapshot |
| Public registry | `public-skill-registry.v1`; 40 entries; all names are `pc-*`; SHA-256 `a92cbb8bb8a69080a907cbdd35a880243380c7c49fe7d776861df45b7bd93f5b` | Canonical public packaging membership at the reviewed commit; not all authored skills, product readiness, or environment stability |
| Curated index | 40 names equal the registry names; SHA-256 `d131e66539d94b3766ca915453a7754ee2e1fb8706b8e1af42aba0ca35f99f21` | Generated install-surface corroboration; not independent authority |
| Gateway | curated `pc-prodcraft/SKILL.md` SHA-256 `e983c9fe236d03e0e53704b0381130ba6b02dc803736fde0f40eb6c9ec039982`; it documents locator/source-repo/sibling resolution and forbids searching inside its own directory | Sufficient for the static reader contract only; a real Agent did not execute it |
| Locator implementation | upstream `prodcraft-runtime-locator.v1` carries absolute path fields and the installer checks schema/name/install path/repository ownership for managed gateway operations | It does not carry or enforce ADR-0004 `generation_id`, artifact digest, per-root digest, or environment qualification |
| Targeted upstream gates | `validate_prodcraft.py --check curated-surface` passed; 25 gateway/installer unit tests passed | Static/repository contract evidence only; not a control-plane or Agent-runtime test |

The prior ADR-0003 package remains authoritative only for its explicitly bounded historical observations, including the prior Claude 46 + Factory 46 projection count. This audit did not promote that 92-link lower bound to a complete or freshly re-observed machine inventory.

## 46-to-40 mapping recomputation

### Deterministic result

```text
old ProdCraft receipt names:            46
upstream public pc-* names:             40
direct lexical basename pairs:          39
old-only basenames:                       7
new-only basenames:                       1
net public-name count change:            -6
```

Direct lexical pairs:

```text
acceptance-criteria -> pc-acceptance-criteria
accessibility -> pc-accessibility
api-design -> pc-api-design
ci-cd -> pc-ci-cd
code-review -> pc-code-review
data-modeling -> pc-data-modeling
delivery-completion -> pc-delivery-completion
deployment-strategy -> pc-deployment-strategy
documentation -> pc-documentation
domain-modeling -> pc-domain-modeling
e2e-scenario-design -> pc-e2e-scenario-design
estimation -> pc-estimation
feature-development -> pc-feature-development
incident-response -> pc-incident-response
intake -> pc-intake
monitoring-observability -> pc-monitoring-observability
observability -> pc-observability
problem-framing -> pc-problem-framing
prodcraft -> pc-prodcraft
receiving-code-review -> pc-receiving-code-review
refactoring -> pc-refactoring
release-management -> pc-release-management
retrospective -> pc-retrospective
risk-assessment -> pc-risk-assessment
runbooks -> pc-runbooks
security-audit -> pc-security-audit
security-design -> pc-security-design
spec-writing -> pc-spec-writing
sprint-planning -> pc-sprint-planning
system-design -> pc-system-design
systematic-debugging -> pc-systematic-debugging
task-breakdown -> pc-task-breakdown
task-execution -> pc-task-execution
tdd -> pc-tdd
tech-debt-management -> pc-tech-debt-management
tech-selection -> pc-tech-selection
testing-strategy -> pc-testing-strategy
user-research -> pc-user-research
verification-before-completion -> pc-verification-before-completion
```

Old-only basenames:

```text
bug-history-retrieval
compliance
feasibility-study
implementation-alignment-review
implementation-integrity-audit
internationalization
market-analysis
```

New-only public ID:

```text
pc-requirements-engineering
```

### Mapping authority boundary

- The 39 pairs are **lexical candidate pairs**, not proven rename identities.
- The seven old-only names are **set-diff old-only members**. Calling them `retired` is an Owner-approved desired disposition, not a fact declared by the pinned upstream registry.
- `pc-requirements-engineering` is **new relative to this 46-entry receipt set**. No inference may merge it with `feasibility-study`, `market-analysis`, or third-party `bs-requirements-engineering` without an explicit compatibility manifest or Owner decision.
- ADR-0004 says each member is classified as exactly one of `renamed`, `replaced`, and other states, then describes 39 members as `renamed/replaced`. That slash-form violates the exact-one rule. The plan schema must select one state per member using content/compatibility evidence, or introduce a pre-plan `lexical_candidate_pair` evidence class that carries no mutation authority.

## Current-vs-future language audit

| Location | Current wording risk | Required truth-preserving interpretation or change |
|---|---|---|
| ADR-0004 §5 | “The stored artifact contains...” reads as an existing object | This is a proposed artifact contract; no artifact store, digest, or stored artifact exists |
| ADR-0004 §6.1 | “The current 46 receipts ... are adopted as an exact local rollback snapshot” implies adoption has occurred | Change to “must be adopted during a separately approved plan/apply preparation”; no exact rollback snapshot or per-path digest manifest exists yet |
| ADR-0004 §8 | “The `gateway-only` generation contains...” reads as a materialized generation | It is a target generation shape. No generation exists and no real Agent has loaded it |
| ADR-0004 §9 | Present-tense claims that skills-refiner imports/snapshots/classifies receipt drift can read as current behavior | These are required V1 behaviors; the receipt adapter and managed CLI do not exist |
| ADR-0004 §10 | “Synchronous reconcile emits...” reads as an implemented state engine | It is a future contract; no reconciler has been observed |
| ADR-0004 §13 | “V1 includes only...” can be read as delivered capability | Prefer “the proposed V1 implementation scope is limited to...” |
| ADR-0004 §14 | The table is titled as runnable, but no ADR-0004 control-plane command currently exists | Mark gates `specified, unimplemented` until each replay command is implemented and captured |
| ADR-0004 §15 Positive | Present-tense outcomes such as “become explicit”, “remain unmodified”, “are observable”, and “cannot keep false healthy state” sound achieved | Prefix with “If implemented and the fitness gates pass...” or use future/conditional language |
| Evidence map E-06 | “Pinned upstream commit” can be mistaken for a qualified deployment pin | State “review snapshot pin and migration candidate”; qualification and activation are absent |
| ADR-0004 §2 / §15 | “No release or tag as a stronger stable anchor” overstates what absence proves | Say “no publisher release/tag signal was observed”; a tag/release is not inherently more immutable than a commit and its absence does not prove instability |

## Claim conflicts and evidence gaps

### EC4-01 — Exact-one mapping conflict

- **Severity:** High
- **Claim attacked:** 39 entries are `renamed/replaced` while every entry must have exactly one classification.
- **Evidence class:** Source conflict inside ADR-0004.
- **Resolution required:** Use lexical candidate pairs in evidence, then classify each as one state using explicit compatibility/content evidence in the immutable plan.
- **Veto:** Canonical promotion veto until wording/schema is internally consistent; mutation veto remains until identities pass.

### EC4-02 — Upstream locator support is narrower than ADR fail-closed claims

- **Severity:** High
- **Claim attacked:** the upstream `prodcraft-runtime-locator.v1` contract itself supports generation mismatch, digest mismatch, and path-escape enforcement.
- **Evidence class:** Current upstream source versus future control-plane contract.
- **Observed boundary:** upstream supplies path fields and managed-gateway ownership checks. It does not encode a generation or artifact digest. The gateway is instructions consumed by an Agent, not an observed executable locator resolver.
- **Resolution required:** attribute generation/digest/path-containment checks to a new control-plane qualification/projection validator and make them runnable; do not attribute them to the existing upstream locator or gateway.
- **Veto:** Runtime and migration authority blocked; canonical architecture requires explicit ownership of this new enforcement.

### EC4-03 — Exact curated bytes plus generated locator is an unqualified composition

- **Severity:** High
- **Claim attacked:** pairing exact curated `pc-prodcraft` bytes with a generated local locator is already an upstream-qualified global gateway configuration.
- **Evidence class:** Missing evidence.
- **Observed boundary:** the curated gateway documents locator resolution, but its metadata/distribution prose remains `curated`; upstream's global installer renders a `global` variant. Existing tests cover curated and global renderings separately, not the ADR-0004 generation composition in a real Agent.
- **Resolution required:** add a pinned composition fixture and real-Agent replay, or select and digest the upstream global-rendered gateway as the packaging profile output.
- **Veto:** `gateway-only` runtime claim blocked.

### EC4-04 — Receipt provenance does not prove current byte identity

- **Severity:** Critical for mutation
- **Claim attacked:** 46 source-matching receipts plus same-basename directories are sufficient retirement authority or an exact rollback artifact.
- **Evidence class:** Missing evidence.
- **Observed boundary:** the receipt has `skillFolderHash`, source/path/timestamps, but this audit did not prove every current tree against that hash or an adopted-snapshot digest. No complete projection inventory or raw-symlink manifest exists.
- **Resolution required:** recompute content/tree identities with a versioned algorithm, bind raw path/link state, classify mismatches as conflict, and materialize a verified rollback snapshot before approval.
- **Veto:** Global mutation and undo claims blocked.

### EC4-05 — Release/tag absence is volatile and semantically narrow

- **Severity:** Medium
- **Claim attacked:** zero releases/tags is a durable fixed-snapshot fact or proof that the commit is unstable.
- **Evidence class:** Volatile external fact plus missing preserved response.
- **Resolution required:** record exact endpoint, query time, status/headers, response digest and repository identity in the package. Use the result only as “no publisher release/tag signal observed at time T.”
- **Veto:** No stable-release claim; not by itself an architecture veto.

### EC4-06 — Registry parity is packaging evidence, not qualification

- **Severity:** High
- **Claim attacked:** registry/index parity and 40 present packages prove the artifact is stable or suitable for every Agent.
- **Evidence class:** Authority overreach.
- **Resolution required:** preserve registry as public-set authority; separately require per-member tree digests, reference closure, frontmatter/loadability, target-Agent runtime, OS/policy, and real gateway qualification.
- **Veto:** Qualification, runtime, and migration authority blocked.

## Claim-ledger draft

| ID | Claim | Label | Evidence / confidence | Validation or reversal | Must not claim yet |
|---|---|---|---|---|---|
| EC4-CL-01 | Review repository is `8af4c408…` on the stated branch, one commit ahead of `origin/main` | Fact | Direct Git observation; high | Re-run after repository movement | Uncommitted ADR-0004 files are in that commit |
| EC4-CL-02 | Current receipt is v3/173 at SHA-256 `193a3540…` | Fact, machine-bounded | Direct read/hash; high | Any receipt write invalidates it | Receipt is desired or effective state |
| EC4-CL-03 | 46 receipt entries say `source == yknothing/prodcraft`, all 46 basename paths are current real directories, and none has `resolvedRevision` | Fact, machine-bounded | Direct receipt/filesystem/frontmatter join; high | Re-run on receipt/topology change | Their current bytes match receipt hashes or form one coherent release |
| EC4-CL-04 | The reviewed fixed tar is named for `fd05978…` and has SHA-256 `0a4a7251…`; live GitHub `main` also resolved to that commit during this audit | Fact, source-bounded | Fixed tar + volatile API replay; high for reviewed bytes | Repository/API state changes; bind provider repository identity in implementation | The commit is qualified, stable, or active |
| EC4-CL-05 | Live GitHub API returned zero releases and tags | Fact, time-bounded | Direct API replay; medium because response was not preserved in the shared packet | Preserve response metadata/digest or re-query | Absence proves instability or will remain true |
| EC4-CL-06 | Registry and curated index contain the same 40 `pc-*` names and curated-surface validation passed | Fact, commit-bounded | Pinned files, hashes, validator; high | Any revision or packaging-profile change | All repo skills are public; all 40 are environment-qualified |
| EC4-CL-07 | The mapping result is 39 lexical pairs, seven old-only, one new-only | Fact, deterministic set arithmetic | Receipt names versus registry names; high | Source sets change | 39 semantic renames; seven upstream-declared retirements |
| EC4-CL-08 | The Owner intends to replace provenance-confirmed legacy ProdCraft members with the approved `pc-*` public surface | Product-owner decision | `00-evidence-map.md`; high authority | Owner reverses or narrows intent | Basename alone authorizes deletion |
| EC4-CL-09 | The pinned gateway documents locator, trusted source repository, sibling, and partial-entry modes and forbids in-directory member search | Fact, static source | Pinned gateway/doc; high | Upstream revision changes | A real Agent successfully routed; downstream gates ran |
| EC4-CL-10 | Existing locator v1 provides path/repository ownership fields but not artifact/generation digest binding | Fact, pinned source | Installer payload/assertion code; high | Upstream locator schema changes | Current upstream locator enforces ADR generation/digest rules |
| EC4-CL-11 | A control-plane validator can safely add generation/digest/path-containment enforcement around locator v1 | Hypothesis / architecture contract | No implementation; medium | Runnable negative tests and real-Agent qualification | The enforcement exists today |
| EC4-CL-12 | `gateway-only` can provide full trusted-repository routing while exposing only `pc-prodcraft` in each target Agent | Hypothesis | Static gateway supports the route in prose; no Agent evidence | Fresh-session per-Agent locator/discovery/route tests | Gateway-only works or reduces context |
| EC4-CL-13 | The proposed transaction can recover exact 46-entry pre-state or exact 40-entry post-state | Hypothesis / future contract | No journal, generation manager, kill matrix or rollback rehearsal | Phase fault injection and byte/raw-link round trip | Exact recovery is proven |
| EC4-CL-14 | ADR-0004 is currently suitable as architecture review input | Opinion / Evidence Clerk recommendation | Evidence conflicts are explicit | Judge/Owner decision after corrections | Canonical acceptance has already occurred |
| EC4-CL-15 | Migration completion, implementation readiness, environment stability, runtime success, context reduction, receipt synchronization, and independent review | Out of scope | Missing evidence / L2 declaration | Separate implementation/runtime/L3-L4 proof | Any affirmative form of these claims |

## Required replay commands

Run from `/Users/whatsup/workspace/2026/skills-refiner`. These commands are read-only. The pinned snapshot path is part of this evidence boundary.

### Repository and receipt snapshot

```zsh
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count origin/main...HEAD
git status --short --branch

shasum -a 256 /Users/whatsup/.agents/.skill-lock.json
jq '{version, skill_count:(.skills|length)}' /Users/whatsup/.agents/.skill-lock.json
jq '[.skills | to_entries[] | select(.value.source == "yknothing/prodcraft")] | {count:length, with_resolved_revision:(map(select(.value.resolvedRevision != null))|length)}' /Users/whatsup/.agents/.skill-lock.json
```

### Exact set diff

```zsh
UP=/private/tmp/prodcraft-upstream-audit-20260720-fd05978/prodcraft-fd05978dbbbf5a064205a695af47c8a550f1b224
LOCK=/Users/whatsup/.agents/.skill-lock.json
REG="$UP/schemas/distribution/public-skill-registry.json"

comm -12 \
  <(jq -r '.skills | to_entries[] | select(.value.source == "yknothing/prodcraft") | .key' "$LOCK" | sort -u) \
  <(jq -r '.public_skills[].name | sub("^pc-"; "")' "$REG" | sort -u)

comm -23 \
  <(jq -r '.skills | to_entries[] | select(.value.source == "yknothing/prodcraft") | .key' "$LOCK" | sort -u) \
  <(jq -r '.public_skills[].name | sub("^pc-"; "")' "$REG" | sort -u)

comm -13 \
  <(jq -r '.skills | to_entries[] | select(.value.source == "yknothing/prodcraft") | .key' "$LOCK" | sort -u) \
  <(jq -r '.public_skills[].name | sub("^pc-"; "")' "$REG" | sort -u)
```

Expected line counts are `39`, `7`, and `1` respectively.

### Fixed snapshot, registry, index, and gateway

```zsh
UP=/private/tmp/prodcraft-upstream-audit-20260720-fd05978/prodcraft-fd05978dbbbf5a064205a695af47c8a550f1b224
TAR=/private/tmp/prodcraft-upstream-audit-20260720-fd05978/prodcraft.tar.gz

shasum -a 256 \
  "$TAR" \
  "$UP/schemas/distribution/public-skill-registry.json" \
  "$UP/skills/.curated/index.json" \
  "$UP/skills/.curated/pc-prodcraft/SKILL.md" \
  "$UP/docs/distribution/npx-skills-compat.md"

diff -u \
  <(jq -r '.public_skills[].name' "$UP/schemas/distribution/public-skill-registry.json" | sort) \
  <(jq -r '.skills[].name' "$UP/skills/.curated/index.json" | sort)

rg -n 'prodcraft-runtime.json|canonical_repo_root|sibling skill packages|Do not search for downstream skills inside' \
  "$UP/skills/.curated/pc-prodcraft/SKILL.md" \
  "$UP/docs/distribution/npx-skills-compat.md" \
  "$UP/scripts/install_prodcraft_global_skill.py"

PYTHONDONTWRITEBYTECODE=1 /Users/whatsup/miniconda3/bin/python3 \
  "$UP/scripts/validate_prodcraft.py" --check curated-surface

cd "$UP"
PYTHONDONTWRITEBYTECODE=1 /Users/whatsup/miniconda3/bin/python3 -m unittest \
  tests.test_prodcraft_gateway_locator_contract \
  tests.test_install_prodcraft_global_skill
```

The default `/usr/bin/python3` on this machine did not have `yaml`; using it produced `ModuleNotFoundError: No module named 'yaml'`. The replay command therefore names the interpreter that passed in this audit.

### Volatile GitHub release/tag/main check

```zsh
env -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY \
  curl -fsS 'https://api.github.com/repos/yknothing/prodcraft/releases?per_page=100' \
  | jq '{count:length, values:[.[].tag_name]}'

env -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY \
  curl -fsS 'https://api.github.com/repos/yknothing/prodcraft/tags?per_page=100' \
  | jq '{count:length, values:[.[].name]}'

env -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY \
  curl -fsS 'https://api.github.com/repos/yknothing/prodcraft/commits/main' \
  | jq '{sha, html_url, tree_sha:.commit.tree.sha, committer_date:.commit.committer.date}'
```

For final acceptance, preserve the status/headers, observation time, response bytes and digest in a task-scoped evidence record. A later replay cannot prove what the API returned during an earlier review window.

## Forbidden claims

- ProdCraft has been migrated, installed as an artifact set, or activated under a managed generation.
- ADR-0004's store, planner, reconciler, projection manager, journal, managed CLI, repair, apply, or undo behavior exists.
- The reviewed commit is an upstream stable release, universally stable, environment-qualified, or approved for activation.
- Zero tags/releases proves the repository or commit is unstable, or will remain zero.
- The 39 lexical pairs are proven semantic renames or byte-equivalent replacements.
- The seven old-only names are upstream-declared retirements; their retirement is an Owner disposition subject to identity gates.
- `pc-requirements-engineering` replaces or merges any particular old-only member, or is related to `bs-requirements-engineering`.
- Receipt source plus basename is deletion authority, or all current trees match their receipt hashes.
- An exact 46-entry rollback snapshot, complete projection inventory, or byte-for-byte undo proof exists.
- The existing upstream locator enforces generation, artifact digest, qualification, or all ADR path-containment rules.
- Exact curated gateway bytes plus a generated locator are already qualified as the global runtime composition.
- `gateway-only` works in any real Agent, ran downstream ProdCraft gates, or exposes only one metadata entry in every Agent.
- Context/discovery cost has been reduced or measured.
- Registry membership proves all authored skills, maturity, security, runtime loadability, or target-environment compatibility.
- `.skill-lock.json` is synchronized with managed desired/active state.
- The historical 92-link lower bound is a complete or fresh machine-global projection inventory.
- The L2 package is independent, external, market-validated, implementation acceptance, or migration acceptance.

## Promotion ceiling

| Surface | Current ceiling |
|---|---|
| Evidence package | Review input with the conflicts and replay boundaries in this audit |
| ADR-0004 status | `Proposed` |
| Canonical architecture | Blocked now; at most `canonical architecture with limitations` after claim corrections, severe-objection handling, Judge decision, and Owner approval |
| Implementation planning | Separate planning input allowed; no authority to implement global mutation |
| Upstream candidate | Review-pinned candidate only |
| Environment qualification | Blocked |
| Real-Agent gateway/runtime claim | Blocked |
| Global Skills mutation / 46-to-40 apply | Blocked |
| Exact rollback / transaction reliability | Blocked |
| Context-saving claim | Blocked |
| Independent/external wording | Blocked at L2 |
