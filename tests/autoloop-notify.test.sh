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
  echo "LLM: \$(pwd)"
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
for arg in "\$@"; do case "\$arg" in text=*) printf '%s\n---\n' "\${arg#text=}" >> "$dir/messages" ;; esac; done
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
expect=3 run_loop "$on" LOOP_NOTIFY_CONFIG="$tmp/on.env"
check "start, each session and the end are sent" '[ "$(grep -c "^---$" "$on/messages")" -ge 3 ]'
check "every message starts with the loop title and carries the LLM summary" '[ "$(grep -c "^\[loop\] on · " "$on/messages")" -ge 3 ] && grep -q "^LLM: " "$on/messages"'
check "the summary call runs outside the project" '! grep -q "^LLM: $on" "$on/messages"'
check "the token never reaches curl arguments, only its stdin config" '! grep -q "$token" "$on/curl.argv" && grep -q "bot$token/sendMessage" "$on/curl.stdin" && grep -qx "chat_id=42" "$on/curl.argv" && grep -qx -- "--proto" "$on/curl.argv"'

plain="$tmp/plain"
make_project "$plain"
config "$tmp/plain.env" 600
expect=3 run_loop "$plain" LOOP_NOTIFY_CONFIG="$tmp/plain.env" SUMMARY_FAIL=1
check "a failing summary falls back to the plain facts" 'grep -q "A1 passed: Export button" "$plain/messages" && grep -q "The loop finished: every item passes." "$plain/messages" && ! grep -q "^LLM:" "$plain/messages"'

hang="$tmp/hang"
make_project "$hang"
config "$tmp/hang.env" 600
expect=4 run_loop "$hang" LOOP_NOTIFY_CONFIG="$tmp/hang.env" SUMMARY_FAIL=1 LOOP_HANG_MINUTES=0
check "a session running past LOOP_HANG_MINUTES is reported as possibly stuck" 'grep -q "A1 has been running for 0m; it may be stuck" "$hang/messages"'

[ "$failures" = 0 ] && echo "all notify checks passed" || { echo "$failures notify checks failed"; exit 1; }
