import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchLengthUnitSystem,
  lengthDisplayFromMeters,
  lengthMetersFromDisplay,
  lengthUnitLabel,
  resolveUnitSystem
} from '../src/panel/unit-system.js'

// -- resolveUnitSystem ------------------------------------------------------

test('a preset whose length category targets feet resolves to imperial', () => {
  assert.equal(
    resolveUnitSystem({ categories: { length: { targetUnit: 'foot' } } }),
    'imperial'
  )
})

test('a preset whose length category targets meters resolves to metric', () => {
  assert.equal(
    resolveUnitSystem({ categories: { length: { targetUnit: 'm' } } }),
    'metric'
  )
})

test('a malformed or missing preset resolves to metric', () => {
  assert.equal(resolveUnitSystem(undefined), 'metric')
  assert.equal(resolveUnitSystem(null), 'metric')
  assert.equal(resolveUnitSystem({}), 'metric')
  assert.equal(resolveUnitSystem({ categories: {} }), 'metric')
  assert.equal(resolveUnitSystem({ categories: { length: {} } }), 'metric')
  assert.equal(resolveUnitSystem('imperial'), 'metric')
  assert.equal(resolveUnitSystem(42), 'metric')
})

test('an unsupported length unit resolves to metric, the only other display system', () => {
  assert.equal(
    resolveUnitSystem({ categories: { length: { targetUnit: 'fathom' } } }),
    'metric'
  )
})

// -- conversions ------------------------------------------------------------

test('metric display conversion is the identity in both directions', () => {
  assert.equal(lengthDisplayFromMeters(100, 'metric'), 100)
  assert.equal(lengthDisplayFromMeters(45.72, 'metric'), 45.72)
  assert.equal(lengthMetersFromDisplay(100, 'metric'), 100)
  assert.equal(lengthMetersFromDisplay(0.5, 'metric'), 0.5)
})

test('imperial display converts meters to feet, rounded to two decimals', () => {
  assert.equal(lengthDisplayFromMeters(45.72, 'imperial'), 150)
  assert.equal(lengthDisplayFromMeters(100, 'imperial'), 328.08)
  assert.equal(lengthDisplayFromMeters(1, 'imperial'), 3.28)
  assert.equal(lengthDisplayFromMeters(0, 'imperial'), 0)
})

test('imperial input converts feet to meters, rounded to four decimals', () => {
  assert.equal(lengthMetersFromDisplay(150, 'imperial'), 45.72)
  assert.equal(lengthMetersFromDisplay(0.5, 'imperial'), 0.1524)
  assert.equal(lengthMetersFromDisplay(328.08, 'imperial'), 99.9988)
  assert.equal(lengthMetersFromDisplay(0, 'imperial'), 0)
})

test('typed imperial values round-trip stably through the stored meters', () => {
  // Stability is what keeps the NumberField draft alive while typing: the
  // committed display value must come back identical from the meters it
  // produced, for any value a user would plausibly type (two decimals max).
  for (const typed of [1, 3.28, 10, 150, 150.5, 328.08, 1000]) {
    const meters = lengthMetersFromDisplay(typed, 'imperial')
    assert.equal(lengthDisplayFromMeters(meters, 'imperial'), typed)
  }
})

test('the unit label names the display unit', () => {
  assert.equal(lengthUnitLabel('metric'), 'meters')
  assert.equal(lengthUnitLabel('imperial'), 'feet')
})

// -- fetchLengthUnitSystem --------------------------------------------------

type StubRoute = { ok: boolean, body?: unknown, throws?: boolean }

function stubFetch (routes: Record<string, StubRoute>): {
  fetchFn: (url: string, init?: { credentials?: string }) => Promise<{ ok: boolean, json: () => Promise<unknown> }>
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    fetchFn: async (url: string) => {
      calls.push(url)
      const route = routes[url]
      if (route === undefined || route.throws === true) {
        throw new Error(`stub: no route for ${url}`)
      }
      return { ok: route.ok, json: async () => route.body }
    }
  }
}

const USER_PREF_URL = '/signalk/v1/applicationData/user/unitpreferences/1.0.0'
const ACTIVE_URL = '/signalk/v1/unitpreferences/active'
const FOOT_PRESET = { categories: { length: { targetUnit: 'foot' } } }
const METER_PRESET = { categories: { length: { targetUnit: 'm' } } }

test('a per-user preset wins: its preset definition decides the system', async () => {
  const { fetchFn, calls } = stubFetch({
    [USER_PREF_URL]: { ok: true, body: { activePreset: 'imperial-us' } },
    '/signalk/v1/unitpreferences/presets/imperial-us': { ok: true, body: FOOT_PRESET }
  })
  assert.equal(await fetchLengthUnitSystem(fetchFn), 'imperial')
  assert.deepEqual(calls, [
    USER_PREF_URL,
    '/signalk/v1/unitpreferences/presets/imperial-us'
  ])
})

test('an empty per-user document falls back to the server-wide active preset', async () => {
  const { fetchFn, calls } = stubFetch({
    [USER_PREF_URL]: { ok: true, body: {} },
    [ACTIVE_URL]: { ok: true, body: METER_PRESET }
  })
  assert.equal(await fetchLengthUnitSystem(fetchFn), 'metric')
  assert.deepEqual(calls, [USER_PREF_URL, ACTIVE_URL])
})

test('a failed per-user read falls back to the server-wide active preset', async () => {
  const { fetchFn } = stubFetch({
    [USER_PREF_URL]: { ok: false },
    [ACTIVE_URL]: { ok: true, body: FOOT_PRESET }
  })
  assert.equal(await fetchLengthUnitSystem(fetchFn), 'imperial')
})

test('a per-user preset whose definition cannot be fetched falls back to active', async () => {
  const { fetchFn } = stubFetch({
    [USER_PREF_URL]: { ok: true, body: { activePreset: 'custom-gone' } },
    '/signalk/v1/unitpreferences/presets/custom-gone': { ok: false },
    [ACTIVE_URL]: { ok: true, body: FOOT_PRESET }
  })
  assert.equal(await fetchLengthUnitSystem(fetchFn), 'imperial')
})

test('the preset name is URL-encoded into the presets path', async () => {
  const { fetchFn, calls } = stubFetch({
    [USER_PREF_URL]: { ok: true, body: { activePreset: 'my preset/2' } },
    '/signalk/v1/unitpreferences/presets/my%20preset%2F2': { ok: true, body: FOOT_PRESET }
  })
  assert.equal(await fetchLengthUnitSystem(fetchFn), 'imperial')
  assert.equal(calls[1], '/signalk/v1/unitpreferences/presets/my%20preset%2F2')
})

test('every endpoint failing resolves to metric, the pre-unitpreferences default', async () => {
  const { fetchFn } = stubFetch({})
  assert.equal(await fetchLengthUnitSystem(fetchFn), 'metric')
})
