#!/usr/bin/env bash
# Thin wrapper for contributors: forwards to skills/skill-debug/bin/skills-refiner-doctor.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT/skills/skill-debug/bin/skills-refiner-doctor.sh" "$@"
