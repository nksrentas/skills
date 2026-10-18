#!/usr/bin/env bash
set -euo pipefail

skill="$(cd "$(dirname "$0")/../bussin-autoloop" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
failures=0

check() {
  if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

make_project() {
  local dir="$1" test_command="$2" features="$3"
  mkdir -p "$dir/.loop" "$dir/bin" "$dir/src"
  cp "$skill/assets/verify.sh" "$skill/assets/guard-commit.sh" "$dir/.loop/"
  jq -n --arg test "$test_command" '{commands: {test: $test}, gates: {mutation: false}}' > "$dir/.loop/config.json"
  echo "$features" | jq . > "$dir/.loop/feature_list.json"
  printf '.loop/tests-passed\n' > "$dir/.gitignore"
  echo keep > "$dir/src/keep.txt"
  cat > "$dir/bin/claude" <<EOF
#!/usr/bin/env bash
id="\${2##* }"
echo "start \$id" >> "$dir/events"
sleep 2
target="\$(jq -r --arg id "\$id" '.features[] | select(.id == \$id) | .writes' .loop/feature_list.json)"
mkdir -p "\$(dirname "\$target")"
echo "\$id" > "\$target"
case "\$(jq -r --arg id "\$id" '.features[] | select(.id == \$id) | .tamper // ""' .loop/feature_list.json)" in
  flip) jq '.features |= map(.passes = true)' .loop/feature_list.json > .loop/f.tmp && mv .loop/f.tmp .loop/feature_list.json ;;
  script) echo 'exit 0' >> .loop/verify.sh ;;
esac
git add -A && git commit -qm "feat: \$id"
sha="\$(git rev-parse --short HEAD)"
mkdir -p .loop/results
if [ "\$(jq -r --arg id "\$id" '.features[] | select(.id == \$id) | .no_evidence // false' .loop/feature_list.json)" = true ]; then
  jq -n --arg id "\$id" '{id: \$id, passes: true}' > ".loop/results/\$id.json"
else
  jq -n --arg id "\$id" --arg sha "\$sha" '{id: \$id, passes: true, evidence: {commit: \$sha, ran: "mock"}, notes: "Did: \\(\$id)"}' > ".loop/results/\$id.json"
fi
git add -A && git commit -qm "chore(loop): result \$id"
echo "end \$id" >> "$dir/events"
EOF
  chmod +x "$dir/bin/claude"
  git -C "$dir" init -q
  git -C "$dir" add -A
  git -C "$dir" commit -qm init
}

run_loop() {
  local dir="$1"
  shift
  (cd "$dir" && env "$@" PATH="$dir/bin:$PATH" LOOP_POLL_SECONDS=1 LIMIT_WAIT=0 bash "$skill/scripts/loop.sh" > "$dir/out" 2>&1)
}

line_of() { grep -n "^$2\$" "$1/events" | head -1 | cut -d: -f1; }

happy="$tmp/happy"
make_project "$happy" true '{"features": [
  {"id": "A", "passes": false, "evidence": null, "touches": ["src/a/**"], "writes": "src/a/a.txt"},
  {"id": "B", "passes": false, "evidence": null, "touches": ["src/b/**"], "writes": "src/b/b.txt"},
  {"id": "C", "passes": false, "evidence": null, "depends_on": ["A"], "touches": ["src/a/**"], "writes": "src/a/c.txt"},
  {"id": "D", "passes": false, "evidence": null, "touches": ["src/b/d.txt"], "writes": "src/b/d.txt"}
]}'
happy_status=0
run_loop "$happy" LOOP_WORKERS=2 || happy_status=$?
check "parallel run finishes" '[ "$happy_status" = 0 ]'
check "independent items run at the same time" '[ "$(line_of "$happy" "start B")" -lt "$(line_of "$happy" "end A")" ]'
check "an item waits for its dependency" '[ "$(line_of "$happy" "start C")" -gt "$(line_of "$happy" "end A")" ]'
check "items with overlapping touches never overlap" '[ "$(line_of "$happy" "start D")" -gt "$(line_of "$happy" "end B")" ]'
check "every item is marked passing with evidence" '[ "$(jq "[.features[] | select(.passes and (.evidence.commit | length > 0))] | length" "$happy/.loop/feature_list.json")" = 4 ]'
check "all work is merged into the main branch" '[ -f "$happy/src/a/a.txt" ] && [ -f "$happy/src/a/c.txt" ] && [ -f "$happy/src/b/b.txt" ] && [ -f "$happy/src/b/d.txt" ]'
check "progress gets one entry per item" '[ "$(grep -c "^## " "$happy/.loop/progress.md")" = 4 ]'
check "result files are cleaned up" '[ ! -d "$happy/.loop/results" ] || [ -z "$(ls -A "$happy/.loop/results")" ]'
check "worktrees and branches are cleaned up" '[ "$(git -C "$happy" worktree list | wc -l | tr -d " ")" = 1 ] && [ -z "$(git -C "$happy" branch --list "loop/*")" ]'

