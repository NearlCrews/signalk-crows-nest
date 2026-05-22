import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeAgainstBase, BASE_SOURCE_ID } from '../src/inputs/dedupe-pois.js'
import type { PoiSummary, PoiType } from '../src/shared/types.js'

/** Build a POI at a latitude/longitude with the given source and type. */
function poi (
  id: string, source: string, type: PoiType, latitude: number, longitude: number
): PoiSummary {
  return {
    id,
    type,
    position: { latitude, longitude },
    name: `${source} ${id}`,
    source,
    url: `https://example.test/${source}/${id}`,
    attribution: `Data from ${source}`
  }
}

/** A latitude offset of about 20 m: well within the default 150 m radius. */
const NEAR = 0.00018
/** A latitude offset of about 5 km: well outside the merge radius. */
const FAR = 0.045

test('a non-base POI of the same type within the radius merges into the base POI', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const osm = poi('node/9', 'openseamap', 'Marina', 10 + NEAR, 20)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  assert.equal(result.length, 1, 'the duplicate is dropped, the base survives')
  assert.equal(result[0].source, BASE_SOURCE_ID, 'the base POI is the survivor')
  assert.equal(result[0].id, '1', 'the base POI keeps its id')
  assert.equal(result[0].name, 'activecaptain 1', 'the base POI content wins')
  assert.deepEqual(result[0].sources, ['activecaptain', 'openseamap'])
})

test('a non-base POI of a different type at the same spot does not merge', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const osm = poi('node/9', 'openseamap', 'Hazard', 10, 20)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  assert.equal(result.length, 2, 'a different type is treated as a different feature')
})

test('a dedupe-enabled non-base POI with no co-located base passes through unmerged', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const osm = poi('node/9', 'openseamap', 'Marina', 10 + FAR, 20)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  assert.equal(result.length, 2)
  const survivor = result.find((p) => p.source === 'openseamap')
  assert.deepEqual(survivor?.sources, ['openseamap'], 'its sources is just its own source')
})

test('two non-base sources co-located with one base POI all merge into it', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const osm = poi('node/9', 'openseamap', 'Marina', 10 + NEAR, 20)
  const wpi = poi('w7', 'worldportindex', 'Marina', 10, 20 + NEAR)
  const result = dedupeAgainstBase(
    [base, osm, wpi], new Set(['openseamap', 'worldportindex']), 50)
  assert.equal(result.length, 1)
  assert.deepEqual(
    [...(result[0].sources ?? [])].sort(),
    ['activecaptain', 'openseamap', 'worldportindex'])
})

test('the surviving base POI attribution credits every merged source', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const osm = poi('node/9', 'openseamap', 'Marina', 10 + NEAR, 20)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  assert.match(result[0].attribution, /activecaptain/i)
  assert.match(result[0].attribution, /openseamap/i)
})

test('a POI from a source not in the dedupe set is never merged or dropped', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const osm = poi('node/9', 'openseamap', 'Marina', 10 + NEAR, 20)
  // openseamap is co-located with the base but is not in the dedupe set.
  const result = dedupeAgainstBase([base, osm], new Set(['worldportindex']), 50)
  assert.equal(result.length, 2, 'a non-dedupe source survives even when co-located')
})

test('with no base POI present non-base POIs are not merged across the missing base', () => {
  // Both are non-base and far enough apart that the same-source pass does not
  // collapse them: with no base layer there is no cross-source merge.
  const osm1 = poi('node/9', 'openseamap', 'Marina', 10, 20)
  const osm2 = poi('node/8', 'openseamap', 'Marina', 10 + FAR, 20)
  const result = dedupeAgainstBase([osm1, osm2], new Set(['openseamap']), 50)
  assert.equal(result.length, 2, 'with no base layer there is nothing to merge against')
})

test('with no base POI present same-source duplicates still collapse', () => {
  const osm1 = poi('node/9', 'openseamap', 'Marina', 10, 20)
  const osm2 = poi('way/77', 'openseamap', 'Marina', 10 + NEAR, 20)
  const result = dedupeAgainstBase([osm1, osm2], new Set(['openseamap']), 50)
  assert.equal(result.length, 1, 'the same-source pass runs even without a base layer')
  assert.equal(result[0].id, 'node/9', 'the first occurrence in input order wins')
})

test('dedupeAgainstBase defaults to a 150 m merge radius', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  // A ~110 m gap is inside the new 150 m default but outside the old 50 m one;
  // a hit here proves the default bump took effect.
  const osm = poi('node/9', 'openseamap', 'Marina', 10 + 0.001, 20)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']))
  assert.equal(result.length, 1, 'a ~110 m gap is within the default 150 m radius')
})

test('a base POI with no co-located duplicate keeps just its own source', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const osm = poi('node/9', 'openseamap', 'Marina', 10 + FAR, 20)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  const survivor = result.find((p) => p.source === BASE_SOURCE_ID)
  assert.deepEqual(survivor?.sources, ['activecaptain'])
})

test('two same-source same-type POIs within the radius collapse to the first one', () => {
  const node = poi('node/9', 'openseamap', 'Marina', 10, 20)
  const way = poi('way/77', 'openseamap', 'Marina', 10 + NEAR, 20)
  const result = dedupeAgainstBase([node, way], new Set(['openseamap']), 50)
  assert.equal(result.length, 1, 'the second same-source duplicate is dropped')
  assert.equal(result[0].id, 'node/9', 'the first occurrence in input order wins')
})

test('same-source POIs of different types at the same spot are kept separate', () => {
  const harbour = poi('node/9', 'openseamap', 'Marina', 10, 20)
  const lock = poi('way/77', 'openseamap', 'Lock', 10, 20)
  const result = dedupeAgainstBase([harbour, lock], new Set(['openseamap']), 50)
  assert.equal(result.length, 2, 'different types at the same spot are not the same feature')
})

test('same-source POIs farther than the radius both survive', () => {
  const a = poi('node/9', 'openseamap', 'Marina', 10, 20)
  const b = poi('way/77', 'openseamap', 'Marina', 10 + FAR, 20)
  const result = dedupeAgainstBase([a, b], new Set(['openseamap']), 50)
  assert.equal(result.length, 2, 'a wide separation is not a duplicate')
})

test('same-source dedup also runs when a base POI is present alongside non-base duplicates', () => {
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  // Both OpenSeaMap POIs are far from the base, so neither merges into it;
  // they are also same-source duplicates of each other, so the second drops.
  const a = poi('node/9', 'openseamap', 'Marina', 10 + FAR, 20)
  const b = poi('way/77', 'openseamap', 'Marina', 10 + FAR + NEAR, 20)
  const result = dedupeAgainstBase([base, a, b], new Set(['openseamap']), 50)
  const osm = result.filter((p) => p.source === 'openseamap')
  assert.equal(osm.length, 1, 'the two co-located OpenSeaMap POIs collapse to one')
  assert.equal(osm[0].id, 'node/9', 'the first occurrence in input order wins')
})
