/**
 * Combine optional abort signals into one. Shared by the queued upstream HTTP
 * client and the OpenRouter client so the "conditionally fold a caller signal
 * into an AbortSignal.any" idea lives once.
 *
 * Undefined entries are filtered out, so a caller can pass an optional signal
 * positionally. When a single signal remains it is returned directly, skipping
 * the `AbortSignal.any` wrapper allocation for the common one-signal path.
 */

/**
 * Combine the given signals into one. Returns the lone signal when exactly one
 * is defined; otherwise an `AbortSignal.any` over the defined signals, which
 * aborts when any of them does. Every caller here passes at least one signal.
 */
export function combineAbortSignals (signals: Array<AbortSignal | undefined>): AbortSignal {
  const defined = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  // An all-undefined call would yield AbortSignal.any([]), a signal that never aborts, silently
  // leaving the request with no timeout or cancellation. Every caller passes at least one signal, so
  // make a future all-undefined caller a loud error rather than a silent permanently-in-flight fetch.
  if (defined.length === 0) throw new Error('combineAbortSignals: at least one signal must be defined')
  if (defined.length === 1) return defined[0]
  return AbortSignal.any(defined)
}
