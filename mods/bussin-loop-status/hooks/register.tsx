import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AddDraft, Area, InboxChange, ItemRow, ItemState, LogLine, LoopSnapshot, LoopView } from '../types'
import { currentStep, parseLog, SAFE_ITEM } from './session-log'
import {
  areas,
  baseName,
  clean,
  commonDirFromGitFile,
  compactLine,
  compute,
  customName,
  dismissed,
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
  longInactive,
  orderLoops,
  parentDir,
  phaseOf,
  progressBar,
  resumeCommand,
  shortModel,
  shortName,
  shortTitle,
  statusLine,
} from './snapshot'

const REFRESH_MS = 5000
const MAX_LOG_READ = 256 * 1024

export const PANE = 'autoloop-status'

export const loopsAtom = atom({ plugin: 'bussin-loop-status', key: 'loops' } as const, [] as LoopView[])
export const selectedAtom = atom({ plugin: 'bussin-loop-status', key: 'selected' } as const, null as string | null)
export const renamingAtom = atom({ plugin: 'bussin-loop-status', key: 'renaming' } as const, null as string | null)
export const showTokensAtom = atom({ plugin: 'bussin-loop-status', key: 'showTokens' } as const, false)
// Keyed `<loop path>\n<area name>`; an area nobody toggled is open while it has running or failing tasks.
export const openAreasAtom = atom({ plugin: 'bussin-loop-status', key: 'openAreas' } as const, {} as Record<string, boolean>)
// Keyed `<loop path>\n<item id>`: one open task at a time; pressing any task hides technical details and drops an edit draft.
export const openTaskAtom = atom({ plugin: 'bussin-loop-status', key: 'openTask' } as const, null as string | null)
export const technicalAtom = atom({ plugin: 'bussin-loop-status', key: 'technical' } as const, false)
// The task being reworded (keyed like openTask) and the text typed so far.
export const editDraftAtom = atom({ plugin: 'bussin-loop-status', key: 'editDraft' } as const, null as { key: string; plain: string; doneWhen: string } | null)
export const addDraftAtom = atom({ plugin: 'bussin-loop-status', key: 'addDraft' } as const, null as AddDraft | null)

const LOG_ROWS = 6
const ADDED_AREA = 'Added by you'
const KIND_OPTIONS = [
  { value: 'build', label: 'Build a feature' },
  { value: 'eval', label: 'Evaluation: returns metrics' },
  { value: 'design', label: 'Design: send me screenshots' },
]
const WHEN_OPTIONS = [
  { value: 'queued', label: 'After what is queued' },
  { value: 'next', label: 'Next' },
]

// 'precision@5>=0.75, recall@10' -> [{ name: 'precision@5', target: 0.75 }, { name: 'recall@10' }]
function parseMetrics(text: string) {
  return text
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '')
    .map(part => {
      const match = /^(.+?)\s*>=\s*(.+)$/.exec(part)
      const target = match === null ? NaN : Number(match[2])
      return match !== null && Number.isFinite(target) ? { name: match[1] ?? part, target } : { name: part }
    })
}

const TASK_MARK: Record<ItemState, { icon: string; color: string }> = {
  running: { icon: '◆', color: 'claude' },
  failing: { icon: '↻', color: 'warning' },
  ready: { icon: '○', color: 'subtle' },
  waiting: { icon: '○', color: 'subtle' },
  done: { icon: '✓', color: 'success' },
}
const TASK_ORDER: Record<ItemState, number> = { running: 0, failing: 1, ready: 2, waiting: 3, done: 4 }
const LOOP_COLOR: Record<LoopSnapshot['loopState'], string> = {
  running: 'claude',
  stopping: 'warning',
  queued: 'warning',
  finished: 'success',
  stopped: 'subtle',
  idle: 'subtle',
}

