#!/usr/bin/env bash
set -euo pipefail

started_in="$PWD"
cd "$(git rev-parse --show-toplevel)"

list=.loop/feature_list.json
usage=.loop/usage.jsonl

[ -f "$list" ] || { echo "backfill: $list not found; run this from a project with a loop" >&2; exit 1; }
if [ -s "$usage" ] && [ "${1:-}" != "--force" ]; then
  echo "backfill: $usage already has data; pass --force to rebuild it from transcripts" >&2
  exit 1
fi

projects_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
transcripts=""
for dir in "$(pwd)" "$(pwd -P)" "$started_in"; do
  candidate="$projects_dir/$(printf '%s' "$dir" | sed 's/[^A-Za-z0-9]/-/g')"
  if [ -d "$candidate" ]; then transcripts="$candidate"; break; fi
done
[ -n "$transcripts" ] || { echo "backfill: no Claude Code transcripts for $(pwd) under $projects_dir" >&2; exit 1; }

session_query='
def epoch: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
def text_of: if type == "string" then . else (map(.text? // empty) | join(" ")) end;
def total($messages; $field): $messages | map(.message.usage[$field] // 0) | add // 0;
. as $rows
| ([$rows[] | select(.type == "user") | .message.content | text_of][0] // "") as $prompt
| select($prompt | test("autoloop</command-name>[\\s\\S]*<command-args>run"))
| ([$rows[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use") | .input | tostring] | join("\n")) as $written
| ([$written | scan("## Session ([0-9]+) · ([A-Za-z]+[0-9]+)")] | map({n: (.[0] | tonumber), id: .[1]}) | max_by(.n) | .id?) as $from_progress
| ([$written | scan("(?:feat|fix|test|docs|refactor|chore|ci)\\(([A-Za-z]+[0-9]+)\\)")] | last | .[0]?) as $from_commit
| ([$prompt | scan("--item ([A-Za-z]+[0-9]+)")] | first | .[0]?) as $from_args
| ([$rows[] | select(.type == "assistant" and .message.usage != null)] | group_by(.message.id) | map(last)) as $messages
| [$rows[] | .timestamp? // empty | select(type == "string")] as $times
| select(($times | length) > 0)
| ($times | min | epoch) as $started
| ($times | max | epoch) as $ended
| {
    item: ($from_args // $from_progress // $from_commit // "unknown"),
    worker: 0,
    started_at: $started,
    ended_at: $ended,
    outcome: "backfilled",
    duration_ms: (($ended - $started) * 1000),
    turns: ($messages | length),
    input_tokens: total($messages; "input_tokens"),
    output_tokens: total($messages; "output_tokens"),
    cache_read_tokens: total($messages; "cache_read_input_tokens"),
    cache_write_tokens: total($messages; "cache_creation_input_tokens"),
    models: ($messages | group_by(.message.model) | map({
      key: .[0].message.model,
      value: {
        input_tokens: total(.; "input_tokens"),
        output_tokens: total(.; "output_tokens"),
        cache_read_tokens: total(.; "cache_read_input_tokens"),
        cache_write_tokens: total(.; "cache_creation_input_tokens")
      }
    }) | from_entries)
  }'

rows="$(mktemp)"
trap 'rm -f "$rows"' EXIT
for transcript in "$transcripts"/*.jsonl; do
  [ -e "$transcript" ] || continue
  jq -c -s "$session_query" "$transcript" 2>/dev/null >> "$rows" || echo "backfill: skipped unreadable $transcript" >&2
done

jq -c -s 'sort_by(.started_at)[]' "$rows" > "$usage"
jq -r -s '"backfill: \(length) loop sessions from \(map(.started_at) | min // 0 | todate) to \(map(.ended_at) | max // 0 | todate), \(map(.input_tokens + .cache_read_tokens + .cache_write_tokens) | add // 0) input and \(map(.output_tokens) | add // 0) output tokens; cost is not in transcripts"' "$usage"
