/**
 * Best-effort discovery of the host page's CSP nonce, so the panel's injected
 * styles survive a `style-src` policy without `unsafe-inline`.
 *
 * The Signal K admin UI exposes no nonce API to a federated remote, so the
 * only signal available is a nonce the host already stamped on one of its own
 * script or style elements. The `nonce` IDL property is the reliable read:
 * browsers hide the content attribute from `getAttribute` on nonced elements,
 * so an attribute read would come back empty. When the host emits no nonced
 * tags (including every host without a CSP), this returns undefined and the
 * panel renders exactly as before; a host with a nonce-based policy that
 * never nonces its own tags is out of reach by design, not a bug here.
 */

let cached: string | undefined
let discovered = false

/** Return the first non-empty nonce found on a script or style element. */
export function discoverStyleNonce (doc: Document): string | undefined {
  if (discovered) return cached
  discovered = true
  for (const element of doc.querySelectorAll('script, style')) {
    const nonce = (element as HTMLElement).nonce
    if (nonce !== undefined && nonce !== '') {
      cached = nonce
      break
    }
  }
  return cached
}
