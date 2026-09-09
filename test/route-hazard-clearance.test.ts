/**
 * Route-hazard bridge-clearance upgrade.
 *
 * When the bridge air-draft check is enabled, a too-low bridge in the route
 * corridor gets a clearance-specific `warn` message; a bridge that fits, a
 * bridge whose clearance is unknown, and a tick with no known air draft all
 * keep today's generic route message. These tests drive the seam the
 * route-hazard output uses: `resolveTooLowBridges` builds the verdict map from
 * the tick's clearance, air draft, and margin, and `createRouteHazardAlarms`
 * renders the message from it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouteHazardAlarms, type RouteListScan } from '../src/outputs/route-hazard/route-hazard-alarms.js'
import { resolveTooLowBridges } from '../src/outputs/route-hazard/route-hazard-output.js'
import { createBridgeClearanceResolver } from '../src/outputs/bridge-air-draft/bridge-clearance-resolver.js'
import type { CorridorPoi, PoiSummary } from '../src/shared/types.js'
import { createCapturingApp } from './helpers.js'

/**
 * The scan record for a tick whose list carried nothing. These tests drive the
 * message-rendering seam, where the tick's summaries play no part: the verdict
 * map `resolveTooLowBridges` builds is what decides the message.
 */
const NO_LIST: RouteListScan = { pois: [], summaries: new Map(), listFetchedAt: 1_000_000 }

/** A corridor bridge flagged by the scan, with no clearance of its own. */
function corridorBridge (id: string, name: string, alongTrackDistanceMeters = 1200): CorridorPoi {
  return {
    id,
    type: 'Bridge',
    name,
    position: { latitude: 0, longitude: 0 },
    alongTrackDistanceMeters,
    crossTrackDistanceMeters: 0
  }
}

/**
 * An OpenSeaMap bridge summary. OpenSeaMap carries its clearance on the summary,
 * so the resolver returns it synchronously without a detail fetch; omitting the
 * clearance leaves it unknown.
 */
function bridgeSummary (id: string, clearanceMeters?: number): PoiSummary {
  return {
    id,
    type: 'Bridge',
    position: { latitude: 0, longitude: 0 },
    name: `Bridge ${id}`,
    source: 'openseamap',
    url: 'https://www.openstreetmap.org/',
    attribution: 'Map data from OpenStreetMap contributors',
    skIcon: 'bridge',
    verticalClearanceMeters: clearanceMeters
  }
}

/** The id-to-summary index `RouteHazardAlarms.completeList` hands the output. */
function indexById (summaries: PoiSummary[]): ReadonlyMap<string, PoiSummary> {
  return new Map(summaries.map((summary) => [summary.id, summary]))
}

/**
 * A resolver for the OpenSeaMap fixtures. Every summary carries (or lacks) its
 * own clearance, so the resolver answers synchronously and never reaches
 * `getDetails`; a rejecting `getDetails` proves no detail fetch is attempted.
 */
function makeResolver () {
  return createBridgeClearanceResolver({
    getDetails: () => Promise.reject(new Error('no detail fetch expected for OpenSeaMap bridges')),
    debug: () => {}
  })
}

test('a too-low corridor bridge gets a clearance-specific warn message', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const corridor = [corridorBridge('b1', 'Low swing bridge')]
  const tooLow = resolveTooLowBridges({
    corridorPois: corridor,
    summaries: indexById([bridgeSummary('b1', 4)]),
    resolver: makeResolver(),
    airDraftMeters: 5,
    marginMeters: 1
  })

  assert.equal(tooLow.size, 1, 'the too-low bridge is recorded')
  alarms.evaluate(NO_LIST, corridor, tooLow)

  assert.equal(captured.length, 1)
  assert.equal(captured[0].value.state, 'warn', 'the clearance upgrade stays a warn')
  const { message } = captured[0].value
  assert.ok(message.includes('on the route ahead'), 'keeps the base route message')
  assert.ok(message.includes('clearance 4 m'), 'names the bridge clearance')
  assert.ok(message.includes('air draft 5 m'), 'names the vessel air draft')
  assert.ok(message.includes('(+1 m margin)'), 'names the safety margin')
})

test('a fitting corridor bridge keeps the generic message', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const corridor = [corridorBridge('b1', 'Tall bridge')]
  const tooLow = resolveTooLowBridges({
    corridorPois: corridor,
    summaries: indexById([bridgeSummary('b1', 20)]),
    resolver: makeResolver(),
    airDraftMeters: 5,
    marginMeters: 1
  })

  assert.equal(tooLow.size, 0, 'a bridge that clears is not recorded')
  alarms.evaluate(NO_LIST, corridor, tooLow)
  assert.ok(captured[0].value.message.includes('on the route ahead'))
  assert.ok(!captured[0].value.message.includes('clearance'), 'no clearance clause on a fitting bridge')
})

