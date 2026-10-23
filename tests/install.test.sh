#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
failures=0

check() {
  if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; failures=$((failures + 1)); fi
}

mkdir -p "$tmp/home" "$tmp/bin"
git clone -q "$repo" "$tmp/origin"
for tool in claude npx codex; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "%s/calls"\n' "$tool" "$tmp" > "$tmp/bin/$tool"
  chmod +x "$tmp/bin/$tool"
done
run_install() { HOME="$tmp/home" SKILLS_REPO="$tmp/origin" PATH="$tmp/bin:$PATH" bash "$repo/install.sh" < /dev/null > "$tmp/out" 2>&1; }

run_install
check "a fresh install clones the repository" '[ -f "$tmp/home/dev/skills/bussin-autoloop/SKILL.md" ]'
check "every skill and alias is linked into ~/.claude/skills" '[ "$(readlink "$tmp/home/.claude/skills/bussin-autoloop")" = "$tmp/home/dev/skills/bussin-autoloop" ] && [ "$(readlink "$tmp/home/.claude/skills/autoloop")" = "$tmp/home/dev/skills/aliases/autoloop" ] && [ "$(ls "$tmp/home/.claude/skills" | wc -l | tr -d " ")" = "$(ls -d "$repo"/bussin-* "$repo"/aliases/* | wc -l | tr -d " ")" ]'
check "the status mod is installed through Claude Code" 'grep -q "claude plugin install bussin-loop-status@bussin" "$tmp/calls"'
check "the skills are copied for Codex, by name and never with --all" 'grep -q "npx -y skills add nksrentas/skills -g -y --skill" "$tmp/calls" && grep -q " -a codex" "$tmp/calls" && ! grep -q -- "--all" "$tmp/calls"'

git -C "$tmp/origin" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "newer"
rm "$tmp/home/.claude/skills/bussin-lean"
run_install
check "running it again updates the clone" '[ "$(git -C "$tmp/home/dev/skills" log -1 --format=%s)" = newer ]'
check "running it again restores a missing link" '[ -L "$tmp/home/.claude/skills/bussin-lean" ]'
check "it says how to finish" 'grep -q "Restart Claude Code, then type /autoloop" "$tmp/out"'

[ "$failures" = 0 ] && echo "all install checks passed" || { echo "$failures install checks failed"; exit 1; }
