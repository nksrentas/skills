#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
for tool in bash git jq claude; do
  command -v "$tool" >/dev/null || { echo "init: missing $tool" >&2; exit 1; }
done
echo "init: $(bash --version | head -1)"
echo "init: no app to boot; run the gate with bash .loop/verify.sh"
