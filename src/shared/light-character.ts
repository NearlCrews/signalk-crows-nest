/**
 * IALA light-character humanizer, shared by the source detail renderers.
 *
 * Both the OpenSeaMap detail renderer (`seamark:light:character`) and the USCG
 * Light List detail renderer translate an IALA light-character abbreviation
 * like `Fl(2)` into a phrase like `flashing (2)`. The vocabulary is one
 * standard (IALA), so it lives here in `src/shared/` rather than in one input
 * module the other has to reach into.
 */

/**
 * IALA light character abbreviations, in plain English. A real value can carry
 * a parenthesised group count, e.g. `Fl(2)` or `Q(9)`, handled after this base
 * map is consulted.
 */
const LIGHT_CHARACTER: Readonly<Record<string, string>> = {
  F: 'fixed',
  Fl: 'flashing',
  LFl: 'long flashing',
  Q: 'quick flashing',
  IQ: 'interrupted quick',
  VQ: 'very quick',
  IVQ: 'interrupted very quick',
  UQ: 'ultra quick',
  IUQ: 'interrupted ultra quick',
  Iso: 'isophase',
  Oc: 'occulting',
  Mo: 'Morse',
  Al: 'alternating',
  FFl: 'fixed and flashing'
}

/** Pattern that splits a light character into its base and optional group. */
const LIGHT_CHARACTER_PATTERN = /^([A-Za-z]+)(\(.+\))?$/

/**
 * Translate an IALA light-character value like `Fl(2)` into a phrase like
 * `flashing (2)`. An unmapped base abbreviation is left as-is so an exotic
 * character is at least recognizable; the group count rides along unchanged.
 */
export function humanizeLightCharacter (raw: string): string {
  const match = raw.match(LIGHT_CHARACTER_PATTERN)
  if (match === null) {
    return raw
  }
  const base = LIGHT_CHARACTER[match[1]] ?? match[1]
  return match[2] !== undefined ? `${base} ${match[2]}` : base
}
