import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginStatus } from '../src/status/plugin-status.js'

/** The two enabled sources used across the per-source status tests. */
const SOURCES = [
  { source: 'activecaptain', name: 'Garmin ActiveCaptain' },
  { source: 'openseamap', name: 'OpenSeaMap' }
]

test('a fresh recorder reports every source apiReachable null and no list fetch', () => {
  const snapshot = createPluginStatus(SOURCES).snapshot(0)
  assert.equal(snapshot.sources.length, 2)
  for (const source of snapshot.sources) {
    assert.equal(source.apiReachable, null)
    assert.equal(source.lastListFetch, null)
  }
  assert.deepEqual(snapshot.recentErrors, [])
})

test('the snapshot lists one SourceStatus per source, in registration order', () => {
  const snapshot = createPluginStatus(SOURCES).snapshot(0)
  assert.deepEqual(snapshot.sources.map((s) => s.source), ['activecaptain', 'openseamap'])
  assert.equal(snapshot.sources[0].name, 'Garmin ActiveCaptain')
  assert.equal(snapshot.sources[1].name, 'OpenSeaMap')
})

test('recordListFetch sets that source reachable with its last fetch', () => {
  const status = createPluginStatus(SOURCES)
  status.recordListFetch('activecaptain', 5)

  const snapshot = status.snapshot(0)
  const ac = snapshot.sources.find((s) => s.source === 'activecaptain')
  const osm = snapshot.sources.find((s) => s.source === 'openseamap')
  assert.equal(ac?.apiReachable, true)
  assert.equal(ac?.lastListFetch?.poiCount, 5)
  assert.ok(!Number.isNaN(Date.parse(ac?.lastListFetch?.at ?? '')))
  // The other source is untouched.
  assert.equal(osm?.apiReachable, null)
  assert.equal(osm?.lastListFetch, null)
})

test('recordDetailSuccess marks only the named source reachable', () => {
  const status = createPluginStatus(SOURCES)
  status.recordDetailSuccess('openseamap')

  const snapshot = status.snapshot(0)
  assert.equal(snapshot.sources.find((s) => s.source === 'openseamap')?.apiReachable, true)
  assert.equal(snapshot.sources.find((s) => s.source === 'activecaptain')?.apiReachable, null)
})

test('recordError sets that source unreachable and appends to recentErrors', () => {
  const status = createPluginStatus(SOURCES)
  status.recordError('openseamap', 'overpass timeout')

  const snapshot = status.snapshot(0)
  assert.equal(snapshot.sources.find((s) => s.source === 'openseamap')?.apiReachable, false)
  assert.equal(snapshot.sources.find((s) => s.source === 'activecaptain')?.apiReachable, null)
  assert.equal(snapshot.recentErrors.length, 1)
  assert.equal(snapshot.recentErrors[0].message, 'overpass timeout')
  assert.equal(typeof snapshot.recentErrors[0].at, 'string')
})

test('recentErrors is global, newest first, and capped at 5', () => {
  const status = createPluginStatus(SOURCES)
  for (let i = 1; i <= 7; i += 1) {
    status.recordError('activecaptain', `error ${i}`)
  }

  const snapshot = status.snapshot(0)
  assert.equal(snapshot.recentErrors.length, 5)
  // Newest first: errors 7 down to 3 survive, the oldest two are dropped.
  assert.equal(snapshot.recentErrors[0].message, 'error 7')
  assert.equal(snapshot.recentErrors[4].message, 'error 3')
})

test('a later success leaves earlier recorded errors in the list', () => {
  const status = createPluginStatus(SOURCES)
  status.recordError('activecaptain', 'transient failure')
  status.recordListFetch('activecaptain', 3)

  const snapshot = status.snapshot(0)
  assert.equal(snapshot.sources.find((s) => s.source === 'activecaptain')?.apiReachable, true)
  assert.equal(snapshot.recentErrors.length, 1)
  assert.equal(snapshot.recentErrors[0].message, 'transient failure')
})

