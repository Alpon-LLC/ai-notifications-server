#!/usr/bin/env bash
set -euo pipefail
profile="${1:?Usage: $0 /path/to/hermes-profile}"
source_file="$(cd "$(dirname "$0")/.." && pwd)/skills/github/alpon-github-pr-review/SKILL.md"
destination="$profile/skills/github/alpon-github-pr-review/SKILL.md"
if [[ -e "$destination" && "${FORCE:-0}" != 1 ]]; then echo "Refusing to overwrite $destination; set FORCE=1 explicitly." >&2; exit 3; fi
mkdir -p "$(dirname "$destination")"
cp "$source_file" "$destination"
printf 'Installed %s\n' "$destination"
