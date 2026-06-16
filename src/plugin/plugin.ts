/**
 * Plugin factory.
 *
 * Assembles the SignalK plugin from the input and output registries: it builds
 * the config schema from the modules' fragments, and its `start`/`stop`
 * lifecycle builds the aggregate POI source, starts the enabled outputs, and
 * builds the shared position monitor from the outputs' scan contributors.
 */

import type { Plugin, ServerAPI } from '@signalk/server-api'
import type { InputRegistry } from '../inputs/input-registry.js'
import type { OutputRegistry } from '../outputs/output-registry.js'
import type { OutputContext, OutputHandle, PositionScanContributor } from '../outputs/output.js'
import type { PoiSource } from '../inputs/poi-source.js'
import { assemblePluginSchema } from './plugin-config.js'
import { createBridgeClearanceResolver } from '../outputs/bridge-air-draft/bridge-clearance-resolver.js'
import { createPositionMonitor } from '../monitoring/position-monitor.js'
import type { PositionMonitor } from '../monitoring/position-monitor.js'
import { createPluginStatus } from '../status/plugin-status.js'
import { createStatusRouter } from '../status/status-router.js'
import { buildPoiTypesString, ensurePoiTypes } from '../shared/poi-type-selection.js'
import { PLUGIN_ID, PLUGIN_REPO_URL } from '../shared/plugin-id.js'
import type { Logger, PluginConfig } from '../shared/types.js'
import { join } from 'node:path'
import type { IRouter } from 'express'
import { createEncDirectClient } from '../inputs/noaa-enc/enc-direct-client.js'
import { createOverpassClient } from '../inputs/openseamap/overpass-client.js'
import { createVectorTileClient, DEFAULT_TILE_STYLE_URL, type VectorTileClient } from '../inputs/vector-tiles/vector-tile-client.js'
import { createTileWaterSource } from '../route-draft/channel-router/index.js'
import type { OverpassClient } from '../inputs/openseamap/overpass-client.js'
import { resolvePrimaryEndpoint } from '../shared/overpass-endpoints.js'
import { normalizeRouteDraftConfig, routeDraftConfigSchema } from '../route-draft/config.js'
import { createRouteDraftRouter, modelsForRequest } from '../route-draft/endpoint.js'
import type { RouteDraftService } from '../route-draft/endpoint.js'
import { createEmodnetClient } from '../route-draft/emodnet/emodnet-client.js'
import { OpenRouterClient } from '../route-draft/openrouter.js'
import { BudgetTracker } from '../route-draft/budget.js'

const PLUGIN_NAME = "Crow's Nest"
const PLUGIN_DESCRIPTION =
  'Imports Garmin ActiveCaptain, OpenSeaMap, USCG Light List, and NOAA ENC Direct points of interest as SignalK resources, with proximity and route-corridor hazard alarms'

/** OpenAPI description of the plugin's internal status API. */
const OPEN_API = {
  openapi: '3.0.0',
  info: {
    title: "Crow's Nest plugin API",
    version: '1.0.0',
    description: 'Internal status API plus the optional AI route-draft endpoint.'
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
          401: { description: 'The caller is not authenticated.' },
          403: { description: 'The caller is authenticated but is not an administrator.' }
        }
      }
    },
    '/api/route-draft': {
      post: {
        summary: 'Draft a route from a plain-language passage request',
        description:
          'Asks OpenRouter for a route, then checks each leg against NOAA ENC charted depth, land, and ' +
          'hazards in US waters; OpenSeaMap point hazards and OpenStreetMap coastline land worldwide; ' +
          'and EMODnet modeled depth (awareness-grade, referenced to LAT) in European seas. Computes ' +
          'a deterministic fuel estimate. Optional and admin-scoped: it spends the OpenRouter budget, ' +
          'so it is gated to administrators and is disabled until a key is configured.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['from', 'bounds'],
                properties: {
                  prompt: {
                    type: 'string',
                    description: 'Plain-language passage request. Required for a from-scratch draft; an optional hint when route is present.'
                  },
                  from: {
                    type: 'object',
                    required: ['latitude', 'longitude'],
                    properties: {
                      latitude: { type: 'number' },
                      longitude: { type: 'number' }
                    }
                  },
                  bounds: {
                    type: 'array',
                    description: 'Visible chart window as [west, south, east, north].',
                    items: { type: 'number' },
                    minItems: 4,
                    maxItems: 4
                  },
                  route: {
                    type: 'array',
                    description: 'Optional drawn route to optimize, ordered turning points. When present the endpoint refines it and prompt becomes an optional hint.',
                    minItems: 2,
                    maxItems: 25,
                    items: {
                      type: 'object',
                      required: ['latitude', 'longitude'],
                      properties: {
                        latitude: { type: 'number' },
                        longitude: { type: 'number' }
                      }
                    }
                  },
                  units: { type: 'string', enum: ['metric', 'imperial'] }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'A drafted route, or an ok:false body with a stable error code.',
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          400: { description: 'The request body was invalid.' },
          401: { description: 'The caller is not authenticated, or drafting is not configured.' },
          403: { description: 'The caller is authenticated but is not an administrator.' },
          500: { description: 'The route-draft handler failed unexpectedly.' },
          502: { description: 'The AI service or the safety check failed.' }
        }
      }
    }
  }
}

