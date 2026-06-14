/**
 * Tests for the EMODnet leg-safety provider, in isolation.
 *
 * These drive the provider directly through `createEmodnetProvider(...).checkLeg`
 * and `.coversLeg`, free of the orchestrator and the other providers, so they pin
 * the EMODnet behaviors without any union or cross-provider concern. They stub the
 * EMODnet client directly: no live HTTP, no in-process server.
 *
 * EMODnet supplies European MODELED depth, awareness-grade and referenced to LAT,
 * distinct from ENC's authoritative MLLW charted depth. depth_profile values are
 * signed meters, NEGATIVE below datum, so the shallowest navigable reading on a
 * leg is `Math.max(...samples)` (the value closest to zero). A POSITIVE sample is
 * an above-datum elevation (drying or land), not a depth, mirroring the ENC
 * drying-as-land rule, and is never printed as a negative depth. Each pinned
 * branch: the max-of-the-samples shallowest under draft-plus-margin flags shallow
 * with the LAT and modeled wording, a positive sample flags land or drying and
 * never a negative depth and never a shallow flag, an empty profile reports
 * depth coverage 'nodata' with the no-data note, a hadGap profile adds the
 * incomplete-gaps caveat, every checked leg carries the awareness caveat, a query
 * rejection degrades to depth coverage 'nodata' with the query-failed note,
 * coversLeg gates to the European envelope, and the capabilities are exactly
 * {depth} with no checkHazards.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmodnetProvider } from '../src/route-draft/providers/emodnet-provider.js'
import type { EmodnetClient } from '../src/route-draft/emodnet/emodnet-client.js'
import type { LegCheckParams } from '../src/route-draft/safety-check.js'
import type { Position } from '../src/shared/types.js'

// A short leg in the Mediterranean off Toulon, comfortably inside the EMODnet envelope.
const FROM: Position = { latitude: 43.0, longitude: 5.0 }
const TO: Position = { latitude: 43.1, longitude: 5.0 }

// draft 2 m + margin 1 m gives a 3 m draft-plus-margin contour. The provider
// reads only draftMeters, safetyMarginMeters, and signal; the rest are the
// interface's other required fields, set to inert valid values.
const params: LegCheckParams = {
  waypoints: [FROM, TO],
  draftMeters: 2,
  safetyMarginMeters: 1,
  standoffNm: 0.5,
  corridorHalfWidthMeters: 500,
  bands: []
}

/** A provider over a stub client that returns the given profile. */
function provider (profile: { samples: number[], hadGap?: boolean }): ReturnType<typeof createEmodnetProvider> {
  const client: EmodnetClient = {
    depthProfile: async () => ({ samples: profile.samples, hadGap: profile.hadGap ?? false })
  }
  return createEmodnetProvider({ client })
}

/** A provider whose depthProfile rejects, for the degrade path. */
function rejectingProvider (): ReturnType<typeof createEmodnetProvider> {
  const client: EmodnetClient = {
    depthProfile: async () => { throw new Error('boom') }
  }
  return createEmodnetProvider({ client })
}

test('capabilities is exactly {depth} and there is no checkHazards', () => {
  const p = provider({ samples: [-10] })
  assert.deepEqual([...p.capabilities], ['depth'])
  assert.equal(p.capabilities.has('depth'), true)
  assert.equal(p.capabilities.has('land'), false)
  assert.equal(p.capabilities.has('hazards'), false)
  assert.equal(p.checkHazards, undefined)
})

test('coversLeg is true inside the European envelope and false at a US point', () => {
  const p = provider({ samples: [-10] })
  // Both endpoints in the Med: covered.
  assert.equal(p.coversLeg(FROM, TO), true)
  // A US point (New York harbour) is outside the EMODnet envelope.
  const usFrom: Position = { latitude: 40.5, longitude: -74.0 }
  const usTo: Position = { latitude: 40.6, longitude: -74.0 }
  assert.equal(p.coversLeg(usFrom, usTo), false)
  // One endpoint outside is not covered: both must be inside.
  assert.equal(p.coversLeg(FROM, usTo), false)
})

