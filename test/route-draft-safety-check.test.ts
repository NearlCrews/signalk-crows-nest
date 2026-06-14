/**
 * Tests for the route-draft "check these legs" orchestrator.
 *
 * `checkLegs` resolves the provider UNION per leg: the US-only NOAA ENC provider
 * and the worldwide OpenSeaMap provider. These tests stub BOTH the ENC side (the
 * client and the charted-area query) and the Overpass side (the Overpass client)
 * so no live HTTP runs, and pin the orchestrator's own behavior: a US leg checked
 * by ENC and OSM together with no duplicate hazard, a foreign leg checked by OSM
 * with the collapsed depth-not-checked note, a US-envelope-overlapping-foreign
 * leg still getting OSM coverage (the silent-gap fix), the cross-provider hazard
 * dedupe preferring ENC, the single collapsed depth note over a multi-leg foreign
 * route, the deadline abort reaching both providers, and the contiguous-run
 * hazard sweep over a US/foreign/US route.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { checkLegs, type LegCheckDeps, type LegCheckParams } from '../src/route-draft/safety-check.js'
import { scanRouteCorridor } from '../src/outputs/route-hazard/route-corridor.js'
import type { ChartedAreas, EncAreaPolygon } from '../src/inputs/noaa-enc/depth-area-query.js'
import type { EncDirectClient, QueryRequest } from '../src/inputs/noaa-enc/enc-direct-client.js'
import type { EncFeature, ScaleBand } from '../src/inputs/noaa-enc/enc-direct-types.js'
import type { OverpassClient, OverpassElement, CoastlineWay } from '../src/inputs/openseamap/overpass-client.js'
import type { Bbox, Position } from '../src/shared/types.js'

// A leg in the New York harbour approach, comfortably inside US waters.
const FROM: Position = { latitude: 40.45, longitude: -74.05 }
const TO: Position = { latitude: 40.55, longitude: -74.05 }

// A leg in the Mediterranean, outside every US-waters envelope: ENC does not
// cover it, OSM does.
const MED_FROM: Position = { latitude: 43.5, longitude: 7.0 }
const MED_TO: Position = { latitude: 43.6, longitude: 7.1 }

/** A square polygon centered on the NY leg, big enough that the leg crosses it. */
const COVERING_SQUARE: number[][][] = [[
  [-74.1, 40.4],
  [-74.0, 40.4],
  [-74.0, 40.6],
  [-74.1, 40.6],
  [-74.1, 40.4]
]]

function depthArea (drval1: number, rings = COVERING_SQUARE): EncAreaPolygon {
  return {
    rings,
    depthRange: { shallowMeters: drval1, deepMeters: drval1 + 5 },
    properties: {}
  }
}

/** A wreck EncFeature at the given [lon, lat]. */
function encWreck (objectId: number, lon: number, lat: number): EncFeature {
  return {
    type: 'Feature',
    id: objectId,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { OBJECTID: objectId, CATWRK: 'dangerous wreck', VALSOU: 3.2, QUASOU: '6' }
  }
}

/** An OSM wreck seamark node at the given lat/lon. */
function osmWreck (id: number, lat: number, lon: number): OverpassElement {
  return {
    type: 'node',
    id,
    tags: { 'seamark:type': 'wreck' },
    position: { latitude: lat, longitude: lon }
  }
}

interface EncStub {
  client: EncDirectClient
  /** Charted-area query, recording the bands it was called with. */
  queryChartedAreas: LegCheckDeps['queryChartedAreas']
  /** Every queryLayer call's bbox (one per hazard sweep band x layer). */
  hazardBboxes: Bbox[]
  /** Whether the charted-area query saw an aborted signal. */
  sawChartedAbort: () => boolean
}

/**
 * An ENC stub. `depthByBand` answers the charted-area query; `wrecks` are served
 * on the wreck point-hazard layer at every band.
 */
