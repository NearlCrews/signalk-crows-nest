/**
 * Plain-English HTML renderer for a NOAA CO-OPS station.
 *
 * The popup shows the station name, its id, its type, the state and time zone
 * when the wire carries them, and a link to the canonical tidesandcurrents.noaa.gov
 * station page. The link is the only bespoke line: an anchor cannot go through
 * `labeledParagraph` (which escapes its value into text), so it is built here
 * with the href escaped and the scheme already vetted by `stationPageUrl`.
 */

import type { CoopsStationRecord } from './noaa-coops-types.js'
import { stationPageUrl, stationTypeLabel } from './coops-mapping.js'
import { escapeHtml, labeledParagraph } from '../../shared/html-escape.js'

/** Render a CO-OPS station as a Freeboard-ready HTML description. */
export function renderCoopsDetail (record: CoopsStationRecord): string {
  const blocks: string[] = []
  blocks.push(`<h4>${escapeHtml(record.name)}</h4>`)
  blocks.push(labeledParagraph('Station ID', record.id))
  blocks.push(labeledParagraph('Type', stationTypeLabel(record.stationType)))
  if (record.state !== undefined) {
    blocks.push(labeledParagraph('State', record.state))
  }
  if (record.timezone !== undefined) {
    blocks.push(labeledParagraph('Time zone', record.timezone))
  }
  const page = stationPageUrl(record)
  if (page !== undefined) {
    blocks.push(
      `<p><strong>Station page:</strong> <a href="${escapeHtml(page)}" ` +
      'target="_blank" rel="noopener">tidesandcurrents.noaa.gov</a>.</p>'
    )
  }
  blocks.push(
    '<p><strong>Source:</strong> NOAA CO-OPS (Center for Operational ' +
    'Oceanographic Products and Services), public domain.</p>'
  )
  return blocks.join('')
}
