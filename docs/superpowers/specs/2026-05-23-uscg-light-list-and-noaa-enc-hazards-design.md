# USCG Light List and NOAA ENC Direct hazards: design

Date: 2026-05-23
Status: approved for planning

## Goal

Add two authoritative US data sources to `signalk-crows-nest` as new
`InputModule` modules, alongside the existing ActiveCaptain and OpenSeaMap
inputs:

1. **USCG Light List** (Volumes I to VII), the official US Aids to Navigation
   catalog. ~57,700 lights, daymarks, buoys, racons, and sound signals across
   all 10 Coast Guard districts. Strictly more accurate for US waters than
   OpenSeaMap's crowd-sourced navaid coverage.
2. **NOAA ENC Direct hazards**, the official successor to the retired AWOIS
   wrecks-and-obstructions service. Authoritative wrecks, obstructions, and
   underwater rocks sourced from official NOAA hydrographic surveys. Bigger
   coverage than legacy AWOIS, weekly fresh.

Both feed the existing `notes` resource output and the existing proximity and
route-corridor alarm outputs without changing the output modules.

## Constraints

- The architectural rule holds: ONE npm package, ONE Signal K plugin, modular
  TypeScript files under `src/`. Each POI source is a new `InputModule` under
  `src/inputs/`.
- American English, no em dashes, the Oxford comma.
- Existing installs keep working. Both new inputs default to disabled.
- All existing tests stay green; new behavior is covered by new tests.
- Both sources are US-only. Outbound HTTP is skipped when the vessel is
  clearly outside US waters, so a Mediterranean boat does not hit NAVCEN or
  NOAA at all.

## 1. File structure

Two new directories under `src/inputs/`, each self-contained and registered
on one line in `src/index.ts`:

```
src/inputs/
├── uscg-light-list/
│   ├── uscg-light-list-input.ts       # InputModule registration + config schema fragment
│   ├── uscg-light-list-source.ts      # PoiSource adapter over client, store, mapping
│   ├── light-list-client.ts           # 61 GeoJSON downloads, conditional GET
│   ├── light-list-store.ts            # On-disk index, refresh scheduler
│   ├── light-list-types.ts            # MSI GeoJSON wire types
│   ├── light-list-detail.ts           # Plain-English HTML renderer
│   └── light-list-mapping.ts          # AID_TYPE -> PoiType + skIcon, isolated-danger rules
└── noaa-enc/
    ├── noaa-enc-input.ts              # InputModule registration + config schema fragment
    ├── noaa-enc-source.ts             # PoiSource adapter
    ├── enc-direct-client.ts           # ArcGIS REST /query, pagination
    ├── enc-direct-types.ts            # ArcGIS feature wire types
    ├── enc-direct-detail.ts           # Plain-English HTML renderer (S-57 codes)
    └── s57-mapping.ts                 # S-57 enum -> human label, layer -> PoiType + skIcon
```

One shared addition:

```
src/shared/
└── us-waters.ts                       # Coarse US-waters bbox, isInUsWaters(position)
```

Source-agnostic, consumed by both new inputs. The bbox covers the Atlantic
coast, Pacific coast, Gulf of Mexico, Great Lakes, Alaska, Hawaii, Puerto
Rico, the USVI, Guam, and the CNMI. Coarse on purpose: a false negative would
silently skip data, so the bbox is deliberately generous and a false positive
is allowed (the request would return an empty FeatureCollection and the next
tick would not retry, no harm done).

## 2. Plugin configuration additions

Both inputs add fragments to the merged plugin config schema and to the panel.
Field names mirror the existing OpenSeaMap pattern (`openSeaMapEnabled`,
`openSeaMapDedupe`, etc.).

USCG Light List:

| key | type | default | notes |
|---|---|---|---|
| `uscgLightListEnabled` | boolean | `false` | Master toggle for this source. |
| `uscgLightListDedupe` | boolean | `true` | Dedupe against ActiveCaptain base and same-source within radius. |
| `uscgLightListRefreshHours` | number | `6` | 1 to 168. Background refresh period. |

