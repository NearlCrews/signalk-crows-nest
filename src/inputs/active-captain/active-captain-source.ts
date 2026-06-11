/**
 * ActiveCaptain POI source.
 *
 * Wires the ActiveCaptain HTTP client, the TTL detail cache, and the on-disk
 * store into one `PoiSource`. The cache listener records detail outcomes onto
 * the status recorder; a 404 is the API answering normally (the point of
 * interest does not exist), so it is recorded as a success, not an outage.
 *
 * `listPointsOfInterest` applies the minimum-rating filter to this source's
 * own results, so the threshold gates only ActiveCaptain POIs, the only ones
 * that carry a review score.
 *
 * Once `close()` has run, the source is torn down: a load that resolves after
 * close belongs to the stopped run, so its outcome is neither recorded onto a
 * later run's status nor persisted to the on-disk store.
 */

import type { ServerAPI } from '@signalk/server-api'
import { HttpError } from './active-captain-client.js'
import type { ActiveCaptainClient } from './active-captain-client.js'
import { createPoiCache } from './poi-cache.js'
import { createPoiStore } from './poi-store.js'
import type { PoiStore } from './poi-store.js'
import { parseApiDate, renderDescription } from './poi-detail-renderer.js'
import { buildActiveCaptainSections } from './active-captain-sections.js'
import { bridgeHeightToMeters } from './bridge-clearance.js'
import { filterByRating } from './rating-filter.js'
import type { PoiSource } from '../poi-source.js'
import { createBboxDebounceCache } from '../../shared/bbox-debounce.js'
import { MAX_BBOX_CACHE_ENTRIES } from '../../shared/cache.js'
import type { PoiDetailView, PoiSummary, PoiType } from '../../shared/types.js'
import type { PluginStatus } from '../../status/plugin-status.js'

import { ACTIVE_CAPTAIN_SOURCE_ID } from '../../shared/source-ids.js'

/**
 * Human-readable attribution credit for ActiveCaptain data. The other three
 * sources lead with a `©` symbol and end with a `(license)` parenthetical
 * (ODbL, CC0, US Government public domain). ActiveCaptain reads as a
 * sentence because the data is proprietary and community-contributed: the
 * Garmin developer terms ask for a credit, not a copyright assertion. The
 * dedupe pass joins these credits with `'; '`, so a corroborated note
 * displays them side by side with the stylistic mismatch preserved.
 */
const ACTIVE_CAPTAIN_ATTRIBUTION = 'Data from Garmin ActiveCaptain'

/** Public ActiveCaptain page for a point of interest, by id. */
const POI_PAGE_URL_PREFIX = 'https://activecaptain.garmin.com/en-US/pois/'

/** Build the public ActiveCaptain page URL for a point of interest id. */
function poiPageUrl (id: string | number): string {
  return `${POI_PAGE_URL_PREFIX}${id}`
}

/** HTTP status for a point of interest that does not exist. */
const HTTP_NOT_FOUND = 404

/**
 * Map every `PoiType` an ActiveCaptain POI can carry onto a Freeboard-SK note
 * icon. Freeboard registers a fixed set of POI icons under the `sk-`
 * namespace; an unregistered name silently falls back to a default yellow
 * square. Every value here is one of Freeboard's actually registered icons.
 *
 * Most ActiveCaptain types match Freeboard's icon name directly when
 * lowercased; the three that don't (`LocalKnowledge`, `Navigational`,
 * `Airport`) and the catch-all `Unknown` are routed to the best available
 * Freeboard glyph rather than left to silently break.
 */
const ACTIVE_CAPTAIN_SK_ICON: Readonly<Record<PoiType, string>> = {
  Marina: 'marina',
  Anchorage: 'anchorage',
  Hazard: 'hazard',
  Business: 'business',
  BoatRamp: 'boatramp',
  Bridge: 'bridge',
  Dam: 'dam',
  Ferry: 'ferry',
  Inlet: 'inlet',
  Lock: 'lock',
  LocalKnowledge: 'notice-to-mariners',
  Navigational: 'navigation-structure',
  Airport: 'notice-to-mariners',
  Unknown: 'notice-to-mariners'
}