/** State rebuilt on every plugin start so configuration changes take effect. */
interface Runtime {
  source: PoiSource
  handles: OutputHandle[]
  monitor?: PositionMonitor
}

/** Build the SignalK plugin from the input and output registries. */
export function createPlugin (
  app: ServerAPI,
  inputs: InputRegistry,
  outputs: OutputRegistry
): Plugin {
  let runtime: Runtime | undefined
  // Replaced on every start with a recorder built for that run's enabled
  // sources; an empty recorder stands in before the first start.
  let status = createPluginStatus([])
  // The optional AI route-draft service, built at start() when drafting is
  // enabled and a key is set. Undefined makes the endpoint return
  // `unauthorized` (not configured). The generation counter orphans an
  // in-flight budget load if a teardown or a newer start beats it.
  let routeDraftService: RouteDraftService | undefined
  // True when drafting is configured (a key is set) but the service failed to start, for example a
  // budget-state load error. It lets the endpoint return a "configured but failed to start" error
  // rather than the misleading "not configured" when the service is undefined for that reason.
  let routeDraftInitFailed = false
  let routeDraftGeneration = 0
  // The route-draft Overpass client is a queued client with in-flight work to
  // abort, unlike the one-shot ENC client, so it is held alongside the service
  // and closed on teardown even if the budget load (and thus the published
  // service) never resolved. The one-shot ENC client needs no close.
  let routeDraftOverpass: OverpassClient | undefined
  let routeDraftTiles: VectorTileClient | undefined

  /**
   * Tear the current runtime down. Idempotent.
   *
   * Every stop is wrapped so one output's failing `stop()` cannot abort the
   * teardown and leak the remaining handles or skip `source.close()`. The
   * runtime reference is cleared first, so a throw can never leave a
   * half-stopped runtime behind for a later call.
   */
  function teardown (): void {
    // Always orphan any in-flight route-draft build and drop the service, even
    // on the no-runtime path, so the endpoint cannot answer with a stale one.
    // The Overpass client is closed (aborting any in-flight route-draft query)
    // independently of the service, since it is built synchronously while the
    // service is published only after the async budget load.
    routeDraftGeneration += 1
    routeDraftService = undefined
    routeDraftInitFailed = false
    if (routeDraftOverpass !== undefined) {
      try {
        routeDraftOverpass.close()
      } catch (error) {
        app.error(`Cannot close the route-draft Overpass client: ${String(error)}`)
      }
      routeDraftOverpass = undefined
    }
    if (routeDraftTiles !== undefined) {
      try {
        routeDraftTiles.close()
      } catch (error) {
        app.error(`Cannot close the route-draft vector-tile client: ${String(error)}`)
      }
      routeDraftTiles = undefined
    }
    if (runtime === undefined) {
      // Even with no runtime to tear down, reset the status recorder so a
      // snapshot during the gap between teardown and the next start does
      // not report stale source rows from a prior run.
      status = createPluginStatus([])
      return
    }
    const { source, handles, monitor } = runtime
    runtime = undefined
    // Reset the status recorder before the per-resource stop loop so a
    // snapshot read mid-teardown sees the gap state rather than the prior
    // run's stale rows. The new recorder reports no sources and no errors
    // until the next start() rebuilds it.
    status = createPluginStatus([])

    if (monitor !== undefined) {
      try {
        monitor.stop()
      } catch (error) {
        app.error(`Cannot stop the position monitor: ${String(error)}`)
      }
    }
    for (const handle of handles) {
      try {
        handle.stop()
      } catch (error) {
        app.error(`Cannot stop an output: ${String(error)}`)
      }
    }
    try {
      source.close()
    } catch (error) {
      app.error(`Cannot close the POI source: ${String(error)}`)
    }
  }

  /**
   * Build the optional AI route-draft service when drafting is enabled and a
   * key is set. The OpenRouter and ENC clients are built at once; the call
   * budget loads asynchronously from the plugin data dir, so the service is
   * published only once the load resolves and only if this start is still
   * current (the generation guard).
   */
  function startRouteDraft (config: PluginConfig): void {
    const rd = normalizeRouteDraftConfig(config)
    // normalizeRouteDraftConfig already trims the key, so read it once.
    const apiKey = rd.routeDraftOpenRouterApiKey
    if (!rd.routeDraftEnabled || apiKey === '') return
    // Drafting is configured from here on; start clean so a prior failed start does not stick.
    routeDraftInitFailed = false
    const mine = routeDraftGeneration
    const llm = new OpenRouterClient({
      apiKey,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: rd.routeDraftModel,
      requestTimeoutMs: 20_000,
      referer: PLUGIN_REPO_URL,
      title: PLUGIN_NAME
    })
    const enc = createEncDirectClient()
    // The European modeled-depth leg check queries through this EMODnet client.
    // Like the ENC client it is a stateless one-shot client holding no sockets
    // between calls, so it needs no close on teardown.
    const emodnet = createEmodnetClient()
    const log: Logger = { debug: (m) => { app.debug(m) }, error: (m) => { app.error(m) } }
    // The worldwide OpenSeaMap leg check queries through this Overpass client.
    // The default endpoint suffices (no per-source config here); the lighter
    // minDelayMs keeps the bounded per-route burst inside the request deadline.
    const overpass = createOverpassClient(resolvePrimaryEndpoint(undefined), log, { minDelayMs: 250 })
    routeDraftOverpass = overpass
    // The channel router reads worldwide water from vector tiles; the source holds the
    // cross-request tile cache, so it is built once here, not per request.
    const tileClient = createVectorTileClient(DEFAULT_TILE_STYLE_URL, log)
    routeDraftTiles = tileClient
    const tileWater = createTileWaterSource(tileClient)
    const statePath = join(app.getDataDirPath(), 'route-draft-budget.json')
    BudgetTracker.load({
      maxPerDay: rd.routeDraftMaxCallsPerDay,
      statePath,
      log
    }).then((budget) => {
      if (mine === routeDraftGeneration) {
        routeDraftService = { llm, budget, enc, overpass, emodnet, tileWater, config: rd, models: modelsForRequest(rd.routeDraftModel) }
        routeDraftInitFailed = false
        app.debug(`${PLUGIN_NAME} route drafting ready`)
      }
    }).catch((err) => {
      // Configured but failed to start: record it so the endpoint reports a start failure, not "not configured".
      if (mine === routeDraftGeneration) routeDraftInitFailed = true
      app.error(`Cannot load the route-draft budget: ${String(err)}`)
    })
  }

  const statusRegistrar = createStatusRouter(
    app,
    () => status.snapshot(runtime?.source.cacheSize() ?? 0)
  )
  const routeDraftRegistrar = createRouteDraftRouter(app, () => routeDraftService, () => routeDraftInitFailed)
  const registerWithRouter = (router: IRouter): void => {
    statusRegistrar(router)
    routeDraftRegistrar(router)
  }

  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    schema: assemblePluginSchema(PLUGIN_NAME, PLUGIN_DESCRIPTION, [
      ...inputs.configSchemaFragments(),
      ...outputs.configSchemaFragments(),
      routeDraftConfigSchema()
    ]),

    start: (rawConfig: object): void => {
      // Guard against a start() without a matching stop().
      teardown()

      app.setPluginStatus('Starting')

      const config = rawConfig as PluginConfig
      startRouteDraft(config)
      // A fresh recorder per run, built with this run's enabled sources so the
      // status snapshot carries one row per source; it reports this run's own
      // start time and a clean error history.
      const enabledSources = inputs.modules
        .filter((module) => module.isEnabled(config))
        .map((module) => ({ source: module.id, name: module.name }))
      status = createPluginStatus(enabledSources)

      // Log the resolved configuration so a misconfigured install is
      // diagnosable from the server log alone.
      const poiTypes = buildPoiTypesString(config)
      app.debug(
        `Crow's Nest starting: caching duration ${config.cachingDurationMinutes} minutes, ` +
        `POI types ${poiTypes ?? '(none selected)'}`
      )

      // The InputContext's getCurrentPosition reads through the runtime's
      // monitor, which is created later in this same start() call. The
      // closure captures `runtime` lazily so the inputs always see the
      // latest fix the monitor has tracked, and `undefined` while the
      // monitor is still being built or has not yet seen a position fix.
      const source = inputs.createSource({
        app,
        config,
        status,
        dataDir: app.getDataDirPath(),
        getCurrentPosition: () => runtime?.monitor?.getCurrentPosition()
      })

      // The server shares one plugin-status slot, last writer wins. A
      // start-time failure below (dead monitor or failed output) latches a
      // plugin error that must stay visible until the next start, so the
      // outputs get a guarded app whose healthy-status writes are suppressed
      // while the latch is set; everything else, errors included, delegates
      // to the real app through the prototype chain.
      let startErrorLatched = false
      const guardedApp: ServerAPI = Object.assign(Object.create(app), {
        setPluginStatus: (message: string): void => {
          if (!startErrorLatched) {
            app.setPluginStatus(message)
          }
        }
      })

      const outputContext: OutputContext = {
        app: guardedApp,
        config,
        pois: source,
        status,
        // One clearance resolver per run, shared by the bridge air-draft and
        // route-hazard outputs so the same bridge resolves once. Cheap to
        // build (an LRU and a Set, no timers), so it is always supplied even
        // when neither consumer is enabled.
        bridgeClearanceResolver: createBridgeClearanceResolver({
          getDetails: (id) => source.getDetails(id),
          debug: (message) => { app.debug(message) }
        })
      }
      const { handles, startedIds, failedIds: failedOutputIds } = outputs.startEnabled(outputContext)
      runtime = { source, handles }

      // Log the outputs that actually started, not merely the enabled ones, so
      // an output whose start() threw and was isolated by the registry is not
      // reported as started.
      app.debug(`${PLUGIN_NAME} started outputs: ${startedIds.join(', ') || '(none)'}`)

      // The registry reports the enabled outputs whose start() threw and was
      // isolated, so the admin UI surfaces a plugin error rather than the bland
      // "Ready" status that would mask a dead output.

      // The position monitor always starts, because the US-only inputs read
      // through its `getCurrentPosition` getter to skip outbound HTTP outside
      // US waters even when no position-driven output is enabled. The output
      // contributors drive its per-tick scan when any are present.
      const contributors: PositionScanContributor[] = handles
        .map((handle) => handle.positionScan)
        .filter((scan): scan is PositionScanContributor => scan !== undefined)
      let monitorFailed = false
      const requiredTypes = contributors.flatMap((c) => c.poiTypes)
      try {
        runtime.monitor = createPositionMonitor({
          app,
          client: source,
          contributors,
          poiTypes: ensurePoiTypes(poiTypes, requiredTypes)
        })
        if (contributors.length > 0) {
          app.debug(`${PLUGIN_NAME} position monitor driving ${contributors.length} position-driven output(s)`)
        }
      } catch (error) {
        // The position-driven outputs are started but, without the monitor,
        // never driven. Surface a plugin error rather than reporting a bland
        // "Ready" status that would mask dead safety alarms.
        monitorFailed = true
        app.error(`Cannot start the position monitor: ${String(error)}`)
        // A monitor-startup failure is not a data-source outage, so it is
        // surfaced as a plugin error rather than recorded against a source
        // row in the per-source status snapshot.
        startErrorLatched = true
        app.setPluginError(
          'Position monitor failed to start; proximity and route-hazard alarms are not running'
        )
      }

      // Treat a failed output start the same way as a monitor failure: surface
      // it via setPluginError so the admin UI does not show "Ready" while an
      // enabled output is dead. A monitor failure takes precedence; its error
      // message is the more specific one.
      if (!monitorFailed && failedOutputIds.length > 0) {
        startErrorLatched = true
        app.setPluginError(
          `Outputs failed to start: ${failedOutputIds.join(', ')} (see server log for details)`
        )
      } else if (!monitorFailed) {
        // Only report a healthy status when nothing failed.
        app.setPluginStatus(
          `Ready, ${enabledSources.length} source(s) and ${startedIds.length} output(s) enabled`
        )
      }
    },

    stop: (): void => {
      teardown()
    },

    getOpenApi: () => OPEN_API,

    registerWithRouter
  }
}
