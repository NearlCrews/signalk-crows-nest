/**
 * Notes-resource output.
 *
 * Registers the SignalK `notes` resource provider that exposes points of
 * interest to chart plotters. It lists POIs through the aggregate source and
 * renders detail descriptions. It declares no configuration of its own.
 *
 * The resource provider is registered on every plugin start; the SignalK
 * server unregisters it on stop, so `stop()` here is a no-op.
 */

import type { ResourceProviderMethods, SourceRef } from '@signalk/server-api'
import type { OutputContext, OutputHandle, OutputModule } from '../output.js'
import { buildNoteResource, readProperty } from './note-builder.js'
import { resolveBbox } from './resource-query.js'
import { buildPoiTypesString } from '../../shared/poi-type-selection.js'
import { PLUGIN_ID } from '../../shared/plugin-id.js'
import type { PoiSummary } from '../../shared/types.js'

/** The SignalK resource type this output provides. */
const RESOURCE_TYPE = 'notes'

/**
 * Error message thrown by the read-only resource methods. The SignalK
 * resources REST layer hardcodes the HTTP status for thrown errors (400 on
 * POST, 404 on PUT, 400 on DELETE) and does not read any `statusCode`
 * field off the error, so the wire status is fixed by the server; this
 * message is what reaches the client body either way.
 */
const READ_ONLY_MESSAGE = "Crow's nest notes resources are read-only"

/** Build the resource-provider methods bound to one plugin run's context. */
function buildMethods (context: OutputContext): ResourceProviderMethods {
  const { app, config, pois } = context

  return {
    listResources: async (query: Record<string, unknown>): Promise<Record<string, unknown>> => {
      app.debug(`Incoming request to list note resources - query: ${JSON.stringify(query)}`)
      // Resolve the bbox first: a Freeboard probe without a viewport is the
      // common no-op, and bailing here skips building the POI-types string.
      const bbox = resolveBbox(query)
      if (bbox === null) {
        app.debug(`Could not derive a bounding box from query ${JSON.stringify(query)}`)
        return {}
      }
      const poiTypes = buildPoiTypesString(config)
      if (poiTypes === null) {
        app.debug('No POI types are selected in the configuration; returning no resources')
        return {}
      }

      let entities: PoiSummary[]
      try {
        entities = await pois.listPointsOfInterest(bbox, poiTypes)
      } catch (error) {
        // The aggregate source records each failed source's error onto the
        // per-source status itself; here the failure is surfaced to the
        // SignalK plugin UI and rethrown to the resource caller.
        const message = `List request failed: ${String(error)}`
        app.setPluginError(message)
        throw error
      }
      app.setPluginStatus(`${entities.length} point(s) of interest from the last search`)

      const resources: Record<string, unknown> = {}
      for (const entity of entities) {
        resources[entity.id] = buildNoteResource({
          name: entity.name,
          // Position passes through unchanged. With the per-bbox debounce
          // caches the same position reference is shared across calls and
          // into the published note; the pipeline downstream of the cache
          // is strictly read-only, so the shared reference is safe.
          position: entity.position,
          // Every source sets `skIcon` explicitly to one of Freeboard's
          // registered icons; the field is required on PoiSummary, so a source
          // that omitted it would be a compile error rather than a silent
          // yellow square.
          skIcon: entity.skIcon,
          url: entity.url,
          source: entity.source,
          attribution: entity.attribution,
          sources: entity.sources
        })
      }
      return resources
    },

    /**
     * Fetch the full note resource, or one property off it.
     *
     * Two failure modes both throw a plain `Error`:
     *
     * - The id does not resolve to any POI: the per-source `getDetails`
     *   throws a source-specific message (`No Light List record for "id"`
     *   and friends). The SignalK resources REST layer maps any thrown
     *   error from this method to HTTP 404 for GETs.
     * - The id resolves but the requested property does not exist: this
     *   method throws `Resource ${id} has no property ${property}`. The
     *   wire status is the same (404) because the server collapses both
     *   conditions onto a single status by method; the message is what
     *   reaches the client body and distinguishes the two cases.
     *
     * A single detail fetch routes to one source, so the resulting note
     * carries no cross-source corroboration (no `properties.sources`),
     * even when listResources for the same id would have showed multiple
     * contributors. This is a known list/detail asymmetry; corroboration
     * is a list-time-only artifact of the dedupe pass.
     */
    getResource: async (id: string, property?: string): Promise<object> => {
      app.debug(`Incoming request to get note ${id}${property != null ? ` property ${property}` : ''}`)
      const view = await pois.getDetails(id)
      const note = buildNoteResource({
        name: view.name,
        // Sources return a fresh position per call, so the reference is
        // safe to pass through unchanged.
        position: view.position,
        // Required on PoiDetailView, set explicitly by every source.
        skIcon: view.skIcon,
        url: view.url,
        source: view.source,
        attribution: view.attribution,
        timestamp: view.timestamp,
        description: view.description
      })

      if (property === undefined || property === '') {
        return note
      }
      const value = readProperty(note, property)
      if (value === undefined) {
        throw new Error(`Resource ${id} has no property ${property}`)
      }
      // Omit `timestamp` from the property-value response when the note has
      // none. The whole-resource path already follows this rule; mirroring
      // it here keeps a strict client that asserts `timestamp` is a string
      // happy on sources whose record carries no date.
      const response: Record<string, unknown> = {
        value,
        $source: PLUGIN_ID as SourceRef
      }
      if (note.timestamp !== undefined) {
        response.timestamp = note.timestamp
      }
      return response
    },

    setResource: (): Promise<void> =>
      Promise.reject(new Error(READ_ONLY_MESSAGE)),

    deleteResource: (): Promise<void> =>
      Promise.reject(new Error(READ_ONLY_MESSAGE))
  }
}

/** The notes-resource output module. */
export const notesResourceOutput: OutputModule = {
  id: 'notes-resource',
  name: 'SignalK notes resource',
  configSchema: {},
  isEnabled: () => true,
  start: (context: OutputContext): OutputHandle => {
    // Let the registration error propagate so the output registry marks
    // this output as failed and surfaces it via setPluginError. Swallowing
    // it here would let the plugin report "Ready" while the core data
    // path is dead.
    context.app.registerResourceProvider({
      type: RESOURCE_TYPE,
      methods: buildMethods(context)
    })
    // The SignalK server unregisters resource providers on plugin stop.
    return { stop: () => {} }
  }
}
