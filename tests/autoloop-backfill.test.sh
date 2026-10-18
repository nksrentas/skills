#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "$0")/../bussin-autoloop/scripts" && pwd)/backfill-usage.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

check() {
  if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

project="$tmp/project"
mkdir -p "$project/.loop"
git -C "$project" init -q
echo '{"features":[{"id":"F1","passes":true},{"id":"F2","passes":false}]}' > "$project/.loop/feature_list.json"
transcripts="$tmp/config/projects/$(cd "$project" && pwd | sed 's/[^A-Za-z0-9]/-/g')"
mkdir -p "$transcripts"

{
  echo '{"type":"user","timestamp":"2026-10-18T10:00:00.120Z","message":{"content":"<command-message>bussin-autoloop</command-message>\n<command-name>/bussin-autoloop</command-name>\n<command-args>run</command-args>"}}'
  echo '{"type":"user","timestamp":"2026-10-18T10:00:05Z","message":{"content":[{"type":"tool_result","content":"## Session 1 · F1 · 2026-10-18"}]}}'
  echo '{"type":"assistant","timestamp":"2026-10-18T10:01:00Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":3,"output_tokens":100,"cache_read_input_tokens":1000,"cache_creation_input_tokens":50},"content":[{"type":"text","text":"working"}]}}'
  echo '{"type":"assistant","timestamp":"2026-10-18T10:01:01Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":3,"output_tokens":100,"cache_read_input_tokens":1000,"cache_creation_input_tokens":50},"content":[{"type":"tool_use","name":"Edit","input":{"new_string":"## Session 2 · F2 · 2026-10-18"}}]}}'
  echo '{"type":"assistant","timestamp":"2026-10-18T10:12:00.500Z","message":{"id":"m2","model":"claude-haiku-4-5","usage":{"input_tokens":7,"output_tokens":20,"cache_read_input_tokens":0,"cache_creation_input_tokens":0},"content":[{"type":"tool_use","name":"Bash","input":{"command":"git commit -m \"feat(F2): thing\""}}]}}'
} > "$transcripts/loop-session.jsonl"

{
  echo '{"type":"user","timestamp":"2026-10-18T11:00:00Z","message":{"content":"Review this change for security vulnerabilities."}}'
  echo '{"type":"assistant","timestamp":"2026-10-18T11:02:00Z","message":{"id":"x1","model":"claude-opus-5-5","usage":{"input_tokens":9,"output_tokens":9},"content":[]}}'
} > "$transcripts/other-session.jsonl"

out="$(cd "$project" && CLAUDE_CONFIG_DIR="$tmp/config" bash "$script")"
usage="$project/.loop/usage.jsonl"
check "only loop sessions are recovered" '[ "$(wc -l < "$usage" | tr -d " ")" = 1 ]'
check "the item is the heading the session wrote, not one it read" '[ "$(jq -r .item "$usage")" = F2 ]'
check "repeated message ids are counted once" '[ "$(jq .output_tokens "$usage")" = 120 ] && [ "$(jq .input_tokens "$usage")" = 10 ] && [ "$(jq .cache_read_tokens "$usage")" = 1000 ]'
check "tokens are broken down by model" '[ "$(jq -r ".models | keys | join(\",\")" "$usage")" = "claude-haiku-4-5,claude-opus-5-5" ] && [ "$(jq ".models[\"claude-haiku-4-5\"].output_tokens" "$usage")" = 20 ]'
check "duration comes from the first and last timestamps" '[ "$(jq .duration_ms "$usage")" = 720000 ]'
check "cost is left unknown, not zero" '[ "$(jq "has(\"cost_usd\")" "$usage")" = false ] && [[ "$out" == *"cost is not in transcripts"* ]]'
refused=0
(cd "$project" && CLAUDE_CONFIG_DIR="$tmp/config" bash "$script" > /dev/null 2>&1) || refused=1
check "existing usage data is kept unless --force is given" '[ "$refused" = 1 ]'
(cd "$project" && CLAUDE_CONFIG_DIR="$tmp/config" bash "$script" --force > /dev/null)
check "--force rebuilds it" '[ "$(wc -l < "$usage" | tr -d " ")" = 1 ]'

[ "$failures" = 0 ] && echo "all backfill checks passed" || { echo "$failures backfill checks failed"; exit 1; }
