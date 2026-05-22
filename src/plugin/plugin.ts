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
import type { PluginStatus } from '../status/plugin-status.js'
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
          401: { description: 'The caller is not an authenticated administrator.' }
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
  let status: PluginStatus = createPluginStatus()

  /** Tear the current runtime down. Idempotent. */
  function teardown (): void {
    if (runtime === undefined) {
      return
    }
    runtime.monitor?.stop()
    for (const handle of runtime.handles) {
      handle.stop()
    }
    runtime.source.close()
    runtime = undefined
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

      const source = inputs.createSource({
        app,
        config,
        status,
        dataDir: app.getDataDirPath()
      })

      const outputContext: OutputContext = { app, config, pois: source, status }
      const handles = outputs.startEnabled(outputContext)
      runtime = { source, handles }

      // Build the shared position monitor from the outputs' scan contributors.
      const contributors: PositionScanContributor[] = handles
        .map((handle) => handle.positionScan)
        .filter((scan): scan is PositionScanContributor => scan !== undefined)
      if (contributors.length > 0) {
        const requiredTypes = [...new Set(contributors.flatMap((c) => [...c.poiTypes]))]
        try {
          runtime.monitor = createPositionMonitor({
            app,
            client: source,
            contributors,
            poiTypes: ensurePoiTypes(buildPoiTypesString(config), requiredTypes)
          })
        } catch (error) {
          app.error(`Cannot start the position monitor: ${String(error)}`)
        }
      }

      app.setPluginStatus('Ready, waiting for resource requests')
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
