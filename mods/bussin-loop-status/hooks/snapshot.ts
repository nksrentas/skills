import type { BlockedGroup, ItemRow, LoopSnapshot, ModelRow, RunningRow, SessionRow } from '../types'

type Feature = { id: string; description?: string; passes?: boolean; depends_on?: string[] }

type Usage = {
  item: string
  outcome: string
  duration_ms?: number
  cost_usd?: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  started_at?: number
  ended_at?: number
  models?: Record<string, { input_tokens?: number; output_tokens?: number; cost_usd?: number }>
}

type Live = {
  state?: string
  mode?: string
  agent?: string
  script?: string
  pid?: number
  workers?: number
  started_at?: number
  updated_at?: number
  running?: { item: string; worker: number; started_at?: number }[]
  machine?: { sessions: number; inUse: number }
}

export type LoopFiles = {
  features: string
  usage?: string
  live?: string
  attempts?: string
  stopRequested?: boolean
  driverAlive?: boolean
  now: number
}

const parseJson = <T>(text: string | undefined): T | undefined => {
  if (!text) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

const SILENT_DRIVER_SEC = 15 * 60

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

export const clean = (text: unknown) => String(text ?? '').replace(CONTROL_CHARACTERS, '')

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const optionalNum = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toUsage = (row: Record<string, unknown>): Usage => ({
  item: clean(row.item),
  outcome: clean(row.outcome),
  duration_ms: num(row.duration_ms),
  cost_usd: optionalNum(row.cost_usd),
  input_tokens: num(row.input_tokens),
  output_tokens: num(row.output_tokens),
  cache_read_tokens: num(row.cache_read_tokens),
  cache_write_tokens: num(row.cache_write_tokens),
  started_at: optionalNum(row.started_at),
  ended_at: optionalNum(row.ended_at),
  models: Object.fromEntries(
    Object.entries(isRecord(row.models) ? row.models : {}).map(([name, model]) => {
      const fields = isRecord(model) ? model : {}
      return [clean(name), { input_tokens: num(fields.input_tokens), output_tokens: num(fields.output_tokens), cost_usd: num(fields.cost_usd) }]
    }),
  ),
})

const toLive = (value: unknown): Live | undefined => {
  if (!isRecord(value)) return undefined
  return {
    state: clean(value.state),
    mode: clean(value.mode ?? 'sequential'),
    agent: clean(value.agent ?? ''),
    script: typeof value.script === 'string' ? clean(value.script) : undefined,
    pid: optionalNum(value.pid),
    workers: Math.max(1, Math.floor(num(value.workers) || 1)),
    started_at: optionalNum(value.started_at),
    updated_at: optionalNum(value.updated_at),
    running: (Array.isArray(value.running) ? value.running : [])
      .filter(isRecord)
      .map(row => ({ item: clean(row.item), worker: Math.floor(num(row.worker)), started_at: optionalNum(row.started_at) })),
    machine: isRecord(value.machine)
      ? { sessions: Math.max(1, Math.floor(num(value.machine.sessions) || 1)), inUse: Math.max(0, Math.floor(num(value.machine.in_use))) }
      : undefined,
  }
}

const toFeature = (value: Record<string, unknown>): Feature => ({
  id: clean(value.id),
  description: clean(value.description),
  passes: value.passes === true,
  depends_on: (Array.isArray(value.depends_on) ? value.depends_on : []).map(clean),
})

const parseLines = (text: string | undefined): Usage[] =>
  (text ?? '')
    .split('\n')
    .map(line => parseJson<unknown>(line.trim()))
    .filter(isRecord)
    .filter(row => typeof row.item === 'string')
    .map(toUsage)

const sum = (rows: Usage[], pick: (row: Usage) => number | undefined) =>
  rows.reduce((total, row) => total + (pick(row) ?? 0), 0)

const title = (feature: Feature | undefined) => feature?.description ?? ''

const loopStateOf = (live: Live | undefined, done: number, total: number, stopRequested: boolean): LoopSnapshot['loopState'] => {
  if (live?.state === 'running' && stopRequested) return 'stopping'
  if (live?.state === 'running' || live?.state === 'stopping' || live?.state === 'queued' || live?.state === 'finished' || live?.state === 'stopped') return live.state
  return done === total && total > 0 ? 'finished' : 'idle'
}

export const isActive = (loopState: LoopSnapshot['loopState']) => loopState === 'running' || loopState === 'stopping' || loopState === 'queued'

const modelRows = (usage: Usage[]): ModelRow[] => {
  const byName = new Map<string, ModelRow>()
  for (const row of usage) {
    for (const [name, model] of Object.entries(row.models ?? {})) {
      const label = name
      const seen = byName.get(label) ?? { name: label, costUsd: 0, priced: false, inputTokens: 0, outputTokens: 0 }
      const priced = row.cost_usd !== undefined
      byName.set(label, {
        name: label,
        costUsd: seen.costUsd + (priced ? (model.cost_usd ?? 0) : 0),
        priced: seen.priced || priced,
        inputTokens: seen.inputTokens + (model.input_tokens ?? 0),
        outputTokens: seen.outputTokens + (model.output_tokens ?? 0),
      })
    }
  }
  return [...byName.values()].sort((a, b) => b.costUsd - a.costUsd)
}

const spend = (sessions: Usage[]) => {
  const priced = sessions.filter(row => row.cost_usd !== undefined)
  const minutes = Math.round(sum(sessions, row => row.duration_ms) / 60000)
  return [
    priced.length > 0 ? formatCost(sum(priced, row => row.cost_usd)) : sessions.length > 0 ? 'cost unknown' : '',
    minutes > 0 ? `${minutes}m` : '',
  ].filter(Boolean)
}

const itemRow = (feature: Feature, passed: Set<string>, running: Map<string, number>, usage: Usage[]): ItemRow => {
  const sessions = usage.filter(row => row.item === feature.id)
  if (feature.passes) {
    return { id: feature.id, title: title(feature), state: 'done', note: spend(sessions).join(' · ') || 'done' }
  }
  const worker = running.get(feature.id)
  if (worker !== undefined) {
    return { id: feature.id, title: title(feature), state: 'running', note: worker > 0 ? `worker ${worker}` : 'now' }
  }
  if (sessions.length > 0) {
    const attempts = sessions.length === 1 ? '1 attempt' : `${sessions.length} attempts`
    return { id: feature.id, title: title(feature), state: 'failing', note: [attempts, ...spend(sessions)].join(' · ') }
  }
  const waitingFor = (feature.depends_on ?? []).filter(id => !passed.has(id))
  if (waitingFor.length > 0) {
    return { id: feature.id, title: title(feature), state: 'waiting', note: `waiting for ${waitingFor.join(', ')}`, waitingFor }
  }
  return { id: feature.id, title: title(feature), state: 'ready', note: 'ready' }
}

const OUTCOME_OK: Record<string, boolean> = { passed: true, merged: true, failed: false, error: false, 'not merged': false }

const sessionRows = (usage: Usage[]): SessionRow[] =>
  usage
    .slice(-3)
    .reverse()
    .map(row => ({
      item: row.item,
      outcome: row.outcome,
      ok: OUTCOME_OK[row.outcome] ?? null,
      seconds: Math.round((row.duration_ms ?? 0) / 1000),
      costUsd: row.cost_usd ?? null,
      endedAt: row.ended_at ?? null,
    }))

const blockedGroups = (items: ItemRow[]): BlockedGroup[] => {
  const groups = new Map<string, string[]>()
  for (const row of items) {
    if (row.state !== 'waiting') continue
    const key = (row.waitingFor ?? []).join(', ')
    groups.set(key, [...(groups.get(key) ?? []), row.id])
  }
  return [...groups.entries()].map(([waitingFor, ids]) => ({ waitingFor, items: ids })).sort((a, b) => b.items.length - a.items.length)
}

const attemptCounts = (text: string | undefined) => {
  const parsed = parseJson<unknown>(text)
  return isRecord(parsed) ? parsed : {}
}

export const compute = (files: LoopFiles): LoopSnapshot | null => {
  const parsed = parseJson<unknown>(files.features)
  const list = isRecord(parsed) ? parsed.features : undefined
  if (!Array.isArray(list)) return null
  const features = list.filter(isRecord).map(toFeature)
  const usage = parseLines(files.usage)
  const live = toLive(parseJson<unknown>(files.live))
  const passed = new Set(features.filter(feature => feature.passes).map(feature => feature.id))
  const runningList = live?.state === 'running' || live?.state === 'stopping' ? (live.running ?? []) : []
  const running = new Map(runningList.map(row => [row.item, row.worker]))
  const items = features.map(feature => itemRow(feature, passed, running, usage))
  const total = features.length
  const done = passed.size
  const loopState = loopStateOf(live, done, total, files.stopRequested === true)
  const mode = live?.mode ?? 'sequential'
  const workers = live?.workers ?? 1
  const silent = files.driverAlive === undefined && runningList.length > 0 && files.now - (live?.updated_at ?? files.now) > SILENT_DRIVER_SEC
  const stale = isActive(loopState) && (files.driverAlive === false || silent)
  const firstStart = live?.started_at ?? usage[0]?.started_at
  const lastSeen = isActive(loopState) && !stale ? files.now : (live?.updated_at ?? usage[usage.length - 1]?.ended_at ?? files.now)
  const elapsedSec = firstStart === undefined ? 0 : Math.max(0, lastSeen - firstStart)
  const remaining = total - done
  const sessionSec = sum(usage, row => row.duration_ms) / 1000
  const parallelism = mode === 'parallel' ? Math.max(1, Math.min(workers, remaining)) : 1
  const doneByLoop = new Set(usage.filter(row => passed.has(row.item)).map(row => row.item)).size
  const attempts = attemptCounts(files.attempts)
  const etaSec =
    loopState === 'running' && !stale && doneByLoop > 0 && remaining > 0 ? Math.round((remaining * sessionSec) / doneByLoop / parallelism) : null
  const runningRows: RunningRow[] = runningList.map(row => ({
    item: row.item,
    title: title(features.find(feature => feature.id === row.item)),
    worker: row.worker,
    seconds: Math.max(0, files.now - (row.started_at ?? files.now)),
    attempt: Math.floor(num(attempts[row.item])),
  }))
  return {
    loopState,
    stale,
    mode,
    agent: live?.agent ?? '',
    script: live?.script ?? null,
    workers,
    total,
    done,
    running: runningRows.length,
    ready: items.filter(row => row.state === 'ready').length,
    waiting: items.filter(row => row.state === 'waiting').length,
    failing: items.filter(row => row.state === 'failing').length,
    elapsedSec,
    etaSec,
    finishAt: etaSec === null ? null : files.now + etaSec,
    sessions: usage.length,
    unpricedSessions: usage.filter(row => row.cost_usd === undefined).length,
    costUsd: sum(usage, row => row.cost_usd),
    inputTokens: sum(usage, row => row.input_tokens),
    outputTokens: sum(usage, row => row.output_tokens),
    cacheReadTokens: sum(usage, row => row.cache_read_tokens),
    cacheWriteTokens: sum(usage, row => row.cache_write_tokens),
    models: modelRows(usage),
    runningRows,
    items,
    blockedGroups: blockedGroups(items),
    recent: sessionRows(usage),
    machine: live?.machine ?? null,
  }
}

export const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return `${Math.max(0, Math.round(seconds))}s`
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export const formatTokens = (count: number) => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`
  return String(count)
}

export const formatCost = (usd: number) => `$${usd.toFixed(2)}`

export const formatClock = (epochSec: number) => {
  const at = new Date(epochSec * 1000)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export const progressBar = (done: number, total: number, width: number) => {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const pricedCost = (snapshot: LoopSnapshot) =>
  snapshot.sessions - snapshot.unpricedSessions > 0 ? formatCost(snapshot.costUsd) : undefined

export const statusLine = (snapshot: LoopSnapshot) => {
  const progress = `${snapshot.done}/${snapshot.total}`
  const cost = pricedCost(snapshot)
  const elapsed = snapshot.elapsedSec > 0 ? formatDuration(snapshot.elapsedSec) : undefined
  const parts = (head: string, ...rest: (string | undefined)[]) => [head, ...rest].filter(Boolean).join(' · ')
  if (snapshot.stale) return parts(`autoloop driver not running at ${progress}`, cost)
  if (snapshot.loopState === 'running') {
    const eta = snapshot.etaSec === null ? 'ETA after first item' : `ETA ${formatDuration(snapshot.etaSec)}`
    return parts(`autoloop ${progress} done`, `${snapshot.running} running`, eta, cost)
  }
  if (snapshot.loopState === 'stopping') return parts(`autoloop stopping at ${progress}`, `${snapshot.running} running`, cost)
  if (snapshot.loopState === 'queued') return parts(`autoloop queued at ${progress}`, 'waiting for a free session on this Mac', cost)
  if (snapshot.loopState === 'finished') return parts(`autoloop finished ${progress}`, elapsed, cost)
  if (snapshot.loopState === 'stopped') return parts(`autoloop stopped at ${progress}`, cost)
  return parts(`autoloop ${progress} done`, 'not running')
}

export const parentDir = (path: string) => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'

export const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path

export const commonDirFromGitFile = (text: string) => {
  const match = /^gitdir:\s*(.+)$/m.exec(text)
  return match?.[1] === undefined ? undefined : parentDir(parentDir(match[1].trim()))
}

const LOOP_ORDER: Record<LoopSnapshot['loopState'], number> = { running: 0, stopping: 0, queued: 0, stopped: 1, idle: 2, finished: 3 }

export const orderLoops = <T extends { name: string; snapshot: LoopSnapshot }>(loops: T[]) =>
  [...loops].sort((a, b) => LOOP_ORDER[a.snapshot.loopState] - LOOP_ORDER[b.snapshot.loopState] || a.name.localeCompare(b.name))

const labelOf = (text: string) => {
  const head = text.split(': ')[0] ?? text
  const title = head.length > 0 && head.length <= 40 ? head : text
  return title.length > 40 ? `${title.slice(0, 41).replace(/\s+\S*$/, '')}…` : title
}

export const customName = (text: string | undefined) => clean((text ?? '').split('\n')[0]).trim().slice(0, 60)

export const loopTask = (config: string | undefined) => {
  const parsed = parseJson<unknown>(config)
  return isRecord(parsed) ? clean(parsed.task ?? '').trim() : ''
}

export const loopLabel = (config: string | undefined, folder: string, nameFile?: string) => {
  const custom = customName(nameFile)
  if (custom.length > 0) return custom
  const parsed = parseJson<unknown>(config)
  const fields = isRecord(parsed) ? parsed : {}
  const named = clean(fields.name ?? '').trim()
  if (named.length > 0) return labelOf(named)
  const task = clean(fields.task ?? '').trim()
  if (task.length > 0) return labelOf(task.split(/\.\s/)[0] ?? task)
  return folder
}

export const distinctLabels = <T extends { name: string; label: string }>(loops: T[]) =>
  loops.map(loop =>
    loops.filter(other => other.label === loop.label).length > 1 ? { ...loop, label: `${loop.label} (${loop.name})` } : loop,
  )

export const shortName = (name: string, repoName: string | undefined) =>
  repoName !== undefined && name !== repoName && name.startsWith(`${repoName}-`) ? name.slice(repoName.length + 1) : name

export const compactLine = (name: string, snapshot: LoopSnapshot) => {
  if (snapshot.stale) return [`⚠ ${name} ${snapshot.done}/${snapshot.total} driver not running`, pricedCost(snapshot)].filter(Boolean).join(' · ')
  if (snapshot.loopState === 'stopping') return [`◌ ${name} ${snapshot.done}/${snapshot.total} stopping`, pricedCost(snapshot)].filter(Boolean).join(' · ')
  if (snapshot.loopState === 'queued') return [`◌ ${name} ${snapshot.done}/${snapshot.total} queued`, pricedCost(snapshot)].filter(Boolean).join(' · ')
  const eta = snapshot.etaSec === null ? 'ETA after first item' : `ETA ${formatDuration(snapshot.etaSec)}`
  return [`● ${name} ${snapshot.done}/${snapshot.total}`, eta, pricedCost(snapshot)].filter(Boolean).join(' · ')
}

export const shortTitle = (text: string, max = 64) => {
  const head = text.split(/:\s/)[0]?.trim() ?? text
  const title = head.length > 0 && head.length <= max ? head : text
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title
}

export const shortModel = (name: string) => name.replace(/^claude-/, '')

const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

const DRIVER_PATH = /^\/(?:[^/\0]+\/)*bussin-autoloop\/scripts\/loop\.sh$/

const KNOWN_AGENTS = ['claude', 'codex', 'copilot']

const trustedDriver = (path: string, script: string) =>
  DRIVER_PATH.test(script) && !script.split('/').includes('..') && !`${script}/`.startsWith(`${path.replace(/\/+$/, '')}/`)

export const resumeCommand = (path: string, snapshot: LoopSnapshot) => {
  if (snapshot.script === null || !trustedDriver(path, snapshot.script) || !KNOWN_AGENTS.includes(snapshot.agent || 'claude')) return null
  const env = [
    snapshot.agent !== '' && snapshot.agent !== 'claude' ? `LOOP_AGENT=${snapshot.agent}` : '',
    snapshot.mode === 'parallel' ? `LOOP_WORKERS=${snapshot.workers}` : '',
  ].filter(Boolean)
  return `cd ${shellQuote(path)} && ${[...env, 'bash', shellQuote(snapshot.script)].join(' ')}`
}

export const isWorkerHead = (head: string | undefined) => /^ref: refs\/heads\/loop\/[^/\s]+\/[^/\s]+\s*$/.test(head ?? '')

export const isDriverCommand = (command: string) => /(^|[\s/])loop\.sh(\s|$)/.test(command.trim().split('\n')[0] ?? '')

export const livePid = (text: string | undefined) => {
  const live = toLive(parseJson<unknown>(text))
  return (live?.state === 'running' || live?.state === 'stopping') && live.pid !== undefined && Number.isInteger(live.pid) && live.pid > 0 ? live.pid : undefined
}
