import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fromNow,
  hasAmenities,
  hasBusiness,
  hasContact,
  hasDockage,
  hasFuel,
  hasMooring,
  hasNavigation,
  hasRetail,
  hasServices,
  isStaleHazard,
  renderDescription
} from '../src/inputs/active-captain/poi-detail-renderer.js'
import type { PoiDetails } from '../src/shared/types.js'

const NOW = new Date('2026-05-21T12:00:00.000Z')
const THREE_DAYS_AGO = new Date(NOW.getTime() - 3 * 86400 * 1000)
/** Comfortably older than the two-year staleness threshold. */
const FOUR_YEARS_AGO = new Date('2022-01-01T00:00:00.000Z')

/** A marina with every section populated. */
function fullMarina (): PoiDetails {
  return {
    pointOfInterest: {
      id: 12345,
      name: 'Test Harbour Marina',
      poiType: 'Marina',
      mapLocation: { latitude: 25.7, longitude: -80.2 },
      dateLastModified: THREE_DAYS_AGO.toISOString(),
      notes: [{ field: 'Heads up', value: 'Shallow at low tide' }]
    },
    fuel: { diesel: 'Yes', ethanolFree: 'Unknown', gas: 'Yes', propane: 'No', electric: 'Unknown' },
    dockage: { liveaboard: 'Yes', secureAccess: 'Unknown', securityPatrol: 'No' },
    contact: { vhfChannel: '16', phone: '+1 305 555 0100', website: 'https://example.com' },
    services: { haulOut: 'Yes', pumpOut: 'Yes', mechanical: 'Unknown', repair: 'No' },
    retail: { grocery: 'Yes', ice: 'Unknown', fishingSupplies: 'No' },
    reviewSummary: { averageRating: 4.5, numberOfReviews: 27 },
    featuredReview: { title: 'Great stop', text: 'Friendly staff and calm water', rating: 5, createdBy: 'A Sailor' }
  }
}

/** An anchorage with mooring-field and navigation detail. */
function anchorageWithMooring (): PoiDetails {
  return {
    pointOfInterest: {
      id: 222,
      name: 'Quiet Cove',
      poiType: 'Anchorage',
      mapLocation: { latitude: 41.4, longitude: -71.3 },
      dateLastModified: THREE_DAYS_AGO.toISOString()
    },
    mooring: { hasMoorings: 'Yes', dinghy: 'Yes', launch: 'No', liveaboard: 'Unknown', transient: 12 },
    navigation: { current: 'Weak', fixedBridge: 'No', tide: 1.4, bridgeHeight: 0 }
  }
}

/** A marina with only the mandatory point-of-interest block. */
function bareMarina (): PoiDetails {
  return {
    pointOfInterest: {
      id: 999,
      name: 'Bare Point',
      poiType: 'Marina',
      mapLocation: { latitude: 0, longitude: 0 },
      dateLastModified: THREE_DAYS_AGO.toISOString()
    }
  }
}

/** A Hazard point of interest, last modified at the given time. */
function hazard (dateLastModified: Date): PoiDetails {
  return {
    pointOfInterest: {
      id: 555,
      name: 'Submerged Piling',
      poiType: 'Hazard',
      mapLocation: { latitude: 27.1, longitude: -82.5 },
      dateLastModified: dateLastModified.toISOString()
    }
  }
}

test('renderDescription renders every populated section of a marina', () => {
  const html = renderDescription(fullMarina())

  assert.match(html, /last updated/)
  assert.match(html, /Dockage/)
  assert.match(html, /Liveaboard/)
  assert.match(html, /Contact/)
  assert.match(html, /VHF 16/)
  assert.match(html, /Fuel/)
  assert.match(html, /Diesel/)
  assert.match(html, /Services/)
  assert.match(html, /Haul-out/)
  assert.match(html, /Retail/)
  assert.match(html, /Grocery/)
  assert.match(html, /Heads up: Shallow at low tide/)
  assert.match(html, /27 reviews/)
  assert.match(html, /Friendly staff and calm water/)
  assert.match(html, /reviewed by A Sailor/)
  assert.match(html, /contribute/)
})

