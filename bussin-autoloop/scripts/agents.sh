#!/usr/bin/env bash

agent="${LOOP_AGENT:-claude}"
agent_model="${LOOP_MODEL:-}"
protected_files=(.loop/config.json .loop/verify.sh .loop/guard-commit.sh .loop/init.sh)

case "$agent" in
  claude | codex | copilot) ;;
  *)
    echo "autoloop: LOOP_AGENT=$agent is not supported; use claude, codex or copilot" >&2
    exit 1
    ;;
esac
command -v "$agent" > /dev/null || { echo "autoloop: $agent is not on PATH" >&2; exit 1; }

default_skill_command() {
  case "$agent:$1" in
    claude:*/plugins/cache/*) echo "/bussin:bussin-autoloop" ;;
    codex:*) echo "\$bussin-autoloop" ;;
    *) echo "/bussin-autoloop" ;;
  esac
}

project_commands=()
if [ -f .loop/config.json ]; then
  while IFS= read -r project_command; do
    [ -n "$project_command" ] && project_commands+=("$project_command")
  done < <(jq -r '.commands // {} | .[] | strings' .loop/config.json)
fi
extra_tools=()
if [ -n "${LOOP_EXTRA_TOOLS:-}" ]; then
  IFS=',' read -r -a extra_tools <<< "$LOOP_EXTRA_TOOLS"
fi
extra_args=()
if [ -n "${LOOP_AGENT_ARGS:-}" ]; then
  read -r -a extra_args <<< "$LOOP_AGENT_ARGS"
fi

claude_flags() {
  local allowed=(
    Read Edit Write Glob Grep Skill Agent TodoWrite
    "Bash(bash .loop/init.sh)" "Bash(bash .loop/verify.sh)"
    "Bash(git status *)" "Bash(git diff *)" "Bash(git log *)" "Bash(git show *)"
    "Bash(git add *)" "Bash(git commit *)" "Bash(git rev-parse *)"
  )
  local denied=() command path
  for command in ${project_commands[@]+"${project_commands[@]}"}; do
    allowed+=("Bash($command)" "Bash($command *)")
  done
  allowed+=(${extra_tools[@]+"${extra_tools[@]}"})
  for path in ".loop/*.sh" ".loop/config.json" ".claude/**" ".git/**"; do
    denied+=("Edit($path)" "Write($path)")
  done
  agent_flags=(--output-format json --allowedTools "${allowed[@]}" --disallowedTools "${denied[@]}")
}

copilot_flags() {
  local command words tool path
  agent_flags=(--output-format json --no-ask-user --add-dir "$(pwd)" --allow-tool write --allow-tool "shell(bash)")
  for command in status diff log show add commit rev-parse; do
    agent_flags+=(--allow-tool "shell(git $command)")
  done
  for command in ${project_commands[@]+"${project_commands[@]}"}; do
    read -r -a words <<< "$command"
    agent_flags+=(--allow-tool "shell(${words[0]})")
    [ "${#words[@]}" -lt 2 ] || agent_flags+=(--allow-tool "shell(${words[0]} ${words[1]})")
  done
  for tool in ${extra_tools[@]+"${extra_tools[@]}"}; do
    agent_flags+=(--allow-tool "$tool")
  done
  for path in "${protected_files[@]}"; do
    agent_flags+=(--deny-tool "write($path)")
  done
}

codex_flags() {
  agent_flags=(--json --sandbox workspace-write --add-dir "$(cd "$(git rev-parse --git-common-dir)" && pwd)")
}

"${agent}_flags"
[ -z "$agent_model" ] || agent_flags+=(--model "$agent_model")
agent_flags+=(${extra_args[@]+"${extra_args[@]}"})

agent_command() {
  case "$agent" in
    claude) agent_cmd=(claude -p "$1" "${agent_flags[@]}") ;;
    copilot) agent_cmd=(copilot -p "$1" "${agent_flags[@]}") ;;
    codex) agent_cmd=(codex exec "${agent_flags[@]}" "$1") ;;
  esac
}

model_label() {
  [ -z "$agent_model" ] || { echo "$agent_model"; return; }
  [ "$agent" = codex ] && sed -n 's/^model *= *"\(.*\)"/\1/p' "${CODEX_HOME:-$HOME/.codex}/config.toml" 2>/dev/null | head -n 1 | grep . && return
  echo "$agent"
}
