#!/usr/bin/env bash

hook_marker="# bussin-autoloop commit guard"
guarded_files=(.loop/config.json .loop/verify.sh .loop/guard-commit.sh)
item_text='del(.features[]?.passes, .features[]?.evidence, .features[]?.depends_on, .features[]?.touches)'
hook_warned=0

install_commit_hook() {
  local hook
  if [ -n "$(git config core.hooksPath || true)" ]; then
    [ "$hook_warned" = 1 ] || echo "autoloop: core.hooksPath is set, so the git pre-commit guard is not installed; the driver still audits every session" >&2
    hook_warned=1
    return 0
  fi
  hook="$(git rev-parse --git-common-dir)/hooks/pre-commit"
  mkdir -p "$(dirname "$hook")"
  if [ -e "$hook" ] && ! grep -qF "$hook_marker" "$hook"; then mv "$hook" "$hook.before-autoloop"; fi
  cat > "$hook" <<HOOK
#!/usr/bin/env bash
$hook_marker
if [ -n "\${AUTOLOOP_SESSION:-}" ]; then
  guard="\$(git show HEAD:.loop/guard-commit.sh 2>/dev/null || true)"
  if [ -n "\$guard" ]; then
    bash <(printf '%s\n' "\$guard") --pre-commit < /dev/null || exit 1
  fi
fi
chained="\$(dirname "\$0")/pre-commit.before-autoloop"
if [ -x "\$chained" ]; then exec "\$chained" "\$@"; fi
HOOK
  chmod +x "$hook"
}

passing_at() { git show "$1:$list" | jq '[.features[] | select(.passes == true)] | length'; }

audit_failed() {
  echo "autoloop: stopped, because since ${1:0:7} $2. Inspect it with: git log --stat ${1:0:7}..HEAD" >&2
}

audit_session() {
  local from="$1" file gate_log
  [ "$(git rev-parse HEAD)" != "$from" ] || return 0
  for file in "${guarded_files[@]}"; do
    if [ "$(git rev-parse -q --verify "$from:$file" || true)" != "$(git rev-parse -q --verify "HEAD:$file" || true)" ]; then
      audit_failed "$from" "a session committed a change to $file"
      return 1
    fi
  done
  if [ "$(git show "$from:$list" | jq -S "$item_text")" != "$(git show "HEAD:$list" | jq -S "$item_text")" ]; then
    audit_failed "$from" "a session committed added, removed or reworded items in $list"
    return 1
  fi
  [ "$agent" != claude ] || return 0
  [ "$(passing_at HEAD)" -gt "$(passing_at "$from")" ] || return 0
  git cat-file -e HEAD:.loop/verify.sh 2> /dev/null || return 0
  echo "autoloop: re-running the gate on the new passing items, because $agent has no tool-level commit guard"
  gate_log="$(mktemp)"
  if ! bash <(git show HEAD:.loop/verify.sh) > "$gate_log" 2>&1; then
    tail -n 10 "$gate_log" | sed 's/^/    /' >&2
    rm -f "$gate_log"
    audit_failed "$from" "an item was marked passing but the gate fails on the committed code"
    return 1
  fi
  rm -f "$gate_log"
}
