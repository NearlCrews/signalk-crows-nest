# Changelog

All notable changes to Crow's Nest are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on version numbering.** 0.4.2 is the first release published to
> npm. The version entries below it (0.5.0 through 0.2.0) describe
> development milestones that preceded this publication. Their content is
> incorporated into the 0.4.2 release.

<a id="v0103"></a>

## [0.10.3] - 2026-06-25

A hardening pass on top of 0.10.2: route-draft safety and boundary fixes, a
first-run Save fix in the admin panel, and a refresh of the development
dependencies. No configuration changes, and no runtime dependencies changed;
existing setups are unaffected.

### Fixed

- **Route draft: flag every unverified dimension when a safety provider fails.**
  When a leg's safety provider errored, the check emitted a single depth-worded
  note and still treated that provider as having covered its dimensions, so a
  failure of the worldwide land provider on a leg could leave land unverified yet
  unflagged. The check now counts only providers that returned data, so every
  dimension a failed provider could not verify is called out explicitly, and the
  mislabeled per-leg note is gone.
- **Route draft: warn when a long AI route is truncated to the waypoint cap.** A
  model route with more turning waypoints than the cap keeps could stop short of
  the destination with no warning. The model is now told the cap so it
  self-limits and still reaches the end, and a kept straight route that was
  truncated carries an explicit caveat.
- **Route draft: drop a hallucinated waypoint near the antimeridian.** The
  trust-boundary check that discards a model waypoint far outside the
  requested chart window skipped its longitude test entirely when the window
  crossed the antimeridian (west longitude greater than east), so a point
  anywhere along that latitude band could slip through. The check is now
  wrap-aware and judges every waypoint by its true angular distance from the
  window center, so a just-off-screen turn still survives while a far-off
  hallucination is dropped.
- **Channel router: never request a water tile past the map edge.** A routing
  window whose eastern or pole-ward edge landed exactly on a tile boundary
  (longitude or latitude at the +/-180 or pole extreme) could compute a tile
  index one past the last real tile. The tile range is now clamped to the
  valid grid, so the water fetch never asks for a tile that does not exist.
- **Admin panel: allow Save on an as-yet-unconfigured plugin.** Save was
  disabled until the plugin already had a stored configuration, which blocked
  writing the defaults needed to enable it the first time. Save is now
  available so the defaults can be saved to turn the plugin on.

### Internal

- Brought the development dependencies current: `@signalk/server-api` 2.25 to
  2.28, `webpack` 5.107 to 5.108, and `@types/node` to 25.9.4. No runtime
  dependencies changed and `npm audit` stays clean. ESLint stays on 9 (the
  neostandard flat config peers to `eslint ^9`) and Babel stays on 7
  deliberately.
- Added regression tests for the wrap-aware antimeridian waypoint check, and
  documented the previously implicit grid-rasterization cell-center shift, the
  navigable-grid cell-coarsening growth factor, the EMODnet all-null gap case,
  and why the in-band and cross-provider hazard-dedupe keys round to different
  precisions.
- Added orchestrator tests for a failed depth provider and a failed sole land
  provider, and parser tests for the route-truncation marker. Documented that the
  ENC standoff check samples land-area ring vertices, a standoff advisory rather
  than a crossing test (land crossings are caught separately, so an
  under-measured standoff is never a false safe).

<a id="v0102"></a>

## [0.10.2] - 2026-06-21

A maintainer hardening pass that fixed two edge-case routing bugs, shrank the
configuration panel's browser bundle, and tightened a handful of types,
comments, and tests. No configuration changes, and no new dependencies;
existing setups are unaffected.

### Fixed

- **Channel router: decline instead of returning a one-waypoint route.**
  When a drafted or drawn route's start and end snapped to the same
  navigable grid cell (a closed loop, or two near-identical drawn
  waypoints), the router could return a degenerate single-waypoint
  "success" with no legs to safety-check. It now declines cleanly so the
  caller keeps the original geometry and attaches the channel-unavailable
  note.
- **OpenSeaMap Overpass client: stop endpoint failover on a caller abort.**
  When the route-draft deadline aborted an in-flight Overpass query, the
  client would still fail over and issue fresh requests to every configured
  fallback mirror for a check no one was waiting on. An aborted caller
  signal now stops failover at once.

### Internal

- **Smaller configuration-panel bundle.** Split the bbox-debounce refresh
  bounds into a dependency-free module so the React panel no longer pulls
  the node-only `lru-cache` library into the browser bundle.
- Made the EMODnet leg-safety client's injected-transport type track the
  real one-shot GET signature, gave the USCG `NAME` wire field its honest
  nullable type, guarded the bundled country-boundary asset against a
  malformed-shape feature, and named the failing tile in the vector-tile
  gunzip error. Added regression tests for both fixes above and corrected a
  comment drift in the proximity-alarm tests.

<a id="v0101"></a>

## [0.10.1] - 2026-06-21

A quality-only pass that dedupes a few shared helpers and trims some
small redundancies. No behavior change, no new configuration; existing
setups are unaffected.

### Internal

- Extracted the bounded-concurrency worker pool that the route-draft
  leg-safety check and the USCG Light List refresh each hand-rolled into a
  single shared `mapWithConcurrency` helper, and routed both through it.
- Shared the isometric-latitude formula and its east-west epsilon across
  the two loxodrome helpers, the latitude/longitude validity guards and the
  range clamp through the canonical finite-number helpers, and the
  covered-legs-to-waypoints stitch across the two route-draft hazard
  providers. Folded the channel router's water-index bounding-box union into
  one pass, collapsed the dedupe radius's min clamps, and dropped a needless
  panel memo and an orphaned comment.

<a id="v0100"></a>

## [0.10.0] - 2026-06-17

The plugin gains an optional, admin-gated, beta AI route-draft endpoint whose
safety check covers routes worldwide, plus the charted-depth capability that
backs it. AI route drafting is in beta: it cannot guarantee accuracy, so every
drafted route must be verified against the official charts before it is used for
navigation.

### Added

- **AI route drafting (beta, optional, admin only, off until an OpenRouter key is
  set).** A new `POST /api/route-draft` endpoint turns a plain-language passage
  request into a drafted route: OpenRouter proposes the turning waypoints, then
  owned code checks every leg, resolving data providers per leg by the union of
  every provider whose coverage reaches the leg, and computes a deterministic
  fuel estimate. This feature is in beta and cannot guarantee accuracy: the route
  is always a draft the navigator verifies against the official charts before
  saving, and the depth check reads the charted depth-AREA contour, not the depth
  at every point. A new Route drafting panel card configures the masked
  OpenRouter key, the model, a daily call cap, and the vessel, fuel, and routing
  inputs.
- **Optimize a drawn route.** `POST /api/route-draft` now also accepts an optional
  `route`, the navigator's drawn waypoints. When present, the endpoint refines that
  route instead of drafting from words: it keeps the drawn start and destination,
  moves and adds turning waypoints only as needed to clear the charted and modeled
  hazards with the standoff, and runs the same worldwide per-leg safety check and
  fuel estimate. The plain-language prompt becomes an optional one-line hint, and
  the response carries an `optimized` marker so a client can confirm the route was
  consumed. Documented in `docs/route-draft-api.md`.
- **Channel routing follows the water.** Where charted depth (US ENC) or mapped
  water covers the passage, the endpoint replaces the model's straight legs with a
  deterministic water-following route computed in owned code (a depth-aware
  navigable grid plus A* over it), so the drafted waypoints follow the channel
  rather than cutting across land. Mapped water is read from vector tiles, the
  OpenStreetMap-derived water layer the chart base map renders, where each water
  body is a pre-clipped polygon and an island is a hole in it; because the tiles
  are pre-clipped, big water and coastline-bounded bodies route worldwide, inland
  or on the coast. The grid avoids charted and mapped land, including the island
  holes, and the returned route is re-checked at full polygon resolution so a
  returned channel route never crosses land. Where no coverage is available, where
  the passage is too large to cover within the tile budget, or where routing is
  skipped to leave the safety check time, the model or drawn geometry is kept and a
  route-level note says which. A route built on a mapped water outline carries an
  explicit depth-unverified caveat, since tile water is generalized for display and
  carries no depth.
