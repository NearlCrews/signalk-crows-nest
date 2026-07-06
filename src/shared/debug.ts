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

/** True when the given `app.debug` logger is currently enabled. */
export function debugIsEnabled (debug: unknown): boolean {
  const enabled = (debug as { enabled?: unknown })?.enabled
  return typeof enabled === 'boolean' ? enabled : true
}
