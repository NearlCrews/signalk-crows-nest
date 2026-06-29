/**
 * Admin-gate the plugin's `/api` subtree, once per app.
 *
 * The plugin's Express router is mounted by the server at
 * `/plugins/signalk-crows-nest`, and plugin routers receive no authentication
 * by default, so every `/api` route must sit behind the server's admin
 * middleware. This helper installs that gate exactly once per app and reports
 * whether it is in place, so a caller mounts its route only when the gate
 * holds: a route that cannot be gated fails CLOSED (unmounted) rather than
 * answering unauthenticated callers.
 *
 * All plugin API routes gate the same path, so the gate logic lives here once.
 * The gate is
 * path-scoped and the path is fixed for the life of the plugin, so calling
 * `addAdminMiddleware` more than once would stack duplicate gates on the same
 * path; the per-app guard installs it exactly once across enable, disable, and
 * re-enable cycles on a long-running server.
 */

import type { ServerAPI } from '@signalk/server-api'
import { PLUGIN_ID } from '../shared/plugin-id.js'

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
 * Apps whose `/api` subtree has already been admin-gated. Keyed by the app
 * object so the path-scoped middleware is installed exactly once per app.
 */
const gatedApps = new WeakSet<object>()

/**
 * Ensure the plugin's `/api` subtree is admin-gated on `app`, and report
 * whether the gate is in place. Idempotent: the gate is installed on the first
 * successful call and every later call returns `true` without re-installing.
 * Returns `false` when the server exposes no admin middleware or the install
 * throws, so the caller can fail closed.
 */
export function ensureApiAdminGate (app: ServerAPI): boolean {
  if (gatedApps.has(app)) return true
  try {
    const securityAware = app as unknown as Partial<SecurityAwareApp>
    if (typeof securityAware.securityStrategy?.addAdminMiddleware === 'function') {
      securityAware.securityStrategy.addAdminMiddleware(API_PATH)
      gatedApps.add(app)
      return true
    }
    app.error(`Cannot admin-gate ${API_PATH}: securityStrategy.addAdminMiddleware is unavailable`)
  } catch (error) {
    app.error(`Cannot admin-gate ${API_PATH}: ${String(error)}`)
  }
  return false
}
