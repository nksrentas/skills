#!/usr/bin/env bash

live_file=.loop/live.json
usage_file=.loop/usage.jsonl
loop_started="$(date +%s)"

usage_query='
($result[0] // {}) as $r
| ($r.modelUsage // {}) as $models
| def total($field; $fallback):
    if ($models | length) > 0 then ([$models[] | .[$field] // 0] | add) else ($r.usage[$fallback] // 0) end;
  {
    item: $item, worker: $worker, started_at: $started, ended_at: $ended, outcome: $outcome,
    duration_ms: ($r.duration_ms // (($ended - $started) * 1000)),
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
  }'

record_usage() {
  local item="$1" worker="$2" started="$3" output="$4" outcome="$5" result
  result="$(jq -c 'select(type == "object" and .type == "result")' "$output" 2>/dev/null | tail -n 1)" || result=null
  [ -n "$result" ] || result=null
  jq -c -n --arg item "$item" --argjson worker "$worker" --argjson started "$started" \
    --argjson ended "$(date +%s)" --arg outcome "$outcome" --argjson result "[$result]" "$usage_query" >> "$usage_file"
  tail -n 1 "$usage_file" | jq -r '"autoloop: \(.item) \(.outcome) after \(.duration_ms / 60000 | floor)m, $\(.cost_usd * 100 | round / 100), \(.input_tokens) in / \(.output_tokens) out tokens"'
}

write_live() {
  local state="$1" mode="$2" workers="$3" running="$4"
  jq -n --arg state "$state" --arg mode "$mode" --argjson workers "$workers" --argjson started "$loop_started" \
    --argjson updated "$(date +%s)" --argjson pid "$$" --argjson running "$running" \
    '{state: $state, mode: $mode, workers: $workers, started_at: $started, updated_at: $updated, pid: $pid, running: $running}' \
    > "$live_file.tmp"
  mv "$live_file.tmp" "$live_file"
}

closing_state() {
  if [ "$(remaining 2>/dev/null || echo 1)" = 0 ]; then echo finished; else echo stopped; fi
}
