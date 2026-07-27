/**
 * Tests for the USACE ArcGIS REST client.
 *
 * Drives `createUsaceClient` against an in-process `node:http` server (the
 * shared `http-one-shot` transport speaks raw sockets, not global fetch, so a
 * real server is the way to exercise it) with both layers pointed at the
 * server through `queryUrls`. Covers the bbox query URL shape, the
 * exceededTransferLimit pagination, the by-id query, and the non-2xx rejection.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { createUsaceClient } from '../src/inputs/usace/usace-client.js'
import type { UsaceFeature } from '../src/inputs/usace/usace-types.js'
import { startStubServer, type StubServer } from './helpers.js'

async function startServer (
  handler: (req: IncomingMessage, page: number) => { status?: number, body: unknown }
): Promise<StubServer> {
  let page = 0
  const stub = await startStubServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    if (!url.pathname.endsWith('/query')) {
      // The once-per-session layer identity check fetches the layer metadata
      // before the first query; answer with a name matching both layer kinds
      // so it passes without consuming the page counter.
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ name: 'Stub Lock and Dam layer' }))
      return
    }
    page++
    const { status = 200, body } = handler(req, page)
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  })
  return { ...stub, url: `${stub.url}/query` }
}

/** The recorded requests that hit the /query endpoint (identity checks excluded). */
function queryRequests (server: StubServer): StubServer['requests'] {
  return server.requests.filter((request) =>
    new URL(request.url, 'http://stub').pathname.endsWith('/query'))
}

const lockFeature: UsaceFeature = {
  type: 'Feature',
  id: 203,
  geometry: { type: 'Point', coordinates: [-80.385, 40.648] },
  properties: { OBJECTID: 203, PMSNAME: 'MONTGOMERY LOCK & DAM' }
}

test('queryLayer issues a bbox envelope query and parses the GeoJSON response', async () => {
  const server = await startServer(() => ({
    body: { type: 'FeatureCollection', features: [lockFeature] }
  }))
  try {
    const client = createUsaceClient({ queryUrls: { lock: server.url, dam: server.url } })
    const result = await client.queryLayer({
      layerKey: 'lock',
      bbox: { south: 40.3, west: -80.4, north: 40.7, east: -79.7 }
    })
    assert.equal(result.features.length, 1)
    assert.equal(result.features[0].properties.PMSNAME, 'MONTGOMERY LOCK & DAM')
    const requested = queryRequests(server)[0].url
    assert.match(requested, /geometry=-80\.4%2C40\.3%2C-79\.7%2C40\.7/)
    assert.match(requested, /geometryType=esriGeometryEnvelope/)
    assert.match(requested, /f=geojson/)
    assert.match(requested, /inSR=4326/)
  } finally {
    await server.close()
  }
})

test('queryLayer splits an antimeridian bbox and removes duplicate features', async () => {
  const server = await startServer((req) => {
    const geometry = new URL(req.url ?? '/', 'http://stub').searchParams.get('geometry') ?? ''
    const sideId = geometry.startsWith('170,') ? 204 : 205
    return {
      body: {
        type: 'FeatureCollection',
        features: [
          lockFeature,
          {
            ...lockFeature,
            id: sideId,
            properties: { ...lockFeature.properties, OBJECTID: sideId }
          }
        ]
      }
    }
  })
  try {
    const client = createUsaceClient({ queryUrls: { lock: server.url, dam: server.url } })
    const result = await client.queryLayer({
      layerKey: 'lock',
      bbox: { south: 51, west: 170, north: 53, east: -170 }
    })
    assert.deepEqual(result.features.map(feature => feature.id), [203, 204, 205])
    assert.equal(queryRequests(server).length, 2)
    const geometries = queryRequests(server).map(request =>
      new URL(request.url, 'http://stub').searchParams.get('geometry'))
    assert.deepEqual(geometries, ['170,51,180,53', '-180,51,-170,53'])
  } finally {
    await server.close()
  }
})

test('queryLayer pages while the upstream signals exceededTransferLimit', async () => {
  const server = await startServer((_req, page) => {
    if (page === 1) {
      return { body: { type: 'FeatureCollection', features: [lockFeature], exceededTransferLimit: true } }
    }
    return { body: { type: 'FeatureCollection', features: [] } }
  })
  try {
    const client = createUsaceClient({ queryUrls: { lock: server.url, dam: server.url } })
    const result = await client.queryLayer({
      layerKey: 'lock',
      bbox: { south: 40, west: -81, north: 41, east: -79 }
    })
    // Page 1 returned one feature with the more-data flag; page 2 terminated
    // the loop with an empty page.
    assert.equal(result.features.length, 1)
    assert.equal(queryRequests(server).length, 2)
    assert.match(queryRequests(server)[1].url, /resultOffset=1/)
  } finally {
    await server.close()
  }
})

test('queryById fetches a single feature by object id', async () => {
  const server = await startServer(() => ({
    body: { type: 'FeatureCollection', features: [lockFeature] }
  }))
  try {
    const client = createUsaceClient({ queryUrls: { lock: server.url, dam: server.url } })
    const feature = await client.queryById({ layerKey: 'lock', objectId: 203 })
    assert.ok(feature !== undefined)
    assert.equal(feature.id, 203)
    assert.match(queryRequests(server)[0].url, /objectIds=203/)
    // A by-id query carries no geometry envelope.
    assert.doesNotMatch(queryRequests(server)[0].url, /geometryType/)
  } finally {
    await server.close()
  }
})

test('queryById resolves undefined when the upstream returns no feature', async () => {
  const server = await startServer(() => ({
    body: { type: 'FeatureCollection', features: [] }
  }))
  try {
    const client = createUsaceClient({ queryUrls: { lock: server.url, dam: server.url } })
    const feature = await client.queryById({ layerKey: 'dam', objectId: 999 })
    assert.equal(feature, undefined)
  } finally {
    await server.close()
  }
})

test('queryLayer rejects on a non-2xx response', async () => {
  const server = await startServer(() => ({ status: 503, body: { error: 'unavailable' } }))
  try {
    const client = createUsaceClient({ queryUrls: { lock: server.url, dam: server.url } })
    await assert.rejects(
      () => client.queryLayer({ layerKey: 'dam', bbox: { south: 40, west: -81, north: 41, east: -79 } }),
      /USACE HTTP 503/
    )
  } finally {
    await server.close()
  }
})

test('a drifted layer URL fails the identity check loudly', async () => {
  // An ArcGIS Online republish can change the org item id behind the pinned
  // URL; whatever layer answers still returns 200, so the identity check is
  // what turns a silent mislabel into a recorded error.
  const stub = await startStubServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const url = new URL(req.url ?? '/', 'http://stub')
    if (!url.pathname.endsWith('/query')) {
      res.end(JSON.stringify({ name: 'Recreation Areas' }))
      return
    }
    res.end(JSON.stringify({ type: 'FeatureCollection', features: [] }))
  })
  try {
    const client = createUsaceClient({ queryUrls: { lock: `${stub.url}/query` } })
    await assert.rejects(
      () => client.queryLayer({
        layerKey: 'lock',
        bbox: { south: 40.0, west: -81.0, north: 41.0, east: -80.0 }
      }),
      /identity check failed/)
  } finally {
    await stub.close()
  }
})
