import test from 'node:test'
import assert from 'node:assert/strict'
import { openSeaMapInput, resolveEndpoints } from '../src/inputs/openseamap/openseamap-input.js'
import type { InputContext } from '../src/inputs/poi-source.js'
import type { PluginConfig } from '../src/shared/types.js'
import { DEFAULT_OVERPASS_ENDPOINT } from '../src/shared/overpass-endpoints.js'
import { DEFAULT_DEDUPE_RADIUS_METERS } from '../src/shared/dedupe-radius.js'

test('isEnabled tracks the openSeaMapEnabled toggle', () => {
  assert.equal(openSeaMapInput.isEnabled({} as PluginConfig), false)
  assert.equal(openSeaMapInput.isEnabled({ openSeaMapEnabled: false } as PluginConfig), false)
  assert.equal(openSeaMapInput.isEnabled({ openSeaMapEnabled: true } as PluginConfig), true)
})

test('the config fragment carries the enable, endpoint, fallback-endpoints, seamark-group, dedupe, radius, minimum-year, and refresh-seconds keys', () => {
  // Asserted as a set, not an ordered list: the test cares that every key
  // exists in the schema, not that the input module declares them in a
  // particular order. A future re-grouping would otherwise fail this test
  // for purely cosmetic reasons.
  const keys = new Set(Object.keys(openSeaMapInput.configSchema))
  for (const expected of [
    'openSeaMapEnabled',
    'openSeaMapEndpoint',
    'openSeaMapFallbackEndpoints',
    'openSeaMapSeamarkGroups',
    'openSeaMapDedupe',
    'openSeaMapDedupeRadiusMeters',
    'openSeaMapMinimumYear',
    'openSeaMapRefreshSeconds'
  ]) {
    assert.ok(keys.has(expected), `expected schema to include "${expected}"`)
  }
})

test('resolveEndpoints puts the primary first, then deduped non-empty fallbacks', () => {
  // Default: a config with no endpoint falls back to the canonical default,
  // with no fallbacks.
  assert.deepEqual(resolveEndpoints({} as PluginConfig), [DEFAULT_OVERPASS_ENDPOINT])

  // The primary leads; blank and duplicate fallbacks (including one equal to
  // the primary) are dropped while order is preserved.
  assert.deepEqual(
    resolveEndpoints({
      openSeaMapEndpoint: 'https://primary.test/api',
      openSeaMapFallbackEndpoints: [' https://b.test/api ', '', 'https://primary.test/api', 'https://b.test/api', 'https://c.test/api']
    } as PluginConfig),
    ['https://primary.test/api', 'https://b.test/api', 'https://c.test/api']
  )

  // A blank primary falls back to the default, and real fallbacks still ride along.
  assert.deepEqual(
    resolveEndpoints({
      openSeaMapEndpoint: '   ',
      openSeaMapFallbackEndpoints: ['https://m.test/api']
    } as PluginConfig),
    [DEFAULT_OVERPASS_ENDPOINT, 'https://m.test/api']
  )
})

test('the seamark-groups schema enum and default are derived from the shared id list', () => {
  const field = openSeaMapInput.configSchema.openSeaMapSeamarkGroups as {
    items: { enum: string[] }
    default: string[]
  }
  assert.deepEqual(field.items.enum, ['hazards', 'navaids', 'harbours', 'infrastructure'])
  assert.deepEqual(field.default, ['hazards', 'navaids', 'harbours', 'infrastructure'])
})

test('the dedupe-radius schema field defaults to 150 feet and enforces a positive minimum', () => {
  const field = openSeaMapInput.configSchema.openSeaMapDedupeRadiusMeters as {
    type: string
    default: number
    minimum: number
  }
  assert.equal(field.type, 'number')
  // The exact 45.72 value is pinned once, in the dedupe-pois tests; this
  // test's claim is that the schema default is the shared constant.
  assert.equal(field.default, DEFAULT_DEDUPE_RADIUS_METERS)
  assert.equal(field.minimum, 1)
})

test('isDedupeEnabled defaults on and only an explicit false turns it off', () => {
  assert.equal(openSeaMapInput.isDedupeEnabled?.({} as PluginConfig), true)
  assert.equal(openSeaMapInput.isDedupeEnabled?.({ openSeaMapDedupe: true } as PluginConfig), true)
  assert.equal(openSeaMapInput.isDedupeEnabled?.({ openSeaMapDedupe: false } as PluginConfig), false)
})

test('createSource builds the OpenSeaMap PoiSource', () => {
  const context = {
    app: { debug: () => {}, error: () => {} },
    config: {},
    status: {},
    dataDir: ''
  } as unknown as InputContext
  const source = openSeaMapInput.createSource(context)
  assert.equal(source.id, 'openseamap')
  assert.equal(typeof source.listPointsOfInterest, 'function')
  assert.equal(typeof source.getDetails, 'function')
  source.close()
})
