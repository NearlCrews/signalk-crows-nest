/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * SignalK plugin entrypoint.
 *
 * Imports points of interest from the Garmin ActiveCaptain community API and
 * exposes them as SignalK `notes` resources. This file is the wiring layer: it
 * connects the HTTP client, the detail cache, the bounding-box geometry, and
 * the Handlebars renderer. The pure logic lives in the focused modules it
 * imports.
 */

import type {
  Plugin,
  ServerAPI,
  ResourceProviderMethods
} from '@signalk/server-api'

import { createActiveCaptainClient, HttpError, type ActiveCaptainClient } from './activeCaptainClient.js'
import { createPoiCache, type PoiCache } from './poiCache.js'
import { createPluginStatus } from './pluginStatus.js'
import { createStatusRouter } from './statusRouter.js'
import { renderDescription } from './handlebarsUtilities.js'
import { PLUGIN_ID } from './pluginId.js'
import { buildPoiTypesString } from './poiTypeSelection.js'
import { resolveBbox } from './resourceQuery.js'
import type { PluginConfig, PoiSummary, Position } from './types.js'

const PLUGIN_NAME = 'Garmin Active Captain Resources'
const PLUGIN_DESCRIPTION =
  'Provides points of interest from Garmin Active Captain API as SignalK resources'

/** The SignalK resource type this plugin provides. */
const RESOURCE_TYPE = 'notes'

/** Default caching window, in minutes, when configuration omits it. */
const DEFAULT_CACHING_DURATION_MINUTES = 60

/** Public ActiveCaptain page for a point of interest, by id. */
const POI_PAGE_URL_PREFIX = 'https://activecaptain.garmin.com/en-US/pois/'

/** HTTP status for a point of interest that does not exist. */
const HTTP_NOT_FOUND = 404

/**
 * OpenAPI description of the plugin's HTTP API. The SignalK server-api docs
 * recommend any plugin that exposes an API document it; the paths here are
 * relative to the plugin's mount point `/plugins/${PLUGIN_ID}`.
 */
const OPEN_API = {
  openapi: '3.0.0',
  info: {
    title: 'Garmin Active Captain Resources plugin API',
    version: '1.0.0',
    description: 'Internal status API consumed by the plugin configuration panel.'
  },
  paths: {
    '/api/status': {
      get: {
        summary: 'Plugin status snapshot',
        description: 'Returns the current status snapshot. Requires administrator authentication.',
        responses: {
          200: {
            description: 'The current status snapshot.',
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          401: { description: 'The caller is not an authenticated administrator.' }
        }
      }
    }
  }
}

/** State rebuilt on every plugin start so configuration changes take effect. */
interface Runtime {
  client: ActiveCaptainClient
  cache: PoiCache
  /** The API `poiTypes` string, or null when the config selects no type. */
  poiTypes: string | null
}

/**
 * Build a SignalK `notes` resource object. The shape is shared by the list and
 * single-resource responses. `timestamp` is included only when a genuine
 * resource timestamp is known (the list endpoint does not supply one), and
 * `description`, which is rendered HTML, is included only when supplied.
 */
function buildNoteResource (
  id: string,
  name: string,
  position: Position,
  skIcon: string,
  timestamp?: string,
  description?: string
): Record<string, unknown> {
  const note: Record<string, unknown> = {
    name,
    position,
    url: `${POI_PAGE_URL_PREFIX}${id}`,
    properties: {
      readOnly: true,
      skIcon
    },
    $source: PLUGIN_ID
  }
  if (timestamp !== undefined) {
    note.timestamp = timestamp
  }
  if (description !== undefined) {
    // The description is rendered HTML, so the note must declare text/html
    // rather than mislabel the markup as plain text.
    note.description = description
    note.mimeType = 'text/html'
  }
  return note
}

/** Read a dot-notation property path out of a note object. */
function readProperty (note: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value !== null && typeof value === 'object') {
      return (value as Record<string, unknown>)[key]
    }
    return undefined
  }, note)
}

