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
