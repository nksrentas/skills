import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { PANE } from './register'
import { areas, commonDirFromGitFile, compactLine, compute, distinctLabels, isDriverCommand, loopLabel, phaseOf, resumeCommand, formatDuration, formatTokens, shortModel, shortName, shortTitle, statusLine } from './snapshot'
import { currentStep, parseLog } from './session-log'

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

const running = () => compute({ features: FEATURES, usage: USAGE, live: LIVE, now: NOW })

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
  const snapshot = compute({ features: hostile, usage: hostileUsage, live: hostileLive, now: NOW })
  const shown = JSON.stringify(snapshot)
  expect(/[\u0000-\u001f\u007f-\u009f]/.test(shown.replace(/\\u00[0-9a-f]{2}/g, ''))).toBe(false)
  expect(shown).not.toContain('\\u001b')
  expect(snapshot?.items[0]?.id).toBe('F[2J1')
  expect(snapshot?.items[0]?.waitingFor).toEqual(['X'])
  expect(snapshot?.models[0]?.name).toBe('evil[31m')
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

test('sessions whose agent reports no cost show tokens and time and mark cost unknown', async () => {
  const features = JSON.stringify({ features: [{ id: 'F1', description: 'One', passes: true }, { id: 'F2', description: 'Two', passes: true }, { id: 'F3', description: 'Three', passes: false }] })
  const usage = [
    { item: 'F1', outcome: 'passed', duration_ms: 840000, input_tokens: 10, output_tokens: 2000, started_at: 1000, ended_at: 1840, models: { 'claude-opus-5-5': { input_tokens: 10, output_tokens: 2000 } } },
    { item: 'F2', outcome: 'passed', duration_ms: 600000, input_tokens: 20, output_tokens: 1000, started_at: 1900, ended_at: 2500, models: { 'claude-opus-5-5': { input_tokens: 20, output_tokens: 1000 } } },
  ]
    .map(row => JSON.stringify(row))
    .join('\n')
  const snapshot = compute({ features, usage, now: NOW })
  expect(snapshot?.unpricedSessions).toBe(2)
  expect(snapshot?.costUsd).toBe(0)
  expect(snapshot?.outputTokens).toBe(3000)
  expect(snapshot?.elapsedSec).toBe(1500)
  expect(snapshot && statusLine(snapshot)).toBe('autoloop 2/3 done · not running')
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
    expect(await ui.find({ type: 'Text', text: /^● project$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^running · parallel × 2$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^[█░]{30} 1\/4$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ETA ~22m \(around \d\d:\d\d\) · elapsed 50m · \$2\.00 so far$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\$2\.00 · 2 priced sessions · \$1\.00 each · opus-5-5 \$1\.50 · haiku-4-5 \$0\.50$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^out 250/ })).toBeUndefined()
    expect(await ui.find({ key: 'area-Other', text: '▾ Other' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^[█░]{12} 1\/4$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^◆ building 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^CSV download$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Reading the plan$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Filters unchanged$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^trying again$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^after CSV download$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Export button$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\d\d:\d\d$/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^CSV download$/ })).toHaveLength(1)
    await ui.press({ key: 'show-tokens' })
    expect(await ui.find({ type: 'Text', text: /^out 250 · in 1\.4k · cache read 5\.0k · cache write 100$/ })).toBeDefined()
    await ui.press({ key: 'show-tokens' })
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
  '/repo/.git/worktrees/wt-a/HEAD': 'ref: refs/heads/loop/payments\n',
  '/repo/.git/worktrees/w1/gitdir': '/repo.loop-workers/w1/.git\n',
  '/repo/.git/worktrees/w1/HEAD': 'ref: refs/heads/loop/repo/F2\n',
  '/repo.loop-workers/w1/.loop/feature_list.json': FEATURES,
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
      ? { value: [{ ...ENTRY, name: 'wt-a' }, { ...ENTRY, name: 'wt-b' }, { ...ENTRY, name: 'wt-c' }, { ...ENTRY, name: 'w1' }] }
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
  expect(ran).toMatchObject({ text: 'autoloop ● wt-a 1/4 · ETA 22m · $2.00 │ ● wt-c 1/4 · ETA 22m · $2.00' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await ui.find({ key: 'select-wt-a' })).toBeDefined()
    expect(await ui.find({ key: 'select-wt-c' })).toBeDefined()
    expect(await ui.find({ key: 'select-repo' })).toBeDefined()
    expect(await ui.find({ key: 'select-wt-b' })).toBeUndefined()
    expect(await ui.find({ key: 'select-w1' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^● wt-a$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^running · parallel × 2$/ })).toBeDefined()
    await ui.press({ key: 'select-repo' })
    expect(await ui.find({ type: 'Text', text: /^✓ repo$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^finished · sequential$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /elapsed|\$0\.00/ })).toBeUndefined()
    await ui.press({ key: 'select-wt-a' })
    await ui.unmount()
  }
})

test('a loop finished over a day ago, or stopped over a week ago, drops out of the pane; recent ones stay', async ($, on) => {
  const endedAt = (state: string, secondsAgo: number) => JSON.stringify({ state, started_at: NOW - secondsAgo - 600, updated_at: NOW - secondsAgo, running: [] })
  const files = { ...REPO_FILES }
  answerRepo(on, '/repo', [], files)
  const cases = [['finished', 2 * 86400, false], ['finished', 3600, true], ['stopped', 8 * 86400, false], ['stopped', 2 * 86400, true]] as const
  for (const [state, secondsAgo, shown] of cases) {
    files['/repo/.loop/live.json'] = endedAt(state, secondsAgo)
    await $.command.run(RUN_COMMAND)
    const ui = await $.ui.mount({ ...PANE_TARGET, surface: 'desktop' })
    expect((await ui.find({ key: 'select-repo' })) !== undefined).toBe(shown)
    expect(await ui.find({ key: 'select-wt-a' })).toBeDefined()
    await ui.unmount()
  }
})

test('Dismiss hides a finished loop until it runs again, and running loops have no Dismiss', async ($, on) => {
  const files = { ...REPO_FILES }
  answerRepo(on, '/repo', [], files)
  const written: string[] = []
  on('fs.write', async (_, e) => {
    written.push(`${e.path}=${e.text}`)
    files[e.path] = e.text
    return { value: undefined }
  })
  on('ui.toast', async () => ({ value: undefined }))
  await $.command.run(RUN_COMMAND)
  const pane = await $.ui.mount({ ...PANE_TARGET, surface: 'desktop' })
  expect(await pane.find({ key: 'pane-dismiss' })).toBeUndefined()
  await pane.press({ key: 'select-repo' })
  await pane.press({ key: 'pane-dismiss' })
  expect(written).toEqual([`/repo/.loop/dismissed=${NOW}\n`])
  expect(await pane.find({ key: 'select-repo' })).toBeUndefined()
  expect(await pane.find({ key: 'select-wt-a' })).toBeDefined()
  await pane.unmount()
  files['/repo/.loop/live.json'] = JSON.stringify({ state: 'finished', started_at: NOW, updated_at: NOW + 60, running: [] })
  await $.command.run(RUN_COMMAND)
  const again = await $.ui.mount({ ...PANE_TARGET, surface: 'desktop' })
  expect(await again.find({ key: 'select-repo' })).toBeDefined()
  await again.unmount()
})

