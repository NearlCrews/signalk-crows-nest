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

import type { ResourceProviderMethods } from '@signalk/server-api'
import type { OutputContext, OutputHandle, OutputModule } from '../output.js'
import { buildNoteResource, readProperty } from './note-builder.js'
import { resolveBbox } from './resource-query.js'
import { buildPoiTypesString } from '../../shared/poi-type-selection.js'
import { PLUGIN_ID } from '../../shared/plugin-id.js'
import type { PoiSummary } from '../../shared/types.js'

/** The SignalK resource type this output provides. */
const RESOURCE_TYPE = 'notes'

/** Build the resource-provider methods bound to one plugin run's context. */
function buildMethods (context: OutputContext): ResourceProviderMethods {
  const { app, config, pois } = context

  return {
    listResources: async (query: Record<string, unknown>): Promise<Record<string, unknown>> => {
      app.debug(`Incoming request to list note resources - query: ${JSON.stringify(query)}`)
      const poiTypes = buildPoiTypesString(config)
      if (poiTypes === null) {
        app.debug('No POI types are selected in the configuration; returning no resources')
        return {}
      }
      const bbox = resolveBbox(query)
      if (bbox === null) {
        app.debug(`Could not derive a bounding box from query ${JSON.stringify(query)}`)
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
          position: { ...entity.position },
          skIcon: entity.type.toLowerCase(),
          url: entity.url,
          source: entity.source,
          attribution: entity.attribution,
          sources: entity.sources
        })
      }
      return resources
    },

    getResource: async (id: string, property?: string): Promise<object> => {
      app.debug(`Incoming request to get note ${id}${property != null ? ` property ${property}` : ''}`)
      const view = await pois.getDetails(id)
      // A single detail fetch routes to one source, so a getResource note
      // carries no cross-source corroboration.
      const note = buildNoteResource({
        name: view.name,
        position: { ...view.position },
        skIcon: view.type.toLowerCase(),
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
      return { value, timestamp: note.timestamp, $source: PLUGIN_ID }
    },

    setResource: (): Promise<void> =>
      Promise.reject(new Error('ActiveCaptain resources are read-only')),

    deleteResource: (): Promise<void> =>
      Promise.reject(new Error('ActiveCaptain resources are read-only'))
  }
}

/** The notes-resource output module. */
export const notesResourceOutput: OutputModule = {
  id: 'notes-resource',
  name: 'SignalK notes resource',
  configSchema: {},
  isEnabled: () => true,
  start: (context: OutputContext): OutputHandle => {
    try {
      context.app.registerResourceProvider({
        type: RESOURCE_TYPE,
        methods: buildMethods(context)
      })
    } catch (error) {
      context.app.error(`Cannot register as a ${RESOURCE_TYPE} resource provider: ${String(error)}`)
    }
    // The SignalK server unregisters resource providers on plugin stop.
    return { stop: () => {} }
  }
}