NOAA ENC Direct:

| key | type | default | notes |
|---|---|---|---|
| `noaaEncEnabled` | boolean | `false` | Master toggle for this source. |
| `noaaEncDedupe` | boolean | `true` | Dedupe against ActiveCaptain base and same-source within radius. |
| `noaaEncScaleBand` | enum | `'coastal'` | One of `overview`, `general`, `coastal`, `approach`, `harbour`, `berthing`. |
| `noaaEncIncludeWrecks` | boolean | `true` | Fetch the `Wreck_point` layer for the selected band. |
| `noaaEncIncludeObstructions` | boolean | `true` | Fetch the `Obstruction_point` layer. |
| `noaaEncIncludeRocks` | boolean | `false` | Off by default: a coastal-band query can return tens of thousands of awash rocks for a normal cruising bbox. |

## 3. USCG Light List input

### 3.1 Acquisition

`light-list-client.ts` sends GET against the 61 URLs:

```
https://navcen.uscg.gov/sites/default/files/msi/lightListD{DD}_{N}.geojson
```

District numbers and page counts are hard-coded from the NAVCEN `/msi` page:
`01` (4 pages), `02` (2), `05` (4), `07` (15), `08` Gulf (4), `08` Western
Rivers (2), `09` (3), `11` (1), `13` (2), `14` (1), `17` (1). The file
inventory is stable; NAVCEN exposes it only as anchors on the HTML index page,
so scraping is not justified. If a future district or page is added, a
fixture-backed test will fail and the contributor extends the constant.

Built on the shared `http-client.ts`. Conditional GET: the response's
`Last-Modified` and `ETag` headers are persisted, and the next refresh sends
`If-Modified-Since` and `If-None-Match`. A 304 reply is a no-op. The
`http-client.ts` retry-and-backoff policy already covers 429 and 503.

`User-Agent: signalk-crows-nest/<version> (+https://github.com/...)`.

### 3.2 Storage

`light-list-store.ts` keeps one file: `<plugin-data-dir>/uscg-light-list/index.json`.

The index has the shape:

```typescript
interface LightListIndex {
  generated: string                    // ISO timestamp of the last full pass
  districts: Record<string, DistrictMeta>     // key: 'D01_1' etc.
  records: Record<string, LightListRecord>    // key: LLNR as string
}
interface DistrictMeta {
  lastModified?: string                // Last-Modified header verbatim
  etag?: string                        // ETag header verbatim
  recordCount: number                  // For status reporting
  fetchedAt: string                    // ISO timestamp
}
interface LightListRecord {
  llnr: number
  name: string
  position: { latitude: number, longitude: number }
  lightChar?: string
  color?: string
  nominalRange?: { value: number, unit: 'NAUT MI' | 'STAT MI' }
  focalPlane?: { value: number, unit: 'FT' }
  structureType?: string
  structureHeight?: { value: number, unit: 'FT' }
  daymarkShape?: string
  daymarkColor?: string
  soundEmitterType?: string
  racon?: string                       // single Morse character
  aidType?: string                     // e.g. 'FD/FX'
  aidSubtype?: string
  remark?: string
  district: string                     // e.g. 'D01'
  volume: number                       // 1 to 7
  source: 'usclightlist'
  modifiedDate?: string                // ISO from MODIFIED_DATE epoch ms
  inactive: boolean
}
```

The store strips wire fields the plugin never displays: every `*_UID` Esri
identifier, `ATONIX_DATE`, `CREATE_DATE`, `ESRI_OID`, MRN URN, the redundant
DMS `ASSIGNED_LATITUDE`/`ASSIGNED_LONGITUDE`, `ICE_CONDITIONS`,
`GROUP_JURISDICTION`, `PRIMARY_UNIT_NAME`, `SECONDARY_UNIT_NAME`,
`HWATERWAY_NAME`, `RIVER_*`. The on-disk footprint is roughly half the raw 102
MB after stripping.

