---
name: bussin-autoloop
description: Autonomous build loop for one feature or a whole new project. `/bussin-autoloop init <task>` researches the codebase (or scaffolds a new project), expands the task into `.loop/feature_list.json` with functional, edge-case and regression items, installs verify gates and a commit guard, then `/bussin-autoloop run` completes ONE item per fresh session until every item passes with evidence. Use it whenever the user wants something built autonomously, "in a loop", "without back and forth", "until it's done", "overnight", "with proof it works end-to-end", or mentions autoloop, feature_list, Ralph-style loops or long-running agent harnesses. Also use it when they want the loop faster or more thorough (modes fast, standard, thorough) or want specific skills plugged into one feature.
argument-hint: "init <task> [--mode fast|standard|thorough] [--skills a,b,review:c] [--no-checkpoint] [--new] [--stack <text>] [--base <ref>] | run | status"
---

# bussin-autoloop

Two prompts over one harness. `init` runs once and leaves artifacts in `.loop/`. `run` is executed by a fresh session per iteration, finishes one item, and leaves the artifacts updated for the next session. Memory lives in the repo, never in the context window, so a session that starts from zero can orient in under a minute.

## Dispatch

| Invocation | Read first | Do |
|---|---|---|
| `/bussin-autoloop init <task> [flags]` | `references/init.md` | Research or scaffold, write `.loop/`, checkpoint with the user, commit |
| `/bussin-autoloop run` | `references/run.md` | One item: implement, pass the gates, mark passing with evidence, commit, stop |
| `/bussin-autoloop run --item <id>` | `references/run.md` | Worker mode for the parallel driver: that one item in its own worktree, result written to `.loop/results/<id>.json` |
| `/bussin-autoloop status` | nothing | Run `bash <skill directory>/scripts/loop-status.sh` and show its output: progress, ETA, what runs now and next, cost, tokens, models and the latest progress notes |
| `/bussin-autoloop <text>` with no `.loop/` | `references/init.md` | Treat the text as the task |

Installed as the `bussin` plugin, the command is `/bussin:bussin-autoloop`; everything else is the same. In Codex the skill is mentioned as `$bussin-autoloop`.

The driver `scripts/loop.sh` starts one headless agent session per item with the `run` prompt until no item has `passes:false`, with a stall guard. The prompt is `/bussin-autoloop run`, the plugin form when the script lives in the plugin cache, or `$bussin-autoloop run` for Codex; override it with `LOOP_SKILL_COMMAND`. A session that exits on a usage limit is not a stall: the driver waits `LIMIT_WAIT` seconds (default 600) and retries. Start it from the project root:

```bash
bash <skill directory>/scripts/loop.sh
```

Init prints the exact path for the current install, for example `~/.claude/skills/bussin-autoloop/scripts/loop.sh`.

One loop per checkout. The driver holds `.loop/run.lock` while it runs and refuses to start when another driver is live in the same checkout ("a loop is already running here"); a lock or `live.json` left by a driver that died does not block. To run several loops at once, give each its own git worktree or repo. Each loop is named after its checkout's directory (`LOOP_NAME`), which keeps its worker branches, ports and test databases apart from the others'.

To stop without losing work, request a stop instead of pressing Ctrl-C:

```bash
bash <skill directory>/scripts/loop-status.sh --stop [project dir]
```

It creates `.loop/stop`, which git never sees. The driver never interrupts a running session. A sequential loop exits before its next session starts. A parallel loop starts no new workers, lets the running ones finish and merge as usual (live state `stopping`), then exits. Both exit 0 with live state `stopped`. To resume, run `loop.sh` again. The Stop button in the `bussin-loop-status` mod does the same.

### Agents

`LOOP_AGENT` picks the CLI that runs each session; the default is `claude`. Each needs the skill installed where that agent finds it (`npx skills add nksrentas/skills --skill bussin-autoloop -a codex`, or `-a github-copilot`).

| `LOOP_AGENT` | Session command | Tool limits | Telemetry |
|---|---|---|---|
| `claude` | `claude -p … --output-format json` | Allowlist per tool and command, Edit and Write denied on loop files | Tokens, cost and models from the result |
| `codex` | `codex exec --json --sandbox workspace-write --add-dir <git dir>` | Codex's sandbox: writes only inside the project and its git dir, no network. A parallel worker gets only the git objects, refs, logs and its own worktree data, not git config or hooks | Tokens per turn; cost unknown |
| `copilot` | `copilot -p … --output-format json --no-ask-user` | `--allow-tool` for file writes, `.loop/init.sh` and `.loop/verify.sh` by path, the git read and commit subcommands, and each project command by its first two words; writes to the loop scripts and config denied | Model, turns and premium requests; tokens and cost unknown |

