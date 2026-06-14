/**
 * Tests for the route-draft "check these legs" safety check.
 *
 * `checkLegs` is injectable, so these tests stub the ENC client, the
 * charted-area query, the corridor scan, and the US-waters gate directly: no
 * live HTTP, no in-process server. Each test pins one honesty branch the spec
 * requires: the shallow flag against a synthetic depth area, the drying-as-land
 * negative-DRVAL1 branch (never a negative water depth), the land flag, the
 * explicit no-coverage flag (never a silent pass), the standoff flag, the
 * corridor point-hazard flag, the best-band conservative selection (the
 * shallower DRVAL1 where bands overlap), the one-query-per-leg-per-band call
 * count, and the degrade when the charted query rejects.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { checkLegs, type LegCheckDeps, type LegCheckParams } from '../src/route-draft/safety-check.js'
import { scanRouteCorridor } from '../src/outputs/route-hazard/route-corridor.js'
import { isInUsWaters } from '../src/shared/us-waters.js'
import type { ChartedAreas, EncAreaPolygon } from '../src/inputs/noaa-enc/depth-area-query.js'
import type { EncDirectClient } from '../src/inputs/noaa-enc/enc-direct-client.js'
import type { EncFeature, ScaleBand } from '../src/inputs/noaa-enc/enc-direct-types.js'
import type { Position } from '../src/shared/types.js'

// A leg in the New York harbour approach, comfortably inside US waters.
const FROM: Position = { latitude: 40.45, longitude: -74.05 }
const TO: Position = { latitude: 40.55, longitude: -74.05 }

/** A square polygon centered on the leg, big enough that the leg crosses it. */
const COVERING_SQUARE: number[][][] = [[
  [-74.1, 40.4],
  [-74.0, 40.4],
  [-74.0, 40.6],
  [-74.1, 40.6],
  [-74.1, 40.4]
]]

/** A square well to the east of the leg, so the leg does not cross it. */
const FAR_SQUARE: number[][][] = [[
  [-73.5, 40.4],
  [-73.4, 40.4],
  [-73.4, 40.6],
  [-73.5, 40.6],
  [-73.5, 40.4]
]]

function depthArea (drval1: number | undefined, rings = COVERING_SQUARE): EncAreaPolygon {
  return {
    rings,
    depthRange: drval1 === undefined ? {} : { shallowMeters: drval1, deepMeters: drval1 + 5 },
    properties: {}
  }
}

function landArea (rings = COVERING_SQUARE): EncAreaPolygon {
  return { rings, properties: { OBJNAM: 'Staten Island' } }
}

function noAreas (): ChartedAreas {
  return { depthAreas: [], landAreas: [] }
}

/** A client whose queryLayer always returns no features. */
function emptyClient (): EncDirectClient {
  return {
    queryLayer: async () => ({ features: [] }),
    queryById: async () => undefined
  }
}

