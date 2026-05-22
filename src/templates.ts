/*
 * MIT License
 *
 * Copyright (c) 2024 Paul Willems <paul.willems@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * Handlebars template and partial sources for the
 * signalk-activecaptain-resources plugin.
 *
 * These were previously loaded at runtime from `.hbs` and `.hbsp` files via a
 * hardcoded `./node_modules/signalk-activecaptain-resources/plugin/...` path.
 * That path broke whenever the working directory or the install location
 * differed from the assumed layout. The sources are now inlined here as plain
 * string constants so rendering never touches the filesystem.
 *
 * Every capability section renders its tri-state fields through the
 * `availabilityLine` helper, which emits a line only for a definite Yes, No,
 * or Nearby value. An `'Unknown'` field is skipped rather than shown as a
 * misleading red cross.
 */

/** Root template used for every point-of-interest type. */
export const POINT_OF_INTEREST_TEMPLATE = `{{> header}}
{{#hasDockage}}{{> dockage data.dockage}}{{/hasDockage}}
{{#hasMooring}}{{> mooring data.mooring}}{{/hasMooring}}
{{#hasContact}}{{> contact data.contact}}{{/hasContact}}
{{#hasFuel}}{{> fuel data.fuel}}{{/hasFuel}}
{{#hasAmenities}}{{> amenities data.amenity}}{{/hasAmenities}}
{{#hasServices}}{{> services data.services}}{{/hasServices}}
{{#hasRetail}}{{> retail data.retail}}{{/hasRetail}}
{{#hasNavigation}}{{> navigation data.navigation}}{{/hasNavigation}}
{{#hasBusiness}}{{> business data.business}}{{/hasBusiness}}
{{> footer data.pointOfInterest}}`

/**
 * Shared free-form notes block. The context is the notes array itself, so each
 * section partial invokes it as `{{> notes notes}}`. An absent or empty array
 * renders nothing. The field id is humanised and the value keeps its line
 * breaks.
 */
export const NOTES_PARTIAL = `{{#if this}}
<div>
{{#each this}}
    <p>{{humanize this.field}}: {{multiline this.value}}</p>
{{/each}}
</div>
{{/if}}`

/** Header partial: last-updated line, free-form notes, the review summary, and a featured review. */
export const HEADER_PARTIAL = `<hr/>
<sup>last updated {{fromNow data.pointOfInterest.dateLastModified}}</sup><br/>

{{> notes data.pointOfInterest.notes}}

{{#if data.reviewSummary}}{{> review data.reviewSummary id=data.pointOfInterest.id}}{{/if}}
{{#if data.featuredReview.text}}{{> featuredReview data.featuredReview}}{{/if}}`

/** Footer partial: data attribution and the contribute link. */
export const FOOTER_PARTIAL = `<hr/>
<sup>Data sourced from <a href="https://activecaptain.garmin.com/">Garmin Active Captain</a> via the <a href="https://github.com/KvotheBloodless/signalk-activecaptain-resources/">signalk-activecaptain-resources plugin</a>.</sup><br/>
<sub>Something missing or room for improvement?</sub><br/>
<sup>You are encouraged to <a href="https://activecaptain.garmin.com/en-US/pois/{{id}}">contribute</a>.</sup><br/>`

/** Business partial: payment and opening details for business points. */
export const BUSINESS_PARTIAL = `<hr/>
<div>
    <h4>\u{1F4B5} Business</h4>
    {{availabilityLine seasonal "Seasonal"}}
    {{availabilityLine public "Open to public"}}
    {{availabilityLine cash "Cash accepted"}}
    {{availabilityLine check "Cheques accepted"}}
    {{availabilityLine credit "Cards accepted"}}
</div>
{{> notes notes}}`

/** Dockage partial: berth pricing, capacity, and access details. */
export const DOCKAGE_PARTIAL = `<hr/>
<div>
    <h4>\u{1F17F}\u{FE0F} Dockage</h4>
    {{freeLine isFree "docks"}}
    {{#if total}}\u{1F6E5}\u{FE0F} {{total}} berths in total<br/>{{/if}}
    {{#if transient}}\u{1F6E5}\u{FE0F} {{transient}} berths for visiting vessels<br/>{{/if}}
    {{availabilityLine liveaboard "Liveaboard"}}
    {{availabilityLine secureAccess "Secure access"}}
    {{availabilityLine securityPatrol "Patrolled"}}
</div>
{{> notes notes}}`

/** Fuel partial: fuel types available at the point. */
export const FUEL_PARTIAL = `<hr/>
<div>
    <h4>\u{26FD} Fuel</h4>
    {{availabilityLine diesel "Diesel"}}
    {{availabilityLine ethanolFree "Ethanol free"}}
    {{availabilityLine gas "Unleaded"}}
    {{availabilityLine propane "Propane"}}
    {{availabilityLine electric "Electric charging"}}
</div>
{{> notes notes}}`

/** Amenities partial: shoreside facilities. */
export const AMENITIES_PARTIAL = `<hr/>
<div>
    <h4>\u{1F3E8} Amenities</h4>
    {{availabilityLine bar "Bar"}}
    {{availabilityLine cellReception "Cell reception"}}
    {{availabilityLine boatRamp "Boat ramp"}}
    {{availabilityLine laundry "Laundry"}}
    {{availabilityLine courtesyCar "Courtesy car"}}
    {{availabilityLine pets "Pets allowed"}}
    {{availabilityLine lodging "Lodging"}}
    {{availabilityLine restroom "Restrooms"}}
    {{availabilityLine restaurant "Restaurant"}}
    {{availabilityLine transportation "Transportation"}}
    {{availabilityLine shower "Showers"}}
    {{availabilityLine water "Water"}}
    {{availabilityLine trash "Rubbish disposal"}}
    {{availabilityLine wifi "Wifi"}}
</div>
{{> notes notes}}`