export = function (app: ServerAPI): Plugin {
  // Rebuilt on every start(); the resource provider methods read it live so a
  // configuration change takes effect.
  let runtime: Runtime | undefined

  // Records request outcomes and serves the status snapshot the configuration
  // panel polls. Rebuilt by start() so each run reports its own start time and
  // a clean error history; the methods and router below read it live.
  let status = createPluginStatus()

  const methods: ResourceProviderMethods = {
    listResources: async (query: Record<string, unknown>): Promise<Record<string, unknown>> => {
      app.debug(`Incoming request to list note resources - query: ${JSON.stringify(query)}`)
      if (runtime === undefined) {
        return {}
      }

      if (runtime.poiTypes === null) {
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
        entities = await runtime.client.listPointsOfInterest(bbox, runtime.poiTypes)
      } catch (error) {
        const message = `List request failed: ${String(error)}`
        status.recordError(message)
        app.setPluginError(message)
        throw error
      }
      status.recordListFetch(entities.length)
      app.setPluginStatus(`${entities.length} point(s) of interest from the last search`)

      // The bounding-box endpoint carries no per-POI last-modified time, so
      // list entries omit `timestamp` rather than report a fetch time that
      // changes on every call.
      const resources: Record<string, unknown> = {}
      for (const entity of entities) {
        resources[entity.id] = buildNoteResource(
          entity.id,
          entity.name,
          { ...entity.position },
          entity.type.toLowerCase()
        )
      }
      return resources
    },

    getResource: async (id: string, property?: string): Promise<object> => {
      app.debug(`Incoming request to get note ${id}${property != null ? ` property ${property}` : ''}`)
      if (runtime === undefined) {
        throw new Error('Plugin is not running')
      }

      // cache.get rejects on a failed load. The cache listener wired up in
      // start() records the API outcome, so a cache hit (which makes no
      // network request) never affects the status.
      const entity = await runtime.cache.get(id)
      const poi = entity.pointOfInterest

      let description = ''
      try {
        description = renderDescription(entity)
      } catch (error) {
        app.debug(`Unable to format description for ${id} - ${String(error)}`)
      }

      const note = buildNoteResource(
        id,
        poi.name,
        { ...poi.mapLocation },
        poi.poiType.toLowerCase(),
        poi.dateLastModified,
        description
      )

      // A property request returns just that property's value, per the
      // SignalK ResourceProvider contract.
      if (property === undefined || property === '') {
        return note
      }
      const value = readProperty(note, property)
      if (value === undefined) {
        throw new Error(`Resource ${id} has no property ${property}`)
      }
      return {
        value,
        timestamp: note.timestamp,
        $source: PLUGIN_ID
      }
    },

    setResource: (): Promise<void> => {
      return Promise.reject(new Error('ActiveCaptain resources are read-only'))
    },

    deleteResource: (): Promise<void> => {
      return Promise.reject(new Error('ActiveCaptain resources are read-only'))
    }
  }

  const plugin: Plugin = {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,

    schema: {
      title: PLUGIN_NAME,
      description: PLUGIN_DESCRIPTION,
      type: 'object',
      required: ['cachingDurationMinutes'],
      properties: {
        cachingDurationMinutes: {
          type: 'number',
          title: 'How long to cache data from Active Captain in minutes (longer = less data traffic; shorter = more up to date data)',
          default: DEFAULT_CACHING_DURATION_MINUTES
        },
        includeMarinas: { type: 'boolean', title: 'Include marinas', default: true },
        includeAnchorages: { type: 'boolean', title: 'Include anchorages', default: true },
        includeHazards: { type: 'boolean', title: 'Include hazards', default: true },
        includeBusinesses: { type: 'boolean', title: 'Include businesses', default: true },
        includeBoatRamps: { type: 'boolean', title: 'Include boat ramps', default: true },
        includeBridges: { type: 'boolean', title: 'Include bridges', default: true },
        includeDams: { type: 'boolean', title: 'Include dams', default: true },
        includeFerries: { type: 'boolean', title: 'Include ferries', default: true },
        includeInlets: { type: 'boolean', title: 'Include inlets', default: true },
        includeLocks: { type: 'boolean', title: 'Include locks', default: true },
        includeLocalKnowledge: { type: 'boolean', title: 'Include local knowledge', default: true },
        includeNavigational: { type: 'boolean', title: 'Include navigational aids', default: true },
        includeAirports: { type: 'boolean', title: 'Include airports', default: true }
      }
    },

    start: (config: object): void => {
      const options = config as Partial<PluginConfig>
      const cachingDurationMinutes =
        typeof options.cachingDurationMinutes === 'number' && options.cachingDurationMinutes > 0
          ? options.cachingDurationMinutes
          : DEFAULT_CACHING_DURATION_MINUTES

      const poiTypes = buildPoiTypesString(options)
      app.debug(`Starting with caching ${cachingDurationMinutes}min, poiTypes: ${poiTypes ?? 'none'}`)

      // A fresh recorder per start: this run reports its own start time and
      // does not inherit the previous run's error history.
      status = createPluginStatus()

      const client = createActiveCaptainClient(app)
      runtime = {
        client,
        cache: createPoiCache(client, cachingDurationMinutes, {
          // These fire only on a real load (a cache miss), so a cache hit
          // never flips the status to reachable while the API is down.
          onLoadSuccess: () => { status.recordDetailSuccess() },
          onLoadError: (error) => {
            // A 404 is the API answering normally: the point of interest does
            // not exist. That is not a reachability failure.
            if (error instanceof HttpError && error.status === HTTP_NOT_FOUND) {
              status.recordDetailSuccess()
            } else {
              status.recordError(`Detail request failed: ${String(error)}`)
            }
          }
        }),
        poiTypes
      }

      // Register on every start(). The SignalK server unregisters a plugin's
      // resource providers on stop, so a config change (stop then start) must
      // re-register or the `notes` type would be left with no provider.
      // ResourcesApi.register stores providers in a Map keyed by plugin id, so
      // this is idempotent.
      try {
        app.registerResourceProvider({ type: RESOURCE_TYPE, methods })
      } catch (error) {
        app.error(`Cannot register as a ${RESOURCE_TYPE} resource provider: ${String(error)}`)
      }

      app.setPluginStatus('Ready, waiting for resource requests')
    },

    stop: (): void => {
      // Abort in-flight requests so a late response cannot record onto the
      // next run's status, then drop the cache.
      runtime?.client.close()
      runtime?.cache.clear()
      runtime = undefined
    },

    getOpenApi: () => OPEN_API,

    // Mounts the admin-gated GET /api/status endpoint the configuration panel
    // polls. The cached entry count comes from the live runtime, or zero
    // before the first start().
    registerWithRouter: createStatusRouter(
      app,
      () => status.snapshot(runtime?.cache.size() ?? 0)
    )
  }

  return plugin
}
