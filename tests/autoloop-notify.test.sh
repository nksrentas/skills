#!/usr/bin/env bash
set -euo pipefail

loop="$(cd "$(dirname "$0")/../bussin-autoloop/scripts" && pwd)/loop.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export LOOP_SLOTS_DIR="$tmp/slots" LOOP_MACHINE_SESSIONS=8 LOOP_STARTUP_SECONDS=0
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
failures=0
token="123456:secret-token_x"

check() {
  if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

make_project() {
  local dir="$1"
  mkdir -p "$dir/.loop" "$dir/bin"
  echo '{"features":[{"id":"A1","description":"Export button","passes":false}]}' > "$dir/.loop/feature_list.json"
  cat > "$dir/bin/claude" <<EOF
#!/usr/bin/env bash
if [ "\$2" = --model ]; then
  [ -z "\${SUMMARY_FAIL:-}" ] || exit 1
  echo "LLM: <b>\$(basename "\$(pwd)")</b> <script>x</script>"
  exit 0
fi
sleep 2
jq '.features[0].passes = true' .loop/feature_list.json > .loop/tmp && mv .loop/tmp .loop/feature_list.json
git commit -qam "pass A1"
EOF
  cat > "$dir/bin/curl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" >> "$dir/curl.argv"
cat >> "$dir/curl.stdin"
html=0
for arg in "\$@"; do case "\$arg" in text=*) printf '%s\n---\n' "\${arg#text=}" >> "$dir/messages" ;; parse_mode=HTML) html=1 ;; esac; done
if [ -n "\${CURL_REJECT_HTML:-}" ] && [ "\$html" = 1 ]; then echo '{"ok":false,"description":"Bad Request: can'"'"'t parse entities"}'; else echo '{"ok":true}'; fi
EOF
  chmod +x "$dir/bin/claude" "$dir/bin/curl"
  git -C "$dir" init -q
  git -C "$dir" add .loop
  git -C "$dir" commit -qm init
}

run_loop() {
  local dir="$1"
  shift
  (cd "$dir" && env "$@" PATH="$dir/bin:$PATH" bash "$loop" > "$dir/out" 2>&1)
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(grep -c '^---$' "$dir/messages" 2> /dev/null || echo 0)" -ge "${expect:-0}" ] && break
    sleep 1
  done
  sleep 1
}

config() { printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=42\n' "$token" > "$1"; chmod "$2" "$1"; }

off="$tmp/off"
make_project "$off"
expect=0 run_loop "$off" LOOP_NOTIFY_CONFIG="$tmp/missing.env"
check "without a config file nothing is sent" '[ ! -e "$off/curl.argv" ] && grep -q "all items passing" "$off/out"'

open="$tmp/open"
make_project "$open"
config "$tmp/open.env" 644
expect=0 run_loop "$open" LOOP_NOTIFY_CONFIG="$tmp/open.env"
check "a config other users can read is refused and nothing is sent" '[ ! -e "$open/curl.argv" ] && grep -q "chmod 600" "$open/out"'

on="$tmp/on"
make_project "$on"
config "$tmp/on.env" 600
echo '{"name":"Export flow"}' > "$on/.loop/config.json"
expect=3 run_loop "$on" LOOP_NOTIFY_CONFIG="$tmp/on.env"
check "start, each session and the end are sent" '[ "$(grep -c "^---$" "$on/messages")" -ge 3 ]'
check "every message starts with the bold folder and loop name and its progress in code" '[ "$(grep -c "^<b>on · Export flow</b> · <code>[0-9]*/1</code>$" "$on/messages")" -ge 3 ]'
check "the LLM event line keeps b, i and code and escapes every other tag" 'grep -q "^LLM: <b>" "$on/messages" && grep -q "&lt;script&gt;x&lt;/script&gt;" "$on/messages" && ! grep -q "<script>" "$on/messages"'
check "every message ends with the Now, Next, Pending and Finish block in a quote" '[ "$(grep -c "^<blockquote><b>Now</b>  " "$on/messages")" -ge 3 ] && [ "$(grep -c "^<b>Finish</b>  .*</blockquote>$" "$on/messages")" -ge 3 ]'
check "the finished message says nothing is pending and when it was done" 'grep -q "^<b>Pending</b>  none$" "$on/messages" && grep -q "^<b>Finish</b>  done at <code>[0-9][0-9]:[0-9][0-9]</code>" "$on/messages"'
check "messages go out as Telegram HTML" 'grep -qx "parse_mode=HTML" "$on/curl.argv"'
check "the summary call runs outside the project" '! grep -q "^LLM: <b>on</b>" "$on/messages"'
check "the token never reaches curl arguments, only its stdin config" '! grep -q "$token" "$on/curl.argv" && grep -q "bot$token/sendMessage" "$on/curl.stdin" && grep -qx "chat_id=42" "$on/curl.argv" && grep -qx -- "--proto" "$on/curl.argv"'

plain="$tmp/plain"
make_project "$plain"
config "$tmp/plain.env" 600
expect=3 run_loop "$plain" LOOP_NOTIFY_CONFIG="$tmp/plain.env" SUMMARY_FAIL=1
check "a loop named after its folder does not repeat the folder" '[ "$(grep -c "^<b>plain</b> · <code>" "$plain/messages")" -ge 3 ] && ! grep -q "plain · plain" "$plain/messages"'
check "a failing summary falls back to the template event line" 'grep -q "^<i><code>A1</code> Export button passed.</i>$" "$plain/messages" && grep -q "^<i>Loop finished, every item passes.</i>$" "$plain/messages" && ! grep -q "^LLM:" "$plain/messages"'

rejected="$tmp/rejected"
make_project "$rejected"
config "$tmp/rejected.env" 600
expect=6 run_loop "$rejected" LOOP_NOTIFY_CONFIG="$tmp/rejected.env" SUMMARY_FAIL=1 CURL_REJECT_HTML=1
check "a message Telegram refuses as HTML is sent again as plain text" 'grep -q "^Loop finished, every item passes.$" "$rejected/messages" && grep -q "^Now  " "$rejected/messages" && [ "$(grep -c "^parse_mode=HTML$" "$rejected/curl.argv")" = "$(grep -c "^Now  " "$rejected/messages")" ]'

hang="$tmp/hang"
make_project "$hang"
config "$tmp/hang.env" 600
expect=4 run_loop "$hang" LOOP_NOTIFY_CONFIG="$tmp/hang.env" SUMMARY_FAIL=1 LOOP_HANG_MINUTES=0
check "a session running past LOOP_HANG_MINUTES is reported as possibly stuck" 'grep -q "^<b><code>A1</code> may be stuck</b>$" "$hang/messages"'

status="$(dirname "$loop")/loop-status.sh"
muted="$tmp/muted"
make_project "$muted"
config "$tmp/muted.env" 600
LOOP_NOTIFY_CONFIG="$tmp/muted.env" bash "$status" --telegram off "$muted" > "$tmp/muted-out"
check "--telegram off names the loop it muted" 'grep -q "Telegram notifications off for muted" "$tmp/muted-out"'
check "--telegram lists a muted loop as off" '[ "$(LOOP_NOTIFY_CONFIG="$tmp/muted.env" bash "$status" --telegram "$muted" | cut -f1,2)" = "$(printf "off\tmuted")" ]'
expect=0 run_loop "$muted" LOOP_NOTIFY_CONFIG="$tmp/muted.env" SUMMARY_FAIL=1
check "a muted loop sends nothing" '[ ! -e "$muted/curl.argv" ] && grep -q "all items passing" "$muted/out"'
LOOP_NOTIFY_CONFIG="$tmp/muted.env" bash "$status" --telegram on "$muted" > /dev/null
check "--telegram on lists the loop as on again and leaves no entry behind" '[ "$(LOOP_NOTIFY_CONFIG="$tmp/muted.env" bash "$status" --telegram "$muted" | cut -f1)" = on ] && [ ! -s "$tmp/telegram-muted" ]'
git -C "$muted" -c user.email=t@t -c user.name=t commit -q --allow-empty -m again
jq '.features[0].passes = false' "$muted/.loop/feature_list.json" > "$muted/f.tmp" && mv "$muted/f.tmp" "$muted/.loop/feature_list.json" && git -C "$muted" commit -qam reopen
expect=3 run_loop "$muted" LOOP_NOTIFY_CONFIG="$tmp/muted.env" SUMMARY_FAIL=1
check "an unmuted loop notifies again" '[ "$(grep -c "^---$" "$muted/messages")" -ge 3 ]'
check "the muted list lives next to the config, never in the repo" '[ -z "$(find "$muted" -name telegram-muted)" ] && [ -f "$tmp/telegram-muted" ]'
check "--telegram off on a folder with no loop is refused" '! LOOP_NOTIFY_CONFIG="$tmp/muted.env" bash "$status" --telegram off "$tmp" 2> /dev/null'

[ "$failures" = 0 ] && echo "all notify checks passed" || { echo "$failures notify checks failed"; exit 1; }
