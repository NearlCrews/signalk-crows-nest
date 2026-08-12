/**
 * Admin-gated status endpoint for the configuration panel.
 *
 * The plugin's Express router is mounted by the server at
 * `/plugins/signalk-crows-nest`. This module adds a single
 * `GET /api/status` route that serves the StatusSnapshot the panel polls,
 * as an admin-only route. Signal K's public `PluginRouter` contract keeps
 * routes registered directly on the router behind admin authentication.
 */

import type { PluginRouter } from '@signalk/server-api'
import type { StatusSnapshot } from './status-types.js'

/**
 * Build the `registerWithRouter` implementation for the plugin.
 *
 * @param getSnapshot Supplies the current StatusSnapshot for each request.
 */
export function createStatusRouter (
  getSnapshot: () => StatusSnapshot
): (router: PluginRouter) => void {
  // Track per-router so a fresh router (a new plugin start hands us a new
  // one) gets its GET handler mounted exactly once, but a re-invocation
  // against the same router (which would otherwise stack duplicate handlers
  // Express would never reach past the first) is skipped.
  const handlerMounted = new WeakSet<PluginRouter>()

  return (router: PluginRouter): void => {
    if (handlerMounted.has(router)) {
      return
    }
    router.get('/api/status', (_req, res) => {
      res.json(getSnapshot())
    })
    handlerMounted.add(router)
  }
}
