#!/usr/bin/env bash
set -euo pipefail

loop="$(cd "$(dirname "$0")/../bussin-autoloop/scripts" && pwd)/loop.sh"

make_project() {
  local dir="$1" mode="$2"
  mkdir -p "$dir/.loop" "$dir/bin"
  echo '{"features":[{"id":"A1","passes":false}]}' > "$dir/.loop/feature_list.json"
  cat > "$dir/bin/claude" <<EOF
#!/usr/bin/env bash
calls=\$(( \$(cat "$dir/calls" 2>/dev/null || echo 0) + 1 ))
echo "\$calls" > "$dir/calls"
if [ "$mode" = always-fail ] || { [ "$mode" != pass ] && [ "\$calls" -eq 1 ]; }; then
  [ "$mode" = limit-then-pass ] && echo "You've hit your session limit · resets 1pm (Europe/Athens)"
  exit 1
fi
jq '.features[0].passes = true' .loop/feature_list.json > .loop/tmp && mv .loop/tmp .loop/feature_list.json
git commit -qam "pass A1"
EOF
  chmod +x "$dir/bin/claude"
  git -C "$dir" init -q
  git -C "$dir" add .loop
  git -C "$dir" -c user.email=t@t -c user.name=t commit -qm init
}

run_loop() {
  local dir="$1"
  (cd "$dir" && GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t \
    PATH="$dir/bin:$PATH" LIMIT_WAIT=0 MAX_STALLS=1 bash "$loop" > "$dir/out" 2>&1)
}

tmp="$(mktemp -d)"
export LOOP_SLOTS_DIR="$tmp/slots" LOOP_MACHINE_SESSIONS=8
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
trap 'rm -rf "$tmp"' EXIT

make_project "$tmp/limit" limit-then-pass
run_loop "$tmp/limit" || { cat "$tmp/limit/out"; echo "FAIL: usage limit counted as a stall"; exit 1; }
[ "$(cat "$tmp/limit/calls")" -eq 2 ] || { echo "FAIL: expected 2 sessions, got $(cat "$tmp/limit/calls")"; exit 1; }
grep -q "usage limit" "$tmp/limit/out" || { echo "FAIL: no usage limit notice"; exit 1; }

make_project "$tmp/fail" always-fail
if run_loop "$tmp/fail"; then echo "FAIL: plain failure was not counted as a stall"; exit 1; fi
grep -q "no progress (1/1)" "$tmp/fail/out" || { cat "$tmp/fail/out"; echo "FAIL: plain failure not reported as stall"; exit 1; }

stop="$tmp/stop"
mkdir -p "$stop/.loop" "$stop/bin"
echo '{"features":[{"id":"A1","passes":false},{"id":"A2","passes":false}]}' > "$stop/.loop/feature_list.json"
cat > "$stop/bin/claude" <<EOF
#!/usr/bin/env bash
echo run >> "$stop/calls"
bash "$(dirname "$loop")/loop-status.sh" --stop > "$stop/stop-out"
id="\$(jq -r '[.features[] | select(.passes == false)][0].id' .loop/feature_list.json)"
jq --arg id "\$id" '(.features[] | select(.id == \$id)).passes = true' .loop/feature_list.json > .loop/tmp && mv .loop/tmp .loop/feature_list.json
git commit -qam "pass \$id"
EOF
chmod +x "$stop/bin/claude"
git -C "$stop" init -q
git -C "$stop" add .loop
git -C "$stop" -c user.email=t@t -c user.name=t commit -qm init
touch "$stop/.loop/stop"
run_loop "$stop" || { cat "$stop/out"; echo "FAIL: a stop request did not exit 0"; exit 1; }
[ "$(wc -l < "$stop/calls" | tr -d " ")" = 1 ] || { cat "$stop/out"; echo "FAIL: a stale stop request blocked the start, or a session started after the stop request"; exit 1; }
grep -q "stops after its running items finish" "$stop/stop-out" || { echo "FAIL: loop-status --stop did not confirm"; exit 1; }
grep -q "autoloop: stopped on request after A1" "$stop/out" || { cat "$stop/out"; echo "FAIL: no stop notice"; exit 1; }
[ "$(jq -r .state "$stop/.loop/live.json")" = stopped ] || { echo "FAIL: live state is not stopped"; exit 1; }
[ ! -e "$stop/.loop/stop" ] || { echo "FAIL: the stop request was left behind"; exit 1; }
[ "$(git -C "$stop" show HEAD:.loop/feature_list.json | jq -r '.features[1].passes')" = false ] || { echo "FAIL: A2 ran after the stop request"; exit 1; }

