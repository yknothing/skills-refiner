#!/usr/bin/env bash
# skill-scan.sh — Agent Skills fact collector for AI-driven hygiene analysis
#
# Collects structured data about installed skills. Does NOT score or judge.
# The AI reads this output and applies expert judgment.
#
# Usage:
#   bash skill-scan.sh                    # Full scan, table + JSON output
#   bash skill-scan.sh --stale-days 365   # Custom staleness threshold
#   bash skill-scan.sh --json             # JSON to stdout only

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Governance skills are independently installable, so each executable skill
# ships the same runtime helper inside its own directory. The installed-layout
# contract test keeps the mirrored copies byte-identical.
COMMON_SH="$SCRIPT_DIR/../lib/common.sh"
[ -f "$COMMON_SH" ] || { echo "[ERROR] Missing shared helper: $COMMON_SH" >&2; exit 1; }
# shellcheck source=../lib/common.sh
. "$COMMON_SH"
sr_require_sha256 || exit $?

# ── Config ────────────────────────────────────────────────────────────
detect_home_dir() {
    sr_detect_home_dir
}

STALE_DAYS=180
JSON_ONLY=false
NO_WRITE=false
SKIP_PROVENANCE_TREE=false
MAX_DESCRIPTION_LENGTH=1024
SKILL_LOCK_SCHEMA_VERSION=3
MAX_SKILL_LOCK_BYTES=1048576
# Bound installer tree hashing so one oversized skill (docs/assets) cannot stall the
# whole inventory. Small receipt-backed fixtures remain fully verified.
MAX_PROVENANCE_TREE_FILES=400
PROVENANCE_GIT_TMP=""
PROVENANCE_RECEIPT_TMP=""
GIT_TREE_HASH_RESULT=""
MUTATION_PROVENANCE_JSON=""
INSTALLER_SOURCE_CLAIM_JSON="null"
SCAN_CONTENT_CACHE_DIR=""
SCAN_CONTENT_CACHE_HITS_FILE=""

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Parse Args ────────────────────────────────────────────────────────
show_help() {
    echo "skill-scan.sh — Agent Skills fact collector for AI-driven hygiene analysis"
    echo ""
    echo "Usage:"
    echo "  bash skill-scan.sh                    # Full scan, table + JSON output"
    echo "  bash skill-scan.sh --stale-days 365   # Custom staleness threshold"
    echo "  bash skill-scan.sh --json             # JSON to stdout only"
    echo "  bash skill-scan.sh --no-write         # Terminal report without writing JSON"
    echo "  bash skill-scan.sh --skip-provenance-tree  # Skip git tree hashing for receipts"
    echo ""
    echo "Options:"
    echo "  --stale-days N   Override stale threshold (default: 180 days)"
    echo "  --json           Output JSON to stdout only (no report file)"
    echo "  --no-write       Do not write ~/.agents/skills-report/scan-*.json"
    echo "  --skip-provenance-tree  Skip git write-tree provenance (faster inventory)"
    echo "  --help, -h       Show this help message"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --stale-days)
            if [ -z "${2:-}" ] || ! echo "$2" | grep -Eq '^[0-9]+$'; then
                echo "[ERROR] --stale-days requires a non-negative integer" >&2
                exit 2
            fi
            STALE_DAYS="$2"
            shift 2
            ;;
        --json) JSON_ONLY=true; shift ;;
        --no-write) NO_WRITE=true; shift ;;
        --skip-provenance-tree) SKIP_PROVENANCE_TREE=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "[ERROR] Unknown option: $1" >&2; exit 2 ;;
    esac
done

HOME_DIR="$(detect_home_dir)" || {
    echo "[ERROR] Unable to determine home directory. Set HOME and retry." >&2
    exit 2
}
REPORT_DIR="$HOME_DIR/.agents/skills-report"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
REPORT_JSON="$REPORT_DIR/scan-$TIMESTAMP.json"

# Agent-recognized directories to scan. These are active consumption surfaces,
# not arbitrary workspace/project directories.
AGENT_DIRS=()
while IFS= read -r _skill_dir; do
    AGENT_DIRS+=("$HOME_DIR/$_skill_dir")
done < <(sr_agent_skill_dirs "$HOME_DIR")

# ── Helpers ───────────────────────────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
    echo "[ERROR] jq is required for JSON output and aggregation. Install jq and retry." >&2
    exit 127
fi
if ! command -v base64 >/dev/null 2>&1; then
    echo "[ERROR] base64 is required for byte-preserving symlink identity. Install base64 and retry." >&2
    exit 127
fi

COLLECTION_INDEX_NODE="${SKILLS_REFINER_NODE_BIN:-node}"
COLLECTION_INDEX_LIB_DIR="$SCRIPT_DIR/../lib"

is_managed_collection_root() {
    case "$1" in
        prodcraft|better-skills|loopos|langcraft) return 0 ;;
        *) return 1 ;;
    esac
}

# Validate only controller-owned collection roots. An arbitrary top-level
# INDEX.json is data, not authority to make nested directories active Skills.
# The existing collection contracts own schema/source/member validation; this
# read-only adapter additionally binds every declared deployed path to its
# current tree digest before the scanner enumerates a member.
validate_managed_collection_index() {
    local collection_root="$1" collection_id="$2"
    if ! command -v "$COLLECTION_INDEX_NODE" >/dev/null 2>&1; then
        jq -n --arg collection_id "$collection_id" \
            --arg index_path "$collection_root/INDEX.json" \
            '{status:"blocked", collection_id:$collection_id, index_path:$index_path,
              error_code:"collection_index_validator_unavailable",
              diagnostic:"Node.js is required to validate a managed collection INDEX.json"}'
        return 1
    fi

    "$COLLECTION_INDEX_NODE" --input-type=module - \
        "$collection_root" "$collection_id" "$COLLECTION_INDEX_LIB_DIR" <<'NODE'
import { createHash } from 'node:crypto';
import {
  lstatSync, readFileSync, readdirSync, realpathSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [collectionRoot, expectedCollectionId, libraryDirectory] = process.argv.slice(2);
const indexPath = join(collectionRoot, 'INDEX.json');
const recognized = new Set(['prodcraft', 'better-skills', 'loopos', 'langcraft']);

function blocked(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function requiredStatus(path, code, message) {
  try {
    return lstatSync(path);
  } catch {
    blocked(code, message);
  }
}

try {
  if (!recognized.has(expectedCollectionId) || basename(collectionRoot) !== expectedCollectionId
      || !isAbsolute(collectionRoot)) {
    blocked('collection_index_identity_invalid', 'collection root identity is not controller-owned');
  }

  const rootStatus = requiredStatus(
    collectionRoot, 'collection_index_root_missing', 'managed collection root disappeared during validation',
  );
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()
      || realpathSync(collectionRoot) !== collectionRoot) {
    blocked('collection_index_root_unsafe', 'managed collection root must be a canonical real directory');
  }
  const indexStatus = requiredStatus(
    indexPath, 'collection_index_missing', 'controller-owned collection root is missing INDEX.json',
  );
  if (!indexStatus.isFile() || indexStatus.isSymbolicLink() || indexStatus.size < 2
      || indexStatus.size > 1024 * 1024) {
    blocked('collection_index_file_unsafe', 'INDEX.json must be a bounded real file');
  }

  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (error) {
    blocked('collection_index_json_invalid', `cannot parse INDEX.json: ${error.message}`);
  }

  const contractUrl = pathToFileURL(join(
    libraryDirectory,
    expectedCollectionId === 'prodcraft' ? 'collection-contract.mjs' : 'managed-collection-contract.mjs',
  )).href;
  const contract = await import(contractUrl);
  try {
    if (expectedCollectionId === 'prodcraft') contract.validateCollectionIndex(index);
    else contract.validateManagedIndex(index);
  } catch (error) {
    blocked('collection_index_contract_invalid', error.message);
  }
  if (index.collection_id !== expectedCollectionId) {
    blocked('collection_index_identity_invalid', 'INDEX.json collection_id does not match its root');
  }

  const { computeTreeDigest } = await import(pathToFileURL(join(libraryDirectory, 'collection-tree.mjs')).href);
  let matchedProfile = null;
  if (expectedCollectionId !== 'prodcraft') {
    const { collectionSpec } = await import(pathToFileURL(join(libraryDirectory, 'collection-specs.mjs')).href);
    const spec = collectionSpec(expectedCollectionId);
    matchedProfile = spec.memberProfiles.find((profile) => profile.length === index.members.length
      && profile.every((member, position) => member.name === index.members[position].name
        && index.members[position].relative_path === member.name));
    if (!matchedProfile) blocked('collection_index_source_mapping_invalid', 'members do not match an authoritative source_path profile');
  }

  const ignoredBasenames = index.schema_version === 'skills-refiner.managed-collection.index.v2'
    ? ['.DS_Store'] : [];
  const members = [];
  const seenNames = new Set();
  const seenRelativePaths = new Set();
  for (const [position, member] of index.members.entries()) {
    if (seenNames.has(member.name) || seenRelativePaths.has(member.relative_path)) {
      blocked('collection_index_member_duplicate', 'INDEX.json contains duplicate member identities');
    }
    seenNames.add(member.name);
    seenRelativePaths.add(member.relative_path);
    if (member.relative_path !== member.name || member.relative_path.includes('/')
        || member.relative_path === '.' || member.relative_path === '..') {
      blocked('collection_index_relative_path_invalid', `member relative_path is not a direct canonical child: ${member.name}`);
    }
    const memberRoot = join(collectionRoot, member.relative_path);
    const memberStatus = requiredStatus(
      memberRoot, 'collection_index_member_missing', `declared member is missing: ${member.name}`,
    );
    if (!memberStatus.isDirectory() || memberStatus.isSymbolicLink()
        || realpathSync(memberRoot) !== memberRoot) {
      blocked('collection_index_member_unsafe', `member is not a canonical real directory: ${member.name}`);
    }
    const skillPath = join(memberRoot, 'SKILL.md');
    const skillStatus = requiredStatus(
      skillPath, 'collection_index_member_skill_invalid', `member SKILL.md is missing or unsafe: ${member.name}`,
    );
    if (!skillStatus.isFile() || skillStatus.isSymbolicLink()) {
      blocked('collection_index_member_skill_invalid', `member SKILL.md is missing or unsafe: ${member.name}`);
    }
    const observedTreeDigest = computeTreeDigest(
      memberRoot,
      (code, message) => blocked(`collection_index_${code}`, message),
      { ignoredBasenames },
    );
    if (observedTreeDigest !== member.tree_digest) {
      blocked('collection_index_member_tree_drift', `member tree digest does not match INDEX.json: ${member.name}`);
    }
    members.push({
      name: member.name,
      source_provider: index.source.provider,
      repository_id: index.source.repository_id,
      resolved_revision: index.source.resolved_revision,
      source_path: expectedCollectionId === 'prodcraft'
        ? `skills/.curated/${member.name}` : matchedProfile[position].sourcePath,
      relative_path: member.relative_path,
      tree_digest: member.tree_digest,
      observed_tree_digest: observedTreeDigest,
    });
  }

  const expectedTopLevel = new Set(['INDEX.json', ...members.map(({ relative_path: memberPath }) => memberPath)]);
  for (const resource of index.resources ?? []) expectedTopLevel.add(resource.relative_path.split('/')[0]);
  for (const entry of readdirSync(collectionRoot)) {
    // Both collection controllers explicitly treat root-level Finder metadata
    // as non-authoritative. Member-tree hashing remains schema-specific below.
    if (entry === '.DS_Store') continue;
    if (!expectedTopLevel.has(entry)) {
      blocked('collection_index_unexpected_entry', `undeclared collection entry: ${entry}`);
    }
  }
  for (const expected of expectedTopLevel) {
    if (!readdirSync(collectionRoot).includes(expected)) {
      blocked('collection_index_missing_entry', `declared collection entry is missing: ${expected}`);
    }
  }

  for (const resource of index.resources ?? []) {
    const resourcePath = join(collectionRoot, resource.relative_path);
    const rel = relative(collectionRoot, resourcePath);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      blocked('collection_index_resource_path_invalid', `resource escapes collection root: ${resource.relative_path}`);
    }
    const status = requiredStatus(
      resourcePath, 'collection_index_resource_missing', `declared resource is missing: ${resource.relative_path}`,
    );
    let observedDigest;
    if (status.isSymbolicLink()) {
      blocked('collection_index_resource_unsafe', `resource is a symlink: ${resource.relative_path}`);
    } else if (status.isDirectory()) {
      observedDigest = computeTreeDigest(
        resourcePath,
        (code, message) => blocked(`collection_index_${code}`, message),
        { ignoredBasenames },
      );
    } else if (status.isFile()) {
      observedDigest = sha256(Buffer.concat([
        Buffer.from(`f\0${status.mode & 0o777}\0${status.size}\0`),
        readFileSync(resourcePath), Buffer.from('\0'),
      ]));
    } else {
      blocked('collection_index_resource_unsafe', `resource has an unsupported type: ${resource.relative_path}`);
    }
    if (observedDigest !== resource.tree_digest) {
      blocked('collection_index_resource_tree_drift', `resource tree digest does not match INDEX.json: ${resource.relative_path}`);
    }
  }

  const locatorDigest = expectedCollectionId === 'prodcraft'
    ? index.gateway.locator_digest : index.exposure.locator_digest;
  if (locatorDigest !== null) {
    const gatewayName = expectedCollectionId === 'prodcraft' ? index.gateway.name : index.exposure.name;
    const locatorName = expectedCollectionId === 'prodcraft'
      ? 'prodcraft-runtime.json' : `${expectedCollectionId}-runtime.json`;
    const locatorPath = join(collectionRoot, gatewayName, locatorName);
    const locatorStatus = requiredStatus(
      locatorPath, 'collection_index_locator_drift', 'gateway locator is missing',
    );
    if (!locatorStatus.isFile() || locatorStatus.isSymbolicLink()
        || sha256(readFileSync(locatorPath)) !== locatorDigest) {
      blocked('collection_index_locator_drift', 'gateway locator does not match INDEX.json');
    }
  }

  process.stdout.write(`${JSON.stringify({
    status: 'valid', collection_id: expectedCollectionId, index_path: indexPath, members,
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: 'blocked',
    collection_id: expectedCollectionId ?? null,
    index_path: indexPath,
    error_code: error?.code ?? 'collection_index_validation_failed',
    diagnostic: error?.message ?? 'managed collection INDEX.json validation failed',
  })}\n`);
  process.exitCode = 1;
}
NODE
}

