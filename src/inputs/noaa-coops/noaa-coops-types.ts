/**
 * Wire and parsed types for the NOAA CO-OPS metadata API (mdapi) station feed.
 *
 * The mdapi station endpoints
 * (`.../mdapi/prod/webapi/stations.json?type=waterlevels` and `?type=currents`)
 * return `{ count, units, stations: [...] }`. Each station carries far more than
 * the plugin needs; the parsed shape (CoopsStationRecord) keeps only the fields
 * a chart popup shows. Absent text fields arrive as `null` or an empty string,
 * so every optional wire field is widened to allow `null` and is routed through
 * `presentString` at parse time; the parsed shape never carries `null`.
 */

import type { Position } from '../../shared/types.js'
import type { NOAA_COOPS_SOURCE_ID } from '../../shared/source-ids.js'

/** The two CO-OPS station families the plugin imports. */
export type CoopsStationType = 'tide' | 'current'

/** A single CO-OPS station off the mdapi wire. */
export interface CoopsWireStation {
  /** Station id: a numeric string for tide stations, alphanumeric for currents. */
  id?: string | number
  name?: string | null
  lat?: number
  lng?: number
  /** Two-letter US state, present on tide stations and absent on current meters. */
  state?: string | null
  /** Station time zone label, present on tide stations. */
  timezone?: string | null
  // Other fields exist on the wire; the client ignores them on parse.
}

/** The mdapi stations response envelope. */
export interface CoopsStationsResponse {
  count?: number
  stations?: CoopsWireStation[]
}

/** A CO-OPS station as stored in the plugin's on-disk index. */
export interface CoopsStationRecord {
  /** Raw upstream station id, e.g. `8447386` or `bh0101`. */
  id: string
  stationType: CoopsStationType
  name: string
  position: Position
  state?: string
  timezone?: string
  source: typeof NOAA_COOPS_SOURCE_ID
}

/** Response headers retained for a best-effort conditional GET. */
export interface CoopsStationHeaders {
  lastModified?: string
  etag?: string
}

/** Metadata about one downloaded station-type list. */
export interface CoopsTypeMeta extends CoopsStationHeaders {
  recordCount: number
  fetchedAt: string
}

/** The on-disk index: per-type metadata plus the merged station-record map keyed by internal id. */
export interface CoopsIndex {
  generated: string
  types: Partial<Record<CoopsStationType, CoopsTypeMeta>>
  records: Record<string, CoopsStationRecord>
}
