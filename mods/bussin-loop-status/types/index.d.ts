export type ItemState = 'done' | 'running' | 'waiting' | 'failing' | 'ready'

export type ItemRow = { id: string; title: string; state: ItemState; note: string }

export type RunningRow = { item: string; title: string; worker: number; seconds: number }

export type ModelRow = { name: string; costUsd: number; inputTokens: number; outputTokens: number }

export type LoopSnapshot = {
  loopState: 'running' | 'finished' | 'stopped' | 'idle'
  mode: string
  workers: number
  total: number
  done: number
  running: number
  waiting: number
  failing: number
  elapsedSec: number
  etaSec: number | null
  finishAt: number | null
  updatedAgoSec: number | null
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
  recent: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'bussin-loop-status': { snapshot: LoopSnapshot | null }
  }
}
