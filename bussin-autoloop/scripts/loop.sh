#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

list=.loop/feature_list.json
max_iterations="${MAX_ITERATIONS:-40}"
max_stalls="${MAX_STALLS:-3}"
limit_wait="${LIMIT_WAIT:-600}"
limit_pattern="hit your .*limit|usage limit reached"

[ -f "$list" ] || { echo "autoloop: $list not found, run /bussin-autoloop init first" >&2; exit 1; }

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

session_output="$(mktemp)"
trap 'rm -f "$session_output"' EXIT

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
  status=0
  claude -p "/bussin-autoloop run" --allowedTools "${allowed_tools[@]}" --disallowedTools "${denied_tools[@]}" 2>&1 | tee "$session_output" || status=$?
  [ "$status" -eq 0 ] || echo "autoloop: session exited non-zero" >&2
  after="$(snapshot)"
  if [ "$before" = "$after" ] && [ "$status" -ne 0 ] && grep -qiE "$limit_pattern" "$session_output"; then
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
