# Optional Telegram notifications, sourced by loop.sh. Off unless the config file exists.
# The loop only sends: nothing here listens for messages, so the bot cannot control the machine.

notify_config="${LOOP_NOTIFY_CONFIG:-$HOME/.config/bussin-autoloop/telegram.env}"
hang_minutes="${LOOP_HANG_MINUTES:-60}"
notify_on=0
hang_pid=""

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

# A short LLM rewrite of the facts; any failure, a missing claude CLI or a 60s timeout falls back to the facts as they are.
notify_summary() {
  local text=""
  if command -v claude > /dev/null; then
    # from a temp dir with no tools, so no project settings, hooks or files reach this call
    text="$(cd "${TMPDIR:-/tmp}" && perl -e 'alarm shift; exec @ARGV' 60 claude -p --model haiku --tools "" --strict-mcp-config --no-session-persistence \
      "Rewrite these facts about an autonomous coding loop as a Telegram message for the developer running it: at most three short lines, what happened first, then anything that needs their attention. Plain text, no markdown, no preamble, no sign-off. Facts: $1" \
      < /dev/null 2> /dev/null)" || text=""
  fi
  [ -n "$text" ] || text="$1"
  printf '%s' "$text" | head -c 1500
}

notify_send() {
  # the token goes through curl's stdin config, so it never shows in the process list
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$notify_token" \
    | curl -sS --proto =https --max-time 20 -o /dev/null -K - --data-urlencode "chat_id=$notify_chat" --data-urlencode "text=$1"
}

notify() {
  [ "$notify_on" = 1 ] || return 0
  local title
  title="$(bash "$script_dir/loop-status.sh" --title 2> /dev/null || echo "[loop] $LOOP_NAME")"
  (notify_send "$title
$(notify_summary "$*")") < /dev/null > /dev/null 2>&1 &
}

notify_session() {
  local item="$1" outcome="$2" reason="$3" what
  what="$(jq -r --arg id "$item" '[.features[] | select(.id == $id)][0] | [.description // "", (.evidence.ran // "" | if . == "" then "" else "ran: " + . end)] | map(select(. != "")) | join(", ")' "$list" 2> /dev/null || true)"
  case "$outcome" in
    passed | merged) notify "$item passed: $what" ;;
    limit) notify "A usage limit paused the loop at $item; it retries after ${limit_wait}s." ;;
    *) notify "$item did not pass ($outcome, attempt $(attempts_of "$item") of $item_attempts): $what${reason:+. Last output: $reason}" ;;
  esac
}

notify_loop_end() {
  local code="$1" facts blocked last
  if [ "$(closing_state)" = finished ]; then
    facts="The loop finished: every item passes."
  elif [ "$code" = 0 ]; then
    facts="The loop stopped on request; run loop.sh again to resume."
  else
    facts="The loop stopped with an error and needs attention."
    blocked="$(blocked_items 2> /dev/null | sort -u | paste -sd, - || true)"
    [ -z "$blocked" ] || facts="$facts Blocked items: $blocked."
    last="$(tail -n 1 "$usage_file" 2> /dev/null | jq -r 'select(.outcome != "passed" and .outcome != "merged") | "Last session: \(.item) \(.outcome)" + (if .reason then ", \(.reason)" else "" end)' 2> /dev/null || true)"
    [ -z "$last" ] || facts="$facts $last"
  fi
  notify "$facts"
}

# Tells you when one session runs longer than LOOP_HANG_MINUTES; the caller kills $hang_pid once the session ends.
watch_hang() {
  hang_pid=""
  [ "$notify_on" = 1 ] || return 0
  (sleep $((hang_minutes * 60)) && notify "$1 has been running for ${hang_minutes}m; it may be stuck. Check .loop/logs/$1.log.") < /dev/null > /dev/null 2>&1 &
  hang_pid=$!
}

unwatch_hang() { [ -z "${1:-}" ] || kill "$1" 2> /dev/null || true; }
