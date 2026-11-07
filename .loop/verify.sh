#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$(git rev-parse --show-toplevel)"
marker=.loop/tests-passed

loop_fingerprint() {
  local index
  index="$(mktemp)"
  rm -f "$index"
  GIT_INDEX_FILE="$index" git read-tree "$(git write-tree)"
  GIT_INDEX_FILE="$index" git add -A -- .
  GIT_INDEX_FILE="$index" git rm -r -q --cached --ignore-unmatch -- \
    .loop/tests-passed .loop/feature_list.json .loop/progress.md .loop/retro.md .loop/results \
    .loop/usage.jsonl .loop/live.json .loop/live.json.tmp
  GIT_INDEX_FILE="$index" git write-tree
  rm -f "$index"
}

config="$(git show HEAD:.loop/config.json 2>/dev/null || cat "$here/config.json")"
cfg() { jq -r "$1" <<< "$config"; }

rm -f "$marker"

test_cmd="$(cfg '.commands.test // "npm test"')"
bash -c "$test_cmd"

if [ "$(cfg '.gates.mutation // false')" = "true" ]; then
  if [ ! -f package.json ]; then
    echo "autoloop: gates.mutation is on, but there is no package.json; the mutation gate runs Stryker and needs a JS/TS test runner. Set gates.mutation to false in .loop/config.json." >&2
    exit 1
  fi
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
