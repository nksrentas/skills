# bussin-autoloop retro

Run after a loop finishes, or any time between items. It turns the mistakes the loop made into rules, so the next session, the next loop and the next project avoid them. It runs with you, not unattended: nothing changes until you approve the list.

## 1. Gather what went wrong

- Every `Lesson:` line in `.loop/progress.md`. Sessions write one whenever something went wrong (see step 8 of `references/run.md`).
- Every proposal in `.loop/retro.md`, the thorough-mode retros.
- From `.loop/usage.jsonl`, the items that needed more than one session or ended `failed` or `error`. From `.loop/attempts.json`, the items that ran out of attempts. Read the matching `progress.md` entries to see why.
- Rules already promoted from this loop, listed under `## Promoted` in `.loop/retro.md`, so nothing is proposed twice.

## 2. Turn them into rules

Group the lessons by cause, then write one rule per cause. Each rule is a single line a reviewer can check against a diff, in the style of the target's review checklist, and cites its evidence (item ids, the lesson text). Pick the target:

| The lesson is about | Target |
|---|---|
| A rule a house skill should have had: React, architecture, Drizzle, UI, a11y, SEO, schema, lean | That skill's `## Review checklist`, or its rules section when the rule changes how code is written |
| How the loop itself works: gates, the guard, item lists, sessions | `bussin-autoloop`: `references/run.md` or `references/init.md` |
| Something only this project needs: a naming rule, a fixture, a flaky service | The project's `CODING_STANDARDS.md` |
| The environment: a missing command, a slow or broken `init.sh`, a lint rule | A proposal for the next `init`, in `.loop/retro.md` |

A lesson becomes a skill rule only when it would help in another project too. One about this codebase's quirks stays in the project.

## 3. Checkpoint

Show a table of target, proposed rule, evidence, and whether it is project-only or a skill change. Wait for the user. Drop or reword rules as they say. Apply nothing before they answer.

## 4. Apply

**Project-only rules:** add them to `CODING_STANDARDS.md`, run `bash .loop/verify.sh`, and commit as `docs(retro): <loop name> lessons`.

**Skill rules:**
1. Find where the skills come from: `realpath` the skill's directory. If it is inside a git checkout, the usual case being `~/dev/skills` linked into `~/.claude/skills`, work there:
   - Create a worktree on a branch named `retro/<loop name>-<date>` from the default branch.
   - Edit the target files.
   - Run the repository's structure check (`bash tests/skills-structure.test.sh`, when it exists).
   - Commit, push, and open a pull request whose body lists each rule with its evidence. Give the user the link.
   - Never merge it yourself and never push to the default branch: the user reviews skill changes before every other loop picks them up.
2. If the skills are installed as copies (plugin cache, `~/.agents/skills`), write the exact edits to `.loop/skill-proposals.md` and tell the user where to apply them.

**Environment proposals** go to `.loop/retro.md`, where the next `init` folds in the ones that recur.

Finally, append to `.loop/retro.md`:

```
## Promoted · <date>
- <target>: <rule> (<evidence>)
```

## Rules

- Never edit a skill, hook or loop script while a loop is running on it. A retro proposes; the user merges.
- One rule per cause, phrased so a reviewer can check a diff against it. A long explanation means the rule is not clear yet.
- Do not turn a one-off accident into a rule. Two occurrences, or one that cost a whole attempt, earn a rule.
