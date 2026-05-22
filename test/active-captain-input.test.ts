import test from 'node:test'
import assert from 'node:assert/strict'
import { activeCaptainInput } from '../src/inputs/active-captain/active-captain-input.js'

test('the input is always enabled', () => {
  assert.equal(activeCaptainInput.isEnabled({} as never), true)
})

test('the config fragment carries the caching and POI-type properties', () => {
  const keys = Object.keys(activeCaptainInput.configSchema)
  assert.ok(keys.includes('cachingDurationMinutes'))
  assert.ok(keys.includes('includeMarinas'))
  assert.equal(keys.filter((k) => k.startsWith('include')).length, 13)
})
