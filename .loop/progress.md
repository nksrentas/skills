# Progress: repeatable proofs for the bussin skillset

Task: structure test, CI on ubuntu and macOS, `claude plugin eval` trigger suite, README "Tests and evals" section. Mode standard, no checkpoint. Base c253de1.

## Baseline (init, 2026-10-18)

- `tests/autoloop-guard.test.sh`: pass. `tests/autoloop-loop.test.sh`: pass. 2 test files, 0 failing.
- `claude plugin validate --strict .`: passes (validates `.claude-plugin/marketplace.json`; there is no plugin.json, the marketplace entry has `source: ./`, `strict: false` and lists the skill folders).
- Dry scan: no non-kebab-case file names under bussin-*/ or tests/, no mentions of bussin-code-feature, ts-feature-architecture, drizzle-data-access or edefy-ui. "retro" appears only as `retro.md` (a loop artifact, not the Pocock skill) and must not be flagged.

## Conventions learned

- Local `bash` is /bin/bash 3.2.57, so `bash .loop/verify.sh` already proves bash 3.2 compatibility.
- Existing tests: `#!/usr/bin/env bash`, `set -euo pipefail`, temp dirs with `trap 'rm -rf ...' EXIT`, `expect`-style helpers printing `ok   <label>` / `FAIL <label> (...)`, a `failures` counter, jq for JSON. Copy that style.
- `~/.claude/skills/bussin-*` are symlinks to `~/.agents/skills/` copies, not to this repo; editing the repo does not change the installed skill.
- README "Included skills" is a `## Included skills` section of `- [bussin-x](./bussin-x): ...` lines. Marketplace lists skills as `"./bussin-x"` under `plugins[0].skills`.
- `claude plugin eval . --case <x>` resolves this repo as the plugin target (tested: "No eval cases found matching"). `claude plugin eval init --bare <name>` refuses this root ("not a plugin or skill folder") unless `--eval-dir evals` is passed.
- Bare case template: `evals/<name>/prompt.md` with YAML frontmatter (`max_turns: 10`, `allowed_tools: [Read, Glob, Grep, Skill]`) then the prompt text; `evals/<name>/graders/criteria.md` with frontmatter `type: llm`, `weight: 1`. The skill-fired grader type (`tool_used: Skill`) and the fixture mechanism are not in the bare template: ask the claude-code-guide subagent for the exact grader and fixture frontmatter. `--help` says `tool_used: Skill` graders are "with-only" and count as a plugin-fired indicator under with-without ablation; we run with `--ablation none`, so they score.
- `scaffold_script` is off unless `--scaffold` is passed, so fixtures must use a static mechanism.
- Unattended sessions may only run config.commands: `test`, `structure` (accepts a fixture root argument), `validate`, `eval-one` (append the case name). Build negative-proof fixtures with Write in the scratchpad, then point `bash tests/skills-structure.test.sh <root>` at them.
- `evals/results/` is gitignored; eval runs write there.

## Sessions

## Session 1 · F1 · 2026-10-18
Did: added tests/skills-structure.test.sh with a `check <label> <fn> args...` helper and per-skill frontmatter, name and description checks; optional root argument for fixtures. Commit e7aa7a3.
Learned: frontmatter is parsed with awk (first line must be ---, stops at the next ---); `field` strips one pair of surrounding quotes, which bussin-honest-feedback and bussin-write-like-a-human need. Folded/literal (`>`/`|`) descriptions are not handled yet: E2 extends `field`/`has_description`. New checks should reuse `check` so the run keeps going after a FAIL (F3 needs that).
Next: F2

## Session 2 · F2 · 2026-10-18
Did: structure test now checks each bussin-* dir is in marketplace.json `plugins[].skills` and the README `## Included skills` list, and each entry in either list exists on disk. Commit 7a48ef2.
Learned: `readme_skills` already scopes to the `## Included skills` section (awk toggles on `## ` headings), so E3 likely only needs its fixture proof. `marketplace_skills` swallows jq errors (empty list), so invalid JSON shows up as "not listed" FAILs until F3 adds an explicit validity check. Use `grep ... >/dev/null`, not `grep -q`, after a producer under pipefail (SIGPIPE).
Next: F3

## Session 3 · F3 · 2026-10-18
Did: added `valid_json` (`jq empty`) and a `check "marketplace.json is valid JSON"` before the per-skill loop. Trailing-comma fixture prints the FAIL and keeps running the other checks. Commit 6c12e17.
Learned: `check` wraps the predicate in `if`, so a failing predicate never trips set -e; new checks just need a predicate function. With invalid JSON the per-skill "listed in marketplace.json" checks also FAIL (marketplace_skills yields nothing), which is expected noise.
Next: F4

## Session 4 · F4 · 2026-10-18
Did: added `kebab_file_names` (find over bussin-* and tests, excluding SKILL.md and .DS_Store, `LC_ALL=C grep -v '/[a-z0-9.-]*$'`), which prints `     not kebab-case: <path>` per offender before one FAIL. A missing root fails the check rather than passing it. Commit 0044b8d.
Learned: Finder writes .DS_Store into folders (the repo root has one and it is not gitignored), so filesystem scans must skip it. Set `LC_ALL=C` on bracket ranges so macOS and Linux agree. The scan already covers only bussin-*/ and tests/, so E4's .git/, evals/results/ and .loop/ exclusions hold for file names, and paths with spaces print whole (one line per path). E4 still needs its fixture proof. F5's retired-name scan is a different walk (all tracked files) and does need those exclusions.
Next: F5
