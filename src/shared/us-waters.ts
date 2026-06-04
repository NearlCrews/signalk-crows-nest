/**
 * Coarse US-waters bounding boxes used by US-only POI input modules to skip
 * outbound HTTP when the vessel is clearly elsewhere. Several disjoint
 * rectangles, not a single envelope, so the Mediterranean and other
 * non-US-waters do not falsely match. Deliberately generous: a false negative
 * would silently hide data, a false positive only sends one network request
 * that returns an empty FeatureCollection.
 */

import type { Position } from './types.js'
import type { PluginStatus } from '../status/plugin-status.js'

interface UsWatersEnvelope {
  readonly minLat: number
  readonly maxLat: number
  readonly minLon: number
  readonly maxLon: number
}

/** The set of disjoint envelopes that together cover US waters. */
const US_WATERS_BBOXES: readonly UsWatersEnvelope[] = [
  // CONUS coastal and inland waters, including the Great Lakes.
  { minLat: 24.0, maxLat: 49.5, minLon: -125.5, maxLon: -66.0 },
  // Alaska (the main landmass and the Aleutian arc up to the dateline).
  { minLat: 51.0, maxLat: 72.0, minLon: -180.0, maxLon: -129.0 },
  // Alaska, the western Aleutian tail across the 180 degree meridian.
  { minLat: 51.0, maxLat: 56.0, minLon: 172.0, maxLon: 180.0 },
  // Hawaii.
  { minLat: 18.5, maxLat: 23.0, minLon: -161.0, maxLon: -154.5 },
  // Puerto Rico and the US Virgin Islands.
  { minLat: 17.5, maxLat: 18.7, minLon: -67.5, maxLon: -64.5 },
  // Guam and the Northern Mariana Islands.
  { minLat: 13.0, maxLat: 21.0, minLon: 144.5, maxLon: 146.5 }
]

/** True when a position is inside one of the US-waters envelopes. */
export function isInUsWaters (position: Position): boolean {
  const { latitude, longitude } = position
  for (const envelope of US_WATERS_BBOXES) {
    if (
      latitude >= envelope.minLat &&
      latitude <= envelope.maxLat &&
      longitude >= envelope.minLon &&
      longitude <= envelope.maxLon
    ) {
      return true
    }
  }
  return false
}

/**
 * The outbound-HTTP gate the US-only inputs share. Returns true (and records a
 * skip on `status`) when there is a fix and it lies outside US waters, so the
 * caller can bail out of its upstream request. A position that is unknown, or
 * inside US waters, returns false and the caller proceeds. The two US-only
 * sources call this so the "gate on the latest fix, record the skip" rule lives
 * in one place rather than in each source body.
 */
export function shouldSkipOutsideUsWaters (
  getCurrentPosition: () => Position | undefined,
  status: PluginStatus,
  sourceId: string
): boolean {
  const position = getCurrentPosition()
  if (position !== undefined && !isInUsWaters(position)) {
    status.recordSkipped(sourceId, 'outside US waters')
    return true
  }
  return false
}
