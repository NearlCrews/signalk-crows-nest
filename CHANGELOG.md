## Change Log

<a id="unreleased"></a>

### Unreleased

**Two new authoritative US data sources, plus a broad cleanup pass driven by a
multi-agent code review.**

#### USCG Light List input

- A new opt-in source imports the USCG Light List (US Aids to Navigation):
  ~57,000 lights, daymarks, buoys, racons, and sound signals across all 10
  Coast Guard districts. Downloads 37 GeoJSON files from the NAVCEN Maritime
  Safety Information feed with conditional GET (If-Modified-Since /
  If-None-Match), persists a stripped JSON index under
  `<dataDir>/uscg-light-list/`, and refreshes every 6 hours (configurable).
  Source is off by default; US-only, gated on `isInUsWaters(position)` so a
  vessel outside US waters issues no refresh against NAVCEN.
- Plain-English popup HTML renders the IALA light character, color, nominal
  range, focal-plane height, structure, daymark, fog signal, and racon
  Morse character. Isolated-danger AtoNs get the hazard icon while their
  `PoiType` stays `Navigational` so they do not falsely trigger the
  proximity alarm.

#### NOAA ENC Direct input (AWOIS successor)

- A new opt-in source imports US authoritative wrecks, obstructions, and
  underwater rocks from NOAA's ENC Direct ArcGIS REST FeatureServer. AWOIS
  was retired by NOAA; ENC Direct is the official successor and is updated
  weekly. The source is bbox-native (no bulk download required), gated on
  `isInUsWaters(position)`, and off by default. Includes a panel selector
  for the chart scale band (overview / general / coastal / approach /
  harbour / berthing), individual toggles for wrecks / obstructions /
  rocks, and the standard per-source dedupe.
- Popup HTML translates the S-57 attribute codes (CATWRK, WATLEV, QUASOU,
  TECSOU) to plain-English labels. CATWRK and CATOBS are passed through
  as decoded strings because the ArcGIS service pre-decodes them on the
  wire. The popup always carries NOAA's mandatory navigation disclaimer
  (`NOAA ENC data is not intended for primary navigation.`) and the CC0
  attribution footer per NOAA's data-licensing terms.
- The popup's source-date suffix is labelled "surveyed YYYY-MM" rather
  than "last updated YYYY-MM", because S-57 SORDAT is the hydrographic
  survey date (often decades old for stable features), not the chart
  refresh date.

#### Multi-agent code review cleanup

A 5-agent code review of the entire codebase surfaced and fixed:

- **HIGH (safety):** position monitor wrapped each contributor's
  `buildFetchBox` and `evaluate` in its own try/catch. A throwing
  contributor (e.g. a route-hazard fetch box crashing on a bad Course API
  response) no longer short-circuits the proximity alarm for the same
  tick.
- **HIGH (correctness):** the NOAA ENC client's pagination loop now
  caps at 200 pages so a server pinning `exceededTransferLimit: true`
  forever cannot exhaust memory. The light-list store now validates the
  on-disk JSON shape before use so a hand-edited or partial-write file
  cannot crash `Object.values(undefined)` on the next list query. The
  NOAA ENC source now rejects when every enabled layer query fails so
  the aggregate registry's "any source succeeded" check trips correctly
  instead of recording a bogus `recordListFetch(0)` and flipping
  `apiReachable` to true.
- **MED (reliability):** raw `node:http` clients in the USCG and NOAA
  ENC paths now enforce a 60-second per-request timeout so a silently
  dropped TCP connection cannot block the refresh loop. The USCG Light
  List refresh scheduler has an in-flight guard so a slow refresh pass
  cannot race a concurrent one. The status router is now idempotent
  across plugin enable / disable / enable cycles (no stacked admin
  middleware, no duplicate route handlers).
- **MED (status correctness):** `PluginStatus.recordSkipped` now sets a
  per-source `justSkipped` flag and the aggregate input registry checks
  it before recording an empty list result. A US-only source that
  skipped because the vessel is outside US waters no longer overwrites
  its previous `lastListFetch` with a bogus `recordListFetch(0)`, and
  `apiReachable` is no longer flipped to `true` on a request that was
  never sent. NOAA ENC `getDetails` no longer records detail success
  on a cache hit, so a stale `apiReachable: false` cannot flip to
  `true` from a user clicking a previously loaded marker.
