#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
cfg=.loop/config.json
marker=.loop/tests-passed

rm -f "$marker"

test_cmd="$(jq -r '.commands.test // "npm test"' "$cfg")"
bash -c "$test_cmd"

if [ "$(jq -r '.gates.mutation // false' "$cfg")" = "true" ]; then
  base="$(jq -r '.base // "HEAD"' "$cfg")"
  set -f
  paths="$(jq -r '(.mutation_paths // ["src/**/*.ts", "src/**/*.tsx"]) | .[] | ":(glob)" + .' "$cfg")"
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

touch "$marker"
echo "autoloop: verify passed"
