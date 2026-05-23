/**
 * Wire types for the NOAA ENC Direct ArcGIS REST FeatureServer.
 *
 * The server returns standard GeoJSON when `f=geojson` is set, plus an
 * `exceededTransferLimit` flag the ENC Direct HTTP client uses to drive
 * pagination. The numeric ArcGIS layer ids differ per scale band, so the
 * `LAYER_IDS_BY_BAND` table is the single source of truth for every
 * `(band, layerKey)` to layer-id resolution downstream of this module.
 */

/** The ENC Direct scale bands the plugin queries. */
export type ScaleBand =
  | 'overview'
  | 'general'
  | 'coastal'
  | 'approach'
  | 'harbour'
  | 'berthing'

/** The three S-57 point hazard layers the plugin reads. */
export type EncLayerKey = 'wreck' | 'obstruction' | 'rock'

/** Numeric ArcGIS layer ids per scale band, for each hazard layer. */
export interface LayerIds {
  readonly wreck: number
  readonly obstruction: number
  readonly rock: number
}

/** One ENC Direct GeoJSON feature as returned by the FeatureServer. */
export interface EncFeature {
  type: 'Feature'
  id?: number
  geometry: { type: 'Point', coordinates: [number, number] }
  properties: Record<string, unknown>
}

/** The GeoJSON FeatureCollection ArcGIS returns from a `/query` request. */
export interface EncFeatureCollection {
  type: 'FeatureCollection'
  features: EncFeature[]
  exceededTransferLimit?: boolean
}
