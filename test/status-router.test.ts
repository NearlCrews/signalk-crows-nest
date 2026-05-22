import test from 'node:test'
import assert from 'node:assert/strict'
import type { ServerAPI } from '@signalk/server-api'
import type { IRouter } from 'express'
import { createStatusRouter } from '../src/status/status-router.js'
import type { StatusSnapshot } from '../src/status/status-types.js'

/** A representative snapshot for the route handler to serve. */
const SNAPSHOT: StatusSnapshot = {
  apiReachable: true,
  lastListFetch: { at: '2026-01-01T00:00:00.000Z', poiCount: 3 },
  cachedPoiCount: 5,
  recentErrors: [],
  startedAt: '2026-01-01T00:00:00.000Z'
}

/** A router stub recording every mounted route and its handler. */
function createStubRouter (): {
  router: IRouter
  routes: string[]
  handlerFor: (path: string) => ((req: unknown, res: unknown) => void) | undefined
} {
  const routes: string[] = []
  const handlers = new Map<string, (req: unknown, res: unknown) => void>()
  const router = {
    get: (path: string, handler: (req: unknown, res: unknown) => void) => {
      routes.push(path)
      handlers.set(path, handler)
    }
  }
  return {
    router: router as unknown as IRouter,
    routes,
    handlerFor: (path) => handlers.get(path)
  }
}

test('admin-gates the api subtree and mounts the status route', () => {
  const gatedPaths: string[] = []
  const app = {
    error: () => {},
    securityStrategy: {
      addAdminMiddleware: (path: string) => { gatedPaths.push(path) }
    }
  } as unknown as ServerAPI
  const stub = createStubRouter()

  createStatusRouter(app, () => SNAPSHOT)(stub.router)

  assert.equal(gatedPaths.length, 1, 'the api subtree is admin-gated')
  assert.deepEqual(stub.routes, ['/api/status'], 'the status route is mounted')

  let body: unknown
  stub.handlerFor('/api/status')?.({}, { json: (payload: unknown) => { body = payload } })
  assert.deepEqual(body, SNAPSHOT, 'the route handler serves the snapshot')
})

test('does not mount the status route when addAdminMiddleware is unavailable', () => {
  const errors: string[] = []
  const app = { error: (message: string) => errors.push(message) } as unknown as ServerAPI
  const stub = createStubRouter()

  createStatusRouter(app, () => SNAPSHOT)(stub.router)

  assert.deepEqual(stub.routes, [], 'the ungated status route is not mounted')
  assert.ok(
    errors.some((message) => message.includes('addAdminMiddleware is unavailable')),
    'the missing gate is logged'
  )
  assert.ok(
    errors.some((message) => message.includes('Status API unavailable')),
    'the unmounted route is logged as unavailable'
  )
})

test('does not mount the status route when addAdminMiddleware throws', () => {
  const errors: string[] = []
  const app = {
    error: (message: string) => errors.push(message),
    securityStrategy: {
      addAdminMiddleware: () => { throw new Error('gate boom') }
    }
  } as unknown as ServerAPI
  const stub = createStubRouter()

  createStatusRouter(app, () => SNAPSHOT)(stub.router)

  assert.deepEqual(stub.routes, [], 'the ungated status route is not mounted')
  assert.ok(
    errors.some((message) => message.includes('gate boom')),
    'the thrown gate error is logged'
  )
  assert.ok(
    errors.some((message) => message.includes('Status API unavailable')),
    'the unmounted route is logged as unavailable'
  )
})
