import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { ItemState, LoopSnapshot, LoopView } from '../types'
import {
  baseName,
  commonDirFromGitFile,
  compactLine,
  compute,
  distinctLabels,
  formatClock,
  formatCost,
  formatDuration,
  formatTokens,
  isActive,
  isDriverCommand,
  isWorkerHead,
  livePid,
  loopLabel,
  orderLoops,
  parentDir,
  progressBar,
  resumeCommand,
  shortModel,
  shortName,
  shortTitle,
  statusLine,
} from './snapshot'

const REFRESH_MS = 5000

export const PANE = 'autoloop-status'

export const loopsAtom = atom({ plugin: 'bussin-loop-status', key: 'loops' } as const, [] as LoopView[])
export const selectedAtom = atom({ plugin: 'bussin-loop-status', key: 'selected' } as const, null as string | null)
export const expandedAtom = atom({ plugin: 'bussin-loop-status', key: 'expanded' } as const, [] as string[])
export const showIdleAtom = atom({ plugin: 'bussin-loop-status', key: 'showIdle' } as const, false)
export const showTokensAtom = atom({ plugin: 'bussin-loop-status', key: 'showTokens' } as const, false)

const STATE_COLOR: Record<ItemState, string> = { done: 'success', running: 'claude', waiting: 'subtle', failing: 'error', ready: 'text' }
const LOOP_COLOR: Record<LoopSnapshot['loopState'], string> = { running: 'claude', stopping: 'warning', finished: 'success', stopped: 'warning', idle: 'subtle' }

function costSummary(snapshot: LoopSnapshot) {
  const priced = snapshot.sessions - snapshot.unpricedSessions
  if (snapshot.sessions === 0) return 'no sessions recorded yet'
  if (priced === 0) return `unknown · ${snapshot.sessions} sessions recovered from transcripts`
  const base = `${formatCost(snapshot.costUsd)} · ${priced} priced sessions · ${formatCost(snapshot.costUsd / priced)} each`
  return snapshot.unpricedSessions > 0 ? `${base} · ${snapshot.unpricedSessions} earlier sessions unpriced` : base
}

function loopIcon(snapshot: LoopSnapshot) {
  if (snapshot.stale) return '⚠'
  return { running: '▶', stopping: '□', finished: '✓', stopped: '■', idle: '·' }[snapshot.loopState]
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
  if (running.length === 0) return `${primary.label}: ${statusLine(primary.snapshot)}`
  return `autoloop ${running.map(loop => compactLine(loop.label, loop.snapshot)).join(' │ ')}`
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
        if (isWorkerHead(await readOptional($, `${common}/worktrees/${entry.name}/HEAD`))) continue
        const gitdir = await readOptional($, `${common}/worktrees/${entry.name}/gitdir`)
        if (typeof gitdir === 'string' && gitdir.trim() !== '') dirs.push(parentDir(gitdir.trim()))
      }
    } catch {
      return { dirs: [...new Set(dirs)], repoName }
    }
  }
  return { dirs: [...new Set(dirs)], repoName }
}

async function driverAlive($: EngineInterface, pid: number | undefined) {
  if (pid === undefined) return undefined
  try {
    const { exitCode, stdout } = await $.process.run(['ps', '-p', String(pid), '-o', 'command='], { timeoutMs: 5000 })
    return exitCode === 0 && isDriverCommand(stdout)
  } catch {
    return undefined
  }
}

async function loadLoop($: EngineInterface, dir: string, repoName: string, now: number) {
  const features = await readOptional($, `${dir}/.loop/feature_list.json`)
  if (typeof features !== 'string') return null
  const live = await readOptional($, `${dir}/.loop/live.json`)
  const snapshot = compute({
    features,
    usage: await readOptional($, `${dir}/.loop/usage.jsonl`),
    live,
    attempts: await readOptional($, `${dir}/.loop/attempts.json`),
    stopRequested: (await readOptional($, `${dir}/.loop/stop`)) !== undefined,
    driverAlive: await driverAlive($, livePid(live)),
    now,
  })
  if (snapshot === null) return null
  const name = shortName(baseName(dir), repoName)
  return { name, label: loopLabel(await readOptional($, `${dir}/.loop/config.json`), name), path: dir, snapshot }
}