- **MED (data correctness):** the route-hazard fetch bbox now uses the
  monitor's fresh `tickPosition` rather than the courseReader's
  independent `readPosition`, closing a fetch-vs-scan gap where a
  hazard sitting between the vessel and the first waypoint could be
  scanned without being fetched.
- **LOW (cleanup):** `resolveRadius` and `resolveCorridorWidth` reject
  Infinity (a hand-edited config file would otherwise propagate NaN
  through `positionToBbox` into the outbound URL). The notes-resource
  output's skIcon fallback is now `notice-to-mariners` (a registered
  Freeboard icon) rather than `type.toLowerCase()` (which produces
  unregistered names like `boatramp`). `sanitizePoiId('')` falls back
  to `_` so two empty-id POIs cannot collide on the same notification
  path. The intra-source dedupe pass now respects each source's dedupe
  toggle, so a user who turned dedupe off for OpenSeaMap sees their
  raw OSM feed un-collapsed.
- **LOW (UX):** the NOAA ENC collapsed accordion summary now uses the
  same friendly band labels ("Harbor") as the expanded selector, not
  the raw wire value ("harbour"). The "ActiveCaptain resources are
  read-only" message in the notes resource output is relabelled to
  "Crow's nest notes resources are read-only" because the output now
  serves four sources. An "Always on" badge replaces the disabled
  checkbox on the always-on ActiveCaptain card so it does not visually
  read as an unavailable toggle. The NoaaEncSource card surfaces a
  "choose at least one layer" hint when every hazard toggle is off.
- **LOW (hooks):** the panel's `markSaved` callback is now identity-stable
  across renders, so typing in any field no longer re-renders the
  FooterBar on every keystroke. The `useNumberDraft` hook now clears
  its draft when the parent commits an external value (e.g. a Discard
  restoring the saved snapshot), so the input no longer shows stale
  typed text until the user blurs.

#### Documentation

- CLAUDE.md, README.md, docs/roadmap.md, and docs/development.md gain
  the two new source sections. The earlier `61 (district, page) pairs`
  count is corrected to `37` across docs and code comments after live
  verification on the boat Pi found the true pinned count.

<a id="v050"></a>

### v0.5.0 (2026/05/22) - multi-source points of interest

**The plugin is now multi-source: it adds OpenSeaMap alongside Garmin
ActiveCaptain, merges the two into one chart layer, and gives each source its
own health and settings.**

#### OpenSeaMap source

- A new opt-in source imports OpenSeaMap (OpenStreetMap marine data) through
  the OSM Overpass API: seamark hazards (rocks, wrecks, obstructions),
  navigational aids (lights, buoys, beacons), harbours and marinas, and
  infrastructure (locks, bridges). Each feature group can be toggled
  independently. The source is off by default; the Overpass endpoint URL is
  configurable.
- OpenStreetMap data is published under the Open Database License (ODbL),
  which requires visible attribution. Every OpenSeaMap point's rendered detail
  carries an `© OpenStreetMap contributors (ODbL)` footer.

#### Multi-source aggregate

- With more than one source enabled, the plugin fans each `notes` query out to
  every source, unions the results, and serves them as one layer. A failing
  source no longer blanks the chart: the layer is served from whichever
  sources answered.
- Resource ids gain a source prefix (`activecaptain-123456`,
  `openseamap-node_987654`). A single-ActiveCaptain install sees its note ids
  change from `123456` to `activecaptain-123456`; `getResource` round-trips
  the prefixed id. The OpenSeaMap source uses an underscore-separated
  internal id form (`node_123`, not `node/123`) so a slash inside the raw OSM
  id never splits the SignalK `/resources/notes/<id>` path.
