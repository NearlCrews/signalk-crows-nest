/**
 * Tests for the OpenSeaMap endpoint validation the connection fields and the
 * save bar share.
 *
 * The rule under test is deliberately not restated in the panel: each check
 * runs the value through the same coercion the plugin uses and asks whether it
 * survived. These cases pin the consequences of that, in particular the ones
 * where a silently coerced value used to reach the configuration.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  endpointInvalidMessage,
  fallbackEndpointsError,
  primaryEndpointError
} from '../src/panel/endpoint-validation.js'
import { DEFAULT_OVERPASS_ENDPOINT } from '../src/shared/overpass-endpoints.js'
import type { PluginConfig } from '../src/shared/types.js'

/** A configuration carrying only the two fields under test. */
function config (overrides: Partial<PluginConfig> = {}): PluginConfig {
  return { ...overrides } as PluginConfig
}

test('a usable endpoint reports nothing', () => {
  assert.equal(primaryEndpointError(DEFAULT_OVERPASS_ENDPOINT), undefined)
  assert.equal(primaryEndpointError('http://192.168.1.20/api/interpreter'), undefined)
  // Surrounding whitespace survives the plugin's own trim, so it is not an error.
  assert.equal(primaryEndpointError('  https://overpass.kumi.systems/api/interpreter  '), undefined)
})

test('a blank endpoint is not an error, because the plugin documents it as the default', () => {
  // An empty box claims to be no endpoint at all, so it cannot mislead the
  // way a wrong one does, and the plugin treats it as "use the default".
  assert.equal(primaryEndpointError(''), undefined)
  assert.equal(primaryEndpointError('   '), undefined)
  assert.equal(primaryEndpointError(undefined), undefined)
})

test('an endpoint the plugin would silently replace is reported', () => {
  // Each of these resolves to the FOSSGIS default inside the plugin, so
  // without this the operator's value was saved, ignored, and then lost.
  for (const value of [
    'overpass-api.de/api/interpreter',
    'ftp://overpass-api.de/api/interpreter',
    'javascript:alert(1)',
    'https://user:secret@overpass-api.de/api/interpreter',
    'not a url at all'
  ]) {
    assert.notEqual(primaryEndpointError(value), undefined, value)
  }
})

test('fallback lines are reported by position, blanks ignored', () => {
  assert.equal(fallbackEndpointsError([]), undefined)
  assert.equal(fallbackEndpointsError(undefined), undefined)
  assert.equal(fallbackEndpointsError(['', '   ', '']), undefined)
  assert.equal(
    fallbackEndpointsError(['https://overpass.kumi.systems/api/interpreter', '', 'nope']),
    'Line 3 is not a full http or https URL with no embedded credentials.'
  )
})

test('several bad fallback lines read as a list with a serial comma', () => {
  assert.equal(
    fallbackEndpointsError(['one', 'two', 'three']),
    'Lines 1, 2, and 3 are not a full http or https URL with no embedded credentials.'
  )
  assert.equal(
    fallbackEndpointsError(['one', 'https://overpass.kumi.systems/api/interpreter', 'three']),
    'Lines 1 and 3 are not a full http or https URL with no embedded credentials.'
  )
})

test('a repeated mirror is not reported, because collapsing it costs nothing', () => {
  const mirror = 'https://overpass.kumi.systems/api/interpreter'
  assert.equal(fallbackEndpointsError([mirror, mirror]), undefined)
})

test('the save-bar message names every field that is holding the save', () => {
  assert.equal(endpointInvalidMessage(config()), undefined)
  assert.equal(
    endpointInvalidMessage(config({ openSeaMapEndpoint: DEFAULT_OVERPASS_ENDPOINT })),
    undefined
  )
  assert.equal(
    endpointInvalidMessage(config({ openSeaMapEndpoint: 'nope' })),
    'Overpass API endpoint URL needs a full http or https URL with no embedded credentials.'
  )
  assert.equal(
    endpointInvalidMessage(config({ openSeaMapFallbackEndpoints: ['nope'] })),
    'Fallback endpoints needs a full http or https URL with no embedded credentials.'
  )
  assert.equal(
    endpointInvalidMessage(config({
      openSeaMapEndpoint: 'nope',
      openSeaMapFallbackEndpoints: ['also nope']
    })),
    'Overpass API endpoint URL and Fallback endpoints need a full http or https URL with no embedded credentials.'
  )
})
