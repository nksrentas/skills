import type { LogLine } from '../types'
import { clean } from './snapshot'

export const STEPS = ['orient', 'implement', 'gate', 'review', 'browser', 'commit'] as const

export type StepState = { name: string; state: 'done' | 'now' | 'todo' }

export const SAFE_ITEM = /^[A-Za-z0-9._-]+$/

export const parseLog = (text: string | undefined, keep = 40): LogLine[] =>
  (text ?? '')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .slice(-keep)
    .map(line => {
      const [time = '', step = '-', kind = '', ...rest] = line.split('\t')
      return { time: clean(time), step: clean(step), kind: clean(kind), text: clean(rest.join(' ')) }
    })

const isStep = (step: string) => (STEPS as readonly string[]).includes(step)

export const currentStep = (lines: LogLine[]) => [...lines].reverse().find(line => isStep(line.step))?.step ?? 'orient'

export const stepStrip = (lines: LogLine[]): StepState[] => {
  const now = currentStep(lines)
  const seen = new Set(lines.map(line => line.step).filter(isStep))
  if (now !== 'orient') seen.add('orient')
  return STEPS.map(name => ({ name: name[0]?.toUpperCase() + name.slice(1), state: name === now ? 'now' : seen.has(name) ? 'done' : 'todo' }))
}