get_frontmatter() {
    local file="$1" key="$2"
    sr_get_frontmatter_field "$file" "$key"
}

get_frontmatter_text() {
    local file="$1" key="$2"
    sr_get_frontmatter_text "$file" "$key"
}

utf8_byte_length() {
    LC_ALL=C printf '%s' "$1" | wc -c | tr -d ' '
}

utf8_codepoint_length() {
    LC_ALL=C printf '%s' "$1" | LC_ALL=C od -An -v -tu1 | LC_ALL=C awk '
        {
            for (i = 1; i <= NF; i++) {
                byte=$i + 0
                if (invalid) continue
                if (expected > 0) {
                    if (byte < next_min || byte > next_max) {
                        invalid=1
                        continue
                    }
                    expected--
                    next_min=128
                    next_max=191
                    continue
                }
                if (byte <= 127) {
                    count++
                } else if (byte >= 194 && byte <= 223) {
                    count++; expected=1; next_min=128; next_max=191
                } else if (byte == 224) {
                    count++; expected=2; next_min=160; next_max=191
                } else if (byte >= 225 && byte <= 236) {
                    count++; expected=2; next_min=128; next_max=191
                } else if (byte == 237) {
                    count++; expected=2; next_min=128; next_max=159
                } else if (byte >= 238 && byte <= 239) {
                    count++; expected=2; next_min=128; next_max=191
                } else if (byte == 240) {
                    count++; expected=3; next_min=144; next_max=191
                } else if (byte >= 241 && byte <= 243) {
                    count++; expected=3; next_min=128; next_max=191
                } else if (byte == 244) {
                    count++; expected=3; next_min=128; next_max=143
                } else {
                    invalid=1
                }
            }
        }
        END {
            if (invalid || expected != 0) exit 1
            print count + 0
        }
    '
}

frontmatter_scalar_kind() {
    local file="$1" key="$2"
    LC_ALL=C awk -v key="$key" '
        function top_key(line, raw, first, last) {
            if (line ~ /^[[:space:]]/ || line !~ /:/) return ""
            raw=line
            sub(/:.*/, "", raw)
            sub(/[[:space:]]+$/, "", raw)
            first=substr(raw, 1, 1)
            last=substr(raw, length(raw), 1)
            if ((first == "\"" && last == "\"") || (first == "\047" && last == "\047")) {
                raw=substr(raw, 2, length(raw) - 2)
            }
            return raw
        }
        {
            line=$0
            sub(/\r$/, "", line)
            if (NR == 1 && substr(line, 1, 3) == "\357\273\277") line=substr(line, 4)
        }
        NR == 1 && line ~ /^---[[:space:]]*$/ { in_fm=1; next }
        in_fm && line ~ /^---[[:space:]]*$/ { in_fm=0; closed=1; next }
        in_fm && top_key(line) == key {
            seen++
            value=line
            sub(/^[^:]*:[[:space:]]*/, "", value)
            sub(/[[:space:]]+$/, "", value)
            first=substr(value, 1, 1)
            if (value == "") kind="empty"
            else if (value ~ /^[|>][+-]?$/) kind="block"
            else if (first == "\"" || first == "\047") kind="quoted"
            else if (value ~ /[#&*!|>{}\[\]]/ || value ~ /:[[:space:]]/) kind="complex"
            else kind="plain-simple"
        }
        END {
            if (!closed || seen == 0) print "unobserved"
            else if (seen > 1) print "complex"
            else print kind
        }
    ' "$file" 2>/dev/null
}

# Extract only active @file references from prose. Markdown fenced examples and
# inline-code examples are documentation, not loader directives; treating them
# as dependencies creates false broken-reference findings (for example a skill
# explaining why `@missing/example.md` is a bad pattern).
extract_active_at_refs() {
    local file="$1"
    LC_ALL=C awk '
        /^[[:space:]]*(```|~~~)/ { in_fence = !in_fence; next }
        !in_fence {
            line = $0
            while (match(line, /`[^`]*`/)) {
                line = substr(line, 1, RSTART - 1) substr(line, RSTART + RLENGTH)
            }
            print line
        }
    ' "$file" 2>/dev/null |
        grep -oE '@[a-zA-Z0-9_./-]+\.(md|sh|py|js)' || true
}

get_metadata_value() {
    local file="$1" key="$2"
    sr_get_metadata_value "$file" "$key"
}

frontmatter_keys_json() {
    local file="$1"
    sr_frontmatter_keys_json "$file"
}

frontmatter_list_json() {
    local file="$1" key="$2"
    sr_frontmatter_list_json "$file" "$key"
}

hook_events_json() {
    local file="$1"
    sr_hook_events_json "$file"
}

yaml_section_scalar() {
    local file="$1" section="$2" key="$3"
    awk -v section="$section" -v key="$key" '
        $0 ~ "^" section ":[[:space:]]*$" { in_section=1; next }
        in_section && $0 ~ /^[^[:space:]]/ { exit }
        in_section && $0 ~ "^[[:space:]]+" key ":[[:space:]]*" {
            sub("^[[:space:]]+" key ":[[:space:]]*", "")
            gsub(/^['\''\"]|['\''\"]$/, "")
            print
            exit
        }
    ' "$file" 2>/dev/null | head -c 300
}

yaml_sequence_count() {
    local file="$1" key="$2"
    awk -v key="$key" '
        $0 ~ "^[[:space:]]*" key ":[[:space:]]*$" { in_seq=1; next }
        in_seq && $0 ~ /^[^[:space:]]/ { exit }
        in_seq && $0 ~ /^[[:space:]]*-[[:space:]]*/ { count++ }
        END { print count + 0 }
    ' "$file" 2>/dev/null
}

count_content_words() {
    awk '
        NR == 1 && $0 == "---" { in_fm=1; next }
        in_fm && $0 == "---" { in_fm=0; next }
        !in_fm { print }
    ' "$1" 2>/dev/null | wc -w | tr -d ' '
}

get_mtime() {
    # GNU stat first, then BSD/macOS stat.
    stat -c "%Y" "$1" 2>/dev/null || stat -f "%m" "$1" 2>/dev/null || echo 0
}

iso_from_epoch() {
    local epoch="$1"
    date -u -r "$epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo ""
}

hash_file() {
    local file="$1"
    sr_hash_skill_file "$file"
}

git_root_for_dir() {
    local dir="$1"
    command -v git >/dev/null 2>&1 || return 0
    git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true
}

sanitize_git_remote() {
    local remote="$1" rest authority host path scheme
    [ -n "$remote" ] && [ "${#remote}" -le 2048 ] || return 0
    if printf '%s' "$remote" | LC_ALL=C grep -q '[[:cntrl:]]'; then
        return 0
    fi

    # Query strings, fragments and userinfo are never provenance. Accept only
    # repository paths on an explicit public-forge allowlist; private hosts,
    # local paths, custom ports and other schemes collapse to no source URL.
    remote="${remote%%\#*}"
    remote="${remote%%\?*}"
    case "$remote" in
        *://*)
            scheme="${remote%%://*}"
            case "$scheme" in http|https|ssh|git) ;; *) return 0 ;; esac
            rest="${remote#*://}"
            [ "$rest" != "${rest%%/*}" ] || return 0
            authority="${rest%%/*}"
            path="${rest#*/}"
            host="${authority##*@}"
            case "$host" in *:*) return 0 ;; esac
            ;;
        *:*)
            authority="${remote%%:*}"
            path="${remote#*:}"
            host="${authority##*@}"
            ;;
        *) return 0 ;;
    esac
    host=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')
    case "$host" in
        github.com|gitlab.com|bitbucket.org|codeberg.org) ;;
        *) return 0 ;;
    esac
    [ -n "$path" ] && [ "${#path}" -le 1024 ] || return 0
    if ! printf '%s' "$path" | LC_ALL=C grep -Eq '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)+$'; then
        return 0
    fi
    case "/$path/" in *'/../'*|*'/./'*|*'//'*) return 0 ;; esac
    printf 'https://%s/%s\n' "$host" "$path"
}