- Per-source dedupe: an OpenSeaMap point of interest that duplicates an
  ActiveCaptain marker of the same type, within a configurable radius
  (default 150 meters), is merged into it. A second pass collapses
  same-source duplicates within the same radius, so a feature OSM tagged
  twice (typically once as a node and once as a way) still becomes one
  note. The surviving note records every contributing source as a
  corroboration signal (`properties.sources` and `properties.sourceCount`).
  Dedupe is on by default and can be turned off per source; the radius is
  exposed as a panel field.
- Every POI is mapped at the source to a Freeboard-registered icon, since
  Freeboard's icon registry is fixed and an unregistered name silently
  renders as a default yellow square. The icon hint travels with the POI
  through the new source-agnostic `PoiSummary.skIcon` /
  `PoiDetailView.skIcon` field. OpenSeaMap maps every `seamark:type`
  individually: rocks, wrecks, and obstructions render as hazards; harbours
  and marinas as marina markers; locks, bridges, anchorages, anchor berths,
  and moorings as their direct icons; lights, beacons, buoys, and landmarks
  as `navigation-structure`; isolated-danger buoys and beacons as hazards
  even though their `PoiType` stays `Navigational` so they do not falsely
  trigger the proximity alarms. ActiveCaptain maps every `PoiType` to a
  Freeboard-registered icon; the three types with no direct glyph
  (`LocalKnowledge`, `Navigational`, `Airport`) route to
  `notice-to-mariners` or `navigation-structure` rather than silently
  breaking.

#### Per-source status and the accordion panel

- The status snapshot is now per-source: each enabled source reports its own
  API reachability and last fetch. The configuration panel restructures into a
  per-source accordion (a collapsible card per data source) followed by an
  Alerts section.

#### Notification path rename

- The proximity and route-hazard alarms move from
  `notifications.navigation.activecaptain.{hazard,route}.*` to
  `notifications.navigation.crowsNest.{hazard,route}.*`, since a hazard from a
  non-ActiveCaptain source on an `activecaptain` path is wrong. A hot upgrade
  leaves any stale `activecaptain.*` notifications in place until the next
  Signal K server restart.

#### Correctness fixes

- The minimum-rating filter is now scoped to the ActiveCaptain source. It
  was applied to the merged POI list, which silently dropped every
  OpenSeaMap point of interest (the OSM data carries no average rating).
- The ActiveCaptain attribution footer is appended once, not twice. The
  shared `appendAttribution` helper now owns the footer, so the renderer no
  longer adds a duplicate `Data sourced from Garmin Active Captain` line.
- A failed output start is surfaced via `setPluginError` (matching how a
  failed monitor start is surfaced) rather than left as a bland "Ready"
  status that masked a dead output.
- `assemblePluginSchema` now throws a clear message if a key in the schema's
  `required` array is not actually declared by any module, so a renamed or
  dropped owner-module is caught at assembly time rather than producing a
  schema with a required slot that has no backing property.

#### Refactors and shared plumbing

- A single shared HTTP client (`src/inputs/http-client.ts`) underlies both
  the ActiveCaptain and the OpenSeaMap source: one concurrency-limited and
  throttled request queue, one retry-with-backoff that honors `Retry-After`,
  one `close()` that aborts in-flight work.
- A single shared notification tracker (`src/shared/notification-tracker.ts`)
  owns the raise/clear bookkeeping the proximity-alarm and route-hazard
  outputs both need, so the clear-half of each alarm lives in one module.
- The ActiveCaptain summary-API wire types (`PointOfInterest`, the section
  types, `Availability`, `PoiDetails`, etc.) move from `src/shared/types.ts`
  to `src/inputs/active-captain/active-captain-types.ts`. `src/shared/types.ts`
  now holds only the cross-module, source-agnostic contracts.
- The OpenSeaMap seamark group ids and labels move to
  `src/shared/seamark-groups.ts` as the single source of truth, consumed by
  the OpenSeaMap input, its config-schema fragment, and the panel.
- The per-source POI detail caches share one `MAX_POI_CACHE_ENTRIES`
  ceiling from `src/shared/cache.ts`; the `toFiniteNumber` narrowing helper
  moves to `src/shared/numbers.ts` and replaces three ad-hoc copies; the
  route-corridor leg-point chain and corridor-type list, and the
  position-monitor tick fix, each live in one named module rather than
  being inlined per call site.
