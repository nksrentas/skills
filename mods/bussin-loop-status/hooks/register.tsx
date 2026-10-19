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
  isActive,
  orderLoops,
  parentDir,
  progressBar,
  shortModel,
  shortName,
  shortTitle,
  statusLine,
} from './snapshot'

const REFRESH_MS = 5000

export const PANE = 'autoloop-status'

export const loopsAtom = atom({ plugin: 'bussin-loop-status', key: 'loops' } as const, [] as LoopView[])
export const selectedAtom = atom({ plugin: 'bussin-loop-status', key: 'selected' } as const, null as string | null)

const STATE_COLOR: Record<ItemState, string> = { done: 'success', running: 'claude', waiting: 'subtle', failing: 'error', ready: 'text' }
const LOOP_COLOR: Record<LoopSnapshot['loopState'], string> = { running: 'claude', stopping: 'warning', finished: 'success', stopped: 'warning', idle: 'subtle' }

function costSummary(snapshot: LoopSnapshot) {
  const priced = snapshot.sessions - snapshot.unpricedSessions
  if (snapshot.sessions === 0) return 'no sessions recorded yet'
  if (priced === 0) return `unknown · ${snapshot.sessions} sessions recovered from transcripts`
  const base = `${formatCost(snapshot.costUsd)} · ${priced} priced sessions · ${formatCost(snapshot.costUsd / priced)} each`
  return snapshot.unpricedSessions > 0 ? `${base} · ${snapshot.unpricedSessions} earlier sessions unpriced` : base
}

function primaryLoop(loops: LoopView[], selected: string | null) {
  return loops.find(loop => loop.path === selected) ?? loops[0]
}

function runningLoops(loops: LoopView[]) {
  return loops.filter(loop => isActive(loop.snapshot.loopState))
}

function summaryText(loops: LoopView[]) {
  const primary = loops[0]
  if (primary === undefined) return undefined
  if (loops.length === 1) return statusLine(primary.snapshot)
  const running = runningLoops(loops)
  if (running.length === 0) return `${primary.name}: ${statusLine(primary.snapshot)}`
  return `autoloop ${running.map(loop => compactLine(loop.name, loop.snapshot)).join(' │ ')}`
}

