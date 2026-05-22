import test from 'node:test'
import assert from 'node:assert/strict'
import type { ServerAPI } from '@signalk/server-api'
import createPluginFactory from '../src/index.js'
import { activeCaptainInput } from '../src/inputs/active-captain/active-captain-input.js'
import { notesResourceOutput } from '../src/outputs/notes-resource/notes-resource-output.js'
import { proximityAlarmOutput } from '../src/outputs/proximity-alarm/proximity-alarm-output.js'
import { routeHazardOutput } from '../src/outputs/route-hazard/route-hazard-output.js'

/**
 * The entrypoint reads `app` only inside the plugin's lifecycle closures, so a
 * bare stub is enough to build the plugin and inspect its assembled schema.
 */
const stubApp = {} as unknown as ServerAPI

test('the entrypoint wires the real input and output modules', () => {
  const plugin = createPluginFactory(stubApp)
  const { properties } = plugin.schema as unknown as { properties: Record<string, unknown> }

  // The assembled schema is the merge of every registered module's fragment,
  // so every key each real module contributes must be present.
  const modules = [activeCaptainInput, notesResourceOutput, proximityAlarmOutput, routeHazardOutput]
  for (const module of modules) {
    for (const key of Object.keys(module.configSchema)) {
      assert.ok(key in properties, `${module.id} contributes "${key}" to the plugin schema`)
    }
  }
})

test('the entrypoint returns a plugin with the shared id and lifecycle hooks', () => {
  const plugin = createPluginFactory(stubApp)
  assert.equal(typeof plugin.id, 'string')
  assert.ok(plugin.id.length > 0, 'the plugin has an id')
  assert.equal(typeof plugin.start, 'function', 'the plugin exposes start')
  assert.equal(typeof plugin.stop, 'function', 'the plugin exposes stop')
})