/** Standard deps: real corridor scan and US-waters gate, stubbed ENC queries. */
function makeDeps (
  charted: (band: ScaleBand) => ChartedAreas,
  hazardFeatures: EncFeature[] = []
): { deps: LegCheckDeps, chartedCalls: Array<{ band: ScaleBand }> } {
  const chartedCalls: Array<{ band: ScaleBand }> = []
  const client: EncDirectClient = {
    // Only the point-hazard layers route through the client here; the charted
    // areas come through the injected queryChartedAreas stub. The wreck layer
    // carries the test's hazards, the other layers are empty.
    queryLayer: async ({ layerKey }) => ({
      features: layerKey === 'wreck' ? hazardFeatures : []
    }),
    queryById: async () => undefined
  }
  const deps: LegCheckDeps = {
    client,
    queryChartedAreas: async (_client, { band }) => {
      chartedCalls.push({ band })
      return charted(band)
    },
    scanRouteCorridor,
    isInUsWaters
  }
  return { deps, chartedCalls }
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

test('flags shallow when a crossed depth area DRVAL1 is under draft plus margin', async () => {
  const { deps } = makeDeps(() => ({ depthAreas: [depthArea(2.5)], landAreas: [] }))
  const result = await checkLegs(deps, params())
  assert.equal(result.checked, true)
  const shallow = result.flags.find((f) => f.kind === 'shallow')
  assert.ok(shallow, 'expected a shallow flag')
  assert.equal(shallow?.leg, 0)
  // The message states the charted contour value and the datum, never a verdict.
  assert.match(shallow!.message, /DRVAL1 is 2\.5 m/)
  assert.match(shallow!.message, /MLLW/)
  assert.match(shallow!.message, /Coastal band/)
  assert.doesNotMatch(shallow!.message, /deep enough|verified/i)
})

test('does not flag shallow when DRVAL1 clears draft plus margin', async () => {
  const { deps } = makeDeps(() => ({ depthAreas: [depthArea(10)], landAreas: [] }))
  const result = await checkLegs(deps, params())
  assert.equal(result.flags.some((f) => f.kind === 'shallow'), false)
})

test('classifies a negative-DRVAL1 drying area as land, never a negative depth', async () => {
  const { deps } = makeDeps(() => ({ depthAreas: [depthArea(-1.6)], landAreas: [] }))
  const result = await checkLegs(deps, params())
  const land = result.flags.find((f) => f.kind === 'land')
  assert.ok(land, 'expected a land flag for the drying area')
  assert.match(land!.message, /drying/)
  assert.match(land!.message, /dries to 1\.6 m above MLLW/)
  // The drying area must never surface as a shallow flag nor print a negative depth.
  assert.equal(result.flags.some((f) => f.kind === 'shallow'), false)
  assert.equal(result.flags.some((f) => /-1\.6/.test(f.message)), false)
})

test('flags land when the leg crosses a Land_Area', async () => {
  const { deps } = makeDeps(() => ({ depthAreas: [depthArea(10)], landAreas: [landArea()] }))
  const result = await checkLegs(deps, params())
  const land = result.flags.find((f) => f.kind === 'land')
  assert.ok(land, 'expected a land flag')
  assert.equal(land?.leg, 0)
  assert.match(land!.message, /charted land/)
})

test('flags no-coverage explicitly when neither a depth area nor land covers the leg', async () => {
  // Areas exist in the response but sit far from the leg, so it crosses neither.
  const { deps } = makeDeps(() => ({
    depthAreas: [depthArea(10, FAR_SQUARE)],
    landAreas: [landArea(FAR_SQUARE)]
  }))
  const result = await checkLegs(deps, params())
  const gap = result.flags.find((f) => f.kind === 'other' && /no charted depth area/.test(f.message))
  assert.ok(gap, 'expected an explicit no-coverage flag, not a silent pass')
  assert.equal(gap?.leg, 0)
})

test('flags standoff when the nearest charted land is inside the offing', async () => {
  // A land area whose ring runs alongside the leg about 0.1 nm to the east,
  // inside the 0.5 nm standoff but not on the leg path itself.
  const closeLand: number[][][] = [[
    [-74.047, 40.45],
    [-74.04, 40.45],
    [-74.04, 40.55],
    [-74.047, 40.55],
    [-74.047, 40.45]
  ]]
  const { deps } = makeDeps(() => ({
    depthAreas: [depthArea(10)],
    landAreas: [landArea(closeLand)]
  }))
  const result = await checkLegs(deps, params({ standoffNm: 0.5 }))
  const standoff = result.flags.find((f) => f.kind === 'other' && /standoff/.test(f.message))
  assert.ok(standoff, 'expected a standoff flag for the close land area')
  assert.equal(standoff?.leg, 0)
})

test('flags a charted point hazard inside the leg corridor', async () => {
  const wreck: EncFeature = {
    type: 'Feature',
    id: 8001,
    geometry: { type: 'Point', coordinates: [-74.0505, 40.5] },
    properties: { OBJECTID: 8001, CATWRK: 'dangerous wreck', VALSOU: 3.2, QUASOU: '6' }
  }
  const { deps } = makeDeps(() => ({ depthAreas: [depthArea(10)], landAreas: [] }), [wreck])
  const result = await checkLegs(deps, params({ corridorHalfWidthMeters: 800 }))
  const hazard = result.flags.find((f) => f.kind === 'hazard')
  assert.ok(hazard, 'expected a hazard flag for the wreck in the corridor')
  assert.equal(hazard?.leg, 0)
  assert.match(hazard!.message, /wreck/)
  assert.match(hazard!.message, /dangerous wreck/)
  // VALSOU 3.2 with QUASOU 6 (least depth known) surfaces as a least-depth label.
  assert.match(hazard!.message, /3\.2 m/)
  assert.match(hazard!.message, /least depth/i)
})

test('queries point hazards across every band, so a wreck charted only at a coarser band is flagged', async () => {
  const wreck: EncFeature = {
    type: 'Feature',
    id: 8100,
    geometry: { type: 'Point', coordinates: [-74.0505, 40.5] },
    properties: { OBJECTID: 8100, CATWRK: 'dangerous wreck', VALSOU: 3.2, QUASOU: '6' }
  }
  // The wreck is charted only at the coarser 'coastal' band, not at 'approach'.
  const deps: LegCheckDeps = {
    client: {
      queryLayer: async ({ band, layerKey }) => ({
        features: layerKey === 'wreck' && band === 'coastal' ? [wreck] : []
      }),
      queryById: async () => undefined
    },
    queryChartedAreas: async () => ({ depthAreas: [depthArea(10)], landAreas: [] }),
    scanRouteCorridor,
    isInUsWaters
  }
  const result = await checkLegs(deps, params({ bands: ['approach', 'coastal'], corridorHalfWidthMeters: 800 }))
  assert.ok(result.flags.some((f) => f.kind === 'hazard'), 'a wreck charted only at the coarser band is still flagged')
})

test('dedupes a hazard charted at several bands into a single flag', async () => {
  // The same wreck position at both bands, with distinct OBJECTIDs, as NOAA charts it.
  const wreckAt = (objectId: number): EncFeature => ({
    type: 'Feature',
    id: objectId,
    geometry: { type: 'Point', coordinates: [-74.0505, 40.5] },
    properties: { OBJECTID: objectId, CATWRK: 'dangerous wreck', VALSOU: 3.2, QUASOU: '6' }
  })
  const deps: LegCheckDeps = {
    client: {
      queryLayer: async ({ band, layerKey }) => ({
        features: layerKey === 'wreck' ? [band === 'approach' ? wreckAt(8200) : wreckAt(8201)] : []
      }),
      queryById: async () => undefined
    },
    queryChartedAreas: async () => ({ depthAreas: [depthArea(10)], landAreas: [] }),
    scanRouteCorridor,
    isInUsWaters
  }
  const result = await checkLegs(deps, params({ bands: ['approach', 'coastal'], corridorHalfWidthMeters: 800 }))
  assert.equal(result.flags.filter((f) => f.kind === 'hazard').length, 1, 'the same wreck across bands is flagged once')
})

test('best band takes the shallower DRVAL1 where bands overlap', async () => {
  // The coarse band reads deeper (8 m); the finer band reads shallower (2.5 m).
  // The conservative choice is the shallower value, flagged shallow.
  const { deps } = makeDeps((band) => {
    if (band === 'harbour') return { depthAreas: [depthArea(2.5)], landAreas: [] }
    return { depthAreas: [depthArea(8)], landAreas: [] }
  })
  const result = await checkLegs(deps, params({ bands: ['harbour', 'coastal'] }))
  const shallow = result.flags.find((f) => f.kind === 'shallow')
  assert.ok(shallow, 'expected the conservative shallower reading to flag')
  assert.match(shallow!.message, /2\.5 m/)
  assert.match(shallow!.message, /Harbor band/)
})

test('issues exactly one charted-area query per leg per band', async () => {
  const { deps, chartedCalls } = makeDeps(() => ({ depthAreas: [depthArea(10)], landAreas: [] }))
  // Two legs (three waypoints), two bands: four charted-area queries total.
  const mid: Position = { latitude: 40.5, longitude: -74.05 }
  await checkLegs(deps, params({
    waypoints: [FROM, mid, TO],
    bands: ['harbour', 'coastal']
  }))
  assert.equal(chartedCalls.length, 4, 'expected 2 legs x 2 bands = 4 charted-area queries')
  const harbourCalls = chartedCalls.filter((c) => c.band === 'harbour').length
  const coastalCalls = chartedCalls.filter((c) => c.band === 'coastal').length
  assert.equal(harbourCalls, 2)
  assert.equal(coastalCalls, 2)
})

test('degrades to an explicit note when the charted query rejects, never a silent pass', async () => {
  const failing: LegCheckDeps = {
    client: emptyClient(),
    queryChartedAreas: async () => { throw new Error('ENC Direct HTTP 503') },
    scanRouteCorridor,
    isInUsWaters
  }
  const result = await checkLegs(failing, params())
  assert.equal(result.checked, false)
  const note = result.flags.find((f) => f.kind === 'other')
  assert.ok(note, 'expected an explicit degrade note')
  assert.match(note!.message, /charted query failed/)
})

test('degrades when the route leaves US ENC coverage', async () => {
  const { deps } = makeDeps(() => noAreas())
  const outside: Position = { latitude: 43.5, longitude: 7.0 } // Mediterranean
  const result = await checkLegs(deps, params({ waypoints: [FROM, outside] }))
  assert.equal(result.checked, false)
  assert.equal(result.flags.length, 1)
  assert.match(result.flags[0].message, /outside US ENC coverage/)
})

test('passes the deadline signal to the charted-area query and degrades when it aborts', async () => {
  const controller = new AbortController()
  controller.abort()
  let sawAbort = false
  const deps: LegCheckDeps = {
    client: emptyClient(),
    queryChartedAreas: async (_client, { signal }) => {
      if (signal?.aborted === true) {
        sawAbort = true
        throw signal.reason ?? new Error('aborted')
      }
      return { depthAreas: [depthArea(10)], landAreas: [] }
    },
    scanRouteCorridor,
    isInUsWaters
  }
  const result = await checkLegs(deps, params({ signal: controller.signal }))
  assert.equal(sawAbort, true, 'the deadline signal reaches the charted-area query')
  assert.equal(result.checked, false, 'an aborted check degrades, never a silent pass')
  assert.ok(result.flags.some((f) => /not checked for this leg/.test(f.message)))
})
