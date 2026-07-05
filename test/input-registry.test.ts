import test from 'node:test'
import assert from 'node:assert/strict'
import { createInputRegistry } from '../src/inputs/input-registry.js'
import { createPluginStatus } from '../src/status/plugin-status.js'
import type { InputModule, PoiSource } from '../src/inputs/poi-source.js'
import type { Bbox, PoiDetailView, PoiSummary } from '../src/shared/types.js'

const SAMPLE_BBOX: Bbox = { north: 1, south: 0, east: 1, west: 0 }

/** Build a source-tagged summary. */
function summary (id: string, source: string): PoiSummary {
  return {
    id,
    type: 'Marina',
    position: { latitude: 0, longitude: 0 },
    name: `POI ${id}`,
    source,
    url: `https://example.test/${id}`,
    attribution: `Data from ${source}`,
    skIcon: 'marina'
  }
}

/** Build a source-tagged detail view. */
function detailView (source: string): PoiDetailView {
  return {
    name: 'Detail',
    type: 'Marina',
    position: { latitude: 0, longitude: 0 },
    url: 'https://example.test/detail',
    source,
    attribution: `Data from ${source}`,
    skIcon: 'marina'
  }
}

interface StubOptions {
  list?: () => Promise<PoiSummary[]>
  details?: (id: string) => Promise<PoiDetailView>
  cache?: number
}

function stubSource (id: string, options: StubOptions = {}): PoiSource {
  return {
    id,
    listPointsOfInterest: options.list ?? (async () => [summary('raw1', id)]),
    getDetails: options.details ?? (async () => detailView(id)),
    cacheSize: () => options.cache ?? 0,
    close: () => {}
  }
}

function stubModule (id: string, enabled: boolean, source?: PoiSource): InputModule {
  return {
    id,
    name: id,
    configSchema: { [`enable_${id}`]: { type: 'boolean' } },
    isEnabled: () => enabled,
    createSource: () => source ?? stubSource(id)
  }
}

/** A no-op status recorder, enough for tests that do not inspect status. */
const silentStatus = {
  recordListFetch: () => {},
  recordDetailSuccess: () => {},
  recordError: () => {},
  recordSkipped: () => {},
  wasListFetchSuppressed: () => false
}

const context = {
  app: {}, config: {}, status: silentStatus, dataDir: '/tmp'
} as never

test('configSchemaFragments returns every module fragment', () => {
  const registry = createInputRegistry([stubModule('a', true), stubModule('b', false)])
  assert.deepEqual(registry.configSchemaFragments(), [
    { enable_a: { type: 'boolean' } },
    { enable_b: { type: 'boolean' } }
  ])
})

test('createSource throws when no module is enabled', () => {
  const registry = createInputRegistry([stubModule('a', false)])
  assert.throws(() => registry.createSource(context), /no input is enabled/i)
})

test('createSource builds an aggregate over the enabled inputs', () => {
  const registry = createInputRegistry([stubModule('a', true), stubModule('b', false)])
  assert.equal(registry.createSource(context).id, 'aggregate')
})

test('listPointsOfInterest prefixes each summary id with its source slug and unions results', async () => {
  const a = stubModule('sourceA', true, stubSource('sourceA', {
    list: async () => [summary('1', 'sourceA'), summary('2', 'sourceA')]
  }))
  const b = stubModule('sourceB', true, stubSource('sourceB', {
    list: async () => [summary('9', 'sourceB')]
  }))
  const source = createInputRegistry([a, b]).createSource(context)
  const list = await source.listPointsOfInterest(SAMPLE_BBOX, '')
  assert.deepEqual(
    list.map((poi) => poi.id).sort(),
    ['sourceA-1', 'sourceA-2', 'sourceB-9']
  )
})

test('getDetails routes to the source named by the id prefix, stripping the prefix', async () => {
  const seen: string[] = []
  const b = stubModule('sourceB', true, stubSource('sourceB', {
    details: async (id) => { seen.push(id); return detailView('sourceB') }
  }))
  const source = createInputRegistry([stubModule('sourceA', true), b]).createSource(context)
  const view = await source.getDetails('sourceB-raw1')
  assert.equal(view.source, 'sourceB')
  assert.deepEqual(seen, ['raw1'], 'only the prefix is stripped; the raw id reaches the source')
})

test('getDetails routes a raw id that itself contains hyphens on the first hyphen only', async () => {
  const seen: string[] = []
  const b = stubModule('openseamap', true, stubSource('openseamap', {
    details: async (id) => { seen.push(id); return detailView('openseamap') }
  }))
  const source = createInputRegistry([b]).createSource(context)
  await source.getDetails('openseamap-node/987-654')
  assert.deepEqual(seen, ['node/987-654'])
})

