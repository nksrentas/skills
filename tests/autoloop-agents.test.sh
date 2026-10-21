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
  local dir="$1" test_command="$2"
  mkdir -p "$dir/.loop" "$dir/bin" "$dir/src"
  cp "$skill/assets/verify.sh" "$skill/assets/guard-commit.sh" "$dir/.loop/"
  jq -n --arg test "$test_command" '{commands: {test: $test, lint: "npm run lint"}, gates: {mutation: false}}' > "$dir/.loop/config.json"
  echo '{"features":[{"id":"A1","description":"first","passes":false,"evidence":null},{"id":"A2","description":"second","passes":false,"evidence":null}]}' \
    | jq . > "$dir/.loop/feature_list.json"
  printf '.loop/tests-passed\nout\nargv\nhook-said\nchained\n' > "$dir/.gitignore"
  git -C "$dir" init -q
  git -C "$dir" add -A
  git -C "$dir" commit -qm init
}

session_body='
printf "%s\n" "$@" > "$PROJECT/argv"
id="$(jq -r "[.features[] | select(.passes == false)][0].id" .loop/feature_list.json)"
echo "$id" > "src/$id.txt"
case "${MOCK_BEHAVIOUR:-honest}" in
  honest)
    bash .loop/verify.sh > /dev/null
    git add -A && git commit -qm "feat: $id"
    jq --arg id "$id" "(.features[] | select(.id == \$id)) |= (.passes = true | .evidence = {commit: \"x\"})" .loop/feature_list.json > .loop/f.tmp
    mv .loop/f.tmp .loop/feature_list.json
    git commit -qam "chore(loop): mark $id" ;;
  unverified)
    git add -A
    git commit -qm "feat: $id" 2> "$PROJECT/hook-said" || true ;;
  bypass)
    jq --arg id "$id" "(.features[] | select(.id == \$id)) |= (.passes = true | .evidence = {commit: \"x\"})" .loop/feature_list.json > .loop/f.tmp
    mv .loop/f.tmp .loop/feature_list.json
    git add -A && git commit -qm "feat: $id" --no-verify ;;
  flip-only)
    jq "(.features[] | select(.id == \"$id\")) |= (.passes = true)" .loop/feature_list.json > .loop/f.tmp
    mv .loop/f.tmp .loop/feature_list.json ;;
  fsmonitor)
    git config core.fsmonitor "touch $PROJECT/pwned; false" ;;
  reword)
    jq ".features[1].description = \"easier\"" .loop/feature_list.json > .loop/f.tmp
    mv .loop/f.tmp .loop/feature_list.json
    git add -A && git commit -qm "feat: $id" --no-verify ;;
esac
'

write_agent() {
  local dir="$1" name="$2" output="$3"
  { echo '#!/usr/bin/env bash'; echo "PROJECT='$dir'"; echo "$session_body"; echo "cat <<'JSON'"; echo "$output"; echo 'JSON'; } > "$dir/bin/$name"
  chmod +x "$dir/bin/$name"
}

