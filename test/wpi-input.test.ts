/**
 * Tests for the World Port Index input module contract.
 *
 * These pin the surface the aggregate registry and the config panel wire
 * against: the id and name, the config-schema keys, the enable and dedupe
 * predicates, and that the factory builds a usable PoiSource.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { wpiInput } from '../src/inputs/wpi/wpi-input.js'
import { WPI_SOURCE_ID } from '../src/shared/source-ids.js'
import { DEFAULT_DEDUPE_RADIUS_METERS } from '../src/shared/dedupe-radius.js'
import type { InputContext } from '../src/inputs/poi-source.js'
import type { PluginConfig } from '../src/shared/types.js'

test('the module identifies itself and exposes its config-schema keys', () => {
  assert.equal(wpiInput.id, WPI_SOURCE_ID)
  assert.equal(wpiInput.name, 'NGA World Port Index')
  for (const key of ['wpiEnabled', 'wpiDedupe', 'wpiDedupeRadiusMeters', 'wpiRefreshHours']) {
    assert.ok(key in wpiInput.configSchema, `config schema missing ${key}`)
  }
})

test('isEnabled follows the wpiEnabled toggle', () => {
  assert.equal(wpiInput.isEnabled({ wpiEnabled: true } as PluginConfig), true)
  assert.equal(wpiInput.isEnabled({ wpiEnabled: false } as PluginConfig), false)
  assert.equal(wpiInput.isEnabled({} as PluginConfig), false)
})

test('dedupe defaults on and reads the per-source radius', () => {
  assert.equal(wpiInput.isDedupeEnabled?.({} as PluginConfig), true)
  assert.equal(wpiInput.isDedupeEnabled?.({ wpiDedupe: false } as PluginConfig), false)
  // An unusable radius resolves to null so the registry falls back to its default.
  assert.equal(wpiInput.dedupeRadiusMeters?.({} as PluginConfig), null)
  assert.equal(
    wpiInput.dedupeRadiusMeters?.({ wpiDedupeRadiusMeters: 250 } as PluginConfig),
    250
  )
  // Sanity: the default the registry substitutes is the shared dedupe radius.
  assert.ok(DEFAULT_DEDUPE_RADIUS_METERS > 0)
})

test('createSource builds a usable PoiSource', () => {
  const context = {
    config: {} as PluginConfig,
    status: { recordError: () => {}, recordDetailSuccess: () => {} },
    getCurrentPosition: () => undefined,
    dataDir: undefined
  } as unknown as InputContext
  const source = wpiInput.createSource(context)
  assert.equal(source.id, WPI_SOURCE_ID)
  assert.equal(typeof source.listPointsOfInterest, 'function')
  assert.equal(typeof source.getDetails, 'function')
  assert.equal(source.cacheSize(), 0)
  source.close()
})