test('finds the same loops from inside a worktree', async ($, on) => {
  const statuses: (string | undefined)[] = []
  answerRepo(on, '/elsewhere/wt-a', statuses)
  const ran = await $.command.run(RUN_COMMAND)
  expect(ran).toMatchObject({ text: 'autoloop ● wt-a 1/4 · ETA 22m · $2.00 │ ● wt-c 1/4 · ETA 22m · $2.00' })
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
    expect(await band.find({ type: 'Text', text: /^● wt-a [█░]{10} 1\/4 · CSV download · Reading the plan · ETA 22m · \$2\.00$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^● wt-c [█░]{10} 1\/4/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /repo/ })).toBeUndefined()
    await band.press({ key: 'details-wt-c' })
    await band.unmount()
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ type: 'Text', text: /^● wt-c$/ })).toBeDefined()
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
  expect(await tight.find({ type: 'Text', text: /^autoloop ● wt-a 1\/4 · ETA 22m · \$2\.00 │ ● wt-c 1\/4/ })).toBeDefined()
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
  expect(requested && compactLine('wt-a', requested)).toBe('◌ wt-a 1/4 stopping · $2.00')
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
  expect(await band.find({ type: 'Text', text: /^◌ wt-a stopping [█░]{10} 1\/4 · CSV download · Reading the plan · \$2\.00$/ })).toBeDefined()
  expect(await band.find({ key: 'stop-wt-a' })).toBeUndefined()
  expect(await band.find({ key: 'stop-wt-c' })).toBeDefined()
  await band.press({ key: 'details-wt-c' })
  await band.unmount()
  const before = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: /^● wt-c$/ })).toBeDefined()
  await before.press({ key: 'pane-stop' })
  await before.unmount()
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ type: 'Text', text: /^stopping · parallel × 2$/ })).toBeDefined()
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

const STALE_LIVE = JSON.stringify({ ...JSON.parse(LIVE), agent: 'codex', pid: 4242, script: "/skills/it's/bussin-autoloop/scripts/loop.sh" })

function answerProject(on: On, ps: { exitCode: number; stdout: string }, copied: string[], toasts: string[]) {
  const files: Record<string, string> = { ...LOOP_FILES, '/project/.loop/live.json': STALE_LIVE, '/project/.loop/attempts.json': '{"F2": 3}' }
  on('session.root', async () => ({ value: '/project' }))
  on('clock.now', async () => ({ value: NOW * 1000 }))
  on('fs.read', async (_, e) => {
    const text = files[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.stat', async (_, e) => ({ deny: `ENOENT: ${e.path}` }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('process.run', async (_, e) => {
    expect(e.argv).toEqual(['ps', '-p', '4242', '-o', 'command='])
    return { value: { ...ps, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.copy', async (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
}

test('a running loop whose driver process is gone shows a warning, no Stop, and copies the resume command', async ($, on) => {
  const copied: string[] = []
  const toasts: string[] = []
  answerProject(on, { exitCode: 1, stdout: '' }, copied, toasts)
  const ran = await $.command.run(RUN_COMMAND)
  expect(ran).toMatchObject({ text: 'autoloop driver not running at 1/4 · $2.00' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ type: 'Text', text: /^⚠ project$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^driver not running · parallel × 2 · codex$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /The loop driver is not running/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /nothing is working on CSV download\./ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /ETA/ })).toBeUndefined()
    expect(await pane.find({ key: 'pane-stop' })).toBeUndefined()
    await pane.unmount()
  }
  const pane = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  await pane.press({ key: 'copy-resume' })
  expect(copied).toEqual([`cd '/project' && LOOP_AGENT=codex LOOP_WORKERS=2 bash '/skills/it'\\''s/bussin-autoloop/scripts/loop.sh'`])
  expect(await pane.find({ type: 'Text', text: copied[0] })).toBeDefined()
  expect(toasts).toEqual(['Resume command copied'])
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND_TARGET, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^⚠ project driver not running [█░]{10} 1\/4 · CSV download · Reading the plan · \$2\.00$/ })).toBeDefined()
  expect(await band.find({ key: 'stop-project' })).toBeUndefined()
  await band.unmount()
})

test('a loop whose driver process is alive stays running', async ($, on) => {
  answerProject(on, { exitCode: 0, stdout: 'bash /skills/loop.sh\n' }, [], [])
  const ran = await $.command.run(RUN_COMMAND)
  expect(ran).toMatchObject({ text: 'autoloop 1/4 done · 1 running · ETA 22m · $2.00' })
  const pane = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  expect(await pane.find({ key: 'pane-stop' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /The loop driver is not running/ })).toBeUndefined()
  await pane.unmount()
})

test('a reused pid that is not loop.sh counts as gone', async () => {
  expect(isDriverCommand('bash /skills/bussin-autoloop/scripts/loop.sh')).toBe(true)
  expect(isDriverCommand('bash loop.sh')).toBe(true)
  expect(isDriverCommand('/usr/bin/vim notes.txt')).toBe(false)
  expect(isDriverCommand('bash myloop.sh')).toBe(false)
})

test('the resume command only runs a bussin-autoloop loop.sh outside the project, with a known agent', async () => {
  const stale = (live: Record<string, unknown>) => {
    const snapshot = compute({ features: FEATURES, live: JSON.stringify({ ...JSON.parse(LIVE), ...live }), driverAlive: false, now: NOW })
    if (snapshot === null) throw new Error('no snapshot')
    return resumeCommand('/project', snapshot)
  }
  expect(stale({ script: '/home/me/.claude/skills/bussin-autoloop/scripts/loop.sh' })).toBe(
    `cd '/project' && LOOP_WORKERS=2 bash '/home/me/.claude/skills/bussin-autoloop/scripts/loop.sh'`,
  )
  expect(stale({ script: '/project/bussin-autoloop/scripts/loop.sh' })).toBeNull()
  expect(stale({ script: '/project/evil.sh' })).toBeNull()
  expect(stale({ script: 'bussin-autoloop/scripts/loop.sh' })).toBeNull()
  expect(stale({ script: '/x/../project/bussin-autoloop/scripts/loop.sh' })).toBeNull()
  expect(stale({ script: '/home/me/bussin-autoloop/scripts/loop.sh', agent: '$(rm -rf ~)' })).toBeNull()
})

