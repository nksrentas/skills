import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ItemState, LogLine, LoopSnapshot, LoopView } from '../types'
import { currentStep, parseLog, SAFE_ITEM, stepStrip } from './session-log'
import {
  baseName,
  commonDirFromGitFile,
  compactLine,
  compute,
  customName,
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
  loopTask,
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
const LOG_ROWS = 6
const MAX_LOG_READ = 256 * 1024

export const PANE = 'autoloop-status'

export const loopsAtom = atom({ plugin: 'bussin-loop-status', key: 'loops' } as const, [] as LoopView[])
export const selectedAtom = atom({ plugin: 'bussin-loop-status', key: 'selected' } as const, null as string | null)
export const renamingAtom = atom({ plugin: 'bussin-loop-status', key: 'renaming' } as const, null as string | null)
export const showTokensAtom = atom({ plugin: 'bussin-loop-status', key: 'showTokens' } as const, false)

const STATE_COLOR: Record<ItemState, string> = { done: 'success', running: 'claude', waiting: 'subtle', failing: 'error', ready: 'text' }
const LOOP_COLOR: Record<LoopSnapshot['loopState'], string> = {
  running: 'claude',
  stopping: 'warning',
  queued: 'warning',
  finished: 'success',
  stopped: 'subtle',
  idle: 'subtle',
}
const KIND_COLOR: Record<string, string> = { Error: 'error', Done: 'success', Edit: 'claude', Bash: 'text', Say: 'subtle' }

function costSummary(snapshot: LoopSnapshot) {
  const priced = snapshot.sessions - snapshot.unpricedSessions
  if (snapshot.sessions === 0) return 'no sessions recorded yet'
  if (priced === 0) return `unknown · ${snapshot.sessions} sessions recovered from transcripts`
  const base = `${formatCost(snapshot.costUsd)} · ${priced} priced sessions · ${formatCost(snapshot.costUsd / priced)} each`
  return snapshot.unpricedSessions > 0 ? `${base} · ${snapshot.unpricedSessions} earlier sessions unpriced` : base
}

function loopIcon(snapshot: LoopSnapshot) {
  if (snapshot.stale) return '⚠'
  return { running: '●', stopping: '◌', queued: '◌', finished: '✓', stopped: '■', idle: '·' }[snapshot.loopState]
}

function stateWords(snapshot: LoopSnapshot) {
  if (snapshot.stale) return 'driver not running'
  if (snapshot.loopState === 'queued') return 'queued: this Mac is full'
  return snapshot.loopState
}

function canStop(snapshot: LoopSnapshot) {
  return (snapshot.loopState === 'running' || snapshot.loopState === 'queued') && !snapshot.stale
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

function machineText(loops: LoopView[]) {
  const machine = runningLoops(loops).find(loop => loop.snapshot.machine !== null)?.snapshot.machine
  if (machine === undefined || machine === null) return null
  const room = machine.sessions - machine.inUse
  return `This Mac: ${machine.inUse} of ${machine.sessions} loop sessions in use · ${room > 0 ? `room for ${room} more` : 'full, new sessions wait for a free one'}`
}

function workingOn(view: LoopView) {
  return view.snapshot.runningRows
    .map(row => {
      const lines = view.logs[row.item] ?? []
      return lines.length > 0 ? `${row.item} ${currentStep(lines)}` : row.item
    })
    .join(', ')
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

async function readLogTail($: EngineInterface, path: string) {
  try {
    const info = await $.fs.stat(path)
    if (info.size <= MAX_LOG_READ) return await $.fs.read(path)
    const { exitCode, stdout } = await $.process.run(['tail', '-n', '40', path], { timeoutMs: 5000 })
    return exitCode === 0 ? stdout : undefined
  } catch {
    return undefined
  }
}

async function readLogs($: EngineInterface, dir: string, snapshot: LoopSnapshot) {
  const logs: Record<string, LogLine[]> = {}
  for (const row of snapshot.runningRows) {
    if (!SAFE_ITEM.test(row.item)) continue
    const text = await readLogTail($, `${dir}/.loop/logs/${row.item}.log`)
    if (typeof text === 'string') logs[row.item] = parseLog(text)
  }
  return logs
}

async function loadLoop($: EngineInterface, dir: string, repoName: string, now: number): Promise<LoopView | null> {
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
  const config = await readOptional($, `${dir}/.loop/config.json`)
  return {
    name,
    label: loopLabel(config, name, await readOptional($, `${dir}/.loop/name`)),
    task: loopTask(config),
    path: dir,
    snapshot,
    logs: await readLogs($, dir, snapshot),
  }
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

async function rename($: EngineInterface, loop: LoopView, value: string) {
  const name = customName(value)
  await update($, renamingAtom, () => null)
  if (name.length === 0) return
  try {
    await $.fs.write(`${loop.path}/.loop/name`, `${name}\n`)
  } catch (error) {
    $.ui.toast(`Could not rename ${loop.label}: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  $.ui.toast(`Renamed to ${name}`)
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
        {shown.map(loop => {
          const snapshot = loop.snapshot
          const busy = workingOn(loop)
          const eta =
            snapshot.loopState !== 'running' || snapshot.stale ? '' : snapshot.etaSec === null ? ' · ETA after first item' : ` · ETA ${formatDuration(snapshot.etaSec)}`
          return (
            <Box key={`band-${loop.path}`} flexDirection="row" gap={1}>
              <Text color={snapshot.stale ? 'warning' : LOOP_COLOR[snapshot.loopState]} wrap="truncate-end">
                {loopIcon(snapshot)} {loop.label}
                {snapshot.stale ? ' driver not running' : snapshot.loopState === 'running' ? '' : ` ${stateWords(snapshot)}`} {progressBar(snapshot.done, snapshot.total, 10)}{' '}
                {snapshot.done}/{snapshot.total}
                {busy !== '' ? ` · ${busy}` : ''}
                {eta}
                {snapshot.sessions > snapshot.unpricedSessions ? ` · ${formatCost(snapshot.costUsd)}` : ''}
              </Text>
              <Button
                key={`details-${loop.name}`}
                label="Details"
                onPress={async () => {
                  await update($, selectedAtom, () => loop.path)
                  await openPane($)
                }}
              />
              {canStop(snapshot) && <Button key={`stop-${loop.name}`} label="Stop" onPress={() => requestStop($, loop)} />}
            </Box>
          )
        })}
        {running.length > shown.length && <Text dimColor>+{running.length - shown.length} more running · /autoloop-status</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
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
    const renaming = (await read($, renamingAtom)) === view.path
    const showTokens = await read($, showTokensAtom)

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

    const cards = loops.length > 1 && (
      <Box flexDirection="column" width={28} flexShrink={0}>
        {loops.map(loop => (
          <Box
            key={`card-${loop.name}`}
            flexDirection="column"
            borderStyle="round"
            borderColor={loop.path === view.path ? 'claude' : 'subtle'}
            paddingX={1}
          >
            <Button
              key={`select-${loop.name}`}
              plain
              label={`${loopIcon(loop.snapshot)} ${loop.label}`}
              onPress={() => update($, selectedAtom, () => loop.path)}
            />
            <Text color={loop.snapshot.stale ? 'warning' : LOOP_COLOR[loop.snapshot.loopState]}>
              {progressBar(loop.snapshot.done, loop.snapshot.total, 12)} {loop.snapshot.done}/{loop.snapshot.total}
            </Text>
            <Text dimColor wrap="truncate-end">
              {loop.snapshot.loopState === 'running' && !loop.snapshot.stale
                ? loop.snapshot.etaSec === null
                  ? 'ETA after first item'
                  : `ETA ${formatDuration(loop.snapshot.etaSec)}`
                : stateWords(loop.snapshot)}
            </Text>
          </Box>
        ))}
      </Box>
    )

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
    const resume = resumeCommand(view.path, snapshot)
    const runningIds = snapshot.runningRows.map(row => row.item).join(', ')
    const open = snapshot.items.filter(row => row.state === 'failing' || row.state === 'ready')
    const nextShown = open.slice(0, 4)

    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold color={color} wrap="truncate-end">
            {loopIcon(snapshot)} {view.label}
          </Text>
          <Box flexDirection="row" gap={1} flexShrink={0}>
            <Button key="pane-rename" label="Rename" onPress={() => update($, renamingAtom, () => view.path)} />
            {canStop(snapshot) && <Button key="pane-stop" label="Stop" onPress={() => requestStop($, view)} />}
          </Box>
        </Box>
        {renaming && (
          <Box flexDirection="row" gap={1}>
            {Input !== undefined ? (
              <Input key="rename-input" label="Loop name" value={view.label} submitLabel="Save" autoFocus onSubmit={(value: string) => rename($, view, value)} />
            ) : (
              <Text dimColor>Rename it from a terminal: loop-status.sh --rename "New name"</Text>
            )}
            <Button key="rename-cancel" label="Cancel" onPress={() => update($, renamingAtom, () => null)} />
          </Box>
        )}
        {view.task !== '' && <Text dimColor>{view.task}</Text>}
        <Text color={color}>
          {stateWords(snapshot)} · {mode}
          {snapshot.agent !== '' ? ` · ${snapshot.agent}` : ''}
          {view.label !== view.name ? ` · ${view.name}` : ''}
        </Text>
        <Text>
          {progressBar(snapshot.done, snapshot.total, 30)} {snapshot.done}/{snapshot.total}
        </Text>
        <Text dimColor>{[eta, elapsed, spent].filter(Boolean).join(' · ') || ' '}</Text>
        {!snapshot.hasLiveData && (
          <Text color="warning">No live data yet: restart this loop with the latest bussin-autoloop to see what is running and the ETA.</Text>
        )}
      </Box>
    )

    const stale = snapshot.stale && (
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
    )

    const now = snapshot.runningRows.length > 0 && (
      <Box flexDirection="column">
        <Text bold>Now</Text>
        {snapshot.runningRows.map(row => {
          const lines = view.logs[row.item] ?? []
          return (
            <Box key={`now-${row.item}`} flexDirection="column" borderStyle="round" borderColor={snapshot.stale ? 'warning' : 'subtle'} paddingX={1}>
              <Box flexDirection="row" gap={1}>
                <Text bold color={snapshot.stale ? 'warning' : 'claude'}>
                  {row.item}
                </Text>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">{shortTitle(row.title)}</Text>
                </Box>
                <Text dimColor>
                  {[row.worker > 0 ? `w${row.worker}` : '', formatDuration(row.seconds), row.attempt > 1 ? `attempt ${row.attempt}` : ''].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              {lines.length > 0 && (
                <Box flexDirection="row" flexWrap="wrap" gap={1}>
                  {stepStrip(lines).map(step => (
                    <Text
                      key={`step-${row.item}-${step.name}`}
                      color={step.state === 'now' ? 'claude' : step.state === 'done' ? 'success' : 'subtle'}
                      bold={step.state === 'now'}
                    >
                      {step.state === 'done' ? '✓ ' : step.state === 'now' ? '› ' : ''}
                      {step.name}
                    </Text>
                  ))}
                </Box>
              )}
              {lines.slice(-LOG_ROWS).map((entry, index) => (
                <Box key={`log-${row.item}-${index}`} flexDirection="row" gap={1}>
                  <Text dimColor>{entry.time}</Text>
                  <Box width={6} flexShrink={0}>
                    <Text color={KIND_COLOR[entry.kind] ?? 'subtle'}>{entry.kind}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text wrap="truncate-end">{entry.text}</Text>
                  </Box>
                </Box>
              ))}
              {lines.length === 0 && <Text dimColor>No session log yet; it appears once this loop runs on the latest bussin-autoloop.</Text>}
            </Box>
          )
        })}
      </Box>
    )

    const next = (nextShown.length > 0 || snapshot.blockedGroups.length > 0) && (
      <Box flexDirection="column">
        {nextShown.map((row, index) => line(`next-${row.id}`, index === 0 ? 'Up next' : '', row.id, shortTitle(row.title), row.note, STATE_COLOR[row.state]))}
        {open.length > nextShown.length && (
          <Box key="next-more" flexDirection="row">
            {label('')}
            <Text dimColor>… {open.length - nextShown.length} more ready</Text>
          </Box>
        )}
        {snapshot.blockedGroups.map((group, index) => (
          <Box key={`blocked-${group.waitingFor}`} flexDirection="row">
            {label(index === 0 && nextShown.length === 0 ? 'Up next' : '')}
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor wrap="truncate-end">
                {group.items.length} wait for {group.waitingFor}: {group.items.slice(0, 6).join(' ')}
                {group.items.length > 6 ? ' …' : ''}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    )

    const recent = snapshot.recent.length > 0 && (
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
              {[session.seconds > 0 ? formatDuration(session.seconds) : '', session.costUsd === null ? '' : formatCost(session.costUsd), session.endedAt === null ? '' : formatClock(session.endedAt)]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const spend = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {label('Spend')}
          <Box flexGrow={1} flexShrink={1}>
            <Text>
              {[costSummary(snapshot), snapshot.models.map(model => `${shortModel(model.name)} ${model.priced ? formatCost(model.costUsd) : 'unpriced'}`).join(' · ')]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Box>
          {snapshot.sessions > 0 && <Button key="show-tokens" label={showTokens ? 'Hide tokens' : 'Tokens'} onPress={() => update($, showTokensAtom, shown => !shown)} />}
        </Box>
        {showTokens && (
          <Box flexDirection="row" gap={1}>
            {label('')}
            <Text>
              out {formatTokens(snapshot.outputTokens)} · in {formatTokens(snapshot.inputTokens)} · cache read {formatTokens(snapshot.cacheReadTokens)} · cache write{' '}
              {formatTokens(snapshot.cacheWriteTokens)}
            </Text>
          </Box>
        )}
      </Box>
    )

    const machine = machineText(loops)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          {cards}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} gap={1}>
            {header}
            {stale}
            {now}
            {next}
            {recent}
            {spend}
          </Box>
        </Box>
        {machine !== null && <Text dimColor>{machine}</Text>}
      </Box>
    )
  })
}