test('renderDescription renders mooring and navigation for an anchorage', () => {
  const html = renderDescription(anchorageWithMooring())

  assert.match(html, /Mooring/)
  assert.match(html, /Moorings available/)
  assert.match(html, /Dinghy dock/)
  assert.match(html, /12 transient moorings/)
  assert.match(html, /Navigation/)
  // `current` is a strength word, rendered as "Current: Weak", not a tick.
  assert.match(html, /Current: Weak/)
  assert.match(html, /Tidal range 1.4/)
})

test('availabilityLine skips Unknown fields and shows definite ones', () => {
  const html = renderDescription(fullMarina())

  // haulOut is Yes and repair is No, so both render.
  assert.match(html, /✅ Haul-out/)
  assert.match(html, /❌ General repair/)
  // mechanical is Unknown, so its line is omitted entirely.
  assert.doesNotMatch(html, /Mechanical repair/)
})

test('renderDescription omits sections that are absent', () => {
  const html = renderDescription(bareMarina())

  assert.doesNotMatch(html, /Dockage/)
  assert.doesNotMatch(html, /Fuel/)
  assert.doesNotMatch(html, /Contact/)
  assert.doesNotMatch(html, /Amenities/)
  assert.doesNotMatch(html, /Business/)
  assert.doesNotMatch(html, /Services/)
  assert.doesNotMatch(html, /Retail/)
  assert.doesNotMatch(html, /Mooring/)
  assert.doesNotMatch(html, /Navigation/)
  // The header and footer always render.
  assert.match(html, /last updated/)
  assert.match(html, /contribute/)
})

test('renderDescription closes the fuel div correctly (no <//div> typo)', () => {
  const html = renderDescription(fullMarina())
  assert.doesNotMatch(html, /<\/\/div>/)
})

test('renderDescription emits a real website href, not the literal word', () => {
  const html = renderDescription(fullMarina())
  assert.match(html, /href="https:\/\/example\.com"/)
  assert.doesNotMatch(html, /href="website"/)
})

test('fromNow describes past and future dates relative to a reference time', () => {
  assert.equal(fromNow(THREE_DAYS_AGO, NOW), '3 days ago')
  assert.equal(fromNow(new Date(NOW.getTime() + 2 * 3600 * 1000), NOW), 'in 2 hours')
  assert.equal(fromNow(new Date(NOW.getTime() - 90 * 1000), NOW), '1 minute ago')
})

test('fromNow steps up a unit when rounding spills past the boundary', () => {
  // 3599 s is under an hour but rounds to 60 minutes; it must read "1 hour".
  assert.equal(fromNow(new Date(NOW.getTime() - 3599 * 1000), NOW), '1 hour ago')
  // 86399 s rounds to 24 hours, which is one day.
  assert.equal(fromNow(new Date(NOW.getTime() - 86399 * 1000), NOW), 'yesterday')
  // A sub-minute delta stays in seconds rather than rounding up to a minute.
  assert.equal(fromNow(new Date(NOW.getTime() - 20 * 1000), NOW), '20 seconds ago')
})

test('fromNow returns a fallback string for an invalid date instead of throwing', () => {
  assert.equal(fromNow(new Date('not a date'), NOW), 'an unknown time ago')
})

