/**
 * Public-map deep-link builders for POI "view this in a browser" buttons.
 *
 * Several plugin sources need a public-map fallback because their upstream
 * does not expose a stable per-feature viewer:
 *
 * - NAVCEN's old Light List search-result deep link
 *   (`/light-list-search-results?...`) was retired when NAVCEN migrated to
 *   Drupal in 2020; the MSI app at `navcen.uscg.gov/msi` has no per-LLNR or
 *   per-notice URL routing.
 *   (https://www.navcen.uscg.gov/LNM-and-LL-app-frequently-asked-questions)
 *
 * - NOAA's ENC Direct viewer at `encdirect.noaa.gov` is an Esri Web
 *   AppBuilder shell with a 2020-stale configuration that ignores the
 *   documented `?center=lon,lat&level=z` URL parameters and lands blank
 *   regardless of input.
 *   (https://doc.arcgis.com/en/web-appbuilder/latest/manage-apps/app-url-parameters.htm)
 *
 * - The World Port Index dataset and public USACE lock and dam ArcGIS services
 *   expose records through bulk or query endpoints but provide no stable,
 *   user-facing page for one feature.
 *
 * NOAA CO-OPS also uses this fallback when a station record does not contain
 * enough information to construct its normal station page. Popup bodies still
 * carry source-specific identifiers and details so a mariner can
 * cross-reference a feature with its source publication.
 *
 * OpenSeaMap is chosen over plain OpenStreetMap because it renders the
 * marine seamark overlay (lights, buoys, depth contours) on top of the OSM
 * base, and many US navaids are already mirrored from the Light List into
 * OSM under the `seamark:light:*` tag family, so the marker often lands on
 * the matching aid.
 *
 * Marker URL format per the OpenSeaMap wiki:
 *   https://wiki.openseamap.org/wiki/h:En:Marker_in_URL
 */

import { isValidLatitude, isValidLongitude } from './numbers.js'

/** Default zoom for a marker view. Matches the zoom every other deep link uses. */
const DEFAULT_ZOOM = 15

/**
 * Decimal places used when interpolating coordinates into the URL. Five
 * decimals is roughly 1.1 m on the ground at the equator, which is well
 * inside the resolution any of the plugin's sources publishes and well
 * inside the precision a zoom-15 marker pin can represent. Without this
 * cap, JavaScript's default `Number.prototype.toString` produces up to 17
 * significant digits, so a coordinate like `41.012345678901234` would
 * ship a 60+ character URL twice (once for the center, once for the pin).
 */
const COORDINATE_PRECISION = 5

/** Fallback URL when a caller's coordinates are not usable. */
const FALLBACK_URL = 'https://map.openseamap.org/'

/**
 * Build an OpenSeaMap marker deep link centered on the given lat/lon. The
 * marker parameters (`mlat`, `mlon`) drop a pin so the feature is visible
 * without zooming around. An invalid coordinate falls back to the OpenSeaMap
 * home page rather than producing an out-of-range or `lat=NaN` URL that would
 * silently land somewhere meaningless.
 */
export function openSeaMapMarkerUrl (latitude: number, longitude: number): string {
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return FALLBACK_URL
  }
  const lat = latitude.toFixed(COORDINATE_PRECISION)
  const lon = longitude.toFixed(COORDINATE_PRECISION)
  return (
    'https://map.openseamap.org/' +
    `?zoom=${DEFAULT_ZOOM}` +
    `&lat=${lat}&lon=${lon}` +
    `&mlat=${lat}&mlon=${lon}`
  )
}
