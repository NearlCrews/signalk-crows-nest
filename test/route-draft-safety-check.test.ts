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
import { checkLegs, runOrchestrator, type LegCheckDeps, type LegCheckParams, type LegFlag } from '../src/route-draft/safety-check.js'
import { createEncProvider } from '../src/route-draft/providers/enc-provider.js'
import { createOpenSeaMapProvider } from '../src/route-draft/providers/openseamap-provider.js'
import { scanRouteCorridor } from '../src/outputs/route-hazard/route-corridor.js'
import type { ChartedAreas, EncAreaPolygon } from '../src/inputs/noaa-enc/depth-area-query.js'
import type { EncDirectClient, QueryRequest } from '../src/inputs/noaa-enc/enc-direct-client.js'
import type { EncFeature, EncLayerKey, ScaleBand } from '../src/inputs/noaa-enc/enc-direct-types.js'
import type { OverpassClient, OverpassElement, CoastlineWay } from '../src/inputs/openseamap/overpass-client.js'
import type { EmodnetClient, EmodnetProfile } from '../src/route-draft/emodnet/emodnet-client.js'
import type {
  Coverage,
  Dimension,
  LegDimensionCoverage,
  LegProviderResult,
  LegSafetyProvider
} from '../src/route-draft/providers/provider.js'
import type { Bbox, Position } from '../src/shared/types.js'

// A leg in the New York harbour approach, comfortably inside US waters.
const FROM: Position = { latitude: 40.45, longitude: -74.05 }
const TO: Position = { latitude: 40.55, longitude: -74.05 }

// A leg in the Mediterranean, inside the EMODnet European envelope but outside
// every US-waters envelope: ENC does not cover it, EMODnet and OSM do.
const MED_FROM: Position = { latitude: 43.5, longitude: 7.0 }
const MED_TO: Position = { latitude: 43.6, longitude: 7.1 }

// A leg in the mid South Pacific, outside both the US ENC envelope and the
// EMODnet European envelope (longitude -140 is well outside EMODnet's -36..43):
// no depth provider covers it, only the worldwide OSM provider does.
const OCEAN_FROM: Position = { latitude: -20.0, longitude: -140.0 }
const OCEAN_TO: Position = { latitude: -20.1, longitude: -140.1 }

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

/** A bare ENC point feature at the given [lon, lat], for the obstruction and rock layers. */
function encPoint (objectId: number, lon: number, lat: number): EncFeature {
  return {
    type: 'Feature',
    id: objectId,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { OBJECTID: objectId }
  }
}

/** An OSM seamark node of the given hazard type at the given lat/lon. */
function osmHazard (id: number, seamarkType: string, lat: number, lon: number): OverpassElement {
  return {
    type: 'node',
    id,
    tags: { 'seamark:type': seamarkType },
    position: { latitude: lat, longitude: lon }
  }
}

