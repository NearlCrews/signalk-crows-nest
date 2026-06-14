import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveProviders, type LegSafetyProvider } from '../src/route-draft/providers/provider.js'
import type { Position } from '../src/shared/types.js'

function stub (id: string, covers: boolean): LegSafetyProvider {
  return {
    id,
    capabilities: new Set(),
    coversLeg: () => covers,
    checkLeg: async () => ({ flags: [], coverage: {} })
  }
}

const A: Position = { latitude: 40, longitude: -74 }
const B: Position = { latitude: 41, longitude: -74 }

test('resolveProviders returns only providers whose footprint reaches the leg', () => {
  const active = resolveProviders([stub('enc', true), stub('osm', true), stub('emodnet', false)], A, B)
  assert.deepEqual(active.map((p) => p.id), ['enc', 'osm'])
})
