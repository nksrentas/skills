# Optional Telegram notifications, sourced by loop.sh. Off unless the config file exists.
# The loop only sends: nothing here listens for messages, so the bot cannot control the machine.

notify_config="${LOOP_NOTIFY_CONFIG:-$HOME/.config/bussin-autoloop/telegram.env}"
hang_minutes="${LOOP_HANG_MINUTES:-60}"
notify_on=0
notify_phase=running
hang_pid=""
muted_file="$(dirname "$notify_config")/telegram-muted"

notify_setting() { sed -n "s/^$1=//p" "$notify_config" | tail -n 1 | tr -d "\"' \r"; }

notify_init() {
  [ -f "$notify_config" ] || return 0
  if [ -n "$(find "$notify_config" \( -perm -004 -o -perm -040 \) 2> /dev/null)" ]; then
    echo "autoloop: $notify_config is readable by other users, so Telegram notifications stay off; run chmod 600 on it" >&2
    return 0
  fi
  notify_token="$(notify_setting TELEGRAM_BOT_TOKEN)"
  notify_chat="$(notify_setting TELEGRAM_CHAT_ID)"
  if [[ ! "$notify_token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ || ! "$notify_chat" =~ ^-?[0-9]+$ ]]; then
    echo "autoloop: $notify_config needs TELEGRAM_BOT_TOKEN=<digits:letters> and TELEGRAM_CHAT_ID=<number>; Telegram notifications stay off" >&2
    return 0
  fi
  notify_on=1
}

html_escape() { perl -pe 's/&/&amp;/g; s/</&lt;/g; s/>/&gt;/g'; }
# escape everything, then let only the tags Telegram renders for us back in
html_allow() { perl -pe 's/&/&amp;/g; s/</&lt;/g; s/>/&gt;/g; s{&lt;(/?)(b|i|code)&gt;}{<$1$2>}g'; }
html_plain() { perl -pe 's/<[^>]*>//g; s/&lt;/</g; s/&gt;/>/g; s/&amp;/&/g'; }

# The event line: Haiku turns the facts into one or two plain-spoken lines; any failure, a missing claude CLI
# or a 60s timeout keeps the template line instead.
notify_event() {
  local text=""
  if command -v claude > /dev/null; then
    # from a temp dir with no tools, so no project settings, hooks or files reach this call
    text="$(cd "${TMPDIR:-/tmp}" && perl -e 'alarm shift; exec @ARGV' 60 claude -p --model haiku --tools "" --strict-mcp-config --no-session-persistence \
      "Write the event line of a Telegram status message about an autonomous coding loop, for the developer running it. One or two short lines: what happened, and for a failure or a stall the likely reason in plain words. Use only <b>, <i> and <code> tags: bold what failed or needs attention, italics for the reason, code for item ids. No emojis, no preamble, no progress or status list (one is added below). Facts: $1" \
      < /dev/null 2> /dev/null | head -n 3 | head -c 600 | html_allow)" || text=""
  fi
  printf '%s' "${text:-$2}"
}

# Header and the Now / Next / Pending / Finish block, computed from the loop's own files so the numbers are exact.
notify_status_query='
def short: (.description // "" | split(", ")[0] | if length > 40 then .[0:39] + "…" else . end);
def item: "<code>\(.id | @html)</code> \(short | @html)";
def items: if length == 0 then null else map(item) | join(", ") end;
def dur: (. / 60 | floor) as $m | if $m < 60 then "\($m)m" else "\($m / 60 | floor)h \($m % 60)m" end;
def clock: strflocaltime("%H:%M");
(.features // [] | map(objects)) as $all
| ($all | map(select(.passes == true) | .id) | unique) as $passed
| ($all | map(select(.passes != true))) as $left
| ($live.running // [] | map(.item)) as $run
| ($all | map(select(.id as $id | $run | index($id)))) as $running
| ($left | map(select(.id as $id | ($run | index($id) | not) and ($blocked | index($id) | not) and ((((.depends_on // []) | if type == "array" then . else [] end) - $passed) | length == 0)))) as $queue
| ($left | length) as $remaining
| (($usage | map(.duration_ms // 0 | numbers) | add // 0) / 1000) as $spent
| ([$usage[] | select(.item as $i | $passed | index($i)) | .item] | unique | length) as $doneBy
| (if ($live.mode // "") == "parallel" then ([[$live.workers // 1, $remaining] | min, 1] | max) else 1 end) as $par
| (if $doneBy > 0 then $remaining * $spent / $doneBy / $par else null end) as $eta
| ($all | map(select(.id as $id | $blocked | index($id)))) as $stuck
| "<b>\($folder | @html)\(if $label == $folder then "" else " · " + ($label | @html) end)</b> · <code>\($passed | length)/\($all | length)</code>",
  ((if $remaining == 0 then
    ["nothing running", "review and merge", "none",
     "done at <code>\(now | clock)</code>" + (if $live.started_at then ", \(now - $live.started_at | dur)" else "" end)]
  elif $phase == "ended" then
    ["nothing running",
     (if ($stuck | length) > 0 then "fix \($stuck | map("<code>\(.id | @html)</code>") | join(", ")), then resume" else "run loop.sh to resume" end),
     "<code>\($remaining)</code> items" + (if ($stuck | length) > 0 then ", blocked: \($stuck | items)" else "" end),
     "on hold"]
  else
    [(if ($running | length) > 0 then $running | items else ($queue[0:1] | items) // "starting" end),
     (if ($running | length) > 0 then $queue[0:1] else $queue[1:2] end | items) // "nothing queued",
     "<code>\($remaining)</code> items",
     (if $eta then "<code>~\(now + $eta | clock)</code>, in \($eta | dur)" else "estimated once the first item passes" end)]
  end) as $v
  | "<blockquote><b>Now</b>  \($v[0])\n<b>Next</b>  \($v[1])\n<b>Pending</b>  \($v[2])\n<b>Finish</b>  \($v[3])</blockquote>")'

notify_status() {
  local title label folder live usage
  title="$(bash "$script_dir/loop-status.sh" --title 2> /dev/null || echo "[loop] $LOOP_NAME")"
  label="${title#*] }"
  label="${label% · *}"
  folder="$(basename "$PWD")"
  live="$(jq -c 'objects' "$live_file" 2> /dev/null || true)"
  [ -n "$live" ] || live='{}'
  usage="$({ cat "$usage_file" 2> /dev/null || true; } | jq -c -R 'fromjson? // empty' | jq -s -c .)"
  jq -r --arg folder "$folder" --arg label "$label" --arg phase "$notify_phase" \
    --argjson live "$live" --argjson usage "${usage:-[]}" --argjson blocked "$(json_array $(blocked_items 2> /dev/null))" \
    "$notify_status_query" "$list" 2> /dev/null \
    || printf '<b>%s</b>\n' "$(printf '%s' "$folder" | html_escape)"
}

notify_post() {
  # the token goes through curl's stdin config, so it never shows in the process list
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$notify_token" \
    | curl -sS --proto =https --max-time 20 -K - --data-urlencode "chat_id=$notify_chat" --data-urlencode "text=$1" ${2:+--data-urlencode "parse_mode=$2"}
}

notify_send() {
  # Telegram refuses the whole message on broken HTML, so a refusal is sent again as plain text
  notify_post "$1" HTML | jq -e '.ok == true' > /dev/null 2>&1 || notify_post "$(printf '%s' "$1" | html_plain)" > /dev/null
}

# notify <facts for the summary> [template event line in Telegram HTML]
notify() {
  [ "$notify_on" = 1 ] || return 0
  # checked on every message, so muting a running loop with loop-status.sh --telegram off takes effect at once
  ! grep -qxF -- "$(pwd -P)" "$muted_file" 2> /dev/null || return 0
  local status fallback="${2:-<i>$(printf '%s' "$1" | html_escape)</i>}"
  status="$(notify_status)"
  (notify_send "$(printf '%s\n%s\n%s' "$(sed -n 1p <<< "$status")" "$(notify_event "$1" "$fallback")" "$(sed '1d' <<< "$status")")") < /dev/null > /dev/null 2>&1 &
}

notify_session() {
  local item="$1" outcome="$2" reason="$3" what id
  what="$(jq -r --arg id "$item" '[.features[] | select(.id == $id)][0].description // ""' "$list" 2> /dev/null | split_first | html_escape || true)"
  id="<code>$(printf '%s' "$item" | html_escape)</code>"
  case "$outcome" in
    passed | merged) notify "$item passed: $what" "<i>$id $what passed.</i>" ;;
    limit) notify "A usage limit paused the loop at $item; it retries after ${limit_wait}s." "<i>Usage limit at $id; retrying in ${limit_wait}s.</i>" ;;
    *) notify "$item did not pass ($outcome, attempt $(attempts_of "$item") of $item_attempts): $what${reason:+. Last output: $reason}" \
      "<b>$id $what failed</b>, try $(attempts_of "$item") of $item_attempts${reason:+
<i>$(printf '%s' "$reason" | cut -c1-200 | html_escape)</i>}" ;;
  esac
}

split_first() { sed 's/, .*//' | cut -c1-60; }

notify_loop_end() {
  local code="$1" facts blocked last
  notify_phase=ended
  if [ "$(closing_state)" = finished ]; then
    notify "The loop finished: every item passes." "<i>Loop finished, every item passes.</i>"
  elif [ "$code" = 0 ]; then
    notify "The loop stopped on request; run loop.sh again to resume." "<i>Loop stopped on request.</i>"
  else
    facts="The loop stopped with an error and needs attention."
    blocked="$(blocked_items 2> /dev/null | sort -u | paste -sd, - || true)"
    [ -z "$blocked" ] || facts="$facts Blocked items: $blocked."
    last="$(tail -n 1 "$usage_file" 2> /dev/null | jq -r 'select(.outcome != "passed" and .outcome != "merged") | "Last session: \(.item) \(.outcome)" + (if .reason then ", \(.reason)" else "" end)' 2> /dev/null || true)"
    [ -z "$last" ] || facts="$facts $last"
    notify "$facts" "<b>Loop stopped, needs you</b>
<i>$(printf '%s' "${last:-check the terminal}" | cut -c1-200 | html_escape)</i>"
  fi
}

# Tells you when one session runs longer than LOOP_HANG_MINUTES; the caller kills $hang_pid once the session ends.
watch_hang() {
  hang_pid=""
  [ "$notify_on" = 1 ] || return 0
  local id
  id="$(printf '%s' "$1" | html_escape)"
  (sleep $((hang_minutes * 60)) && notify "$1 has been running for ${hang_minutes}m; it may be stuck. Check .loop/logs/$1.log." \
    "<b><code>$id</code> may be stuck</b>
<i>Running ${hang_minutes}m. Check .loop/logs/$id.log</i>") < /dev/null > /dev/null 2>&1 &
  hang_pid=$!
}

unwatch_hang() { [ -z "${1:-}" ] || kill "$1" 2> /dev/null || true; }
