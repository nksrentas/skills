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
if [ "\$(jq -r --arg id "\$id" '.features[] | select(.id == \$id) | .stop // false' .loop/feature_list.json)" = true ]; then
  bash "$skill/scripts/loop-status.sh" --stop "\$LOOP_MAIN_DIR" > /dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "\$(jq -r .state "\$LOOP_MAIN_DIR/.loop/live.json")" = stopping ] && { echo "saw stopping" >> "$dir/events"; break; }
    sleep 1
  done
fi
sleep 2
target="\$(jq -r --arg id "\$id" '.features[] | select(.id == \$id) | .writes' .loop/feature_list.json)"
mkdir -p "\$(dirname "\$target")"
echo "\$id" > "\$target"
case "\$(jq -r --arg id "\$id" '.features[] | select(.id == \$id) | .tamper // ""' .loop/feature_list.json)" in
  flip) jq '.features |= map(.passes = true)' .loop/feature_list.json > .loop/f.tmp && mv .loop/f.tmp .loop/feature_list.json ;;
  script) echo 'exit 0' >> .loop/verify.sh ;;
  redirect) echo "\$(pwd)/elsewhere" > "\$(git rev-parse --absolute-git-dir)/gitdir" ;;
esac
bash .loop/verify.sh > /dev/null 2>&1 || true
bypass=()
[ "\$(jq -r --arg id "\$id" '.features[] | select(.id == \$id) | .bypass // false' .loop/feature_list.json)" = true ] && bypass=(--no-verify)
git add -A && git commit -qm "feat: \$id" \${bypass[@]+"\${bypass[@]}"}
sha="\$(git rev-parse --short HEAD)"
mkdir -p .loop/results
if [ "\$(jq -r --arg id "\$id" '.features[] | select(.id == \$id) | .no_evidence // false' .loop/feature_list.json)" = true ]; then
  jq -n --arg id "\$id" '{id: \$id, passes: true}' > ".loop/results/\$id.json"
else
  jq -n --arg id "\$id" --arg sha "\$sha" '{id: \$id, passes: true, evidence: {commit: \$sha, ran: "mock"}, notes: "Did: \\(\$id)"}' > ".loop/results/\$id.json"
fi
git add -A && git commit -qm "chore(loop): result \$id" \${bypass[@]+"\${bypass[@]}"}
echo "end \$id" >> "$dir/events"
printf '{"type":"result","duration_ms":120000,"num_turns":9,"total_cost_usd":0.5,"usage":{"input_tokens":1,"output_tokens":1},"modelUsage":{"claude-opus-5-5":{"inputTokens":1000,"outputTokens":200,"cacheReadInputTokens":5000,"cacheCreationInputTokens":300,"costUSD":0.5}}}\n'
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
check "every session is recorded with tokens, cost and model" '[ "$(wc -l < "$happy/.loop/usage.jsonl" | tr -d " ")" = 4 ] && [ "$(jq -s "map(.input_tokens) | add" "$happy/.loop/usage.jsonl")" = 4000 ] && [ "$(jq -s "map(.cost_usd) | add" "$happy/.loop/usage.jsonl")" = 2 ] && [ "$(jq -s -r "map(.models | keys[]) | unique | join(\",\")" "$happy/.loop/usage.jsonl")" = claude-opus-5-5 ]'
check "merged sessions are recorded as merged with their worker" '[ "$(jq -s "map(select(.outcome == \"merged\" and .worker >= 1)) | length" "$happy/.loop/usage.jsonl")" = 4 ]'
check "live state ends as finished with nothing running" '[ "$(jq -r ".state" "$happy/.loop/live.json")" = finished ] && [ "$(jq ".running | length" "$happy/.loop/live.json")" = 0 ] && [ "$(jq -r ".mode" "$happy/.loop/live.json")" = parallel ]'
check "worktrees and branches are cleaned up" '[ "$(git -C "$happy" worktree list | wc -l | tr -d " ")" = 1 ] && [ -z "$(git -C "$happy" branch --list "loop/*")" ]'