twice="$tmp/twice"
mkdir -p "$twice/.loop" "$twice/bin"
echo '{"features":[{"id":"A1","passes":false}]}' > "$twice/.loop/feature_list.json"
cat > "$twice/bin/claude" <<EOF
#!/usr/bin/env bash
git status --porcelain > "$twice/status-during"
status=0
bash "$loop" > "$twice/second-out" 2>&1 || status=\$?
echo "\$status" > "$twice/second-status"
jq '.features[0].passes = true' .loop/feature_list.json > .loop/tmp && mv .loop/tmp .loop/feature_list.json
git commit -qam "pass A1"
EOF
chmod +x "$twice/bin/claude"
git -C "$twice" init -q
git -C "$twice" add .loop
git -C "$twice" -c user.email=t@t -c user.name=t commit -qm init
run_loop "$twice" || { cat "$twice/out"; echo "FAIL: the first loop did not finish"; exit 1; }
[ "$(cat "$twice/second-status")" = 1 ] || { cat "$twice/second-out"; echo "FAIL: a second loop.sh in the same checkout did not refuse"; exit 1; }
grep -q "autoloop: a loop is already running here (pid [0-9]*); stop it first or use another worktree" "$twice/second-out" || { cat "$twice/second-out"; echo "FAIL: no refusal notice"; exit 1; }
! grep -q run.lock "$twice/status-during" || { cat "$twice/status-during"; echo "FAIL: the run lock shows up in git status"; exit 1; }
[ ! -e "$twice/.loop/run.lock" ] || { echo "FAIL: the run lock was left behind"; exit 1; }
[ "$(jq -r .state "$twice/.loop/live.json")" = finished ] || { echo "FAIL: the refused loop overwrote the live state"; exit 1; }

make_project "$tmp/held" pass
sleep 30 &
holder=$!
mkdir "$tmp/held/.loop/run.lock"
echo "$holder" > "$tmp/held/.loop/run.lock/pid"
held_status=0
run_loop "$tmp/held" || held_status=$?
kill "$holder"
wait "$holder" 2>/dev/null || true
[ "$held_status" = 1 ] && [ ! -e "$tmp/held/calls" ] || { cat "$tmp/held/out"; echo "FAIL: a lock held by a live process did not block"; exit 1; }
grep -q "already running here (pid $holder)" "$tmp/held/out" || { cat "$tmp/held/out"; echo "FAIL: the refusal does not name the lock holder"; exit 1; }
[ "$(cat "$tmp/held/.loop/run.lock/pid")" = "$holder" ] || { echo "FAIL: a refused start removed the other loop's lock"; exit 1; }

make_project "$tmp/stale" pass
true &
dead=$!
wait "$dead"
jq -n --argjson pid "$dead" '{state: "running", pid: $pid}' > "$tmp/stale/.loop/live.json"
mkdir "$tmp/stale/.loop/run.lock"
echo "$dead" > "$tmp/stale/.loop/run.lock/pid"
run_loop "$tmp/stale" || { cat "$tmp/stale/out"; echo "FAIL: a stale live.json or lock blocked the start"; exit 1; }
[ "$(cat "$tmp/stale/calls")" = 1 ] && [ ! -e "$tmp/stale/.loop/run.lock" ] || { cat "$tmp/stale/out"; echo "FAIL: the run after a stale lock did not finish cleanly"; exit 1; }

make_picker() {
  local dir="$1" failing="$2"
  mkdir -p "$dir/.loop" "$dir/bin"
  echo '{"features":[{"id":"A1","passes":false},{"id":"A2","passes":false}]}' > "$dir/.loop/feature_list.json"
  cat > "$dir/bin/claude" <<EOF
#!/usr/bin/env bash
echo "\$2" >> "$dir/prompts"
id="\$(sed -n 's/.*--item \([^ ]*\).*/\1/p' <<< "\$2")"
[ "\$id" != "$failing" ] || exit 0
jq --arg id "\$id" '(.features[] | select(.id == \$id)).passes = true' .loop/feature_list.json > .loop/tmp && mv .loop/tmp .loop/feature_list.json
git commit -qam "pass \$id"
EOF
  chmod +x "$dir/bin/claude"
  git -C "$dir" init -q
  git -C "$dir" add .loop
  git -C "$dir" -c user.email=t@t -c user.name=t commit -qm init
}

