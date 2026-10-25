#!/usr/bin/env bash
set -euo pipefail

status="$(cd "$(dirname "$0")/../bussin-autoloop/scripts" && pwd)/loop-status.sh"
tmp="$(mktemp -d)"
export LOOP_SLOTS_DIR="$tmp/slots" LOOP_MACHINE_SESSIONS=8
drivers=()
trap 'for pid in ${drivers[@]+"${drivers[@]}"}; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done; rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
failures=0
now="$(date +%s)"

check() {
  if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

make_repo() {
  mkdir -p "$1/.loop"
  echo "$2" > "$1/.loop/feature_list.json"
  git -C "$1" init -q
  git -C "$1" add .loop
  git -C "$1" commit -qm init
}

start_driver() {
  bash -c 'sleep 60; :' "$1" &
  drivers+=($!)
  driver=$!
}

one='{"features":[{"id":"A","passes":false}]}'

repo="$tmp/proj"
make_repo "$repo" "$one"
git -C "$repo" worktree add -q -b loop/payments "$tmp/proj-payments"
git -C "$repo" worktree add -q -b loop/proj/A "$tmp/proj.loop-workers/w1"
listing="$(cd "$repo" && bash "$status")"
check "a loop on a user branch named loop/<name> still shows" 'grep -q "^· payments " <<< "$listing"'
check "a parallel worker's worktree does not show as a loop" '! grep -q "w1" <<< "$listing"'

(cd "$tmp/proj.loop-workers/w1" && bash "$status" --stop > /dev/null)
check "--stop inside a worker worktree stops the loop in its own checkout" '[ -e "$repo/.loop/stop" ] && [ ! -e "$tmp/proj.loop-workers/w1/.loop/stop" ]'
rm -f "$repo/.loop/stop"

esc="$tmp/esc"
make_repo "$esc" "$one"
start_driver loop.sh
jq -n --argjson now "$now" --argjson pid "$driver" '{state: "running", mode: "par\u001b[31mallel", workers: "\u001b[2J", pid: $pid, started_at: ($now - 60), updated_at: $now,
  running: [{item: "A", worker: "\u001b]0;pwned\u0007", started_at: ($now - 30)}]}' > "$esc/.loop/live.json"
esc_out="$(bash "$status" "$esc" 2>&1)"
check "live.json fields cannot write terminal control sequences" 'grep -q "Now   A" <<< "$esc_out" && ! grep -q $'"'"'\033'"'"' <<< "$esc_out" && ! grep -q $'"'"'\a'"'"' <<< "$esc_out"'

odd="$tmp/odd"
make_repo "$odd" '{"features":[{"id":"A","passes":false},{"id":"B","passes":false,"depends_on":"A"},7,"x"]}'
start_driver loop.sh
jq -n --argjson now "$now" --argjson pid "$driver" '{state: "running", pid: $pid, started_at: ($now - 60), updated_at: $now, running: [{item: "A", worker: 0}]}' > "$odd/.loop/live.json"
odd_status=0
odd_out="$(bash "$status" "$odd" 2>&1)" || odd_status=$?
check "one malformed live.json row or feature does not hide the loop" '[ "$odd_status" = 0 ] && grep -q "Now   A" <<< "$odd_out" && grep -q "B " <<< "$odd_out"'

broken="$tmp/broken"
make_repo "$broken" "$one"
echo '{' > "$broken/.loop/feature_list.json"
broken_status=0
broken_out="$(bash "$status" "$broken" 2>&1)" || broken_status=$?
check "an unreadable feature list is named and the exit is non-zero when no loop renders" '[ "$broken_status" != 0 ] && grep -q "cannot read .loop/feature_list.json" <<< "$broken_out"'

bash "$status" --watch 0 "$repo" > "$tmp/watch-out" 2>&1 &
watch_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$watch_pid" 2> /dev/null || break; sleep 0.3; done
watch_status=running
if kill -0 "$watch_pid" 2> /dev/null; then kill "$watch_pid"; wait "$watch_pid" 2> /dev/null || true; else wait "$watch_pid" && watch_status=0 || watch_status=$?; fi
check "--watch 0 is refused instead of spinning" '[ "$watch_status" != running ] && [ "$watch_status" != 0 ] && grep -q "1 or more" "$tmp/watch-out"'

