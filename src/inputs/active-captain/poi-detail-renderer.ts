/**
 * Handlebars rendering for the signalk-crows-nest plugin.
 *
 * This module renders a point-of-interest detail response into the HTML
 * snippet shown as a SignalK resource description. The templates and partials
 * live in `./templates.js` as inlined string constants, so rendering never
 * reads from the filesystem.
 *
 * Differences from the original `plugin/handlebars_utilities.js`:
 *  - Templates are inlined (see `templates.ts`), removing the fragile
 *    hardcoded `./node_modules/...` path.
 *  - `moment` is replaced by a small `Intl.RelativeTimeFormat` helper.
 *  - `helpers-for-handlebars` is replaced by the small inline helpers
 *    registered below; the templates need no third-party helper library.
 *  - The `has*` checks use positive tests: a section counts as populated
 *    only when a field carries a definite value. The original used
 *    `field !== 'Unknown'`, which treated an absent field as populated.
 */

import Handlebars from 'handlebars'

import {
  AMENITIES_PARTIAL,
  BUSINESS_PARTIAL,
  CONTACT_PARTIAL,
  DOCKAGE_PARTIAL,
  FEATURED_REVIEW_PARTIAL,
  FOOTER_PARTIAL,
  FUEL_PARTIAL,
  HEADER_PARTIAL,
  MOORING_PARTIAL,
  NAVIGATION_PARTIAL,
  NOTES_PARTIAL,
  POINT_OF_INTEREST_TEMPLATE,
  RETAIL_PARTIAL,
  REVIEW_PARTIAL,
  SERVICES_PARTIAL
} from './templates.js'

import type { PoiDetails, PoiNote } from '../../shared/types.js'

/** The root context handed to the point-of-interest template. */
interface TemplateRoot {
  data: PoiDetails
}

/**
 * True when an availability field carries a definite value. An absent field
 * (`undefined`), `'Unknown'`, or a non-availability value does not count as
 * populated.
 */
function isDefinite (value: unknown): boolean {
  return value === 'Yes' || value === 'No' || value === 'Nearby'
}

/**
 * True when any field of a summary section carries a definite availability
 * value. Non-availability fields (ids, dates, units, notes arrays) never match
 * `isDefinite`, so passing a whole section object is safe.
 */
function hasDefiniteAvailability (section: object | undefined): boolean {
  return section !== undefined && Object.values(section).some(isDefinite)
}

/** True when a contact string field holds a non-empty value. */
function hasText (value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0
}

/** True when a notes array is present and non-empty. */
function hasNotes (notes: PoiNote[] | undefined): boolean {
  return (notes?.length ?? 0) > 0
}

/** True for a string value that is present and not the API's 'Unknown'. */
function isKnown (value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0 && value !== 'Unknown'
}

/**
 * Parse an ActiveCaptain timestamp. The API returns timestamps with no time
 * zone (for example "2025-08-11T18:51:51.442"), which JavaScript would read as
 * local time. ActiveCaptain serves them as UTC, so a zone-less value gets a
 * trailing 'Z' before parsing.
 */
export function parseApiDate (value: unknown): Date {
  let text = String(value)
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(text)) {
    text += 'Z'
  }
  return new Date(text)
}

/**
 * Seconds in each relative-time unit, ordered largest first. Used to pick the
 * coarsest unit that fits a given delta. A month is treated as 30 days and a
 * year as 12 of those months, so the two thresholds stay consistent: a delta
 * just under a year never rounds to "12 months".
 */
const SECONDS_PER_MONTH = 2592000
const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', SECONDS_PER_MONTH * 12],
  ['month', SECONDS_PER_MONTH],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1]
]

const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/**
 * Format a date relative to `now`, e.g. "3 days ago" or "in 2 hours". This is
 * the native replacement for the single `moment(date).fromNow()` call the
 * original code relied on. An invalid date yields a fallback string rather
 * than throwing, matching moment's "Invalid date" behavior.
 */
export function fromNow (date: Date, now: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) {
    return 'an unknown time ago'
  }

  const deltaSeconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const absSeconds = Math.abs(deltaSeconds)

  // Pick the coarsest unit the delta reaches; 'second' (the last entry) is the
  // floor for a sub-second delta.
  let index = RELATIVE_UNITS.length - 1
  for (let i = 0; i < RELATIVE_UNITS.length; i++) {
    if (absSeconds >= RELATIVE_UNITS[i][1]) {
      index = i
      break
    }
  }

  // Rounding within the chosen unit can spill into the next unit up: 3599 s is
  // under an hour but rounds to 60 minutes. When the rounded count reaches the
  // larger unit, step up so it reads "1 hour" rather than "60 minutes".
  while (index > 0 &&
    Math.round(absSeconds / RELATIVE_UNITS[index][1]) * RELATIVE_UNITS[index][1] >= RELATIVE_UNITS[index - 1][1]) {
    index -= 1
  }

  const [unit, secondsPerUnit] = RELATIVE_UNITS[index]
  return relativeTimeFormat.format(Math.round(deltaSeconds / secondsPerUnit), unit)
}