test('an outcome for an unknown source still lands in recentErrors but creates no row', () => {
  const status = createPluginStatus(SOURCES)
  status.recordError('mystery', 'who is this')
  status.recordListFetch('mystery', 4)

  const snapshot = status.snapshot(0)
  assert.equal(snapshot.recentErrors.length, 1, 'the error reaches the global list')
  assert.equal(snapshot.sources.length, 2, 'no phantom source row is created')
  for (const source of snapshot.sources) {
    assert.equal(source.apiReachable, null, 'no known source row is touched')
  }
})

test('snapshot passes cachedPoiCount through and keeps startedAt stable', () => {
  const status = createPluginStatus(SOURCES)

  const first = status.snapshot(42)
  assert.equal(first.cachedPoiCount, 42)
  assert.equal(typeof first.startedAt, 'string')
  assert.ok(!Number.isNaN(Date.parse(first.startedAt)))

  const second = status.snapshot(0)
  assert.equal(second.cachedPoiCount, 0)
  assert.equal(second.startedAt, first.startedAt)
})

test('snapshot has exactly the StatusSnapshot keys', () => {
  const snapshot = createPluginStatus(SOURCES).snapshot(9)
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'cachedPoiCount', 'recentErrors', 'sources', 'startedAt'
  ])
})

test('snapshot recentErrors is a copy, not the live array', () => {
  const status = createPluginStatus(SOURCES)
  status.recordError('activecaptain', 'first')

  const snapshot = status.snapshot(0)
  status.recordError('activecaptain', 'second')
  // The earlier snapshot must not see errors recorded after it was taken.
  assert.equal(snapshot.recentErrors.length, 1)
})

test('a recorder with no sources still records global errors', () => {
  const status = createPluginStatus([])
  status.recordError('activecaptain', 'before any source is enabled')

  const snapshot = status.snapshot(0)
  assert.deepEqual(snapshot.sources, [])
  assert.equal(snapshot.recentErrors.length, 1)
})

test('wasJustSkipped returns false on a fresh recorder for every source', () => {
  const status = createPluginStatus(SOURCES)
  for (const { source } of SOURCES) {
    assert.equal(status.wasJustSkipped(source), false)
  }
})

test('recordSkipped sets wasJustSkipped to true for that source only', () => {
  const status = createPluginStatus(SOURCES)
  status.recordSkipped('activecaptain', 'outside US waters')
  assert.equal(status.wasJustSkipped('activecaptain'), true)
  assert.equal(status.wasJustSkipped('openseamap'), false)
})

test('recordListFetch clears the wasJustSkipped flag', () => {
  // A normal list fetch after a skip transitions the row back to a real
  // outcome and clears the skip flag so a later empty fetch is recorded
  // as a real "fetched zero POIs" success.
  const status = createPluginStatus(SOURCES)
  status.recordSkipped('activecaptain', 'outside US waters')
  status.recordListFetch('activecaptain', 5)
  assert.equal(status.wasJustSkipped('activecaptain'), false)
})

test('recordError clears the wasJustSkipped flag', () => {
  // An error after a skip is a real failure: the skip flag must not mask
  // the next aggregate-level decision.
  const status = createPluginStatus(SOURCES)
  status.recordSkipped('activecaptain', 'outside US waters')
  status.recordError('activecaptain', 'upstream 500')
  assert.equal(status.wasJustSkipped('activecaptain'), false)
})

test('recordSkipped does not flip apiReachable', () => {
  // A skip is observational, not evidence of upstream health.
  const status = createPluginStatus(SOURCES)
  status.recordListFetch('activecaptain', 10) // previously reachable
  status.recordSkipped('activecaptain', 'outside US waters')
  const snapshot = status.snapshot(0)
  const row = snapshot.sources.find(s => s.source === 'activecaptain')
  assert.equal(row?.apiReachable, true, 'apiReachable carries forward from the previous fetch')
  assert.equal(row?.lastListFetch?.poiCount, 10, 'lastListFetch carries forward unchanged')
})

test('wasJustSkipped returns false for an unknown source', () => {
  const status = createPluginStatus(SOURCES)
  assert.equal(status.wasJustSkipped('not-a-source'), false)
})
