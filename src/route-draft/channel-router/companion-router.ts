/**
 * Client for the Binnacle Companion in-process routing bridge.
 *
 * When the companion plugin is installed it publishes a bridge on globalThis that routes "on water" in a
 * container, off this event loop. This module reads that bridge, builds the serializable request (camelCase,
 * no closure, no AbortSignal; the sovereign country id in place of the foreignRings closure), bounds both the
 * readiness probe and the route call, and narrows the untyped result. It returns a ChannelRouteResult the
 * caller consumes exactly like the in-process router's, or null to signal "fall back to the in-process router"
 * so the cutover is reversible and a down or wedged container degrades to the built-in path.
 */

import type { Position } from '../../shared/types.js'
import type { ChannelRouteRequest, ChannelRouteResult, ChannelDeclineReason } from './channel-router.js'
import { withDeadline } from '../../shared/with-deadline.js'

/** The global key the companion plugin installs its in-process bridge on. */
export const COMPANION_BRIDGE_KEY = '__signalk_binnacle_routeOnWater'

/** The in-process bridge the companion publishes. routeOnWater is untyped on the wire; we narrow its result. */
export interface RouteOnWaterBridge {
  whenReady: () => Promise<void>
  routeOnWater: (request: unknown) => Promise<unknown>
}

/** The six typed decline reasons crows-nest understands; the bridge may also return the transport-only 'router-unavailable'. */
const CHANNEL_REASONS: ReadonlySet<ChannelDeclineReason> = new Set<ChannelDeclineReason>([
  'no-coverage', 'no-path', 'deadline', 'unsnappable', 'land-leg', 'fetch-failed'
])

function isBridge (v: unknown): v is RouteOnWaterBridge {
  return typeof v === 'object' && v !== null &&
    typeof (v as RouteOnWaterBridge).whenReady === 'function' &&
    typeof (v as RouteOnWaterBridge).routeOnWater === 'function'
}

/** The companion bridge if the plugin has installed it, else undefined. A non-bridge value reads as absent. */
export function getCompanionBridge (): RouteOnWaterBridge | undefined {
  const v = (globalThis as Record<string, unknown>)[COMPANION_BRIDGE_KEY]
  return isBridge(v) ? v : undefined
}

function isPosition (v: unknown): v is Position {
  return typeof v === 'object' && v !== null &&
    typeof (v as Position).latitude === 'number' && typeof (v as Position).longitude === 'number'
}

/**
 * Narrow an untyped bridge result to a ChannelRouteResult, or null when it is not one we can trust:
 * a 'router-unavailable' transport decline, an unknown reason, a malformed ok shape, or a degenerate
 * route of fewer than two waypoints (the in-process router never returns one; it declines no-path).
 * Null tells the caller to fall back rather than surface a fabricated, blank, or unverifiable route.
 */
function narrowResult (raw: unknown): ChannelRouteResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.ok === true) {
    if (!Array.isArray(r.waypoints) || r.waypoints.length < 2 || !r.waypoints.every(isPosition)) return null
    if (typeof r.usedTileWater !== 'boolean') return null
    const borderFallback = typeof r.borderFallback === 'boolean' ? r.borderFallback : false
    return { ok: true, waypoints: r.waypoints as Position[], usedTileWater: r.usedTileWater, borderFallback }
  }
  if (r.ok === false && typeof r.reason === 'string' && CHANNEL_REASONS.has(r.reason as ChannelDeclineReason)) {
    return { ok: false, reason: r.reason as ChannelDeclineReason }
  }
  return null // 'router-unavailable', unknown reason, or malformed: fall back.
}

/** Build the serializable wire request: camelCase, no closure, no AbortSignal; the container honors deadlineMs. */
export function toCompanionRequest (req: ChannelRouteRequest, homeCountryId: string | undefined): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    from: req.from,
    to: req.to,
    draftMeters: req.draftMeters,
    safetyMarginMeters: req.safetyMarginMeters,
    standoffNm: req.standoffNm,
    borderAware: homeCountryId !== undefined
  }
  if (req.corridor !== undefined) wire.corridor = req.corridor
  if (req.bboxAnchors !== undefined) wire.bboxAnchors = req.bboxAnchors
  if (req.maxSnapMeters !== undefined) wire.maxSnapMeters = req.maxSnapMeters
  if (req.deadlineMs !== undefined) wire.deadlineMs = req.deadlineMs
  if (homeCountryId !== undefined) wire.homeCountryId = homeCountryId
  return wire
}

/**
 * Route via the companion bridge, or return null to fall back to the in-process router. Both the readiness
 * probe and the route call are time-bounded (with withDeadline), so a wedged container cannot stall the
 * draft: a not-ready bridge, a transport failure, a timeout, or an untrusted result all return null.
 */
export async function routeViaCompanion (
  bridge: RouteOnWaterBridge,
  req: ChannelRouteRequest,
  homeCountryId: string | undefined,
  readyTimeoutMs: number,
  callTimeoutMs: number
): Promise<ChannelRouteResult | null> {
  const ready = await withDeadline(bridge.whenReady().then(() => true).catch(() => false), readyTimeoutMs, () => false)
  if (!ready) return null
  const raw = await withDeadline(
    bridge.routeOnWater(toCompanionRequest(req, homeCountryId)).catch(() => null),
    callTimeoutMs, () => null
  )
  return narrowResult(raw)
}
