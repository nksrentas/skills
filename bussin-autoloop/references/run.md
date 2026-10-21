# bussin-autoloop run

One iteration. You start with no memory of earlier sessions; the artifacts are your memory. Finish one item and stop, even if the next one looks trivial. Stopping is what keeps the next session's picture accurate.

## The item: `run --item <id> --sequential`

The sequential driver picks the item and starts the session as `run --item <id> --sequential`. Work on exactly that item and follow the steps below unchanged, including marking it in `feature_list.json` and `progress.md` in step 7; there is no result file. The driver skips an item that has failed `LOOP_ITEM_ATTEMPTS` sessions (default 3) or that `progress.md` names on a line of its own as `Blocked: <id>`, so write that line when only a human can unblock the item.

## Worker mode: `run --item <id>`

The parallel driver starts sessions as `run --item <id>` without `--sequential`, each in its own git worktree on branch `loop/<loop name>/<id>`, with `LOOP_NAME` (the loop's name, from its checkout directory), `LOOP_WORKER` (the worker's number) and `LOOP_MAIN_DIR` (the main checkout) in the environment. Follow the steps below with these differences:

- Work on exactly that item, even if earlier items are still failing; the driver already checked its dependencies.
- `bash .loop/init.sh` gets `LOOP_NAME` and `LOOP_WORKER`, so it can name its test database and copy untracked files such as `.env` from `LOOP_MAIN_DIR`; it picks a free port itself and prints the URL.
- Do not edit `.loop/feature_list.json` or `.loop/progress.md`; other workers run at the same time, and the driver is their only writer.
- Never run `git stash`. Every worktree of a repo shares one stash, so a parallel worker could pop your entry or you its. To set work aside, make a WIP commit on your own branch; the driver warns when a worker leaves a stash entry behind.
- In step 7, commit the implementation as usual. Then, in place of marking the item and writing progress, write `.loop/results/<id>.json` and commit it as `chore(loop): result <id>`:

```json
{ "id": "F7", "passes": true, "evidence": { "commit": "<sha>", "ran": "npm test" }, "notes": "Did: ...\nLearned: ..." }
```

  When the item cannot pass, write the same file with `"passes": false` and the reason in `notes`. The driver merges a passing branch into the main branch, runs the gate again on the merged result, then marks the item and copies `notes` into `progress.md`.

## 1. Orient (under two minutes)

Read `.loop/config.json`, `.loop/progress.md`, `.loop/feature_list.json` and `git log --oneline -20`. Run `bash .loop/init.sh`. Do a sixty-second smoke check of the app (the home page loads, login works if there is one). If the previous session left it broken, fixing that is this session's item: record it in `progress.md` and proceed as if it were an item.

## 2. Pick one item

The item the driver named with `--item`. A plain `run`, started by hand, takes the first item with `passes:false` in list order that no `Blocked: <id>` line in `progress.md` names. Read every skill in `config.skills.context` before touching code. If an item depends on an unlisted decision, make the decision, write it in `progress.md` under "Assumptions", and continue; do not ask.

## 3. Implement

In `standard` and `thorough` mode, work test-first; in `fast` mode, write the code and then the tests. The item's `verify` steps are the seam to test through; nobody needs to be asked.

- Write one failing test for the next behaviour, run it and watch it fail for the reason you expect, then write the least code that passes it. Repeat per behaviour; do not write all tests up front.
- Test through the public interface; a test that reads a private field or queries the DB directly breaks on refactor without catching a bug.
- Expected values come from an independent source (the spec, a hand calculation, a fixture), never from re-running the code's own logic.
- Refactor only with the tests green, and run them again after.

Then invoke any skills in `config.skills.implement`.

Edge items get at least one example test each. Parsing, escaping, money, dates and anything with an input grammar also get a property test with `fast-check`; examples alone miss the input you did not think of.

## 4. Verify gate

```bash
bash .loop/verify.sh
```

Under Copilot, whose allowlist names the loop scripts by path, run them as `.loop/verify.sh` and `.loop/init.sh` without `bash`. It runs the test command, then Stryker on the changed files when `gates.mutation` is on, and creates `.loop/tests-passed` only if everything held. If mutants survive, add the tests that kill them. Do not touch thresholds, do not exclude files. After three attempts on the same item, write what survived into `progress.md`, leave the item `false`, and stop; the driver counts the failed session and moves on once the item runs out of attempts.

