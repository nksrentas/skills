# Coding standards

## Repository

- Shell tests live in `tests/<name>.test.sh`, start with `#!/usr/bin/env bash` and `set -euo pipefail`, print `ok   <check>` or `FAIL <check>` per check, and exit non-zero when any check failed.
- Shell must run on macOS bash 3.2 and Linux bash 5: no `mapfile`/`readarray`, associative arrays, `${var,,}`, `&>>`, `|&`, or GNU-only flags (`sed -i` without a suffix, `grep -P`, `readlink -f`).
- Tests find the repo from their own location (`$(dirname "$0")/..`), never from the caller's working directory.
- Tools available in tests are bash, git, jq and POSIX utilities. No new runtime dependencies, no npm/pip installs.
- No comments in shell or YAML unless a tool requires them.
- File names are kebab-case and lowercase; `SKILL.md` is the only exception under `bussin-*/` and `tests/`.
- Workflows need no secrets and pin every action to a full version tag (`actions/checkout@v4.2.2`, not `@v4` or `@main`).
- Skill behaviour is fixed: a change inside `bussin-*/` is allowed only when the structure test forces it, and the reason goes in `.loop/progress.md`.
- Eval cases live in `evals/<case-name>/` with `prompt.md` (frontmatter: `max_turns` at least 15) and `graders/*.md`; case names are kebab-case.

## bussin-lean

- Nothing in the diff is unused: no dead code, exports, files, flags, dependencies, debug logging or commented-out code.
- Replaced code is deleted, not kept beside the new path.
- Every abstraction, parameter and dependency added has a real use today.
- No pass-through layers or duplicate types.
- No copying inside loops, N+1 queries, whole-table loads or unbounded caches.
- Files have one responsibility; functions are small and nesting is shallow.
