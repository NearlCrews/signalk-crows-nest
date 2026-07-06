/**
 * SignalK plugin entrypoint.
 *
 * Registers the input and output modules and hands them to the plugin factory.
 * Adding a POI data source or a POI consumer means implementing the module
 * (see `src/inputs/poi-source.ts` and `src/outputs/output.ts`) and adding it
 * to the relevant array below. All wiring lives in `src/plugin/plugin.ts`.
 */

import type { Plugin, ServerAPI } from '@signalk/server-api'
import { createInputRegistry } from './inputs/input-registry.js'
import { createOutputRegistry } from './outputs/output-registry.js'
import { createPlugin } from './plugin/plugin.js'
import { activeCaptainInput } from './inputs/active-captain/active-captain-input.js'
import { openSeaMapInput } from './inputs/openseamap/openseamap-input.js'
import { uscgLightListInput } from './inputs/uscg-light-list/uscg-light-list-input.js'
import { noaaEncInput } from './inputs/noaa-enc/noaa-enc-input.js'
import { noaaCoopsInput } from './inputs/noaa-coops/noaa-coops-input.js'
import { uscgLnmInput } from './inputs/uscg-lnm/uscg-lnm-input.js'
import { wpiInput } from './inputs/wpi/wpi-input.js'
import { usaceInput } from './inputs/usace/usace-input.js'
import { notesResourceOutput } from './outputs/notes-resource/notes-resource-output.js'
import { proximityAlarmOutput } from './outputs/proximity-alarm/proximity-alarm-output.js'
import { routeHazardOutput } from './outputs/route-hazard/route-hazard-output.js'
import { bridgeAirDraftOutput } from './outputs/bridge-air-draft/bridge-air-draft-output.js'

export = function (app: ServerAPI): Plugin {
  const inputs = createInputRegistry([
    activeCaptainInput,
    openSeaMapInput,
    uscgLightListInput,
    noaaEncInput,
    noaaCoopsInput,
    uscgLnmInput,
    wpiInput,
    usaceInput
  ])
  const outputs = createOutputRegistry([
    notesResourceOutput,
    proximityAlarmOutput,
    routeHazardOutput,
    bridgeAirDraftOutput
  ])
  return createPlugin(app, inputs, outputs)
}