test('getDetails rejects an unknown source prefix', async () => {
  const source = createInputRegistry([stubModule('sourceA', true)]).createSource(context)
  await assert.rejects(source.getDetails('unknown-x'), /No source/i)
})

test('listPointsOfInterest keeps a successful source when another fails', async () => {
  const errors: string[] = []
  const failing = stubModule('sourceA', true, stubSource('sourceA', {
    list: async () => { throw new Error('overpass down') }
  }))
  const ok = stubModule('sourceB', true, stubSource('sourceB', {
    list: async () => [summary('9', 'sourceB')]
  }))
  const failContext = {
    app: {},
    config: {},
    dataDir: '/tmp',
    status: {
      recordListFetch: () => {},
      recordDetailSuccess: () => {},
      recordError: (_source: string, message: string) => errors.push(message),
      recordSkipped: () => {},
      wasListFetchSuppressed: () => false
    }
  } as never
  const source = createInputRegistry([failing, ok]).createSource(failContext)
  const list = await source.listPointsOfInterest(SAMPLE_BBOX, '')
  assert.deepEqual(list.map((poi) => poi.id), ['sourceB-9'])
  assert.equal(errors.length, 1, 'the failed source is recorded as an error')
  assert.match(errors[0], /sourceA/)
})

test('listPointsOfInterest throws when every source fails', async () => {
  const failing = stubModule('sourceA', true, stubSource('sourceA', {
    list: async () => { throw new Error('down') }
  }))
  const source = createInputRegistry([failing]).createSource(context)
  await assert.rejects(
    source.listPointsOfInterest(SAMPLE_BBOX, ''),
    /Every POI source failed/i
  )
})

test('listPointsOfInterest records each source list outcome onto the per-source status', async () => {
  const fetches: Array<{ source: string, count: number }> = []
  const errors: string[] = []
  const ok = stubModule('sourceA', true, stubSource('sourceA', {
    list: async () => [summary('1', 'sourceA'), summary('2', 'sourceA')]
  }))
  const failing = stubModule('sourceB', true, stubSource('sourceB', {
    list: async () => { throw new Error('overpass down') }
  }))
  const recordingContext = {
    app: {},
    config: {},
    dataDir: '/tmp',
    status: {
      recordListFetch: (source: string, count: number) => fetches.push({ source, count }),
      recordDetailSuccess: () => {},
      recordError: (_source: string, message: string) => errors.push(message),
      recordSkipped: () => {},
      wasListFetchSuppressed: () => false
    }
  } as never
  const source = createInputRegistry([ok, failing]).createSource(recordingContext)
  await source.listPointsOfInterest(SAMPLE_BBOX, '')
  assert.deepEqual(fetches, [{ source: 'sourceA', count: 2 }], 'the fulfilled source records its fetch')
  assert.equal(errors.length, 1, 'the rejected source records an error')
  assert.match(errors[0], /sourceB/)
})

test('cacheSize sums the cache size of every source', () => {
  const a = stubModule('sourceA', true, stubSource('sourceA', { cache: 3 }))
  const b = stubModule('sourceB', true, stubSource('sourceB', { cache: 4 }))
  const source = createInputRegistry([a, b]).createSource(context)
  assert.equal(source.cacheSize(), 7)
})

test('listPointsOfInterest passes each non-base module\'s dedupeRadiusMeters through to the dedupe pass', async () => {
  // A base POI and a non-base POI ~20 m apart. With the per-source default
  // (150 m) they merge into one. With the non-base module reporting a 5 m
  // radius they stay separate, proving the per-module radius reached
  // dedupeAgainstBase as the per-source map entry.
  const NEAR_M = 0.00018 // ~20 m of latitude
  const baseAt = (latitude: number): PoiSummary => ({
    ...summary('1', 'activecaptain'),
    position: { latitude, longitude: 0 }
  })
  const otherAt = (latitude: number): PoiSummary => ({
    ...summary('node/9', 'other'),
    position: { latitude, longitude: 0 }
  })
  const base = stubModule('activecaptain', true, stubSource('activecaptain', {
    list: async () => [baseAt(10)]
  }))
  // Like the production OpenSeaMap, USCG, and NOAA modules, this stub
  // surfaces its dedupe radius by reading a per-source config key.
  const other: InputModule = {
    id: 'other',
    name: 'other',
    configSchema: {},
    isEnabled: () => true,
    isDedupeEnabled: () => true,
    dedupeRadiusMeters: (config) => {
      const v = (config as { otherDedupeRadiusMeters?: number }).otherDedupeRadiusMeters
      return typeof v === 'number' && v > 0 ? v : undefined
    },
    createSource: () => stubSource('other', {
      list: async () => [otherAt(10 + NEAR_M)]
    })
  }

  const wide = createInputRegistry([base, other]).createSource(context)
  const wideList = await wide.listPointsOfInterest(SAMPLE_BBOX, '')
  assert.equal(wideList.length, 1, 'at the default 150 m radius the dup merges into the base')

  const tightContext = {
    app: {},
    config: { otherDedupeRadiusMeters: 5 },
    status: silentStatus,
    dataDir: '/tmp'
  } as never
  const tight = createInputRegistry([base, other]).createSource(tightContext)
  const tightList = await tight.listPointsOfInterest(SAMPLE_BBOX, '')
  assert.equal(tightList.length, 2, 'at a 5 m radius the same dup is kept separate')
})

