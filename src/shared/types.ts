/**
 * Shared type contracts for the signalk-crows-nest plugin.
 *
 * This module is the single source of truth for the source-agnostic data
 * shapes that flow between the plugin's input, output, and shared modules
 * under `src/`. Wire types private to one input live next to that input: see
 * `src/inputs/active-captain/active-captain-types.ts` for the ActiveCaptain
 * summary-API shapes.
 */

import type { NormalizedSection } from './normalized-detail.js'

/** A geographic point. Matches both SignalK and ActiveCaptain conventions. */
export interface Position {
  latitude: number
  longitude: number
}

/** A geographic bounding box, in degrees. */
export interface Bbox {
  north: number
  south: number
  east: number
  west: number
}

/**
 * The vessel's active route resolved into a forward-looking polyline, ready for
 * a route-corridor hazard scan. Produced by `course-reader.ts`'s
 * `getRouteAhead()`.
 *
 * The path ahead of the vessel is `[vesselPosition, ...waypoints]`, with
 * `vesselPosition` dropped when there is no fix. `vesselPosition` is kept
 * separate from `waypoints` so a consumer can choose whether the first corridor
 * segment starts at the vessel or at the next route waypoint.
 */
export interface RoutePolyline {
  /** Resource id of the active route, the final path segment of its href. */
  routeId: string
  /** Route name reported by the Course API, when one is set. */
  name?: string
  /** Vessel position when the route was read, or null when there is no fix. */
  vesselPosition: Position | null
  /**
   * Route waypoints ahead of the vessel, ordered from the next waypoint to the
   * route end, already adjusted for route direction: a route followed in
   * reverse is returned in travel order. Never empty.
   */
  waypoints: Position[]
}

/**
 * A snapshot of the vessel's own navigation data, used to scope a route scan.
 * Produced by `course-reader.ts`'s `getVesselState()`.
 */
export interface VesselState {
  /** Current position, or null when there is no fix. */
  position: Position | null
  /** Speed over ground in meters per second, or null when unavailable. */
  speedOverGround: number | null
}

/** A point of interest flagged by the route-corridor scan as lying on or near the route. */
export interface CorridorPoi {
  /**
   * Source-namespaced point-of-interest id (e.g. `activecaptain-12345` or
   * `openseamap-node_987654`), the same id the aggregate POI source exposes.
   */
  id: string
  /** The point-of-interest type. Hazards, bridges, and locks are the route-scan-relevant types. */
  type: PoiType
  /** The point-of-interest name. */
  name: string
  /** The point-of-interest location. */
  position: Position
  /** Distance, in meters, the vessel must travel along the route to draw level with this point. */
  alongTrackDistanceMeters: number
  /** Signed perpendicular distance, in meters, from the point to the route: + right of travel, - left. */
  crossTrackDistanceMeters: number
  /** Estimated time, in seconds, until the vessel draws level with the point; absent when no usable speed is known. */
  etaSeconds?: number
}

/** Minimal logging surface used by the plugin modules (a subset of the SignalK app). */
export interface Logger {
  debug: (message: string) => void
  error: (message: string) => void
}

/**
 * The plugin-wide categories of point of interest. The string values originate
 * from ActiveCaptain's API (the exact strings it expects and returns), but the
 * union is the cross-source type every input maps onto: OpenSeaMap, the USCG
 * Light List, and NOAA ENC all resolve their features to one of these members.
 */
export type PoiType =
  | 'Marina'
  | 'Anchorage'
  | 'Hazard'
  | 'Business'
  | 'BoatRamp'
  | 'Bridge'
  | 'Dam'
  | 'Ferry'
  | 'Inlet'
  | 'Lock'
  | 'LocalKnowledge'
  | 'Navigational'
  | 'Airport'
  | 'Unknown'

