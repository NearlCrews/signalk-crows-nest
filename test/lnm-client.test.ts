/**
 * Tests for the USCG Local Notice to Mariners HTTP client.
 *
 * A fixture server on localhost serves the two wire shapes the LNM feed
 * publishes: a "notice" file (hazNav) and a "discrepancy" file (discFedAid).
 * The tests exercise the parse of each shape, the layer-namespaced ids, the
 * conditional-GET path, the descriptive User-Agent, and the error path.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createLnmClient } from '../src/inputs/uscg-lnm/lnm-client.js'
import { LNM_LAYER_BY_SLUG, type LnmLayer } from '../src/inputs/uscg-lnm/lnm-layers.js'
import { startJsonServer, startStubServer, type StubServer } from './helpers.js'

const HAZNAV = LNM_LAYER_BY_SLUG.get('haznav') as LnmLayer
const DISCFEDAID = LNM_LAYER_BY_SLUG.get('discfedaid') as LnmLayer

const LAST_MODIFIED = 'Sun, 05 Jul 2026 23:32:51 GMT'
const ETAG = '"38beb398d6cdd1:0"'

/**
 * Start a server that maps each `<fileBase>_<page>.geojson` request to a
 * fixture, honors conditional GET, and (when `failStatus` is set) returns that
 * status instead so the error path can be exercised.
 */
async function startFixtureServer (failStatus?: number): Promise<StubServer> {
  const notice = await readFile('test/fixtures/lnm-haznav.geojson')
  const discrepancy = await readFile('test/fixtures/lnm-discfedaid.geojson')
  return startStubServer((req, res) => {
    if (failStatus !== undefined) {
      res.statusCode = failStatus
      res.end()
      return
    }
    if (
      req.headers['if-modified-since'] === LAST_MODIFIED ||
      req.headers['if-none-match'] === ETAG
    ) {
      res.statusCode = 304
      res.end()
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Last-Modified', LAST_MODIFIED)
    res.setHeader('ETag', ETAG)
    res.end((req.url ?? '').includes('discFedAid') ? discrepancy : notice)
  })
}

test('downloadLayerPage parses a notice file into Hazard-typed records', async () => {
  const server = await startFixtureServer()
  try {
    const client = createLnmClient({ baseUrl: server.url })
    const result = await client.downloadLayerPage(HAZNAV, 1)
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    // The fixture carries four features, one with a null geometry that must be
    // dropped rather than minting a NaN-position marker.
    assert.equal(result.records.length, 3)
    const first = result.records[0]
    assert.equal(first.kind, 'notice')
    assert.equal(first.poiType, 'Hazard')
    assert.equal(first.skIcon, 'hazard')
    assert.ok(first.id.startsWith('haznav_'), 'ids are namespaced by layer slug')
    // The concise name is composed from the waterway and notice type.
    assert.equal(first.name, 'Little Egg Inlet: Shoaling Reported')
    assert.ok(first.timestamp !== undefined, 'the modified date becomes the timestamp')
    if (first.kind === 'notice') {
      assert.ok(first.description !== undefined && first.description.length > 0)
    }
    assert.equal(result.headers.lastModified, LAST_MODIFIED)
    assert.equal(result.headers.etag, ETAG)
  } finally {
    await server.close()
  }
})

test('downloadLayerPage parses a discrepancy file into Hazard-typed records', async () => {
  const server = await startFixtureServer()
  try {
    const client = createLnmClient({ baseUrl: server.url })
    const result = await client.downloadLayerPage(DISCFEDAID, 1)
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.records.length, 4)
    const withStatus = result.records.find((record) =>
      record.kind === 'discrepancy' && record.status !== undefined)
    assert.ok(withStatus !== undefined, 'a discrepancy carries a coded status')
    assert.equal(withStatus.kind, 'discrepancy')
    assert.equal(withStatus.poiType, 'Hazard')
    assert.equal(withStatus.skIcon, 'hazard')
    assert.ok(withStatus.id.startsWith('discfedaid_'))
    if (withStatus.kind === 'discrepancy') {
      assert.ok(withStatus.llnr !== undefined, 'a discrepancy carries the affected aid LLNR')
    }
    // The synthetic feature with a null NAME falls back to the layer label.
    const fallbackNamed = result.records.find((record) => record.name === 'Discrepant Federal Aid')
    assert.ok(fallbackNamed !== undefined, 'a null name falls back to the layer label')
  } finally {
    await server.close()
  }
})

