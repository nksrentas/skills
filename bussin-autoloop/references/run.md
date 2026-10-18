# bussin-autoloop run

One iteration. You start with no memory of earlier sessions; the artifacts are your memory. Finish one item and stop, even if the next one looks trivial. Stopping is what keeps the next session's picture accurate.

## 1. Orient (under two minutes)

Read `.loop/config.json`, `.loop/progress.md`, `.loop/feature_list.json` and `git log --oneline -20`. Run `bash .loop/init.sh`. Do a sixty-second smoke check of the app (the home page loads, login works if there is one). If the previous session left it broken, fixing that is this session's item: record it in `progress.md` and proceed as if it were an item.

## 2. Pick one item

The first item with `passes:false` in list order, unless `progress.md` names a blocked item to skip. Read every skill in `config.skills.context` before touching code. If an item depends on an unlisted decision, make the decision, write it in `progress.md` under "Assumptions", and continue; do not ask.

## 3. Implement

If `tdd` is in `config.skills.implement`, invoke it. The item's `verify` steps are the confirmed seam; it does not need to ask anyone. Inline fallback when the skill is missing, or in fast mode after writing the code:

- Write the failing test first and watch it fail.
- Test through the public interface; a test that reads a private field or queries the DB directly breaks on refactor without catching a bug.
- Expected values come from an independent source (the spec, a hand calculation, a fixture), never from re-running the code's own logic.

Edge items get at least one example test each. Parsing, escaping, money, dates and anything with an input grammar also get a property test with `fast-check`; examples alone miss the input you did not think of.

## 4. Verify gate

```bash
bash .loop/verify.sh
```

It runs the test command, then Stryker on the changed files when `gates.mutation` is on, and creates `.loop/tests-passed` only if everything held. If mutants survive, add the tests that kill them. Do not touch thresholds, do not exclude files. After three attempts on the same item, write what survived into `progress.md`, leave the item `false`, and stop; a human reads it next.

## 5. Review

Spawn a subagent for each skill in `config.skills.review`, with the item text and `verify` steps as its spec and the diff since `config.base`. Pocock's `code-review` reports on a Standards axis and a Spec axis. Any Spec finding (missing requirement, scope creep, requirement that looks implemented but is not) means the item stays `false`: fix, re-run the gate, re-review. Standards findings are fixed when cheap and otherwise logged.

`test-audit` runs on the new tests; delete what it flags as tautological or implementation-coupled, then re-run the gate.

Inline fallback when `code-review` is missing: one subagent, read-only tools, prompt it with the item, the diff, and `CODING_STANDARDS.md`, and ask for two lists: requirements not met and conventions broken. It writes nothing.

## 6. Browser verification

For items with `"ui": true` and `gates.browser` on, follow the item's `verify` steps in a real browser with whatever browser tool is available (Playwright MCP, Claude in Chrome, the built-in browser). Unit tests and curl missed the bugs this step catches. If no browser tool exists, record `"browser": "unavailable"` in the evidence and leave a UI item `false`.

## 7. Mark and commit

Set `passes: true` and `evidence` on that one item only:

```json
"evidence": { "commit": "<sha>", "ran": "npm test, stryker 84%", "browser": "exported paid-only CSV, 12 rows" }
```

Commit with a message that names the item id. The commit guard requires `.loop/tests-passed`, which any edit after the gate deletes, so run the gate last.

## 8. Progress and retro

Append to `.loop/progress.md`:

```
## Session <n> · <item id> · <date>
Did: ...
Learned: anything about the codebase the next session would otherwise rediscover
Next: <item id>
```

If `retro` is in `config.skills.end`, invoke it and append its proposals to `.loop/retro.md` under a dated heading. Never apply them here; the loop is not the place to change its own rules.

## 9. Stop

End the session. The driver starts a fresh one.
