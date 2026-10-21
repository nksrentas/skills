#!/usr/bin/env bash

max_workers=8
workers="${LOOP_WORKERS:-1}"
merge_retries="${LOOP_MERGE_RETRIES:-2}"
poll_seconds="${LOOP_POLL_SECONDS:-5}"
main_dir="$(pwd)"
integration="$(git rev-parse --abbrev-ref HEAD)"
worker_root="${LOOP_WORKER_ROOT:-$main_dir.loop-workers}"
state_dir="$(mktemp -d)"
launched=0
pause_after_poll=0
slot_pid=()
slot_item=()
slot_started=()
slot_pointers=()
slot_admin=()

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
    if ($skip | index($id)) then "gave up after \($attempts) attempts, see .loop/progress.md and branch loop/\($name)/\($id)"
    else ((.depends_on // []) - $done | map(. as $dep | if ($all | index($dep)) then $dep else $dep + " (unknown id)" end) | join(", ")) as $waiting
      | if $waiting == "" then "ready" else "waiting for " + $waiting end
    end)'

log() { echo "autoloop: $*"; }

running_items() {
  local i
  for ((i = 1; i <= workers; i++)); do
    if [ -n "${slot_item[$i]}" ]; then echo "${slot_item[$i]}"; fi
  done
}

next_ready() {
  jq -r --argjson running "$(json_array $(running_items))" --argjson skip "$(json_array $(exhausted_items))" "$ready_query" "$list"
}

launch() {
  local slot="$1" id="$2" dir="$worker_root/w$1" branch="loop/$LOOP_NAME/$2"
  git branch -D "$branch" >/dev/null 2>&1 || true
  mkdir -p "$worker_root"
  git worktree add -q -b "$branch" "$dir" "$integration"
  slot_admin[$slot]="$(git -C "$dir" rev-parse --absolute-git-dir)"
  slot_pointers[$slot]="$(worker_pointers "$slot")"
  if [ -f .claude/settings.local.json ]; then
    mkdir -p "$dir/.claude" && cp .claude/settings.local.json "$dir/.claude/"
  fi
  set_attempts "$id" $(($(attempts_of "$id") + 1))
  log "worker $slot started $id (attempt $(attempts_of "$id") of $item_attempts)"
  install_commit_hook
  agent_command "$skill_command run --item $id" "$dir"
  (cd "$dir" && LOOP_WORKER="$slot" LOOP_MAIN_DIR="$main_dir" AUTOLOOP_SESSION=1 exec perl -e 'setpgrp(0, 0); exec @ARGV' \
    "${agent_cmd[@]}") > "$state_dir/w$slot.json" 2> "$state_dir/w$slot.log" < /dev/null &
  slot_pid[$slot]=$!
  slot_item[$slot]="$id"
  slot_started[$slot]="$(date +%s)"
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

restore_bookkeeping() {
  local file
  for file in "$list" .loop/progress.md; do
    if git cat-file -e "HEAD:$file" 2>/dev/null; then
      git checkout -q HEAD -- "$file"
    else
      git rm -q -f --cached --ignore-unmatch -- "$file"
      rm -f "$file"
    fi
  done
}

merge_item() {
  local id="$1" branch="$2" slot="$3"
  if ! git merge --no-ff --no-commit "$branch" >> "$state_dir/merge.log" 2>&1; then
    git merge --abort >/dev/null 2>&1 || true
    log "$id conflicts with work merged meanwhile; it runs again on top of it"
    return 1
  fi
  restore_bookkeeping
  if git diff --cached --name-only HEAD -- ':(icase).loop' ':(icase).claude' | grep -qvx ".loop/results/$id.json"; then
    git merge --abort >/dev/null 2>&1 || true
    log "$id changed files under .loop or .claude other than its own result, which workers may not do; not merged"
    return 1
  fi
  if ! merge_gate; then
    log "$id failed the gate once merged with the latest work; running the gate once more"
    if ! merge_gate; then
      git merge --abort >/dev/null 2>&1 || true
      log "$id failed the merged gate twice; it runs again on top of the latest work"
      return 2
    fi
  fi
  git commit -q -m "merge(loop): $id"
  mark "$id" "$slot"
  git branch -D "$branch" >/dev/null 2>&1 || true
  log "merged $id"
}

merge_gate() { bash <(git show HEAD:.loop/verify.sh) >> "$state_dir/merge.log" 2>&1; }

refund_merge_failure() {
  local id="$1" used
  used="$(grep -cxF "$id" "$state_dir/merge-retries" 2>/dev/null || true)"
  [ "${used:-0}" -lt "$merge_retries" ] || return 0
  echo "$id" >> "$state_dir/merge-retries"
  set_attempts "$id" $(($(attempts_of "$id") - 1))
  log "$id passed its own gate, so this does not count as an attempt (merge retry $((${used:-0} + 1)) of $merge_retries)"
}

cwd_pids_under() {
  local dir="$1" proc
  if [ -d /proc/self ]; then
    for proc in /proc/[0-9]*; do
      case "$(readlink "$proc/cwd" 2>/dev/null || true)" in
        "$dir" | "$dir"/*) echo "${proc#/proc/}" ;;
      esac
    done
  else
    { lsof -n -P -d cwd -Fpn 2>/dev/null || true; } \
      | awk -v dir="$dir" '/^p/ {pid = substr($0, 2)} /^n/ {path = substr($0, 2); if (path == dir || index(path, dir "/") == 1) print pid}'
  fi
}

kill_worker_processes() {
  local dir pids
  dir="$(cd "${worker_root:?}/w$1" 2>/dev/null && pwd -P)" || return 0
  pids="$(cwd_pids_under "$dir")"
  [ -n "$pids" ] || return 0
  log "stopping processes left in worker $1's worktree: $(echo $pids)"
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    sleep 1
    pids="$(cwd_pids_under "$dir")"
    [ -n "$pids" ] || return 0
  done
  kill -9 $pids 2>/dev/null || true
}

remove_worktree() {
  local dir="${worker_root:?}/w$1"
  kill_worker_processes "$1"
  rm -rf "$dir" 2>/dev/null || { sleep 1; rm -rf "$dir" 2>/dev/null; } || log "could not remove $dir; remove it by hand"
  git worktree prune || true
}

warn_new_stashes() {
  local new
  new="$(git stash list --format=%H 2>/dev/null | grep -vxF -f "$state_dir/stashes" || true)"
  [ -z "$new" ] || log "warning: $(echo "$new" | wc -l | tr -d ' ') new git stash entry(ies) appeared while $1 ran; stash is shared by every worktree, check git stash list (nothing was dropped)"
  git stash list --format=%H > "$state_dir/stashes" 2>/dev/null || true
}

warn_on_load() {
  local cores load
  cores="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 0)"
  if [ -r /proc/loadavg ]; then load="$(cut -d' ' -f1 /proc/loadavg)"; else load="$(sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' || true)"; fi
  if awk -v load="${load:-0}" -v cores="${cores:-0}" 'BEGIN {exit !(cores > 0 && load > 2 * cores)}'; then
    log "warning: 1-minute load is $load on $cores cores; flaky tests may fail merge gates"
  fi
}

worker_pointers() { cat "${slot_admin[$1]}/commondir" "${slot_admin[$1]}/gitdir" 2> /dev/null || true; }

worker_redirected() {
  [ -n "${slot_item[$1]}" ] || return 1
  [ "$(worker_pointers "$1")" != "${slot_pointers[$1]}" ] || return 1
  echo "autoloop: stopped, because worker $1 changed its worktree's git pointers (commondir or gitdir). Inspect $(git rev-parse --git-common-dir)/worktrees before running git here again." >&2
}

any_worker_redirected() {
  local i
  for ((i = 1; i <= workers; i++)); do
    if worker_redirected "$i"; then return 0; fi
  done
  return 1
}

stop_on_tamper() {
  local i
  for ((i = 1; i <= workers; i++)); do
    if [ -n "${slot_pid[$i]}" ]; then kill -- -"${slot_pid[$i]}" 2>/dev/null || true; fi
  done
  trap - EXIT
  write_live stopped parallel "$workers" "[]"
  release_lock
  exit 1
}

finish() {
  local slot="$1" id="${slot_item[$1]}" started="${slot_started[$1]}" status=0 merge_status=0 outcome
  local branch="loop/$LOOP_NAME/$id" output="$state_dir/w$1.log" result="$state_dir/w$1.json"
  wait "${slot_pid[$slot]}" || status=$?
  kill -- -"${slot_pid[$slot]}" 2>/dev/null || true
  if worker_redirected "$slot"; then stop_on_tamper; fi
  slot_pid[$slot]=""
  slot_item[$slot]=""
  remove_worktree "$slot"
  warn_new_stashes "$id"
  if git show "$branch:.loop/results/$id.json" 2>/dev/null \
    | jq -e --arg id "$id" '.passes == true and .id == $id and (.evidence | type) == "object"' >/dev/null 2>&1; then
    if merge_item "$id" "$branch" "$slot"; then outcome=merged; else merge_status=$?; outcome="not merged"; fi
    if [ "$merge_status" = 2 ]; then refund_merge_failure "$id"; fi
  elif [ "$status" -ne 0 ] && session_tail "$result" "$output" | grep -iE "$limit_pattern" > /dev/null; then
    outcome=limit
    set_attempts "$id" $(($(attempts_of "$id") - 1))
    launched=$((launched - 1))
    pause_after_poll=1
    log "worker $slot hit a usage limit on $id; it runs again after a ${limit_wait}s pause"
  else
    outcome=failed
    log "worker $slot did not pass $id (exit $status):"
    tail -n 5 "$output" | sed 's/^/    /'
  fi
  record_usage "$id" "$slot" "$started" "$result" "$outcome"
}

running_json() {
  local i
  for ((i = 1; i <= workers; i++)); do
    if [ -n "${slot_item[$i]}" ]; then
      printf '{"item":"%s","worker":%s,"started_at":%s}\n' "${slot_item[$i]}" "$i" "${slot_started[$i]}"
    fi
  done | jq -s -c .
}

stop_workers() {
  local i
  for ((i = 1; i <= workers; i++)); do
    if [ -n "${slot_pid[$i]:-}" ]; then kill -- -"${slot_pid[$i]}" 2>/dev/null || true; fi
    remove_worktree "$i"
  done
  git merge --abort >/dev/null 2>&1 || true
  rmdir "$worker_root" 2>/dev/null || true
  rm -rf "$state_dir"
  write_live "$(closing_state)" parallel "$workers" "[]"
  release_lock
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
  jq -r --argjson skip "$(json_array $(exhausted_items))" --arg attempts "$item_attempts" --arg name "$LOOP_NAME" "$blocked_query" "$list" >&2
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
    slot_started[$i]=""
    slot_pointers[$i]=""
    slot_admin[$i]=""
  done
  trap stop_workers EXIT
  trap 'exit 130' INT TERM
  install_commit_hook
  remember_git_controls
  git stash list --format=%H > "$state_dir/stashes" 2>/dev/null || true
  warn_on_load
  log "running up to $workers workers on $integration, $(remaining) items remaining"
  while :; do
    if git_controls_changed || any_worker_redirected; then stop_on_tamper; fi
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
    if [ -e "$stop_file" ]; then
      if [ "$(busy_workers)" -eq 0 ]; then
        rm -f "$stop_file"
        log "stopped on request; run loop.sh again to resume"
        exit 0
      fi
      write_live stopping parallel "$workers" "$(running_json)"
      sleep "$poll_seconds"
      continue
    fi
    for ((i = 1; i <= workers; i++)); do
      [ -z "${slot_pid[$i]}" ] || continue
      [ "$launched" -lt "$max_iterations" ] || break
      id="$(next_ready 2>/dev/null)" || id=""
      [ -n "$id" ] || break
      remove_worktree "$i"
      [ ! -e "$worker_root/w$i" ] || continue
      launch "$i" "$id"
    done
    write_live running parallel "$workers" "$(running_json)"
    if [ "$(busy_workers)" -eq 0 ]; then
      report_blocked
      exit 1
    fi
    sleep "$poll_seconds"
  done
  log "all items passing"
  rm -f "$attempts_file"
  jq -r '.features[] | [.id, .category, (.evidence.commit // "")] | @tsv' "$list"
}
