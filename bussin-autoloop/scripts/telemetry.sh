#!/usr/bin/env bash

live_file=.loop/live.json
stop_file=.loop/stop
usage_file=.loop/usage.jsonl
loop_started="$(date +%s)"

exclude_file="$(git rev-parse --git-path info/exclude)"
mkdir -p "$(dirname "$exclude_file")"
for pattern in /.loop/usage.jsonl /.loop/live.json /.loop/live.json.tmp /.loop/stop /.loop/attempts.json /.loop/attempts.json.tmp; do
  grep -qxF "$pattern" "$exclude_file" 2>/dev/null || echo "$pattern" >> "$exclude_file"
done
rm -f "$stop_file"

events_query='(fromjson? | objects | [.]) // [split("\n")[] | fromjson? | objects]'

usage_query='
def base: {agent: $agent, item: $item, worker: $worker, started_at: $started, ended_at: $ended, outcome: $outcome};
def wall: ($ended - $started) * 1000;
def last_result: map(select(.type == "result")) | last // {};

def claude:
  last_result as $r
  | ($r.modelUsage // {}) as $models
  | def total($field; $fallback):
      if ($models | length) > 0 then ([$models[] | .[$field] // 0] | add) else ($r.usage[$fallback] // 0) end;
    base + {
      duration_ms: ($r.duration_ms // wall),
      turns: ($r.num_turns // 0),
      cost_usd: ($r.total_cost_usd // 0),
      input_tokens: total("inputTokens"; "input_tokens"),
      output_tokens: total("outputTokens"; "output_tokens"),
      cache_read_tokens: total("cacheReadInputTokens"; "cache_read_input_tokens"),
      cache_write_tokens: total("cacheCreationInputTokens"; "cache_creation_input_tokens"),
      models: ($models | with_entries(.value |= {
        input_tokens: (.inputTokens // 0), output_tokens: (.outputTokens // 0),
        cache_read_tokens: (.cacheReadInputTokens // 0), cache_write_tokens: (.cacheCreationInputTokens // 0),
        cost_usd: (.costUSD // 0)
      }))
    };

def codex:
  [.[] | select(.type == "turn.completed") | .usage // {}] as $turns
  | def total($field): [$turns[] | .[$field] // 0] | add // 0;
    total("cached_input_tokens") as $cached
  | {
      input_tokens: (total("input_tokens") - $cached),
      output_tokens: total("output_tokens"),
      cache_read_tokens: $cached,
      cache_write_tokens: total("cache_write_input_tokens")
    } as $tokens
  | base + {duration_ms: wall, turns: ($turns | length)} + $tokens + {models: {($model): $tokens}};

def copilot:
  last_result as $r
  | ([.[] | select(.type == "assistant.message") | .data.model // empty] | unique) as $seen
  | base + {
      duration_ms: ($r.usage.sessionDurationMs // wall),
      turns: ([.[] | select(.type == "assistant.turn_end")] | length),
      premium_requests: ($r.usage.premiumRequests // 0),
      models: ((if $seen == [] then [$model] else $seen end) | map({key: ., value: {}}) | from_entries)
    };

if $agent == "codex" then codex elif $agent == "copilot" then copilot else claude end'

record_usage() {
  local item="$1" worker="$2" started="$3" output="$4" outcome="$5"
  { cat "$output" 2> /dev/null || true; } | jq -c -s -R "$events_query" \
    | jq -c --arg agent "$agent" --arg model "$(model_label)" --arg item "$item" --argjson worker "$worker" \
      --argjson started "$started" --argjson ended "$(date +%s)" --arg outcome "$outcome" "$usage_query" >> "$usage_file"
  tail -n 1 "$usage_file" | jq -r '"autoloop: \(.item) \(.outcome) after \(.duration_ms / 60000 | floor)m, "
    + (if .cost_usd then "$\(.cost_usd * 100 | round / 100)" else "cost unknown" end)
    + (if .input_tokens then ", \(.input_tokens) in / \(.output_tokens) out tokens" else "" end)'
}

write_live() {
  local state="$1" mode="$2" workers="$3" running="$4"
  jq -n --arg state "$state" --arg mode "$mode" --arg agent "$agent" --arg script "$script_dir/loop.sh" --argjson workers "$workers" --argjson started "$loop_started" \
    --argjson updated "$(date +%s)" --argjson pid "$$" --argjson running "$running" \
    '{state: $state, mode: $mode, agent: $agent, script: $script, workers: $workers, started_at: $started, updated_at: $updated, pid: $pid, running: $running}' \
    > "$live_file.tmp"
  mv "$live_file.tmp" "$live_file"
}

closing_state() {
  if [ "$(remaining 2>/dev/null || echo 1)" = 0 ]; then echo finished; else echo stopped; fi
}