/** Normalized list entry produced by a source for use inside the plugin. */
export interface PoiSummary {
  id: string
  type: PoiType
  position: Position
  name: string
  /** Source slug that produced this entry, e.g. `activecaptain`. */
  source: string
  /** Public web page for this POI (source-specific). */
  url: string
  /** Human-readable attribution credit for the source. */
  attribution: string
  /**
   * Every source that corroborates this POI, base source first. Set by the
   * dedupe pass: more than one entry means independent sources reported the
   * same physical feature. Absent when the POI did not pass through dedupe.
   */
  sources?: string[]
  /** Average review rating (0 to 5), when the list response carries one. */
  rating?: number
  /** Number of reviews behind the rating. */
  reviewCount?: number
  /**
   * Chartplotter icon hint, mapped to a Freeboard `:sk-${icon}` glyph.
   * Freeboard only renders a fixed list of registered icons; an unknown name
   * silently falls back to a default yellow square. Required so every source
   * must pick a registered icon at construction time: ActiveCaptain maps every
   * `PoiType` to a Freeboard-registered icon, and the other sources map every
   * feature (with isolated-danger marks rendered as hazards even though the
   * `PoiType` stays `Navigational`). A new source that omits it is a compile
   * error rather than a silent yellow square.
   */
  skIcon: string
  /**
   * ISO-8601 UTC timestamp tagging this entry with its source-specific
   * "age" (NOAA ENC `SORDAT` survey date, USCG `MODIFIED_DATE`, OSM element
   * `timestamp`, etc.). Parallel to {@link PoiDetailView.timestamp} so the
   * shared year-filter helper can act at list time without a detail fetch.
   * Optional: a source whose wire data carries no date leaves it absent and
   * the year filter passes the POI through unchanged.
   */
  timestamp?: string
  /**
   * Vertical clearance under a Bridge, in meters (SI), when the source knows
   * it. The bridge air-draft check compares this against the vessel air draft.
   * OpenSeaMap fills it at list time from the OSM clearance tags; the dedupe
   * pass carries the more conservative value onto a surviving base POI.
   * Absent when the source carries no clearance (the air-draft check then
   * resolves it from detail for ActiveCaptain bridges, or stays silent).
   */
  verticalClearanceMeters?: number
}

/**
 * A source-agnostic, fully rendered point-of-interest detail view. Every
 * `PoiSource.getDetails` returns this shape: the source has already rendered
 * its own detail HTML, so the `notes` output builds a note from this without
 * knowing which source produced it. The attribution credit rides on the
 * `attribution` field (and is republished on the note's structured
 * `properties.attribution`), not inline in the rendered HTML.
 */
export interface PoiDetailView {
  /** Display name. */
  name: string
  /** Map position. */
  position: Position
  /** POI type, used for the note `skIcon`. */
  type: PoiType
  /** Public web page for this POI (source-specific). */
  url: string
  /** Source slug, e.g. `activecaptain` or `openseamap`. */
  source: string
  /** Human-readable attribution credit for the source. */
  attribution: string
  /** Rendered HTML description. Omitted when none. */
  description?: string
  /**
   * Normalized, presentation-neutral detail a structured client can render
   * natively, carried alongside the HTML `description` (not instead of it).
   * Omitted by a source that does not yet produce it. Published on the note's
   * `properties.crowsNest.sections`; see `src/shared/normalized-detail.ts`.
   */
  sections?: NormalizedSection[]
  /** ISO-8601 UTC last-modified time, omitted when unknown. */
  timestamp?: string
  /**
   * Chartplotter icon hint, mapped to a Freeboard `:sk-${icon}` glyph. See
   * the matching {@link PoiSummary.skIcon} field for the contract.
   */
  skIcon: string
  /**
   * Vertical clearance under a Bridge, in meters (SI), when the source's
   * detail carries it. ActiveCaptain fills it from `NavigationSection`'s
   * `bridgeHeight`, converted from its `distanceUnit`. Parallel to
   * {@link PoiSummary.verticalClearanceMeters} so the air-draft check can
   * resolve a clearance from a detail fetch when the list summary had none.
   */
  verticalClearanceMeters?: number
}

/**
 * The PluginConfig keys that toggle a POI type: every `includeX` key. Used to
 * type the POI-type flag table and the config panel. Defined by the `include`
 * prefix so non-toggle settings (the caching duration, the rating filter, the
 * proximity-alarm options, and the route-hazard options) are never mistaken
 * for POI-type flags.
 */
export type PoiTypeFlag = Extract<keyof PluginConfig, `include${string}`>

