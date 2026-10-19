import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { PANE } from './register'
import { commonDirFromGitFile, compactLine, compute, formatDuration, formatTokens, shortModel, shortName, shortTitle, statusLine } from './snapshot'

const NOW = 4000

const FEATURES = JSON.stringify({
  features: [
    { id: 'F1', description: 'Export button', passes: true },
    { id: 'F2', description: 'CSV download', passes: false },
    { id: 'E1', description: 'Empty export', passes: false, depends_on: ['F2'] },
    { id: 'R1', description: 'Filters unchanged', passes: false },
  ],
})

const USAGE = [
  {
    item: 'F1', outcome: 'merged', duration_ms: 600000, cost_usd: 1.5,
    input_tokens: 1000, output_tokens: 200, cache_read_tokens: 5000, cache_write_tokens: 100,
    started_at: 1000, ended_at: 1600,
    models: { 'claude-opus-5-5': { input_tokens: 1000, output_tokens: 200, cost_usd: 1.5 } },
  },
  {
    item: 'R1', outcome: 'failed', duration_ms: 300000, cost_usd: 0.5,
    input_tokens: 400, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0,
    started_at: 1700, ended_at: 2000,
    models: { 'claude-haiku-4-5': { input_tokens: 400, output_tokens: 50, cost_usd: 0.5 } },
  },
]
  .map(row => JSON.stringify(row))
  .join('\n')

const LIVE = JSON.stringify({
  state: 'running', mode: 'parallel', workers: 2, started_at: 1000, updated_at: 3990,
  running: [{ item: 'F2', worker: 1, started_at: 3700 }],
})

const PROGRESS = '# Task\n\n## F1 · worker 1 · 2026-10-18\nDid: button\n\n## R1 · worker 2 · 2026-10-18\nDid: nothing yet\n'

const running = () => compute({ features: FEATURES, usage: USAGE, live: LIVE, progress: PROGRESS, now: NOW })

test('counts items by state from the loop files', async () => {
  const snapshot = running()
  expect(snapshot).not.toBeNull()
  expect(snapshot?.total).toBe(4)
  expect(snapshot?.done).toBe(1)
  expect(snapshot?.running).toBe(1)
  expect(snapshot?.waiting).toBe(1)
  expect(snapshot?.failing).toBe(1)
  expect(snapshot?.items.map(row => `${row.id}:${row.state}`)).toEqual(['F1:done', 'F2:running', 'E1:waiting', 'R1:failing'])
})

test('estimates the finish from time per passed item and the worker count', async () => {
  const snapshot = running()
  expect(snapshot?.elapsedSec).toBe(3000)
  expect(snapshot?.etaSec).toBe(1350)
  expect(snapshot?.finishAt).toBe(NOW + 1350)
})

