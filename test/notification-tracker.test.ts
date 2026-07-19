import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotificationTracker } from '../src/shared/notification-tracker.js'

/** One captured emit: the notification path and the value's episode timestamp. */
interface Captured { path: string, createdAt: string }

/**
 * A tracker over a mock app that records the path and `createdAt` of each emit.
 * `buildClearValue` echoes the tracker-stamped `raisedAt` into `createdAt`, so a
 * test can assert the clear delta carries the alarm episode's start time rather
 * than the clear time.
 */
function createTracker (): { tracker: ReturnType<typeof createNotificationTracker<{ name: string }>>, captured: Captured[] } {
  const captured: Captured[] = []
  const app = {
    handleMessage: (_id: string, delta: { updates?: Array<{ values?: Array<{ path: string, value: { createdAt: string } }> }> }): void => {
      for (const update of delta.updates ?? []) {
        for (const value of update.values ?? []) {
          captured.push({ path: value.path, createdAt: value.value.createdAt })
        }
      }
    },
    debug: (): void => {}
  }
  const tracker = createNotificationTracker<{ name: string }>({
    app: app as unknown as Parameters<typeof createNotificationTracker>[0]['app'],
    pathPrefix: 'notifications.test.',
    buildClearValue: (_entry, raisedAt) => ({
      state: 'normal', method: [], message: 'cleared', createdAt: raisedAt
    })
  })
  return { tracker, captured }
}

test('clearStale keeps a still-active entry whose raw id is encoded, matching the wire identity', () => {
  const { tracker, captured } = createTracker()
  // An id with a '.' is encoded on the wire and in the tracker key.
  tracker.set('wreck.123', { name: 'Wreck' })
  // The caller passes the raw id as still active. clearStale encodes it into
  // the tracker's key space, so the still-active entry is NOT cleared. The old
  // raw-vs-sanitized comparison would have cleared and re-raised it every tick.
  tracker.clearStale(['wreck.123'])
  assert.equal(captured.length, 0, 'a still-active alarm must not be cleared (no chatter)')
  assert.equal(tracker.has('wreck.123'), true)
})

test('clearStale clears an entry that is no longer active', () => {
  const { tracker, captured } = createTracker()
  tracker.set('a', { name: 'A' })
  tracker.set('b', { name: 'B' })
  tracker.clearStale(['a'])
  assert.equal(tracker.has('a'), true, 'a stays active')
  assert.equal(tracker.has('b'), false, 'b is cleared')
  assert.equal(captured.length, 1, 'exactly one clear notification emitted')
  assert.ok(captured[0].path.endsWith('.b'))
})

test('set stamps a raisedAt ISO timestamp on the first set of an id', () => {
  const { tracker } = createTracker()
  const before = Date.now()
  const raisedAt = tracker.set('poi-1', { name: 'One' })
  const after = Date.now()
  const stampMs = Date.parse(raisedAt)
  assert.ok(Number.isFinite(stampMs), 'raisedAt parses as a date')
  assert.ok(stampMs >= before && stampMs <= after, 'raisedAt is the moment of the first set')
})

test('set preserves raisedAt across an overwrite refresh of the same key', () => {
  const { tracker } = createTracker()
  const first = tracker.set('poi-1', { name: 'One' })
  // A refresh (a new entry for the same id, e.g. an updated distance) must keep
  // the episode start, not restamp it.
  const second = tracker.set('poi-1', { name: 'One, moved closer' })
  assert.equal(second, first, 'the refresh returns the original episode start time')
  assert.deepEqual(tracker.get('poi-1'), { name: 'One, moved closer' }, 'the entry itself is updated')
})

test('the clear delta reuses the preserved raisedAt, not the clear time', () => {
  const { tracker, captured } = createTracker()
  const raisedAt = tracker.set('poi-1', { name: 'One' })
  tracker.set('poi-1', { name: 'One, refreshed' })
  tracker.clearAll()
  assert.equal(captured.length, 1, 'one clear delta emitted')
  assert.equal(captured[0].createdAt, raisedAt, 'the clear delta carries the episode start, preserved across the refresh')
})

test('distinct raw ids do not alias in tracker state or on-wire paths', () => {
  const { tracker, captured } = createTracker()
  tracker.set('a.b', { name: 'Dotted' })
  tracker.set('a_b', { name: 'Scored' })

  assert.equal(tracker.has('a.b'), true)
  assert.equal(tracker.has('a_b'), true)
  assert.deepEqual(tracker.get('a.b'), { name: 'Dotted' })
  assert.deepEqual(tracker.get('a_b'), { name: 'Scored' })

  tracker.clearStale(['a.b'])
  assert.equal(tracker.has('a.b'), true, 'the dotted id remains active')
  assert.equal(tracker.has('a_b'), false, 'the scored id clears independently')
  assert.deepEqual(captured.map(entry => entry.path), ['notifications.test.a_b'])

  tracker.clearAll()
  assert.deepEqual(captured.map(entry => entry.path), [
    'notifications.test.a_b',
    'notifications.test.escaped.YS5i'
  ])
})

test('has and get report entries by raw id, and clearAll empties the tracker', () => {
  const { tracker, captured } = createTracker()
  assert.equal(tracker.has('poi-1'), false, 'an unknown id is not active')
  assert.equal(tracker.get('poi-1'), undefined, 'an unknown id has no entry')

  tracker.set('poi-1', { name: 'One' })
  tracker.set('poi-2', { name: 'Two' })
  assert.equal(tracker.has('poi-1'), true)
  assert.deepEqual(tracker.get('poi-1'), { name: 'One' }, 'get returns the stored entry')
  // get and has encode their argument into the same key space used on the wire.
  // A distinct safe id that resembles the old replacement form must not alias.
  tracker.set('dot.id', { name: 'Dotted' })
  assert.equal(tracker.has('dot.id'), true)
  assert.equal(tracker.has('dot_id'), false, 'a distinct safe id does not alias')
  assert.equal(tracker.get('dot_id'), undefined)

  tracker.clearAll()
  assert.equal(captured.length, 3, 'clearAll emits one clear per active entry')
  assert.ok(captured.every((entry) => entry.path.startsWith('notifications.test.')))
  assert.equal(tracker.has('poi-1'), false, 'clearAll drops every entry')
  assert.equal(tracker.get('poi-2'), undefined)
})
