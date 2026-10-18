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

marketplace_skills() {
  jq -r '.plugins[].skills[]?' "$root/.claude-plugin/marketplace.json" 2>/dev/null | sed 's|^\./||'
}

readme_skills() {
  awk '/^## / { on = ($0 == "## Included skills"); next } on' "$root/README.md" 2>/dev/null |
    sed -n 's/^- \[\([^]]*\)\].*/\1/p'
}

valid_json() { jq empty "$1" 2>/dev/null; }
listed_in() { "$2" | grep -xF "$1" >/dev/null; }
exists_on_disk() { [ -d "$root/$1" ]; }

check "marketplace.json is valid JSON" valid_json "$root/.claude-plugin/marketplace.json"

for dir in "$root"/bussin-*/; do
  dir="${dir%/}"
  skill="$(basename "$dir")"
  file="$dir/SKILL.md"
  check "$skill: SKILL.md opens with frontmatter" opens_with_frontmatter "$file"
  check "$skill: name matches directory" name_matches "$file" "$skill"
  check "$skill: description is non-empty" has_description "$file"
  check "$skill: listed in marketplace.json" listed_in "$skill" marketplace_skills
  check "$skill: listed in README Included skills" listed_in "$skill" readme_skills
done

while IFS= read -r entry; do
  check "marketplace.json entry $entry exists on disk" exists_on_disk "$entry"
done < <(marketplace_skills)

while IFS= read -r entry; do
  check "README Included skills entry $entry exists on disk" exists_on_disk "$entry"
done < <(readme_skills)

[ "$failures" = 0 ]
