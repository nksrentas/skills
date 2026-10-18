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
- [bussin-ui](./bussin-ui): House UI system for landing pages and dashboards in Next.js, Tailwind CSS v4, GSAP and Lenis.
- [bussin-honest-feedback](./bussin-honest-feedback): Direct assessments instead of agreeable ones: verdict first, a rating out of 10 against fixed anchors, weak assumptions named, "you're wrong" with the reason, and "I don't know" when that is the truth.
- [bussin-write-like-a-human](./bussin-write-like-a-human): Check and revise drafts against the narrative choices that separate human from AI fiction, using measured rates from the StoryScope study of 61,608 stories.

## Short aliases

Every skill has a short alias that takes the same arguments, and the slash menu shows those arguments as you type.

| Alias | Skill | Arguments |
|---|---|---|
| `/autoloop` | `bussin-autoloop` | `init <task> [--mode fast\|standard\|thorough] [--skills a,b,review:c] [--no-checkpoint] [--new] [--stack <text>] [--base <ref>]`, `run` or `status` |
| `/feature` | `bussin-feature` | `<feature to build or change>` |
| `/lean` | `bussin-lean` | `[path, file or commit range to clean up]` |
| `/arch` | `bussin-ts-architecture` | `[feature to place or wiring question]` |
| `/drizzle` | `bussin-drizzle` | `[table, column, migration or query task]` |
| `/ui` | `bussin-ui` | `[page, section or screen to build or restyle]` |
| `/honest` | `bussin-honest-feedback` | `<idea, plan, draft or decision to assess>` |
| `/humanize` | `bussin-write-like-a-human` | `<draft text or path to the draft>` |

Aliases are user-only: Claude never picks one by itself, so they do not compete with the real skills for triggering. When the skills come from the plugin, the aliases are namespaced too, for example `/bussin:autoloop`.

## Install

### As a Claude Code plugin

One install gives you all eight skills:

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

For UI work add `bussin-ui` and `review:review-animations` to `--skills`. See [bussin-autoloop](./bussin-autoloop/SKILL.md) for modes, gates and running unattended safely.

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
