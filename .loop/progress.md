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

## Session 5 · F5 · 2026-10-18
Did: added `no_retired_skill_refs`: find from the root pruning ./.git, ./.loop, ./evals/results and skipping the test file, `xargs -0 grep -lIE` for the four retired names anywhere plus Pocock names (tdd, code-review, test-audit, retro) only as `/name`, `` `name` skill`` or verb (invoke/load/use/run) + name, with explicit `before`/`after` boundary classes. Commit e5fda5c.
Learned: `xargs` with no input exits 0 without running grep on BSD, so test emptiness of the output (`[ -n "$bad" ]`) rather than relying on grep's exit code. ERE has no portable `\b`; use `(^|[^A-Za-z0-9_.-])` / `([^A-Za-z0-9_.-]|$)` on both sides or substrings like `mytdd skill` and `overuse tdd` match. E4's exclusions and space-in-path handling already hold for this scan too (verified with a 'refs dir' fixture); E4 still needs its formal fixture proof.
Next: F6

## Session 6 · F6 · 2026-10-18
Did: ran the full structure test on the repo at e57a661: every check ok, exit 0. `git diff c253de1 -- 'bussin-*' .claude-plugin README.md` is empty, so there was nothing to fix and no implementation commit; evidence points at e57a661. Review subagent skipped: the item's diff is empty.
Learned: the skills, marketplace.json and README were already consistent with every F1-F5 check, so the remaining structure work is the E-item fixture proofs.
Next: F7

## Session 7 · F7 · 2026-10-18
Did: added .github/workflows/test.yml: pull_request + push to main, matrix ubuntu-latest/macos-latest, fail-fast off, `permissions: contents: read`, actions/checkout@v4.2.2, one step that prints `/bin/bash --version` then runs each tests/*.test.sh with `/bin/bash`, exiting on the first failure. Commit 14a4404.
Learned: GitHub macOS runners put Homebrew bash 5 ahead of /bin on PATH, so plain `bash` there would not prove 3.2 compatibility; `/bin/bash` is 3.2 on macOS and bash 5 on Ubuntu. The tests set their own git identity and stub `claude`, so CI needs no setup beyond checkout. Not yet observed running on GitHub (nothing pushed); first push/PR is the real proof.
Next: F8

## Session 8 · F8 · 2026-10-18
Did: added evals/trigger-bussin-<skill>/ for the eight skills: prompt.md (max_turns 20, allowed_tools [Read, Glob, Grep, Skill], task prompt verbatim) and graders/skill-fired.md (`type: tool_used`, `tool: Skill`, `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?<skill>"'`). Commit a6de05c.
Learned: the task's exact prompts were only in the init session transcript (~/.claude/projects/-Users-nrentas-dev-skills/d367f01b-*.jsonl); they are now in the case files. Documented format (code.claude.com/docs/en/plugin-evals): negative = same tool_used grader with `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?bussin-'` plus `min: 0` and `max: 0` (F10). Static fixtures: there is no auto-copied fixture folder; the only non-scaffold mechanism is a case.yaml next to prompt.md with `schema_version: "1.1"` and `context: { add_dirs: [<dir relative to the case>] }`, which gives read access to that dir, so one shared evals/fixtures/<name>/ can be listed by all four F9 cases. prompt.md frontmatter overrides matching case.yaml fields and graders/*.md are added to the case.yaml graders. Not yet run end to end (F11).
Next: F9

## Session 9 · F9 · 2026-10-18
Did: added case.yaml (`schema_version: "1.1"`, name, `context: { add_dirs: [fixture] }`) plus fixture/package.json (next, drizzle-orm, typescript) and fixture/src/features/orders/order.schema.ts (pgTable orders) to the feature, ts-architecture, drizzle and ui cases. Commit a309edb.
Learned: correction to session 8: docs define `context.add_dirs` as "directories inside the case directory", so one shared evals/fixtures/ is not allowed and each case carries its own byte-identical copy. `claude plugin eval . ... --case trigger-bussin-drizzle` loaded the case fine but printed "Plugin under test: none resolved — cases run against baseline Claude Code" and scored 0.00. The repo root has only .claude-plugin/marketplace.json (plugin `bussin`, source ./) and no plugin.json, so a path target does not resolve the plugin. F11 has to fix that: try target `bussin@<marketplace name>` after installing, or add .claude-plugin/plugin.json, then check validate --strict still passes. Eval results land in gitignored evals/results/.
Next: F10
