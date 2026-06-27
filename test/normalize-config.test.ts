import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeConfig } from '../src/panel/normalize-config.js'
import { SEAMARK_GROUP_IDS } from '../src/shared/seamark-groups.js'
import { POI_TYPE_FLAGS } from '../src/shared/poi-type-selection.js'
import {
  DEFAULT_CLEARANCE_MARGIN_METERS,
  MAX_CLEARANCE_MARGIN_METERS
} from '../src/shared/bridge-clearance.js'
import {
  DEFAULT_PROXIMITY_ALARM_RADIUS_METERS,
  MAX_PROXIMITY_ALARM_RADIUS_METERS
} from '../src/shared/proximity-radius.js'
import {
  DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS,
  MAX_ROUTE_CORRIDOR_WIDTH_METERS
} from '../src/shared/route-corridor.js'
import { DEFAULT_DEDUPE_RADIUS_METERS, MAX_DEDUPE_RADIUS_METERS } from '../src/shared/dedupe-radius.js'
import {
  DEFAULT_CACHE_DURATION_MINUTES,
  MAX_CACHE_DURATION_MINUTES
} from '../src/shared/cache-duration.js'
import { DEFAULT_MINIMUM_RATING } from '../src/shared/rating.js'
import { DEFAULT_SCALE_BAND } from '../src/shared/scale-band.js'
import { DEFAULT_OVERPASS_ENDPOINT } from '../src/shared/overpass-endpoints.js'
import { DEFAULT_REFRESH_HOURS, MAX_REFRESH_HOURS, MIN_REFRESH_HOURS } from '../src/shared/refresh-hours.js'

test('normalizeConfig fills every POI flag true and the default duration for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  for (const [flag] of POI_TYPE_FLAGS) {
    assert.equal(config[flag], true, `${flag} defaults to true`)
  }
})

test('normalizeConfig keeps a valid cache duration', () => {
  assert.equal(normalizeConfig({ cachingDurationMinutes: 15 }).cachingDurationMinutes, 15)
})

