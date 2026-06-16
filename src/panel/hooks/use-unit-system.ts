/**
 * React glue for the server-driven display units: a context the length fields
 * read and a hook that resolves the system once on mount. The panel renders
 * metric until the ladder answers, so a pre-unitpreferences server simply
 * stays metric, and an imperial preset flips the fields as soon as the
 * one-time fetch lands.
 */

import { createContext, useEffect, useState } from 'react'
import { fetchLengthUnitSystem } from '../unit-system.js'
import type { UnitSystem } from '../unit-system.js'

/** The display system the length fields render in. Provided at the panel root. */
export const UnitSystemContext = createContext<UnitSystem>('metric')

/** Resolve the display system from the server's unit preferences, once. */
export function useUnitSystem (): UnitSystem {
  const [system, setSystem] = useState<UnitSystem>('metric')

  useEffect(() => {
    const controller = new AbortController()
    let canceled = false
    // fetchLengthUnitSystem never rejects: every failure resolves to metric, so
    // the promise can be left unhandled. The controller cancels the in-flight
    // requests on unmount, merged with each request's own timeout signal.
    fetchLengthUnitSystem((url, init) => fetch(url, {
      ...init,
      signal: init?.signal !== undefined
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal
    })).then((resolved) => {
      if (!canceled) setSystem(resolved)
    })
    return () => {
      canceled = true
      controller.abort()
    }
  }, [])

  return system
}
