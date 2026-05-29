import test from 'node:test'
import assert from 'node:assert/strict'
import { filterByMinimumYear } from '../src/shared/year-filter.js'
import type { PoiSummary } from '../src/shared/types.js'

function poi (id: string, timestamp?: string): PoiSummary {
  const summary: PoiSummary = {
    id,
    type: 'Hazard',
    position: { latitude: 0, longitude: 0 },
    name: `POI ${id}`,
    source: 'test',
    url: `https://example.test/${id}`,
    attribution: 'test data',
    skIcon: 'notice-to-mariners'
  }
  if (timestamp !== undefined) summary.timestamp = timestamp
  return summary
}

test('a zero minimum-year returns the input unchanged (filter off)', () => {
  const input = [poi('1', '2000-01-01T00:00:00Z'), poi('2', '1950-01-01T00:00:00Z')]
  const result = filterByMinimumYear(input, 0)
  assert.equal(result, input, 'the same array is returned by reference')
  assert.equal(result.length, 2)
})

test('a negative or NaN minimum-year is treated as off', () => {
  const input = [poi('1', '1950-01-01T00:00:00Z')]
  assert.equal(filterByMinimumYear(input, -1).length, 1)
  assert.equal(filterByMinimumYear(input, Number.NaN).length, 1)
})

test('a POI with no timestamp is always included (filter only narrows)', () => {
  const result = filterByMinimumYear(
    [poi('1'), poi('2', '1950-01-01T00:00:00Z')],
    2000
  )
  assert.deepEqual(result.map((p) => p.id), ['1'])
})

test('a malformed timestamp is treated as absent and included', () => {
  const result = filterByMinimumYear([poi('1', 'not a date'), poi('2', '1950-01-01T00:00:00Z')], 2000)
  assert.deepEqual(result.map((p) => p.id), ['1'])
})

test('a POI exactly at the threshold year is kept', () => {
  const result = filterByMinimumYear([
    poi('exact', '2000-01-01T00:00:00Z'),
    poi('first-of-year', '2000-12-31T23:59:59Z')
  ], 2000)
  assert.equal(result.length, 2)
})

test('a POI strictly above the threshold is kept', () => {
  const result = filterByMinimumYear([poi('1', '2010-06-15T12:00:00Z')], 2000)
  assert.equal(result.length, 1)
})

test('a POI strictly below the threshold is dropped', () => {
  const result = filterByMinimumYear([poi('1', '1999-12-31T23:59:59Z')], 2000)
  assert.equal(result.length, 0)
})

test('a mixed list keeps the modern POIs, drops the old ones, and passes the undated', () => {
  const result = filterByMinimumYear([
    poi('modern', '2020-03-15T00:00:00Z'),
    poi('old', '1960-07-04T00:00:00Z'),
    poi('undated'),
    poi('exact-threshold', '2000-01-01T00:00:00Z'),
    poi('also-old', '1989-12-31T00:00:00Z'),
    poi('malformed', 'sometime in the 70s')
  ], 2000)
  assert.deepEqual(
    result.map((p) => p.id).sort(),
    ['exact-threshold', 'malformed', 'modern', 'undated']
  )
})

test('a future-year cutoff drops every dated POI but keeps the undated', () => {
  // A user who picks next year as the cutoff would hide every record that
  // is not yet dated in the future; the filter still passes undated POIs.
  const result = filterByMinimumYear([
    poi('modern', '2024-06-15T00:00:00Z'),
    poi('undated')
  ], 9999)
  assert.deepEqual(result.map((p) => p.id), ['undated'])
})
