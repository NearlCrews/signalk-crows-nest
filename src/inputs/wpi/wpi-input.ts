/**
 * NGA World Port Index input module.
 *
 * Opt-in: defaults off. Owns the config-schema fragment (enable toggle, dedupe
 * toggle and radius, and the refresh interval) and the factory that wires the
 * NGA MSI client and the PoiSource together. The World Port Index is
 * worldwide, so there is no vessel-position gate.
 */

import { createWpiSource } from './wpi-source.js'
import { createWpiClient } from './wpi-client.js'
import { dedupeRadiusSchema, dedupeToggleSchema } from '../dedupe-pois.js'
import type { InputContext, InputModule } from '../poi-source.js'
import { clampRefreshHours, refreshHoursSchema } from '../../shared/refresh-hours.js'
import { cappedDedupeRadius } from '../../shared/dedupe-radius.js'
import { WPI_SOURCE_ID } from '../../shared/source-ids.js'
import type { PluginConfig } from '../../shared/types.js'

/** The enable, dedupe, and refresh config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  wpiEnabled: {
    type: 'boolean',
    title: 'Import world ports from the NGA World Port Index (worldwide)',
    default: false
  },
  wpiDedupe: dedupeToggleSchema(
    'Merge World Port Index ports that duplicate an ActiveCaptain marker'
  ),
  wpiDedupeRadiusMeters: dedupeRadiusSchema(
    'Merge radius for World Port Index ports, in meters'
  ),
  // The whole worldwide index downloads at once, so the refresh cadence is in
  // hours like the other full-download sources, not the per-viewport seconds
  // the bbox-queryable sources use. NGA publishes the index quarterly, so the
  // daily default is already conservative.
  wpiRefreshHours: refreshHoursSchema(
    'World Port Index background refresh period, in hours'
  )
}

/** The NGA World Port Index input module. */
export const wpiInput: InputModule = {
  id: WPI_SOURCE_ID,
  name: 'NGA World Port Index',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config: PluginConfig) => config.wpiEnabled === true,
  // Dedupe defaults on: an absent toggle still merges World Port Index ports
  // that duplicate an ActiveCaptain marina marker. Only an explicit false
  // turns it off, matching the other non-base inputs.
  isDedupeEnabled: (config: PluginConfig) => config.wpiDedupe !== false,
  // Per-source merge radius surfaced on the WPI card.
  dedupeRadiusMeters: (config: PluginConfig) =>
    cappedDedupeRadius(config.wpiDedupeRadiusMeters),
  createSource: (context: InputContext) => {
    const { config, status, dataDir } = context
    return createWpiSource({
      client: createWpiClient(),
      refreshHours: clampRefreshHours(config.wpiRefreshHours),
      status,
      dataDir
    })
  }
}
