/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Admin-gated status endpoint for the configuration panel.
 *
 * The plugin's Express router is mounted by the server at
 * `/plugins/signalk-activecaptain-resources`. This module adds a single
 * `GET /api/status` route that serves the StatusSnapshot the panel polls, and
 * gates the whole `/api` subtree behind the server's admin middleware. Without
 * that gate the endpoint would be reachable by anyone on the admin port;
 * plugin routers receive no authentication by default.
 */

import type { IRouter } from 'express'
import type { ServerAPI } from '@signalk/server-api'
import { PLUGIN_ID } from './pluginId.js'
import type { StatusSnapshot } from './statusTypes.js'

/** Subtree to admin-gate, an absolute path under the mounted router. */
const API_PATH = `/plugins/${PLUGIN_ID}/api`

/**
 * The slice of the server's security strategy this module needs. The
 * `@signalk/server-api` ServerAPI type does not currently expose
 * `securityStrategy`, so we narrow to the single method we call rather than
 * casting through `any`. The real signalk-server always provides it.
 */
interface SecurityAwareApp {
  securityStrategy: {
    addAdminMiddleware: (path: string) => void
  }
}

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
  return (router: IRouter): void => {
    // Admin-gate the API subtree. The real signalk-server always provides
    // securityStrategy; guarding the call means a server that does not still
    // gets the route mounted, rather than failing registerWithRouter outright
    // and leaving the panel with no status endpoint at all.
    try {
      const securityAware = app as unknown as Partial<SecurityAwareApp>
      if (typeof securityAware.securityStrategy?.addAdminMiddleware === 'function') {
        securityAware.securityStrategy.addAdminMiddleware(API_PATH)
      } else {
        app.error(`Cannot admin-gate ${API_PATH}: securityStrategy.addAdminMiddleware is unavailable`)
      }
    } catch (error) {
      app.error(`Cannot admin-gate ${API_PATH}: ${String(error)}`)
    }

    router.get('/api/status', (_req, res) => {
      res.json(getSnapshot())
    })
  }
}