/** True when the fuel section is present and carries at least one definite value. */
export function hasFuel (details: PoiDetails): boolean {
  return hasDefiniteAvailability(details.fuel) || hasNotes(details.fuel?.notes)
}

/** True when the dockage section is present and carries usable detail. */
export function hasDockage (details: PoiDetails): boolean {
  const dockage = details.dockage
  if (dockage === undefined) {
    return false
  }

  // `isFree` alone is worth showing: the dockage partial always renders a
  // "Free docks" / "Paid docks" line.
  return hasDefiniteAvailability(dockage) ||
    hasNotes(dockage.notes) ||
    dockage.isFree !== undefined
}

/** True when the contact section is present and carries at least one populated field. */
export function hasContact (details: PoiDetails): boolean {
  const contact = details.contact
  if (contact === undefined) {
    return false
  }

  return hasText(contact.vhfChannel) ||
    hasText(contact.phone) ||
    hasText(contact.afterHourContact) ||
    hasText(contact.email) ||
    hasText(contact.website)
}

/** True when the amenity section is present and carries at least one definite value. */
export function hasAmenities (details: PoiDetails): boolean {
  return hasDefiniteAvailability(details.amenity) || hasNotes(details.amenity?.notes)
}

/** True when the business section is present and carries at least one definite value. */
export function hasBusiness (details: PoiDetails): boolean {
  return hasDefiniteAvailability(details.business) || hasNotes(details.business?.notes)
}

/** True when the services section is present and carries at least one definite value. */
export function hasServices (details: PoiDetails): boolean {
  return hasDefiniteAvailability(details.services) || hasNotes(details.services?.notes)
}

/** True when the retail section is present and carries at least one definite value. */
export function hasRetail (details: PoiDetails): boolean {
  return hasDefiniteAvailability(details.retail) || hasNotes(details.retail?.notes)
}

/** True when the mooring section is present and carries usable detail. */
export function hasMooring (details: PoiDetails): boolean {
  const mooring = details.mooring
  if (mooring === undefined) {
    return false
  }

  return hasDefiniteAvailability(mooring) ||
    (mooring.transient ?? 0) > 0 ||
    (mooring.total ?? 0) > 0 ||
    hasNotes(mooring.notes)
}

/** True when the navigation section is present and carries usable detail. */
export function hasNavigation (details: PoiDetails): boolean {
  const navigation = details.navigation
  if (navigation === undefined) {
    return false
  }

  return hasDefiniteAvailability(navigation) ||
    isKnown(navigation.current) ||
    (navigation.bridgeHeight ?? 0) > 0 ||
    (navigation.tide ?? 0) > 0 ||
    (navigation.depthApproach ?? 0) > 0 ||
    hasNotes(navigation.notes)
}

/**
 * A Hazard report is treated as stale once its `dateLastModified` is more than
 * this many years in the past. A stale hazard report is a safety signal: the
 * crew should be told the entry may no longer reflect conditions on the water.
 */
const STALE_HAZARD_YEARS = 2

/**
 * True when `details` is a Hazard whose last-modified date is more than
 * `STALE_HAZARD_YEARS` years before `now`. Non-hazard points of interest, and
 * hazards modified more recently, are never stale. An unparseable date is
 * treated as not stale rather than raising a false warning.
 */
export function isStaleHazard (details: PoiDetails, now: Date = new Date()): boolean {
  if (details.pointOfInterest.poiType !== 'Hazard') {
    return false
  }

  const modified = parseApiDate(details.pointOfInterest.dateLastModified)
  if (!Number.isFinite(modified.getTime())) {
    return false
  }

  const staleBefore = new Date(now)
  staleBefore.setFullYear(staleBefore.getFullYear() - STALE_HAZARD_YEARS)
  return modified.getTime() < staleBefore.getTime()
}

/**
 * Build an isolated Handlebars environment with the plugin's partials and
 * helpers registered. Using `create()` avoids mutating the global Handlebars
 * instance that other code might share.
 */
