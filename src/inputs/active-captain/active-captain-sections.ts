/**
 * Normalized-section builder for an ActiveCaptain point of interest.
 *
 * Turns the structured {@link PoiDetails} into the source-agnostic
 * {@link NormalizedSection}[] a structured chart plotter renders, carried on the
 * note's `properties.crowsNest.sections` alongside the HTML description.
 *
 * It mirrors the content of `poi-detail-renderer.ts`'s Handlebars output
 * section by section (review, fuel, dockage, mooring, amenities, business,
 * services, retail, navigation, contact, the featured review, and the
 * POI-level notes), emitting structured items rather than markup. Each section
 * reuses the same `has*` predicate and the same per-field guards the partials
 * use, so the structured payload and the HTML stay in lockstep: an availability
 * line shows only for a definite Yes / No / Nearby value, a free/paid flag only
 * for a known boolean, a current strength only when not 'Unknown', and a
 * numeric measurement or count only when positive. A measurement keeps its
 * value even when the unit is absent (a go/no-go depth or clearance must not be
 * dropped over a missing unit), matching the HTML. A section with zero items is
 * omitted so a marina with no fuel data shows no empty "Fuel" heading.
 *
 * The review summary and featured review are emitted only for POI types that
 * carry reviews (marinas, anchorages, businesses, and boat ramps), shared with
 * the HTML renderer through `poiTypeShowsReviews`, so a hazard or navigational
 * feature never gets a star rating. The free-text notes are always kept,
 * regardless of type, since that is where on-the-water intel lives.
 */

import type {
  Availability,
  PoiDetails,
  PoiNote
} from './active-captain-types.js'
import { noteFieldLabel, poiTypeShowsReviews } from './poi-detail-renderer.js'
import { pushSection } from '../../shared/normalized-detail.js'
import type { NormalizedItem, NormalizedSection } from '../../shared/normalized-detail.js'

/**
 * Push an availability item for a definite Yes / No / Nearby value, mirroring
 * the `availabilityLine` helper: an absent field or the API's 'Unknown' emits
 * nothing.
 */
function pushAvailability (items: NormalizedItem[], label: string, value: Availability | undefined): void {
  if (value === 'Yes' || value === 'No' || value === 'Nearby') {
    items.push({ label, value, kind: 'availability' })
  }
}

/**
 * Push a count item for a positive whole-number tally, mirroring the partials'
 * `{{#if}}` guard: Handlebars treats 0 and `undefined` as falsy, so a zero or
 * absent count renders no line.
 */
function pushCount (items: NormalizedItem[], label: string, value: number | undefined): void {
  if (typeof value === 'number' && value > 0) {
    items.push({ label, value, kind: 'count' })
  }
}

/**
 * Push a measure item for a positive numeric measurement, mirroring the
 * partials' `{{#if}}` guard. An absent or zero value emits nothing. A missing
 * unit does NOT drop the value: a depth, clearance, or length is a go/no-go
 * fact, and a missing measurement and a unitless one are very different to a
 * skipper, so the value is emitted unitless when the unit is absent (matching
 * the HTML, which renders the value with an empty `{{distanceUnit}}`).
 */
function pushMeasure (items: NormalizedItem[], label: string, value: number | undefined, unit: string | undefined): void {
  if (typeof value !== 'number' || value <= 0) {
    return
  }
  const hasUnit = typeof unit === 'string' && unit.length > 0
  items.push({ label, value, kind: 'measure', ...(hasUnit && { unit }) })
}

/**
 * Push a free/paid flag for a known boolean, mirroring the `freeLine` helper:
 * an absent value emits nothing so an unknown price is not asserted as "Paid".
 */
function pushFreeFlag (items: NormalizedItem[], label: string, isFree: boolean | undefined): void {
  if (typeof isFree === 'boolean') {
    items.push({ label, value: isFree, kind: 'flag' })
  }
}

/**
 * Push a text item for a non-empty string, mirroring the contact partial's
 * `{{#if}}` guards. An absent or empty value emits nothing.
 */
function pushText (items: NormalizedItem[], label: string, value: string | undefined, kind: NormalizedItem['kind'] = 'text'): void {
  if (typeof value === 'string' && value.length > 0) {
    items.push({ label, value, kind })
  }
}

/**
 * Append each free-form note as a `note` item, mirroring the shared notes
 * partial: the field id is humanized for the label, and the value keeps its
 * line breaks (a structured client wraps the prose itself).
 */
function pushNotes (items: NormalizedItem[], notes: PoiNote[] | undefined): void {
  for (const note of notes ?? []) {
    items.push({ label: noteFieldLabel(note.field), value: note.value, kind: 'note' })
  }
}

