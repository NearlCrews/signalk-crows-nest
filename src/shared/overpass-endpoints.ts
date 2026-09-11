/**
 * Overpass API endpoint constants and helpers, shared by the OpenSeaMap input
 * module, the panel's normalize-config, and the panel's fallback-endpoints
 * field. Browser-safe: it imports nothing node-only, so the bundled panel can
 * consume it directly.
 *
 * The OpenSeaMap source queries one primary endpoint and, when configured,
 * fails over to an ordered list of mirrors. This module owns the canonical
 * default, the vetted suggestion list, and the coercion that turns a raw
 * config value into a clean endpoint list.
 */

/**
 * Canonical default Overpass endpoint: the FOSSGIS-operated main instance. The
 * OSM wiki names this the main instance and the default for a polite low-volume
 * client (its policy allows under 10,000 queries and 1 GB per day, and requires
 * a descriptive `User-Agent`, both of which the plugin satisfies).
 */
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

/**
 * Vetted fallback mirrors suggested to the user, in preference order. Both are
 * full-planet public instances confirmed to serve global (including US) data
 * and to permit polite low-volume use. They are SUGGESTIONS surfaced in the
 * admin UI, not an enabled-by-default list: a published plugin should not route
 * every install's traffic onto volunteer mirrors without the operator opting
 * in, so the fallback list defaults empty.
 *
 * Deliberately excluded: `overpass.osm.ch` is a Switzerland-only extract (it
 * answers a US bounding box with HTTP 200 and zero elements), so it would
 * silently drop data for most of the world; `maps.mail.ru` is suspended; and
 * Geofabrik requires a paid API key.
 */
export const RECOMMENDED_OVERPASS_FALLBACK_ENDPOINTS: readonly string[] = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
]

/**
 * Return a trimmed absolute HTTP(S) endpoint, or `undefined` when the value is
 * not usable as one: a non-string, blank, unparseable, non-HTTP(S), or
 * credential-bearing URL.
 *
 * This is also the module's validity predicate, and the one callers should
 * reach for when they want the question rather than the value. Asking it
 * through {@link resolvePrimaryEndpoint} (comparing the result against the
 * trimmed input) or through {@link normalizeFallbackEndpoints} (checking a
 * one-element array's length) gives the same answer in every case, since the
 * default endpoint itself passes this check and so can never be returned for
 * an input that fails it, but both spellings pay a resolver round trip or an
 * array allocation to recover a boolean this returns directly.
 */
export function usableEndpoint (raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username !== '' || url.password !== '') return undefined
    return trimmed
  } catch {
    return undefined
  }
}

/**
 * Resolve the primary Overpass endpoint from a raw config value: a non-blank
 * string is trimmed and used, anything else (blank, whitespace, or non-string)
 * falls back to {@link DEFAULT_OVERPASS_ENDPOINT}. Shared by the input module
 * and the panel's normalize-config so the single-endpoint default rule lives in
 * one place alongside the default constant and the fallback cleaner.
 */
export function resolvePrimaryEndpoint (raw: unknown): string {
  return usableEndpoint(raw) ?? DEFAULT_OVERPASS_ENDPOINT
}

/**
 * Coerce a raw config value into a clean, ordered fallback-endpoint list:
 * non-string entries are dropped, each value is trimmed, blank entries are
 * removed, and duplicates are collapsed while preserving first-seen order.
 * Anything that is not an array (an old config that omits the key) yields an
 * empty list. Shared by the input module and normalize-config so the panel and
 * the plugin clean the value identically.
 */
export function normalizeFallbackEndpoints (raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const seen = new Set<string>()
  const endpoints: string[] = []
  for (const value of raw) {
    const endpoint = usableEndpoint(value)
    if (endpoint === undefined || seen.has(endpoint)) {
      continue
    }
    seen.add(endpoint)
    endpoints.push(endpoint)
  }
  return endpoints
}
