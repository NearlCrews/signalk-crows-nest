/**
 * NGA World Port Index POI source.
 *
 * The authoritative NGA endpoint is not bounding-box queryable: it answers with
 * the whole worldwide index (about 2950 ports) in one response. So, unlike the
 * ArcGIS-backed sources, this source fetches the full set once and filters it
 * in memory. The whole set fits inside the shared hydrated detail cache (its
 * ceiling is well above the port count), so one cache holds every port, is
 * bbox-filtered per list call, is persisted to disk for offline cold starts,
 * and serves detail clicks straight from memory without a per-id round trip.
 *
 * `refreshHours` governs how often the full set is re-downloaded: a list call
 * after the window has elapsed triggers one re-fetch, and concurrent calls
 * share it (single-flight). When a re-fetch fails, the shared offline-fallback
 * policy serves the last known ports (fresh or hydrated) as a stale serve
 * rather than an error.
 *
 * There is no US-waters gate: the World Port Index is worldwide.
 *
 * The summary id is the port's numeric `portNumber` as a string; it carries no
 * separator, so the aggregate registry's `${slug}-${id}` namespacing and its
 * split-on-first-hyphen recovery round-trip cleanly.
 */

import { createHydratedDetailCache } from '../../shared/hydrated-detail-cache.js'
import { bboxContainsPoint } from '../../geo/position-utilities.js'
import { isValidLatitude, isValidLongitude } from '../../shared/numbers.js'
import { openSeaMapMarkerUrl } from '../../shared/map-link.js'
import { MS_PER_HOUR } from '../../shared/time.js'
import { WPI_SOURCE_ID } from '../../shared/source-ids.js'
import type { Bbox, PoiDetailView, PoiSummary } from '../../shared/types.js'
import type { PluginStatus } from '../../status/plugin-status.js'
import {
  fetchDetailRecorded,
  fetchListWithOfflineFallback,
  staleSummariesWithinBbox,
  withListProvenance,
  type PoiSource
} from '../poi-source.js'
import type { WpiClient } from './wpi-client.js'
import { isWpiPort, type WpiPort } from './wpi-types.js'
import { PORT_POI_TYPE, PORT_SK_ICON, portName } from './wpi-mapping.js'
import { renderWpiDetail } from './wpi-detail.js'
import { buildWpiSections } from './wpi-sections.js'

/** Human-readable attribution credit for World Port Index data. */
const WPI_ATTRIBUTION = 'NGA World Port Index (public domain)'

/** Name of the JSON file the on-disk detail store persists to. */
const STORE_FILE_NAME = 'wpi-cache.json'

/**
 * Cache and store capacity for the complete worldwide index. The source must
 * keep every port for its in-memory bbox filter and offline coverage, so the
 * ceiling sits comfortably above any plausible Pub 150 size: 2951 ports today,
 * and older editions carried 3400 plus. The default detail-cache ceiling is
 * tuned for a viewport's worth of markers and would silently evict part of the
 * complete set, so this larger cap is passed to both the LRU and the on-disk
 * store.
 */
const WPI_MAX_PORT_ENTRIES = 8192

/** Dependencies for {@link createWpiSource}. */
export interface WpiSourceConfig {
  /** The World Port Index HTTP client. */
  client: WpiClient
  /**
   * Minimum interval between full-dataset re-downloads, in hours. A list call
   * after this long re-fetches the whole index; a shorter window is pointless
   * because NGA publishes the index on a quarterly cycle.
   */
  refreshHours: number
  /** Status recorder for per-source outcomes. */
  status: PluginStatus
  /**
   * Plugin data directory, for the on-disk store that survives a restart.
   * Optional so a fixture that does not exercise persistence can omit it; the
   * production input module always supplies it. When absent the source runs in
   * memory only.
   */
  dataDir?: string
  /** Clock source, injectable for tests. Defaults to {@link Date.now}. */
  now?: () => number
}

/** Resolve the resource id for a port: its numeric index number as a string. */
function portId (port: WpiPort): string | undefined {
  return Number.isFinite(port.portNumber) ? String(port.portNumber) : undefined
}

/**
 * Extract a port's `[latitude, longitude]` from the decimal `ycoord` / `xcoord`
 * pair and validate the range. Returns null when either is absent or
 * out-of-range so a downstream NaN-position POI cannot poison the
 * proximity-alarm distance math.
 */