The in-memory data structure is a `Map<number, LightListRecord>` keyed by
LLNR, rebuilt from the JSON index on plugin start, mutated in place when a
district refresh succeeds. Filtering by bbox is a linear scan over the values,
fast enough at ~57,700 records (well under 10 ms on a Raspberry Pi 4).

### 3.3 Refresh scheduler

The input owns a `setInterval` that ticks every `uscgLightListRefreshHours`
hours (default 6). The first tick runs `refreshDelaySeconds` after plugin
start (default 30) so cold-start does not block plugin activation. The tick
re-issues every district with conditional GET. The interval is cleared in
`close()`.

If a refresh tick fails for an individual district, the existing in-memory
data for that district stays loaded; the failure is recorded on the status
recorder and the next tick retries. A whole-tick failure is logged once and
the next tick runs as scheduled.

### 3.4 Mapping

`light-list-mapping.ts`:

- Every Light List entry is `PoiType: 'Navigational'`. The Light List is a
  navigation catalog; it has no non-navigation entries.
- Freeboard icon is `navigation-structure` by default.
- Isolated-danger AtoNs (identified by `AID_SUBTYPE` containing `ISO/DG` or
  similar, plus a curated list of LLNRs the USCG flags as isolated-danger)
  get `skIcon: 'hazard'` while the `PoiType` stays `'Navigational'`, matching
  the existing OpenSeaMap pattern. This keeps the proximity alarm from
  falsely triggering on the buoy itself while the chart shows the visually
  correct cue.

A mapping exhaustiveness test (see section 6) asserts that every `AID_TYPE`
value in the bundled fixtures resolves to a non-`Unknown` `PoiType` and a
non-default skIcon, so contributor drift is caught at test time.

### 3.5 Detail rendering

`light-list-detail.ts` produces a friendly HTML description from the parsed
record. Example output for a major light:

```
<h4>Whipple Point Light (LLNR 40100)</h4>
<p><strong>Light:</strong> flashing white, 4 s period, 14 NM range, 67 ft focal plane.</p>
<p><strong>Structure:</strong> White tower on cylindrical base, 28 ft tall.</p>
<p><strong>Sound signal:</strong> HORN.</p>
<p><strong>RACON:</strong> B (Morse).</p>
<p><strong>Remarks:</strong> &lt;escaped REMARK verbatim&gt;</p>
<p><strong>Source:</strong> USCG Light List, Volume I, District 01 (last updated 2026-05-22).</p>
<p class="crows-nest-attribution">© USCG (US Government public domain)</p>
```

The light-character translation reuses the existing `humanizeLightCharacter`
helper from `openseamap-detail.ts`. Light List values like `Fl W 4s` split
on whitespace into `Fl`, `W`, `4s`; each piece is humanized using the
existing IALA abbreviation table (extended once if any Light List value
appears that the OpenSeaMap table does not already cover, with a
record-and-extend test that prevents silent drift).

Sector arc parsing is best-effort: a regex matches the common USCG REMARK
phrases (`Visible <X>° to <Y>°`, `Red sector from <X>° to <Y>°`,
`Obscured from <X>° to <Y>°`) and renders them as a separate "Sector arcs:"
paragraph. A no-match leaves the full REMARK rendered verbatim under
"Remarks:" and never blocks the rest of the description.

Inactive entries (`inactive: true`) are listed with `<h4>... (inactive)</h4>`
in the header, and skIcon falls back to `notice-to-mariners` so they read as
"informational only" on the chart.

### 3.6 PoiSource adapter and ids

`uscg-light-list-source.ts` exposes the `PoiSource` contract:

- `id: 'usclightlist'`.
- `listPointsOfInterest(bbox)` filters the in-memory `Map` to records whose
  position is inside the bbox, builds a `PoiSummary` for each, returns them.
- `getDetails(id)` reads the in-memory record by LLNR and builds the
  `PoiDetailView`, including the rendered description.
- The internal id is the LLNR as a decimal string (e.g. `'40100'`). The
  aggregate registry's prefix routing turns this into the resource id
  `usclightlist-40100`.