/** Contact partial: VHF, phone, email, and website details. */
export const CONTACT_PARTIAL = `<hr/>
<div>
    <h4>\u{1F4DE} Contact</h4>
    {{#if vhfChannel}}\u{1F4DF} VHF {{vhfChannel}}<br/>{{/if}}
    {{#if phone}}\u{260E}\u{FE0F} <a href="tel:{{phone}}">{{phone}}</a><br/>{{/if}}
    {{#if afterHourContact}}\u{1F319} {{afterHourContact}}<br/>{{/if}}
    {{#if email}}\u{1F4E7} <a href="mailto:{{email}}">{{email}}</a><br/>{{/if}}
    {{#if website}}\u{1F310} <a href="{{website}}">{{website}}</a><br/>{{/if}}
</div>`

/** Review partial: aggregate rating and a link to the reviews page. */
export const REVIEW_PARTIAL = '{{averageRating}}/5 \u{2B50} from <a href="https://activecaptain.garmin.com/en-US/pois/{{id}}/Reviews">({{numberOfReviews}} reviews)</a>'

/** Featured-review partial: one highlighted user review. Context is the review itself. */
export const FEATURED_REVIEW_PARTIAL = `<div>
    <sup>\u{1F4DD} \u{201C}{{title}}\u{201D} ({{rating}}/5 \u{2B50})</sup><br/>
    <em>{{multiline text}}</em><br/>
    <sub>reviewed by {{createdBy}}</sub>
</div>`

/**
 * Mooring partial: mooring-field details, present mainly on anchorages. The
 * `availabilityLine` helper renders a line only for fields with a definite
 * value, so Unknown fields are skipped rather than shown as a cross.
 */
export const MOORING_PARTIAL = `<hr/>
<div>
    <h4>\u{2693} Mooring</h4>
    {{freeLine isFree "moorings"}}
    {{availabilityLine hasMoorings "Moorings available"}}
    {{availabilityLine dinghy "Dinghy dock"}}
    {{availabilityLine launch "Launch service"}}
    {{availabilityLine liveaboard "Liveaboard"}}
    {{#if total}}\u{1F6DF} {{total}} moorings in total<br/>{{/if}}
    {{#if transient}}\u{1F6DF} {{transient}} transient moorings<br/>{{/if}}
</div>
{{> notes notes}}`

/** Services partial: repair and marine-service trades, present mainly on marinas. */
export const SERVICES_PARTIAL = `<hr/>
<div>
    <h4>\u{1F527} Services</h4>
    {{availabilityLine haulOut "Haul-out"}}
    {{availabilityLine pumpOut "Pump-out"}}
    {{availabilityLine repair "General repair"}}
    {{availabilityLine mechanical "Mechanical repair"}}
    {{availabilityLine repairDieselEngines "Diesel engine repair"}}
    {{availabilityLine repairGasEngines "Petrol engine repair"}}
    {{availabilityLine electronics "Electronics"}}
    {{availabilityLine sailsAndRigging "Sails and rigging"}}
    {{availabilityLine fiberglass "Fibreglass"}}
    {{availabilityLine welding "Welding"}}
    {{availabilityLine propellerRepair "Propeller repair"}}
    {{availabilityLine canvasAndUpholstery "Canvas and upholstery"}}
    {{availabilityLine paint "Painting"}}
    {{availabilityLine bottomPainting "Bottom painting"}}
    {{availabilityLine washAndWax "Wash and wax"}}
    {{availabilityLine marineHvac "Marine HVAC"}}
    {{availabilityLine plumbing "Plumbing"}}
    {{availabilityLine carpentry "Carpentry"}}
    {{availabilityLine storage "Storage"}}
    {{availabilityLine charter "Charter"}}
    {{availabilityLine boatBrokers "Boat brokers"}}
    {{availabilityLine surveyors "Surveyors"}}
    {{availabilityLine towing "Towing"}}
    {{availabilityLine rescueAndSalvage "Rescue and salvage"}}
    {{availabilityLine waterTaxi "Water taxi"}}
</div>
{{> notes notes}}`

/** Retail partial: shops and supplies, present on marinas and some anchorages. */
export const RETAIL_PARTIAL = `<hr/>
<div>
    <h4>\u{1F6D2} Retail</h4>
    {{availabilityLine grocery "Grocery"}}
    {{availabilityLine ice "Ice"}}
    {{availabilityLine fishingSupplies "Fishing supplies"}}
    {{availabilityLine marineRetail "Marine supplies"}}
    {{availabilityLine hardware "Hardware"}}
</div>
{{> notes notes}}`

/** Navigation partial: navigation hazards and constraints, present mainly on anchorages. */
export const NAVIGATION_PARTIAL = `<hr/>
<div>
    <h4>\u{1F9ED} Navigation</h4>
    {{knownLine "Current" current}}
    {{availabilityLine fixedBridge "Fixed bridge"}}
    {{#if bridgeHeight}}\u{1F309} Bridge clearance {{bridgeHeight}} {{distanceUnit}}<br/>{{/if}}
    {{#if tide}}\u{1F30A} Tidal range {{tide}} {{distanceUnit}}<br/>{{/if}}
    {{#if depthApproach}}\u{1F4CF} Approach depth {{depthApproach}} {{distanceUnit}}<br/>{{/if}}
</div>
{{> notes notes}}`
