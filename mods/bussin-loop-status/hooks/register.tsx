import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ItemState, LoopSnapshot } from '../types'
import { compute, formatClock, formatCost, formatDuration, formatTokens, progressBar, statusLine } from './snapshot'

const REFRESH_MS = 5000

export const PANE = 'autoloop-status'

export const snapshotAtom = atom({ plugin: 'bussin-loop-status', key: 'snapshot' } as const, null as LoopSnapshot | null)

const STATE_MARK: Record<ItemState, string> = { done: '✓', running: '▶', waiting: '…', failing: '✗', ready: '·' }
const STATE_COLOR: Record<ItemState, string> = { done: 'success', running: 'claude', waiting: 'subtle', failing: 'error', ready: 'text' }
const LOOP_COLOR: Record<LoopSnapshot['loopState'], string> = { running: 'claude', finished: 'success', stopped: 'warning', idle: 'subtle' }

async function readOptional($: EngineInterface, path: string) {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

async function loadSnapshot($: EngineInterface) {
  const loopDir = `${await $.session.root()}/.loop`
  const features = await readOptional($, `${loopDir}/feature_list.json`)
  if (features === undefined) return null
  return compute({
    features,
    usage: await readOptional($, `${loopDir}/usage.jsonl`),
    live: await readOptional($, `${loopDir}/live.json`),
    progress: await readOptional($, `${loopDir}/progress.md`),
    now: Math.floor((await $.clock.now()) / 1000),
  })
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Autoloop status' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'autoloop-status', description: 'Show the bussin-autoloop run in this project' })
    const snapshot = await loadSnapshot($)
    await update($, snapshotAtom, () => snapshot)
    $.ui.status(snapshot === null ? undefined : statusLine(snapshot))
    $.clock.every(REFRESH_MS, async () => {
      const latest = await loadSnapshot($)
      await update($, snapshotAtom, () => latest)
      $.ui.status(latest === null ? undefined : statusLine(latest))
    })
    if (snapshot?.loopState === 'running') void openPane($)
    return next(e)
  })

  on('command.run', { command: 'autoloop-status' }, async $ => {
    const snapshot = await loadSnapshot($)
    await update($, snapshotAtom, () => snapshot)
    $.ui.status(snapshot === null ? undefined : statusLine(snapshot))
    if (snapshot === null) return { text: 'No .loop/feature_list.json in this project. Start one with /bussin-autoloop init.' }
    await openPane($)
    return { text: statusLine(snapshot) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snapshot = await read($, snapshotAtom)
    if (snapshot === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No autoloop in this project.</Text>
          <Text dimColor>Start one with /bussin-autoloop init.</Text>
        </Box>
      )
    }
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 16 - snapshot.runningRows.length - snapshot.models.length)
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
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={LOOP_COLOR[snapshot.loopState]}>
              autoloop · {snapshot.loopState} · {mode}
            </Text>
            <Text dimColor>{snapshot.updatedAgoSec === null ? '' : `updated ${formatDuration(snapshot.updatedAgoSec)} ago`}</Text>
          </Box>
          <Text>
            {progressBar(snapshot.done, snapshot.total, 24)} {snapshot.done}/{snapshot.total} done · {snapshot.running} running ·{' '}
            {snapshot.waiting} waiting · {snapshot.failing} failing
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text>
            <Text bold>Time   </Text>
            elapsed {formatDuration(snapshot.elapsedSec)} · ETA {eta}
          </Text>
          <Text>
            <Text bold>Tokens </Text>
            in {formatTokens(snapshot.inputTokens)} · out {formatTokens(snapshot.outputTokens)} · cache read{' '}
            {formatTokens(snapshot.cacheReadTokens)} · cache write {formatTokens(snapshot.cacheWriteTokens)}
          </Text>
          <Text>
            <Text bold>Cost   </Text>
            {formatCost(snapshot.costUsd)} over {snapshot.sessions} sessions
            {snapshot.sessions > 0 ? ` · ${formatCost(snapshot.costUsd / snapshot.sessions)} per session` : ''}
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
