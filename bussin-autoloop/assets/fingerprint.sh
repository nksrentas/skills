#!/usr/bin/env bash

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
