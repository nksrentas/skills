#!/usr/bin/env bash

max_workers=8
workers="${LOOP_WORKERS:-1}"
item_attempts="${LOOP_ITEM_ATTEMPTS:-3}"
poll_seconds="${LOOP_POLL_SECONDS:-5}"
main_dir="$(pwd)"
integration="$(git rev-parse --abbrev-ref HEAD)"
worker_root="${LOOP_WORKER_ROOT:-$main_dir.loop-workers}"
state_dir="$(mktemp -d)"
launched=0
pause_after_poll=0
slot_pid=()
slot_item=()

ready_query='
def prefix: sub("[*?\\[{].*$"; "");
def overlaps($a; $b): ($a | prefix) as $x | ($b | prefix) as $y | ($x | startswith($y)) or ($y | startswith($x));
def scope: if (.touches // []) == [] then [""] else .touches end;
(.features | map(select(.passes == true) | .id)) as $done
| ([.features[] | select(.id as $id | $running | index($id)) | scope[]]) as $busy
| [.features[]
   | select(.passes == false)
   | select(.id as $id | ($running + $skip) | index($id) | not)
   | select(((.depends_on // []) - $done) | length == 0)
   | select(scope as $t | all($t[]; . as $a | all($busy[]; overlaps($a; .) | not)))
   | .id][0] // empty'

blocked_query='
(.features | map(select(.passes == true) | .id)) as $done
| (.features | map(.id)) as $all
| .features[]
| select(.passes == false)
| .id as $id
| "  \($id): " + (
    if ($skip | index($id)) then "gave up after \($attempts) attempts, see .loop/progress.md and branch loop/\($id)"
    else ((.depends_on // []) - $done | map(. as $dep | if ($all | index($dep)) then $dep else $dep + " (unknown id)" end) | join(", ")) as $waiting
      | if $waiting == "" then "ready" else "waiting for " + $waiting end
    end)'

log() { echo "autoloop: $*"; }

json_array() {
  if [ $# -eq 0 ]; then echo '[]'; else printf '%s\n' "$@" | jq -R . | jq -s -c .; fi
}

running_items() {
  local i
  for ((i = 1; i <= workers; i++)); do
    if [ -n "${slot_item[$i]}" ]; then echo "${slot_item[$i]}"; fi
  done
}

attempts_of() { cat "$state_dir/attempts-$1" 2>/dev/null || echo 0; }
set_attempts() { echo "$2" > "$state_dir/attempts-$1"; }

exhausted_items() {
  local f
  for f in "$state_dir"/attempts-*; do
    [ -e "$f" ] || continue
    if [ "$(cat "$f")" -ge "$item_attempts" ]; then echo "${f##*/attempts-}"; fi
  done
}

next_ready() {
  jq -r --argjson running "$(json_array $(running_items))" --argjson skip "$(json_array $(exhausted_items))" "$ready_query" "$list"
}

launch() {
  local slot="$1" id="$2" dir="$worker_root/w$1" branch="loop/$2"
  git worktree remove --force "$dir" >/dev/null 2>&1 || true
  git branch -D "$branch" >/dev/null 2>&1 || true
  mkdir -p "$worker_root"
  git worktree add -q -b "$branch" "$dir" "$integration"
  if [ -f .claude/settings.local.json ]; then
    mkdir -p "$dir/.claude" && cp .claude/settings.local.json "$dir/.claude/"
  fi
  set_attempts "$id" $(($(attempts_of "$id") + 1))
  log "worker $slot started $id (attempt $(attempts_of "$id") of $item_attempts)"
  (cd "$dir" && LOOP_WORKER="$slot" LOOP_MAIN_DIR="$main_dir" exec perl -e 'setpgrp(0, 0); exec @ARGV' \
    claude -p "$skill_command run --item $id" --allowedTools "${allowed_tools[@]}" --disallowedTools "${denied_tools[@]}") \
    > "$state_dir/w$slot.log" 2>&1 < /dev/null &
  slot_pid[$slot]=$!
  slot_item[$slot]="$id"
  launched=$((launched + 1))
}

mark() {
  local id="$1" slot="$2" result=".loop/results/$1.json"
  jq --arg id "$id" --slurpfile result "$result" \
    '(.features[] | select(.id == $id)) |= (.passes = true | .evidence = $result[0].evidence)' "$list" > "$list.tmp"
  mv "$list.tmp" "$list"
  { printf '\n## %s · worker %s · %s\n' "$id" "$slot" "$(date +%Y-%m-%d)"; jq -r '.notes // ""' "$result"; } >> .loop/progress.md
  git rm -q "$result"
  git add "$list" .loop/progress.md
  git commit -q -m "chore(loop): mark $id"
}

merge_item() {
  local id="$1" branch="$2" slot="$3"
  if ! git merge --no-ff --no-commit "$branch" >> "$state_dir/merge.log" 2>&1; then
    git merge --abort >/dev/null 2>&1 || true
    log "$id conflicts with work merged meanwhile; it runs again on top of it"
    return
  fi
  if ! bash .loop/verify.sh >> "$state_dir/merge.log" 2>&1; then
    git merge --abort >/dev/null 2>&1 || true
    log "$id failed the gate once merged with the latest work; it runs again on top of it"
    return
  fi
  git commit -q -m "merge(loop): $id"
  mark "$id" "$slot"
  git branch -D "$branch" >/dev/null 2>&1 || true
  log "merged $id"
}

finish() {
  local slot="$1" id="${slot_item[$1]}" status=0
  local branch="loop/$id" output="$state_dir/w$1.log"
  wait "${slot_pid[$slot]}" || status=$?
  kill -- -"${slot_pid[$slot]}" 2>/dev/null || true
  slot_pid[$slot]=""
  slot_item[$slot]=""
  git worktree remove --force "$worker_root/w$slot" >/dev/null 2>&1 || true
  if git show "$branch:.loop/results/$id.json" 2>/dev/null \
    | jq -e --arg id "$id" '.passes == true and .id == $id and (.evidence | type) == "object"' >/dev/null 2>&1; then
    merge_item "$id" "$branch" "$slot"
  elif [ "$status" -ne 0 ] && grep -qiE "$limit_pattern" "$output"; then
    set_attempts "$id" $(($(attempts_of "$id") - 1))
    launched=$((launched - 1))
    pause_after_poll=1
    log "worker $slot hit a usage limit on $id; it runs again after a ${limit_wait}s pause"
  else
    log "worker $slot did not pass $id (exit $status):"
    tail -n 5 "$output" | sed 's/^/    /'
  fi
}

stop_workers() {
  local i
  for ((i = 1; i <= workers; i++)); do
    if [ -n "${slot_pid[$i]:-}" ]; then kill -- -"${slot_pid[$i]}" 2>/dev/null || true; fi
    git worktree remove --force "$worker_root/w$i" >/dev/null 2>&1 || true
  done
  git merge --abort >/dev/null 2>&1 || true
  git worktree prune
  rmdir "$worker_root" 2>/dev/null || true
  rm -rf "$state_dir"
}

busy_workers() {
  local i count=0
  for ((i = 1; i <= workers; i++)); do
    if [ -n "${slot_pid[$i]}" ]; then count=$((count + 1)); fi
  done
  echo "$count"
}

report_blocked() {
  if [ "$launched" -ge "$max_iterations" ]; then
    echo "autoloop: reached MAX_ITERATIONS=$max_iterations sessions with $(remaining) items left" >&2
  fi
  echo "autoloop: no item can start. Items still failing:" >&2
  jq -r --argjson skip "$(json_array $(exhausted_items))" --arg attempts "$item_attempts" "$blocked_query" "$list" >&2
}

run_parallel() {
  local i id left
  if [ "$workers" -gt "$max_workers" ]; then
    echo "autoloop: LOOP_WORKERS=$workers is above the cap of $max_workers" >&2
    exit 1
  fi
  if [ "$integration" = HEAD ]; then
    echo "autoloop: check out a branch first; workers merge into the current branch" >&2
    exit 1
  fi
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "autoloop: commit or stash local changes first; workers merge into $integration" >&2
    exit 1
  fi
  for ((i = 1; i <= workers; i++)); do
    slot_pid[$i]=""
    slot_item[$i]=""
  done
  trap stop_workers EXIT
  trap 'exit 130' INT TERM
  log "running up to $workers workers on $integration, $(remaining) items remaining"
  while :; do
    for ((i = 1; i <= workers; i++)); do
      if [ -n "${slot_pid[$i]}" ] && ! kill -0 "${slot_pid[$i]}" 2>/dev/null; then finish "$i"; fi
    done
    if [ "$pause_after_poll" = 1 ]; then
      sleep "$limit_wait"
      pause_after_poll=0
    fi
    if ! left="$(remaining 2>/dev/null)"; then
      log "could not read $list, retrying"
      sleep "$poll_seconds"
      continue
    fi
    [ "$left" -gt 0 ] || break
    for ((i = 1; i <= workers; i++)); do
      [ -z "${slot_pid[$i]}" ] || continue
      [ "$launched" -lt "$max_iterations" ] || break
      id="$(next_ready 2>/dev/null)" || id=""
      [ -n "$id" ] || break
      launch "$i" "$id"
    done
    if [ "$(busy_workers)" -eq 0 ]; then
      report_blocked
      exit 1
    fi
    sleep "$poll_seconds"
  done
  log "all items passing"
  jq -r '.features[] | [.id, .category, (.evidence.commit // "")] | @tsv' "$list"
}
