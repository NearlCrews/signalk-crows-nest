/**
 * Shared ArcGIS REST `/query` paging protocol.
 *
 * The NOAA ENC Direct and USACE clients speak the same ArcGIS dialect: a
 * bbox-bounded `esriGeometryEnvelope` query that returns `f=geojson`, a 1000
 * record per-response cap, and a bounded pagination loop driven by the
 * `exceededTransferLimit` flag. The two services differ only in how a request
 * URL is assembled (ENC Direct derives a MapServer path from a scale band and
 * layer id; USACE keys each layer to a full `/query` endpoint) and in the label
 * that tags their error messages. Everything else lives here once so the two
 * clients are thin bindings that supply a per-request URL and a label.
 *
 * Both clients build on the raw `http-one-shot.ts` transport on purpose: each is
 * a low-volume bbox query stream that needs neither the queue nor the retry of
 * `http-client.ts`.
 */

import { requestJson } from './http-one-shot.js'
import { PLUGIN_USER_AGENT } from '../shared/plugin-id.js'
import type { Bbox } from '../shared/types.js'
import { MS_PER_MINUTE } from '../shared/time.js'
import {
  isValidLatitude,
  isValidLongitude,
  toPositiveSafeInteger
} from '../shared/numbers.js'

/** ArcGIS' per-response cap. A client pages while the upstream signals more. */
const ARCGIS_PAGE_SIZE = 1000

/**
 * Upper bound on pagination passes per query. A misbehaving server that pins
 * `exceededTransferLimit: true` forever (a CDN cache regression, a stuck
 * cursor) would otherwise loop indefinitely and exhaust memory; the bound trips
 * first and rejects with a clear error so the source records it and the caller
 * backs off.
 */
const ARCGIS_MAX_PAGES = 200

/**
 * Per-request timeout in milliseconds. A hung TCP connection (a silently
 * dropped TLS handshake, a black-hole proxy) would otherwise block the next
 * scan tick indefinitely. The shared `http-client.ts` already enforces this for
 * the queued sources; these raw clients mirror the policy.
 */
const REQUEST_TIMEOUT_MS = MS_PER_MINUTE

/**
 * Request headers for every ArcGIS query. A descriptive User-Agent is part of
 * the protocol, not per-client configuration: some ArcGIS deployments never
 * answer the default Node agent, and the plugin has exactly one identity.
 */
const ARCGIS_HEADERS = { 'User-Agent': PLUGIN_USER_AGENT }

/** The subset of an ArcGIS GeoJSON response the paging loop reads. */
interface ArcGisFeatureCollection<F> {
  features?: F[]
  exceededTransferLimit?: boolean
}

/** Feature fields ArcGIS commonly uses as a stable object identity. */
interface ArcGisIdentifiableFeature {
  id?: unknown
  properties?: Record<string, unknown>
}

/**
 * Split an antimeridian-crossing bbox into ordinary ArcGIS envelopes. ArcGIS
 * envelopes use minimum and maximum X coordinates, so a wrapped `west > east`
 * box must become one request on each side of the dateline.
 */
export function splitArcgisEnvelope (bbox: Bbox): Bbox[] {
  if (
    !isValidLatitude(bbox.south) || !isValidLatitude(bbox.north) ||
    !isValidLongitude(bbox.west) || !isValidLongitude(bbox.east) ||
    bbox.south > bbox.north
  ) {
    throw new Error('ArcGIS query received an invalid bounding box')
  }
  if (bbox.west <= bbox.east) return [bbox]
  return [
    { ...bbox, east: 180 },
    { ...bbox, west: -180 }
  ]
}

/** Merge split-envelope results without duplicating an ArcGIS object id. */
export function mergeArcgisFeatureSets<F extends ArcGisIdentifiableFeature> (
  featureSets: readonly (readonly F[])[]
): F[] {
  const merged: F[] = []
  const seen = new Set<string>()
  for (const features of featureSets) {
    for (const feature of features) {
      const rawId = feature.id ?? feature.properties?.OBJECTID
      if (typeof rawId === 'number' || typeof rawId === 'string') {
        const key = `${typeof rawId}:${rawId}`
        if (seen.has(key)) continue
        seen.add(key)
      }
      merged.push(feature)
    }
  }
  return merged
}

/** The URLSearchParams for a bbox envelope query at a given paging offset. */
export function arcgisEnvelopeParams (bbox: Bbox, offset: number): URLSearchParams {
  if (splitArcgisEnvelope(bbox).length !== 1) {
    throw new Error('ArcGIS envelope must not cross the antimeridian')
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('ArcGIS result offset must be a non-negative safe integer')
  }
  return new URLSearchParams({
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outFields: '*',
    returnGeometry: 'true',
    f: 'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(ARCGIS_PAGE_SIZE)
  })
}

/** The URLSearchParams for a single-feature by-object-id query. */
export function arcgisByIdParams (objectId: number): URLSearchParams {
  const validId = toPositiveSafeInteger(objectId)
  if (validId === null) {
    throw new Error('ArcGIS object id must be a positive safe integer')
  }
  return new URLSearchParams({
    objectIds: String(validId),
    outFields: '*',
    returnGeometry: 'true',
    f: 'geojson'
  })
}

async function fetchJson (
  url: string,
  label: string,
  signal?: AbortSignal
): Promise<unknown> {
  return await requestJson(url, ARCGIS_HEADERS, REQUEST_TIMEOUT_MS, label, signal)
}

/** Inputs to {@link arcgisPagedQuery}. */
export interface ArcgisPagedQuery {
  /** Tags error messages and the timeout/abort reason, e.g. `ENC Direct`. */
  label: string
  /** Identifies the query in the pagination-exceeded error, e.g. `coastal/wreck`. */
  context: string
  /** Builds the full request URL for a given paging offset. */
  buildPageUrl: (offset: number) => string
  /** Optional deadline signal; cancels the in-flight request and stops paging. */
  signal?: AbortSignal
}

/**
 * Run a bbox `/query` to completion, paging while the upstream signals
 * `exceededTransferLimit`, and return the unioned features. Rejects once the
 * page bound trips so a server pinning the flag cannot loop forever.
 */
export async function arcgisPagedQuery<F> (query: ArcgisPagedQuery): Promise<F[]> {
  const { label, context, buildPageUrl, signal } = query
  const all: F[] = []
  let offset = 0
  // Bounded pagination loop: a misbehaving server pinning
  // exceededTransferLimit forever would otherwise loop indefinitely.
  for (let page = 0; page < ARCGIS_MAX_PAGES; page++) {
    // requestText rejects immediately when signal is already aborted, so the
    // continuation does not need its own pre-fetch abort guard.
    const json = await fetchJson(buildPageUrl(offset), label, signal) as ArcGisFeatureCollection<F>
    const features = json.features ?? []
    all.push(...features)
    if (json.exceededTransferLimit !== true || features.length === 0) {
      return all
    }
    offset += features.length
  }
  throw new Error(
    `${label} pagination exceeded ${ARCGIS_MAX_PAGES} pages for ${context}; ` +
    'the upstream may be pinning exceededTransferLimit incorrectly'
  )
}

/** Fetch a single feature by object id, or undefined when the upstream returns none. */
export async function arcgisQueryById<F> (
  url: string,
  label: string,
  signal?: AbortSignal
): Promise<F | undefined> {
  const json = await fetchJson(url, label, signal) as ArcGisFeatureCollection<F>
  return (json.features ?? [])[0]
}
