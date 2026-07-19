import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveBbox, resolvePosition } from '../src/outputs/notes-resource/resource-query.js'

test('resolvePosition reads a latitude/longitude object', () => {
  assert.deepEqual(
    resolvePosition({ latitude: 25.77, longitude: -80.18 }),
    { latitude: 25.77, longitude: -80.18 }
  )
})

test('resolvePosition reads a [longitude, latitude] array', () => {
  assert.deepEqual(
    resolvePosition([-80.18, 25.77]),
    { latitude: 25.77, longitude: -80.18 }
  )
})

test('resolvePosition returns null for unusable input', () => {
  assert.equal(resolvePosition(undefined), null)
  assert.equal(resolvePosition(null), null)
  assert.equal(resolvePosition('25.77,-80.18'), null)
  assert.equal(resolvePosition([42]), null)
  assert.equal(resolvePosition(['x', 'y']), null)
  assert.equal(resolvePosition({ latitude: 25.77 }), null)
  assert.equal(resolvePosition({ latitude: 91, longitude: 0 }), null)
  assert.equal(resolvePosition({ latitude: 0, longitude: 181 }), null)
})

test('resolvePosition rejects blank, whitespace-only, or null components', () => {
  // Number('') and Number(null) both yield 0, so without an explicit guard a
  // blank component would coerce to a real coordinate of 0 (Null Island).
  assert.equal(resolvePosition({ latitude: '', longitude: '' }), null)
  assert.equal(resolvePosition({ latitude: '  ', longitude: '  ' }), null)
  assert.equal(resolvePosition({ latitude: null, longitude: null }), null)
  assert.equal(resolvePosition({ latitude: 25.77, longitude: '' }), null)
  assert.equal(resolvePosition(['', '']), null)
  assert.equal(resolvePosition(['  ', '  ']), null)
  assert.equal(resolvePosition([null, null]), null)
})

test('resolvePosition accepts genuine numeric strings, including "0"', () => {
  assert.deepEqual(
    resolvePosition({ latitude: '0', longitude: '0' }),
    { latitude: 0, longitude: 0 }
  )
  assert.deepEqual(
    resolvePosition({ latitude: '25.77', longitude: '-80.18' }),
    { latitude: 25.77, longitude: -80.18 }
  )
  assert.deepEqual(resolvePosition(['0', '0']), { latitude: 0, longitude: 0 })
})

test('resolveBbox derives a box from a position object and distance', () => {
  const bbox = resolveBbox({ position: { latitude: 25.77, longitude: -80.18 }, distance: 3000 })
  assert.ok(bbox !== null)
  assert.ok(bbox.north > bbox.south)
  assert.ok(bbox.east > bbox.west)
})

test('resolveBbox accepts the legacy array position form', () => {
  const bbox = resolveBbox({ position: [-80.18, 25.77], distance: 3000 })
  assert.ok(bbox !== null)
})

test('resolveBbox returns null when distance is missing, zero, or negative', () => {
  const position = { latitude: 25.77, longitude: -80.18 }
  assert.equal(resolveBbox({ position }), null)
  assert.equal(resolveBbox({ position, distance: 0 }), null)
  assert.equal(resolveBbox({ position, distance: -100 }), null)
  assert.equal(resolveBbox({ position, distance: 'far' }), null)
  assert.equal(resolveBbox({ position, distance: 1_000_001 }), null)
})

test('resolveBbox returns null when the position is missing or unusable', () => {
  assert.equal(resolveBbox({ distance: 3000 }), null)
  assert.equal(resolveBbox({ position: 'here', distance: 3000 }), null)
})

test('resolveBbox accepts an explicit bbox array', () => {
  // [minLongitude, minLatitude, maxLongitude, maxLatitude]
  const bbox = resolveBbox({ bbox: [-80.20, 25.70, -80.10, 25.85] })
  assert.deepEqual(bbox, { west: -80.20, south: 25.70, east: -80.10, north: 25.85 })
})

test('resolveBbox accepts an explicit bbox string, plain or bracketed', () => {
  const expected = { west: 5.4, south: 25.7, east: 6.9, north: 31.2 }
  assert.deepEqual(resolveBbox({ bbox: '5.4,25.7,6.9,31.2' }), expected)
  assert.deepEqual(resolveBbox({ bbox: '[5.4, 25.7, 6.9, 31.2]' }), expected)
})