test('a running loop counts as stale from a dead pid, or from a live.json silent for 15 minutes when the pid cannot be checked', () => {
  const snapshot = (live: Record<string, unknown>, driverAlive?: boolean) =>
    compute({ features: FEATURES, live: JSON.stringify({ ...JSON.parse(LIVE), ...live }), driverAlive, now: NOW })
  expect(snapshot({}, false)).toMatchObject({ loopState: 'running', stale: true, etaSec: null, elapsedSec: 2990 })
  expect(snapshot({ state: 'stopping' }, false)).toMatchObject({ stale: true })
  expect(snapshot({ updated_at: NOW - 901 })).toMatchObject({ stale: true, etaSec: null })
  expect(snapshot({ updated_at: NOW - 600 })).toMatchObject({ stale: false })
  expect(snapshot({ updated_at: NOW - 901 }, true)).toMatchObject({ stale: false })
  expect(snapshot({ updated_at: NOW - 901, running: [] })).toMatchObject({ stale: false })
})

test('names a loop by its config name, else the start of its task, else its folder', async () => {
  expect(loopLabel(JSON.stringify({ name: 'Invoice reminders', task: 'Build invoice reminders' }), 'stage4-6')).toBe('Invoice reminders')
  expect(loopLabel(JSON.stringify({ task: 'Export invoices to CSV. Paid ones only.' }), 'stage4-6')).toBe('Export invoices to CSV')
  expect(loopLabel(JSON.stringify({ task: 'Rebuild the apps/site landing page as a static export with the house look' }), 'w')).toBe('Rebuild the apps/site landing page as a…')
  expect(loopLabel(JSON.stringify({ name: 'Bad\u001b[31m name' }), 'w')).toBe('Bad[31m name')
  expect(loopLabel(undefined, 'stage4-6')).toBe('stage4-6')
  expect(loopLabel('not json', 'stage4-6')).toBe('stage4-6')
})

test('adds the folder only when two loops share a name', async () => {
  const labels = distinctLabels([
    { name: 'a', label: 'Landing page' },
    { name: 'b', label: 'Landing page' },
    { name: 'c', label: 'Invoices' },
  ]).map(loop => loop.label)
  expect(labels.join('|')).toBe('Landing page (a)|Landing page (b)|Invoices')
})

test('a running row without a start time counts from now', () => {
  const live = JSON.stringify({ ...JSON.parse(LIVE), running: [{ item: 'F2', worker: 1 }] })
  expect(compute({ features: FEATURES, live, now: NOW })?.runningRows[0]?.seconds).toBe(0)
})

const LOG = ['10:00:01\t-\tRead\tsrc/export.ts', '10:00:02\timplement\tEdit\tsrc/export.ts', '10:00:03\tgate\tBash\tbash .loop/verify.sh', '10:00:04\t-\tSay\tgate \u001b[31mis running'].join('\n')

test('a session log becomes lines and a current step', () => {
  const lines = parseLog(LOG)
  expect(lines).toHaveLength(4)
  expect(lines[3]).toEqual({ time: '10:00:04', step: '-', kind: 'Say', text: 'gate [31mis running' })
  expect(currentStep(lines)).toBe('gate')
  expect(currentStep([])).toBe('orient')
  expect(parseLog(Array.from({ length: 60 }, (_, i) => `t${i}\t-\tBash\tx`).join('\n'))).toHaveLength(40)
})

test('a loop is named by .loop/name first, then config name, task, folder', () => {
  expect(loopLabel(JSON.stringify({ name: 'From config' }), 'wt', 'Landing page\nignored')).toBe('Landing page')
  expect(loopLabel(JSON.stringify({ name: 'From config' }), 'wt', '  \n')).toBe('From config')
  expect(loopLabel(undefined, 'wt', 'x'.repeat(80))).toHaveLength(60)
})

test('a queued loop waits for a free session on this Mac', () => {
  const live = JSON.stringify({ ...JSON.parse(LIVE), state: 'queued', running: [], machine: { sessions: 5, in_use: 5 } })
  const snapshot = compute({ features: FEATURES, usage: USAGE, live, now: NOW })
  expect(snapshot).toMatchObject({ loopState: 'queued', machine: { sessions: 5, inUse: 5 }, etaSec: null })
  expect(snapshot && statusLine(snapshot)).toBe('autoloop queued at 1/4 · waiting for a free session on this Mac · $2.00')
  expect(snapshot && compactLine('wt-a', snapshot)).toBe('◌ wt-a 1/4 queued · $2.00')
})

function answerLogged(on: On, files: Record<string, string>, reads: string[], written: Record<string, string>, toasts: string[] = []) {
  on('session.root', async () => ({ value: '/project' }))
  on('clock.now', async () => ({ value: NOW * 1000 }))
  on('fs.read', async (_, e) => {
    reads.push(e.path)
    const text = files[e.path]
    if (text === undefined) return { deny: `ENOENT: ${e.path}` }
    return { value: e.as === 'bytes' ? { base64: text } : text }
  })
  on('fs.write', async (_, e) => {
    written[e.path] = e.text
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.stat', async (_, e) => {
    const text = files[e.path]
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { ...ENTRY, kind: 'file', size: text.length } }
  })
  on('ui.status', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
}

test('the pane shows each running task with its phase from the session log, the band its plain title and phase, and this Mac', async ($, on) => {
  const live = JSON.stringify({ ...JSON.parse(LIVE), machine: { sessions: 5, in_use: 3 } })
  const files: Record<string, string> = {
    ...LOOP_FILES,
    '/project/.loop/live.json': live,
    '/project/.loop/config.json': JSON.stringify({ task: 'Export invoices to CSV. Paid ones only.' }),
    '/project/.loop/logs/F2.log': LOG,
  }
  answerLogged(on, files, [], {})
  await $.command.run(RUN_COMMAND)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ type: 'Text', text: /^● Export invoices to CSV$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Export invoices to CSV\. Paid ones only\.$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Running the tests$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /verify\.sh|is running/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^This Mac: 3 of 5 loop sessions in use · room for 2 more$/ })).toBeDefined()
    await pane.unmount()
  }
  const band = await $.ui.mount({ ...BAND_TARGET, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^● Export invoices to CSV [█░]{10} 1\/4 · CSV download · Running the tests · ETA 22m · \$2\.00$/ })).toBeDefined()
  await band.unmount()
})

test('a running item id that is not a plain name is never read as a log path', async ($, on) => {
  const live = JSON.stringify({ ...JSON.parse(LIVE), running: [{ item: '../../etc/passwd', worker: 1, started_at: 3700 }] })
  const reads: string[] = []
  answerLogged(on, { ...LOOP_FILES, '/project/.loop/live.json': live }, reads, {})
  await $.command.run(RUN_COMMAND)
  expect(reads.filter(path => path.includes('/logs/'))).toEqual([])
})

test('Rename in the pane writes .loop/name and every view uses the new name', async ($, on) => {
  const files: Record<string, string> = { ...LOOP_FILES }
  const written: Record<string, string> = {}
  answerLogged(on, files, [], written)
  await $.command.run(RUN_COMMAND)
  const pane = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  await pane.press({ key: 'pane-rename' })
  await pane.input({ key: 'rename-input', text: 'Landing page' })
  expect(written).toEqual({ '/project/.loop/name': 'Landing page\n' })
  expect(await pane.find({ type: 'Text', text: /^● Landing page$/ })).toBeDefined()
  expect(await pane.find({ key: 'rename-input' })).toBeUndefined()
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND_TARGET, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^● Landing page / })).toBeDefined()
  await band.unmount()
})