`LOOP_MODEL` sets the model for any agent. `LOOP_AGENT_ARGS` appends raw flags, for example `LOOP_AGENT_ARGS='-c sandbox_workspace_write.network_access=true'` when Codex sessions need the network for installs or a browser check. `LOOP_EXTRA_TOOLS` adds Claude or Copilot tool rules; Codex takes its MCP servers from its own config.

```bash
LOOP_AGENT=codex LOOP_MODEL=gpt-5.6-luna bash <skill directory>/scripts/loop.sh
```

### Parallel workers

`LOOP_WORKERS=3 bash <skill directory>/scripts/loop.sh` runs up to three sessions at once. The cap is whatever you set, up to 8, and the default of 1 keeps the sequential loop. Init writes two scheduling fields on every item: `depends_on`, the items that must pass first, and `touches`, the paths it will change. An item starts when its dependencies pass and its `touches` overlap no running item. Edit either field in `.loop/feature_list.json` at any time; the driver re-reads them before each launch, and the commit guard ignores them.

Each worker gets a git worktree next to the repo (`<repo>.loop-workers/w<n>`, override with `LOOP_WORKER_ROOT`) on branch `loop/<loop name>/<id>`, and runs `run --item <id>`. When it reports a pass, the driver merges the branch into the current branch one item at a time and runs `verify.sh` on the merged result, because two items that pass alone can still break together. A red merged gate is run once more before it counts, because flaky end-to-end tests fail more under the load of several workers. A conflict or a gate that stays red sends the item back to run again on top of the latest work, up to `LOOP_ITEM_ATTEMPTS` (default 3). A red merged gate after the worker's own gate passed does not use up an attempt, up to `LOOP_MERGE_RETRIES` times per item (default 2), so a merge that is really broken still stops. Attempt counts live in `.loop/attempts.json`, so they survive a restart; the driver deletes the file once every item passes, and you can delete it yourself to give items fresh attempts. When nothing can start (a dependency cycle, an unknown id, or an item out of attempts), the driver stops and lists what each item is waiting for.

The speed-up depends on the list's shape, not on the cap. Items that all edit one file run one after another whatever the cap is, while portable feature folders (`bussin-ts-architecture`) parallelise well. Every worker is a full session, so usage goes N times faster. `init.sh` has to pick a free port at runtime, record it in `.loop/port`, name test databases after `LOOP_NAME` and `LOOP_WORKER`, and stop its servers on `init.sh stop`. Before it removes a worker's worktree, the driver also kills every process still running inside it, so a dev server that outlives its session cannot hold the port or block the removal. Workers must not use `git stash`, which all worktrees share; the driver warns when a new stash entry appears. It also warns at start when the 1-minute load average is above twice the core count.

### Status view

In any terminal, whichever agent runs the loop:

```bash
bash <skill directory>/scripts/loop-status.sh            # every loop in this repository and its worktrees
bash <skill directory>/scripts/loop-status.sh --watch 5  # redraw every 5 seconds
```

It prints the same view as the pane below: progress bar, elapsed time, ETA and its clock time, cost, then Now, Next and Done, then cost, tokens, models (and Copilot premium requests) and the latest progress notes.

In Claude Code, the `bussin-loop-status` mod shows a run as it happens. Install it with `claude plugin marketplace add nksrentas/skills` and `claude plugin install bussin-loop-status@bussin`.
- **Status line:** shows a loop's outcome once nothing is running, for example `autoloop finished 59/59 · 9h 12m · $41.20`. While loops run it stays empty, because the band below already shows them.
- **Band above the prompt:** with several loops in the repository, every running one gets its own row, for example `▶ stage1-auth-site ███░░ 36/59 · on F31 · ETA 40m · $6.09`, with a Details button that opens it in the pane and a Stop button that requests a stop. A loop that is finishing its running items after a stop shows as `□ … stopping`. A loop whose `live.json` says running but whose driver process is gone shows as `⚠ … driver not running`. The status line lists them all too.
- **Pane:** `/autoloop-status` or a band row's Details button opens it.
  - **Loop chips:** running loops show as chips. Loops that are not running fold behind a `+N not running` button.
  - **Header:** a Stop button, progress, ETA, elapsed time, cost so far, and counts of done, running, ready, blocked and failing items.
  - **Dead driver:** when the driver's process (the `pid` in `live.json`) has exited, a warning replaces the Stop button. It has a button that copies the command to resume.
  - **Now:** the running items, with worker, time and attempt.
  - **Next:** the next ready or failing items. Blocked items are grouped by what they wait for (`▸ 43 wait for R0`), and each group expands.
  - **Recent:** the latest sessions with their outcome, time and cost.
  - **Spend:** cost and models on one line. A button shows tokens.

