/**
 * Coverage-envelope predicates the route-draft provider resolver reads. Kept
 * out of us-waters.ts (the inputs' outbound-HTTP gate) so the route-draft region
 * concept does not couple to that gate. Browser-safe: no node-only imports.
 */

import type { Position } from './types.js'
import { isInUsWaters } from './us-waters.js'

/**
 * True when a leg endpoint is inside the (generous) US ENC coverage envelope. ENC coverage equals US
 * waters today, so this delegates, but it is a deliberate seam, not a redundant wrapper: it names the
 * ENC-coverage concept the route-draft resolver reads, and is where the two would diverge if NOAA ENC
 * ever covered more or less than the outbound-HTTP gate's US-waters envelope.
 */
export function isInEncCoverage (position: Position): boolean {
  return isInUsWaters(position)
}

/**
 * EMODnet bathymetry coverage envelope: longitude -36 to +43, latitude 15 to 90
 * (European seas, the Mediterranean, the Black Sea, the Baltic, the Norwegian
 * and Icelandic seas, the Arctic, and Macaronesia). Out-of-coverage cells
 * degrade to "not checked", so this coarse gate only decides whether to query.
 */
export function isInEmodnetCoverage (position: Position): boolean {
  const { latitude, longitude } = position
  return latitude >= 15 && latitude <= 90 && longitude >= -36 && longitude <= 43
}
