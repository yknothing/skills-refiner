# Diagnostic loop and report readability review

Date: 2026-09-11. Baseline: `3ddc8685ef11a3419d3fc6c61785dc8472494883`.
Scope: the existing panorama Markdown report, doctor error evidence, and the
panorama → hygiene/debug → refiner → recheck handoff. Changes are in the source
checkout; this review does not certify a new installed release.

## Review and changes

| Before | After | Why |
| --- | --- | --- |
| The complete identity/lifecycle table precedes gap counts | Gap counts precede per-Skill evidence; lifecycle details move to a disclosure at the end | Users can find relevant work before reading the full inventory |
| Large review and gap inventories are expanded by default | Counts and gap guidance remain visible; individual evidence expands on demand | Reduce reading effort without dropping identity variants or evidence |
| Doctor flattens parseable nonzero output into an error string | The existing error wrapper retains `partial_payload` and its failure status | Downstream review can inspect exact blockers and partial inventory without treating collection as successful |
| Optional raw terminal output appears alongside a JSON snapshot without a temporal boundary | `raw_text_observation` explicitly identifies subsequent runs; help and terminal output explain this | Different observations must not be used as one baseline |
| Handoffs stop at triage/action, with uneven verification instructions | Bind target identity, fingerprint, scope and baseline; verify the original failure condition and affected consumers | A changed scope, missing target or zero exit code does not establish repair |
| Presentation can promote security patterns, age or size to a defect | Separate confirmed findings from review signals and unknowns | Severity needs evidence beyond a heuristic category |

The workflow closes each finding as `verified`, `still_present`, `unverified`
or `regressed`. Intentional retirement has a distinct success condition: the
approved transaction and absence of dangling consumers, not restored loadability.
Existing mutation and deployment transaction requirements remain in force.

## Verification

- `test-doctor.sh`: passed. A real scanner fixture with a rejected managed
  collection preserves the collection blocker, ordinary inventory and an
  unrelated description-length blocker inside `partial_payload`. Removing only
  the deliberately invalid collection fixture and repeating the same scope
  clears its blocker while retaining the unrelated load blocker.
- Error-boundary regressions: empty, malformed, multiple-object and nonzero
  outputs retain their failure semantics; `no_data` remains dashboard-specific.
  A 200,000-character structured failed payload is retained through file-based
  `jq` input. Optional raw text explicitly reports `same_snapshot: false`.
- Panorama Node contracts: 29 passed. Panorama CLI integration: 27 passed,
  including degraded collection, private output, redaction and large stdout.
- `bash -n`, ShellCheck error-level checks and `git diff --check`: passed.
- Five Skill entrypoints: strict portable YAML parsing passed, names match
  directories, descriptions remain within 1024 characters, and linked local
  references are readable. Description lengths: refiner 464, panorama 349,
  appreciation 250, hygiene 315, debug 204.
- Gemini CLI's existing native offline parser loaded all five source entrypoints
  and returned their exact bodies. This verifies parsing/body reading only;
  configured host discovery, triggering and instruction-following are separate.

## Presentation evidence and limits

The archived panorama generated at `2026-09-10T23:32:49.653Z` contains 222 entries
and 229 identity-variant rows. Rendering that unchanged snapshot with the new
Markdown layout places gap counts at line 41, before lifecycle details. All 222
entry names remain present and all eight disclosures are balanced.

A standalone HTML design preview was initially prepared outside the repository, using
that explicitly labelled historical snapshot. It demonstrates search, priority
filtering, a list/detail layout, separate runtime predicates, and recheck
guidance. At this initial stage it was not wired into the CLI and did not execute repairs.
Its embedded data matches the source generation and its script parses.

The browser URL policy rejected the local HTML file. No alternate browser or
URL workaround was attempted. Actual browser rendering, responsive layout,
keyboard interaction and visual quality therefore remain unverified. The
preview required human review before it could be accepted as a UI implementation.

The new workflow guidance has not been validated in a fresh native model
session. The automated evidence establishes the concrete error-boundary fix,
report preservation and parser validity, not a general measured improvement in
model task outcomes. Existing global installations were not changed this round.

## Follow-up: clipping report and fixed template

The user clarified that the visible symptom is horizontal or bottom clipping,
not missing statistics or a filtered Skill count. Browser access to the existing
local-file tab was also rejected, so the exact host geometry and pixel-level
cause could not be inspected. A separate static check confirmed that the old
HTML contained no inventory rows before JavaScript ran; that is an adjacent
resilience defect, not a confirmed explanation of the reported clipping.

The source now owns `templates/report.html` and `lib/panorama-html.mjs` under
`skills/skills-panorama`. The `panorama-report.v1` template fixes typography,
color, spacing, focus treatment and information order. Container-sized automatic
columns replace viewport-dependent minimum column widths. The fixed-height
inner list and clipping panel rule were removed; long paths wrap, and runtime
facts use wrapping cards. Body content follows ordinary page scrolling.

