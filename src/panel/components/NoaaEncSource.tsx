/**
 * The NOAA ENC Direct data-source card body. Field order follows the same
 * convention every per-source card uses: layers (the scale-band selector
 * picks WHAT layer set the layer toggles operate on, so it groups with
 * them), then refresh period (per-bbox debounce in seconds), then the
 * minimum-survey-year filter, then the merge option (dedupe toggle).
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import {
  DEFAULT_MINIMUM_YEAR,
  DEFAULT_NOAA_ENC_SCALE_BAND,
  DEFAULT_REFRESH_SECONDS,
  NOAA_ENC_SCALE_BANDS
} from '../normalize-config.js'
import { S } from '../styles.js'
import type { PluginConfig } from '../../shared/types.js'
import MinimumYearField from './MinimumYearField.js'
import RefreshSecondsField from './RefreshSecondsField.js'

/** Stable id linking the band selector's visible label to its `<select>`. */
const BAND_FIELD_ID = 'ac-noaa-enc-scale-band'

/**
 * Human-readable label for each ENC chart scale band. Exported so the
 * collapsed accordion summary in DataSourcesSection reads "Harbor" rather
 * than the raw NOAA wire value "harbour".
 */
export const BAND_LABELS: Readonly<Record<typeof NOAA_ENC_SCALE_BANDS[number], string>> = {
  overview: 'Overview',
  general: 'General',
  coastal: 'Coastal',
  approach: 'Approach',
  harbour: 'Harbor',
  berthing: 'Berthing'
}

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the NOAA ENC Direct source. */
export default function NoaaEncSource ({ state, dispatch }: Props): React.ReactElement {
  // Dedupe defaults on: an absent value is treated as checked.
  const dedupeEnabled = state.noaaEncDedupe !== false
  // Wrecks and obstructions default on; rocks default off.
  const includeWrecks = state.noaaEncIncludeWrecks !== false
  const includeObstructions = state.noaaEncIncludeObstructions !== false
  const includeRocks = state.noaaEncIncludeRocks === true
  const band = state.noaaEncScaleBand ?? DEFAULT_NOAA_ENC_SCALE_BAND
  const minimumSurveyYear = state.noaaEncMinimumSurveyYear ?? DEFAULT_MINIMUM_YEAR

  return (
    <>
      <div style={S.fieldRow}>
        <label htmlFor={BAND_FIELD_ID} style={S.label}>Chart scale band</label>
        <select
          id={BAND_FIELD_ID}
          style={S.input}
          value={band}
          onChange={(e) => dispatch({ type: 'setNoaaEncScaleBand', band: e.target.value })}
        >
          {NOAA_ENC_SCALE_BANDS.map((bandId) => (
            <option key={bandId} value={bandId}>{BAND_LABELS[bandId]}</option>
          ))}
        </select>
        <p style={S.hint}>
          Which ENC chart scale to query. Overview returns large-area features
          only; berthing returns the densest, finest detail. Coastal is the
          recommended default for most underway use.
        </p>
      </div>
      <section style={S.groupsSection}>
        <fieldset style={S.group}>
          <legend style={S.groupTitle}>Hazard layers to import</legend>
          <label style={S.checkboxRow}>
            <input
              type='checkbox'
              style={S.checkbox}
              checked={includeWrecks}
              onChange={(e) => dispatch({ type: 'setNoaaEncIncludeWrecks', enabled: e.target.checked })}
            />
            Wrecks
          </label>
          <label style={S.checkboxRow}>
            <input
              type='checkbox'
              style={S.checkbox}
              checked={includeObstructions}
              onChange={(e) => dispatch({ type: 'setNoaaEncIncludeObstructions', enabled: e.target.checked })}
            />
            Obstructions
          </label>
          <label style={S.checkboxRow}>
            <input
              type='checkbox'
              style={S.checkbox}
              checked={includeRocks}
              onChange={(e) => dispatch({ type: 'setNoaaEncIncludeRocks', enabled: e.target.checked })}
            />
            Underwater rocks
          </label>
          {!includeWrecks && !includeObstructions && !includeRocks && (
            <p style={S.hint}>
              Choose at least one layer; with all three off the source is
              enabled but imports nothing.
            </p>
          )}
          <p style={S.hint}>
            Underwater rocks default off because a coastal-band query can
            return tens of thousands of rocks, which slows the chart plotter
            and obscures other hazards.
          </p>
        </fieldset>
      </section>
      <RefreshSecondsField
        id='ac-noaa-enc-refresh-seconds'
        label='Refresh period (seconds)'
        hint={'How long to reuse the most recent ENC Direct result for the ' +
          'same chart viewport before re-querying. A Freeboard refresh ' +
          'burst on a stationary view stays inside the cache; a user who ' +
          'pans to a fresh view re-queries immediately. NOAA refreshes ENC ' +
          'data weekly, so a sub-minute cadence here mostly protects the ' +
          'ArcGIS service from your own chart plotter. Leave at 0 to query ' +
          'ENC Direct on every list call.'}
        value={state.noaaEncRefreshSeconds ?? DEFAULT_REFRESH_SECONDS}
        onChange={(seconds) => dispatch({ type: 'setNoaaEncRefreshSeconds', seconds })}
      />
      <MinimumYearField
        id='ac-noaa-enc-minimum-survey-year'
        label='Earliest survey year'
        hint={'Hide features whose hydrographic survey was conducted before ' +
          'this year. Leave at 0 to import every survey. SORDAT is the ' +
          'survey date, not the chart refresh date, so a feature surveyed ' +
          'in 1985 carries that year even though NOAA refreshes the chart ' +
          'weekly. Features with no recorded survey date are always included.'}
        value={minimumSurveyYear}
        onChange={(year) => dispatch({ type: 'setNoaaEncMinimumSurveyYear', year })}
      />
      <label style={S.checkboxRow}>
        <input
          type='checkbox'
          style={S.checkbox}
          checked={dedupeEnabled}
          onChange={(e) => dispatch({ type: 'setNoaaEncDedupe', enabled: e.target.checked })}
        />
        Merge NOAA ENC markers that duplicate an ActiveCaptain marker
      </label>
      <p style={S.hint}>
        When enabled, a NOAA ENC point of interest close to an ActiveCaptain
        point of the same type is merged into it, so one physical feature is
        shown once. The surviving marker records every source that reported it.
      </p>
    </>
  )
}
