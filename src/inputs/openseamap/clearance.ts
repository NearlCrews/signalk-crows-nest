/**
 * OpenSeaMap vertical-clearance parsing.
 *
 * OpenStreetMap tags a bridge's headroom under several keys, most often
 * `seamark:bridge:clearance_height` or the generic `maxheight`, and the value
 * is loosely typed: a bare number is meters, but mappers also write `"3.5 m"`,
 * `"11 ft"`, `"11'"`, or feet-and-inches like `"10'6\""`, and sometimes a
 * non-data placeholder like `default` or `none`. This module turns whatever a
 * bridge element carries into SI meters for the air-draft check, or `undefined`
 * when no usable clearance can be read. A wrong feet-versus-meters guess is a
 * safety bug, so anything unrecognized is treated as unknown rather than
 * assumed.
 */

import { metersFromFeet, metersFromFeetInches } from '../../shared/length.js'
import { positiveFiniteNumber } from '../../shared/numbers.js'

/**
 * Clearance tag keys in priority order. The first key that parses to a usable
 * height wins: a present-but-unparseable tag (a non-data placeholder like
 * `default`, or garbage) falls through to the next key. This is a safety
 * feature, so a real number on a lower-priority tag is preferred over treating
 * the bridge as unknown-clearance, which would silently suppress the warning.
 */
const CLEARANCE_TAG_KEYS: readonly string[] = [
  'seamark:bridge:clearance_height',
  'maxheight',
  'maxheight:physical',
  'clearance'
]

/**
 * Placeholder values OSM mappers use to mean "no real height here." They are
 * compared lowercased, so `Default` and `NONE` are covered too.
 */
const NON_DATA_VALUES: ReadonlySet<string> = new Set([
  'default', 'none', 'unsigned', 'no', 'below_default', 'unknown'
])

/** Feet and inches, e.g. `10'6"` or `10' 6"`. The closing quote is optional. */
const FEET_INCHES_RE = /^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)\s*"?$/
/** Feet only, e.g. `11'`, `11 ft`, or `11 feet`. */
const FEET_RE = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)$/
/** Meters, e.g. `3.5 m`, `3.5m`, `3.5 meter`, or `3.5 metre`. */
const METERS_RE = /^(\d+(?:\.\d+)?)\s*(?:m|meter|metre|meters|metres)$/
/** A bare number with no unit, treated as meters. */
const BARE_NUMBER_RE = /^\d+(?:\.\d+)?$/

/**
 * Narrow a computed height to a positive finite value, else `undefined`. Wraps
 * the shared `positiveFiniteNumber` to adapt its `null` to this module's
 * `undefined` convention rather than re-implement the positive-finite predicate.
 */
function positiveMeters (meters: number): number | undefined {
  return positiveFiniteNumber(meters) ?? undefined
}

/**
 * Parse one raw clearance tag value into SI meters, or `undefined` when it is a
 * placeholder, empty, or otherwise unrecognized. Unit detection is
 * case-insensitive.
 */
function parseClearanceValue (raw: string): number | undefined {
  const value = raw.trim().toLowerCase()
  if (value === '' || NON_DATA_VALUES.has(value)) return undefined

  const feetInches = FEET_INCHES_RE.exec(value)
  if (feetInches !== null) {
    return positiveMeters(metersFromFeetInches(Number(feetInches[1]), Number(feetInches[2])))
  }
  const feet = FEET_RE.exec(value)
  if (feet !== null) return positiveMeters(metersFromFeet(Number(feet[1])))
  const meters = METERS_RE.exec(value)
  if (meters !== null) return positiveMeters(Number(meters[1]))
  if (BARE_NUMBER_RE.test(value)) return positiveMeters(Number(value))
  return undefined
}

/**
 * Read a bridge's vertical clearance from its OSM tags, in SI meters. Walks the
 * clearance tags in priority order and returns the first that parses to a
 * positive finite height, falling through any present-but-unparseable tag.
 * Returns `undefined` when no clearance tag yields a usable height.
 */
export function parseOsmClearanceMeters (tags: Record<string, string>): number | undefined {
  for (const key of CLEARANCE_TAG_KEYS) {
    const raw = tags[key]
    if (raw === undefined) continue
    const meters = parseClearanceValue(raw)
    if (meters !== undefined) return meters
  }
  return undefined
}
