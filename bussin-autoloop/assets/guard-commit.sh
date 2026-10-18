#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
source "$here/fingerprint.sh"

command="$(jq -r '.tool_input.command // ""')"
commit_pattern='(^|[;&|(`$[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit([[:space:]]|$)'
[[ "$command" =~ $commit_pattern ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

block() {
  echo "autoloop: commit blocked. $1" >&2
  exit 2
}

infra=(.loop/config.json .loop/verify.sh .loop/guard-commit.sh .loop/fingerprint.sh)
for file in "${infra[@]}"; do
  git cat-file -e "HEAD:$file" 2>/dev/null || continue
  git diff --quiet HEAD -- "$file" || block "$file changed since the last commit. Loop config and scripts are fixed by init; a human changes them."
done

list=.loop/feature_list.json
if git cat-file -e "HEAD:$list" 2>/dev/null; then
  items='del(.features[]?.passes, .features[]?.evidence)'
  committed="$(git show "HEAD:$list" | jq -S "$items")"
  current="$(jq -S "$items" "$list")"
  [ "$committed" = "$current" ] || block "Items in $list were added, removed or reworded. A run may only change passes and evidence."
fi

marker=.loop/tests-passed
[ -f "$marker" ] || block "Run 'bash .loop/verify.sh' first; the tests-passed marker is missing."
[ "$(cat "$marker")" = "$(loop_fingerprint)" ] || block "The code changed after the last verify. Run 'bash .loop/verify.sh' again."
