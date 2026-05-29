import test from 'node:test'
import assert from 'node:assert/strict'
import { notesResourceOutput } from '../src/outputs/notes-resource/notes-resource-output.js'
import type { OutputContext } from '../src/outputs/output.js'
import type { PoiDetailView } from '../src/shared/types.js'

function recordingApp () {
  const provider: { methods?: Record<string, unknown> } = {}
  return {
    provider,
    app: {
      debug: () => {},
      error: () => {},
      setPluginStatus: () => {},
      setPluginError: () => {},
      registerResourceProvider: (r: { methods: Record<string, unknown> }) => {
        provider.methods = r.methods
      }
    }
  }
}

const allTypesOn = {
  includeMarinas: true,
  includeAnchorages: true,
  includeHazards: true,
  includeBusinesses: true,
  includeBoatRamps: true,
  includeBridges: true,
  includeDams: true,
  includeFerries: true,
  includeInlets: true,
  includeLocks: true,
  includeLocalKnowledge: true,
  includeNavigational: true,
  includeAirports: true
}

const allTypesOff = {
  includeMarinas: false,
  includeAnchorages: false,
  includeHazards: false,
  includeBusinesses: false,
  includeBoatRamps: false,
  includeBridges: false,
  includeDams: false,
  includeFerries: false,
  includeInlets: false,
  includeLocks: false,
  includeLocalKnowledge: false,
  includeNavigational: false,
  includeAirports: false
}

function contextWith (overrides: Partial<OutputContext>): OutputContext {
  const { app } = recordingApp()
  return {
    app: app as never,
    config: { ...allTypesOn } as never,
    status: { recordListFetch: () => {}, recordError: () => {}, recordDetailSuccess: () => {} } as never,
    pois: {
      id: 'activecaptain',
      listPointsOfInterest: async () => [
        {
          id: '1',
          name: 'A',
          type: 'Marina',
          position: { latitude: 0, longitude: 0 },
          source: 'activecaptain',
          url: 'https://activecaptain.garmin.com/en-US/pois/1',
          attribution: 'Data from Garmin ActiveCaptain',
          skIcon: 'marina'
        }
      ],
      getDetails: async (): Promise<PoiDetailView> => ({
        name: 'A',
        type: 'Marina',
        position: { latitude: 0, longitude: 0 },
        url: 'https://activecaptain.garmin.com/en-US/pois/1',
        source: 'activecaptain',
        attribution: 'Data from Garmin ActiveCaptain',
        skIcon: 'marina'
      }),
      cacheSize: () => 0,
      close: () => {}
    },
    ...overrides
  } as OutputContext
}

/** Start the output and hand back the registered resource-provider methods. */
function startMethods (overrides: Partial<OutputContext>): Record<string, unknown> {
  const { app, provider } = recordingApp()
  notesResourceOutput.start(contextWith({ app: app as never, ...overrides }))
  return provider.methods as Record<string, unknown>
}

/**
 * Start the output with an app that captures the plugin status and error
 * messages it sets, so a test can assert on them.
 */
function startCapturing (overrides: Partial<OutputContext> = {}): {
  methods: Record<string, unknown>
  statusMessages: string[]
  pluginErrors: string[]
} {
  const statusMessages: string[] = []
  const pluginErrors: string[] = []
  const provider: { methods?: Record<string, unknown> } = {}
  const app = {
    debug: () => {},
    error: () => {},
    setPluginStatus: (message: string) => { statusMessages.push(message) },
    setPluginError: (message: string) => { pluginErrors.push(message) },
    registerResourceProvider: (r: { methods: Record<string, unknown> }) => {
      provider.methods = r.methods
    }
  }
  notesResourceOutput.start(contextWith({ app: app as never, ...overrides }))
  return { methods: provider.methods as Record<string, unknown>, statusMessages, pluginErrors }
}

test('listResources returns notes keyed by id', async () => {
  const methods = startMethods({})
  const listResources = methods.listResources as (q: object) => Promise<Record<string, unknown>>
  const result = await listResources({ bbox: '0,0,1,1' })
  assert.ok('1' in result)
})

test('listResources returns {} when no POI type is selected', async () => {
  const methods = startMethods({ config: { ...allTypesOff } as never })
  const listResources = methods.listResources as (q: object) => Promise<Record<string, unknown>>
  const result = await listResources({ bbox: '0,0,1,1' })
  assert.deepEqual(result, {})
})

test('listResources returns {} when the query has no bounding box', async () => {
  const methods = startMethods({})
  const listResources = methods.listResources as (q: object) => Promise<Record<string, unknown>>
  const result = await listResources({})
  assert.deepEqual(result, {})
})