function makeEnc (
  depthByBand: (band: ScaleBand) => ChartedAreas,
  wrecks: EncFeature[] = []
): EncStub {
  const hazardBboxes: Bbox[] = []
  let abortSeen = false
  const client: EncDirectClient = {
    queryLayer: async ({ layerKey, bbox, signal }: QueryRequest) => {
      hazardBboxes.push(bbox)
      if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
      return { features: layerKey === 'wreck' ? wrecks : [] }
    },
    queryById: async () => undefined
  }
  return {
    client,
    queryChartedAreas: async (_client, { band, signal }) => {
      if (signal?.aborted === true) {
        abortSeen = true
        throw signal.reason ?? new Error('aborted')
      }
      return depthByBand(band)
    },
    hazardBboxes,
    sawChartedAbort: () => abortSeen
  }
}

interface OverpassStub {
  client: OverpassClient
  /** Whether listCoastlineWays saw an aborted signal. */
  sawCoastlineAbort: () => boolean
  /** How many times the hazard list query ran. */
  hazardCalls: () => number
}

/**
 * An Overpass stub. `coastline` answers listCoastlineWays; `hazards` are served
 * on the point-of-interest list query. close() is a no-op.
 */
function makeOverpass (
  coastline: CoastlineWay[] = [],
  hazards: OverpassElement[] = []
): OverpassStub {
  let abortSeen = false
  let hazardCallCount = 0
  const client: OverpassClient = {
    listCoastlineWays: async (_bbox, signal) => {
      if (signal?.aborted === true) {
        abortSeen = true
        throw signal.reason ?? new Error('aborted')
      }
      return coastline
    },
    listPointsOfInterest: async (_bbox, _regex, signal) => {
      hazardCallCount += 1
      if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
      return hazards
    },
    getById: async () => undefined,
    close: () => {}
  }
  return {
    client,
    sawCoastlineAbort: () => abortSeen,
    hazardCalls: () => hazardCallCount
  }
}

function deps (enc: EncStub, overpass: OverpassStub): LegCheckDeps {
  return {
    client: enc.client,
    queryChartedAreas: enc.queryChartedAreas,
    overpass: overpass.client,
    scanRouteCorridor
  }
}

function params (overrides: Partial<LegCheckParams> = {}): LegCheckParams {
  return {
    waypoints: [FROM, TO],
    draftMeters: 2,
    safetyMarginMeters: 1,
    standoffNm: 0.5,
    corridorHalfWidthMeters: 500,
    bands: ['coastal'],
    ...overrides
  }
}

test('a US leg is checked by ENC and OpenSeaMap together, with no contradictory depth-not-checked note', async () => {
  const enc = makeEnc(() => ({ depthAreas: [depthArea(2.5)], landAreas: [] }))
  const overpass = makeOverpass()
  const result = await checkLegs(deps(enc, overpass), params())
  assert.equal(result.checked, true)
  // ENC owns depth on this leg, so the orchestrator emits no depth-not-checked note.
  assert.equal(result.flags.some((f) => /depth not checked/i.test(f.message)), false)
  // ENC's shallow flag is present.
  assert.ok(result.flags.some((f) => f.kind === 'shallow'), 'ENC checked depth')
})

test('a US leg with the same wreck from ENC and OSM yields one hazard flag, the ENC reading', async () => {
  // Both providers report a wreck at the same charted position and type.
  const lat = 40.5
  const lon = -74.0505
  const enc = makeEnc(
    () => ({ depthAreas: [depthArea(10)], landAreas: [] }),
    [encWreck(9001, lon, lat)]
  )
  const overpass = makeOverpass([], [osmWreck(7001, lat, lon)])
  const result = await checkLegs(deps(enc, overpass), params({ corridorHalfWidthMeters: 800 }))
  const hazards = result.flags.filter((f) => f.kind === 'hazard')
  assert.equal(hazards.length, 1, 'the same wreck from both providers is flagged once')
  // ENC has precedence, so the kept flag carries the ENC message vocabulary.
  assert.match(hazards[0].message, /Charted/)
  assert.match(hazards[0].message, /dangerous wreck/)
  assert.doesNotMatch(hazards[0].message, /OpenStreetMap-charted/)
  // The transient dedupe key never leaks into the returned flag.
  assert.equal('hazardKey' in hazards[0], false, 'hazardKey is stripped from the response')
})