test('downloadLayerPage returns "not-modified" on a 304 conditional response', async () => {
  const server = await startFixtureServer()
  try {
    const client = createLnmClient({ baseUrl: server.url })
    const result = await client.downloadLayerPage(HAZNAV, 1, {
      lastModified: LAST_MODIFIED,
      etag: ETAG
    })
    assert.equal(result.status, 'not-modified')
    const last = server.requests.at(-1)
    assert.equal(last?.headers['if-modified-since'], LAST_MODIFIED)
    assert.equal(last?.headers['if-none-match'], ETAG)
  } finally {
    await server.close()
  }
})

test('downloadLayerPage sends the descriptive User-Agent', async () => {
  const server = await startFixtureServer()
  try {
    const client = createLnmClient({ baseUrl: server.url })
    await client.downloadLayerPage(HAZNAV, 1)
    assert.match(server.requests.at(-1)?.headers['user-agent'] ?? '', /signalk-crows-nest/)
  } finally {
    await server.close()
  }
})

test('downloadLayerPage reports an error status on a non-2xx response', async () => {
  const server = await startFixtureServer(500)
  try {
    const client = createLnmClient({ baseUrl: server.url })
    const result = await client.downloadLayerPage(HAZNAV, 1)
    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.match(result.message, /HTTP 500/)
    }
  } finally {
    await server.close()
  }
})

test('downloadLayerPage keeps a file whose features only partly parse', async () => {
  // Dropping the features this parser cannot read is normal: the file is still
  // a good file, and every record that did parse must reach the store.
  const server = await startJsonServer({
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          MSI_UID: 1,
          DECIMAL_LATITUDE: 42.1,
          DECIMAL_LONGITUDE: -70.9,
          SUB_CATEGORY: 'Hazards To Navigation'
        }
      },
      // Renamed coordinate keys: what an upstream schema change looks like.
      { properties: { MSI_UID: 2, LAT: 42.2, LON: -70.8 } },
      { properties: { MSI_UID: 3, LAT: 42.3, LON: -70.7 } }
    ]
  })
  try {
    const client = createLnmClient({ baseUrl: server.url })
    const result = await client.downloadLayerPage(HAZNAV, 1)
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.records.length, 1)
  } finally {
    await server.close()
  }
})

test('downloadLayerPage reports an error when a full file yields no record', async () => {
  // NAVCEN renames a property and every feature on a 200 stops parsing. The
  // source replaces a layer file wholesale with what it is handed, so
  // reporting this as an empty file would drop every stored notice for the
  // file. On the Hazard-typed danger layers that is the proximity alarm and
  // the route scan going quiet behind a green status row. Failing here also
  // leaves the stored validators alone, so the next tick re-requests the file
  // instead of being answered 304 against the unparseable one.
  const server = await startJsonServer({
    type: 'FeatureCollection',
    features: [
      { properties: { MSI_UID: 1, LAT: 42.1, LON: -70.9 } },
      { properties: { MSI_UID: 2, LAT: 42.2, LON: -70.8 } },
      { properties: { MSI_UID: 3, LAT: 42.3, LON: -70.7 } }
    ]
  })
  try {
    const client = createLnmClient({ baseUrl: server.url })
    const result = await client.downloadLayerPage(HAZNAV, 1)
    assert.equal(result.status, 'error')
    if (result.status !== 'error') return
    assert.match(result.message, /3 features on the wire, none parseable/)
  } finally {
    await server.close()
  }
})

test('downloadLayerPage reports an empty file as zero records, not an error', async () => {
  // A layer file NAVCEN publishes with nothing on it is a legitimate answer
  // and must stay representable without an error, so a file that really did
  // empty still clears its stored notices.
  const server = await startJsonServer({ type: 'FeatureCollection', features: [] })
  try {
    const client = createLnmClient({ baseUrl: server.url })
    const result = await client.downloadLayerPage(HAZNAV, 1)
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.records.length, 0)
  } finally {
    await server.close()
  }
})

test('downloadLayerPage reports an error when the body carries no features array', async () => {
  // Valid JSON in an unexpected shape. Coercing the missing array to an empty
  // file told the refresh the layer really had emptied, which wiped it.
  const server = await startJsonServer({ type: 'FeatureCollection', records: [] })
  try {
    const client = createLnmClient({ baseUrl: server.url })
    const result = await client.downloadLayerPage(HAZNAV, 1)
    assert.equal(result.status, 'error')
    if (result.status !== 'error') return
    assert.match(result.message, /no GeoJSON features array/)
  } finally {
    await server.close()
  }
})