The CLI now writes `latest.html` and optional redacted `share.html` alongside
same-generation JSON and Markdown through the existing private atomic writer.
All entries, variants, lifecycle observations and complete report JSON survive
HTML rendering. JavaScript enhances navigation and filtering; it does not build
the report body. Default scope is all entries, with an explicit matching/total
count and reset action. The current user-facing HTML file was regenerated from
the same 222-entry historical snapshot using this template.

Follow-up verification:

- 33 Node contracts passed, including complete HTML without script execution,
  stable styles across different data, full JSON equality, variant preservation,
  incomplete observations, empty states and HTML/script injection boundaries.
- 35 CLI checks passed, including HTML production output, same-generation data,
  lifecycle fields, redaction and 0600 permissions.
- Five source Skills passed strict frontmatter checks and the native offline
  parser/body-read check again; the new template/renderer references are present.
- ShellCheck error-level checks and `git diff --check` passed.

These checks do not prove browser layout or keyboard behavior. The user was
asked to refresh the updated page and confirm right/bottom reachability; that
feedback is pending. No browser-policy workaround was attempted. No native model
session, commit, publication or global installation was performed in this follow-up.

## Follow-up: standard technical wording

The user reported that some page descriptions were unnatural. The template and
shared report guidance now use concrete terms such as skill paths, Agent skill
directories, configuration and report ID. The process is labelled problem
identification, repair/optimization and result verification. Internal terms such
as identity variants and topology triage are removed from the page descriptions;
raw JSON field names and status values remain unchanged. The template instructions
record this wording convention for future reports.

Verification: all 33 existing Node contracts passed. The affected Skill's
frontmatter parsed, its description remained 349 characters, and all five local
references resolved. The native offline parser read all five source Skill bodies
exactly. The current HTML and Markdown were regenerated from the unchanged
222-entry historical snapshot; embedded JSON equality and 0600 permissions were
preserved. A visible-text check excluded raw JSON and confirmed the revised
labels and removal of the identified internal terms. `git diff --check` passed.
This wording-only follow-up did not add browser layout verification.

## Follow-up: timestamps and symlink installation paths

The user identified two misleading details: a location-specific time label, and
per-link observations presented as independent installation histories. The HTML
now formats timestamps as `YYYY-MM-DD HH:mm:ss UTC` without a host-location label.
Each file/source group shows its actual directory and upstream repository
separately, followed by installation entry paths and their explicit types and
targets. Missing upstream metadata is labelled as a missing repository record;
undeclared versions use plain text. Installation history is shown only where a
record exists, with its original path and authority, and is never copied from a
source directory to a symlink as that link's creation time.

The normalizer retains the scanner's entry type, raw link target, resolved
directory and link health in each observation's `installation` object. It does
not infer links from different-looking paths. Broken links retain an unresolved
canonical target. Full observations remain available in JSON.

Fresh read-only collection, with the same `codex,claude` selection as the earlier
page, completed at `2026-09-11T04:30:55.133Z`: 224 entries, `COMPLETE`, no collection
blockers, generation `6d6cbcb9-a66a-4ab4-aba5-a2d8d35decc4`. The current HTML,
Markdown and JSON use this generation; the prior archived snapshot is unchanged.

For `brainstorming`, direct `lstat`, `readlink` and `realpath` checks matched all
13 observed entry paths. Eleven symlinks, including Factory, share the directory
under `.agents/skills`; Claude links to the separate `superpowers` cache directory.
The two targets retain their distinct content fingerprints. The shared source
directory has installer-declared timestamps, while the Factory link has no
separate installation timestamp; neither fact is promoted to the other's scope.

Verification: the new link-preservation, timestamp and presentation assertions
first failed on the previous implementation, then all 35 Node tests passed.
All 35 CLI checks also passed. The affected Skill's frontmatter, 349-character
description and five local references passed, and the native offline parser
read all five source Skill bodies exactly. Current HTML embeds the complete fresh
JSON, includes every entry, omits the location-specific label, and all three
artifacts retain 0600 permissions. Browser layout remains unverified because of
the existing local-file URL restriction. No installation or repository publication
was performed.


## Follow-up: retracting an unsupported naming-conflict diagnosis

The previous `brainstorming` diagnosis was unsupported. The normalizer converted
multiple local targets and content fingerprints into `collision.status=conflict`
without observing a host's loading namespace or selection behavior. It also
split one physical target when source metadata was available on its real-directory
entry but absent on a symlink. A separate collection shortcut skipped the valid
installer source declaration and the HTML incorrectly described this as an
unrecorded upstream repository.

The static collector now preserves distinct records as `status=unknown`,
`assessment=inventory_only`, `confirmation=null`. Healthy symlinks sharing the
same target and fingerprint aggregate into one path-qualified identity. Repository
URL aliases are normalized for source comparison. The HTML states the observed
number of actual targets and fingerprints and says that host loading effects
remain unverified. Confirmed naming conflicts require evidence from the same
host's loading namespace; a zero confirmed count does not prove absence of
runtime conflicts.

