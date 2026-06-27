# Multi-source POI inputs and the OpenSeaMap input: design

Date: 2026-05-22
Status: approved for planning

## Goal

Extend `signalk-crows-nest` from one POI data source (Garmin ActiveCaptain) to
a multi-source plugin, and add the first additional source: OpenSeaMap via the
OpenStreetMap Overpass API. This sub-project builds the shared multi-source
foundation and proves it end to end with OpenSeaMap. World Port Index, NOAA
NDBC buoys, and USACE locks are deferred to follow-on specs that each add one
`src/inputs/<name>/` module against this foundation.

The configuration panel must stay scannable as sources are added: this is a
hard requirement, not a nicety.

## Constraints

- The architectural rule holds: ONE npm package, ONE Signal K plugin, modular
  TypeScript files under `src/`. Each POI source is a new `InputModule` under
  `src/inputs/`.
- American English, no em dashes, the Oxford comma, as elsewhere in the repo.
- Existing single-ActiveCaptain installs keep working. The one deliberate
  behavior change is that resource ids gain a source prefix (see below) and
  the alarm notification paths are renamed (see below).
- All existing tests stay green; new behavior is covered by new tests.

## 1. ID namespacing

A `notes` resource id becomes `<sourceId>-<rawId>`:

- Hyphen-delimited, never colon. The SignalK Resources API does not validate
  the id on a GET, so a non-UUID id is reachable, but a colon is an HTTP
  path-encoding hazard (clients inconsistently percent-encode it). A hyphen is
  RFC 3986 unreserved, never encoded, and is already permitted by the
  plugin's `sanitizePoiId`.
- `sourceId` is a short, fixed, lowercase slug: `activecaptain`, `openseamap`.
- The aggregate splits an incoming id on the FIRST hyphen only, because a raw
  id can itself contain hyphens (OSM ids look like `node/987654`).
- Example ids: `activecaptain-123456`, `openseamap-node/987654`.

Single-ActiveCaptain installs see their ids change from `123456` to
`activecaptain-123456`. This is the one accepted id-shape change; `getResource`
round-trips the prefixed id correctly.

UUIDv5-derived ids (a deterministic spec-valid UUID) were considered and
deferred: the provider is read-only, so a plain prefixed string id is
acceptable. The UUIDv5 option is recorded here as a future escape hatch if a
strict server ever rejects non-UUID note ids.

## 2. Aggregating input registry

`input-registry.createSource` builds an aggregate `PoiSource` over every
enabled `InputModule`'s source, holding a `Map<sourceId, PoiSource>`:

- `listPointsOfInterest(bbox, poiTypes)`: fan out to every enabled source with
  `Promise.allSettled`. Prefix every returned `PoiSummary.id` with its source
  slug. Union the results from the sources that succeeded. Record each failed
  source's error (per-source status, see section 8). Throw only when EVERY
  source fails; one rate-limited Overpass endpoint must not blank the chart.
- `getDetails(id)`: split on the first hyphen, look up the source by prefix,
  delegate the raw id. Reject with a clear error when the prefix is unknown.
- `cacheSize()`: sum across the sources.
- `close()`: close every source.

Prefixing lives ONLY in the aggregate. Each `PoiSource` stays prefix-agnostic
and is unit-testable in isolation. The `PoiSource` interface in
`src/inputs/poi-source.ts` is unchanged.

## 3. note-builder, url, and attribution

- `$source` stays `PLUGIN_ID` on every note. `$source` identifies the SignalK
  producer (the plugin), not the upstream data source.
- The hardcoded ActiveCaptain `POI_PAGE_URL_PREFIX` is removed from
  `note-builder.ts`. `url` becomes a per-source value carried on the POI data
  the source produces: the ActiveCaptain POI page for AC, the OpenStreetMap
  element page (`https://www.openstreetmap.org/<type>/<id>`) for OpenSeaMap.
- The note's `properties` object gains `source` (the slug) and `attribution`
  (a human-readable credit string). `properties` is free-form; chartplotters
  ignore unknown keys.
