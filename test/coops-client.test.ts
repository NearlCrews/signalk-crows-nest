/**
 * Tests for the NOAA CO-OPS mdapi HTTP client.
 *
 * The client fetches one station-type list, parses each wire station into a
 * CoopsStationRecord, and supports a best-effort conditional GET. The tests run
 * against a local node:http fixture server (the one-shot transport uses
 * node:http, not global fetch) so the request headers and the parsed records
 * can both be asserted.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { createCoopsClient } from '../src/inputs/noaa-coops/coops-client.js'
import { startJsonServer, startStubServer, type StubServer } from './helpers.js'

const LAST_MODIFIED = 'Thu, 22 May 2026 09:26:29 GMT'
const ETAG = '"coops-abc"'

const WATERLEVELS_BODY = JSON.stringify({
  count: 2,
  units: null,
  stations: [
    { id: '8447386', name: 'Fall River', lat: 41.7043, lng: -71.1641, state: 'MA', timezone: 'LST/LDT' },
    // A blank name and an out-of-range coordinate exercise the fallback and the drop.
    { id: '8443970', name: '', lat: 42.3539, lng: -71.0503, state: 'MA' },
    { id: 'bad', name: 'No Position', lat: 999, lng: 0 }
  ]
})

function startFixtureServer (): Promise<StubServer> {
  return startStubServer((req, res) => {
    if (req.headers['if-modified-since'] === LAST_MODIFIED || req.headers['if-none-match'] === ETAG) {
      res.statusCode = 304
      res.end()
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Last-Modified', LAST_MODIFIED)
    res.setHeader('ETag', ETAG)
    res.end(WATERLEVELS_BODY)
  })
}

test('downloadStations parses the mdapi JSON into CoopsStationRecord values', async () => {
  const server = await startFixtureServer()
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    const result = await client.downloadStations('tide')
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    // The out-of-range station is dropped; the blank-name station is kept with a
    // synthesized title.
    assert.equal(result.records.length, 2)
    const first = result.records[0]
    assert.equal(first.id, '8447386')
    assert.equal(first.stationType, 'tide')
    assert.equal(first.name, 'Fall River')
    assert.equal(first.state, 'MA')
    assert.equal(first.timezone, 'LST/LDT')
    assert.deepEqual(first.position, { latitude: 41.7043, longitude: -71.1641 })
    assert.equal(first.source, 'noaacoops')
    const synthesized = result.records[1]
    assert.equal(synthesized.name, 'Station 8443970')
    assert.equal(result.headers.lastModified, LAST_MODIFIED)
    assert.equal(result.headers.etag, ETAG)
  } finally {
    await server.close()
  }
})

test('downloadStations requests the type-specific mdapi endpoint', async () => {
  const server = await startFixtureServer()
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    await client.downloadStations('tide')
    assert.match(server.requests.at(-1)?.url ?? '', /type=waterlevels/)
    await client.downloadStations('current')
    assert.match(server.requests.at(-1)?.url ?? '', /type=currents/)
  } finally {
    await server.close()
  }
})

test('downloadStations returns "not-modified" on a 304 conditional response', async () => {
  const server = await startFixtureServer()
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    const result = await client.downloadStations('tide', { lastModified: LAST_MODIFIED, etag: ETAG })
    assert.equal(result.status, 'not-modified')
    const last = server.requests.at(-1)
    assert.equal(last?.headers['if-modified-since'], LAST_MODIFIED)
    assert.equal(last?.headers['if-none-match'], ETAG)
  } finally {
    await server.close()
  }
})

test('downloadStations sends the descriptive User-Agent', async () => {
  const server = await startFixtureServer()
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    await client.downloadStations('tide')
    assert.match(server.requests.at(-1)?.headers['user-agent'] ?? '', /signalk-crows-nest/)
  } finally {
    await server.close()
  }
})

test('downloadStations reports an error status on a non-2xx response', async () => {
  const server = await startStubServer((_req, res) => { res.statusCode = 500; res.end('boom') })
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    const result = await client.downloadStations('tide')
    assert.equal(result.status, 'error')
    if (result.status !== 'error') return
    assert.match(result.message, /HTTP 500/)
  } finally {
    await server.close()
  }
})

test('downloadStations keeps a list whose stations only partly parse', async () => {
  // Dropping the stations this parser cannot read is normal: the list is still
  // a good list, and every record that did parse must reach the store.
  const server = await startJsonServer({
    count: 3,
    stations: [
      { id: '8447386', name: 'Fall River', lat: 41.7043, lng: -71.1641 },
      // Renamed coordinate keys: what an upstream schema change looks like.
      { id: '8443970', name: 'Boston', latitude: 42.3539, longitude: -71.0503 },
      { id: '8452660', name: 'Newport', latitude: 41.5043, longitude: -71.3261 }
    ]
  })
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    const result = await client.downloadStations('tide')
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.records.length, 1)
  } finally {
    await server.close()
  }
})

test('downloadStations reports an error when a full list yields no record', async () => {
  // The mdapi renames a field and every station on a 200 stops parsing. The
  // source replaces a station family wholesale with what it is handed, so
  // reporting this as an empty family would drop every stored station while
  // the pass still looked healthy. Failing here also leaves the stored
  // validators alone, so the next tick re-requests the list instead of being
  // answered 304 against the unparseable one.
  const server = await startJsonServer({
    count: 3,
    stations: [
      { id: '8447386', name: 'Fall River', latitude: 41.7043, longitude: -71.1641 },
      { id: '8443970', name: 'Boston', latitude: 42.3539, longitude: -71.0503 },
      { id: '8452660', name: 'Newport', latitude: 41.5043, longitude: -71.3261 }
    ]
  })
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    const result = await client.downloadStations('tide')
    assert.equal(result.status, 'error')
    if (result.status !== 'error') return
    assert.match(result.message, /3 stations on the wire, none parseable/)
  } finally {
    await server.close()
  }
})

test('downloadStations reports an empty list as zero records, not an error', async () => {
  // A station family the mdapi answers with nothing is a legitimate response
  // and must stay representable without an error, so a family that really did
  // empty still clears its stored stations.
  const server = await startJsonServer({ count: 0, stations: [] })
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    const result = await client.downloadStations('tide')
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.records.length, 0)
  } finally {
    await server.close()
  }
})

test('downloadStations reports an error when the body carries no stations array', async () => {
  // Valid JSON in an unexpected shape. Coercing the missing array to an empty
  // list told the refresh the family really had emptied, which wiped it.
  const server = await startJsonServer({ count: 0, results: [] })
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    const result = await client.downloadStations('tide')
    assert.equal(result.status, 'error')
    if (result.status !== 'error') return
    assert.match(result.message, /no stations array/)
  } finally {
    await server.close()
  }
})

test('downloadStations decodes a gzip-compressed station list', async () => {
  // The live mdapi answers `gzip` when it is advertised (measured 2026-09-09:
  // 777,389 bytes uncompressed, 31,511 compressed). This proves the whole
  // conditional-GET ingestion path, not just the transport, reads the decoded
  // body.
  const server = await startStubServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Encoding', 'gzip')
    res.end(gzipSync(Buffer.from(WATERLEVELS_BODY, 'utf8')))
  })
  try {
    const client = createCoopsClient({ baseUrl: server.url })
    const result = await client.downloadStations('tide')
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.records.length, 2)
    assert.equal(result.records[0].name, 'Fall River')
    assert.equal(server.requests.at(-1)?.headers['accept-encoding'], 'gzip, br')
  } finally {
    await server.close()
  }
})
