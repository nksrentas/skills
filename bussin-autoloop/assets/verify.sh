#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$(git rev-parse --show-toplevel)"
marker=.loop/tests-passed

committed() { git show "HEAD:.loop/$1" 2>/dev/null || cat "$here/$1"; }
eval "$(committed fingerprint.sh)"
config="$(committed config.json)"
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