test('close closes every source', () => {
  const closed: string[] = []
  const makeSource = (id: string): PoiSource => ({
    ...stubSource(id), close: () => closed.push(id)
  })
  const a = stubModule('sourceA', true, makeSource('sourceA'))
  const b = stubModule('sourceB', true, makeSource('sourceB'))
  createInputRegistry([a, b]).createSource(context).close()
  assert.deepEqual(closed.sort(), ['sourceA', 'sourceB'])
})

test('listPointsOfInterest times out a slow source, ships the others, and records the slow source as skipped', async () => {
  // The slow source's promise never resolves; the fast source returns
  // immediately. The aggregate's per-source timeout wins the race for
  // the slow source and ships the fast source's POIs alone. A short
  // override on the registry's perSourceListTimeoutMs makes the test
  // resolve in well under a second rather than waiting the production 5 s.
  const skips: Array<{ source: string, reason: string }> = []
  const fetches: Array<{ source: string, count: number }> = []
  const slow = stubModule('slow', true, stubSource('slow', {
    list: () => new Promise<PoiSummary[]>(() => {})
  }))
  const fast = stubModule('fast', true, stubSource('fast', {
    list: async () => [summary('1', 'fast'), summary('2', 'fast')]
  }))
  const ctx = {
    app: { debug: () => {} },
    config: {},
    dataDir: '/tmp',
    status: {
      recordListFetch: (source: string, count: number) => fetches.push({ source, count }),
      recordDetailSuccess: () => {},
      recordError: () => {},
      recordSkipped: (source: string, reason: string) => skips.push({ source, reason }),
      wasListFetchSuppressed: () => false
    }
  } as never
  const registry = createInputRegistry([slow, fast], { perSourceListTimeoutMs: 25 })
  const source = registry.createSource(ctx)
  const list = await source.listPointsOfInterest(SAMPLE_BBOX, '')
  assert.deepEqual(
    list.map((poi) => poi.id).sort(),
    ['fast-1', 'fast-2'],
    'the fast source ships immediately; the slow source contributes nothing this call'
  )
  assert.deepEqual(fetches, [{ source: 'fast', count: 2 }], 'only the fast source records a list fetch')
  assert.equal(skips.length, 1)
  assert.equal(skips[0].source, 'slow')
  assert.match(skips[0].reason, /exceeded|timed out/i)
})

test('listPointsOfInterest does not throw when every source times out', async () => {
  // If every source times out, the aggregate ships an empty partial result
  // rather than rejecting: the background fetches keep running and the
  // chartplotter's next refresh will see their populated bbox-debounce
  // caches.
  const stuck = stubModule('stuck', true, stubSource('stuck', {
    list: () => new Promise<PoiSummary[]>(() => {})
  }))
  const ctx = {
    app: { debug: () => {} },
    config: {},
    dataDir: '/tmp',
    status: silentStatus
  } as never
  const registry = createInputRegistry([stuck], { perSourceListTimeoutMs: 25 })
  const list = await registry.createSource(ctx).listPointsOfInterest(SAMPLE_BBOX, '')
  assert.deepEqual(list, [])
})

test('listPointsOfInterest clones each summary position so a downstream mutation does not corrupt the cached entry', async () => {
  // The bbox-debounce caches share the same PoiSummary[] across hits, so the
  // aggregate must clone each `position` object when it rewrites the id;
  // otherwise a chartplotter consumer that mutates `note.position` (a
  // projection step, say) would silently corrupt the cached entry for the
  // next caller.
  const sharedPosition = { latitude: 12.34, longitude: 56.78 }
  const a = stubModule('sourceA', true, stubSource('sourceA', {
    list: async () => [{
      ...summary('1', 'sourceA'),
      position: sharedPosition
    }]
  }))
  const source = createInputRegistry([a]).createSource(context)
  const list = await source.listPointsOfInterest(SAMPLE_BBOX, '')
  assert.equal(list.length, 1)
  assert.notStrictEqual(
    list[0].position,
    sharedPosition,
    'the merged summary carries its own position object'
  )
  assert.deepEqual(list[0].position, sharedPosition, 'with the same coordinates')
})

