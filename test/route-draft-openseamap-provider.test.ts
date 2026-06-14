/**
 * Tests for the OpenSeaMap leg-safety provider.
 *
 * This provider supplies worldwide point HAZARDS (OpenSeaMap rock, wreck, and
 * obstruction seamarks in the leg corridor) and worldwide LAND (OSM coastline
 * crossing and standoff), but NOT depth. It is global: coversLeg is always true.
 * Depth-not-checked emission is the orchestrator's job (its capability-keyed
 * not-checked pass), so this provider carries no depth capability and does not
 * self-emit a depth flag.
 *
 * Each test stubs the Overpass client directly, so there is no live HTTP. The
 * suite pins the honesty branches the spec requires: a coastline crossing flags
 * land, the provider carries no depth capability and self-emits no depth flag,
 * the hazard query is hard-coded to rock/wreck/obstruction regardless of any
 * configured display group, and a hazard seamark in the corridor maps to the
 * correct GLOBAL leg index through checkHazards.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenSeaMapProvider } from '../src/route-draft/providers/openseamap-provider.js'
import { scanRouteCorridor } from '../src/outputs/route-hazard/route-corridor.js'
import type { OverpassClient, OverpassElement } from '../src/inputs/openseamap/overpass-client.js'
import type { LegCheckParams } from '../src/route-draft/safety-check.js'
import type { LegRef } from '../src/route-draft/providers/provider.js'
import type { Position } from '../src/shared/types.js'

const FROM: Position = { latitude: 43.0, longitude: 5.0 }
const TO: Position = { latitude: 43.2, longitude: 5.0 }

function client (overrides: Partial<OverpassClient> = {}): OverpassClient {
  return {
    listPointsOfInterest: async () => [],
    getById: async () => undefined,
    listCoastlineWays: async () => [],
    close: () => {},
    ...overrides
  }
}

const params: LegCheckParams = {
  waypoints: [FROM, TO],
  draftMeters: 2,
  safetyMarginMeters: 1,
  standoffNm: 0.5,
  corridorHalfWidthMeters: 500,
  bands: []
}

/** A seamark element sitting on the leg, in the corridor, on the 5.0 meridian. */
function seamarkOnLeg (
  seamarkType: string,
  id: number,
  lat: number,
  extraTags: Record<string, string> = {}
): OverpassElement {
  return {
    type: 'node',
    id,
    tags: { 'seamark:type': seamarkType, ...extraTags },
    position: { latitude: lat, longitude: 5.0 }
  }
}

test('createOpenSeaMapProvider supplies land and hazards but not depth', () => {
  const provider = createOpenSeaMapProvider({ client: client(), scanRouteCorridor })
  assert.equal(provider.capabilities.has('land'), true)
  assert.equal(provider.capabilities.has('hazards'), true)
  assert.equal(provider.capabilities.has('depth'), false)
})

test('coversLeg is always true: the provider is global', () => {
  const provider = createOpenSeaMapProvider({ client: client(), scanRouteCorridor })
  // A leg in the Mediterranean, outside any US chart coverage, is still covered.
  assert.equal(provider.coversLeg(FROM, TO), true)
  // A leg anywhere else is covered too.
  assert.equal(
    provider.coversLeg({ latitude: -33.9, longitude: 151.2 }, { latitude: -34.0, longitude: 151.3 }),
    true
  )
})

test('flags land when the leg crosses an OSM coastline way', async () => {
  const provider = createOpenSeaMapProvider({
    client: client({ listCoastlineWays: async () => [{ points: [[4.9, 43.1], [5.1, 43.1]] }] }),
    scanRouteCorridor
  })
  const result = await provider.checkLeg(0, FROM, TO, params)
  assert.equal(result.coverage.land, 'data')
  assert.ok(result.flags.some((f) => f.kind === 'land' && /coastline/i.test(f.message)))
  // The land flag is honest: absence of a crossing is not proof of clear water.
  const land = result.flags.find((f) => f.kind === 'land')
  assert.match(land!.message, /verify on the chart/i)
})

