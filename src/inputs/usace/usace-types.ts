/**
 * Wire types for the US Army Corps of Engineers ArcGIS REST services.
 *
 * The plugin reads two disjoint USACE point services, so the layer key selects
 * both which service the client queries and which property bag the mapping and
 * renderers read:
 *
 *  - `lock`: the Navigation Data Center Locks FeatureServer (one point per lock
 *    chamber). Verified live: the feature's top-level GeoJSON `id` equals its
 *    `OBJECTID`; the display name is `PMSNAME` (upper-case, and sometimes
 *    carries an ampersand, e.g. `"MONTGOMERY LOCK & DAM"`); `RIVER` is the
 *    waterway name and `RIVERMI` the river mile as a JSON number; the chamber
 *    dimensions `LENGTH`, `WIDTH`, and the `LIFT` are JSON numbers IN FEET;
 *    `GATETYPE` is a plain-English string (`"Miter"`); `YEAROPEN` is a JSON
 *    number. Several fields (`STATUS`, `OPER1`, `OWNER1`, `BANK`) are opaque
 *    single-character codes with no published codebook, so the renderers skip
 *    them rather than surface a bare `"1"`.
 *
 *  - `dam`: the National Inventory of Dams public MapServer (one point per
 *    dam). Verified live: the top-level `id` equals `OBJECTID`; the display
 *    name is `NAME`; `RIVER_OR_STREAM` is the waterway; `CITY` is frequently
 *    `null`; `PRIMARY_PURPOSE`, `PRIMARY_DAM_TYPE`, `HAZARD_POTENTIAL`,
 *    `CONDITION_ASSESSMENT`, and `PRIMARY_OWNER_TYPE` arrive as decoded
 *    plain-English strings; `DAM_HEIGHT` and `DAM_LENGTH` are JSON numbers IN
 *    FEET; `YEAR_COMPLETED` is a JSON number.
 *
 * Both services return standard GeoJSON when `f=geojson` is set, plus an
 * `exceededTransferLimit` flag the client uses to drive pagination.
 */

/** The two USACE point layers the plugin reads: navigation locks and dams. */
export type UsaceLayerKey = 'lock' | 'dam'

/**
 * A GeoJSON Point geometry: a single `[longitude, latitude]` position. Both
 * USACE layers are point services. ArcGIS can serve a feature with a `null`
 * geometry under a projection failure, so the source treats a missing or
 * malformed geometry as an unusable feature.
 */
export interface UsacePointGeometry {
  type: 'Point'
  coordinates: [number, number]
}

/** One USACE GeoJSON feature as returned by either MapServer/FeatureServer. */
export interface UsaceFeature {
  type: 'Feature'
  id?: number
  geometry: UsacePointGeometry | null
  properties: Record<string, unknown>
}
