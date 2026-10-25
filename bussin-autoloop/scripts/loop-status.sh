#!/usr/bin/env bash
set -euo pipefail

watch_seconds=""
stop=0
title=0
rename=""
target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --watch)
      watch_seconds=5
      if [[ "${2:-}" =~ ^[0-9]+$ ]]; then watch_seconds="$2"; shift; fi
      [ "$watch_seconds" -ge 1 ] || { echo "loop-status.sh: --watch needs 1 or more seconds" >&2; exit 1; }
      ;;
    --stop) stop=1 ;;
    --title) title=1 ;;
    --rename)
      rename="${2:-}"
      [ -n "$rename" ] || { echo "loop-status.sh: --rename needs a name" >&2; exit 1; }
      shift
      ;;
    -h | --help)
      echo "usage: loop-status.sh [--watch [seconds] | --stop | --rename <name> | --title] [project dir]"
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
def num: if type == "number" then . else 0 end;
def opt: if type == "number" then . else null end;
def str: if type == "string" then clean else null end;
def cut($n): if length > $n then .[0:$n - 1] + "…" else . end;
def pad($n): if length >= $n then . else . + (" " * ($n - length)) end;
def title: (.description // "" | clean) as $d | ($d | split(": ")[0]) as $h
  | (if ($h | length) > 0 and ($h | length) <= 56 then $h else $d end) | cut(56);
def sum(f): map(f // 0) | add // 0;
def row($label; $id; $title; $note): "  \($label | pad(6))\($id | clean | pad(6)) \($title | pad(57))\($dim)\($note)\($reset)";
def step_names: ["orient", "implement", "gate", "review", "browser", "commit"];
def steps($lines): ([$lines[] | .[1] | select(. != "-" and (step_names | index(.) != null))]) as $found
  | ($found[-1] // "orient") as $now
  | ($found + (if $now != "orient" then ["orient"] else [] end)) as $seen
  | step_names | map(. as $s | ($s[0:1] | ascii_upcase) + $s[1:] | if $s == $now then "[\(.)]" elif ($seen | index($s)) != null then "✓\(.)" else "\($dim)\(.)\($reset)" end) | join(" ");
def log_rows($lines): $lines[-3:] | map("              \($dim)\(.[0] // "")\($reset) \((.[2] // "") | clean | pad(6)) \((.[3] // "") | clean | cut(70))");

(.features | map(objects)) as $features
| ($usage | map(. + {
    item: (.item | clean), duration_ms: (.duration_ms | num), cost_usd: (.cost_usd | opt), premium_requests: (.premium_requests | num),
    input_tokens: (.input_tokens | num), output_tokens: (.output_tokens | num), cache_read_tokens: (.cache_read_tokens | num), cache_write_tokens: (.cache_write_tokens | num),
    started_at: (.started_at | opt), ended_at: (.ended_at | opt),
    models: (.models | objects // {} | map_values(objects // {} | {input_tokens: (.input_tokens | num), output_tokens: (.output_tokens | num), cost_usd: (.cost_usd | num)}))
  })) as $usage
| ($live[0] // {}) as $raw
| { state: ($raw.state | str), mode: ($raw.mode | str // "sequential"), agent: ($raw.agent | str),
    workers: ([1, ($raw.workers | num | floor)] | max), started_at: ($raw.started_at | opt), updated_at: ($raw.updated_at | opt),
    running: [($raw.running | arrays // [])[] | objects | {item: (.item | clean), worker: (.worker | num | floor), started_at: (.started_at | opt // $now)}] } as $l
| ($features | map(select(.passes == true) | .id) | unique) as $passed
| ($features | length) as $total
| ($passed | length) as $done
| ($l.running | length > 0 and $now - ($l.updated_at // $now) > 900) as $silent
| (($driver == "exited" or ($driver == "unknown" and $silent)) and (["running", "stopping", "queued"] | index($l.state) != null)) as $exited
| (if $exited then "stopped"
   elif $l.state == "running" and $stop_requested then "stopping"
   elif ["running", "stopping", "queued", "finished", "stopped"] | index($l.state) then $l.state
   elif $done == $total and $total > 0 then "finished" else "idle" end) as $state
| (["running", "stopping"] | index($state) != null) as $active
| (if $active then $l.running else [] end) as $running
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
        (($s | sum(.duration_ms) / 60000 | round) | select(. > 0) | "\(.)m") ] | join(" · ");
  def note: . as $f
    | ($usage | map(select(.item == $f.id)) | length) as $tries
    | (($f.depends_on | arrays // []) - $passed) as $waiting
    | if $tries > 0 then ([if $tries == 1 then "1 attempt" else "\($tries) attempts" end, spend($f.id)] | map(select(. != "")) | join(" · "))
      elif ($waiting | length) > 0 then "waiting for \($waiting | map(clean) | join(", "))"
      else "ready" end;
  ({running: "●", stopping: "◌", queued: "◌", finished: "✓", stopped: "■", idle: "·"}[$state]) as $icon
| ($raw.machine | objects // null) as $machine
| [ "\($bold)\($icon) \($name)\($reset)  \($state)\(if $exited then " (driver exited)" else "" end) · \($l.mode)"
    + (if $l.workers > 1 then " ×\($l.workers)" else "" end)
    + (if $l.agent then " · \($l.agent)" else "" end),
    "  \(bar($done; $total; 24)) \($done)/\($total)"
    + (if $elapsed > 0 then " · \($elapsed | dur) elapsed" else "" end)
    + (if $state == "running" then (if $eta then " · ETA \($eta | dur) (\($now + $eta | strflocaltime("%H:%M")))" else " · ETA after first item" end) else "" end)
    + (if ($priced | length) > 0 then " · \($priced | sum(.cost_usd) | usd)" else "" end),
    (if $machine then "  \($dim)this Mac: \($machine.in_use | num)/\($machine.sessions | num) loop sessions\(if $state == "queued" then ", waiting for a free one" else "" end)\($reset)" else empty end),
    ""
  ]
  + ([$running[] | . as $r | ($features | map(select(.id == $r.item))[0] // {id: $r.item}) as $f
      | {id: $f.id, title: ($f | title), note: ((if $r.worker > 0 then "worker \($r.worker) · " else "" end) + ([0, $now - $r.started_at] | max | dur))}]
     | to_entries | map(row(if .key == 0 then "Now" else "" end; .value.id; .value.title; .value.note),
         (($logs[.value.id] // []) as $lines | if ($lines | length) > 0 then ("              " + steps($lines)), log_rows($lines)[] else empty end)))
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

driver_state() {
  local pid
  pid="$(jq -r 'select(.state == "running" or .state == "stopping" or .state == "queued") | .pid | select(type == "number" and . > 0 and . == floor)' "$1/.loop/live.json" 2> /dev/null || true)"
  if [ -z "$pid" ]; then
    echo unknown
  elif ps -p "$pid" -o command= 2> /dev/null | head -n 1 | grep -qE '(^|[[:space:]/])loop\.sh([[:space:]]|$)'; then
    echo alive
  else
    echo exited
  fi
}

running_logs() {
  local id
  {
    echo '{}'
    while IFS= read -r id; do
      [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] && [ -f "$1/.loop/logs/$id.log" ] || continue
      tail -n 40 "$1/.loop/logs/$id.log" | jq -R -s -c --arg id "$id" '{($id): (split("\n") | map(select(length > 0) | split("\t")))}'
    done < <(jq -r '.running[]?.item | strings' "$1/.loop/live.json" 2> /dev/null || true)
  } | jq -s -c 'add'
}

error_note() {
  local first
  first="$(head -n 1 "$scratch/error")"
  [ -z "$first" ] || echo " ($first)"
}

render() {
  local dir="$1" name="$2"
  if ! jq -e '.features | arrays' "$dir/.loop/feature_list.json" > /dev/null 2> "$scratch/error"; then
    echo "$name: cannot read .loop/feature_list.json, which needs a features array$(error_note)" >&2
    return 1
  fi
  { cat "$dir/.loop/usage.jsonl" 2> /dev/null || true; } \
    | jq -c -s -R '[split("\n")[] | fromjson? | objects | select(.item | type == "string")]' > "$scratch/usage"
  { cat "$dir/.loop/live.json" 2> /dev/null || true; } | jq -c -s -R '[fromjson? | objects]' > "$scratch/live"
  { cat "$dir/.loop/progress.md" 2> /dev/null || true; } > "$scratch/progress"
  running_logs "$dir" > "$scratch/logs"
  if ! jq -r --arg name "$name" --argjson now "$(date +%s)" --slurpfile usage "$scratch/usage" --slurpfile live "$scratch/live" --slurpfile logs "$scratch/logs" \
    --rawfile progress "$scratch/progress" --argjson stop_requested "$([ -e "$dir/.loop/stop" ] && echo true || echo false)" --arg driver "$(driver_state "$dir")" --arg bold "$bold" --arg dim "$dim" --arg reset "$reset" \
    '. as $list | ($usage[0]) as $usage | ($live[0]) as $live | ($logs[0]) as $logs | $list | '"$render_query" "$dir/.loop/feature_list.json" 2> "$scratch/error"; then
    echo "$name: cannot render the status from its .loop/ files$(error_note)" >&2
    return 1
  fi
}

loop_dirs() {
  if [ -n "$target" ]; then
    (cd "$target" || exit 1; git rev-parse --show-toplevel 2> /dev/null || pwd)
    return
  fi
  git worktree list --porcelain 2> /dev/null \
    | awk '/^worktree /{path = substr($0, 10)} /^branch refs\/heads\/loop\/[^\/]+\/[^\/]+$/{path = ""} /^$/{if (path != "") print path; path = ""} END{if (path != "") print path}' || true
  git rev-parse --show-toplevel 2> /dev/null || pwd
}

label_query='
def clean: tostring | gsub("[\u0000-\u001f\u007f-\u009f]"; "") | gsub("^\\s+|\\s+$"; "");
def title: (split(": ")[0]) as $head
  | (if ($head | length) > 0 and ($head | length) <= 40 then $head else . end)
  | if length > 40 then (.[0:41] | sub("\\s+\\S*$"; "")) + "…" else . end;
((.name // "") | clean) as $name
| ((.task // "") | clean | split(". ")[0]) as $task
| if $name != "" then ($name | title) elif $task != "" then ($task | title) else $folder end'

loop_label() {
  local custom
  custom="$(head -n 1 "$1/.loop/name" 2> /dev/null | tr -d '\000-\037\177' | cut -c1-60 | sed 's/^ *//; s/ *$//')"
  if [ -n "$custom" ]; then echo "$custom"; return; fi
  jq -r --arg folder "$2" "$label_query" "$1/.loop/config.json" 2> /dev/null || echo "$2"
}

repo_name() {
  local common
  common="$(cd "$1" && cd "$(git rev-parse --git-common-dir 2> /dev/null)" 2> /dev/null && pwd)" || return 0
  case "$common" in */.git) basename "$(dirname "$common")" ;; esac
}

short_name() {
  local name repo="$2"
  name="$(basename "$1")"
  if [ -n "$repo" ] && [ "$name" != "$repo" ] && [ "${name#"$repo"-}" != "$name" ]; then name="${name#"$repo"-}"; fi
  echo "$name"
}

show_all() {
  local dir label repo shown=0 rendered=0
  repo="$(repo_name "${target:-.}")"
  while IFS= read -r dir; do
    [ -f "$dir/.loop/feature_list.json" ] || continue
    printf '%s\t%s\n' "$(loop_label "$dir" "$(short_name "$dir" "$repo")")" "$dir"
  done < <(loop_dirs | awk '!seen[$0]++') > "$scratch/loops"
  while IFS="$(printf '\t')" read -r label dir; do
    [ "$shown" = 0 ] || echo
    if [ "$(cut -f1 "$scratch/loops" | grep -cxF -- "$label")" -gt 1 ]; then label="$label ($(short_name "$dir" "$repo"))"; fi
    if render "$dir" "$label"; then rendered=1; fi
    shown=1
  done < "$scratch/loops"
  [ "$shown" = 1 ] || { echo "No autoloop found here. Run it inside a project with .loop/feature_list.json." >&2; return 1; }
  [ "$rendered" = 1 ]
}

worker_main_dir() {
  local name
  name="$(git symbolic-ref -q --short HEAD 2> /dev/null | sed -n 's|^loop/\([^/]*\)/[^/]*$|\1|p' || true)"
  [ -n "$name" ] || return 1
  git worktree list --porcelain | awk -v name="$name" '
    /^worktree / {
      path = substr($0, 10); base = path; sub(/.*\//, "", base); gsub(/[^A-Za-z0-9._-]/, "-", base)
      if (first == "") first = path
      if (base == name) { print path; found = 1; exit }
    }
    END { if (!found) print first }'
}

request_stop() {
  local dir
  dir="$(cd "${target:-.}" && { worker_main_dir || git rev-parse --show-toplevel 2> /dev/null || pwd; })"
  [ -f "$dir/.loop/feature_list.json" ] || { echo "No autoloop in $dir." >&2; return 1; }
  touch "$dir/.loop/stop"
  echo "autoloop: $(loop_label "$dir" "$(basename "$dir")") stops after its running items finish. Run loop.sh again to resume."
}

request_rename() {
  local dir
  dir="$(cd "${target:-.}" && { worker_main_dir || git rev-parse --show-toplevel 2> /dev/null || pwd; })"
  [ -f "$dir/.loop/feature_list.json" ] || { echo "No autoloop in $dir." >&2; return 1; }
  printf '%s\n' "$rename" | head -n 1 | tr -d '\000-\037\177' | cut -c1-60 > "$dir/.loop/name"
  echo "autoloop: this loop is now called $(loop_label "$dir" "$(basename "$dir")")"
}

title_line() {
  local dir repo state progress count=0 parts=""
  repo="$(repo_name "${target:-.}")"
  [ -n "$repo" ] || repo="$(basename "$(git rev-parse --show-toplevel 2> /dev/null || pwd)")"
  while IFS= read -r dir; do
    [ -f "$dir/.loop/feature_list.json" ] || continue
    state="$(jq -r '.state // "" | strings' "$dir/.loop/live.json" 2> /dev/null || true)"
    case "$state" in running | stopping | queued) ;; *) continue ;; esac
    [ "$(driver_state "$dir")" != exited ] || continue
    progress="$(jq -r '(.features // []) | map(objects) | "\(map(select(.passes == true)) | length)/\(length)"' "$dir/.loop/feature_list.json" 2> /dev/null)" || continue
    count=$((count + 1))
    parts="$parts · $progress"
  done < <(loop_dirs | awk '!seen[$0]++')
  repo="$(printf '%s' "$repo" | tr -d '\000-\037\177')"
  if [ "$count" = 0 ]; then
    echo "[loop] $repo · no loop running"
  else
    echo "[loop] $repo · $count loop$([ "$count" = 1 ] || echo s)$parts"
  fi
}

if [ "$title" = 1 ]; then
  title_line
  exit
fi
if [ "$stop" = 1 ]; then
  request_stop
  exit
fi
if [ -n "$rename" ]; then
  request_rename
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