test('a queued loop shows in the band and in the pane, and can be stopped while it waits', async ($, on) => {
  const live = JSON.stringify({ ...JSON.parse(LIVE), state: 'queued', running: [], machine: { sessions: 2, in_use: 2 } })
  answerLogged(on, { ...LOOP_FILES, '/project/.loop/live.json': live }, [], {})
  await $.command.run(RUN_COMMAND)
  const band = await $.ui.mount({ ...BAND_TARGET, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /^◌ project queued: this Mac is full [█░]{10} 1\/4 · \$2\.00$/ })).toBeDefined()
  expect(await band.find({ key: 'stop-project' })).toBeDefined()
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  expect(await pane.find({ key: 'pane-stop' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^This Mac: 2 of 2 loop sessions in use · full, new sessions wait for a free one$/ })).toBeDefined()
  await pane.unmount()
})

test('a large session log is read through tail, not whole', async ($, on) => {
  const big = `${'10:00:00\t-\tRead\tx\n'.repeat(20000)}10:59:59\tcommit\tBash\tgit commit -m done\n`
  const files: Record<string, string> = { ...LOOP_FILES, '/project/.loop/logs/F2.log': big }
  const reads: string[] = []
  const runs: string[][] = []
  answerLogged(on, files, reads, {})
  on('process.run', async (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '10:59:59\tcommit\tBash\tgit commit -m done\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run(RUN_COMMAND)
  expect(reads).not.toContain('/project/.loop/logs/F2.log')
  expect(runs).toContainEqual(['tail', '-n', '40', '/project/.loop/logs/F2.log'])
  const pane = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^Saving the work$/ })).toBeDefined()
  await pane.unmount()
})

const STEERABLE = JSON.stringify({
  features: [
    {
      id: 'F1', category: 'functional', area: 'Search', plain: 'Search finds products by name', done_when: 'Typing a name lists matches.',
      kind: 'eval', description: 'Search: index products', verify: 'Run the eval', passes: true, review: 'approved',
      metrics: [{ name: 'precision@5', target: 0.75 }, { name: 'recall@10' }],
      evidence: { commit: 'abc', metrics: { 'precision@5': 0.8, mrr: 0.5, '  ': 1 }, screenshots: ['.loop/evidence/F1/1-home.png', '.loop/evidence/F1/../F2/x.png', '.loop/evidence/F2/1-home.png', '/etc/passwd', 7] },
    },
    { id: 'F2', category: 'functional', area: 'Checkout', plain: 'Pay by card', done_when: 'A test card pays.', kind: 'design', passes: false, review: 'changes' },
    { id: 'F3', category: 'edge', area: 'Search', plain: 'Empty search says so', done_when: 'An empty query shows a hint.', kind: 'odd', passes: false },
  ],
})

test('each task carries its area, plain sentence, done-when line, kind, metrics, screenshots, review and finish time', () => {
  const usage = [
    { item: 'F1', outcome: 'failed', started_at: 1000, ended_at: 1200 },
    { item: 'F1', outcome: 'merged', started_at: 1300, ended_at: 1500 },
  ].map(row => JSON.stringify(row)).join('\n')
  const live = JSON.stringify({ state: 'running', started_at: 1000, updated_at: 3990, running: [{ item: 'F2', worker: 0, started_at: 3700 }] })
  const snapshot = compute({ features: STEERABLE, usage, live, now: NOW })
  const [search, pay, empty] = snapshot?.items ?? []
  expect(search).toMatchObject({
    area: 'Search', plain: 'Search finds products by name', doneWhen: 'Typing a name lists matches.', kind: 'eval',
    description: 'Search: index products', verify: 'Run the eval', review: 'approved', finishedAt: 1500, phase: null,
    screenshots: ['.loop/evidence/F1/1-home.png'],
  })
  expect(search?.metrics).toEqual([
    { name: 'precision@5', value: 0.8, target: 0.75 },
    { name: 'recall@10', value: null, target: null },
    { name: 'mrr', value: 0.5, target: null },
  ])
  expect(pay).toMatchObject({ kind: 'design', review: 'changes', phase: 'Reading the plan', finishedAt: null, metrics: [], screenshots: [] })
  expect(empty).toMatchObject({ kind: 'build', review: null, phase: null })
})

test('every session step has a plain phase, and anything else reads the plan', () => {
  expect(['orient', 'implement', 'gate', 'review', 'browser', 'commit', 'constructor', '-'].map(phaseOf)).toEqual([
    'Reading the plan', 'Writing the code', 'Running the tests', 'Reviewing its own work', 'Checking it in a browser', 'Saving the work',
    'Reading the plan', 'Reading the plan',
  ])
})

test('tasks from older loops fall back to their category, description and verify steps', () => {
  const features = JSON.stringify({
    features: [
      { id: 'A', category: 'functional', description: 'CSV export: download paid invoices as CSV', verify: 'Click export', passes: true },
      { id: 'B', category: 'edge', description: 'Empty export', passes: false },
      { id: 'C', category: 'regression', description: 'Filters unchanged', passes: false },
      { id: 'D', description: 'No category', passes: false, evidence: { metrics: 'x', screenshots: 'y' } },
    ],
  })
  const items = compute({ features, now: NOW })?.items ?? []
  expect(items.map(row => row.area)).toEqual(['Features', 'Edge cases', 'Safety checks', 'Other'])
  expect(items[0]).toMatchObject({ plain: 'CSV export', doneWhen: 'Click export', kind: 'build', review: null, finishedAt: null, metrics: [], screenshots: [] })
  expect(items[3]).toMatchObject({ plain: 'No category', doneWhen: '', metrics: [], screenshots: [] })
})

test('the new task fields are stripped of control characters', () => {
  const features = JSON.stringify({ features: [{ id: 'A', area: 'Se\u001b[2Jarch', plain: 'P\u0007lain', done_when: 'D\u001bone', metrics: [{ name: 'm\u001b1', target: 1 }], passes: false }] })
  const shown = JSON.stringify(compute({ features, now: NOW })?.items[0])
  expect(shown).not.toContain('\\u001b')
  expect(shown).not.toContain('\\u0007')
})

test('areas keep first-seen order with done and total counts', () => {
  const groups = areas(compute({ features: STEERABLE, now: NOW })?.items ?? [])
  expect(groups.map(group => `${group.name} ${group.done}/${group.total} ${group.items.map(row => row.id).join(',')}`)).toEqual(['Search 1/2 F1,F3', 'Checkout 0/1 F2'])
})

const AREA_FEATURES = JSON.stringify({
  features: [
    { id: 'A1', area: 'Search', plain: 'Search finds products by name', passes: true },
    { id: 'A2', area: 'Search', plain: 'Empty search says so', passes: false, depends_on: ['A3'] },
    { id: 'A4', area: 'Checkout', plain: 'Refunds work', passes: false },
    { id: 'A3', area: 'Checkout', plain: 'Pay by card', passes: false },
    { id: 'A5', area: 'Account', plain: 'Change your password', passes: false },
    { id: 'A6', area: 'Docs', plain: 'Readme explains it', passes: true },
  ],
})

