/**
 * Helpers for the within-source id encoding the OpenSeaMap, NOAA ENC, and
 * USACE sources use, plus the aggregate registry's source-slug prefix.
 *
 * These sources cannot keep the upstream's slash form (`node/123`, `wreck/12345`)
 * in a resource id: SignalK serves resources at `/resources/notes/<id>`, so a
 * slash inside the id splits the path. They encode the id as
 * `prefix_remainder` (`node_123`, `wreck_12345`) and split on the first
 * underscore to recover the two halves. The aggregate registry uses the same
 * shape with a hyphen separator (`activecaptain-12345`). The split rule lives
 * here so every caller shares it rather than each re-deriving the same
 * `indexOf(sep)` slice.
 */

/**
 * Split an id on the first occurrence of `separator`. Returns null when no
 * separator separates a non-empty prefix from the remainder (a leading or
 * absent separator), so a caller can treat the id as un-namespaced. A raw OSM
 * numeric id never contains an underscore, and a source slug never contains a
 * hyphen, so splitting on the first separator is exact for every caller's id
 * form.
 */
export function splitOnFirstSeparator (
  id: string,
  separator: string
): { prefix: string, remainder: string } | null {
  const index = id.indexOf(separator)
  if (index <= 0) return null
  return { prefix: id.slice(0, index), remainder: id.slice(index + separator.length) }
}

/**
 * Split a `prefix_remainder` id on its first underscore. Thin wrapper over
 * {@link splitOnFirstSeparator} for the OpenSeaMap, NOAA ENC, and USACE id form.
 */
export function splitOnFirstUnderscore (id: string): { prefix: string, remainder: string } | null {
  return splitOnFirstSeparator(id, '_')
}
