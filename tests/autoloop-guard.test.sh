#!/usr/bin/env bash
set -euo pipefail

assets="$(cd "$(dirname "$0")/../bussin-autoloop/assets" && pwd)"
repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
cd "$repo"

git init -q
git config user.email loop@test
git config user.name loop
mkdir -p .loop src
cp "$assets/verify.sh" "$assets/guard-commit.sh" "$assets/fingerprint.sh" .loop/
echo '{"commands":{"test":"true"},"gates":{"mutation":false}}' > .loop/config.json
echo '{"features":[{"id":"F1","description":"export csv","passes":false,"evidence":null}]}' > .loop/feature_list.json
echo '.loop/tests-passed' > .gitignore
echo 'export const a = 1' > src/a.ts
git add -A
git commit -qm init

failures=0
guard() {
  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" \
    | CLAUDE_PROJECT_DIR="$repo" bash .loop/guard-commit.sh 2>/dev/null
}
expect() {
  local want="$1" label="$2" command="$3" got=0
  guard "$command" || got=$?
  if [ "$got" = "$want" ]; then echo "ok   $label"; else echo "FAIL $label (exit $got, want $want)"; failures=$((failures + 1)); fi
}
commit_now() { git add -A && git commit -qm "$1"; }

expect 0 "non-commit command passes" "git status"
expect 0 "git log mentioning commit passes" "git log --grep commit"
expect 2 "commit without marker is blocked" "git commit -m x"
expect 2 "commit through -C is blocked" "git -C . commit -m x"
expect 2 "commit after cd is blocked" "cd src && git commit -m x"

echo 'export const a = 2' > src/a.ts
bash .loop/verify.sh >/dev/null
expect 0 "commit after verify passes" "git commit -m x"

echo 'export const a = 3' > src/a.ts
expect 2 "edit through the shell after verify is blocked" "git commit -m x"

echo forged > .loop/tests-passed
expect 2 "forged marker is blocked" "git commit -m x"

bash .loop/verify.sh >/dev/null
git add src/a.ts
expect 0 "staging after verify still passes" "git commit -m x"
commit_now "implement F1"

jq '.features[0].passes = true | .features[0].evidence = {"commit":"abc"}' .loop/feature_list.json > .loop/f.tmp && mv .loop/f.tmp .loop/feature_list.json
echo "## Session 1" > .loop/progress.md
expect 0 "marking passes and writing progress needs no new verify" "git commit -m mark"
commit_now "mark F1"

jq '.features[0].description = "something easier"' .loop/feature_list.json > .loop/f.tmp && mv .loop/f.tmp .loop/feature_list.json
bash .loop/verify.sh >/dev/null
expect 2 "rewording an item is blocked" "git commit -m x"
git checkout -q .loop/feature_list.json

jq '.features = []' .loop/feature_list.json > .loop/f.tmp && mv .loop/f.tmp .loop/feature_list.json
bash .loop/verify.sh >/dev/null
expect 2 "deleting items is blocked" "git commit -m x"
git checkout -q .loop/feature_list.json

jq '.commands.test = "true # skipped"' .loop/config.json > .loop/c.tmp && mv .loop/c.tmp .loop/config.json
bash .loop/verify.sh >/dev/null
expect 2 "weakening the config is blocked" "git commit -m x"
git checkout -q .loop/config.json

echo 'exit 0' >> .loop/verify.sh
expect 2 "editing verify.sh is blocked" "git commit -m x"
git checkout -q .loop/verify.sh

echo '{"commands":{"test":"false"},"gates":{"mutation":false}}' > "$repo/failing.json"
cp .loop/config.json "$repo/config.bak" && cp "$repo/failing.json" .loop/config.json
rm -f .loop/tests-passed
bash .loop/verify.sh >/dev/null 2>&1 || true
[ ! -f .loop/tests-passed ] && echo "ok   failing tests leave no marker" || { echo "FAIL failing tests left a marker"; failures=$((failures + 1)); }
cp "$repo/config.bak" .loop/config.json

[ "$failures" = 0 ] && echo "all guard checks passed" || { echo "$failures guard checks failed"; exit 1; }
