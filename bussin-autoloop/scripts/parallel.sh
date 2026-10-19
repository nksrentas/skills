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
  remove_worktree "$slot"
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
  if ! bash <(git show HEAD:.loop/verify.sh) >> "$state_dir/merge.log" 2>&1; then
    git merge --abort >/dev/null 2>&1 || true
    log "$id failed the gate once merged with the latest work; it runs again on top of it"
    return 1
  fi
  git commit -q -m "merge(loop): $id"
  mark "$id" "$slot"
  git branch -D "$branch" >/dev/null 2>&1 || true
  log "merged $id"
}

remove_worktree() {
  rm -rf "${worker_root:?}/w$1"
  git worktree prune
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
  exit 1
}

finish() {
  local slot="$1" id="${slot_item[$1]}" started="${slot_started[$1]}" status=0 outcome
  local branch="loop/$id" output="$state_dir/w$1.log" result="$state_dir/w$1.json"
  wait "${slot_pid[$slot]}" || status=$?
  kill -- -"${slot_pid[$slot]}" 2>/dev/null || true
  if worker_redirected "$slot"; then stop_on_tamper; fi
  slot_pid[$slot]=""
  slot_item[$slot]=""
  remove_worktree "$slot"
  if git show "$branch:.loop/results/$id.json" 2>/dev/null \
    | jq -e --arg id "$id" '.passes == true and .id == $id and (.evidence | type) == "object"' >/dev/null 2>&1; then
    if merge_item "$id" "$branch" "$slot"; then outcome=merged; else outcome="not merged"; fi
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
    rm -rf "${worker_root:?}/w$i"
  done
  git merge --abort >/dev/null 2>&1 || true
  git worktree prune
  rmdir "$worker_root" 2>/dev/null || true
  rm -rf "$state_dir"
  write_live "$(closing_state)" parallel "$workers" "[]"
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
    slot_started[$i]=""
    slot_pointers[$i]=""
    slot_admin[$i]=""
  done
  trap stop_workers EXIT
  trap 'exit 130' INT TERM
  install_commit_hook
  remember_git_controls
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
    for ((i = 1; i <= workers; i++)); do
      [ -z "${slot_pid[$i]}" ] || continue
      [ "$launched" -lt "$max_iterations" ] || break
      id="$(next_ready 2>/dev/null)" || id=""
      [ -n "$id" ] || break
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
  jq -r '.features[] | [.id, .category, (.evidence.commit // "")] | @tsv' "$list"
}
