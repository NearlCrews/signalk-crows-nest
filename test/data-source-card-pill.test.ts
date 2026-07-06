/**
 * Tests for the per-source status pill's variant + content helpers.
 *
 * The pill is the at-a-glance "is this source healthy" indicator on each
 * data-source card. A bug that flips ok and error, or shows "idle" after
 * a successful list-fetch, would ship silently because nothing else
 * tests the three states. These tests pin the classification and the
 * visible-text/tooltip pairs.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { pillContent, pillVariant } from '../src/panel/source-status-pill.js'
import type { SourceStatus } from '../src/status/status-types.js'

function status (overrides: Partial<SourceStatus> = {}): SourceStatus {
  return {
    source: 'activecaptain',
    name: 'ActiveCaptain',
    apiReachable: null,
    lastListFetch: null,
    lastSkip: null,
    ...overrides
  }
}

test('pillVariant returns "idle" when no list fetch has resolved yet', () => {
  assert.equal(pillVariant(status({ apiReachable: null, lastListFetch: null })), 'idle')
  assert.equal(pillVariant(status({ apiReachable: true, lastListFetch: null })), 'idle')
})

test('pillVariant returns "ok" when the last list fetch succeeded', () => {
  assert.equal(
    pillVariant(status({
      apiReachable: true,
      lastListFetch: { at: '2026-05-23T08:15:00Z', poiCount: 42 }
    })),
    'ok'
  )
})

test('pillVariant returns "error" when the most recent attempt failed', () => {
  assert.equal(pillVariant(status({ apiReachable: false, lastListFetch: null })), 'error')
  // The error state outranks idle even if a stale prior fetch is still on file.
  assert.equal(
    pillVariant(status({
      apiReachable: false,
      lastListFetch: { at: '2026-05-23T08:15:00Z', poiCount: 42 }
    })),
    'error'
  )
})

test('pillContent for the idle variant shows the ellipsis glyph and an awaiting-first-request tooltip', () => {
  const content = pillContent(status({ name: 'OpenSeaMap' }), 'idle')
  assert.equal(content.glyph, '…')
  assert.equal(content.label, 'idle')
  assert.equal(content.title, 'OpenSeaMap: awaiting first request')
})

test('pillVariant returns "idle" when a source is currently skipping, even with a stale prior fetch', () => {
  // A US-only source offshore records a skip; its previous fetch is stale but
  // the source is deliberately quiet, so it must read as idle, not ok.
  assert.equal(
    pillVariant(status({
      apiReachable: true,
      lastListFetch: { at: '2026-05-23T08:15:00Z', poiCount: 42 },
      lastSkip: { reason: 'outside US waters', transient: false }
    })),
    'idle'
  )
})

test('pillVariant returns "waiting" for a transient deferral, even with a stale prior fetch', () => {
  // A list request that outran the aggregate's per-source timeout is a
  // deferral, not a deliberate gate: the fetch is still running and the next
  // refresh serves it, so the pill reads waiting rather than idle.
  assert.equal(
    pillVariant(status({
      apiReachable: true,
      lastListFetch: { at: '2026-05-23T08:15:00Z', poiCount: 42 },
      lastSkip: { reason: 'list request exceeded 5s; result will appear on next refresh', transient: true }
    })),
    'waiting'
  )
})

test('pillContent for the waiting variant keeps the label calm and puts the reason in the tooltip', () => {
  const content = pillContent(
    status({
      name: 'OpenSeaMap',
      lastSkip: { reason: 'list request exceeded 5s; result will appear on next refresh', transient: true }
    }),
    'waiting'
  )
  assert.equal(content.glyph, '…')
  assert.equal(content.label, 'waiting')
  assert.equal(content.title, 'OpenSeaMap: list request exceeded 5s; result will appear on next refresh')
})

test('pillVariant keeps "error" over a skip reason when the most recent attempt failed', () => {
  assert.equal(
    pillVariant(status({
      apiReachable: false,
      lastSkip: { reason: 'outside US waters', transient: false }
    })),
    'error'
  )
})

test('pillContent for the idle variant surfaces the skip reason as the label and tooltip', () => {
  const content = pillContent(
    status({ name: 'NOAA ENC', lastSkip: { reason: 'outside US waters', transient: false } }),
    'idle'
  )
  assert.equal(content.glyph, '…')
  assert.equal(content.label, 'Idle: outside US waters')
  assert.equal(content.title, 'NOAA ENC: outside US waters')
})

test('pillContent for the error variant shows the bang glyph and the failure tooltip', () => {
  const content = pillContent(status({ name: 'NOAA ENC' }), 'error')
  assert.equal(content.glyph, '!')
  assert.equal(content.label, 'error')
  assert.equal(content.title, 'NOAA ENC: last request failed')
})

test('pillContent for the ok variant shows the check glyph, a short "ok" label, and a tooltip with the last-fetch count + relative time', () => {
  const content = pillContent(
    status({
      name: 'USCG Light List',
      apiReachable: true,
      lastListFetch: { at: new Date(Date.now() - 5 * 60_000).toISOString(), poiCount: 17 }
    }),
    'ok'
  )
  assert.equal(content.glyph, '✓')
  assert.equal(content.label, 'ok')
  assert.match(content.title, /^USCG Light List: 17 POIs in last fetch, /)
  assert.match(content.title, /ago$/)
})

test('pillContent for the ok variant keeps the "ok" label when the last fetch returned zero POIs', () => {
  // The count from a single bbox query is meaningless until you pan
  // the chart; reporting "✓ 0 POI" on the pill would read as confusing
  // negative ("nothing selected?") when in fact the source is healthy
  // and the chart simply has not zoomed to a position with markers.
  // The count moves into the title tooltip.
  const content = pillContent(
    status({
      name: 'Garmin ActiveCaptain',
      apiReachable: true,
      lastListFetch: { at: new Date().toISOString(), poiCount: 0 }
    }),
    'ok'
  )
  assert.equal(content.glyph, '✓')
  assert.equal(content.label, 'ok')
  assert.match(content.title, /^Garmin ActiveCaptain: 0 POIs in last fetch, /)
})

test('pillContent singularizes "1 POI" in the title tooltip', () => {
  const content = pillContent(
    status({
      name: 'OpenSeaMap',
      apiReachable: true,
      lastListFetch: { at: new Date().toISOString(), poiCount: 1 }
    }),
    'ok'
  )
  assert.match(content.title, /^OpenSeaMap: 1 POI in last fetch, /)
})
