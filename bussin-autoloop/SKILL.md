---
name: bussin-autoloop
description: Autonomous build loop for one feature or a whole new project. `/bussin-autoloop init <task>` researches the codebase (or scaffolds a new project), expands the task into `.loop/feature_list.json` with functional, edge-case and regression items, installs verify gates and a commit guard, then `/bussin-autoloop run` completes ONE item per fresh session until every item passes with evidence. Use it whenever the user wants something built autonomously, "in a loop", "without back and forth", "until it's done", "overnight", "with proof it works end-to-end", or mentions autoloop, feature_list, Ralph-style loops or long-running agent harnesses. Also use it when they want the loop faster or more thorough (modes fast, standard, thorough) or want specific skills plugged into one feature.
---

# bussin-autoloop

Two prompts over one harness. `init` runs once and leaves artifacts in `.loop/`. `run` is executed by a fresh session per iteration, finishes one item, and leaves the artifacts updated for the next session. Memory lives in the repo, never in the context window, so a session that starts from zero can orient in under a minute.

## Dispatch

| Invocation | Read first | Do |
|---|---|---|
| `/bussin-autoloop init <task> [flags]` | `references/init.md` | Research or scaffold, write `.loop/`, checkpoint with the user, commit |
| `/bussin-autoloop run` | `references/run.md` | One item: implement, pass the gates, mark passing with evidence, commit, stop |
| `/bussin-autoloop status` | nothing | Print items still `passes:false` and the last 20 lines of `.loop/progress.md` |
| `/bussin-autoloop <text>` with no `.loop/` | `references/init.md` | Treat the text as the task |

Installed as the `bussin` plugin, the command is `/bussin:bussin-autoloop`; everything else is the same.

The driver `scripts/loop.sh` calls `claude -p "/bussin-autoloop run"` (or the plugin form, chosen from where the script lives; override with `LOOP_SKILL_COMMAND`) until no item has `passes:false`, with a stall guard. A session that exits on a usage limit is not a stall: the driver waits `LIMIT_WAIT` seconds (default 600) and retries. Start it from the project root:

```bash
bash <skill directory>/scripts/loop.sh
```

Init prints the exact path for the current install, for example `~/.claude/skills/bussin-autoloop/scripts/loop.sh`.

### Running unattended

Each session runs headless, so it gets only the tools the driver passes in `--allowedTools`: the file tools, `Skill`, `Agent`, `TodoWrite`, `bash .loop/init.sh`, `bash .loop/verify.sh`, the read and commit subset of git, and every command in `config.commands`. Any other shell command is denied rather than run, and Edit and Write are denied on `.loop/*.sh`, `.loop/config.json`, `.claude/` and `.git/`. Add tools with a comma-separated `LOOP_EXTRA_TOOLS`, most often the browser MCP server that browser verification needs, for example `LOOP_EXTRA_TOOLS=mcp__plugin_playwright_playwright`.

The guard and `verify.sh` read the loop scripts and config from the last commit, so editing them in the working tree changes nothing, and committing an edit is blocked. Together with the allowlist this stops the loop from shortcutting its own gates. It is not a sandbox against hostile code: the project's test script runs whatever the repo says, so a deliberately adversarial session could still rewrite it. When the proof has to hold against that, run the same tests in CI on the pushed commits. For an overnight run, use Claude Code's sandbox or a devcontainer with no production credentials and limited network access.

## Artifacts in `.loop/`

