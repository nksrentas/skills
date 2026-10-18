import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ItemState, LoopSnapshot, LoopView } from '../types'
import {
  baseName,
  commonDirFromGitFile,
  compactLine,
  compute,
  formatClock,
  formatCost,
  formatDuration,
  formatTokens,
  orderLoops,
  parentDir,
  progressBar,
  shortName,
  statusLine,
} from './snapshot'

const REFRESH_MS = 5000

export const PANE = 'autoloop-status'

export const loopsAtom = atom({ plugin: 'bussin-loop-status', key: 'loops' } as const, [] as LoopView[])
export const selectedAtom = atom({ plugin: 'bussin-loop-status', key: 'selected' } as const, null as string | null)

const STATE_MARK: Record<ItemState, string> = { done: '✓', running: '▶', waiting: '…', failing: '✗', ready: '·' }
const STATE_COLOR: Record<ItemState, string> = { done: 'success', running: 'claude', waiting: 'subtle', failing: 'error', ready: 'text' }
const LOOP_COLOR: Record<LoopSnapshot['loopState'], string> = { running: 'claude', finished: 'success', stopped: 'warning', idle: 'subtle' }

function costSummary(snapshot: LoopSnapshot) {
  const priced = snapshot.sessions - snapshot.unpricedSessions
  if (snapshot.sessions === 0) return 'no sessions recorded yet'
  if (priced === 0) return `unknown for ${snapshot.sessions} sessions recovered from transcripts`
  const perSession = formatCost(snapshot.costUsd / priced)
  const base = `${formatCost(snapshot.costUsd)} over ${priced} sessions · ${perSession} per session`
  return snapshot.unpricedSessions > 0 ? `${base} · ${snapshot.unpricedSessions} older sessions have no cost data` : base
}

function primaryLoop(loops: LoopView[], selected: string | null) {
  return loops.find(loop => loop.path === selected) ?? loops[0]
}

function runningLoops(loops: LoopView[]) {
  return loops.filter(loop => loop.snapshot.loopState === 'running')
}

function statusText(loops: LoopView[]) {
  const primary = loops[0]
  if (primary === undefined) return undefined
  if (loops.length === 1) return statusLine(primary.snapshot)
  const running = runningLoops(loops)
  if (running.length === 0) return `${primary.name}: ${statusLine(primary.snapshot)}`
  return `autoloop ${running.map(loop => compactLine(loop.name, loop.snapshot)).join(' │ ')}`
}