codex_output='{"type":"thread.started","thread_id":"t"}
{"type":"turn.started"}
{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":400,"cache_write_input_tokens":0,"output_tokens":50,"reasoning_output_tokens":0}}
{"type":"turn.completed","usage":{"input_tokens":500,"cached_input_tokens":100,"cache_write_input_tokens":0,"output_tokens":25}}'
copilot_output='{"type":"assistant.message","data":{"model":"gpt-5.6-terra","content":"done"}}
{"type":"assistant.turn_end","data":{"turnId":"0"}}
{"type":"assistant.turn_end","data":{"turnId":"1"}}
{"type":"result","exitCode":0,"usage":{"premiumRequests":2,"sessionDurationMs":90000}}'

run_loop() {
  local dir="$1"
  shift
  (cd "$dir" && env "$@" PATH="$dir/bin:$PATH" LIMIT_WAIT=0 MAX_STALLS=1 bash "$skill/scripts/loop.sh" > "$dir/out" 2>&1)
}

codex="$tmp/codex"
make_project "$codex" true
write_agent "$codex" codex "$codex_output"
codex_status=0
run_loop "$codex" LOOP_AGENT=codex LOOP_MODEL=gpt-test || codex_status=$?
check "a codex loop finishes every item" '[ "$codex_status" = 0 ] && [ "$(jq "[.features[] | select(.passes)] | length" "$codex/.loop/feature_list.json")" = 2 ]'
check "codex runs headless with json events, the workspace sandbox and the git dir writable" '[ "$(head -n 4 "$codex/argv" | tr "\n" " ")" = "exec --json --sandbox workspace-write " ] && grep -A1 -x -- --add-dir "$codex/argv" | grep -qx "$(cd "$codex/.git" && pwd -P)" && grep -qxF "gpt-test" "$codex/argv"'
check "codex gets the skill through its \$ mention" '[ "$(tail -n 1 "$codex/argv")" = "\$bussin-autoloop run --item A2 --sequential" ]'
check "codex sessions record tokens without cache double counting" '[ "$(jq -s "map(.input_tokens) | add" "$codex/.loop/usage.jsonl")" = 2000 ] && [ "$(jq -s "map(.cache_read_tokens) | add" "$codex/.loop/usage.jsonl")" = 1000 ] && [ "$(jq -s "map(.turns) | add" "$codex/.loop/usage.jsonl")" = 4 ]'
check "codex sessions are unpriced and carry agent and model" '[ "$(jq -s -r "map(.agent + \"/\" + (.models | keys[0]) + \"/\" + (has(\"cost_usd\") | tostring)) | unique | join(\",\")" "$codex/.loop/usage.jsonl")" = "codex/gpt-test/false" ]'
git -C "$codex" worktree add -q -b loop/probe "$tmp/codex-worker"
worker_dirs="$(cd "$codex" && PATH="$codex/bin:$PATH" LOOP_AGENT=codex bash -c 'source "$1/scripts/agents.sh" && git_write_dirs "$2"' _ "$skill" "$tmp/codex-worker")"
check "a codex worker may write git objects, refs and its own worktree data, but not git config or hooks" '[ "$(echo "$worker_dirs" | wc -l | tr -d " ")" = 4 ] && grep -q "/.git/objects$" <<< "$worker_dirs" && grep -q "/.git/worktrees/codex-worker$" <<< "$worker_dirs" && ! grep -qx "$(cd "$codex/.git" && pwd -P)" <<< "$worker_dirs"'
git -C "$codex" worktree remove --force "$tmp/codex-worker"
check "the live state names the agent" '[ "$(jq -r .agent "$codex/.loop/live.json")" = codex ]'
check "the gate is re-run for agents without a tool-level guard" 'grep -q "re-running the gate" "$codex/out"'

copilot="$tmp/copilot"
make_project "$copilot" true
write_agent "$copilot" copilot "$copilot_output"
copilot_status=0
run_loop "$copilot" LOOP_AGENT=copilot || copilot_status=$?
check "a copilot loop finishes every item" '[ "$copilot_status" = 0 ]'
check "copilot gets the slash command and json output" '[ "$(sed -n 1,2p "$copilot/argv" | tr "\n" " ")" = "-p /bussin-autoloop run --item A2 --sequential " ] && grep -qx json "$copilot/argv"'
check "copilot may run the gate, git and the project commands" 'grep -qxF "shell(.loop/verify.sh)" "$copilot/argv" && grep -qxF "shell(git commit)" "$copilot/argv" && grep -qxF "shell(npm run)" "$copilot/argv" && ! grep -qxF "shell(bash)" "$copilot/argv" && ! grep -qxF "shell(npm)" "$copilot/argv" && ! grep -qxF "shell(git push)" "$copilot/argv"'
check "copilot may not write the loop scripts or config" 'grep -qxF "write(.loop/verify.sh)" "$copilot/argv" && grep -qxF "write(.loop/config.json)" "$copilot/argv"'
check "copilot sessions record model, turns and premium requests" '[ "$(jq -s -r "map((.models | keys[0]) + \":\" + (.turns | tostring) + \":\" + (.premium_requests | tostring)) | unique | join(\",\")" "$copilot/.loop/usage.jsonl")" = "gpt-5.6-terra:2:2" ]'

hook="$tmp/hook"
make_project "$hook" true
write_agent "$hook" codex "$codex_output"
mkdir -p "$hook/.git/hooks"
mkdir -p "$hook/.git/hooks"
printf '#!/usr/bin/env bash\necho chained >> "%s/chained"\n' "$hook" > "$hook/.git/hooks/pre-commit"
chmod +x "$hook/.git/hooks/pre-commit"
hook_status=0
run_loop "$hook" LOOP_AGENT=codex MOCK_BEHAVIOUR=unverified || hook_status=$?
check "the git pre-commit guard stops an unverified commit inside a session" 'grep -q "tests-passed marker is missing" "$hook/hook-said" && [ "$(git -C "$hook" rev-list --count HEAD)" = 1 ]'
echo x > "$hook/src/human.txt"
git -C "$hook" add -A
check "commits outside loop sessions are not guarded" 'git -C "$hook" commit -qm human'
check "an existing pre-commit hook still runs after the guard" '[ -f "$hook/chained" ] && [ -x "$hook/.git/hooks/pre-commit.before-autoloop" ]'

bypass="$tmp/bypass"
make_project "$bypass" 'test ! -e src/A1.txt'
write_agent "$bypass" codex "$codex_output"
bypass_status=0
run_loop "$bypass" LOOP_AGENT=codex MOCK_BEHAVIOUR=bypass || bypass_status=$?
check "a pass committed with --no-verify is re-gated and stops the loop" '[ "$bypass_status" != 0 ] && grep -q "gate fails on the committed code" "$bypass/out"'

reword="$tmp/reword"
make_project "$reword" true
write_agent "$reword" copilot "$copilot_output"
reword_status=0
run_loop "$reword" LOOP_AGENT=copilot MOCK_BEHAVIOUR=reword || reword_status=$?
check "a commit that rewords items stops the loop" '[ "$reword_status" != 0 ] && grep -q "reworded items" "$reword/out"'

flip="$tmp/flip"
make_project "$flip" false
write_agent "$flip" codex "$codex_output"
flip_status=0
run_loop "$flip" LOOP_AGENT=codex MOCK_BEHAVIOUR=flip-only || flip_status=$?
check "an uncommitted pass does not count and is discarded" '[ "$flip_status" != 0 ] && ! grep -q "all items passing" "$flip/out" && grep -q "only committed marks count" "$flip/out" && [ "$(jq -r ".features[0].passes" "$flip/.loop/feature_list.json")" = false ]'

tamper="$tmp/tamper"
make_project "$tamper" true
write_agent "$tamper" codex "$codex_output"
tamper_status=0
run_loop "$tamper" LOOP_AGENT=codex MOCK_BEHAVIOUR=fsmonitor || tamper_status=$?
check "a session that changes git config stops the loop before git runs again" '[ "$tamper_status" != 0 ] && grep -q "changed git config or hooks" "$tamper/out" && [ ! -e "$tamper/pwned" ]'

unknown="$tmp/unknown"
make_project "$unknown" true
unknown_status=0
run_loop "$unknown" LOOP_AGENT=gemini || unknown_status=$?
check "an unknown agent is refused" '[ "$unknown_status" != 0 ] && grep -q "LOOP_AGENT=gemini is not supported" "$unknown/out"'

status_out="$(bash "$skill/scripts/loop-status.sh" "$codex")"
check "loop-status shows progress, agent and outcome" 'grep -q "finished · sequential · codex" <<< "$status_out" && grep -q "2/2" <<< "$status_out"'
check "loop-status shows tokens, unpriced sessions and the model" 'grep -q "Cost    unknown over 2 sessions · 2 unpriced" <<< "$status_out" && grep -q "Tokens  2.0k in · 150 out" <<< "$status_out" && grep -q "gpt-test" <<< "$status_out"'
check "loop-status lists done items" 'grep -q "Done  A2" <<< "$status_out"'
copilot_status_out="$(bash "$skill/scripts/loop-status.sh" "$copilot")"
check "loop-status counts copilot premium requests" 'grep -q "4 premium requests" <<< "$copilot_status_out"'
check "loop-status finds loops from inside the repo" '(cd "$codex/src" && bash "$skill/scripts/loop-status.sh") | grep -q "codex"'
check "loop-status explains when there is no loop" '! (cd "$tmp" && bash "$skill/scripts/loop-status.sh" "$tmp") 2> /dev/null'

[ "$failures" = 0 ] && echo "all agent checks passed" || { echo "$failures agent checks failed"; exit 1; }