async function loadLoops($: EngineInterface) {
  const now = Math.floor((await $.clock.now()) / 1000)
  const views: LoopView[] = []
  const { dirs, repoName } = await loopDirs($)
  for (const dir of dirs) {
    const view = await loadLoop($, dir, repoName, now)
    if (view !== null) views.push(view)
  }
  return orderLoops(distinctLabels(views))
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
    $.ui.toast(`Could not stop ${loop.label}: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  $.ui.toast(`${loop.label} stops after its running items finish`)
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
          autoloop {running.map(loop => compactLine(loop.label, loop.snapshot)).join(' │ ')}
        </Text>
      )
    }
    const shown = running.length > room ? running.slice(0, room - 1) : running
    return (
      <Box flexDirection="column">
        {shown.map(loop => (
          <Box key={`band-${loop.path}`} flexDirection="row" gap={1}>
            <Text color={loop.snapshot.stale ? 'warning' : 'claude'} wrap="truncate-end">
              {loopIcon(loop.snapshot)} {loop.label}
              {loop.snapshot.stale ? ' driver not running' : loop.snapshot.loopState === 'stopping' ? ' stopping' : ''} {progressBar(loop.snapshot.done, loop.snapshot.total, 10)} {loop.snapshot.done}/{loop.snapshot.total}
              {loop.snapshot.runningRows.length > 0 ? ` · on ${loop.snapshot.runningRows.map(row => row.item).join(', ')}` : ''}
              {loop.snapshot.loopState === 'stopping' || loop.snapshot.stale ? '' : loop.snapshot.etaSec === null ? ' · ETA after first item' : ` · ETA ${formatDuration(loop.snapshot.etaSec)}`}
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
            {loop.snapshot.loopState === 'running' && !loop.snapshot.stale && <Button key={`stop-${loop.name}`} label="Stop" onPress={() => requestStop($, loop)} />}
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
    const expanded = await read($, expandedAtom)
    const showIdle = await read($, showIdleAtom)
    const showTokens = await read($, showTokensAtom)
    const idle = loops.filter(loop => !isActive(loop.snapshot.loopState) && loop.path !== view.path)
    const switcher = loops.length > 1 && (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {loops
          .filter(loop => showIdle || !idle.includes(loop))
          .map(loop => (
            <Button
              key={`select-${loop.name}`}
              label={`${loop.path === view.path ? '● ' : ''}${loopIcon(loop.snapshot)} ${loop.label} ${loop.snapshot.done}/${loop.snapshot.total}`}
              onPress={() => update($, selectedAtom, () => loop.path)}
            />
          ))}
        {idle.length > 0 && (
          <Button key="show-idle" label={showIdle ? 'hide idle loops' : `+${idle.length} not running`} onPress={() => update($, showIdleAtom, shown => !shown)} />
        )}
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
        <Box flexShrink={0}>
          <Text dimColor> {note}</Text>
        </Box>
      </Box>
    )
    const fact = (key: string, heading: string, text: string, action?: RenderChildren) => (
      <Box key={key} flexDirection="row" gap={1}>
        {label(heading)}
        <Box flexGrow={1} flexShrink={1}>
          <Text>{text}</Text>
        </Box>
        {action}
      </Box>
    )

    const state = snapshot.stale ? 'driver not running' : snapshot.loopState
    const color = snapshot.stale ? 'warning' : LOOP_COLOR[snapshot.loopState]
    const mode = snapshot.mode === 'parallel' ? `parallel × ${snapshot.workers}` : 'sequential'
    const eta =
      snapshot.loopState !== 'running' || snapshot.stale
        ? null
        : snapshot.etaSec === null || snapshot.finishAt === null
          ? 'ETA after the first item'
          : `ETA ~${formatDuration(snapshot.etaSec)} (around ${formatClock(snapshot.finishAt)})`
    const elapsed = snapshot.elapsedSec > 0 ? `elapsed ${formatDuration(snapshot.elapsedSec)}` : null
    const spent = snapshot.sessions > snapshot.unpricedSessions ? `${formatCost(snapshot.costUsd)} so far` : null
    const counts = [
      { key: 'done', text: `${snapshot.done} done`, color: 'success' },
      { key: 'running', text: `${snapshot.running} running`, color: 'claude' },
      { key: 'ready', text: `${snapshot.ready} ready`, color: 'text' },
      { key: 'blocked', text: `${snapshot.waiting} blocked`, color: 'subtle' },
      ...(snapshot.failing > 0 ? [{ key: 'failing', text: `${snapshot.failing} failing`, color: 'error' }] : []),
    ]
    const resume = resumeCommand(view.path, snapshot)
    const runningIds = snapshot.runningRows.map(row => row.item).join(', ')

    const open = snapshot.items.filter(row => row.state === 'failing' || row.state === 'ready')
    const nextShown = open.slice(0, 4)
    const groupKey = (waitingFor: string) => `${view.path}:${waitingFor}`
    const groups = snapshot.blockedGroups.flatMap((group, index) => {
      const isOpen = expanded.includes(groupKey(group.waitingFor))
      const head = (
        <Box key={`blocked-${group.waitingFor}`} flexDirection="row" gap={1}>
          {label(index === 0 && nextShown.length === 0 ? 'Next' : '')}
          <Button
            key={`group-${group.waitingFor}`}
            label={`${isOpen ? '▾' : '▸'} ${group.items.length} wait for ${group.waitingFor}`}
            onPress={() =>
              update($, expandedAtom, keys =>
                keys.includes(groupKey(group.waitingFor)) ? keys.filter(key => key !== groupKey(group.waitingFor)) : [...keys, groupKey(group.waitingFor)],
              )
            }
          />
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {group.items.slice(0, 6).join(' ')}
              {group.items.length > 6 ? ' …' : ''}
            </Text>
          </Box>
        </Box>
      )
      if (!isOpen) return [head]
      const rows = group.items
        .slice(0, 8)
        .map(id => line(`blocked-${group.waitingFor}-${id}`, '', id, shortTitle(snapshot.items.find(row => row.id === id)?.title ?? ''), '', 'subtle'))
      const more = group.items.length > 8 ? [fact(`blocked-${group.waitingFor}-more`, '', `… ${group.items.length - 8} more`)] : []
      return [head, ...rows, ...more]
    })

    return (
      <Box flexDirection="column" gap={1}>
        {switcher}
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text bold color={color} wrap="truncate-end">
              {loopIcon(snapshot)} {view.label} · {state} · {mode}
            </Text>
            {snapshot.loopState === 'running' && !snapshot.stale && <Button key="pane-stop" label="Stop" onPress={() => requestStop($, view)} />}
          </Box>
          <Text>
            {progressBar(snapshot.done, snapshot.total, 30)} {snapshot.done}/{snapshot.total}
          </Text>
          <Text dimColor>{[eta, elapsed, spent].filter(Boolean).join(' · ') || ' '}</Text>
          <Box flexDirection="row" flexWrap="wrap">
            {counts.map((count, index) => (
              <Text key={`count-${count.key}`} color={count.color}>
                {index > 0 ? ' · ' : ''}
                {count.text}
              </Text>
            ))}
          </Box>
          {!snapshot.hasLiveData && (
            <Text color="warning">No live data yet: restart this loop with the latest bussin-autoloop to see what is running and the ETA.</Text>
          )}
        </Box>
        {snapshot.stale && (
          <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
            <Text color="warning" bold>
              ⚠ The loop driver is not running
            </Text>
            <Text dimColor>
              Its process has exited, so nothing is working on {runningIds || 'any item'}. Run loop.sh again to resume; attempt counts are kept.
            </Text>
            {resume !== null && <Text dimColor>{resume}</Text>}
            {resume !== null && (
              <Box flexDirection="row" gap={1}>
                <Button
                  key="copy-resume"
                  label="Copy resume command"
                  onPress={async press => {
                    const copied = await $.ui.copy({ text: resume, surface: press.surface })
                    $.ui.toast(copied.isCopied ? 'Resume command copied' : `Could not copy: ${resume}`)
                  }}
                />
              </Box>
            )}
          </Box>
        )}
        <Box flexDirection="column">
          {snapshot.runningRows.map((row, index) =>
            line(
              `now-${row.item}`,
              index === 0 ? 'Now' : '',
              row.item,
              shortTitle(row.title),
              [row.worker > 0 ? `w${row.worker}` : '', formatDuration(row.seconds), row.attempt > 1 ? `attempt ${row.attempt}` : ''].filter(Boolean).join(' · '),
              snapshot.stale ? 'warning' : 'claude',
            ),
          )}
          {nextShown.map((row, index) => line(`next-${row.id}`, index === 0 ? 'Next' : '', row.id, shortTitle(row.title), row.note, STATE_COLOR[row.state]))}
          {open.length > nextShown.length && fact('next-more', '', `… ${open.length - nextShown.length} more ready`)}
          {groups}
        </Box>
        {snapshot.recent.length > 0 && (
          <Box flexDirection="column">
            {snapshot.recent.map((session, index) => (
              <Box key={`recent-${index}`} flexDirection="row">
                {label(index === 0 ? 'Recent' : '')}
                <Box width={2}>
                  <Text color={session.ok === true ? 'success' : session.ok === false ? 'error' : 'subtle'}>{session.ok === true ? '✓' : session.ok === false ? '✗' : '·'}</Text>
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">
                    {session.item} {session.outcome}
                  </Text>
                </Box>
                <Text dimColor>
                  {' '}
                  {[
                    session.seconds > 0 ? formatDuration(session.seconds) : '',
                    session.costUsd === null ? '' : formatCost(session.costUsd),
                    session.endedAt === null ? '' : formatClock(session.endedAt),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        <Box flexDirection="column">
          {fact(
            'spend',
            'Spend',
            [costSummary(snapshot), snapshot.models.map(model => `${shortModel(model.name)} ${model.priced ? formatCost(model.costUsd) : 'unpriced'}`).join(' · ')]
              .filter(Boolean)
              .join(' · '),
            snapshot.sessions > 0 && (
              <Button key="show-tokens" label={showTokens ? 'hide tokens' : 'tokens'} onPress={() => update($, showTokensAtom, shown => !shown)} />
            ),
          )}
          {showTokens &&
            fact(
              'tokens',
              '',
              `out ${formatTokens(snapshot.outputTokens)} · in ${formatTokens(snapshot.inputTokens)} · cache read ${formatTokens(snapshot.cacheReadTokens)} · cache write ${formatTokens(snapshot.cacheWriteTokens)}`,
            )}
        </Box>
      </Box>
    )
  })
}
