# Sketch Manifest

## Design Direction
Telegram notifications from bussin-autoloop read like a vice president's briefing: calm, high level, readable in two seconds on a lock screen. Bold carries the verdict, italics carry the context, detail stays out of the way. The one thing a glance must answer: is it moving, and does it need me?

## Reference Points
- A Telegram chat with the loop's bot, read on a phone lock screen and in the chat
- Telegram Bot API HTML formatting: `<b>`, `<i>`, `<code>`, `<blockquote expandable>`

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | telegram-message-format | Which message style is easiest to follow at a glance? | E2: Quote + code | telegram, notifications, copy |
| 002 | built-so-far | How do you see what the loop has built so far, in product terms, at a glance? | B: Areas | loop-status, pane, progress, plain-language |
| 003 | doing-now | How do you see what the loop is doing right now, in plain words, without raw logs? | — | loop-status, pane, live, plain-language |
| 004 | steer-the-loop | How do you read, edit and add tasks in a running loop, see eval metrics and approve screenshots, with only mod elements? | A: In place (spike: screenshots draw in a plain Svg) | loop-status, pane, editing, evals, screenshots |

## Design Direction: loop status pane (002–003)
The autoloop status pane reads like a project tracker for the product, not a build log. You see what already works in your app, grouped by feature area (Accounts, Dark mode, Going live), what is being built and what comes next. No item ids or tool names in the main view. The current work shows as plain phases ("Running the tests", "Checking it in a browser"), and raw logs sit behind "technical details". One verdict line answers "is it on track, does it need me".

## Reference Points (002–003)
- Linear / Trello boards
- The current Claude Code status pane (mods/bussin-loop-status) and its terminal/desktop element set: Box, Text, Button, borders, theme colours
