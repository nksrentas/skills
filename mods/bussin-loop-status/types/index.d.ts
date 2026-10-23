export type ItemState = 'done' | 'running' | 'waiting' | 'failing' | 'ready'

export type ItemRow = { id: string; title: string; state: ItemState; note: string; waitingFor?: string[] }

export type BlockedGroup = { waitingFor: string; items: string[] }

export type SessionRow = { item: string; outcome: string; ok: boolean | null; seconds: number; costUsd: number | null; endedAt: number | null }

export type RunningRow = { item: string; title: string; worker: number; seconds: number; attempt: number }

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
  etaSec: number | null
  finishAt: number | null
  sessions: number
  unpricedSessions: number
  hasLiveData: boolean
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  models: ModelRow[]
  runningRows: RunningRow[]
  items: ItemRow[]
  blockedGroups: BlockedGroup[]
  recent: SessionRow[]
  machine: { sessions: number; inUse: number } | null
}

export type LogLine = { time: string; step: string; kind: string; text: string }

export type LoopView = { name: string; label: string; task: string; path: string; snapshot: LoopSnapshot; logs: Record<string, LogLine[]> }

declare module 'claude-code' {
  interface PluginState {
    'bussin-loop-status': { loops: LoopView[]; selected: string | null; renaming: string | null; showTokens: boolean }
  }
}
