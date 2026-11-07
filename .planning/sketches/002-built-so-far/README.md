---
sketch: 002
name: built-so-far
question: "How do you see what the loop has built so far, in product terms, at a glance?"
winner: "B"
tags: [loop-status, pane, progress, plain-language]
---

# Sketch 002: What's built so far

## Design Question
The status pane shows item ids (F12, E3, R0), technical descriptions and tool names, which say nothing to the person who asked for the work. Which layout shows "what works in my app now, and what's still coming" so it is clear at a glance?

## How to View
Serve the sketches folder (the shared CSS and JS don't load from file://):

    python3 -m http.server 8766 --directory .planning/sketches

then open http://localhost:8766/002-built-so-far/

## Variants
- **A: Board.** Works now / Being built / Coming up columns with one plain sentence per card, filters by area, and the spec on click.
- **B: Areas.** One row per feature area (Accounts, Dark mode, Going live…) with its own progress bar. Open a row to see its items.
- **C: What works today.** A release-notes checklist of what the app can already do, grouped by area, then "being built right now" and "next up".

Every variant shares the same header: the loop's plain goal plus one verdict line (On track / Needs you / Finished), with the single action that fits. Use "Loop state" to switch between the three cases.

## What to Look For
- Can you tell in two seconds how far the product is, without reading any ID?
- Is the area grouping how you think about the work?
- Does "Something is stuck" stand out enough, and is it clear the loop carries on?

## Data this needs (not in feature_list.json today)
- `area` per item: a short product area name, written by `init`.
- `plain` per item: one sentence that says what someone can now do, written by `init` next to `description`.
- Optional: `areas[]` with a one-line blurb each, at the top of feature_list.json.
- Fallback for existing loops: the heading before the first ":" in `description` ("Sign-up is live") as the sentence, and `category` as the area.