test('does not self-emit a depth flag and carries no depth capability', async () => {
  // The orchestrator owns the depth-not-checked note via its capability-keyed
  // not-checked pass; this provider only reports what it verifies.
  const provider = createOpenSeaMapProvider({ client: client(), scanRouteCorridor: () => [] })
  const result = await provider.checkLeg(0, FROM, TO, params)
  assert.equal(provider.capabilities.has('depth'), false)
  assert.equal(result.flags.some((f) => /depth/i.test(f.message)), false)
})

test('reports only land flags, no depth flag, when the leg crosses a coastline', async () => {
  const provider = createOpenSeaMapProvider({
    client: client({ listCoastlineWays: async () => [{ points: [[4.9, 43.1], [5.1, 43.1]] }] }),
    scanRouteCorridor
  })
  const result = await provider.checkLeg(0, FROM, TO, params)
  assert.ok(result.flags.some((f) => f.kind === 'land'))
  assert.equal(result.flags.some((f) => /depth/i.test(f.message)), false)
})

test('flags standoff when the nearest coastline is inside the offing', async () => {
  // A coastline way running parallel to the leg about 0.1 nm to the east, inside
  // the 0.5 nm standoff but not crossing the leg path itself.
  const provider = createOpenSeaMapProvider({
    client: client({ listCoastlineWays: async () => [{ points: [[5.0021, 43.05], [5.0021, 43.15]] }] }),
    scanRouteCorridor
  })
  const result = await provider.checkLeg(0, FROM, TO, params)
  assert.equal(result.flags.some((f) => f.kind === 'land'), false)
  const standoff = result.flags.find((f) => f.kind === 'other' && /standoff/.test(f.message))
  assert.ok(standoff, 'expected a standoff flag for the close coastline')
  assert.equal(standoff?.leg, 0)
})

test('degrades to a land-not-checked note when the coastline query rejects', async () => {
  const provider = createOpenSeaMapProvider({
    client: client({ listCoastlineWays: async () => { throw new Error('Overpass 503') } }),
    scanRouteCorridor
  })
  const result = await provider.checkLeg(0, FROM, TO, params)
  assert.equal(result.coverage.land, 'nodata')
  assert.ok(result.flags.some((f) => f.kind === 'other' && /land not checked/i.test(f.message)))
  // A failed land query does not turn into a depth claim either.
  assert.equal(result.flags.some((f) => /depth/i.test(f.message)), false)
})

test('queries hazards with the hard-coded rock/wreck/obstruction regex regardless of config', async () => {
  const regexes: string[] = []
  const provider = createOpenSeaMapProvider({
    client: client({
      listPointsOfInterest: async (_bbox, seamarkRegex) => {
        regexes.push(seamarkRegex)
        return []
      }
    }),
    scanRouteCorridor
  })
  const legs: LegRef[] = [{ leg: 0, from: FROM, to: TO }]
  await provider.checkHazards!(legs, params)
  assert.ok(regexes.length > 0, 'expected at least one hazard query')
  for (const regex of regexes) {
    assert.equal(regex, '^(rock|wreck|obstruction)$')
  }
})

test('flags a hazard seamark in the corridor with the right global leg index', async () => {
  // Two legs (three waypoints): the hazard sits on the SECOND leg, global index 1.
  const mid: Position = { latitude: 43.2, longitude: 5.0 }
  const end: Position = { latitude: 43.4, longitude: 5.0 }
  const wreck = seamarkOnLeg('wreck', 9100, 43.3, { 'seamark:name': 'Test Wreck' }) // on the second leg
  const provider = createOpenSeaMapProvider({
    client: client({ listPointsOfInterest: async () => [wreck] }),
    scanRouteCorridor
  })
  const legs: LegRef[] = [
    { leg: 0, from: FROM, to: mid },
    { leg: 1, from: mid, to: end }
  ]
  const flags = await provider.checkHazards!(legs, { ...params, corridorHalfWidthMeters: 800 })
  const hazard = flags.find((f) => f.kind === 'hazard')
  assert.ok(hazard, 'expected a hazard flag for the wreck in the corridor')
  assert.equal(hazard?.leg, 1, 'the hazard maps to the global second-leg index')
  assert.match(hazard!.message, /wreck/i)
})