- **Worldwide route-draft safety check.** The check now covers routes worldwide,
  not US ENC waters alone. Per leg it runs the union of every applicable
  provider: NOAA ENC charted depth-area contours, charted land, and charted
  point hazards in US waters; OpenSeaMap rock, wreck, and obstruction point
  hazards and an OpenStreetMap coastline land check worldwide; and EMODnet
  modeled depth, awareness-grade and referenced to Lowest Astronomical Tide
  (LAT), explicitly not charted, in European seas. Every dimension is either
  checked with its value and datum stated or flagged explicitly as not checked,
  never silently passed, and where providers overlap, ENC charted depth and land
  win and hazards charted by more than one source are flagged once. The check is
  fully automatic, with no new panel configuration. EMODnet bathymetry is used
  under CC-BY 4.0 attribution, and the OpenStreetMap coastline under ODbL.
- The NOAA ENC input gained a charted `Depth_Area` and `Land_Area` polygon
  query that the route-draft depth check reads as an internal capability. The
  check spans the harbour through general usage bands, so harbour and river
  passages are covered, not only open-coast ones.
- The route-draft endpoint reports each OpenRouter failure with guidance the
  operator can act on: an invalid or missing key points at the plugin key, an
  empty credit balance points at the OpenRouter dashboard, and a moderation or
  permission block is reported as a refused request to rephrase. A moderation
  block is no longer mislabeled as an authentication error.
- Border-aware route drafting (part of the beta AI route-drafting feature; still
  a draft to verify against the official charts before use). When a drafted
  route's start and destination are in the same country,
  the channel router keeps the path in that country's waters instead of taking the shortest water path
  across an international border, so a Detroit River route between two US points stays out of Canadian
  water. Where no in-country water route exists it still returns the crossing route, with a note that it
  crosses the international boundary. It covers the inland and boundary-lake waters that a bundled,
  simplified country dataset partitions (the Great Lakes and their connecting rivers); marine and
  different-country routes are unchanged.

### Changed

- The configuration panel is decluttered with progressive disclosure: each data
  source card now shows only its import choice by default (POI types, seamark
  groups, or scale band and layers), with the refresh cadence, year filter,
  merge radius, cache duration, and Overpass endpoint tucked under a per-card
  Advanced section. The Route drafting section gains the same treatment, and its
  field name now leads its hint visually. New shared `Fieldset` and `Disclosure`
  panel primitives back the grouping.
- The Alerts and Route drafting sections now start collapsed, so the panel opens
  compact and the operator expands a section when wanted. The Data sources
  section still defaults open.
- The route-draft endpoint and the status route now share one admin gate that
  fails closed: if the server admin middleware cannot be installed, neither
  route mounts, so the budget-spending endpoint is never left ungated.
- The configured OpenRouter model now leads each request, with the known-good
  models as fallback, and the configured closest-hauled tacking angle now
  reaches the model for a sailing vessel, so both settings take effect rather
  than being inert.
- The route-draft check now scans point hazards across every configured scale
  band, deduped by charted position, so a hazard charted only at a coarser band
  is still flagged, matching the depth sweep.
- A drafted waypoint far outside the requested chart window is dropped as a
  hallucination, an unexpected server error no longer reflects its internal
  detail to the caller, and the daily call cap, which counts failed attempts
  too, now says so in the panel.
- Renamed the bridge-clearance message formatter to `formatClearanceMeters`,
  resolving a name collision with the shared `formatMeters` that formatted the
  same value with a different number of decimals.
- Single-sourced several duplicated values: the ActiveCaptain point-of-interest
  base URL, the route-draft synthetic route id, and the OpenSeaMap two-tag name
  lookup each now live in one place.
- Reduced per-call work on several paths: the channel router builds its
  decimation input in one pre-sized pass instead of three and propagates each
  charted band's decision over only the cells it touched, the scanline
  rasterizer reuses one row buffer, the OpenSeaMap detail tags are read once per
  fetch and shared by the HTML and structured renderers, and the
  notification-path and bbox-debounce sanitizers hoist their regexes to module
  scope.
- Removed the unused open-polyline coastline helpers from the route-draft leg
  geometry, left over after the land check moved to the vector-tile water
  outline.
- The ENC and OpenSeaMap route-draft hazard sweeps now share one
  `corridorHazardFlags` helper that stitches the covered legs, scans the
  corridor, and maps each matched hazard to its leg, so the two providers differ
  only in how they fetch and word their hazards and the leg-mapping cannot drift
  between them.
- Single-sourced the route-draft logger: the endpoint and the channel router
  adapt the SignalK app to the project logger through one shared `appLogger`
  helper instead of building the same adapter object in each place.
- The OpenSeaMap route-draft land check precomputes each water polygon's bounding
  box once and skips the full ring scan for a sampled point outside that box, so a
  leg sampled at fine spacing over many water polygons does far less work.

### Fixed

- AI route drafting no longer hangs or times out on a route over dense charted
  coverage (a Great Lakes or Chesapeake bounding box returns one to two thousand
  charted areas). The channel router's navigability checks scanned every polygon
  per sampled point with no spatial index, and the route-decimation pass had no
  deadline check, so the synchronous work could run for minutes past the request
  deadline, blocking the server and keeping it busy after the client gave up. The
  router now indexes the charted and water polygons in a per-route spatial grid,
  checks its internal legs against its own navigable grid, and bounds the
  decimation pass by the deadline. A 15-route Great Lakes sweep that previously
  ran two to five minutes per route, or timed out, now returns in eight to thirty
  seconds.
- The notes-resource plugin status reads "1 point of interest" or "N points of
  interest" rather than a "point(s)" plural placeholder.
- The Route drafting panel labels its propulsion control consistently for both
  sighted and screen-reader users.
- The configuration panel cancels its in-flight unit-preference requests on
  unmount, and rejects a non-object status response instead of committing it.
- The route-draft default closest-hauled tacking angle is now 45 degrees off the
  true wind, a realistic cruising pointing angle, rather than 100 degrees, which
  had the model add tacks on legs a normal vessel would lay. It stays
  user-configurable per vessel.
- The channel router's path simplification no longer risks a stack overflow on a
  long winding route. The Ramer-Douglas-Peucker reduction of the A* centerline,
  which can run to thousands of cells, now walks an explicit stack instead of
  recursing, so a deeply winding path cannot exhaust the call stack. The output is
  identical to the recursive form.
- The vector-tile water source no longer collaterally fails concurrent tile
  fetches when one caller's deadline aborts. The shared resolution of the tile-URL
  template is bounded by the client's own request timeout and stop controller, not
  by any one caller's abort signal, so one route's deadline can no longer cancel
  the template lookup that other concurrent routes are awaiting. Each caller's
  signal still bounds its own tile fetch.
- The route-draft bbox tile splitter now rejects a non-positive or non-finite span
  rather than looping forever, and the shared abort-signal combiner now rejects an
  all-undefined call rather than returning a signal that never aborts, turning two
  latent ways to leave the event loop hung into loud errors.

### Internal

- Shared the nautical-mile constant and conversion, the `Retry-After` header
  parser, and the finite-number guard across the modules that held copies. The
  route-draft depth check now runs each leg's per-band charted-area queries
  concurrently and processes legs through a small bounded-concurrency pool, and
  it cancels its in-flight ENC queries when the request deadline passes.

<a id="v090"></a>

