/**
 * Display-unit selection for the panel's length fields, driven by the Signal K
 * server's unit-preferences API rather than a panel-local toggle. The panel
 * stores every length in SI meters (the config schema and the plugin runtime
 * are all-metric); these helpers convert at the display edge only, so an
 * imperial preset shows feet in the inputs while the saved configuration and
 * the wire format never change.
 *
 * The imperial signal is the preset's `categories.length.targetUnit`: every
 * preset signalk-server ships targets either `foot` or `m` for length. Any
 * other (custom) target unit falls back to metric, the only other display
 * system the panel renders.
 *
 * Kept free of React so the resolver, the conversions, and the fetch ladder
 * are unit-testable under node:test; the thin `useUnitSystem` hook owns the
 * React state.
 */

import { METERS_PER_FOOT } from '../shared/length.js'
import { roundTo } from '../shared/numbers.js'
import { presentString } from '../shared/strings.js'
import { PANEL_REQUEST_TIMEOUT_MS } from './request-timeout.js'

/** The display system the panel renders length fields in. */
export type UnitSystem = 'metric' | 'imperial'

/** The per-user preference document the admin UI's units page writes. */
const USER_PREFERENCE_URL = '/signalk/v1/applicationData/user/unitpreferences/1.0.0'

/** The server-wide active preset, with categories resolved. */
const ACTIVE_PRESET_URL = '/signalk/v1/unitpreferences/active'

/** Prefix of the per-preset definition endpoint. */
const PRESET_URL_PREFIX = '/signalk/v1/unitpreferences/presets/'

/**
 * Decimals kept when rendering meters as feet. Two decimals keeps a typed
 * imperial value round-trip-stable through the stored meters (which is what
 * keeps the NumberField draft alive while typing) without rendering the
 * metric-born defaults as long fractions.
 */
const DISPLAY_DECIMALS = 2

/**
 * Decimals kept when storing meters converted from typed feet. Four decimals
 * is sub-millimeter, precise beyond any nautical use, and keeps the saved
 * configuration free of float noise like 30.480000000000004.
 */
const METERS_DECIMALS = 4

/**
 * Read the display system off a unit-preset document (the `/active` response
 * or a `/presets/{name}` body). Anything malformed resolves to metric, the
 * pre-unitpreferences default. Optional chaining is safe on any input here,
 * including primitives, so the cast from `unknown` carries no runtime risk.
 */
export function resolveUnitSystem (preset: unknown): UnitSystem {
  const targetUnit = (preset as { categories?: { length?: { targetUnit?: unknown } } } | null | undefined)
    ?.categories?.length?.targetUnit
  return targetUnit === 'foot' ? 'imperial' : 'metric'
}

/** Convert a stored meters value to the number the input should display. */
export function lengthDisplayFromMeters (meters: number, system: UnitSystem): number {
  return system === 'imperial' ? roundTo(meters / METERS_PER_FOOT, DISPLAY_DECIMALS) : meters
}

/** Convert a displayed input value back to the meters the config stores. */
export function lengthMetersFromDisplay (display: number, system: UnitSystem): number {
  return system === 'imperial' ? roundTo(display * METERS_PER_FOOT, METERS_DECIMALS) : display
}

/** The human-readable unit name for field labels. */
export function lengthUnitLabel (system: UnitSystem): 'meters' | 'feet' {
  return system === 'imperial' ? 'feet' : 'meters'
}

/**
 * The slice of `fetch` the ladder consumes, so tests can stub it without
 * constructing Response objects. The credentials literal is spelled out
 * rather than typed as the DOM's RequestCredentials because the DOM-less
 * test tsconfig also compiles this module.
 */
export type FetchLike = (
  url: string,
  init?: { credentials: 'same-origin', signal?: AbortSignal }
) => Promise<{ ok: boolean, json: () => Promise<unknown> }>

/** GET a JSON body, resolving null on any HTTP, network, or parse failure. */
async function fetchJson (fetchFn: FetchLike, url: string): Promise<unknown> {
  try {
    const response = await fetchFn(url, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(PANEL_REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Resolve the display system the same way the admin UI's units page does: the
 * per-user `activePreset` from applicationData wins, resolved through its
 * preset definition; otherwise the server-wide active preset applies; and any
 * failure (including a pre-unitpreferences server answering 404) lands on
 * metric.
 */
export async function fetchLengthUnitSystem (fetchFn: FetchLike): Promise<UnitSystem> {
  const userDocument = await fetchJson(fetchFn, USER_PREFERENCE_URL)
  const activePreset = presentString(
    (userDocument as { activePreset?: unknown } | null)?.activePreset
  )
  if (activePreset !== undefined) {
    const preset = await fetchJson(fetchFn, PRESET_URL_PREFIX + encodeURIComponent(activePreset))
    if (preset !== null) return resolveUnitSystem(preset)
  }
  const active = await fetchJson(fetchFn, ACTIVE_PRESET_URL)
  return active === null ? 'metric' : resolveUnitSystem(active)
}
