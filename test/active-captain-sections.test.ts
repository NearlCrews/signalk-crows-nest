/**
 * Tests for the ActiveCaptain normalized-section builder.
 *
 * The builder turns a structured PoiDetails into the source-agnostic
 * `NormalizedSection[]` a structured client renders, mirroring the same content
 * the Handlebars HTML renderer shows (the review, fuel, dockage, mooring,
 * amenities, business, services, retail, navigation, contact, featuredReview,
 * and notes partials) but as data rather than markup.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildActiveCaptainSections } from '../src/inputs/active-captain/active-captain-sections.js'
import type { PoiDetails } from '../src/inputs/active-captain/active-captain-types.js'
import type { NormalizedSection } from '../src/shared/normalized-detail.js'

function details (overrides: Partial<PoiDetails>): PoiDetails {
  return {
    pointOfInterest: {
      id: 12345,
      name: 'Test Marina',
      poiType: 'Marina',
      mapLocation: { latitude: 42.0, longitude: -71.0 },
      dateLastModified: '2024-03-12T00:00:00.000',
      ...overrides.pointOfInterest
    },
    ...overrides
  }
}

function section (sections: NormalizedSection[], id: string): NormalizedSection | undefined {
  return sections.find((s) => s.id === id)
}

test('builds normalized sections for a fully populated POI, mirroring the rendered detail', () => {
  const sections = buildActiveCaptainSections(details({
    pointOfInterest: {
      id: 12345,
      name: 'Test Marina',
      poiType: 'Marina',
      mapLocation: { latitude: 42.0, longitude: -71.0 },
      dateLastModified: '2024-03-12T00:00:00.000',
      notes: [{ field: 'GeneralInfo', value: 'Friendly staff,\nfuel dock on the river side.' }]
    },
    reviewSummary: { averageRating: 4.5, numberOfReviews: 28 },
    featuredReview: {
      title: 'Great stay',
      text: 'Easy approach and helpful dockhands.',
      rating: 5,
      createdBy: 'skipper42'
    },
    dockage: {
      isFree: false,
      total: 120,
      transient: 12,
      liveaboard: 'Yes',
      secureAccess: 'No',
      securityPatrol: 'Nearby',
      notes: [{ field: 'DockInfo', value: 'Call ahead on weekends.' }]
    },
    mooring: {
      isFree: true,
      hasMoorings: 'Yes',
      dinghy: 'Yes',
      launch: 'No',
      liveaboard: 'Unknown',
      total: 30,
      transient: 6
    },
    contact: {
      vhfChannel: '16',
      phone: '+1-555-0100',
      afterHourContact: 'Night dockmaster',
      email: 'dock@example.com',
      website: 'https://example.com'
    },
    fuel: {
      diesel: 'Yes',
      ethanolFree: 'No',
      gas: 'Yes',
      propane: 'Unknown',
      electric: 'Nearby'
    },
    amenity: {
      bar: 'Yes',
      cellReception: 'Yes',
      wifi: 'No'
    },
    services: {
      haulOut: 'Yes',
      pumpOut: 'Nearby'
    },
    retail: {
      grocery: 'Yes',
      ice: 'No'
    },
    navigation: {
      current: 'Moderate',
      fixedBridge: 'Yes',
      bridgeHeight: 65,
      tide: 4,
      depthApproach: 12,
      distanceUnit: 'ft'
    },
    business: {
      seasonal: 'No',
      public: 'Yes',
      credit: 'Yes'
    }
  }))

  // Review section: rating plus review count.
  assert.deepEqual(section(sections, 'review')?.items, [
    { label: 'Average rating', value: 4.5, kind: 'rating' },
    { label: 'Reviews', value: 28, kind: 'count' }
  ])

  // Featured review: the review title is content carried under a stable label,
  // not put in the label slot, and the prose is a note. The review's own rating
  // is not repeated here (the aggregate rating already leads the review section).
  assert.deepEqual(section(sections, 'featuredReview')?.items, [
    { label: 'Title', value: 'Great stay', kind: 'text' },
    { label: 'Review', value: 'Easy approach and helpful dockhands.', kind: 'note' },
    { label: 'Reviewed by', value: 'skipper42', kind: 'text' }
  ])

  // POI-level notes: humanized field label, free-text value.
  assert.deepEqual(section(sections, 'notes')?.items, [
    { label: 'General Info', value: 'Friendly staff,\nfuel dock on the river side.', kind: 'note' }
  ])

  assert.deepEqual(section(sections, 'dockage')?.items, [
    { label: 'Docks', value: false, kind: 'flag' },
    { label: 'Berths in total', value: 120, kind: 'count' },
    { label: 'Berths for visiting vessels', value: 12, kind: 'count' },
    { label: 'Liveaboard', value: 'Yes', kind: 'availability' },
    { label: 'Secure access', value: 'No', kind: 'availability' },
    { label: 'Security patrol', value: 'Nearby', kind: 'availability' },
    { label: 'Dock Info', value: 'Call ahead on weekends.', kind: 'note' }
  ])

  assert.deepEqual(section(sections, 'mooring')?.items, [
    { label: 'Moorings', value: true, kind: 'flag' },
    { label: 'Moorings available', value: 'Yes', kind: 'availability' },
    { label: 'Dinghy dock', value: 'Yes', kind: 'availability' },
    { label: 'Launch service', value: 'No', kind: 'availability' },
    { label: 'Moorings in total', value: 30, kind: 'count' },
    { label: 'Transient moorings', value: 6, kind: 'count' }
  ])

  assert.deepEqual(section(sections, 'contact')?.items, [
    { label: 'VHF', value: '16', kind: 'text' },
    { label: 'Phone', value: '+1-555-0100', kind: 'text' },
    { label: 'After hours', value: 'Night dockmaster', kind: 'text' },
    { label: 'Email', value: 'mailto:dock@example.com', kind: 'link' },
    { label: 'Website', value: 'https://example.com', kind: 'link' }
  ])

  assert.deepEqual(section(sections, 'fuel')?.items, [
    { label: 'Diesel', value: 'Yes', kind: 'availability' },
    { label: 'Ethanol free', value: 'No', kind: 'availability' },
    { label: 'Unleaded', value: 'Yes', kind: 'availability' },
    { label: 'Electric charging', value: 'Nearby', kind: 'availability' }
  ])

  assert.deepEqual(section(sections, 'amenities')?.items, [
    { label: 'Bar', value: 'Yes', kind: 'availability' },
    { label: 'Cell reception', value: 'Yes', kind: 'availability' },
    { label: 'Wi-Fi', value: 'No', kind: 'availability' }
  ])

  assert.deepEqual(section(sections, 'services')?.items, [
    { label: 'Haul-out', value: 'Yes', kind: 'availability' },
    { label: 'Pump-out', value: 'Nearby', kind: 'availability' }
  ])

  assert.deepEqual(section(sections, 'retail')?.items, [
    { label: 'Grocery', value: 'Yes', kind: 'availability' },
    { label: 'Ice', value: 'No', kind: 'availability' }
  ])

  assert.deepEqual(section(sections, 'navigation')?.items, [
    { label: 'Current', value: 'Moderate', kind: 'text' },
    { label: 'Fixed bridge', value: 'Yes', kind: 'availability' },
    { label: 'Bridge clearance', value: 65, kind: 'measure', unit: 'ft' },
    { label: 'Tidal range', value: 4, kind: 'measure', unit: 'ft' },
    { label: 'Approach depth', value: 12, kind: 'measure', unit: 'ft' }
  ])

  assert.deepEqual(section(sections, 'business')?.items, [
    { label: 'Seasonal', value: 'No', kind: 'availability' },
    { label: 'Open to public', value: 'Yes', kind: 'availability' },
    { label: 'Cards accepted', value: 'Yes', kind: 'availability' }
  ])
})

test('omits empty sections for a bare POI', () => {
  const sections = buildActiveCaptainSections(details({}))
  assert.equal(sections.length, 0, 'a POI with only identity carries no sections')
  assert.equal(section(sections, 'review'), undefined)
  assert.equal(section(sections, 'dockage'), undefined)
  assert.equal(section(sections, 'contact'), undefined)
  assert.equal(section(sections, 'navigation'), undefined)
  assert.equal(section(sections, 'notes'), undefined)
})

test('omits the dockage section header when only Unknown availabilities are present', () => {
  const sections = buildActiveCaptainSections(details({
    fuel: { diesel: 'Unknown', gas: 'Unknown' }
  }))
  assert.equal(section(sections, 'fuel'), undefined, 'all-Unknown fuel renders nothing')
})

test('shows a dockage section carrying only the price flag', () => {
  const sections = buildActiveCaptainSections(details({
    dockage: { isFree: true }
  }))
  assert.deepEqual(section(sections, 'dockage')?.items, [
    { label: 'Docks', value: true, kind: 'flag' }
  ])
})

test('suppresses review chrome on a non-business POI type but keeps the notes', () => {
  const sections = buildActiveCaptainSections(details({
    pointOfInterest: {
      id: 7,
      name: 'Submerged Piling',
      poiType: 'Hazard',
      mapLocation: { latitude: 42.0, longitude: -71.0 },
      dateLastModified: '2024-03-12T00:00:00.000',
      notes: [{ field: 'GeneralInfo', value: 'Reported by a passing vessel.' }]
    },
    reviewSummary: { averageRating: 4, numberOfReviews: 3 },
    featuredReview: { title: 'Watch out', text: 'Hit it at low tide.', rating: 1, createdBy: 'skipper42' }
  }))
  // A hazard, obstruction, or other non-business feature gets no star rating or
  // user reviews: those belong to marinas and businesses, not navigation hazards.
  assert.equal(section(sections, 'review'), undefined)
  assert.equal(section(sections, 'featuredReview'), undefined)
  // The free-text notes survive: that is where the on-the-water intel lives.
  assert.deepEqual(section(sections, 'notes')?.items, [
    { label: 'General Info', value: 'Reported by a passing vessel.', kind: 'note' }
  ])
})

test('keeps review chrome for an anchorage', () => {
  const sections = buildActiveCaptainSections(details({
    pointOfInterest: {
      id: 8,
      name: 'Quiet Cove',
      poiType: 'Anchorage',
      mapLocation: { latitude: 42.0, longitude: -71.0 },
      dateLastModified: '2024-03-12T00:00:00.000'
    },
    reviewSummary: { averageRating: 4.2, numberOfReviews: 9 },
    featuredReview: { title: 'Great holding', text: 'Mud bottom, well sheltered.', rating: 5, createdBy: 'skipper42' }
  }))
  assert.deepEqual(section(sections, 'review')?.items, [
    { label: 'Average rating', value: 4.2, kind: 'rating' },
    { label: 'Reviews', value: 9, kind: 'count' }
  ])
  assert.deepEqual(section(sections, 'featuredReview')?.items, [
    { label: 'Title', value: 'Great holding', kind: 'text' },
    { label: 'Review', value: 'Mud bottom, well sheltered.', kind: 'note' },
    { label: 'Reviewed by', value: 'skipper42', kind: 'text' }
  ])
})

test('normalizes the PoiNotes field id to a plain "Notes" label', () => {
  const sections = buildActiveCaptainSections(details({
    pointOfInterest: {
      id: 9,
      name: 'Test Marina',
      poiType: 'Marina',
      mapLocation: { latitude: 42.0, longitude: -71.0 },
      dateLastModified: '2024-03-12T00:00:00.000',
      notes: [{ field: 'PoiNotes', value: 'Call ahead.' }]
    }
  }))
  assert.deepEqual(section(sections, 'notes')?.items, [
    { label: 'Notes', value: 'Call ahead.', kind: 'note' }
  ])
})

test('emits approach depth unitless rather than dropping it when the unit is absent', () => {
  // A go/no-go depth must never be silently dropped because the unit field is
  // missing: a missing depth and a unitless depth are very different to a skipper.
  const sections = buildActiveCaptainSections(details({
    navigation: { depthApproach: 9 }
  }))
  assert.deepEqual(section(sections, 'navigation')?.items, [
    { label: 'Approach depth', value: 9, kind: 'measure' }
  ])
})

test('emits maximum LOA and beam from the dockage payload', () => {
  const sections = buildActiveCaptainSections(details({
    dockage: { loaMax: 18, beamMax: 5.5, distanceUnit: 'Meter' }
  }))
  assert.deepEqual(section(sections, 'dockage')?.items, [
    { label: 'Maximum LOA', value: 18, kind: 'measure', unit: 'Meter' },
    { label: 'Maximum beam', value: 5.5, kind: 'measure', unit: 'Meter' }
  ])
})

test('emits the fuel dock depth from the fuel payload', () => {
  const sections = buildActiveCaptainSections(details({
    fuel: { diesel: 'Yes', depthFuel: 3.2, distanceUnit: 'Meter' }
  }))
  assert.deepEqual(section(sections, 'fuel')?.items, [
    { label: 'Diesel', value: 'Yes', kind: 'availability' },
    { label: 'Fuel dock depth', value: 3.2, kind: 'measure', unit: 'Meter' }
  ])
})

test('the contact section rejects a javascript: website and neutralizes a javascript: email, matching the HTML scheme guard', () => {
  const sections = buildActiveCaptainSections(details({
    contact: {
      phone: '+1-555-0100',
      email: 'javascript:alert(1)',
      website: 'javascript:alert(document.cookie)'
    }
  }))
  const items = section(sections, 'contact')?.items ?? []
  // The website is a raw href: a javascript: scheme is not allowed, so the
  // whole link item is dropped, matching the HTML template's suppress-on-reject.
  assert.equal(items.find((i) => i.label === 'Website'), undefined,
    'a javascript: website must not reach a structured client as a link')
  // The email rides as a mailto: URL, an inert scheme, so even a javascript:
  // payload cannot execute. This matches the template's hardcoded mailto: href.
  assert.equal(items.find((i) => i.label === 'Email')?.value, 'mailto:javascript:alert(1)')
  // Belt and suspenders: no contact item ships a javascript: scheme value.
  for (const item of items) {
    assert.ok(!String(item.value).toLowerCase().startsWith('javascript:'),
      `no contact item should carry a javascript: scheme, got ${String(item.value)}`)
  }
})