/** Build the normalized detail sections for an ActiveCaptain point of interest. */
export function buildActiveCaptainSections (entity: PoiDetails): NormalizedSection[] {
  const sections: NormalizedSection[] = []

  // Header content. The HTML header renders the review summary, the featured
  // review, and the POI-level notes; each becomes its own structured section.

  // Review chrome (the aggregate rating and the featured review) is a marina and
  // business signal. A hazard, navigational mark, bridge, lock, or similar
  // feature gets none of it: a star rating on a rock is nonsense. The notes
  // below are always kept, since that is where on-the-water intel lives.
  if (poiTypeShowsReviews(entity.pointOfInterest.poiType)) {
    // Review summary: rendered only when the POI carries at least one review.
    const review: NormalizedItem[] = []
    if (typeof entity.reviewSummary?.numberOfReviews === 'number' && entity.reviewSummary.numberOfReviews > 0) {
      review.push({ label: 'Average rating', value: entity.reviewSummary.averageRating, kind: 'rating' })
      review.push({ label: 'Reviews', value: entity.reviewSummary.numberOfReviews, kind: 'count' })
    }
    pushSection(sections, 'review', 'Reviews', review)

    // Featured review: rendered only when the highlighted review carries prose.
    // The review title is content, so it rides under a stable "Title" label
    // rather than in the label slot. The review's own rating is not repeated
    // here: it duplicates the aggregate rating in the review section above.
    const featured = entity.featuredReview
    if (featured !== undefined && typeof featured.text === 'string' && featured.text.length > 0) {
      const featuredItems: NormalizedItem[] = []
      pushText(featuredItems, 'Title', featured.title)
      featuredItems.push({ label: 'Review', value: featured.text, kind: 'note' })
      pushText(featuredItems, 'Reviewed by', featured.createdBy)
      pushSection(sections, 'featuredReview', 'Featured review', featuredItems)
    }
  }

  // POI-level notes.
  const notes: NormalizedItem[] = []
  pushNotes(notes, entity.pointOfInterest.notes)
  pushSection(sections, 'notes', 'Notes', notes)

  // Capability and detail sections, in the template's render order: dockage,
  // mooring, contact, fuel, amenities, services, retail, navigation, business.
  // Each section also carries its own section-level notes.

  const dockage = entity.dockage
  if (dockage !== undefined) {
    const items: NormalizedItem[] = []
    pushFreeFlag(items, 'Docks', dockage.isFree)
    pushCount(items, 'Berths in total', dockage.total)
    pushCount(items, 'Berths for visiting vessels', dockage.transient)
    pushMeasure(items, 'Maximum LOA', dockage.loaMax, dockage.distanceUnit)
    pushMeasure(items, 'Maximum beam', dockage.beamMax, dockage.distanceUnit)
    pushAvailability(items, 'Liveaboard', dockage.liveaboard)
    pushAvailability(items, 'Secure access', dockage.secureAccess)
    pushAvailability(items, 'Security patrol', dockage.securityPatrol)
    pushNotes(items, dockage.notes)
    pushSection(sections, 'dockage', 'Dockage', items)
  }

  const mooring = entity.mooring
  if (mooring !== undefined) {
    const items: NormalizedItem[] = []
    pushFreeFlag(items, 'Moorings', mooring.isFree)
    pushAvailability(items, 'Moorings available', mooring.hasMoorings)
    pushAvailability(items, 'Dinghy dock', mooring.dinghy)
    pushAvailability(items, 'Launch service', mooring.launch)
    pushAvailability(items, 'Liveaboard', mooring.liveaboard)
    pushCount(items, 'Moorings in total', mooring.total)
    pushCount(items, 'Transient moorings', mooring.transient)
    pushNotes(items, mooring.notes)
    pushSection(sections, 'mooring', 'Mooring', items)
  }

  const contact = entity.contact
  if (contact !== undefined) {
    const items: NormalizedItem[] = []
    pushText(items, 'VHF', contact.vhfChannel)
    pushText(items, 'Phone', contact.phone)
    pushText(items, 'After hours', contact.afterHourContact)
    pushText(items, 'Email', contact.email, 'link')
    pushText(items, 'Website', contact.website, 'link')
    pushSection(sections, 'contact', 'Contact', items)
  }

  const fuel = entity.fuel
  if (fuel !== undefined) {
    const items: NormalizedItem[] = []
    pushAvailability(items, 'Diesel', fuel.diesel)
    pushAvailability(items, 'Ethanol free', fuel.ethanolFree)
    pushAvailability(items, 'Unleaded', fuel.gas)
    pushAvailability(items, 'Propane', fuel.propane)
    pushAvailability(items, 'Electric charging', fuel.electric)
    pushMeasure(items, 'Fuel dock depth', fuel.depthFuel, fuel.distanceUnit)
    pushNotes(items, fuel.notes)
    pushSection(sections, 'fuel', 'Fuel', items)
  }

  const amenity = entity.amenity
  if (amenity !== undefined) {
    const items: NormalizedItem[] = []
    pushAvailability(items, 'Bar', amenity.bar)
    pushAvailability(items, 'Cell reception', amenity.cellReception)
    pushAvailability(items, 'Boat ramp', amenity.boatRamp)
    pushAvailability(items, 'Laundry', amenity.laundry)
    pushAvailability(items, 'Courtesy car', amenity.courtesyCar)
    pushAvailability(items, 'Pets allowed', amenity.pets)
    pushAvailability(items, 'Lodging', amenity.lodging)
    pushAvailability(items, 'Restrooms', amenity.restroom)
    pushAvailability(items, 'Restaurant', amenity.restaurant)
    pushAvailability(items, 'Transportation', amenity.transportation)
    pushAvailability(items, 'Showers', amenity.shower)
    pushAvailability(items, 'Water', amenity.water)
    pushAvailability(items, 'Rubbish disposal', amenity.trash)
    pushAvailability(items, 'Wi-Fi', amenity.wifi)
    pushNotes(items, amenity.notes)
    pushSection(sections, 'amenities', 'Amenities', items)
  }

  const services = entity.services
  if (services !== undefined) {
    const items: NormalizedItem[] = []
    pushAvailability(items, 'Haul-out', services.haulOut)
    pushAvailability(items, 'Pump-out', services.pumpOut)
    pushAvailability(items, 'General repair', services.repair)
    pushAvailability(items, 'Mechanical repair', services.mechanical)
    pushAvailability(items, 'Diesel engine repair', services.repairDieselEngines)
    pushAvailability(items, 'Gas engine repair', services.repairGasEngines)
    pushAvailability(items, 'Electronics', services.electronics)
    pushAvailability(items, 'Sails and rigging', services.sailsAndRigging)
    pushAvailability(items, 'Fiberglass', services.fiberglass)
    pushAvailability(items, 'Welding', services.welding)
    pushAvailability(items, 'Propeller repair', services.propellerRepair)
    pushAvailability(items, 'Canvas and upholstery', services.canvasAndUpholstery)
    pushAvailability(items, 'Painting', services.paint)
    pushAvailability(items, 'Bottom painting', services.bottomPainting)
    pushAvailability(items, 'Wash and wax', services.washAndWax)
    pushAvailability(items, 'Marine HVAC', services.marineHvac)
    pushAvailability(items, 'Plumbing', services.plumbing)
    pushAvailability(items, 'Carpentry', services.carpentry)
    pushAvailability(items, 'Storage', services.storage)
    pushAvailability(items, 'Charter', services.charter)
    pushAvailability(items, 'Boat brokers', services.boatBrokers)
    pushAvailability(items, 'Surveyors', services.surveyors)
    pushAvailability(items, 'Towing', services.towing)
    pushAvailability(items, 'Rescue and salvage', services.rescueAndSalvage)
    pushAvailability(items, 'Water taxi', services.waterTaxi)
    pushNotes(items, services.notes)
    pushSection(sections, 'services', 'Services', items)
  }

  const retail = entity.retail
  if (retail !== undefined) {
    const items: NormalizedItem[] = []
    pushAvailability(items, 'Grocery', retail.grocery)
    pushAvailability(items, 'Ice', retail.ice)
    pushAvailability(items, 'Fishing supplies', retail.fishingSupplies)
    pushAvailability(items, 'Marine supplies', retail.marineRetail)
    pushAvailability(items, 'Hardware', retail.hardware)
    pushNotes(items, retail.notes)
    pushSection(sections, 'retail', 'Retail', items)
  }

  const navigation = entity.navigation
  if (navigation !== undefined) {
    const items: NormalizedItem[] = []
    if (typeof navigation.current === 'string' && navigation.current.length > 0 && navigation.current !== 'Unknown') {
      items.push({ label: 'Current', value: navigation.current, kind: 'text' })
    }
    pushAvailability(items, 'Fixed bridge', navigation.fixedBridge)
    pushMeasure(items, 'Bridge clearance', navigation.bridgeHeight, navigation.distanceUnit)
    pushMeasure(items, 'Tidal range', navigation.tide, navigation.distanceUnit)
    pushMeasure(items, 'Approach depth', navigation.depthApproach, navigation.distanceUnit)
    pushNotes(items, navigation.notes)
    pushSection(sections, 'navigation', 'Navigation', items)
  }

  const business = entity.business
  if (business !== undefined) {
    const items: NormalizedItem[] = []
    pushAvailability(items, 'Seasonal', business.seasonal)
    pushAvailability(items, 'Open to public', business.public)
    pushAvailability(items, 'Cash accepted', business.cash)
    pushAvailability(items, 'Cheques accepted', business.check)
    pushAvailability(items, 'Cards accepted', business.credit)
    pushNotes(items, business.notes)
    pushSection(sections, 'business', 'Business', items)
  }

  return sections
}
