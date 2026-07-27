/**
 * The pinned LNM layer catalog: which NAVCEN MSI files the source imports, the
 * wire shape each follows, and the PoiType and Freeboard icon each maps onto.
 *
 * NAVCEN publishes each LNM category as one or more paged GeoJSON files named
 * `<fileBase>_<page>.geojson` under `/sites/default/files/msi/`. The catalog
 * is pinned here (rather than discovered at runtime) for the same reason the
 * USCG Light List pins its (district, page) pairs: a page-count change should
 * be a deliberate, reviewable table edit rather than silent drift, and a test
 * locks the shape. The MSI host answers 404 one page past each category's
 * end (probed 2026-07-27, for example
 * `curl -I .../msi/discFedAid_4.geojson`), so the pinned counts are directly
 * probe-verifiable; the refresh also prunes store files whose key leaves this
 * catalog, so tracking a NAVCEN contraction cannot leave stale notices
 * serving.
 *
 * The NAVCEN pager overlaps its pages: for a multi-page category, page `_2`
 * repeats most of `_1` (the files are generated seconds apart and are not
 * byte-identical). Because the store unions records by their stable business
 * id, an overlapping page merely re-supplies ids already seen, so pinning
 * every listed page and letting the union collapse shared ids is correct.
 *
 * Mapping rationale (per the task's safety contract): a layer whose features
 * mark a danger (reported hazards and obstructions, discrepant or off-station
 * aids) maps to `Hazard` so the proximity and route-corridor alarms pick it
 * up; an informational layer (temporary aid changes, marine construction,
 * bridge notices, general safety notices) maps to `Navigational`. The hazard
 * layers carry the `hazard` icon; the informational layers carry
 * `notice-to-mariners`.
 *
 * This module is browser-safe (it imports only types), so the configuration
 * panel imports the layer catalog and the default refresh cadence from here
 * without dragging the node-only client or store into the browser bundle. Keep
 * it that way: never import a node-only module here.
 */

import type { PoiType } from '../../shared/types.js'
import type { LnmLayerKind } from './lnm-types.js'

/** One pinned LNM layer: its files, wire shape, and POI mapping. */
export interface LnmLayer {
  /** Stable slug used in the resource id (`${slug}_${businessId}`); no separators. */
  readonly slug: string
  /** NAVCEN file base name, e.g. `hazNav`. */
  readonly fileBase: string
  /** The pages NAVCEN publishes for this layer, from the MSI index. */
  readonly pages: readonly number[]
  /** Which wire shape the features follow. */
  readonly kind: LnmLayerKind
  /** The cross-source POI type every feature in this layer maps onto. */
  readonly poiType: PoiType
  /** The Freeboard-registered icon glyph name for this layer. */
  readonly skIcon: string
  /** Human-readable layer label, used as a name fallback and in detail. */
  readonly label: string
}

/** Icon glyph for a danger layer. Registered in the Freeboard icon set. */
const HAZARD_ICON = 'hazard'

/** Icon glyph for an informational notice layer. Registered in the Freeboard icon set. */
const NOTICE_ICON = 'notice-to-mariners'

/**
 * The pinned LNM layers. Point-geometry files only: NAVCEN also publishes
 * `<base>Line` and `<base>Poly` companions for some categories, but a POI
 * marker is a point, so the line and polygon variants are deliberately not
 * imported. The "Corrected" companion files (discFedAidCor, discPriAidCor,
 * tmpChangeCor) are also excluded: a corrected discrepancy is a resolved
 * condition, not a live hazard, so surfacing it as a marker would mislead.
 */
export const LNM_LAYERS: readonly LnmLayer[] = [
  {
    slug: 'haznav',
    fileBase: 'hazNav',
    pages: [1],
    kind: 'notice',
    poiType: 'Hazard',
    skIcon: HAZARD_ICON,
    label: 'Hazard to Navigation'
  },
  {
    slug: 'discfedaid',
    fileBase: 'discFedAid',
    pages: [1, 2, 3],
    kind: 'discrepancy',
    poiType: 'Hazard',
    skIcon: HAZARD_ICON,
    label: 'Discrepant Federal Aid'
  },
  {
    slug: 'discpriaid',
    fileBase: 'discPriAid',
    pages: [1, 2, 3],
    kind: 'discrepancy',
    poiType: 'Hazard',
    skIcon: HAZARD_ICON,
    label: 'Discrepant Private Aid'
  },
  {
    slug: 'tmpchange',
    fileBase: 'tmpChange',
    pages: [1],
    kind: 'discrepancy',
    poiType: 'Navigational',
    skIcon: NOTICE_ICON,
    label: 'Temporary Change'
  },
  {
    slug: 'marcon',
    fileBase: 'marCon',
    pages: [1],
    kind: 'notice',
    poiType: 'Navigational',
    skIcon: NOTICE_ICON,
    label: 'Marine Construction'
  },
  {
    slug: 'bridge',
    fileBase: 'bridge',
    pages: [1],
    kind: 'notice',
    poiType: 'Navigational',
    skIcon: NOTICE_ICON,
    label: 'Bridge Notice'
  },
  {
    slug: 'misc',
    fileBase: 'misc',
    pages: [1],
    kind: 'notice',
    poiType: 'Navigational',
    skIcon: NOTICE_ICON,
    label: 'Marine Safety Notice'
  }
]

/** The pinned layers keyed by slug, for a getById-style lookup. */
export const LNM_LAYER_BY_SLUG: ReadonlyMap<string, LnmLayer> = new Map(
  LNM_LAYERS.map((layer) => [layer.slug, layer])
)

/** Every pinned (layer, page) file, flattened, for the refresh fan-out. */
export const LNM_LAYER_PAGES: ReadonlyArray<{ layer: LnmLayer, page: number }> =
  LNM_LAYERS.flatMap((layer) => layer.pages.map((page) => ({ layer, page })))

/** Build the persisted-file key for one (layer, page) pair. */
export function lnmFileKey (slug: string, page: number): string {
  return `${slug}_${page}`
}
