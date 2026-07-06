import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createLightListClient } from '../src/inputs/uscg-light-list/light-list-client.js'
import { startStubServer, type StubServer } from './helpers.js'

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
