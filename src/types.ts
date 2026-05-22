/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Shared type contracts for the signalk-activecaptain-resources plugin.
 *
 * This module is the single source of truth for the data shapes that flow
 * between the plugin's modules (geo, client, cache, templates, index). It also
 * describes the subset of the ActiveCaptain wire types that the plugin
 * consumes, based on observed responses from
 * https://activecaptain.garmin.com/community/api/v1. Sections and fields the
 * plugin does not render are intentionally omitted.
 */

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

/** Minimal logging surface used by the plugin modules (a subset of the SignalK app). */
export interface Logger {
  debug: (message: string) => void
  error: (message: string) => void
}

/**
 * The categories of point of interest exposed by ActiveCaptain. The values are
 * the exact strings the API expects and returns.
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

/** A single point of interest as returned by the bounding-box list endpoint. */
export interface PoiListItem {
  id: string
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

/** Normalised list entry produced by the client for use inside the plugin. */
export interface PoiSummary {
  id: string
  type: PoiType
  position: Position
  name: string
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
  notes?: PoiNote[]
}

export interface FuelSection {
  diesel?: Availability
  ethanolFree?: Availability
  gas?: Availability
  propane?: Availability
  electric?: Availability
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

/**
 * The PluginConfig keys that toggle a POI type, i.e. every key except the
 * caching duration. Used to type the POI-type flag table and the config panel.
 */
export type PoiTypeFlag = Exclude<keyof PluginConfig, 'cachingDurationMinutes'>

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
}
