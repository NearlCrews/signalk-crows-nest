# CLAUDE.md

Guidance for Claude Code (and contributors) working in this repository.

## What this is

`signalk-crows-nest` is a single [Signal K server](https://github.com/SignalK/signalk-server)
plugin. It imports points of interest from multiple marine data sources
(Garmin ActiveCaptain, OpenSeaMap via the OpenStreetMap Overpass API, the USCG
Light List of US Aids to Navigation, and the NOAA ENC Direct database of
wrecks, obstructions, and underwater rocks) and exposes them as Signal K
`notes` resources so chart plotters such as Freeboard-SK can display them. It
also hosts an optional, admin-gated, beta AI route-draft endpoint (the
server-side half of Binnacle's AI route drafting): it asks OpenRouter for a passage's
turning waypoints, optionally re-routes the geometry through a deterministic
channel router so the legs follow charted or mapped water, then checks every
leg in owned code and computes a deterministic fuel estimate. The safety check
is worldwide, resolving data providers per leg by the union of every provider
whose coverage envelope reaches the leg: NOAA ENC charted depth, land, and
point hazards in US waters, EMODnet modeled depth in European seas, and an
OpenStreetMap coastline land check plus OpenSeaMap point hazards worldwide. The
AI piece is entirely opt-in and off until an OpenRouter key is configured. It is
in beta and cannot guarantee accuracy: every drafted route is a draft to verify
against the official charts before use.

## Architecture rule: ONE plugin, modular files

This is the architectural rule for this repository. It must not be violated:

> One plugin, modular TypeScript files under `src/`, never split into multiple
> npm packages.

In practice:

- This repository ships exactly ONE npm package and ONE Signal K plugin.
- Keep the code modular by splitting it into focused files under `src/`.
- Never split the project into multiple npm packages or a monorepo.
- New functionality is a new module under `src/`, not a new package. A new POI
  data source is a new `InputModule` under `src/inputs/`, and a new consumer of
  POI data is a new `OutputModule` under `src/outputs/`, each registered in
  `src/index.ts`. This modular extension path is how the plugin grows, and it
  does not change the one-plugin rule.

## Layout

The code is organized into purpose-named directories under `src/`. A POI data
source is an "input"; a SignalK consumer of POI data is an "output". Each is a
self-contained module registered on one line in `src/index.ts`.

- `src/` - TypeScript source. The Node plugin (everything except `src/panel/`)
  is compiled to `dist/` by `tsc`; the React panel under `src/panel/` is
  bundled to `public/` by webpack.
  - `index.ts` - plugin entrypoint. Registers the input and output modules and
    hands them to the plugin factory. It holds no wiring of its own.
  - `plugin/` - the plugin shell.
    - `plugin.ts` - the plugin factory: assembles the config schema from the
      registries' fragments and owns the `start`/`stop` lifecycle, including
      the shared position monitor.
    - `plugin-config.ts` - merges the per-module config-schema fragments into
      the single schema the SignalK admin UI renders.
  - `inputs/` - POI data sources.
    - `poi-source.ts` - the `PoiSource` and `InputModule` contracts an input
      implements.
    - `input-registry.ts` - holds the registered inputs and builds the
      aggregate `PoiSource` for a plugin start: it fans each list request out
      to every enabled input, namespaces resource ids with the producing
      source's slug, unions the results, records per-source status, and runs
      the dedupe pass.
    - `http-client.ts` - shared HTTP client plumbing for the queued clients
      (ActiveCaptain and Overpass): a concurrency-limited and throttled
      request queue, retry with exponential backoff that honors HTTP 429/503
      `Retry-After`, and a `close()` that aborts in-flight work.
    - `http-one-shot.ts` - the `requestText` one-shot GET shared by the two
      raw-client sources (USCG Light List and NOAA ENC Direct): it selects the
      `http`/`https` transport, buffers the body, aborts on a per-request
      timeout, and honors an optional caller `AbortSignal` (the route-draft
      deadline uses it to cancel an abandoned ENC query), leaving each caller
      its own status and JSON handling. Those two feeds are low-volume and
      deliberately skip the queue and retry of `http-client.ts`.
    - `dedupe-pois.ts` - merges non-base POIs that duplicate an ActiveCaptain
      base POI, then runs a same-source pass that collapses internal
      duplicates within a configurable radius (default 150 feet, 45.72 m), so
      a feature reported by several sources becomes one corroborated note
      rather than overlapping markers. It also owns the `dedupeToggleSchema` /
      `dedupeRadiusSchema` config-fragment builders every non-base input's
      schema reuses.
    - `active-captain/` - the ActiveCaptain input: `active-captain-input.ts`
      (the `InputModule`), `active-captain-source.ts` (the `PoiSource` adapter
      over the client, cache, and store), `active-captain-client.ts` (the
      ActiveCaptain-specific HTTP client built on `http-client.ts`),
      `active-captain-types.ts` (the ActiveCaptain summary-API wire types,
      private to this input, plus the `poiTypeShowsReviews` review-type gate
      and the `isDefiniteAvailability` predicate the renderer, the section
      builder, and the rating filter all share so the popup star rating and
      the rating filter cannot diverge), `poi-cache.ts` (TTL detail cache
      with stale-on-error: a lapsed entry whose refetch fails, offline or
      API down, is served rather than rejected), `poi-store.ts`
      (disk-backed detail store with its own long retention, 30 days and
      entry-capped, independent of the freshness TTL, so offline data
      survives restarts and hydrates as stale-but-usable),
      `poi-detail-renderer.ts`
      (Handlebars helpers and POI detail rendering), `templates.ts` (inlined
      Handlebars templates), `rating-filter.ts` (drops list entries below
      the configured minimum rating), and `active-captain-sections.ts` (builds
      the normalized `properties.crowsNest` detail sections from the
      `PoiDetails`, reusing the renderer's shared helpers, the note-field
      humanizer and the review-type gate, so the structured sections and the
      HTML cannot drift; reviews are emitted only for review-bearing POI types).
    - `openseamap/` - the OpenSeaMap input (OpenStreetMap marine data via the
      OSM Overpass API): `openseamap-input.ts` (the `InputModule`),
      `openseamap-source.ts` (the `PoiSource` adapter over the client and an
      in-memory detail cache; uses an underscore-separated internal id form
      like `node_123` so the slash in raw OSM ids never splits the resource
      URL), `overpass-client.ts` (the Overpass HTTP client built on
      `http-client.ts`, with the required `User-Agent`; it takes an ordered
      endpoint list, a primary plus any configured fallback mirrors, and fails
      over to the next on a failure so a single instance outage does not take
      the source offline. Besides the POI list query (`listPointsOfInterest`, the
      route-draft OpenSeaMap hazard provider reuses it with a hard-coded hazard
      regex), it exposes `listCoastlineWays` for the route-draft coastline land
      check, plus the `MAX_BBOX_SPAN_DEGREES` clamp and the `CoastlineWay` wire
      type that consumer reads; every query threads an optional `AbortSignal` so
      an abandoned check cancels its in-flight requests. The channel router no
      longer reads water from Overpass: its water source is vector tiles (see
      `inputs/vector-tiles/` and `route-draft/channel-router/tile-water-query.ts`)),
      `seamark-mapping.ts` (one table mapping every `seamark:type` value to
      the plugin's `PoiType` union, a Freeboard-registered `:sk-` icon, and a
      plain-English label in lockstep, with isolated-danger marks rendered as
      hazards; exposes `seamarkLabel` to the detail renderer and defines the
      seamark feature groups), `openseamap-detail.ts` (the plain-English HTML
      detail renderer), `clearance.ts` (parses the OSM vertical-clearance tags for the
      bridge air-draft check), `openseamap-sections.ts` (the
      normalized-detail section builder), `element-summary.ts` (the shared
      element-to-`PoiSummary` mapper extracted from the source so the
      route-draft OpenSeaMap provider reuses the same icon, type, and name
      logic), and `coastline-query.ts` (the tiled `natural=coastline` Overpass
      query the route-draft land check consumes as an internal capability; it
      lives here because it reuses the Overpass client, mirroring how
      `depth-area-query.ts` sits under `inputs/noaa-enc`, and tiles a wide bbox
      so the client's center clamp never silently truncates coverage).
    - `uscg-light-list/` - the USCG Light List input (US Aids to Navigation,
      US-only, defaults off): `uscg-light-list-input.ts` (the `InputModule`
      with the periodic refresh scheduler), `uscg-light-list-source.ts` (the
      `PoiSource` adapter over the client and store, with a position-gated
      `refreshAll` that iterates the pinned 62 (district, page) pairs (locked
      to the live NAVCEN coverage by a test) and skips outbound HTTP when the
      vessel is outside US waters),
      `light-list-client.ts` (the NAVCEN HTTP client built on
      `http-one-shot.ts`, with conditional-GET via `If-Modified-Since` and
      `If-None-Match`), `light-list-store.ts` (the persistent on-disk index
      under the plugin data directory), `light-list-types.ts` (the parsed and
      wire record types, private to this input), `light-list-mapping.ts`
      (maps each AID_TYPE to the plugin's `PoiType` union and the matching
      Freeboard-registered `:sk-` icon, with isolated-danger marks rendered
      as hazards), `light-list-detail.ts` (renders the record's
      characteristic, structure, sectors, and remarks as plain-English HTML),
      and `light-list-sections.ts` (the normalized-detail section builder,
      reusing the renderer's humanizers).
    - `noaa-enc/` - the NOAA ENC Direct input (US authoritative wrecks,
      obstructions, and underwater rocks, US-only, defaults off):
      `noaa-enc-input.ts` (the `InputModule`), `noaa-enc-source.ts` (the
      `PoiSource` adapter over the ArcGIS REST client; fans the bbox query
      out across the enabled hazard layers in parallel, stashes raw features
      in an LRU detail cache, gates outbound HTTP on `isInUsWaters`, and
      uses an underscore-separated id form like `wreck_12345` so the slash
      in `wreck/12345` does not split the resource URL),
      `enc-direct-client.ts` (the ArcGIS REST client built on
      `http-one-shot.ts`, with band-and-layer-id query and paging),
      `enc-direct-types.ts` (the ENC Direct wire types, including JSDoc on
      the wire-shape quirks: CATWRK as a decoded string, WATLEV as a
      number, OBJNAM frequently null), and `s57-mapping.ts` (the S-57 enum
      tables (WATLEV, QUASOU, TECSOU) plus per-layer `PoiType` and
      `:sk-` icon mappings, the `humanizeCategory` and `categoryLabel`
      readers for the decoded CATWRK/CATOBS strings, the `classifyDangerous`
      helper that turns a hazard's category into its dangerous or
      non-dangerous status, and `encDepthLabel`, the datum-tagged
      least-depth or charted-depth label shared by the HTML renderer and the
      section builder. There are no numeric CATWRK/CATOBS enum tables because
      the wire serves those fields as decoded strings, plus `decodeDepthRange`
      and the `DepthRange` type for the route-draft depth check, and the
      `depthArea`/`land` polygon layer ids the same check reads),
      `enc-direct-detail.ts` (the plain-English S-57 HTML detail renderer),
      `noaa-enc-sections.ts` (the normalized-detail section builder), and
      `depth-area-query.ts` (the charted `Depth_Area` and `Land_Area` polygon
      query the route-draft leg check consumes as an internal capability, built
      on the same `EncDirectClient`; not published as POIs).
    - `vector-tiles/` - the vector-tile client for the channel router's water
      source: `vector-tile-client.ts` resolves the versioned tile-URL template
      from the style's TileJSON, fetches a tile, gunzips and decodes the
      OpenMapTiles `water` layer with the Mapbox Vector Tile stack, and returns
      one layer's polygon geometries in lon/lat. It serves the channel router,
      not a POI source, so it publishes no POIs.
  - `route-draft/` - the optional, admin-gated AI route-draft feature (the
    server-side half of Binnacle's AI route drafting, opt-in and off until an
    OpenRouter key is set). The safety check is worldwide: it resolves data
    providers per leg by the union of every provider whose coverage envelope
    reaches the leg, then states each dimension's value and datum or flags it
    explicitly as not checked, never silently passing. `config.ts` (the
    `RouteDraftConfig` type, the bounds, defaults, clamps, and the
    config-schema fragment, following the shared bounds-module pattern),
    `openrouter.ts` (the OpenRouter chat-completions client with structured
    outputs, model fallback, retry with backoff, and typed terminal errors),
    `budget.ts` (the per-UTC-day call cap, persisted to the plugin data dir,
    that bounds calls not dollars), `fuel.ts` (the deterministic rhumb-distance
    and fuel estimate, honest about its flat head-sea derate and refusing to
    fabricate a sail burn), `safety-check.ts` (the ORCHESTRATOR over the
    leg-safety providers: it resolves each leg's provider set as the union of
    intersecting coverage envelopes, runs the bounded-concurrency leg pool,
    applies a precedence-based depth authority so the highest-precedence depth
    provider that returned data owns the leg, sweeps hazards per provider over
    each contiguous run of covered legs, dedupes hazards cross-provider by
    rounded position and type, emits a capability-keyed "not checked" flag with
    a collapsed depth note for any dimension no responsible provider verified,
    and synthesizes the route-level EMODnet awareness note when EMODnet was the
    effective depth provider on any leg; it states the charted value and never a
    bare verdict), `leg-geometry.ts` (the planar ring helpers shared by the
    providers: `pointInRings`, `segmentCrossesRings`, `legBbox`, `routeBbox`,
    `cumulativeLegStartMeters`, and `legForAlongTrack`; the coastline land check
    reads the vector-tile water outline, not an open coastline polyline),
    `country-boundaries.ts` (border-aware routing: a bundled, simplified admin-0
    country partition, read once at start and degrading to a no-op if absent, that
    classifies a point's country, gates a route as same-country via `homeForRoute`,
    and yields the other countries' water rings overlapping a route bbox so the
    channel router blocks foreign water and a same-country route stays in its own
    waters; it partitions only inland and boundary-lake water, so marine and
    different-country routes are unconstrained), and
    `endpoint.ts` (the `POST /api/route-draft`
    handler that asks the model for turning waypoints, optionally re-routes the
    geometry through the channel router, then disposes every flag and number in
    owned code; the model proposes, this code disposes. It also serves the
    optimize variant: when the request carries a drawn `route`, it refines that
    polyline instead of drafting from words, anchors the result's endpoints to
    the drawn start and end, and returns an `optimized` marker. It attaches one
    route-level geometry note: an OSM-water depth caveat when the channel route
    followed a mapped water outline that carries no depth, or a
    channel-unavailable note when routing did not run (no coverage, declined, or
    skipped for budget) and the straight model or drawn geometry was kept, so a
    navigator never mistakes a straight AI line for a vetted one).
    - `providers/` - the per-leg data providers the orchestrator runs.
      `provider.ts` (the `LegSafetyProvider` contract, the precedence
      constants, the provider-id constants, the `ROUTE_DRAFT_ID` synthetic
      route id, the `resolveProviders` per-leg region resolver, the shared
      `hazardDedupeKey`, and the shared `corridorHazardFlags` helper that
      stitches a provider's covered legs into one polyline, scans the corridor,
      and maps each matched hazard to its global leg index, so the ENC and
      OpenSeaMap hazard sweeps differ only in how they fetch and word their
      hazards), `enc-provider.ts`
      (the NOAA ENC provider: charted depth-area contours, charted land, and
      charted point hazards in US waters), `openseamap-provider.ts` (the
      worldwide OpenSeaMap provider: rock, wreck, and obstruction seamark point
      hazards and an OpenStreetMap coastline land check on every leg), and
      `emodnet-provider.ts` (the European EMODnet provider: modeled depth,
      awareness-grade and referenced to Lowest Astronomical Tide, never charted,
      gated to the European envelope).
    - `emodnet/` - `emodnet-client.ts` (the GET-only EMODnet depth-profile
      client built on `http-one-shot.ts`; it lives here, not under `inputs/`,
      because EMODnet has no POI-source counterpart, mirroring how
      `depth-area-query.ts` sits under `inputs/noaa-enc`).
    - `channel-router/` - the deterministic water-following router the endpoint
      runs before the safety check to replace the model's straight legs with a
      route that follows charted or mapped water where coverage allows; it owns
      the geometry on the water while the model owns only the endpoints and the
      intent. `channel-router.ts` (the orchestrator: it sizes and validates the
      route bbox, declining a cross-antimeridian or oversized window before any
      fetch, fetches the ENC charted areas per band and the vector-tile water
      concurrently, builds the navigable grid, snaps the endpoints to
      water, runs A*, simplifies the path, re-validates every final leg at
      polygon resolution, and returns the turning waypoints or a typed decline
      reason; it never verifies depth for tile water, so the caller flags a
      tile-water success as depth-unverified), `tile-water-query.ts` (the
      worldwide water source: it picks a zoom, enumerates the Web-Mercator tiles
      covering the bbox, reads the pre-clipped OpenMapTiles `water` layer through
      the vector-tile client, and returns water polygons with islands as holes,
      caching decoded tiles in an LRU; it lives here, not under `inputs/`, because
      the tile math and assembly are channel-router concerns, while the HTTP and
      decode live in `inputs/vector-tiles/vector-tile-client.ts`), `nav-grid.ts`
      (the depth-aware navigable grid via scanline rasterization: a cell is
      navigable only where ENC charts it deep enough or tile water maps water, and
      any ENC land, ENC drying, or tile-water island hole blocks; a foreign-country
      water block for border-aware routing stamps blocked but NOT the shore mask, so
      the one-cell shore erosion does not pinch a narrow home channel a cell off the
      border, with a standoff cost ramp toward the desired
      offing), `astar.ts` (the grid A* with a binary min-heap), `path-simplify.ts`
      (the pure Ramer-Douglas-Peucker reduction of the A* centerline to turning
      points, walked over an explicit index-range stack rather than by recursion
      so a long winding centerline of thousands of cells cannot overflow the call
      stack; the output is identical to the recursive form), and `index.ts` (the slice's barrel, exporting `routeChannel`,
      `routeStaysOnWater`, and `createTileWaterSource` with their types).
  - `outputs/` - SignalK consumers of POI data.
    - `output.ts` - the `OutputModule`, `OutputHandle`, `OutputContext`, and
      `PositionScanContributor` contracts an output implements.
    - `output-registry.ts` - holds the registered outputs and starts the
      enabled ones.
    - `notes-resource/` - the `notes` resource output: `notes-resource-output.ts`
      (the `OutputModule` that registers the SignalK `notes` provider),
      `note-builder.ts` (turns a POI into a `notes` resource object, publishing
      the source-agnostic normalized detail on `properties.crowsNest` alongside
      the HTML description so a structured client can render it natively), and
      `resource-query.ts` (parses a resource query into a bounding box).
    - `proximity-alarm/` - the proximity-alarm output: `proximity-alarm-output.ts`
      (the `OutputModule`) and `proximity-alarms.ts` (emits SignalK hazard
      notifications, with hysteresis, near a Hazard).
    - `route-hazard/` - the route-corridor hazard output: `route-hazard-output.ts`
      (the `OutputModule`, which also resolves a too-low-bridge verdict when the
      bridge air-draft check is on), `route-hazard-alarms.ts` (emits SignalK
      route notifications, raised once and cleared once, with a
      clearance-specific message for a too-low bridge), `route-corridor.ts` (pure
      corridor geometry), and `course-reader.ts` (reads the active route from
      the SignalK Course API).
    - `bridge-air-draft/` - the bridge air-draft check (US and worldwide,
      defaults off): warns when a bridge's vertical clearance is at or below the
      vessel air draft plus a configurable margin. `bridge-air-draft-output.ts`
      (the `OutputModule`, a proximity scan over Bridge POIs),
      `bridge-clearance-alarms.ts` (emits SignalK alarm notifications with the
      same raise-once, clear-once hysteresis as the proximity hazard alarm), and
      `bridge-clearance-resolver.ts` (resolves a bridge's clearance: a
      synchronous OpenSeaMap summary hit, or a deduped, cached ActiveCaptain
      detail fetch). The route-hazard output consumes this resolver too, for its
      route-ahead clearance warning.
  - `monitoring/` - `position-monitor.ts` subscribes to `navigation.position`,
    exposes the latest fix through `getCurrentPosition` (read by the US-only
    inputs to gate outbound HTTP), and drives the per-tick scan from the
    position-driven outputs' scan contributors.
  - `geo/` - `position-utilities.ts`: geo helpers (`toPosition` parsing,
    position to bounding box, great-circle `distanceMeters`, `unionBbox`,
    `projectPointOntoLeg` for corridor geometry, and the rhumb-line
    `rhumbDistanceMeters` and `sampleRhumbLeg` the route-draft leg check samples
    along).
  - `status/` - `plugin-status.ts` (records request outcomes, produces a
    `StatusSnapshot`), `status-router.ts` (Express router that serves the
    snapshot behind the shared admin gate), `admin-gate.ts` (the
    `ensureApiAdminGate` helper that installs the server admin middleware on the
    plugin's `/api` subtree once per app and reports whether it holds, so both
    the status route and the budget-spending route-draft route mount only when
    gated and otherwise fail closed), and `status-types.ts` (the
    `StatusSnapshot` type, shared by plugin and panel).
  - `shared/` - source-agnostic contracts and helpers shared across the
    plugin: `types.ts` (the cross-module type contracts; ActiveCaptain-only
    wire types live next to the ActiveCaptain input, not here),
    `plugin-id.ts` (the plugin id, the canonical repo URL, and the shared
    `PLUGIN_USER_AGENT` every upstream client consumes, all in one
    module so a rename touches one place),
    `source-ids.ts` (the four PoiSource id constants, the `SOURCE_SLUGS`
    runtime list, and the `SourceSlug` union derived from it, shared by the
    input modules and the panel; extracted so the browser-bundled panel can
    import them without pulling in any node-only dependencies the source
    modules reach),
    `poi-type-selection.ts` (maps the config POI-type toggles to the
    `poiTypes` string the aggregate source uses), `seamark-groups.ts` (the
    OpenSeaMap seamark group ids and labels, the single source of truth
    consumed by the OpenSeaMap input, its config-schema fragment, and the
    panel), `overpass-endpoints.ts` (the browser-safe single source of truth
    for the default Overpass endpoint, the vetted fallback-mirror suggestions,
    `resolvePrimaryEndpoint`, and `normalizeFallbackEndpoints`, shared by the
    OpenSeaMap input, the panel's normalize-config, and the fallback-endpoints
    field; `overpass.osm.ch` is deliberately excluded from the suggestions as a
    Switzerland-only extract), `us-waters.ts` (the `isInUsWaters` gate plus the
    `shouldSkipOutsideUsWaters` helper the US-only inputs call to skip
    outbound HTTP, and record the skip, when the vessel is outside US
    waters), `regions.ts` (the route-draft coverage-envelope predicates
    `isInEncCoverage` and `isInEmodnetCoverage` the per-leg provider resolver
    reads, kept out of `us-waters.ts` so the route-draft region concept does not
    couple to that input gate), `bbox-tiles.ts` (the `tileBbox` splitter that
    breaks a wide bbox into sub-boxes within a span so the route-draft Overpass
    queries cover a box completely rather than letting the client clamp truncate
    it), `abort.ts` (the `combineAbortSignals` helper, shared by the queued HTTP
    client and the OpenRouter client, that folds an optional caller signal into
    an `AbortSignal.any` and returns the lone signal when only one is defined),
    `bbox-debounce.ts`
    (the per-source geographic stale-while-revalidate cache, which snaps each
    viewport to a coarse tile so a small pan reuses the previous fetch, serves
    a stale tile immediately while revalidating it in the background,
    collapses a concurrent same-tile burst into one upstream request, and
    prefetches the neighbor tile in the background when a small viewport
    approaches a tile edge, so a vessel underway crosses the grid cliff onto
    a warm tile; plus the canonical
    `MIN_BBOX_DEBOUNCE_SECONDS` / `MAX_BBOX_DEBOUNCE_SECONDS` bounds, the
    per-source defaults (`DEFAULT_ACTIVE_CAPTAIN_DEBOUNCE_SECONDS`,
    `DEFAULT_OPENSEAMAP_DEBOUNCE_SECONDS`,
    `DEFAULT_NOAA_ENC_DEBOUNCE_SECONDS`, each sized to its upstream's real
    update rate), the `clampBboxDebounceSeconds` helper (its per-source
    fallback argument is required, so no layer can silently inherit another
    source's cadence), and the `refreshSecondsSchema` config-fragment builder
    the at-runtime inputs share), `map-link.ts` (the OpenSeaMap-marker fallback deep link
    USCG Light List and NOAA ENC popups use, since neither upstream
    viewer supports per-feature deep links), `html-escape.ts` (the
    shared `escapeHtml` helper every source's detail renderer consumes,
    so the four metacharacters plus the apostrophe are escaped from one
    place, plus `labeledParagraph`, the `<p><strong>Label:</strong>
    value.</p>` builder the structured detail renderers share),
    `url-safety.ts` (the `safeLinkUrl` scheme allowlist both the
    Handlebars detail templates and the structured section builders gate a
    link value through, so a `javascript:` value cannot reach either the
    HTML popup or a structured client as a clickable anchor),
    `notification-path.ts` (builds path-safe SignalK notification
    deltas, shared by the alarm outputs, with a `sourceSuffix` arg so
    proximity and route alarms get distinct `$source` brands),
    `notification-tracker.ts` (raise/clear bookkeeping shared by the
    proximity, route-hazard, and bridge air-draft outputs, keyed by the
    sanitized POI id so the in-memory and on-wire identities cannot drift,
    with a `clearStale` sweep that sanitizes the still-active ids into the
    same key space so a clear-and-re-raise chatter on a safety alarm is
    impossible by construction; the tracker also owns the episode clock,
    stamping `raisedAt` on the first `set` and preserving it across
    refreshes so every delta of one alarm episode carries the same
    `createdAt`),
    `year-filter.ts` (the `filterByMinimumYear` helper plus the shared
    `MIN_YEAR` / `MAX_YEAR` / `DEFAULT_MINIMUM_YEAR`
    bounds and the `clampMinimumYear` helper every opting-in source uses
    for its earliest-year filter, plus the `minimumYearSchema`
    config-fragment builder the opting-in inputs share), `rating.ts` (the
    `MIN_RATING` / `MAX_RATING` / `DEFAULT_MINIMUM_RATING` bounds and the
    `clampMinimumRating` helper the ActiveCaptain input and the panel's
    normalize-config share, mirroring the year-filter and bbox-debounce
    shared-bounds pattern), `cache-duration.ts`, `dedupe-radius.ts`,
    `refresh-hours.ts`, `scale-band.ts`, and `route-corridor.ts` (browser-safe
    single-source-of-truth homes for, respectively, the ActiveCaptain
    cache-duration bounds, `clampCacheDurationMinutes`, and
    `cacheDurationSchema`; the dedupe merge-radius default (150 feet), the
    min and max bounds, `cappedDedupeRadius` (nullable, for the input
    modules), and `clampDedupeRadius` (the panel form), named for the dedupe
    rather than one source since all three non-base sources use it; the USCG
    refresh-hours bounds plus
    `clampRefreshHours` and `refreshHoursSchema`; the NOAA `ScaleBand` type
    plus `SCALE_BANDS`, `SCALE_BAND_LABELS`, `DEFAULT_SCALE_BAND`, and
    `resolveScaleBand`; and the route-corridor-width bounds,
    `clampRouteCorridorWidth`, and `routeCorridorWidthSchema`. Each is
    imported by both its source module and the panel's normalize-config so
    the two cannot drift, completing the bounds-sharing pattern),
    `config-schema.ts` (the `boundedNumberSchema` fragment constructor every
    bounds module's schema builder delegates to, so the field shape lives
    once), `numbers.ts` (the `toFiniteNumber`, `finiteOrUndefined`, and
    `positiveFiniteNumber` narrowing helpers, the `isFiniteNumber` type guard,
    plus `isValidLatitude`,
    `isValidLongitude`, `isWireTruthy`, the `clampNumber` bound-and-fallback
    helper, the `roundTo` fixed-decimals rounding the message formatter and
    the panel's display-unit conversions share, and the
    `positiveCappedNumber` fallback-then-cap helper the
    config-bounds modules delegate to), `retry-after.ts` (the
    `parseRetryAfterMs` header parser shared by the queued upstream HTTP client
    and the OpenRouter client, so the seconds-or-HTTP-date handling lives once),
    `strings.ts` (the `presentString`
    trim-and-reject-blank reader the USCG and NOAA wire parsers and the
    panel's unit-preferences reader share, plus `capitalizeFirst`, the
    sentence-case touch the OpenSeaMap detail renderer and the route-draft
    not-checked message share),
    `debug.ts` (the `debugIsEnabled` guard that reads the npm `debug`
    logger's live `enabled` flag so hot paths skip building log arguments
    while debug is off, plus `appLogger`, which adapts a SignalK app to the
    project `Logger` surface in one place so the route-draft endpoint and the
    channel router share one adapter rather than each building their own),
    `cache.ts`
    (the `MAX_POI_CACHE_ENTRIES` and `MAX_BBOX_CACHE_ENTRIES` ceilings
    shared by the per-source detail and bbox caches),
    `relative-time-format.ts` (the `formatRelativeDelta` unit-stepping the
    panel's status bar and the ActiveCaptain detail renderer share, each
    passing its own unit table and locale), `namespaced-id.ts` (the
    `splitOnFirstSeparator` helper, plus its `splitOnFirstUnderscore` wrapper,
    the OpenSeaMap and NOAA ENC sources share to decode their `node_123` /
    `wreck_12345` id form and the aggregate registry uses for its
    `activecaptain-12345` hyphen form), and `time.ts`
    (the `MS_PER_SECOND` / `MS_PER_MINUTE` / `MS_PER_HOUR` millisecond
    constants, the `SECONDS_PER_MINUTE` / `SECONDS_PER_HOUR` /
    `SECONDS_PER_DAY` constants the relative-time formatters share, and the
    `MINUTES_PER_HOUR` / `MINUTES_PER_DAY` constants the minute-denominated
    cache windows derive from),
    `length.ts` (the `METERS_PER_FOOT`, `METERS_PER_KM`,
    `METERS_PER_NAUTICAL_MILE`, and `METERS_PER_DEGREE` constants, the
    latitude-dependent `metersPerDegreeLon` helper the channel-router grid sizes
    its cells with, and the `metersFromFeet` / `metersFromFeetInches` /
    `metersFromNauticalMiles` conversions shared by the two bridge-clearance
    parsers, the dedupe-radius default, the panel's display-unit conversions,
    and the route-corridor and route-draft nautical-mile distances),
    `format-meters.ts` (the `formatMeters` one-decimal meter formatter every
    safety message uses, plus `formatNm`, the two-decimal nautical-mile
    formatter the route-draft ENC and OpenSeaMap standoff messages read),
    `bridge-clearance.ts` (the bridge air-draft comparison: `readVesselAirDraft`
    reads `design.airHeight` then a config fallback, `bridgeBlocksVessel` plus
    the margin bounds and `clampClearanceMargin`, the `formatClearanceMeters`
    message helper, and the config-fragment builders; pure and panel-bundle-safe),
    `proximity-radius.ts` (the vessel-proximity alarm geometry shared by the two
    proximity outputs, the two alarm modules, and the panel: the radius bounds,
    `clampProximityAlarmRadius`, `proximityRadiusSchema`,
    `hysteresisThreshold` (the shared raise/clear distance both alarm modules
    apply), and `vesselScanRadiusMeters`), `light-character.ts` (the IALA
    light-character humanizer the OpenSeaMap and USCG Light List detail
    renderers share), `self-paths.ts` (the `SELF_POSITION_PATH` and
    `SELF_SOG_PATH` constants shared by the position monitor and the course
    reader, so both consumers reference the same path strings), and
    `normalized-detail.ts` (the source-agnostic
    structured-notes schema: `NormalizedSection`, `NormalizedItem`, the
    item-`kind` union, the `schemaVersion`, and the shared `pushSection`
    builder every source's section builder produces onto a note's
    `properties.crowsNest`; documented for consumers in
    `docs/notes-resource-format.md`).
  - `panel/` - federated React configuration panel. Root and reducer:
    `index.tsx` (Module Federation entry), `PluginConfigurationPanel.tsx`,
    `config-reducer.ts`, `normalize-config.ts`, plus the UI-metadata
    modules `active-captain-poi-types.ts`, `styles.ts` (the `--ac-*` design
    tokens: scale tokens plus light, dark, and red-preserving night theme
    blocks, each with `color-scheme`, and the `data-ac-theme` pinned
    overrides the theme toggle drives; the host-driven dark block is dormant
    because the current SignalK admin has no theme switcher),
    `relative-time.ts`, `source-status-pill.ts` (the pure `pillVariant`
    + `pillContent` helpers used by the per-source live-status pill on each
    card header, in a non-tsx module so the unit tests import it without
    JSX), `request-timeout.ts` (the panel-wide per-request timeout the
    status poller and the unit-preferences fetch share), and
    `unit-system.ts` (the React-free display-units module: the
    `UnitSystem` resolver keyed off the server unit-preset's
    `categories.length.targetUnit`, the meters-to-display conversions, and
    the fetch ladder that mirrors the admin UI's Units page, per-user
    `applicationData` preset first, then the server-wide active preset,
    then metric). `hooks/` holds `use-config`, `use-status` (which also
    exposes `lastUpdatedMs`, the freshness note's clock), `use-theme` (the
    localStorage-persisted `ac-theme` choice the root renders declaratively
    as `data-ac-theme`), `use-unit-system` (resolves the display system
    from the server's unit preferences once on mount and provides it
    through `UnitSystemContext`), `use-number-draft` (the raw-text draft
    state for clearable numeric inputs), and `use-collapse-focus-restore`
    (the shared focus-restore-on-collapse hook both `SectionBox` and
    `DataSourceCard` consume, so a keyboard user is not dropped to
    `document.body` when a region collapses). `components/` holds the layout pieces: `SectionBox`
    (the shared collapsible-section primitive: section heading, chevron, and
    focus-restore on collapse via the shared hook), and on top of it
    `StatusBar` (per-source health grid, the "checked Ns ago" freshness
    note, and recent errors as jump-to-card shortcuts), `FooterBar` (sticky,
    composing `SaveStatus`), `DataSourcesSection` (the per-source accordion
    shell, with a getting-started callout while no optional source is
    enabled), `DataSourceCard` (one collapsible card, with an in-header
    live-status pill and a body that stays mounted via `display: none` (and
    marked `inert` while collapsed) so an in-progress NumberField draft
    survives a collapse-and-expand round trip), `ActiveCaptainSource`,
    `OpenSeaMapSource`, `UscgLightListSource`, and `NoaaEncSource` (the
    per-source card bodies), `AlertsSection` (the proximity, route-hazard, and
    bridge air-draft controls), `RouteDraftingSection` (the opt-in AI
    route-drafting card: the master toggle, the masked OpenRouter key and model,
    the call budget, and the vessel, fuel, and routing inputs that feed the
    depth, sailability, and fuel math); plus the per-field input components
    `LabeledField` (the shared label-plus-control-plus-hint scaffold, which
    wires `aria-describedby` from the hint to the control), `NumberField`
    (the labeled numeric input with a draft-while-editing buffer, on top of
    `LabeledField`), `LengthField` (the meters-backed NumberField wrapper
    that renders in the unit system the server preference selects,
    converting the value and bounds at the display edge while the config
    stays in meters; every length field composes it),
    `CacheDurationField`, `EndpointUrlField`,
    `FallbackEndpointsField` (the OpenSeaMap one-per-line Overpass
    fallback-mirror textarea), `Fieldset` (the shared titled-fieldset shell,
    legend plus an optional action slot and hint, that every grouped section
    composes), `Disclosure` (the native `<details>` Advanced collapsible that
    tucks each card's rarely-changed tuning out of the default view),
    `ToggleFieldset` (the shared opt-in toggle-plus-legend fieldset shell,
    composing `Fieldset`),
    `RatingFilterField`, `MinimumYearField` (the shared earliest-year
    NumberField wrapper used by each opting-in source card),
    `RefreshSecondsField` (the shared NumberField wrapper for the
    bbox-debounce period on at-runtime sources),
    `MergeWithActiveCaptain` (the shared dedupe-toggle + merge-radius
    fieldset, composing `ToggleFieldset`, used by every non-base card),
    `ProximityAlarmFields` and `RouteHazardScanFields` (the two alarm
    controls, each a `ToggleFieldset` with one LengthField),
    `BridgeAirDraftFields` (the
    bridge air-draft check controls), `ActiveCaptainPoiTypes`,
    `SeamarkGroups`, `SegmentedControl` (the bordered aria-pressed segment
    fieldset), `ThemeToggle` (the Auto / Light / Dark / Night control on
    `SegmentedControl`), and `SaveStatus` (the dirty / just-saved
    indicator).
    The panel is a per-source accordion: a top control bar with the theme
    toggle, the status bar, a collapsible card per data source, then the
    Alerts and Route drafting sections. Card disclosure state lives at the
    panel root so the four card bodies share one stable map. Each card shows
    only its import choice by default and tucks refresh, freshness, merge, and
    connection tuning under a per-card `Disclosure` ("Advanced"); the Route
    drafting section has one master enable, the vessel basics, and the rest of
    its tuning under the same Advanced disclosure.
- `test/` - `node:test` test suite, run through `tsx`.
- `docs/` - project documentation: the development guide, troubleshooting, the
  notes-resource integration guide (`notes-resource-format.md`), the Garmin API
  research notes, decision records, and maintainer notes.
- `assets/` - committed, published static files: `icons/` (the plugin icon in
  SVG and PNG sizes, wired through the `signalk.appIcon` field), `screenshots/`
  (the admin-panel and Freeboard-SK images declared under `signalk.screenshots`
  for the plugin-registry listing), and `boundaries/` (the bundled, simplified
  country partition for border-aware route drafting, built by
  `scripts/build-boundaries.mjs`; see `assets/boundaries/README.md`). The
  boundary data is deliberately bundled rather than a fetched input module
  because it is a small, static worldwide partition with no upstream API, read
  once at plugin start and degrading to a no-op if absent.
- `dist/` and `public/` - compiled plugin and bundled panel. Generated, not
  committed. They are published to npm alongside `assets/` (see the `files`
  field in `package.json`).

## Toolchain

- TypeScript 6. The Node plugin is compiled with `tsc` (`tsconfig.json`).
- The React panel under `src/panel/` is bundled to `public/` by webpack as a
  Module Federation remote (`webpack.config.cjs`, `tsconfig.panel.json`).
- The test suite is type-checked separately (`tsconfig.test.json`); all three
  configs run under `npm run typecheck`.
- ESLint 9 with [neostandard](https://github.com/neostandard/neostandard)
  flat config (`eslint.config.js`). neostandard is the modern successor to the
  project's old `eslint-config-standard` setup. The lint toolchain caps at
  ESLint 9 because neostandard peers to `eslint ^9`.
- Node.js 20.3 or newer (the ActiveCaptain client uses `AbortSignal.any`).
- Tests run on `node:test` via `tsx`, so no separate test framework.

## Commands

- `npm run build` - build the plugin and the configuration panel.
- `npm run build:plugin` - compile `src/` to `dist/` with `tsc`.
- `npm run build:panel` - bundle the React panel to `public/` with webpack.
- `npm test` - run the test suite under `test/`.
- `npm run typecheck` - type-check the plugin, the panel, and the tests without emitting.
- `npm run lint` - lint with ESLint 9 + neostandard.
- `npm run lint:fix` - lint and auto-fix.
- `npm run clean` - remove `dist/` and the panel build artifacts.
- `npm run prepublishOnly` - clean and rebuild before publishing (runs
  automatically on `npm publish`).

## Conventions

- All new code is TypeScript under `src/`.
- Keep modules focused and small. Shared types belong in `src/shared/types.ts`.
- Do not edit `dist/` or `public/`; they are generated.
- Run `npm run lint`, `npm run typecheck`, and `npm test` before committing.
