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
import { DEFAULT_MINIMUM_YEAR } from '../../shared/year-filter.js'
import { DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS } from '../../shared/bbox-debounce.js'
import { S } from '../styles.js'
import { DEFAULT_SCALE_BAND, SCALE_BAND_LABELS, SCALE_BANDS } from '../../shared/scale-band.js'
import type { PluginConfig } from '../../shared/types.js'
import LabeledField from './LabeledField.js'
import MergeWithActiveCaptain from './MergeWithActiveCaptain.js'
import MinimumYearField from './MinimumYearField.js'
import RefreshSecondsField from './RefreshSecondsField.js'

/** Stable id linking the band selector's visible label to its `<select>`. */
const BAND_FIELD_ID = 'ac-noaa-enc-scale-band'

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
  const band = state.noaaEncScaleBand ?? DEFAULT_SCALE_BAND
  const minimumSurveyYear = state.noaaEncMinimumSurveyYear ?? DEFAULT_MINIMUM_YEAR

  return (
    <>
      <fieldset style={S.group}>
        <legend style={S.groupTitle}>Import layers</legend>
        <LabeledField
          id={BAND_FIELD_ID}
          label='Chart scale band'
          hint={'Which ENC chart scale to query. Overview returns large-area ' +
            'features only; berthing returns the densest, finest detail. ' +
            'Coastal is the recommended default for most underway use.'}
        >
          {(controlProps) => (
            <select
              {...controlProps}
              style={S.input}
              value={band}
              onChange={(e) => dispatch({ type: 'setNoaaEncScaleBand', band: e.target.value })}
            >
              {SCALE_BANDS.map((bandId) => (
                <option key={bandId} value={bandId}>{SCALE_BAND_LABELS[bandId]}</option>
              ))}
            </select>
          )}
        </LabeledField>
        <div style={S.checkboxGrid}>
          <label style={S.checkboxLabel}>
            <input
              type='checkbox'
              style={S.checkbox}
              checked={includeWrecks}
              onChange={(e) => dispatch({ type: 'setNoaaEncIncludeWrecks', enabled: e.target.checked })}
            />
            Wrecks
          </label>
          <label style={S.checkboxLabel}>
            <input
              type='checkbox'
              style={S.checkbox}
              checked={includeObstructions}
              onChange={(e) => dispatch({ type: 'setNoaaEncIncludeObstructions', enabled: e.target.checked })}
            />
            Obstructions
          </label>
          <label style={S.checkboxLabel}>
            <input
              type='checkbox'
              style={S.checkbox}
              checked={includeRocks}
              onChange={(e) => dispatch({ type: 'setNoaaEncIncludeRocks', enabled: e.target.checked })}
            />
            Underwater rocks
          </label>
        </div>
        {!includeWrecks && !includeObstructions && !includeRocks && (
          <p style={S.hint}>
            Choose at least one layer; with all three off the source is
            enabled but imports nothing.
          </p>
        )}
        <p style={S.hintBelow}>
          Underwater rocks default off because a coastal-band query can
          return tens of thousands of rocks, which slows the chart plotter
          and obscures other hazards.
        </p>
      </fieldset>
      <fieldset style={S.group}>
        <legend style={S.groupTitle}>Refresh and freshness</legend>
        <RefreshSecondsField
          id='ac-noaa-enc-refresh-seconds'
          label='Refresh period (seconds)'
          upstreamHint={'NOAA refreshes ENC data weekly, so the 30 minute ' +
            'default only spares the ArcGIS service from re-serving identical ' +
            'wrecks; raise it freely.'}
          value={state.noaaEncRefreshSeconds ?? DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS}
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
      </fieldset>
      <MergeWithActiveCaptain
        sourceName='NOAA ENC'
        enabled={dedupeEnabled}
        onToggleEnabled={(enabled) => dispatch({ type: 'setNoaaEncDedupe', enabled })}
        radiusMeters={state.noaaEncDedupeRadiusMeters}
        onChangeRadius={(meters) => dispatch({ type: 'setNoaaEncDedupeRadius', meters })}
        radiusInputId='ac-noaa-enc-dedupe-radius'
      />
    </>
  )
}
