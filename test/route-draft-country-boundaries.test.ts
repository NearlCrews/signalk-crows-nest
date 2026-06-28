import test from 'node:test'
import assert from 'node:assert/strict'
import { countryBoundariesFrom, loadCountryBoundaries } from '../src/route-draft/country-boundaries.js'

// Two countries split at lon 0. AAA (west) has an open-water hole and a hole where BBB has an exclave;
// BBB (east) is a multipolygon: its east square plus that exclave inside AAA's territory.
const AAA_OUTER = [[-2, -2], [0, -2], [0, 2], [-2, 2], [-2, -2]]
const HOLE_OPEN = [[-1.3, -1.3], [-0.7, -1.3], [-0.7, -0.7], [-1.3, -0.7], [-1.3, -1.3]]
const EXCLAVE = [[-1.7, 1.3], [-1.3, 1.3], [-1.3, 1.7], [-1.7, 1.7], [-1.7, 1.3]]
const BBB_MAIN = [[0, -2], [2, -2], [2, 2], [0, 2], [0, -2]]

const FIXTURE = [
  {
    properties: { id: 'AAA', name: 'Aaa' },
    geometry: { type: 'Polygon', coordinates: [AAA_OUTER, HOLE_OPEN, EXCLAVE] },
  },
  {
    properties: { id: 'BBB', name: 'Bbb' },
    geometry: { type: 'MultiPolygon', coordinates: [[BBB_MAIN], [EXCLAVE]] },
  },
]

test('classify attributes a point to its country', () => {
  const b = countryBoundariesFrom(FIXTURE)
  // The fixture carries no sovId, so it falls back to the unit id (correct for a sovereign mainland state).
  assert.deepEqual(b.classify({ latitude: 0, longitude: -0.5 }), { id: 'AAA', name: 'Aaa', sovId: 'AAA' })
  assert.equal(b.classify({ latitude: 0, longitude: 1 })?.id, 'BBB')
})

test('classify returns undefined inside a hole and outside every country', () => {
  const b = countryBoundariesFrom(FIXTURE)
  assert.equal(b.classify({ latitude: -1, longitude: -1 }), undefined) // open-water hole in AAA
  assert.equal(b.classify({ latitude: 5, longitude: 5 }), undefined) // open water
})

test('classify resolves an exclave to its true country, not the surrounding one', () => {
  const b = countryBoundariesFrom(FIXTURE)
  // The exclave sits inside AAA's outer ring, but AAA has a hole there and BBB has the polygon.
  assert.equal(b.classify({ latitude: 1.5, longitude: -1.5 })?.id, 'BBB')
})

test('foreignRings returns only the polygons overlapping the bbox, by their own bbox', () => {
  const b = countryBoundariesFrom(FIXTURE)
  // This window overlaps BBB's main square but not its far exclave, so only the main square returns.
  const rings = b.foreignRings('AAA', { west: 0.5, south: -1, east: 1.5, north: 1 })
  assert.equal(rings.length, 1)
  assert.ok(rings[0].rings[0].some(([x]) => x === 2))
})

test('foreignRings includes a neighbor whose bbox straddles the query window', () => {
  const b = countryBoundariesFrom(FIXTURE)
  // A window straddling the lon-0 border, home BBB: AAA partially overlaps and is returned.
  const rings = b.foreignRings('BBB', { west: -0.5, south: -1, east: 0.5, north: 1 })
  assert.equal(rings.length, 1)
  assert.ok(rings[0].rings[0].some(([x]) => x === -2)) // AAA's western edge
})

test('foreignRings is empty when no other country overlaps the bbox', () => {
  const b = countryBoundariesFrom(FIXTURE)
  assert.deepEqual(b.foreignRings('AAA', { west: 10, south: 10, east: 11, north: 11 }), [])
})

test('foreignRings excludes the home country', () => {
  const b = countryBoundariesFrom(FIXTURE)
  const rings = b.foreignRings('AAA', { west: -2, south: -2, east: 2, north: 2 })
  // Both of BBB's polygons, and nothing of AAA (AAA's outer reaches lon -2, which BBB never does).
  assert.equal(rings.length, 2)
  assert.ok(!rings.some((r) => r.rings[0].some(([x]) => x === -2)))
})

test('homeForRoute returns the sovereign alpha-3, not the admin-0 unit code, for a territory', () => {
  // Two points inside Puerto Rico (admin-0 unit PRI, sovereign USA).
  const b = countryBoundariesFrom([{
    properties: { id: 'PRI', sovId: 'USA', name: 'Puerto Rico' },
    geometry: { type: 'Polygon', coordinates: [[[-67.3, 17.9], [-65.2, 17.9], [-65.2, 18.5], [-67.3, 18.5], [-67.3, 17.9]]] },
  }])
  const home = b.homeForRoute({ latitude: 18.2, longitude: -66.5 }, { latitude: 18.3, longitude: -66.0 })
  assert.equal(home?.id, 'PRI') // unit code unchanged for classify and display
  assert.equal(home?.sovId, 'USA') // sovereign code is what crosses to the container as homeCountryId
  assert.match(home?.sovId ?? '', /^[A-Z]{3}$/)
})

test('homeForRoute returns the shared country, or undefined when the endpoints differ', () => {
  const b = countryBoundariesFrom(FIXTURE)
  assert.equal(b.homeForRoute({ latitude: 0, longitude: -0.5 }, { latitude: 0, longitude: -1.5 })?.id, 'AAA')
  assert.equal(b.homeForRoute({ latitude: 0, longitude: -0.5 }, { latitude: 0, longitude: 1 }), undefined) // AAA to BBB
  assert.equal(b.homeForRoute({ latitude: 0, longitude: -0.5 }, { latitude: 5, longitude: 5 }), undefined) // AAA to open water
})

test('an empty or malformed feature set degrades to a no-op service', () => {
  const b = countryBoundariesFrom([])
  assert.equal(b.classify({ latitude: 0, longitude: 0 }), undefined)
  assert.deepEqual(b.foreignRings('AAA', { west: -1, south: -1, east: 1, north: 1 }), [])
})

test('the bundled asset loads and splits the Detroit River', () => {
  const b = loadCountryBoundaries()
  assert.equal(b.classify({ latitude: 42.331, longitude: -83.045 })?.id, 'USA') // Detroit
  assert.equal(b.classify({ latitude: 42.309, longitude: -83.02 })?.id, 'CAN') // Windsor
  const rings = b.foreignRings('USA', { west: -83.3, south: 41.98, east: -82.83, north: 42.49 })
  assert.ok(rings.length > 0) // Canada's water is present to block for a US route
})
