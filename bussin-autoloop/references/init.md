# bussin-autoloop init

Runs once per feature or project. It does not implement anything. Its job is to leave `.loop/` in a state where a session with zero context can pick an item and succeed.

## 1. Parse the request

Flags, all optional:

| Flag | Default | Meaning |
|---|---|---|
| `--mode fast\|standard\|thorough` | `standard` | Preset from `assets/presets.json` |
| `--skills a,b,review:c` | none | Extra skills; bare names go to `context`, `stage:name` to that stage |
| `--new` | auto | Force new-project path |
| `--stack <text>` | ask once | Stack for a new project |
| `--no-checkpoint` | off | Skip the single human review of the item list |
| `--base <ref>` | HEAD before init | Only when the loop should diff against another ref |

Everything else in the message is the task text. If it points at a file (`brief.md`, a spec, a PRD), read that file and treat its contents as the task. Detect `new_project` when `--new` is given or the directory has no git history with source files.

## 2. Fold in earlier retros

If `.loop/retro.md` exists from a previous loop, read it. A proposal that appears two or more times has earned a place: a mechanical one becomes a lint rule, hook or CI step, a judgement call goes to `CODING_STANDARDS.md`. Apply those before planning and mention what was promoted. Single occurrences stay in the file.

## 3a. Existing project: research

Use the Explore subagent so the main context stays clean. Find: the feature area and its entry points, the data layer, anything similar already built (export, download, auth guards), the test runner and how tests are organised, the dev server command, lint and typecheck commands, CI config. Record the commands into `config.commands`.

Run the test suite once. Write the baseline counts into `progress.md`. If something already fails, record it; do not fix it, the loop must not inherit unrelated work.

## 3b. New project: scaffold

Ask for the stack only if `--stack` is missing and the task does not imply one. One question, then proceed. Scaffold with the stack's standard generator, add lint, typecheck, a unit test runner and Playwright. Make the app boot to an empty page. The feature list for a new project is 50 to 200 small items ordered so earlier ones unblock later ones: project boots, schema, auth, each page, each API route, each validation rule, then edge cases.

## 4. Write `.loop/`

```bash
mkdir -p .loop
cp "$SKILL_DIR/assets/verify.sh" "$SKILL_DIR/assets/guard-commit.sh" "$SKILL_DIR/assets/fingerprint.sh" .loop/
chmod +x .loop/verify.sh .loop/guard-commit.sh
```

`$SKILL_DIR` is the base directory announced when this skill loaded.

- `config.json`: start from the preset, apply `--skills`, fill `commands`, `mutation_paths` (where the implementation code lives, excluding tests), `task`, `new_project`, `checkpoint`, and `base`: the `--base` value if given, otherwise `git rev-parse HEAD` now, before the init commit, or git's empty tree `4b825dc642cb6eb9a060e54bf8d69288fbee4904` in a repo with no commits yet. The config is fixed once committed, so `base` has to be in it before then. Every command in `commands` is pre-approved for the unattended sessions, so list only commands the loop needs.
- `init.sh`: installs dependencies if needed, starts the dev server in the background, prints the URL, waits until it answers. Reuse the project's own scripts; a session should be able to run `bash .loop/init.sh` and get a working app.
- `progress.md`: heading with the task, the baseline, and the conventions you learned that are not obvious from the code (where filters live, how auth is checked, naming patterns).
- Add to `.gitignore`: `.loop/tests-passed`, `.stryker-tmp/`, `reports/mutation/`.

## 5. Hooks

Merge `assets/hooks.json` into `.claude/settings.local.json`:

```bash
mkdir -p .claude
[ -f .claude/settings.local.json ] || echo '{}' > .claude/settings.local.json
jq -s '.[0] * .[1]' .claude/settings.local.json "$SKILL_DIR/assets/hooks.json" > .claude/settings.tmp && mv .claude/settings.tmp .claude/settings.local.json
```

If the file already defines `hooks`, `*` would replace the arrays. In that case append the entry from `assets/hooks.json` to the existing `PreToolUse` array instead. Remove any `PostToolUse` entry that deletes `.loop/tests-passed`, left over from older versions of this skill; the fingerprint replaces it.

## 6. Mutation gate (thorough mode)

Only when `gates.mutation` is true. Detect the runner from `package.json` (vitest or jest) and install the matching Stryker plugin:

```bash
npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner
```

Write `stryker.config.json` if none exists:

```json
{
  "testRunner": "vitest",
  "incremental": true,
  "thresholds": { "high": 90, "low": 80, "break": 80 },
  "reporters": ["clear-text", "progress"],
  "ignorePatterns": ["dist", ".loop", "reports"]
}
```

Run `npx stryker run --mutate "<one small existing file>"` once so the first loop session does not pay for setup surprises.

## 7. Standards the review stage reads

The review subagent in `run` judges conventions only against `CODING_STANDARDS.md`. If the repo has none, create a short one from what the research found and from CLAUDE.md: naming, error handling, test placement, what counts as a public interface. Ten specific rules beat a hundred generic ones. If a `GLOSSARY.md` would help (domain terms with two meanings), start it.

For every skill in `config.skills.context`, read it now. If it has a "Review checklist" section, append that list to `CODING_STANDARDS.md` under a heading with the skill's name, skipping rules already there. The reviewer only knows what this file says, so a house rule that never reaches it is a rule nobody checks. Items the checklist implies (a new feature folder, a migration) also become verify steps on the matching items in step 8.

## 8. The item list

Write `.loop/feature_list.json` following `assets/feature-list.example.json`. Three categories, every item with concrete `verify` steps a stranger could follow:

- **functional**: one item per requirement, phrased as observable behaviour.
- **edge**: walk this checklist against every functional item and add what applies: empty or none, boundaries (0, 1, max, off by one), invalid or malformed input, permissions and roles, duplicates and concurrency, time (timezone, DST, past and future), size and performance, encoding and i18n, dependency failure (network, DB, third party), partial state and retries.
- **regression**: the existing behaviour around the code you will touch, plus "existing test suite stays green".

Mark UI-visible items with `"ui": true` so run knows the browser gate applies. All items start `"passes": false, "evidence": null`.

## 9. Checkpoint

Unless `checkpoint` is false, show the user the item list as a compact table and the assumptions you made where requirements were silent. Wait for their answer. A wrong line in this list costs more than any amount of verification later. Edit the list on their feedback, then continue.

## 10. Commit and hand over

The guard runs from the committed copy, so it starts protecting commits once this init commit exists. Run the gate first anyway; it doubles as the proof that the gate works in this repo:

```bash
bash .loop/verify.sh
git add -A
git commit -m "chore(autoloop): init <short task slug>"
```

Tell the user the guard applies to every Claude Code session in this repo while `.loop/` exists, including other harnesses, so a commit there needs `bash .loop/verify.sh` first.

On a re-init over an earlier loop, the guard blocks this commit because `config.json` and the scripts change. Ask the user to run the commit themselves, in their terminal or with `!` in Claude Code; the guard only checks Claude's own Bash tool.

Then tell the user how to start:

```bash
bash "$SKILL_DIR/scripts/loop.sh"
```

with `$SKILL_DIR` written out as the real base directory, because the user's shell does not have that variable. Add that a single iteration can be run by hand with `/bussin-autoloop run`, or `/bussin:bussin-autoloop run` when the skill came from the `bussin` plugin.
