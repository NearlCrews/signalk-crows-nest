/**
 * Wire types for the Garmin ActiveCaptain summary API.
 *
 * These describe the subset of the responses from
 * https://activecaptain.garmin.com/community/api/v1 that the ActiveCaptain
 * input consumes. They are private to this input: nothing outside
 * `src/inputs/active-captain/` imports them. Sections and fields the plugin
 * does not render are intentionally omitted.
 *
 * Source-agnostic shapes (`PoiSummary`, `PoiDetailView`, `PoiType`, and
 * friends) live in `src/shared/types.ts` and are imported here.
 */

import type { Position, PoiType } from '../../shared/types.js'

/**
 * Availability flag used throughout the ActiveCaptain summary API. Mostly
 * tri-state (Yes / No / Unknown); some fields also report 'Nearby'.
 */
export type Availability = 'Yes' | 'No' | 'Unknown' | 'Nearby'

/** A free-form note attached to a section of a point of interest. */
export interface PoiNote {
  field: string
  value: string
}

/** Aggregate review score for a point of interest. */
export interface ReviewSummary {
  averageRating: number
  numberOfReviews: number
}

/**
 * A single point of interest as returned by the bounding-box list endpoint.
 *
 * The wire ships `id` as a number on both the list and the detail responses
 * (see docs/garmin-api.md for the live-verified shape); the client coerces
 * it to a string in the list-mapping step for use as a SignalK resource id,
 * so the rest of the plugin sees a uniform string.
 */
export interface PoiListItem {
  id: number
  poiType: PoiType
  mapLocation: Position
  name: string
  reviewSummary?: ReviewSummary
  poiCount?: number
}

/** Response body of the bounding-box list endpoint. */
export interface PoiListResponse {
  pointsOfInterest: PoiListItem[]
}

/** Identity and location block present in every summary response. */
export interface PointOfInterest {
  id: number
  name: string
  poiType: PoiType
  mapLocation: Position
  dateLastModified: string
  notes?: PoiNote[]
}

export interface AmenitySection {
  bar?: Availability
  boatRamp?: Availability
  cellReception?: Availability
  courtesyCar?: Availability
  laundry?: Availability
  lodging?: Availability
  pets?: Availability
  restaurant?: Availability
  restroom?: Availability
  shower?: Availability
  transportation?: Availability
  trash?: Availability
  water?: Availability
  wifi?: Availability
  notes?: PoiNote[]
}

export interface BusinessSection {
  cash?: Availability
  check?: Availability
  credit?: Availability
  public?: Availability
  seasonal?: Availability
  notes?: PoiNote[]
}

export interface ContactSection {
  vhfChannel?: string
  phone?: string
  afterHourContact?: string
  email?: string
  website?: string
  addressStreet?: string
  addressCity?: string
  addressZip?: string
  addressState?: string
  addressCountry?: string
}

export interface DockageSection {
  liveaboard?: Availability
  secureAccess?: Availability
  securityPatrol?: Availability
  isFree?: boolean
  /** Total number of berths. */
  total?: number
  /** Number of berths available to transient (visiting) vessels. */
  transient?: number
  /** Maximum vessel length overall the marina accepts, in `distanceUnit`. */
  loaMax?: number
  /** Maximum vessel beam the marina accepts, in `distanceUnit`. */
  beamMax?: number
  /** Unit for `loaMax` and `beamMax`, e.g. "Meter". */
  distanceUnit?: string
  notes?: PoiNote[]
}

export interface FuelSection {
  diesel?: Availability
  ethanolFree?: Availability
  gas?: Availability
  propane?: Availability
  electric?: Availability
  /** Depth at the fuel dock, in `distanceUnit`. A dockside go/no-go fact. */
  depthFuel?: number
  /** Unit for `depthFuel`, e.g. "Meter". */
  distanceUnit?: string
  notes?: PoiNote[]
}

/** Repair and marine-service trades available at a point of interest. */
export interface ServicesSection {
  boatBrokers?: Availability
  bottomPainting?: Availability
  canvasAndUpholstery?: Availability
  carpentry?: Availability
  charter?: Availability
  electronics?: Availability
  fiberglass?: Availability
  haulOut?: Availability
  marineHvac?: Availability
  mechanical?: Availability
  paint?: Availability
  plumbing?: Availability
  propellerRepair?: Availability
  pumpOut?: Availability
  repair?: Availability
  repairDieselEngines?: Availability
  repairGasEngines?: Availability
  rescueAndSalvage?: Availability
  sailsAndRigging?: Availability
  storage?: Availability
  surveyors?: Availability
  towing?: Availability
  washAndWax?: Availability
  waterTaxi?: Availability
  welding?: Availability
  notes?: PoiNote[]
}

/** Shops and supplies available at a point of interest. */
export interface RetailSection {
  fishingSupplies?: Availability
  grocery?: Availability
  hardware?: Availability
  ice?: Availability
  marineRetail?: Availability
  notes?: PoiNote[]
}

/** Mooring-field details, present mainly on anchorages. */
export interface MooringSection {
  hasMoorings?: Availability
  dinghy?: Availability
  launch?: Availability
  liveaboard?: Availability
  isFree?: boolean
  total?: number
  transient?: number
  notes?: PoiNote[]
}

/** Navigation hazards and constraints, present mainly on anchorages. */
export interface NavigationSection {
  /**
   * Current strength. This is NOT a tri-state availability flag: the API
   * returns a strength word such as 'Weak', 'Moderate', or 'Strong'.
   */
  current?: string
  fixedBridge?: Availability
  /** Fixed-bridge clearance height, in `distanceUnit`. */
  bridgeHeight?: number
  /** Tidal range, in `distanceUnit`. */
  tide?: number
  /** Approach depth, in `distanceUnit`. */
  depthApproach?: number
  distanceUnit?: string
  notes?: PoiNote[]
}

/** A single highlighted user review returned with a summary response. */
export interface FeaturedReview {
  title?: string
  text?: string
  rating?: number
  createdBy?: string
  dateVisited?: string
  votes?: number
  /** Moderation status, e.g. 'Published' or 'PendingReview'. */
  status?: string
}

/** Full detail response of the point-of-interest summary endpoint. */
export interface PoiDetails {
  pointOfInterest: PointOfInterest
  amenity?: AmenitySection
  business?: BusinessSection
  contact?: ContactSection
  dockage?: DockageSection
  fuel?: FuelSection
  services?: ServicesSection
  retail?: RetailSection
  mooring?: MooringSection
  navigation?: NavigationSection
  reviewSummary?: ReviewSummary
  featuredReview?: FeaturedReview
}