test('normalizeConfig falls back to the default for an unusable cache duration', () => {
  assert.equal(normalizeConfig({ cachingDurationMinutes: 0 }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  assert.equal(normalizeConfig({ cachingDurationMinutes: -5 }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
  assert.equal(normalizeConfig({ cachingDurationMinutes: 'soon' }).cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
})

test('normalizeConfig preserves an explicitly disabled POI flag', () => {
  const config = normalizeConfig({ includeMarinas: false, includeHazards: true })
  assert.equal(config.includeMarinas, false)
  assert.equal(config.includeHazards, true)
  assert.equal(config.includeAnchorages, true, 'an absent flag still defaults to true')
})

test('normalizeConfig treats a non-object configuration as empty', () => {
  for (const input of [null, undefined, 'config', 42]) {
    const config = normalizeConfig(input)
    assert.equal(config.cachingDurationMinutes, DEFAULT_CACHE_DURATION_MINUTES)
    assert.equal(config.includeMarinas, true)
  }
})

test('normalizeConfig defaults the safety options for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.minimumRating, DEFAULT_MINIMUM_RATING)
  assert.equal(config.enableProximityAlarms, false)
  assert.equal(config.proximityAlarmRadiusMeters, DEFAULT_PROXIMITY_ALARM_RADIUS_METERS)
})

test('normalizeConfig keeps valid safety options', () => {
  const config = normalizeConfig({
    minimumRating: 3,
    enableProximityAlarms: true,
    proximityAlarmRadiusMeters: 250
  })
  assert.equal(config.minimumRating, 3)
  assert.equal(config.enableProximityAlarms, true)
  assert.equal(config.proximityAlarmRadiusMeters, 250)
})

test('normalizeConfig clamps an out-of-range minimum rating', () => {
  assert.equal(normalizeConfig({ minimumRating: 9 }).minimumRating, 5)
  assert.equal(normalizeConfig({ minimumRating: -2 }).minimumRating, 0)
})

test('normalizeConfig falls back to the default for an unusable minimum rating', () => {
  assert.equal(normalizeConfig({ minimumRating: 'high' }).minimumRating, DEFAULT_MINIMUM_RATING)
  assert.equal(normalizeConfig({ minimumRating: Number.NaN }).minimumRating, DEFAULT_MINIMUM_RATING)
})

test('normalizeConfig treats a non-true enableProximityAlarms as false', () => {
  assert.equal(normalizeConfig({ enableProximityAlarms: 'yes' }).enableProximityAlarms, false)
  assert.equal(normalizeConfig({ enableProximityAlarms: false }).enableProximityAlarms, false)
})

test('normalizeConfig falls back to the default for an unusable alarm radius', () => {
  assert.equal(
    normalizeConfig({ proximityAlarmRadiusMeters: -10 }).proximityAlarmRadiusMeters,
    DEFAULT_PROXIMITY_ALARM_RADIUS_METERS
  )
  assert.equal(
    normalizeConfig({ proximityAlarmRadiusMeters: 'far' }).proximityAlarmRadiusMeters,
    DEFAULT_PROXIMITY_ALARM_RADIUS_METERS
  )
})

test('normalizeConfig falls back to the default for a zero alarm radius', () => {
  assert.equal(
    normalizeConfig({ proximityAlarmRadiusMeters: 0 }).proximityAlarmRadiusMeters,
    DEFAULT_PROXIMITY_ALARM_RADIUS_METERS
  )
})

test('normalizeConfig defaults the OpenSeaMap options for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.openSeaMapEnabled, false)
  assert.equal(config.openSeaMapEndpoint, DEFAULT_OVERPASS_ENDPOINT)
  assert.deepEqual(config.openSeaMapSeamarkGroups, [...SEAMARK_GROUP_IDS])
  assert.deepEqual(config.openSeaMapFallbackEndpoints, [],
    'fallback endpoints default to an empty list')
})

test('normalizeConfig cleans the OpenSeaMap fallback endpoints (trim, drop blanks, dedupe)', () => {
  const config = normalizeConfig({
    openSeaMapFallbackEndpoints: [' https://a.test/api ', '', 'https://a.test/api', 'https://b.test/api', 42]
  })
  assert.deepEqual(config.openSeaMapFallbackEndpoints, ['https://a.test/api', 'https://b.test/api'])
})

test('normalizeConfig treats a non-array fallback-endpoints value as empty', () => {
  assert.deepEqual(
    normalizeConfig({ openSeaMapFallbackEndpoints: 'https://a.test/api' as unknown as string[] })
      .openSeaMapFallbackEndpoints,
    []
  )
})

test('normalizeConfig preserves an explicitly enabled OpenSeaMap source', () => {
  const config = normalizeConfig({
    openSeaMapEnabled: true,
    openSeaMapEndpoint: 'https://overpass.example/api',
    openSeaMapSeamarkGroups: ['hazards', 'navaids']
  })
  assert.equal(config.openSeaMapEnabled, true)
  assert.equal(config.openSeaMapEndpoint, 'https://overpass.example/api')
  assert.deepEqual(config.openSeaMapSeamarkGroups, ['hazards', 'navaids'])
})

test('normalizeConfig treats a non-true openSeaMapEnabled as false', () => {
  assert.equal(normalizeConfig({ openSeaMapEnabled: 'yes' }).openSeaMapEnabled, false)
  assert.equal(normalizeConfig({ openSeaMapEnabled: false }).openSeaMapEnabled, false)
})

test('normalizeConfig falls back to the default for a blank OpenSeaMap endpoint', () => {
  assert.equal(normalizeConfig({ openSeaMapEndpoint: '   ' }).openSeaMapEndpoint, DEFAULT_OVERPASS_ENDPOINT)
  assert.equal(normalizeConfig({ openSeaMapEndpoint: 42 }).openSeaMapEndpoint, DEFAULT_OVERPASS_ENDPOINT)
})

test('normalizeConfig drops unknown seamark groups and keeps an explicit empty selection', () => {
  assert.deepEqual(
    normalizeConfig({ openSeaMapSeamarkGroups: ['hazards', 'bogus', 7] }).openSeaMapSeamarkGroups,
    ['hazards']
  )
  assert.deepEqual(normalizeConfig({ openSeaMapSeamarkGroups: [] }).openSeaMapSeamarkGroups, [])
})

test('normalizeConfig defaults the route-hazard scan options for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.enableRouteHazardScan, false)
  assert.equal(config.routeCorridorWidthMeters, DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS)
})

test('normalizeConfig keeps valid route-hazard scan options', () => {
  const config = normalizeConfig({
    enableRouteHazardScan: true,
    routeCorridorWidthMeters: 750
  })
  assert.equal(config.enableRouteHazardScan, true)
  assert.equal(config.routeCorridorWidthMeters, 750)
})

test('normalizeConfig treats a non-true enableRouteHazardScan as false', () => {
  assert.equal(normalizeConfig({ enableRouteHazardScan: 'yes' }).enableRouteHazardScan, false)
  assert.equal(normalizeConfig({ enableRouteHazardScan: false }).enableRouteHazardScan, false)
})

test('normalizeConfig falls back to the default for an unusable corridor width', () => {
  for (const input of [0, -10, 'wide', Number.NaN]) {
    assert.equal(
      normalizeConfig({ routeCorridorWidthMeters: input }).routeCorridorWidthMeters,
      DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS
    )
  }
})

test('normalizeConfig defaults the bridge air-draft options for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.enableBridgeAirDraftCheck, false)
  assert.equal(config.vesselAirDraftMeters, 0)
  assert.equal(config.bridgeClearanceMarginMeters, DEFAULT_CLEARANCE_MARGIN_METERS)
})

test('normalizeConfig keeps valid bridge air-draft options', () => {
  const config = normalizeConfig({
    enableBridgeAirDraftCheck: true,
    vesselAirDraftMeters: 4.5,
    bridgeClearanceMarginMeters: 2
  })
  assert.equal(config.enableBridgeAirDraftCheck, true)
  assert.equal(config.vesselAirDraftMeters, 4.5)
  assert.equal(config.bridgeClearanceMarginMeters, 2)
})

test('normalizeConfig treats a non-true enableBridgeAirDraftCheck as false', () => {
  assert.equal(normalizeConfig({ enableBridgeAirDraftCheck: 'yes' }).enableBridgeAirDraftCheck, false)
  assert.equal(normalizeConfig({ enableBridgeAirDraftCheck: false }).enableBridgeAirDraftCheck, false)
})

test('normalizeConfig clamps an out-of-range bridge clearance margin', () => {
  assert.equal(normalizeConfig({ bridgeClearanceMarginMeters: 99 }).bridgeClearanceMarginMeters,
    MAX_CLEARANCE_MARGIN_METERS)
  assert.equal(normalizeConfig({ bridgeClearanceMarginMeters: -3 }).bridgeClearanceMarginMeters, 0)
})

test('normalizeConfig falls back a non-numeric bridge clearance margin to the default', () => {
  assert.equal(normalizeConfig({ bridgeClearanceMarginMeters: 'lots' }).bridgeClearanceMarginMeters,
    DEFAULT_CLEARANCE_MARGIN_METERS)
})

test('normalizeConfig coerces the vessel air draft to a finite, non-negative number', () => {
  assert.equal(normalizeConfig({ vesselAirDraftMeters: 6.2 }).vesselAirDraftMeters, 6.2)
  // Zero is valid and means rely on design.airHeight alone.
  assert.equal(normalizeConfig({ vesselAirDraftMeters: 0 }).vesselAirDraftMeters, 0)
  for (const input of [-1, 'tall', Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.equal(normalizeConfig({ vesselAirDraftMeters: input }).vesselAirDraftMeters, 0)
  }
})

test('normalizeConfig defaults openSeaMapDedupe to true when the key is absent', () => {
  assert.equal(normalizeConfig({}).openSeaMapDedupe, true)
})

test('normalizeConfig honors an explicit openSeaMapDedupe false', () => {
  assert.equal(normalizeConfig({ openSeaMapDedupe: false }).openSeaMapDedupe, false)
})

test('normalizeConfig treats a non-false openSeaMapDedupe value as true', () => {
  // Only an explicit false turns dedupe off; anything else (including unusable
  // values) keeps the default-on behavior so old configs migrate cleanly.
  assert.equal(normalizeConfig({ openSeaMapDedupe: true }).openSeaMapDedupe, true)
  assert.equal(normalizeConfig({ openSeaMapDedupe: 'no' }).openSeaMapDedupe, true)
  assert.equal(normalizeConfig({ openSeaMapDedupe: 0 }).openSeaMapDedupe, true)
})

test('normalizeConfig defaults the dedupe merge radius for an empty config', () => {
  assert.equal(
    normalizeConfig({}).openSeaMapDedupeRadiusMeters,
    DEFAULT_DEDUPE_RADIUS_METERS
  )
})

test('normalizeConfig keeps a valid dedupe merge radius', () => {
  assert.equal(
    normalizeConfig({ openSeaMapDedupeRadiusMeters: 75 }).openSeaMapDedupeRadiusMeters,
    75
  )
})

test('normalizeConfig falls back to the default for an unusable dedupe merge radius', () => {
  for (const input of [0, -5, 'near', Number.NaN]) {
    assert.equal(
      normalizeConfig({ openSeaMapDedupeRadiusMeters: input }).openSeaMapDedupeRadiusMeters,
      DEFAULT_DEDUPE_RADIUS_METERS
    )
  }
})

test('normalizeConfig defaults the USCG Light List options for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.uscgLightListEnabled, false)
  assert.equal(config.uscgLightListDedupe, true)
  assert.equal(config.uscgLightListRefreshHours, DEFAULT_REFRESH_HOURS)
})

test('normalizeConfig keeps a valid USCG Light List refresh period', () => {
  assert.equal(normalizeConfig({ uscgLightListRefreshHours: 24 }).uscgLightListRefreshHours, 24)
})

test('normalizeConfig clamps an out-of-range USCG Light List refresh period', () => {
  // The panel applies the same shared clamp the input module does, so the
  // displayed value matches what the runtime scheduler will actually use.
  assert.equal(normalizeConfig({ uscgLightListRefreshHours: 0 }).uscgLightListRefreshHours, MIN_REFRESH_HOURS)
  assert.equal(normalizeConfig({ uscgLightListRefreshHours: -1 }).uscgLightListRefreshHours, MIN_REFRESH_HOURS)
  assert.equal(normalizeConfig({ uscgLightListRefreshHours: 200 }).uscgLightListRefreshHours, MAX_REFRESH_HOURS)
  for (const input of ['soon', Number.NaN]) {
    assert.equal(
      normalizeConfig({ uscgLightListRefreshHours: input }).uscgLightListRefreshHours,
      DEFAULT_REFRESH_HOURS
    )
  }
})

test('normalizeConfig honors an explicit uscgLightListDedupe false', () => {
  assert.equal(normalizeConfig({ uscgLightListDedupe: false }).uscgLightListDedupe, false)
})

test('normalizeConfig defaults the NOAA ENC options for an empty config', () => {
  const config = normalizeConfig({})
  assert.equal(config.noaaEncEnabled, false)
  assert.equal(config.noaaEncDedupe, true)
  assert.equal(config.noaaEncScaleBand, DEFAULT_SCALE_BAND)
  assert.equal(config.noaaEncIncludeWrecks, true)
  assert.equal(config.noaaEncIncludeObstructions, true)
  // Rocks default off so a coastal-band query does not flood the chartplotter.
  assert.equal(config.noaaEncIncludeRocks, false)
})

test('normalizeConfig keeps a known NOAA ENC scale band', () => {
  assert.equal(normalizeConfig({ noaaEncScaleBand: 'harbour' }).noaaEncScaleBand, 'harbour')
})

test('normalizeConfig falls back to the default for an unknown NOAA ENC scale band', () => {
  for (const input of ['unknown', '', 42, null]) {
    assert.equal(
      normalizeConfig({ noaaEncScaleBand: input }).noaaEncScaleBand,
      DEFAULT_SCALE_BAND
    )
  }
})

test('normalizeConfig honors explicit NOAA ENC layer toggles', () => {
  const config = normalizeConfig({
    noaaEncIncludeWrecks: false,
    noaaEncIncludeObstructions: false,
    noaaEncIncludeRocks: true
  })
  assert.equal(config.noaaEncIncludeWrecks, false)
  assert.equal(config.noaaEncIncludeObstructions, false)
  assert.equal(config.noaaEncIncludeRocks, true)
})

test('normalizeConfig defaults every minimum-year filter to 0 (off)', () => {
  const config = normalizeConfig({})
  assert.equal(config.openSeaMapMinimumYear, 0)
  assert.equal(config.uscgLightListMinimumUpdateYear, 0)
  assert.equal(config.noaaEncMinimumSurveyYear, 0)
})

test('normalizeConfig accepts a positive integer minimum year and truncates fractions', () => {
  const config = normalizeConfig({
    openSeaMapMinimumYear: 2010,
    uscgLightListMinimumUpdateYear: 2020.7,
    noaaEncMinimumSurveyYear: 1990
  })
  assert.equal(config.openSeaMapMinimumYear, 2010)
  assert.equal(config.uscgLightListMinimumUpdateYear, 2020, 'fractional values are truncated')
  assert.equal(config.noaaEncMinimumSurveyYear, 1990)
})

test('normalizeConfig clamps an out-of-range minimum year', () => {
  const negative = normalizeConfig({ noaaEncMinimumSurveyYear: -500 })
  assert.equal(negative.noaaEncMinimumSurveyYear, 0)
  const farFuture = normalizeConfig({ noaaEncMinimumSurveyYear: 99999 })
  assert.equal(farFuture.noaaEncMinimumSurveyYear, 9999)
})

test('normalizeConfig falls back to 0 for non-numeric or non-finite minimum-year', () => {
  const config = normalizeConfig({
    openSeaMapMinimumYear: 'not a year',
    uscgLightListMinimumUpdateYear: Number.POSITIVE_INFINITY,
    noaaEncMinimumSurveyYear: Number.NaN
  })
  assert.equal(config.openSeaMapMinimumYear, 0)
  assert.equal(config.uscgLightListMinimumUpdateYear, 0)
  assert.equal(config.noaaEncMinimumSurveyYear, 0)
})

test('normalizeConfig caps an absurd hand-edited numeric at its shared upper bound', () => {
  // The radius, width, dedupe, and cache-duration keys all gained generous
  // upper bounds so a hand-edited config cannot blow up a scan box or pin a
  // cache forever; the panel applies the same shared clamps the modules use.
  const config = normalizeConfig({
    proximityAlarmRadiusMeters: 9e9,
    routeCorridorWidthMeters: 9e9,
    openSeaMapDedupeRadiusMeters: 9e9,
    cachingDurationMinutes: 9e9
  })
  assert.equal(config.proximityAlarmRadiusMeters, MAX_PROXIMITY_ALARM_RADIUS_METERS)
  assert.equal(config.routeCorridorWidthMeters, MAX_ROUTE_CORRIDOR_WIDTH_METERS)
  assert.equal(config.openSeaMapDedupeRadiusMeters, MAX_DEDUPE_RADIUS_METERS)
  assert.equal(config.cachingDurationMinutes, MAX_CACHE_DURATION_MINUTES)
})
