import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALARM_RECONFIRM_WINDOW_MS,
  completeWithRetained,
  unconfirmedClearReason,
  type RetainedPoi
} from '../src/outputs/alarm-retention.js'
import { createNotificationTracker } from '../src/shared/notification-tracker.js'
import type { PoiSummary } from '../src/shared/types.js'
import { createCapturingApp, northOfOrigin, poiSummary as poi } from './helpers.js'

/** A tracker over the bare retained shape, with a clear value that names the point. */
function createTracker (): ReturnType<typeof createNotificationTracker<RetainedPoi>> {
  const { app } = createCapturingApp()
  return createNotificationTracker<RetainedPoi>({
    app,
    pathPrefix: 'notifications.test.',
    buildClearValue: ({ summary }, raisedAt) => ({
      state: 'normal',
      method: [],
      message: `cleared ${summary?.name ?? 'unknown'}`,
      createdAt: raisedAt
    })
  })
}

const WRECK: PoiSummary = poi('h1', 'Hazard', 'Wreck', northOfOrigin(111))
const MARINA: PoiSummary = poi('m1', 'Marina', 'Town quay', northOfOrigin(900))

test('a complete list is handed back untouched', () => {
  const tracker = createTracker()
  tracker.set(WRECK.id, { summary: WRECK, lastListedAt: 1000 })
  const pois = [WRECK, MARINA]

  const scanned = completeWithRetained(tracker, pois, 2000)

  assert.equal(scanned, pois, 'the caller keeps its own array when nothing is added')
  assert.equal(tracker.get(WRECK.id)?.lastListedAt, 2000, 'the reconfirmation clock restarts')
})

test('an omitted point is added back at the position a list last reported it', () => {
  const tracker = createTracker()
  tracker.set(WRECK.id, { summary: WRECK, lastListedAt: 1000 })

  const scanned = completeWithRetained(tracker, [MARINA], 2000)

  assert.deepEqual(scanned.map((entry) => entry.id), ['m1', 'h1'])
  assert.equal(scanned[1].position.latitude, WRECK.position.latitude)
  assert.equal(tracker.get(WRECK.id)?.lastListedAt, 1000, 'the hold does not count as a report')
})

test('a point held past the reconfirmation window is dropped and marked', () => {
  const tracker = createTracker()
  tracker.set(WRECK.id, { summary: WRECK, lastListedAt: 1000 })

  const stillHeld = completeWithRetained(tracker, [], 1000 + ALARM_RECONFIRM_WINDOW_MS)
  assert.deepEqual(stillHeld.map((entry) => entry.id), ['h1'], 'the window is inclusive')
  assert.equal(tracker.get(WRECK.id)?.unconfirmed, undefined)

  const dropped = completeWithRetained(tracker, [], 1001 + ALARM_RECONFIRM_WINDOW_MS)
  assert.deepEqual(dropped, [], 'past the window the point is no longer put back')
  assert.equal(tracker.get(WRECK.id)?.unconfirmed, true, 'the clear can now say why')
})

test('a point reported again after a hold restarts its window', () => {
  const tracker = createTracker()
  tracker.set(WRECK.id, { summary: WRECK, lastListedAt: 1000 })

  completeWithRetained(tracker, [], 1000 + ALARM_RECONFIRM_WINDOW_MS / 2)
  completeWithRetained(tracker, [WRECK], 1000 + ALARM_RECONFIRM_WINDOW_MS)

  const scanned = completeWithRetained(tracker, [], 1000 + ALARM_RECONFIRM_WINDOW_MS * 1.4)
  assert.deepEqual(scanned.map((entry) => entry.id), ['h1'], 'the fresh report bought a full window')
})

test('an entry with nothing held is left to the output own exit path', () => {
  const tracker = createTracker()
  tracker.set(WRECK.id, { lastListedAt: 1000 })

  const scanned = completeWithRetained(tracker, [], 2000)

  assert.deepEqual(scanned, [])
  assert.equal(tracker.get(WRECK.id)?.unconfirmed, undefined, 'and is not marked unconfirmed')
})

test('no active alarm means no work and no allocation', () => {
  const tracker = createTracker()
  const pois = [MARINA]

  assert.equal(completeWithRetained(tracker, pois, 2000), pois)
})

test('an alarming point is found however long the list it sits in', () => {
  const tracker = createTracker()
  tracker.set(WRECK.id, { summary: WRECK, lastListedAt: 1000 })
  // Only the alarming ids are indexed, so the point still has to be found in a
  // list whose other thousands of entries are never looked up.
  const crowded = Array.from({ length: 5000 }, (_unused, index) =>
    poi(`other-${index}`, 'Marina', `Marina ${index}`, northOfOrigin(1000 + index)))
  const moved = { ...WRECK, position: northOfOrigin(150) }

  const scanned = completeWithRetained(tracker, [...crowded, moved], 2000)

  assert.equal(scanned.length, 5001, 'nothing was added, so the caller keeps its own array')
  assert.equal(tracker.get(WRECK.id)?.lastListedAt, 2000)
  assert.equal(tracker.get(WRECK.id)?.summary?.position.latitude, moved.position.latitude,
    'and the hold is refreshed to where the list now reports it')
})

test('a repeated id is held at the last entry the list carries for it', () => {
  const tracker = createTracker()
  tracker.set(WRECK.id, { summary: WRECK, lastListedAt: 1000 })
  const first = { ...WRECK, position: northOfOrigin(120) }
  const second = { ...WRECK, position: northOfOrigin(140) }

  completeWithRetained(tracker, [first, second], 2000)

  assert.equal(tracker.get(WRECK.id)?.summary?.position.latitude, second.position.latitude)
})

test('the unconfirmed reason names the window and where the vessel still is', () => {
  const reason = unconfirmedClearReason('within the alarm radius')

  assert.ok(reason.includes('30 minutes'))
  assert.ok(reason.includes('still within the alarm radius'))
})

test('the window runs on the request time, so replaying one result cannot restart it', () => {
  const tracker = createTracker()
  tracker.set(WRECK.id, { summary: WRECK, lastListedAt: 1000 })
  // One result, replayed by the monitor over and over while every later
  // request fails: each replay carries the time its own request landed.
  const replayed = [WRECK]
  const fetchedAt = 1000

  for (let pass = 0; pass < ALARM_RECONFIRM_WINDOW_MS / 60_000 * 2; pass += 1) {
    completeWithRetained(tracker, replayed, fetchedAt)
  }

  assert.equal(tracker.get(WRECK.id)?.lastListedAt, 1000,
    'a replay is not a fresh report, however many times it runs')

  // The point is not in a fresh result either, so the hold expires on the same
  // window as a point a source answered without.
  const scanned = completeWithRetained(tracker, [], 1001 + ALARM_RECONFIRM_WINDOW_MS)
  assert.deepEqual(scanned, [])
  assert.equal(tracker.get(WRECK.id)?.unconfirmed, true)
})
