## Change Log

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
  `openseamap-node/987654`). A single-ActiveCaptain install sees its note ids
  change from `123456` to `activecaptain-123456`; `getResource` round-trips
  the prefixed id.
- Per-source dedupe: an OpenSeaMap point of interest that duplicates an
  ActiveCaptain marker of the same type, within a short radius, is merged into
  it. The surviving note records every contributing source as a corroboration
  signal (`properties.sources` and `properties.sourceCount`). Dedupe is on by
  default and can be turned off per source.

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