/**
 * Resolve the Freeboard icon for an ActiveCaptain POI type with a runtime
 * fallback. The `Record<PoiType, string>` above is exhaustive at compile
 * time, but `type` comes from the wire: a future server-side POI category
 * the union has not yet learned about would slip past the compile-time
 * check, so a runtime coalesce hands the unknown type a sensible default
 * rather than `undefined`.
 */
function activeCaptainSkIcon (type: PoiType): string {
  const icon = (ACTIVE_CAPTAIN_SK_ICON as Readonly<Partial<Record<string, string>>>)[type]
  return icon ?? 'notice-to-mariners'
}

/** Dependencies for {@link createActiveCaptainSource}. */
export interface ActiveCaptainSourceConfig {
  /** The ActiveCaptain HTTP client. */
  client: ActiveCaptainClient
  /** Detail cache TTL, in minutes. */
  cachingDurationMinutes: number
  /**
   * Lowest average rating (0 to 5) a ratable POI must reach to be listed.
   * Omitted or 0 lists every point of interest.
   */
  minimumRating?: number
  /**
   * Minimum upstream-query interval per bbox, in seconds. A Freeboard
   * refresh burst on the same viewport reuses the cached summaries for
   * this long before re-querying ActiveCaptain. `0` (the off sentinel)
   * disables the cache and queries upstream on every list call. Optional
   * so a fixture that does not care about debounce can omit it; the
   * production input module always supplies it.
   */
  refreshSeconds?: number
  /** Plugin data directory, for the on-disk store. */
  dataDir: string
  /** Status recorder for detail outcomes. */
  status: PluginStatus
  /** SignalK app, for `setPluginError` and `debug`. */
  app: Pick<ServerAPI, 'setPluginError' | 'debug'>
}

