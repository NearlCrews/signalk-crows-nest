/**
 * Pure rating filter for point-of-interest summaries.
 *
 * The plugin's `minimumRating` configuration lets the user hide poorly rated
 * points of interest. This module applies that threshold.
 */

import type { PoiSummary, PoiType } from '../../shared/types.js'

/**
 * Point-of-interest types that carry ActiveCaptain user reviews. Only these
 * are subject to the rating filter. Navigation and infrastructure types
 * (Hazard, Bridge, Lock, and so on) are never reviewed, so an absent rating on
 * one of them means "not a ratable thing", not "poor quality": filtering them
 * out would wrongly strip safety-relevant markers, hazards above all, from the
 * chart even with their POI-type toggle on.
 */
const RATABLE_POI_TYPES = new Set<PoiType>(['Marina', 'Anchorage', 'Business'])

/**
 * Drop point-of-interest summaries whose average rating is below
 * `minimumRating`.
 *
 * Behavior:
 *
 * - A `minimumRating` of 0 (or any value at or below 0) is the "show
 *   everything" case: the input array is returned unchanged.
 * - An entry of a non-ratable type (anything outside {@link RATABLE_POI_TYPES})
 *   is always kept: it has no rating to clear the bar with, and hiding it would
 *   remove navigation markers, not declutter low-quality destinations.
 * - A ratable entry whose `rating` is at or above the threshold is kept.
 * - A ratable entry with no `rating` (undefined) has had no reviews, so it has
 *   no average to compare. When `minimumRating` is greater than 0 such an entry
 *   is hidden: the user asked for a minimum quality bar, and an unrated
 *   destination cannot be shown to clear it.
 *
 * The function is pure: it never mutates the input array or its elements.
 *
 * @param pois          The normalized list entries to filter.
 * @param minimumRating The lowest average rating (0 to 5) to keep.
 * @returns A new array of the entries that meet the threshold, or the original
 *          array when `minimumRating` is 0 or below.
 */
export function filterByRating (pois: PoiSummary[], minimumRating: number): PoiSummary[] {
  if (!(minimumRating > 0)) {
    return pois
  }
  return pois.filter(poi => {
    if (!RATABLE_POI_TYPES.has(poi.type)) {
      return true
    }
    return poi.rating !== undefined && poi.rating >= minimumRating
  })
}