test('listPointsOfInterest does NOT record a list fetch when a source returned empty due to skip', async () => {
  // The aggregate must distinguish "fetched zero POIs" (a real, recordable
  // outcome) from "did not bother, skipped" (the source returned empty after
  // calling recordSkipped). Recording a fetch in the second case would
  // overwrite the previous lastListFetch and flip apiReachable to true even
  // though no request was sent.
  const fetches: Array<{ source: string, count: number }> = []
  const skipFlag = { current: false }
  const fetchEmpty = stubModule('skipper', true, stubSource('skipper', {
    list: async () => {
      skipFlag.current = true
      return []
    }
  }))
  const fetchTwo = stubModule('worker', true, stubSource('worker', {
    list: async () => [summary('1', 'worker'), summary('2', 'worker')]
  }))
  const skipAwareContext = {
    app: {},
    config: {},
    dataDir: '/tmp',
    status: {
      recordListFetch: (source: string, count: number) => fetches.push({ source, count }),
      recordDetailSuccess: () => {},
      recordError: () => {},
      recordSkipped: () => { skipFlag.current = true },
      wasListFetchSuppressed: (source: string) => source === 'skipper' && skipFlag.current
    }
  } as never
  const source = createInputRegistry([fetchEmpty, fetchTwo]).createSource(skipAwareContext)
  await source.listPointsOfInterest(SAMPLE_BBOX, '')
  // Only the working source records a list fetch; the skipped source does
  // not, even though it returned a fulfilled empty array.
  assert.deepEqual(fetches, [{ source: 'worker', count: 2 }])
})

test('a source that skipped on one tick is not frozen out of recording a later real fetch', async () => {
  // Regression for the sticky-suppression freeze: a US-only source gates
  // itself out (recordSkipped + empty return) on tick 1, then returns POIs
  // on tick 2 after re-entering US waters. The later real fetch MUST be
  // recorded; with the old flag lifecycle, recordListFetch was gated behind
  // the very flag it would clear, so the row stayed null for the whole run.
  // Uses the real PluginStatus, not a stub, since the bug lived in the flag's
  // interaction with the registry's gate.
  const status = createPluginStatus([{ source: 'usonly', name: 'US Only' }])
  let outsideUsWaters = true
  const usonly = stubModule('usonly', true, stubSource('usonly', {
    list: async () => {
      if (outsideUsWaters) {
        status.recordSkipped('usonly', 'outside US waters')
        return []
      }
      return [summary('1', 'usonly')]
    }
  }))
  const ctx = { app: {}, config: {}, dataDir: '/tmp', status } as never
  const source = createInputRegistry([usonly]).createSource(ctx)

  // Tick 1: the source gates itself out and returns empty.
  await source.listPointsOfInterest(SAMPLE_BBOX, '')
  // Tick 2: the vessel re-enters US waters and the source returns POIs.
  outsideUsWaters = false
  await source.listPointsOfInterest(SAMPLE_BBOX, '')

  const row = status.snapshot(0).sources.find((s) => s.source === 'usonly')
  assert.equal(
    row?.apiReachable, true,
    'the real fetch after a skip is recorded, not suppressed for the rest of the run'
  )
  assert.equal(row?.lastListFetch?.poiCount, 1)
})

test('a source that served stale offline data ships its markers but is not recorded as a reachable fetch', async () => {
  // Offline restart: the source cannot reach upstream, so it serves cached
  // markers and calls recordStaleServe. The aggregate must union those markers
  // (offline hazard visibility) while leaving the source's recorded error state
  // in place: apiReachable must NOT flip to true, and no list fetch is recorded.
  // Uses the real PluginStatus so the freshness signal's interaction with the
  // registry's gate is exercised end to end.
  const status = createPluginStatus([{ source: 'stale', name: 'Stale Source' }])
  const staleModule = stubModule('stale', true, stubSource('stale', {
    list: async () => {
      status.recordStaleServe?.('stale', 'upstream unreachable')
      return [summary('1', 'stale'), summary('2', 'stale')]
    }
  }))
  const ctx = { app: {}, config: {}, dataDir: '/tmp', status } as never
  const source = createInputRegistry([staleModule]).createSource(ctx)

  const list = await source.listPointsOfInterest(SAMPLE_BBOX, '')
  assert.deepEqual(list.map((poi) => poi.id).sort(), ['stale-1', 'stale-2'],
    'the cached markers are still shipped so hazards stay visible offline')

  const row = status.snapshot(0).sources.find((s) => s.source === 'stale')
  assert.equal(row?.apiReachable, false, 'a stale offline serve is not laundered into reachable')
  assert.equal(row?.lastListFetch, null, 'no list fetch is recorded for a stale serve')
})
