import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_OVERPASS_ENDPOINT,
  RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS,
  normalizeFallbackEndpoints,
  resolvePrimaryEndpoint
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

test('Overpass endpoint normalization accepts only absolute HTTP and HTTPS URLs', () => {
  assert.equal(resolvePrimaryEndpoint(' http://localhost:8080/api '), 'http://localhost:8080/api')
  assert.equal(resolvePrimaryEndpoint('https://10.0.0.2/api'), 'https://10.0.0.2/api')
  for (const endpoint of ['file:///tmp/query', 'data:text/plain,query', 'relative/api', 'https://user:secret@example.test/api']) {
    assert.equal(resolvePrimaryEndpoint(endpoint), DEFAULT_OVERPASS_ENDPOINT, endpoint)
  }

  assert.deepEqual(
    normalizeFallbackEndpoints([
      'https://mirror.example.test/api',
      'file:///tmp/query',
      'relative/api',
      'http://localhost:8080/api',
      'https://mirror.example.test/api'
    ]),
    ['https://mirror.example.test/api', 'http://localhost:8080/api']
  )
})