## [0.9.0] - 2026-06-12

The configuration panel now follows the server's unit preferences, the
default merge radius is rethought in feet, and a consolidation pass
hardens the USCG store, pins the ENC layer table, and dedupes shared
helpers across the plugin, the panel, and the test suite.

### Added

- The configuration panel now follows the Signal K server's unit
  preferences: when the active preset targets feet (any Imperial preset),
  every length field (alarm radius, corridor width, vessel air draft,
  clearance margin, and the three merge radii) displays and accepts feet,
  converting at the display edge. The saved configuration stays in meters,
  the per-user preset override from the admin UI's Units page is honored,
  and a server without the unit-preferences API falls back to meters.

### Changed

- The default merge radius for deduplicating a feature reported by several
  sources is now 150 feet (45.72 m, was 150 m), so two genuinely distinct
  neighbors are less likely to collapse into one marker by default. Widen
  the per-source "Merge radius" field to catch larger cross-source
  placement gaps.
- New plugin icon badge: the crow's-nest barrel glyph is replaced with a
  lighthouse silhouette (tapered tower, lantern with light dot, peaked
  roof, and two sweeping beams) on the crimson badge. The family base
  (deep-ocean gradient and three wave lines) is unchanged, and all PNG
  sizes are regenerated from the new SVG.
- The USCG Light List on-disk store now validates every required record
  field when loading from disk. Previously only the two fields used in the
  list query were checked; a record with any missing required field is now
  rejected rather than silently kept.
- Panel fields for cache duration, alarm radius, and corridor width now
  read their minimum bounds from the shared modules
  (`MIN_CACHE_DURATION_MINUTES`, `MIN_PROXIMITY_ALARM_RADIUS_METERS`, and
  `MIN_ROUTE_CORRIDOR_WIDTH_METERS`), keeping the form and the config
  normalizer consistent.
- The ENC ArcGIS REST layer-id table is now pinned by a dedicated test, so
  a change in the upstream layer assignments is caught before it ships.

<a id="v082"></a>

## [0.8.2] - 2026-06-11

A whole-codebase cleanup, a configuration-panel modernization in the style
of the signalk-nmea2000-emitter-cannon panel, and a caching overhaul built
on the observation that POI data is nearly static: a buoy does not move,
and a harbor rarely changes. All 743 tests pass.

### Added

- Tile prefetch: when a small viewport (the vessel-centered alarm scan, or
  a close-zoom chart view) approaches a tile edge, the neighbor tile warms
  in the background, so a vessel underway crosses the grid cliff onto an
  already-fetched tile instead of blocking the proximity-alarm scan path.
- Theme system: light, dark, and a red-preserving night theme for night
  vision at the helm, pinnable from a new theme toggle (persisted as
  `ac-theme`) with scale tokens and `color-scheme` so native widgets follow.
  The SignalK admin has no theme switcher of its own, so the toggle is how
  dark and night mode are reached.
- Unsaved edits now warn before a tab close or reload, the footer is sticky
  so Save stays reachable, and the status bar shows a "checked Ns ago"
  freshness note.
- Recent errors in the status bar are clickable: they expand and scroll to
  the source card the error belongs to.
- A getting-started callout points at the off-by-default sources while none
  is enabled.

### Changed

- Offline-first ActiveCaptain details: the on-disk store now keeps its own
  30-day, entry-capped retention independent of the freshness TTL, old
  entries hydrate as stale-but-usable, and a lapsed entry whose refetch
  fails (offline, API down) is served instead of rejected. Previously the
  offline store was emptied by the same TTL that governed refetching, so a
  restart more than an hour after the last fetch hydrated nothing.
- The ActiveCaptain detail freshness TTL default rose from 1 hour to
  24 hours: with stale-on-error in place the TTL governs upstream traffic,
  not data availability.
- Per-source viewport-cache defaults now match each upstream's real update
  rate: ActiveCaptain stays at 30 seconds, OpenSeaMap defaults to
  10 minutes, and NOAA ENC Direct (refreshed weekly by NOAA) to 30 minutes,
  with the configurable maximum raised to one hour. The
  stale-while-revalidate design means longer windows have no latency cost.
- The viewport cache keeps 64 tiles per source (up from 16), enough for a
  full day's coastal passage instead of evicting the morning's tiles.
- The USCG Light List background refresh default stretched from 6 hours to
  daily (NAVCEN publishes weekly; conditional GET makes the check cheap),
  and resolved bridge clearances stay fresh for 24 hours instead of 6.
- Marine touch sizing: 22px checkboxes with accent fill and 36px minimum
  control heights.
- Field hints are programmatically linked to their controls
  (`aria-describedby`) through a new shared `LabeledField` scaffold.
- Every bounded numeric config key now shares one clamp-plus-schema pattern,
  with generous upper bounds so a hand-edited config cannot blow up a scan
  box or pin a cache forever; the panel and the runtime resolve values
  through the same shared helpers, including the USCG refresh period, which
  the panel now clamps the way the scheduler does.
- Duplicated wire readers consolidated (`presentString`,
  `finiteOrUndefined`, `isKnown`), the USCG source-slug literals routed
  through the shared constant, and the structured phone item now rides as a
  `tel:` link matching the HTML popup.
- The bridge air-draft and route-hazard outputs share one clearance resolver
  per run, so the same bridge is never resolved and cached twice.
- Per-request debug log arguments are built only while the admin debug
  toggle is on, the NOAA list path caches only year-filter survivors, and
  the panel memoizes its sections so a status poll re-renders only the
  status bar and a keystroke no longer re-renders the whole panel.

### Fixed

- A start-time failure (dead position monitor or failed output) now latches
  the plugin error in the admin UI: the notes provider's per-request healthy
  status no longer overwrites the "safety alarms are not running" message
  seconds after start.
- An OpenSeaMap or NOAA ENC detail request for a feature that no longer
  exists upstream is recorded as a normal not-found rather than flipping the
  source's health row to unreachable; the policy now lives in one shared
  helper (`fetchDetailRecorded`) mirroring the ActiveCaptain 404 handling.
- Alarm notifications keep their `createdAt` at the start of the alarm
  episode across refreshes and the clear delta, stamped centrally by the
  shared notification tracker.
- ActiveCaptain detail responses now validate latitude and longitude the way
  the list path always has, so a malformed detail cannot place a bad marker.
- The queued HTTP client's `close()` tears down immediately: pending
  throttle timers are cleared and queued waiters rejected, instead of firing
  one doomed request per throttle interval after stop.

### Removed

- Dead code removed: the unused `seamarkToPoiType` and `seamarkSkIcon`
  wrappers (tests now exercise `elementMarking`, the shipped reader), the
  notification tracker's unused `entries()` and public `clear()`, and three
  internal proximity-radius constants are no longer exported.

<a id="v081"></a>

## [0.8.1] - 2026-06-04

Endpoint and data-source maintenance, two safety-relevant fixes, a new Overpass
resilience option, plus a full-codebase cleanup. All 733 tests pass.

### Added

- OpenSeaMap: the Overpass endpoint is now backed by an optional,
  admin-configurable fallback-mirror list. When the primary endpoint fails, the
  client fails over to the next mirror in order, so a single Overpass instance
  outage no longer takes the source offline. The recommended planet-wide mirrors
  are surfaced as suggestions; a regional extract (overpass.osm.ch) is
  deliberately excluded because it serves no data outside its region.

### Changed

- NOAA ENC Direct: the default ArcGIS host moved to `encdirect.noaa.gov`, the
  hostname NOAA's own documentation and the data.gov catalog publish. It is a
  byte-identical alias of the previous `gis.charttools.noaa.gov`, so there is no
  behavioral change, just alignment with the documented access point.