test('a corridor bridge with an unknown clearance keeps the generic message', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const corridor = [corridorBridge('b1', 'Unknown bridge')]
  const tooLow = resolveTooLowBridges({
    corridorPois: corridor,
    summaries: indexById([bridgeSummary('b1')]),
    resolver: makeResolver(),
    airDraftMeters: 5,
    marginMeters: 1
  })

  assert.equal(tooLow.size, 0, 'an unknown clearance produces no verdict')
  alarms.evaluate(NO_LIST, corridor, tooLow)
  assert.ok(!captured[0].value.message.includes('clearance'))
})

test('an unknown air draft keeps the generic message even for a low bridge', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const corridor = [corridorBridge('b1', 'Low bridge')]
  const tooLow = resolveTooLowBridges({
    corridorPois: corridor,
    summaries: indexById([bridgeSummary('b1', 4)]),
    resolver: makeResolver(),
    airDraftMeters: null,
    marginMeters: 1
  })

  assert.equal(tooLow.size, 0, 'no air draft means no comparison and no detail fetch')
  alarms.evaluate(NO_LIST, corridor, tooLow)
  assert.ok(!captured[0].value.message.includes('clearance'))
})

test('a corridor bridge with no matching summary keeps the generic message', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const corridor = [corridorBridge('b1', 'Orphan bridge')]
  // The bridge's summary is absent from the tick result, so its clearance
  // cannot be resolved by id.
  const tooLow = resolveTooLowBridges({
    corridorPois: corridor,
    summaries: indexById([]),
    resolver: makeResolver(),
    airDraftMeters: 5,
    marginMeters: 1
  })

  assert.equal(tooLow.size, 0)
  alarms.evaluate(NO_LIST, corridor, tooLow)
  assert.ok(!captured[0].value.message.includes('clearance'))
})

test('a non-bridge corridor point is never upgraded', () => {
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const hazard: CorridorPoi = {
    id: 'h1',
    type: 'Hazard',
    name: 'Submerged rock',
    position: { latitude: 0, longitude: 0 },
    alongTrackDistanceMeters: 800,
    crossTrackDistanceMeters: 0
  }
  const tooLow = resolveTooLowBridges({
    corridorPois: [hazard],
    summaries: indexById([{ ...bridgeSummary('h1', 1), type: 'Hazard' }]),
    resolver: makeResolver(),
    airDraftMeters: 5,
    marginMeters: 1
  })

  assert.equal(tooLow.size, 0, 'only Bridge corridor points are tested')
  alarms.evaluate(NO_LIST, [hazard], tooLow)
  assert.ok(!captured[0].value.message.includes('clearance'))
})

test('a corridor bridge held by retention keeps its clearance upgrade', () => {
  // `completeList` indexes the completed list, so the index it hands the
  // clearance lookup covers a bridge a partial result omitted and retention put
  // back. Indexing the tick's raw list instead would drop that bridge's verdict
  // and quietly downgrade a too-low bridge to the generic message.
  const { app, captured } = createCapturingApp()
  const alarms = createRouteHazardAlarms(app)
  const corridor = [corridorBridge('b1', 'Low swing bridge')]
  const resolver = makeResolver()

  const first = alarms.completeList([bridgeSummary('b1', 4)], 1_000_000)
  alarms.evaluate(first, corridor, resolveTooLowBridges({
    corridorPois: corridor,
    summaries: first.summaries,
    resolver,
    airDraftMeters: 5,
    marginMeters: 1
  }))
  assert.ok(captured[0].value.message.includes('clearance 4 m'))

  // The bridge's source times out, so the list omits it and retention holds it.
  const held = alarms.completeList([], 1_060_000)
  assert.deepEqual(held.pois.map((poi) => poi.id), ['b1'], 'retention put the bridge back')

  const tooLow = resolveTooLowBridges({
    corridorPois: corridor,
    summaries: held.summaries,
    resolver,
    airDraftMeters: 5,
    marginMeters: 1
  })

  assert.equal(tooLow.size, 1, 'the held bridge is still resolvable by id')
  alarms.evaluate(held, corridor, tooLow)
  assert.equal(captured.length, 1, 'the message is unchanged, so no second delta')
})