test('names a rock hazard "rock" in the corridor flag message', async () => {
  // Mirrors the wreck assertion: the type word comes from the seamarkLabel map,
  // so a second seamark type exercises more than one entry of that map.
  const rock = seamarkOnLeg('rock', 9300, 43.1)
  const provider = createOpenSeaMapProvider({
    client: client({ listPointsOfInterest: async () => [rock] }),
    scanRouteCorridor
  })
  const legs: LegRef[] = [{ leg: 0, from: FROM, to: TO }]
  const flags = await provider.checkHazards!(legs, { ...params, corridorHalfWidthMeters: 800 })
  const hazard = flags.find((f) => f.kind === 'hazard')
  assert.ok(hazard, 'expected a hazard flag for the rock in the corridor')
  assert.match(hazard!.message, /OpenStreetMap-charted rock within the leg corridor/)
})

test('maps a hazard on the first of a covered run that starts at a non-zero global index', async () => {
  // The provider covers legs whose global indices start at 2, not 0. A hazard on
  // the first covered leg must map back to global index 2, not 0.
  const a: Position = { latitude: 43.0, longitude: 5.0 }
  const b: Position = { latitude: 43.2, longitude: 5.0 }
  const rock = seamarkOnLeg('rock', 9001, 43.1) // on the first covered leg
  const provider = createOpenSeaMapProvider({
    client: client({ listPointsOfInterest: async () => [rock] }),
    scanRouteCorridor
  })
  const legs: LegRef[] = [{ leg: 2, from: a, to: b }]
  const flags = await provider.checkHazards!(legs, { ...params, corridorHalfWidthMeters: 800 })
  const hazard = flags.find((f) => f.kind === 'hazard')
  assert.ok(hazard, 'expected a hazard flag')
  assert.equal(hazard?.leg, 2, 'the hazard maps to the covered run\'s global index')
})

test('drops a non-Hazard seamark, keeping only Hazard-typed elements', async () => {
  // A marina is not a Hazard, so the corridor scan must not raise a hazard flag.
  const marina: OverpassElement = {
    type: 'node',
    id: 9200,
    tags: { leisure: 'marina', name: 'Test Marina' },
    position: { latitude: 43.1, longitude: 5.0 }
  }
  const provider = createOpenSeaMapProvider({
    client: client({ listPointsOfInterest: async () => [marina] }),
    scanRouteCorridor
  })
  const legs: LegRef[] = [{ leg: 0, from: FROM, to: TO }]
  const flags = await provider.checkHazards!(legs, { ...params, corridorHalfWidthMeters: 800 })
  assert.equal(flags.some((f) => f.kind === 'hazard'), false)
})

test('degrades to a hazards-not-checked note when the hazard query rejects', async () => {
  const provider = createOpenSeaMapProvider({
    client: client({ listPointsOfInterest: async () => { throw new Error('Overpass 503') } }),
    scanRouteCorridor
  })
  const legs: LegRef[] = [{ leg: 0, from: FROM, to: TO }]
  const flags = await provider.checkHazards!(legs, params)
  const note = flags.find((f) => f.kind === 'other')
  assert.ok(note, 'expected an explicit hazards-not-checked note')
  assert.match(note!.message, /point hazards not checked/i)
})

test('checkHazards returns no flags for an empty covered-leg run', async () => {
  const provider = createOpenSeaMapProvider({ client: client(), scanRouteCorridor })
  const flags = await provider.checkHazards!([], params)
  assert.deepEqual(flags, [])
})

test('passes the deadline signal through to the hazard query', async () => {
  const controller = new AbortController()
  controller.abort()
  let sawAbort = false
  const provider = createOpenSeaMapProvider({
    client: client({
      listPointsOfInterest: async (_bbox, _regex, signal) => {
        if (signal?.aborted === true) {
          sawAbort = true
          throw signal.reason ?? new Error('aborted')
        }
        return []
      }
    }),
    scanRouteCorridor
  })
  const legs: LegRef[] = [{ leg: 0, from: FROM, to: TO }]
  const flags = await provider.checkHazards!(legs, { ...params, signal: controller.signal })
  assert.equal(sawAbort, true, 'the deadline signal reaches the hazard query')
  assert.ok(flags.some((f) => f.kind === 'other' && /point hazards not checked/i.test(f.message)))
})
