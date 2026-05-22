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

import { createActiveCaptainClient, HttpError, type ActiveCaptainClient } from './inputs/active-captain/active-captain-client.js'
import { createPoiCache, type PoiCache } from './inputs/active-captain/poi-cache.js'
import { createPoiStore } from './inputs/active-captain/poi-store.js'
import { createPluginStatus } from './status/plugin-status.js'
import { createStatusRouter } from './status/status-router.js'
import { createProximityAlarms } from './proximityAlarms.js'
import { createCourseReader, type CourseReader } from './courseReader.js'
import { createRouteHazardAlarms } from './routeHazardAlarms.js'
import {
  createPositionMonitor,
  type PositionMonitor,
  type PositionMonitorConfig
} from './positionMonitor.js'
import { parseApiDate, renderDescription } from './inputs/active-captain/poi-detail-renderer.js'
import { PLUGIN_ID } from './shared/plugin-id.js'
import { buildPoiTypesString } from './poiTypeSelection.js'
import { filterByRating } from './inputs/active-captain/rating-filter.js'
import { resolveBbox } from './resourceQuery.js'
import type { PluginConfig, PoiSummary, Position } from './shared/types.js'

const PLUGIN_NAME = "Crow's Nest"
const PLUGIN_DESCRIPTION =
  'Imports Garmin ActiveCaptain points of interest as SignalK resources, with proximity and route-corridor hazard alarms'

/** The SignalK resource type this plugin provides. */
const RESOURCE_TYPE = 'notes'

/** Default caching window, in minutes, when configuration omits it. */
const DEFAULT_CACHING_DURATION_MINUTES = 60

/** Public ActiveCaptain page for a point of interest, by id. */
const POI_PAGE_URL_PREFIX = 'https://activecaptain.garmin.com/en-US/pois/'

/** HTTP status for a point of interest that does not exist. */
const HTTP_NOT_FOUND = 404

/** Default proximity-alarm radius, in meters; mirrors the schema default. */
const DEFAULT_PROXIMITY_ALARM_RADIUS_METERS = 500

/** Default route-corridor half-width, in meters; mirrors the schema default. */
const DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS = 500

/** Lower bound on the hazard-scan radius, so the alarm check always has data. */
const MIN_SCAN_RADIUS_METERS = 2000

/** POI type the proximity alarms act on; the monitor fetch must include it. */
const PROXIMITY_POI_TYPES = ['Hazard'] as const

/** POI types the route-corridor scan acts on; the monitor fetch must include them. */
const ROUTE_SCAN_POI_TYPES = ['Hazard', 'Bridge', 'Lock'] as const

/**
 * OpenAPI description of the plugin's HTTP API. The SignalK server-api docs
 * recommend any plugin that exposes an API document it; the paths here are
 * relative to the plugin's mount point `/plugins/${PLUGIN_ID}`.
 */