| File | Written by | Purpose |
|---|---|---|
| `config.json` | init | Mode, gates, skills per stage, commands, base commit |
| `feature_list.json` | init writes items; run touches only `passes` and `evidence` | The contract and the final proof |
| `init.sh` | init | Boots the environment so no session rediscovers how |
| `verify.sh` | init copies from `assets/` | Runs tests, then Stryker on changed files when enabled, then writes the code's fingerprint to `.loop/tests-passed` |
| `fingerprint.sh` | init copies from `assets/` | Hashes the working tree, leaving out the bookkeeping files, so the marker is tied to the exact code that passed |
| `guard-commit.sh` | init copies from `assets/` | PreToolUse hook, always run from the committed copy (`git show HEAD:`), that blocks any `git commit` unless the marker matches the current code, items are unchanged apart from `passes` and `evidence`, and the loop config and scripts are untouched |
| `progress.md` | run | What each session did, learned about the codebase, and what is next |
| `retro.md` | run, thorough mode | Proposed environment improvements, never applied by the loop |

Items are never removed or reworded by `run`. Deleting an item to make the list green is the exact failure this harness exists to prevent, so a run that believes an item is wrong records that in `progress.md` and leaves it `false` for a human. The guard enforces this rather than trusting it.

## Modes

Presets live in `assets/presets.json`. Choose with `--mode`; the default is `standard`.

| | fast | standard | thorough |
|---|---|---|---|
| Tests gate | yes | yes | yes |
| Implement stage | tests after code | test-first | test-first |
| Review stage | none | spec and standards review | spec and standards review, plus test audit |
| Mutation gate (Stryker) | no | no | yes |
| Browser verification | only when the item's `verify` says so | UI items | UI items |
| End stage | none | none | retro note in `retro.md` |

Fast suits throwaway or low-risk work. Standard suits normal features. Thorough is for when the proof matters more than the hours: mutation testing is the only objective check that the tests exercise edge cases instead of happy paths.

## Per-feature skills

`--skills a,b,review:c` adds skills to `config.skills`. A bare name lands in the `context` stage, which run reads before implementing (design systems, framework conventions, house style). `stage:name` targets `context`, `implement`, `review` or `end`. Run invokes each configured skill at its stage with the Skill tool, after its own built-in work for that stage. Test-first implementation, review and retro are built into `references/run.md`, so no outside skill is required. When a configured skill is not installed, run skips it and notes that in `progress.md`.

House context skills, opt-in per feature:

| Skill | Use when |
|---|---|
| `bussin-ts-architecture` | Any TypeScript backend or Next.js feature: portable feature folders with controller, service, DTO, job and UI files |
| `bussin-drizzle` | The feature reads or writes a SQL database from TypeScript |
| `bussin-ui` | Landing pages and dashboards in Next.js + Tailwind v4 + GSAP + Lenis with the house look |

Example: `/bussin-autoloop init "Invoice reminders" --skills bussin-ts-architecture,bussin-drizzle`. Init copies each one's review checklist into `CODING_STANDARDS.md`, so the review stage enforces it.

For UI work, pair the house look with Emil Kowalski's animation review: `/bussin-autoloop init "Pricing page" --skills bussin-ts-architecture,bussin-ui,review:review-animations`.

## Config shape

```json
{
  "task": "Export invoices to CSV",
  "mode": "standard",
  "new_project": false,
  "base": "<HEAD before the init commit>",
  "commands": { "test": "npm test", "dev": "npm run dev" },
  "mutation_paths": ["src/**/*.ts", "src/**/*.tsx"],
  "gates": { "tests": true, "mutation": false, "browser": true },
  "skills": { "context": [], "implement": [], "review": [], "end": [] },
  "checkpoint": true
}
```

## Rules that hold in every stage

- One item per session. Agents reach for more and leave half-finished work that the next fresh session cannot distinguish from intent.
- `passes:true` needs evidence: the commit sha plus what was run or clicked. Without evidence it is a claim, and the loop would stop on a claim.
- Whoever wrote the code does not grade it. Review runs in a subagent with its own context and the item as its spec.
- Gates never weaken to pass. Thresholds and items are fixed by init; run adds tests, it does not lower bars.
- Codebase learnings go to `progress.md`, environment proposals go to `retro.md`. Nothing edits CLAUDE.md, hooks or skills mid-loop; a human promotes recurring proposals at the next init.
