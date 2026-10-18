#!/usr/bin/env bash
set -euo pipefail

command="$(jq -r '.tool_input.command // ""')"
case "$command" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
if [ ! -f "$root/.loop/tests-passed" ]; then
  echo "autoloop: commit blocked. Run 'bash .loop/verify.sh' first; the tests-passed marker is missing or was invalidated by an edit after the last verify." >&2
  exit 2
fi