/** Plugin configuration as supplied by the SignalK admin UI. */
export interface PluginConfig {
  cachingDurationMinutes: number
  includeMarinas?: boolean
  includeAnchorages?: boolean
  includeHazards?: boolean
  includeBusinesses?: boolean
  includeBoatRamps?: boolean
  includeBridges?: boolean
  includeDams?: boolean
  includeFerries?: boolean
  includeInlets?: boolean
  includeLocks?: boolean
  includeLocalKnowledge?: boolean
  includeNavigational?: boolean
  includeAirports?: boolean
  /** Subscribe to the vessel position, scan for nearby hazards, and emit alarms. */
  enableProximityAlarms?: boolean
  /** Distance, in meters, within which a hazard raises a proximity alarm. */
  proximityAlarmRadiusMeters?: number
  /** Scan the active Course API route ahead for hazards, bridges, and locks. */
  enableRouteHazardScan?: boolean
  /** Half-width, in meters, of the route corridor a POI must fall within. */
  routeCorridorWidthMeters?: number
  /**
   * Warn when an approaching bridge, or a bridge on the active route ahead,
   * has a vertical clearance at or below the vessel air draft. Drives a new
   * proximity alarm and upgrades the route-hazard scan's bridge messages.
   */
  enableBridgeAirDraftCheck?: boolean
  /**
   * Fallback vessel air draft, in meters, used only when the SignalK data
   * model has no `design.airHeight`. `0` or unset means rely on
   * `design.airHeight` alone; with neither set, the air-draft check is inert.
   */
  vesselAirDraftMeters?: number
  /**
   * Safety margin, in meters, added to the vessel air draft before the
   * clearance comparison, covering tide, datum, and loading. A bridge warns
   * when its clearance is at or below `airDraft + margin`. Clamped to the
   * shared bounds in `src/shared/bridge-clearance.ts`.
   */
  bridgeClearanceMarginMeters?: number
  /** Hide points of interest whose average rating is below this value (0 to 5). */
  minimumRating?: number
  /** Import points of interest from OpenSeaMap (OpenStreetMap marine data). */
  openSeaMapEnabled?: boolean
  /** Overpass API endpoint URL the OpenSeaMap source queries. */
  openSeaMapEndpoint?: string
  /**
   * Ordered Overpass fallback mirror endpoints the OpenSeaMap source fails over
   * to, in order, when the primary endpoint is unreachable. Empty by default.
   */
  openSeaMapFallbackEndpoints?: string[]
  /** Which OpenSeaMap seamark feature groups to import. */
  openSeaMapSeamarkGroups?: string[]
  /** Merge OpenSeaMap points of interest that duplicate an ActiveCaptain marker. */
  openSeaMapDedupe?: boolean
  /** Merge radius, in meters, for OpenSeaMap dedupe against the ActiveCaptain base. */
  openSeaMapDedupeRadiusMeters?: number
  /** Import US Aids to Navigation from the USCG Light List. */
  uscgLightListEnabled?: boolean
  /** Merge USCG Light List points of interest that duplicate an ActiveCaptain marker. */
  uscgLightListDedupe?: boolean
  /** Merge radius, in meters, for USCG Light List dedupe against the ActiveCaptain base. */
  uscgLightListDedupeRadiusMeters?: number
  /** USCG Light List background refresh period, in hours. */
  uscgLightListRefreshHours?: number
  /** Import wrecks, obstructions, and rocks from NOAA ENC Direct. */
  noaaEncEnabled?: boolean
  /** Merge NOAA ENC points of interest that duplicate an ActiveCaptain marker. */
  noaaEncDedupe?: boolean
  /** Merge radius, in meters, for NOAA ENC dedupe against the ActiveCaptain base. */
  noaaEncDedupeRadiusMeters?: number
  /** NOAA ENC chart scale band (`overview` through `berthing`). */
  noaaEncScaleBand?: string
  /** Include the NOAA ENC wrecks layer in list queries. */
  noaaEncIncludeWrecks?: boolean
  /** Include the NOAA ENC obstructions layer in list queries. */
  noaaEncIncludeObstructions?: boolean
  /** Include the NOAA ENC underwater-rocks layer in list queries. */
  noaaEncIncludeRocks?: boolean
  /**
   * Hide OpenSeaMap features whose OSM element timestamp is older than this
   * year. `0` disables the filter; features without a timestamp are always
   * included. Clamped to the shared `[MIN_YEAR, MAX_YEAR]` range from
   * `src/shared/year-filter.ts`.
   */
  openSeaMapMinimumYear?: number
  /**
   * Hide USCG Light List records whose `MODIFIED_DATE` is older than this
   * year. `0` disables the filter; records with no modification date are
   * always included. Clamped to the shared range.
   */
  uscgLightListMinimumUpdateYear?: number
  /**
   * Hide NOAA ENC features whose `SORDAT` hydrographic survey date is older
   * than this year. `0` disables the filter; features with no survey date
   * are always included. Clamped to the shared range.
   */
  noaaEncMinimumSurveyYear?: number
  /**
   * Minimum upstream-query interval per bbox for OpenSeaMap, in seconds. A
   * Freeboard refresh burst on the same viewport reuses the cached result
   * for this long before re-querying Overpass. `0` disables the cache.
   */
  openSeaMapRefreshSeconds?: number
  /**
   * Minimum upstream-query interval per bbox for NOAA ENC Direct, in
   * seconds. Same semantic as `openSeaMapRefreshSeconds`. `0` disables the
   * cache.
   */
  noaaEncRefreshSeconds?: number
  /**
   * Minimum upstream-query interval per bbox for ActiveCaptain, in
   * seconds. Same semantic as `openSeaMapRefreshSeconds`. `0` disables the
   * cache and posts to Garmin on every list call.
   */
  activeCaptainRefreshSeconds?: number
}