- Detail rendering stays source-specific (ActiveCaptain's section-based HTML
  renderer is intrinsically AC-shaped; OpenSeaMap gets its own simpler
  tag-based rendering). The attribution FOOTER, however, becomes a shared
  helper: each source supplies an attribution string, and the shared helper
  appends it to that source's rendered description. Every rendered description
  therefore carries a visible attribution footer. For OpenSeaMap the footer
  reads `© OpenStreetMap contributors (ODbL)`: ODbL requires attribution at
  the point of display, so the README alone is not sufficient.

## 4. Notification path rename

The proximity and route-hazard alarms move from
`notifications.navigation.activecaptain.{hazard,route}.<id>` to
`notifications.navigation.crowsNest.{hazard,route}.<id>`. The `navigation`
branch is correct and unchanged; only the vendor segment changes, because a
non-ActiveCaptain hazard (an OpenSeaMap rock or wreck) on an `activecaptain`
path is factually wrong. The `<id>` segment is the namespaced id from section
1, run through `sanitizePoiId`. The CHANGELOG notes that a hot upgrade leaves
stale `activecaptain.*` notifications until the next server restart.

## 5. Configuration shape

Config keys stay FLAT, with a per-source prefix for new sources
(`openSeaMapEnabled`, `openSeaMapEndpoint`, `openSeaMapSeamarkGroups`). A
nested `sources: {}` object was considered and rejected: nesting is tidier but
forces a migration of every existing user's saved config, whereas flat-prefixed
keys leave existing ActiveCaptain configs untouched and absent OpenSeaMap keys
simply take their schema defaults. The panel accordion (section 7) provides the
visual grouping; the config's internal shape does not need to.

The plugin config schema is still assembled per-module by `plugin-config.ts`;
the OpenSeaMap `InputModule` contributes its own flat fragment. The reducer
(`config-reducer.ts`) namespaces its ACTIONS by source
(`{ type: 'setSourceField', source, field, value }`) to avoid one action per
field per source.

## 6. OpenSeaMap input module: `src/inputs/openseamap/`

- `openseamap-input.ts` - the `InputModule`. Config fragment: `openSeaMapEnabled`
  (boolean, default false), `openSeaMapEndpoint` (string, default a public
  Overpass interpreter URL), `openSeaMapSeamarkGroups` (which seamark
  categories to fetch: hazards, navigation aids, harbours and moorings,
  infrastructure). `isEnabled` returns `openSeaMapEnabled === true`.
- `overpass-client.ts` - the Overpass QL HTTP client. Builds a bounding-box
  query (`[bbox:south,west,north,east]`, `nwr["seamark:type"~...]`,
  `out center tags`). Sends a descriptive `User-Agent` identifying the plugin
  (required by Overpass usage policy). Rate limits, retries with exponential
  backoff, and honors `Retry-After` and HTTP 429, reusing the shape of the
  ActiveCaptain client. Caps the bounding-box size and sets an explicit query
  `[timeout:...]` so a large box cannot hit the server's 180 s limit.
- `openseamap-source.ts` - the `PoiSource`. The list query returns full tags,
  so it populates the detail cache; `getDetails` is served from cache and only
  hits the network on a miss, by id (`node(id:)/way(id:)/rel(id:)`). This
  mirrors the ActiveCaptain cache-and-store pattern. `getDetails` handles a
  deleted element gracefully (an OSM id can disappear).
- `seamark-mapping.ts` - maps `seamark:type` values onto the plugin's existing
  `PoiType` union: `rock`, `wreck`, and `obstruction` map to `Hazard` (so they
  flow straight into the existing proximity and route-corridor alarms);
  `harbour` and `leisure=marina` map to `Marina`; `lock_basin` to `Lock`;
  `bridge` to `Bridge`; lights, buoys, and beacons to `Navigational`;
  anchorage and mooring to `Anchorage`. The `PoiType` union is not changed;
  every OpenSeaMap feature maps to an existing member.

The OpenSeaMap source attaches `source: 'openseamap'`, an OSM element `url`,
and the ODbL attribution string to the POIs it produces.

## 7. Configuration panel rework

The panel restructures into four fixed zones, top to bottom: the status bar, a
Data sources section, an Alerts section, and the footer.