async function readOptional($: EngineInterface, path: string) {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

async function gitCommonDir($: EngineInterface, root: string) {
  try {
    const git = await $.fs.stat(`${root}/.git`)
    if (git.kind === 'dir') return `${root}/.git`
    const pointer = await $.fs.read(`${root}/.git`)
    return typeof pointer === 'string' ? commonDirFromGitFile(pointer) : undefined
  } catch {
    return undefined
  }
}

async function loopDirs($: EngineInterface) {
  const root = await $.session.root()
  const dirs = [root]
  const common = await gitCommonDir($, root)
  const repoName = common !== undefined && common.endsWith('/.git') ? baseName(parentDir(common)) : baseName(root)
  if (common !== undefined) {
    if (common.endsWith('/.git')) dirs.push(parentDir(common))
    try {
      for (const entry of await $.fs.list(`${common}/worktrees`)) {
        const gitdir = await readOptional($, `${common}/worktrees/${entry.name}/gitdir`)
        if (typeof gitdir === 'string' && gitdir.trim() !== '') dirs.push(parentDir(gitdir.trim()))
      }
    } catch {
      return { dirs: [...new Set(dirs)], repoName }
    }
  }
  return { dirs: [...new Set(dirs)], repoName }
}

async function loadLoop($: EngineInterface, dir: string, repoName: string, now: number) {
  const features = await readOptional($, `${dir}/.loop/feature_list.json`)
  if (typeof features !== 'string') return null
  const snapshot = compute({
    features,
    usage: await readOptional($, `${dir}/.loop/usage.jsonl`),
    live: await readOptional($, `${dir}/.loop/live.json`),
    progress: await readOptional($, `${dir}/.loop/progress.md`),
    now,
  })
  return snapshot === null ? null : { name: shortName(baseName(dir), repoName), path: dir, snapshot }
}

async function loadLoops($: EngineInterface) {
  const now = Math.floor((await $.clock.now()) / 1000)
  const views: LoopView[] = []
  const { dirs, repoName } = await loopDirs($)
  for (const dir of dirs) {
    const view = await loadLoop($, dir, repoName, now)
    if (view !== null) views.push(view)
  }
  return orderLoops(views)
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Autoloop status' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'autoloop-status', description: 'Show the bussin-autoloop runs in this repository and its worktrees' })
    const loops = await loadLoops($)
    await update($, loopsAtom, () => loops)
    $.ui.status(statusText(loops))
    $.clock.every(REFRESH_MS, async () => {
      const latest = await loadLoops($)
      await update($, loopsAtom, () => latest)
      $.ui.status(statusText(latest))
    })
    if (loops.some(loop => loop.snapshot.loopState === 'running')) void openPane($)
    return next(e)
  })

  on('command.run', { command: 'autoloop-status' }, async $ => {
    const loops = await loadLoops($)
    await update($, loopsAtom, () => loops)
    $.ui.status(statusText(loops))
    if (loops.length === 0) return { text: 'No .loop/feature_list.json in this repository or its worktrees. Start one with /bussin-autoloop init.' }
    await openPane($)
    return { text: statusText(loops) ?? '' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const running = runningLoops(await read($, loopsAtom))
    if (e.props.hasSurvey || running.length === 0) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const room = Math.max(1, e.props.maxRows)
    if (running.length > room && room === 1) {
      return (
        <Text color="claude" wrap="truncate-end">
          autoloop {running.map(loop => compactLine(loop.name, loop.snapshot)).join(' │ ')}
        </Text>
      )
    }
    const shown = running.length > room ? running.slice(0, room - 1) : running
    return (
      <Box flexDirection="column">
        {shown.map(loop => (
          <Box key={`band-${loop.path}`} flexDirection="row" gap={1}>
            <Text color="claude" wrap="truncate-end">
              ▶ {loop.name} {progressBar(loop.snapshot.done, loop.snapshot.total, 10)} {loop.snapshot.done}/{loop.snapshot.total}
              {loop.snapshot.runningRows.length > 0 ? ` · on ${loop.snapshot.runningRows.map(row => row.item).join(', ')}` : ''} ·{' '}
              {loop.snapshot.etaSec === null ? 'ETA after first item' : `ETA ${formatDuration(loop.snapshot.etaSec)}`}
              {loop.snapshot.sessions > loop.snapshot.unpricedSessions ? ` · ${formatCost(loop.snapshot.costUsd)}` : ''}
            </Text>
            <Button
              key={`details-${loop.name}`}
              label="Details"
              onPress={async () => {
                await update($, selectedAtom, () => loop.path)
                await openPane($)
              }}
            />
          </Box>
        ))}
        {running.length > shown.length && <Text dimColor>+{running.length - shown.length} more running · /autoloop-status</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const loops = await read($, loopsAtom)
    const view = primaryLoop(loops, await read($, selectedAtom))
    if (view === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No autoloop in this repository or its worktrees.</Text>
          <Text dimColor>Start one with /bussin-autoloop init.</Text>
        </Box>
      )
    }
    const snapshot = view.snapshot
    const overview = loops.length > 1 && (
      <Box flexDirection="column">
        <Text bold>Loops</Text>
        {loops.map(loop => (
          <Box key={`loop-${loop.path}`} flexDirection="row" gap={1}>
            <Button
              key={`select-${loop.name}`}
              label={loop.path === view.path ? `● ${loop.name}` : loop.name}
              onPress={() => update($, selectedAtom, () => loop.path)}
            />
            <Text color={LOOP_COLOR[loop.snapshot.loopState]} wrap="truncate-end">
              {statusLine(loop.snapshot)}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const room = Math.max(3, (e.viewport?.rows ?? 30) - 16 - snapshot.runningRows.length - snapshot.models.length - (loops.length > 1 ? loops.length + 2 : 0))
    const shown = [
      ...snapshot.items.filter(row => row.state !== 'done'),
      ...snapshot.items.filter(row => row.state === 'done').reverse(),
    ].slice(0, room)
    const eta =
      snapshot.etaSec === null || snapshot.finishAt === null
        ? snapshot.loopState === 'running'
          ? 'after the first item passes'
          : '—'
        : `~${formatDuration(snapshot.etaSec)} (around ${formatClock(snapshot.finishAt)})`
    const mode = snapshot.mode === 'parallel' ? `parallel × ${snapshot.workers}` : 'sequential'
    return (
      <Box flexDirection="column" gap={1}>
        {overview}
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={LOOP_COLOR[snapshot.loopState]}>
              {view.name} · {snapshot.loopState} · {mode}
            </Text>
            <Text dimColor>{snapshot.updatedAgoSec === null ? '' : `updated ${formatDuration(snapshot.updatedAgoSec)} ago`}</Text>
          </Box>
          {!snapshot.hasLiveData && (
            <Text color="warning">No live data yet: restart this loop with the latest bussin-autoloop to see what is running and the ETA.</Text>
          )}
          <Text>
            {progressBar(snapshot.done, snapshot.total, 24)} {snapshot.done}/{snapshot.total} done · {snapshot.running} running ·{' '}
            {snapshot.waiting} waiting · {snapshot.failing} failing
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text>
            <Text bold>Time   </Text>
            elapsed {snapshot.elapsedSec > 0 ? formatDuration(snapshot.elapsedSec) : '—'} · ETA {eta}
          </Text>
          <Text>
            <Text bold>Tokens </Text>
            in {formatTokens(snapshot.inputTokens)} · out {formatTokens(snapshot.outputTokens)} · cache read{' '}
            {formatTokens(snapshot.cacheReadTokens)} · cache write {formatTokens(snapshot.cacheWriteTokens)}
          </Text>
          <Text>
            <Text bold>Cost   </Text>
            {costSummary(snapshot)}
          </Text>
          {snapshot.models.map(model => (
            <Text>
              <Text bold>Model  </Text>
              {model.name} · {formatCost(model.costUsd)} · in {formatTokens(model.inputTokens)} · out{' '}
              {formatTokens(model.outputTokens)}
            </Text>
          ))}
        </Box>
        {snapshot.runningRows.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Running</Text>
            {snapshot.runningRows.map(row => (
              <Text color="claude" wrap="truncate-end">
                {row.worker > 0 ? `w${row.worker}` : '  '} {row.item} {row.title} · {formatDuration(row.seconds)}
              </Text>
            ))}
          </Box>
        )}
        <Box flexDirection="column">
          <Text bold>Items</Text>
          {shown.map(row => (
            <Text color={STATE_COLOR[row.state]} wrap="truncate-end">
              {STATE_MARK[row.state]} {row.id} {row.title} · {row.note}
            </Text>
          ))}
          {snapshot.items.length > shown.length && <Text dimColor>… {snapshot.items.length - shown.length} more</Text>}
        </Box>
        {snapshot.recent.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Recent</Text>
            {snapshot.recent.map(line => (
              <Text dimColor wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