- Full-codebase cleanup. A shared URL-safety helper; a single merged seamark
  mapping table replacing three parallel tables; one source of truth for the
  cache-duration, dedupe-radius, refresh-hours, scale-band, and
  route-corridor-width defaults (browser-safe shared modules the panel and the
  plugin both import, completing the pattern the rating and year-filter bounds
  already use); a reducer field-setter helper; an alarm-tracker `clearStale`
  helper and a shared hysteresis-threshold helper; shared millisecond and
  earth-radius constants in place of inline magic numbers; and assorted comment
  and dead-code corrections.

### Fixed

- USCG Light List: the pinned district coverage expanded from 37 to 62
  (district, page) pairs to match the current NAVCEN MSI index, which had grown
  several pages per district. The plugin was silently under-fetching aids in
  districts 1, 5, and 8 among others. A test now locks the coverage so future
  NAVCEN growth is a deliberate table edit, not silent drift.
- A BoatRamp now obeys the minimum-rating filter, matching the fact that it
  already shows a star rating; the review-bearing set and the ratable set are
  now one source of truth.
- A USCG aid with a colour but no light character no longer renders an empty
  "Light:" line.
- The course reader's synchronous route-clear fast path now fires on a cleared
  active-route delta: it was testing the delta object instead of its value, so a
  cleared route now drops the cached corridor immediately rather than on the
  next background refresh.
- The proximity, route-hazard, and bridge air-draft alarms now clear stale
  entries through a tracker helper that compares ids in one key space. The old
  exit loops compared the tracker's sanitized ids against a raw-id map, which
  would have chattered a safety alarm for any id containing a character outside
  the sanitized set (latent: no current source id triggers it).

### Security

- The structured `properties.crowsNest` output now gates the
  ActiveCaptain website and email link values through the same URL-scheme
  allowlist the HTML popup already applied, so a `javascript:` value can no
  longer reach a structured client as a click-to-execute anchor.

<a id="v080"></a>

## [0.8.0] - 2026-06-02

A feature release. Each POI note now carries a source-agnostic, structured
detail payload a chart-plotter client can render natively, POIs reach the chart
faster through a geographic stale-while-revalidate cache, and the safety
framing and the content of that detail are tightened. All 715 tests pass.

### Added

- Every note now carries a presentation-neutral detail view on
  `properties.crowsNest`, ALONGSIDE the existing HTML `description` (never
  instead of it). A structured chart plotter reads
  `properties.crowsNest.sections` (titled sections of labeled items) and renders
  natively; a generic notes client (stock Freeboard-SK) ignores the extra
  property and renders the HTML. There is no server-side format switch, so both
  representations always ship and interoperability is preserved.
- A per-source section builder for each of the four sources (ActiveCaptain,
  OpenSeaMap, USCG Light List, and NOAA ENC) mirrors exactly what that source's
  HTML renderer surfaces, structured rather than rendered, sharing each source's
  humanizer so the two cannot drift.
- `properties.crowsNest` carries `type` (the POI type) on both list and detail
  responses, so a marker is styleable without a detail fetch, and `sections` on
  detail responses. `schemaVersion` lets a consumer detect the shape and fall
  back to the HTML on an unrecognized version.
- New integration guide for consumers: `docs/notes-resource-format.md`.
- Marina decision facts now surface: maximum LOA and beam (from the dockage
  payload) and the fuel-dock depth (from the fuel payload). An approach,
  dockside, or other go/no-go depth is emitted even when the wire carried no
  unit, rather than being silently dropped.

### Changed

- The per-source bounding-box cache is now a geographic stale-while-revalidate
  cache. Each viewport snaps outward to a coarse tile and keys on it, so a small
  pan or zoom that stays in the tile reuses the previous fetch instead of a
  fresh upstream round-trip. A tile past its freshness window is served at once
  and refreshed in the background, so only a genuinely new tile blocks, and
  concurrent same-tile bursts collapse onto one upstream request.