test('sums tokens and cost and breaks them down by model', async () => {
  const snapshot = running()
  expect(snapshot?.sessions).toBe(2)
  expect(snapshot?.costUsd).toBe(2)
  expect(snapshot?.inputTokens).toBe(1400)
  expect(snapshot?.outputTokens).toBe(250)
  expect(snapshot?.cacheReadTokens).toBe(5000)
  expect(snapshot?.models.map(model => model.name)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
  expect(snapshot?.recent).toEqual(['F1 · worker 1 · 2026-10-18', 'R1 · worker 2 · 2026-10-18'])
})

test('has no estimate before the first item passes, and none once finished', async () => {
  const fresh = JSON.stringify({ features: [{ id: 'A', passes: false }] })
  expect(compute({ features: fresh, live: LIVE, now: NOW })?.etaSec).toBeNull()
  const finished = JSON.stringify({ state: 'finished', started_at: 1000, updated_at: 2000, running: [] })
  const done = JSON.stringify({ features: [{ id: 'A', passes: true }] })
  const snapshot = compute({ features: done, live: finished, now: NOW })
  expect(snapshot?.loopState).toBe('finished')
  expect(snapshot?.etaSec).toBeNull()
  expect(snapshot?.elapsedSec).toBe(1000)
})

test('ignores a broken feature list and broken usage lines', async () => {
  expect(compute({ features: '{ not json', now: NOW })).toBeNull()
  const snapshot = compute({ features: FEATURES, usage: `${USAGE}\n{ half a line`, live: LIVE, now: NOW })
  expect(snapshot?.sessions).toBe(2)
})

test('strips terminal control characters from everything read out of the repo', async () => {
  const hostile = JSON.stringify({ features: [{ id: 'F\u001b[2J1', description: 'Title\u001b]0;pwned\u0007 here', passes: false, depends_on: ['X\u0007'] }] })
  const hostileLive = JSON.stringify({ state: 'running', mode: 'par\u001ballel', started_at: 1, updated_at: 2, running: [] })
  const hostileUsage = JSON.stringify({ item: 'F\u001b1', outcome: 'failed', models: { 'evil\u001b[31m': { cost_usd: 1 } } })
  const snapshot = compute({ features: hostile, usage: hostileUsage, live: hostileLive, progress: '## note\u001b[2J here', now: NOW })
  const shown = JSON.stringify(snapshot)
  expect(/[\u0000-\u001f\u007f-\u009f]/.test(shown.replace(/\\u00[0-9a-f]{2}/g, ''))).toBe(false)
  expect(shown).not.toContain('\\u001b')
  expect(snapshot?.items[0]?.id).toBe('F[2J1')
  expect(snapshot?.items[0]?.note).toBe('waiting for X')
  expect(snapshot?.models[0]?.name).toBe('evil[31m')
  expect(snapshot?.recent).toEqual(['note[2J here'])
})

test('ignores numbers that are not numbers in the loop files', async () => {
  const live = JSON.stringify({ state: 'running', mode: 'parallel', workers: '\u001b[2J9', started_at: 'soon', updated_at: 2, running: [{ item: 'A', worker: '\u001b1', started_at: 'x' }] })
  const usage = JSON.stringify({ item: 'A', outcome: 'failed', cost_usd: '\u001b[31m9', input_tokens: '5', duration_ms: null, models: { m: { cost_usd: 'NaN' } } })
  const features = JSON.stringify({ features: [{ id: 'A', passes: 'yes' }, { id: 'B', passes: true }] })
  const snapshot = compute({ features, usage, live, now: NOW })
  expect(snapshot?.workers).toBe(1)
  expect(snapshot?.costUsd).toBe(0)
  expect(snapshot?.inputTokens).toBe(0)
  expect(snapshot?.models[0]?.costUsd).toBe(0)
  expect(snapshot?.runningRows[0]?.worker).toBe(0)
  expect(snapshot?.done).toBe(1)
  expect(JSON.stringify(snapshot)).not.toContain('\\u001b')
})

test('a run recovered from transcripts shows tokens and time, marks cost unknown, and asks for a restart', async () => {
  const features = JSON.stringify({ features: [{ id: 'F1', description: 'One', passes: true }, { id: 'F2', description: 'Two', passes: true }, { id: 'F3', description: 'Three', passes: false }] })
  const usage = [
    { item: 'F1', outcome: 'backfilled', duration_ms: 840000, input_tokens: 10, output_tokens: 2000, started_at: 1000, ended_at: 1840, models: { 'claude-opus-5-5': { input_tokens: 10, output_tokens: 2000 } } },
    { item: 'F2', outcome: 'backfilled', duration_ms: 600000, input_tokens: 20, output_tokens: 1000, started_at: 1900, ended_at: 2500, models: { 'claude-opus-5-5': { input_tokens: 20, output_tokens: 1000 } } },
  ]
    .map(row => JSON.stringify(row))
    .join('\n')
  const snapshot = compute({ features, usage, now: NOW })
  expect(snapshot?.hasLiveData).toBe(false)
  expect(snapshot?.unpricedSessions).toBe(2)
  expect(snapshot?.costUsd).toBe(0)
  expect(snapshot?.outputTokens).toBe(3000)
  expect(snapshot?.elapsedSec).toBe(1500)
  expect(snapshot?.items[0]?.note).toBe('cost unknown · 14m')
  expect(snapshot && statusLine(snapshot)).toBe('autoloop 2/3 done · no live data')
})

test('a done item with no recorded sessions just says done', async () => {
  const features = JSON.stringify({ features: [{ id: 'A', description: 'Old work', passes: true }] })
  expect(compute({ features, now: NOW })?.items[0]?.note).toBe('done')
})

test('formats durations, tokens and the status line', async () => {
  expect(formatDuration(45)).toBe('45s')
  expect(formatDuration(1350)).toBe('22m')
  expect(formatDuration(8040)).toBe('2h 14m')
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(84_000)).toBe('84k')
  expect(formatTokens(1_200_000)).toBe('1.2M')
  const snapshot = running()
  expect(snapshot && statusLine(snapshot)).toBe('autoloop 1/4 done · 1 running · ETA 22m · $2.00')
})

const LOOP_FILES: Record<string, string> = {
  '/project/.loop/feature_list.json': FEATURES,
  '/project/.loop/usage.jsonl': USAGE,
  '/project/.loop/live.json': LIVE,
  '/project/.loop/progress.md': PROGRESS,
}