cycle="$tmp/cycle"
make_project "$cycle" true '{"features": [
  {"id": "X", "passes": false, "evidence": null, "depends_on": ["Y"], "writes": "src/x.txt"},
  {"id": "Y", "passes": false, "evidence": null, "depends_on": ["X", "Z"], "writes": "src/y.txt"}
]}'
cycle_status=0
run_loop "$cycle" LOOP_WORKERS=2 || cycle_status=$?
check "a blocked run leaves the live state as stopped" '[ "$(jq -r ".state" "$cycle/.loop/live.json")" = stopped ]'
check "a dependency cycle stops with a report" '[ "$cycle_status" != 0 ] && grep -q "X: waiting for Y" "$cycle/out" && grep -q "Z (unknown id)" "$cycle/out"'
check "nothing runs when every item is blocked" '[ ! -f "$cycle/events" ]'

gate="$tmp/gate"
make_project "$gate" '! test -e src/broken.txt' '{"features": [
  {"id": "E", "passes": false, "evidence": null, "bypass": true, "touches": ["src/broken.txt"], "writes": "src/broken.txt"},
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
  {"id": "T3", "passes": false, "evidence": null, "tamper": "script", "bypass": true, "touches": ["src/t3.txt"], "writes": "src/t3.txt"}
]}'
tamper_status=0
run_loop "$tamper" LOOP_WORKERS=2 LOOP_ITEM_ATTEMPTS=1 || tamper_status=$?
check "a worker cannot mark other items as passing" '[ "$(grep -c "^start T2$" "$tamper/events")" = 1 ] && [ -f "$tamper/src/t2.txt" ]'
check "a worker that edits loop scripts is not merged" '[ "$tamper_status" != 0 ] && [ ! -e "$tamper/src/t3.txt" ] && grep -q "T3 changed files under .loop or .claude" "$tamper/out" && [ "$(git -C "$tamper" show HEAD:.loop/verify.sh | tail -1)" != "exit 0" ]'

redirect="$tmp/redirect"
make_project "$redirect" true '{"features": [{"id": "R", "passes": false, "evidence": null, "tamper": "redirect", "writes": "src/r.txt"}]}'
redirect_status=0
run_loop "$redirect" LOOP_WORKERS=2 || redirect_status=$?
check "a worker that rewrites its worktree pointers stops the loop" '[ "$redirect_status" != 0 ] && grep -q "changed its worktree" "$redirect/out" && [ "$(jq -r ".features[0].passes" "$redirect/.loop/feature_list.json")" = false ]'

seq="$tmp/sequential"
make_project "$seq" true '{"features": [
  {"id": "S1", "passes": false, "evidence": null, "writes": "src/s1.txt"},
  {"id": "S2", "passes": false, "evidence": null, "writes": "src/s2.txt"}
]}'
cat > "$seq/bin/claude" <<EOF
#!/usr/bin/env bash
id="\$(jq -r '[.features[] | select(.passes == false)][0].id' .loop/feature_list.json)"
echo "\$id" > "src/\$id.txt"
jq --arg id "\$id" '(.features[] | select(.id == \$id)) |= (.passes = true | .evidence = {commit: "x"})' .loop/feature_list.json > .loop/f.tmp && mv .loop/f.tmp .loop/feature_list.json
bash .loop/verify.sh > /dev/null
git add -A && git commit -qm "feat: \$id"
printf '{"type":"result","duration_ms":60000,"num_turns":4,"total_cost_usd":0.25,"modelUsage":{"claude-sonnet-5-5":{"inputTokens":700,"outputTokens":90,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"costUSD":0.25}}}\n'
EOF
chmod +x "$seq/bin/claude"
seq_status=0
run_loop "$seq" LOOP_WORKERS=1 || seq_status=$?
check "the sequential loop records each session as passed" '[ "$seq_status" = 0 ] && [ "$(jq -s -r "map(.item + \":\" + .outcome) | join(\",\")" "$seq/.loop/usage.jsonl")" = "S1:passed,S2:passed" ]'
check "the sequential loop records tokens, cost and model" '[ "$(jq -s "map(.output_tokens) | add" "$seq/.loop/usage.jsonl")" = 180 ] && [ "$(jq -s "map(.cost_usd) | add" "$seq/.loop/usage.jsonl")" = 0.5 ] && [ "$(jq -r ".state" "$seq/.loop/live.json")" = finished ]'
check "telemetry files are kept out of commits through info/exclude" 'grep -qxF /.loop/usage.jsonl "$seq/.git/info/exclude" && grep -qxF /.loop/live.json "$seq/.git/info/exclude" && [ -z "$(git -C "$seq" status --porcelain .loop/usage.jsonl .loop/live.json)" ]'
check "the sequential loop prints a summary per session" 'grep -q "autoloop: S1 passed after 1m, \$0.25, 700 in / 90 out tokens" "$seq/out"'