It reads only `.loop/` folders, and it finds them in the session's project and in every git worktree of the same repository. A session opened in the main checkout therefore sees loops running in worktrees, with buttons to switch between them. A loop started before this telemetry existed has no `usage.jsonl` or `live.json`, so the view shows progress and items only. Two steps fill it in:
- Run `bash <skill directory>/scripts/backfill-usage.sh` in the project. It rebuilds `usage.jsonl` from Claude Code's own transcripts of past loop sessions: tokens, models, time and item per session. Cost isn't in transcripts, so it shows as unknown.
- Restart the loop with the current `loop.sh`, which keeps `usage.jsonl` and `live.json` current from then on.

### Running unattended

Each session runs headless with the limits in the agents table. A Claude session gets only the tools the driver passes in `--allowedTools`: the file tools, `Skill`, `Agent`, `TodoWrite`, `bash .loop/init.sh` (and `bash .loop/init.sh stop`), `bash .loop/verify.sh`, the read and commit subset of git, and every command in `config.commands`. Any other shell command is denied rather than run, and Edit and Write are denied on `.loop/*.sh`, `.loop/config.json`, `.claude/` and `.git/`. Recent Claude Code applies the `Edit` rule to every file tool and warns that the `Write` rule is redundant. Older versions need both, and the warning only reaches a session's error file. Add tools with a comma-separated `LOOP_EXTRA_TOOLS`, most often the browser MCP server that browser verification needs, for example `LOOP_EXTRA_TOOLS=mcp__plugin_playwright_playwright`.

The commit guard runs in two places. In Claude Code it is a PreToolUse hook on Bash. For every agent, the driver also installs a git `pre-commit` hook that runs the same guard on the commit being made, but only inside sessions it started (`AUTOLOOP_SESSION` is set), so your own commits are untouched. An existing `pre-commit` hook is kept as `pre-commit.before-autoloop` and still runs after the guard. When `core.hooksPath` is set (husky), the driver skips the hook and says so.

Codex and Copilot sessions can write the git directory, so the driver checks git's config and hooks after every session (and on every poll in parallel mode) and stops before running git again if a session changed them, because a planted hook or `core.fsmonitor` would run outside the agent's sandbox. The driver's own git commands run with hooks and fsmonitor switched off (`GIT_CONFIG_COUNT`), so nothing a session plants runs in the driver even between checks.

A git hook can be skipped with `--no-verify`, so after every sequential session the driver audits what was committed. It stops the loop when a commit changed the loop config or scripts (`init.sh` included), or added, removed or reworded items. For Codex and Copilot, which have no tool-level guard, it also re-runs `verify.sh` whenever an item turned passing. The parallel driver already re-gates every merge.

The guard and `verify.sh` read the loop scripts and config from the last commit, so editing them in the working tree changes nothing, and committing an edit is blocked. Together with the allowlist this stops the loop from shortcutting its own gates. It is not a sandbox against hostile code: the project's test script runs whatever the repo says, so a deliberately adversarial session could still rewrite it. When the proof has to hold against that, run the same tests in CI on the pushed commits. For an overnight run, use Claude Code's sandbox, Codex's sandbox or a devcontainer with no production credentials and limited network access. Copilot's allowlist matches a command and its subcommand, not its arguments, so `npm run lint` in `config.commands` allows every `npm run` script; run Copilot loops in a container when that matters.

## Artifacts in `.loop/`

