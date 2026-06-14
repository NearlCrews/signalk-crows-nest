import { METERS_PER_NAUTICAL_MILE } from './length.js'

/** Format a meter value to one decimal for a message, keeping the sign. */
export function formatMeters (value: number): string {
  return value.toFixed(1)
}

/** Format a meter value as nautical miles to two decimals for a message. */
export function formatNm (meters: number): string {
  return (meters / METERS_PER_NAUTICAL_MILE).toFixed(2)
}