- NOAA ENC hazard safety framing: a wreck or obstruction now leads its feature
  section with a `Dangerous`
  boolean flag (from CATWRK/CATOBS) a consumer can surface prominently, instead
  of burying the danger status in a mid-list "Category" text item. A descriptive
  category with no danger word (for example "foul ground" or "wreck showing
  mast") still reads as a plain Category item.
- A least-depth sounding (QUASOU 6 or 7) is labeled "Least depth", the
  safety-critical worst-case depth over the feature, rather than a generic
  "Charted depth". Both depth labels are datum-tagged "(MLLW)", the chart datum
  for US ENCs. The water level is kept adjacent to the depth, and a water level
  is no longer dropped when the feature carries no numeric sounding.
- ActiveCaptain reviews and star ratings are emitted only for review-bearing
  POI types
  (marinas, anchorages, businesses, and boat ramps): a hazard, navigational
  mark, bridge, lock, or similar feature no longer gets a star rating or
  featured review. The free-text notes are always kept, since that is where
  on-the-water intel lives.
- The featured review no longer repeats its own star rating (it duplicated the
  aggregate rating), the review title rides under a stable label instead of in
  the item label slot, and the catch-all `PoiNotes` field reads as a plain
  "Notes".
- Dependencies refreshed (React and React DOM 19.2.7, `@types/react` 19.2.16,
  `tsx` 4.22.4, and the transitive tree), with `npm audit` clean of runtime
  vulnerabilities. ESLint stays on 9 because neostandard peers to `eslint ^9`.
- The living docs (README, `docs/development.md`, `docs/roadmap.md`, and
  CLAUDE.md) were brought back in line with the shipped code.

### Fixed

- Caching correctness fixes: a cache hit no longer masks an upstream
  outage as a recorded success, a per-source skip flag no longer freezes a
  source's status for the rest of a run, the USCG on-disk index self-heals on a
  corrupt read, and the bridge-clearance resolver cache gained a freshness TTL
  so an upstream correction is picked up without a restart.
- USCG Light List LLNR and Volume are emitted as `text` rather than `count`:
  they are identifiers, not tallies.

<a id="v070"></a>

## [0.7.0] - 2026-05-30

A feature release. The new bridge air-draft check warns when a bridge would not
clear the vessel: it compares each bridge's vertical clearance against the
vessel air draft plus a configurable safety margin, raising a proximity alarm
as the vessel nears a too-low bridge and a route-ahead warning when one lies on
the active Course API route. All 663 tests pass.

### Added

- New `bridge-air-draft` output raises a Signal K alarm on
  `notifications.navigation.crowsNest.bridgeClearance.<id>` when the vessel
  comes within the proximity radius of a bridge whose vertical clearance is at
  or below the vessel air draft plus the margin, with the same raise-once,
  clear-once hysteresis as the proximity hazard alarm.
- The route-corridor scan upgrades a too-low bridge on the active route to a
  clearance-specific `warn`, carrying the clearance, the air draft, and the
  margin in the message.
- Vessel air draft is read from `design.airHeight` first, then a configurable
  fallback in the plugin config. With neither set, the check stays inert and
  logs the transition once.
- Bridge clearance is sourced from OpenSeaMap (the OSM
  `seamark:bridge:clearance_height`, `maxheight`, and `clearance` tags, parsed
  at list time) and from ActiveCaptain (the detail `bridgeHeight`, converted
  from its `distanceUnit`; an unrecognized unit is treated as unknown, never
  guessed). The dedupe pass carries the more conservative clearance onto a
  merged ActiveCaptain base POI.
- New Alerts-section controls: the check toggle, the fallback air draft (in
  meters, `0` means use `design.airHeight` only), and the clearance margin
  (default 1 m).

### Changed

- Roughly forty reuse and quality cleanups, with no behavior change beyond
  the new feature: a shared `proximity-radius` module for the
  vessel-proximity geometry, a shared `clampNumber`, a shared `light-character`
  humanizer hoisted out of the OpenSeaMap module, a panel `ToggleFieldset`
  shell composed by three cards, gating bridge clearance to bridge POIs, a
  range check in `toPosition`, and assorted dead-code, comment-accuracy, and
  reuse fixes.

<a id="v061"></a>

## [0.6.1] - 2026-05-30

A quality, accessibility, and compliance release covering Signal K
compliance, performance, code quality, and the admin UI across the whole
codebase. There are no runtime behavior changes for the chart user: every POI
source, note, and alarm works exactly as before, and all 587 tests pass. This
release is also cut from a commit that carries the Signal K plugin-ci workflow,
so the community plugin-registry's plugin-ci run now lands on the published
commit.

### Added

- Declare `signalk.recommends` (the registry's "Works well with" list),
  cross-linking the two published, genuinely-paired companion plugins:
  `@signalk/freeboard-sk` (the chart plotter that renders these notes and
  hazard notifications) and `signalk-nmea2000-emitter-cannon` (relays the
  hazard-notification deltas to a Garmin MFD over NMEA 2000).
- Add a `minimum` bound to the ActiveCaptain `cachingDurationMinutes` schema
  field so the admin UI clamps it and AJV rejects a zero or negative submit,
  matching every other bounded numeric in the schema.

### Changed

- Add shared `SECONDS_PER_MINUTE` / `SECONDS_PER_HOUR` / `SECONDS_PER_DAY`
  constants and route the three relative-time formatters through them, removing
  three private copies of the same arithmetic and the dead `MS_PER_DAY` export.
- Generalize the namespaced-id splitter to `splitOnFirstSeparator`, so the
  aggregate registry's hyphen split and the sources' underscore split share one
  implementation.
- Derive the OpenSeaMap `PoiType` and Freeboard icon in a single
  `elementMarking` pass instead of normalizing the `seamark:type` tag twice per
  element.
- Hoist the per-leg bearing out of the route-corridor point loop and the
  selected-POI-types string out of the per-request notes path, and reuse the
  shared `positiveFiniteNumber` / `toFiniteNumber` narrowers and the
  `refreshSecondsSchema` builder where they had been re-implemented inline.

### Fixed

- Restore focus to the disclosure button before a data-source card collapses,
  so a keyboard user is no longer dropped to the top of the panel. The
  focus-restore logic that previously lived only in the section headers is now
  a shared `useCollapseFocusRestore` hook both the cards and the sections use.
- Mark collapsed card and section bodies `inert`, so the hidden subtree stays
  out of the tab order and the accessibility tree.
- Drop the malformed ARIA table roles from the status bar (rows with no cells),
  rendering it as a plain read-only health readout instead.
- Stop the per-source pills and the whole status bar from each being a live
  region: the relative "N minutes ago" text re-rendered on every poll, so the
  redundant regions only produced screen-reader noise. The pill now exposes a
  concise ok / idle / error label, with the longer context in the hover title.
- Guard the note `url` field against the empty string, matching the existing
  `description` and `timestamp` guards.

<a id="v060"></a>

## [0.6.0] - 2026-05-29

A version-only release: the code is identical to v0.4.7, so there are no
functional changes. The bump realigns the published version line to 0.6.0.
`v0.5.0` is skipped because that identifier already names a pre-publication
development milestone above. The release content, carried over from v0.4.7, is
the whole-tree code cleanup, the plugin-registry screenshots declared
under `signalk.screenshots`, and the hardened npm publish workflow (a
tag-versus-version guard, `typecheck` and `lint` in the gating job, and
provenance). See the v0.4.7 entry below for the detailed change list.

<a id="v047"></a>

## [0.4.7] - 2026-05-29

An internal-quality, packaging, and release-pipeline release. There are no
runtime behavior changes for the chart user: the POI sources, the notes, and
the alarms all work exactly as before, and all 587 tests pass. The published
package now carries screenshots for the Signal K plugin registry, and the npm
publish workflow is hardened.

### Added

- Add three screenshots under `assets/screenshots/` (an ActiveCaptain hazard
  popup, a USCG Light List aid popup, and the configuration panel) and declare
  them in `package.json` under `signalk.screenshots`, clearing the registry's
  screenshots penalty. The `files` allowlist already ships `assets/`, so the
  images travel in the published tarball.
- Add a Screenshots section to the README so the images render on GitHub and
  on npm.

### Changed

- `npm-publish.yml` now verifies that the release tag matches the
  `package.json` version before building, runs `typecheck` and `lint`
  alongside `build` and `test` in the gating job, and publishes with
  `--provenance` (granting the `id-token: write` and `contents: read`
  permissions provenance requires).

**Code cleanup.** A cleanup of the whole `src/` tree for reuse,
simplification, and efficiency. Behavior is preserved throughout.

- Make `PoiSummary.skIcon` and `PoiDetailView.skIcon` required, so every
  source must pick a Freeboard-registered icon at construction. Remove the
  dead `?? 'notice-to-mariners'` fallback in the notes output.
- Extract shared helpers: `src/shared/rating.ts` (rating bounds and clamp,
  shared by the ActiveCaptain input and the panel), `relative-time-format.ts`
  (the relative-time unit-stepping shared by the panel status bar and the
  ActiveCaptain detail renderer), `namespaced-id.ts` (`splitOnFirstUnderscore`,
  shared by the OpenSeaMap and NOAA id parsing), and
  `src/inputs/http-one-shot.ts` (the one-shot HTTP GET shared by the USCG and
  NOAA raw clients).
- Add a shared `labeledParagraph` HTML helper used by the three structured
  detail renderers, a `shouldSkipOutsideUsWaters` gate shared by the two
  US-only inputs, and config-fragment schema builders (`minimumYearSchema`,
  `refreshSecondsSchema`, `dedupeToggleSchema`, and `dedupeRadiusSchema`)
  shared across the input modules.
- Efficiency: hoist per-call regexes to module constants in the detail
  renderers, and collapse a concurrent same-bbox burst into one upstream
  request by caching the in-flight promise in the bbox-debounce cache.
- Refresh `CLAUDE.md`, the README, and the development and maintainer docs to
  reflect the new shared modules, the required `skIcon`, the screenshots, and
  the hardened publish workflow.

### Fixed

- Resync `package-lock.json`, whose version field had drifted to `0.4.4`
  while `package.json` advanced. The dependency graph was already consistent,
  so `npm ci` was unaffected, but the metadata is now correct.

### Removed

- Remove dead state (`lastSkipReason`) and a redundant escape-helper alias,
  and reuse `toFiniteNumber` at three open-coded wire-parse sites.

<a id="v046"></a>

## [0.4.6] - 2026-05-27

A presentation cleanup. The boilerplate attribution footer (the "Data
sourced from..." sup/sub block on ActiveCaptain notes and the
`<p class="crows-nest-attribution">` line that every other source
appended to its rendered description) is gone; the same information now
rides on structured `properties.{source,attribution,plugin,pluginRepo}`
fields published on every note, so a SignalK client UI can render the
source link cleanly in chrome instead of inline alongside the POI
detail. The release also lands roughly fifty data-formatting cleanups
across the codebase.

### Changed

- Move attribution from inline description boilerplate to structured
  `properties.{source,attribution,plugin,pluginRepo}` fields on every
  note so client UIs can render the source link cleanly. `source` and
  `attribution` were already published on the note; `plugin` and
  `pluginRepo` are new and identify this plugin and its canonical
  GitHub repository.
- **Plugin identity consolidated.** `PLUGIN_REPO_URL` and the new
  `PLUGIN_USER_AGENT` live alongside `PLUGIN_ID` in
  `src/shared/plugin-id.ts`. The four upstream clients (ActiveCaptain,
  Overpass, USCG NAVCEN, NOAA ENC) all consume the shared `User-Agent`,
  so every outbound request carries the same identity and the same
  canonical repo URL. The stale `nlabadie/signalk-crows-nest` URL on
  the NOAA and USCG clients is fixed in the same change.
- **Shared HTML escape helper.** The three near-identical `escapeHtml`
  copies in the source detail renderers consolidate onto a single
  helper in `src/shared/html-escape.ts`; the table now escapes the
  apostrophe alongside the four metacharacters so a future
  single-quoted attribute is safe by default. The USCG `llnr` and
  `volume` interpolation sites are now escaped consistently with the
  rest of that renderer.
- **SignalK note shape.** The `properties.sourceCount` field is
  dropped (it duplicated `properties.sources.length`). The note's
  `position` is built field-by-field at the builder boundary so an
  upstream type that grows a stray field cannot leak it onto the wire.
  `description: ''` no longer ships with `mimeType: text/html` for an
  empty body. The `getResource` property-value branch no longer
  returns `timestamp: undefined` for sources whose record carries no
  date.
- **Numeric helpers.** `toFiniteNumber` and `positiveFiniteNumber`
  both return `null` for the "not usable" sentinel, matching the
  `toPosition` and resource-query patterns. New helpers
  `isValidLatitude`, `isValidLongitude`, and `isWireTruthy` live in
  the same module and are used at every coordinate-parse site. The
  panel's normalize-config replaces six copies of the
  positive-finite inline check with the shared helper.
- **Time and year constants.** `MS_PER_SECOND` and `MS_PER_DAY` join
  `MS_PER_MINUTE` and `MS_PER_HOUR` in `src/shared/time.ts`; the
  three `60_000` literals in HTTP clients and the position monitor
  consume the shared `MS_PER_MINUTE` constant. The year-filter's
  off-sentinel is now named `OFF_SENTINEL_YEAR` (still equal to
  `MIN_YEAR = 0`) so the dual semantic is explicit.
- **Geographic helpers harden.** `positionToBbox` and `unionBbox`
  throw on non-finite inputs rather than silently emitting `NaN` to
  an upstream query, and the projected latitude is clamped to
  `[-90, 90]`. The doc comments name the pole and antimeridian
  limitations side by side.
- **Aggregate id namespace constraint.** The input registry asserts
  at registration that no source slug contains a hyphen, because the
  aggregate's id namespace splits on the first hyphen. A future
  `noaa-enc` slug would surface as a runtime click-through error
  without the guard.
- **Map-link URL precision.** `openSeaMapMarkerUrl` caps coordinates
  to five decimals (~1.1 m), so a marker URL is roughly 25% of its
  previous length.

### Fixed

- **NOAA ENC robustness.** The source rejects features with no
  `OBJECTID` or out-of-range coordinates rather than minting a
  `<layer>_unknown` marker whose click-through 404s. Charted depths
  and sounding-accuracy parentheticals render as `12.0 m`, not
  `12.0000001 m`, via `toFixed(1)`. `sordatToIsoTimestamp` rejects
  out-of-range months and days so a wire `"20240299"` no longer
  silently rolls forward to `2024-04-08`.
- **OpenSeaMap robustness.** The wire timestamp is normalized through
  `Date.toISOString()` so the published `PoiSummary.timestamp` is
  consistent in precision with the other three sources. The
  `seamark:type` and `leisure` lookups are case-insensitive and
  whitespace-trimming so an older OSM edit with a capitalized or
  padded tag is recognized rather than falling through to `Unknown`.
  The `humanizeWord`-then-lowercase round-trip in `buildFamilyLine`
  is dropped.
- **USCG robustness.** A null `NAME` falls back to
  `Unnamed <aidType>` so the chart marker has a popup title.
  `INACTIVE` reads through `isWireTruthy` so a schema bump that
  ships the boolean as a number does not silently mark every record
  active. `MODIFIED_DATE = 0` is treated as absent so the year filter
  does not unconditionally drop the record. The `humanizeLightChar`
  guard, the `(Morse)` parenthetical, the dangling `<hr/>` in the
  ActiveCaptain header, and the `Wifi` -> `Wi-Fi` and `Patrolled` ->
  `Security patrol` labels are all fixed.
- **Notification path safety.** The notification tracker keys by the
  sanitized POI id (the same value that ends up on the wire), so two
  ids that sanitize identically cannot live as two distinct tracker
  entries that share one SignalK notification path. An empty
  `sourceSuffix` string is treated the same as undefined, so the
  `$source` brand never gains a trailing dot.
- **Editorial.** Punctuation across the OpenSeaMap and NOAA ENC
  popups is now consistent (every fact line ends in a period); the
  ActiveCaptain `parseApiDate` regex tightens its time portion to
  reject malformed `HH:MM:SS` values before appending `Z`.

### Removed

- Remove the ActiveCaptain footer partial that rendered the "Data
  sourced from Garmin Active Captain via the signalk-crows-nest
  plugin" sup/sub block plus the per-POI "encouraged to contribute"
  link, and stop wrapping the rendered description of every other
  source (OpenSeaMap, USCG Light List, NOAA ENC Direct) with the
  `crows-nest-attribution` paragraph.
- Delete the now-unused `src/shared/attribution.ts` helper and its
  test, since no source appends an inline attribution footer anymore.

### Security

- **Security (med).** The ActiveCaptain `<a href="{{website}}">` link
  is now gated by a `safeWebsite` Handlebars helper that rejects any
  URL outside `http:`, `https:`, and `mailto:`, so a wire value of
  `javascript:alert(1)` cannot ride the click-to-execute path. The
  `rel="noopener noreferrer"` attribute is set on every external link.

<a id="v044"></a>

## [0.4.4] - 2026-05-26

A performance and polish release. The chart-load latency on a cold
viewport dropped from 15-30 s to about 5 s by capping each POI source's
list request at a per-source timeout: a slow Overpass or NOAA ENC query
no longer holds up the chart while the other sources answer. The
canonical plugin icon ships in the same release, alongside a round of
SignalK conformance, correctness, UI, docs, and test fixes.

### Added

- Add the canonical plugin icon under `assets/icons/icon.svg` (master)
  with rasterized PNG sizes 72/96/192/512. The icon follows the
  family pattern shared with `signalk-virtual-weather-sensors`,
  `signalk-nmea2000-emitter-cannon`, and
  `signalk-openrouter-companion`: a rounded square with the deep-ocean
  gradient and three stacked wave lines, plus a project-specific
  bottom-right circle badge. Crow's Nest's badge is crimson red with
  a crow's-nest silhouette (mast + yardarm + dome-topped barrel with a
  lookout head poking out), reflecting both the project name and the
  lookout-and-alarms role.
- Wire `signalk.appIcon` to `assets/icons/icon-192.png` in
  `package.json` (no leading `./`, matching the convention every other
  installed plugin uses), the single field the SignalK admin UI reads
  (`packages/server-admin-ui/src/views/Webapps/Webapp.tsx`).
- Add a `build:icons` step that copies the icons into
  `public/assets/icons/` so the SignalK `express.static` mount can
  serve them (the mount exposes `public/` only when present, not the
  package root, per `src/interfaces/webapps.ts:86-90`). The copy uses
  a glob (`icon-*.png`) so a future icon-size addition does not
  require editing the script. Wire the new step into `build`.
  Tighten `clean` to wipe `public/` recursively so a stale icon file
  does not linger across builds.
- Ship the canonical master under `assets/` in the npm tarball
  (`files` extended).

### Changed

- **Per-source list-request timeout in the aggregate registry.** Race
  each source's `listPointsOfInterest` against a 5 s timeout (configurable
  on the registry for tests). On timeout the source's POIs are skipped
  for this call, but the underlying HTTP keeps running so the source's
  bbox-debounce cache fills; the next chart-plotter refresh sees the
  populated cache and the source's POIs appear without an extra
  upstream round-trip. A slow Overpass or NOAA ENC tail-latency outlier
  no longer blocks the fast sources behind it.
