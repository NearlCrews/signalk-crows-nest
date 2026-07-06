/**
 * Normalized-section builder for a NOAA CO-OPS station.
 *
 * Turns the structured {@link CoopsStationRecord} into the source-agnostic
 * {@link NormalizedSection}[] a structured chartplotter renders, carried on the
 * note's `properties.crowsNest.sections` alongside the HTML description. It
 * mirrors the HTML renderer's content (same fields, same station-page link) but
 * emits structured items rather than markup.
 */

import type { CoopsStationRecord } from './noaa-coops-types.js'
import { stationPageUrl, stationTypeLabel } from './coops-mapping.js'
import { pushSection } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'

/** Build the normalized detail sections for a CO-OPS station. */
export function buildCoopsSections (record: CoopsStationRecord): NormalizedSection[] {
  const sections: NormalizedSection[] = []

  const station: NormalizedItem[] = [
    { label: 'Station ID', value: record.id, kind: 'text' },
    { label: 'Type', value: stationTypeLabel(record.stationType), kind: 'text' }
  ]
  if (record.state !== undefined) {
    station.push({ label: 'State', value: record.state, kind: 'text' })
  }
  if (record.timezone !== undefined) {
    station.push({ label: 'Time zone', value: record.timezone, kind: 'text' })
  }
  pushSection(sections, 'station', 'Station', station)

  const page = stationPageUrl(record)
  if (page !== undefined) {
    pushSection(sections, 'links', 'Links', [
      { label: 'Station page', value: page, kind: 'link' }
    ])
  }

  return sections
}
