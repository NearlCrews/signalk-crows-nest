import test from 'node:test'
import assert from 'node:assert/strict'
import type { PluginRouter, RouteAccessLevel } from '@signalk/server-api'
import { createStatusRouter } from '../src/status/status-router.js'
import type { StatusSnapshot } from '../src/status/status-types.js'

/** A representative snapshot for the route handler to serve. */
const SNAPSHOT: StatusSnapshot = {
  sources: [
    {
      source: 'activecaptain',
      name: 'Garmin ActiveCaptain',
      apiReachable: true,
      lastListFetch: { at: '2026-01-01T00:00:00.000Z', poiCount: 3 },
      lastSkip: null
    }
  ],
  cachedPoiCount: 5,
  recentErrors: [],
  startedAt: '2026-01-01T00:00:00.000Z'
}

/** A router stub recording every mounted route and its handler. */
function createStubRouter (): {
  router: PluginRouter
  routes: string[]
  accessLevels: RouteAccessLevel[]
  handlerFor: (path: string) => ((req: unknown, res: unknown) => void) | undefined
} {
  const routes: string[] = []
  const accessLevels: RouteAccessLevel[] = []
  const handlers = new Map<string, (req: unknown, res: unknown) => void>()
  const router = {
    get: (path: string, handler: (req: unknown, res: unknown) => void) => {
      routes.push(path)
      handlers.set(path, handler)
    },
    access: (level: RouteAccessLevel): never => {
      accessLevels.push(level)
      throw new Error('the status endpoint must remain admin-only')
    }
  }
  return {
    router: router as unknown as PluginRouter,
    routes,
    accessLevels,
    handlerFor: (path) => handlers.get(path)
  }
}

test('mounts the status route directly so the host keeps it admin-only', () => {
  const stub = createStubRouter()

  createStatusRouter(() => SNAPSHOT)(stub.router)

  assert.deepEqual(stub.accessLevels, [], 'the route is not opened to a lower access level')
  assert.deepEqual(stub.routes, ['/api/status'], 'the status route is mounted')

  let body: unknown
  stub.handlerFor('/api/status')?.({}, { json: (payload: unknown) => { body = payload } })
  assert.deepEqual(body, SNAPSHOT, 'the route handler serves the snapshot')
})

test('mounts the status route on each host-provided router', () => {
  const register = createStatusRouter(() => SNAPSHOT)
  const first = createStubRouter()
  const second = createStubRouter()
  register(first.router)
  register(second.router)
  assert.deepEqual(first.routes, ['/api/status'])
  assert.deepEqual(second.routes, ['/api/status'])
})

test('re-invocation against the same router does not stack a duplicate GET handler', () => {
  // Mounting the GET handler twice would leave a phantom second handler
  // Express never reaches, but still costs a slot in the route table.
  const register = createStatusRouter(() => SNAPSHOT)
  const stub = createStubRouter()
  register(stub.router)
  register(stub.router)
  assert.deepEqual(stub.routes, ['/api/status'], 'the status route is mounted exactly once')
})