test('a foreign leg is checked by OpenSeaMap and gets the collapsed depth-not-checked note', async () => {
  // ENC does not cover a Mediterranean leg, so its stub is never relied on. OSM
  // provides land (a coastline crossing) and the depth note comes from the
  // orchestrator's capability-keyed not-checked pass.
  const enc = makeEnc(() => ({ depthAreas: [], landAreas: [] }))
  // A coastline way crossing the leg, so OSM raises a land flag.
  const crossing: CoastlineWay = { points: [[7.04, 43.4], [7.04, 43.7]] }
  const overpass = makeOverpass([crossing])
  const result = await checkLegs(deps(enc, overpass), params({ waypoints: [MED_FROM, MED_TO] }))
  assert.equal(result.checked, true, 'OSM ran, so the check ran')
  // ENC was not queried for charted areas on a leg it does not cover.
  assert.equal(enc.hazardBboxes.length, 0, 'ENC issued no hazard query on a foreign-only route')
  // The collapsed depth note, one route-level flag.
  const depthNote = result.flags.find((f) => /depth not checked/i.test(f.message))
  assert.ok(depthNote, 'expected the collapsed depth-not-checked note')
  assert.equal(depthNote!.leg, undefined, 'the collapsed depth note carries no per-leg index')
  assert.match(depthNote!.message, /1 of 1 legs/)
  // OSM owns land, so no land-not-checked note.
  assert.equal(result.flags.some((f) => /land not checked/i.test(f.message) && f.leg === undefined), false)
})

test('a US-envelope leg whose far end is foreign still gets OpenSeaMap coverage (the silent-gap fix)', async () => {
  // Miami to Bimini: both endpoints inside the CONUS box, so ENC covers the leg,
  // but Bimini is foreign water. OSM must still run so the foreign half gets its
  // hazards and land, rather than the leg silently passing on ENC alone.
  const miami: Position = { latitude: 25.77, longitude: -80.13 }
  const bimini: Position = { latitude: 25.74, longitude: -79.30 }
  const enc = makeEnc(() => ({ depthAreas: [depthArea(10)], landAreas: [] }))
  // An OSM wreck on the leg path near the Bimini (foreign) end.
  const overpass = makeOverpass([], [osmWreck(7100, 25.743, -79.383)])
  const result = await checkLegs(
    deps(enc, overpass),
    params({ waypoints: [miami, bimini], corridorHalfWidthMeters: 1500 })
  )
  assert.equal(result.checked, true)
  // ENC ran (it covers the leg), and OSM ran too: the foreign-half wreck is flagged.
  assert.ok(enc.hazardBboxes.length > 0, 'ENC ran on the envelope-overlapping leg')
  assert.ok(overpass.hazardCalls() > 0, 'OSM ran on the envelope-overlapping leg')
  const hazard = result.flags.find((f) => f.kind === 'hazard')
  assert.ok(hazard, 'the foreign-half wreck was caught by OSM')
  assert.match(hazard!.message, /OpenStreetMap-charted wreck/)
})

test('the depth-not-checked note collapses to ONE flag over a multi-leg foreign route', async () => {
  const enc = makeEnc(() => ({ depthAreas: [], landAreas: [] }))
  const overpass = makeOverpass()
  // Three foreign legs (four Mediterranean waypoints): one collapsed note, not three.
  const w0: Position = { latitude: 43.50, longitude: 7.00 }
  const w1: Position = { latitude: 43.55, longitude: 7.10 }
  const w2: Position = { latitude: 43.60, longitude: 7.20 }
  const w3: Position = { latitude: 43.65, longitude: 7.30 }
  const result = await checkLegs(deps(enc, overpass), params({ waypoints: [w0, w1, w2, w3] }))
  const depthNotes = result.flags.filter((f) => /depth not checked/i.test(f.message))
  assert.equal(depthNotes.length, 1, 'one collapsed depth note for the whole foreign route')
  assert.match(depthNotes[0].message, /3 of 3 legs/)
})