test('hasFuel is true only when a fuel section carries data', () => {
  assert.equal(hasFuel(fullMarina()), true)
  assert.equal(hasFuel(bareMarina()), false)

  // An empty section object must not count as populated.
  const emptySection = bareMarina()
  emptySection.fuel = {}
  assert.equal(hasFuel(emptySection), false)

  const allUnknown = bareMarina()
  allUnknown.fuel = { diesel: 'Unknown', ethanolFree: 'Unknown', gas: 'Unknown', propane: 'Unknown', electric: 'Unknown' }
  assert.equal(hasFuel(allUnknown), false)

  const notesOnly = bareMarina()
  notesOnly.fuel = { diesel: 'Unknown', ethanolFree: 'Unknown', gas: 'Unknown', propane: 'Unknown', electric: 'Unknown', notes: [{ field: 'Hours', value: 'Daylight only' }] }
  assert.equal(hasFuel(notesOnly), true)
})

test('hasDockage is true only when a dockage section carries data', () => {
  assert.equal(hasDockage(fullMarina()), true)
  assert.equal(hasDockage(bareMarina()), false)

  // notes absent must not throw: this was the original null-safety bug.
  const allUnknown = bareMarina()
  allUnknown.dockage = { liveaboard: 'Unknown', secureAccess: 'Unknown', securityPatrol: 'Unknown' }
  assert.equal(hasDockage(allUnknown), false)
})

test('hasContact is true only when a contact section carries a populated field', () => {
  assert.equal(hasContact(fullMarina()), true)
  assert.equal(hasContact(bareMarina()), false)

  const empty = bareMarina()
  empty.contact = { vhfChannel: '', phone: '', afterHourContact: '', email: '', website: '' }
  assert.equal(hasContact(empty), false)
})

test('hasAmenities and hasBusiness handle present and absent sections', () => {
  assert.equal(hasAmenities(bareMarina()), false)
  assert.equal(hasBusiness(bareMarina()), false)

  const withAmenity = bareMarina()
  withAmenity.amenity = { wifi: 'Yes' }
  assert.equal(hasAmenities(withAmenity), true)

  const withBusiness = bareMarina()
  withBusiness.business = { credit: 'Yes' }
  assert.equal(hasBusiness(withBusiness), true)

  // All known fields Unknown and notes absent: this reaches the notes check,
  // which threw in the original code. It must return false without throwing.
  const businessAllUnknown = bareMarina()
  businessAllUnknown.business = { cash: 'Unknown', check: 'Unknown', credit: 'Unknown', public: 'Unknown', seasonal: 'Unknown' }
  assert.equal(hasBusiness(businessAllUnknown), false)
})

test('hasServices and hasRetail are true only when a section carries data', () => {
  assert.equal(hasServices(fullMarina()), true)
  assert.equal(hasRetail(fullMarina()), true)
  assert.equal(hasServices(bareMarina()), false)
  assert.equal(hasRetail(bareMarina()), false)

  // An all-Unknown section does not count as populated.
  const allUnknown = bareMarina()
  allUnknown.services = { haulOut: 'Unknown', pumpOut: 'Unknown' }
  assert.equal(hasServices(allUnknown), false)

  // Notes alone count as data.
  const notesOnly = bareMarina()
  notesOnly.retail = { grocery: 'Unknown', notes: [{ field: 'Store', value: 'Open weekends' }] }
  assert.equal(hasRetail(notesOnly), true)
})

test('hasMooring counts a transient count even when availability is Unknown', () => {
  assert.equal(hasMooring(anchorageWithMooring()), true)
  assert.equal(hasMooring(bareMarina()), false)

  const allUnknown = bareMarina()
  allUnknown.mooring = { hasMoorings: 'Unknown', dinghy: 'Unknown', transient: 0, total: 0 }
  assert.equal(hasMooring(allUnknown), false)

  const transientOnly = bareMarina()
  transientOnly.mooring = { hasMoorings: 'Unknown', transient: 8 }
  assert.equal(hasMooring(transientOnly), true)
})

