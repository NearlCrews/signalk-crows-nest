/**
 * Default route-corridor half-width, in meters, for the route-hazard scan.
 * Browser-safe (dependency-free) so the panel's normalize-config and the
 * route-hazard output both import the one value rather than each keeping a
 * hand-synced copy, mirroring the proximity-radius.ts shared-default pattern.
 */
export const DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS = 500
