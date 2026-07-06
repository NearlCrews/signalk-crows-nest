/**
 * Input registry.
 *
 * Holds the registered `InputModule`s, exposes their config-schema fragments,
 * and builds the aggregate `PoiSource` for a plugin start. The aggregate fans
 * every call out to each enabled source, namespaces resource ids with the
 * producing source's slug, and unions the results, so the `notes` output sees
 * one source regardless of how many inputs are enabled.
 */

import type { InputContext, InputModule, PoiSource } from './poi-source.js'
import { dedupeAgainstBase } from './dedupe-pois.js'
import { ACTIVE_CAPTAIN_SOURCE_ID } from '../shared/source-ids.js'
import { splitOnFirstSeparator } from '../shared/namespaced-id.js'
import { MS_PER_SECOND } from '../shared/time.js'
import type { PoiSummary } from '../shared/types.js'

/**
 * Per-source list-request timeout, in milliseconds.
 *
 * `Promise.allSettled` waits for the slowest upstream, so an Overpass query
 * stuck behind a CDN warm-up can stall the chart for tens of seconds while the
 * other sources have long since answered. Racing each source against this
 * timeout caps the aggregate's perceived latency at this value: the fast
 * sources ship immediately and the slow source's HTTP keeps running in the
 * background, so its bbox-debounce cache fills and its POIs appear on the
 * chartplotter's next refresh.
 *
 * Chosen to be longer than a healthy ActiveCaptain/NOAA ENC round-trip
 * (typically under 2 s) but shorter than the Overpass tail-latency outliers
 * (typically 8 to 20 s) that drive the perceived delay.
 */
const DEFAULT_PER_SOURCE_LIST_TIMEOUT_MS = 5000

/**
 * Race outcome for one source's list request. The timeout branch lets the
 * aggregate ship a partial result on this call and pick the source up on
 * the next call once its bbox-debounce cache has been populated.
 */
type SourceListOutcome =
  | { kind: 'value', pois: PoiSummary[] }
  | { kind: 'timeout' }

/** Public surface of the input registry. */
export interface InputRegistry {
  /** The registered input modules, in registration order. */
  readonly modules: readonly InputModule[]
  /** Each module's config-schema fragment, in registration order. */
  configSchemaFragments: () => Array<Record<string, unknown>>
  /**
   * Build the aggregate POI source from the enabled inputs. Throws when no
   * input is enabled, since the plugin cannot serve resources without a source.
   */
  createSource: (context: InputContext) => PoiSource
}

/** Options for {@link createInputRegistry}. */
export interface InputRegistryOptions {
  /**
   * Override for the per-source list-request timeout. Default is
   * {@link DEFAULT_PER_SOURCE_LIST_TIMEOUT_MS}. Tests inject a small value
   * so the race resolves on the test's real clock rather than the
   * production 5 s.
   */
  perSourceListTimeoutMs?: number
}