test('resolveBbox returns null for a malformed bbox', () => {
  assert.equal(resolveBbox({ bbox: '1,2,3' }), null)
  assert.equal(resolveBbox({ bbox: [1, 2, 'x', 4] }), null)
  assert.equal(resolveBbox({ bbox: 42 }), null)
  assert.equal(resolveBbox({ bbox: [-181, 0, 1, 1] }), null)
  assert.equal(resolveBbox({ bbox: [-1, -91, 1, 1] }), null)
  assert.equal(resolveBbox({ bbox: [-1, 20, 1, 10] }), null)
})

test('resolveBbox rejects a bbox of blank or null components', () => {
  // `,,,` parses to four empty strings; Number('') is 0, so without a guard
  // this would resolve to the box {0,0,0,0} around Null Island.
  assert.equal(resolveBbox({ bbox: ',,,' }), null)
  assert.equal(resolveBbox({ bbox: ' , , , ' }), null)
  assert.equal(resolveBbox({ bbox: ['', '', '', ''] }), null)
  assert.equal(resolveBbox({ bbox: [1, 2, null, 4] }), null)
})

test('resolveBbox does not resolve a blank position to Null Island', () => {
  assert.equal(
    resolveBbox({ position: { latitude: '', longitude: '' }, distance: 3000 }),
    null
  )
  assert.equal(resolveBbox({ position: ['', ''], distance: 3000 }), null)
})

test('resolveBbox passes through an antimeridian-crossing bbox without reordering it', () => {
  // A vessel near 179.5 E in the Aleutians gets a viewport with east < west.
  // The bbox-string form is GeoJSON order [west, south, east, north]: the
  // resolver must preserve `east < west` so each downstream source can apply
  // its own wrapped-bbox handling, not normalize it to two boxes here.
  const wrap = resolveBbox({ bbox: '178.5,51,-178.5,53' })
  assert.notEqual(wrap, null)
  assert.equal(wrap?.west, 178.5)
  assert.equal(wrap?.east, -178.5)
  assert.equal(wrap?.south, 51)
  assert.equal(wrap?.north, 53)
})

test('resolveBbox preserves an antimeridian-crossing bbox supplied as an array', () => {
  const wrap = resolveBbox({ bbox: [178.5, 51, -178.5, 53] })
  assert.notEqual(wrap, null)
  assert.equal(wrap?.west, 178.5)
  assert.equal(wrap?.east, -178.5)
})

test('resolveBbox rejects an explicit bbox whose latitude span is too large', () => {
  assert.equal(resolveBbox({ bbox: [-10, -10.01, 10, 10] }), null)
  assert.equal(resolveBbox({ bbox: '-10,-10.01,10,10' }), null)
})

test('resolveBbox rejects ordinary and wrapped longitude spans over the limit', () => {
  assert.equal(resolveBbox({ bbox: [-10.01, -5, 10, 5] }), null)
  assert.equal(resolveBbox({ bbox: '169,-5,-170,5' }), null)
})

test('resolveBbox accepts a small wrapped explicit bbox', () => {
  assert.deepEqual(
    resolveBbox({ bbox: [179, -5, -179, 5] }),
    { west: 179, south: -5, east: -179, north: 5 }
  )
})

test('resolveBbox accepts ordinary and wrapped boxes at the span limit', () => {
  assert.deepEqual(
    resolveBbox({ bbox: [-10, -10, 10, 10] }),
    { west: -10, south: -10, east: 10, north: 10 }
  )
  assert.deepEqual(
    resolveBbox({ bbox: [170, -10, -170, 10] }),
    { west: 170, south: -10, east: -170, north: 10 }
  )
})

test('resolveBbox distinguishes a full-world box from a seam point', () => {
  assert.equal(resolveBbox({ bbox: [-180, -5, 180, 5] }), null)
  assert.deepEqual(
    resolveBbox({ bbox: [180, -5, -180, 5] }),
    { west: 180, south: -5, east: -180, north: 5 }
  )
})