test('shallowest is max() of the samples and flags shallow under draft-plus-margin', async () => {
  // Samples -2.5, -4, -8: the shallowest (closest to zero) is -2.5, so the modeled
  // depth is 2.5 m, under the 3 m draft-plus-margin contour.
  const p = provider({ samples: [-4, -2.5, -8] })
  const result = await p.checkLeg(0, FROM, TO, params)
  const shallow = result.flags.filter((f) => f.kind === 'shallow')
  assert.equal(shallow.length, 1)
  assert.match(shallow[0].message, /2\.5 m/)
  assert.match(shallow[0].message, /LAT/)
  assert.match(shallow[0].message, /modeled/)
  assert.match(shallow[0].message, /3\.0 m/)
  assert.equal(result.coverage.depth, 'data')
})

test('a deep leg under no contour raises no shallow flag, only the awareness caveat', async () => {
  // Shallowest is -10, so 10 m modeled depth, well over the 3 m contour.
  const p = provider({ samples: [-10, -12, -15] })
  const result = await p.checkLeg(0, FROM, TO, params)
  assert.equal(result.flags.some((f) => f.kind === 'shallow'), false)
  assert.equal(result.flags.some((f) => f.kind === 'land'), false)
  // Awareness caveat is always present on a checked leg.
  assert.equal(result.flags.some((f) => f.kind === 'other' && /awareness-grade/.test(f.message)), true)
  assert.equal(result.coverage.depth, 'data')
})

test('a positive sample flags land or drying, never a negative depth and never a shallow flag', async () => {
  // Shallowest is +1.4 (above datum): drying or land, not a depth.
  const p = provider({ samples: [-3, 1.4, -1] })
  const result = await p.checkLeg(0, FROM, TO, params)
  const land = result.flags.filter((f) => f.kind === 'land')
  assert.equal(land.length, 1)
  assert.match(land[0].message, /1\.4 m above LAT/)
  // Never a shallow flag for the positive value, and never a negative number printed.
  assert.equal(result.flags.some((f) => f.kind === 'shallow'), false)
  assert.equal(result.flags.some((f) => /-1\.4/.test(f.message)), false)
  assert.equal(result.coverage.depth, 'data')
})

test('an empty profile reports depth coverage nodata with the no-data note', async () => {
  const p = provider({ samples: [] })
  const result = await p.checkLeg(0, FROM, TO, params)
  assert.equal(result.coverage.depth, 'nodata')
  assert.equal(result.flags.length, 1)
  assert.match(result.flags[0].message, /no EMODnet modeled depth here/)
  // No awareness caveat is added for an unchecked (no-data) leg.
  assert.equal(result.flags.some((f) => /awareness-grade/.test(f.message)), false)
})

test('a hadGap profile adds the incomplete-gaps caveat alongside the awareness caveat', async () => {
  const p = provider({ samples: [-10], hadGap: true })
  const result = await p.checkLeg(0, FROM, TO, params)
  assert.equal(result.flags.some((f) => /incomplete on this leg/.test(f.message)), true)
  assert.equal(result.flags.some((f) => /awareness-grade/.test(f.message)), true)
  assert.equal(result.coverage.depth, 'data')
})

test('every checked leg carries the awareness caveat', async () => {
  // A clean, deep leg with no shallow, land, or gap flag still carries the caveat,
  // so a navigator never reads it as charted clearance.
  const p = provider({ samples: [-20] })
  const result = await p.checkLeg(0, FROM, TO, params)
  const caveat = result.flags.filter((f) => f.kind === 'other' && /EMODnet modeled bathymetry referenced to LAT/.test(f.message))
  assert.equal(caveat.length, 1)
})

test('a query rejection degrades to depth coverage nodata with the query-failed note', async () => {
  const p = rejectingProvider()
  const result = await p.checkLeg(0, FROM, TO, params)
  assert.equal(result.coverage.depth, 'nodata')
  assert.equal(result.flags.length, 1)
  assert.match(result.flags[0].message, /the EMODnet query failed/)
})
