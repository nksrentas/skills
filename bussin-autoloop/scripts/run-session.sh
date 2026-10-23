#!/usr/bin/env bash
set -uo pipefail

raw="$1" log="$2" agent="$3"
shift 3
mkdir -p "$(dirname "$log")"
: > "$log"
"$@" < /dev/null | tee "$raw" | jq --unbuffered -R -r --arg agent "$agent" -f "$(dirname "$0")/session-log.jq" >> "$log"
exit "${PIPESTATUS[0]}"