git_remote_for_root() {
    local root="$1" raw_remote
    [ -z "$root" ] && return 0
    raw_remote=$(git -C "$root" config --get remote.origin.url 2>/dev/null || true)
    sanitize_git_remote "$raw_remote"
}

repository_id_for_source_url() {
    local source_url="$1" identity
    [ -n "$source_url" ] || return 0
    identity="${source_url#https://}"
    identity="${identity%.git}"
    printf '%s\n' "$identity"
}

installer_source_claim_from_receipt() {
    local entry_name="$1" receipt_snapshot="$2"
    local source source_owner source_repository source_url skill_path source_path
    INSTALLER_SOURCE_CLAIM_JSON="null"

    [ -n "$entry_name" ] && [ -f "$receipt_snapshot" ] || return
    # Validate the original JSON strings before command substitution so even
    # NUL bytes cannot be silently discarded by Bash before this gate.
    jq -e --arg skill "$entry_name" '
        [.skills[$skill].source,
         .skills[$skill].sourceUrl,
         .skills[$skill].skillPath]
        | all(type == "string"
              and (explode | all(. >= 32 and . != 127)))
    ' "$receipt_snapshot" >/dev/null 2>&1 || return
    source=$(jq -r --arg skill "$entry_name" '.skills[$skill].source // ""' \
        "$receipt_snapshot" 2>/dev/null || true)
    source_url=$(jq -r --arg skill "$entry_name" '.skills[$skill].sourceUrl // ""' \
        "$receipt_snapshot" 2>/dev/null || true)
    skill_path=$(jq -r --arg skill "$entry_name" '.skills[$skill].skillPath // ""' \
        "$receipt_snapshot" 2>/dev/null || true)

    # Installer receipts are claims, not upstream attestations. Promote only a
    # bounded, credential-free GitHub identity whose redundant fields agree.
    # The immutable revision intentionally remains null because skills v3
    # receipts do not record one.
    [ "${#source}" -le 1024 ] \
        && printf '%s' "$source" | LC_ALL=C grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' \
        || return
    source_owner="${source%%/*}"
    source_repository="${source#*/}"
    case "$source_owner" in .|..) return ;; esac
    case "$source_repository" in .|..|*.git) return ;; esac
    case "$source_url" in
        "https://github.com/${source}"|"https://github.com/${source}.git") ;;
        *) return ;;
    esac
    [ "${#skill_path}" -le 2048 ] || return
    case "$skill_path" in
        SKILL.md) source_path="." ;;
        */SKILL.md) source_path="${skill_path%/SKILL.md}" ;;
        *) return ;;
    esac
    if [ "$source_path" != "." ]; then
        printf '%s' "$source_path" | LC_ALL=C \
            grep -Eq '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$' || return
        case "/$source_path/" in *'/../'*|*'/./'*|*'//'*) return ;; esac
    fi

    INSTALLER_SOURCE_CLAIM_JSON=$(jq -n \
        --arg source_url "https://github.com/${source}.git" \
        --arg repository_id "$source" \
        --arg source_path "$source_path" \
        '{source_url:$source_url,
          source_provider:"github",
          repository_id:$repository_id,
          source_path:$source_path,
          resolved_revision:null,
          claim_kind:"installer_receipt_claim",
          git_root:"",
          git_branch:"",
          confidence:"receipt_bound"}')
}

git_source_path_for_dir() {
    local root="$1" dir="$2"
    [ -n "$root" ] || return 0
    if [ "$dir" = "$root" ]; then
        printf '.\n'
    elif [[ "$dir" == "$root/"* ]]; then
        printf '%s\n' "${dir#"$root/"}"
    fi
}

git_branch_for_root() {
    local root="$1"
    [ -z "$root" ] && return 0
    git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || true
}

source_kind_for_entry() {
    local location="$1" entry_type="$2" discovery_depth="${3:-1}"
    if [ "$entry_type" = "symlink" ]; then
        echo "symlink_distribution"
    elif [ "$location" = ".agents/skills" ] && [ "$discovery_depth" -gt 1 ]; then
        echo "canonical_collection_member"
    elif [ "$location" = ".agents/skills" ]; then
        echo "canonical_global"
    else
        echo "native_agent"
    fi
}

append_risk_finding() {
    local findings="$1" detector_id="$2" subtype="$3" canonical_skill_file="$4"
    local line_number="$5" context_kind="$6" execution_scope="$7" preview="$8" snippet="$9"
    local snippet_sha256
    snippet_sha256=$(sr_hash_string "$snippet") || return 1
    jq -c \
        --arg detector_id "$detector_id" \
        --arg subtype "$subtype" \
        --arg canonical_skill_file "$canonical_skill_file" \
        --argjson line "$line_number" \
        --arg context_kind "$context_kind" \
        --arg execution_scope "$execution_scope" \
        --arg redacted_preview "$preview" \
        --arg snippet_sha256 "$snippet_sha256" \
        '. + [{
            id: $detector_id,
            detector_id: $detector_id,
            subtype: $subtype,
            severity: "review_required",
            canonical_skill_file: $canonical_skill_file,
            line: $line,
            context_kind: $context_kind,
            execution_scope: $execution_scope,
            redacted_preview: $redacted_preview,
            snippet_sha256: $snippet_sha256
        }]' <<< "$findings"
}