align="$tmp/align"
make_repo "$align" '{"features":[{"id":"D","passes":true},{"id":"D","passes":true},{"id":"E","passes":false}]}'
jq -n -c --argjson now "$now" '{item: "D", outcome: "passed", duration_ms: 90000, cost_usd: 0.1, started_at: ($now - 3000), ended_at: ($now - 2910)}' > "$align/.loop/usage.jsonl"
jq -n --argjson now "$now" '{state: "running", started_at: ($now - 3000), updated_at: ($now - 1000), running: [{item: "E", worker: 0, started_at: ($now - 1200)}]}' > "$align/.loop/live.json"
align_out="$(bash "$status" "$align")"
check "a duplicate passing id counts once" 'grep -q " 1/3 " <<< "$align_out"'
check "per-item minutes round like the mod" 'grep -q "Done  D .*\$0.10 · 2m" <<< "$align_out"'
check "a running loop silent for 15 minutes without a pid counts as exited, with elapsed frozen" 'grep -q "stopped (driver exited)" <<< "$align_out" && grep -q "33m elapsed" <<< "$align_out"'
start_driver myloop.sh
jq --argjson pid "$driver" --argjson now "$now" '.pid = $pid | .updated_at = $now' "$align/.loop/live.json" > "$tmp/live.json" && mv "$tmp/live.json" "$align/.loop/live.json"
check "a pid whose command only ends in loop.sh is not the driver" 'bash "$status" "$align" | grep -q "stopped (driver exited)"'

dup="$tmp/dup"
make_repo "$dup" "$one"
for side in a b; do
  git -C "$dup" worktree add -q -b "side-$side" "$tmp/dup-$side"
  echo '{"name":"Same"}' > "$tmp/dup-$side/.loop/config.json"
done
dup_out="$(cd "$dup" && bash "$status")"
check "two loops with one name get the short folder name, as in the mod" 'grep -q "Same (a)" <<< "$dup_out" && grep -q "Same (b)" <<< "$dup_out"'

live="$tmp/live"
make_repo "$live" '{"features":[{"id":"E4","description":"Hero CTA keeps a focus ring","passes":false}]}'
start_driver loop.sh
jq -n --argjson now "$now" --argjson pid "$driver" '{state: "running", mode: "sequential", pid: $pid, started_at: ($now - 60), updated_at: $now,
  running: [{item: "E4", worker: 0, started_at: ($now - 30)}], machine: {sessions: 5, in_use: 3}}' > "$live/.loop/live.json"
mkdir -p "$live/.loop/logs"
printf '10:00:01\t-\tRead\thero.tsx\n10:00:02\timplement\tEdit\thero.tsx\n10:00:03\tgate\tBash\tbash .loop/verify.sh\n10:00:04\t-\tSay\tgate is running\n' > "$live/.loop/logs/E4.log"
live_out="$(bash "$status" "$live")"
check "a running item shows its step strip with the current step" 'grep -q "✓Orient ✓Implement \[Gate\] Review" <<< "$live_out"'
check "a running item shows the last three lines of its session log" 'grep -q "10:00:04 Say    gate is running" <<< "$live_out" && ! grep -q "10:00:01" <<< "$live_out"'
check "the header shows how many loop sessions this Mac runs" 'grep -q "this Mac: 3/5 loop sessions" <<< "$live_out"'
check "a running loop is marked with a dot, not an arrow" 'head -n 1 <<< "$live_out" | grep -q "^● " && ! grep -q "▶" <<< "$live_out"'

bash "$status" --rename "Landing page" "$live" > /dev/null
check "--rename sets the name every status view shows" '[ "$(cat "$live/.loop/name")" = "Landing page" ] && bash "$status" "$live" | head -n 1 | grep -q "^● Landing page "'
check "--rename refuses an empty name" '! bash "$status" --rename "" "$live" 2> /dev/null'

titled="$tmp/titled"
make_repo "$titled" '{"features":[{"id":"A","passes":true},{"id":"B","passes":false},{"id":"C","passes":false}]}'
git -C "$titled" worktree add -q -b second "$tmp/titled-second"
start_driver loop.sh
jq -n --argjson now "$now" --argjson pid "$driver" '{state: "running", pid: $pid, started_at: $now, updated_at: $now, running: []}' > "$titled/.loop/live.json"
jq -n --argjson now "$now" --argjson pid "$driver" '{state: "queued", pid: $pid, started_at: $now, updated_at: $now, running: []}' > "$tmp/titled-second/.loop/live.json"
jq '.features[1].passes = true' "$titled/.loop/feature_list.json" > "$tmp/titled-second/.loop/feature_list.json"
title_out="$(cd "$titled" && bash "$status" --title)"
check "--title names the project and gives one progress pair per running loop" '[ "$title_out" = "[loop] titled · 2 loops · 1/3 · 2/3" ]'
jq -n --argjson now "$now" '{state: "running", pid: 999999, started_at: $now, updated_at: $now, running: []}' > "$tmp/titled-second/.loop/live.json"
check "--title leaves out a loop whose driver has exited" '[ "$(cd "$titled" && bash "$status" --title)" = "[loop] titled · 1 loop · 1/3" ]'
check "--title says when nothing runs" '[ "$(cd "$esc" && rm -f .loop/live.json && bash "$status" --title)" = "[loop] esc · no loop running" ]'

[ "$failures" = 0 ] && echo "all status checks passed" || { echo "$failures status checks failed"; exit 1; }
