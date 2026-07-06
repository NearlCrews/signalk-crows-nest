/**
 * Source-slug constants shared by the input modules and the configuration
 * panel.
 *
 * The constants would naturally live in each input's source module (next
 * to the rest of that source's code), but the panel cannot import from
 * those modules: the panel is bundled by webpack for the browser, and
 * the input source modules transitively reach `node:fs` and `node:path`
 * via their on-disk stores. Defining the slugs in this dependency-free
 * module keeps them one canonical export consumed by both sides.
 *
 * Renaming any of these is a single-site change and produces TypeScript
 * compile errors at every consumer (input registry, status recorder,
 * panel slug type, panel disclosure map).
 */

/** The Garmin ActiveCaptain source. The fixed base every other source dedupes against. */
export const ACTIVE_CAPTAIN_SOURCE_ID = 'activecaptain'

/** The OpenSeaMap (OSM Overpass) source. */
export const OPENSEAMAP_SOURCE_ID = 'openseamap'

/** The USCG Light List source. */
export const USCG_LIGHT_LIST_SOURCE_ID = 'usclightlist'

/** The NOAA ENC Direct source. */
export const NOAA_ENC_SOURCE_ID = 'noaaenc'

/** The NOAA CO-OPS tide and current station source. */
export const NOAA_COOPS_SOURCE_ID = 'noaacoops'

/** The USCG Local Notice to Mariners source. */
export const USCG_LNM_SOURCE_ID = 'uscglnm'

/** The NGA World Port Index source. */
export const WPI_SOURCE_ID = 'wpi'

/** The USACE locks and dams source. */
export const USACE_SOURCE_ID = 'usace'

/**
 * Every source slug the plugin recognizes, as a runtime list. The panel's
 * jump-to-error shortcut narrows raw status slugs against it, so a fifth
 * source added here is picked up everywhere at once.
 */
export const SOURCE_SLUGS = [
  ACTIVE_CAPTAIN_SOURCE_ID,
  OPENSEAMAP_SOURCE_ID,
  USCG_LIGHT_LIST_SOURCE_ID,
  NOAA_ENC_SOURCE_ID,
  NOAA_COOPS_SOURCE_ID,
  USCG_LNM_SOURCE_ID,
  WPI_SOURCE_ID,
  USACE_SOURCE_ID
] as const

/**
 * The union of source slugs the plugin recognizes, derived from the runtime
 * list. The panel keys its disclosure-state map on this; a typo in any slug
 * literal produces a compile error here AND in the panel.
 */
export type SourceSlug = typeof SOURCE_SLUGS[number]
