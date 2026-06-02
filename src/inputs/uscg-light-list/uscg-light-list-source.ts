/**
 * USCG Light List POI source.
 *
 * Wraps the HTTP client and the on-disk store in a PoiSource. The list query
 * filters the in-memory index by bbox; `getDetails` is always a cache hit
 * because the full index is loaded into memory on start. Outbound HTTP is
 * gated on `isInUsWaters(currentPosition)`: a vessel that has left US waters
 * keeps its already-loaded index but issues no refresh against NAVCEN until
 * it returns.
 *
 * The 37 (district, page) pairs are pinned here from the NAVCEN MSI index, so
 * a refresh iterates the exact set the upstream publishes rather than
 * probing for valid pages.
 */

import type { LightListClient } from './light-list-client.js'
import type { LightListStore } from './light-list-store.js'
import { recordPoiType, recordSkIcon } from './light-list-mapping.js'
import { renderLightListDetail } from './light-list-detail.js'
import { buildLightListSections } from './light-list-sections.js'
import type { PoiSource } from '../poi-source.js'
import type { Bbox, PoiDetailView, PoiSummary, Position } from '../../shared/types.js'
import { shouldSkipOutsideUsWaters } from '../../shared/us-waters.js'
import { openSeaMapMarkerUrl } from '../../shared/map-link.js'
import { filterByMinimumYear } from '../../shared/year-filter.js'
import type { PluginStatus } from '../../status/plugin-status.js'

import { USCG_LIGHT_LIST_SOURCE_ID } from '../../shared/source-ids.js'

/** Human-readable attribution credit for USCG Light List data. */
const ATTRIBUTION = '© USCG (US Government public domain)'

/**
 * The 37 (district, page) pairs the NAVCEN MSI feed publishes. A district can
 * publish up to fifteen pages of light-list records; the set is fixed for
 * the life of the upstream catalog, so the pairs are pinned here rather than
 * discovered at runtime.
 */
export const DISTRICT_PAGES: ReadonlyArray<readonly [string, number]> = [
  ['D01', 1], ['D01', 2], ['D01', 3], ['D01', 4],
  ['D02', 1], ['D02', 2],
  ['D05', 1], ['D05', 2], ['D05', 3], ['D05', 4],
  ['D07', 1], ['D07', 2], ['D07', 3], ['D07', 4], ['D07', 5],
  ['D07', 6], ['D07', 7], ['D07', 8], ['D07', 9], ['D07', 10],
  ['D07', 11], ['D07', 12], ['D07', 13], ['D07', 14], ['D07', 15],
  ['D08', 1], ['D08', 2], ['D08', 3], ['D08', 4],
  ['D09', 1], ['D09', 2], ['D09', 3],
  ['D11', 1],
  ['D13', 1], ['D13', 2],
  ['D14', 1],
  ['D17', 1]
]

/** Dependencies for {@link createUscgLightListSource}. */
export interface UscgLightListSourceConfig {
  /** The HTTP client that downloads NAVCEN district files. */
  client: LightListClient
  /** The on-disk store holding the merged index. */
  store: LightListStore
  /**
   * Hide records whose `MODIFIED_DATE` year is older than this. `0` (the off
   * sentinel) disables the filter; records with no modification date are
   * always included.
   */
  minimumYear: number
  /** Status recorder for per-source outcomes. */
  status: PluginStatus
  /** Returns the most recent vessel position, or undefined when unknown. */
  getCurrentPosition: () => Position | undefined
}

/**
 * The USCG Light List PoiSource extended with `refreshAll`, the periodic
 * refresh entry point owned by the input module. Declared as a public
 * extension of `PoiSource` so the input module reads it without casts and
 * the registry sees the source as a plain `PoiSource`.
 */
export interface UscgLightListSource extends PoiSource {
  /** Run one refresh pass across every (district, page) pair. */
  refreshAll: () => Promise<void>
}

/**
 * Concurrency cap for the parallel NAVCEN refresh: four in-flight conditional
 * GETs at once is well-mannered against a CDN-fronted static-file feed and
 * collapses the 37-page refresh from ~7 s sequential to under 2 s.
 */
const REFRESH_CONCURRENCY = 4

