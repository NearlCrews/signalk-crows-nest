/**
 * Wire types for the NGA World Port Index (Pub 150) API.
 *
 * The authoritative source is NGA Maritime Safety Information at
 * `https://msi.nga.mil/api/publications/world-port-index?output=json`. It
 * returns `{ "ports": [ ... ] }` with the whole worldwide index in one
 * response (about 2950 ports); it is not bounding-box queryable, so the source
 * fetches the full set and filters it in memory. The chosen endpoint is the
 * current Pub 150 schema, which is fully metric: channel, anchorage, cargo,
 * and oil-terminal depths, the tidal range, and the maximum-vessel dimensions
 * are all in meters, so no imperial conversion is needed.
 *
 * Observed wire shapes from a live full-dump the mapping and renderers handle:
 *
 *  - `xcoord` / `ycoord` are DECIMAL degrees (longitude, latitude) and are
 *    always present and in range on the live wire; `latitude` / `longitude`
 *    are the display-only degree-minute-second strings, so the source reads
 *    the decimal pair and ignores the DMS strings.
 *  - The depth fields (`chDepth`, `anDepth`, `cpDepth`, `otDepth`) and the
 *    maximum-vessel fields (`maxVesselLength`, `maxVesselBeam`,
 *    `maxVesselDraft`) arrive as numeric JSON STRINGS, e.g. `"13"`, while
 *    `tide` arrives as a JSON NUMBER, so the mapping parses either shape.
 *  - The coded categorical fields are single letters: `harborSize` (L, M, S,
 *    V), `harborType` (CN, CB, CT, RN, RB, RT, LC, OR, TH), `shelter` (E, G,
 *    F, P, N), `repairCode` (A, B, C, D, N), and `drydock` (S, M, L, N). A
 *    `U` or a blank means "unknown", treated as absent.
 *  - The restriction and facility fields carry `Y`, `N`, or `U`, so the
 *    mapping reads them as yes, no, or unknown.
 *  - `harborUse` arrives already decoded (`Cargo`, `Fish`, `Ferry`, `Mil`, or
 *    `UNK`), and many free-text fields ship as `null`, so every consumer skips
 *    an absent field rather than writing a placeholder.
 */

/** A numeric-or-string wire value the depth and vessel-size fields use. */
type WireNumber = number | string | null

/** A coded or free-text wire value that may be null or blank. */
type WireText = string | null

/**
 * One World Port Index port record. Only the fields the source, the mapping,
 * and the renderers read are typed; the live record carries many more the
 * plugin does not surface. `portNumber`, `portName`, `xcoord`, and `ycoord`
 * are the load-bearing fields the hydration guard checks.
 */
export interface WpiPort {
  /** Stable numeric index number, used as the resource id. */
  portNumber: number
  /** Port name, always present on the wire. */
  portName: string
  /** Decimal longitude. */
  xcoord: number
  /** Decimal latitude. */
  ycoord: number
  alternateName?: WireText
  countryName?: WireText
  countryCode?: WireText
  regionName?: WireText
  navArea?: WireText
  publicationNumber?: WireText
  chartNumber?: WireText
  harborSize?: WireText
  harborType?: WireText
  harborUse?: WireText
  shelter?: WireText
  erTide?: WireText
  erSwell?: WireText
  erIce?: WireText
  erOther?: WireText
  overheadLimits?: WireText
  chDepth?: WireNumber
  anDepth?: WireNumber
  cpDepth?: WireNumber
  otDepth?: WireNumber
  tide?: WireNumber
  maxVesselLength?: WireNumber
  maxVesselBeam?: WireNumber
  maxVesselDraft?: WireNumber
  ptCompulsory?: WireText
  ptAdvisable?: WireText
  tugsAssist?: WireText
  tugsSalvage?: WireText
  qtPratique?: WireText
  medFacilities?: WireText
  suFuel?: WireText
  suDiesel?: WireText
  suWater?: WireText
  suProvisions?: WireText
  repairCode?: WireText
  drydock?: WireText
}

/** The top-level API response shape. */
export interface WpiListResponse {
  ports?: WpiPort[]
}

/**
 * Narrow an unknown, JSON-parsed value to a {@link WpiPort}, checking only the
 * four load-bearing fields the source dereferences (the numeric id and name,
 * and the decimal coordinate pair). A hydrated entry that passes this cannot
 * crash the renderer; a malformed coordinate is caught later by the range
 * check and treated as an unusable record.
 */
export function isWpiPort (value: unknown): value is WpiPort {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const port = value as Record<string, unknown>
  return (
    typeof port.portNumber === 'number' &&
    typeof port.portName === 'string' &&
    typeof port.xcoord === 'number' &&
    typeof port.ycoord === 'number'
  )
}