const OPEN_API = {
  openapi: '3.0.0',
  info: {
    title: "Crow's Nest plugin API",
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
  /** Hide list results rated below this value (0 keeps everything). */
  minimumRating: number
  /** The position monitor, present only when proximity alarms are enabled. */
  monitor?: PositionMonitor
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

/**
 * Ensure the POI-types string includes every type in `required`. The position
 * monitor's per-tick fetch uses it, and the proximity alarms and the
 * route-corridor scan can only act on points of interest the fetch returned.
 */
function ensurePoiTypes (poiTypes: string | null, required: readonly string[]): string {
  const present = (poiTypes === null || poiTypes === '') ? [] : poiTypes.split(',')
  const merged = [...present]
  for (const type of required) {
    if (!merged.includes(type)) {
      merged.push(type)
    }
  }
  return merged.join(',')
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

      // Drop points of interest rated below the configured minimum.
      entities = filterByRating(entities, runtime.minimumRating)

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

      // ActiveCaptain serves a zone-less timestamp; normalize it to a UTC
      // ISO-8601 string so a consumer does not read it as local time. An
      // unparseable value is omitted rather than passed through.
      const modified = parseApiDate(poi.dateLastModified)
      const timestamp = Number.isFinite(modified.getTime())
        ? modified.toISOString()
        : undefined
      const note = buildNoteResource(
        id,
        poi.name,
        { ...poi.mapLocation },
        poi.poiType.toLowerCase(),
        timestamp,
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
        includeAirports: { type: 'boolean', title: 'Include airports', default: true },
        minimumRating: {
          type: 'number',
          title: 'Minimum rating: hide points of interest rated below this (0 to 5; 0 shows all)',
          default: 0,
          minimum: 0,
          maximum: 5
        },
        enableProximityAlarms: {
          type: 'boolean',
          title: 'Emit a notification when the vessel nears a hazard (subscribes to the vessel position)',
          default: false
        },
        proximityAlarmRadiusMeters: {
          type: 'number',
          title: 'Proximity alarm radius in meters',
          default: 500,
          minimum: 1
        },
        enableRouteHazardScan: {
          type: 'boolean',
          title: 'Scan the active route ahead for hazards, bridges, and locks (uses the Course API)',
          default: false
        },
        routeCorridorWidthMeters: {
          type: 'number',
          title: 'Route corridor width in meters',
          default: 500,
          minimum: 1
        }
      }
    },

    start: (config: object): void => {
      // stop() should have cleared the previous run, but guard against a
      // start() without a matching stop(): tear the old runtime down first so
      // its client and position monitor do not leak.
      if (runtime !== undefined) {
        runtime.client.close()
        runtime.monitor?.stop()
        runtime = undefined
      }

      const options = config as Partial<PluginConfig>
      const cachingDurationMinutes =
        typeof options.cachingDurationMinutes === 'number' && options.cachingDurationMinutes > 0
          ? options.cachingDurationMinutes
          : DEFAULT_CACHING_DURATION_MINUTES

      const poiTypes = buildPoiTypesString(options)
      const minimumRating =
        typeof options.minimumRating === 'number' && options.minimumRating > 0
          ? options.minimumRating
          : 0
      app.debug(`Starting with caching ${cachingDurationMinutes}min, poiTypes: ${poiTypes ?? 'none'}`)

      // A fresh recorder per start: this run reports its own start time and
      // does not inherit the previous run's error history.
      status = createPluginStatus()

      const client = createActiveCaptainClient(app)
      // The cache is backed by an on-disk store in the plugin data directory,
      // so cached detail survives a restart and is readable offline.
      const store = createPoiStore(app.getDataDirPath(), cachingDurationMinutes)
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
              // Surface a genuine detail outage on the SignalK plugin status
              // too, not just the panel snapshot, so it matches how a failed
              // list request is reported.
              const message = `Detail request failed: ${String(error)}`
              status.recordError(message)
              app.setPluginError(message)
            }
          }
        }, store),
        poiTypes,
        minimumRating
      }

      // Run the position monitor when proximity alarms, the route-corridor
      // hazard scan, or both are enabled: it subscribes to the vessel
      // position, lists points of interest as the vessel moves, and feeds the
      // enabled checks. The monitor is an optional extra: if its construction
      // throws, the failure is logged and the core notes resource provider
      // still starts.
      const proximityEnabled = options.enableProximityAlarms === true
      const routeScanEnabled = options.enableRouteHazardScan === true
      if (proximityEnabled || routeScanEnabled) {
        // A non-positive radius would disable the alarm silently, so it falls
        // back to the default. The radius also sizes the scan box, so it is
        // resolved even when only the route scan is on.
        const radiusMeters =
          typeof options.proximityAlarmRadiusMeters === 'number' && options.proximityAlarmRadiusMeters > 0
            ? options.proximityAlarmRadiusMeters
            : DEFAULT_PROXIMITY_ALARM_RADIUS_METERS
        // The route scan also needs Bridge and Lock; its type list includes
        // Hazard, so it covers the proximity alarms when both are enabled.
        const requiredPoiTypes = routeScanEnabled ? ROUTE_SCAN_POI_TYPES : PROXIMITY_POI_TYPES
        // The Course API reader holds a delta subscription. The monitor stops
        // it on teardown, but a kept reference lets the catch below stop it
        // when the monitor itself fails to construct, so it does not leak.
        let courseReader: CourseReader | undefined
        try {
          const monitorConfig: PositionMonitorConfig = {
            app,
            client,
            poiTypes: ensurePoiTypes(poiTypes, requiredPoiTypes),
            scanRadiusMeters: Math.max(radiusMeters * 3, MIN_SCAN_RADIUS_METERS)
          }
          if (proximityEnabled) {
            monitorConfig.alarms = createProximityAlarms(app, radiusMeters)
          }
          if (routeScanEnabled) {
            // A non-positive corridor width would leave the scan unable to
            // ever flag a point of interest, so it falls back to the default.
            const corridorWidthMeters =
              typeof options.routeCorridorWidthMeters === 'number' && options.routeCorridorWidthMeters > 0
                ? options.routeCorridorWidthMeters
                : DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS
            courseReader = createCourseReader({ app })
            monitorConfig.routeScan = {
              courseReader,
              alarms: createRouteHazardAlarms(app),
              corridorWidthMeters
            }
          }
          runtime.monitor = createPositionMonitor(monitorConfig)
          app.debug(
            `Position monitor started (proximity alarms: ${proximityEnabled}, route scan: ${routeScanEnabled})`
          )
        } catch (error) {
          // The monitor was not created, so it cannot stop the reader: do it
          // here. stop() is idempotent, so this is safe even if it ran.
          courseReader?.stop()
          app.error(`Cannot start the position monitor: ${String(error)}`)
        }
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
      // Abort in-flight requests and stop the position monitor so a late
      // callback cannot touch the next run. The persistent cache is left on
      // disk, since it is the offline store, so cache.clear() is deliberately
      // not called here: the server discards the in-memory cache anyway when
      // `runtime` is dropped.
      runtime?.client.close()
      runtime?.monitor?.stop()
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
