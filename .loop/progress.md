# Steerable autoloop, parts 2 to 4

Design: .planning/sketches/MANIFEST.md, 002-built-so-far (winner B: Areas) and 004-steer-the-loop (winner A: In place; its README holds every decision and the screenshot spike results). Part 1 (the driver applying .loop/inbox changes between sessions) is done: bussin-autoloop/scripts/inbox.sh, inbox.jq, tests/autoloop-inbox.test.sh.

## Conventions
- The mod (mods/bussin-loop-status) draws only what the surface element table has: desktop Box, Text, Button, Input (rows), Select, Markdown, Code, Link, Svg; terminal adds Image, no Svg; mobile has no Input or Select. Grab element constructors with `$.ui.resolve(e)` and check `'Input' in elements` before using optional ones, as register.tsx already does for Input.
- Load the `plugin-authoring` skill for the mod API; its types file lists every element's props. Text takes no key; find Text in tests by its words.
- A `file:` Link draws as plain text on desktop: open files with a Button running `open` through `$.process.run`.
- Screenshots on desktop: a plain Svg (never isInteractive) wrapping a JPEG data URI under 131072 characters; terminal Image needs real PNG bytes.
- `$.fs` has read, write, list and stat but no delete; remove a file with `$.process.run(['rm', '--', path])`.
- Change files for the driver go to <loop>/.loop/inbox/<epoch ms>-<random>.json in the exact shape bussin-autoloop/scripts/inbox.jq accepts (ops add, edit, skip, first, review).
- ~/.claude/skills/bussin-autoloop is a symlink to the main checkout (~/dev/skills), not this worktree: edits here never touch the scripts other loops on this Mac are running.
- Shell tests are plain bash in tests/*.test.sh; mod tests run with `claude plugin test mods/bussin-loop-status`.

## Baseline
Fast gate before init (commands.test): green. Final suites (commands.final): agents 45s, loop 150s, notify 51s, parallel 146s, all green. Mod tests: 43 pass.

## F1 · worker 1 · 2026-11-08
Did: init.md step 8 describes area, plain, done_when, optional kind and metrics, each with an example. feature-list.example.json has the three fields on every item plus an eval item (F3, metrics) and a design item (F4). SKILL.md artifacts table has inbox/ and evidence/ rows and a short paragraph on the item fields.
Learned: a parallel worker's environment leaks LOOP_WORKERS=2 into tests that run loop.sh. tests/autoloop-loop, autoloop-agents and autoloop-notify (the final suites) also run loop.sh without pinning LOOP_WORKERS, so FINAL may hit the same failure when run under a parallel driver.
Lesson: [tests] tests/autoloop-inbox.test.sh e2e failed in the worker gate because it inherited LOOP_WORKERS=2 from the driver → tests that start loop.sh must pin or unset every LOOP_* setting they depend on (fixed here with LOOP_WORKERS=1).
Lesson: [bussin-autoloop docs] review flagged 'the pane groups by area' as a claim nothing backs yet → document only behaviour that exists or that the item's spec requires.