/** An OSM wreck seamark node at the given lat/lon. */
function osmWreck (id: number, lat: number, lon: number): OverpassElement {
  return osmHazard(id, 'wreck', lat, lon)
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

/** Point-hazard features served by the ENC stub, keyed by layer (wreck, obstruction, rock). */
type HazardsByLayer = Partial<Record<EncLayerKey, EncFeature[]>>

/**
 * An ENC stub. `depthByBand` answers the charted-area query; `hazards` are
 * served per point-hazard layer at every band. An `EncFeature[]` shorthand is
 * accepted and treated as the wreck layer, the common single-layer case.
 */
function makeEnc (
  depthByBand: (band: ScaleBand) => ChartedAreas,
  hazards: EncFeature[] | HazardsByLayer = {}
): EncStub {
  const byLayer: HazardsByLayer = Array.isArray(hazards) ? { wreck: hazards } : hazards
  const hazardBboxes: Bbox[] = []
  let abortSeen = false
  const client: EncDirectClient = {
    queryLayer: async ({ layerKey, bbox, signal }: QueryRequest) => {
      hazardBboxes.push(bbox)
      if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
      return { features: byLayer[layerKey] ?? [] }
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

interface EmodnetStub {
  client: EmodnetClient
  /** How many times depthProfile was called (the EU-only gate test reads this). */
  calls: () => number
}

/**
 * An EMODnet stub serving one fixed depth profile. depthProfile is called only on
 * legs the provider covers (both endpoints inside the European envelope), so a
 * US-only route leaves `calls()` at zero. An empty profile yields no flags and
 * depth coverage 'nodata'.
 */
function makeEmodnet (profile: EmodnetProfile = { samples: [], hadGap: false }): EmodnetStub {
  let callCount = 0
  const client: EmodnetClient = {
    depthProfile: async () => {
      callCount += 1
      return profile
    }
  }
  return { client, calls: () => callCount }
}

function deps (enc: EncStub, overpass: OverpassStub, emodnet: EmodnetStub = makeEmodnet()): LegCheckDeps {
  return {
    client: enc.client,
    queryChartedAreas: enc.queryChartedAreas,
    overpass: overpass.client,
    emodnet: emodnet.client,
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

test('the cross-provider hazard dedupe collapses each type (wreck, obstruction, and rock), keeping the ENC reading', async () => {
  // One of each hazard type, charted at the same position by both providers. The
  // ENC layer key and the OpenSeaMap seamark label lowercased agree on the dedupe
  // key for all three, so each pair collapses to one flag and the kept flag is
  // ENC's (never the OpenStreetMap-charted message).
  const at = { wreck: 40.50, obstruction: 40.52, rock: 40.54 }
  const lon = -74.0505
  const enc = makeEnc(
    () => ({ depthAreas: [depthArea(10)], landAreas: [] }),
    {
      wreck: [encWreck(9001, lon, at.wreck)],
      obstruction: [encPoint(9002, lon, at.obstruction)],
      rock: [encPoint(9003, lon, at.rock)]
    }
  )
  const overpass = makeOverpass([], [
    osmHazard(7001, 'wreck', at.wreck, lon),
    osmHazard(7002, 'obstruction', at.obstruction, lon),
    osmHazard(7003, 'rock', at.rock, lon)
  ])
  const result = await checkLegs(deps(enc, overpass), params({ corridorHalfWidthMeters: 1500 }))
  const hazards = result.flags.filter((f) => f.kind === 'hazard')
  assert.equal(hazards.length, 3, 'one flag per type, each pair collapsed across providers')
  // Every kept flag is the ENC reading, not the OpenSeaMap one.
  assert.equal(
    hazards.every((f) => !/OpenStreetMap-charted/.test(f.message)),
    true,
    'the higher-precedence ENC reading is kept for every type'
  )
})

test('a no-depth-provider leg is checked by OpenSeaMap and gets the collapsed depth-not-checked note', async () => {
  // A mid-ocean leg: neither ENC nor EMODnet covers it, so its ENC stub is never
  // relied on. OSM provides land (a coastline crossing) and the depth note comes
  // from the orchestrator's capability-keyed not-checked pass, since no depth
  // provider declares depth on this leg.
  const enc = makeEnc(() => ({ depthAreas: [], landAreas: [] }))
  const emodnet = makeEmodnet()
  // A coastline way crossing the leg, so OSM raises a land flag.
  const crossing: CoastlineWay = { points: [[-140.04, -19.9], [-140.04, -20.2]] }
  const overpass = makeOverpass([crossing])
  const result = await checkLegs(deps(enc, overpass, emodnet), params({ waypoints: [OCEAN_FROM, OCEAN_TO] }))
  assert.equal(result.checked, true, 'OSM ran, so the check ran')
  // ENC was not queried for charted areas on a leg it does not cover.
  assert.equal(enc.hazardBboxes.length, 0, 'ENC issued no hazard query on a no-depth-provider route')
  // EMODnet does not cover a mid-Pacific leg, so its stub is never called.
  assert.equal(emodnet.calls(), 0, 'EMODnet issued no query outside the European envelope')
  // The collapsed depth note, one route-level flag.
  const depthNote = result.flags.find((f) => /depth not checked/i.test(f.message))
  assert.ok(depthNote, 'expected the collapsed depth-not-checked note')
  assert.equal(depthNote!.leg, undefined, 'the collapsed depth note carries no per-leg index')
  assert.match(depthNote!.message, /1 of 1 legs/)
  // No EMODnet awareness note when no leg used EMODnet.
  assert.equal(result.flags.some((f) => /EMODnet modeled bathymetry/.test(f.message)), false)
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

test('the depth-not-checked note collapses to ONE flag over a multi-leg no-depth-provider route', async () => {
  const enc = makeEnc(() => ({ depthAreas: [], landAreas: [] }))
  const overpass = makeOverpass()
  // Three mid-Pacific legs (four waypoints), no depth provider covering any of
  // them: one collapsed note, not three.
  const w0: Position = { latitude: -20.00, longitude: -140.00 }
  const w1: Position = { latitude: -20.05, longitude: -140.10 }
  const w2: Position = { latitude: -20.10, longitude: -140.20 }
  const w3: Position = { latitude: -20.15, longitude: -140.30 }
  const result = await checkLegs(deps(enc, overpass), params({ waypoints: [w0, w1, w2, w3] }))
  const depthNotes = result.flags.filter((f) => /depth not checked/i.test(f.message))
  assert.equal(depthNotes.length, 1, 'one collapsed depth note for the whole no-depth-provider route')
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

test('the providers carry the precedence the orchestrator sorts by, ENC above OpenSeaMap', () => {
  // The factories set the explicit precedence field; lower is higher authority,
  // and ENC must outrank OpenSeaMap. The orchestrator sorts by this field, so its
  // dedupe and merge order follow precedence rather than construction order.
  const enc = makeEnc(() => ({ depthAreas: [], landAreas: [] }))
  const overpass = makeOverpass()
  const encProvider = createEncProvider({
    client: enc.client,
    queryChartedAreas: enc.queryChartedAreas,
    scanRouteCorridor
  })
  const osmProvider = createOpenSeaMapProvider({ client: overpass.client, scanRouteCorridor })
  assert.ok(encProvider.precedence < osmProvider.precedence, 'ENC outranks OpenSeaMap by precedence')
})

test('the dedupe is cross-provider only: one provider keeps both close same-type hazards, a lower provider is deduped against a higher', async () => {
  // The position key is coarse (about 11 m at four decimals), needed to match the
  // SAME feature across providers, but it must not collapse two genuinely distinct
  // same-type hazards a single provider reports close together.
  const lon = -74.0505
  // ENC reports one wreck. OSM reports THREE wrecks on the same leg:
  //  - osm1 at the ENC position (shared key, a higher-precedence provider already
  //    emitted it, so this one is dropped),
  //  - osm2 and osm3 about 3 m apart at a DIFFERENT position, sharing a coarse key
  //    with each other (40.5200) but not with ENC (40.5000). Both must survive,
  //    because within one provider the seen set must not suppress the second.
  const encLat = 40.50
  const osmPairLat = 40.52
  const enc = makeEnc(
    () => ({ depthAreas: [depthArea(10)], landAreas: [] }),
    [encWreck(9001, lon, encLat)]
  )
  const overpass = makeOverpass([], [
    osmWreck(7001, encLat, lon), // same key as ENC, dropped cross-provider
    osmWreck(7002, osmPairLat, lon), // distinct key from ENC
    osmWreck(7003, osmPairLat + 0.00003, lon + 0.00003) // same coarse key as 7002
  ])
  const result = await checkLegs(deps(enc, overpass), params({ corridorHalfWidthMeters: 1500 }))
  const hazards = result.flags.filter((f) => f.kind === 'hazard')
  // ENC wreck (1) + the two distinct-from-ENC OSM wrecks (2) = 3. The OSM wreck
  // that duplicated ENC's position is the only one dropped.
  assert.equal(hazards.length, 3, 'within-provider close hazards both survive; only the cross-provider duplicate is dropped')
  assert.equal(
    hazards.filter((f) => !/OpenStreetMap-charted/.test(f.message)).length,
    1,
    'the ENC wreck is kept'
  )
  assert.equal(
    hazards.filter((f) => /OpenStreetMap-charted/.test(f.message)).length,
    2,
    'both OSM wrecks that ENC did not also report survive, despite their shared coarse key'
  )
})

test('a European leg is checked by EMODnet for depth and OpenSeaMap for land and hazards, with the route-level awareness note', async () => {
  // ENC does not cover a Mediterranean leg, so EMODnet owns depth there. EMODnet
  // returns a shallow modeled reading; OSM provides a coastline crossing (land)
  // and a hazard seamark. The route-level EMODnet awareness note appears once.
  const enc = makeEnc(() => ({ depthAreas: [], landAreas: [] }))
  // 2.5 m modeled depth, under the 3 m draft-plus-margin contour: a shallow flag.
  const emodnet = makeEmodnet({ samples: [-2.5], hadGap: false })
  // A coastline way crossing the leg for land, and a wreck seamark for a hazard.
  const crossing: CoastlineWay = { points: [[7.04, 43.4], [7.04, 43.7]] }
  const overpass = makeOverpass([crossing], [osmWreck(7200, 43.55, 7.05)])
  const result = await checkLegs(
    deps(enc, overpass, emodnet),
    params({ waypoints: [MED_FROM, MED_TO], corridorHalfWidthMeters: 1500 })
  )
  assert.equal(result.checked, true)
  // EMODnet was queried (it covers the European leg).
  assert.ok(emodnet.calls() > 0, 'EMODnet ran on the European leg')
  // EMODnet supplied the depth (shallow) flag.
  const shallow = result.flags.filter((f) => f.kind === 'shallow')
  assert.equal(shallow.length, 1, 'EMODnet flagged the shallow leg')
  assert.match(shallow[0].message, /EMODnet modeled depth/)
  // OSM supplied land and a hazard.
  assert.ok(result.flags.some((f) => f.kind === 'land'), 'OSM flagged the coastline crossing')
  assert.ok(result.flags.some((f) => f.kind === 'hazard'), 'OSM flagged the wreck seamark')
  // Since EMODnet owns depth here, no collapsed depth-not-checked note.
  assert.equal(result.flags.some((f) => /depth not checked/i.test(f.message)), false)
  // The route-level EMODnet awareness note appears once.
  const caveats = result.flags.filter((f) => /EMODnet modeled bathymetry referenced to LAT/.test(f.message))
  assert.equal(caveats.length, 1, 'one route-level EMODnet awareness note')
  assert.equal(caveats[0].leg, undefined, 'the awareness note carries no per-leg index')
  assert.match(caveats[0].message, /1 of 1 legs/)
})

test('EMODnet is not queried on a US leg it does not cover', async () => {
  // A New York harbour leg: ENC covers it, EMODnet does not (the European and US
  // envelopes are disjoint), so the EMODnet stub is never called.
  const enc = makeEnc(() => ({ depthAreas: [depthArea(10)], landAreas: [] }))
  const overpass = makeOverpass()
  const emodnet = makeEmodnet({ samples: [-5], hadGap: false })
  const result = await checkLegs(deps(enc, overpass, emodnet), params())
  assert.equal(emodnet.calls(), 0, 'EMODnet issued no query on a US leg outside its envelope')
  // No EMODnet awareness note when no leg used EMODnet.
  assert.equal(result.flags.some((f) => /EMODnet modeled bathymetry/.test(f.message)), false)
})

test('the route-level EMODnet awareness note appears exactly once for a multi-leg European route', async () => {
  // Three European legs (four Mediterranean waypoints), all covered by EMODnet:
  // one route-level awareness note reading "3 of 3 legs", not one per leg.
  const enc = makeEnc(() => ({ depthAreas: [], landAreas: [] }))
  const overpass = makeOverpass()
  const emodnet = makeEmodnet({ samples: [-8], hadGap: false })
  const w0: Position = { latitude: 43.50, longitude: 7.00 }
  const w1: Position = { latitude: 43.55, longitude: 7.10 }
  const w2: Position = { latitude: 43.60, longitude: 7.20 }
  const w3: Position = { latitude: 43.65, longitude: 7.30 }
  const result = await checkLegs(deps(enc, overpass, emodnet), params({ waypoints: [w0, w1, w2, w3] }))
  const caveats = result.flags.filter((f) => /EMODnet modeled bathymetry referenced to LAT/.test(f.message))
  assert.equal(caveats.length, 1, 'one route-level awareness note, not one per leg')
  assert.match(caveats[0].message, /3 of 3 legs/)
  // EMODnet owned depth on every leg, so no collapsed depth-not-checked note.
  assert.equal(result.flags.some((f) => /depth not checked/i.test(f.message)), false)
})

test('no EMODnet awareness note on a US-only route (no leg used EMODnet)', async () => {
  // A US leg checked by ENC for depth and OSM for land: EMODnet never covers it,
  // so the route carries no EMODnet awareness note.
  const enc = makeEnc(() => ({ depthAreas: [depthArea(2.5)], landAreas: [] }))
  const overpass = makeOverpass()
  const result = await checkLegs(deps(enc, overpass), params())
  assert.equal(result.flags.some((f) => /EMODnet modeled bathymetry/.test(f.message)), false)
})

/**
 * A synthetic depth-capable provider for the orchestrator-level depth-authority
 * test, free of any real client. It covers every leg, returns the given depth
 * coverage, and emits one `shallow` flag per leg so the suppression of a lower
 * provider's depth flags is observable.
 */
function syntheticDepthProvider (
  id: string,
  precedence: number,
  depthCoverage: Coverage,
  shallowMessage: string,
  capabilities: ReadonlySet<Dimension> = new Set<Dimension>(['depth'])
): LegSafetyProvider {
  return {
    id,
    capabilities,
    precedence,
    coversLeg: () => true,
    checkLeg: async (leg: number): Promise<LegProviderResult> => {
      const coverage: LegDimensionCoverage = { depth: depthCoverage }
      const flags: LegFlag[] = [{ leg, kind: 'shallow', message: shallowMessage }]
      return { flags, coverage }
    }
  }
}

test('depth-authority: a higher-precedence depth provider returning data suppresses a lower provider\'s depth flags', async () => {
  // Two synthetic depth providers both cover the single leg. The higher-precedence
  // one (precedence 0) returns depth data; the lower one (precedence 10) also
  // returns data but its depth flags must be DROPPED, because the higher provider
  // is authoritative for depth on that leg. Tested with synthetic providers
  // because the real ENC and EMODnet envelopes are disjoint, so no real leg ever
  // has both depth providers active.
  const high = syntheticDepthProvider('high', 0, 'data', 'HIGH shallow reading')
  const low = syntheticDepthProvider('low', 10, 'data', 'LOW shallow reading')
  // runOrchestrator takes its provider list already sorted by precedence (its
  // contract; checkLegs does the sort), so the list is passed highest-first.
  const result = await runOrchestrator([high, low], [MED_FROM, MED_TO], params({ waypoints: [MED_FROM, MED_TO] }))
  const shallow = result.flags.filter((f) => f.kind === 'shallow')
  assert.equal(shallow.length, 1, 'only the authoritative provider\'s depth flag survives')
  assert.match(shallow[0].message, /HIGH shallow reading/)
  assert.equal(result.flags.some((f) => /LOW shallow reading/.test(f.message)), false, 'the lower provider\'s depth flag is dropped')
})

test('depth-authority: a superseded multi-capability depth provider loses its depth verdicts but keeps its non-depth flags', async () => {
  // A higher-precedence depth provider owns depth on the leg. The lower provider
  // is depth-AND-land capable: its depth verdicts (shallow and the drying-as-land
  // flag) are dropped, but its non-depth flags (a standoff `other`, a hazard) are
  // kept. This proves the drop is by flag kind for a multi-capability provider,
  // not a blanket "drop everything" reserved for depth-only providers.
  const high = syntheticDepthProvider('high', 0, 'data', 'HIGH shallow reading')
  const low: LegSafetyProvider = {
    id: 'low-multi',
    capabilities: new Set<Dimension>(['depth', 'land']),
    precedence: 10,
    coversLeg: () => true,
    checkLeg: async (leg: number): Promise<LegProviderResult> => ({
      flags: [
        { leg, kind: 'shallow', message: 'LOW shallow verdict' },
        { leg, kind: 'land', message: 'LOW drying-as-land verdict' },
        { leg, kind: 'other', message: 'LOW standoff note' }
      ],
      coverage: { depth: 'data', land: 'data' }
    })
  }
  const result = await runOrchestrator([high, low], [MED_FROM, MED_TO], params({ waypoints: [MED_FROM, MED_TO] }))
  // The high provider's depth verdict survives; the low provider's depth verdicts go.
  assert.match(result.flags.find((f) => f.kind === 'shallow')!.message, /HIGH shallow reading/)
  assert.equal(result.flags.some((f) => /LOW shallow verdict/.test(f.message)), false, 'the low depth verdict is dropped')
  assert.equal(result.flags.some((f) => /LOW drying-as-land verdict/.test(f.message)), false, 'the low depth-derived land verdict is dropped')
  // The low provider's non-depth flag survives the supersession.
  assert.equal(result.flags.some((f) => /LOW standoff note/.test(f.message)), true, 'the low provider\'s non-depth flag survives')
})

test('depth-authority: a lower depth provider is NOT suppressed when the higher one returned no data', async () => {
  // When the higher-precedence provider returns depth 'nodata', it is not the
  // authority, so the lower provider that DID return data owns depth and its flag
  // survives. This proves the rule keys off returned coverage, not capability alone.
  const high = syntheticDepthProvider('high', 0, 'nodata', 'HIGH no-data reading')
  const low = syntheticDepthProvider('low', 10, 'data', 'LOW shallow reading')
  // Passed in precedence order (highest-first), runOrchestrator's contract.
  const result = await runOrchestrator([high, low], [MED_FROM, MED_TO], params({ waypoints: [MED_FROM, MED_TO] }))
  const shallow = result.flags.filter((f) => f.kind === 'shallow')
  // The higher provider returned nodata but still emitted its own shallow flag
  // (a synthetic always does); it is not the authority, so it does not suppress
  // the lower. The lower provider IS the authority and its flag survives. Neither
  // flag is dropped: a non-authoritative higher provider keeps its own readings
  // (it is never superseded, being highest precedence), and the lower provider,
  // as the authority, is not superseded either. Both survive, so the count is two.
  assert.equal(shallow.length, 2, 'neither provider is suppressed: both depth flags survive')
  assert.ok(shallow.some((f) => /LOW shallow reading/.test(f.message)), 'the lower provider owns depth and its flag survives')
  assert.ok(shallow.some((f) => /HIGH no-data reading/.test(f.message)), 'the non-authoritative higher provider keeps its own flag')
})