- `url` is the USCG search-result deep link:
  `https://www.navcen.uscg.gov/light-list-search-results?listVolumeNumber=<vol>&lightListNumber=<llnr>`.
- `attribution` is `'© USCG (US Government public domain)'`.
- `cacheSize()` returns the in-memory `Map.size`.
- `close()` clears the refresh interval and the in-memory map.

## 4. NOAA ENC Direct input

### 4.1 Acquisition

`enc-direct-client.ts` issues ArcGIS REST `/query` requests against the
per-scale-band MapServers:

```
https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_<band>/MapServer/<layerId>/query
?geometry=<xmin>,<ymin>,<xmax>,<ymax>
&geometryType=esriGeometryEnvelope
&spatialRel=esriSpatialRelIntersects
&inSR=4326
&outFields=*
&returnGeometry=true
&f=geojson
&resultOffset=<n>
&resultRecordCount=1000
```

`f=geojson` is supported directly, so the client receives a standard
`FeatureCollection` and skips the Esri-JSON conversion step. The 1000-record
cap means the client must page: when the response carries
`exceededTransferLimit: true`, the client re-issues with the next
`resultOffset` until exhausted.

Built on the shared `http-client.ts`. Sends a descriptive User-Agent.

The query must always include a geometry filter. Never issue `where=1=1`: the
research confirmed that an unbounded query against the harbour scale band
times out.

### 4.2 Layer ids per scale band

The numeric layer ids differ per scale band. The client carries a hard-coded
table:

```typescript
const LAYER_IDS_BY_BAND: Readonly<Record<ScaleBand, LayerIds>> = {
  overview:  { wreck: ?, obstruction: ?, rock: ? },
  general:   { wreck: ?, obstruction: ?, rock: ? },
  coastal:   { wreck: 33, obstruction: 30, rock: 31 },     // verified
  approach:  { wreck: ?, obstruction: ?, rock: ? },
  harbour:   { wreck: ?, obstruction: ?, rock: ? },
  berthing:  { wreck: ?, obstruction: ?, rock: ? }
}
```

The `?` values are populated during the implementation phase by hitting each
MapServer's root with `?f=json` and recording the layer ids. A test asserts
the table is fully populated.

### 4.3 No persistent store

Unlike Light List, ENC Direct is bbox-native; the at-runtime fetch pattern
matches OpenSeaMap exactly. An in-memory LRU cache holds the most recently
fetched details for `getDetails` lookups, bounded by the shared
`MAX_POI_CACHE_ENTRIES` ceiling. The list-fetch path always re-queries on
bbox change.

### 4.4 Mapping

`s57-mapping.ts`:

- All three layers (`Wreck_point`, `Obstruction_point`,
  `Underwater_Awash_Rock_point`) map to `PoiType: 'Hazard'`.
- All three get Freeboard icon `hazard`.
- Hazards feed the existing proximity-alarm and route-corridor outputs
  without any wiring change.

The S-57 enum tables for human-readable rendering:

```typescript
const CATWRK: Readonly<Record<number, string>> = {
  1: 'non-dangerous wreck',
  2: 'dangerous wreck',
  3: 'distributed remains of wreck',
  4: 'wreck showing mast',
  5: 'wreck showing hull'
}
const CATOBS: Readonly<Record<number, string>> = {
  // populated from the S-57 catalog during implementation
}
const WATLEV: Readonly<Record<number, string>> = {
  1: 'partly submerged at high water',
  2: 'always dry',
  3: 'always submerged',
  4: 'covers and uncovers',
  5: 'awash',
  6: 'subject to inundation or flooding'
}
const QUASOU: Readonly<Record<number, string>> = { /* sounding-quality enum */ }
const TECSOU: Readonly<Record<number, string>> = { /* technique-of-sounding enum */ }
const NATSUR: Readonly<Record<number, string>> = { /* nature-of-surface enum */ }
```

A mapping exhaustiveness test asserts every enum value present in the
bundled fixtures resolves to a non-empty human label.

### 4.5 Detail rendering

