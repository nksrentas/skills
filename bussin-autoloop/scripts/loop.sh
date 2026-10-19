#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$(git rev-parse --show-toplevel)"

list=.loop/feature_list.json
max_iterations="${MAX_ITERATIONS:-40}"
max_stalls="${MAX_STALLS:-3}"
limit_wait="${LIMIT_WAIT:-600}"
limit_pattern="hit your .*limit|usage limit reached"

source "$script_dir/agents.sh"
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null GIT_CONFIG_KEY_1=core.fsmonitor GIT_CONFIG_VALUE_1=false
skill_command="${LOOP_SKILL_COMMAND:-$(default_skill_command "$0")}"

git cat-file -e "HEAD:$list" 2> /dev/null || { echo "autoloop: $list is not committed, run $skill_command init first" >&2; exit 1; }

remaining() { git show "HEAD:$list" | jq '[.features[] | select(.passes == false)] | length'; }
session_tail() { tail -n 5 "$1"; cat "$2"; }
snapshot() { echo "$(remaining)@$(git rev-parse HEAD)"; }

source "$script_dir/telemetry.sh"
source "$script_dir/commit-hook.sh"

if [ "${LOOP_WORKERS:-1}" -gt 1 ]; then
  source "$script_dir/parallel.sh"
  run_parallel
  exit
fi

session_output="$(mktemp)"
session_errors="$(mktemp)"
trap 'rm -f "$session_output" "$session_errors"; write_live "$(closing_state)" sequential 1 "[]"' EXIT
write_live running sequential 1 "[]"

iteration=0
stalls=0
item=""
while [ "$(remaining)" -gt 0 ]; do
  if [ -e "$stop_file" ]; then
    rm -f "$stop_file"
    echo "autoloop: stopped on request${item:+ after $item}"
    exit 0
  fi
  iteration=$((iteration + 1))
  if [ "$iteration" -gt "$max_iterations" ]; then
    echo "autoloop: reached MAX_ITERATIONS=$max_iterations with $(remaining) items left" >&2
    exit 1
  fi
  echo "autoloop: iteration $iteration, $(remaining) items remaining"
  before="$(snapshot)"
  before_head="$(git rev-parse HEAD)"
  item="$(jq -r '[.features[] | select(.passes == false)][0].id' "$list")"
  started="$(date +%s)"
  write_live running sequential 1 "$(jq -n -c --arg item "$item" --argjson started "$started" '[{item: $item, worker: 0, started_at: $started}]')"
  status=0
  install_commit_hook
  remember_git_controls
  agent_command "$skill_command run"
  AUTOLOOP_SESSION=1 "${agent_cmd[@]}" > "$session_output" 2> "$session_errors" < /dev/null || status=$?
  if git_controls_changed; then exit 1; fi
  restore_uncommitted_list
  after="$(snapshot)"
  hit_limit=false
  if [ "$status" -ne 0 ] && session_tail "$session_output" "$session_errors" | grep -iE "$limit_pattern" > /dev/null; then hit_limit=true; fi
  if [ "$(git show "HEAD:$list" | jq -r --arg item "$item" '.features[] | select(.id == $item) | .passes')" = true ]; then
    outcome=passed
  elif [ "$hit_limit" = true ]; then
    outcome=limit
  elif [ "$status" -ne 0 ]; then
    outcome=error
    echo "autoloop: session exited non-zero" >&2
    tail -n 5 "$session_errors" | sed 's/^/    /' >&2
  else
    outcome=failed
  fi
  record_usage "$item" 0 "$started" "$session_output" "$outcome"
  write_live running sequential 1 "[]"
  audit_session "$before_head" || exit 1
  if [ "$before" = "$after" ] && [ "$hit_limit" = true ]; then
    iteration=$((iteration - 1))
    echo "autoloop: usage limit hit, retrying in ${limit_wait}s" >&2
    sleep "$limit_wait"
    continue
  fi
  if [ "$before" = "$after" ]; then
    stalls=$((stalls + 1))
    echo "autoloop: no progress ($stalls/$max_stalls)" >&2
  else
    stalls=0
  fi
  if [ "$stalls" -ge "$max_stalls" ]; then
    echo "autoloop: stopped after $max_stalls iterations without progress, see .loop/progress.md" >&2
    exit 1
  fi
done

echo "autoloop: all items passing"
rm -f .loop/attempts.json
jq -r '.features[] | [.id, .category, (.evidence.commit // "")] | @tsv' "$list"
