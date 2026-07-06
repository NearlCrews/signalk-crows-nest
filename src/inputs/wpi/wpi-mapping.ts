/**
 * Code-to-label tables and readers for the World Port Index detail renderer
 * and section builder, plus the shared PoiType and Freeboard icon.
 *
 * The Pub 150 wire encodes most descriptive fields as single letters (harbor
 * size and type, shelter, repairs, drydock) or as `Y` / `N` / `U` restriction
 * and facility flags. The tables here are the single source of truth for every
 * code-to-English mapping, so the HTML renderer and the normalized-section
 * builder cannot drift. `U`, a blank, and `null` all read as "unknown", which
 * every consumer treats as absent and skips.
 *
 * Codes and their meanings are from NGA's "World Port Index, Explanation of
 * Data Fields". The depth and vessel-size fields are metric on this wire, so
 * the numeric readers here return meters unchanged.
 */

import type { PoiType } from '../../shared/types.js'
import { presentString } from '../../shared/strings.js'
import type { WpiPort } from './wpi-types.js'

/** Harbor size (HARBORSIZE) code to label. */
const HARBOR_SIZE: Readonly<Record<string, string>> = {
  L: 'Large',
  M: 'Medium',
  S: 'Small',
  V: 'Very small'
}

/** Harbor type (HARBORTYPE) code to label. */
const HARBOR_TYPE: Readonly<Record<string, string>> = {
  CN: 'Coastal, natural',
  CB: 'Coastal, breakwater',
  CT: 'Coastal, tide gate',
  RN: 'River, natural',
  RB: 'River, basin',
  RT: 'River, tide gate',
  LC: 'Canal or lake',
  OR: 'Open roadstead',
  TH: 'Typhoon harbor'
}

/** Shelter afforded (SHELTER) code to label. */
const SHELTER: Readonly<Record<string, string>> = {
  E: 'Excellent',
  G: 'Good',
  F: 'Fair',
  P: 'Poor',
  N: 'None'
}

/** Repairs available (REPAIRCODE) code to label. */
const REPAIRS: Readonly<Record<string, string>> = {
  A: 'Major',
  B: 'Moderate',
  C: 'Limited',
  D: 'Emergency only',
  N: 'None'
}

/** Drydock (DRYDOCK) code to label, with the Pub 150 size bands. */
const DRYDOCK: Readonly<Record<string, string>> = {
  S: 'Small (up to 200 m)',
  M: 'Medium (201 to 300 m)',
  L: 'Large (301 m and up)',
  N: 'None'
}

/** Harbor use (HARBORUSE) code to label; `UNK` reads as absent. */
const HARBOR_USE: Readonly<Record<string, string>> = {
  Cargo: 'Cargo',
  Fish: 'Fishing',
  Ferry: 'Ferry',
  Mil: 'Military'
}

/**
 * Every World Port Index port is a berthing harbor, so the source publishes a
 * single PoiType and Freeboard glyph rather than a per-record lookup. `Marina`
 * is the union's berthing-place member, which is also what lets a WPI port
 * dedupe against an ActiveCaptain marina marker (the dedupe pass matches on
 * identical PoiType).
 */
export const PORT_POI_TYPE: PoiType = 'Marina'
export const PORT_SK_ICON = 'marina'

/**
 * Read a coded field and resolve it through `table`. Returns undefined for an
 * absent field, a blank, the `U` unknown sentinel, or a code the table does
 * not carry.
 */
function labelFor (table: Readonly<Record<string, string>>, raw: unknown): string | undefined {
  const code = presentString(raw)
  return code === undefined ? undefined : table[code]
}

/** Resolve the harbor-size label. */
export function harborSizeLabel (port: WpiPort): string | undefined {
  return labelFor(HARBOR_SIZE, port.harborSize)
}

/** Resolve the harbor-type label. */
export function harborTypeLabel (port: WpiPort): string | undefined {
  return labelFor(HARBOR_TYPE, port.harborType)
}

/** Resolve the shelter-afforded label. */
export function shelterLabel (port: WpiPort): string | undefined {
  return labelFor(SHELTER, port.shelter)
}

/** Resolve the repairs-available label. */
export function repairsLabel (port: WpiPort): string | undefined {
  return labelFor(REPAIRS, port.repairCode)
}

/** Resolve the drydock label. */
export function drydockLabel (port: WpiPort): string | undefined {
  return labelFor(DRYDOCK, port.drydock)
}

/** Resolve the harbor-use label; the `UNK` sentinel reads as absent. */
export function harborUseLabel (port: WpiPort): string | undefined {
  return labelFor(HARBOR_USE, port.harborUse)
}

/**
 * Interpret a `Y` / `N` / `U` wire flag: true for yes, false for no, and
 * undefined for unknown (the `U` sentinel, a blank, or an absent field). The
 * comparison is case-insensitive against the trimmed value.
 */
export function wpiFlag (raw: unknown): boolean | undefined {
  const code = presentString(raw)
  if (code === undefined) return undefined
  const upper = code.toUpperCase()
  if (upper === 'Y') return true
  if (upper === 'N') return false
  return undefined
}

/**
 * Parse a metric wire value that may arrive as a JSON number or a numeric
 * string (the depth and vessel-size fields ship as strings, `tide` as a
 * number). Returns the finite number, or undefined for a blank, a null, or a
 * non-numeric value. The wire is metric, so the returned value is meters.
 */
export function meterValue (raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** One entrance restriction, its label paired with the wire field that flags it. */
const ENTRANCE_RESTRICTIONS: ReadonlyArray<{ label: string, read: (port: WpiPort) => unknown }> = [
  { label: 'Tide', read: (port) => port.erTide },
  { label: 'Swell', read: (port) => port.erSwell },
  { label: 'Ice', read: (port) => port.erIce },
  { label: 'Other', read: (port) => port.erOther }
]

/**
 * The list of entrance restrictions in force at a port (those whose flag is
 * yes), in the fixed Pub 150 order. Empty when none are flagged, so a caller
 * can present "None" or omit the line.
 */
export function entranceRestrictions (port: WpiPort): string[] {
  return ENTRANCE_RESTRICTIONS
    .filter(({ read }) => wpiFlag(read(port)) === true)
    .map(({ label }) => label)
}

/** One supply, its label paired with the wire field that flags its availability. */
const SUPPLIES: ReadonlyArray<{ label: string, read: (port: WpiPort) => unknown }> = [
  { label: 'Provisions', read: (port) => port.suProvisions },
  { label: 'Water', read: (port) => port.suWater },
  { label: 'Fuel oil', read: (port) => port.suFuel },
  { label: 'Diesel', read: (port) => port.suDiesel }
]

/**
 * The supplies available at a port (those whose flag is yes), in the fixed
 * Pub 150 order. Empty when none are flagged.
 */
export function availableSupplies (port: WpiPort): string[] {
  return SUPPLIES
    .filter(({ read }) => wpiFlag(read(port)) === true)
    .map(({ label }) => label)
}

/** The port name for a summary or a popup header; always present on the wire. */
export function portName (port: WpiPort): string {
  return presentString(port.portName) ?? `Port ${port.portNumber}`
}

/**
 * The display header for a popup: the port name, its alternate name in
 * parentheses when the wire carries one, and the country appended when known.
 */
export function portDisplayName (port: WpiPort): string {
  const name = portName(port)
  const alternate = presentString(port.alternateName)
  const withAlternate = alternate === undefined ? name : `${name} (${alternate})`
  const country = presentString(port.countryName)
  return country === undefined ? withAlternate : `${withAlternate}, ${country}`
}
