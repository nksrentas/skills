export type ItemState = 'done' | 'running' | 'waiting' | 'failing' | 'ready'

export type Metric = { name: string; value: number | null; target: number | null }

export type ItemRow = {
  id: string
  state: ItemState
  waitingFor?: string[]
  area: string
  plain: string
  doneWhen: string
  kind: 'build' | 'eval' | 'design'
  description: string
  verify: string
  metrics: Metric[]
  screenshots: string[]
  review: 'approved' | 'changes' | null
  finishedAt: number | null
  phase: string | null
}

export type Area = { name: string; done: number; total: number; items: ItemRow[] }

export type RunningRow = { item: string; worker: number; seconds: number; attempt: number }

export type ModelRow = { name: string; costUsd: number; priced: boolean; inputTokens: number; outputTokens: number }

export type LoopSnapshot = {
  loopState: 'running' | 'stopping' | 'queued' | 'finished' | 'stopped' | 'idle'
  stale: boolean
  mode: string
  agent: string
  script: string | null
  workers: number
  total: number
  done: number
  running: number
  ready: number
  waiting: number
  failing: number
  elapsedSec: number
  lastActivityAt: number | null
  etaSec: number | null
  finishAt: number | null
  sessions: number
  unpricedSessions: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  models: ModelRow[]
  runningRows: RunningRow[]
  items: ItemRow[]
  machine: { sessions: number; inUse: number } | null
}

export type LogLine = { time: string; step: string; kind: string; text: string }

export type LoopView = { name: string; label: string; task: string; path: string; snapshot: LoopSnapshot; logs: Record<string, LogLine[]> }

declare module 'claude-code' {
  interface PluginState {
    'bussin-loop-status': { loops: LoopView[]; selected: string | null; renaming: string | null; showTokens: boolean; openAreas: Record<string, boolean> }
  }
}