test('listResources reports the result count via setPluginStatus', async () => {
  const { methods, statusMessages } = startCapturing()
  const listResources = methods.listResources as (q: object) => Promise<Record<string, unknown>>
  await listResources({ bbox: '0,0,1,1' })
  assert.equal(statusMessages.length, 1)
  assert.match(statusMessages[0], /1 point/)
})

test('listResources surfaces the error and rethrows on a list failure', async () => {
  // The aggregate POI source records each failed source's error onto the
  // per-source status itself; the notes output surfaces the failure to the
  // SignalK plugin UI and rethrows it to the resource caller.
  const { methods, pluginErrors } = startCapturing({
    pois: {
      id: 'activecaptain',
      listPointsOfInterest: async () => { throw new Error('boom') },
      getDetails: async (): Promise<PoiDetailView> => { throw new Error('not used') },
      cacheSize: () => 0,
      close: () => {}
    } as never
  })
  const listResources = methods.listResources as (q: object) => Promise<Record<string, unknown>>
  await assert.rejects(listResources({ bbox: '0,0,1,1' }), /boom/)
  assert.match(pluginErrors[0] ?? '', /boom/)
})

test('getResource returns the built note', async () => {
  const methods = startMethods({})
  const getResource = methods.getResource as (id: string, p?: string) => Promise<Record<string, unknown>>
  const note = await getResource('1')
  assert.equal(note.name, 'A')
  assert.equal(note.url, 'https://activecaptain.garmin.com/en-US/pois/1')
})

test('getResource returns a property value for a property request', async () => {
  const methods = startMethods({})
  const getResource = methods.getResource as (id: string, p?: string) => Promise<Record<string, unknown>>
  const result = await getResource('1', 'properties.skIcon')
  assert.equal(result.value, 'marina')
})

test('getResource rejects an unknown property', async () => {
  const methods = startMethods({})
  const getResource = methods.getResource as (id: string, p?: string) => Promise<Record<string, unknown>>
  await assert.rejects(getResource('1', 'properties.nope'), /no property/)
})

test('getResource rejects cleanly when getDetails fails', async () => {
  const methods = startMethods({
    pois: {
      id: 'activecaptain',
      listPointsOfInterest: async () => [],
      getDetails: async (): Promise<PoiDetailView> => { throw new Error('detail boom') },
      cacheSize: () => 0,
      close: () => {}
    } as never
  })
  const getResource = methods.getResource as (id: string, p?: string) => Promise<Record<string, unknown>>
  // The getDetails rejection must surface as a clean getResource rejection,
  // not an unhandled rejection or a swallowed error.
  await assert.rejects(getResource('1'), /detail boom/)
})

test('setResource rejects with a multi-source read-only message', async () => {
  const methods = startMethods({})
  const setResource = methods.setResource as () => Promise<void>
  await assert.rejects(setResource(), /Crow's nest notes resources are read-only/)
})

test('deleteResource rejects with a multi-source read-only message', async () => {
  const methods = startMethods({})
  const deleteResource = methods.deleteResource as () => Promise<void>
  await assert.rejects(deleteResource(), /Crow's nest notes resources are read-only/)
})

test('the note publishes the source-provided skIcon verbatim, not a type-derived value', async () => {
  // skIcon is required on PoiSummary, so every source picks a Freeboard-
  // registered icon at construction. The notes output publishes that choice
  // unchanged: it does not derive the icon from the POI type (a
  // type.toLowerCase() would produce unregistered names like "boatramp" or
  // "localknowledge" that Freeboard renders as the default yellow square).
  // A BoatRamp tagged with an unrelated icon proves the value flows through
  // rather than being recomputed from the type.
  const iconContext = contextWith({
    pois: {
      id: 'activecaptain',
      listPointsOfInterest: async () => [
        {
          id: '7',
          name: 'Tagged POI',
          type: 'BoatRamp',
          position: { latitude: 0, longitude: 0 },
          source: 'activecaptain',
          url: 'https://activecaptain.garmin.com/en-US/pois/7',
          attribution: 'Data from Garmin ActiveCaptain',
          skIcon: 'notice-to-mariners'
        }
      ],
      getDetails: async () => ({
        name: 'Tagged POI',
        type: 'BoatRamp',
        position: { latitude: 0, longitude: 0 },
        url: 'https://activecaptain.garmin.com/en-US/pois/7',
        source: 'activecaptain',
        attribution: 'Data from Garmin ActiveCaptain',
        skIcon: 'notice-to-mariners'
      }),
      cacheSize: () => 0,
      close: () => {}
    } as never
  })
  const { app, provider } = recordingApp()
  notesResourceOutput.start({ ...iconContext, app: app as never })
  const methods = provider.methods as Record<string, unknown>
  const listResources = methods.listResources as (q: object) => Promise<Record<string, { properties: { skIcon: string } }>>
  const result = await listResources({ bbox: '0,0,1,1' })
  assert.equal(result['7'].properties.skIcon, 'notice-to-mariners')
})
