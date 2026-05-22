import test from 'node:test'
import assert from 'node:assert/strict'
import { assemblePluginSchema } from '../src/plugin/plugin-config.js'

test('assemblePluginSchema merges fragments in order', () => {
  const schema = assemblePluginSchema('Title', 'Desc', [
    { cachingDurationMinutes: { type: 'number' }, a: { type: 'boolean' } },
    { b: { type: 'number' } }
  ])
  assert.equal(schema.title, 'Title')
  assert.equal(schema.description, 'Desc')
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['cachingDurationMinutes'])
  assert.deepEqual(Object.keys(schema.properties), ['cachingDurationMinutes', 'a', 'b'])
})

test('assemblePluginSchema rejects a duplicated property key', () => {
  assert.throws(
    () => assemblePluginSchema('T', 'D', [{ a: {} }, { a: {} }]),
    /duplicate config property/i
  )
})

test('assemblePluginSchema rejects a required key with no backing property', () => {
  // None of the fragments declares cachingDurationMinutes (the always-required
  // property), so the merged schema would carry a required slot with no
  // schema; the assembler must throw rather than emit it.
  assert.throws(
    () => assemblePluginSchema('T', 'D', [{ other: {} }]),
    /required config property "cachingDurationMinutes".*not declared/i
  )
})
