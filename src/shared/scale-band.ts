/**
 * The NOAA ENC Direct scale bands, plus the default and the validation both the
 * NOAA input module and the panel's normalize-config share. Browser-safe
 * (dependency-free) so the panel can import the band list and default without
 * pulling in the node-only NOAA input, mirroring the seamark-groups.ts shared
 * pattern. The `ScaleBand` type lives here and is re-exported from
 * `enc-direct-types.ts` so the node-side importers keep their existing path.
 */

/** The ENC Direct scale bands the plugin queries, ordered overview to berthing. */
export type ScaleBand =
  | 'overview'
  | 'general'
  | 'coastal'
  | 'approach'
  | 'harbour'
  | 'berthing'

/** The six ENC Direct scale bands, ordered overview to berthing. */
export const SCALE_BANDS: readonly ScaleBand[] = [
  'overview', 'general', 'coastal', 'approach', 'harbour', 'berthing'
]

/** Default scale band when the configuration omits or mis-sets one. */
export const DEFAULT_SCALE_BAND: ScaleBand = 'coastal'

const SCALE_BAND_SET: ReadonlySet<string> = new Set(SCALE_BANDS)

/**
 * Human-readable label for each ENC chart scale band, kept next to the band
 * list so the two cannot drift. The panel's band selector and the collapsed
 * accordion summary both read it, so the summary shows "Harbor" rather than
 * the raw NOAA wire value "harbour".
 */
export const SCALE_BAND_LABELS: Readonly<Record<ScaleBand, string>> = {
  overview: 'Overview',
  general: 'General',
  coastal: 'Coastal',
  approach: 'Approach',
  harbour: 'Harbor',
  berthing: 'Berthing'
}

/** Coerce a raw config value to a known scale band, falling back to the default. */
export function resolveScaleBand (raw: unknown): ScaleBand {
  return typeof raw === 'string' && SCALE_BAND_SET.has(raw)
    ? raw as ScaleBand
    : DEFAULT_SCALE_BAND
}
