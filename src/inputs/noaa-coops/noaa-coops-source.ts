/**
 * NOAA CO-OPS POI source.
 *
 * Wraps the HTTP client and the on-disk store in a PoiSource. The list query
 * filters the in-memory index by bbox and by the enabled station types;
 * `getDetails` is always a cache hit because the full index is loaded into
 * memory on start. Outbound HTTP happens only in `refreshAll`, which is gated
 * on `isInUsWaters(currentPosition)`: a vessel that has left US waters keeps its
 * already-loaded index but issues no refresh against the mdapi until it returns.
 *
 * The summary id encodes the station type and the raw upstream id, e.g.
 * `tide_8447386` (see `coopsInternalId`), so the two families cannot collide and
 * no id carries a slash that would split the SignalK resource path.
 */

import type { CoopsClient } from './coops-client.js'
import type { CoopsStore } from './coops-store.js'
import type { CoopsStationRecord, CoopsStationType } from './noaa-coops-types.js'
import { COOPS_POI_TYPE, COOPS_SK_ICON, coopsInternalId, stationPageUrl } from './coops-mapping.js'
import { renderCoopsDetail } from './coops-detail.js'
import { buildCoopsSections } from './coops-sections.js'
import { withListProvenance, type PoiSource } from '../poi-source.js'
import type { Bbox, PoiDetailView, PoiSummary, Position } from '../../shared/types.js'
import { shouldSkipOutsideUsWaters } from '../../shared/us-waters.js'
import { openSeaMapMarkerUrl } from '../../shared/map-link.js'
import type { PluginStatus } from '../../status/plugin-status.js'

import { NOAA_COOPS_SOURCE_ID } from '../../shared/source-ids.js'

/** Human-readable attribution credit for NOAA CO-OPS data. */
const ATTRIBUTION = '© NOAA CO-OPS (US Government public domain)'

/** Dependencies for {@link createNoaaCoopsSource}. */
export interface NoaaCoopsSourceConfig {
  /** The HTTP client that downloads the mdapi station lists. */
  client: CoopsClient
  /** The on-disk store holding the merged station index. */
  store: CoopsStore
  /** The station families to import and refresh. An empty set imports nothing. */
  stationTypes: readonly CoopsStationType[]
  /** Status recorder for per-source outcomes. */
  status: PluginStatus
  /** Returns the most recent vessel position, or undefined when unknown. */
  getCurrentPosition: () => Position | undefined
}

/**
 * The CO-OPS PoiSource extended with `refreshAll`, the periodic refresh entry
 * point owned by the input module. Declared as a public extension of
 * `PoiSource` so the input module reads it without casts and the registry sees
 * the source as a plain `PoiSource`.
 */
export interface NoaaCoopsSource extends PoiSource {
  /** Run one refresh pass across every enabled station type. */
  refreshAll: (signal?: AbortSignal) => Promise<void>
}

/** The public web page for a station, falling back to an OpenSeaMap marker. */
function stationUrl (record: CoopsStationRecord): string {
  return stationPageUrl(record) ??
    openSeaMapMarkerUrl(record.position.latitude, record.position.longitude)
}

/** Build the source-agnostic list summary for one station. */
function toSummary (record: CoopsStationRecord): PoiSummary {
  return {
    id: coopsInternalId(record),
    type: COOPS_POI_TYPE,
    position: { ...record.position },
    name: record.name,
    source: NOAA_COOPS_SOURCE_ID,
    url: stationUrl(record),
    attribution: ATTRIBUTION,
    skIcon: COOPS_SK_ICON
  }
}

/** Create the NOAA CO-OPS PoiSource. */
export function createNoaaCoopsSource (config: NoaaCoopsSourceConfig): NoaaCoopsSource {
  const { client, store, stationTypes, status, getCurrentPosition } = config
  // The enabled set is fixed for the life of the source (a config change
  // restarts the plugin), so it is captured once as a Set for the list filter.
  const enabledTypes = new Set<CoopsStationType>(stationTypes)

  async function refreshOneType (stationType: CoopsStationType, signal?: AbortSignal): Promise<boolean> {
    const previous = store.snapshot().types[stationType]
    const previousHeaders = previous !== undefined
      ? { lastModified: previous.lastModified, etag: previous.etag }
      : undefined
    const result = await client.downloadStations(stationType, previousHeaders, signal)
    if (result.status === 'ok') {
      store.upsertType(stationType, result.records, result.headers)
    } else if (result.status === 'error') {
      status.recordError(
        NOAA_COOPS_SOURCE_ID,
        `Refresh failed for ${stationType} stations: ${result.message}`
      )
      return false
    }
    return true
  }

  async function refreshAll (signal?: AbortSignal): Promise<void> {
    if (shouldSkipOutsideUsWaters(getCurrentPosition, status, NOAA_COOPS_SOURCE_ID)) {
      return
    }
    // The two lists are independent and low-volume, so a small sequential walk
    // is plenty; a per-type error is recorded and does not abort the rest.
    let allSucceeded = true
    for (const stationType of stationTypes) {
      signal?.throwIfAborted()
      try {
        if (!await refreshOneType(stationType, signal)) allSucceeded = false
      } catch (error) {
        signal?.throwIfAborted()
        allSucceeded = false
        status.recordError(
          NOAA_COOPS_SOURCE_ID,
          `Refresh worker failed for ${stationType} stations: ${String(error)}`
        )
      }
    }
    // The store no-ops this flush if the run has been closed mid-refresh, so a
    // torn-down run cannot write over a freshly started one at the same dir.
    await store.flush()
    if (stationTypes.length > 0 && allSucceeded) {
      status.recordListFetch(NOAA_COOPS_SOURCE_ID, store.recordCount())
    }
  }

  return {
    id: NOAA_COOPS_SOURCE_ID,
    // The aggregate's `poiTypes` argument is deliberately ignored, matching the
    // NOAA ENC and USCG Light List sources: that string is the ActiveCaptain
    // type selection, and this source's own enable and per-type toggles are its
    // filter.
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      const result: PoiSummary[] = []
      for (const record of store.queryBbox(bbox)) {
        // Defensive: the store only holds enabled types (refresh fetches only
        // those), but filtering here keeps the source correct even when the
        // store is seeded directly.
        if (enabledTypes.has(record.stationType)) {
          result.push(toSummary(record))
        }
      }
      return withListProvenance(result, 'local')
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const record = store.snapshot().records[id]
      if (record === undefined) {
        throw new Error(`No CO-OPS station for "${id}"`)
      }
      // The index is held in memory, so getDetails always serves locally without
      // issuing HTTP. A purely local serve is not evidence of upstream
      // reachability, so it records no status: only the refresh path's real
      // requests drive apiReachable, matching the USCG and NOAA ENC cache-hit
      // paths.
      return {
        name: record.name,
        position: { ...record.position },
        type: COOPS_POI_TYPE,
        url: stationUrl(record),
        source: NOAA_COOPS_SOURCE_ID,
        attribution: ATTRIBUTION,
        description: renderCoopsDetail(record),
        // Normalized detail alongside the HTML: a structured client renders
        // these sections natively, a generic client renders `description`.
        sections: buildCoopsSections(record),
        skIcon: COOPS_SK_ICON
      }
    },
    cacheSize: () => store.recordCount(),
    close: () => {
      // The refresh scheduler is owned by the input module, which clears its
      // timers before chaining onto this close. Closing the store makes an
      // in-flight refreshAll's final flush a no-op, so a late refresh cannot
      // write onto a torn-down or restarted run's store.
      store.close()
    },
    refreshAll
  }
}
