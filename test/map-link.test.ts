import test from 'node:test'
import assert from 'node:assert/strict'
import { openSeaMapMarkerUrl } from '../src/shared/map-link.js'

test('openSeaMapMarkerUrl builds a marker URL with lat, lon, mlat, and mlon', () => {
  const url = openSeaMapMarkerUrl(42.3601, -71.0589)
  assert.ok(url.startsWith('https://map.openseamap.org/?'))
  assert.ok(url.includes('lat=42.3601'))
  assert.ok(url.includes('lon=-71.0589'))
  assert.ok(url.includes('mlat=42.3601'))
  assert.ok(url.includes('mlon=-71.0589'))
  assert.ok(url.includes('zoom=15'))
})

test('openSeaMapMarkerUrl handles negative and zero coordinates', () => {
  const url = openSeaMapMarkerUrl(-33.8688, 151.2093)
  assert.ok(url.includes('lat=-33.8688'))
  assert.ok(url.includes('lon=151.2093'))
  const zero = openSeaMapMarkerUrl(0, 0)
  assert.ok(zero.includes('lat=0'))
  assert.ok(zero.includes('lon=0'))
})

test('a non-finite latitude falls back to the OpenSeaMap home page', () => {
  const url = openSeaMapMarkerUrl(Number.NaN, -71.0)
  assert.equal(url, 'https://map.openseamap.org/')
})

test('a non-finite longitude falls back to the OpenSeaMap home page', () => {
  const url = openSeaMapMarkerUrl(42.0, Number.POSITIVE_INFINITY)
  assert.equal(url, 'https://map.openseamap.org/')
})

test('out-of-range coordinates fall back to the OpenSeaMap home page', () => {
  assert.equal(openSeaMapMarkerUrl(91, 0), 'https://map.openseamap.org/')
  assert.equal(openSeaMapMarkerUrl(0, -181), 'https://map.openseamap.org/')
})

test('the marker URL does not encode hyphens or digits (they are URI-safe)', () => {
  // Sanity check that the helper does not over-encode numeric coordinates.
  const url = openSeaMapMarkerUrl(-33.8688, 151.2093)
  assert.ok(!url.includes('%2D'), 'hyphens are not percent-encoded')
  assert.ok(!url.includes('%2E'), 'decimal points are not percent-encoded')
})
