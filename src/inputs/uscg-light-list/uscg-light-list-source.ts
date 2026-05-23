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
import type { PoiSource } from '../poi-source.js'
import { appendAttribution } from '../../shared/attribution.js'
import type { Bbox, PoiDetailView, PoiSummary, Position } from '../../shared/types.js'
import { isInUsWaters } from '../../shared/us-waters.js'
import { filterByMinimumYear } from '../../shared/year-filter.js'
import type { PluginStatus } from '../../status/plugin-status.js'

/** Stable id of the USCG Light List source. */
export const USCG_LIGHT_LIST_SOURCE_ID = 'usclightlist'

/** Human-readable attribution credit for USCG Light List data. */
const ATTRIBUTION = '© USCG (US Government public domain)'

/** Public NAVCEN search URL prefix, completed with volume and LLNR query parameters. */
const URL_PREFIX = 'https://www.navcen.uscg.gov/light-list-search-results'

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

/** Build the NAVCEN search URL for one Light List record. */
function recordUrl (volume: number, llnr: number): string {
  return `${URL_PREFIX}?listVolumeNumber=${volume}&lightListNumber=${llnr}`
}

/** Create the USCG Light List PoiSource. */
export function createUscgLightListSource (
  config: UscgLightListSourceConfig
): UscgLightListSource {
  const { client, store, minimumYear, status, getCurrentPosition } = config

  async function refreshAll (): Promise<void> {
    const position = getCurrentPosition()
    if (position !== undefined && !isInUsWaters(position)) {
      status.recordSkipped(USCG_LIGHT_LIST_SOURCE_ID, 'outside US waters')
      return
    }
    for (const [district, page] of DISTRICT_PAGES) {
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
    await store.flush()
  }

  return {
    id: USCG_LIGHT_LIST_SOURCE_ID,
    listPointsOfInterest: async (bbox: Bbox): Promise<PoiSummary[]> => {
      const index = store.snapshot()
      const result: PoiSummary[] = []
      for (const record of Object.values(index.records)) {
        if (
          record.position.latitude >= bbox.south &&
          record.position.latitude <= bbox.north &&
          record.position.longitude >= bbox.west &&
          record.position.longitude <= bbox.east
        ) {
          const summary: PoiSummary = {
            id: String(record.llnr),
            type: recordPoiType(record),
            position: { ...record.position },
            name: record.name,
            source: USCG_LIGHT_LIST_SOURCE_ID,
            url: recordUrl(record.volume, record.llnr),
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
      const description = appendAttribution(
        renderLightListDetail(record), ATTRIBUTION)
      status.recordDetailSuccess(USCG_LIGHT_LIST_SOURCE_ID)
      const view: PoiDetailView = {
        name: record.name,
        position: { ...record.position },
        type: recordPoiType(record),
        url: recordUrl(record.volume, record.llnr),
        source: USCG_LIGHT_LIST_SOURCE_ID,
        attribution: ATTRIBUTION,
        description,
        skIcon: recordSkIcon(record)
      }
      if (record.modifiedDate !== undefined) {
        view.timestamp = record.modifiedDate
      }
      return view
    },
    cacheSize: () => Object.keys(store.snapshot().records).length,
    close: () => {
      // The refresh scheduler is owned by the input module: it chains its own
      // teardown onto this close. The source itself holds no resources to
      // release here.
    },
    refreshAll
  }
}
