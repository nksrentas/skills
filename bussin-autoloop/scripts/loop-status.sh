#!/usr/bin/env bash
set -euo pipefail

watch_seconds=""
stop=0
target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --watch)
      watch_seconds=5
      if [[ "${2:-}" =~ ^[0-9]+$ ]]; then watch_seconds="$2"; shift; fi
      ;;
    --stop) stop=1 ;;
    -h | --help)
      echo "usage: loop-status.sh [--watch [seconds] | --stop] [project dir]"
      exit 0
      ;;
    *) target="$1" ;;
  esac
  shift
done

bold="" dim="" reset=""
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  bold=$'\033[1m' dim=$'\033[2m' reset=$'\033[0m'
fi

render_query='
def two: tostring | if length < 2 then "0" + . else . end;
def dur: (. / 60 | floor) as $m
  | if $m < 1 then "\(. | round)s" elif $m < 60 then "\($m)m" else "\($m / 60 | floor)h \($m % 60 | two)m" end;
def fixed($scale): if . >= $scale * 10 then "\(. / $scale | round)" else (. * 10 / $scale | round) as $t | "\($t / 10 | floor).\($t % 10)" end;
def tok: if . >= 1000000 then "\(fixed(1000000))M" elif . >= 1000 then "\(fixed(1000))k" else tostring end;
def usd: (. * 100 | round) as $c | "$\($c / 100 | floor).\($c % 100 | two)";
def bar($d; $t; $w): (if $t == 0 then 0 else ($d / $t * $w | round) end) as $f
  | ([range($f)] | map("█") | join("")) + ([range($w - $f)] | map("░") | join(""));