blocked="$tmp/blocked"
make_picker "$blocked" none
printf '## Session 1 · A1\nBlocked: A1 needs an API key from a human\n' > "$blocked/.loop/progress.md"
git -C "$blocked" add .loop/progress.md
git -C "$blocked" -c user.email=t@t -c user.name=t commit -qm blocked
blocked_status=0
run_loop "$blocked" || blocked_status=$?
[ "$(cat "$blocked/prompts")" = "/bussin-autoloop run --item A2 --sequential" ] || { cat "$blocked/out"; echo "FAIL: the sequential driver did not start the session on the unblocked item"; exit 1; }
[ "$(jq -r .item "$blocked/.loop/usage.jsonl")" = A2 ] || { cat "$blocked/.loop/usage.jsonl"; echo "FAIL: usage.jsonl names the wrong item"; exit 1; }
[ "$(jq -r .outcome "$blocked/.loop/usage.jsonl")" = passed ] || { echo "FAIL: the session's outcome is not passed"; exit 1; }
[ "$blocked_status" = 1 ] && grep -q "every remaining item is blocked" "$blocked/out" || { cat "$blocked/out"; echo "FAIL: a loop with only blocked items left did not stop"; exit 1; }

spent="$tmp/spent"
make_picker "$spent" A1
spent_status=0
(cd "$spent" && GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t \
  PATH="$spent/bin:$PATH" LOOP_ITEM_ATTEMPTS=2 MAX_STALLS=5 bash "$loop" > "$spent/out" 2>&1) || spent_status=$?
[ "$(jq -r .item "$spent/.loop/usage.jsonl" | tr '\n' ' ')" = "A1 A1 A2 " ] || { cat "$spent/out"; echo "FAIL: an item out of attempts was not skipped"; exit 1; }
grep -q "giving up on A1 after 2 attempts" "$spent/out" || { cat "$spent/out"; echo "FAIL: no notice when an item runs out of attempts"; exit 1; }
[ "$spent_status" = 1 ] && [ "$(jq -c . "$spent/.loop/attempts.json")" = '{"A1":2,"A2":1}' ] || { cat "$spent/out"; echo "FAIL: attempts were not kept in .loop/attempts.json"; exit 1; }

status_script="$(dirname "$loop")/loop-status.sh"
crashed="$tmp/crashed"
make_project "$crashed" pass
jq -n --argjson pid "$dead" --argjson now "$(date +%s)" \
  '{state: "running", mode: "sequential", workers: 1, started_at: ($now - 600), updated_at: ($now - 300), pid: $pid, running: [{item: "A1", worker: 0, started_at: ($now - 300)}]}' > "$crashed/.loop/live.json"
crashed_out="$(bash "$status_script" "$crashed")"
grep -q "stopped (driver exited) · sequential" <<< "$crashed_out" || { echo "$crashed_out"; echo "FAIL: loop-status shows a loop whose driver died as running"; exit 1; }
! grep -qE "ETA|Now " <<< "$crashed_out" || { echo "$crashed_out"; echo "FAIL: a dead loop still shows an ETA or a running item"; exit 1; }
bash -c 'sleep 30; :' loop.sh &
alive=$!
jq --argjson pid "$alive" '.pid = $pid' "$crashed/.loop/live.json" > "$crashed/.loop/tmp" && mv "$crashed/.loop/tmp" "$crashed/.loop/live.json"
alive_out="$(bash "$status_script" "$crashed")"
kill "$alive"
wait "$alive" 2>/dev/null || true
grep -q "running · sequential" <<< "$alive_out" && grep -q "Now   A1" <<< "$alive_out" || { echo "$alive_out"; echo "FAIL: loop-status does not show a live driver as running"; exit 1; }

budget="$tmp/budget"
mkdir -p "$budget/.loop" "$budget/bin"
jq -n '{features: [range(21) | {id: "B\(.)", passes: false}]}' > "$budget/.loop/feature_list.json"
printf '#!/usr/bin/env bash\necho run >> "%s/calls"\n' "$budget" > "$budget/bin/claude"
chmod +x "$budget/bin/claude"
git -C "$budget" init -q
git -C "$budget" add .loop
git -C "$budget" -c user.email=t@t -c user.name=t commit -qm init
budget_status=0
(cd "$budget" && PATH="$budget/bin:$PATH" MAX_STALLS=100 bash "$loop" > "$budget/out" 2>&1) || budget_status=$?
[ "$budget_status" = 1 ] && grep -q "reached MAX_ITERATIONS=42 with 21 items left" "$budget/out" && [ "$(wc -l < "$budget/calls" | tr -d ' ')" = 42 ] || { tail -n 3 "$budget/out"; echo "FAIL: the session budget does not scale with the list"; exit 1; }

