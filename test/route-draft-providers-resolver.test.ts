import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hazardDedupeKey,
  resolveProviders,
  type LegSafetyProvider
} from '../src/route-draft/providers/provider.js'
import { seamarkLabel } from '../src/inputs/openseamap/seamark-mapping.js'
import type { EncLayerKey } from '../src/inputs/noaa-enc/enc-direct-types.js'
import type { Position } from '../src/shared/types.js'

function stub (id: string, covers: boolean, precedence = 0): LegSafetyProvider {
  return {
    id,
    capabilities: new Set(),
    precedence,
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

test('resolveProviders preserves the input order (which the orchestrator sorts by precedence)', () => {
  // resolveProviders does not sort; it filters and keeps order. The orchestrator
  // hands it an already-precedence-sorted list, so the active set is in precedence
  // order too.
  const sorted = [stub('osm', true, 20), stub('enc', true, 0)].sort((a, b) => a.precedence - b.precedence)
  const active = resolveProviders(sorted, A, B)
  assert.deepEqual(active.map((p) => p.id), ['enc', 'osm'])
})

test('the cross-provider hazard key matches between the ENC layer key and the OpenSeaMap label, for every hazard type', () => {
  // The cross-provider dedupe only collapses the same charted hazard reported by
  // both sources because the ENC layer key equals the OpenSeaMap seamark label
  // lowercased. This locks that equality so a future vocabulary drift on either
  // side fails CI instead of silently doubling every wreck, obstruction, and rock.
  const pos: Position = { latitude: 40.5, longitude: -74.0505 }
  // Each ENC hazard layer key paired with the OSM seamark:type it corresponds to.
  const pairs: Array<{ encLayerKey: EncLayerKey, osmSeamarkType: string }> = [
    { encLayerKey: 'wreck', osmSeamarkType: 'wreck' },
    { encLayerKey: 'obstruction', osmSeamarkType: 'obstruction' },
    { encLayerKey: 'rock', osmSeamarkType: 'rock' }
  ]
  for (const { encLayerKey, osmSeamarkType } of pairs) {
    // The OSM provider derives its type word from seamarkLabel(...).toLowerCase().
    const osmTypeWord = seamarkLabel(osmSeamarkType)?.toLowerCase()
    assert.ok(osmTypeWord !== undefined, `seamarkLabel should map ${osmSeamarkType}`)
    assert.equal(
      hazardDedupeKey(encLayerKey, pos),
      hazardDedupeKey(osmTypeWord!, pos),
      `ENC layer key "${encLayerKey}" and OSM label for "${osmSeamarkType}" must produce the same dedupe key`
    )
  }
})