- **Rename `NotificationValue.timestamp` to `createdAt`** so the
  notification value shape matches the SignalK `Notification` spec's
  optional `createdAt` field. The wire `timestamp` on the outer
  Update is still set from this value, so a consumer reading
  `Update.timestamp` is unchanged.
- **Short-circuit `app.getCourse()` on a null `activeRoute.href`
  delta.** The Course API signals route clear with a null value;
  the course reader now drops the cached polyline synchronously
  without paying for a getCourse round-trip.
- **`useNumberDraft` parser extracted** as a pure `commitNumberDraft`
  helper, with a node:test suite covering empty / unparsable input,
  fallback, integer truncation, min / max clamping, and Infinity /
  NaN handling. The hook's React state-management bits are unchanged.
- **Per-source status pill fixtures** carry `apiReachable: true` for
  ok cases, matching what the runtime emits.
- **Docs reflect the assets/ tarball entry and the build:icons
  step:** `docs/maintainers/releasing.md`, `docs/development.md`,
  and the architecture map in `CLAUDE.md`. The troubleshooting doc
  drops the obsolete "cached POI count" line from the status-section
  description (the panel pill shows health, not a per-fetch count).
  CLAUDE.md picks up `SectionBox.tsx` in the panel layout list.

### Fixed

- **Clone each summary `position` object in the aggregate's merge.**
  The per-source bbox-debounce caches share the same `PoiSummary[]`
  (and `position` objects) across hits, so a downstream consumer
  that mutates `note.position` would silently corrupt the cached
  entry for the next caller. The merge now spreads the position
  alongside the id rewrite.