pause="$tmp/pause"
make_project "$pause" pass
cat > "$pause/bin/claude" <<'EOF'
#!/usr/bin/env bash
touch .loop/stop
echo "You've hit your session limit"
exit 1
EOF
pause_started=$SECONDS
(cd "$pause" && PATH="$pause/bin:$PATH" LIMIT_WAIT=30 bash "$loop" > "$pause/out" 2>&1) || true
[ $((SECONDS - pause_started)) -lt 15 ] && grep -q "stopped on request" "$pause/out" || { cat "$pause/out"; echo "FAIL: a stop request did not cut the usage-limit wait short"; exit 1; }

full="$tmp/full"
make_project "$full" pass
mkdir -p "$tmp/full-slots/1"
sleep 4 &
holder=$!
echo "$holder other-loop F9" > "$tmp/full-slots/1/owner"
(cd "$full" && PATH="$full/bin:$PATH" LOOP_SLOTS_DIR="$tmp/full-slots" LOOP_MACHINE_SESSIONS=1 LOOP_SLOT_WAIT=1 bash "$loop" > "$full/out" 2>&1) || { cat "$full/out"; echo "FAIL: a queued loop did not run once the machine had room"; exit 1; }
grep -q "already runs 1 loop sessions; A1 waits" "$full/out" || { cat "$full/out"; echo "FAIL: a full machine did not queue the session"; exit 1; }
[ ! -e "$tmp/full-slots/1" ] || { echo "FAIL: the session slot was not released"; exit 1; }
wait "$holder" 2> /dev/null || true

stale="$tmp/stale"
make_project "$stale" pass
mkdir -p "$tmp/stale-slots/1"
echo "999999 gone F1" > "$tmp/stale-slots/1/owner"
(cd "$stale" && PATH="$stale/bin:$PATH" LOOP_SLOTS_DIR="$tmp/stale-slots" LOOP_MACHINE_SESSIONS=1 LOOP_SLOT_WAIT=1 bash "$loop" > "$stale/out" 2>&1) || { cat "$stale/out"; echo "FAIL: a slot held by a dead driver blocked the loop"; exit 1; }
! grep -q "waits for one to finish" "$stale/out" || { echo "FAIL: a dead driver's slot was not reclaimed"; exit 1; }
[ -f "$stale/.loop/logs/A1.log" ] || { echo "FAIL: no session log was written"; exit 1; }

unsafe="$tmp/unsafe"
make_project "$unsafe" pass
echo '{"features":[{"id":"../../escape","passes":false}]}' > "$unsafe/.loop/feature_list.json"
git -C "$unsafe" -c user.email=t@t -c user.name=t commit -qam unsafe
if run_loop "$unsafe"; then echo "FAIL: an item id with a path in it was accepted"; exit 1; fi
grep -q "item ids may only use" "$unsafe/out" && [ ! -e "$unsafe/calls" ] || { cat "$unsafe/out"; echo "FAIL: an unsafe item id did not stop the loop before any session"; exit 1; }

run_session="$(dirname "$loop")/run-session.sh"
hang_started=$SECONDS
hang_status=0
bash "$run_session" "$tmp/hang.raw" "$tmp/hang/.loop/logs/H1.log" claude \
  bash -c 'echo "{\"type\":\"result\",\"subtype\":\"success\",\"num_turns\":1}"; sleep 30 & exit 3' || hang_status=$?
[ "$hang_status" = 3 ] && [ $((SECONDS - hang_started)) -lt 10 ] || { echo "FAIL: a session that left a child running did not end with the agent ($hang_status after $((SECONDS - hang_started))s)"; exit 1; }
grep -q "Done	success after 1 turns" "$tmp/hang/.loop/logs/H1.log" || { cat "$tmp/hang/.loop/logs/H1.log"; echo "FAIL: the session log missed the last event"; exit 1; }
if bash "$run_session" "$tmp/x.raw" "$tmp/p/.loop/logs/../../escape.log" claude true 2> /dev/null; then echo "FAIL: a log path outside .loop/logs was accepted"; exit 1; fi
[ ! -e "$tmp/escape.log" ] || { echo "FAIL: a log was written outside .loop/logs"; exit 1; }

echo "autoloop-loop.test.sh: ok"