const RUN_COMMAND = {
  command: 'autoloop-status',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

const PANE_TARGET = {
  plugin: 'bussin-loop-status',
  component: 'Pane',
  requestId: PANE,
  props: {
    title: 'Autoloop status',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
  viewport: { rows: 40, columns: 100 },
} as const

test('/autoloop-status reads the loop files, sets the status line and fills the pane on every surface', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('session.root', async () => ({ value: '/project' }))
  on('clock.now', async () => ({ value: NOW * 1000 }))
  on('fs.read', async (_, e) => {
    const text = LOOP_FILES[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('ui.status', async (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('fs.stat', async (_, e) => ({ deny: `ENOENT: ${e.path}` }))
  const ran = await $.command.run(RUN_COMMAND)
  expect(ran).toMatchObject({ text: 'autoloop 1/4 done · 1 running · ETA 22m · $2.00' })
  expect(statuses.at(-1)).toBeUndefined()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await ui.find({ type: 'Text', text: /project · running · parallel × 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/4 done · 1 running · 3 to go/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ETA ~22m \(around \d\d:\d\d\) · elapsed 50m · \$2\.00 so far$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^out 250 · in 1\.4k · cache read 5\.0k · cache write 100$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$2\.00 · 2 priced sessions · \$1\.00 each$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^opus-5-5 \$1\.50 · haiku-4-5 \$0\.50$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Now$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^CSV download$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /w1 · 5m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Empty export$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /waiting for F2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Done$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.50 · 10m/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^CSV download$/ })).toHaveLength(1)
    await ui.unmount()
  }
})

test('/autoloop-status explains when the project has no loop, and the pane says so', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('session.root', async () => ({ value: '/project' }))
  on('clock.now', async () => ({ value: NOW * 1000 }))
  on('fs.read', async (_, e) => ({ deny: `ENOENT: ${e.path}` }))
  on('fs.stat', async (_, e) => ({ deny: `ENOENT: ${e.path}` }))
  on('ui.status', async (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const ran = await $.command.run(RUN_COMMAND)
  expect(ran).toMatchObject({ text: expect.stringContaining('No .loop/feature_list.json in this repository') })
  expect(statuses.at(-1)).toBeUndefined()
  const ui = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No autoloop in this repository or its worktrees/ })).toBeDefined()
  await ui.unmount()
})

const FINISHED = JSON.stringify({ features: [{ id: 'T1', description: 'Old', passes: true }, { id: 'T2', description: 'Older', passes: true }] })

const REPO_FILES: Record<string, string> = {
  '/repo/.loop/feature_list.json': FINISHED,
  '/repo/.git/worktrees/wt-a/gitdir': '/elsewhere/wt-a/.git\n',
  '/repo/.git/worktrees/wt-b/gitdir': '/elsewhere/wt-b/.git\n',
  '/repo/.git/worktrees/wt-c/gitdir': '/elsewhere/wt-c/.git\n',
  '/elsewhere/wt-c/.loop/feature_list.json': FEATURES,
  '/elsewhere/wt-c/.loop/usage.jsonl': USAGE,
  '/elsewhere/wt-c/.loop/live.json': LIVE,
  '/elsewhere/wt-a/.git': 'gitdir: /repo/.git/worktrees/wt-a\n',
  '/elsewhere/wt-a/.loop/feature_list.json': FEATURES,
  '/elsewhere/wt-a/.loop/usage.jsonl': USAGE,
  '/elsewhere/wt-a/.loop/live.json': LIVE,
}

const ENTRY = { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } as const

function answerRepo(on: On, root: string, statuses: (string | undefined)[], files: Record<string, string> = REPO_FILES) {
  on('session.root', async () => ({ value: root }))
  on('clock.now', async () => ({ value: NOW * 1000 }))
  on('fs.read', async (_, e) => {
    const text = files[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.stat', async (_, e) => {
    if (e.path === '/repo/.git') return { value: { ...ENTRY } }
    if (e.path === '/elsewhere/wt-a/.git') return { value: { ...ENTRY, kind: 'file' } }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('fs.list', async (_, e) =>
    e.path === '/repo/.git/worktrees'
      ? { value: [{ ...ENTRY, name: 'wt-a' }, { ...ENTRY, name: 'wt-b' }, { ...ENTRY, name: 'wt-c' }] }
      : { deny: `ENOENT: ${e.path}` },
  )
  on('ui.status', async (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
}

test('a finished loop without usage data does not claim zero time or cost', async () => {
  const snapshot = compute({ features: FINISHED, now: NOW })
  expect(snapshot && statusLine(snapshot)).toBe('autoloop finished 2/2')
})

test('reads the common git dir from a worktree pointer file', async () => {
  expect(commonDirFromGitFile('gitdir: /repo/.git/worktrees/wt-a\n')).toBe('/repo/.git')
  expect(commonDirFromGitFile('not a pointer')).toBeUndefined()
})

test('finds loops in every worktree from the main checkout, running ones first', async ($, on) => {
  const statuses: (string | undefined)[] = []
  answerRepo(on, '/repo', statuses)
  const ran = await $.command.run(RUN_COMMAND)
  expect(ran).toMatchObject({ text: 'autoloop ▶ wt-a 1/4 · ETA 22m · $2.00 │ ▶ wt-c 1/4 · ETA 22m · $2.00' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await ui.find({ key: 'select-wt-a' })).toBeDefined()
    expect(await ui.find({ key: 'select-repo' })).toBeDefined()
    expect(await ui.find({ key: 'select-wt-b' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /wt-a · running · parallel × 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^autoloop finished 2\/2$/ })).toBeDefined()
    await ui.press({ key: 'select-repo' })
    expect(await ui.find({ type: 'Text', text: /repo · finished · sequential/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /elapsed|\$0\.00/ })).toBeUndefined()
    await ui.press({ key: 'select-wt-a' })
    await ui.unmount()
  }
})

test('finds the same loops from inside a worktree', async ($, on) => {
  const statuses: (string | undefined)[] = []
  answerRepo(on, '/elsewhere/wt-a', statuses)
  const ran = await $.command.run(RUN_COMMAND)
  expect(ran).toMatchObject({ text: 'autoloop ▶ wt-a 1/4 · ETA 22m · $2.00 │ ▶ wt-c 1/4 · ETA 22m · $2.00' })
  const ui = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  expect(await ui.find({ key: 'select-repo' })).toBeDefined()
  await ui.unmount()
})

const BAND_TARGET = {
  plugin: 'bussin-loop-status',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

test('the band above the prompt shows every running loop, and Details opens it in the pane', async ($, on) => {
  const statuses: (string | undefined)[] = []
  answerRepo(on, '/repo', statuses)
  await $.command.run(RUN_COMMAND)
  expect(statuses.at(-1)).toBeUndefined()
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND_TARGET, surface })
    expect(await band.find({ type: 'Text', text: /▶ wt-a [█░]{10} 1\/4 · on F2 · ETA 22m · \$2\.00/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /▶ wt-c [█░]{10} 1\/4/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /repo/ })).toBeUndefined()
    await band.press({ key: 'details-wt-c' })
    await band.unmount()
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ type: 'Text', text: /wt-c · running · parallel × 2/ })).toBeDefined()
    await pane.unmount()
  }
})

test('the band folds extra loops into one line when it has little room, and stays out of a survey', async ($, on) => {
  answerRepo(on, '/repo', [])
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await $.command.run(RUN_COMMAND)
  const tight = await $.ui.mount({ ...BAND_TARGET, surface: 'terminal', props: { ...BAND_TARGET.props, maxRows: 1 } })
  expect(await tight.find({ type: 'Text', text: /^autoloop ▶ wt-a 1\/4 · ETA 22m · \$2\.00 │ ▶ wt-c 1\/4/ })).toBeDefined()
  expect(await tight.find({ key: 'details-wt-a' })).toBeUndefined()
  await tight.unmount()
  const survey = await $.ui.mount({ ...BAND_TARGET, surface: 'terminal', props: { ...BAND_TARGET.props, hasSurvey: true } })
  expect(await survey.find({ key: 'details-wt-a' })).toBeUndefined()
  expect(await survey.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await survey.unmount()
})

test('worktree names drop the repository prefix', async () => {
  expect(shortName('get.offer-stage1-auth-site', 'get.offer')).toBe('stage1-auth-site')
  expect(shortName('nextjs-stage1-00c1f6', 'get.offer')).toBe('nextjs-stage1-00c1f6')
  expect(shortName('get.offer', 'get.offer')).toBe('get.offer')
})

test('the ETA only counts items this loop finished, not ones done before it started', async () => {
  const features = JSON.stringify({
    features: [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `OLD${i}`, passes: true })),
      { id: 'NEW', passes: true },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `TODO${i}`, passes: false })),
    ],
  })
  const usage = JSON.stringify({ item: 'NEW', outcome: 'passed', duration_ms: 600000, cost_usd: 1, started_at: 1000, ended_at: 1600 })
  const live = JSON.stringify({ state: 'running', mode: 'sequential', workers: 1, started_at: 1000, updated_at: 1600, running: [] })
  expect(compute({ features, usage, live, now: NOW })?.etaSec).toBe(3000)
})

