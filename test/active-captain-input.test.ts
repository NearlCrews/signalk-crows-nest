import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { activeCaptainInput } from '../src/inputs/active-captain/active-captain-input.js'
import type { InputContext } from '../src/inputs/poi-source.js'

test('the input is always enabled', () => {
  assert.equal(activeCaptainInput.isEnabled({} as never), true)
})

test('the config fragment carries the caching and POI-type properties', () => {
  const keys = Object.keys(activeCaptainInput.configSchema)
  assert.ok(keys.includes('cachingDurationMinutes'))
  assert.ok(keys.includes('includeMarinas'))
  assert.equal(keys.filter((k) => k.startsWith('include')).length, 13)
})

test('createSource builds the ActiveCaptain PoiSource', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crows-nest-'))
  try {
    const context = {
      app: { debug: () => {}, setPluginError: () => {} },
      config: {},
      status: { recordDetailSuccess: () => {}, recordError: () => {} },
      dataDir
    } as unknown as InputContext
    const source = activeCaptainInput.createSource(context)
    assert.equal(source.id, 'activecaptain')
    assert.equal(typeof source.listPointsOfInterest, 'function')
    assert.equal(typeof source.getDetails, 'function')
    source.close()
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
