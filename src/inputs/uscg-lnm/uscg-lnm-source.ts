/**
 * USCG Local Notice to Mariners POI source.
 *
 * Wraps the HTTP client and the on-disk store in a PoiSource. The refresh pass
 * downloads every pinned (layer, page) file (with conditional GET) into the
 * store; the list query filters the in-memory union by bbox, and `getDetails`
 * is always a store hit because the full set is loaded into memory on start.
 * Outbound HTTP is gated on `isInUsWaters(currentPosition)`: a vessel that has
 * left US waters keeps its already-loaded notices but issues no refresh
 * against NAVCEN until it returns.
 *
 * The (layer, page) files are pinned in `lnm-layers.ts` from the NAVCEN MSI
 * index, so a refresh iterates the exact set the upstream publishes rather
 * than probing for valid pages, mirroring the USCG Light List source.
 */

import type { LnmClient } from './lnm-client.js'
import type { LnmStore } from './lnm-store.js'
import type { LnmRecord } from './lnm-types.js'
import { LNM_LAYER_PAGES, lnmFileKey, type LnmLayer } from './lnm-layers.js'
import { renderLnmDetail } from './lnm-detail.js'
import { buildLnmSections } from './lnm-sections.js'
import type { PoiSource } from '../poi-source.js'
import type { Bbox, PoiDetailView, PoiSummary, Position } from '../../shared/types.js'
import { shouldSkipOutsideUsWaters } from '../../shared/us-waters.js'
import { openSeaMapMarkerUrl } from '../../shared/map-link.js'
import { mapWithConcurrency } from '../../shared/concurrency.js'
import type { PluginStatus } from '../../status/plugin-status.js'

import { USCG_LNM_SOURCE_ID } from '../../shared/source-ids.js'

/** Human-readable attribution credit for USCG NAVCEN LNM data. */
const ATTRIBUTION = '© USCG NAVCEN (US Government public domain)'

/**
 * Concurrency cap for the parallel NAVCEN refresh: four in-flight conditional
 * GETs at once is well-mannered against a CDN-fronted static-file feed and
 * collapses the pinned-file refresh into a few concurrent waves rather than one
 * long sequential walk, matching the USCG Light List refresh.
 */
const REFRESH_CONCURRENCY = 4

/** Dependencies for {@link createUscgLnmSource}. */
export interface UscgLnmSourceConfig {
  /** The HTTP client that downloads NAVCEN MSI files. */
  client: LnmClient
  /** The on-disk store holding the merged record union. */
  store: LnmStore
  /** Status recorder for per-source outcomes. */
  status: PluginStatus
  /** Returns the most recent vessel position, or undefined when unknown. */
  getCurrentPosition: () => Position | undefined
}

/**
 * The USCG LNM PoiSource extended with `refreshAll`, the periodic refresh entry
 * point owned by the input module. Declared as a public extension of
 * `PoiSource` so the input module reads it without casts and the registry sees
 * the source as a plain `PoiSource`.
 */
export interface UscgLnmSource extends PoiSource {
  /** Run one refresh pass across every pinned (layer, page) file. */
  refreshAll: () => Promise<void>
}

/** Build the list summary for one record. */
function toSummary (record: LnmRecord): PoiSummary {
  const summary: PoiSummary = {
    id: record.id,
    type: record.poiType,
    position: { ...record.position },
    name: record.name,
    source: USCG_LNM_SOURCE_ID,
    // NAVCEN's MSI app has no per-feature deep link, so the "view in a
    // browser" link falls back to an OpenSeaMap marker (see map-link.ts).
    url: openSeaMapMarkerUrl(record.position.latitude, record.position.longitude),
    attribution: ATTRIBUTION,
    skIcon: record.skIcon
  }
  if (record.timestamp !== undefined) summary.timestamp = record.timestamp
  return summary
}

/** Create the USCG LNM PoiSource. */
export function createUscgLnmSource (config: UscgLnmSourceConfig): UscgLnmSource {
  const { client, store, status, getCurrentPosition } = config

  async function refreshOnePage (layer: LnmLayer, page: number): Promise<void> {
    const key = lnmFileKey(layer.slug, page)
    const result = await client.downloadLayerPage(layer, page, store.headersFor(key))
    if (result.status === 'ok') {
      store.upsertFile(key, result.records, result.headers)
    } else if (result.status === 'error') {
      status.recordError(USCG_LNM_SOURCE_ID, `Refresh failed for ${key}: ${result.message}`)
    }
  }

  async function refreshAll (): Promise<void> {
    if (shouldSkipOutsideUsWaters(getCurrentPosition, status, USCG_LNM_SOURCE_ID)) {
      return
    }
    // Concurrency-capped fan-out: a small worker pool pulls (layer, page)
    // pairs off the shared cursor until the pinned catalog is drained.
    // Per-file errors are recorded onto the status and do not abort the pass.
    await mapWithConcurrency(LNM_LAYER_PAGES, REFRESH_CONCURRENCY, async ({ layer, page }) => {
      try {
        await refreshOnePage(layer, page)
      } catch (error) {
        status.recordError(
          USCG_LNM_SOURCE_ID,
          `Refresh worker failed for ${lnmFileKey(layer.slug, page)}: ${String(error)}`
        )
      }
    })
    // The store no-ops this flush if the run has been closed mid-refresh, so a
    // torn-down run cannot write over a freshly started one at the same dir.
    await store.flush()
  }

  return {
    id: USCG_LNM_SOURCE_ID,
    // The aggregate's `poiTypes` argument is deliberately ignored, matching the
    // NOAA ENC and USCG Light List sources: that string is the ActiveCaptain
    // type selection, and this source's own enable toggle is its type filter.
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      return store.queryBbox(bbox).map(toSummary)
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const record = store.getById(id)
      if (record === undefined) {
        throw new Error(`No LNM record for "${id}"`)
      }
      const view: PoiDetailView = {
        name: record.name,
        position: { ...record.position },
        type: record.poiType,
        url: openSeaMapMarkerUrl(record.position.latitude, record.position.longitude),
        source: USCG_LNM_SOURCE_ID,
        attribution: ATTRIBUTION,
        description: renderLnmDetail(record),
        // Normalized detail alongside the HTML: a structured client renders
        // these sections natively, a generic client renders `description`.
        sections: buildLnmSections(record),
        skIcon: record.skIcon
      }
      if (record.timestamp !== undefined) {
        view.timestamp = record.timestamp
      }
      // The union is held in memory, so getDetails always serves locally
      // without HTTP. A purely local serve is not evidence of NAVCEN
      // reachability, so it records no status: only the refresh path's real
      // requests drive apiReachable, matching the Light List and NOAA ENC
      // cache-hit paths.
      return view
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
