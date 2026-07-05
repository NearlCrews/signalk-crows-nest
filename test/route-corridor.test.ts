import test from 'node:test'
import assert from 'node:assert/strict'
import { scanRouteCorridor } from '../src/outputs/route-hazard/route-corridor.js'
import { distanceMeters, projectPointOntoLeg } from '../src/geo/position-utilities.js'
import type { Position, RoutePolyline } from '../src/shared/types.js'
import { poiSummary as poi } from './helpers.js'

/** Assert that two numbers are within `epsilon` of each other. */
function assertClose (actual: number, expected: number, epsilon: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${actual} to be within ${epsilon} of ${expected}`
  )
}

/** Build a route polyline ahead of the vessel from a list of waypoints. */
function routeAhead (waypoints: Position[], vesselPosition: Position | null = VESSEL): RoutePolyline {
  return { routeId: 'test-route', name: 'Test Route', vesselPosition, waypoints }
}

// The vessel sits at the origin. The route runs one degree of longitude due
// east along the equator, so the route's great circle is the equator and a
// point's cross-track distance is just its latitude offset, which makes the
// expected values easy to reason about. One degree of arc on the sphere this
// plugin uses is about 111194.9 meters.
const VESSEL: Position = { latitude: 0, longitude: 0 }
const ONE_DEGREE_ARC_METERS = 111194.9

test('scanRouteCorridor flags a hazard inside the corridor on the current leg', () => {
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }]),
    pois: [poi('1', 'Hazard', 'Shoal', { latitude: 0, longitude: 0.5 })],
    corridorHalfWidthMeters: 500
  })

  assert.equal(result.length, 1, 'the on-corridor hazard is flagged')
  assert.equal(result[0].id, '1')
  assert.equal(result[0].type, 'Hazard')
  assertClose(result[0].alongTrackDistanceMeters, ONE_DEGREE_ARC_METERS / 2, 5, 'along-track is half the leg')
  assertClose(result[0].crossTrackDistanceMeters, 0, 1e-3, 'a hazard on the route line has no cross-track offset')
  assert.equal(result[0].etaSeconds, undefined, 'no ETA without a speed over ground')
})

test('scanRouteCorridor flags Bridge and Lock points, not other types', () => {
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }]),
    pois: [
      poi('bridge', 'Bridge', 'Swing Bridge', { latitude: 0, longitude: 0.3 }),
      poi('lock', 'Lock', 'River Lock', { latitude: 0, longitude: 0.6 }),
      poi('marina', 'Marina', 'City Marina', { latitude: 0, longitude: 0.4 }),
      poi('anchorage', 'Anchorage', 'Quiet Bay', { latitude: 0, longitude: 0.7 })
    ],
    corridorHalfWidthMeters: 500
  })

  assert.deepEqual(result.map((entry) => entry.id), ['bridge', 'lock'], 'only Bridge and Lock are flagged')
})

test('scanRouteCorridor computes an ETA from the speed over ground', () => {
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }]),
    pois: [poi('1', 'Hazard', 'Shoal', { latitude: 0, longitude: 0.5 })],
    corridorHalfWidthMeters: 500,
    speedOverGround: 5
  })

  assert.equal(result.length, 1)
  assert.notEqual(result[0].etaSeconds, undefined, 'an ETA is produced when a speed is supplied')
  assertClose(
    result[0].etaSeconds as number,
    result[0].alongTrackDistanceMeters / 5,
    1e-6,
    'ETA is the along-track distance divided by the speed over ground'
  )
})

test('scanRouteCorridor omits the ETA when the speed over ground is zero or null', () => {
  for (const speedOverGround of [0, null]) {
    const result = scanRouteCorridor({
      route: routeAhead([{ latitude: 0, longitude: 1 }]),
      pois: [poi('1', 'Hazard', 'Shoal', { latitude: 0, longitude: 0.5 })],
      corridorHalfWidthMeters: 500,
      speedOverGround
    })

    assert.equal(result.length, 1)
    assert.equal(result[0].etaSeconds, undefined, `no ETA when the speed is ${String(speedOverGround)}`)
  }
})

test('scanRouteCorridor ignores a hazard outside the corridor width', () => {
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }]),
    // One degree of latitude north of the route: far outside a 500 m corridor.
    pois: [poi('1', 'Hazard', 'Distant Wreck', { latitude: 1, longitude: 0.5 })],
    corridorHalfWidthMeters: 500
  })

  assert.deepEqual(result, [], 'an off-corridor hazard is not flagged')
})

test('scanRouteCorridor ignores a hazard behind the vessel', () => {
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }]),
    // Half a degree west of the vessel: on the route line, but astern.
    pois: [poi('1', 'Hazard', 'Passed Shoal', { latitude: 0, longitude: -0.5 })],
    corridorHalfWidthMeters: 500
  })

  assert.deepEqual(result, [], 'a hazard astern of the vessel is not flagged')
})

test('scanRouteCorridor ignores a hazard beyond the end of the route', () => {
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }]),
    // Half a degree past the final waypoint: on the route line, but off route.
    pois: [poi('1', 'Hazard', 'Far Shoal', { latitude: 0, longitude: 1.5 })],
    corridorHalfWidthMeters: 500
  })

  assert.deepEqual(result, [], 'a hazard beyond the route end is not flagged')
})

test('scanRouteCorridor spans multiple legs and sorts nearest-first', () => {
  // Leg 0 runs east along the equator; leg 1 turns north up the meridian at
  // longitude 1. The first hazard sits on leg 0, the second halfway up leg 1.
  const result = scanRouteCorridor({
    route: routeAhead([
      { latitude: 0, longitude: 1 },
      { latitude: 0.5, longitude: 1 }
    ]),
    pois: [
      poi('far', 'Hazard', 'Second Leg Rock', { latitude: 0.25, longitude: 1 }),
      poi('near', 'Hazard', 'First Leg Rock', { latitude: 0, longitude: 0.5 })
    ],
    corridorHalfWidthMeters: 1000
  })

  assert.deepEqual(result.map((entry) => entry.id), ['near', 'far'], 'flagged nearest-first by along-track')
  assertClose(result[0].alongTrackDistanceMeters, ONE_DEGREE_ARC_METERS / 2, 5, 'leg 0 hazard along-track')
  assertClose(
    result[1].alongTrackDistanceMeters,
    ONE_DEGREE_ARC_METERS + ONE_DEGREE_ARC_METERS / 4,
    5,
    'leg 1 hazard along-track is the full first leg plus a quarter degree'
  )
})

test('scanRouteCorridor reports a hazard near a bend only once', () => {
  // Two collinear legs sharing the waypoint at longitude 1. A hazard exactly
  // on that waypoint falls in the corridor of both legs but must appear once.
  const result = scanRouteCorridor({
    route: routeAhead([
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 2 }
    ]),
    pois: [poi('1', 'Hazard', 'Junction Rock', { latitude: 0, longitude: 1 })],
    corridorHalfWidthMeters: 500
  })

  assert.equal(result.length, 1, 'a hazard matching two legs is reported once')
  assertClose(result[0].alongTrackDistanceMeters, ONE_DEGREE_ARC_METERS, 5, 'reported at its nearest projection')
})

test('scanRouteCorridor reports the nearer leg when a POI projects onto two legs at a bend', () => {
  // Leg 0 runs east along the equator to the bend at longitude 1; leg 1 turns
  // due north up that meridian. The hazard sits just inside the corner: it
  // falls in the corridor of both legs but lies much closer to leg 1. The scan
  // records leg 0 first, then must replace it with the nearer leg-1 projection.
  const bend: Position = { latitude: 0, longitude: 1 }
  const end: Position = { latitude: 1, longitude: 1 }
  const poiPos: Position = { latitude: 0.005, longitude: 0.999 }
  const result = scanRouteCorridor({
    route: routeAhead([bend, end]),
    pois: [poi('bend', 'Hazard', 'Corner Rock', poiPos)],
    corridorHalfWidthMeters: 1000
  })

  const legLength0 = distanceMeters(VESSEL, bend)
  const leg0 = projectPointOntoLeg(VESSEL, bend, poiPos)
  const leg1 = projectPointOntoLeg(bend, end, poiPos)
  // The fixture is only meaningful if the later leg is the nearer one, so the
  // replacement branch is exercised rather than the keep-existing branch.
  assert.ok(
    Math.abs(leg1.crossTrackMeters) < Math.abs(leg0.crossTrackMeters),
    'fixture: leg 1 passes nearer the hazard than leg 0'
  )

  assert.equal(result.length, 1, 'the bend hazard is reported once')
  assertClose(result[0].crossTrackDistanceMeters, leg1.crossTrackMeters, 1e-6, 'the nearer leg-1 cross-track is reported')
  assertClose(
    result[0].alongTrackDistanceMeters,
    legLength0 + leg1.alongTrackMeters,
    1e-6,
    'along-track is the full first leg plus the leg-1 projection'
  )
})

test('scanRouteCorridor keeps the earlier projection when two legs tie on cross-track', () => {
  // The route runs east to longitude 2, then doubles back west to longitude 1.
  // A hazard on the equator at longitude 1.5 sits exactly on both legs, so the
  // cross-track is zero on each. The equal-cross-track tiebreaker then keeps the
  // earlier, shorter along-track projection.
  const result = scanRouteCorridor({
    route: routeAhead([
      { latitude: 0, longitude: 2 },
      { latitude: 0, longitude: 1 }
    ]),
    pois: [poi('tie', 'Hazard', 'Doubled-back Rock', { latitude: 0, longitude: 1.5 })],
    corridorHalfWidthMeters: 500
  })

  assert.equal(result.length, 1, 'the hazard is reported once despite matching two legs')
  assertClose(result[0].crossTrackDistanceMeters, 0, 1e-3, 'a hazard on the route line has no cross-track offset')
  assertClose(
    result[0].alongTrackDistanceMeters,
    1.5 * ONE_DEGREE_ARC_METERS,
    5,
    'the earlier, shorter along-track projection wins the cross-track tie'
  )
})

test('scanRouteCorridor keeps along-track correct past a duplicate (zero-length) waypoint', () => {
  // The route repeats the waypoint at longitude 1, so the middle leg is
  // zero-length. That leg is skipped without advancing the along-track
  // accumulator, so a hazard on the leg beyond the duplicate still reports the
  // true distance along the route.
  const result = scanRouteCorridor({
    route: routeAhead([
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 2 }
    ]),
    pois: [
      poi('after', 'Hazard', 'Beyond Rock', { latitude: 0, longitude: 1.5 }),
      poi('before', 'Hazard', 'Near Rock', { latitude: 0, longitude: 0.5 })
    ],
    corridorHalfWidthMeters: 500
  })

  assert.deepEqual(result.map((entry) => entry.id), ['before', 'after'], 'nearest-first, the degenerate leg skipped')
  assertClose(result[0].alongTrackDistanceMeters, ONE_DEGREE_ARC_METERS / 2, 5, 'the leg-0 hazard along-track')
  assertClose(
    result[1].alongTrackDistanceMeters,
    ONE_DEGREE_ARC_METERS + ONE_DEGREE_ARC_METERS / 2,
    5,
    'the duplicate waypoint adds no distance, so the far hazard is one and a half legs along'
  )
})

test('scanRouteCorridor measures from the first waypoint when there is no vessel fix', () => {
  // With no fix the legs run waypoint to waypoint, so along-track is measured
  // from the first waypoint rather than the vessel.
  const result = scanRouteCorridor({
    route: routeAhead(
      [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }],
      null
    ),
    pois: [poi('1', 'Hazard', 'Shoal', { latitude: 0, longitude: 0.5 })],
    corridorHalfWidthMeters: 500
  })

  assert.equal(result.length, 1, 'the hazard is flagged with no vessel fix')
  assertClose(
    result[0].alongTrackDistanceMeters,
    ONE_DEGREE_ARC_METERS / 2,
    5,
    'along-track is measured from the first waypoint'
  )
})

test('scanRouteCorridor returns an empty list when the route has no leg', () => {
  // A single waypoint and no vessel fix yields no leg to scan.
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }], null),
    pois: [poi('1', 'Hazard', 'Shoal', { latitude: 0, longitude: 0.5 })],
    corridorHalfWidthMeters: 500
  })

  assert.deepEqual(result, [], 'no leg means nothing to scan')
})

test('scanRouteCorridor returns an empty list for a non-positive corridor width', () => {
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }]),
    pois: [poi('1', 'Hazard', 'Shoal', { latitude: 0, longitude: 0.5 })],
    corridorHalfWidthMeters: 0
  })

  assert.deepEqual(result, [], 'a zero-width corridor flags nothing')
})

test('scanRouteCorridor returns an empty list for a non-finite corridor width', () => {
  // NaN fails every comparison, so it must be rejected up front: otherwise the
  // cross-track filter `abs(crossTrack) > NaN` is always false and every point
  // in the box is flagged regardless of how far it sits from the route.
  const result = scanRouteCorridor({
    route: routeAhead([{ latitude: 0, longitude: 1 }]),
    pois: [poi('far', 'Hazard', 'Distant rock', { latitude: 0.5, longitude: 0.5 })],
    corridorHalfWidthMeters: Number.NaN
  })

  assert.deepEqual(result, [], 'a non-finite corridor width flags nothing')
})
