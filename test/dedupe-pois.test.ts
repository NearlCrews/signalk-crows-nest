import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeAgainstBase } from '../src/inputs/dedupe-pois.js'
import { DEFAULT_DEDUPE_RADIUS_METERS } from '../src/shared/dedupe-radius.js'
import { ACTIVE_CAPTAIN_SOURCE_ID as BASE_SOURCE_ID } from '../src/shared/source-ids.js'
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
    attribution: `Data from ${source}`,
    skIcon: 'notice-to-mariners'
  }
}

/** Build a Bridge POI carrying an optional vertical clearance, in meters. */
function bridge (
  id: string, source: string, latitude: number, longitude: number, clearanceMeters?: number
): PoiSummary {
  const base = poi(id, source, 'Bridge', latitude, longitude)
  return clearanceMeters === undefined
    ? base
    : { ...base, verticalClearanceMeters: clearanceMeters }
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

test('dedupeAgainstBase defaults to a 150-foot merge radius', () => {
  // ~20 m is inside the 150-foot (45.72 m) default; ~110 m is outside it but
  // inside the old 150 m default, so the pair proves the new default applies.
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const near = poi('node/9', 'openseamap', 'Marina', 10 + NEAR, 20)
  const farBase = poi('2', BASE_SOURCE_ID, 'Hazard', 10 + 0.001, 20)
  const far = poi('node/8', 'openseamap', 'Hazard', 10, 20)
  const result = dedupeAgainstBase([base, near, farBase, far], new Set(['openseamap']))
  const survivingIds = result.map(p => p.id)
  assert.ok(!survivingIds.includes('node/9'), 'a ~20 m gap merges under the 150-foot default')
  assert.ok(survivingIds.includes('node/8'), 'a ~110 m gap no longer merges')
  assert.equal(result.length, 3)
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

test('a base POI without clearance takes a merged duplicate\'s clearance', () => {
  const base = bridge('1', BASE_SOURCE_ID, 10, 20)
  const osm = bridge('node/9', 'openseamap', 10 + NEAR, 20, 5)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  assert.equal(result.length, 1, 'the duplicate merges into the base')
  assert.equal(result[0].source, BASE_SOURCE_ID, 'the base POI is the survivor')
  assert.equal(result[0].verticalClearanceMeters, 5, 'and it carries the duplicate\'s clearance')
})

test('when both the base and a duplicate carry clearance the smaller wins', () => {
  const base = bridge('1', BASE_SOURCE_ID, 10, 20, 8)
  const osm = bridge('node/9', 'openseamap', 10 + NEAR, 20, 5)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  assert.equal(result.length, 1)
  assert.equal(result[0].verticalClearanceMeters, 5, 'the conservative clearance survives')
})

test('a base POI keeps its own clearance when a merged duplicate reports a larger one', () => {
  const base = bridge('1', BASE_SOURCE_ID, 10, 20, 5)
  const osm = bridge('node/9', 'openseamap', 10 + NEAR, 20, 8)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  assert.equal(result.length, 1)
  assert.equal(result[0].verticalClearanceMeters, 5, 'a larger duplicate does not clobber the base')
})

test('a base POI with no clearance and a clearance-less duplicate leaves the field absent', () => {
  const base = bridge('1', BASE_SOURCE_ID, 10, 20)
  const osm = bridge('node/9', 'openseamap', 10 + NEAR, 20)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  assert.equal(result.length, 1)
  assert.ok(!('verticalClearanceMeters' in result[0]), 'the field stays absent, not present-undefined')
})

test('a pass-through POI with no base match keeps its own clearance', () => {
  const base = bridge('1', BASE_SOURCE_ID, 10, 20)
  const osm = bridge('node/9', 'openseamap', 10 + FAR, 20, 7)
  const result = dedupeAgainstBase([base, osm], new Set(['openseamap']), 50)
  const survivor = result.find((p) => p.source === 'openseamap')
  assert.equal(survivor?.verticalClearanceMeters, 7, 'an unmerged duplicate keeps its clearance')
})

test('the same-source collapse keeps the smaller clearance', () => {
  const node = bridge('node/9', 'openseamap', 10, 20, 8)
  const way = bridge('way/77', 'openseamap', 10 + NEAR, 20, 5)
  const result = dedupeAgainstBase([node, way], new Set(['openseamap']), 50)
  assert.equal(result.length, 1, 'the second same-source duplicate is dropped')
  assert.equal(result[0].id, 'node/9', 'the first occurrence survives')
  assert.equal(result[0].verticalClearanceMeters, 5, 'but it takes the smaller clearance')
})

test('a per-source radius map applies each source\'s radius independently', () => {
  // Two non-base sources at the same offset from a base POI: USCG with a
  // tight 5 m radius (does not merge), OpenSeaMap with a wide 150 m
  // radius (does merge). The per-source map proves each source's radius
  // is honored independently in one dedupe pass.
  const base = poi('1', BASE_SOURCE_ID, 'Marina', 10, 20)
  const tight = poi('789', 'usclightlist', 'Marina', 10 + NEAR, 20)
  const wide = poi('node/9', 'openseamap', 'Marina', 10 + NEAR, 20)
  const result = dedupeAgainstBase(
    [base, tight, wide],
    new Set(['usclightlist', 'openseamap']),
    new Map([['usclightlist', 5], ['openseamap', 150]])
  )
  const sources = result.map(p => p.source).sort()
  assert.deepEqual(
    sources,
    ['activecaptain', 'usclightlist'],
    'OpenSeaMap merges into the base at 150 m; USCG stays separate at 5 m'
  )
})

test('the default merge radius is 150 feet, expressed in meters', () => {
  assert.equal(DEFAULT_DEDUPE_RADIUS_METERS, 45.72)
})