test('the pane lists areas with counts and status, opens and closes them, and never shows an item id', async ($, on) => {
  const files: Record<string, string> = {
    '/project/.loop/feature_list.json': AREA_FEATURES,
    '/project/.loop/usage.jsonl': JSON.stringify({ item: 'A5', outcome: 'failed', started_at: 1000, ended_at: 1200 }),
    '/project/.loop/live.json': JSON.stringify({ state: 'running', started_at: 1000, updated_at: 3990, running: [{ item: 'A3', worker: 0, started_at: 3700 }] }),
  }
  answerLogged(on, files, [], {})
  await $.command.run(RUN_COMMAND)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect((await pane.findAll({ type: 'Button', text: /^[▾▸] / })).map(button => button.text)).toEqual(['▸ Search', '▾ Checkout', '▾ Account', '▸ Docs'])
    expect((await pane.findAll({ type: 'Text', text: /^[█░]{12} \d\/\d$/ })).map(text => text.text.slice(13))).toEqual(['1/2', '0/2', '0/1', '1/1'])
    for (const status of ['waiting its turn', '◆ building 1', '1 needs a look', '✓ all work']) expect(await pane.find({ type: 'Text', text: status })).toBeDefined()
    expect((await pane.findAll({ type: 'Text', text: /^(Pay by card|Refunds work|Change your password)$/ })).map(text => text.text)).toEqual(['Pay by card', 'Refunds work', 'Change your password'])
    expect(await pane.find({ type: 'Text', text: /^not started$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Empty search says so$/ })).toBeUndefined()
    await pane.press({ key: 'area-Search' })
    expect(await pane.find({ key: 'area-Search', text: '▾ Search' })).toBeDefined()
    expect((await pane.findAll({ type: 'Text', text: /^(Empty search says so|Search finds products by name)$/ })).map(text => text.text)).toEqual(['Empty search says so', 'Search finds products by name'])
    expect(await pane.find({ type: 'Text', text: /^after Pay by card$/ })).toBeDefined()
    await pane.press({ key: 'area-Checkout' })
    expect(await pane.find({ type: 'Text', text: /^Pay by card$/ })).toBeUndefined()
    const shown = [...(await pane.findAll({ type: 'Text' })), ...(await pane.findAll({ type: 'Button' }))].map(element => element.text)
    expect(shown.filter(text => /\bA[1-6]\b/.test(text))).toEqual([])
    expect(shown.filter(text => /^(Now|Up next|Recent)$/.test(text))).toEqual([])
    await pane.press({ key: 'area-Search' })
    await pane.press({ key: 'area-Checkout' })
    await pane.unmount()
  }
})

const OPEN_FEATURES = JSON.stringify({
  features: [
    { id: 'A1', area: 'Search', plain: 'Search finds products by name', done_when: 'Typing a name lists matches.', description: 'Search index over product names', verify: 'Type mug, see two rows', passes: false },
    { id: 'A2', area: 'Search', plain: 'Empty search says so', done_when: 'An empty query shows a hint.', description: 'Empty query hint', verify: 'Clear the box', passes: false },
  ],
})

test('pressing a task opens it in place with its done-when line, technical details on request, and one open at a time', async ($, on) => {
  const log = Array.from({ length: 8 }, (_, i) => `10:00:0${i}\t${i < 7 ? 'implement' : 'gate'}\tBash\tstep ${i}`).join('\n')
  const files: Record<string, string> = {
    '/project/.loop/feature_list.json': OPEN_FEATURES,
    '/project/.loop/live.json': JSON.stringify({ state: 'running', started_at: 1000, updated_at: 3990, running: [{ item: 'A1', worker: 1, started_at: 3700 }] }),
    '/project/.loop/logs/A1.log': log,
  }
  answerLogged(on, files, [], {})
  await $.command.run(RUN_COMMAND)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ type: 'Text', text: /^Done when/ })).toBeUndefined()
    await pane.press({ key: 'task-A2' })
    expect(await pane.find({ type: 'Text', text: /^Done when: An empty query shows a hint\.$/ })).toBeDefined()
    const shown = [...(await pane.findAll({ type: 'Text' })), ...(await pane.findAll({ type: 'Button' }))].map(element => element.text)
    expect(shown.filter(text => /\bA[12]\b/.test(text))).toEqual([])
    await pane.press({ key: 'tech-A2' })
    for (const text of [/^Id: A2$/, /^Empty query hint$/, /^Verify: Clear the box$/]) expect(await pane.find({ type: 'Text', text })).toBeDefined()
    await pane.press({ key: 'tech-A2' })
    expect(await pane.find({ type: 'Text', text: /^Id: A2$/ })).toBeUndefined()
    await pane.press({ key: 'tech-A2' })
    await pane.press({ key: 'task-A1' })
    expect(await pane.find({ type: 'Text', text: /^Done when: An empty query shows a hint\.$/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^Id: A2$/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^Done when: Typing a name lists matches\.$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Running the tests · running for 5m$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /step [0-7]/ })).toBeUndefined()
    await pane.press({ key: 'tech-A1' })
    expect(await pane.find({ type: 'Text', text: /^Id: A1$/ })).toBeDefined()
    expect((await pane.findAll({ type: 'Text', text: /step \d$/ })).map(text => text.text)).toEqual([2, 3, 4, 5, 6, 7].map(i => `10:00:0${i} Bash step ${i}`))
    await pane.press({ key: 'task-A1' })
    expect(await pane.find({ type: 'Text', text: /^Done when/ })).toBeUndefined()
    await pane.press({ key: 'task-A1' })
    expect(await pane.find({ type: 'Text', text: /^Id: A1$/ })).toBeUndefined()
    await pane.press({ key: 'task-A1' })
    await pane.unmount()
  }
})

const STEER_FEATURES = JSON.stringify({
  features: [
    { id: 'A1', area: 'Search', plain: 'Search finds products by name', passes: false },
    { id: 'A2', area: 'Search', plain: 'Empty search says so', done_when: 'An empty query shows a hint.', passes: false },
    { id: 'A3', area: 'Search', plain: 'Search is fast', passes: true },
  ],
})
const INBOX_FILE = /^\/project\/\.loop\/inbox\/4000000-[A-Za-z0-9]+\.json$/

