#!/usr/bin/env bash
set -euo pipefail
trap 'echo "autoloop: commit blocked because the guard itself failed at line $LINENO." >&2; exit 2' ERR

block() {
  echo "autoloop: commit blocked. $1" >&2
  exit 2
}

if [ "${1:-}" = --pre-commit ]; then
  cd "$(git rev-parse --show-toplevel)"
else
  input="$(cat)"
  command="$(jq -r '.tool_input.command // ""' <<< "$input" 2>/dev/null)" || command="$input"
  commit_pattern='(^|[;&|(`$[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+commit([[:space:]]|$)'
  [[ "$command" =~ $commit_pattern ]] || exit 0
  redirect_pattern='GIT_(INDEX_FILE|DIR|WORK_TREE|OBJECT_DIRECTORY|COMMON_DIR)=|--git-dir|--work-tree|--namespace'
  [[ "$command" =~ $redirect_pattern ]] && block "Commit commands may not point git at another index, git dir or work tree."
  cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
fi
empty_tree=4b825dc642cb6eb9a060e54bf8d69288fbee4904
head="$(git rev-parse -q --verify HEAD || echo "$empty_tree")"
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

while IFS= read -r -d '' path; do
  git --literal-pathspecs diff --quiet -- "$path" || block "$path has staged changes that differ from the working tree. Stage exactly what was verified."
done < <(git diff --cached --name-only -z --no-renames "$head")

infra=(.loop/config.json .loop/verify.sh .loop/guard-commit.sh .loop/init.sh)
for file in "${infra[@]}"; do
  git cat-file -e "HEAD:$file" 2>/dev/null || continue
  git diff --quiet HEAD -- "$file" || block "$file changed since the last commit. Loop config and scripts are fixed by init; a human changes them."
done

list=.loop/feature_list.json
if git cat-file -e "HEAD:$list" 2>/dev/null; then
  items='del(.features[]?.passes, .features[]?.evidence, .features[]?.depends_on, .features[]?.touches)'
  committed_items="$(git show "HEAD:$list" | jq -S "$items")"
  current_items="$(jq -S "$items" "$list")"
  [ "$committed_items" = "$current_items" ] || block "Items in $list were added, removed or reworded. A run may only change passes and evidence; depends_on and touches are free to edit."
fi

marker=.loop/tests-passed
[ -f "$marker" ] || block "Run 'bash .loop/verify.sh' first; the tests-passed marker is missing."
[ "$(cat "$marker")" = "$(loop_fingerprint)" ] || block "The code changed after the last verify. Run 'bash .loop/verify.sh' again."
