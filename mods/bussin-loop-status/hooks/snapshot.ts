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

const parseLines = (text: string | undefined): Usage[] =>
  (text ?? '')
    .split('\n')
    .map(line => parseJson<Usage>(line.trim()))
    .filter((row): row is Usage => row !== undefined && typeof row.item === 'string')

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

const clean = (text: unknown) => String(text ?? '').replace(CONTROL_CHARACTERS, '')

const sum = (rows: Usage[], pick: (row: Usage) => number | undefined) =>
  rows.reduce((total, row) => total + (pick(row) ?? 0), 0)

const title = (feature: Feature | undefined) => clean(feature?.description)

const loopStateOf = (live: Live | undefined, done: number, total: number): LoopSnapshot['loopState'] => {
  if (live?.state === 'running' || live?.state === 'finished' || live?.state === 'stopped') return live.state
  return done === total && total > 0 ? 'finished' : 'idle'
}

const modelRows = (usage: Usage[]): ModelRow[] => {
  const byName = new Map<string, ModelRow>()
  for (const row of usage) {
    for (const [name, model] of Object.entries(row.models ?? {})) {
      const label = clean(name)
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

const itemRow = (feature: Feature, passed: Set<string>, running: Map<string, number>, usage: Usage[]): ItemRow => {
  const sessions = usage.filter(row => row.item === feature.id)
  const cost = sum(sessions, row => row.cost_usd)
  const minutes = Math.round(sum(sessions, row => row.duration_ms) / 60000)
  if (feature.passes) {
    return { id: feature.id, title: title(feature), state: 'done', note: `${formatCost(cost)} · ${minutes}m` }
  }
  const worker = running.get(feature.id)
  if (worker !== undefined) {
    return { id: feature.id, title: title(feature), state: 'running', note: worker > 0 ? `worker ${worker}` : 'now' }
  }
  if (sessions.length > 0) {
    const attempts = sessions.length === 1 ? '1 attempt' : `${sessions.length} attempts`
    return { id: feature.id, title: title(feature), state: 'failing', note: `${attempts}, ${formatCost(cost)}` }
  }
  const waitingFor = (feature.depends_on ?? []).filter(id => !passed.has(id))
  if (waitingFor.length > 0) {
    return { id: feature.id, title: title(feature), state: 'waiting', note: `waiting for ${waitingFor.join(', ')}` }
  }
  return { id: feature.id, title: title(feature), state: 'ready', note: 'ready' }
}

export const compute = (files: LoopFiles): LoopSnapshot | null => {
  const parsed = parseJson<{ features?: Feature[] }>(files.features)?.features
  if (!Array.isArray(parsed)) return null
  const features = parsed.map(feature => ({
    ...feature,
    id: clean(feature.id),
    depends_on: (feature.depends_on ?? []).map(clean),
  }))
  const usage = parseLines(files.usage).map(row => ({ ...row, item: clean(row.item) }))
  const live = parseJson<Live>(files.live)
  const passed = new Set(features.filter(feature => feature.passes).map(feature => feature.id))
  const runningList = (live?.state === 'running' ? (live.running ?? []) : []).map(row => ({ ...row, item: clean(row.item) }))
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
    mode: clean(mode),
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

export const statusLine = (snapshot: LoopSnapshot) => {
  const progress = `${snapshot.done}/${snapshot.total}`
  const cost = formatCost(snapshot.costUsd)
  if (snapshot.loopState === 'running') {
    const eta = snapshot.etaSec === null ? 'ETA after first item' : `ETA ${formatDuration(snapshot.etaSec)}`
    return `autoloop ${progress} done · ${snapshot.running} running · ${eta} · ${cost}`
  }
  if (snapshot.loopState === 'finished') return `autoloop finished ${progress} · ${formatDuration(snapshot.elapsedSec)} · ${cost}`
  if (snapshot.loopState === 'stopped') return `autoloop stopped at ${progress} · ${cost}`
  return `autoloop ${progress} done · not running`
}
