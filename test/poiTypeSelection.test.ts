import test from 'node:test'
import assert from 'node:assert/strict'
import { POI_TYPE_FLAGS, buildPoiTypesString } from '../src/shared/poi-type-selection.js'

test('buildPoiTypesString returns every type for a config with no flag keys', () => {
  const result = buildPoiTypesString({})
  assert.ok(result !== null)
  const types = result.split(',')
  assert.equal(types.length, POI_TYPE_FLAGS.length)
  assert.ok(types.includes('Marina'))
  assert.ok(types.includes('Airport'))
})

test('buildPoiTypesString returns null when every flag is explicitly false', () => {
  // All flag keys present and false is a deliberate "select none": the plugin
  // should import nothing, distinct from a pre-toggles config with no keys.
  const config = Object.fromEntries(POI_TYPE_FLAGS.map(([flag]) => [flag, false]))
  assert.equal(buildPoiTypesString(config), null)
})

test('buildPoiTypesString returns null when some flags are present and none is true', () => {
  assert.equal(buildPoiTypesString({ includeMarinas: false, includeHazards: false }), null)
})

test('buildPoiTypesString returns only the selected types', () => {
  const result = buildPoiTypesString({ includeMarinas: true, includeAnchorages: true })
  assert.equal(result, 'Marina,Anchorage')
})

test('buildPoiTypesString ignores flags that are not strictly true', () => {
  const result = buildPoiTypesString({
    includeMarinas: true,
    includeHazards: undefined,
    includeLocks: false
  })
  assert.equal(result, 'Marina')
})

test('buildPoiTypesString returns all selected types when every flag is true', () => {
  const config = Object.fromEntries(POI_TYPE_FLAGS.map(([flag]) => [flag, true]))
  const result = buildPoiTypesString(config)
  assert.ok(result !== null)
  assert.equal(result.split(',').length, POI_TYPE_FLAGS.length)
})
