# Notes resource format (integration guide)

How `signalk-crows-nest` publishes points of interest as Signal K `notes`
resources, and how a chartplotter client should consume them. This is the
reference for building a consumer (for example a custom chartplotter such as
signalk-binnacle): it describes the wire shape, the additive normalized-detail
schema, and exactly how to render it.

## TL;DR for a consumer

- The plugin serves standard Signal K `notes` resources at
  `GET /signalk/v2/api/resources/notes` (list, scoped by a `bbox` query) and
  `GET /signalk/v2/api/resources/notes/{id}` (one note's detail).
- Every note keeps the **standard** Signal K notes shape (`name`, `position`,
  `url`, `description`, `properties`), so any generic notes client renders it
  with no special knowledge.
- A structured client gets a **normalized, presentation-neutral** view of the
  detail under `properties.crowsNest`, carried **alongside** the HTML
  `description` (never instead of it). Read `properties.crowsNest.sections` and
  render natively; ignore the HTML. There is no server-side format switch: both
  representations always ship, so the plugin stays interoperable with stock
  Freeboard-SK while letting a richer client render its own UI.
- If `properties.crowsNest` is absent, or its `schemaVersion` is one you do not
  recognize, fall back to rendering the HTML `description`.

## The notes endpoints

### List (markers)

```
GET /signalk/v2/api/resources/notes?bbox=[west,south,east,north]
```

`bbox` is a JSON array in GeoJSON (longitude-first) order. The provider is
query-scoped: it returns nothing without a `bbox`, so always send one. The
response is an object keyed by note id:

```jsonc
{
  "usclightlist-40100": {
    "name": "Whipple Point Light",
    "position": { "latitude": 42.0, "longitude": -71.0 },
    "url": "<source viewer link>",
    "$source": "signalk-crows-nest",
    "properties": {
      "skIcon": "navigation-structure",
      "source": "usclightlist",
      "attribution": "© USCG (US Government public domain)",
      "plugin": "signalk-crows-nest",
      "pluginRepo": "https://github.com/NearlCrews/signalk-crows-nest",
      "crowsNest": { "schemaVersion": 1, "type": "Navigational" }
    }
  }
  // ...more notes
}
```

List entries carry enough to place and style a marker without a detail fetch:
`name`, `position`, `properties.skIcon` (a Freeboard `:sk-<icon>` glyph hint),
and `properties.crowsNest.type` (the POI type, see the `PoiType` list below).
List entries do **not** carry `sections` or a `description`: open the detail
for those.

The server merges every notes provider, so this plugin's POI notes arrive
alongside the user's own notes and any other provider's. Filter by
`properties.plugin === "signalk-crows-nest"` or `properties.source` if you need
to distinguish them.

### Detail (popup)

```
GET /signalk/v2/api/resources/notes/{id}
```

Returns the single note with its rendered HTML `description` and the normalized
`properties.crowsNest.sections`:

```jsonc
{
  "name": "Whipple Point Light",
  "position": { "latitude": 42.0, "longitude": -71.0 },
  "url": "<source viewer link>",
  "$source": "signalk-crows-nest",
  "description": "<h4>Whipple Point Light (LLNR 40100)</h4>...",
  "mimeType": "text/html",
  "properties": {
    "skIcon": "navigation-structure",
    "source": "usclightlist",
    "attribution": "© USCG (US Government public domain)",
    "plugin": "signalk-crows-nest",
    "pluginRepo": "https://github.com/NearlCrews/signalk-crows-nest",
    "crowsNest": {
      "schemaVersion": 1,
      "type": "Navigational",
      "sections": [
        { "id": "light", "title": "Light", "items": [
          { "label": "Character",     "value": "flashing, white, 4 s period", "kind": "text" },
          { "label": "Nominal range", "value": 14, "kind": "measure", "unit": "NM" },
          { "label": "Focal plane",   "value": 67, "kind": "measure", "unit": "ft" } ] },
        { "id": "source", "title": "Source", "items": [
          { "label": "LLNR",     "value": 40100, "kind": "text" },
          { "label": "Volume",   "value": 1,     "kind": "text" },
          { "label": "District", "value": "D01", "kind": "text" } ] }
      ]
    }
  }
}
```

## The `properties.crowsNest` schema

```ts
interface CrowsNest {
  /** Schema version. Currently 1. Fall back to the HTML on an unknown version. */
  schemaVersion: number
  /** The POI type (see PoiType below). Present on both list and detail. */
  type: PoiType
  /** Normalized detail. Present on detail responses; absent on list entries. */
  sections?: NormalizedSection[]
}

interface NormalizedSection {
  /** Stable machine id, e.g. "light", "fuel", "remarks". */
  id: string
  /** Human-readable heading, e.g. "Light" or "Fuel". */
  title: string
  /** Items in this section. A section with no items is never emitted. */
  items: NormalizedItem[]
}

interface NormalizedItem {
  /** Human-readable label, e.g. "Nominal range" or "Diesel". */
  label: string
  /** The value. For a "measure", the number is here and the unit in `unit`. */
  value: string | number | boolean
  /** Presentation hint; absent means render as text. */
  kind?: NormalizedItemKind
  /** Unit for a "measure" value, e.g. "NM", "ft", "m". */
  unit?: string
}

type NormalizedItemKind =
  | 'text'         // a plain string
  | 'measure'      // a number with a `unit` (e.g. 14 NM, 67 ft, 10 m)
  | 'count'        // a whole-number tally (berths, reviews)
  | 'availability' // a capability; value is "Yes" | "No" | "Nearby"
  | 'flag'         // a boolean property (free vs paid, active vs inactive, dangerous vs not)
  | 'rating'       // a 0-to-5 review score (number)
  | 'link'         // a URL the client may render as an anchor
  | 'note'         // free-text prose, possibly multi-line

type PoiType =
  | 'Marina' | 'Anchorage' | 'Hazard' | 'Business' | 'BoatRamp' | 'Bridge'
  | 'Dam' | 'Ferry' | 'Inlet' | 'Lock' | 'LocalKnowledge' | 'Navigational'
  | 'Airport' | 'Unknown'
```

The `sections` content mirrors exactly what the HTML `description` shows for
that POI, just structured rather than rendered: there is no information in the
HTML that is missing from the sections, and none added. Each source produces
its own section ids (a marina's `fuel`/`dockage`/`amenities`, a light's
`light`/`structure`, a wreck's `feature`/`depth`/`quality`), but the
section/item shape is uniform, so you render one shape across all sources.

## How to render (consumer recipe)

```ts
function renderNoteDetail(note) {
  const cn = note.properties?.crowsNest
  if (cn && cn.schemaVersion === 1 && Array.isArray(cn.sections)) {
    return renderSections(cn.sections)   // native rendering
  }
  return renderHtml(note.description)    // fallback for any other client/version
}

function renderSections(sections) {
  for (const section of sections) {
    heading(section.title)
    for (const item of section.items) {
      switch (item.kind) {
        case 'measure':      line(item.label, `${item.value} ${item.unit ?? ''}`.trim()); break
        case 'availability': badge(item.label, item.value /* "Yes" | "No" | "Nearby" */); break
        case 'flag':         toggle(item.label, item.value === true); break
        case 'rating':       stars(item.label, Number(item.value)); break
        case 'link':         anchor(item.label, String(item.value)); break
        case 'note':         prose(item.label, String(item.value)); break
        case 'count':
        case 'text':
        default:             line(item.label, String(item.value)); break
      }
    }
  }
}
```

Rendering notes:

- A consumer that does not special-case a `kind` can always show
  `label: value` as text; the `kind` is a hint, not a requirement.
- `measure` carries the numeric value in `value` and the unit string in `unit`.
  Join them for display, or convert units yourself. `unit` may be absent on a
  `measure`: a safety-critical value (a depth or clearance) is emitted even when
  the source did not carry a unit, so render the bare number rather than dropping
  it.
- `availability` value is the string `"Yes"`, `"No"`, or `"Nearby"`; the plugin
  omits unknown or absent capabilities entirely rather than emitting `"Unknown"`.
- `flag` value is a boolean. A safety-relevant flag leads its section: a NOAA ENC
  wreck or obstruction emits a `{ "label": "Dangerous", "value": true|false,
  "kind": "flag" }` first item when it is classified dangerous or non-dangerous,
  so a consumer can surface the danger status prominently.
- The note's `name` is the popup title; do not repeat it inside the sections.
- The attribution credit is `properties.attribution` (and `properties.sources`
  lists every source that independently corroborated a deduped POI). Show the
  attribution wherever you show the data, per the source licenses.

## Versioning and compatibility

- `schemaVersion` is bumped only on a backwards-incompatible change. Treat an
  unrecognized version as "render the HTML `description` instead", so an older
  client keeps working against a newer plugin.
- New `kind` values may be added within a version: an unknown `kind` must
  degrade to text rendering, never throw.
- New section ids and item labels may appear without a version bump. Render
  whatever sections and items arrive; do not hardcode an expected set.
- `properties.crowsNest` is additive. The standard note fields (`name`,
  `position`, `url`, `description`, `mimeType`, and the other `properties`)
  remain a valid Signal K note, so a generic consumer is unaffected.

## Source coverage

Every POI source produces `sections` on its detail responses: ActiveCaptain
(marina and anchorage amenities, fuel, dockage with maximum LOA and beam,
mooring, services, contact, and reviews), OpenSeaMap (seamark attributes), the
USCG Light List (light characteristic, structure, daymark, and signals),
NOAA ENC Direct (wreck, obstruction, and rock S-57 attributes), NOAA CO-OPS
(station identity and the station-page link), USCG Local Notice to Mariners
(the notice detail, including the Broadcast Notice to Mariners number and the
affected aid's LLNR), the NGA World Port Index (harbor classification,
entrance restrictions, pilotage, services, and maximum vessel dimensions),
and USACE locks and dams (chamber dimensions, river and river mile, and gate
type). The per-source builders live in
`src/inputs/<source>/<source>-sections.ts`; the shared schema is
`src/shared/normalized-detail.ts`.

A few source-specific conventions worth knowing:

- ActiveCaptain reviews (the aggregate rating and the featured review) ship only
  for review-bearing POI types (marinas, anchorages, businesses, and boat ramps);
  a hazard, navigational mark, bridge, or similar feature carries no rating.
- NOAA ENC depth labels are referenced to chart datum (MLLW on US ENCs) and call
  out a least-depth sounding ("Least depth (MLLW)") versus a plain charted depth
  ("Charted depth (MLLW)"); the least-depth case is the worst-case depth over the
  feature.
- Units are not normalized across sources: the USCG Light List reports light
  heights in feet (US convention) while OpenSeaMap reports them in meters (OSM
  convention), and NOAA ENC reports depths in meters. Read the `unit` on each
  `measure` rather than assuming a single unit across sources.
