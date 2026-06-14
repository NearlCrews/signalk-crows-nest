/**
 * Charted depth-area and land-area query over the NOAA ENC Direct client.
 *
 * The route-draft leg check needs the charted DEPTH AREA contours (`Depth_Area`,
 * carrying `DRVAL1`/`DRVAL2`) and the charted LAND AREAS (`Land_Area`) along a
 * leg, both POLYGON layers, as an internal capability. This is distinct from the
 * point hazard layers crows-nest publishes as POIs, so it lives in its own
 * module rather than in the POI input path.
 *
 * The query reuses the existing {@link EncDirectClient}: its `queryLayer`
 * already takes any `EncLayerKey` (now including `depthArea` and `land`),
 * resolves the per-band layer id from `LAYER_IDS_BY_BAND`, sends the bbox
 * geometry filter, and pages to completion. This module adds only the
 * area-specific shaping: it keeps polygon geometry, drops any stray non-polygon
 * feature, and decodes the depth range so the leg check reads `shallowMeters`
 * and `deepMeters` rather than the raw `DRVAL1`/`DRVAL2` keys. It does not
 * classify drying (negative `DRVAL1`) areas as land; that is the leg check's
 * job, per the depth decoder's contract.
 */

import type { EncDirectClient } from './enc-direct-client.js'
import type {
  EncFeature,
  EncPolygonGeometry,
  ScaleBand
} from './enc-direct-types.js'
import { decodeDepthRange, type DepthRange } from './s57-mapping.js'
import type { Bbox } from '../../shared/types.js'

/**
 * One charted area polygon returned by {@link queryChartedAreas}. `rings` is the
 * GeoJSON Polygon coordinate array (outer ring first, then holes), so a local
 * point-in-polygon or segment-vs-polygon test reads it directly. `depthRange`
 * is present for a Depth_Area polygon and absent for a Land_Area polygon.
 * `properties` carries the raw S-57 attribute bag for any further reading
 * (OBJNAM, QUASOU, and so on).
 */
export interface EncAreaPolygon {
  rings: number[][][]
  depthRange?: DepthRange
  properties: Record<string, unknown>
}

/** The charted areas a single band's query returns for one bounding box. */
export interface ChartedAreas {
  /** Depth_Area polygons, each carrying its decoded `DRVAL1`/`DRVAL2` range. */
  depthAreas: EncAreaPolygon[]
  /** Land_Area polygons. */
  landAreas: EncAreaPolygon[]
}

export interface ChartedAreasRequest {
  band: ScaleBand
  bbox: Bbox
  /** Optional deadline signal, passed through to the underlying layer queries. */
  signal?: AbortSignal
}

function isPolygon (feature: EncFeature): feature is EncFeature & { geometry: EncPolygonGeometry } {
  return feature.geometry.type === 'Polygon'
}

/**
 * Shape one polygon feature into an {@link EncAreaPolygon}. A Depth_Area passes
 * its decoded `depthRange`; a Land_Area passes none, so the field is omitted.
 */
function toAreaPolygon (
  feature: EncFeature & { geometry: EncPolygonGeometry },
  depthRange?: DepthRange
): EncAreaPolygon {
  return {
    rings: feature.geometry.coordinates,
    properties: feature.properties,
    ...(depthRange !== undefined ? { depthRange } : {})
  }
}

/**
 * Query the Depth_Area and Land_Area polygons that intersect `bbox` at `band`.
 * Returns both layers in one call so the leg check makes a single round of
 * requests per leg per layer. Non-polygon features (none observed live, but the
 * geometry type is a union) are dropped so the consumer only ever reads rings.
 */
export async function queryChartedAreas (
  client: EncDirectClient,
  { band, bbox, signal }: ChartedAreasRequest
): Promise<ChartedAreas> {
  const [depth, land] = await Promise.all([
    client.queryLayer({ band, layerKey: 'depthArea', bbox, signal }),
    client.queryLayer({ band, layerKey: 'land', bbox, signal })
  ])
  return {
    depthAreas: depth.features.filter(isPolygon).map((f) => toAreaPolygon(f, decodeDepthRange(f.properties))),
    landAreas: land.features.filter(isPolygon).map((f) => toAreaPolygon(f))
  }
}
