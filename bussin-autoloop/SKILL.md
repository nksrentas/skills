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

The driver `scripts/loop.sh` calls `claude -p "/bussin-autoloop run"` until no item has `passes:false`, with a stall guard. Start it from the project root:

```bash
bash ~/.claude/skills/bussin-autoloop/scripts/loop.sh
```

## Artifacts in `.loop/`

| File | Written by | Purpose |
|---|---|---|
| `config.json` | init | Mode, gates, skills per stage, commands, base commit |
| `feature_list.json` | init writes items; run touches only `passes` and `evidence` | The contract and the final proof |
| `init.sh` | init | Boots the environment so no session rediscovers how |
| `verify.sh` | init copies from `assets/` | Runs tests, then Stryker on changed files when enabled, then creates `.loop/tests-passed` |
| `guard-commit.sh` | init copies from `assets/` | PreToolUse hook that blocks `git commit` while `tests-passed` is missing |
| `progress.md` | run | What each session did, learned about the codebase, and what is next |
| `retro.md` | run, thorough mode | Proposed environment improvements, never applied by the loop |

Items are never removed or reworded by `run`. Deleting an item to make the list green is the exact failure this harness exists to prevent, so a run that believes an item is wrong records that in `progress.md` and leaves it `false` for a human.

## Modes

Presets live in `assets/presets.json`. Choose with `--mode`; the default is `standard`.

| | fast | standard | thorough |
|---|---|---|---|
| Tests gate | yes | yes | yes |
| Implement stage | tests after code, inline | `tdd` | `tdd` |
| Review stage | none | `code-review` | `code-review` + `test-audit` |
| Mutation gate (Stryker) | no | no | yes |
| Browser verification | only when the item's `verify` says so | UI items | UI items |
| End stage | none | none | `retro` |

Fast suits throwaway or low-risk work. Standard suits normal features. Thorough is for when the proof matters more than the hours: mutation testing is the only objective check that the tests exercise edge cases instead of happy paths.

## Per-feature skills

`--skills a,b,review:c` adds skills to `config.skills`. A bare name lands in the `context` stage, which run reads before implementing (design systems, framework conventions, house style). `stage:name` targets `context`, `implement`, `review` or `end`. Run invokes each configured skill at its stage with the Skill tool. When a skill is not installed, run applies the inline fallback in `references/run.md` and notes the fallback in `progress.md`.

House context skills, opt-in per feature:

| Skill | Use when |
|---|---|
| `bussin-ts-architecture` | TypeScript backend work: feature folders with controller, service, DTO and job files |
| `bussin-drizzle` | The feature reads or writes a SQL database from TypeScript |
| `bussin-ui` | Landing pages and dashboards in Next.js + Tailwind v4 + GSAP + Lenis with the house look |

Example: `/bussin-autoloop init "Invoice reminders" --skills bussin-ts-architecture,bussin-drizzle`. Init copies each one's review checklist into `CODING_STANDARDS.md`, so the review stage enforces it.

Matt Pocock's `tdd`, `code-review` and `retro` install with:

```bash
npx skills@latest add mattpocock/skills
```

## Config shape

```json
{
  "task": "Export invoices to CSV",
  "mode": "standard",
  "new_project": false,
  "base": "<sha of the init commit>",
  "commands": { "test": "npm test", "dev": "npm run dev" },
  "mutation_paths": ["src/**/*.ts", "src/**/*.tsx"],
  "gates": { "tests": true, "mutation": false, "browser": true },
  "skills": { "context": [], "implement": ["tdd"], "review": ["code-review"], "end": [] },
  "checkpoint": true
}
```

## Rules that hold in every stage

- One item per session. Agents reach for more and leave half-finished work that the next fresh session cannot distinguish from intent.
- `passes:true` needs evidence: the commit sha plus what was run or clicked. Without evidence it is a claim, and the loop would stop on a claim.
- Whoever wrote the code does not grade it. Review runs in a subagent with its own context and the item as its spec.
- Gates never weaken to pass. Thresholds and items are fixed by init; run adds tests, it does not lower bars.
- Codebase learnings go to `progress.md`, environment proposals go to `retro.md`. Nothing edits CLAUDE.md, hooks or skills mid-loop; a human promotes recurring proposals at the next init.
