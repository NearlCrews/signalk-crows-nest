/**
 * Output registry.
 *
 * Holds the registered `OutputModule`s, exposes their config-schema fragments,
 * and starts the enabled ones for a plugin start. A failing output start is
 * isolated and logged so one broken output cannot stop the others, mirroring
 * how the legacy entrypoint isolated the position monitor.
 */

import type { OutputContext, OutputHandle, OutputModule } from './output.js'

/**
 * The result of starting the enabled outputs. `handles` and `startedIds` are
 * aligned and in registration order, and both exclude any output whose
 * `start()` threw and was isolated, so a caller can log exactly the outputs
 * that actually started. `failedIds` carries the enabled outputs whose
 * `start()` threw, so a caller can surface them without re-deriving the set.
 */
interface StartedOutputs {
  /** Handles for the outputs that started. */
  handles: OutputHandle[]
  /** Ids of the outputs that started. */
  startedIds: string[]
  /** Ids of the enabled outputs whose `start()` threw and was isolated. */
  failedIds: string[]
}

/** Public surface of the output registry. */
export interface OutputRegistry {
  /** The registered output modules, in registration order. */
  readonly modules: readonly OutputModule[]
  /** Each module's config-schema fragment, in registration order. */
  configSchemaFragments: () => Array<Record<string, unknown>>
  /**
   * Start every enabled output. A start that throws is logged through
   * `context.app.error` and skipped; the remaining outputs still start. The
   * result reports the outputs that started and the enabled ones that threw.
   */
  startEnabled: (context: OutputContext) => StartedOutputs
}

/** Create an output registry over a fixed set of modules. */
export function createOutputRegistry (modules: readonly OutputModule[]): OutputRegistry {
  return {
    modules,
    configSchemaFragments: () => modules.map((module) => module.configSchema),
    startEnabled: (context: OutputContext): StartedOutputs => {
      const handles: OutputHandle[] = []
      const startedIds: string[] = []
      const failedIds: string[] = []
      for (const module of modules) {
        if (!module.isEnabled(context.config)) {
          continue
        }
        try {
          handles.push(module.start(context))
          startedIds.push(module.id)
        } catch (error) {
          failedIds.push(module.id)
          context.app.error(`Cannot start output ${module.id}: ${String(error)}`)
        }
      }
      return { handles, startedIds, failedIds }
    }
  }
}