/** Create the ActiveCaptain POI source. */
export function createActiveCaptainSource (config: ActiveCaptainSourceConfig): PoiSource {
  const {
    client, cachingDurationMinutes, dataDir, status, app,
    minimumRating = 0, refreshSeconds = 0
  } = config
  // Per-bbox debounce: a Freeboard refresh burst on the same view reuses the
  // last summaries for `refreshSeconds` before re-querying ActiveCaptain.
  // The detail cache below (TTL by POI id) is unrelated; this one keys on
  // the bounding-box string and gates the list call only.
  const bboxCache = createBboxDebounceCache<PoiSummary[]>(refreshSeconds, MAX_BBOX_CACHE_ENTRIES)

  // Set by close(). Once the source is closed, a load that resolves later
  // belongs to the torn-down run: its outcome must not touch a later run's
  // status, nor the on-disk store.
  let closed = false

  // The store keeps its own long retention (30 days): the freshness TTL
  // decides when an entry is refetched while online, while retention only
  // bounds how long offline data is kept. Conflating the two would gut the
  // offline cache whenever the TTL is short.
  const baseStore = createPoiStore(dataDir)
  // Wrap the store so a load that resolves after close() does not write to
  // disk: that run is gone, and the entry would only mislead a later cold
  // start drawn from a partially torn-down run. Every other store method is
  // delegated to the base store unchanged.
  const store: PoiStore = {
    ...baseStore,
    persist: (id, details) => {
      if (!closed) {
        baseStore.persist(id, details)
      }
    }
  }

  const cache = createPoiCache(client, cachingDurationMinutes, {
    onLoadSuccess: () => {
      // A load that resolves after close belongs to the stopped run; do not
      // record it onto a later run's status.
      if (!closed) {
        status.recordDetailSuccess(ACTIVE_CAPTAIN_SOURCE_ID)
      }
    },
    onLoadError: (error) => {
      // Once closed, a late-resolving load belongs to the torn-down run: drop
      // its outcome rather than recording it onto a later run's status. This
      // also covers the benign AbortError raised when close() aborts the
      // previous run's in-flight detail fetches. A genuine abort that is NOT
      // from the plugin's own close() leaves `closed` false, so it falls
      // through and is recorded as the real failure it is.
      if (closed) {
        return
      }
      // A 404 is the API answering normally: the point of interest does not
      // exist. That is not a reachability failure.
      if (error instanceof HttpError && error.status === HTTP_NOT_FOUND) {
        status.recordDetailSuccess(ACTIVE_CAPTAIN_SOURCE_ID)
      } else {
        const message = `Detail request failed: ${String(error)}`
        status.recordError(ACTIVE_CAPTAIN_SOURCE_ID, message)
        app.setPluginError(message)
      }
    }
  }, store)

  return {
    id: ACTIVE_CAPTAIN_SOURCE_ID,
    listPointsOfInterest: async (bbox, poiTypes) => {
      // Wrap the upstream fetch in the bbox debounce cache so a refresh
      // burst on the same viewport reuses the previous summaries. The cache
      // key includes `poiTypes` because the Garmin endpoint filters
      // server-side on that argument: a notes-resource call without Hazard
      // must not poison a later proximity-alarm scan that needs Hazard.
      const tagged = await bboxCache.get(bbox, async (fetchBbox) => {
        const summaries = await client.listPointsOfInterest(fetchBbox, poiTypes)
        // The client is source-agnostic; tag each summary with the source slug,
        // its public ActiveCaptain page, the attribution credit, and the
        // Freeboard icon for its type.
        return summaries.map((summary) => ({
          ...summary,
          source: ACTIVE_CAPTAIN_SOURCE_ID,
          url: poiPageUrl(summary.id),
          attribution: ACTIVE_CAPTAIN_ATTRIBUTION,
          skIcon: activeCaptainSkIcon(summary.type)
        }))
      }, poiTypes)
      // The minimum-rating filter runs OUTSIDE the cache so a runtime
      // change to minimumRating takes effect on the next list call rather
      // than after the bbox TTL expires.
      return filterByRating(tagged, minimumRating)
    },
    getDetails: async (id: string): Promise<PoiDetailView> => {
      const entity = await cache.get(id)
      const poi = entity.pointOfInterest
      let description: string | undefined
      try {
        // The rendered HTML carries no inline attribution credit; the
        // ActiveCaptain credit rides on the detail view's `attribution`
        // field and is republished on the note's `properties.attribution`.
        description = renderDescription(entity)
      } catch (error) {
        app.debug(`Unable to format description for ${id}: ${String(error)}`)
      }
      const modified = parseApiDate(poi.dateLastModified)
      // A fixed bridge's clearance lives only in the navigation section, in
      // `distanceUnit` (feet or meters). The air-draft check reads this off
      // the detail view; gate it to a Bridge POI (matching the OpenSeaMap
      // source) so a non-bridge never carries a clearance. An absent or
      // unrecognized unit yields undefined and the field stays absent.
      const navigation = entity.navigation
      const verticalClearanceMeters = poi.poiType === 'Bridge'
        ? bridgeHeightToMeters(navigation?.bridgeHeight, navigation?.distanceUnit)
        : undefined
      return {
        name: poi.name,
        position: { ...poi.mapLocation },
        type: poi.poiType,
        url: poiPageUrl(id),
        source: ACTIVE_CAPTAIN_SOURCE_ID,
        attribution: ACTIVE_CAPTAIN_ATTRIBUTION,
        skIcon: activeCaptainSkIcon(poi.poiType),
        ...(description !== undefined && { description }),
        // Normalized detail alongside the HTML: a structured client renders
        // these sections natively, a generic client renders `description`.
        sections: buildActiveCaptainSections(entity),
        ...(Number.isFinite(modified.getTime()) && { timestamp: modified.toISOString() }),
        ...(verticalClearanceMeters !== undefined && { verticalClearanceMeters })
      }
    },
    cacheSize: () => cache.size(),
    close: () => {
      closed = true
      // Flush any debounced store write so a clean shutdown persists every
      // detail loaded during the run.
      baseStore.flush()
      bboxCache.clear()
      client.close()
    }
  }
}
