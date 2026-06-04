import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_OVERPASS_ENDPOINT,
  RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS,
  normalizeFallbackEndpoints
} from '../src/shared/overpass-endpoints.js'

test('the default endpoint is the FOSSGIS main instance', () => {
  assert.equal(DEFAULT_OVERPASS_ENDPOINT, 'https://overpass-api.de/api/interpreter')
})

test('the recommended fallbacks are full-planet mirrors and exclude regional extracts', () => {
  assert.ok(RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS.length >= 1)
  // osm.ch is a Switzerland-only extract: it must never be suggested as a
  // worldwide fallback because it answers a non-Swiss bbox with zero elements.
  for (const endpoint of RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS) {
    assert.ok(!endpoint.includes('osm.ch'), 'osm.ch is regional and must not be a recommended fallback')
  }
})

test('normalizeFallbackEndpoints trims, drops blanks and non-strings, and dedupes in order', () => {
  assert.deepEqual(
    normalizeFallbackEndpoints([' https://a.test/api ', '', '   ', 'https://a.test/api', 'https://b.test/api', 7, null]),
    ['https://a.test/api', 'https://b.test/api']
  )
})

test('normalizeFallbackEndpoints returns an empty list for a non-array value', () => {
  assert.deepEqual(normalizeFallbackEndpoints(undefined), [])
  assert.deepEqual(normalizeFallbackEndpoints('https://a.test/api'), [])
  assert.deepEqual(normalizeFallbackEndpoints(null), [])
})
