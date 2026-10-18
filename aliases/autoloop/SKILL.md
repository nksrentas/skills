---
name: autoloop
description: Short alias for bussin-autoloop. Type /autoloop instead of /bussin-autoloop; your arguments pass through unchanged.
argument-hint: "init <task> [--mode fast|standard|thorough] [--skills a,b,review:c] [--no-checkpoint] [--new] [--stack <text>] [--base <ref>] | run | status"
disable-model-invocation: true
---

Invoke the `bussin-autoloop` skill with the Skill tool (`bussin:bussin-autoloop` when the skills came from the bussin plugin), passing these arguments unchanged: $ARGUMENTS

If `bussin-autoloop` is not installed, say so and stop.