function costSummary(snapshot: LoopSnapshot) {
  const priced = snapshot.sessions - snapshot.unpricedSessions
  if (snapshot.sessions === 0) return 'no sessions recorded yet'
  if (priced === 0) return `unknown · ${snapshot.sessions} sessions`
  const base = `${formatCost(snapshot.costUsd)} · ${priced} priced sessions · ${formatCost(snapshot.costUsd / priced)} each`
  return snapshot.unpricedSessions > 0 ? `${base} · ${snapshot.unpricedSessions} sessions with unknown cost` : base
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

function canDismiss(snapshot: LoopSnapshot) {
  return !isActive(snapshot.loopState) || snapshot.stale
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

function areaStatus(area: Area) {
  const busy = area.items.filter(row => row.state === 'running').length
  if (busy > 0) return { text: `◆ building ${busy}`, color: 'claude' }
  const failing = area.items.filter(row => row.state === 'failing').length
  if (failing > 0) return { text: `${failing} ${failing === 1 ? 'needs' : 'need'} a look`, color: 'warning' }
  if (area.done === area.total) return { text: '✓ all work', color: 'success' }
  return { text: 'waiting its turn', color: 'subtle' }
}

function taskNote(row: ItemRow, plainOf: Map<string, string>) {
  if (row.state === 'running') return row.phase ?? ''
  if (row.state === 'failing') return 'trying again'
  if (row.state === 'done') return row.finishedAt === null ? 'done' : formatClock(row.finishedAt)
  const after = (row.waitingFor ?? []).flatMap(id => plainOf.get(id) || [])
  return row.state === 'waiting' && after.length > 0 ? `after ${after.map(text => shortTitle(text, 40)).join(', ')}` : 'not started'
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

// The names sendChange writes; anything else in the folder is not ours to show or remove.
const INBOX_NAME = /^[0-9]+-[A-Za-z0-9]+\.json$/
const MAX_CHANGES = 50

// Typed text is shown whole up to 80 characters; shortTitle would cut it at its first ': '.
function quoted(text: string) {
  return `'${text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text}'`
}

function changeLine(change: Record<string, unknown>, plainOf: Map<string, string>) {
  if (change.op === 'add') return `Add ${quoted(clean(change.plain))}`
  if (change.op === 'review' && change.verdict === 'changes') return `Fix after review: ${quoted(clean(change.note))}`
  const task = quoted(plainOf.get(clean(change.id)) || clean(change.id))
  if (change.op === 'edit') return `Reword ${task}`
  if (change.op === 'skip') return `Skip ${task}`
  if (change.op === 'first') return `Run ${task} next`
  if (change.op === 'review' && change.verdict === 'approved') return `Approve screenshots of ${task}`
  return null
}

async function readInbox($: EngineInterface, dir: string, snapshot: LoopSnapshot) {
  let names: string[]
  try {
    names = (await $.fs.list(`${dir}/.loop/inbox`)).map(entry => entry.name).filter(name => INBOX_NAME.test(name))
  } catch {
    return []
  }
  const plainOf = new Map(snapshot.items.map(row => [row.id, row.plain]))
  const changes: InboxChange[] = []
  for (const name of names.sort().slice(0, MAX_CHANGES)) {
    const path = `${dir}/.loop/inbox/${name}`
    try {
      const change: unknown = JSON.parse((await readOptional($, path)) ?? '')
      const line = typeof change === 'object' && change !== null ? changeLine(change as Record<string, unknown>, plainOf) : null
      if (line !== null) changes.push({ name, path, line })
    } catch {
      // Unreadable or half-written: the driver drops it with a reason.
    }
  }
  return changes
}

async function undoChange($: EngineInterface, change: InboxChange) {
  try {
    const { exitCode, stderr } = await $.process.run(['rm', '--', change.path], { timeoutMs: 5000 })
    if (exitCode !== 0) throw new Error(stderr.trim() || `rm exited ${exitCode}`)
  } catch (error) {
    $.ui.toast(`Could not undo the change: ${error instanceof Error ? error.message : String(error)}`)
  }
  await refresh($)
}

async function loadLoop($: EngineInterface, dir: string, repoName: string, now: number): Promise<LoopView | null> {
  const features = await readOptional($, `${dir}/.loop/feature_list.json`)
  if (typeof features !== 'string') return null
  const live = await readOptional($, `${dir}/.loop/live.json`)
  const computed = compute({
    features,
    usage: await readOptional($, `${dir}/.loop/usage.jsonl`),
    live,
    attempts: await readOptional($, `${dir}/.loop/attempts.json`),
    stopRequested: (await readOptional($, `${dir}/.loop/stop`)) !== undefined,
    driverAlive: await driverAlive($, livePid(live)),
    now,
  })
  if (computed === null || dismissed(computed, await readOptional($, `${dir}/.loop/dismissed`))) return null
  const logs = await readLogs($, dir, computed)
  const snapshot = { ...computed, items: computed.items.map(row => (row.state === 'running' && Object.hasOwn(logs, row.id) ? { ...row, phase: phaseOf(currentStep(logs[row.id] ?? [])) } : row)) }
  const name = shortName(baseName(dir), repoName)
  const config = await readOptional($, `${dir}/.loop/config.json`)
  return {
    name,
    label: loopLabel(config, name, await readOptional($, `${dir}/.loop/name`)),
    task: loopTask(config),
    path: dir,
    snapshot,
    logs,
    changes: await readInbox($, dir, snapshot),
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
  return orderLoops(distinctLabels(views.filter(view => !longInactive(view.snapshot, now))))
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

async function dismiss($: EngineInterface, loop: LoopView) {
  try {
    await $.fs.write(`${loop.path}/.loop/dismissed`, `${Math.floor((await $.clock.now()) / 1000)}\n`)
  } catch (error) {
    $.ui.toast(`Could not dismiss ${loop.label}: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  $.ui.toast(`${loop.label} dismissed; it shows again if it runs`)
  await refresh($)
}

// One change file for the driver's inbox.sh / inbox.jq, applied between sessions.
async function sendChange($: EngineInterface, loop: LoopView, change: Record<string, unknown>, done: string) {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  try {
    await $.fs.write(`${loop.path}/.loop/inbox/${await $.clock.now()}-${random}.json`, `${JSON.stringify(change)}\n`)
  } catch (error) {
    $.ui.toast(`Could not save the change: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  $.ui.toast(`${done}. ${canStop(loop.snapshot) ? 'Applied before the next task starts.' : 'Applied when the loop runs next.'}`)
  await refresh($)
  return true
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
    // Mobile's table still hands out an Input, drawn as an empty Box: the app has no text field yet.
    const Input = e.surface !== 'mobile' && 'Input' in elements ? elements.Input : undefined
    const Select = Input !== undefined && 'Select' in elements ? elements.Select : undefined
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
    const runningTasks = snapshot.items
      .filter(row => row.state === 'running')
      .map(row => row.plain)
      .join(', ')
    const loopAreas = areas(snapshot.items)
    const storedAdd = await read($, addDraftAtom)
    const adding = Input !== undefined && Select !== undefined && storedAdd?.path === view.path ? storedAdd : null
    const setAdd = (patch: Partial<AddDraft>) => update($, addDraftAtom, current => current && { ...current, ...patch })
    const submitAdd = async () => {
      if (adding === null) return
      const plain = adding.plain.trim()
      if (plain === '') {
        $.ui.toast('Say what the new task should do before adding it')
        return
      }
      const metrics = adding.kind === 'eval' ? parseMetrics(adding.metrics) : []
      const change = {
        op: 'add',
        plain,
        done_when: adding.doneWhen.trim(),
        area: adding.area,
        kind: adding.kind,
        ...(metrics.length > 0 ? { metrics } : {}),
        ...(adding.first ? { first: true } : {}),
      }
      if (await sendChange($, view, change, `Added '${plain}'`)) await update($, addDraftAtom, () => null)
    }
    const addForm = adding !== null && Input !== undefined && Select !== undefined && (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Input key="add-plain" label="What should it do?" rows={2} value={adding.plain} onInput={(plain: string) => setAdd({ plain })} onSubmit={(plain: string) => setAdd({ plain })} />
        <Input key="add-done" label="Done when" rows={2} value={adding.doneWhen} onInput={(doneWhen: string) => setAdd({ doneWhen })} onSubmit={(doneWhen: string) => setAdd({ doneWhen })} />
        <Select
          key="add-area"
          label="Area"
          options={[...new Set([...loopAreas.map(area => area.name), ADDED_AREA])].map(value => ({ value }))}
          value={adding.area}
          onSelect={(area: string) => setAdd({ area })}
        />
        <Select key="add-kind" label="Kind" options={KIND_OPTIONS} value={adding.kind} onSelect={(kind: string) => setAdd({ kind: kind as AddDraft['kind'] })} />
        <Select key="add-when" label="When" options={WHEN_OPTIONS} value={adding.first ? 'next' : 'queued'} onSelect={(when: string) => setAdd({ first: when === 'next' })} />
        {adding.kind === 'eval' && (
          <Input
            key="add-metrics"
            label="Metrics to return"
            value={adding.metrics}
            onInput={(metrics: string) => setAdd({ metrics })}
            onSubmit={(metrics: string) => setAdd({ metrics })}
          />
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="add-submit" label="Add to the loop" onPress={submitAdd} />
          <Button key="add-cancel" label="Cancel" onPress={() => update($, addDraftAtom, () => null)} />
        </Box>
      </Box>
    )

    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold color={color} wrap="truncate-end">
            {loopIcon(snapshot)} {view.label}
          </Text>
          <Box flexDirection="row" gap={1} flexShrink={0}>
            {Select !== undefined && (
              <Button
                key="pane-add"
                label="+ Add a task"
                onPress={() =>
                  update($, addDraftAtom, current =>
                    current?.path === view.path ? null : { path: view.path, plain: '', doneWhen: '', area: ADDED_AREA, kind: 'build', first: false, metrics: '' },
                  )
                }
              />
            )}
            <Button key="pane-rename" label="Rename" onPress={() => update($, renamingAtom, () => view.path)} />
            {canStop(snapshot) && <Button key="pane-stop" label="Stop" onPress={() => requestStop($, view)} />}
            {canDismiss(snapshot) && <Button key="pane-dismiss" label="Dismiss" onPress={() => dismiss($, view)} />}
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
      </Box>
    )

    const yourChanges = view.changes.length > 0 && (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Text bold>Your changes · {view.changes.length} waiting</Text>
        {view.changes.map(change => (
          <Box key={`change-${change.name}`} flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text>{change.line}</Text>
            </Box>
            <Button key={`undo-${change.name}`} label="Undo" onPress={() => undoChange($, change)} />
          </Box>
        ))}
        <Text dimColor>{canStop(snapshot) ? 'Applied before the next task starts.' : 'Applied when the loop runs next.'}</Text>
      </Box>
    )

    const stale = snapshot.stale && (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Text color="warning" bold>
          ⚠ The loop driver is not running
        </Text>
        <Text dimColor>
          Its process has exited, so nothing is working on {runningTasks || 'any task'}. Run loop.sh again to resume; attempt counts are kept.
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

    const openAreas = await read($, openAreasAtom)
    const openTask = await read($, openTaskAtom)
    const showTechnical = await read($, technicalAtom)
    const draft = await read($, editDraftAtom)
    const plainOf = new Map(snapshot.items.map(row => [row.id, row.plain]))
    const taskBox = (row: ItemRow) => {
      const run = snapshot.runningRows.find(running => running.item === row.id)
      const lines = (view.logs[row.id] ?? []).slice(-LOG_ROWS)
      const taskKey = `${view.path}\n${row.id}`
      const pending = row.state !== 'done' && row.state !== 'running'
      const editing = pending && Input !== undefined && draft?.key === taskKey ? draft : null
      const setDraft = (field: 'plain' | 'doneWhen') => (value: string) => update($, editDraftAtom, current => current && { ...current, [field]: value })
      const saveEdit = async () => {
        if (editing === null) return
        const plain = editing.plain.trim()
        if (plain === '') {
          $.ui.toast('Say what the task should do before saving')
          return
        }
        if (await sendChange($, view, { op: 'edit', id: row.id, plain, done_when: editing.doneWhen.trim() }, `Saved your edit of '${row.plain}'`)) {
          await update($, editDraftAtom, () => null)
        }
      }
      return (
        <Box key={`task-box-${row.id}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          {run !== undefined && (
            <Text color="claude">
              {row.phase ?? 'Working on it'} · running for {formatDuration(run.seconds)}
            </Text>
          )}
          {editing === null && row.doneWhen !== '' && <Text>Done when: {row.doneWhen}</Text>}
          {editing !== null && Input !== undefined && (
            <Box flexDirection="column">
              <Input
                key={`edit-plain-${row.id}`}
                label="What it should do"
                rows={2}
                value={editing.plain}
                onInput={setDraft('plain')}
                onSubmit={setDraft('plain')}
              />
              <Input
                key={`edit-done-${row.id}`}
                label="Done when"
                rows={2}
                value={editing.doneWhen}
                onInput={setDraft('doneWhen')}
                onSubmit={setDraft('doneWhen')}
              />
              <Box flexDirection="row" gap={1}>
                <Button key={`edit-save-${row.id}`} label="Save" onPress={saveEdit} />
                <Button key={`edit-cancel-${row.id}`} label="Cancel" onPress={() => update($, editDraftAtom, () => null)} />
              </Box>
            </Box>
          )}
          {pending && editing === null && (
            <Box flexDirection="row" gap={1}>
              {Input !== undefined && (
                <Button
                  key={`edit-${row.id}`}
                  label="Edit"
                  onPress={() => update($, editDraftAtom, () => ({ key: taskKey, plain: row.plain, doneWhen: row.doneWhen }))}
                />
              )}
              <Button key={`first-${row.id}`} label="Do it next" onPress={() => sendChange($, view, { op: 'first', id: row.id }, `'${row.plain}' runs next`)} />
              <Button key={`skip-${row.id}`} label="Skip it" onPress={() => sendChange($, view, { op: 'skip', id: row.id }, `'${row.plain}' will be skipped`)} />
            </Box>
          )}
          <Box flexDirection="row">
            <Button
              key={`tech-${row.id}`}
              plain
              dimColor
              label={showTechnical ? 'Hide technical details' : 'Technical details'}
              onPress={() => update($, technicalAtom, shown => !shown)}
            />
          </Box>
          {showTechnical && <Text dimColor>Id: {row.id}</Text>}
          {showTechnical && row.description !== '' && <Text dimColor>{row.description}</Text>}
          {showTechnical && row.verify !== '' && <Text dimColor>Verify: {row.verify}</Text>}
          {showTechnical &&
            lines.map((entry, index) => (
              <Text key={`log-${row.id}-${index}`} dimColor wrap="truncate-end">
                {entry.time} {entry.kind} {entry.text}
              </Text>
            ))}
        </Box>
      )
    }
    const areaList = (
      <Box flexDirection="column" gap={1}>
        {loopAreas.map(area => {
          const key = `${view.path}\n${area.name}`
          const isOpen = Object.hasOwn(openAreas, key) ? openAreas[key] === true : area.items.some(row => row.state === 'running' || row.state === 'failing')
          const status = areaStatus(area)
          return (
            <Box key={`area-box-${area.name}`} flexDirection="column" borderStyle="round" borderColor={isOpen ? 'text' : 'subtle'} paddingX={1}>
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Button
                  key={`area-${area.name}`}
                  plain
                  label={`${isOpen ? '▾' : '▸'} ${area.name}`}
                  onPress={() => update($, openAreasAtom, open => ({ ...open, [key]: !isOpen }))}
                />
                <Box flexDirection="row" gap={2} flexShrink={0}>
                  <Text>
                    {progressBar(area.done, area.total, 12)} {area.done}/{area.total}
                  </Text>
                  <Text color={status.color}>{status.text}</Text>
                </Box>
              </Box>
              {isOpen &&
                [...area.items]
                  .sort((a, b) => TASK_ORDER[a.state] - TASK_ORDER[b.state])
                  .map(row => {
                    const taskKey = `${view.path}\n${row.id}`
                    return (
                      <Box key={`task-row-${row.id}`} flexDirection="column">
                        <Box flexDirection="row" gap={1}>
                          <Box flexGrow={1} flexShrink={1}>
                            <Button
                              key={`task-${row.id}`}
                              plain
                              label={row.plain}
                              onPress={async () => {
                                await update($, technicalAtom, () => false)
                                await update($, editDraftAtom, () => null)
                                await update($, openTaskAtom, open => (open === taskKey ? null : taskKey))
                              }}
                            >
                              <Text color={TASK_MARK[row.state].color}>{TASK_MARK[row.state].icon}</Text>{' '}
                              <Text dimColor={row.state === 'done'}>{row.plain}</Text>
                            </Button>
                          </Box>
                          <Box flexShrink={0}>
                            <Text color={row.state === 'running' ? 'claude' : 'subtle'}>{taskNote(row, plainOf)}</Text>
                          </Box>
                        </Box>
                        {openTask === taskKey && taskBox(row)}
                      </Box>
                    )
                  })}
            </Box>
          )
        })}
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
            {yourChanges}
            {addForm}
            {stale}
            {areaList}
            {spend}
          </Box>
        </Box>
        {machine !== null && <Text dimColor>{machine}</Text>}
      </Box>
    )
  })
}
