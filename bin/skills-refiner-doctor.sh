#!/usr/bin/env bash
# Thin wrapper for contributors: forwards to skills/skill-debug/bin/skills-refiner-doctor.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SKILLS_REFINER_TOOLS_ROOT="${SKILLS_REFINER_TOOLS_ROOT:-$ROOT/skills}"
exec bash "$ROOT/skills/skill-debug/bin/skills-refiner-doctor.sh" "$@"
