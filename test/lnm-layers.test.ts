/**
 * Tests for the pinned USCG LNM layer catalog and its POI mapping.
 *
 * The safety contract is the load-bearing assertion: the reported-hazard and
 * discrepant-aid layers must map to the `Hazard` PoiType so the proximity and
 * route-corridor alarms pick them up, while the informational layers map to a
 * non-hazard type. The catalog shape is locked here so a NAVCEN paging change
 * or an accidental remapping is a deliberate, visible edit.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LNM_LAYERS,
  LNM_LAYER_BY_SLUG,
  LNM_LAYER_PAGES,
  lnmFileKey
} from '../src/inputs/uscg-lnm/lnm-layers.js'

/** The layers whose features mark a danger, so they must map to Hazard. */
const HAZARD_LAYERS = new Set(['haznav', 'discfedaid', 'discpriaid'])

test('every danger layer maps to the Hazard type with the hazard icon', () => {
  for (const slug of HAZARD_LAYERS) {
    const layer = LNM_LAYER_BY_SLUG.get(slug)
    assert.ok(layer !== undefined, `expected a pinned layer for ${slug}`)
    assert.equal(layer.poiType, 'Hazard',
      `${slug} must be Hazard so the proximity and route alarms fire`)
    assert.equal(layer.skIcon, 'hazard')
  }
})

test('every informational layer maps to a non-hazard type with the notice icon', () => {
  for (const layer of LNM_LAYERS) {
    if (HAZARD_LAYERS.has(layer.slug)) continue
    assert.equal(layer.poiType, 'Navigational',
      `${layer.slug} is informational, so it must not be a Hazard`)
    assert.equal(layer.skIcon, 'notice-to-mariners')
  }
})

test('layer slugs are unique and carry no separator that would split a resource id', () => {
  const slugs = LNM_LAYERS.map((layer) => layer.slug)
  assert.equal(new Set(slugs).size, slugs.length, 'slugs must be unique')
  for (const slug of slugs) {
    // The aggregate registry splits a resource id on the first hyphen to
    // recover the source slug, and the source id is `${slug}_${businessId}`,
    // so a hyphen or underscore in a layer slug would corrupt the id split.
    assert.doesNotMatch(slug, /[-_]/, `slug "${slug}" must not contain a hyphen or underscore`)
  }
})

test('the notice and discrepancy layers are covered, and the corrected files are excluded', () => {
  const slugs = new Set(LNM_LAYERS.map((layer) => layer.slug))
  for (const expected of ['haznav', 'discfedaid', 'discpriaid', 'tmpchange', 'marcon', 'bridge', 'misc']) {
    assert.ok(slugs.has(expected), `expected the ${expected} layer to be pinned`)
  }
  for (const excluded of LNM_LAYERS) {
    assert.doesNotMatch(excluded.fileBase, /Cor$/,
      'a "Corrected" companion file is a resolved condition, not a live notice')
  }
})

test('LNM_LAYER_PAGES flattens every pinned (layer, page) file exactly once', () => {
  const expectedTotal = LNM_LAYERS.reduce((sum, layer) => sum + layer.pages.length, 0)
  assert.equal(LNM_LAYER_PAGES.length, expectedTotal)
  // discFedAid and discPriAid each pin three pages (NAVCEN duplicates page _2
  // and continues on _3); every other layer pins one page.
  assert.equal(expectedTotal, 11)
  const keys = LNM_LAYER_PAGES.map(({ layer, page }) => lnmFileKey(layer.slug, page))
  assert.equal(new Set(keys).size, keys.length, 'no (layer, page) file is pinned twice')
})