# Return structured, redacted review signals. Detection intentionally avoids
# path/name allowlists: a finding is bound to detector + line + content hash.
collect_risk_indicators() {
    local skill_file="$1" canonical_skill_file="$2"
    local findings='[]' line command_line line_number=0 lower rhs normalized variable
    local pipe_to_shell_re dangerous_root_re privileged_re secret_assignment_re
    pipe_to_shell_re="(cu""rl|wge""t)[[:space:][:graph:]]*[|][[:space:]]*(ba""sh|sh)"
    dangerous_root_re="r""m[[:space:]]+-r""f[[:space:]]+/([[:space:]]|$)"
    privileged_re="su""do[[:space:]]+"
    secret_assignment_re='(API_KEY|TOKEN|SECRET)[[:space:]]*=[[:space:]]*'

    while IFS= read -r line || [ -n "$line" ]; do
        line_number=$((line_number + 1))
        # Most SKILL.md lines cannot match any detector. Keep that overwhelmingly
        # common path inside Bash instead of spawning several grep processes per
        # line; large skills distributed across many agent roots otherwise turn
        # one inventory into hundreds of thousands of short-lived subprocesses.
        case "$line" in
            *curl*|*wget*|*rm*|*sudo*|*API_KEY*|*TOKEN*|*SECRET*) ;;
            *) continue ;;
        esac
        command_line="${line//\`/}"
        if printf '%s\n' "$command_line" | grep -qE "$pipe_to_shell_re"; then
            findings=$(append_risk_finding "$findings" "pipe_to_shell" \
                "supply_chain_remote_exec" "$canonical_skill_file" "$line_number" \
                "command" "local" "remote download piped to a shell" "$line") || return 1
        fi
        if printf '%s\n' "$command_line" | grep -qE "$dangerous_root_re"; then
            findings=$(append_risk_finding "$findings" "destructive_root" \
                "recursive_root_deletion" "$canonical_skill_file" "$line_number" \
                "command" "local" "recursive deletion targets the filesystem root" "$line") || return 1
        fi
        if printf '%s\n' "$command_line" | grep -qE "$privileged_re"; then
            local privileged_subtype="privileged_operation" privileged_scope="local"
            if printf '%s\n' "$command_line" | grep -qE '(^|[[:space:]])ssh[[:space:]].*su''do[[:space:]]+'; then
                privileged_subtype="remote_operation"
                privileged_scope="remote"
            elif printf '%s\n' "$command_line" | grep -qE 'su''do[[:space:]]+(apt(-get)?|dnf|yum|pacman|zypper)[[:space:]].*(install|add)|su''do[[:space:]]+brew[[:space:]]+install'; then
                privileged_subtype="package_install"
            fi
            findings=$(append_risk_finding "$findings" "privileged_command" \
                "$privileged_subtype" "$canonical_skill_file" "$line_number" \
                "command" "$privileged_scope" "privileged command requires contextual review" "$line") || return 1
        fi

        if [[ "$line" =~ $secret_assignment_re ]]; then
            variable="${BASH_REMATCH[1]}"
            rhs="${line#*=}"
            normalized=$(printf '%s' "$rhs" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^['"'"'"]//; s/['"'"'"]([[:space:]]*(#.*)?)$//')
            lower=$(printf '%s' "$normalized" | tr '[:upper:]' '[:lower:]')
            case "$normalized" in
                ''|'$('*|'${'*|'$'[A-Za-z_]*|*'...'*) continue ;;
            esac
            case "$normalized" in
                \"*) normalized="${normalized#\"}"; normalized="${normalized%%\"*}" ;;
                \'*) normalized="${normalized#\'}"; normalized="${normalized%%\'*}" ;;
                \`*) normalized="${normalized#\`}"; normalized="${normalized%%\`*}" ;;
                *) normalized="${normalized%%[[:space:]\`]*}" ;;
            esac
            case "$lower" in
                *'<your-'*|*'<api-'*|*'<token>'*|*placeholder*|*redacted*|*changeme*|*example*|*dummy*|*'your-key'*) continue ;;
            esac
            if { [ "${#normalized}" -ge 20 ] \
                    && printf '%s' "$normalized" | grep -q '[[:alpha:]]' \
                    && printf '%s' "$normalized" | grep -q '[[:digit:]]' \
                    && ! printf '%s' "$normalized" | grep -q '[[:space:]$]'; } \
                || printf '%s' "$normalized" | grep -qE '^(sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}$'; then
                findings=$(append_risk_finding "$findings" "possible_secret" \
                    "credential_like_literal" "$canonical_skill_file" "$line_number" \
                    "assignment" "local" "credential-like literal assigned to ${variable}" "$line") || return 1
            fi
        fi
    done < "$skill_file"
    printf '%s\n' "$findings"
}

canonical_dir_for_entry() {
    local path="$1"
    (
        cd -P "$path" 2>/dev/null || exit 1
        printf '%s\001' "$PWD"
    )
}

stat_owner_uid() {
    local path="$1" result
    if result=$(stat -c '%u' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -f '%u' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

stat_size_bytes() {
    local path="$1" result
    if result=$(stat -c '%s' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -f '%z' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

stat_inode() {
    local path="$1" result
    if result=$(stat -c '%i' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -f '%i' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

stat_inode_follow() {
    local path="$1" result
    if result=$(stat -L -c '%i' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -L -f '%i' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

stat_mode_bits() {
    local path="$1" result
    if result=$(stat -c '%a' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    elif result=$(stat -f '%Lp' "$path" 2>/dev/null); then
        printf '%s\n' "$result"
    else
        return 1
    fi
}

cleanup_provenance_git_tmp() {
    if [ -n "$PROVENANCE_GIT_TMP" ] && [ -d "$PROVENANCE_GIT_TMP" ]; then
        rm -rf -- "$PROVENANCE_GIT_TMP"
    fi
    if [ -n "$PROVENANCE_RECEIPT_TMP" ] && [ -f "$PROVENANCE_RECEIPT_TMP" ]; then
        rm -f -- "$PROVENANCE_RECEIPT_TMP"
    fi
    # Command substitutions run scan_directory in a subshell and inherit EXIT
    # traps. Only the top-level scanner owns the cross-directory content cache.
    if [ "${BASH_SUBSHELL:-0}" -eq 0 ] \
        && [ -n "$SCAN_CONTENT_CACHE_DIR" ] && [ -d "$SCAN_CONTENT_CACHE_DIR" ]; then
        rm -rf -- "$SCAN_CONTENT_CACHE_DIR"
    fi
}

trap cleanup_provenance_git_tmp EXIT

initialize_scan_content_cache() {
    local tmp_root candidate
    tmp_root="${TMPDIR:-/tmp}"
    candidate=$(mktemp -d "${tmp_root%/}/skills-refiner-scan-cache.XXXXXX") || return 1
    chmod 700 "$candidate" || {
        rm -rf -- "$candidate"
        return 1
    }
    SCAN_CONTENT_CACHE_DIR="$candidate"
    SCAN_CONTENT_CACHE_HITS_FILE="$candidate/cache-hits"
    : > "$SCAN_CONTENT_CACHE_HITS_FILE" || return 1
    chmod 600 "$SCAN_CONTENT_CACHE_HITS_FILE" || return 1
}

scan_content_cache_file() {
    local canonical_skill_file="$1" cache_key
    [ -n "$SCAN_CONTENT_CACHE_DIR" ] || return 1
    # Device + inode uniquely identify the opened filesystem object for this
    # scan; size, mtime, and ctime invalidate reuse if it changes mid-run. One
    # stat replaces the previous stat/hash subprocess chain on every alias.
    cache_key=$(stat -c '%d-%i-%s-%Y-%Z' "$canonical_skill_file" 2>/dev/null) \
        || cache_key=$(stat -f '%d-%i-%z-%m-%c' "$canonical_skill_file" 2>/dev/null) \
        || return 1
    [[ "$cache_key" =~ ^[0-9]+(-[0-9]+){4}$ ]] || return 1
    printf '%s/%s.json\n' "$SCAN_CONTENT_CACHE_DIR" "$cache_key"
}

write_scan_content_cache() {
    local cache_file="$1" entry_json="$2" cache_tmp
    [ -n "$cache_file" ] && [ ! -e "$cache_file" ] && [ ! -L "$cache_file" ] || return 0
    cache_tmp=$(mktemp "$SCAN_CONTENT_CACHE_DIR/.entry.XXXXXX") || return 1
    chmod 600 "$cache_tmp" || {
        rm -f -- "$cache_tmp"
        return 1
    }
    if ! printf '%s\n' "$entry_json" > "$cache_tmp" || ! jq -e 'type == "object"' "$cache_tmp" >/dev/null 2>&1; then
        rm -f -- "$cache_tmp"
        return 1
    fi
    mv -f -- "$cache_tmp" "$cache_file"
}

ensure_provenance_git_tmp() {
    [ -n "$PROVENANCE_GIT_TMP" ] && [ -d "$PROVENANCE_GIT_TMP/repo" ] && return 0
    [ -x /usr/bin/git ] || return 1

    local tmp_root candidate
    tmp_root="${TMPDIR:-/tmp}"
    candidate=$(mktemp -d "${tmp_root%/}/skills-refiner-git-tree.XXXXXX") || return 1
    chmod 700 "$candidate" || {
        rm -rf -- "$candidate"
        return 1
    }
    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$HOME_DIR" \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
        /usr/bin/git init --bare -q "$candidate/repo" >/dev/null 2>&1 || {
        rm -rf -- "$candidate"
        return 1
    }
    PROVENANCE_GIT_TMP="$candidate"
}

git_tree_hash_for_directory() {
    local entry_path="$1"
    GIT_TREE_HASH_RESULT=""
    ensure_provenance_git_tmp || return 1
    rm -f -- "$PROVENANCE_GIT_TMP/index"

    /usr/bin/env -i PATH=/usr/bin:/bin HOME="$HOME_DIR" \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
        GIT_INDEX_FILE="$PROVENANCE_GIT_TMP/index" \
        /usr/bin/git --git-dir="$PROVENANCE_GIT_TMP/repo" --work-tree="$entry_path" \
        -c core.autocrlf=false -c core.filemode=true -c core.symlinks=true \
        add -f -A -- . >/dev/null 2>&1 || return 1
    GIT_TREE_HASH_RESULT=$(/usr/bin/env -i PATH=/usr/bin:/bin HOME="$HOME_DIR" \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
        GIT_INDEX_FILE="$PROVENANCE_GIT_TMP/index" \
        /usr/bin/git --git-dir="$PROVENANCE_GIT_TMP/repo" --work-tree="$entry_path" \
        write-tree 2>/dev/null) || return 1
    echo "$GIT_TREE_HASH_RESULT" | grep -Eq '^[0-9a-f]{40}$'
}

# Count files under a skill tree with a hard ceiling (does not walk forever).
count_tree_files_bounded() {
    local entry_path="$1"
    local limit="$2"
    local counted
    counted=$(find "$entry_path" \( -type f -o -type l \) 2>/dev/null \
        | head -n "$((limit + 1))" \
        | wc -l \
        | tr -d '[:space:]')
    echo "${counted:-0}"
}

snapshot_install_receipt() {
    local receipt_file="$1"
    local receipt_owner receipt_size receipt_mode path_inode fd_inode snapshot tmp_root

    [ -f "$receipt_file" ] && [ ! -L "$receipt_file" ] || return 1
    exec 9< "$receipt_file" || return 1

    path_inode=$(stat_inode "$receipt_file" 2>/dev/null || true)
    fd_inode=$(stat_inode_follow /dev/fd/9 2>/dev/null || true)
    receipt_owner=$(stat_owner_uid "$receipt_file" 2>/dev/null || true)
    receipt_size=$(stat_size_bytes "$receipt_file" 2>/dev/null || true)
    receipt_mode=$(stat_mode_bits "$receipt_file" 2>/dev/null || true)
    if [ -z "$path_inode" ] || [ "$path_inode" != "$fd_inode" ] ||
       [ "$receipt_owner" != "$(id -u)" ] ||
       ! echo "$receipt_size" | grep -Eq '^[0-9]+$' ||
       [ "$receipt_size" -gt "$MAX_SKILL_LOCK_BYTES" ] ||
       ! echo "$receipt_mode" | grep -Eq '^[0-7]{3,4}$' ||
       (( (8#$receipt_mode & 8#022) != 0 )); then
        exec 9<&-
        return 1
    fi

    tmp_root="${TMPDIR:-/tmp}"
    snapshot=$(mktemp "${tmp_root%/}/skills-refiner-receipt.XXXXXX") || {
        exec 9<&-
        return 1
    }
    chmod 600 "$snapshot" || {
        exec 9<&-
        rm -f -- "$snapshot"
        return 1
    }
    if ! cat <&9 > "$snapshot"; then
        exec 9<&-
        rm -f -- "$snapshot"
        return 1
    fi
    exec 9<&-

    if [ -L "$receipt_file" ] ||
       [ "$(stat_inode "$receipt_file" 2>/dev/null || true)" != "$path_inode" ] ||
       [ "$(stat_size_bytes "$snapshot" 2>/dev/null || true)" != "$receipt_size" ]; then
        rm -f -- "$snapshot"
        return 1
    fi

    printf '%s\n' "$snapshot"
}

mutation_provenance_for_entry() {
    local location="$1" entry_type="$2" entry_name="$3" entry_path="$4" receipt_snapshot="$5"
    local unknown='{"kind":"unknown","confidence":"none","evidence":null}'
    MUTATION_PROVENANCE_JSON="$unknown"
    INSTALLER_SOURCE_CLAIM_JSON="null"

    if [ "$location" != ".agents/skills" ] || [ "$entry_type" != "directory" ]; then
        return
    fi

    if [ -z "$receipt_snapshot" ] || [ ! -f "$receipt_snapshot" ]; then
        return
    fi

    local receipt_file="$HOME_DIR/.agents/.skill-lock.json"

    if jq -e --arg skill "$entry_name" --argjson schema_version "$SKILL_LOCK_SCHEMA_VERSION" '
        .version == $schema_version and
        (.skills | type == "object") and
        (.skills[$skill] | type == "object") and
        ([.skills[$skill].source,
          .skills[$skill].sourceType,
          .skills[$skill].sourceUrl,
          .skills[$skill].skillPath]
         | all(type == "string" and length > 0)) and
        (.skills[$skill].sourceType == "github") and
        (.skills[$skill].skillFolderHash | type == "string" and test("^[0-9a-f]{40}$"))
    ' "$receipt_snapshot" >/dev/null 2>&1; then
        local receipt_sha256 expected_tree_sha1 installed_tree_sha1 tree_file_count
        receipt_sha256=$(sr_hash_file_raw "$receipt_snapshot" 2>/dev/null || true)
        expected_tree_sha1=$(jq -r --arg skill "$entry_name" '.skills[$skill].skillFolderHash' "$receipt_snapshot" 2>/dev/null || true)

        if $SKIP_PROVENANCE_TREE; then
            MUTATION_PROVENANCE_JSON=$(jq -n \
                --arg receipt_file "$receipt_file" \
                --arg receipt_sha256 "${receipt_sha256:-}" \
                '{kind:"unknown", confidence:"truncated",
                  evidence:{kind:"provenance_tree_skipped",
                            receipt_file:$receipt_file,
                            receipt_sha256:$receipt_sha256}}')
            return
        fi

        tree_file_count=$(count_tree_files_bounded "$entry_path" "$MAX_PROVENANCE_TREE_FILES")
        if ! echo "$tree_file_count" | grep -Eq '^[0-9]+$' \
            || [ "$tree_file_count" -gt "$MAX_PROVENANCE_TREE_FILES" ]; then
            MUTATION_PROVENANCE_JSON=$(jq -n \
                --arg receipt_file "$receipt_file" \
                --arg receipt_sha256 "${receipt_sha256:-}" \
                --argjson max_files "$MAX_PROVENANCE_TREE_FILES" \
                --argjson observed_files "${tree_file_count:-0}" \
                '{kind:"unknown", confidence:"truncated",
                  evidence:{kind:"provenance_tree_too_large",
                            receipt_file:$receipt_file,
                            receipt_sha256:$receipt_sha256,
                            max_files:$max_files,
                            observed_files:$observed_files}}')
            return
        fi

        if git_tree_hash_for_directory "$entry_path" 2>/dev/null; then
            installed_tree_sha1="$GIT_TREE_HASH_RESULT"
        else
            installed_tree_sha1=""
        fi
        if [ -n "$receipt_sha256" ] && [ "$installed_tree_sha1" = "$expected_tree_sha1" ]; then
            MUTATION_PROVENANCE_JSON=$(jq -n \
                --arg receipt_file "$receipt_file" \
                --arg receipt_sha256 "$receipt_sha256" \
                --arg installed_tree_sha1 "$installed_tree_sha1" \
                '{kind:"installed_copy", confidence:"direct",
                  evidence:{kind:"content_bound_installer_receipt",
                            receipt_file:$receipt_file,
                            receipt_sha256:$receipt_sha256,
                            installed_tree_sha1:$installed_tree_sha1}}')
            installer_source_claim_from_receipt "$entry_name" "$receipt_snapshot"
            return
        fi
    else
        return
    fi
}

# ── Topology Scanner ──────────────────────────────────────────────────
scan_directory() {
    local dir="$1"
    local dir_label="$2"
    local results="[]"
    local results_file=""
    local collection_index_blockers="[]"
    local validated_collection_members="[]"

    if [ ! -d "$dir" ]; then
        jq -n '{entries:[], collection_index_blockers:[]}'
        return
    fi

    if [ -n "$SCAN_CONTENT_CACHE_DIR" ] && [ -d "$SCAN_CONTENT_CACHE_DIR" ]; then
        results_file=$(mktemp "$SCAN_CONTENT_CACHE_DIR/entries.XXXXXX" 2>/dev/null || true)
        [ -z "$results_file" ] || chmod 600 "$results_file" || {
            rm -f -- "$results_file"
            results_file=""
        }
    fi

    local install_receipt_snapshot=""
    if [ "$dir_label" = ".agents/skills" ]; then
        install_receipt_snapshot=$(snapshot_install_receipt "$HOME_DIR/.agents/.skill-lock.json" 2>/dev/null || true)
        PROVENANCE_RECEIPT_TMP="$install_receipt_snapshot"
    fi

    local entry_paths=()
    for entry_path in "$dir"/*; do
        [ -e "$entry_path" ] || [ -L "$entry_path" ] || continue
        entry_paths+=("$entry_path")
        # Only roots owned by the collection controller may activate nested
        # members. Validation is fail-closed: no member is enumerated until the
        # schema, source mapping, relative paths, and deployed tree digests all
        # match the authoritative collection contract.
        if [ "$dir_label" = ".agents/skills" ] \
            && is_managed_collection_root "${entry_path##*/}"; then
            local validation_json validation_rc
            validation_json=$(validate_managed_collection_index "$entry_path" "${entry_path##*/}")
            validation_rc=$?
            if [ "$validation_rc" -ne 0 ] || [ "$(echo "$validation_json" | jq -r '.status // "blocked"' 2>/dev/null)" != "valid" ]; then
                if ! echo "$validation_json" | jq -e 'type == "object" and .status == "blocked"' >/dev/null 2>&1; then
                    validation_json=$(jq -n \
                        --arg collection_id "${entry_path##*/}" \
                        --arg index_path "$entry_path/INDEX.json" \
                        '{status:"blocked", collection_id:$collection_id, index_path:$index_path,
                          error_code:"collection_index_validation_failed",
                          diagnostic:"collection INDEX validator returned an invalid result"}')
                fi
                collection_index_blockers=$(echo "$collection_index_blockers" | jq --argjson blocker "$validation_json" '. + [$blocker]')
                continue
            fi

            local indexed_member_relative
            validated_collection_members=$(echo "$validated_collection_members" | jq \
                --argjson validation "$validation_json" '. + [$validation.members[] | . + {collection_id:$validation.collection_id}]')
            while IFS= read -r indexed_member_relative; do
                entry_paths+=("$entry_path/$indexed_member_relative")
            done < <(echo "$validation_json" | jq -r '.members[].relative_path')
        fi
    done

    for entry_path in "${entry_paths[@]}"; do
        [ -e "$entry_path" ] || [ -L "$entry_path" ] || continue
        [ -d "$entry_path" ] || [ -L "$entry_path" ] || continue
        local entry_name relative_entry_path relative_without_slashes discovery_depth collection_id
        local collection_member_contract collection_member_relative_path
        entry_name="${entry_path##*/}"
        [[ "$entry_name" == .* ]] && continue
        relative_entry_path="${entry_path#"$dir"/}"
        relative_without_slashes="${relative_entry_path//\//}"
        discovery_depth=$(( ${#relative_entry_path} - ${#relative_without_slashes} + 1 ))
        collection_id=""
        if [ "$discovery_depth" -gt 1 ]; then
            collection_id="${relative_entry_path%%/*}"
        fi
        collection_member_contract="null"
        if [ -n "$collection_id" ]; then
            collection_member_relative_path="${relative_entry_path#*/}"
            collection_member_contract=$(echo "$validated_collection_members" | jq -c \
                --arg collection_id "$collection_id" \
                --arg relative_path "$collection_member_relative_path" \
                'first(.[] | select(.collection_id == $collection_id and .relative_path == $relative_path)) // null')
        fi

        local entry_type link_target raw_link_target_base64
        link_target=""
        raw_link_target_base64=""
        if [ -L "$entry_path" ]; then
            local readlink_with_sentinel
            readlink_with_sentinel="$(readlink -n "$entry_path" 2>/dev/null; printf '\001')"
            link_target="${readlink_with_sentinel%$'\001'}"
            raw_link_target_base64=$(printf '%s' "$link_target" | base64 | tr -d '\r\n')
            if [ -d "$entry_path" ]; then
                entry_type="symlink"
            else
                entry_type="broken_symlink"
            fi
        elif [ -d "$entry_path" ]; then
            entry_type="directory"
        else
            continue
        fi

        local mutation_provenance_json installer_source_claim_json
        mutation_provenance_for_entry "$dir_label" "$entry_type" "$entry_name" "$entry_path" "$install_receipt_snapshot"
        mutation_provenance_json="$MUTATION_PROVENANCE_JSON"
        installer_source_claim_json="$INSTALLER_SOURCE_CLAIM_JSON"

        if [ "$entry_type" = "broken_symlink" ]; then
            local entry_json
            entry_json=$(jq -n \
                --arg name "$entry_name" \
                --arg dir_name "$entry_name" \
                --arg location "$dir_label" \
                --arg entry_path "$entry_path" \
                --arg active_root "$dir" \
                --arg storage_relative_path "$relative_entry_path" \
                --arg collection_id "$collection_id" \
                --argjson discovery_depth "$discovery_depth" \
                --arg entry_type "broken_symlink" \
                --arg link_target "$link_target" \
                --arg raw_link_target_base64 "$raw_link_target_base64" \
                --argjson mutation_provenance "$mutation_provenance_json" \
                '{name: $name, dir_name: $dir_name, location: $location,
                  entry_path: $entry_path, active_root: $active_root,
                  storage_relative_path: $storage_relative_path,
                  discovery_depth: $discovery_depth,
                  collection_id: (if $collection_id == "" then null else $collection_id end),
                  entry_kind: $entry_type, type: $entry_type,
                  link_target: $link_target,
                  raw_link_target: $link_target,
                  raw_link_target_base64: $raw_link_target_base64,
                  mutation_provenance: $mutation_provenance,
                  description: "", word_count: 0, age_days: 0,
                  flags: ["broken_symlink"]}')
            if [ -n "$results_file" ]; then
                printf '%s\n' "$entry_json" >> "$results_file"
            else
                results=$(echo "$results" | jq --argjson e "$entry_json" '. + [$e]')
            fi
            continue
        fi

        local canonical_dir canonical_dir_with_sentinel skill_file source_skill_file canonical_skill_file
        canonical_dir_with_sentinel=$(canonical_dir_for_entry "$entry_path" 2>/dev/null || true)
        canonical_dir="${canonical_dir_with_sentinel%$'\001'}"
        [ -z "$canonical_dir" ] && continue

        skill_file="$canonical_dir/SKILL.md"
        source_skill_file="$entry_path/SKILL.md"
        canonical_skill_file="$skill_file"
        [ ! -f "$skill_file" ] && continue

        # A single canonical skill is commonly distributed into a dozen agent
        # roots. Reuse content-derived facts, but always rebuild entry identity,
        # installer evidence, and provenance for the current discovery surface.
        local scan_cache_file
        local installer_storage_git_root="" installer_storage_git_branch=""
        if [ "$installer_source_claim_json" != "null" ]; then
            installer_storage_git_root=$(git_root_for_dir "$canonical_dir")
            installer_storage_git_branch=$(git_branch_for_root "$installer_storage_git_root")
        fi
        scan_cache_file=$(scan_content_cache_file "$canonical_skill_file" 2>/dev/null || true)
        if [ -n "$scan_cache_file" ] && [ -f "$scan_cache_file" ] && [ ! -L "$scan_cache_file" ]; then
            local cached_source_kind cached_is_backup=false entry_json
            cached_source_kind=$(source_kind_for_entry "$dir_label" "$entry_type" "$discovery_depth")
            case "$entry_name" in
                *.backup.*|*.disabled*|*.tmp*|*.old*) cached_is_backup=true ;;
            esac
            entry_json=$(jq -c \
                --arg dir_name "$entry_name" \
                --arg location "$dir_label" \
                --arg entry_path "$entry_path" \
                --arg active_root "$dir" \
                --arg storage_relative_path "$relative_entry_path" \
                --arg collection_id "$collection_id" \
                --argjson collection_member_contract "$collection_member_contract" \
                --argjson discovery_depth "$discovery_depth" \
                --arg entry_type "$entry_type" \
                --arg raw_link_target "$link_target" \
                --arg raw_link_target_base64 "$raw_link_target_base64" \
                --argjson mutation_provenance "$mutation_provenance_json" \
                --argjson installer_source_claim "$installer_source_claim_json" \
                --arg installer_storage_git_root "$installer_storage_git_root" \
                --arg installer_storage_git_branch "$installer_storage_git_branch" \
                --arg source_skill_file "$source_skill_file" \
                --arg source_kind "$cached_source_kind" \
                --argjson is_backup "$cached_is_backup" '
                select(type == "object") |
                . as $cached |
                ($cached.collection_member_contract // null) as $cached_contract |
                .dir_name = $dir_name |
                .location = $location |
                .entry_path = $entry_path |
                .active_root = $active_root |
                .storage_relative_path = $storage_relative_path |
                .discovery_depth = $discovery_depth |
                .collection_id = (if $collection_id == "" then null else $collection_id end) |
                .collection_member_contract = $collection_member_contract |
                .entry_kind = $entry_type |
                .type = $entry_type |
                .link_target = $raw_link_target |
                .raw_link_target = (if $raw_link_target == "" then null else $raw_link_target end) |
                .raw_link_target_base64 = (if $entry_type == "directory" then null else $raw_link_target_base64 end) |
                .mutation_provenance = $mutation_provenance |
                .source_skill_file = $source_skill_file |
                .flags = ([.flags[] | select(startswith("backup") | not)]
                          + if $is_backup then ["backup_remnant"] else [] end) |
                .provenance = (
                    if $collection_member_contract != null then {
                        kind: $source_kind,
                        source_url: (if $collection_member_contract.source_provider == "github"
                                     then "https://github.com/" + $collection_member_contract.repository_id + ".git"
                                     else "" end),
                        source_provider: $collection_member_contract.source_provider,
                        repository_id: $collection_member_contract.repository_id,
                        source_path: $collection_member_contract.source_path,
                        resolved_revision: $collection_member_contract.resolved_revision,
                        claim_kind: "index_claim",
                        git_root: "",
                        git_branch: "",
                        confidence: "controller_unverified"
                    } elif $installer_source_claim != null then
                        ($installer_source_claim + {
                            kind: $source_kind,
                            git_root: $installer_storage_git_root,
                            git_branch: $installer_storage_git_branch
                        })
                    elif $cached_contract == null then
                        if $cached.provenance.claim_kind == "installer_receipt_claim" then {
                            kind: $source_kind,
                            source_url: "",
                            source_provider: null,
                            repository_id: null,
                            source_path: null,
                            resolved_revision: null,
                            claim_kind: null,
                            git_root: "",
                            git_branch: "",
                            confidence: "heuristic"
                        } else
                            ($cached.provenance | .kind = $source_kind | .claim_kind = null)
                        end
                    else {
                        kind: $source_kind,
                        source_url: "",
                        source_provider: null,
                        repository_id: null,
                        source_path: null,
                        resolved_revision: null,
                        claim_kind: null,
                        git_root: "",
                        git_branch: "",
                        confidence: "heuristic"
                    } end
                )
            ' "$scan_cache_file" 2>/dev/null || true)
            if [ -n "$entry_json" ]; then
                if [ -n "$results_file" ]; then
                    printf '%s\n' "$entry_json" >> "$results_file"
                else
                    results=$(echo "$results" | jq --argjson e "$entry_json" '. + [$e]')
                fi
                printf '1\n' >> "$SCAN_CONTENT_CACHE_HITS_FILE"
                continue
            fi
        fi

        local name desc_full desc top_version metadata_version declared_version word_count mtime mtime_iso now age_days
        name=$(get_frontmatter "$skill_file" "name")
        desc_full=$(get_frontmatter_text "$skill_file" "description")
        desc="$desc_full"
        top_version=$(get_frontmatter "$skill_file" "version")
        metadata_version=$(get_metadata_value "$skill_file" "version")
        declared_version="${metadata_version:-$top_version}"
        word_count=$(count_content_words "$skill_file")
        mtime=$(get_mtime "$skill_file")
        mtime_iso=$(iso_from_epoch "$mtime")
        now=$(date +%s)
        age_days=$(( (now - mtime) / 86400 ))

        local flags=()

        if echo "$entry_name" | grep -qE '\.backup\.|\.disabled|\.tmp|\.old'; then
            flags+=("backup_remnant")
        fi

        local desc_length desc_length_json desc_length_valid desc_utf8_bytes desc_length_over_limit desc_over_limit desc_scalar_kind runtime_status runtime_loadable_json
        desc_length=""
        desc_length_json="null"
        desc_length_valid=false
        if desc_length=$(utf8_codepoint_length "$desc_full"); then
            desc_length_json="$desc_length"
            desc_length_valid=true
        fi
        desc_utf8_bytes=$(utf8_byte_length "$desc_full")
        desc_scalar_kind=$(frontmatter_scalar_kind "$skill_file" "description")
        desc_length_over_limit=false
        desc_over_limit=false
        if $desc_length_valid && [ "$desc_length" -gt "$MAX_DESCRIPTION_LENGTH" ]; then
            desc_length_over_limit=true
            if [ "$desc_scalar_kind" = "plain-simple" ]; then
                desc_over_limit=true
            fi
        fi

        runtime_status="unknown"
        runtime_loadable_json="null"
        if $desc_over_limit; then
            runtime_status="fail"
            runtime_loadable_json="false"
        fi

        [ -z "$name" ] && flags+=("name_not_observed")
        [ -z "$desc" ] && flags+=("description_not_observed")
        if $desc_over_limit; then
            flags+=("description_too_long:${desc_length}>${MAX_DESCRIPTION_LENGTH}")
        elif $desc_length_over_limit; then
            flags+=("description_length_over_limit_unverified:${desc_length}>${MAX_DESCRIPTION_LENGTH}")
        fi

        [ "$word_count" -lt 30 ] && flags+=("very_small")
        [ "$word_count" -gt 5000 ] && flags+=("very_large")
        [ "$age_days" -gt "$STALE_DAYS" ] && flags+=("stale_${age_days}d")

        local risk_json risk_id
        risk_json=$(collect_risk_indicators "$skill_file" "$canonical_skill_file") || risk_json='[]'
        while IFS= read -r risk_id; do
            [ -n "$risk_id" ] && flags+=("$risk_id")
        done < <(printf '%s\n' "$risk_json" | jq -r 'map(.id) | unique[]')

        local broken_refs=()
        local refs
        refs=$(extract_active_at_refs "$skill_file")
        if [ -n "$refs" ]; then
            while IFS= read -r ref; do
                [ -z "$ref" ] && continue
                local ref_path="$(dirname "$skill_file")/${ref#@}"
                [ ! -f "$ref_path" ] && broken_refs+=("$ref")
            done <<< "$refs"
        fi
        [ ${#broken_refs[@]} -gt 0 ] && flags+=("broken_refs:${broken_refs[*]}")

        local flags_json
        if [ ${#flags[@]} -eq 0 ]; then
            flags_json='[]'
        else
            flags_json=$(printf '%s\n' "${flags[@]}" | jq -R . | jq -s .)
        fi

        local normalized_content_sha256 git_root git_remote git_branch source_kind
        local source_provider repository_id provenance_source_path resolved_revision provenance_claim_kind provenance_confidence
        normalized_content_sha256=$(hash_file "$skill_file")
        git_root=$(git_root_for_dir "$canonical_dir")
        git_remote=$(git_remote_for_root "$git_root")
        git_branch=$(git_branch_for_root "$git_root")
        source_kind=$(source_kind_for_entry "$dir_label" "$entry_type" "$discovery_depth")
        source_provider=""
        repository_id=""
        provenance_source_path=""
        resolved_revision=""
        provenance_claim_kind=""
        provenance_confidence="heuristic"
        if [ "$collection_member_contract" != "null" ]; then
            source_provider=$(echo "$collection_member_contract" | jq -r '.source_provider // ""')
            repository_id=$(echo "$collection_member_contract" | jq -r '.repository_id // ""')
            provenance_source_path=$(echo "$collection_member_contract" | jq -r '.source_path // ""')
            resolved_revision=$(echo "$collection_member_contract" | jq -r '.resolved_revision // ""')
            provenance_claim_kind="index_claim"
            provenance_confidence="controller_unverified"
            # The ambient ~/.agents/skills repository is not the collection
            # member's source authority. INDEX claims remain controller-
            # unverified and must not inherit that unrelated Git root/branch.
            git_root=""
            git_branch=""
            if [ "$source_provider" = "github" ] \
                && [[ "$repository_id" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
                git_remote="https://github.com/${repository_id}.git"
            else
                git_remote=""
            fi
        elif [ "$installer_source_claim_json" != "null" ]; then
            git_remote=$(printf '%s' "$installer_source_claim_json" | jq -r '.source_url')
            source_provider=$(printf '%s' "$installer_source_claim_json" | jq -r '.source_provider')
            repository_id=$(printf '%s' "$installer_source_claim_json" | jq -r '.repository_id')
            provenance_source_path=$(printf '%s' "$installer_source_claim_json" | jq -r '.source_path')
            resolved_revision=""
            provenance_claim_kind="installer_receipt_claim"
            provenance_confidence="receipt_bound"
        else
            repository_id=$(repository_id_for_source_url "$git_remote")
            provenance_source_path=$(git_source_path_for_dir "$git_root" "$canonical_dir")
            if [ -n "$repository_id" ]; then
                source_provider="git"
                provenance_confidence="direct"
            fi
        fi

        local when_to_use when_to_use_preview disable_model_invocation user_invocable model effort context agent shell_value
        local allowed_tools_json paths_json hook_events_json_value has_hooks extra_keys_json fm_keys_json openai_yaml openai_yaml_exists
        local allow_implicit_invocation tool_dependencies_count
        local desc_truncated when_to_use_length when_to_use_truncated allowed_tools_count paths_count

        when_to_use=$(get_frontmatter_text "$skill_file" "when_to_use")
        when_to_use_preview="$when_to_use"
        disable_model_invocation=$(get_frontmatter "$skill_file" "disable-model-invocation")
        user_invocable=$(get_frontmatter "$skill_file" "user-invocable")
        model=$(get_frontmatter "$skill_file" "model")
        effort=$(get_frontmatter "$skill_file" "effort")
        context=$(get_frontmatter "$skill_file" "context")
        agent=$(get_frontmatter "$skill_file" "agent")
        shell_value=$(get_frontmatter "$skill_file" "shell")
        allowed_tools_json=$(frontmatter_list_json "$skill_file" "allowed-tools")
        paths_json=$(frontmatter_list_json "$skill_file" "paths")
        hook_events_json_value=$(hook_events_json "$skill_file")
        has_hooks=false
        [ "$(echo "$hook_events_json_value" | jq 'length')" -gt 0 ] && has_hooks=true
        fm_keys_json=$(frontmatter_keys_json "$skill_file")
        extra_keys_json=$(echo "$fm_keys_json" | jq 'map(. as $key | select((["name","description","when_to_use","disable-model-invocation","user-invocable","allowed-tools","model","effort","context","agent","paths","shell","hooks"] | index($key)) | not))')

        desc_truncated=false
        $desc_length_valid && [ "$desc_length" -gt 200 ] && desc_truncated=true
        when_to_use_length=$(utf8_codepoint_length "$when_to_use" 2>/dev/null || echo 0)
        when_to_use_truncated=false
        [ "$when_to_use_length" -gt 200 ] && when_to_use_truncated=true
        allowed_tools_count=$(echo "$allowed_tools_json" | jq 'length')
        paths_count=$(echo "$paths_json" | jq 'length')

        openai_yaml="$canonical_dir/agents/openai.yaml"
        openai_yaml_exists=false
        allow_implicit_invocation=""
        tool_dependencies_count=0
        if [ -f "$openai_yaml" ]; then
            openai_yaml_exists=true
            allow_implicit_invocation=$(yaml_section_scalar "$openai_yaml" "policy" "allow_implicit_invocation")
            tool_dependencies_count=$(yaml_sequence_count "$openai_yaml" "tools")
        fi

        local entry_json
        entry_json=$(jq -n \
            --arg name "${name:-$entry_name}" \
            --arg frontmatter_name "$name" \
            --arg dir_name "$entry_name" \
            --arg location "$dir_label" \
            --arg entry_path "$entry_path" \
            --arg active_root "$dir" \
            --arg storage_relative_path "$relative_entry_path" \
            --arg collection_id "$collection_id" \
            --argjson discovery_depth "$discovery_depth" \
            --arg entry_type "$entry_type" \
            --arg raw_link_target "$link_target" \
            --arg raw_link_target_base64 "$raw_link_target_base64" \
            --arg source_skill_file "$source_skill_file" \
            --arg canonical_skill_file "$canonical_skill_file" \
            --arg canonical_dir "$canonical_dir" \
            --arg desc "$desc" \
            --arg declared_version "$declared_version" \
            --arg metadata_version "$metadata_version" \
            --arg normalized_content_sha256 "$normalized_content_sha256" \
            --arg mtime_iso "$mtime_iso" \
            --arg source_kind "$source_kind" \
            --arg git_root "$git_root" \
            --arg git_remote "$git_remote" \
            --arg git_branch "$git_branch" \
            --arg source_provider "$source_provider" \
            --arg repository_id "$repository_id" \
            --arg provenance_source_path "$provenance_source_path" \
            --arg resolved_revision "$resolved_revision" \
            --arg provenance_claim_kind "$provenance_claim_kind" \
            --arg provenance_confidence "$provenance_confidence" \
            --arg when_to_use_preview "$when_to_use_preview" \
            --arg disable_model_invocation "$disable_model_invocation" \
            --arg user_invocable "$user_invocable" \
            --arg model "$model" \
            --arg effort "$effort" \
            --arg context "$context" \
            --arg agent "$agent" \
            --arg shell "$shell_value" \
            --arg allow_implicit_invocation "$allow_implicit_invocation" \
            --arg runtime_status "$runtime_status" \
            --arg description_scalar_kind "$desc_scalar_kind" \
            --argjson words "$word_count" \
            --argjson mtime "$mtime" \
            --argjson age "$age_days" \
            --argjson stale_days "$STALE_DAYS" \
            --argjson max_description_length "$MAX_DESCRIPTION_LENGTH" \
            --argjson desc_length "$desc_length_json" \
            --argjson desc_length_valid "$desc_length_valid" \
            --argjson desc_length_over_limit "$desc_length_over_limit" \
            --argjson desc_utf8_bytes "$desc_utf8_bytes" \
            --argjson desc_truncated "$desc_truncated" \
            --argjson desc_over_limit "$desc_over_limit" \
            --argjson when_to_use_length "$when_to_use_length" \
            --argjson when_to_use_truncated "$when_to_use_truncated" \
            --argjson allowed_tools "$allowed_tools_json" \
            --argjson allowed_tools_count "$allowed_tools_count" \
            --argjson paths "$paths_json" \
            --argjson paths_count "$paths_count" \
            --argjson has_hooks "$has_hooks" \
            --argjson hook_events "$hook_events_json_value" \
            --argjson extra_keys "$extra_keys_json" \
            --argjson openai_yaml_exists "$openai_yaml_exists" \
            --argjson tool_dependencies_count "$tool_dependencies_count" \
            --argjson runtime_loadable "$runtime_loadable_json" \
            --argjson mutation_provenance "$mutation_provenance_json" \
            --argjson collection_member_contract "$collection_member_contract" \
            --argjson flags "$flags_json" \
            --argjson risks "$risk_json" \
            '{
                name: $name,
                dir_name: $dir_name,
                location: $location,
                entry_path: $entry_path,
                active_root: $active_root,
                storage_relative_path: $storage_relative_path,
                discovery_depth: $discovery_depth,
                collection_id: (if $collection_id == "" then null else $collection_id end),
                collection_member_contract: $collection_member_contract,
                entry_kind: $entry_type,
                type: $entry_type,
                link_target: $raw_link_target,
                raw_link_target: (if $raw_link_target == "" then null else $raw_link_target end),
                raw_link_target_base64: (if $entry_type == "directory" then null else $raw_link_target_base64 end),
                mutation_provenance: $mutation_provenance,
                source_skill_file: $source_skill_file,
                canonical_skill_file: $canonical_skill_file,
                canonical_dir: $canonical_dir,
                description: $desc[0:200],
                frontmatter: {
                    contract: "name_description_only",
                    name: $frontmatter_name,
                    description: $desc[0:200],
                    max_description_length: $max_description_length,
                    description_length: $desc_length,
                    description_utf8_bytes: $desc_utf8_bytes,
                    description_truncated: $desc_truncated
                },
                runtime_contract: {
                    loader: "agent-skills",
                    status: $runtime_status,
                    loadable: $runtime_loadable,
                    runtime_verified: false,
                    validation_method: "conservative-static-frontmatter-preflight",
                    unknown_reason: (if $runtime_status == "unknown" then "runtime_loader_not_executed" else null end),
                    load_blockers: ([
                        if $desc_over_limit then "description_too_long" else empty end
                    ]),
                    unverified_requirements: ([
                        if $frontmatter_name == "" then "name_not_observed_by_lightweight_parser" else empty end,
                        if $desc == "" then "description_not_observed_by_lightweight_parser" else empty end,
                        if ($desc_length_valid | not) then "description_length_not_verified_invalid_utf8" else empty end,
                        if $desc_length_over_limit and ($desc_over_limit | not) then "description_length_over_limit_parser_not_authoritative" else empty end
                    ]),
                    max_description_length: $max_description_length,
                    description_length: $desc_length,
                    description_length_valid: $desc_length_valid,
                    description_scalar_kind: $description_scalar_kind,
                    description_utf8_bytes: $desc_utf8_bytes
                },
                claude_code: {
                    when_to_use_length: $when_to_use_length,
                    when_to_use_preview: $when_to_use_preview[0:200],
                    when_to_use_truncated: $when_to_use_truncated,
                    disable_model_invocation: $disable_model_invocation,
                    user_invocable: $user_invocable,
                    allowed_tools_count: $allowed_tools_count,
                    allowed_tools_preview: ($allowed_tools[:5]),
                    model: $model,
                    effort: $effort,
                    context: $context,
                    agent: $agent,
                    paths_count: $paths_count,
                    paths_preview: ($paths[:5]),
                    shell: $shell,
                    has_hooks: $has_hooks,
                    hook_events: $hook_events
                },
                openai: {
                    skill_md_contract: "name_description_only",
                    openai_yaml_exists: $openai_yaml_exists,
                    allow_implicit_invocation: $allow_implicit_invocation,
                    tool_dependencies_count: $tool_dependencies_count
                },
                extra_frontmatter_keys: $extra_keys,
                declared_version: $declared_version,
                metadata_version: $metadata_version,
                normalized_content_sha256: $normalized_content_sha256,
                word_count: $words,
                age_days: $age,
                freshness: {
                    mtime_epoch: $mtime,
                    mtime_iso: $mtime_iso,
                    age_days: $age,
                    stale_threshold_days: $stale_days,
                    is_stale: ($age > $stale_days)
                },
                provenance: {
                    kind: $source_kind,
                    source_url: $git_remote,
                    source_provider: (if $source_provider == "" then null else $source_provider end),
                    repository_id: (if $repository_id == "" then null else $repository_id end),
                    source_path: (if $provenance_source_path == "" then null else $provenance_source_path end),
                    resolved_revision: (if $resolved_revision == "" then null else $resolved_revision end),
                    claim_kind: (if $provenance_claim_kind == "" then null else $provenance_claim_kind end),
                    git_root: $git_root,
                    git_branch: $git_branch,
                    confidence: $provenance_confidence
                },
                risk_indicators: $risks,
                flags: $flags
            }')

        if [ -n "$results_file" ]; then
            printf '%s\n' "$entry_json" >> "$results_file"
        else
            results=$(echo "$results" | jq --argjson e "$entry_json" '. + [$e]')
        fi
        write_scan_content_cache "$scan_cache_file" "$entry_json" 2>/dev/null || true
    done

    if [ -n "$install_receipt_snapshot" ]; then
        rm -f -- "$install_receipt_snapshot"
        PROVENANCE_RECEIPT_TMP=""
    fi
    if [ -n "$results_file" ]; then
        results=$(jq -s '.' "$results_file")
        rm -f -- "$results_file"
    fi
    jq -n --argjson entries "$results" --argjson blockers "$collection_index_blockers" \
        '{entries:$entries, collection_index_blockers:$blockers}'
}

# ── Main ──────────────────────────────────────────────────────────────
main() {
    if ! $JSON_ONLY; then
        echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
        echo -e "${BOLD}║     Agent Skills Inventory Scanner v2.0      ║${NC}"
        echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "  ${DIM}Staleness threshold: ${STALE_DAYS} days${NC}"
        echo ""
    fi

    local all_data
    all_data=$(jq -n --arg scanned_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson stale_days "$STALE_DAYS" --argjson max_description_length "$MAX_DESCRIPTION_LENGTH" '{metadata:{schema_version:"skill-scan.v7", product_version:"2.0", scanned_at:$scanned_at, stale_days:$stale_days, max_description_length:$max_description_length, scope:"agent-recognized-directories-plus-validated-managed-collection-members", hash_normalization:"strip-canary-crlf-bom.v1", runtime_validation_mode:"static-preflight", runtime_status_semantics:"pass=runtime validator confirmed; fail=proven blocker; unknown=runtime loader not executed", collection_index_validation:"controller-contract-and-deployed-tree-digest"}, topology:{}, skills:[], skill_links:[], broken_symlinks:[], entries:[], runtime_load_blockers:[], collection_index_blockers:[], name_collisions:[]}')

    for dir in "${AGENT_DIRS[@]}"; do
        [ ! -d "$dir" ] && continue
        local label="${dir#$HOME_DIR/}"
        local dir_data
        dir_data=$(scan_directory "$dir" "$label")
        all_data=$(echo "$all_data" | jq \
            --arg label "$label" \
            --argjson directory "$dir_data" '
            ($directory.entries) as $entries |
            .topology[$label] = {
                total: ($entries | length),
                symlinks: ([$entries[] | select(.type == "symlink")] | length),
                native: ([$entries[] | select(.type == "directory")] | length),
                broken_symlinks: ([$entries[] | select(.type == "broken_symlink")] | length)
            } |
            .skills += [$entries[] | select(.type == "directory")] |
            .skill_links += [$entries[] | select(.type == "symlink")] |
            .broken_symlinks += [$entries[] | select(.type == "broken_symlink")] |
            .collection_index_blockers += $directory.collection_index_blockers
        ')
    done

    local canonical_content_parses=0 canonical_content_cache_hits=0 content_cache_status="disabled"
    if [ -n "$SCAN_CONTENT_CACHE_DIR" ] && [ -d "$SCAN_CONTENT_CACHE_DIR" ]; then
        content_cache_status="enabled"
        canonical_content_parses=$(find "$SCAN_CONTENT_CACHE_DIR" -type f -name '*.json' 2>/dev/null | wc -l | tr -d '[:space:]')
        canonical_content_cache_hits=$(wc -l < "$SCAN_CONTENT_CACHE_HITS_FILE" | tr -d '[:space:]')
    fi
    all_data=$(echo "$all_data" | jq \
        --arg status "$content_cache_status" \
        --argjson canonical_content_parses "${canonical_content_parses:-0}" \
        --argjson canonical_content_cache_hits "${canonical_content_cache_hits:-0}" '
        .metadata.scan_efficiency = {
            content_cache: $status,
            cache_key: "canonical-skill-file-identity.v1",
            canonical_content_parses: $canonical_content_parses,
            canonical_content_cache_hits: $canonical_content_cache_hits
        }
    ')

    all_data=$(echo "$all_data" | jq '
        def is_backup_or_archive:
            (.dir_name | test("\\.backup\\.|\\.disabled|\\.tmp|\\.old|\\.archive"));
        .entries = (.skills + .skill_links + .broken_symlinks) |
        .runtime_load_blockers = (
            .skills + .skill_links
            | unique_by(.canonical_skill_file)
            | map(select(.runtime_contract.status == "fail") | {
                name,
                location,
                type,
                canonical_skill_file,
                load_blockers: .runtime_contract.load_blockers,
                description_length: .runtime_contract.description_length,
                max_description_length: .runtime_contract.max_description_length
            })
        ) |
        .name_collisions = (
            [.skills[] | select(is_backup_or_archive | not)]
            | sort_by(.name)
            | group_by(.name)
            | map(select(length > 1) | {
                name: .[0].name,
                real_directory_count: length,
                distinct_canonical_dirs: ([.[].canonical_dir] | unique | length),
                distinct_repository_ids: ([.[].provenance.repository_id | select(. != null and length > 0)] | unique),
                distinct_source_paths: ([.[].provenance.source_path | select(. != null and length > 0)] | unique),
                distinct_versions: ([.[].declared_version | select(length > 0)] | unique),
                distinct_hashes: ([.[].normalized_content_sha256 | select(length > 0)] | unique),
                distinct_entity_keys: ([.[] | [
                    (.provenance.repository_id // ""),
                    (.provenance.source_path // ""),
                    .canonical_dir
                ] | @json] | unique),
                disposition: "preserve",
                reason: "same_declared_name_multiple_qualified_entities",
                entries: [.[] | {
                    location,
                    canonical_dir,
                    canonical_skill_file,
                    declared_version,
                    normalized_content_sha256,
                    provenance,
                    entity_identity: {
                        repository_id: .provenance.repository_id,
                        source_path: .provenance.source_path,
                        canonical_target: .canonical_dir
                    }
                }]
            })
            | map(select((.distinct_entity_keys | length) > 1))
        )
    ')

    local collection_index_blocker_count
    collection_index_blocker_count=$(echo "$all_data" | jq '.collection_index_blockers | length')

    if $JSON_ONLY; then
        echo "$all_data" | jq '.'
        [ "$collection_index_blocker_count" -eq 0 ]
        return
    fi

    local report_written=false
    if ! $NO_WRITE; then
        if ! mkdir -p "$REPORT_DIR"; then
            echo "[ERROR] Cannot create report directory: $REPORT_DIR" >&2
            exit 1
        fi
        if ! echo "$all_data" | jq '.' > "$REPORT_JSON"; then
            echo "[ERROR] Cannot write report JSON: $REPORT_JSON" >&2
            exit 1
        fi
        report_written=true
    fi

    echo -e "${BOLD}── Topology Map ──${NC}"
    echo "$all_data" | jq -r '.topology | to_entries[] | "\(.key)|\(.value.total)|\(.value.native)|\(.value.symlinks)|\(.value.broken_symlinks)"' | while IFS='|' read -r loc total native sym broken; do
        printf "  %-30s %3d total  (%d native, %d symlinks" "$loc" "$total" "$native" "$sym"
        if [ "$broken" -gt 0 ]; then
            printf ", ${RED}%d broken${NC}" "$broken"
        fi
        echo ")"
    done
    echo ""

    local canonical_count total_skills link_count
    canonical_count=$(echo "$all_data" | jq '[.skills[] | select(.location == ".agents/skills")] | length')
    total_skills=$(echo "$all_data" | jq '.skills | length')
    link_count=$(echo "$all_data" | jq '.skill_links | length')
    echo -e "${BOLD}── Skill Inventory ──${NC}"
    echo -e "  Canonical skills (in .agents/skills): ${BOLD}$canonical_count${NC}"
    echo -e "  Native agent-specific skills:         ${BOLD}$((total_skills - canonical_count))${NC}"
    echo -e "  Total unique real-directory skills:   ${BOLD}$total_skills${NC}"
    echo -e "  Symlink distribution links:           ${BOLD}$link_count${NC}"
    echo ""

    echo -e "${BOLD}── Provenance Signals ──${NC}"
    echo "$all_data" | jq -r '.skills | group_by(.provenance.kind) | .[] | "\(.[0].provenance.kind)|\(length)"' | while IFS='|' read -r kind count; do
        printf "  %-24s %3d\n" "$kind" "$count"
    done
    local collision_count
    collision_count=$(echo "$all_data" | jq '.name_collisions | length')
    if [ "$collision_count" -gt 0 ]; then
        echo -e "  ${YELLOW}Active name/version/content collisions:${NC} $collision_count"
    else
        echo "  Active name/version/content collisions: 0"
    fi
    echo ""

    local broken_count security_count load_blocker_count backup_count critical_count advisory_count
    broken_count=$(echo "$all_data" | jq '.broken_symlinks | length')
    security_count=$(echo "$all_data" | jq '[.skills[] | select((.risk_indicators // []) | length > 0)] | length')
    load_blocker_count=$(echo "$all_data" | jq '.runtime_load_blockers | length')
    backup_count=$(echo "$all_data" | jq '[.skills[] | select(any(.flags[]?; startswith("backup")))] | length')
    critical_count=$((broken_count + security_count + load_blocker_count + collision_count + collection_index_blocker_count))
    advisory_count=$backup_count
    echo -e "${BOLD}── Severity Summary ──${NC}"
    echo "  Critical signals:     $critical_count (load blockers: $load_blocker_count, collection INDEX blockers: $collection_index_blocker_count, broken symlinks: $broken_count, security review flags: $security_count, active collisions: $collision_count)"
    echo "  Advisory signals:     $advisory_count (backup/archive remnants)"
    echo "  Informational signals: topology, provenance, size, and age distributions below"
    echo -e "  ${DIM}Signals are not verdicts; validate high-priority paths directly before cleanup.${NC}"
    echo ""

    local flagged flagged_count
    flagged=$(echo "$all_data" | jq '[.skills[] | select(.flags | length > 0)]')
    flagged_count=$(echo "$flagged" | jq 'length')

    if [ "$flagged_count" -gt 0 ]; then
        echo -e "${BOLD}── Flagged Skills ──${NC}"
        printf "  ${DIM}%-30s %-20s %-8s %s${NC}\n" "NAME" "LOCATION" "WORDS" "FLAGS"
        printf "  ${DIM}%-30s %-20s %-8s %s${NC}\n" "----" "--------" "-----" "-----"
        echo "$flagged" | jq -r '.[] | "\(.name)|\(.location)|\(.word_count)|\(.flags | join(", "))"' | while IFS='|' read -r name loc words flags; do
            local color="$YELLOW"
            echo "$flags" | grep -qE 'destructive_root|privileged_command|pipe_to_shell|possible_secret|description_too_long|name_not_observed|description_not_observed' && color="$RED"
            printf "  ${color}%-30s${NC} %-20s %-8s %s\n" "${name:0:30}" "${loc:0:20}" "$words" "$flags"
        done
        echo ""
    fi

    if [ "$load_blocker_count" -gt 0 ]; then
        echo -e "${RED}${BOLD}── Runtime Load Blockers ──${NC}"
        echo "$all_data" | jq -r '.runtime_load_blockers[] | "  \(.name) in \(.location) -> \(.load_blockers | join(", ")) (\(.canonical_skill_file))"'
        echo ""
    fi

    if [ "$collection_index_blocker_count" -gt 0 ]; then
        echo -e "${RED}${BOLD}── Managed Collection INDEX Blockers ──${NC}"
        echo "$all_data" | jq -r '.collection_index_blockers[] | "  \(.collection_id) -> \(.error_code): \(.diagnostic) (\(.index_path))"'
        echo ""
    fi

    if [ "$broken_count" -gt 0 ]; then
        echo -e "${RED}${BOLD}── Broken Symlinks ──${NC}"
        echo "$all_data" | jq -r '.broken_symlinks[] | "  \(.dir_name) in \(.location) → \(.link_target)"'
        echo ""
    fi

    local backups
    backups=$(echo "$all_data" | jq -r '[.skills[] | select(any(.flags[]?; startswith("backup")))] | .[] | "  \(.dir_name) in \(.location) (\(.age_days)d old, \(.word_count)w)"')
    if [ -n "$backups" ]; then
        echo -e "${YELLOW}${BOLD}── Backup/Archive Remnants ──${NC}"
        echo "$backups"
        echo ""
    fi

    echo -e "${BOLD}── Size Distribution ──${NC}"
    local tiny small medium large xlarge
    tiny=$(echo "$all_data" | jq '[.skills[] | select(.word_count < 30)] | length')
    small=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 30 and .word_count < 200)] | length')
    medium=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 200 and .word_count < 1000)] | length')
    large=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 1000 and .word_count < 5000)] | length')
    xlarge=$(echo "$all_data" | jq '[.skills[] | select(.word_count >= 5000)] | length')
    echo "  <30w (possible stub): $tiny"
    echo "  30-200w (compact):   $small"
    echo "  200-1000w (typical): $medium"
    echo "  1000-5000w (large):  $large"
    echo "  >5000w (very large): $xlarge"
    echo ""

    echo -e "${BOLD}── Age Distribution ──${NC}"
    local fresh recent mature stale
    fresh=$(echo "$all_data" | jq '[.skills[] | select(.age_days <= 30)] | length')
    recent=$(echo "$all_data" | jq '[.skills[] | select(.age_days > 30 and .age_days <= 90)] | length')
    mature=$(echo "$all_data" | jq --argjson s "$STALE_DAYS" '[.skills[] | select(.age_days > 90 and .age_days <= $s)] | length')
    stale=$(echo "$all_data" | jq --argjson s "$STALE_DAYS" '[.skills[] | select(.age_days > $s)] | length')
    echo "  ≤30 days (fresh):      $fresh"
    echo "  31-90 days:            $recent"
    echo "  91-${STALE_DAYS} days:          $mature"
    echo "  >${STALE_DAYS} days (stale):     $stale"
    echo ""

    if [ "$collection_index_blocker_count" -gt 0 ]; then
        echo -e "${RED}[BLOCKED]${NC} Scan found an invalid controller-owned collection INDEX.json."
        return 1
    elif $report_written; then
        echo -e "${GREEN}[OK]${NC} Scan complete. JSON: ${CYAN}$REPORT_JSON${NC}"
    else
        echo -e "${GREEN}[OK]${NC} Scan complete. JSON report not written (--json/--no-write)."
    fi
    echo -e "${DIM}Feed this JSON to the AI for expert analysis. Findings are signals, not verdicts.${NC}"
}

initialize_scan_content_cache || true
main "$@"