function portLatLon (port: WpiPort): { lat: number, lon: number } | null {
  const lat = port.ycoord
  const lon = port.xcoord
  if (!isValidLatitude(lat) || !isValidLongitude(lon)) return null
  return { lat, lon }
}

/**
 * Build the list summary for one port. Returns null when the port is unusable
 * (no numeric id, or out-of-range coordinates) so the caller drops the row
 * rather than minting a marker whose click-through would fail.
 */
function toSummary (port: WpiPort): PoiSummary | null {
  const id = portId(port)
  if (id === undefined) return null
  const latLon = portLatLon(port)
  if (latLon === null) return null
  return {
    id,
    type: PORT_POI_TYPE,
    position: { latitude: latLon.lat, longitude: latLon.lon },
    name: portName(port),
    source: WPI_SOURCE_ID,
    // The World Port Index has no per-port web page, so the "view in a browser"
    // link falls back to an OpenSeaMap marker (see map-link.ts).
    url: openSeaMapMarkerUrl(latLon.lat, latLon.lon),
    attribution: WPI_ATTRIBUTION,
    skIcon: PORT_SK_ICON
  }
}

/**
 * Build the detail view for one port. Returns null when the coordinates are
 * unusable; the caller treats this the same as a cache miss.
 */
function toDetailView (port: WpiPort): PoiDetailView | null {
  const latLon = portLatLon(port)
  if (latLon === null) return null
  return {
    name: portName(port),
    position: { latitude: latLon.lat, longitude: latLon.lon },
    type: PORT_POI_TYPE,
    url: openSeaMapMarkerUrl(latLon.lat, latLon.lon),
    source: WPI_SOURCE_ID,
    attribution: WPI_ATTRIBUTION,
    description: renderWpiDetail(port),
    // Normalized detail alongside the HTML: a structured client renders these
    // sections natively, a generic client renders `description`.
    sections: buildWpiSections(port),
    skIcon: PORT_SK_ICON
  }
}

/**
 * A prebuilt list row: the port's summary alongside its raw coordinate
 * primitives, so a per-poll bbox filter tests the coordinates without rebuilding
 * a summary or allocating a position object per port.
 */
interface PortSummaryRow {
  lat: number
  lon: number
  summary: PoiSummary
}

