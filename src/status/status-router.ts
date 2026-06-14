/**
 * Admin-gated status endpoint for the configuration panel.
 *
 * The plugin's Express router is mounted by the server at
 * `/plugins/signalk-crows-nest`. This module adds a single
 * `GET /api/status` route that serves the StatusSnapshot the panel polls,
 * behind the shared `/api` admin gate (see {@link ensureApiAdminGate}). Without
 * that gate the endpoint would be reachable by anyone on the admin port;
 * plugin routers receive no authentication by default, so the route fails
 * closed (unmounted) if the gate cannot be installed.
 */

import type { IRouter } from 'express'
import type { ServerAPI } from '@signalk/server-api'
import { ensureApiAdminGate } from './admin-gate.js'
import type { StatusSnapshot } from './status-types.js'

/**
 * Build the `registerWithRouter` implementation for the plugin.
 *
 * @param app         The SignalK server API, used for the admin gate.
 * @param getSnapshot Supplies the current StatusSnapshot for each request.
 */
export function createStatusRouter (
  app: ServerAPI,
  getSnapshot: () => StatusSnapshot
): (router: IRouter) => void {
  // Track per-router so a fresh router (a new plugin start hands us a new
  // one) gets its GET handler mounted exactly once, but a re-invocation
  // against the same router (which would otherwise stack duplicate handlers
  // Express would never reach past the first) is skipped.
  const handlerMounted = new WeakSet<IRouter>()

  return (router: IRouter): void => {
    if (!ensureApiAdminGate(app)) {
      app.error(
        'Status API unavailable: the /api/status route was not mounted because it could not be admin-gated'
      )
      return
    }

    if (handlerMounted.has(router)) {
      return
    }
    router.get('/api/status', (_req, res) => {
      res.json(getSnapshot())
    })
    handlerMounted.add(router)
  }
}
