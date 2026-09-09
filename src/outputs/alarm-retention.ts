/**
 * Alarm retention across an incomplete point-of-interest list.
 *
 * The alarm outputs decide what should be alarming from the tick's combined
 * list, and clear anything the list no longer carries. That is only sound when
 * the list is complete, and the aggregate legitimately resolves with a partial
 * one: a source is raced against a per-source timeout, a source can reject
 * while another answers, and an ArcGIS source serves the layers that answered
 * when one layer's query fails. A hazard missing for any of those reasons is
 * not a hazard the vessel has cleared, so treating this tick's list as ground
 * truth clears a standing alarm and re-raises it, with sound, the moment the
 * source answers again. Nothing moved; the operator learns to ignore the alarm.
 *
 * The fix is to hold the point of interest at the last position a list
 * actually reported it at. An alarm is about a place, not about a list entry,
 * so the exit test is unchanged: the caller's own geometry runs over a list
 * completed with what the plugin already knows, and clears the alarm when the
 * vessel is genuinely clear of the point. Holding is bounded, because a point
 * that has been retracted upstream would otherwise pin its alarm for as long
 * as the vessel stayed near it: past {@link ALARM_RECONFIRM_WINDOW_MS} with no
 * source reporting it, the point drops out of the completed list and the
 * caller clears it, with a message that says it went unreported rather than
 * that the vessel passed it.
 *
 * That window runs on when a list request last landed, not on when a list was
 * last handed to an output. The position monitor re-evaluates the alarms
 * against the last result between requests, so a clock driven by evaluations
 * would be restarted by every replay and an outage that stopped every request
 * would hold an alarm forever. The monitor therefore passes the time its
 * request landed down to every `evaluate`, and the outputs pass it through to
 * here. One bounded answer covers both ways a point can stop being reported: a
 * source that answers without it, and a source that stops answering at all.
 */

import type { NotificationTracker } from '../shared/notification-tracker.js'
import { MS_PER_MINUTE } from '../shared/time.js'
import type { PoiSummary } from '../shared/types.js'

/**
 * How long, in minutes, an alarm is held while no source reports its point of
 * interest. It has to outlast the stalls the plugin creates for itself, so
 * ordinary flakiness never reaches it: the per-source list timeout is five
 * seconds, a failed bbox tile is not retried for a minute, and a source's
 * refresh window is minutes. Half an hour of silence is several missed refresh
 * cycles across every enabled source, which is upstream retraction or a long
 * outage rather than a transient, and short enough that a point removed from
 * the data does not hold its alarm for a whole watch.
 */
const ALARM_RECONFIRM_WINDOW_MINUTES = 30

/** How long, in milliseconds, an alarm is held while no source reports its point. */
export const ALARM_RECONFIRM_WINDOW_MS = ALARM_RECONFIRM_WINDOW_MINUTES * MS_PER_MINUTE

/**
 * The bookkeeping every retained alarm entry carries, on top of whatever its
 * own output tracks. An output's tracker entry extends this.
 */
export interface RetainedPoi {
  /**
   * The point of interest as a list last reported it, held so the output's own
   * geometry runs against where the point is rather than against whether this
   * tick's list mentioned it. Absent only on an entry raised with no list
   * result behind it, which is then simply not held. The two proximity outputs
   * narrow it to required, since they raise straight off a list entry.
   */
  summary?: PoiSummary
  /** When a list last reported it, on the output's clock. */
  lastListedAt: number
  /**
   * Set once the entry has been held past the reconfirmation window. The
   * output's clear-value builder reads it, so the operator is told the alarm
   * was dropped because nothing reported the point any more, not because the
   * vessel moved clear of it.
   */
  unconfirmed?: boolean
}

/**
 * Explain an alarm cleared because its point of interest went unreported.
 * `stillWithin` names where the vessel still is relative to the point, since a
 * clear that does not mean "you are past it" has to say what it does mean.
 */
export function unconfirmedClearReason (stillWithin: string): string {
  return `unreported for ${ALARM_RECONFIRM_WINDOW_MINUTES} minutes and still ${stillWithin}`
}

/**
 * Complete a tick's list with the last reported summary of every point of
 * interest still alarming that the list omitted.
 *
 * A point the list carries has its held summary refreshed, and its
 * reconfirmation clock set to when this result's request landed. A point the
 * list omits is appended at the position it was last reported at, so the
 * caller's own entry and exit geometry decides its fate from where the point
 * is rather than from whether this particular list mentioned it. A point held
 * past {@link ALARM_RECONFIRM_WINDOW_MS} is left out and marked
 * {@link RetainedPoi.unconfirmed}, which lets the caller's ordinary exit path
 * clear it with the right message.
 *
 * The returned array is the caller's own when nothing had to be added, so the
 * common path of a complete list allocates nothing.
 *
 * @param tracker       The output's alarm tracker, whose entries extend {@link RetainedPoi}.
 * @param pois          The tick's combined list result.
 * @param listFetchedAt When the request behind `pois` landed. A replay of an
 *                      earlier result reports that result's time, so replaying
 *                      it cannot restart the reconfirmation window.
 * @returns The list to run the output's entry and exit geometry over.
 */
export function completeWithRetained<T extends RetainedPoi> (
  tracker: NotificationTracker<T>,
  pois: PoiSummary[],
  listFetchedAt: number
): PoiSummary[] {
  // Nothing alarming, so nothing to hold and nothing to look up. This is the
  // path every evaluation takes while the water is clear, and it runs on every
  // position fix, so it short-circuits before the tracker snapshots anything.
  if (tracker.size === 0) {
    return pois
  }
  const active = tracker.entries()
  // Index only the alarming ids, not the whole list: a full-list Map costs a
  // hash entry per point to answer two or three lookups, on a list that runs
  // to thousands of points in busy water.
  const alarming = new Set<string>()
  for (const { poiId } of active) {
    alarming.add(poiId)
  }
  const listed = new Map<string, PoiSummary>()
  for (const poi of pois) {
    if (alarming.has(poi.id)) {
      listed.set(poi.id, poi)
    }
  }
  let completed: PoiSummary[] | undefined
  for (const { poiId, entry } of active) {
    const reported = listed.get(poiId)
    if (reported !== undefined) {
      // `set` preserves the episode's `raisedAt`, so refreshing the held
      // summary does not restart the alarm's clock.
      tracker.set(poiId, { ...entry, summary: reported, lastListedAt: listFetchedAt })
      continue
    }
    if (entry.summary === undefined) {
      // Nothing held to put back, so this entry falls through to whatever the
      // output's own exit path decides, exactly as it did before retention.
      continue
    }
    if (listFetchedAt - entry.lastListedAt > ALARM_RECONFIRM_WINDOW_MS) {
      if (entry.unconfirmed !== true) {
        tracker.set(poiId, { ...entry, unconfirmed: true })
      }
      continue
    }
    completed ??= [...pois]
    completed.push(entry.summary)
  }
  return completed ?? pois
}
