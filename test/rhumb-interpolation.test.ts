import test from 'node:test'
import assert from 'node:assert/strict'
import { rhumbDistanceMeters, sampleRhumbLeg, distanceMeters } from '../src/geo/position-utilities.js'
import type { Position } from '../src/shared/types.js'

/** Assert that two numbers are within `epsilon` of each other. */
function assertClose (actual: number, expected: number, epsilon: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${actual} to be within ${epsilon} of ${expected}`
  )
}

test('rhumbDistanceMeters matches the textbook loxodrome example', () => {
  // The canonical worked example from Williams "Aviation Formulary" as
  // published at movable-type.co.uk/scripts/latlong.html: a rhumb line from
  // (51.127, 1.338) to (50.964, 1.853) is 40.31 km on a 6371 km sphere, at a
  // constant bearing of 116.7 degrees. The same earth radius the haversine
  // helper uses keeps the two measures comparable.
  const from: Position = { latitude: 51.127, longitude: 1.338 }
  const to: Position = { latitude: 50.964, longitude: 1.853 }

  assertClose(rhumbDistanceMeters(from, to), 40307.7, 5, 'rhumb distance matches the published 40.31 km')
})

test('rhumbDistanceMeters equals the great-circle distance on a meridian', () => {
  // A pure north-south leg is both a rhumb line and a great circle, so the two
  // distance helpers must agree exactly there (one degree of latitude).
  const from: Position = { latitude: 10, longitude: -40 }
  const to: Position = { latitude: 11, longitude: -40 }

  assertClose(rhumbDistanceMeters(from, to), distanceMeters(from, to), 1e-6, 'meridian rhumb equals the great circle')
})

test('rhumbDistanceMeters scales an east-west leg by the cosine of latitude', () => {
  // One degree of longitude is a full degree of arc on the equator and shrinks
  // by cos(latitude) toward the poles. At 60 degrees that is exactly half.
  const equator = rhumbDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })
  const sixty = rhumbDistanceMeters({ latitude: 60, longitude: 0 }, { latitude: 60, longitude: 1 })

  assertClose(equator, 111194.9, 0.5, 'one degree of arc on the equator')
  assertClose(sixty / equator, Math.cos(Math.PI / 3), 1e-9, 'an east-west degree at 60N is half the equator value')
})

test('rhumbDistanceMeters takes the short way across the antimeridian', () => {
  // 179.5 E to 179.5 W is one degree apart across the 180 meridian, not 359.
  const across = rhumbDistanceMeters({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 })

  assertClose(across, 111194.9, 0.5, 'the antimeridian crossing measures one degree, not 359')
})

test('sampleRhumbLeg spaces samples evenly along the rhumb line', () => {
  const from: Position = { latitude: 40, longitude: -70 }
  const to: Position = { latitude: 42, longitude: -66 }
  const total = rhumbDistanceMeters(from, to)
  const spacing = total / 4

  const samples = sampleRhumbLeg(from, to, spacing)

  // ceil(4) - 1 interior points: the endpoint is excluded.
  assert.equal(samples.length, 3, 'an exact 4-spacing leg yields three interior samples, not the endpoint')

  let previous = from
  for (const sample of samples) {
    assertClose(rhumbDistanceMeters(previous, sample), spacing, 1, 'each step is one spacing from the last')
    previous = sample
  }
  assertClose(rhumbDistanceMeters(previous, to), spacing, 1, 'the last interior sample sits one spacing short of the end')
})

test('sampleRhumbLeg keeps every sample on the same rhumb bearing', () => {
  // Every sample must lie on the constant-bearing loxodrome from the start, so
  // the rhumb bearing from the start to each sample equals the leg bearing.
  const from: Position = { latitude: 40, longitude: -70 }
  const to: Position = { latitude: 42, longitude: -66 }

  const legBearing = rhumbBearingDegrees(from, to)
  for (const sample of sampleRhumbLeg(from, to, rhumbDistanceMeters(from, to) / 5)) {
    assertClose(rhumbBearingDegrees(from, sample), legBearing, 1e-6, 'sample lies on the leg rhumb line')
  }
})

test('sampleRhumbLeg keeps an east-west leg on one parallel', () => {
  // A rhumb east-west leg is a parallel of latitude, so every sample shares the
  // start latitude. This is where it diverges from a great circle, which would
  // bow toward the pole.
  const from: Position = { latitude: 30, longitude: 0 }
  const to: Position = { latitude: 30, longitude: 4 }

  const samples = sampleRhumbLeg(from, to, rhumbDistanceMeters(from, to) / 5)

  assert.ok(samples.length > 0, 'a multi-degree east-west leg produces samples')
  for (const sample of samples) {
    assertClose(sample.latitude, 30, 1e-9, 'every east-west sample stays on the 30N parallel')
  }
  // The longitudes step evenly because the parallel has a uniform scale.
  for (let i = 1; i < samples.length; i += 1) {
    assertClose(
      samples[i].longitude - samples[i - 1].longitude,
      samples[1].longitude - samples[0].longitude,
      1e-9,
      'east-west samples step by an equal longitude increment'
    )
  }
})

test('sampleRhumbLeg samples a leg crossing the antimeridian', () => {
  // From 179 E to 179 W is two degrees across the 180 meridian. The samples
  // must walk across the seam, normalizing into [-180, 180], not the long way.
  const from: Position = { latitude: 0, longitude: 179 }
  const to: Position = { latitude: 0, longitude: -179 }
  const total = rhumbDistanceMeters(from, to)
  const spacing = total / 4

  const samples = sampleRhumbLeg(from, to, spacing)

  assert.equal(samples.length, 3, 'three interior samples across the seam')
  for (const sample of samples) {
    assert.ok(sample.longitude >= -180 && sample.longitude <= 180, `longitude ${sample.longitude} is normalized`)
    assertClose(sample.latitude, 0, 1e-9, 'the equatorial leg stays on the equator')
  }
  // The middle sample sits on the 180 meridian; either sign of 180 is valid.
  assertClose(Math.abs(samples[1].longitude), 180, 1e-9, 'the midpoint lands on the antimeridian')
  let previous = from
  for (const sample of samples) {
    assertClose(rhumbDistanceMeters(previous, sample), spacing, 1, 'each step across the seam is one spacing')
    previous = sample
  }
})

test('sampleRhumbLeg returns no interior points for a sub-spacing leg', () => {
  const from: Position = { latitude: 0, longitude: 0 }
  const to: Position = { latitude: 0, longitude: 0.001 }

  assert.deepEqual(sampleRhumbLeg(from, to, 1000), [], 'a leg shorter than one spacing has no interior samples')
})

test('sampleRhumbLeg rejects a non-positive spacing', () => {
  const from: Position = { latitude: 0, longitude: 0 }
  const to: Position = { latitude: 0, longitude: 1 }

  assert.throws(() => sampleRhumbLeg(from, to, 0), /finite positive/, 'a zero spacing throws')
  assert.throws(() => sampleRhumbLeg(from, to, -5), /finite positive/, 'a negative spacing throws')
  assert.throws(() => sampleRhumbLeg(from, to, Number.NaN), /finite positive/, 'a NaN spacing throws')
})

/**
 * Rhumb-line (constant) bearing from `from` to `to`, in degrees clockwise from
 * north. A local test helper used to assert samples lie on the leg's loxodrome;
 * the module under test does not export a bearing, only distance and samples.
 */
function rhumbBearingDegrees (from: Position, to: Position): number {
  const latitudeFrom = (from.latitude * Math.PI) / 180
  const latitudeTo = (to.latitude * Math.PI) / 180
  let deltaLongitude = ((to.longitude - from.longitude) * Math.PI) / 180
  if (Math.abs(deltaLongitude) > Math.PI) {
    deltaLongitude = deltaLongitude > 0 ? deltaLongitude - 2 * Math.PI : deltaLongitude + 2 * Math.PI
  }
  const deltaIsometricLatitude = Math.log(
    Math.tan(Math.PI / 4 + latitudeTo / 2) / Math.tan(Math.PI / 4 + latitudeFrom / 2)
  )
  return ((Math.atan2(deltaLongitude, deltaIsometricLatitude) * 180) / Math.PI + 360) % 360
}
