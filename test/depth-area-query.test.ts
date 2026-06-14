/**
 * Tests for the charted depth-area and land-area query.
 *
 * `queryChartedAreas` reuses the existing ENC Direct client (bbox geometry
 * filter, paging, per-band layer-id resolution) and adds the area-specific
 * shaping: it queries `Depth_Area` and `Land_Area` for a band and bounding box,
 * keeps the polygon rings, and decodes `DRVAL1`/`DRVAL2` into a depth range. The
 * request shape (the right per-band layer ids in the URL) and the polygon parse
 * are what these tests pin.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createEncDirectClient } from '../src/inputs/noaa-enc/enc-direct-client.js'
import { queryChartedAreas } from '../src/inputs/noaa-enc/depth-area-query.js'

interface RecordingServer {
  url: string
  close: () => Promise<void>
  requests: string[]
}

async function startServer (
  handler: (url: string) => unknown
): Promise<RecordingServer> {
  const requests: string[] = []
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    requests.push(url)
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(handler(url)))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => { error === undefined ? resolve() : reject(error) })
    })
  }
}

const SQUARE: number[][][] = [[
  [-74.05, 40.45],
  [-73.95, 40.45],
  [-73.95, 40.55],
  [-74.05, 40.55],
  [-74.05, 40.45]
]]

function depthFeature (drval1: number | null, drval2: number | null) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: SQUARE },
    properties: { OBJECTID: 1, DRVAL1: drval1, DRVAL2: drval2 }
  }
}

function landFeature () {
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: SQUARE },
    properties: { OBJECTID: 2, OBJNAM: 'Sandy Hook' }
  }
}

test('queryChartedAreas hits the coastal Depth_Area (166) and Land_Area (171) layers', async () => {
  const server = await startServer(url => {
    if (url.includes('/MapServer/166/')) {
      return { type: 'FeatureCollection', features: [depthFeature(0, 18.2)] }
    }
    if (url.includes('/MapServer/171/')) {
      return { type: 'FeatureCollection', features: [landFeature()] }
    }
    return { type: 'FeatureCollection', features: [] }
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const areas = await queryChartedAreas(client, {
      band: 'coastal',
      bbox: { south: 40.45, west: -74.05, north: 40.55, east: -73.95 }
    })
    assert.equal(areas.depthAreas.length, 1)
    assert.equal(areas.landAreas.length, 1)
    const depthUrls = server.requests.filter(u => u.includes('/enc_coastal/MapServer/166/query'))
    const landUrls = server.requests.filter(u => u.includes('/enc_coastal/MapServer/171/query'))
    assert.equal(depthUrls.length, 1, 'expected one Depth_Area request to layer 166')
    assert.equal(landUrls.length, 1, 'expected one Land_Area request to layer 171')
    // Both requests carry the bbox geometry filter, never an unbounded where.
    for (const u of [...depthUrls, ...landUrls]) {
      assert.ok(u.includes('geometry='), 'expected the geometry filter in the URL')
      assert.ok(!u.includes('where=1%3D1') && !u.includes('where=1=1'))
    }
  } finally {
    await server.close()
  }
})

test('queryChartedAreas resolves harbour to Depth_Area 227 and Land_Area 233', async () => {
  const server = await startServer(() => ({ type: 'FeatureCollection', features: [] }))
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    await queryChartedAreas(client, {
      band: 'harbour',
      bbox: { south: 40.6, west: -74.1, north: 40.75, east: -73.9 }
    })
    assert.ok(
      server.requests.some(u => u.includes('/enc_harbour/MapServer/227/query')),
      'expected harbour Depth_Area layer id 227'
    )
    assert.ok(
      server.requests.some(u => u.includes('/enc_harbour/MapServer/233/query')),
      'expected harbour Land_Area layer id 233'
    )
  } finally {
    await server.close()
  }
})

test('queryChartedAreas parses polygon rings and decodes the depth range', async () => {
  const server = await startServer(url => {
    if (url.includes('/MapServer/166/')) {
      return { type: 'FeatureCollection', features: [depthFeature(0, 18.2)] }
    }
    return { type: 'FeatureCollection', features: [] }
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const areas = await queryChartedAreas(client, {
      band: 'coastal',
      bbox: { south: 40.45, west: -74.05, north: 40.55, east: -73.95 }
    })
    const area = areas.depthAreas[0]
    assert.deepEqual(area.rings, SQUARE)
    assert.equal(area.depthRange?.shallowMeters, 0)
    assert.equal(area.depthRange?.deepMeters, 18.2)
  } finally {
    await server.close()
  }
})

test('queryChartedAreas carries a negative drying DRVAL1 through to the consumer', async () => {
  const server = await startServer(url => {
    if (url.includes('/MapServer/227/')) {
      return { type: 'FeatureCollection', features: [depthFeature(-1.6, 0)] }
    }
    return { type: 'FeatureCollection', features: [] }
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const areas = await queryChartedAreas(client, {
      band: 'harbour',
      bbox: { south: 40.6, west: -74.1, north: 40.75, east: -73.9 }
    })
    assert.equal(areas.depthAreas[0]?.depthRange?.shallowMeters, -1.6)
  } finally {
    await server.close()
  }
})

test('queryChartedAreas drops a stray non-polygon feature', async () => {
  const server = await startServer(url => {
    if (url.includes('/MapServer/166/')) {
      return {
        type: 'FeatureCollection',
        features: [
          depthFeature(2, 5),
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-74, 40.5] },
            properties: { OBJECTID: 9 }
          }
        ]
      }
    }
    return { type: 'FeatureCollection', features: [] }
  })
  try {
    const client = createEncDirectClient({ baseUrl: server.url })
    const areas = await queryChartedAreas(client, {
      band: 'coastal',
      bbox: { south: 40.45, west: -74.05, north: 40.55, east: -73.95 }
    })
    assert.equal(areas.depthAreas.length, 1, 'only the polygon survives')
    assert.deepEqual(areas.depthAreas[0].rings, SQUARE)
  } finally {
    await server.close()
  }
})
