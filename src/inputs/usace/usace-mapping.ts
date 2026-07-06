/**
 * Per-layer PoiType, Freeboard icon, label, and shared field readers for the
 * USACE locks and dams source.
 *
 * A lock maps to the `Lock` PoiType and a dam to `Dam`; both are members the
 * ActiveCaptain toggles already carry, and the route-hazard scan treats a
 * `Lock` specially, so the type must be faithful. Every icon here is one of
 * Freeboard's registered `sk-` glyphs (the ActiveCaptain mapping registers
 * `lock` and `dam`), so a marker never falls back to the default yellow square.
 *
 * The lock and dam wire records name their display field differently
 * (`PMSNAME` versus `NAME`), so {@link structureName} centralizes that choice:
 * the source, the HTML renderer, and the section builder all read the name
 * through it and cannot drift.
 */

import type { UsaceLayerKey } from './usace-types.js'
import type { PoiType } from '../../shared/types.js'
import { presentString } from '../../shared/strings.js'

/** The PoiType each USACE layer maps to. */
export const LAYER_POI_TYPE: Readonly<Record<UsaceLayerKey, PoiType>> = {
  lock: 'Lock',
  dam: 'Dam'
}

/** The Freeboard-registered `sk-` icon each USACE layer maps to. */
export const LAYER_SK_ICON: Readonly<Record<UsaceLayerKey, string>> = {
  lock: 'lock',
  dam: 'dam'
}

/** Layer-derived fallback label, used as the popup header when the name is absent. */
export const LAYER_LABEL: Readonly<Record<UsaceLayerKey, string>> = {
  lock: 'Lock',
  dam: 'Dam'
}

/**
 * The display name for a feature: `PMSNAME` for a lock, `NAME` for a dam,
 * trimmed and rejected when blank. Returns `undefined` when the record carries
 * no usable name so the caller falls back to {@link LAYER_LABEL}.
 */
export function structureName (
  layerKey: UsaceLayerKey,
  properties: Record<string, unknown>
): string | undefined {
  return presentString(layerKey === 'lock' ? properties.PMSNAME : properties.NAME)
}