test('an eval task shows its metrics as a table with targets, and a missed target offers a task to reach it', async ($, on) => {
  const files: Record<string, string> = {
    '/project/.loop/feature_list.json': JSON.stringify({
      features: [
        {
          id: 'Q1', area: 'Quality', plain: 'Measure search quality', kind: 'eval', passes: true,
          metrics: [{ name: 'precision@5', target: 0.75 }, { name: 'recall@10', target: 0.6 }],
          evidence: { commit: 'abc', metrics: { 'precision@5': 0.812, 'recall@10': 0.5, mrr: 0.4 }, dataset: 'queries-200.jsonl', command: 'npm run eval' },
        },
      ],
    }),
    '/project/.loop/live.json': JSON.stringify({ state: 'stopped', started_at: 1000, updated_at: 3990, running: [] }),
  }
  const written: Record<string, string> = {}
  const toasts: string[] = []
  answerLogged(on, files, [], written, toasts)
  await $.command.run(RUN_COMMAND)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const path of Object.keys(written)) delete written[path]
    toasts.length = 0
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    await pane.press({ key: 'area-Quality' })
    await pane.press({ key: 'task-Q1' })
    expect((await pane.find({ key: 'metrics-Q1' }))?.text).toBe(
      [
        '| Metric | Value | Target | |',
        '| --- | ---: | ---: | --- |',
        '| precision@5 | 0.81 | 0.75 | ✓ met |',
        '| recall@10 | 0.50 | 0.60 | ✗ below |',
        '| mrr | 0.40 | — | — |',
      ].join('\n'),
    )
    expect(await pane.find({ type: 'Text', text: /^Dataset: queries-200\.jsonl · Command: npm run eval$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^⚠ recall@10 is 0\.50, below its target of 0\.60$/ })).toBeDefined()
    expect(await pane.find({ key: 'reach-Q1-precision@5' })).toBeUndefined()
    await pane.press({ key: 'reach-Q1-recall@10' })
    const found = Object.entries(written).filter(([path]) => path.includes('/inbox/'))
    expect(found.every(([path]) => INBOX_FILE.test(path))).toBe(true)
    expect(found.map(([, text]) => JSON.parse(text))).toEqual([
      { op: 'add', plain: 'Raise recall@10 to at least 0.6', kind: 'eval', area: 'Quality', metrics: [{ name: 'recall@10', target: 0.6 }] },
    ])
    expect(toasts).toEqual(["Added 'Raise recall@10 to at least 0.6'. Applied when the loop runs next."])
    // Close what this mount opened, since the open task and areas outlive it.
    await pane.press({ key: 'task-Q1' })
    await pane.press({ key: 'area-Quality' })
    await pane.unmount()
  }
})

test('a task that has not started offers Edit, Do it next and Skip it, each writing one inbox change', async ($, on) => {
  const files: Record<string, string> = {
    '/project/.loop/feature_list.json': STEER_FEATURES,
    '/project/.loop/live.json': JSON.stringify({ state: 'running', started_at: 1000, updated_at: 3990, running: [{ item: 'A1', worker: 1, started_at: 3700 }] }),
  }
  const written: Record<string, string> = {}
  const toasts: string[] = []
  answerLogged(on, files, [], written, toasts)
  await $.command.run(RUN_COMMAND)
  const changes = () => Object.entries(written).filter(([path]) => path.includes('/inbox/'))
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const path of Object.keys(written)) delete written[path]
    toasts.length = 0
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    await pane.press({ key: 'task-A1' })
    for (const key of ['edit-A1', 'first-A1', 'skip-A1']) expect(await pane.find({ key })).toBeUndefined()
    await pane.press({ key: 'task-A3' })
    for (const key of ['edit-A3', 'first-A3', 'skip-A3']) expect(await pane.find({ key })).toBeUndefined()
    await pane.press({ key: 'task-A2' })
    await pane.press({ key: 'first-A2' })
    await pane.press({ key: 'skip-A2' })
    await pane.press({ key: 'edit-A2' })
    expect(await pane.find({ key: 'edit-plain-A2' })).toBeDefined()
    await pane.input({ key: 'edit-plain-A2', text: '  An empty search explains what to type  ', kind: 'change' })
    await pane.input({ key: 'edit-done-A2', text: 'A hint shows under the box.', kind: 'change' })
    await pane.press({ key: 'edit-save-A2' })
    expect(await pane.find({ key: 'edit-plain-A2' })).toBeUndefined()
    const found = changes()
    expect(found.every(([path]) => INBOX_FILE.test(path))).toBe(true)
    expect(new Set(found.map(([path]) => path)).size).toBe(3)
    expect(found.map(([, text]) => JSON.parse(text))).toEqual([
      { op: 'first', id: 'A2' },
      { op: 'skip', id: 'A2' },
      { op: 'edit', id: 'A2', plain: 'An empty search explains what to type', done_when: 'A hint shows under the box.' },
    ])
    await pane.press({ key: 'edit-A2' })
    await pane.input({ key: 'edit-plain-A2', text: '   ', kind: 'change' })
    await pane.press({ key: 'edit-save-A2' })
    expect(changes()).toHaveLength(3)
    await pane.press({ key: 'edit-cancel-A2' })
    expect(await pane.find({ key: 'edit-plain-A2' })).toBeUndefined()
    expect(changes()).toHaveLength(3)
    await pane.press({ key: 'edit-A2' })
    await pane.press({ key: 'task-A2' })
    await pane.press({ key: 'task-A2' })
    expect(await pane.find({ key: 'edit-plain-A2' })).toBeUndefined()
    expect(toasts).toEqual([
      "'Empty search says so' runs next. Applied before the next task starts.",
      "'Empty search says so' will be skipped. Applied before the next task starts.",
      "Saved your edit of 'Empty search says so'. Applied before the next task starts.",
      'Say what the task should do before saving',
    ])
    await pane.press({ key: 'task-A2' })
    await pane.unmount()
  }
  const mobile = await $.ui.mount({ ...PANE_TARGET, surface: 'mobile' })
  await mobile.press({ key: 'task-A2' })
  expect(await mobile.find({ key: 'first-A2' })).toBeDefined()
  expect(await mobile.find({ key: 'edit-A2' })).toBeUndefined()
  await mobile.unmount()
})

