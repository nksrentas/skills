---
sketch: 001
name: telegram-message-format
question: "Which Telegram message style is easiest to follow at a glance?"
winner: "E2"
tags: [telegram, notifications, copy]
---

# Sketch 001: Telegram message format

## Design Question
Which format lets someone follow a long autoloop run from Telegram with the least effort: at a glance, is it moving, and does it need me?

## How to View
open .planning/sketches/001-telegram-message-format/index.html

## Variants
- **A: Executive headline**: icon + one bold verdict + one italic line. Fits a lock screen whole.
- **B: Status card**: bold project, 10-cell progress bar, labelled Now / Done / Why / Needs you lines.
- **C: Headline + fold**: A's headline, with facts and last output in a tap-to-open `<blockquote expandable>`.
- **D: Quiet mode**: successes are one italic line; only problems get bold, an icon and a reason.
- **E: Briefing list (synthesis)**: no emojis; bold project and progress, the event in one italic line, then Now / Next / Pending / Finish lines.
- **F: Briefing line (synthesis)**: E's facts on one italic line under the headline; problems add a reason.
- **E1: Quote block**: E with the status lines in a quote (accent bar and tint, the one colour bots get without emojis).
- **E2: Quote + code**: E1 plus ids, counts and times in inline code, which Telegram tints.
- **E3: Quote + code + bar**: E2 plus a ten-cell ▰▱ text progress bar.

## Feedback so far
- Round 1 (A-D): no emojis; every message should say what runs now, what runs next, what is pending and when the loop should finish.
- Round 2 (E, F): E preferred; make it better, with colour if Telegram allows. Bots cannot colour text; the quote bar/tint and inline code tint are the only colour available.

## What to Look For
- Click each message: does the lock-screen preview alone tell you what you need?
- Replay the run: which variant makes the failing and stuck messages stand out from progress?
- "Show what the bot sends": every variant uses only Telegram HTML (`<b>`, `<i>`, `<code>`, `<blockquote expandable>`), which is safe to send from LLM text after escaping.

## Implementation notes
- Send with `parse_mode=HTML`; MarkdownV2 rejects any unescaped `_*[]()~\`>#+-=|{}.!`, which LLM and test output contain.
- Escape `&`, `<`, `>` in all facts, let only the allowed tags through from the summary, and resend as plain text if Telegram answers 400.
