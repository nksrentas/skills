# Autoloop Dashboard

A user-wide Copilot Desktop canvas for existing `bussin-autoloop` runs. It does
not start agents, execute repository scripts, or change the loop runner.

Open canvas type `autoloop-dashboard` with an optional absolute `projectPath`.
Without a repository session, use **Add source** in the panel. Only selected
directories and their registered Git worktrees are examined; there is no disk
scan. Selected roots persist in
`$COPILOT_HOME/extensions/bussin-autoloop-dashboard/artifacts/roots.json`
(`COPILOT_HOME` defaults to `~/.copilot`).

The view refreshes every three seconds while visible. Pause **Live** to inspect
a stable snapshot. Logs and session history are bounded to the latest 2 MB per
file; truncated usage totals are explicitly labeled. JSON contracts above 2 MB
are rejected with a visible error. At most 100 loop checkouts are displayed.
ETA is an estimate from completed-item sessions and reported worker count.
Copilot tokens and unreported dollar cost remain **Unknown**, not zero.

**Stop gracefully** creates `.loop/stop`; current sessions finish normally.
It never sends a signal or kills a process. **Rename** changes only `.loop/name`.
Sources are directories you trust; file names and rendered text are treated as
data, never executed. Driver detection checks the reported PID's command for
`loop.sh`; unknown/stale detection is explicitly distinguished from exited.
Machine slot usage is the last driver snapshot, not an independent census.

Each panel serves its assets on an ephemeral `127.0.0.1` port. API endpoints
require an unguessable per-panel token and reject mismatched Host, Origin and
cross-site fetch metadata. No external dependencies, fonts, telemetry or network
services are used by the dashboard.

Validation: `node --test dashboard.test.mjs`.

The canvas entry point and loopback-server lifecycle were adapted from the
GitHub-maintained
[`git-worktree-explorer`](https://github.com/github/awesome-copilot/tree/main/extensions/git-worktree-explorer)
pre-generated canvas extension. Its MIT attribution is retained in `LICENSE`.