def clean: tostring | gsub("[\u0000-\u001f\u007f-\u009f]"; "");
def cut($n): if length > $n then .[0:$n - 1] + "…" else . end;
def pad($n): if length >= $n then . else . + (" " * ($n - length)) end;
def title: (.description // "" | clean) as $d | ($d | split(": ")[0]) as $h
  | (if ($h | length) > 0 and ($h | length) <= 56 then $h else $d end) | cut(56);
def sum(f): map(f // 0) | add // 0;
def row($label; $id; $title; $note): "  \($label | pad(6))\($id | clean | pad(6)) \($title | pad(57))\($dim)\($note)\($reset)";

(.features // []) as $features
| ($live[0] // {}) as $l
| ($features | map(select(.passes == true) | .id)) as $passed
| ($features | length) as $total
| ($passed | length) as $done
| (if $l.state == "running" and $stop_requested then "stopping"
   elif ["running", "stopping", "finished", "stopped"] | index($l.state) then $l.state
   elif $done == $total and $total > 0 then "finished" else "idle" end) as $state
| (["running", "stopping"] | index($state) != null) as $active
| (if $active then ($l.running // []) else [] end) as $running
| ($running | map(.item)) as $running_ids
| ($usage | map(select(.cost_usd != null))) as $priced
| ($usage | sum(.duration_ms) / 1000) as $session_sec
| ($usage | map(select(.item as $i | $passed | index($i))) | map(.item) | unique | length) as $done_by_loop
| ($total - $done) as $left
| (if $l.mode == "parallel" then ([1, ([($l.workers // 1), $left] | min)] | max) else 1 end) as $parallel
| (if $state == "running" and $done_by_loop > 0 and $left > 0 then ($left * $session_sec / $done_by_loop / $parallel | round) else null end) as $eta
| ($l.started_at // $usage[0].started_at) as $first
| (if $active then $now else ($l.updated_at // $usage[-1].ended_at // $now) end) as $last
| (if $first then ([0, $last - $first] | max) else 0 end) as $elapsed
| def spend($id): ($usage | map(select(.item == $id))) as $s
    | [ (if ($s | map(select(.cost_usd != null)) | length) > 0 then ($s | sum(.cost_usd) | usd)
         elif ($s | length) > 0 then "cost unknown" else empty end),
        (($s | sum(.duration_ms) / 60000 | floor) | select(. > 0) | "\(.)m") ] | join(" · ");
  def note: . as $f
    | ($usage | map(select(.item == $f.id)) | length) as $tries
    | (($f.depends_on // []) - $passed) as $waiting
    | if $tries > 0 then ([if $tries == 1 then "1 attempt" else "\($tries) attempts" end, spend($f.id)] | map(select(. != "")) | join(" · "))
      elif ($waiting | length) > 0 then "waiting for \($waiting | map(clean) | join(", "))"
      else "ready" end;
  ({running: "▶", stopping: "□", finished: "✓", stopped: "■", idle: "·"}[$state]) as $icon
| [ "\($bold)\($icon) \($name)\($reset)  \($state) · \($l.mode // "sequential")"
    + (if ($l.workers // 1) > 1 then " ×\($l.workers)" else "" end)
    + (if $l.agent then " · \($l.agent | clean)" else "" end),
    "  \(bar($done; $total; 24)) \($done)/\($total)"
    + (if $elapsed > 0 then " · \($elapsed | dur) elapsed" else "" end)
    + (if $state == "running" then (if $eta then " · ETA \($eta | dur) (\($now + $eta | strflocaltime("%H:%M")))" else " · ETA after first item" end) else "" end)
    + (if ($priced | length) > 0 then " · \($priced | sum(.cost_usd) | usd)" else "" end),
    ""
  ]
  + ([$running[] | . as $r | ($features | map(select(.id == $r.item))[0] // {id: $r.item}) as $f
      | {id: $f.id, title: ($f | title), note: ((if $r.worker > 0 then "worker \($r.worker) · " else "" end) + ([0, $now - $r.started_at] | max | dur))}]
     | to_entries | map(row(if .key == 0 then "Now" else "" end; .value.id; .value.title; .value.note)))
  + ([$features[] | select(.passes != true) | select(.id as $i | $running_ids | index($i) | not)] | .[0:5]
     | to_entries | map(row(if .key == 0 then "Next" else "" end; .value.id; (.value | title); (.value | note))))
  + ([$features[] | select(.passes == true)] | .[-5:] | reverse
     | to_entries | map(row(if .key == 0 then "Done" else "" end; .value.id; (.value | title); (spend(.value.id) | if . == "" then "done" else . end))))
  + (if ($usage | length) == 0 then ["", "  \($dim)No session telemetry yet.\($reset)"] else
      [ "",
        "  Cost    " + (if ($priced | length) > 0 then ($priced | sum(.cost_usd) | usd) else "unknown" end)
          + " over \($usage | length) sessions"
          + (($usage | length) - ($priced | length) | if . > 0 then " · \(.) unpriced" else "" end)
          + ($usage | sum(.premium_requests) | if . > 0 then " · \(.) premium requests" else "" end),
        "  Tokens  \($usage | sum(.input_tokens) | tok) in · \($usage | sum(.output_tokens) | tok) out · \($usage | sum(.cache_read_tokens) | tok) cache read · \($usage | sum(.cache_write_tokens) | tok) cache write"
      ]
      + ([$usage[] | .cost_usd as $c | (.models // {}) | to_entries[] | {name: .key, cost: (if $c != null then .value.cost_usd // 0 else null end), input: (.value.input_tokens // 0), output: (.value.output_tokens // 0)}]
         | group_by(.name)
         | map({name: (.[0].name | clean | sub("^claude-"; "")), cost: (map(.cost) | if any(. != null) then map(. // 0) | add else null end), input: sum(.input), output: sum(.output)})
         | sort_by(-(.cost // 0))
         | to_entries | map("  \(if .key == 0 then "Models" else "" end | pad(8))\(.value.name | pad(22)) \(if .value.cost != null then (.value.cost | usd) else "cost unknown" end) · \(.value.input | tok) in · \(.value.output | tok) out"))
    end)
  + ($progress | split("\n") | map(select(startswith("## ")) | .[3:] | clean) | .[-3:]
     | if length == 0 then [] else [""] + (to_entries | map("  \(if .key == 0 then "Recent" else "" end | pad(8))\(.value | cut(80))")) end)
| .[]'

render() {
  local dir="$1" name="$2"
  { cat "$dir/.loop/usage.jsonl" 2> /dev/null || true; } \
    | jq -c -s -R '[split("\n")[] | fromjson? | objects | select(.item | type == "string")]' > "$scratch/usage"
  { cat "$dir/.loop/live.json" 2> /dev/null || true; } | jq -c -s -R '[fromjson? | objects]' > "$scratch/live"
  { cat "$dir/.loop/progress.md" 2> /dev/null || true; } > "$scratch/progress"
  if ! jq -r --arg name "$name" --argjson now "$(date +%s)" --slurpfile usage "$scratch/usage" --slurpfile live "$scratch/live" \
    --rawfile progress "$scratch/progress" --argjson stop_requested "$([ -e "$dir/.loop/stop" ] && echo true || echo false)" --arg bold "$bold" --arg dim "$dim" --arg reset "$reset" \
    '. as $list | ($usage[0]) as $usage | ($live[0]) as $live | $list | '"$render_query" "$dir/.loop/feature_list.json" 2> "$scratch/error"; then
    echo "$name: cannot read .loop/feature_list.json ($(head -n 1 "$scratch/error"))" >&2
  fi
}

loop_dirs() {
  if [ -n "$target" ]; then
    (cd "$target" || exit 1; git rev-parse --show-toplevel 2> /dev/null || pwd)
    return
  fi
  git worktree list --porcelain 2> /dev/null \
    | awk '/^worktree /{path = substr($0, 10)} /^branch refs\/heads\/loop\//{path = ""} /^$/{if (path != "") print path; path = ""} END{if (path != "") print path}' || true
  git rev-parse --show-toplevel 2> /dev/null || pwd
}

show_all() {
  local dir shown=0
  while IFS= read -r dir; do
    [ -f "$dir/.loop/feature_list.json" ] || continue
    [ "$shown" = 0 ] || echo
    render "$dir" "$(basename "$dir")"
    shown=1
  done < <(loop_dirs | awk '!seen[$0]++')
  [ "$shown" = 1 ] || { echo "No autoloop found here. Run it inside a project with .loop/feature_list.json." >&2; return 1; }
}

request_stop() {
  local dir
  dir="$(cd "${target:-.}" && { git rev-parse --show-toplevel 2> /dev/null || pwd; })"
  [ -f "$dir/.loop/feature_list.json" ] || { echo "No autoloop in $dir." >&2; return 1; }
  touch "$dir/.loop/stop"
  echo "autoloop: $(basename "$dir") stops after its running items finish. Run loop.sh again to resume."
}

if [ "$stop" = 1 ]; then
  request_stop
  exit
fi

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

if [ -z "$watch_seconds" ]; then
  show_all
  exit
fi
while :; do
  frame="$(show_all 2>&1 || true)"
  printf '\033[H\033[2J%s\n\n%sRefreshing every %ss · Ctrl-C to stop%s\n' "$frame" "$dim" "$watch_seconds" "$reset"
  sleep "$watch_seconds"
done