test("'+ Add a task' opens a form whose Add to the loop writes one add change", async ($, on) => {
  const files: Record<string, string> = {
    '/project/.loop/feature_list.json': STEER_FEATURES,
    '/project/.loop/live.json': JSON.stringify({ state: 'running', started_at: 1000, updated_at: 3990, running: [{ item: 'A1', worker: 1, started_at: 3700 }] }),
  }
  const written: Record<string, string> = {}
  const toasts: string[] = []
  answerLogged(on, files, [], written, toasts)
  await $.command.run(RUN_COMMAND)
  const changes = () => Object.entries(written).filter(([path]) => path.includes('/inbox/'))
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const path of Object.keys(written)) delete written[path]
    toasts.length = 0
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ key: 'add-plain' })).toBeUndefined()
    await pane.press({ key: 'pane-add' })
    await pane.press({ key: 'add-submit' })
    expect(changes()).toHaveLength(0)
    await pane.input({ key: 'add-plain', text: '  Search suggests products as you type  ', kind: 'change' })
    await pane.input({ key: 'add-done', text: 'Typing three letters shows suggestions.', kind: 'change' })
    expect(await pane.find({ key: 'add-metrics' })).toBeUndefined()
    await pane.press({ key: 'add-submit' })
    expect(await pane.find({ key: 'add-plain' })).toBeUndefined()
    await pane.press({ key: 'pane-add' })
    await pane.input({ key: 'add-plain', text: 'Measure search quality', kind: 'change' })
    await pane.select({ key: 'add-area', value: 'Search' })
    await pane.select({ key: 'add-kind', value: 'eval' })
    await pane.select({ key: 'add-when', value: 'next' })
    await pane.input({ key: 'add-metrics', text: 'precision@5>=0.75, recall@10 ,', kind: 'change' })
    await pane.press({ key: 'add-submit' })
    await pane.press({ key: 'pane-add' })
    await pane.input({ key: 'add-plain', text: 'Something', kind: 'change' })
    await pane.press({ key: 'add-cancel' })
    expect(await pane.find({ key: 'add-plain' })).toBeUndefined()
    const found = changes()
    expect(found.every(([path]) => INBOX_FILE.test(path))).toBe(true)
    expect(found.map(([, text]) => JSON.parse(text))).toEqual([
      { op: 'add', plain: 'Search suggests products as you type', done_when: 'Typing three letters shows suggestions.', area: 'Added by you', kind: 'build' },
      { op: 'add', plain: 'Measure search quality', done_when: '', area: 'Search', kind: 'eval', metrics: [{ name: 'precision@5', target: 0.75 }, { name: 'recall@10' }], first: true },
    ])
    expect(toasts).toEqual([
      'Say what the new task should do before adding it',
      "Added 'Search suggests products as you type'. Applied before the next task starts.",
      "Added 'Measure search quality'. Applied before the next task starts.",
    ])
    await pane.unmount()
  }
  const mobile = await $.ui.mount({ ...PANE_TARGET, surface: 'mobile' })
  expect(await mobile.find({ key: 'pane-add' })).toBeUndefined()
  await mobile.unmount()
})

test("waiting changes show as plain lines in 'Your changes', with when they apply and an Undo that removes the file", async ($, on) => {
  const inbox: Record<string, unknown> = {
    '3999001-a1.json': { op: 'add', plain: 'Search: suggests products as you type', area: 'Search' },
    '3999002-b2.json': { op: 'edit', id: 'A2', plain: 'An empty search explains what to type' },
    '3999003-c3.json': { op: 'skip', id: 'A2' },
    '3999004-d4.json': { op: 'first', id: 'A2' },
    '3999005-e5.json': { op: 'review', id: 'A3', verdict: 'approved' },
    '3999006-f6.json': { op: 'review', id: 'A3', verdict: 'changes', note: 'The button is too small' },
    'notes.json': { op: 'skip', id: 'A2' },
    '3999007-g7.json.tmp': { op: 'skip', id: 'A2' },
    '3999008-h_8.json': { op: 'skip', id: 'A2' },
  }
  const files: Record<string, string> = {
    '/project/.loop/feature_list.json': STEER_FEATURES,
    '/project/.loop/live.json': JSON.stringify({ state: 'running', started_at: 1000, updated_at: 3990, running: [{ item: 'A1', worker: 1, started_at: 3700 }] }),
  }
  for (const [name, change] of Object.entries(inbox)) files[`/project/.loop/inbox/${name}`] = JSON.stringify(change)
  const removed: string[][] = []
  const toasts: string[] = []
  answerLogged(on, files, [], {}, toasts)
  on('fs.list', async (_, e) =>
    e.path === '/project/.loop/inbox'
      ? { value: Object.keys(files).flatMap(path => (path.startsWith('/project/.loop/inbox/') ? [{ ...ENTRY, kind: 'file' as const, name: path.slice(21) }] : [])) }
      : { deny: `ENOENT: ${e.path}` },
  )
  on('process.run', async (_, e) => {
    removed.push(e.argv)
    delete files[e.argv[2] ?? '']
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run(RUN_COMMAND)
  const lines = [
    "Add 'Search: suggests products as you type'",
    "Reword 'Empty search says so'",
    "Skip 'Empty search says so'",
    "Run 'Empty search says so' next",
    "Approve screenshots of 'Search is fast'",
    "Fix after review: 'The button is too small'",
  ]
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE_TARGET, surface })
    expect(await pane.find({ type: 'Text', text: /^Your changes · 6 waiting$/ })).toBeDefined()
    expect((await pane.findAll({ type: 'Text', text: /^(Add|Reword|Skip|Run|Approve|Fix after) / })).map(text => text.text)).toEqual(lines)
    expect(await pane.find({ type: 'Text', text: /^Applied before the next task starts\.$/ })).toBeDefined()
    expect(await pane.find({ key: 'undo-notes.json' })).toBeUndefined()
    await pane.unmount()
  }
  const pane = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  await pane.press({ key: 'undo-3999003-c3.json' })
  expect(removed).toEqual([['rm', '--', '/project/.loop/inbox/3999003-c3.json']])
  expect(await pane.find({ type: 'Text', text: /^Your changes · 5 waiting$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^Skip 'Empty search says so'$/ })).toBeUndefined()
  await pane.press({ key: 'task-A2' })
  await pane.press({ key: 'skip-A2' })
  expect(await pane.find({ type: 'Text', text: /^Your changes · 6 waiting$/ })).toBeDefined()
  await pane.unmount()

  files['/project/.loop/live.json'] = JSON.stringify({ state: 'stopped', started_at: 1000, updated_at: 3990, running: [] })
  await $.command.run(RUN_COMMAND)
  const stopped = await $.ui.mount({ ...PANE_TARGET, surface: 'desktop' })
  expect(await stopped.find({ type: 'Text', text: /^Applied when the loop runs next\.$/ })).toBeDefined()
  // A2 is still the open task from the terminal pane; its area no longer opens by itself once nothing runs.
  await stopped.press({ key: 'area-Search' })
  await stopped.press({ key: 'first-A2' })
  expect(toasts.at(-1)).toBe("'Empty search says so' runs next. Applied when the loop runs next.")
  await stopped.unmount()

  for (const path of Object.keys(files)) if (path.startsWith('/project/.loop/inbox/')) delete files[path]
  await $.command.run(RUN_COMMAND)
  const empty = await $.ui.mount({ ...PANE_TARGET, surface: 'desktop' })
  expect(await empty.find({ type: 'Text', text: /^Your changes/ })).toBeUndefined()
  await empty.unmount()
})

