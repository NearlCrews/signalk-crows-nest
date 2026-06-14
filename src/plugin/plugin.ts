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
import type { PluginConfig } from '../shared/types.js'
import { join } from 'node:path'
import type { IRouter } from 'express'
import { createEncDirectClient } from '../inputs/noaa-enc/enc-direct-client.js'
import { normalizeRouteDraftConfig, routeDraftConfigSchema } from '../route-draft/config.js'
import { createRouteDraftRouter } from '../route-draft/endpoint.js'
import type { RouteDraftService } from '../route-draft/endpoint.js'
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
          'Asks OpenRouter for a route, then checks it against NOAA ENC charted depth, land, and ' +
          'point hazards and computes the fuel. Optional and admin-scoped: it spends the OpenRouter ' +
          'budget, so it is gated to administrators and is disabled until a key is configured.',
        responses: {
          200: {
            description: 'A drafted route, or an ok:false body with a stable error code.',
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          400: { description: 'The request body was invalid.' },
          401: { description: 'The caller is not authenticated, or drafting is not configured.' },
          403: { description: 'The caller is authenticated but is not an administrator.' }
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
  let routeDraftGeneration = 0

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
    routeDraftGeneration += 1
    routeDraftService = undefined
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
    const statePath = join(app.getDataDirPath(), 'route-draft-budget.json')
    BudgetTracker.load({
      maxPerDay: rd.routeDraftMaxCallsPerDay,
      statePath,
      log: { debug: (m) => { app.debug(m) }, error: (m) => { app.error(m) } }
    }).then((budget) => {
      if (mine === routeDraftGeneration) {
        routeDraftService = { llm, budget, enc, config: rd }
        app.debug("Crow's Nest route drafting ready")
      }
    }).catch((err) => {
      app.error(`Cannot load the route-draft budget: ${String(err)}`)
    })
  }

  const statusRegistrar = createStatusRouter(
    app,
    () => status.snapshot(runtime?.source.cacheSize() ?? 0)
  )
  const routeDraftRegistrar = createRouteDraftRouter(app, () => routeDraftService)
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
      app.debug(`Crow's Nest started outputs: ${startedIds.join(', ') || '(none)'}`)

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
          app.debug(`Crow's Nest position monitor driving ${contributors.length} position-driven output(s)`)
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
