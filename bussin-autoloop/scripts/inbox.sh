#!/usr/bin/env bash
# Changes from the status pane: one JSON file per change in .loop/inbox/, applied between sessions so nothing running is interrupted.

inbox_dir=.loop/inbox

# Pane changes and screenshots never belong in a session's commit, and older loops have no .gitignore line for them.
ignore_loop_scratch() {
  local exclude line
  exclude="$(git rev-parse --git-common-dir)/info/exclude"
  mkdir -p "$(dirname "$exclude")"
  for line in /.loop/inbox/ /.loop/evidence/; do
    grep -qxF "$line" "$exclude" 2> /dev/null || echo "$line" >> "$exclude"
  done
}

apply_inbox() {
  local file result busy changed=0 blocked
  [ -d "$inbox_dir" ] || return 0
  busy="$(json_array $(declare -F running_items > /dev/null && running_items))"
  for file in "$inbox_dir"/*.json; do
    [ -f "$file" ] || continue
    if ! result="$(jq -c --argjson running "$busy" --slurpfile op "$file" -f "$script_dir/inbox.jq" "$list" 2> /dev/null)"; then
      echo "autoloop: dropped ${file##*/} from the status pane: not valid JSON" >&2
      rm -f "$file"
      continue
    fi
    if jq -e '.keep == true' <<< "$result" > /dev/null; then continue; fi
    if jq -e 'has("error")' <<< "$result" > /dev/null; then
      echo "autoloop: dropped ${file##*/} from the status pane: $(jq -r .error <<< "$result")" >&2
      rm -f "$file"
      continue
    fi
    jq '.list' <<< "$result" > "$list.tmp" && mv "$list.tmp" "$list"
    blocked="$(jq -r '.blocked // empty' <<< "$result")"
    if [ -n "$blocked" ]; then printf '\nBlocked: %s skipped from the status pane\n' "$blocked" >> .loop/progress.md; fi
    echo "autoloop: from the status pane: $(jq -r .log <<< "$result")"
    rm -f "$file"
    changed=1
  done
  [ "$changed" = 1 ] || return 0
  git add -- "$list"
  if [ -f .loop/progress.md ]; then git add -- .loop/progress.md; fi
  git commit -q -m "chore(loop): changes from the status pane" -- "$list" $([ -f .loop/progress.md ] && echo .loop/progress.md)
}