- Data sources is a vertical accordion of per-source cards. Collapsed, a card
  is one row: an enable toggle, the source name, and a one-line summary
  (`5 of 13 types, 60 min cache`, or `Disabled`). Expanded, it shows that
  source's own settings. Default: all cards collapsed. A source's detail
  fields are hidden until its enable toggle is on, and behind the
  collapse/expand affordance even when enabled. A user with only ActiveCaptain
  enabled sees one card plus a short Disabled OpenSeaMap row.
- Alerts is a new section holding the proximity-alarm and route-hazard-scan
  controls. These are outputs that consume the merged POI set, so they sit
  once, below the sources, never per-source.
- POI-type filtering stays per-source. ActiveCaptain keeps its 13 toggles in 4
  groups; the `PoiTypeGroups` component and `poi-type-groups.ts` are renamed to
  be explicitly ActiveCaptain-specific. OpenSeaMap gets its own seamark-group
  checklist. No unified cross-source taxonomy.
- Cache duration stays per-source (inside each live-API source card). The
  minimum-rating filter stays inside the ActiveCaptain card: it filters on
  ActiveCaptain review ratings, which OpenSeaMap features do not have.

New components under `src/panel/components/`: `DataSourceCard` (the accordion
shell: header row, enable toggle, summary, expand state, renders children when
expanded), `DataSourcesSection`, `ActiveCaptainSource` and `OpenSeaMapSource`
(the card bodies), `AlertsSection`, `EndpointUrlField`, and `SeamarkGroups`.
The existing `CacheDurationField`, `RatingFilterField`, `ProximityAlarmFields`,
`RouteHazardScanFields`, and `FooterBar` are reused unchanged inside the new
parents. New panel CSS uses `--ac-*` tokens in `THEME_STYLE`, no hex literals.

## 8. Per-source status

`StatusSnapshot` becomes per-source: each enabled source reports its own API
reachability, last fetch, cached count, and recent errors. `plugin-status.ts`,
`status-types.ts`, and `StatusBar.tsx` change together. The status bar renders
one compact row per enabled source. The aggregate `cacheSize()` still feeds the
snapshot, summed across sources.

## 9. Behavior preservation

For a single-ActiveCaptain install:

- The `notes` resources are identical except the id gains the `activecaptain-`
  prefix; `getResource` round-trips the prefixed id.
- The config schema keeps every existing ActiveCaptain property with the same
  names and defaults; old saved configs load unchanged.
- The proximity and route-hazard alarms behave identically apart from the
  `activecaptain` to `crowsNest` path-segment rename.
- The 295-test suite stays green; the gate is `npm run typecheck`,
  `npm run lint`, `npm test`, and `npm run build`.

New tests cover the aggregate registry (the `allSettled` union, prefix
routing, unknown-prefix rejection, `cacheSize` summing), the Overpass client
(bbox query, backoff, `User-Agent`), the seamark mapping, the OpenSeaMap
source, and the new panel components.

## 10. Deferred work (follow-on specs)

- The NGA World Port Index input (a bundled static dataset source).
- The NOAA NDBC buoy input (a station-list source).
- The USACE lock-locations input (an ArcGIS REST source).
- Marine-forecast outputs (NWS, Open-Meteo) are outputs, not inputs, and are
  out of scope here.

Each follow-on adds one `src/inputs/<name>/` module plus one accordion card; no
foundation change.

## 11. Execution

A 6-agent team implements the written plan: a foundation and registry agent;
an agent for note-builder, the `url` and `properties` change, the notification
rename, and the attribution renderer; an OpenSeaMap-module agent; a
panel-rework agent; a per-source-status agent; and a test and integration
agent. The agents coordinate the shared files (`index.ts`, `plugin.ts`,
`note-builder.ts`) through the task list, the same model as the modular
restructure.

## 12. Documentation follow-up

After implementation: update `CLAUDE.md` (the new `src/inputs/openseamap/`
module and the multi-source registry), `README.md` (the OpenSeaMap source, the
new panel layout, the attribution), `CHANGELOG.md` (the notification-path
rename caveat), and `docs/development.md`.
