---
name: bussin-lean
description: Keep code lean while writing it, then run a mandatory cleanup pass on the diff before calling the work done - no speculative abstractions, options or dependencies, no leftovers from earlier implementations (dead code, unused exports, debug logs), no wasteful data access (N+1 queries, unbounded caches). Use whenever writing, changing or refactoring code, and when asked to simplify, remove leftovers or check for over-engineering.
argument-hint: "[path, file or commit range to clean up]"
---

# Lean code

Two halves: rules to follow while writing, and a cleanup pass after. The pass is mandatory. Code work is not done until it has run on the diff and come back clean.

## While writing

Stop at the first rung that holds:

1. **Does it need to exist?** A need nobody stated is not a need. Skip it and mention it in one line of the report.
2. **The language's standard library does it.**
3. **The platform or framework does it:** a native input, CSS rather than JavaScript, a database constraint rather than application code.
4. **A dependency the project already has does it.**
5. **Only then:** the least new code that works.

Rules that keep it there:

- No abstraction without a second real use: no interface with one implementation, no factory with one product, no config for a value that never changes, no wrapper that only forwards.
- No parameters, options, flags, generic type parameters or extension points that no caller uses today.
- Fewer files. Inline a helper used once unless its name says something the call site cannot.
- Code this change replaces is deleted, not kept alongside or behind a flag "just in case".
- Allocation and data access:
  - Build a result once rather than copying inside a loop; a spread inside `reduce` is quadratic.
  - Select the columns and rows you need, paginate, and aggregate in the database instead of loading a table into memory.
  - Batch lookups instead of querying once per item.
  - Every cache, map or array that grows with traffic has a bound or an eviction rule.
  - Stream large files and responses instead of buffering them whole.
  - Compute once what a hot path or render would otherwise recompute, but add memoisation only where the cost is real.
  - Immutable updates at boundaries are fine; inside a hot loop, build a local result and return it.

Lean never means removing input validation at trust boundaries, error handling that prevents data loss, security checks or accessibility. Those stay.

## The cleanup pass

Run it after the code compiles and the tests pass, on everything the change touched: `git diff <base>` plus untracked files from `git status`, where `<base>` is the commit the work started from. Fix what you find; a finding you only report is still a finding.

**Leftovers**
- Code, files, exports, routes, flags, environment variables, styles, translations and dependencies that this change left unused. Search the codebase for every old name and contract.
- Earlier implementation paths kept around, commented-out code, debug logging, stray `console.log` or `print`, TODO narration, scratch files.
- Tests, mocks and fixtures for behaviour that no longer exists.

**Over-engineering**
- Each new abstraction has two real callers today, or it is inlined.
- Each new parameter or option is passed by a caller today, or it is removed.
- Each new dependency replaces more code than it adds and is not covered by the standard library or an installed package.
- No pass-through layers, no duplicate types for the same shape, no `try`/`catch` that rethrows unchanged.

**Structure**
- Each file has one responsibility and a name that says what it does. Functions stay small (about 50 lines) and do one thing; nesting stays at four levels or fewer.
- New code follows the project's layout, and `bussin-ts-architecture` when the project uses it.

**Allocation and data access**
- The rules above, checked on hot paths, loops and every new query.

**Tools**
- Run what the project already has for unused code and types: the type-checker (with unused locals and parameters on, if configured), the linter, and knip, ts-prune or depcheck if installed. Do not add a tool only for this pass.
- If the ponytail plugin is installed, also run its `ponytail-review` on the diff and treat its findings the same way.

After fixing, run the tests again.

## Report

End the work with what the pass removed or simplified, and anything deliberately kept with a one-line reason. When it found nothing, say "Cleanup pass: clean".

## Ponytail

[Ponytail](https://github.com/DietrichGebert/ponytail) (MIT) is a Claude Code plugin that applies the same discipline to every reply and reviews diffs for over-engineering. Install it next to this skill:

```bash
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail
```

Without it, this skill works on its own.

## Review checklist

Copy these into `CODING_STANDARDS.md` when bussin-autoloop loads this skill:

- Nothing in the diff is unused: no dead code, exports, files, flags, dependencies, debug logging or commented-out code.
- Replaced code is deleted, not kept beside the new path.
- Every abstraction, parameter and dependency added has a real use today.
- No pass-through layers or duplicate types.
- No copying inside loops, N+1 queries, whole-table loads or unbounded caches.
- Files have one responsibility; functions are small and nesting is shallow.
