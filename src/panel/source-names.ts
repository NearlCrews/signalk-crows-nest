/**
 * The display name of each data source, in one place because two surfaces
 * need it: the accordion titles its cards with them, and the status section
 * names a source in a jump button.
 *
 * The status snapshot carries its own name per source and stays the authority
 * where it has one. This map is what answers for a source the snapshot does
 * not list, which `plugin-status.ts` documents as reachable: a source that
 * failed before it registered is recorded as an error without a row of its
 * own. Without it the button read "Show openseamap", putting a wire slug in
 * front of the operator.
 *
 * Kept out of the accordion module so the status section can read it without
 * importing a card body per source, and free of JSX so the unit tests can too.
 */

import {
  ACTIVE_CAPTAIN_SOURCE_ID,
  NOAA_COOPS_SOURCE_ID,
  NOAA_ENC_SOURCE_ID,
  OPENSEAMAP_SOURCE_ID,
  SOURCE_SLUGS,
  USACE_SOURCE_ID,
  USCG_LIGHT_LIST_SOURCE_ID,
  USCG_LNM_SOURCE_ID,
  WPI_SOURCE_ID,
  type SourceSlug
} from '../shared/source-ids.js'

/**
 * Card title per source, and the fallback name for a source with no status
 * row. Keyed off the slug constants rather than their literals, so a renamed
 * slug is a compile error here rather than a card that quietly loses its name.
 */
export const SOURCE_NAMES: Readonly<Record<SourceSlug, string>> = {
  [ACTIVE_CAPTAIN_SOURCE_ID]: 'Garmin ActiveCaptain',
  [OPENSEAMAP_SOURCE_ID]: 'OpenSeaMap',
  [USCG_LIGHT_LIST_SOURCE_ID]: 'USCG Light List (US Aids to Navigation)',
  [NOAA_ENC_SOURCE_ID]: 'NOAA ENC Direct (US wrecks, obstructions, and rocks)',
  [NOAA_COOPS_SOURCE_ID]: 'NOAA CO-OPS (US tide and current stations)',
  [USCG_LNM_SOURCE_ID]: 'USCG Local Notice to Mariners (US live safety notices)',
  [WPI_SOURCE_ID]: 'NGA World Port Index (worldwide ports)',
  [USACE_SOURCE_ID]: 'USACE locks and dams (US waterways)'
}

/** Membership set behind {@link isSourceSlug}, built once per module load. */
const KNOWN_SLUGS: ReadonlySet<string> = new Set(SOURCE_SLUGS)

/**
 * Whether `slug` is one of the panel's known sources. It narrows, so a caller
 * guarding on it can index {@link SOURCE_NAMES} or the panel's per-card state
 * without a cast.
 */
export function isSourceSlug (slug: string): slug is SourceSlug {
  return KNOWN_SLUGS.has(slug)
}

/**
 * The best name available for a source: the one the status snapshot reported,
 * this panel's own name for a source the snapshot does not list, and the raw
 * slug only for a source neither knows, which would be a source added to the
 * plugin and not to the panel.
 */
export function sourceDisplayName (slug: string, reported?: string): string {
  if (reported !== undefined && reported !== '') return reported
  return isSourceSlug(slug) ? SOURCE_NAMES[slug] : slug
}
