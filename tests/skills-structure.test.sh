#!/usr/bin/env bash
set -euo pipefail

root="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then echo "ok   $label"; else echo "FAIL $label"; failures=$((failures + 1)); fi
}

frontmatter() {
  awk 'NR == 1 { if ($0 != "---") exit; next } $0 == "---" { exit } { print }' "$1"
}

field() {
  frontmatter "$1" | sed -n "s/^$2:[[:space:]]*//p" | head -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

opens_with_frontmatter() { [ -f "$1" ] && [ "$(head -n 1 "$1")" = "---" ]; }
name_matches() { [ -f "$1" ] && [ "$(field "$1" name)" = "$2" ]; }
has_description() { [ -f "$1" ] && [ -n "$(field "$1" description)" ]; }

for dir in "$root"/bussin-*/; do
  dir="${dir%/}"
  skill="$(basename "$dir")"
  file="$dir/SKILL.md"
  check "$skill: SKILL.md opens with frontmatter" opens_with_frontmatter "$file"
  check "$skill: name matches directory" name_matches "$file" "$skill"
  check "$skill: description is non-empty" has_description "$file"
done

[ "$failures" = 0 ]