`enc-direct-detail.ts` produces friendly HTML. Example output for a wreck:

```
<h4>Wreck (dangerous wreck, always submerged)</h4>
<p><strong>Charted depth:</strong> 23.7 m (sounding accuracy ±0.5 m).</p>
<p><strong>Position quality:</strong> depth known.</p>
<p><strong>Survey technique:</strong> side-scan sonar.</p>
<p><strong>Information:</strong> &lt;INFORM verbatim, escaped&gt;</p>
<p><strong>Source:</strong> NOAA ENC US5MA12M.000 (last updated 2007-05).</p>
<p><strong>Disclaimer:</strong> NOAA ENC data is not intended for primary navigation.</p>
<p class="crows-nest-attribution">© NOAA Office of Coast Survey (CC0)</p>
```

The navigation disclaimer is mandatory under NOAA's data-licensing terms and
is rendered into every detail, not just the README.

### 4.6 PoiSource adapter and ids

`noaa-enc-source.ts` exposes the `PoiSource` contract:

- `id: 'noaaenc'`.
- The internal id is `${layerKey}_${OBJECTID}` (e.g. `wreck_12345`,
  `obstruction_67890`, `rock_99999`). The aggregate registry's prefix routing
  turns this into the resource id `noaaenc-wreck_12345`.
- `listPointsOfInterest(bbox)` issues a query per enabled layer
  (`noaaEncIncludeWrecks`, `noaaEncIncludeObstructions`,
  `noaaEncIncludeRocks`) against the configured scale band's MapServer,
  pages through `exceededTransferLimit`, and stashes each returned feature
  in the LRU cache before returning the summaries.
- `getDetails(id)` reads the LRU cache by id; a cache miss issues a single
  `/query?objectIds=<id>&f=geojson` against the relevant layer.
- `url` is the ENC Online viewer deep link to the feature's position:
  `https://encdirect.noaa.gov/?center=<lat>,<lon>&zoom=15`.
- `attribution` is `'© NOAA Office of Coast Survey (CC0)'`.
- `cacheSize()` returns the LRU size.
- `close()` clears the LRU and tears down the client.

## 5. US-waters gate

`src/shared/us-waters.ts`:

```typescript
const US_WATERS_BBOX = {
  // Generous union of CONUS coastal, Alaska, Hawaii, Puerto Rico, USVI,
  // Guam, and CNMI envelopes. Several disjoint rectangles, not a single
  // square, so the Mediterranean is not falsely included.
}

export function isInUsWaters (position: { latitude: number, longitude: number }): boolean
```

Both new inputs gate their outbound HTTP on `isInUsWaters(currentPosition)`.
When the vessel is outside, the list query returns an empty array and
records a per-source status of "skipped: outside US waters". The refresh
scheduler on Light List still runs (a vessel that left US waters should not
lose its already-loaded index, and re-entering US waters should pick up
where it left off); the at-runtime ENC query is skipped entirely.

The US-waters bbox is a hard-coded constant. A future PR can refine it
without changing the input modules.

## 6. Tests

Each input gets the same test shape as the existing OpenSeaMap input:

- **Client test**: bbox query URL composition, conditional-GET headers,
  pagination loop (ENC), 304 handling (Light List), 429/503 retry, abort on
  `close()`.
- **Parser test**: real fixture from the live wire (one or two records per
  district for Light List, a sample `/query` response per layer for ENC),
  asserts the parsed object has the expected fields.
- **Mapping exhaustiveness test**: every enum value in the fixtures resolves
  to a non-default `PoiType` and a non-default skIcon. Catches drift the
  same way `seamark-mapping.test.ts` does today.
- **Renderer test**: golden HTML for a representative entry per category
  (major light, minor light, lateral buoy, racon for Light List; wreck,
  obstruction, rock for ENC).
- **Store test (Light List only)**: cold start with an empty data dir,
  conditional-GET 304 round-trip, partial-district failure leaves prior
  data intact, JSON index round-trip survives a process restart.