/** Create the NGA World Port Index POI source. */
export function createWpiSource (config: WpiSourceConfig): PoiSource {
  const { client, refreshHours, status, dataDir, now = Date.now } = config
  // One cache holds the whole worldwide index, hydrated from the on-disk store
  // so a cold start offline still lists and renders every previously fetched
  // port.
  const { cache, replaceAll, close: closeCache } = createHydratedDetailCache<WpiPort>({
    dataDir,
    fileName: STORE_FILE_NAME,
    isValue: isWpiPort,
    // Hold the complete index without eviction: the default ceiling would drop
    // ports once the worldwide set grows past it.
    maxEntries: WPI_MAX_PORT_ENTRIES
  })
  const refreshIntervalMs = Math.max(0, refreshHours) * MS_PER_HOUR
  // The time of the last successful full fetch, or undefined when none has
  // happened this session. A hydrated-only cache reads as undefined, so the
  // first list call still tries to refresh.
  let lastFetchedAt: number | undefined
  // The in-flight full fetch, so concurrent list and detail calls share one
  // download rather than each pulling the multi-megabyte set.
  let pending: Promise<void> | undefined
  // Aborts an in-flight download on plugin stop so a `close` cancels the
  // multi-megabyte fetch rather than letting it run to completion.
  const abortController = new AbortController()
  // The list rows prebuilt once per successful fetch, so a poll bbox-filters raw
  // primitives instead of rebuilding every port's summary each call. Rebuilt
  // whole on each fetch; empty until the first fetch succeeds (a hydrated-only
  // cache serves its offline rows through `buildStaleSummaries` instead).
  let summaryRows: PortSummaryRow[] = []

  // Filter the prebuilt rows to the viewport on raw primitives. The shared
  // bboxContainsPoint handles an antimeridian-crossing viewport (Fiji, the
  // western Aleutians), so a wrapped box still matches ports on both sides of
  // the 180-degree line.
  const summariesWithinBbox = (bbox: Bbox): PoiSummary[] => {
    const summaries: PoiSummary[] = []
    for (const row of summaryRows) {
      if (bboxContainsPoint(bbox, row.lon, row.lat)) summaries.push(row.summary)
    }
    return summaries
  }

  // The offline stale-fallback rebuild: summaries straight from the cache
  // values, so a hydrated-only cache (no fetch this session, so `summaryRows`
  // is still empty) still serves its previously fetched ports. Wrap handling
  // again lives in the shared bboxContainsPoint the helper calls.
  const buildStaleSummaries = (bbox: Bbox): PoiSummary[] =>
    staleSummariesWithinBbox(
      cache.values(),
      bbox,
      (port) => {
        const latLon = portLatLon(port)
        return latLon === null ? undefined : { latitude: latLon.lat, longitude: latLon.lon }
      },
      (port) => toSummary(port)
    )

  const fetchAllIntoCache = async (): Promise<void> => {
    const ports = await client.fetchAllPorts(abortController.signal)
    const rows: PortSummaryRow[] = []
    const nextCache = new Map<string, WpiPort>()
    for (const port of ports) {
      const id = portId(port)
      if (id === undefined) continue
      nextCache.set(id, port)
      const summary = toSummary(port)
      if (summary === null) continue
      // The summary's own position carries the validated coordinates, so the
      // row reuses them rather than re-deriving the pair.
      rows.push({ lat: summary.position.latitude, lon: summary.position.longitude, summary })
    }
    // A successful full dump is authoritative. Replace the complete snapshot
    // only after it has been parsed so an interrupted refresh retains the last
    // good dataset, while ports removed upstream disappear everywhere.
    replaceAll(nextCache)
    summaryRows = rows
    lastFetchedAt = now()
  }

  const refreshDataset = (): Promise<void> => {
    if (pending !== undefined) return pending
    pending = (async () => {
      try {
        await fetchAllIntoCache()
      } finally {
        pending = undefined
      }
    })()
    return pending
  }

  // Refresh the full set unless it was fetched within the window. A set never
  // fetched this session (including a hydrated-only cache) is always refreshed.
  const ensureFresh = async (): Promise<boolean> => {
    const fresh = lastFetchedAt !== undefined && now() - lastFetchedAt < refreshIntervalMs
    if (fresh) return false
    await refreshDataset()
    return true
  }

  return {
    id: WPI_SOURCE_ID,
    // The `poiTypes` filter is not meaningful for the World Port Index: every
    // port is a single PoiType, so the argument is intentionally ignored.
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      const outcome = await fetchListWithOfflineFallback<boolean>(
        status,
        WPI_SOURCE_ID,
        'World Port Index unreachable',
        ensureFresh,
        () => buildStaleSummaries(bbox)
      )
      // Fresh: filter the rows prebuilt by the fetch. Stale: the offline rebuild
      // already read the hydrated cache.
      if (outcome.kind === 'stale') {
        return withListProvenance(outcome.summaries, 'stale')
      }
      return withListProvenance(
        summariesWithinBbox(bbox),
        outcome.value ? 'fresh' : 'local'
      )
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const hit = cache.get(id)
      if (hit !== undefined) {
        // A cache hit is served straight from the loaded set; it is not
        // evidence of upstream reachability, so it records no detail success.
        const view = toDetailView(hit)
        if (view !== null) return view
      }
      // Miss: the set may not be loaded yet (a detail click before any list),
      // or the port is genuinely absent. Refresh once through the shared
      // wrapper, which records a detail success when the fetch answers normally
      // and an error only on a transport failure, then retry the lookup.
      await fetchDetailRecorded(status, WPI_SOURCE_ID, () => ensureFresh())
      const refreshed = cache.get(id)
      if (refreshed !== undefined) {
        const view = toDetailView(refreshed)
        if (view !== null) return view
      }
      throw new Error(`No World Port Index port for "${id}"`)
    },
    // The cache holds the whole loaded index, so this is the user-visible
    // "ports loaded" count on the status panel.
    cacheSize: () => cache.size,
    close: () => {
      // Abort an in-flight full-set download first so a plugin stop cancels the
      // multi-megabyte fetch rather than waiting it out.
      abortController.abort()
      // Flush the debounced store write so a clean shutdown persists the
      // fetched index, then drop the in-memory cache. The file is left in place
      // for the next cold start to hydrate.
      closeCache()
    }
  }
}
