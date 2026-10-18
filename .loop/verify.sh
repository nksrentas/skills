#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$(git rev-parse --show-toplevel)"
marker=.loop/tests-passed

loop_fingerprint() {
  local index
  index="$(mktemp)"
  cp "$(git rev-parse --git-path index)" "$index" 2>/dev/null || rm -f "$index"
  GIT_INDEX_FILE="$index" git add -A -- .
  GIT_INDEX_FILE="$index" git rm -q --cached --ignore-unmatch -- \
    .loop/tests-passed .loop/feature_list.json .loop/progress.md .loop/retro.md
  GIT_INDEX_FILE="$index" git write-tree
  rm -f "$index"
}

config="$(git show HEAD:.loop/config.json 2>/dev/null || cat "$here/config.json")"
cfg() { jq -r "$1" <<< "$config"; }

rm -f "$marker"

test_cmd="$(cfg '.commands.test // "npm test"')"
bash -c "$test_cmd"

if [ "$(cfg '.gates.mutation // false')" = "true" ]; then
  base="$(cfg '.base // "HEAD"')"
  set -f
  paths="$(cfg '(.mutation_paths // ["src/**/*.ts", "src/**/*.tsx"]) | .[] | ":(glob)" + .')"
  excludes=(':(exclude,glob)**/*.test.*' ':(exclude,glob)**/*.spec.*' ':(exclude,glob)**/*.d.ts')
  changed="$( {
    git diff --name-only --diff-filter=AM "$base" -- $paths "${excludes[@]}"
    git ls-files --others --exclude-standard -- $paths "${excludes[@]}"
  } | sort -u | paste -sd, -)"
  set +f
  if [ -n "$changed" ]; then
    npx stryker run --incremental --mutate "$changed"
  else
    echo "autoloop: no implementation files changed since $base, mutation skipped"
  fi
fi

loop_fingerprint > "$marker"
echo "autoloop: verify passed"