- **US-waters gate test**: positions inside several US sub-envelopes resolve
  true; positions in the Mediterranean, the North Sea, and the central
  Pacific resolve false; the input's list query is empty when outside.

All four `tsconfig`s (plugin, panel, tests) stay green; lint stays green.

## 7. Panel additions

Two new cards in the `DataSourcesSection` accordion, one per new input,
each modelled on the existing `OpenSeaMapSource` card:

- **USCG Light List card**: enable toggle, dedupe toggle, refresh-hours
  field, status badge ("ready (57,712 records, last refreshed N hours ago)",
  or "refresh failed: <message>", or "outside US waters").
- **NOAA ENC Direct card**: enable toggle, dedupe toggle, scale-band
  selector (six options), the three layer toggles (wrecks, obstructions,
  rocks), status badge.

The cards collapse and expand exactly like the existing ones; the panel
stays scannable.

Two new per-source UI-metadata modules under `src/panel/components/` mirror
the existing per-source card components (`ActiveCaptainSource`,
`OpenSeaMapSource`): `UscgLightListSource`, `NoaaEncSource`.

## 8. Status snapshot additions

`status-types.ts` already carries a `Record<sourceId, SourceStatus>`. The two
new source slugs (`usclightlist`, `noaaenc`) join the existing keys. No
schema change; the existing per-source status structure (list-fetch
outcomes, detail-fetch outcomes, last error, cache size) already covers what
both inputs need.

The Light List input adds one extra field to its source status: the
`refresh` sub-record with `lastTick`, `lastTickOutcome`, and per-district
`lastModified`/`recordCount`. This is per-source, not part of the
source-agnostic shape; it lives in the input module and is rendered only by
the Light List card.

## 9. Documentation

- `CLAUDE.md`: extend section "Layout" with the two new directories. Extend
  "What this is" to mention USCG Light List and NOAA ENC Direct alongside
  ActiveCaptain and OpenSeaMap.
- `docs/development.md`: add a "New POI input" walkthrough that points at
  these two as worked examples.
- `docs/roadmap.md`: move USCG Light List and NOAA ENC Direct from
  "considered" to "shipped".
- `README.md`: add the two sources to the "Data sources" list.

## 10. Out of scope

- A free-text REMARK parser that extracts every possible sector / fog signal
  / seasonal-period nuance. The plugin parses the common USCG REMARK
  patterns and renders the rest verbatim; structured sector parsing is a
  follow-on if and when a user shows a chart that needs it.
- A NOAA ENC scale-band auto-selector based on vessel speed or distance
  from shore. The panel exposes a manual selector; auto-selection is
  follow-on.
- The historical 2013 AWOIS snapshot. The user chose ENC Direct; the frozen
  AWOIS is not in scope.
- Foreign navaids (NGA List of Lights). US-only sources only.
- World Port Index, NOAA NDBC buoys, USACE locks. Already deferred in the
  multi-source spec; this spec does not pull them forward.

## 11. Acceptance

The work is acceptably complete when:

- Both inputs build, type-check, lint, and test green across all three
  `tsconfig`s.
- A live cold start of the plugin against `boatpi.naternet.lan` downloads
  the Light List on first run, the in-memory index is populated, the refresh
  scheduler is ticking, and the SignalK admin UI shows a non-zero record
  count under "USCG Light List".
- A live ENC query for a US harbor (e.g. Boston Harbor coastal-scale bbox)
  returns wrecks and obstructions, the notes are visible in Freeboard-SK as
  hazard icons, and the per-source attribution and CC0 disclaimer are
  rendered in the detail popup.
- The dedupe pipeline collapses an overlapping OpenSeaMap wreck and NOAA
  wreck into a single note in US waters with both enabled.
- The proximity alarm fires for a NOAA wreck inside the configured radius
  and clears outside it.
- A vessel position in the Mediterranean does not produce any outbound
  request to NAVCEN or NOAA.
- The panel renders both new cards with their controls and their status
  badges; the accordion stays scannable.
- All four docs in section 9 are updated and `docs/roadmap.md` shows both
  sources as shipped.
