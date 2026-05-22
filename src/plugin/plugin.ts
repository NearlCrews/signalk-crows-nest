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
  'Imports Garmin ActiveCaptain points of interest as SignalK resources, with proximity and route-corridor hazard alarms'

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
  let status = createPluginStatus()

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
      return
    }
    const { source, handles, monitor } = runtime
    runtime = undefined

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
      // A fresh recorder per run: this run reports its own start time and a
      // clean error history.
      status = createPluginStatus()

      // Log the resolved configuration so a misconfigured install is
      // diagnosable from the server log alone.
      const poiTypes = buildPoiTypesString(config)
      app.debug(
        `Crow's Nest starting: caching duration ${config.cachingDurationMinutes} minutes, ` +
        `POI types ${poiTypes ?? '(none selected)'}`
      )

      const source = inputs.createSource({
        app,
        config,
        status,
        dataDir: app.getDataDirPath()
      })

      const outputContext: OutputContext = { app, config, pois: source, status }
      const { handles, startedIds } = outputs.startEnabled(outputContext)
      runtime = { source, handles }

      // Log the outputs that actually started, not merely the enabled ones, so
      // an output whose start() threw and was isolated by the registry is not
      // reported as started.
      app.debug(`Crow's Nest started outputs: ${startedIds.join(', ') || '(none)'}`)

      // Build the shared position monitor from the outputs' scan contributors.
      const contributors: PositionScanContributor[] = handles
        .map((handle) => handle.positionScan)
        .filter((scan): scan is PositionScanContributor => scan !== undefined)
      let monitorFailed = false
      if (contributors.length > 0) {
        const requiredTypes = [...new Set(contributors.flatMap((c) => [...c.poiTypes]))]
        try {
          runtime.monitor = createPositionMonitor({
            app,
            client: source,
            contributors,
            poiTypes: ensurePoiTypes(poiTypes, requiredTypes),
            status
          })
          app.debug(`Crow's Nest position monitor driving ${contributors.length} position-driven output(s)`)
        } catch (error) {
          // The position-driven outputs are started but, without the monitor,
          // never driven. Surface a plugin error rather than reporting a bland
          // "Ready" status that would mask dead safety alarms.
          monitorFailed = true
          app.error(`Cannot start the position monitor: ${String(error)}`)
          app.setPluginError(
            'Position monitor failed to start; proximity and route-hazard alarms are not running'
          )
          // Record the failure so the status snapshot the panel polls reflects
          // that the position-driven alarms are not running.
          status.recordError(`Position monitor failed to start: ${String(error)}`)
        }
      }

      // Only report a healthy status when nothing failed. On a monitor failure
      // the plugin error set above must stand.
      if (!monitorFailed) {
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
