import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BudgetTracker } from '../src/route-draft/budget.js'
import { silentLog } from './helpers.js'

/** A fixed clock at a known UTC day. */
function fixedNow (iso: string): () => Date {
  const date = new Date(iso)
  return () => date
}

test('a cold start allows calls up to the daily cap, then refuses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rd-budget-'))
  try {
    const statePath = join(dir, 'budget.json')
    const budget = await BudgetTracker.load({
      maxPerDay: 2,
      statePath,
      now: fixedNow('2026-06-14T08:00:00Z'),
      log: silentLog
    })
    assert.equal(budget.canSpend(), true, 'first call permitted')
    await budget.recordCall()
    assert.equal(budget.canSpend(), true, 'second call permitted')
    await budget.recordCall()
    assert.equal(budget.canSpend(), false, 'the cap refuses the third call')
    assert.equal(budget.callsToday(), 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the call count persists across a reload on the same day', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rd-budget-'))
  try {
    const statePath = join(dir, 'budget.json')
    const now = fixedNow('2026-06-14T08:00:00Z')
    const first = await BudgetTracker.load({ maxPerDay: 5, statePath, now, log: silentLog })
    await first.recordCall()
    await first.recordCall()

    const reloaded = await BudgetTracker.load({ maxPerDay: 5, statePath, now, log: silentLog })
    assert.equal(reloaded.callsToday(), 2, 'the persisted count is read back')
    assert.equal(reloaded.canSpend(), true)

    const persisted = JSON.parse(await readFile(statePath, 'utf-8')) as { day: string, callsToday: number }
    assert.deepEqual(persisted, { day: '2026-06-14', callsToday: 2 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the count rolls over at the UTC day boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rd-budget-'))
  try {
    const statePath = join(dir, 'budget.json')
    let clock = new Date('2026-06-14T23:59:00Z')
    const budget = await BudgetTracker.load({
      maxPerDay: 1,
      statePath,
      now: () => clock,
      log: silentLog
    })
    await budget.recordCall()
    assert.equal(budget.canSpend(), false, 'today is exhausted')

    // Advance past midnight UTC: the counter rolls over to a fresh day.
    clock = new Date('2026-06-15T00:01:00Z')
    assert.equal(budget.canSpend(), true, 'the new day resets the counter')
    assert.equal(budget.callsToday(), 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a stored count from a prior day does not carry into today', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rd-budget-'))
  try {
    const statePath = join(dir, 'budget.json')
    await writeFile(statePath, JSON.stringify({ day: '2026-06-13', callsToday: 9 }))
    const budget = await BudgetTracker.load({
      maxPerDay: 2,
      statePath,
      now: fixedNow('2026-06-14T08:00:00Z'),
      log: silentLog
    })
    assert.equal(budget.callsToday(), 0, 'yesterday\'s count rolls over on the first read')
    assert.equal(budget.canSpend(), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unreadable state file degrades to a fresh counter and logs once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rd-budget-'))
  try {
    const statePath = join(dir, 'budget.json')
    await writeFile(statePath, 'not json at all')
    const logged: string[] = []
    const budget = await BudgetTracker.load({
      maxPerDay: 3,
      statePath,
      now: fixedNow('2026-06-14T08:00:00Z'),
      log: { debug: (m) => logged.push(m), error: () => {} }
    })
    assert.equal(budget.callsToday(), 0, 'corrupt state resets the daily counter')
    assert.equal(budget.canSpend(), true)
    assert.equal(logged.length, 1, 'the unexpected unreadable case is surfaced')
    assert.match(logged[0], /unreadable/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a missing state file is the silent first-run case (no log)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rd-budget-'))
  try {
    const statePath = join(dir, 'budget.json')
    const logged: string[] = []
    const budget = await BudgetTracker.load({
      maxPerDay: 3,
      statePath,
      now: fixedNow('2026-06-14T08:00:00Z'),
      log: { debug: (m) => logged.push(m), error: () => {} }
    })
    assert.equal(budget.callsToday(), 0)
    assert.equal(logged.length, 0, 'ENOENT is expected and not logged')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a negative stored count is rejected and reset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rd-budget-'))
  try {
    const statePath = join(dir, 'budget.json')
    await writeFile(statePath, JSON.stringify({ day: '2026-06-14', callsToday: -3 }))
    const budget = await BudgetTracker.load({
      maxPerDay: 2,
      statePath,
      now: fixedNow('2026-06-14T08:00:00Z'),
      log: silentLog
    })
    assert.equal(budget.callsToday(), 0, 'a negative count cannot grant free calls')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