- The `poi-store` debounces its disk writes, so a burst of detail loads
  collapses into a single rewrite of the cache file instead of one rewrite
  per POI.
- The attribution footer's CSS class is now the source-agnostic
  `crows-nest-attribution` rather than the ActiveCaptain-flavoured
  `ac-attribution`.

#### Configuration panel

- The numeric fields share one `NumberField` row layout (label, input
  backed by `useNumberDraft` so the input can be cleared mid-edit, and hint
  text); the proximity and route-hazard alarm controls share one
  `AlarmFieldset` toggle-plus-numeric layout. The panel imports the
  OpenSeaMap seamark groups from the shared module so its checklist stays
  in lockstep with the schema. Style names are source-neutral, the style
  table is now key-typed, and the per-source card bodies were tightened
  for accessibility (matching `aria-*` attributes, stable callbacks, and
  a shared number formatter).

#### Tests

- The duplicated test stubs (a stub SignalK app and a POI-summary builder)
  are lifted into `test/helpers.ts` and reused across the suite. New
  coverage was added for previously untested branches of the panel
  reducer, the config normaliser, and the relative-time formatter.

<a id="v040"></a>

### v0.4.0 (2026/05/22) - route-corridor hazard scan

**The plugin can now scan the active route ahead and warn about hazards,
bridges, and locks along it.**

#### Route-corridor hazard scan

- A new opt-in option, "Scan the active route ahead for hazards, bridges, and
  locks", reads the vessel's active route from the Signal K Course API. As the
  vessel moves, the plugin checks the route ahead for Hazard, Bridge, and Lock
  points of interest that lie within the configured corridor width of the
  route line, and emits a Signal K
  `notifications.navigation.activecaptain.route.*` notification for each one.
- Each notification carries the point of interest's along-track distance and,
  when the speed over ground is known, an ETA. It is raised once when the
  point first appears on the route ahead and cleared once it is no longer on
  the route ahead, so the warning does not chatter.
- The corridor width is configurable; the feature is off by default.
- The scan reuses the position monitor's existing tick and its single
  point-of-interest fetch, so it adds no extra API traffic. The fetch's
  bounding box is widened to enclose the route ahead, up to a 10 NM
  look-ahead window that slides forward as the vessel advances. A point of
  interest beyond the look-ahead, or beyond the distance at which the
  ActiveCaptain API starts returning clustered results, is picked up on a
  later tick as the window slides forward.

<a id="v030"></a>

### v0.3.0 (2026/05/22) - position-aware safety

**The plugin gains a position-aware safety feature set: proximity hazard alarms, an offline cache, a rating filter, and stale-hazard warnings.**

#### Proximity hazard alarms

- A new opt-in option, "Emit a notification when the vessel nears a hazard",
  subscribes to `navigation.position`. When the vessel comes within the
  configured radius of a Hazard point of interest, the plugin emits a SignalK
  `notifications.navigation.activecaptain.hazard.*` alert that chart plotters
  and Freeboard-SK render as an alarm. The notification is raised once on
  approach and cleared once the vessel moves a margin beyond the radius, so the
  alarm does not chatter on the boundary.
- While the feature is on, the plugin scans for nearby hazards as the vessel
  moves, throttled by distance and time so it stays within the API limits.
- The alarm radius is configurable; the feature is off by default.

#### Persistent, offline cache

- Point-of-interest detail is now cached on disk in the plugin data directory,
  so it survives a server restart and is readable with no connectivity. The
  cache still honours the configured caching duration.

#### Rating filter

- A new "Minimum rating" option hides points of interest rated below the
  chosen value (0 to 5; 0 shows everything), cutting clutter on dense charts.

#### Hazard freshness

- A Hazard point of interest whose report has not been confirmed in over two
  years now carries a prominent freshness warning in its description.

<a id="v020"></a>

### v0.2.0 (2026/05/21) - TypeScript rewrite, modern toolchain, and a React configuration panel

**The plugin has been rewritten in TypeScript, its toolchain modernized, covered with an automated test suite, and given a dedicated React configuration panel.**

