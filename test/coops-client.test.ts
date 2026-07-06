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
import { createCoopsClient } from '../src/inputs/noaa-coops/coops-client.js'
import { startStubServer, type StubServer } from './helpers.js'

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
