/**
 * The ActiveCaptain data-source card body. Every clustered option group is
 * wrapped in its own bordered fieldset: import layers (POI types), refresh
 * and freshness (per-bbox debounce plus the detail cache duration), and
 * the rating filter (which conceptually stands alone but is wrapped for
 * visual consistency with the other cards). ActiveCaptain has no
 * update-year filter and no merge option (it is the base every other
 * source merges into), so those cells are absent.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_MINIMUM_RATING } from '../../shared/rating.js'
import { DEFAULT_ACTIVE_CAPTAIN_DEBOUNCE_SECONDS } from '../../shared/bbox-debounce-bounds.js'
import type { PluginConfig } from '../../shared/types.js'
import ActiveCaptainPoiTypes from './ActiveCaptainPoiTypes.js'
import CacheDurationField from './CacheDurationField.js'
import Disclosure from './Disclosure.js'
import Fieldset from './Fieldset.js'
import RatingFilterField from './RatingFilterField.js'
import RefreshSecondsField from './RefreshSecondsField.js'

interface Props {
  state: PluginConfig
  dispatch: Dispatch<ConfigAction>
}

/** The configuration fields for the ActiveCaptain source. */
export default function ActiveCaptainSource ({ state, dispatch }: Props): React.ReactElement {
  return (
    <>
      <ActiveCaptainPoiTypes
        config={state}
        onToggle={(flag, enabled) => dispatch({ type: 'setPoiType', flag, enabled })}
        onSetAll={(enabled) => dispatch({ type: 'setAllPoiTypes', enabled })}
      />
      <Disclosure>
        <Fieldset title='Refresh and freshness'>
          <RefreshSecondsField
            id='ac-activecaptain-refresh-seconds'
            label='Refresh period (seconds)'
            upstreamHint={'ActiveCaptain is the most dynamic source (reviews and ' +
              'hazard reports arrive continuously), so its default stays short.'}
            value={state.activeCaptainRefreshSeconds ?? DEFAULT_ACTIVE_CAPTAIN_DEBOUNCE_SECONDS}
            onChange={(seconds) => dispatch({ type: 'setActiveCaptainRefreshSeconds', seconds })}
          />
          <CacheDurationField
            value={state.cachingDurationMinutes}
            onChange={(minutes) => dispatch({ type: 'setCacheDuration', minutes })}
          />
        </Fieldset>
        <Fieldset title='Filters'>
          <RatingFilterField
            value={state.minimumRating ?? DEFAULT_MINIMUM_RATING}
            onChange={(rating) => dispatch({ type: 'setMinimumRating', rating })}
          />
        </Fieldset>
      </Disclosure>
    </>
  )
}
