/**
 * Guard for the cost of building debug-log arguments on hot paths.
 *
 * At runtime the SignalK `app.debug` a plugin receives is the npm `debug`
 * module's logger, whose `enabled` accessor tracks the admin UI's live
 * per-plugin debug toggle; the typed `ServerAPI` surface omits it. Reading
 * the flag before building an expensive log argument (a `JSON.stringify`,
 * a joined list) keeps the per-request cost at zero while debug is off. A
 * plain function (a test stub) has no `enabled` and falls back to true so a
 * message is never lost.
 */

import type { Logger } from './types.js'

/** True when the given `app.debug` logger is currently enabled. */
export function debugIsEnabled (debug: unknown): boolean {
  const enabled = (debug as { enabled?: unknown })?.enabled
  return typeof enabled === 'boolean' ? enabled : true
}

/**
 * Adapt a SignalK app (or anything with `debug` and `error` string methods) to the project's
 * {@link Logger} surface, normalizing each to a one-argument call that discards any return value.
 */
export function appLogger (app: { debug: (message: string) => void, error: (message: string) => void }): Logger {
  return { debug: (m) => { app.debug(m) }, error: (m) => { app.error(m) } }
}
