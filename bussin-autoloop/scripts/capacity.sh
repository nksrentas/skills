#!/usr/bin/env bash

slots_dir="${LOOP_SLOTS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/bussin-autoloop/sessions}"
slot_wait="${LOOP_SLOT_WAIT:-15}"

machine_sessions() {
  local cores ram_bytes ram_gb by_cpu by_ram
  cores="$(sysctl -n hw.ncpu 2> /dev/null || nproc 2> /dev/null || echo 4)"
  ram_bytes="$(sysctl -n hw.memsize 2> /dev/null || awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo 2> /dev/null || echo 8589934592)"
  ram_gb=$((ram_bytes / 1073741824))
  by_cpu=$((cores / 2))
  by_ram=$(((ram_gb - 4) / 2))
  [ "$by_ram" -lt "$by_cpu" ] && by_cpu="$by_ram"
  [ "$by_cpu" -ge 1 ] && echo "$by_cpu" || echo 1
}

max_sessions="${LOOP_MACHINE_SESSIONS:-$(machine_sessions)}"
[[ "$max_sessions" =~ ^[1-9][0-9]*$ ]] || { echo "autoloop: LOOP_MACHINE_SESSIONS=$max_sessions must be a whole number of 1 or more" >&2; exit 1; }

slot_owner_alive() { kill -0 "$(cut -d' ' -f1 "$1/owner" 2> /dev/null || echo 0)" 2> /dev/null; }

take_slot() {
  local i
  mkdir -p "$slots_dir"
  for ((i = 1; i <= max_sessions; i++)); do
    if [ -d "$slots_dir/$i" ] && [ -f "$slots_dir/$i/owner" ] && ! slot_owner_alive "$slots_dir/$i"; then rm -rf "${slots_dir:?}/$i"; fi
    if mkdir "$slots_dir/$i" 2> /dev/null; then
      echo "$$ $LOOP_NAME $1" > "$slots_dir/$i/owner"
      echo "$i"
      return 0
    fi
  done
  return 1
}

release_slot() { [ -z "${1:-}" ] || rm -rf "${slots_dir:?}/$1"; }

sessions_in_use() {
  local dir count=0
  for dir in "$slots_dir"/*/; do
    [ -f "$dir/owner" ] && slot_owner_alive "$dir" && count=$((count + 1))
  done
  echo "$count"
}
