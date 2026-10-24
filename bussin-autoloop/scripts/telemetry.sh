#!/usr/bin/env bash

live_file=.loop/live.json
stop_file=.loop/stop
usage_file=.loop/usage.jsonl
lock_dir=.loop/run.lock
attempts_file=.loop/attempts.json
item_attempts="${LOOP_ITEM_ATTEMPTS:-3}"
loop_started="$(date +%s)"

exclude_file="$(git rev-parse --git-path info/exclude)"
mkdir -p "$(dirname "$exclude_file")"
for pattern in /.loop/usage.jsonl /.loop/live.json /.loop/live.json.tmp /.loop/stop /.loop/attempts.json /.loop/attempts.json.tmp /.loop/run.lock/ /.loop/port /.loop/logs/ /.loop/name; do
  grep -qxF "$pattern" "$exclude_file" 2>/dev/null || echo "$pattern" >> "$exclude_file"
done

refuse_second_loop() {
  echo "autoloop: a loop is already running here (pid $1); stop it first or use another worktree" >&2
  exit 1
}

live_pid="$(jq -r 'select(.state == "running" or .state == "stopping") | .pid // empty' "$live_file" 2>/dev/null || true)"
if [ -n "$live_pid" ] && kill -0 "$live_pid" 2>/dev/null; then refuse_second_loop "$live_pid"; fi
if ! mkdir "$lock_dir" 2>/dev/null; then
  lock_pid="$(cat "$lock_dir/pid" 2>/dev/null || { sleep 1; cat "$lock_dir/pid" 2>/dev/null; } || true)"
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then refuse_second_loop "$lock_pid"; fi
  rm -rf "$lock_dir"
  mkdir "$lock_dir" 2>/dev/null || refuse_second_loop "$(cat "$lock_dir/pid" 2>/dev/null || echo unknown)"
fi
echo "$$" > "$lock_dir/pid"
release_lock() { remove_agent_settings; [ "$(cat "$lock_dir/pid" 2>/dev/null || true)" != "$$" ] || rm -rf "$lock_dir"; }
trap release_lock EXIT
rm -f "$stop_file"

events_query='[split("\n")[] | fromjson? | objects]'

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
  local item="$1" worker="$2" started="$3" output="$4" outcome="$5" ended="${6:-$(date +%s)}"
  { cat "$output" 2> /dev/null || true; } | jq -c -s -R "$events_query" \
    | jq -c --arg agent "$agent" --arg model "$(model_label)" --arg item "$item" --argjson worker "$worker" \
      --argjson started "$started" --argjson ended "$ended" --arg outcome "$outcome" "$usage_query" >> "$usage_file"
  tail -n 1 "$usage_file" | jq -r '"autoloop: \(.item) \(.outcome) after \(.duration_ms / 60000 | floor)m, "
    + (if .cost_usd then "$\(.cost_usd * 100 | round / 100)" else "cost unknown" end)
    + (if .input_tokens then ", \(.input_tokens) in / \(.output_tokens) out tokens" else "" end)'
}

write_live() {
  local state="$1" mode="$2" workers="$3" running="$4"
  jq -n --arg state "$state" --arg mode "$mode" --arg agent "$agent" --arg script "$script_dir/loop.sh" --argjson workers "$workers" --argjson started "$loop_started" \
    --argjson updated "$(date +%s)" --argjson pid "$$" --argjson running "$running" \
    --argjson sessions "${max_sessions:-1}" --argjson in_use "$(sessions_in_use 2> /dev/null || echo 0)" \
    '{state: $state, mode: $mode, agent: $agent, script: $script, workers: $workers, started_at: $started, updated_at: $updated, pid: $pid, running: $running,
      machine: {sessions: $sessions, in_use: $in_use}}' \
    > "$live_file.tmp"
  mv "$live_file.tmp" "$live_file"
}

pause() {
  [[ "$1" =~ ^[0-9]+$ ]] || { sleep "$1"; return; }
  local until=$((SECONDS + 10#$1))
  while [ "$SECONDS" -lt "$until" ] && [ ! -e "$stop_file" ]; do sleep 1; done
}

lessons_hint() {
  local count
  count="$(grep -c '^Lesson:' .loop/progress.md 2> /dev/null || true)"
  [ "${count:-0}" -gt 0 ] || return 0
  echo "autoloop: this loop recorded $count lesson$([ "$count" = 1 ] || echo s); run /bussin-autoloop retro to turn them into rules"
}

closing_state() {
  if [ "$(remaining 2>/dev/null || echo 1)" = 0 ]; then echo finished; else echo stopped; fi
}

json_array() {
  if [ $# -eq 0 ]; then echo '[]'; else printf '%s\n' "$@" | jq -R . | jq -s -c .; fi
}

attempts_of() { jq -r --arg id "$1" '.[$id] | if type == "number" then floor else 0 end' "$attempts_file" 2>/dev/null || echo 0; }

set_attempts() {
  { jq -e 'objects' "$attempts_file" 2>/dev/null || echo '{}'; } | jq --arg id "$1" --argjson count "$2" '.[$id] = $count' > "$attempts_file.tmp"
  mv "$attempts_file.tmp" "$attempts_file"
}

exhausted_items() {
  jq -r --argjson max "$item_attempts" 'to_entries[] | select((.value | type) == "number" and .value >= $max) | .key' "$attempts_file" 2>/dev/null || true
}