- **Tighten the USCG Light List dark-zone recovery.** A page file
  that decoded to a different record count than the metadata claims
  now drops its If-Modified-Since / ETag (forcing a 200 OK on next
  refresh), not just a page file that decoded to zero records: the
  partial-decode case is also covered.
- **Escape the `|` separator in the bbox-debounce cache key** so a
  future caller whose extra discriminator happens to contain a
  literal `|` cannot collide with another caller's bbox + remainder.
- **NOAA ENC empty-state hint** uses the `hintBelow` style variant so
  the "Choose at least one layer" message and the "Underwater rocks
  default off" follow-up no longer butt against each other with zero
  vertical gap.
- **ActiveCaptain client timing tests** use an injectable `Sleep`
  spy: the three Retry-After tests now assert the requested wait
  exactly (1000 ms, capped to maxRetryAfterMs, etc.) rather than
  observed wall-clock floors, so the suite is no longer flaky on a
  loaded CI runner.
- **Bug report template** now points users to this repo's
  Discussions, not the upstream fork's.

### Removed

- **Drop the `MethodNotAllowedError` class** from
  `notes-resource-output.ts`. The signalk-server resources REST layer
  hardcodes its HTTP status (400 on POST, 404 on PUT, 400 on DELETE)
  and never reads a `statusCode` field off the thrown error, so the
  `statusCode: 405` it carried was dead code. The read-only methods
  now throw a plain `Error` carrying the same message; the wire
  status is fixed by the server and the message reaches the client
  body either way.
- **Drop `properties.readOnly`** from the notes resource. It was
  not a standard SignalK notes property and a strict server-side
  validator could strip it. The read-only contract is enforced by
  the resource provider's `setResource` / `deleteResource` methods.

<a id="v043"></a>

## [0.4.3] - 2026-05-24

A bug-fix release. The minimum-rating filter on the ActiveCaptain card
treated a never-reviewed marina as a 0-star marina, so a user who
picked `minimumRating: 2` was hiding both real low-quality marinas
AND brand-new ones. Also reclassifies the plugin under the SignalK
Appstore's Chart Plotters and Notifications categories instead of
the catch-all Utility category, and bumps the GitHub Actions runner
versions ahead of the Node.js 20 deprecation.

### Added

- Add discoverability keywords for npm search (`activecaptain`,
  `openseamap`, `uscg`, `noaa`, `freeboard`, `points-of-interest`,
  `notes`, `chart-overlay`, `proximity-alarm`, `route-corridor`,
  `marina`, `anchorage`, `hazard`).

### Changed

- Replace the catch-all `signalk-category-utility` keyword with the
  two categories the plugin actually belongs to:
  `signalk-category-chart-plotters` (the notes resources feed
  Freeboard-SK and other chart plotters) and
  `signalk-category-notifications` (the proximity and route-corridor
  hazard alarms). The plugin now appears under both Appstore
  category filters.
- Bump `actions/checkout` and `actions/setup-node` from v4 to v6
  across every workflow (`ci.yml`, `eslint.yml`,
  `npm-publish.yml`). The v4 releases run on Node.js 20, which
  GitHub flagged for deprecation in the v0.4.2 publish run; v6 runs
  on Node.js 24 and clears the warning ahead of the June 2026 hard
  cutover.

### Fixed

- **ActiveCaptain "0/5" rating bug.** The AC summary API sometimes
  returned `reviewSummary: { averageRating: 0, numberOfReviews: 0 }`
  for a marina that had not been reviewed yet. The plugin took that
  placeholder as a real 0-star rating, with two visible symptoms:
  the minimum-rating filter dropped these never-reviewed marinas
  exactly like genuine 0-star marinas, and the popup rendered a
  meaningless "0/5 ⭐ from (0 reviews)" line. Both the client and
  the popup template now treat a zero-review reviewSummary as
  unrated: the rating filter leaves the marina visible at
  `minimumRating: 0` and hides it at any positive threshold (the
  same as any unrated ratable POI), and the popup omits the rating
  section entirely.
- Add the missing trailing period to the package.json `description`.

<a id="v042"></a>

## [0.4.2] - 2026-05-23

**First release published to npm. Bundles the multi-source POI architecture
(ActiveCaptain, OpenSeaMap, USCG Light List, and NOAA ENC Direct), the
position-aware safety alarms, the route-corridor hazard scan, the React
configuration panel, the per-source earliest-year filter, the per-bbox
refresh-debounce cache, and a codebase-wide cleanup.**

The full development history of the changes that ship in this release is
documented in the per-milestone entries below (`v0.5.0` for multi-source,
`v0.4.0` for the route-corridor scan, `v0.3.0` for the position-aware safety
alarms, `v0.2.0` for the TypeScript and panel rewrite). This entry summarizes
what is new since the `v0.5.0` development milestone described below.

### Added

**Per-bbox refresh-debounce cache (NOAA ENC and OpenSeaMap)**

The two at-runtime sources gained a small in-memory cache keyed on the
bounding-box. A Freeboard refresh burst on a stationary viewport reuses
the previous result for the configured window (`noaaEncRefreshSeconds`,
`openseamapRefreshSeconds`, default 30 s, range 0 to 600). When the user
pans to a fresh view, the new bbox misses the cache and re-queries
upstream immediately. The cache key rounds the bbox to four decimal places
(about 11 m) so sub-pixel jitter from Freeboard's bbox math does not
fragment the cache. 0 disables the cache; a failed upstream fetch is not
cached (the next call retries).

This also brings the per-source panels into shape with the user's
expectation that every card has a refresh-period control. The USCG Light
List card's refresh period stays a background-download cadence in hours;
the NOAA ENC and OpenSeaMap fields are sub-minute upstream debounces.
Each card's hint paragraph spells out the difference.

**Earliest-year filter, per source**

Each opting-in source grows an optional "earliest year" knob on its
configuration card. When set, the source hides POIs whose source-specific
timestamp is older than the chosen year:

