#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$(git rev-parse --show-toplevel)"

list=.loop/feature_list.json
max_iterations="${MAX_ITERATIONS:-40}"
max_stalls="${MAX_STALLS:-3}"
limit_wait="${LIMIT_WAIT:-600}"
limit_pattern="hit your .*limit|usage limit reached"

case "$0" in
  */plugins/cache/*) default_command="/bussin:bussin-autoloop" ;;
  *) default_command="/bussin-autoloop" ;;
esac
skill_command="${LOOP_SKILL_COMMAND:-$default_command}"

[ -f "$list" ] || { echo "autoloop: $list not found, run $skill_command init first" >&2; exit 1; }

allowed_tools=(
  Read Edit Write Glob Grep Skill Agent TodoWrite
  "Bash(bash .loop/init.sh)" "Bash(bash .loop/verify.sh)"
  "Bash(git status *)" "Bash(git diff *)" "Bash(git log *)" "Bash(git show *)"
  "Bash(git add *)" "Bash(git commit *)" "Bash(git rev-parse *)"
)
if [ -f .loop/config.json ]; then
  while IFS= read -r project_command; do
    [ -n "$project_command" ] && allowed_tools+=("Bash($project_command)" "Bash($project_command *)")
  done < <(jq -r '.commands // {} | .[] | strings' .loop/config.json)
fi
denied_tools=()
for protected in ".loop/*.sh" ".loop/config.json" ".claude/**" ".git/**"; do
  denied_tools+=("Edit($protected)" "Write($protected)")
done
if [ -n "${LOOP_EXTRA_TOOLS:-}" ]; then
  IFS=',' read -r -a extra_tools <<< "$LOOP_EXTRA_TOOLS"
  allowed_tools+=("${extra_tools[@]}")
fi

remaining() { jq '[.features[] | select(.passes == false)] | length' "$list"; }
snapshot() { echo "$(remaining)@$(git rev-parse HEAD)"; }

source "$script_dir/telemetry.sh"

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
while [ "$(remaining)" -gt 0 ]; do
  iteration=$((iteration + 1))
  if [ "$iteration" -gt "$max_iterations" ]; then
    echo "autoloop: reached MAX_ITERATIONS=$max_iterations with $(remaining) items left" >&2
    exit 1
  fi
  echo "autoloop: iteration $iteration, $(remaining) items remaining"
  before="$(snapshot)"
  item="$(jq -r '[.features[] | select(.passes == false)][0].id' "$list")"
  started="$(date +%s)"
  write_live running sequential 1 "$(jq -n -c --arg item "$item" --argjson started "$started" '[{item: $item, worker: 0, started_at: $started}]')"
  status=0
  claude -p "$skill_command run" --output-format json --allowedTools "${allowed_tools[@]}" --disallowedTools "${denied_tools[@]}" \
    > "$session_output" 2> "$session_errors" < /dev/null || status=$?
  after="$(snapshot)"
  hit_limit=false
  if [ "$status" -ne 0 ] && grep -qiE "$limit_pattern" "$session_output" "$session_errors"; then hit_limit=true; fi
  if [ "$(jq -r --arg item "$item" '.features[] | select(.id == $item) | .passes' "$list")" = true ]; then
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
jq -r '.features[] | [.id, .category, (.evidence.commit // "")] | @tsv' "$list"