/** Create an input registry over a fixed set of modules. */
export function createInputRegistry (
  modules: readonly InputModule[],
  options: InputRegistryOptions = {}
): InputRegistry {
  // The aggregate prefixes resource ids with `${sourceId}-` and `getDetails`
  // splits on the first hyphen to recover the source slug. A source whose
  // slug itself contains a hyphen (e.g. `noaa-enc`) would split as
  // `noaa` / `enc-12345` and route to a non-existent source, surfacing as
  // a `No source for resource id` error only at click-time. Enforce the
  // constraint at registration so a future contributor cannot trip the
  // bug without noticing.
  for (const module of modules) {
    if (module.id.includes('-')) {
      throw new Error(
        `Source slug "${module.id}" contains a hyphen; the aggregate ` +
        'resource-id namespace splits on the first hyphen, so slugs must ' +
        'use underscores or no separators.'
      )
    }
  }
  const perSourceListTimeoutMs =
    options.perSourceListTimeoutMs ?? DEFAULT_PER_SOURCE_LIST_TIMEOUT_MS
  return {
    modules,
    configSchemaFragments: () => modules.map((module) => module.configSchema),
    createSource: (context: InputContext): PoiSource => {
      const enabled = modules.filter((module) => module.isEnabled(context.config))
      if (enabled.length === 0) {
        throw new Error('Cannot build a POI source: no input is enabled')
      }
      const sources = new Map<string, PoiSource>()
      for (const module of enabled) {
        sources.set(module.id, module.createSource(context))
      }
      // Dedupe runs only when the ActiveCaptain base layer is enabled and at
      // least one non-base input has its per-source dedupe toggle on.
      const dedupeSources = new Set<string>()
      // Per-source merge-radius map: each non-base input contributes the
      // radius surfaced on its card. Sources that omit the contract use
      // DEFAULT_DEDUPE_RADIUS_METERS via the dedupe pass's fallback.
      const dedupeRadiusBySource = new Map<string, number>()
      if (enabled.some((module) => module.id === ACTIVE_CAPTAIN_SOURCE_ID)) {
        for (const module of enabled) {
          if (module.id !== ACTIVE_CAPTAIN_SOURCE_ID && module.isDedupeEnabled?.(context.config) === true) {
            dedupeSources.add(module.id)
            const radius = module.dedupeRadiusMeters?.(context.config)
            if (radius != null) {
              dedupeRadiusBySource.set(module.id, radius)
            }
          }
        }
      }
      // Materialize the source list and the id list once at registry-build
      // time. Both arrays are fixed for the life of the aggregate, so the
      // per-tick `listPointsOfInterest` does not need to rebuild them on
      // every call.
      const sourceIds = [...sources.keys()]
      const sourceList = [...sources.values()]
      return {
        id: 'aggregate',
        listPointsOfInterest: async (bbox, poiTypes) => {
          // Race each source against perSourceListTimeoutMs so a slow
          // upstream (Overpass tail latency, an ENC ArcGIS round-trip behind
          // a cold CDN edge) cannot stall the whole chart load: every other
          // source ships immediately. The timed-out source's underlying
          // listPointsOfInterest promise is left running, since its
          // bbox-debounce cache fetcher populates the cache on success; the
          // next aggregate call then hits the cache and the source's POIs
          // appear on the chartplotter's next refresh.
          const results = await Promise.allSettled(
            sourceList.map(async (s, i): Promise<SourceListOutcome> => {
              const fetchPromise = s.listPointsOfInterest(bbox, poiTypes)
              // Silent observer for the lingering promise: a rejection that
              // arrives AFTER the race has already returned its timeout
              // outcome must not surface as a Node UnhandledPromiseRejection.
              // Errors that race the timeout to settlement are observed by
              // Promise.race itself, so this guard only matters for the
              // post-timeout rejection.
              fetchPromise.catch(() => {})
              let timeoutHandle: ReturnType<typeof setTimeout> | undefined
              try {
                const outcome = await Promise.race<SourceListOutcome>([
                  fetchPromise.then((pois): SourceListOutcome => ({ kind: 'value', pois })),
                  new Promise<SourceListOutcome>((resolve) => {
                    timeoutHandle = setTimeout(
                      () => resolve({ kind: 'timeout' }),
                      perSourceListTimeoutMs
                    )
                  })
                ])
                if (outcome.kind === 'timeout') {
                  // Diagnostic observer attached only on the timeout branch:
                  // the underlying fetch is still running and its eventual
                  // outcome is now interesting only for plugin debug
                  // output, since the registry has already returned a
                  // partial result. Optional-chained so a stub test context
                  // without `app.debug` does not throw.
                  fetchPromise.catch((error) => {
                    context.app.debug?.(
                      `Source "${sourceIds[i]}" list rejected after timeout was already returned: ${String(error)}`
                    )
                  })
                }
                return outcome
              } finally {
                if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
              }
            }))
          const merged: PoiSummary[] = []
          let anyOk = false
          // Any source that timed out keeps the chart's hope alive: the
          // background fetch is still running and the next aggregate call
          // will see the populated bbox-debounce cache. If every source
          // either hard-errored or timed out, we still ship the (empty)
          // partial rather than throw; the all-hard-error case is the only
          // one that throws below.
          let anyTimeout = false
          // The aggregate is the only component that knows each source's
          // individual list outcome, so it owns the per-source status
          // recording: a fulfilled source records its own list fetch, a
          // rejected source records its own error, a timed-out source is
          // recorded as skipped.
          for (const [index, result] of results.entries()) {
            const sourceId = sourceIds[index]
            if (result.status === 'fulfilled') {
              if (result.value.kind === 'timeout') {
                anyTimeout = true
                // Transient: the underlying fetch keeps running inside the
                // source's cache, so the next refresh serves it. The panel
                // shows this as waiting, not idle.
                context.status.recordSkipped(
                  sourceId,
                  `list request exceeded ${Math.round(perSourceListTimeoutMs / MS_PER_SECOND)}s; result will appear on next refresh`,
                  true
                )
                continue
              }
              anyOk = true
              // A returned-but-not-reachable result must not be laundered into
              // a "fetched N POIs" success that flips apiReachable to true: a
              // source that gated itself out (recordSkipped) returned []
              // without sending a request, and a source that served stale
              // offline data (recordStaleServe) already recorded the outage.
              // Both raise the same suppression flag, consumed on read.
              if (!context.status.wasListFetchSuppressed(sourceId)) {
                context.status.recordListFetch(sourceId, result.value.pois.length)
              }
              // The id rewrite is a spread-clone, not an in-place mutation:
              // ActiveCaptain's bbox-debounce cache returns the same
              // PoiSummary (and position) object references across hits, so
              // mutating them would re-apply the prefix every cached tick
              // (`activecaptain-12345` becoming `activecaptain-activecaptain-12345`,
              // breaking detail lookup and proximity-alarm hysteresis) and a
              // consumer that mutates `note.position` (a projection step, say)
              // would corrupt the cached entry. OpenSeaMap and NOAA build fresh
              // summaries per call, but the uniform clone is harmless for them.
              const prefix = `${sourceId}-`
              for (const poi of result.value.pois) {
                merged.push({
                  ...poi,
                  id: prefix + poi.id,
                  position: { ...poi.position }
                })
              }
            } else {
              context.status.recordError(
                sourceId, `List from "${sourceId}" failed: ${String(result.reason)}`)
            }
          }
          if (!anyOk && !anyTimeout) {
            throw new Error('Every POI source failed the list request')
          }
          // Merge each dedupe-enabled source's duplicates into the base layer,
          // so a feature reported by several sources is one corroborated note.
          return dedupeSources.size > 0
            ? dedupeAgainstBase(merged, dedupeSources, dedupeRadiusBySource)
            : merged
        },
        getDetails: async (id) => {
          // Split on the FIRST hyphen only: a raw id (an OSM id such as
          // `node_987654`) can itself contain hyphens or underscores. The
          // shared splitter returns null for a leading or absent hyphen, which
          // throws the same "No source" error as an unknown prefix below.
          const split = splitOnFirstSeparator(id, '-')
          if (split === null) {
            throw new Error(`No source for resource id "${id}"`)
          }
          const source = sources.get(split.prefix)
          if (source === undefined) {
            throw new Error(`No source for resource id "${id}"`)
          }
          return await source.getDetails(split.remainder)
        },
        cacheSize: () => sourceList.reduce((sum, s) => sum + s.cacheSize(), 0),
        close: () => { for (const s of sourceList) s.close() }
      }
    }
  }
}
