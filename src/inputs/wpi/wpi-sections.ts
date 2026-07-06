/**
 * Normalized-section builder for one World Port Index port.
 *
 * Emits the source-agnostic {@link NormalizedSection}[] a structured
 * chartplotter renders, carried on the note's `properties.crowsNest.sections`
 * alongside the HTML description. It surfaces the same Pub 150 attributes the
 * HTML renderer does, through the same `wpi-mapping.ts` helpers, so the two
 * cannot drift, but as structured items: depths and vessel sizes are `measure`
 * items in meters, the coded classifications are `text`, and the yes/no
 * facility flags are `flag`. Every field is skipped when absent and an empty
 * section is dropped.
 */

import { meterMeasureItem, pushSection, textItem } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'
import { presentString } from '../../shared/strings.js'
import {
  availableSupplies,
  drydockLabel,
  entranceRestrictions,
  harborSizeLabel,
  harborTypeLabel,
  harborUseLabel,
  meterValue,
  repairsLabel,
  shelterLabel,
  wpiFlag
} from './wpi-mapping.js'
import type { WpiPort } from './wpi-types.js'

/** Push a text item when the value is present. */
function pushText (items: NormalizedItem[], label: string, value: string | undefined): void {
  if (value !== undefined) items.push(textItem(label, value))
}

/** Push a metric measure item (in meters) when the value parses. */
function pushMeters (items: NormalizedItem[], label: string, raw: unknown): void {
  const meters = meterValue(raw)
  if (meters !== undefined) items.push(meterMeasureItem(label, meters))
}

/** Build the normalized detail sections for one port. */
export function buildWpiSections (port: WpiPort): NormalizedSection[] {
  const sections: NormalizedSection[] = []

  const harbor: NormalizedItem[] = []
  pushText(harbor, 'Size', harborSizeLabel(port))
  pushText(harbor, 'Type', harborTypeLabel(port))
  pushText(harbor, 'Shelter', shelterLabel(port))
  pushText(harbor, 'Use', harborUseLabel(port))
  pushSection(sections, 'harbor', 'Harbor', harbor)

  const restrictions: NormalizedItem[] = []
  const entrance = entranceRestrictions(port)
  if (entrance.length > 0) {
    restrictions.push(textItem('Entrance restrictions', entrance.join(', ')))
  }
  const overhead = wpiFlag(port.overheadLimits)
  if (overhead !== undefined) {
    restrictions.push({ label: 'Overhead limits', value: overhead, kind: 'flag' })
  }
  pushSection(sections, 'restrictions', 'Restrictions', restrictions)

  const depths: NormalizedItem[] = []
  pushMeters(depths, 'Channel depth', port.chDepth)
  pushMeters(depths, 'Anchorage depth', port.anDepth)
  pushMeters(depths, 'Cargo pier depth', port.cpDepth)
  pushMeters(depths, 'Oil terminal depth', port.otDepth)
  pushMeters(depths, 'Tidal range', port.tide)
  pushSection(sections, 'depths', 'Depths', depths)

  const vessel: NormalizedItem[] = []
  pushMeters(vessel, 'Length', port.maxVesselLength)
  pushMeters(vessel, 'Beam', port.maxVesselBeam)
  pushMeters(vessel, 'Draft', port.maxVesselDraft)
  pushSection(sections, 'vessel', 'Maximum vessel', vessel)

  const services: NormalizedItem[] = []
  const compulsory = wpiFlag(port.ptCompulsory)
  if (compulsory !== undefined) {
    services.push({ label: 'Pilotage compulsory', value: compulsory, kind: 'flag' })
  } else if (wpiFlag(port.ptAdvisable) === true) {
    services.push(textItem('Pilotage', 'Advisable'))
  }
  if (wpiFlag(port.tugsAssist) === true) {
    services.push(textItem('Tugs', 'Assistance available'))
  } else if (wpiFlag(port.tugsSalvage) === true) {
    services.push(textItem('Tugs', 'Salvage only'))
  }
  pushText(services, 'Repairs', repairsLabel(port))
  pushText(services, 'Drydock', drydockLabel(port))
  if (wpiFlag(port.medFacilities) === true) {
    services.push({ label: 'Medical facilities', value: true, kind: 'flag' })
  }
  if (wpiFlag(port.qtPratique) === true) {
    services.push({ label: 'Quarantine pratique', value: true, kind: 'flag' })
  }
  pushSection(sections, 'services', 'Services', services)

  const supplies = availableSupplies(port)
  if (supplies.length > 0) {
    pushSection(sections, 'supplies', 'Supplies', [
      textItem('Available', supplies.join(', '))
    ])
  }

  const source: NormalizedItem[] = []
  pushText(source, 'Publication', presentString(port.publicationNumber))
  pushText(source, 'Chart', presentString(port.chartNumber))
  pushText(source, 'NAVAREA', presentString(port.navArea))
  pushSection(sections, 'source', 'Source', source)

  return sections
}
