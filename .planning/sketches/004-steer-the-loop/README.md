---
sketch: 004
name: steer-the-loop
question: "How do you read, edit and add tasks in a running loop, see evaluation metrics and approve screenshots, using only what the mod can draw?"
winner: "A"
tags: [loop-status, pane, editing, evals, screenshots, mod-elements]
---

# Sketch 004: Steer the loop

## Design Question
Builds on 002 B (Areas). While a loop runs you want to read what a task not yet started will do, then change it, reorder it, skip it or add new ones. Evaluation tasks should return metrics (precision@k, recall@k…) that you can read in the pane, and design tasks should show screenshots you approve or send back. Where do those changes happen?

## How to View
    python3 -m http.server 8766 --directory .planning/sketches

then open http://localhost:8766/004-steer-the-loop/. "Show mod elements" outlines every element with the mod element that would draw it.

## Variants
- **A: In place.** Click a task in the Areas list and it opens right there with What it will do, Done when, and Edit / Do it next / Skip, the metrics table, or screenshots with Looks right / Needs changes.
- **B: Task page.** The same list, but a click swaps the pane to one task with a Back button.
- **C: Tell it in words.** One text box: Claude turns a plain request into task changes, and you approve them.

In all three, edits go to a "Your changes" box. The loop applies them before it starts its next task, so it never interrupts a running session.

## Mod fidelity (desktop surface)
Only elements the desktop table has: Box (round border, borderColor, backgroundColor), Text (size title/heading/body/caption, weight, dim, mono, theme colours), Button (secondary/primary/plain), Input (`rows` for multi-line), Select, Markdown (the metrics table), Code (the JSON a task returns), Link, Svg. Progress bars are text (█░) as today.
- **Screenshots:** desktop has no `Image`. A thumbnail is an `Svg` wrapping the PNG as a data URI (`<image href="data:image/png;base64,…">`). The SVG source is capped at 131,072 characters, so the mod shrinks each screenshot first (`sips -Z 480 -s format jpeg -s formatOptions 70`). "Open full size" is a `Button` that runs `open <file>` (Preview). The terminal draws real pixels with `Image` (kitty, Ghostty, iTerm2 3.5+) and shows the alt text elsewhere.

### Spike results (2026-11-07, Claude Code 2.1.317)
Throwaway mod `svg-image-spike` in this session's dev-mods folder.
- ✓ Size fits. A busy 640×715 UI screenshot shrunk to 480px JPEG q70 is 46,172 base64 characters, about a third of the 131,072 cap. A 640px JPEG (84K) fits too.
- ✓ The engine accepts the tree. `claude plugin test` mounts it on desktop (4 Svgs with real-size data URIs) and on terminal (an `Image` with a PNG) without refusal.
- ✗ **A `file:` Link does not work on desktop.** The engine draws it as plain text ("its href is not https: (or http://localhost)"). Use a Button running `open` instead.
- ✓ The terminal `Image` only takes real PNG bytes (`source.png` is checked for the PNG signature), so terminal thumbnails are PNG and desktop thumbnails can be JPEG.
- ✓ **The desktop paints the screenshot** in a plain `Svg` (checked by eye in the desktop app): a JPEG with `href` (case 2) and a PNG with `xlink:href` (case 3) both show.
- ✗ The same SVG with `isInteractive` (sandboxed frame, case 4) shows nothing, so thumbnails use a plain `Svg` with the press on an enclosing Box/Button.
- ✗ Markdown does not draw a `file:` image (case 5), so the Svg route is the only one on desktop.
- **Decision:** desktop thumbnails are a plain `Svg` wrapping a 480px JPEG (`<image href="data:image/jpeg;base64,…">`), the terminal uses `Image` with a PNG, and a "Open full size" Button runs `open`.
- **Mobile** has no Input or Select, so the edit and add forms are desktop and terminal only.

## What the loop must change to support this
- **Editing a running loop is blocked today.** After each session the driver compares the task list with the start of that session (`audit_session` in scripts/commit-hook.sh). Any added, removed or reworded task stops the loop and blames the session. Fix: the pane writes requests to `.loop/inbox/*.json` (uncommitted). Between sessions the driver applies them to tasks not running, commits `chore(loop): human edits`, and moves its audit baseline to that commit.
- **Plain fields:** `area`, `plain`, `will[]`, `doneWhen` per task (see 002). An edit changes `plain`/`doneWhen`, and a short Claude call (`$.model` in the mod, or the driver) rewrites `description` and `verify` from them.
- **Evaluation tasks:** `kind: "eval"` with `returns` (a JSON shape) and an optional `command`. The session writes `.loop/outputs/<id>.json`; the pane reads it, with the previous run for the change column. A target in `doneWhen` can be made a real pass/fail check.
- **Design tasks:** `kind: "design"`. The browser step saves PNGs to `.loop/evidence/<id>/`, and the task waits for your review before the next design task in its area builds on it. "Needs changes" adds a fix task through the inbox.

## What to Look For
- Is it obvious which tasks you can change (not started) and which you can't (running, done)?
- Does the metrics table answer "did it get better?" without opening the JSON?
- Is approving screenshots in the pane enough, or do you want them bigger (B)?
