import type { ItemRow, LoopSnapshot, ModelRow, RunningRow } from '../types'

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
  workers?: number
  started_at?: number
  updated_at?: number
  running?: { item: string; worker: number; started_at: number }[]
}

export type LoopFiles = { features: string; usage?: string; live?: string; progress?: string; now: number }

const parseJson = <T>(text: string | undefined): T | undefined => {
  if (!text) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

const clean = (text: unknown) => String(text ?? '').replace(CONTROL_CHARACTERS, '')

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
    workers: Math.max(1, Math.floor(num(value.workers) || 1)),
    started_at: optionalNum(value.started_at),
    updated_at: optionalNum(value.updated_at),
    running: (Array.isArray(value.running) ? value.running : [])
      .filter(isRecord)
      .map(row => ({ item: clean(row.item), worker: Math.floor(num(row.worker)), started_at: num(row.started_at) })),
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

const loopStateOf = (live: Live | undefined, done: number, total: number): LoopSnapshot['loopState'] => {
  if (live?.state === 'running' || live?.state === 'finished' || live?.state === 'stopped') return live.state
  return done === total && total > 0 ? 'finished' : 'idle'
}

const modelRows = (usage: Usage[]): ModelRow[] => {
  const byName = new Map<string, ModelRow>()
  for (const row of usage) {
    for (const [name, model] of Object.entries(row.models ?? {})) {
      const label = name
      const seen = byName.get(label) ?? { name: label, costUsd: 0, inputTokens: 0, outputTokens: 0 }
      byName.set(label, {
        name: label,
        costUsd: seen.costUsd + (model.cost_usd ?? 0),
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
    return { id: feature.id, title: title(feature), state: 'waiting', note: `waiting for ${waitingFor.join(', ')}` }
  }
  return { id: feature.id, title: title(feature), state: 'ready', note: 'ready' }
}

export const compute = (files: LoopFiles): LoopSnapshot | null => {
  const parsed = parseJson<unknown>(files.features)
  const list = isRecord(parsed) ? parsed.features : undefined
  if (!Array.isArray(list)) return null
  const features = list.filter(isRecord).map(toFeature)
  const usage = parseLines(files.usage)
  const live = toLive(parseJson<unknown>(files.live))
  const passed = new Set(features.filter(feature => feature.passes).map(feature => feature.id))
  const runningList = live?.state === 'running' ? (live.running ?? []) : []
  const running = new Map(runningList.map(row => [row.item, row.worker]))
  const items = features.map(feature => itemRow(feature, passed, running, usage))
  const total = features.length
  const done = passed.size
  const loopState = loopStateOf(live, done, total)
  const mode = live?.mode ?? 'sequential'
  const workers = live?.workers ?? 1
  const firstStart = live?.started_at ?? usage[0]?.started_at
  const lastSeen = loopState === 'running' ? files.now : (live?.updated_at ?? usage[usage.length - 1]?.ended_at ?? files.now)
  const elapsedSec = firstStart === undefined ? 0 : Math.max(0, lastSeen - firstStart)
  const remaining = total - done
  const sessionSec = sum(usage, row => row.duration_ms) / 1000
  const parallelism = mode === 'parallel' ? Math.max(1, Math.min(workers, remaining)) : 1
  const etaSec = loopState === 'running' && done > 0 && remaining > 0 ? Math.round((remaining * sessionSec) / done / parallelism) : null
  const runningRows: RunningRow[] = runningList.map(row => ({
    item: row.item,
    title: title(features.find(feature => feature.id === row.item)),
    worker: row.worker,
    seconds: Math.max(0, files.now - row.started_at),
  }))
  const recent = (files.progress ?? '')
    .split('\n')
    .filter(line => line.startsWith('## '))
    .slice(-3)
    .map(line => clean(line.slice(3)).trim())
  return {
    loopState,
    mode,
    workers,
    total,
    done,
    running: runningRows.length,
    waiting: items.filter(row => row.state === 'waiting').length,
    failing: items.filter(row => row.state === 'failing').length,
    elapsedSec,
    etaSec,
    finishAt: etaSec === null ? null : files.now + etaSec,
    updatedAgoSec: live?.updated_at === undefined ? null : Math.max(0, files.now - live.updated_at),
    sessions: usage.length,
    unpricedSessions: usage.filter(row => row.cost_usd === undefined).length,
    hasLiveData: live !== undefined,
    costUsd: sum(usage, row => row.cost_usd),
    inputTokens: sum(usage, row => row.input_tokens),
    outputTokens: sum(usage, row => row.output_tokens),
    cacheReadTokens: sum(usage, row => row.cache_read_tokens),
    cacheWriteTokens: sum(usage, row => row.cache_write_tokens),
    models: modelRows(usage),
    runningRows,
    items,
    recent,
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
  if (snapshot.loopState === 'running') {
    const eta = snapshot.etaSec === null ? 'ETA after first item' : `ETA ${formatDuration(snapshot.etaSec)}`
    return parts(`autoloop ${progress} done`, `${snapshot.running} running`, eta, cost)
  }
  if (snapshot.loopState === 'finished') return parts(`autoloop finished ${progress}`, elapsed, cost)
  if (snapshot.loopState === 'stopped') return parts(`autoloop stopped at ${progress}`, cost)
  return parts(`autoloop ${progress} done`, snapshot.hasLiveData ? 'not running' : 'no live data')
}

export const parentDir = (path: string) => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'

export const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path

export const commonDirFromGitFile = (text: string) => {
  const match = /^gitdir:\s*(.+)$/m.exec(text)
  return match?.[1] === undefined ? undefined : parentDir(parentDir(match[1].trim()))
}

const LOOP_ORDER: Record<LoopSnapshot['loopState'], number> = { running: 0, stopped: 1, idle: 2, finished: 3 }

export const orderLoops = <T extends { name: string; snapshot: LoopSnapshot }>(loops: T[]) =>
  [...loops].sort((a, b) => LOOP_ORDER[a.snapshot.loopState] - LOOP_ORDER[b.snapshot.loopState] || a.name.localeCompare(b.name))
