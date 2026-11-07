#!/usr/bin/env bash
set -euo pipefail

scripts="$(cd "$(dirname "$0")/../bussin-autoloop/scripts" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fail() { echo "FAIL: $*"; exit 1; }

repo="$tmp/repo"
mkdir -p "$repo/.loop/inbox"
cat > "$repo/.loop/feature_list.json" <<'EOF'
{"features":[
  {"id":"F1","area":"Accounts","plain":"People can log in","passes":true,"evidence":{"commit":"abc"}},
  {"id":"F2","description":"Password reset is live: technical spec","verify":"old","passes":false,"evidence":null},
  {"id":"F3","plain":"People can delete their account","passes":false,"evidence":null},
  {"id":"F4","plain":"Running now","passes":false,"evidence":null},
  {"id":"FINAL","description":"the final checks pass","depends_on":["F1","F2","F3","F4"],"passes":false,"evidence":null}
]}
EOF
git -C "$repo" init -q
git -C "$repo" add .loop/feature_list.json
git -C "$repo" commit -qm init

inbox() { echo "$2" > "$repo/.loop/inbox/$1.json"; }
apply() {
  (cd "$repo" && list=.loop/feature_list.json script_dir="$scripts" && json_array() { if [ $# -eq 0 ]; then echo "[]"; else printf "%s\n" "$@" | jq -R . | jq -s -c .; fi; } && source "$scripts/inbox.sh" \
    && running_items() { echo F4; } && ignore_loop_scratch && apply_inbox) > "$tmp/out" 2>&1
}
item() { git -C "$repo" show HEAD:.loop/feature_list.json | jq -c --arg id "$1" ".features[] | select(.id == \$id) | $2"; }
ids() { git -C "$repo" show HEAD:.loop/feature_list.json | jq -r '[.features[].id] | join(" ")'; }

inbox 1-add '{"op":"add","plain":"  Matching quality is measured ","done_when":"precision@5 is reported","area":"Matching quality","kind":"eval","metrics":[{"name":"precision@5","target":0.75},{"name":"recall@10"}]}'
inbox 2-edit '{"op":"edit","id":"F2","plain":"People can reset a forgotten password","done_when":"The emailed link sets a new password"}'
inbox 3-edit-done '{"op":"edit","id":"F1","plain":"Nope"}'
inbox 4-skip '{"op":"skip","id":"F3"}'
inbox 5-running '{"op":"edit","id":"F4","plain":"Changed while running"}'
inbox 6-bad 'not json'
inbox 7-unknown '{"op":"edit","id":"NOPE","plain":"x"}'
apply || { cat "$tmp/out"; fail "apply_inbox failed"; }

[ "$(ids)" = "F1 F2 F3 F4 U1 FINAL" ] || fail "the new task is not placed before FINAL: $(ids)"
[ "$(item FINAL '.depends_on | index("U1") != null')" = true ] || fail "FINAL does not wait for the new task"
[ "$(item U1 '[.plain, .area, .kind, .verify, .description, (.metrics | length), .passes, .ui]')" = '["Matching quality is measured","Matching quality","eval","precision@5 is reported","Matching quality is measured Done when: precision@5 is reported",2,false,false]' ] || fail "new task fields: $(item U1 .)"
[ "$(item F2 '[.plain, .done_when, .verify, .edited]')" = '["People can reset a forgotten password","The emailed link sets a new password","The emailed link sets a new password",true]' ] || fail "edit not applied: $(item F2 .)"
[ "$(item F1 .plain)" = '"People can log in"' ] || fail "a passing task was edited"
git -C "$repo" show HEAD:.loop/progress.md | grep -qx 'Blocked: F3 skipped from the status pane' || fail "skip wrote no Blocked line"
[ "$(item F4 .plain)" = '"Running now"' ] || fail "a running task was edited"
[ -f "$repo/.loop/inbox/5-running.json" ] || fail "the change to a running task was not kept for later"
[ "$(ls "$repo/.loop/inbox" | tr '\n' ' ')" = "5-running.json " ] || fail "applied or invalid changes were left behind: $(ls "$repo/.loop/inbox")"
grep -q "F1 already passes" "$tmp/out" || fail "no reason for the dropped edit"
grep -q "not valid JSON" "$tmp/out" || fail "no reason for the invalid file"
grep -q "no task NOPE" "$tmp/out" || fail "no reason for the unknown id"
[ "$(git -C "$repo" log -1 --format=%s)" = "chore(loop): changes from the status pane" ] || fail "changes were not committed"
[ -z "$(git -C "$repo" status --porcelain)" ] || fail "the inbox shows up in git status: $(git -C "$repo" status --porcelain)"

inbox 8-first '{"op":"first","id":"FINAL"}'
inbox 9-add-first '{"op":"add","plain":"Urgent fix","first":true}'
apply || { cat "$tmp/out"; fail "apply_inbox failed"; }
[ "$(ids)" = "F1 U2 FINAL F2 F3 F4 U1" ] || fail "first and add-first order: $(ids)"
[ "$(item U2 '[.area, .kind, .verify]')" = '["Added by you","build","Urgent fix"]' ] || fail "defaults for a new task: $(item U2 .)"

inbox a-approve '{"op":"review","id":"F1","verdict":"approved"}'
inbox b-changes '{"op":"review","id":"F1","verdict":"changes","note":"The login button is too small"}'
inbox c-empty '{"op":"review","id":"F1","verdict":"changes","note":"  "}'
apply || { cat "$tmp/out"; fail "apply_inbox failed"; }
[ "$(item F1 .review)" = '"changes"' ] || fail "review verdict not recorded: $(item F1 .)"
[ "$(item U3 '[.plain, .depends_on, .area, .kind, .ui]')" = '["Fix after review: The login button is too small",["F1"],"Accounts","design",true]' ] || fail "fix task after review: $(item U3 .)"
grep -q "say what should change" "$tmp/out" || fail "an empty review note was not refused"

# end to end: a change waiting before the run is applied, runs, and the audit accepts it
e2e="$tmp/e2e"
mkdir -p "$e2e/.loop/inbox" "$e2e/bin"
echo '{"features":[{"id":"A1","passes":false,"evidence":null}]}' > "$e2e/.loop/feature_list.json"
cat > "$e2e/bin/claude" <<'EOF'
#!/usr/bin/env bash
id="$(jq -r '[.features[] | select(.passes == false)][0].id' .loop/feature_list.json)"
echo "$id" >> ran
jq --arg id "$id" '(.features[] | select(.id == $id)) |= (.passes = true | .evidence = {commit: "x"})' .loop/feature_list.json > .loop/tmp && mv .loop/tmp .loop/feature_list.json
git commit -qam "pass $id"
EOF
chmod +x "$e2e/bin/claude"
git -C "$e2e" init -q
git -C "$e2e" add .loop/feature_list.json
git -C "$e2e" commit -qm init
echo '{"op":"add","plain":"Added before the run","first":true}' > "$e2e/.loop/inbox/1.json"
(cd "$e2e" && PATH="$e2e/bin:$PATH" LOOP_NOTIFY_CONFIG="$tmp/no-telegram" LOOP_SLOTS_DIR="$tmp/slots" LOOP_MACHINE_SESSIONS=8 LOOP_STARTUP_SECONDS=0 MAX_STALLS=1 LOOP_WORKERS=1 \
  bash "$scripts/loop.sh" > "$e2e/out" 2>&1) || { cat "$e2e/out"; fail "the loop did not finish with a pane change"; }
[ "$(tr '\n' ' ' < "$e2e/ran")" = "U1 A1 " ] || fail "the added task did not run first: $(cat "$e2e/ran")"
grep -q "from the status pane: added U1" "$e2e/out" || fail "the loop did not report the change"

echo "autoloop inbox: ok"
