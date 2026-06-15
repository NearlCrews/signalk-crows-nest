import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createVectorTileClient } from '../src/inputs/vector-tiles/vector-tile-client.js'
import type { RateLimitOptions } from '../src/inputs/http-client.js'
import { silentLog } from './helpers.js'

const here = dirname(fileURLToPath(import.meta.url))
const TILE = readFileSync(join(here, 'fixtures/water-tile-z14.mvt'))

const STYLE_URL = 'https://tiles.test/styles/liberty'
const TILEJSON_URL = 'https://tiles.test/planet'
const TEMPLATE = 'https://tiles.test/planet/BUILD1/{z}/{x}/{y}.pbf'
const TEMPLATE2 = 'https://tiles.test/planet/BUILD2/{z}/{x}/{y}.pbf'

/** Fast settings so retry tests do not sleep. */
const fast: Partial<RateLimitOptions> = { minDelayMs: 0, backoffBaseMs: 1, maxBackoffMs: 2, maxRetries: 0 }

function styleResponse (): Response {
  return new Response(JSON.stringify({ sources: { omt: { type: 'vector', url: TILEJSON_URL } } }), { headers: { 'content-type': 'application/json' } })
}
function tileJsonResponse (template: string): Response {
  return new Response(JSON.stringify({ tiles: [template] }), { headers: { 'content-type': 'application/json' } })
}

async function withMock (
  handler: (url: string, calls: string[]) => Response,
  fn: (calls: string[]) => Promise<void>
): Promise<void> {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (url: unknown): Promise<Response> => { calls.push(String(url)); return handler(String(url), calls) }) as typeof fetch
  try { await fn(calls) } finally { globalThis.fetch = original }
}

const isTile = (url: string, build = 'BUILD1'): boolean => url.includes(`/planet/${build}/`)

test('fetchLayer resolves the template from the style TileJSON and decodes the water layer', async () => {
  await withMock(
    (url) => url === STYLE_URL ? styleResponse() : url === TILEJSON_URL ? tileJsonResponse(TEMPLATE) : new Response(TILE),
    async () => {
      const client = createVectorTileClient(STYLE_URL, silentLog, fast)
      const geoms = await client.fetchLayer(14, 2621, 6326, 'water')
      assert.ok(geoms.length >= 1, 'the fixture tile has water features')
      for (const g of geoms) assert.ok(g.type === 'Polygon' || g.type === 'MultiPolygon')
      // The coordinates are lon/lat near San Francisco Bay (the captured tile).
      const first = geoms[0]
      const pt = first.type === 'Polygon' ? (first.coordinates as number[][][])[0][0] : (first.coordinates as number[][][][])[0][0][0]
      assert.ok(pt[0] > -123 && pt[0] < -122 && pt[1] > 37 && pt[1] < 38, `decoded a SF-Bay lon/lat, got ${JSON.stringify(pt)}`)
    }
  )
})

test('fetchLayer caches the template, fetching the style only once across two tiles', async () => {
  await withMock(
    (url) => url === STYLE_URL ? styleResponse() : url === TILEJSON_URL ? tileJsonResponse(TEMPLATE) : new Response(TILE),
    async (calls) => {
      const client = createVectorTileClient(STYLE_URL, silentLog, fast)
      await client.fetchLayer(14, 2621, 6326, 'water')
      await client.fetchLayer(14, 2622, 6326, 'water')
      assert.equal(calls.filter((u) => u === STYLE_URL).length, 1, 'the style is resolved once and cached')
    }
  )
})

test('a tile with no such layer decodes to an empty array', async () => {
  await withMock(
    (url) => url === STYLE_URL ? styleResponse() : url === TILEJSON_URL ? tileJsonResponse(TEMPLATE) : new Response(TILE),
    async () => {
      const client = createVectorTileClient(STYLE_URL, silentLog, fast)
      assert.deepEqual(await client.fetchLayer(14, 2621, 6326, 'no_such_layer'), [])
    }
  )
})

test('an empty tile body decodes to an empty array', async () => {
  await withMock(
    (url) => url === STYLE_URL ? styleResponse() : url === TILEJSON_URL ? tileJsonResponse(TEMPLATE) : new Response(new Uint8Array(0)),
    async () => {
      const client = createVectorTileClient(STYLE_URL, silentLog, fast)
      assert.deepEqual(await client.fetchLayer(14, 2621, 6326, 'water'), [])
    }
  )
})

test('a non-ok tile status rejects', async () => {
  await withMock(
    (url) => url === STYLE_URL ? styleResponse() : url === TILEJSON_URL ? tileJsonResponse(TEMPLATE) : new Response('err', { status: 500 }),
    async () => {
      const client = createVectorTileClient(STYLE_URL, silentLog, fast)
      await assert.rejects(() => client.fetchLayer(14, 2621, 6326, 'water'), /vector-tile request failed/)
    }
  )
})

test('a 404 (aged-out build) re-resolves the template once and retries', async () => {
  await withMock(
    (url, calls) => {
      if (url === STYLE_URL) return styleResponse()
      if (url === TILEJSON_URL) {
        // First resolution gives BUILD1 (which 404s), the re-resolution gives BUILD2.
        const styleResolutions = calls.filter((u) => u === TILEJSON_URL).length
        return tileJsonResponse(styleResolutions <= 1 ? TEMPLATE : TEMPLATE2)
      }
      if (isTile(url, 'BUILD1')) return new Response('gone', { status: 404 })
      if (isTile(url, 'BUILD2')) return new Response(TILE)
      return new Response('?', { status: 500 })
    },
    async (calls) => {
      const client = createVectorTileClient(STYLE_URL, silentLog, fast)
      const geoms = await client.fetchLayer(14, 2621, 6326, 'water')
      assert.ok(geoms.length >= 1, 'the retry against the fresh build decoded water')
      assert.equal(calls.filter((u) => u === TILEJSON_URL).length, 2, 'the template was re-resolved once after the 404')
    }
  )
})
