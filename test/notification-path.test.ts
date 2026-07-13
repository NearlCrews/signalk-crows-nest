import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emitNotification,
  sanitizePoiId,
  type NotificationEmitterApp,
  type NotificationValue
} from '../src/shared/notification-path.js'
import { PLUGIN_ID } from '../src/shared/plugin-id.js'

test('sanitizePoiId leaves a path-safe id unchanged', () => {
  assert.equal(sanitizePoiId('12345'), '12345')
  assert.equal(sanitizePoiId('keep-_ok'), 'keep-_ok')
})

test('sanitizePoiId replaces every path-breaking character', () => {
  assert.equal(sanitizePoiId('a.b/c'), 'a_b_c')
  assert.equal(sanitizePoiId('x y.z'), 'x_y_z')
})

test('emitNotification builds the shared notification delta', () => {
  const captured: Array<{ id: string, delta: unknown }> = []
  const app: NotificationEmitterApp = {
    handleMessage: (id, delta) => { captured.push({ id, delta }) }
  }
  const value: NotificationValue = {
    state: 'alarm',
    method: ['visual', 'sound'],
    message: 'Rock ahead',
    createdAt: '2026-05-22T00:00:00.000Z'
  }

  emitNotification(
    app,
    'notifications.navigation.crowsNest.hazard.',
    'h1',
    value,
    undefined,
    () => new Date('2026-05-22T00:05:00.000Z')
  )

  assert.equal(captured.length, 1)
  assert.equal(captured[0].id, PLUGIN_ID)
  assert.deepEqual(captured[0].delta, {
    updates: [{
      $source: PLUGIN_ID,
      timestamp: '2026-05-22T00:05:00.000Z',
      values: [{
        path: 'notifications.navigation.crowsNest.hazard.h1',
        value
      }]
    }]
  })
  assert.equal(value.createdAt, '2026-05-22T00:00:00.000Z')
})

test('emitNotification sanitizes the POI id embedded in the path', () => {
  const paths: unknown[] = []
  const app: NotificationEmitterApp = {
    handleMessage: (_id, delta) => {
      const update = delta.updates?.[0]
      if (update !== undefined && 'values' in update) {
        for (const pathValue of update.values) {
          paths.push(pathValue.path)
        }
      }
    }
  }

  emitNotification(
    app,
    'notifications.navigation.crowsNest.route.',
    'a.b/c',
    {
      state: 'normal',
      method: [],
      message: 'cleared',
      createdAt: '2026-05-22T00:00:00.000Z'
    }
  )

  assert.deepEqual(paths, ['notifications.navigation.crowsNest.route.a_b_c'])
})
