/**
 * Plain-English HTML renderer for one World Port Index port.
 *
 * Turns the Pub 150 coded attributes into a friendly popup: the harbor
 * classification, entrance restrictions, charted depths, the largest vessel
 * the port accommodates, pilotage and tug services, repairs, and supplies.
 * Every field is skipped when absent (a blank, the `U` unknown sentinel, or a
 * null) so an under-recorded port renders a short popup rather than a wall of
 * "unknown" lines.
 *
 * The metric depth and vessel-size values are formatted at the display edge
 * with the shared meter formatter; the wire is already metric, so there is no
 * unit conversion here. The mapping helpers are shared with the section
 * builder so the HTML and the structured detail cannot drift.
 */

import { escapeHtml, labeledMeters, labeledParagraph } from '../../shared/html-escape.js'
import { presentString } from '../../shared/strings.js'
import {
  availableSupplies,
  drydockLabel,
  entranceRestrictions,
  harborSizeLabel,
  harborTypeLabel,
  harborUseLabel,
  meterValue,
  portDisplayName,
  repairsLabel,
  shelterLabel,
  wpiFlag
} from './wpi-mapping.js'
import type { WpiPort } from './wpi-types.js'

/** Append a labeled paragraph when the value is present. */
function pushLabeled (blocks: string[], label: string, value: string | undefined): void {
  if (value !== undefined) blocks.push(labeledParagraph(label, value))
}

/** Append a labeled metric line (`<label>: <meters> m.`) when the value parses. */
function pushMeters (blocks: string[], label: string, raw: unknown): void {
  const meters = meterValue(raw)
  if (meters !== undefined) blocks.push(labeledMeters(label, meters))
}

/** Resolve the pilotage phrase from the compulsory and advisable flags. */
function pilotagePhrase (port: WpiPort): string | undefined {
  const compulsory = wpiFlag(port.ptCompulsory)
  const advisable = wpiFlag(port.ptAdvisable)
  if (compulsory === true) return 'Compulsory'
  if (advisable === true) return 'Advisable'
  if (compulsory === false) return 'Not compulsory'
  return undefined
}

/** Render the popup HTML for one port. */
export function renderWpiDetail (port: WpiPort): string {
  const blocks: string[] = [`<h4>${escapeHtml(portDisplayName(port))}</h4>`]

  pushLabeled(blocks, 'Harbor size', harborSizeLabel(port))
  pushLabeled(blocks, 'Harbor type', harborTypeLabel(port))
  pushLabeled(blocks, 'Shelter', shelterLabel(port))
  pushLabeled(blocks, 'Harbor use', harborUseLabel(port))

  const restrictions = entranceRestrictions(port)
  if (restrictions.length > 0) {
    pushLabeled(blocks, 'Entrance restrictions', restrictions.join(', '))
  }
  const overhead = wpiFlag(port.overheadLimits)
  if (overhead !== undefined) {
    pushLabeled(blocks, 'Overhead limits', overhead ? 'Yes' : 'No')
  }

  pushMeters(blocks, 'Channel depth', port.chDepth)
  pushMeters(blocks, 'Anchorage depth', port.anDepth)
  pushMeters(blocks, 'Cargo pier depth', port.cpDepth)
  pushMeters(blocks, 'Oil terminal depth', port.otDepth)
  pushMeters(blocks, 'Tidal range', port.tide)

  pushMeters(blocks, 'Max vessel length', port.maxVesselLength)
  pushMeters(blocks, 'Max vessel beam', port.maxVesselBeam)
  pushMeters(blocks, 'Max vessel draft', port.maxVesselDraft)

  pushLabeled(blocks, 'Pilotage', pilotagePhrase(port))
  if (wpiFlag(port.tugsAssist) === true) {
    pushLabeled(blocks, 'Tugs', 'Assistance available')
  } else if (wpiFlag(port.tugsSalvage) === true) {
    pushLabeled(blocks, 'Tugs', 'Salvage only')
  }
  pushLabeled(blocks, 'Repairs', repairsLabel(port))
  pushLabeled(blocks, 'Drydock', drydockLabel(port))
  if (wpiFlag(port.medFacilities) === true) {
    pushLabeled(blocks, 'Medical facilities', 'Yes')
  }
  if (wpiFlag(port.qtPratique) === true) {
    pushLabeled(blocks, 'Quarantine', 'Pratique required')
  }

  const supplies = availableSupplies(port)
  if (supplies.length > 0) {
    pushLabeled(blocks, 'Supplies', supplies.join(', '))
  }

  const publication = presentString(port.publicationNumber)
  if (publication !== undefined) {
    pushLabeled(blocks, 'Publication', publication)
  }
  const chart = presentString(port.chartNumber)
  if (chart !== undefined) {
    pushLabeled(blocks, 'Chart', chart)
  }
  const navArea = presentString(port.navArea)
  if (navArea !== undefined) {
    pushLabeled(blocks, 'NAVAREA', navArea)
  }

  return blocks.join('')
}