- **NOAA ENC Direct** gets `noaaEncMinimumSurveyYear`, filtering on the
  S-57 `SORDAT` hydrographic survey date. SORDAT is the survey vintage,
  often decades old for stable features (a wreck found in a 1950s
  lead-line survey vs a 2020s multibeam survey), so this is a
  data-confidence filter. The popup label says "Earliest survey year".
- **USCG Light List** gets `uscgLightListMinimumUpdateYear`, filtering on
  the NAVCEN `MODIFIED_DATE` (the date the USCG last edited the AtoN
  record). The popup label says "Earliest update year".
- **OpenSeaMap** gets `openSeaMapMinimumYear`, filtering on the OSM
  element `timestamp` (the date the OSM element was last edited by any
  contributor). The Overpass query now requests
  `out center tags meta;` so each element carries its timestamp; the
  response is one optional field heavier per element.

Every field defaults to `0`, which disables the filter and matches the
existing minimum-rating convention. POIs without a timestamp are always
included: the filter only narrows, it never silences a source whose wire
data carries no date. ActiveCaptain is intentionally not in scope:
`dateLastModified` is on the detail response only, not the summary list,
so filtering at list time would require fetching every detail and burning
the API quota; AC base markers therefore always survive the filter.

The collapsed accordion summary on each source card appends `since YYYY`
when the filter is set, so a non-zero cutoff is visible without expanding
the card.

**USCG Light List input**

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

**NOAA ENC Direct input (AWOIS successor)**

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

### Changed

**Per-card layout consistency**

Every data-source card now reads in the same vertical order: **layers,
refresh period, update year, merge option**. ActiveCaptain (POI types,
cache duration), USCG Light List (no layers, refresh hours, update year,
dedupe), OpenSeaMap (Overpass endpoint above the buckets, seamark groups,
refresh seconds, update year, dedupe + radius), and NOAA ENC (scale band
with the layer toggles, refresh seconds, survey year, dedupe) all match.
The expanded card body picks up a left-side accent rule (a 3 px border in
`var(--ac-border)` plus a left padding bump) so the body fields read as
obvious children of the source-name header above.

- CLAUDE.md, README.md, docs/roadmap.md, and docs/development.md gain
  the two new source sections. The earlier `61 (district, page) pairs`
  count is corrected to `37` across docs and code comments after live
  verification on the boat Pi found the true pinned count.

### Fixed

A code review of the entire codebase surfaced and fixed:

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

<a id="v050"></a>

## [0.5.0] - 2026-05-22

**The plugin is now multi-source: it adds OpenSeaMap alongside Garmin
ActiveCaptain, merges the two into one chart layer, and gives each source its
own health and settings.**

### Added

- A new opt-in source imports OpenSeaMap (OpenStreetMap marine data) through
  the OSM Overpass API: seamark hazards (rocks, wrecks, obstructions),
  navigational aids (lights, buoys, beacons), harbours and marinas, and
  infrastructure (locks, bridges). Each feature group can be toggled
  independently. The source is off by default; the Overpass endpoint URL is
  configurable.
- OpenStreetMap data is published under the Open Database License (ODbL),
  which requires visible attribution. Every OpenSeaMap point's rendered detail
  carries an `© OpenStreetMap contributors (ODbL)` footer.
- With more than one source enabled, the plugin fans each `notes` query out to
  every source, unions the results, and serves them as one layer. A failing
  source no longer blanks the chart: the layer is served from whichever
  sources answered.
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

### Changed

- Resource ids gain a source prefix (`activecaptain-123456`,
  `openseamap-node_987654`). A single-ActiveCaptain install sees its note ids
  change from `123456` to `activecaptain-123456`; `getResource` round-trips
  the prefixed id. The OpenSeaMap source uses an underscore-separated
  internal id form (`node_123`, not `node/123`) so a slash inside the raw OSM
  id never splits the SignalK `/resources/notes/<id>` path.
- The status snapshot is now per-source: each enabled source reports its own
  API reachability and last fetch. The configuration panel restructures into a
  per-source accordion (a collapsible card per data source) followed by an
  Alerts section.
- The proximity and route-hazard alarms move from
  `notifications.navigation.activecaptain.{hazard,route}.*` to
  `notifications.navigation.crowsNest.{hazard,route}.*`, since a hazard from a
  non-ActiveCaptain source on an `activecaptain` path is wrong. A hot upgrade
  leaves any stale `activecaptain.*` notifications in place until the next
  Signal K server restart.
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
- The numeric fields share one `NumberField` row layout (label, input
  backed by `useNumberDraft` so the input can be cleared mid-edit, and hint
  text); the proximity and route-hazard alarm controls share one
  `AlarmFieldset` toggle-plus-numeric layout. The panel imports the
  OpenSeaMap seamark groups from the shared module so its checklist stays
  in lockstep with the schema. Style names are source-neutral, the style
  table is now key-typed, and the per-source card bodies were tightened
  for accessibility (matching `aria-*` attributes, stable callbacks, and
  a shared number formatter).
- The duplicated test stubs (a stub SignalK app and a POI-summary builder)
  are lifted into `test/helpers.ts` and reused across the suite. New
  coverage was added for previously untested branches of the panel
  reducer, the config normaliser, and the relative-time formatter.

### Fixed

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

<a id="v040"></a>

## [0.4.0] - 2026-05-22

**The plugin can now scan the active route ahead and warn about hazards,
bridges, and locks along it.**

### Added

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

## [0.3.0] - 2026-05-22

**The plugin gains a position-aware safety feature set: proximity hazard alarms, an offline cache, a rating filter, and stale-hazard warnings.**

### Added

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
- Point-of-interest detail is now cached on disk in the plugin data directory,
  so it survives a server restart and is readable with no connectivity. The
  cache still honours the configured caching duration.
- A new "Minimum rating" option hides points of interest rated below the
  chosen value (0 to 5; 0 shows everything), cutting clutter on dense charts.
- A Hazard point of interest whose report has not been confirmed in over two
  years now carries a prominent freshness warning in its description.

<a id="v020"></a>

## [0.2.0] - 2026-05-21

**The plugin has been rewritten in TypeScript, its toolchain modernized, covered with an automated test suite, and given a dedicated React configuration panel.**

### Added

- A CI workflow builds, type-checks, tests, and lints on Node.js 20 and 22.
- A `node:test` suite, run through `tsx`, covers the HTTP client, the detail
  cache, the geometry helpers, the resource-query parser, the POI-type
  selection, the Handlebars rendering, the status recorder, and the panel
  config reducer.
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
- Point-of-interest descriptions now render the `services`, `retail`,
  `mooring`, and `navigation` summary sections, and a featured user review.
  These were already in every cached API response but were not displayed.
- This needs no extra API traffic. Anchorages gain the most: their mooring and
  navigation detail was previously fetched but never shown.
- Service and retail listings show only capabilities with a known answer, so a
  long section is not padded with crosses for every unrated field.

### Changed

- The plugin source moved from JavaScript under `plugin/` to modular
  TypeScript under `src/`, compiled to `dist/` by `tsc` in strict mode.
- The code is split into focused modules: the HTTP client, the detail cache,
  the geometry helpers, the resource-query parser, the POI-type selection,
  the Handlebars rendering, the inlined templates, and the shared type
  contracts in `src/types.ts`.
- The Handlebars templates and partials, previously separate files, are
  inlined as string constants so no extra files need to be published.
- The HTTP client uses the native `fetch` API, with rate limiting, exponential
  backoff, and `Retry-After` support.
- The detail cache is a TTL cache backed by `lru-cache`. `handlebars` and
  `lru-cache` are the only runtime dependencies.
- Linting moved to ESLint 9 with the neostandard flat config, replacing the
  older `eslint-config-standard` setup.
- The project targets TypeScript 6 and Node.js 20 or newer.

### Fixed

- A code review drove a round of correctness fixes: the status
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
- A SignalK and Garmin API review drove a further round. The most
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
