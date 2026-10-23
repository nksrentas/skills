#!/usr/bin/env bash
set -uo pipefail

raw="$1" log="$2" agent="$3"
shift 3
[[ "$log" == */.loop/logs/* && "${log##*/.loop/logs/}" =~ ^[A-Za-z0-9_-][A-Za-z0-9._-]*\.log$ ]] || { echo "autoloop: refusing session log path $log" >&2; exit 2; }
mkdir -p "$(dirname "$log")"
: > "$log"
: > "$raw"
"$@" < /dev/null > "$raw" &
agent_pid=$!
tail -n +1 -f "$raw" 2> /dev/null > >(jq --unbuffered -R -r --arg agent "$agent" -f "$(dirname "$0")/session-log.jq" >> "$log") &
follower=$!
wait "$agent_pid"
status=$?
sleep 1
kill "$follower" 2> /dev/null
exit "$status"