cycle="$tmp/cycle"
make_project "$cycle" true '{"features": [
  {"id": "X", "passes": false, "evidence": null, "depends_on": ["Y"], "writes": "src/x.txt"},
  {"id": "Y", "passes": false, "evidence": null, "depends_on": ["X", "Z"], "writes": "src/y.txt"}
]}'
cycle_status=0
run_loop "$cycle" LOOP_WORKERS=2 || cycle_status=$?
check "a dependency cycle stops with a report" '[ "$cycle_status" != 0 ] && grep -q "X: waiting for Y" "$cycle/out" && grep -q "Z (unknown id)" "$cycle/out"'
check "nothing runs when every item is blocked" '[ ! -f "$cycle/events" ]'

gate="$tmp/gate"
make_project "$gate" '! test -e src/broken.txt' '{"features": [
  {"id": "E", "passes": false, "evidence": null, "touches": ["src/broken.txt"], "writes": "src/broken.txt"},
  {"id": "F", "passes": false, "evidence": null, "touches": ["src/fine.txt"], "writes": "src/fine.txt"}
]}'
gate_status=0
run_loop "$gate" LOOP_WORKERS=2 LOOP_ITEM_ATTEMPTS=2 || gate_status=$?
check "an item that breaks the merged gate is not merged" '[ "$gate_status" != 0 ] && [ ! -e "$gate/src/broken.txt" ] && grep -q "failed the gate" "$gate/out"'
check "it is retried up to the attempt limit, then reported" '[ "$(grep -c "^start E$" "$gate/events")" = 2 ] && grep -q "E: gave up after 2 attempts" "$gate/out"'
check "other items still merge" '[ -f "$gate/src/fine.txt" ] && [ "$(jq -r ".features[] | select(.id == \"F\") | .passes" "$gate/.loop/feature_list.json")" = true ]'

bare="$tmp/bare"
make_project "$bare" true '{"features": [{"id": "N", "passes": false, "evidence": null, "no_evidence": true, "writes": "src/n.txt"}]}'
bare_status=0
run_loop "$bare" LOOP_WORKERS=2 LOOP_ITEM_ATTEMPTS=1 || bare_status=$?
check "a pass reported without evidence is not merged" '[ "$bare_status" != 0 ] && [ ! -e "$bare/src/n.txt" ] && [ "$(jq -r ".features[0].passes" "$bare/.loop/feature_list.json")" = false ]'

tamper="$tmp/tamper"
make_project "$tamper" true '{"features": [
  {"id": "T1", "passes": false, "evidence": null, "tamper": "flip", "touches": ["src/t1.txt"], "writes": "src/t1.txt"},
  {"id": "T2", "passes": false, "evidence": null, "depends_on": ["T1"], "touches": ["src/t2.txt"], "writes": "src/t2.txt"},
  {"id": "T3", "passes": false, "evidence": null, "tamper": "script", "touches": ["src/t3.txt"], "writes": "src/t3.txt"}
]}'
tamper_status=0
run_loop "$tamper" LOOP_WORKERS=2 LOOP_ITEM_ATTEMPTS=1 || tamper_status=$?
check "a worker cannot mark other items as passing" '[ "$(grep -c "^start T2$" "$tamper/events")" = 1 ] && [ -f "$tamper/src/t2.txt" ]'
check "a worker that edits loop scripts is not merged" '[ "$tamper_status" != 0 ] && [ ! -e "$tamper/src/t3.txt" ] && grep -q "T3 changed files under .loop or .claude" "$tamper/out" && [ "$(git -C "$tamper" show HEAD:.loop/verify.sh | tail -1)" != "exit 0" ]'

cap="$tmp/cap"
make_project "$cap" true '{"features": [{"id": "A", "passes": false, "evidence": null, "writes": "src/a.txt"}]}'
cap_status=0
run_loop "$cap" LOOP_WORKERS=9 || cap_status=$?
check "worker count above the cap is refused" '[ "$cap_status" != 0 ] && grep -q "above the cap of 8" "$cap/out"'

[ "$failures" = 0 ] && echo "all parallel checks passed" || { echo "$failures parallel checks failed"; exit 1; }
