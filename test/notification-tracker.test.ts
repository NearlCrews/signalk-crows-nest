import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotificationTracker } from '../src/shared/notification-tracker.js'
import type { NotificationValue } from '../src/shared/notification-path.js'

interface Captured { path: string }

/** A tracker over a mock app that records the notification path of each emit. */
function createTracker (): { tracker: ReturnType<typeof createNotificationTracker<{ name: string }>>, paths: Captured[] } {
  const paths: Captured[] = []
  const app = {
    handleMessage: (_id: string, delta: { updates?: Array<{ values?: Array<{ path: string }> }> }): void => {
      for (const update of delta.updates ?? []) {
        for (const value of update.values ?? []) {
          paths.push({ path: value.path })
        }
      }
    },
    debug: (): void => {}
  }
  const clearValue: NotificationValue = {
    state: 'normal', method: [], message: 'cleared', createdAt: '2026-01-01T00:00:00.000Z'
  }
  const tracker = createNotificationTracker<{ name: string }>({
    app: app as unknown as Parameters<typeof createNotificationTracker>[0]['app'],
    pathPrefix: 'notifications.test.',
    buildClearValue: () => clearValue
  })
  return { tracker, paths }
}

test('clearStale keeps a still-active entry whose raw id sanitizes, matching the wire identity', () => {
  const { tracker, paths } = createTracker()
  // An id with a '.' sanitizes to '_' on the wire and in the tracker key.
  tracker.set('wreck.123', { name: 'Wreck' })
  // The caller passes the RAW id as still active. clearStale sanitizes it into
  // the tracker's key space, so the still-active entry is NOT cleared. The old
  // raw-vs-sanitized comparison would have cleared and re-raised it every tick.
  tracker.clearStale(['wreck.123'])
  assert.equal(paths.length, 0, 'a still-active alarm must not be cleared (no chatter)')
  assert.equal(tracker.has('wreck.123'), true)
})

test('clearStale clears an entry that is no longer active', () => {
  const { tracker, paths } = createTracker()
  tracker.set('a', { name: 'A' })
  tracker.set('b', { name: 'B' })
  tracker.clearStale(['a'])
  assert.equal(tracker.has('a'), true, 'a stays active')
  assert.equal(tracker.has('b'), false, 'b is cleared')
  assert.equal(paths.length, 1, 'exactly one clear notification emitted')
  assert.ok(paths[0].path.endsWith('.b'))
})
