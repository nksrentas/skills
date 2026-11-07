#!/usr/bin/env bash
# Nothing to boot: the skills repo has no dev server. Sessions run the gate and the mod tests directly.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if [ "${1:-}" = stop ]; then rm -f .loop/port; exit 0; fi
command -v jq > /dev/null || { echo "init.sh: jq is required" >&2; exit 1; }
command -v claude > /dev/null || { echo "init.sh: the claude CLI is required for the mod tests" >&2; exit 1; }
echo "skills repo ready: no app to start. Gate: bash .loop/verify.sh"
