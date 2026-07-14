import test from 'node:test'
import assert from 'node:assert/strict'
import {
  arcgisByIdParams,
  arcgisEnvelopeParams,
  splitArcgisEnvelope
} from '../src/inputs/arcgis-query.js'

test('splitArcgisEnvelope leaves an ordinary bbox intact', () => {
  const bbox = { south: 40, west: -75, north: 42, east: -73 }
  assert.deepEqual(splitArcgisEnvelope(bbox), [bbox])
})

test('splitArcgisEnvelope rejects invalid coordinate ranges and latitude order', () => {
  assert.throws(
    () => splitArcgisEnvelope({ south: -91, west: 0, north: 1, east: 2 }),
    /invalid bounding box/
  )
  assert.throws(
    () => splitArcgisEnvelope({ south: 2, west: 0, north: 1, east: 2 }),
    /invalid bounding box/
  )
})

test('arcgisEnvelopeParams rejects a wrapped bbox that was not split', () => {
  assert.throws(
    () => arcgisEnvelopeParams({ south: 40, west: 170, north: 42, east: -170 }, 0),
    /must not cross the antimeridian/
  )
})

test('ArcGIS parameter builders reject invalid paging and object ids', () => {
  const bbox = { south: 40, west: -75, north: 42, east: -73 }
  assert.throws(
    () => arcgisEnvelopeParams(bbox, -1),
    /result offset must be a non-negative safe integer/
  )
  assert.throws(
    () => arcgisEnvelopeParams(bbox, Number.NaN),
    /result offset must be a non-negative safe integer/
  )
  assert.throws(
    () => arcgisByIdParams(0),
    /object id must be a positive safe integer/
  )
  assert.throws(
    () => arcgisByIdParams(1.5),
    /object id must be a positive safe integer/
  )
})
