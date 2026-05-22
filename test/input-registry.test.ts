import test from 'node:test'
import assert from 'node:assert/strict'
import { createInputRegistry } from '../src/inputs/input-registry.js'
import type { InputModule, PoiSource } from '../src/inputs/poi-source.js'

function stubSource (id: string): PoiSource {
  return {
    id,
    listPointsOfInterest: async () => [],
    getDetails: async () => { throw new Error('not used') },
    cacheSize: () => 0,
    close: () => {}
  }
}

function stubModule (id: string, enabled: boolean): InputModule {
  return {
    id,
    name: id,
    configSchema: { [`enable_${id}`]: { type: 'boolean' } },
    isEnabled: () => enabled,
    createSource: () => stubSource(id)
  }
}

const context = { app: {}, config: {}, status: {}, dataDir: '/tmp' } as never

test('configSchemaFragments returns every module fragment', () => {
  const registry = createInputRegistry([stubModule('a', true), stubModule('b', false)])
  assert.deepEqual(registry.configSchemaFragments(), [
    { enable_a: { type: 'boolean' } },
    { enable_b: { type: 'boolean' } }
  ])
})

test('createSource returns the enabled module source', () => {
  const registry = createInputRegistry([stubModule('a', false), stubModule('b', true)])
  assert.equal(registry.createSource(context).id, 'b')
})

test('createSource throws when no module is enabled', () => {
  const registry = createInputRegistry([stubModule('a', false)])
  assert.throws(() => registry.createSource(context), /no input is enabled/i)
})

test('createSource warns and uses the first input when several are enabled', () => {
  const errors: string[] = []
  const registry = createInputRegistry([
    stubModule('a', true),
    stubModule('b', true),
    stubModule('c', false)
  ])
  const multiContext = {
    app: { error: (message: string) => errors.push(message) },
    config: {},
    status: {},
    dataDir: '/tmp'
  } as never
  const source = registry.createSource(multiContext)
  assert.equal(source.id, 'a', 'the first enabled input is used')
  assert.equal(errors.length, 1, 'the misconfiguration is logged once via app.error')
  assert.match(errors[0], /Multiple inputs are enabled/, 'the log explains the misconfiguration')
  assert.match(errors[0], /a, b/, 'the log names only the enabled inputs')
  assert.match(errors[0], /using "a" only/, 'the log names the input that is used')
})
