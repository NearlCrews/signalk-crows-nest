import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createLightListClient } from '../src/inputs/uscg-light-list/light-list-client.js'
import { startJsonServer, startStubServer, type StubServer } from './helpers.js'

/**
 * A stub NAVCEN server that serves the district fixture with Last-Modified
 * and ETag headers, answering 304 when the request carries the matching
 * conditional headers. Thin adapter over the shared startStubServer.
 */
async function startFixtureServer (): Promise<StubServer> {
  const body = await readFile('test/fixtures/light-list-d01-1.geojson')
  return await startStubServer((req, res) => {
    const ifModifiedSince = req.headers['if-modified-since']
    const ifNoneMatch = req.headers['if-none-match']
    if (
      ifModifiedSince === 'Thu, 22 May 2026 09:26:29 GMT' ||
      ifNoneMatch === '"abc"'
    ) {
      res.statusCode = 304
      res.end()
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Last-Modified', 'Thu, 22 May 2026 09:26:29 GMT')
    res.setHeader('ETag', '"abc"')
    res.end(body)
  })
}

test('downloadDistrict parses the GeoJSON into LightListRecord values', async () => {
  const server = await startFixtureServer()
  try {
    const client = createLightListClient({ baseUrl: server.url })
    const result = await client.downloadDistrict('D01', 1)
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.ok(Array.isArray(result.records))
    // Asserting one-record-per-fixture-feature lets the fixture be refreshed
    // from a newer NAVCEN export without breaking the test for a non-bug.
    // The fixture currently has 5 features; this asserts whatever it has.
    const fixtureBody = await readFile('test/fixtures/light-list-d01-1.geojson', 'utf8')
    const expectedCount = (JSON.parse(fixtureBody) as { features: unknown[] }).features.length
    assert.equal(result.records.length, expectedCount)
    assert.ok(result.records.length > 0, 'the fixture carries at least one parseable record')
    const first = result.records[0]
    assert.equal(typeof first.llnr, 'number')
    assert.equal(typeof first.name, 'string')
    assert.equal(first.district, 'D01')
    assert.equal(first.volume, 1)
    assert.equal(first.source, 'usclightlist')
    const withRacon = result.records.find(r => r.racon !== undefined)
    assert.ok(withRacon !== undefined, 'expected at least one record with a racon')
    assert.equal(withRacon.racon, 'B')
    const withSound = result.records.find(r => r.soundEmitterType !== undefined)
    assert.ok(withSound !== undefined, 'expected at least one record with a sound emitter')
    assert.equal(result.headers.lastModified, 'Thu, 22 May 2026 09:26:29 GMT')
    assert.equal(result.headers.etag, '"abc"')
  } finally {
    await server.close()
  }
})

test('downloadDistrict returns "not-modified" on 304 conditional response', async () => {
  const server = await startFixtureServer()
  try {
    const client = createLightListClient({ baseUrl: server.url })
    const result = await client.downloadDistrict('D01', 1, {
      lastModified: 'Thu, 22 May 2026 09:26:29 GMT',
      etag: '"abc"'
    })
    assert.equal(result.status, 'not-modified')
    const lastRequest = server.requests.at(-1)
    assert.equal(lastRequest?.headers['if-modified-since'], 'Thu, 22 May 2026 09:26:29 GMT')
    assert.equal(lastRequest?.headers['if-none-match'], '"abc"')
  } finally {
    await server.close()
  }
})

test('downloadDistrict sends the descriptive User-Agent', async () => {
  const server = await startFixtureServer()
  try {
    const client = createLightListClient({ baseUrl: server.url })
    await client.downloadDistrict('D01', 1)
    const userAgent = server.requests.at(-1)?.headers['user-agent']
    assert.match(userAgent ?? '', /signalk-crows-nest/)
  } finally {
    await server.close()
  }
})

test('downloadDistrict keeps a page whose features only partly parse', async () => {
  // Dropping the features this parser cannot read is normal: the page is still
  // a good page, and every record that did parse must reach the store.
  const server = await startJsonServer({
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          LIGHT_LIST_NUMBER: 100,
          VOLUME_NUMBER: '01',
          NAME: 'Good Light',
          DECIMAL_LATITUDE: 42.1,
          DECIMAL_LONGITUDE: -70.9
        }
      },
      // Renamed coordinate keys: what an upstream schema change looks like.
      { properties: { LIGHT_LIST_NUMBER: 101, VOLUME_NUMBER: '01', LAT: 42.2, LON: -70.8 } },
      { properties: { LIGHT_LIST_NUMBER: 102, VOLUME_NUMBER: '01', LAT: 42.3, LON: -70.7 } }
    ]
  })
  try {
    const client = createLightListClient({ baseUrl: server.url })
    const result = await client.downloadDistrict('D01', 1)
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.records.length, 1)
  } finally {
    await server.close()
  }
})

test('downloadDistrict reports an error when a full page yields no record', async () => {
  // NAVCEN renames a property and every feature on a 200 stops parsing. The
  // source replaces a district page wholesale with what it is handed, so
  // reporting this as an empty page would drop every stored aid for the page
  // and take the proximity alarm quiet behind a green status row. Failing here
  // also leaves the stored validators alone, so the next tick re-requests the
  // page instead of being answered 304 against the unparseable one.
  const server = await startJsonServer({
    type: 'FeatureCollection',
    features: [
      { properties: { LIGHT_LIST_NUMBER: 100, VOLUME_NUMBER: '01', LAT: 42.1, LON: -70.9 } },
      { properties: { LIGHT_LIST_NUMBER: 101, VOLUME_NUMBER: '01', LAT: 42.2, LON: -70.8 } },
      { properties: { LIGHT_LIST_NUMBER: 102, VOLUME_NUMBER: '01', LAT: 42.3, LON: -70.7 } }
    ]
  })
  try {
    const client = createLightListClient({ baseUrl: server.url })
    const result = await client.downloadDistrict('D01', 1)
    assert.equal(result.status, 'error')
    if (result.status !== 'error') return
    assert.match(result.message, /3 features on the wire, none parseable/)
  } finally {
    await server.close()
  }
})

test('downloadDistrict reports an empty page as zero records, not an error', async () => {
  // A district page NAVCEN publishes with nothing on it is a legitimate answer
  // and must stay representable without an error, so a page that really did
  // empty still clears its stored aids.
  const server = await startJsonServer({ type: 'FeatureCollection', features: [] })
  try {
    const client = createLightListClient({ baseUrl: server.url })
    const result = await client.downloadDistrict('D01', 1)
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.records.length, 0)
  } finally {
    await server.close()
  }
})

test('downloadDistrict reports an error when the body carries no features array', async () => {
  // Valid JSON in an unexpected shape. Coercing the missing array to an empty
  // page told the refresh the district really had emptied, which wiped it.
  const server = await startJsonServer({ type: 'FeatureCollection', records: [] })
  try {
    const client = createLightListClient({ baseUrl: server.url })
    const result = await client.downloadDistrict('D01', 1)
    assert.equal(result.status, 'error')
    if (result.status !== 'error') return
    assert.match(result.message, /no GeoJSON features array/)
  } finally {
    await server.close()
  }
})