/** Create the USCG Light List PoiSource. */
export function createUscgLightListSource (
  config: UscgLightListSourceConfig
): UscgLightListSource {
  const { client, store, minimumYear, status, getCurrentPosition } = config

  async function refreshOnePage (district: string, page: number): Promise<void> {
    const key = `${district}_${page}`
    const previous = store.snapshot().districts[key]
    const previousHeaders = previous !== undefined
      ? { lastModified: previous.lastModified, etag: previous.etag }
      : undefined
    const result = await client.downloadDistrict(district, page, previousHeaders)
    if (result.status === 'ok') {
      store.upsertDistrict(district, page, result.records, result.headers)
    } else if (result.status === 'error') {
      status.recordError(
        USCG_LIGHT_LIST_SOURCE_ID,
        `Refresh failed for ${key}: ${result.message}`
      )
    }
  }

  async function refreshAll (): Promise<void> {
    if (shouldSkipOutsideUsWaters(getCurrentPosition, status, USCG_LIGHT_LIST_SOURCE_ID)) {
      return
    }
    // Concurrency-capped fan-out: a small worker pool pulls (district, page)
    // pairs off the shared cursor until the table is drained. Per-page
    // errors are recorded onto the status by refreshOnePage and do not
    // abort the rest of the pass.
    let next = 0
    const workers: Array<Promise<void>> = []
    const limit = Math.min(REFRESH_CONCURRENCY, DISTRICT_PAGES.length)
    for (let i = 0; i < limit; i += 1) {
      workers.push((async () => {
        for (;;) {
          const index = next++
          if (index >= DISTRICT_PAGES.length) return
          const [district, page] = DISTRICT_PAGES[index]
          try {
            await refreshOnePage(district, page)
          } catch (error) {
            status.recordError(
              USCG_LIGHT_LIST_SOURCE_ID,
              `Refresh worker failed for ${district}_${page}: ${String(error)}`
            )
          }
        }
      })())
    }
    await Promise.all(workers)
    // The store no-ops this flush if the run has been closed mid-refresh, so a
    // torn-down run cannot write over a freshly started one at the same dir.
    await store.flush()
  }

  return {
    id: USCG_LIGHT_LIST_SOURCE_ID,
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      // The store's spatial tile index narrows the candidate set from the
      // full ~57,700-record map to the records in the bbox's tiles.
      const records = store.queryBbox(bbox)
      const result: PoiSummary[] = []
      for (const record of records) {
        const summary: PoiSummary = {
          id: String(record.llnr),
          type: recordPoiType(record),
          position: { ...record.position },
          name: record.name,
          source: USCG_LIGHT_LIST_SOURCE_ID,
          // NAVCEN has no per-LLNR deep link, so the "view in a browser" link
          // falls back to an OpenSeaMap marker (see map-link.ts).
          url: openSeaMapMarkerUrl(record.position.latitude, record.position.longitude),
          attribution: ATTRIBUTION,
          skIcon: recordSkIcon(record)
        }
        // record.modifiedDate is already ISO-8601 UTC (parsed from epoch ms
        // by the client), so PoiSummary.timestamp accepts it as-is for the
        // year-filter helper.
        if (record.modifiedDate !== undefined) {
          summary.timestamp = record.modifiedDate
        }
        result.push(summary)
      }
      // Year filter is applied source-side so the rest of the pipeline
      // (dedupe, notes output, alarms) never sees filtered records.
      return filterByMinimumYear(result, minimumYear)
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const record = store.snapshot().records[id]
      if (record === undefined) {
        throw new Error(`No Light List record for "${id}"`)
      }
      const description = renderLightListDetail(record)
      status.recordDetailSuccess(USCG_LIGHT_LIST_SOURCE_ID)
      const view: PoiDetailView = {
        name: record.name,
        position: { ...record.position },
        type: recordPoiType(record),
        url: openSeaMapMarkerUrl(record.position.latitude, record.position.longitude),
        source: USCG_LIGHT_LIST_SOURCE_ID,
        attribution: ATTRIBUTION,
        description,
        // Normalized detail alongside the HTML: a structured client renders
        // these sections natively, a generic client renders `description`.
        sections: buildLightListSections(record),
        skIcon: recordSkIcon(record)
      }
      if (record.modifiedDate !== undefined) {
        view.timestamp = record.modifiedDate
      }
      return view
    },
    // The store exposes its live record total in O(1) (per-record tile
    // bookkeeping). That avoids both the per-poll 57.7 k-key allocation of
    // `Object.keys(records).length` (the status snapshot polls every 5 s) AND
    // the stale over-count of summing the per-district `recordCount` metas,
    // which a partial-decode recovery leaves higher than the records actually
    // loaded.
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