Scanner `installer_source_claim` is a separate, additive diagnostic field. It
retains a bounded, credential-free declaration from a safely read installer
receipt, subject to current frontmatter-name matching. Skipping tree verification
does not suppress that declaration or promote it to bound provenance. Cached
Agent projections do not inherit the declaration. Existing `provenance` and
`mutation_provenance` authorization contracts remain unchanged.

Direct read-only checks found 13 `brainstorming` entry paths: the shared real
directory and 11 symlinks to it, plus the Claude symlink to a second cache target.
The two `SKILL.md` contents differ. The shared directory's Git tree hash
`f260c775073816860fef8a37c032ac77e2ff5821` matches its installer receipt, which
names `obra/superpowers` and `skills/brainstorming/SKILL.md`. The cache tree hash
`b14f49a55a8387cfa12ac89794ab79698d7fddbb` matches that checkout's Git HEAD subtree;
its remote names the same repository. These checks establish local records and
content binding, not cryptographic upstream attestation or host loading conflict.
The normal report's fast collection remains labelled `receipt_declared` because
that collection does not perform this separate manual tree check.

Verification: 38 Panorama Node tests, 179 scanner assertions, 35 CLI assertions
and 15 cleanup-core tests passed. The initial scanner test run exposed three
incorrectly scoped assertions that selected both the source and its symlink;
the assertions now select the source explicitly, and the full scanner suite
passed. The five source Skills passed strict YAML/name/description checks,
10 linked local references resolved, and the existing native offline loader
parsed all five bodies exactly. Shell syntax, ShellCheck error-level checks
and `git diff --check` passed. Host discovery/selection and browser visual
behavior remain unverified. This follow-up does not install, commit, push,
change global skills, or alter canaries.


The corrected current HTML, Markdown and JSON were regenerated from read-only
collection `6fd11d27-37ff-4436-9a5e-5fdbd08b0ba4`, generated at
`2026-09-11T05:35:16.130Z`: 224 entries, `COMPLETE`. `brainstorming` now has two
file groups, `same_source_content_difference`, and gap `暂无法判定`; the visible
text explicitly identifies the unverified host loading effect. All 13 entry
kinds, link targets and canonical paths matched direct filesystem checks.
The report's confirmed naming-conflict count is zero under this stricter
evidence rule. Full embedded JSON equality, all 224 rendered entry bodies,
private atomic replacement and 0600 permissions passed. This count is an
evidence boundary, not a claim that all hosts were tested or have no conflicts.

## Release acceptance

The user authorized completing a directly publishable version. Independent
review reproduced and closed two additional findings before publication:

- A receipt's upstream declaration was hidden by the Git remote of the storage
  repository. Direct source observations now retain the declaration and keep
  ambient Git evidence in `storage_provenance`. Matching symlink observations
  preserve their storage evidence without inheriting a receipt, revision or
  lifecycle record. Matching requires the same canonical target, nonempty
  content fingerprint and ambient repository; receipt-bound entries are excluded.
- Proven `runtime_contract` load blockers were omitted from the HTML review
  filter. The normalizer now retains their reason, path and validation method;
  the filter and next-step guidance include them. Unknown loader requirements
  remain unknown, and the directory classification remains independent.

All 40 Panorama Node contracts passed after these changes. The reviewer also
reran the three focused regressions independently and reported no remaining
blocker in the reviewed scope. All 19 shell files passed syntax and error-level
ShellCheck; the common-library mirror and native C syntax checks passed.

Five source Skills passed strict YAML/name/description validation (description
lengths 204, 315, 250, 349 and 464), all 10 Markdown local references resolved,
and the existing Gemini native offline loader returned all five exact bodies.
No canary was injected or removed.

The actual production renderer and template generated a separate 224-entry
synthetic report for browser acceptance. Chromium checks at 1440, 768, 390 and
320 CSS pixels found no horizontal overflow. Search, two-file-group detail,
empty results, reset, review and gap filters, keyboard Tab/Enter selection,
return-to-list navigation and footer reachability passed. The browser console
reported zero errors and warnings. Screenshots were visually inspected. These
results validate the shared template with synthetic data; the private real
report was not opened through an alternate browser route.

Before installation, all five existing global packages (77 files) matched the
previous published revision `3ddc8685ef11a3419d3fc6c61785dc8472494883` byte for byte.
An owner-only backup includes these packages and the installer receipt, with
archive contents verified against the pre-install hashes. The installer and
post-install byte, projection, reference and launcher checks complete the
repository-to-installation boundary separately.

The checks above do not include a fresh model-task validation. A sandboxed Claude auth check
reported `loggedIn=false`; a read-only check outside the sandbox confirmed an
authenticated session. A native model request needs separate authorization to
send automatically loaded local context to the configured external service.
Codex CLI failed configuration parsing before discovery.
Offline native body loading is recorded above; it does not establish
configured-host selection or task benefit. No unrelated global configuration
or canaries were changed. The release receipt records any later native sample,
full-suite results and final-revision CI, alongside the corresponding GitHub
Actions run for the published revision.
