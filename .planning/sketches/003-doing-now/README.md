---
sketch: 003
name: doing-now
question: "How do you see what the loop is doing right now, in plain words, without raw logs?"
winner: null
tags: [loop-status, pane, live, plain-language]
---

# Sketch 003: What it's doing now

## Design Question
Today the pane shows step names (Orient, Gate 3/6) and raw log lines (Bash, Edit with file paths). How should the work in progress read so someone who doesn't follow the code knows what is happening and whether it is going well?

## How to View
    python3 -m http.server 8766 --directory .planning/sketches

then open http://localhost:8766/003-doing-now/

## Variants
- **A: Phase stepper.** The six steps every item goes through, in plain words (Reading the plan → Writing the code → Running the tests → Reviewing its own work → Checking it in a browser → Saving the work), with a "Right now" sentence and a time bar against how long items usually take.
- **B: Narration.** One big sentence per running item saying what it is doing, then a short "just happened" list.
- **C: Timeline.** A delivery-tracker feed of the day, newest first, with what is happening now on top.

In every variant raw log lines and ids sit behind "technical details". A failed try is explained in one sentence ("the 6th wrong password still went through"), not as a stack trace.

## What to Look For
- After reading it, could you tell someone what the loop is doing?
- Is the time bar ("usually ~15 min") reassuring or noise?
- Which variant best answers "what happened while I was away"?

## Data this needs
- Phase names map straight from today's steps: Orient, Implement, Gate, Review, Browser, Commit.
- The "Right now" sentence (A, B) needs the session to write a plain `Now:` line to its log at each step. run.md would ask for it; the mod only reads it.
- "Usually ~N min" is the median session time from usage.jsonl.
- The failure sentence needs the session to write one plain `Why:` line when the gate fails.
