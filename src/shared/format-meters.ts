/** Format a meter value to one decimal for a message, keeping the sign. */
export function formatMeters (value: number): string {
  return value.toFixed(1)
}