drain="$tmp/drain"
make_project "$drain" true '{"features": [
  {"id": "P1", "passes": false, "evidence": null, "stop": true, "touches": ["src/p1.txt"], "writes": "src/p1.txt"},
  {"id": "P2", "passes": false, "evidence": null, "touches": ["src/p2.txt"], "writes": "src/p2.txt"},
  {"id": "P3", "passes": false, "evidence": null, "touches": ["src/p3.txt"], "writes": "src/p3.txt"}
]}'
drain_status=0
run_loop "$drain" LOOP_WORKERS=2 || drain_status=$?
check "a stop request drains the running workers and exits 0" '[ "$drain_status" = 0 ] && grep -q "stopped on request" "$drain/out"'
check "the live state says stopping while workers drain" 'grep -q "^saw stopping$" "$drain/events"'
check "running items still merge after a stop request" '[ -f "$drain/src/p1.txt" ] && [ -f "$drain/src/p2.txt" ] && [ "$(jq "[.features[] | select(.passes)] | length" "$drain/.loop/feature_list.json")" = 2 ]'
check "no new worker starts after a stop request" '! grep -q "^start P3$" "$drain/events"'
check "a drained loop ends as stopped and clears the request" '[ "$(jq -r ".state" "$drain/.loop/live.json")" = stopped ] && [ ! -e "$drain/.loop/stop" ] && [ -z "$(git -C "$drain" status --porcelain .loop)" ]'
check "attempt counts are kept in .loop/attempts.json" '[ "$(jq -c . "$drain/.loop/attempts.json")" = "{\"P1\":1,\"P2\":1}" ] || [ "$(jq -c . "$drain/.loop/attempts.json")" = "{\"P2\":1,\"P1\":1}" ]'
resume_status=0
run_loop "$drain" LOOP_WORKERS=2 || resume_status=$?
check "running loop.sh again resumes and finishes" '[ "$resume_status" = 0 ] && [ -f "$drain/src/p3.txt" ] && [ "$(jq -r ".state" "$drain/.loop/live.json")" = finished ]'
check "attempt counts are deleted once every item passes" '[ ! -e "$drain/.loop/attempts.json" ]'

spent="$tmp/spent"
make_project "$spent" true '{"features": [{"id": "G", "passes": false, "evidence": null, "writes": "src/g.txt"}]}'
echo '{"G": 2}' > "$spent/.loop/attempts.json"
spent_status=0
run_loop "$spent" LOOP_WORKERS=2 LOOP_ITEM_ATTEMPTS=2 || spent_status=$?
check "attempt counts survive a restart" '[ "$spent_status" != 0 ] && [ ! -f "$spent/events" ] && grep -q "G: gave up after 2 attempts" "$spent/out"'

cap="$tmp/cap"
make_project "$cap" true '{"features": [{"id": "A", "passes": false, "evidence": null, "writes": "src/a.txt"}]}'
cap_status=0
run_loop "$cap" LOOP_WORKERS=9 || cap_status=$?
check "worker count above the cap is refused" '[ "$cap_status" != 0 ] && grep -q "above the cap of 8" "$cap/out"'

[ "$failures" = 0 ] && echo "all parallel checks passed" || { echo "$failures parallel checks failed"; exit 1; }