test('the deadline abort cancels every in-flight provider, ENC and Overpass alike', async () => {
  const controller = new AbortController()
  controller.abort()
  const enc = makeEnc(() => ({ depthAreas: [depthArea(10)], landAreas: [] }))
  const overpass = makeOverpass()
  const result = await checkLegs(deps(enc, overpass), params({ signal: controller.signal }))
  // The aborted signal reached both providers' in-flight queries.
  assert.equal(enc.sawChartedAbort(), true, 'the deadline signal reached the ENC charted-area query')
  assert.equal(overpass.sawCoastlineAbort(), true, 'the deadline signal reached the Overpass coastline query')
  // ENC threw (its leg query aborted) but OSM degraded rather than throwing (it
  // is global, so a thrown query would wrongly mark the leg as not-run). So at
  // least one provider ran in the degrade sense: the check still produced flags.
  assert.ok(result.flags.length > 0, 'an aborted check still produces explicit notes, never a silent pass')
  // The hazard-sweep degrade note keeps its kind:'other'; the dedupe pass must
  // not relabel a degrade note as a hazard.
  assert.ok(
    result.flags.some((f) => f.kind === 'other' && /not checked/i.test(f.message)),
    'an aborted check carries an explicit not-checked note, not a relabelled hazard'
  )
  assert.equal(
    result.flags.some((f) => f.kind === 'hazard'),
    false,
    'an aborted check raises no hazard flags'
  )
})

test('non-contiguous ENC coverage runs the hazard sweep once per contiguous US run, not across the gap', async () => {
  // A route US, then foreign, then US. ENC covers a leg when either endpoint is
  // in US waters, so the only ENC-uncovered leg is the middle one with both
  // endpoints foreign. The covered legs split into two contiguous runs, and the
  // ENC hazard sweep must run once per run (two distinct route bboxes), never
  // once spanning the foreign gap (which would be a single bbox).
  // Points around 32 N off the US Atlantic. The CONUS envelope reaches east to
  // longitude -66, so a point west of -66 is US (ENC-covered) and a point east
  // of -66 (toward Bermuda) is foreign. Kept geographically tight so the per-leg
  // and hazard bboxes stay small.
  const usA0: Position = { latitude: 32.00, longitude: -67.00 }
  const usA1: Position = { latitude: 32.00, longitude: -66.50 }
  const med0: Position = { latitude: 32.00, longitude: -64.00 }
  const med1: Position = { latitude: 32.00, longitude: -63.00 }
  const usB0: Position = { latitude: 32.00, longitude: -66.50 }
  const usB1: Position = { latitude: 32.00, longitude: -67.00 }
  // Legs: 0[A0,A1] US-US covered, 1[A1,med0] covered (A1 US), 2[med0,med1] NOT
  // covered (both foreign), 3[med1,B0] covered (B0 US), 4[B0,B1] US-US covered.
  // ENC-covered legs {0,1,3,4} split into runs [0,1] and [3,4].
  const enc = makeEnc(() => ({ depthAreas: [depthArea(10)], landAreas: [] }))
  const overpass = makeOverpass()
  await checkLegs(
    deps(enc, overpass),
    params({ waypoints: [usA0, usA1, med0, med1, usB0, usB1] })
  )
  // Each contiguous run's hazard sweep queries with one route bbox (repeated per
  // layer); distinct bboxes therefore count the runs. Two distinct bboxes means
  // two runs ([0,1] and [3,4]); a single bbox would mean one sweep spanning the
  // foreign gap, the bug the contiguous-run split prevents.
  const distinctBboxes = new Set(enc.hazardBboxes.map((b) => JSON.stringify(b)))
  assert.equal(distinctBboxes.size, 2, 'the ENC hazard sweep ran once per contiguous US run, not once across the gap')
})
