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
  frontmatter "$1" | awk -v key="$2" '
    block && /^[[:space:]]*$/ { next }
    block { if ($0 ~ /^[[:space:]]/) { sub(/^[[:space:]]+/, ""); print } exit }
    index($0, key ":") == 1 {
      value = substr($0, length(key) + 2)
      sub(/^[[:space:]]+/, "", value)
      if (value ~ /^[>|][-+]?[[:space:]]*$/) { block = 1; next }
      gsub(/^["'\'']|["'\'']$/, "", value)
      print value
      exit
    }'
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

kebab_file_names() {
  local bad
  [ -d "$root" ] || return 1
  bad="$(cd "$root" && { find bussin-* tests -type f ! -name SKILL.md ! -name .DS_Store 2>/dev/null || true; } | LC_ALL=C grep -v '/[a-z0-9.-]*$')" || return 0
  printf '%s\n' "$bad" | sed 's/^/     not kebab-case: /'
  return 1
}

retired_names='bussin-code-feature|ts-feature-architecture|drizzle-data-access|edefy-ui'
pocock='(tdd|code-review|test-audit|retro)'
before='(^|[^A-Za-z0-9_.-])'
after='([^A-Za-z0-9_.-]|$)'
pocock_refs="$before/$pocock$after|$before\`?$pocock\`?[[:space:]]+skill|$before(invoke|invokes|invoking|load|loads|use|uses|run|runs)[[:space:]]+(the[[:space:]]+)?\`?$pocock\`?$after"

no_retired_skill_refs() {
  local bad
  [ -d "$root" ] || return 1
  bad="$(cd "$root" && find . \( -path ./.git -o -path ./.loop -o -path ./evals/results \) -prune -o \
    -type f ! -path ./tests/skills-structure.test.sh -print0 |
    xargs -0 grep -lIE "$retired_names|$pocock_refs" 2>/dev/null || true)"
  [ -n "$bad" ] || return 0
  printf '%s\n' "$bad" | sed 's|^\./|     retired skill reference: |'
  return 1
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

check "file names under bussin-*/ and tests/ are kebab-case" kebab_file_names
check "no references to retired skills" no_retired_skill_refs

[ "$failures" = 0 ]