| File | Written by | Purpose |
|---|---|---|
| `config.json` | init | Mode, gates, skills per stage, commands, base commit |
| `feature_list.json` | init writes items; run touches only `passes` and `evidence` | The contract and the final proof |
| `init.sh` | init | Boots the environment so no session rediscovers how |
| `verify.sh` | init copies from `assets/` | Runs tests, then Stryker on changed files when enabled, then writes the code's fingerprint to `.loop/tests-passed` |
| `guard-commit.sh` | init copies from `assets/` | The commit guard, run as a Claude Code PreToolUse hook and as the git `pre-commit` hook the driver installs, always from the committed copy (`git show HEAD:`). It blocks any commit unless the marker matches the current code, items are unchanged apart from `passes` and `evidence`, and the loop config and scripts are untouched |
| `progress.md` | run, or the driver in parallel mode | What each session did, learned about the codebase, and what is next |
| `usage.jsonl` | the driver | One line per session: agent, item, worker, outcome, duration, input, output and cache tokens, cost, and a per-model breakdown. `cost_usd` is absent when the agent does not report it |
| `live.json` | the driver | Whether the loop is running, its mode, agent and workers, when it started, and which items are running now |
| `results/<id>.json` | a parallel worker | One item's outcome, merged and then folded into `feature_list.json` and `progress.md` by the driver |
| `retro.md` | run, thorough mode | Proposed environment improvements, never applied by the loop |

Items are never removed or reworded by `run`. Deleting an item to make the list green is the exact failure this harness exists to prevent, so a run that believes an item is wrong records that in `progress.md` and leaves it `false` for a human. The guard enforces this rather than trusting it.

## Modes

Presets live in `assets/presets.json`. Choose with `--mode`; the default is `standard`.

| | fast | standard | thorough |
|---|---|---|---|
| Tests gate | yes | yes | yes |
| Implement stage | tests after code | test-first | test-first |
| Review stage | `bussin-lean` cleanup pass, inline | spec, standards and lean review | spec, standards and lean review, plus test audit |
| Mutation gate (Stryker) | no | no | yes |
| Browser verification | only when the item's `verify` says so | UI items | UI items |
| End stage | none | none | retro note in `retro.md` |

Fast suits throwaway or low-risk work. Standard suits normal features. Thorough is for when the proof matters more than the hours: mutation testing is the only objective check that the tests exercise edge cases instead of happy paths.

## Per-feature skills

`--skills a,b,review:c` adds skills to `config.skills`. A bare name lands in the `context` stage, which run reads before implementing (design systems, framework conventions, house style). `stage:name` targets `context`, `implement`, `review` or `end`. Run invokes each configured skill at its stage (the Skill tool in Claude Code; other agents load it by name), after its own built-in work for that stage. Test-first implementation, review and retro are built into `references/run.md`, so no outside skill is required. When a configured skill is not installed, run skips it and notes that in `progress.md`.

House context skills, opt-in per feature:

| Skill | Use when |
|---|---|
| `bussin-ts-architecture` | Any TypeScript backend or Next.js feature: portable feature folders with controller, service, DTO, job and UI files |
| `bussin-drizzle` | The feature reads or writes a SQL database from TypeScript |
| `bussin-ui` | Landing pages and dashboards in Next.js + Tailwind v4 + GSAP + Lenis with the house look |
| `bussin-lean` | Always on: every preset loads it, and the review stage blocks on its findings |
| `bussin-a11y` | Any UI work: WCAG 2.2 AA, native HTML first |
| `bussin-seo` | Public pages and routes: metadata, headings, sitemap, Core Web Vitals |
| `bussin-schema` | Public pages that need JSON-LD |

Example: `/bussin-autoloop init "Invoice reminders" --skills bussin-ts-architecture,bussin-drizzle`. Init copies each one's review checklist into `CODING_STANDARDS.md`, so the review stage enforces it.

For UI work, add accessibility, SEO and Emil Kowalski's animation review: `/bussin-autoloop init "Pricing page" --skills bussin-ts-architecture,bussin-ui,bussin-a11y,bussin-seo,bussin-schema,review:review-animations`.

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
  "skills": { "context": ["bussin-lean"], "implement": [], "review": [], "end": [] },
  "checkpoint": true
}
```

## Rules that hold in every stage

- One item per session. Agents reach for more and leave half-finished work that the next fresh session cannot distinguish from intent.
- `passes:true` needs evidence: the commit sha plus what was run or clicked. Without evidence it is a claim, and the loop would stop on a claim.
- Whoever wrote the code does not grade it. Review runs in a subagent with its own context and the item as its spec.
- Gates never weaken to pass. Thresholds and items are fixed by init; run adds tests, it does not lower bars.
- Codebase learnings go to `progress.md`, environment proposals go to `retro.md`. Nothing edits CLAUDE.md, hooks or skills mid-loop; a human promotes recurring proposals at the next init.
