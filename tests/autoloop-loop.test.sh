#!/usr/bin/env bash
set -euo pipefail

loop="$(cd "$(dirname "$0")/../bussin-autoloop/scripts" && pwd)/loop.sh"

make_project() {
  local dir="$1" mode="$2"
  mkdir -p "$dir/.loop" "$dir/bin"
  echo '{"features":[{"id":"A1","passes":false}]}' > "$dir/.loop/feature_list.json"
  cat > "$dir/bin/claude" <<EOF
#!/usr/bin/env bash
calls=\$(( \$(cat "$dir/calls" 2>/dev/null || echo 0) + 1 ))
echo "\$calls" > "$dir/calls"
if [ "$mode" = always-fail ] || [ "\$calls" -eq 1 ]; then
  [ "$mode" = limit-then-pass ] && echo "You've hit your session limit · resets 1pm (Europe/Athens)"
  exit 1
fi
jq '.features[0].passes = true' .loop/feature_list.json > .loop/tmp && mv .loop/tmp .loop/feature_list.json
git commit -qam "pass A1"
EOF
  chmod +x "$dir/bin/claude"
  git -C "$dir" init -q
  git -C "$dir" add .loop
  git -C "$dir" -c user.email=t@t -c user.name=t commit -qm init
}

run_loop() {
  local dir="$1"
  (cd "$dir" && GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t \
    PATH="$dir/bin:$PATH" LIMIT_WAIT=0 MAX_STALLS=1 bash "$loop" > "$dir/out" 2>&1)
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

make_project "$tmp/limit" limit-then-pass
run_loop "$tmp/limit" || { cat "$tmp/limit/out"; echo "FAIL: usage limit counted as a stall"; exit 1; }
[ "$(cat "$tmp/limit/calls")" -eq 2 ] || { echo "FAIL: expected 2 sessions, got $(cat "$tmp/limit/calls")"; exit 1; }
grep -q "usage limit" "$tmp/limit/out" || { echo "FAIL: no usage limit notice"; exit 1; }

make_project "$tmp/fail" always-fail
if run_loop "$tmp/fail"; then echo "FAIL: plain failure was not counted as a stall"; exit 1; fi
grep -q "no progress (1/1)" "$tmp/fail/out" || { cat "$tmp/fail/out"; echo "FAIL: plain failure not reported as stall"; exit 1; }

echo "autoloop-loop.test.sh: ok"
