#!/usr/bin/env bash
set -euo pipefail

repo="${SKILLS_REPO:-https://github.com/nksrentas/skills.git}"
dir="${SKILLS_DIR:-$HOME/dev/skills}"
skills_home="$HOME/.claude/skills"

say() { printf 'bussin: %s\n' "$*"; }

command -v git > /dev/null || { say "git is required; install it and run this again" >&2; exit 1; }

if [ -d "$dir/.git" ]; then
  say "updating $dir"
  git -C "$dir" pull --ff-only --quiet < /dev/null
else
  say "cloning into $dir"
  mkdir -p "$(dirname "$dir")"
  git clone --quiet "$repo" "$dir" < /dev/null
fi

mkdir -p "$skills_home"
linked=0
for skill in "$dir"/bussin-* "$dir"/aliases/*; do
  [ -f "$skill/SKILL.md" ] || continue
  ln -sfn "$skill" "$skills_home/$(basename "$skill")"
  linked=$((linked + 1))
done
say "linked $linked skills into $skills_home"

if command -v claude > /dev/null; then
  claude plugin marketplace add nksrentas/skills < /dev/null > /dev/null 2>&1 || true
  claude plugin marketplace update bussin < /dev/null > /dev/null 2>&1 || true
  if claude plugin install bussin-loop-status@bussin < /dev/null > /dev/null 2>&1 || claude plugin update bussin-loop-status@bussin < /dev/null > /dev/null 2>&1; then
    say "status mod installed and up to date"
  else
    say "could not install the status mod; run: claude plugin install bussin-loop-status@bussin" >&2
  fi
else
  say "Claude Code not found, so the status mod was skipped"
fi

if { command -v codex > /dev/null || command -v copilot > /dev/null; } && command -v npx > /dev/null; then
  agents=()
  command -v codex > /dev/null && agents+=(codex)
  command -v copilot > /dev/null && agents+=(github-copilot)
  args=()
  for skill in "$dir"/bussin-* "$dir"/aliases/*; do
    [ -f "$skill/SKILL.md" ] && args+=(--skill "$(basename "$skill")")
  done
  if npx -y skills add nksrentas/skills -g -y "${args[@]}" -a "${agents[@]}" < /dev/null > /dev/null 2>&1; then
    say "refreshed the skills for ${agents[*]}"
  else
    say "could not refresh the skills for ${agents[*]}" >&2
  fi
fi

command -v jq > /dev/null || say "install jq too (brew install jq, or sudo apt install jq); bussin-autoloop needs it"
say "done. Restart Claude Code, then type /autoloop. Run this same command again any time to update."
