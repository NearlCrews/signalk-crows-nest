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
import { createPositionMonitor } from '../monitoring/position-monitor.js'
import type { PositionMonitor } from '../monitoring/position-monitor.js'
import { createPluginStatus } from '../status/plugin-status.js'
import { createStatusRouter } from '../status/status-router.js'
import { buildPoiTypesString, ensurePoiTypes } from '../shared/poi-type-selection.js'
import { PLUGIN_ID } from '../shared/plugin-id.js'
import type { PluginConfig } from '../shared/types.js'

const PLUGIN_NAME = "Crow's Nest"
const PLUGIN_DESCRIPTION =
  'Imports Garmin ActiveCaptain, OpenSeaMap, USCG Light List, and NOAA ENC Direct points of interest as SignalK resources, with proximity and route-corridor hazard alarms'

/** OpenAPI description of the plugin's internal status API. */
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
          401: { description: 'The caller is not authenticated.' },
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

  /**
   * Tear the current runtime down. Idempotent.
   *
   * Every stop is wrapped so one output's failing `stop()` cannot abort the
   * teardown and leak the remaining handles or skip `source.close()`. The
   * runtime reference is cleared first, so a throw can never leave a
   * half-stopped runtime behind for a later call.
   */
  function teardown (): void {
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

  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    schema: assemblePluginSchema(PLUGIN_NAME, PLUGIN_DESCRIPTION, [
      ...inputs.configSchemaFragments(),
      ...outputs.configSchemaFragments()
    ]),

    start: (rawConfig: object): void => {
      // Guard against a start() without a matching stop().
      teardown()

      const config = rawConfig as PluginConfig
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

      const outputContext: OutputContext = { app, config, pois: source, status }
      const { handles, startedIds } = outputs.startEnabled(outputContext)
      runtime = { source, handles }

      // Log the outputs that actually started, not merely the enabled ones, so
      // an output whose start() threw and was isolated by the registry is not
      // reported as started.
      app.debug(`Crow's Nest started outputs: ${startedIds.join(', ') || '(none)'}`)

      // Detect outputs whose start() threw and was isolated by the registry,
      // so the admin UI surfaces a plugin error rather than the bland "Ready"
      // status that would mask a dead output.
      const enabledOutputIds = outputs.modules
        .filter((module) => module.isEnabled(config))
        .map((module) => module.id)
      const startedSet = new Set(startedIds)
      const failedOutputIds = enabledOutputIds.filter((id) => !startedSet.has(id))

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
        app.setPluginError(
          'Position monitor failed to start; proximity and route-hazard alarms are not running'
        )
      }

      // Treat a failed output start the same way as a monitor failure: surface
      // it via setPluginError so the admin UI does not show "Ready" while an
      // enabled output is dead. A monitor failure takes precedence; its error
      // message is the more specific one.
      if (!monitorFailed && failedOutputIds.length > 0) {
        app.setPluginError(
          `Outputs failed to start: ${failedOutputIds.join(', ')} (see server log for details)`
        )
      } else if (!monitorFailed) {
        // Only report a healthy status when nothing failed.
        app.setPluginStatus('Ready, waiting for resource requests')
      }
    },

    stop: (): void => {
      teardown()
    },

    getOpenApi: () => OPEN_API,

    registerWithRouter: createStatusRouter(
      app,
      () => status.snapshot(runtime?.source.cacheSize() ?? 0)
    )
  }
}
