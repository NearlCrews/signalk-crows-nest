import test from 'node:test'
import assert from 'node:assert/strict'
import { notesResourceOutput } from '../src/outputs/notes-resource/notes-resource-output.js'
import type { OutputContext } from '../src/outputs/output.js'
import type { PoiDetails } from '../src/shared/types.js'

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
        { id: '1', name: 'A', type: 'Marina', position: { latitude: 0, longitude: 0 } }
      ],
      getDetails: async (): Promise<PoiDetails> => ({
        pointOfInterest: {
          name: 'A',
          poiType: 'Marina',
          mapLocation: { latitude: 0, longitude: 0 },
          dateLastModified: '2020-01-01 00:00:00'
        }
      }) as unknown as PoiDetails,
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

test('the output is always enabled', () => {
  assert.equal(notesResourceOutput.isEnabled({} as never), true)
})

test('the config fragment carries the minimumRating property', () => {
  assert.deepEqual(Object.keys(notesResourceOutput.configSchema), ['minimumRating'])
})

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

test('listResources records the list fetch on the status recorder', async () => {
  let recorded: number | undefined
  const methods = startMethods({
    status: {
      recordListFetch: (count: number) => { recorded = count },
      recordError: () => {},
      recordDetailSuccess: () => {}
    } as never
  })
  const listResources = methods.listResources as (q: object) => Promise<Record<string, unknown>>
  await listResources({ bbox: '0,0,1,1' })
  assert.equal(recorded, 1)
})

test('listResources records the error and rethrows on a list failure', async () => {
  let recorded: string | undefined
  const methods = startMethods({
    status: {
      recordListFetch: () => {},
      recordError: (message: string) => { recorded = message },
      recordDetailSuccess: () => {}
    } as never,
    pois: {
      id: 'activecaptain',
      listPointsOfInterest: async () => { throw new Error('boom') },
      getDetails: async (): Promise<PoiDetails> => { throw new Error('not used') },
      cacheSize: () => 0,
      close: () => {}
    } as never
  })
  const listResources = methods.listResources as (q: object) => Promise<Record<string, unknown>>
  await assert.rejects(listResources({ bbox: '0,0,1,1' }), /boom/)
  assert.match(recorded ?? '', /boom/)
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
      getDetails: async (): Promise<PoiDetails> => { throw new Error('detail boom') },
      cacheSize: () => 0,
      close: () => {}
    } as never
  })
  const getResource = methods.getResource as (id: string, p?: string) => Promise<Record<string, unknown>>
  // The getDetails rejection must surface as a clean getResource rejection,
  // not an unhandled rejection or a swallowed error.
  await assert.rejects(getResource('1'), /detail boom/)
})

test('setResource rejects', async () => {
  const methods = startMethods({})
  const setResource = methods.setResource as () => Promise<void>
  await assert.rejects(setResource(), /read-only/)
})

test('deleteResource rejects', async () => {
  const methods = startMethods({})
  const deleteResource = methods.deleteResource as () => Promise<void>
  await assert.rejects(deleteResource(), /read-only/)
})