test('a design task shows its screenshots as thumbnails to open full size, then Looks right or Needs changes', async ($, on) => {
  const shot = (id: string, name: string) => `.loop/evidence/${id}/${name}`
  // A 1×1 PNG: the terminal's Image refuses bytes that are not a real PNG.
  const PNG_HEAD = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const files: Record<string, string> = {
    '/project/.loop/feature_list.json': JSON.stringify({
      features: [
        { id: 'D1', area: 'Design', plain: 'The pricing page looks like the sketch', kind: 'design', passes: true, evidence: { commit: 'abc', screenshots: [shot('D1', '1-home.png'), shot('D1', '2-pricing.png')] } },
        { id: 'D2', area: 'Design', plain: 'The footer looks right', kind: 'design', passes: true, review: 'approved', evidence: { commit: 'def', screenshots: [shot('D2', '1-footer.png')] } },
        { id: 'D3', area: 'Design', plain: 'The header looks right', kind: 'design', passes: true, evidence: { commit: 'ghi', screenshots: [shot('D3', '1-header.png')] } },
        { id: 'D4', area: 'Design', plain: 'The menu looks right', kind: 'design', passes: true, review: 'changes', evidence: { commit: 'jkl', screenshots: [shot('D4', '1-menu.png')] } },
        { id: 'D5', area: 'Design', plain: 'The poster looks right', kind: 'design', passes: true, evidence: { commit: 'mno', screenshots: [shot('D5', '1-huge.png')] } },
      ],
    }),
    '/project/.loop/live.json': JSON.stringify({ state: 'stopped', started_at: 1000, updated_at: 3990, running: [] }),
  }
  for (const name of ['D1/1-home', 'D1/2-pricing', 'D2/1-footer', 'D3/1-header', 'D4/1-menu', 'D5/1-huge']) files[`/project/.loop/evidence/${name}.png`] = 'png'
  const written: Record<string, string> = {}
  const toasts: string[] = []
  const runs: string[][] = []
  answerLogged(on, files, [], written, toasts)
  on('fs.list', async (_, e) =>
    e.path === '/project/.loop/inbox'
      ? { value: Object.keys(files).flatMap(path => (path.startsWith('/project/.loop/inbox/') ? [{ ...ENTRY, kind: 'file' as const, name: path.slice(21) }] : [])) }
      : { deny: `ENOENT: ${e.path}` },
  )
  on('process.run', async (_, e) => {
    runs.push(e.argv)
    const out = e.argv.at(-1) ?? ''
    // Each JPEG's bytes name its screenshot, so two thumbnails drawn at once cannot swap; the poster is too big for an Svg.
    const input = e.argv.at(-3) ?? ''
    if (e.argv[0] === 'sips') files[out] = out.endsWith('.png') ? PNG_HEAD : input.includes('huge') ? 'A'.repeat(140000) : btoa(input)
    const stdout = e.argv[0] === 'mktemp' ? '/tmp/thumbs\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run(RUN_COMMAND)
  const changes = () => Object.entries(written).filter(([path]) => path.includes('/inbox/'))

  const desktop = await $.ui.mount({ ...PANE_TARGET, surface: 'desktop' })
  await desktop.press({ key: 'area-Design' })
  await desktop.press({ key: 'task-D1' })
  const svgs = await desktop.findAll({ type: 'Svg' })
  expect(svgs.map(svg => /base64,([^"]+)"/.exec(String(svg.props.source))?.[1])).toEqual([btoa('/project/.loop/evidence/D1/1-home.png'), btoa('/project/.loop/evidence/D1/2-pricing.png')])
  expect(svgs.every(svg => String(svg.props.source).startsWith('<svg ') && svg.props.isInteractive === undefined)).toBe(true)
  expect(await desktop.find({ type: 'Image' })).toBeUndefined()
  expect((await desktop.findAll({ type: 'Text', text: /^\d-\w+\.png$/ })).map(text => text.text)).toEqual(['1-home.png', '2-pricing.png'])
  await desktop.press({ key: 'open-D1-1' })
  expect(runs.filter(argv => argv[0] === 'open')).toEqual([['open', '/project/.loop/evidence/D1/2-pricing.png']])
  await desktop.press({ key: 'approve-D1' })
  expect(await desktop.find({ type: 'Text', text: /^Your review is waiting for the loop$/ })).toBeDefined()
  expect(await desktop.find({ key: 'approve-D1' })).toBeUndefined()
  await desktop.press({ key: 'task-D3' })
  await desktop.press({ key: 'changes-D3' })
  await desktop.press({ key: 'review-send-D3' })
  await desktop.input({ key: 'review-note-D3', text: '  The logo is cut off on mobile  ', kind: 'change' })
  await desktop.press({ key: 'review-send-D3' })
  expect(await desktop.find({ key: 'review-note-D3' })).toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: /^Your review is waiting for the loop$/ })).toBeDefined()
  expect(changes().map(([, text]) => JSON.parse(text))).toEqual([
    { op: 'review', id: 'D1', verdict: 'approved' },
    { op: 'review', id: 'D3', verdict: 'changes', note: 'The logo is cut off on mobile' },
  ])
  expect(changes().every(([path]) => INBOX_FILE.test(path))).toBe(true)
  expect(toasts).toEqual([
    "Approved the screenshots of 'The pricing page looks like the sketch'. Applied when the loop runs next.",
    'Say what needs to change before sending it',
    "Sent your notes on 'The header looks right'. Applied when the loop runs next.",
  ])
  await desktop.press({ key: 'task-D2' })
  expect(await desktop.find({ type: 'Text', text: /^You approved these$/ })).toBeDefined()
  expect(await desktop.find({ key: 'approve-D2' })).toBeUndefined()
  expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(1)
  await desktop.press({ key: 'task-D4' })
  expect(await desktop.find({ type: 'Text', text: /^You asked for changes$/ })).toBeDefined()
  expect(await desktop.find({ key: 'approve-D4' })).toBeUndefined()
  await desktop.press({ key: 'task-D5' })
  expect(await desktop.find({ type: 'Svg' })).toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: /^1-huge\.png$/ })).toBeDefined()
  expect(await desktop.find({ key: 'open-D5-0' })).toBeDefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE_TARGET, surface: 'terminal' })
  await terminal.press({ key: 'task-D1' })
  const images = await terminal.findAll({ type: 'Image' })
  expect(images.map(image => image.props.source)).toEqual([{ png: PNG_HEAD }, { png: PNG_HEAD }])
  expect(images.every(image => image.props.columns === 40)).toBe(true)
  await terminal.unmount()
  // Redraws reuse thumbnails: one sips run per screenshot and format, each to its own file in one temp folder.
  const sips = runs.filter(argv => argv[0] === 'sips')
  const made = sips.map(argv => `${argv[5]} ${argv.at(-3)}`)
  expect(new Set(made).size).toBe(made.length)
  expect(made).toEqual(expect.arrayContaining(['jpeg /project/.loop/evidence/D1/1-home.png', 'png /project/.loop/evidence/D1/1-home.png', 'png /project/.loop/evidence/D1/2-pricing.png']))
  expect(new Set(sips.map(argv => argv.at(-1))).size).toBe(sips.length)
  expect(sips.every(argv => argv.at(-1)?.startsWith('/tmp/thumbs/'))).toBe(true)
  expect(runs.filter(argv => argv[0] === 'mktemp')).toHaveLength(1)

  const mobile = await $.ui.mount({ ...PANE_TARGET, surface: 'mobile' })
  await mobile.press({ key: 'task-D5' })
  expect(await mobile.find({ key: 'approve-D5' })).toBeDefined()
  expect(await mobile.find({ key: 'changes-D5' })).toBeUndefined()
  await mobile.unmount()
})
