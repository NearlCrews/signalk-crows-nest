# CLAUDE.md

Guidance for Claude Code (and contributors) working in this repository.

## What this is

`signalk-crows-nest` is a single [Signal K server](https://github.com/SignalK/signalk-server)
plugin. It imports points of interest from multiple marine data sources
(Garmin ActiveCaptain, OpenSeaMap via the OpenStreetMap Overpass API, the USCG
Light List of US Aids to Navigation, the NOAA ENC Direct database of wrecks,
obstructions, and underwater rocks, NOAA CO-OPS tide and current stations, the
USCG Local Notice to Mariners live safety feed, the NGA World Port Index, and
USACE locks and dams) and exposes them as Signal K `notes` resources so
chartplotters such as Freeboard-SK can display them. It also runs three safety
outputs: a proximity hazard alarm, a route-corridor hazard scan, and a bridge
air-draft check.

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
      implements, plus the shared per-source policy helpers:
      `fetchDetailRecorded` (the miss-vs-outage detail policy),
      `fetchListWithOfflineFallback` (the offline list-fallback control flow
      the OpenSeaMap, NOAA ENC, and USACE sources share), and
      `staleSummariesWithinBbox` (the cheap-position-first stale-summary
      rebuild the fallback consumes).
    - `input-registry.ts` - holds the registered inputs and builds the
      aggregate `PoiSource` for a plugin start: it fans each list request out
      to every enabled input, namespaces resource ids with the producing
      source's slug, unions the results, records per-source status, and runs
      the dedupe pass. Its per-source status recording skips `recordListFetch`
      for a source whose request-scoped list provenance is local, skipped, or
      stale, so none is laundered into a reachable fetch.
    - `http-client.ts` - shared HTTP client plumbing for the queued clients
      (ActiveCaptain and Overpass): a concurrency-limited and throttled
      request queue, retry with exponential backoff that honors HTTP 429/503
      `Retry-After`, and a `close()` that aborts in-flight work.
    - `http-one-shot.ts` - the `requestText` one-shot GET the raw-client
      sources build on: it selects the `http`/`https` transport, buffers the
      body up to a fixed ceiling, enforces a wall-clock deadline, and honors an
      optional caller `AbortSignal`; plus `requestJson`, the status-guarded
      JSON envelope the ArcGIS protocol and the World Port Index client share.
      Those feeds are low-volume and deliberately skip the queue and retry of
      `http-client.ts`.
    - `http-conditional-get.ts` - the `conditionalGet` download envelope built
      on `http-one-shot.ts` and shared by the USCG Light List, USCG LNM, and
      NOAA CO-OPS clients: the ok / not-modified / error result union, the
      `If-Modified-Since` and `If-None-Match` request headers, the 304 branch,
      and the `Last-Modified` / `ETag` response-header extraction, leaving
      each caller its own body parsing.
    - `arcgis-query.ts` - the ArcGIS REST query protocol shared by the NOAA
      ENC Direct and USACE clients: the envelope and by-id query parameters,
      antimeridian envelope splitting and result deduplication, the JSON fetch
      with status guard, and the bounded
      `exceededTransferLimit` pagination loop, parameterized by a per-request
      URL resolver and an upstream label for error messages.
    - `refresh-scheduler.ts` - `startRefreshScheduler`, the periodic-refresh
      installer the USCG Light List, USCG LNM, and NOAA CO-OPS input modules
      share: the in-flight guard, the initial and periodic timers, and the
      close-wrap that clears both timers before chaining the source's own
      `close`.
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
      (the ActiveCaptain binding of the shared `detail-store.ts` disk store:
      the `PoiDetails` guard, the file name, and the version gate; long
      retention independent of the freshness TTL, so offline data survives
      restarts and hydrates as stale-but-usable),
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
      `openseamap-source.ts` (the `PoiSource` adapter over the client, an
      in-memory detail cache, and the shared disk-backed detail store that
      hydrates the cache on a cold start so a restart offline still renders
      previously fetched elements; when an upstream list fails it falls back to
      rebuilding summaries from the hydrated cache within the requested bbox and
      records a stale serve (see `plugin-status.ts`), so previously visited
      areas reappear offline without laundering the outage into a reachable
      fetch; uses an underscore-separated internal id form
      like `node_123` so the slash in raw OSM ids never splits the resource
      URL), `overpass-client.ts` (the Overpass HTTP client built on
      `http-client.ts`, with the required `User-Agent`; it takes an ordered
      endpoint list, a primary plus any configured fallback mirrors, and fails
      over to the next on a failure so a single instance outage does not take
      the source offline. Its list query conditionally includes plain
      `leisure=marina` features only when the Harbours and moorings group is
      enabled, clamps oversized viewports, and threads an optional
      `AbortSignal` so an abandoned check cancels its in-flight requests),
      `seamark-mapping.ts` (one table mapping every `seamark:type` value to
      the plugin's `PoiType` union, a Freeboard-registered `:sk-` icon, and a
      plain-English label in lockstep, with isolated-danger marks rendered as
      hazards; exposes `seamarkLabel` to the detail renderer and defines the
      seamark feature groups), `openseamap-detail.ts` (the plain-English HTML
      detail renderer), `clearance.ts` (parses the OSM vertical-clearance tags for the
      bridge air-draft check), `openseamap-sections.ts` (the
      normalized-detail section builder), and `element-summary.ts` (the shared
      element-to-`PoiSummary` mapper extracted from the source so the icon,
      type, and name logic lives once).
    - `uscg-light-list/` - the USCG Light List input (US Aids to Navigation,
      US-only, defaults off): `uscg-light-list-input.ts` (the `InputModule`
      with the periodic refresh scheduler), `uscg-light-list-source.ts` (the
      `PoiSource` adapter over the client and store, with a position-gated
      `refreshAll` that iterates the pinned 62 (district, page) pairs and
      skips outbound HTTP when the vessel is outside US waters),
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
      in an LRU detail cache backed by the shared disk detail store that
      hydrates the cache on a cold start, falls back on an upstream list failure
      to rebuilding summaries from the hydrated cache within the requested bbox
      and recording a stale serve (see `plugin-status.ts`) so previously visited
      areas reappear offline, gates outbound HTTP on `isInUsWaters`
      on BOTH the list path and the detail-miss path, and
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
      section builder), `enc-direct-detail.ts` (the plain-English S-57 HTML
      detail renderer), and `noaa-enc-sections.ts` (the normalized-detail
      section builder).
    - `noaa-coops/` - the NOAA CO-OPS input (US tide and current stations,
      US-only, defaults off): `noaa-coops-input.ts` (the `InputModule` with the
      periodic refresh scheduler on `noaaCoopsRefreshHours`),
      `noaa-coops-source.ts` (the `PoiSource` over the client and store),
      `coops-client.ts` (the keyless mdapi client built on `http-one-shot.ts`
      with best-effort conditional GET), `coops-store.ts` (the on-disk station
      index under the plugin data directory), `coops-mapping.ts` (station to
      summary mapping; ids are `tide_<id>` / `current_<id>`),
      `coops-detail.ts` (the plain-English HTML renderer),
      `coops-sections.ts` (the normalized-detail section builder), and
      `noaa-coops-types.ts` (the mdapi wire types, private to this input).
    - `uscg-lnm/` - the USCG Local Notice to Mariners input (live US safety
      notices, US-only, defaults off): `uscg-lnm-input.ts` (the `InputModule`
      with the periodic refresh on `uscgLnmRefreshSeconds`, where a configured
      `0` means the default cadence, not no-cache), `uscg-lnm-source.ts` (the
      `PoiSource`; serves bbox-filtered from the in-memory record set),
      `lnm-client.ts` (the NAVCEN per-category GeoJSON client on
      `http-one-shot.ts` with conditional GET), `lnm-layers.ts` (the pinned
      file list and layer-to-`PoiType` mapping; danger layers map to `Hazard`
      so the alarms fire, and NAVCEN's duplicate-page quirk is neutralized by
      unioning records by business id), `lnm-store.ts` (the single-file
      on-disk store), `lnm-detail.ts`, `lnm-sections.ts`, and `lnm-types.ts`
      (the notice and discrepancy wire shapes normalized into one
      kind-discriminated record).
    - `wpi/` - the NGA World Port Index input (worldwide ports, defaults
      off): `wpi-input.ts` (the `InputModule`), `wpi-source.ts` (the
      `PoiSource`; the authoritative NGA endpoint is not bbox-queryable, so
      the source single-flight fetches the full near-static dataset on the
      `wpiRefreshHours` cadence, holds it complete in the hydrated detail
      cache with a WPI-specific entry cap, and bbox-filters in memory per
      list call), `wpi-client.ts` (the msi.nga.mil publications client on
      `http-one-shot.ts`), `wpi-mapping.ts` (Pub 150 coded-value decoding;
      ports map to `Marina` so they dedupe against ActiveCaptain markers),
      `wpi-detail.ts`, `wpi-sections.ts`, and `wpi-types.ts`.
    - `usace/` - the USACE locks and dams input (US inland waterways,
      defaults off; locks default on, dams default off because the National
      Inventory of Dams would bury the chart): `usace-input.ts` (the
      `InputModule`), `usace-source.ts` (the `PoiSource`; per-layer ArcGIS
      fan-out mirroring the NOAA ENC shape, with the US-waters gate on the
      list and detail-miss paths and the offline stale fallback),
      `usace-client.ts` (the ArcGIS REST client on `http-one-shot.ts` with
      envelope query and paging), `usace-mapping.ts` (locks map to `Lock`
      and dams to `Dam`, the types the route-hazard scan treats specially;
      wire dimensions are feet, stored SI via `metersFromFeet`),
      `usace-detail.ts`, `usace-sections.ts`, and `usace-types.ts`.
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
    the antimeridian-aware `bboxContainsPoint` (a box whose `west` exceeds
    its `east` wraps across the 180-degree line), and `projectPointOntoLeg`
    for corridor geometry).
  - `status/` - `plugin-status.ts` (records request outcomes, produces a
    `StatusSnapshot`; besides list, detail, error, and skip outcomes it exposes
    `recordStaleServe` so a source that serves cached markers while its
    upstream is unreachable reads as in error. Request-scoped list provenance
    tells the aggregate registry whether a fulfilled list proves upstream
    reachability),
    `status-router.ts` (Express router that serves the
    snapshot behind the shared admin gate), `admin-gate.ts` (the
    `ensureApiAdminGate` helper that installs the server admin middleware on the
    plugin's `/api` subtree once per app and reports whether it holds, so the
    status route mounts only when gated and otherwise fails closed), and
    `status-types.ts` (the `StatusSnapshot` type, shared by plugin and panel).
  - `shared/` - source-agnostic contracts and helpers shared across the
    plugin: `types.ts` (the cross-module type contracts; ActiveCaptain-only
    wire types live next to the ActiveCaptain input, not here),
    `plugin-id.ts` (the plugin id, the canonical repo URL, and the shared
    `PLUGIN_USER_AGENT` every upstream client consumes, all in one
    module so a rename touches one place),
    `source-ids.ts` (the eight PoiSource id constants, the `SOURCE_SLUGS`
    runtime list, and the `SourceSlug` union derived from it, shared by the
    input modules and the panel; extracted so the browser-bundled panel can
    import them without pulling in any node-only dependencies the source
    modules reach),
    `longitude.ts` (the inclusive longitude-wrap helper shared by projection,
    bbox-cache neighbor prefetch, and Overpass span clamping),
    `poi-type-selection.ts` (maps the config POI-type toggles to the
    `poiTypes` string the aggregate source uses), `seamark-groups.ts` (the
    OpenSeaMap seamark group ids, labels, and config normalizer, the single
    source of truth consumed by the OpenSeaMap input, source, schema, and
    panel), `overpass-endpoints.ts` (the browser-safe single source of truth
    for the default Overpass endpoint, the vetted fallback-mirror suggestions,
    `resolvePrimaryEndpoint`, and `normalizeFallbackEndpoints`, shared by the
    OpenSeaMap input, the panel's normalize-config, and the fallback-endpoints
    field; `overpass.osm.ch` is deliberately excluded from the suggestions as a
    Switzerland-only extract), `us-waters.ts` (the `isInUsWaters` gate plus the
    `shouldSkipOutsideUsWaters` helper the US-only inputs call to skip
    outbound HTTP, and record the skip, when the vessel is outside US
    waters), `abort.ts` (the `combineAbortSignals`
    helper, shared by the queued HTTP client, that folds an optional caller
    signal into an `AbortSignal.any` and returns the lone signal when only one
    is defined),
    `concurrency.ts` (the `mapWithConcurrency` bounded-concurrency fan-out, a
    shared-cursor worker pool that runs an async operation over a list with a
    small number in flight and returns the results in input order, shared by the
    USCG Light List refresh),
    `bbox-debounce.ts`
    (the per-source geographic stale-while-revalidate cache, which snaps each
    viewport to a coarse tile so a small pan reuses the previous fetch, serves
    a stale tile immediately while revalidating it in the background,
    collapses a concurrent same-tile burst into one upstream request, and
    prefetches the neighbor tile in the background when a small viewport
    approaches a tile edge, so a vessel underway crosses the grid cliff onto
    a warm tile; it depends on the node-only `lru-cache`), `bbox-debounce-bounds.ts`
    (the dependency-free, browser-safe companion holding the canonical
    `MIN_BBOX_DEBOUNCE_SECONDS` / `MAX_BBOX_DEBOUNCE_SECONDS` bounds, the
    per-source defaults, the `clampBboxDebounceSeconds` helper, and the
    `refreshSecondsSchema` config-fragment builder the at-runtime inputs share;
    split out of `bbox-debounce.ts` so the panel imports the bounds without
    pulling `lru-cache` into the browser bundle), `map-link.ts` (the
    OpenSeaMap-marker fallback deep link USCG Light List and NOAA ENC popups
    use), `html-escape.ts` (the shared `escapeHtml` helper every source's
    detail renderer consumes, plus `labeledParagraph`, the
    `<p><strong>Label:</strong> value.</p>` builder the structured detail
    renderers share, and `labeledMeters`, its meters-formatting sibling),
    `atomic-write-json.ts` (the async temp-file-and-rename JSON write the
    USCG Light List, USCG LNM, and NOAA CO-OPS stores share, with a commit-time
    lifecycle predicate that prevents a stopped run from publishing),
    `url-safety.ts` (the `safeLinkUrl` scheme allowlist both
    the Handlebars detail templates and the structured section builders gate a
    link value through), `notification-path.ts` (builds path-safe SignalK
    notification deltas, shared by the alarm outputs, with a `sourceSuffix`
    arg so proximity and route alarms get distinct `$source` brands),
    `notification-tracker.ts` (raise/clear bookkeeping shared by the
    proximity, route-hazard, and bridge air-draft outputs, keyed by the
    sanitized POI id so the in-memory and on-wire identities cannot drift,
    with a `clearStale` sweep and an episode clock that stamps `raisedAt` on
    the first `set` and preserves it across refreshes),
    `year-filter.ts` (the `filterByMinimumYear` helper plus the shared
    `MIN_YEAR` / `MAX_YEAR` / `DEFAULT_MINIMUM_YEAR` bounds, the
    `clampMinimumYear` helper, and the `minimumYearSchema` config-fragment
    builder), `rating.ts` (the `MIN_RATING` / `MAX_RATING` /
    `DEFAULT_MINIMUM_RATING` bounds and the `clampMinimumRating` helper),
    `cache-duration.ts`, `dedupe-radius.ts`, `refresh-hours.ts`,
    `scale-band.ts`, and `route-corridor.ts` (browser-safe single-source-of-truth
    homes for, respectively, the ActiveCaptain cache-duration bounds and schema;
    the dedupe merge-radius default and bounds; the refresh-hours bounds and
    schema the bulk-download sources share; the NOAA `ScaleBand` type plus
    constants; and the
    route-corridor-width bounds, `clampRouteCorridorWidth`, and schema),
    `config-schema.ts` (the `boundedNumberSchema` fragment constructor every
    bounds module's schema builder delegates to), `numbers.ts` (the
    `toFiniteNumber`, `finiteOrUndefined`, and `positiveFiniteNumber` narrowing
    helpers, the `isFiniteNumber` type guard, plus `isValidLatitude`,
    `isValidLongitude`, `isWireTruthy`, the `clampNumber` helper, the `roundTo`
    helper, and the `positiveCappedNumber` helper), `retry-after.ts` (the
    `parseRetryAfterMs` header parser shared by the queued upstream HTTP client),
    `strings.ts` (the `presentString` trim-and-reject-blank reader, plus
    `capitalizeFirst`), `debug.ts` (the `debugIsEnabled` guard), `cache.ts`
    (the `MAX_POI_CACHE_ENTRIES` and `MAX_BBOX_CACHE_ENTRIES` ceilings),
    `detail-store.ts` (the generic disk-backed detail store: an atomic-write,
    debounced, retention-bounded, entry-capped JSON store generic over the
    value type with a caller-supplied guard, node-only; the ActiveCaptain
    `poi-store.ts` binds it directly, and the OpenSeaMap, NOAA ENC, and USACE
    sources reach it through `hydrated-detail-cache.ts`, so a restart offline
    does not blank them), `hydrated-detail-cache.ts` (the LRU-plus-store
    lifecycle glue the OpenSeaMap, NOAA ENC, and USACE sources share: hydrates
    the detail LRU from disk at construction, mirrors inserts to the store, and
    on close flushes the pending write, drops the store reference so a late
    list resolution persists nothing, and clears the cache),
    `relative-time-format.ts` (the `formatRelativeDelta` unit-stepping the
    panel's status bar and the ActiveCaptain detail renderer share),
    `namespaced-id.ts` (the `splitOnFirstSeparator` helper, plus its
    `splitOnFirstUnderscore` wrapper), `time.ts` (the millisecond and
    second constants the relative-time formatters share), `length.ts` (the
    `METERS_PER_FOOT`, `METERS_PER_KM`, `METERS_PER_NAUTICAL_MILE`, and
    `METERS_PER_DEGREE` constants, and the `metersFromFeet` /
    `metersFromFeetInches` conversions), `format-meters.ts` (the
    `formatMeters` one-decimal meter formatter),
    `bridge-clearance.ts` (the bridge air-draft comparison: `readVesselAirDraft`,
    `bridgeBlocksVessel`, the margin bounds, and the config-fragment builders),
    `proximity-radius.ts` (the vessel-proximity alarm geometry shared by the
    proximity outputs: the radius bounds, `clampProximityAlarmRadius`,
    `proximityRadiusSchema`, `hysteresisThreshold`, and `vesselScanRadiusMeters`),
    `light-character.ts` (the IALA light-character humanizer the OpenSeaMap and
    USCG Light List detail renderers share), `self-paths.ts` (the
    `SELF_POSITION_PATH` and `SELF_SOG_PATH` constants), and
    `normalized-detail.ts` (the source-agnostic structured-notes schema:
    `NormalizedSection`, `NormalizedItem`, the item-`kind` union, the
    `schemaVersion`, and the shared `pushSection`, `textItem`, and
    `meterMeasureItem` builders).
  - `panel/` - federated React configuration panel. Root and reducer:
    `index.tsx` (Module Federation entry), `PluginConfigurationPanel.tsx`,
    `config-reducer.ts`, `normalize-config.ts`, plus the UI-metadata
    modules `active-captain-poi-types.ts`, `styles.ts` (the `--ac-*` design
    tokens: scale tokens plus light, dark, and red-preserving night theme
    blocks, each with `color-scheme`, and the `data-ac-theme` pinned
    overrides the theme toggle drives), `relative-time.ts`,
    `source-status-pill.ts` (the pure `pillVariant` + `pillContent` helpers
    used by the per-source live-status pill on each card header),
    `request-timeout.ts` (the panel-wide per-request timeout the status
    poller and the unit-preferences fetch share), and `unit-system.ts` (the
    React-free display-units module keyed off the server unit-preset's
    `categories.length.targetUnit`). `hooks/` holds `use-config`,
    `use-status` (which also exposes `lastUpdatedMs`), `use-theme` (the
    localStorage-persisted `ac-theme` choice), `use-unit-system` (resolves
    the display system from the server's unit preferences), `use-number-draft`
    (the raw-text draft state for clearable numeric inputs), and
    `use-collapse-focus-restore` (the shared focus-restore-on-collapse hook).
    `components/` holds the layout pieces: `SectionBox` (the shared
    collapsible-section primitive), `StatusBar`, `FooterBar` (sticky,
    composing `SaveStatus`), `DataSourcesSection` (the per-source accordion
    shell), `DataSourceCard` (one collapsible card, with an in-header
    live-status pill), `ActiveCaptainSource`, `OpenSeaMapSource`,
    `UscgLightListSource`, `NoaaEncSource`, `NoaaCoopsSource`,
    `UscgLnmSource`, `WpiSource`, and `UsaceSource` (the per-source card
    bodies), `IncludeToggles` (the shared import-layers checkbox grid with
    its empty-selection warning),
    `AlertsSection` (the proximity, route-hazard, and bridge air-draft
    controls); plus the per-field input components `LabeledField`,
    `NumberField`, `LengthField`, `CacheDurationField`, `EndpointUrlField`,
    `FallbackEndpointsField`, `Fieldset`, `Disclosure`, `ToggleFieldset`,
    `RatingFilterField`, `MinimumYearField`, `RefreshSecondsField`,
    `MergeWithActiveCaptain`, `ProximityAlarmFields`, `RouteHazardScanFields`,
    `BridgeAirDraftFields`, `ActiveCaptainPoiTypes`, `SeamarkGroups`,
    `SegmentedControl`, `ThemeToggle`, and `SaveStatus`.
    The panel is a per-source accordion: a top control bar with the theme
    toggle, the status bar, a collapsible card per data source, then the
    Alerts section. Card disclosure state lives at the panel root so the
    card bodies share one stable map.
- `test/` - `node:test` test suite, run through `tsx`.
- `docs/` - project documentation: the development guide, troubleshooting, the
  notes-resource integration guide (`notes-resource-format.md`), the Garmin API
  research notes, decision records, and maintainer notes.
- `assets/` - committed, published static files: `icons/` (the plugin icon in
  SVG and PNG sizes, wired through the `signalk.appIcon` field), and
  `screenshots/` (the admin-panel and Freeboard-SK images declared under
  `signalk.screenshots` for the plugin-registry listing).
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
- `npm run prepack` - clean and rebuild before packaging or publishing (runs
  automatically on `npm pack` and `npm publish`).

## Conventions

- All new code is TypeScript under `src/`.
- Keep modules focused and small. Shared types belong in `src/shared/types.ts`.
- Do not edit `dist/` or `public/`; they are generated.
- Run `npm run lint`, `npm run typecheck`, and `npm test` before committing.
