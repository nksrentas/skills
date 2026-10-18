#!/usr/bin/env bash
set -euo pipefail
trap 'echo "autoloop: commit blocked because the guard itself failed at line $LINENO." >&2; exit 2' ERR

input="$(cat)"
command="$(jq -r '.tool_input.command // ""' <<< "$input" 2>/dev/null)" || command="$input"
commit_pattern='(^|[;&|(`$[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit([[:space:]]|$)'
[[ "$command" =~ $commit_pattern ]] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
empty_tree=4b825dc642cb6eb9a060e54bf8d69288fbee4904
head="$(git rev-parse -q --verify HEAD || echo "$empty_tree")"
committed() { git show "HEAD:.loop/$1" 2>/dev/null || cat ".loop/$1"; }
eval "$(committed fingerprint.sh)"

block() {
  echo "autoloop: commit blocked. $1" >&2
  exit 2
}

while IFS= read -r path; do
  [ -z "$path" ] || git diff --quiet -- "$path" || block "$path has staged changes that differ from the working tree. Stage exactly what was verified."
done <<< "$(git diff --cached --name-only "$head")"

infra=(.loop/config.json .loop/verify.sh .loop/guard-commit.sh .loop/fingerprint.sh)
for file in "${infra[@]}"; do
  git cat-file -e "HEAD:$file" 2>/dev/null || continue
  git diff --quiet HEAD -- "$file" || block "$file changed since the last commit. Loop config and scripts are fixed by init; a human changes them."
done

list=.loop/feature_list.json
if git cat-file -e "HEAD:$list" 2>/dev/null; then
  items='del(.features[]?.passes, .features[]?.evidence)'
  committed_items="$(git show "HEAD:$list" | jq -S "$items")"
  current_items="$(jq -S "$items" "$list")"
  [ "$committed_items" = "$current_items" ] || block "Items in $list were added, removed or reworded. A run may only change passes and evidence."
fi

marker=.loop/tests-passed
[ -f "$marker" ] || block "Run 'bash .loop/verify.sh' first; the tests-passed marker is missing."
[ "$(cat "$marker")" = "$(loop_fingerprint)" ] || block "The code changed after the last verify. Run 'bash .loop/verify.sh' again."
