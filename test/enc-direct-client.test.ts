import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createEncDirectClient } from '../src/inputs/noaa-enc/enc-direct-client.js'
import { startStubServer, type StubServer } from './helpers.js'

/**
 * A JSON stub server with a per-run page counter: the handler receives the
 * 1-based request number so a pagination test can answer each page
 * differently. Thin adapter over the shared startStubServer.
 */
async function startServer (
  handler: (req: IncomingMessage, page: number) => unknown
): Promise<StubServer> {
  let page = 0
  return await startStubServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url ?? '/', 'http://stub')
    if (!url.pathname.endsWith('/query')) {
      // The once-per-session layer identity check fetches the layer metadata
      // before the first query; answer with a name matching every layer kind
      // so it passes without consuming the page counter.
      res.end(JSON.stringify({ name: 'Stub.Wreck_Obstruction_Rock_point' }))
      return
    }
    page++
    res.end(JSON.stringify(handler(req, page)))
  })
}

/** The recorded requests that hit the /query endpoint (identity checks excluded). */
function queryRequests (server: StubServer): StubServer['requests'] {
  return server.requests.filter((request) =>
    new URL(request.url, 'http://stub').pathname.endsWith('/query'))
}

test('queryLayer issues a bbox query and parses the GeoJSON response', async () => {
  const fixture = JSON.parse(
    await readFile('test/fixtures/enc-coastal-wreck.geojson', 'utf8')
  ) as { features: unknown[], exceededTransferLimit?: boolean }
  // The captured fixture's exceededTransferLimit is true (the upstream had
  // more data than the resultRecordCount=3 cap). The mock returns the fixture
  // on page 1 and an empty terminating page on page 2 so the client's
  // pagination loop exits.
  const server = await startServer((_req, page) => {
    if (page === 1) return fixture
    return { type: 'FeatureCollection', features: [] }
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const result = await client.queryLayer({
      band: 'coastal',
      layerKey: 'wreck',
      bbox: { south: 40.0, west: -74.5, north: 41.5, east: -73.0 }
    })
    assert.ok(Array.isArray(result.features))
    assert.equal(result.features.length, fixture.features.length)
    assert.equal(result.features[0].geometry.type, 'Point')
    assert.equal(result.features[0].geometry.coordinates.length, 2)
  } finally {
    await server.close()
  }
})

test('queryLayer splits an antimeridian bbox and removes duplicate features', async () => {
  const shared = {
    type: 'Feature' as const,
    id: 1,
    geometry: { type: 'Point' as const, coordinates: [180, 52] as [number, number] },
    properties: { OBJECTID: 1 }
  }
  const server = await startServer((req) => {
    const geometry = new URL(req.url ?? '/', 'http://stub').searchParams.get('geometry') ?? ''
    const sideId = geometry.startsWith('170,') ? 2 : 3
    return {
      type: 'FeatureCollection',
      features: [
        shared,
        {
          ...shared,
          id: sideId,
          properties: { OBJECTID: sideId }
        }
      ]
    }
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const result = await client.queryLayer({
      band: 'coastal',
      layerKey: 'wreck',
      bbox: { south: 51, west: 170, north: 53, east: -170 }
    })
    assert.deepEqual(result.features.map(feature => feature.id), [1, 2, 3])
    assert.equal(queryRequests(server).length, 2)
    const geometries = queryRequests(server).map(request =>
      new URL(request.url, 'http://stub').searchParams.get('geometry'))
    assert.deepEqual(geometries, ['170,51,180,53', '-180,51,-170,53'])
  } finally {
    await server.close()
  }
})

test('queryLayer pages through exceededTransferLimit responses', async () => {
  const featureA = {
    type: 'Feature' as const,
    id: 1,
    geometry: { type: 'Point' as const, coordinates: [-74, 41] as [number, number] },
    properties: {}
  }
  const featureB = {
    type: 'Feature' as const,
    id: 2,
    geometry: { type: 'Point' as const, coordinates: [-74, 41] as [number, number] },
    properties: {}
  }
  const server = await startServer((_req, page) => {
    if (page === 1) {
      return {
        type: 'FeatureCollection',
        features: [featureA],
        exceededTransferLimit: true
      }
    }
    return { type: 'FeatureCollection', features: [featureB] }
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const result = await client.queryLayer({
      band: 'coastal',
      layerKey: 'wreck',
      bbox: { south: 40, west: -75, north: 42, east: -73 }
    })
    assert.equal(result.features.length, 2)
    assert.equal(result.features[0].id, 1)
    assert.equal(result.features[1].id, 2)
    assert.equal(queryRequests(server).length, 2)
  } finally {
    await server.close()
  }
})

test('queryLayer always includes a geometry filter, never an unbounded where=1=1', async () => {
  const server = await startServer(() => ({
    type: 'FeatureCollection',
    features: []
  }))
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    await client.queryLayer({
      band: 'coastal',
      layerKey: 'wreck',
      bbox: { south: 40, west: -75, north: 42, east: -73 }
    })
    const url = queryRequests(server)[0]?.url ?? ''
    assert.ok(url.includes('geometry='), 'expected the geometry filter in the URL')
    assert.ok(
      !url.includes('where=1%3D1') && !url.includes('where=1=1'),
      'must not send an unbounded where=1=1 filter'
    )
  } finally {
    await server.close()
  }
})

test('queryLayer resolves the layer id from band + layerKey', async () => {
  const server = await startServer(() => ({
    type: 'FeatureCollection',
    features: []
  }))
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    await client.queryLayer({
      band: 'harbour',
      layerKey: 'rock',
      bbox: { south: 40, west: -75, north: 42, east: -73 }
    })
    const url = queryRequests(server)[0]?.url ?? ''
    // harbour/rock is layer 34 (from LAYER_IDS_BY_BAND).
    assert.ok(
      url.includes('/enc_harbour/MapServer/34/query'),
      `expected harbour rock layer id 34 in URL, got ${url}`
    )
  } finally {
    await server.close()
  }
})

test('queryLayer sends the descriptive User-Agent header', async () => {
  const server = await startServer(() => ({
    type: 'FeatureCollection',
    features: []
  }))
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    await client.queryLayer({
      band: 'coastal',
      layerKey: 'wreck',
      bbox: { south: 40, west: -75, north: 42, east: -73 }
    })
    const ua = String(queryRequests(server)[0]?.headers['user-agent'] ?? '')
    assert.match(ua, /signalk-crows-nest/)
  } finally {
    await server.close()
  }
})

