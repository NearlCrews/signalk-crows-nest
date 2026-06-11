import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ServerAPI } from '@signalk/server-api'
import { createInputRegistry } from '../src/inputs/input-registry.js'
import { activeCaptainInput } from '../src/inputs/active-captain/active-captain-input.js'
import { openSeaMapInput } from '../src/inputs/openseamap/openseamap-input.js'
import { notesResourceOutput } from '../src/outputs/notes-resource/notes-resource-output.js'
import { createPluginStatus } from '../src/status/plugin-status.js'
import type { OutputContext } from '../src/outputs/output.js'
import type { PluginConfig } from '../src/shared/types.js'

/** Canned ActiveCaptain bounding-box list response: one marina. */
const AC_LIST = {
  pointsOfInterest: [
    { id: '123', poiType: 'Marina', name: 'AC Marina', mapLocation: { latitude: 10, longitude: 20 } }
  ]
}

/** Canned ActiveCaptain detail response for POI 123. */
const AC_DETAIL = {
  pointOfInterest: {
    id: 123,
    name: 'AC Marina',
    poiType: 'Marina',
    mapLocation: { latitude: 10, longitude: 20 },
    dateLastModified: '2020-01-01T00:00:00.000'
  }
}

/** Canned Overpass response: one harbour node, far from the ActiveCaptain marina. */
const OSM_RESPONSE = {
  elements: [
    { type: 'node', id: 555, lat: 30, lon: 40, tags: { 'seamark:type': 'harbour', name: 'OSM Harbour' } }
  ]
}

/** A JSON Response with HTTP 200. */
function jsonResponse (body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

/**
 * Run `fn` with a global fetch stubbed to serve the ActiveCaptain and Overpass
 * endpoints from canned responses, so both sources run without real network.
 */
async function withMockFetch (fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = (async (url: unknown): Promise<Response> => {
    const target = String(url)
    if (target.includes('/points-of-interest/bbox')) return jsonResponse(AC_LIST)
    if (target.includes('/summary')) return jsonResponse(AC_DETAIL)
    if (target.includes('overpass')) return jsonResponse(OSM_RESPONSE)
    throw new Error(`unexpected fetch to ${target}`)
  }) as typeof fetch
  try {
    await fn()
  } finally {
    globalThis.fetch = original
  }
}

/** Config that enables both sources, with the marina POI type on. */
const CONFIG = {
  cachingDurationMinutes: 60,
  includeMarinas: true,
  openSeaMapEnabled: true
} as unknown as PluginConfig

/** Start the notes output over the aggregate of both real inputs. */
function startMultiSource (dataDir: string): {
  listResources: (query: object) => Promise<Record<string, unknown>>
  getResource: (id: string, property?: string) => Promise<Record<string, unknown>>
} {
  const provider: { methods?: Record<string, unknown> } = {}
  const app = {
    debug: () => {},
    error: () => {},
    setPluginStatus: () => {},
    setPluginError: () => {},
    getDataDirPath: () => dataDir,
    registerResourceProvider: (r: { methods: Record<string, unknown> }) => {
      provider.methods = r.methods
    }
  } as unknown as ServerAPI

  const status = createPluginStatus([
    { source: 'activecaptain', name: 'Garmin ActiveCaptain' },
    { source: 'openseamap', name: 'OpenSeaMap' }
  ])
  const inputs = createInputRegistry([activeCaptainInput, openSeaMapInput])
  const source = inputs.createSource({
    app, config: CONFIG, status, dataDir, getCurrentPosition: () => undefined
  })
  const context: OutputContext = {
    app,
    config: CONFIG,
    pois: source,
    status,
    // The notes output never touches the resolver; an inert stub satisfies
    // the contract the plugin shell normally fills.
    bridgeClearanceResolver: { clearanceMeters: () => null }
  }
  notesResourceOutput.start(context)

  const methods = provider.methods as Record<string, unknown>
  return {
    listResources: methods.listResources as (q: object) => Promise<Record<string, unknown>>,
    getResource: methods.getResource as (id: string, p?: string) => Promise<Record<string, unknown>>
  }
}

test('the multi-source path lists and routes resources across both sources', async () => {
  await withMockFetch(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crows-nest-'))
    try {
      const { listResources, getResource } = startMultiSource(dataDir)

      // listResources unions both sources, prefixing each id with its source.
      // OSM ids use the URL-safe underscore form so a `/` inside the id does
      // not split the SignalK `/resources/notes/<id>` route.
      const resources = await listResources({ bbox: '0,0,1,1' })
      const ids = Object.keys(resources).sort()
      assert.deepEqual(ids, ['activecaptain-123', 'openseamap-node_555'],
        'every id carries its source prefix and the OSM id uses the underscore form')

      // getResource of an openseamap- id routes to the OpenSeaMap source.
      const osmNote = await getResource('openseamap-node_555')
      assert.equal(osmNote.name, 'OSM Harbour')
      assert.equal((osmNote.properties as Record<string, unknown>).source, 'openseamap')

      // getResource of an activecaptain- id routes to the ActiveCaptain source.
      const acNote = await getResource('activecaptain-123')
      assert.equal(acNote.name, 'AC Marina')
      assert.equal((acNote.properties as Record<string, unknown>).source, 'activecaptain')

      // An unknown source prefix has no source to route to and rejects.
      await assert.rejects(getResource('mystery-99'), /No source/i)
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