## 5. Review

In `fast` mode, skip the subagent but still run the `bussin-lean` cleanup pass yourself on the diff before the gate. Otherwise spawn one review subagent with read-only tools (Read, Glob, Grep). An agent without subagents does the review as a separate pass: re-read the item and the diff cold, as if someone else wrote it, before changing any code. Give it the item's `description` and `verify` steps as the spec, the output of `git diff <config.base> -- . ':(exclude).loop'`, and `CODING_STANDARDS.md`. It writes nothing and returns two lists:

- **Spec**: a requirement in the item that is missing, only looks implemented (dead code path, hard-coded value, test that never reaches it), or scope beyond the item.
- **Standards**: each rule in `CODING_STANDARDS.md` the diff breaks, with file and line.
- **Lean**: the `bussin-lean` cleanup pass applied to the diff. Leftovers from earlier implementations (dead code, unused exports, files, flags or dependencies, debug logging, commented-out code), over-engineering (an abstraction, parameter or dependency with no real use today, pass-through layers, duplicate types), structure problems, and wasteful allocation or data access. Tell the subagent to load `bussin-lean` for the full checklist when it is installed.

Any Spec or Lean finding means the item stays `false`: fix it, re-run the gate, review again with a fresh subagent. Fix Standards findings when cheap and log the rest in `progress.md`.

In `thorough` mode, spawn a second read-only subagent on the tests this item added or changed. It flags tests that are tautological (the expected value is computed by the code under test), coupled to implementation (private fields, mocks of the unit itself, direct DB reads where the public interface would do), or duplicate another test without covering a new case. Rewrite or delete what it flags, then re-run the gate.

Then spawn a subagent for each skill in `config.skills.review`, with the same spec and diff.

## 6. Browser verification

For items with `"ui": true` and `gates.browser` on, follow the item's `verify` steps in a real browser with whatever browser tool is available (Playwright MCP, Claude in Chrome, the built-in browser). Unit tests and curl missed the bugs this step catches. If no browser tool exists, record `"browser": "unavailable"` in the evidence and leave a UI item `false`.

## 7. Mark and commit

Set `passes: true` and `evidence` on that one item only:

```json
"evidence": { "commit": "<sha>", "ran": "npm test, stryker 84%", "browser": "exported paid-only CSV, 12 rows" }
```

Commit in two steps. First commit the implementation with a message that names the item id. Then set `passes` and `evidence` with that commit's sha, append to `progress.md` (step 8), and commit those as `chore(loop): mark <item id>`.

The commit guard (a git `pre-commit` hook in driver sessions, plus a PreToolUse hook in Claude Code) allows a commit only when `.loop/tests-passed` holds the fingerprint of the current code, so any code change after the gate, by any tool, means running the gate again. `feature_list.json`, `progress.md` and `retro.md` are outside the fingerprint, so the second commit needs no new gate. The guard also refuses a commit that rewords, adds or removes items, or that changes `.loop/config.json` or the loop scripts. Never commit with `--no-verify` or another way around the hook: the driver audits every commit, re-runs the gate, and stops the whole loop when the guard was skipped. Never use `git stash` either; set work aside with a WIP commit on the session's branch.

## 8. Progress and retro

Append to `.loop/progress.md`:

```
## Session <n> · <item id> · <date>
Did: ...
Learned: anything about the codebase the next session would otherwise rediscover
Next: <item id>
```

In `thorough` mode, write a short retro: what in this session cost the most time or nearly went wrong, and one concrete change to the environment that would have prevented it (a lint rule, a hook, a missing command in `config.commands`, a line in `CODING_STANDARDS.md`). Append it to `.loop/retro.md` under a dated heading, then invoke any skills in `config.skills.end`. Never apply the proposals here; the loop is not the place to change its own rules.

## 9. Stop

Run `bash .loop/init.sh stop` (`.loop/init.sh stop` under Copilot) so no dev server outlives the session, then end it. The driver starts a fresh one.
