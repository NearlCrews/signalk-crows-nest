/**
 * Helper for the within-source id encoding both OpenSeaMap and NOAA ENC use.
 *
 * Neither source can keep the upstream's slash form (`node/123`, `wreck/12345`)
 * in a resource id: SignalK serves resources at `/resources/notes/<id>`, so a
 * slash inside the id splits the path. Both encode the id as
 * `prefix_remainder` (`node_123`, `wreck_12345`) and split on the first
 * underscore to recover the two halves. The split rule lives here so the two
 * sources share it rather than each re-deriving the same `indexOf('_')` slice.
 */

/**
 * Split a `prefix_remainder` id on its first underscore. Returns null when no
 * underscore separates a non-empty prefix from the remainder (a leading or
 * absent underscore), so a caller can treat the id as un-namespaced. A raw OSM
 * numeric id never contains an underscore, so splitting on the first underscore
 * is exact for both sources' id forms.
 */
export function splitOnFirstUnderscore (id: string): { prefix: string, remainder: string } | null {
  const underscore = id.indexOf('_')
  if (underscore <= 0) return null
  return { prefix: id.slice(0, underscore), remainder: id.slice(underscore + 1) }
}
