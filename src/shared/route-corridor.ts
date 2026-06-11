/**
 * Route-corridor half-width bounds, clamp, and schema fragment for the
 * route-hazard scan. Browser-safe (the only import is the dependency-free
 * numbers module) so the panel's normalize-config and the route-hazard output
 * both import the one set of values rather than each keeping a hand-synced
 * copy, mirroring the proximity-radius.ts shared-bounds pattern.
 */

import { positiveCappedNumber } from './numbers.js'
import { boundedNumberSchema } from './config-schema.js'

/** Default route-corridor half-width, in meters. */
export const DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS = 500

/**
 * Upper bound on the corridor half-width. Generous (a 50 km half-width is far
 * beyond any real corridor), but it caps the route-ahead fetch box a
 * hand-edited config could otherwise blow up to an absurd size.
 */
export const MAX_ROUTE_CORRIDOR_WIDTH_METERS = 50_000

/**
 * Resolve a raw corridor-width config value: a non-positive or non-numeric
 * value falls back to {@link DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS} (matching
 * the other optional numeric config keys), and the result is capped at
 * {@link MAX_ROUTE_CORRIDOR_WIDTH_METERS}. Shared by the route-hazard output
 * and the panel's normalize-config so the two cannot drift.
 */
export function clampRouteCorridorWidth (raw: unknown): number {
  return positiveCappedNumber(raw, MAX_ROUTE_CORRIDOR_WIDTH_METERS, DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS)
}

/** Config-schema fragment for the route-corridor half-width field. */
export function routeCorridorWidthSchema (title: string): Record<string, unknown> {
  return boundedNumberSchema(title, DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS, 1, MAX_ROUTE_CORRIDOR_WIDTH_METERS)
}
