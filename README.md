<p align="center">
  <img src="./bussin-feature/assets/bussin-logo.svg" alt="Bussin" width="360">
</p>

<h1 align="center">Skills</h1>

<p align="center">Reusable Agent Skills for shipping focused, production-quality work across AI coding tools.</p>

<p align="center">
  <a href="https://skills.sh/nksrentas/skills"><img src="https://skills.sh/b/nksrentas/skills" alt="skills.sh installs"></a>
</p>

## Included skills

- [bussin-autoloop](./bussin-autoloop): Autonomous build loop. `init` expands a task into a feature list with verify gates and a commit guard, then `run` finishes one item per fresh session until every item passes with evidence.
- [bussin-feature](./bussin-feature): The workflow for building a feature end to end: ground it in the repo, cover loading, error, empty and success states, update every dependent file, keep the folder portable, and verify.
- [bussin-lean](./bussin-lean): Lean code while writing it, then a mandatory cleanup pass on the diff: no leftovers from earlier implementations, nothing over-engineered, no wasteful allocation or data access.
- [bussin-ts-architecture](./bussin-ts-architecture): Feature-based folders for TypeScript backends and Next.js apps, where every feature folder is portable: it imports nothing from other features and works when copied into another project.
- [bussin-drizzle](./bussin-drizzle): Drizzle ORM data access with schemas per feature, drizzle-kit migrations, typed queries inside services, and tests against a real database.
- [bussin-react](./bussin-react): React 19 and Next.js App Router rules: server components first, shadcn/ui owned in the shared kit, compound components, TanStack Query, forms on the feature's DTOs, and performance and security rules.
- [bussin-ui](./bussin-ui): House UI system for landing pages and dashboards in Next.js, Tailwind CSS v4, GSAP and Lenis.
- [bussin-a11y](./bussin-a11y): Build and audit accessible UI to WCAG 2.2 AA, native HTML first and ARIA only where needed. Adapted from addyosmani/web-quality-skills (MIT).
- [bussin-seo](./bussin-seo): On-page and technical SEO plus Core Web Vitals, with Next.js App Router metadata, sitemap and robots rules. Adapted from addyosmani/web-quality-skills (MIT).
- [bussin-schema](./bussin-schema): Schema.org JSON-LD that stays eligible for Google rich results, with an up-to-date list of deprecated types. Adapted from AgriciDaniel/claude-seo (MIT).
- [bussin-honest-feedback](./bussin-honest-feedback): Direct assessments instead of agreeable ones: verdict first, a rating out of 10 against fixed anchors, weak assumptions named, "you're wrong" with the reason, and "I don't know" when that is the truth.
- [bussin-write-like-a-human](./bussin-write-like-a-human): Check and revise drafts against the narrative choices that separate human from AI fiction, using measured rates from the StoryScope study of 61,608 stories.

## Short aliases

Every skill has a short alias that takes the same arguments, and the slash menu shows those arguments as you type.

| Alias | Skill | Arguments |
|---|---|---|
| `/autoloop` | `bussin-autoloop` | `init <task> [--mode fast\|standard\|thorough] [--skills a,b,review:c] [--no-checkpoint] [--new] [--stack <text>] [--base <ref>] [--name <text>]`, `run`, `retro` or `status` |
| `/feature` | `bussin-feature` | `<feature to build or change>` |
| `/lean` | `bussin-lean` | `[path, file or commit range to clean up]` |
| `/arch` | `bussin-ts-architecture` | `[feature to place or wiring question]` |
| `/drizzle` | `bussin-drizzle` | `[table, column, migration or query task]` |
| `/react` | `bussin-react` | `[component, hook, form or page to build or review]` |
| `/ui` | `bussin-ui` | `[page, section or screen to build or restyle]` |
| `/honest` | `bussin-honest-feedback` | `<idea, plan, draft or decision to assess>` |
| `/humanize` | `bussin-write-like-a-human` | `<draft text or path to the draft>` |
| `/a11y` | `bussin-a11y` | `[page, component or URL to build or audit]` |
| `/seo` | `bussin-seo` | `[page, route or URL]` |
| `/schema` | `bussin-schema` | `[page, entity or URL]` |

Aliases are user-only: Claude never picks one by itself, so they do not compete with the real skills for triggering. When the skills come from the plugin, the aliases are namespaced too, for example `/bussin:autoloop`.

## Install or update, on any computer

```bash
npx github:nksrentas/skills
```

Without Node, the same installer runs with `curl -fsSL https://raw.githubusercontent.com/nksrentas/skills/main/install.sh | bash`.

It clones this repository into `~/dev/skills`, or pulls it if it is already there, and links every skill and alias into `~/.claude/skills`. It also installs or updates the `bussin-loop-status` mod. When Codex or Copilot is installed, it copies the skills for them too. Run the same command again any time to update. It needs `git`; `jq` is needed by bussin-autoloop. On Windows, run it inside WSL. Set `SKILLS_DIR` to clone somewhere else.

## Other ways to install

### As a Claude Code plugin

One install gives you all twelve skills:

```bash
claude plugin marketplace add nksrentas/skills
claude plugin install bussin@bussin
```

Plugin skills are namespaced, so the loop command becomes `/bussin:bussin-autoloop`.

### With the skills CLI

The repository follows the open Agent Skills format, so it works with Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot and the other tools the `skills` CLI supports.

