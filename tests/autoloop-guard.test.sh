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
cp "$assets/verify.sh" "$assets/guard-commit.sh" .loop/
echo '{"commands":{"test":"true"},"gates":{"mutation":false}}' > .loop/config.json
echo '{"features":[{"id":"F1","description":"export csv","passes":false,"evidence":null}]}' > .loop/feature_list.json
printf '.loop/tests-passed\n.guard-stderr\n' > .gitignore
echo 'export const a = 1' > src/a.ts
git add -A
git commit -qm init

failures=0
hook_command="$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$assets/hooks.json")"
guard() {
  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" \
    | CLAUDE_PROJECT_DIR="$repo" bash -c "$hook_command" 2>"$repo/.guard-stderr"
}
expect() {
  local want="$1" label="$2" command="$3" got=0
  guard "$command" || got=$?
  if [ "$got" = "$want" ]; then
    echo "ok   $label"
  else
    echo "FAIL $label (exit $got, want $want): $(cat "$repo/.guard-stderr")"
    failures=$((failures + 1))
  fi
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

jq '.features[0].depends_on = ["F0"] | .features[0].touches = ["src/**"]' .loop/feature_list.json > .loop/f.tmp && mv .loop/f.tmp .loop/feature_list.json
mkdir -p .loop/results && echo '{"id":"F1","passes":true}' > .loop/results/F1.json
echo '{"item":"F1"}' > .loop/usage.jsonl && echo '{"state":"running"}' > .loop/live.json
expect 0 "editing depends_on and touches and writing result, usage and live files need no new verify" "git commit -m schedule"
git checkout -q .loop/feature_list.json && rm -rf .loop/results .loop/usage.jsonl .loop/live.json

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

printf '#!/usr/bin/env bash\nexit 0\n' > .loop/guard-commit.sh
echo 'export const a = 4' > src/a.ts
expect 2 "a gutted guard in the working tree is ignored" "git commit -m x"
git checkout -q .loop/guard-commit.sh

echo '*.conf' >> .gitignore && echo 'mode=safe' > app.conf && git add -f app.conf .gitignore && git commit -qm "track an ignored config" --no-verify
bash .loop/verify.sh >/dev/null
echo 'mode=unsafe' > app.conf
expect 2 "an edit to a tracked file that matches an ignore rule is blocked" "git commit -am x"
git checkout -q app.conf

echo 'export const a = 5' > src/a.ts
bash .loop/verify.sh >/dev/null
echo 'export const a = "unverified"' > src/a.ts && git add src/a.ts && echo 'export const a = 5' > src/a.ts
expect 2 "staged code that differs from the verified working tree is blocked" "git commit -m x"
git reset -q src/a.ts

echo 'exit 0' >> .loop/verify.sh && git add .loop/verify.sh && git show HEAD:.loop/verify.sh > .loop/verify.sh
expect 2 "a staged loop-script edit hidden behind a clean working tree is blocked" "git commit -m x"
git reset -q .loop/verify.sh
git checkout -q src/a.ts

weird=$'src/we"ird\tname.ts'
echo 'export const w = 1' > "$weird" && git add "$weird" && git commit -qm "add weird file" --no-verify
bash .loop/verify.sh >/dev/null
echo 'export const w = "unverified"' > "$weird" && git add "$weird" && echo 'export const w = 1' > "$weird"
expect 2 "a staged change to a file name git would quote is blocked" "git commit -m x"
git reset -q -- "$weird"

:
magic=':(exclude)*'
echo 'export const m = 1' > "$magic" && git --literal-pathspecs add -- "$magic" && git commit -qm "add magic-named file" --no-verify
bash .loop/verify.sh >/dev/null
echo 'export const m = "unverified"' > "$magic" && git --literal-pathspecs add -- "$magic" && echo 'export const m = 1' > "$magic"
expect 2 "a staged change to a file named like pathspec magic is blocked" "git commit -m x"
git --literal-pathspecs reset -q -- "$magic"

bash .loop/verify.sh >/dev/null
expect 2 "a commit against another index is blocked" "GIT_INDEX_FILE=/tmp/other git commit -m x"
expect 2 "a commit with --git-dir is blocked" "git --git-dir=.git --work-tree=. commit -m x"
expect 0 "commit -a after verify passes" "git commit -am x"

if printf '{"tool_input":{"command":"git commit -m x"}}' | CLAUDE_PROJECT_DIR="$repo/missing" bash -c "$hook_command" 2>/dev/null; then
  echo "FAIL a guard that cannot run lets the commit through"; failures=$((failures + 1))
else
  echo "ok   a guard that cannot run blocks the commit"
fi

fresh="$(mktemp -d)"
(
  cd "$fresh" && git init -q && mkdir .loop
  cp "$assets/verify.sh" "$assets/guard-commit.sh" .loop/
  echo '{"commands":{"test":"true"},"gates":{"mutation":false}}' > .loop/config.json
  echo '{"features":[]}' > .loop/feature_list.json
  echo '.loop/tests-passed' > .gitignore
  git add -A
)
fresh_guard() { printf '{"tool_input":{"command":"git commit -m init"}}' | CLAUDE_PROJECT_DIR="$fresh" bash -c "$hook_command" 2>/dev/null; }
if fresh_guard; then echo "FAIL init commit in a repo with no commits passed without verify"; failures=$((failures + 1)); else echo "ok   init commit in a repo with no commits needs verify"; fi
(cd "$fresh" && bash .loop/verify.sh >/dev/null)
if fresh_guard; then echo "ok   init commit passes after verify"; else echo "FAIL init commit blocked after verify"; failures=$((failures + 1)); fi
rm -rf "$fresh"

jq '.commands.test = "exit 1"' .loop/config.json > .loop/c.tmp && mv .loop/c.tmp .loop/config.json
rm -f .loop/tests-passed
bash .loop/verify.sh >/dev/null 2>&1 && echo "ok   verify runs the committed test command, not the working-tree one" || { echo "FAIL verify used the working-tree config"; failures=$((failures + 1)); }
git checkout -q .loop/config.json src/a.ts

git add -A && git commit -qm "make tests fail" --allow-empty
echo '{"commands":{"test":"false"},"gates":{"mutation":false}}' > "$repo/failing.json"
cp .loop/config.json "$repo/config.bak" && cp "$repo/failing.json" .loop/config.json
git -c core.hooksPath=/dev/null commit -qam "committed failing test command"
rm -f .loop/tests-passed
bash .loop/verify.sh >/dev/null 2>&1 || true
[ ! -f .loop/tests-passed ] && echo "ok   failing tests leave no marker" || { echo "FAIL failing tests left a marker"; failures=$((failures + 1)); }
cp "$repo/config.bak" .loop/config.json

echo '{"commands":{"test":"true"},"gates":{"mutation":true}}' > .loop/config.json
git -c core.hooksPath=/dev/null commit -qam "mutation on without package.json"
mutation_out="$(bash .loop/verify.sh 2>&1 || true)"
grep -q "gates.mutation is on, but there is no package.json" <<< "$mutation_out" && [ ! -f .loop/tests-passed ] && echo "ok   mutation without package.json fails with a clear message" || { echo "$mutation_out"; echo "FAIL mutation without package.json"; failures=$((failures + 1)); }
cp "$repo/config.bak" .loop/config.json

[ "$failures" = 0 ] && echo "all guard checks passed" || { echo "$failures guard checks failed"; exit 1; }
