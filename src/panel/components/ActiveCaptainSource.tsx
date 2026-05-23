/**
 * The ActiveCaptain data-source card body. Field order follows the same
 * convention every per-source card uses: import layers first, then the
 * refresh-period field, then any per-source filters (here: the minimum
 * rating, which only applies to ActiveCaptain). ActiveCaptain has no
 * update-year filter and no merge option (it is the base every other
 * source merges into), so the rest of the convention is empty for this
 * card.
 */

import type * as React from 'react'
import type { Dispatch } from 'react'
import type { ConfigAction } from '../config-reducer.js'
import { DEFAULT_MINIMUM_RATING } from '../normalize-config.js'
import type { PluginConfig } from '../../shared/types.js'
import ActiveCaptainPoiTypes from './ActiveCaptainPoiTypes.js'
import CacheDurationField from './CacheDurationField.js'
import RatingFilterField from './RatingFilterField.js'

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
      <CacheDurationField
        value={state.cachingDurationMinutes}
        onChange={(minutes) => dispatch({ type: 'setCacheDuration', minutes })}
      />
      <RatingFilterField
        value={state.minimumRating ?? DEFAULT_MINIMUM_RATING}
        onChange={(rating) => dispatch({ type: 'setMinimumRating', rating })}
      />
    </>
  )
}