Install everything:

```bash
npx skills add nksrentas/skills -g --all
```

Or one skill:

```bash
npx skills add nksrentas/skills --skill bussin-autoloop -g
```

Omit `-g` for a project-local installation. `npx skills update -g` pulls updates.

### Ponytail for bussin-lean

`bussin-lean` also runs the ponytail plugin's over-engineering review when it is installed:

```bash
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail
```

### Animation skills for bussin-ui

`bussin-ui` hands motion craft to Emil Kowalski's skills. Install them next to it:

```bash
npx skills add emilkowalski/skills --skill emil-design-eng --skill animate --skill find-animation-opportunities --skill improve-animations --skill review-animations --skill animation-performance --skill animation-vocabulary --skill apple-design
```

## Quick start: an autonomous feature loop

```text
/bussin-autoloop init "Invoice reminders" --skills bussin-ts-architecture,bussin-drizzle
```

Init researches the codebase and writes `.loop/`. That holds the feature list (functional, edge-case and regression items), a verify gate, and a commit guard that only allows commits of code that passed the gate. Init then shows you the list to confirm, and prints the command that runs one fresh session per item until every item passes:

```bash
bash ~/.claude/skills/bussin-autoloop/scripts/loop.sh
```

To run independent items at the same time, each in its own git worktree, set a cap: `LOOP_WORKERS=3 bash ~/.claude/skills/bussin-autoloop/scripts/loop.sh`. Init works out which items depend on which and what files each touches; you can edit both in `.loop/feature_list.json`.

For UI work add `bussin-ui` and `review:review-animations` to `--skills`.

### Running several loops

Run one loop per checkout; a second `loop.sh` in the same checkout refuses to start while the first runs. For several loops at once, from different chats or terminals, give each its own git worktree (`git worktree add ../app-billing`) or repo. Each loop is named after its directory, so its worker branches (`loop/<name>/<id>`), dev-server ports and test databases never collide with another loop's.

The loop runs with Codex or GitHub Copilot too: install the skill for that agent, start init there (`$bussin-autoloop init …` in Codex, `/bussin-autoloop init …` in Copilot), then run the driver with `LOOP_AGENT=codex` or `LOOP_AGENT=copilot`. Every agent's commits go through the same commit guard, here as a git `pre-commit` hook, and the driver re-runs the gate after Codex and Copilot sessions. See [Agents](./bussin-autoloop/SKILL.md#agents) for what each one limits and reports.

### Watching a run

From any terminal, whichever agent runs the loop:

```bash
bash ~/.claude/skills/bussin-autoloop/scripts/loop-status.sh --watch
```

It shows every loop in the repository and its worktrees: progress, ETA, each running item's step (Orient, Implement, Gate, Review, Browser, Commit) and its latest log lines, what runs next, cost, tokens, models, and how many loop sessions this Mac runs. Follow one item's full log with `tail -f .loop/logs/<item>.log`. Give a loop a better name with `--rename "Landing page"`.

Run as many loops as you like, in different projects or worktrees: they share one machine-wide limit on agent sessions (half the CPU cores or (RAM − 4 GB) ÷ 2 GB, whichever is lower; `LOOP_MACHINE_SESSIONS` overrides it). A loop that would go over the limit waits as queued instead of slowing everything down.

To stop a loop without losing in-flight work, run `bash ~/.claude/skills/bussin-autoloop/scripts/loop-status.sh --stop`. Running sessions finish and parallel workers merge, then the loop exits. Run `loop.sh` again to resume.

Inside Claude Code, the `bussin-loop-status` mod puts every running loop in a band above the prompt, one row per loop, including loops in git worktrees. The status line stays empty while loops run and shows a loop's outcome once none is running. `/autoloop-status`, or a row's Details button, opens a pane. The band rows and the pane each have a Stop button that works like `--stop`. The pane shows:
- a card per loop on the left, and the selected loop's task, progress and ETA
- each running item's step strip and its last log lines, with worker and attempt
- elapsed time and the estimated finish
- Rename and Stop, and how many loop sessions this Mac runs
- a warning, and a copyable resume command, when the driver process is gone
- blocked items grouped by what they wait for, and the latest sessions
- input, output and cache tokens
- cost, per model and per session

```bash
claude plugin marketplace add nksrentas/skills
claude plugin install bussin-loop-status@bussin
```

See [bussin-autoloop](./bussin-autoloop/SKILL.md) for modes, gates and running unattended safely.

## Tests and evals

CI runs every `tests/*.test.sh` with the system bash on `ubuntu-latest` and `macos-latest`, on pull requests and on pushes to `main`. Run them locally with:

```bash
for t in tests/*.test.sh; do bash "$t" || exit 1; done
```

The `evals/` folder holds trigger cases for `claude plugin eval`: one per skill, plus negative cases where no bussin skill may fire. Run the suite from the repo root:

```bash
claude plugin eval . --runs 1 --ablation none --no-publish --trust-plugin
```

Evals run real Claude sessions on your own Claude credentials and cost money, roughly $0.06-0.09 per case.

## Compatibility

The portable behavior lives in each skill's `SKILL.md`, with optional `references/`, `scripts/`, and `assets/`. Agent-specific metadata such as `agents/openai.yaml` enhances supported clients without changing the shared skill instructions.