function buildEnvironment (): typeof Handlebars {
  const env = Handlebars.create()

  env.registerPartial({
    header: HEADER_PARTIAL,
    footer: FOOTER_PARTIAL,
    business: BUSINESS_PARTIAL,
    dockage: DOCKAGE_PARTIAL,
    fuel: FUEL_PARTIAL,
    amenities: AMENITIES_PARTIAL,
    services: SERVICES_PARTIAL,
    retail: RETAIL_PARTIAL,
    mooring: MOORING_PARTIAL,
    navigation: NAVIGATION_PARTIAL,
    contact: CONTACT_PARTIAL,
    review: REVIEW_PARTIAL,
    featuredReview: FEATURED_REVIEW_PARTIAL,
    notes: NOTES_PARTIAL
  })

  env.registerHelper('fromNow', (value: unknown): string => fromNow(parseApiDate(value)))

  // Renders a ticked or crossed line for a definite availability value, and
  // nothing for an absent or Unknown one. This keeps sections with many
  // capability fields (such as services) free of a wall of crosses.
  env.registerHelper('availabilityLine', (value: unknown, label: unknown): Handlebars.SafeString | string => {
    const text = env.escapeExpression(String(label))
    if (value === 'Yes') return new env.SafeString(`\u{2705} ${text}<br/>`)
    if (value === 'No') return new env.SafeString(`\u{274C} ${text}<br/>`)
    // 'Nearby' is a definite value (isDefinite counts it), so it must render a
    // line: otherwise a section whose only values are 'Nearby' shows an empty
    // header.
    if (value === 'Nearby') return new env.SafeString(`\u{1F4CD} ${text} (nearby)<br/>`)
    return ''
  })

  // Renders "label: value" for a known value, and nothing for an absent or
  // 'Unknown' one. Used for descriptive (non-tri-state) fields.
  env.registerHelper('knownLine', (label: unknown, value: unknown): Handlebars.SafeString | string => {
    if (typeof value !== 'string' || value.length === 0 || value === 'Unknown') {
      return ''
    }
    return new env.SafeString(
      `${env.escapeExpression(String(label))}: ${env.escapeExpression(value)}<br/>`
    )
  })

  // Turns a PascalCase API field id (such as "CellReception") into spaced
  // words ("Cell Reception") for display.
  env.registerHelper('humanize', (value: unknown): string =>
    String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  )

  // Escapes text and converts its line breaks to <br/>, so a multi-line note
  // is not collapsed onto one line in the rendered HTML.
  env.registerHelper('multiline', (value: unknown): Handlebars.SafeString =>
    new env.SafeString(env.escapeExpression(String(value)).replace(/\r\n|\r|\n/g, '<br/>'))
  )

  // Renders a "Free" or "Paid" line for a known boolean, and nothing when the
  // value is absent, so an unknown price is not asserted as "Paid".
  env.registerHelper('freeLine', (isFree: unknown, noun: unknown): Handlebars.SafeString | string => {
    if (typeof isFree !== 'boolean') {
      return ''
    }
    const word = isFree ? 'Free' : 'Paid'
    return new env.SafeString(`\u{1F4B0} ${word} ${env.escapeExpression(String(noun))}<br/>`)
  })

  // Each section helper is a block helper that renders its body only when the
  // matching section carries data.
  const sectionHelpers: ReadonlyArray<readonly [string, (details: PoiDetails) => boolean]> = [
    ['hasFuel', hasFuel],
    ['hasDockage', hasDockage],
    ['hasContact', hasContact],
    ['hasAmenities', hasAmenities],
    ['hasBusiness', hasBusiness],
    ['hasServices', hasServices],
    ['hasRetail', hasRetail],
    ['hasMooring', hasMooring],
    ['hasNavigation', hasNavigation]
  ]
  for (const [name, predicate] of sectionHelpers) {
    env.registerHelper(name, function (this: TemplateRoot, options: Handlebars.HelperOptions) {
      return predicate(this.data) ? options.fn(this) : options.inverse(this)
    })
  }

  // Block helper that renders its body only for a Hazard whose report has gone
  // stale, so the header can carry a freshness warning the crew must see.
  env.registerHelper('staleHazard', function (this: TemplateRoot, options: Handlebars.HelperOptions) {
    return isStaleHazard(this.data) ? options.fn(this) : options.inverse(this)
  })

  return env
}

// Helpers, partials, and the compiled template are built once at module load.
const handlebarsEnvironment = buildEnvironment()
const renderPointOfInterest = handlebarsEnvironment.compile(POINT_OF_INTEREST_TEMPLATE)

/**
 * Render the HTML description for a point of interest. Every `PoiType` shares
 * the single point-of-interest template; the `poiType` selects which sections
 * carry data rather than which template is used.
 */
export function renderDescription (details: PoiDetails): string {
  return renderPointOfInterest({ data: details })
}