test('hasNavigation counts a bridge height even when availability is Unknown', () => {
  assert.equal(hasNavigation(anchorageWithMooring()), true)
  assert.equal(hasNavigation(bareMarina()), false)

  const allUnknown = bareMarina()
  allUnknown.navigation = { current: 'Unknown', fixedBridge: 'Unknown', bridgeHeight: 0 }
  assert.equal(hasNavigation(allUnknown), false)

  const bridgeOnly = bareMarina()
  bridgeOnly.navigation = { current: 'Unknown', bridgeHeight: 13.5 }
  assert.equal(hasNavigation(bridgeOnly), true)
})

test('an Unknown capability renders no line, not a misleading cross', () => {
  const poi = bareMarina()
  poi.amenity = { wifi: 'Yes', shower: 'No', bar: 'Unknown' }
  const html = renderDescription(poi)

  assert.match(html, /✅ Wifi/, 'a Yes value renders a tick')
  assert.match(html, /❌ Showers/, 'a No value renders a cross')
  // An Unknown value must produce no line at all: not a cross, not the label.
  assert.doesNotMatch(html, /Bar/)
})

test('a Nearby-only section renders a content line, not an empty header', () => {
  const poi = bareMarina()
  poi.services = { haulOut: 'Nearby' }
  // hasServices treats Nearby as definite, so the section is shown.
  assert.equal(hasServices(poi), true)
  const html = renderDescription(poi)
  // The section must carry a content line, not just an <h4> header.
  assert.match(html, /Haul-out \(nearby\)/)
})

test('hasAmenities is true for an amenity section that carries only notes', () => {
  const notesOnly = bareMarina()
  notesOnly.amenity = { wifi: 'Unknown', notes: [{ field: 'Pool', value: 'Closed for season' }] }
  assert.equal(hasAmenities(notesOnly), true)
  assert.match(renderDescription(notesOnly), /Pool: Closed for season/)
})

test('hasDockage is true for a dockage section that carries only isFree', () => {
  const freeOnly = bareMarina()
  freeOnly.dockage = { isFree: true }
  assert.equal(hasDockage(freeOnly), true)
  assert.match(renderDescription(freeOnly), /Free docks/)
})

test('isStaleHazard flags an old Hazard, but not a recent one or a non-Hazard', () => {
  // A Hazard last confirmed over two years before `now` is stale.
  assert.equal(isStaleHazard(hazard(FOUR_YEARS_AGO), NOW), true)
  // A Hazard confirmed within the window is not.
  assert.equal(isStaleHazard(hazard(THREE_DAYS_AGO), NOW), false)
  // A stale date on a non-Hazard type never counts as a stale hazard.
  const oldMarina = bareMarina()
  oldMarina.pointOfInterest.dateLastModified = FOUR_YEARS_AGO.toISOString()
  assert.equal(isStaleHazard(oldMarina, NOW), false)
  // An unparseable date is treated as not stale rather than warning falsely.
  const undatedHazard = hazard(THREE_DAYS_AGO)
  undatedHazard.pointOfInterest.dateLastModified = 'not a date'
  assert.equal(isStaleHazard(undatedHazard, NOW), false)
})

test('renderDescription warns when a Hazard report has gone stale', () => {
  const html = renderDescription(hazard(FOUR_YEARS_AGO))

  assert.match(html, /Hazard report not recently confirmed/)
  assert.match(html, /Confirm locally before relying on it/)
  // The warning names how old the report is, reusing the relative-time helper.
  assert.match(html, /last updated .* ago/)
})

test('renderDescription does not warn for a recently confirmed Hazard', () => {
  const html = renderDescription(hazard(THREE_DAYS_AGO))

  assert.doesNotMatch(html, /Hazard report not recently confirmed/)
})

test('renderDescription does not warn for a stale non-Hazard point of interest', () => {
  const oldMarina = bareMarina()
  oldMarina.pointOfInterest.dateLastModified = FOUR_YEARS_AGO.toISOString()
  const html = renderDescription(oldMarina)

  assert.doesNotMatch(html, /Hazard report not recently confirmed/)
})