test('queryById fetches one feature by object id', async () => {
  const feature = {
    type: 'Feature' as const,
    id: 42,
    geometry: { type: 'Point' as const, coordinates: [-74, 41] as [number, number] },
    properties: { OBJNAM: 'Test Wreck' }
  }
  const server = await startServer(() => ({
    type: 'FeatureCollection',
    features: [feature]
  }))
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const result = await client.queryById({
      band: 'coastal',
      layerKey: 'wreck',
      objectId: 42
    })
    assert.ok(result !== undefined)
    assert.equal(result?.id, 42)
    const url = queryRequests(server)[0]?.url ?? ''
    assert.ok(url.includes('objectIds=42'))
  } finally {
    await server.close()
  }
})

test('queryById resolves to undefined when no feature matches the id', async () => {
  const server = await startServer(() => ({
    type: 'FeatureCollection',
    features: []
  }))
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const result = await client.queryById({
      band: 'coastal',
      layerKey: 'wreck',
      objectId: 999999
    })
    assert.equal(result, undefined)
  } finally {
    await server.close()
  }
})

test('a renumbered layer id fails the identity check loudly and stays failed', async () => {
  let metadataRequests = 0
  const server = await startStubServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url ?? '/', 'http://stub')
    if (!url.pathname.endsWith('/query')) {
      metadataRequests++
      // A republish renumbered the ids: the pinned wreck id now points at a
      // different layer, which still answers 200.
      res.end(JSON.stringify({ name: 'Coastal.Buoy_point' }))
      return
    }
    res.end(JSON.stringify({ type: 'FeatureCollection', features: [] }))
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const bbox = { south: 40.0, west: -74.5, north: 41.5, east: -73.0 }
    await assert.rejects(
      () => client.queryLayer({ band: 'coastal', layerKey: 'wreck', bbox }),
      /identity check failed/)
    await assert.rejects(
      () => client.queryById({ band: 'coastal', layerKey: 'wreck', objectId: 1 }),
      /identity check failed/)
    assert.equal(metadataRequests, 1, 'the failed check is cached, not re-fetched')
  } finally {
    await server.close()
  }
})

test('an unreachable metadata endpoint does not block queries (fail open)', async () => {
  const server = await startStubServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url ?? '/', 'http://stub')
    if (!url.pathname.endsWith('/query')) {
      res.statusCode = 503
      res.end(JSON.stringify({ error: 'down' }))
      return
    }
    res.end(JSON.stringify({ type: 'FeatureCollection', features: [] }))
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const bbox = { south: 40.0, west: -74.5, north: 41.5, east: -73.0 }
    const result = await client.queryLayer({ band: 'coastal', layerKey: 'wreck', bbox })
    assert.deepEqual(result.features, [], 'the query proceeded despite the unverifiable check')
  } finally {
    await server.close()
  }
})

test('the identity check runs once per session per (band, layer)', async () => {
  let metadataRequests = 0
  const server = await startStubServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url ?? '/', 'http://stub')
    if (!url.pathname.endsWith('/query')) {
      metadataRequests++
      res.end(JSON.stringify({ name: 'Coastal.Wreck_point' }))
      return
    }
    res.end(JSON.stringify({ type: 'FeatureCollection', features: [] }))
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const bbox = { south: 40.0, west: -74.5, north: 41.5, east: -73.0 }
    await client.queryLayer({ band: 'coastal', layerKey: 'wreck', bbox })
    await client.queryLayer({ band: 'coastal', layerKey: 'wreck', bbox })
    assert.equal(metadataRequests, 1, 'the second query reused the verified check')
  } finally {
    await server.close()
  }
})