#### TypeScript migration

- The plugin source moved from JavaScript under `plugin/` to modular
  TypeScript under `src/`, compiled to `dist/` by `tsc` in strict mode.
- The code is split into focused modules: the HTTP client, the detail cache,
  the geometry helpers, the resource-query parser, the POI-type selection,
  the Handlebars rendering, the inlined templates, and the shared type
  contracts in `src/types.ts`.
- The Handlebars templates and partials, previously separate files, are
  inlined as string constants so no extra files need to be published.

#### Dependency and toolchain modernization

- The HTTP client uses the native `fetch` API, with rate limiting, exponential
  backoff, and `Retry-After` support.
- The detail cache is a TTL cache backed by `lru-cache`. `handlebars` and
  `lru-cache` are the only runtime dependencies.
- Linting moved to ESLint 9 with the neostandard flat config, replacing the
  older `eslint-config-standard` setup.
- The project targets TypeScript 6 and Node.js 20 or newer.
- A CI workflow builds, type-checks, tests, and lints on Node.js 20 and 22.

#### Automated test suite

- A `node:test` suite, run through `tsx`, covers the HTTP client, the detail
  cache, the geometry helpers, the resource-query parser, the POI-type
  selection, the Handlebars rendering, the status recorder, and the panel
  config reducer.

#### React configuration panel

- The plugin ships its own configuration panel: a federated React app that the
  Signal K admin UI loads through Module Federation, bundled to `public/` by
  webpack.
- The panel adds a live status section (Garmin API reachability, cached
  point-of-interest count, last fetch, and recent errors), a cache-duration
  field, and the 13 point-of-interest types arranged in labelled groups with
  All and None buttons.
- A small admin-gated HTTP endpoint on the plugin side serves the status
  snapshot the panel polls.
- The panel requires Signal K admin UI 2.26.0 or newer; on older servers the
  plugin still works and falls back to the standard generated settings form.

#### Richer point-of-interest detail

- Point-of-interest descriptions now render the `services`, `retail`,
  `mooring`, and `navigation` summary sections, and a featured user review.
  These were already in every cached API response but were not displayed.
- This needs no extra API traffic. Anchorages gain the most: their mooring and
  navigation detail was previously fetched but never shown.
- Service and retail listings show only capabilities with a known answer, so a
  long section is not padded with crosses for every unrated field.

#### Review hardening

- A multi-angle code review drove a round of correctness fixes: the status
  recorder is rebuilt on each plugin start so a restart no longer shows a stale
  start time or carried-over errors; a `Retry-After` header is now capped so a
  large value cannot stall a request for minutes; malformed elements in a
  bounding-box response are skipped instead of failing the whole search; a
  `'Nearby'` capability now renders a line rather than an empty section header;
  amenity notes and free-only dockage are no longer dropped; a 404 for a
  missing point of interest no longer flips the panel to "API unreachable";
  the status panel no longer stacks overlapping polls; the great-circle math
  is clamped against a floating-point edge case near the poles; and
  `getResource` honours the SignalK resource-property request form.
- A follow-up gap sweep added more fixes: deselecting every POI type now
  imports nothing instead of falling back to all types; the status no longer
  reports the API as reachable on a cache hit that made no request; the
  mooring total is shown; `eslint-plugin-react` is a declared dependency; the
  test suite is now type-checked in CI; and the panel build clears stale
  artifacts.
- A SignalK and Garmin API expert review drove a further round. The most
  important fix: the resource provider is now registered on every plugin
  start, because the SignalK server unregisters it on every stop, so a
  configuration change previously left the `notes` type with no provider
  until a full server restart. Also: capability sections render an `'Unknown'`
  field as no line rather than a misleading red cross; bounding-box cluster
  entries (which cannot be fetched individually) are dropped; the navigation
  current strength, tidal range, approach depth, and dockage berth counts are
  rendered; multi-line notes keep their line breaks; ActiveCaptain timestamps
  are read as UTC; in-flight requests are aborted on stop; the plugin reports
  health through `setPluginStatus`, and documents its HTTP API with
  `getOpenApi`.
