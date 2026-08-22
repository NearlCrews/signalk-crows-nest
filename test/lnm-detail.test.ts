/**
 * Unit tests for the USCG Local Notice to Mariners HTML detail renderer.
 *
 * The renderer and the normalized-section builder are written to mirror each
 * other, so a field one shows and the other hides is a defect. These tests pin
 * the effective-date lines, where an ongoing notice routinely carries a begin
 * date with no end date yet.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { renderLnmDetail } from '../src/inputs/uscg-lnm/lnm-detail.js'
import { buildLnmSections } from '../src/inputs/uscg-lnm/lnm-sections.js'
import { USCG_LNM_SOURCE_ID } from '../src/shared/source-ids.js'
import type { LnmNoticeRecord } from '../src/inputs/uscg-lnm/lnm-types.js'

function notice (dates: { beginDate?: string, endDate?: string }): LnmNoticeRecord {
  const record: LnmNoticeRecord = {
    kind: 'notice',
    id: 'haznav_1',
    layer: 'haznav',
    position: { latitude: 27.5, longitude: -82.6 },
    name: 'Shoaling reported',
    poiType: 'Hazard',
    skIcon: 'hazard',
    source: USCG_LNM_SOURCE_ID,
    description: 'Shoaling reported in the channel.'
  }
  if (dates.beginDate !== undefined) record.beginDate = dates.beginDate
  if (dates.endDate !== undefined) record.endDate = dates.endDate
  return record
}

/** Labels the section builder emits, so the two renderers can be compared. */
function sectionLabels (record: LnmNoticeRecord): string[] {
  return buildLnmSections(record).flatMap((section) => section.items.map((item) => item.label))
}

test('a notice with both dates renders one combined effective range', () => {
  const html = renderLnmDetail(notice({
    beginDate: '2026-08-01T00:00:00Z',
    endDate: '2026-09-01T00:00:00Z'
  }))
  assert.match(html, /Effective:<\/strong> 2026-08-01 to 2026-09-01/)
})

test('an open-ended notice still renders its begin date', () => {
  // The regression this locks out: requiring both dates dropped the only date
  // an ongoing hazard notice carries, while the structured sections kept it.
  const record = notice({ beginDate: '2026-08-01T00:00:00Z' })
  assert.match(renderLnmDetail(record), /Effective from:<\/strong> 2026-08-01/)
  assert.ok(sectionLabels(record).includes('Effective from'))
})

test('a notice with only an end date renders that end date', () => {
  const record = notice({ endDate: '2026-09-01T00:00:00Z' })
  assert.match(renderLnmDetail(record), /Effective to:<\/strong> 2026-09-01/)
  assert.ok(sectionLabels(record).includes('Effective to'))
})

test('a notice with no dates renders no effective line at all', () => {
  const record = notice({})
  assert.doesNotMatch(renderLnmDetail(record), /Effective/)
  assert.ok(!sectionLabels(record).some((label) => label.startsWith('Effective')))
})
