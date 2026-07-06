/**
 * Tests for the USCG LNM input module's refresh-interval resolution.
 *
 * `uscgLnmRefreshSeconds` doubles as the periodic bulk-refresh cadence here, so
 * the shared bbox-debounce `0` off sentinel (which disables a per-viewport
 * cache elsewhere) must fall back to the default cadence rather than a
 * zero-second interval. These tests pin that fallback and the clamp without
 * standing up the scheduler.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshIntervalMs } from '../src/inputs/uscg-lnm/uscg-lnm-input.js'
import {
  DEFAULT_USCG_LNM_DEBOUNCE_SECONDS,
  MAX_BBOX_DEBOUNCE_SECONDS
} from '../src/shared/bbox-debounce-bounds.js'
import { MS_PER_SECOND } from '../src/shared/time.js'

test('a zero refresh value falls back to the default cadence, not a zero interval', () => {
  assert.equal(refreshIntervalMs(0), DEFAULT_USCG_LNM_DEBOUNCE_SECONDS * MS_PER_SECOND)
})

test('a non-numeric or absent value falls back to the default cadence', () => {
  assert.equal(refreshIntervalMs(undefined), DEFAULT_USCG_LNM_DEBOUNCE_SECONDS * MS_PER_SECOND)
  assert.equal(refreshIntervalMs('not a number'), DEFAULT_USCG_LNM_DEBOUNCE_SECONDS * MS_PER_SECOND)
})

test('a positive value in range passes through as milliseconds', () => {
  assert.equal(refreshIntervalMs(60), 60 * MS_PER_SECOND)
})

test('a value above the maximum is clamped to the bound', () => {
  assert.equal(refreshIntervalMs(99_999), MAX_BBOX_DEBOUNCE_SECONDS * MS_PER_SECOND)
})

test('a negative value clamps to the floor and then falls back to the default', () => {
  // The clamp pins a negative to the `0` floor, which the zero-to-default rule
  // then lifts to the default cadence rather than leaving a zero interval.
  assert.equal(refreshIntervalMs(-5), DEFAULT_USCG_LNM_DEBOUNCE_SECONDS * MS_PER_SECOND)
})
