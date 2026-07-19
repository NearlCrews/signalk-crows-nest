import test from 'node:test'
import assert from 'node:assert/strict'
import { bboxContainsPoint, positionToBbox, projectPointOntoLeg, unionBbox } from '../src/geo/position-utilities.js'
import type { Bbox, Position } from '../src/shared/types.js'

/** Assert that two numbers are within `epsilon` of each other. */
function assertClose (actual: number, expected: number, epsilon: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${actual} to be within ${epsilon} of ${expected}`
  )
}

test('positionToBbox encloses the search radius on every cardinal edge', () => {
  // Center on the origin so the great-circle projection is symmetric. The box
  // must enclose the search circle, so each cardinal edge sits at the full
  // search radius from the center. For a 10 km radius that is about 0.0899317
  // degrees (10 km / 6371 km, converted to degrees), not the smaller value an
  // inscribed box would give.
  const bbox = positionToBbox({ latitude: 0, longitude: 0 }, 10000)

  assertClose(bbox.north, 0.0899317, 1e-4, 'north edge')
  assertClose(bbox.south, -0.0899317, 1e-4, 'south edge')
  assertClose(bbox.east, 0.0899317, 1e-4, 'east edge')
  assertClose(bbox.west, -0.0899317, 1e-4, 'west edge')
})

test('positionToBbox orders the edges around the center', () => {
  const center: Position = { latitude: 45, longitude: -122 }
  const bbox = positionToBbox(center, 5000)

  assert.ok(bbox.north > center.latitude, 'north edge is above the center')
  assert.ok(bbox.south < center.latitude, 'south edge is below the center')
  assert.ok(bbox.east > center.longitude, 'east edge is right of the center')
  assert.ok(bbox.west < center.longitude, 'west edge is left of the center')
})

test('positionToBbox is symmetric about a position on the equator and prime meridian', () => {
  // At the origin the projection is exactly symmetric, so opposite edges
  // should mirror each other.
  const bbox = positionToBbox({ latitude: 0, longitude: 0 }, 25000)

  assertClose(bbox.north, -bbox.south, 1e-9, 'north and south mirror each other')
  assertClose(bbox.east, -bbox.west, 1e-9, 'east and west mirror each other')
})

test('positionToBbox handles a position on the equator', () => {
  const bbox = positionToBbox({ latitude: 0, longitude: -40 }, 8000)

  // The center latitude is 0, so the box straddles the equator.
  assert.ok(bbox.north > 0, 'north edge crosses into the northern hemisphere')
  assert.ok(bbox.south < 0, 'south edge crosses into the southern hemisphere')
  assertClose(bbox.north, -bbox.south, 1e-9, 'box is symmetric across the equator')
  assertClose((bbox.east + bbox.west) / 2, -40, 1e-9, 'box stays centered on longitude -40')
})

test('positionToBbox handles a position on the prime meridian', () => {
  const bbox = positionToBbox({ latitude: 50, longitude: 0 }, 8000)

  // The center longitude is 0, so the box straddles the prime meridian.
  assert.ok(bbox.east > 0, 'east edge crosses into positive longitude')
  assert.ok(bbox.west < 0, 'west edge crosses into negative longitude')
  // Longitude is only exactly symmetric on the equator: away from it the
  // great-circle projection skews the two corners slightly, so the east and
  // west edges should mirror each other only approximately.
  assertClose(bbox.east, -bbox.west, 1e-3, 'box is roughly symmetric across the prime meridian')
})

test('positionToBbox normalizes longitude near the antimeridian', () => {
  // Close to the 180 meridian the eastern corner projects past 180 degrees.
  // The result must wrap back into the canonical [-180, 180] range rather
  // than reporting something like 181.
  const bbox = positionToBbox({ latitude: 0, longitude: 179.95 }, 10000)

  for (const [edge, value] of [['east', bbox.east], ['west', bbox.west]] as const) {
    assert.ok(value >= -180 && value <= 180, `${edge} longitude ${value} is within [-180, 180]`)
  }

  // The eastern corner has crossed the antimeridian, so it wraps to a
  // negative longitude while the western corner stays just below 180.
  assert.ok(bbox.east < 0, 'east edge wrapped to a negative longitude')
  assert.ok(bbox.west > 179, 'west edge stayed just west of the antimeridian')
})

test('positionToBbox grows the box as the distance increases', () => {
  const center: Position = { latitude: 10, longitude: 20 }
  const small = positionToBbox(center, 1000)
  const large = positionToBbox(center, 50000)

  assert.ok(large.north - large.south > small.north - small.south, 'taller box for a larger distance')
  assert.ok(large.east - large.west > small.east - small.west, 'wider box for a larger distance')
})

test('positionToBbox returns a zero-size box for a zero distance', () => {
  const center: Position = { latitude: 12.34, longitude: -56.78 }
  const bbox = positionToBbox(center, 0)

  assertClose(bbox.north, center.latitude, 1e-9, 'north collapses onto the center')
  assertClose(bbox.south, center.latitude, 1e-9, 'south collapses onto the center')
  assertClose(bbox.east, center.longitude, 1e-9, 'east collapses onto the center')
  assertClose(bbox.west, center.longitude, 1e-9, 'west collapses onto the center')
})

test('positionToBbox rejects finite coordinates outside geographic ranges', () => {
  assert.throws(
    () => positionToBbox({ latitude: 91, longitude: 0 }, 1000),
    /invalid coordinate/
  )
  assert.throws(
    () => positionToBbox({ latitude: 0, longitude: -181 }, 1000),
    /invalid coordinate/
  )
})

test('unionBbox encloses ordinary overlapping boxes', () => {
  assert.deepEqual(
    unionBbox(
      { north: 11, south: 10, west: 20, east: 22 },
      { north: 10, south: 9, west: 21, east: 24 }
    ),
    { north: 11, south: 9, west: 20, east: 24 }
  )
})

test('unionBbox preserves the shortest interval across the antimeridian', () => {
  assert.deepEqual(
    unionBbox(
      { north: 53, south: 51, west: 175, east: -175 },
      { north: 54, south: 52, west: 178, east: -170 }
    ),
    { north: 54, south: 51, west: 175, east: -170 }
  )
})

test('unionBbox joins boxes on opposite sides of the antimeridian narrowly', () => {
  assert.deepEqual(
    unionBbox(
      { north: 2, south: 0, west: 179, east: 180 },
      { north: 3, south: 1, west: -180, east: -179 }
    ),
    { north: 3, south: 0, west: 179, east: -179 }
  )
})

test('unionBbox retains the full-world and zero-width seam conventions', () => {
  const local: Bbox = { north: 1, south: -1, west: 10, east: 20 }
  assert.deepEqual(
    unionBbox({ north: 90, south: -90, west: -180, east: 180 }, local),
    { north: 90, south: -90, west: -180, east: 180 }
  )
  assert.deepEqual(
    unionBbox(
      { north: 1, south: -1, west: 180, east: -180 },
      { north: 2, south: -2, west: -180, east: -180 }
    ),
    { north: 2, south: -2, west: 180, east: -180 }
  )
})

test('unionBbox rejects a non-finite edge', () => {
  assert.throws(
    () => unionBbox(
      { north: 1, south: -1, west: 10, east: Number.NaN },
      { north: 1, south: -1, west: 10, east: 20 }
    ),
    /non-finite edge/
  )
})

test('bboxContainsPoint includes and excludes points around a non-wrapping box', () => {
  const bbox: Bbox = { north: 43, south: 41, east: -70, west: -72 }

  assert.ok(bboxContainsPoint(bbox, -71, 42), 'a point inside is contained')
  assert.ok(!bboxContainsPoint(bbox, -69, 42), 'a point east of the box is excluded')
  assert.ok(!bboxContainsPoint(bbox, -73, 42), 'a point west of the box is excluded')
  assert.ok(!bboxContainsPoint(bbox, -71, 44), 'a point north of the box is excluded')
  assert.ok(!bboxContainsPoint(bbox, -71, 40), 'a point south of the box is excluded')
})

test('bboxContainsPoint counts the box edges as inside', () => {
  const bbox: Bbox = { north: 10, south: -10, east: 20, west: -20 }

  assert.ok(bboxContainsPoint(bbox, -20, -10), 'the south-west corner is contained')
  assert.ok(bboxContainsPoint(bbox, 20, 10), 'the north-east corner is contained')
})

test('bboxContainsPoint wraps across the antimeridian when west exceeds east', () => {
  // A viewport in the western Aleutians straddling +/-180: west 170, east -170.
  const bbox: Bbox = { north: 55, south: 50, east: -170, west: 170 }

  assert.ok(bboxContainsPoint(bbox, 179, 52), 'a point just west of 180 is contained')
  assert.ok(bboxContainsPoint(bbox, -179, 52), 'a point just east of -180 is contained')
  assert.ok(bboxContainsPoint(bbox, 175, 52), 'a point at the western edge is contained')
  assert.ok(!bboxContainsPoint(bbox, 0, 52), 'a point on the far side of the globe is excluded')
  assert.ok(!bboxContainsPoint(bbox, 179, 40), 'a latitude outside the box is excluded even in the wrap span')
})

test('bboxContainsPoint treats both antimeridian spellings as the zero-width seam', () => {
  const seam: Bbox = { north: 1, south: -1, west: 180, east: -180 }

  assert.ok(bboxContainsPoint(seam, 180, 0))
  assert.ok(bboxContainsPoint(seam, -180, 0))
  assert.ok(!bboxContainsPoint(seam, 179.999, 0))
  assert.ok(!bboxContainsPoint(seam, -179.999, 0))
})

// An eastward leg one degree of longitude long, on the equator. Its great
// circle is the equator itself, so a point's cross-track distance is just its
// latitude offset, which makes the expected values easy to reason about. One
// degree of arc on the sphere this module uses is about 111194.9 meters.
const EQUATOR_LEG_START: Position = { latitude: 0, longitude: 0 }
const EQUATOR_LEG_END: Position = { latitude: 0, longitude: 1 }
const ONE_DEGREE_ARC_METERS = 111194.9

test('projectPointOntoLeg projects a point lying on the leg', () => {
  const projection = projectPointOntoLeg(EQUATOR_LEG_START, EQUATOR_LEG_END, { latitude: 0, longitude: 0.5 })

  assertClose(projection.crossTrackMeters, 0, 1e-3, 'a point on the leg has no cross-track offset')
  assertClose(projection.alongTrackMeters, ONE_DEGREE_ARC_METERS / 2, 1, 'along-track is half the leg length')
})

test('projectPointOntoLeg returns zero for a point at the leg start', () => {
  const projection = projectPointOntoLeg(EQUATOR_LEG_START, EQUATOR_LEG_END, EQUATOR_LEG_START)

  assertClose(projection.crossTrackMeters, 0, 1e-6, 'the start point has no cross-track offset')
  assertClose(projection.alongTrackMeters, 0, 1e-6, 'the start point has no along-track distance')
})

test('projectPointOntoLeg reports a negative along-track distance behind the leg start', () => {
  const projection = projectPointOntoLeg(EQUATOR_LEG_START, EQUATOR_LEG_END, { latitude: 0, longitude: -0.5 })

  assertClose(projection.crossTrackMeters, 0, 1e-3, 'a point on the leg line has no cross-track offset')
  assert.ok(projection.alongTrackMeters < 0, 'a point behind the start has a negative along-track distance')
  assertClose(projection.alongTrackMeters, -ONE_DEGREE_ARC_METERS / 2, 1, 'along-track magnitude is half the leg length')
})

test('projectPointOntoLeg reports an along-track distance beyond the leg end', () => {
  const projection = projectPointOntoLeg(EQUATOR_LEG_START, EQUATOR_LEG_END, { latitude: 0, longitude: 1.5 })

  assertClose(projection.crossTrackMeters, 0, 1e-3, 'a point on the leg line has no cross-track offset')
  assert.ok(
    projection.alongTrackMeters > ONE_DEGREE_ARC_METERS,
    'a point past the end has an along-track distance beyond the leg length'
  )
})

test('projectPointOntoLeg signs the cross-track offset by side of travel', () => {
  // The leg runs due east, so a point to the north is on the left and a point
  // to the south is on the right of the direction of travel.
  const north = projectPointOntoLeg(EQUATOR_LEG_START, EQUATOR_LEG_END, { latitude: 0.05, longitude: 0.5 })
  const south = projectPointOntoLeg(EQUATOR_LEG_START, EQUATOR_LEG_END, { latitude: -0.05, longitude: 0.5 })

  assert.ok(north.crossTrackMeters < 0, 'a point left of the eastward leg has a negative cross-track offset')
  assert.ok(south.crossTrackMeters > 0, 'a point right of the eastward leg has a positive cross-track offset')
  assertClose(
    Math.abs(north.crossTrackMeters),
    ONE_DEGREE_ARC_METERS * 0.05,
    5,
    'cross-track magnitude matches the 0.05 degree latitude offset'
  )
  assertClose(north.crossTrackMeters, -south.crossTrackMeters, 5, 'the two offsets mirror each other')
})
