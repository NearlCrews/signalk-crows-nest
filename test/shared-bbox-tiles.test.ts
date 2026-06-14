import test from 'node:test'
import assert from 'node:assert/strict'
import { tileBbox } from '../src/shared/bbox-tiles.js'

test('a small bbox returns a single tile', () => {
  assert.equal(tileBbox({ south: 0, north: 1, west: 0, east: 1 }, 2).length, 1)
})

test('a 5x5 degree bbox tiles into 3x3 sub-boxes each within the span', () => {
  const tiles = tileBbox({ south: 0, north: 5, west: 0, east: 5 }, 2)
  assert.equal(tiles.length, 9)
  for (const t of tiles) {
    assert.ok(t.north - t.south <= 2 + 1e-9 && t.east - t.west <= 2 + 1e-9)
  }
})