function statusText(loops: LoopView[]) {
  return runningLoops(loops).length > 0 ? undefined : summaryText(loops)
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
    stopRequested: (await readOptional($, `${dir}/.loop/stop`)) !== undefined,
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

async function refresh($: EngineInterface) {
  const loops = await loadLoops($)
  await update($, loopsAtom, () => loops)
  $.ui.status(statusText(loops))
  return loops
}

async function requestStop($: EngineInterface, loop: LoopView) {
  try {
    await $.fs.write(`${loop.path}/.loop/stop`, '')
  } catch (error) {
    $.ui.toast(`Could not stop ${loop.name}: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  $.ui.toast(`${loop.name} stops after its running items finish`)
  await refresh($)
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Autoloop status' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'autoloop-status', description: 'Show the bussin-autoloop runs in this repository and its worktrees' })
    const loops = await refresh($)
    $.clock.every(REFRESH_MS, async () => {
      await refresh($)
    })
    if (runningLoops(loops).length > 0) void openPane($)
    return next(e)
  })

  on('command.run', { command: 'autoloop-status' }, async $ => {
    const loops = await refresh($)
    if (loops.length === 0) return { text: 'No .loop/feature_list.json in this repository or its worktrees. Start one with /bussin-autoloop init.' }
    await openPane($)
    return { text: summaryText(loops) ?? '' }
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
              {loop.snapshot.loopState === 'stopping' ? '□' : '▶'} {loop.name}
              {loop.snapshot.loopState === 'stopping' ? ' stopping' : ''} {progressBar(loop.snapshot.done, loop.snapshot.total, 10)} {loop.snapshot.done}/{loop.snapshot.total}
              {loop.snapshot.runningRows.length > 0 ? ` · on ${loop.snapshot.runningRows.map(row => row.item).join(', ')}` : ''}
              {loop.snapshot.loopState === 'stopping' ? '' : loop.snapshot.etaSec === null ? ' · ETA after first item' : ` · ETA ${formatDuration(loop.snapshot.etaSec)}`}
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
            {loop.snapshot.loopState === 'running' && <Button key={`stop-${loop.name}`} label="Stop" onPress={() => requestStop($, loop)} />}
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

    const label = (text: string) => (
      <Box width={9}>
        <Text bold>{text}</Text>
      </Box>
    )
    const line = (key: string, heading: string, id: string, title: string, note: string, color: string) => (
      <Box key={key} flexDirection="row">
        {label(heading)}
        <Box width={6}>
          <Text color={color}>{id}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text color={color} wrap="truncate-end">
            {title}
          </Text>
        </Box>
        <Text dimColor> {note}</Text>
      </Box>
    )
    const fact = (key: string, heading: string, text: string) => (
      <Box key={key} flexDirection="row">
        {label(heading)}
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">{text}</Text>
        </Box>
      </Box>
    )
    const runningIds = new Set(snapshot.runningRows.map(row => row.item))
    const open = snapshot.items.filter(row => row.state !== 'done' && !runningIds.has(row.id))
    const done = snapshot.items.filter(row => row.state === 'done').reverse()
    const spare = Math.max(4, (e.viewport?.rows ?? 30) - 18 - snapshot.runningRows.length - (loops.length > 1 ? loops.length + 2 : 0))
    const nextShown = open.slice(0, Math.max(2, Math.min(6, Math.ceil(spare * 0.6))))
    const doneShown = done.slice(0, Math.max(1, Math.min(4, spare - nextShown.length)))
    const eta =
      snapshot.etaSec === null || snapshot.finishAt === null
        ? snapshot.loopState === 'running'
          ? 'ETA after the first item this loop finishes'
          : null
        : `ETA ~${formatDuration(snapshot.etaSec)} (around ${formatClock(snapshot.finishAt)})`
    const spent = snapshot.sessions > snapshot.unpricedSessions ? `${formatCost(snapshot.costUsd)} so far` : null
    const elapsed = snapshot.elapsedSec > 0 ? `elapsed ${formatDuration(snapshot.elapsedSec)}` : null
    const mode = snapshot.mode === 'parallel' ? `parallel × ${snapshot.workers}` : 'sequential'
    const models = snapshot.models.map(model => `${shortModel(model.name)} ${model.priced ? formatCost(model.costUsd) : 'unpriced'}`).join(' · ')
    return (
      <Box flexDirection="column" gap={1}>
        {overview}
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={LOOP_COLOR[snapshot.loopState]}>
              {view.name} · {snapshot.loopState} · {mode}
            </Text>
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{snapshot.updatedAgoSec === null ? '' : `updated ${formatDuration(snapshot.updatedAgoSec)} ago`}</Text>
              {snapshot.loopState === 'running' && <Button key="pane-stop" label="Stop" onPress={() => requestStop($, view)} />}
            </Box>
          </Box>
          <Text>
            {progressBar(snapshot.done, snapshot.total, 30)} {snapshot.done}/{snapshot.total} done · {snapshot.running} running ·{' '}
            {snapshot.total - snapshot.done} to go
          </Text>
          <Text color={LOOP_COLOR[snapshot.loopState]}>{[eta, elapsed, spent].filter(Boolean).join(' · ') || ' '}</Text>
          {!snapshot.hasLiveData && (
            <Text color="warning">No live data yet: restart this loop with the latest bussin-autoloop to see what is running and the ETA.</Text>
          )}
        </Box>
        <Box flexDirection="column">
          {snapshot.runningRows.map((row, index) =>
            line(`now-${row.item}`, index === 0 ? 'Now' : '', row.item, shortTitle(row.title), `${row.worker > 0 ? `w${row.worker} · ` : ''}${formatDuration(row.seconds)}`, 'claude'),
          )}
          {nextShown.map((row, index) => line(`next-${row.id}`, index === 0 ? 'Next' : '', row.id, shortTitle(row.title), row.note, STATE_COLOR[row.state]))}
          {open.length > nextShown.length && fact('next-more', '', `… ${open.length - nextShown.length} more to go`)}
          {doneShown.map((row, index) => line(`done-${row.id}`, index === 0 ? 'Done' : '', row.id, shortTitle(row.title), row.note, 'success'))}
          {done.length > doneShown.length && fact('done-more', '', `… ${done.length - doneShown.length} more done`)}
        </Box>
        <Box flexDirection="column">
          {fact('cost', 'Cost', costSummary(snapshot))}
          {fact('tokens', 'Tokens', `out ${formatTokens(snapshot.outputTokens)} · in ${formatTokens(snapshot.inputTokens)} · cache read ${formatTokens(snapshot.cacheReadTokens)} · cache write ${formatTokens(snapshot.cacheWriteTokens)}`)}
          {models !== '' && fact('models', 'Models', models)}
          {snapshot.recent.map((entry, index) => fact(`recent-${index}`, index === 0 ? 'Recent' : '', entry))}
        </Box>
      </Box>
    )
  })
}
