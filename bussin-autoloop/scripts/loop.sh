#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

list=.loop/feature_list.json
max_iterations="${MAX_ITERATIONS:-40}"
max_stalls="${MAX_STALLS:-3}"
allowed_tools="${LOOP_ALLOWED_TOOLS:-Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite}"

[ -f "$list" ] || { echo "autoloop: $list not found, run /bussin-autoloop init first" >&2; exit 1; }

remaining() { jq '[.features[] | select(.passes == false)] | length' "$list"; }
snapshot() { echo "$(remaining)@$(git rev-parse HEAD)"; }

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
  claude -p "/bussin-autoloop run" --allowedTools "$allowed_tools" || echo "autoloop: session exited non-zero" >&2
  after="$(snapshot)"
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
