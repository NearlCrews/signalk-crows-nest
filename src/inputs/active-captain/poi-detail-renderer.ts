/**
 * Handlebars rendering for the signalk-crows-nest plugin.
 *
 * Renders a point-of-interest detail response into the HTML snippet shown as a
 * SignalK resource description. The templates and partials live in
 * `./templates.js` as inlined string constants, so rendering never touches the
 * filesystem. The `has*` helpers use positive tests: a section counts as
 * populated only when a field carries a definite value, so an absent field is
 * never rendered as a misleading empty section.
 */

import Handlebars from 'handlebars'

import {
  AMENITIES_PARTIAL,
  BUSINESS_PARTIAL,
  CONTACT_PARTIAL,
  DOCKAGE_PARTIAL,
  FEATURED_REVIEW_PARTIAL,
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

import type { PoiDetails, PoiNote } from './active-captain-types.js'
import { formatRelativeDelta } from '../../shared/relative-time-format.js'

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
 * True when a numeric section field carries a positive value. The section
 * partials gate every numeric field line with a Handlebars `{{#if}}`, and
 * Handlebars treats 0 (like `undefined`) as falsy. So a zero count or a zero
 * measurement renders no line, and the predicate must agree: a numeric field
 * counts as present only when it is greater than zero, otherwise a POI whose
 * only data in a section is a zero value would show an empty section header.
 */
function isPositiveNumber (value: number | undefined): boolean {
  return typeof value === 'number' && value > 0
}

/**
 * Parse an ActiveCaptain timestamp. The API returns timestamps with no time
 * zone (for example "2025-08-11T18:51:51.442"), which JavaScript would read as
 * local time. ActiveCaptain serves them as UTC, so a zone-less value gets a
 * trailing 'Z' before parsing. The regex is strict on the time portion (two-
 * digit hour, minute, and second, with an optional fractional-second tail) so
 * a malformed wire value like `"2024-01-01T:::"` is not silently accepted as
 * zone-less and re-emitted with a `Z`.
 */
export function parseApiDate (value: unknown): Date {
  let text = String(value)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
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
const SECONDS_PER_SECOND = 1
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * 60
const SECONDS_PER_DAY = SECONDS_PER_HOUR * 24
const SECONDS_PER_MONTH = SECONDS_PER_DAY * 30
const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', SECONDS_PER_MONTH * 12],
  ['month', SECONDS_PER_MONTH],
  ['day', SECONDS_PER_DAY],
  ['hour', SECONDS_PER_HOUR],
  ['minute', SECONDS_PER_MINUTE],
  ['second', SECONDS_PER_SECOND]
]

const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** Splits a PascalCase boundary so "CellReception" humanizes to "Cell Reception". */
const HUMANIZE_PATTERN = /([a-z0-9])([A-Z])/g

/** Matches CR, LF, or CRLF so a multi-line note renders with `<br/>` breaks. */
const LINE_BREAK_PATTERN = /\r\n|\r|\n/g

/**
 * Format a date relative to `now`, e.g. "3 days ago" or "in 2 hours". An
 * invalid date yields a fallback string rather than throwing.
 */
export function fromNow (date: Date, now: Date = new Date()): string {
  if (!Number.isFinite(date.getTime())) {
    return 'an unknown time ago'
  }

  const deltaSeconds = Math.round((date.getTime() - now.getTime()) / 1000)
  return formatRelativeDelta(deltaSeconds, RELATIVE_UNITS, relativeTimeFormat)
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
    isPositiveNumber(mooring.transient) ||
    isPositiveNumber(mooring.total) ||
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
    isPositiveNumber(navigation.bridgeHeight) ||
    isPositiveNumber(navigation.tide) ||
    isPositiveNumber(navigation.depthApproach) ||
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
  const month = staleBefore.getMonth()
  staleBefore.setFullYear(staleBefore.getFullYear() - STALE_HAZARD_YEARS)
  // Feb 29 has no counterpart in a non-leap year, so `setFullYear` rolls it
  // forward to Mar 1. Clamp it back to Feb 28 so the 2-year cutoff stays exact.
  if (staleBefore.getMonth() !== month) {
    staleBefore.setDate(0)
  }
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
    String(value).replace(HUMANIZE_PATTERN, '$1 $2')
  )

  // Escapes text and converts its line breaks to <br/>, so a multi-line note
  // is not collapsed onto one line in the rendered HTML. An absent value
  // renders as empty rather than the literal string "undefined".
  env.registerHelper('multiline', (value: unknown): Handlebars.SafeString => {
    if (value === undefined || value === null) return new env.SafeString('')
    return new env.SafeString(env.escapeExpression(String(value)).replace(LINE_BREAK_PATTERN, '<br/>'))
  })

  // Returns the website URL if it parses as `http:`, `https:`, or `mailto:`,
  // otherwise the empty string. Handlebars escapes HTML metacharacters in
  // `{{value}}` interpolation but does not validate URL schemes, so a wire
  // value of `javascript:alert(1)` would survive auto-escape and ship as a
  // working click-to-execute link. This helper gates the only attacker-
  // controllable href on the popup.
  env.registerHelper('safeWebsite', (value: unknown): string => {
    if (typeof value !== 'string' || value.length === 0) return ''
    try {
      const parsed = new URL(value)
      const protocol = parsed.protocol.toLowerCase()
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
        return value
      }
      return ''
    } catch {
      return ''
    }
  })

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
 *
 * `trimEnd` strips trailing whitespace left over from absent section blocks:
 * the template separates section blocks with literal newlines so the source
 * stays readable, and Handlebars cannot strip those when the block tag shares
 * a line with the partial call. Trimming keeps a bare-header description from
 * shipping a tail of empty lines.
 */
export function renderDescription (details: PoiDetails): string {
  return renderPointOfInterest({ data: details }).trimEnd()
}