test('the status line only speaks when no loop is running', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const files: Record<string, string> = { '/done/.loop/feature_list.json': FINISHED }
  on('session.root', async () => ({ value: '/done' }))
  on('clock.now', async () => ({ value: NOW * 1000 }))
  on('fs.read', async (_, e) => {
    const text = files[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.stat', async (_, e) => ({ deny: `ENOENT: ${e.path}` }))
  on('ui.status', async (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run(RUN_COMMAND)
  expect(statuses.at(-1)).toBe('autoloop finished 2/2')
})

test('long item descriptions shorten to their heading, and model names drop the claude- prefix', async () => {
  expect(shortTitle('F33 Docs and harness for the new stack: README.md explains the monorepo')).toBe('F33 Docs and harness for the new stack')
  expect(shortTitle('x'.repeat(100)).length).toBe(64)
  expect(shortModel('claude-opus-5-5[1m]')).toBe('opus-5-5[1m]')
})

test('a stop request turns a running loop into stopping, which keeps its running items but no ETA', async () => {
  const requested = compute({ features: FEATURES, usage: USAGE, live: LIVE, stopRequested: true, now: NOW })
  expect(requested?.loopState).toBe('stopping')
  expect(requested?.runningRows.map(row => row.item)).toEqual(['F2'])
  expect(requested?.etaSec).toBeNull()
  expect(requested && statusLine(requested)).toBe('autoloop stopping at 1/4 · 1 running · $2.00')
  expect(requested && compactLine('wt-a', requested)).toBe('□ wt-a 1/4 stopping · $2.00')
  const draining = JSON.stringify({ ...JSON.parse(LIVE), state: 'stopping' })
  expect(compute({ features: FEATURES, live: draining, now: NOW })?.loopState).toBe('stopping')
  const stopped = JSON.stringify({ ...JSON.parse(LIVE), state: 'stopped', running: [] })
  expect(compute({ features: FEATURES, live: stopped, stopRequested: true, now: NOW })?.loopState).toBe('stopped')
})

test('Stop in the band and in the pane writes the stop file, and the loop then shows as stopping', async ($, on) => {
  const files = { ...REPO_FILES }
  answerRepo(on, '/repo', [], files)
  const written: string[] = []
  const toasts: string[] = []
  on('fs.write', async (_, e) => {
    written.push(e.path)
    files[e.path] = e.text
    return { value: undefined }
  })
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(RUN_COMMAND)
  const band = await $.ui.mount({ ...BAND_TARGET, surface: 'terminal' })
  await band.press({ key: 'stop-wt-a' })
  expect(written).toEqual(['/elsewhere/wt-a/.loop/stop'])
  expect(toasts).toEqual(['wt-a stops after its running items finish'])
  expect(await band.find({ type: 'Text', text: /^□ wt-a stopping [█░]{10} 1\/4 · on F2 · \$2\.00$/ })).toBeDefined()
  expect(await band.find({ key: 'stop-wt-a' })).toBeUndefined()
  expect(await band.find({ key: 'stop-wt-c' })).toBeDefined()
  await band.press({ key: 'details-wt-c' })
  await band.unmount()
  const before = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: /wt-c · running · parallel × 2/ })).toBeDefined()
  await before.press({ key: 'pane-stop' })
  await before.unmount()
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ type: 'Text', text: /wt-c · stopping · parallel × 2/ })).toBeDefined()
    expect(await pane.find({ key: 'pane-stop' })).toBeUndefined()
    await pane.unmount()
  }
  expect(written).toEqual(['/elsewhere/wt-a/.loop/stop', '/elsewhere/wt-c/.loop/stop'])
})

test('a failed stop says why and changes nothing', async ($, on) => {
  answerRepo(on, '/repo', [])
  const toasts: string[] = []
  on('fs.write', async () => ({ deny: 'EACCES: read-only' }))
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.command.run(RUN_COMMAND)
  const band = await $.ui.mount({ ...BAND_TARGET, surface: 'terminal' })
  await band.press({ key: 'stop-wt-a' })
  expect(toasts[0]).toMatch(/^Could not stop wt-a: .*EACCES/)
  expect(await band.find({ key: 'stop-wt-a' })).toBeDefined()
  await band.unmount()
})
