# CLAUDE.md

Guidance for Claude Code (and contributors) working in this repository.

## What this is

`signalk-crows-nest` is a single [Signal K server](https://github.com/SignalK/signalk-server)
plugin. It imports points of interest from multiple marine data sources
(Garmin ActiveCaptain, OpenSeaMap via the OpenStreetMap Overpass API, the USCG
Light List of US Aids to Navigation, and the NOAA ENC Direct database of
wrecks, obstructions, and underwater rocks) and exposes them as Signal K
`notes` resources so chart plotters such as Freeboard-SK can display them.

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
      `http`/`https` transport, buffers the body, and aborts on a per-request
      timeout, leaving each caller its own status and JSON handling. Those two
      feeds are low-volume and deliberately skip the queue and retry of
      `http-client.ts`.
    - `dedupe-pois.ts` - merges non-base POIs that duplicate an ActiveCaptain
      base POI, then runs a same-source pass that collapses internal
      duplicates within a configurable radius (default 150 meters), so a
      feature reported by several sources becomes one corroborated note rather
      than overlapping markers. It also owns `DEFAULT_DEDUPE_RADIUS_METERS` and
      the `dedupeToggleSchema` / `dedupeRadiusSchema` config-fragment builders
      every non-base input's schema reuses.
    - `active-captain/` - the ActiveCaptain input: `active-captain-input.ts`
      (the `InputModule`), `active-captain-source.ts` (the `PoiSource` adapter
      over the client, cache, and store), `active-captain-client.ts` (the
      ActiveCaptain-specific HTTP client built on `http-client.ts`),
      `active-captain-types.ts` (the ActiveCaptain summary-API wire types,
      private to this input), `poi-cache.ts` (TTL detail cache), `poi-store.ts`
      (disk-backed detail store, readable offline), `poi-detail-renderer.ts`
      (Handlebars helpers and POI detail rendering), `templates.ts` (inlined
      Handlebars templates), `rating-filter.ts` (drops list entries below
      the configured minimum rating), and `active-captain-sections.ts` (builds
      the normalized `properties.crowsNest` detail sections from the
      `PoiDetails`, reusing the renderer's humanizer so the two cannot drift).
    - `openseamap/` - the OpenSeaMap input (OpenStreetMap marine data via the
      OSM Overpass API): `openseamap-input.ts` (the `InputModule`),
      `openseamap-source.ts` (the `PoiSource` adapter over the client and an
      in-memory detail cache; uses an underscore-separated internal id form
      like `node_123` so the slash in raw OSM ids never splits the resource
      URL), `overpass-client.ts` (the Overpass HTTP client built on
      `http-client.ts`, with the required `User-Agent`),
      `seamark-mapping.ts` (maps every `seamark:type` value onto the
      plugin's `PoiType` union AND onto a Freeboard-registered `:sk-` icon,
      with isolated-danger marks rendered as hazards; defines the seamark
      feature groups), `openseamap-detail.ts` (the plain-English HTML detail
      renderer), `clearance.ts` (parses the OSM vertical-clearance tags for the
      bridge air-draft check), and `openseamap-sections.ts` (the
      normalized-detail section builder).
    - `uscg-light-list/` - the USCG Light List input (US Aids to Navigation,
      US-only, defaults off): `uscg-light-list-input.ts` (the `InputModule`
      with the periodic refresh scheduler), `uscg-light-list-source.ts` (the
      `PoiSource` adapter over the client and store, with a position-gated
      `refreshAll` that iterates the pinned 37 (district, page) pairs and
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
      in an LRU detail cache, gates outbound HTTP on `isInUsWaters`, and
      uses an underscore-separated id form like `wreck_12345` so the slash
      in `wreck/12345` does not split the resource URL),
      `enc-direct-client.ts` (the ArcGIS REST client built on
      `http-one-shot.ts`, with band-and-layer-id query and paging),
      `enc-direct-types.ts` (the ENC Direct wire types, including JSDoc on
      the wire-shape quirks: CATWRK as a decoded string, WATLEV as a
      number, OBJNAM frequently null), and `s57-mapping.ts` (the S-57 enum
      tables (WATLEV, QUASOU, TECSOU) plus per-layer `PoiType` and
      `:sk-` icon mappings and a `humanizeCategory` helper. CATWRK and
      CATOBS are intentionally absent because the wire serves them as
      decoded strings), `enc-direct-detail.ts` (the plain-English S-57 HTML
      detail renderer), and `noaa-enc-sections.ts` (the normalized-detail
      section builder).
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
    position to bounding box, great-circle `distanceMeters`, `unionBbox`, and
    `projectPointOntoLeg` for corridor geometry).
  - `status/` - `plugin-status.ts` (records request outcomes, produces a
    `StatusSnapshot`), `status-router.ts` (admin-gated Express router that
    serves the snapshot), and `status-types.ts` (the `StatusSnapshot` type,
    shared by plugin and panel).
  - `shared/` - source-agnostic contracts and helpers shared across the
    plugin: `types.ts` (the cross-module type contracts; ActiveCaptain-only
    wire types live next to the ActiveCaptain input, not here),
    `plugin-id.ts` (the plugin id, the canonical repo URL, and the shared
    `PLUGIN_USER_AGENT` every upstream client consumes, all in one
    module so a rename touches one place),
    `source-ids.ts` (the four PoiSource id constants and the `SourceSlug`
    union, shared by the input modules and the panel; extracted so the
    browser-bundled panel can import them without pulling in any
    node-only dependencies the source modules reach),
    `poi-type-selection.ts` (maps the config POI-type toggles to the
    `poiTypes` string the aggregate source uses), `seamark-groups.ts` (the
    OpenSeaMap seamark group ids and labels, the single source of truth
    consumed by the OpenSeaMap input, its config-schema fragment, and the
    panel), `us-waters.ts` (the `isInUsWaters` gate plus the
    `shouldSkipOutsideUsWaters` helper the US-only inputs call to skip
    outbound HTTP, and record the skip, when the vessel is outside US
    waters), `bbox-debounce.ts`
    (the per-source geographic stale-while-revalidate cache, which snaps each
    viewport to a coarse tile so a small pan reuses the previous fetch, serves
    a stale tile immediately while revalidating it in the background, and
    collapses a concurrent same-tile burst into one upstream request, plus the
    canonical
    `DEFAULT_BBOX_DEBOUNCE_SECONDS` / `MIN_BBOX_DEBOUNCE_SECONDS` /
    `MAX_BBOX_DEBOUNCE_SECONDS` bounds, the `clampBboxDebounceSeconds`
    helper that every input module and the panel's normalize-config
    consume, and the `refreshSecondsSchema` config-fragment builder the
    at-runtime inputs share), `map-link.ts` (the OpenSeaMap-marker fallback deep link
    USCG Light List and NOAA ENC popups use, since neither upstream
    viewer supports per-feature deep links), `html-escape.ts` (the
    shared `escapeHtml` helper every source's detail renderer consumes,
    so the four metacharacters plus the apostrophe are escaped from one
    place, plus `labeledParagraph`, the `<p><strong>Label:</strong>
    value.</p>` builder the structured detail renderers share),
    `notification-path.ts` (builds path-safe SignalK notification
    deltas, shared by the alarm outputs, with a `sourceSuffix` arg so
    proximity and route alarms get distinct `$source` brands),
    `notification-tracker.ts` (raise/clear bookkeeping shared by the
    proximity and route-hazard outputs, keyed by the sanitized POI id
    so the in-memory and on-wire identities cannot drift),
    `year-filter.ts` (the `filterByMinimumYear` helper plus the shared
    `MIN_YEAR` / `MAX_YEAR` / `DEFAULT_MINIMUM_YEAR`
    bounds and the `clampMinimumYear` helper every opting-in source uses
    for its earliest-year filter, plus the `minimumYearSchema`
    config-fragment builder the opting-in inputs share), `rating.ts` (the
    `MIN_RATING` / `MAX_RATING` / `DEFAULT_MINIMUM_RATING` bounds and the
    `clampMinimumRating` helper the ActiveCaptain input and the panel's
    normalize-config share, mirroring the year-filter and bbox-debounce
    shared-bounds pattern), `numbers.ts` (the `toFiniteNumber`
    and `positiveFiniteNumber` narrowing helpers, both returning `null`
    on a non-usable value, plus `isValidLatitude`, `isValidLongitude`,
    `isWireTruthy`, and the `clampNumber` bound-and-fallback helper the four
    config-bounds modules delegate to), `cache.ts`
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
    constants plus the `SECONDS_PER_MINUTE` / `SECONDS_PER_HOUR` /
    `SECONDS_PER_DAY` constants the relative-time formatters share),
    `length.ts` (the `METERS_PER_FOOT` constant and the `metersFromFeet` /
    `metersFromFeetInches` conversions the two bridge-clearance parsers share),
    `bridge-clearance.ts` (the bridge air-draft comparison: `readVesselAirDraft`
    reads `design.airHeight` then a config fallback, `bridgeBlocksVessel` plus
    the margin bounds and `clampClearanceMargin`, the `formatMeters` message
    helper, and the config-fragment builders; pure and panel-bundle-safe),
    `proximity-radius.ts` (the vessel-proximity alarm geometry shared by the two
    proximity outputs, the two alarm modules, and the panel: the default radius,
    the scan floor and factor, the exit-radius factor, and
    `vesselScanRadiusMeters`), `light-character.ts` (the IALA
    light-character humanizer the OpenSeaMap and USCG Light List detail
    renderers share), and `normalized-detail.ts` (the source-agnostic
    structured-notes schema: `NormalizedSection`, `NormalizedItem`, the
    item-`kind` union, the `schemaVersion`, and the shared `pushSection`
    builder every source's section builder produces onto a note's
    `properties.crowsNest`; documented for consumers in
    `docs/notes-resource-format.md`).
  - `panel/` - federated React configuration panel. Root and reducer:
    `index.tsx` (Module Federation entry), `PluginConfigurationPanel.tsx`,
    `config-reducer.ts`, `normalize-config.ts`, plus the UI-metadata
    modules `active-captain-poi-types.ts`, `styles.ts`, `relative-time.ts`,
    and `source-status-pill.ts` (the pure `pillVariant` + `pillContent`
    helpers used by the per-source live-status pill on each card header,
    in a non-tsx module so the unit tests import it without JSX).
    `hooks/` holds `use-config`, `use-status`, `use-number-draft` (the
    raw-text draft state for clearable numeric inputs), and
    `use-collapse-focus-restore` (the shared focus-restore-on-collapse hook
    both `SectionBox` and `DataSourceCard` consume, so a keyboard user is not
    dropped to `document.body` when a region collapses). `components/` holds
    the layout pieces: `SectionBox` (the shared collapsible-section
    primitive: section heading, chevron, and focus-restore on collapse via
    the shared hook), and
    on top of it `StatusBar`, `FooterBar`, `DataSourcesSection`
    (the per-source accordion shell), `DataSourceCard` (one collapsible
    card, with an in-header live-status pill and a body that stays mounted
    via `display: none` (and marked `inert` while collapsed) so an
    in-progress NumberField draft survives a
    collapse-and-expand round trip), `ActiveCaptainSource`,
    `OpenSeaMapSource`, `UscgLightListSource`, and `NoaaEncSource` (the
    per-source card bodies), `AlertsSection` (the proximity, route-hazard, and
    bridge air-draft controls); plus the per-field input components
    `CacheDurationField`, `EndpointUrlField`, `NumberField` (the shared
    label-plus-input-plus-hint row), `ToggleFieldset` (the shared opt-in
    toggle-plus-legend fieldset shell), `AlarmFieldset` (the toggle-plus-numeric
    layout, composing `ToggleFieldset`, shared by both alarm controls),
    `RatingFilterField`, `MinimumYearField` (the shared earliest-year
    NumberField wrapper used by each opting-in source card),
    `RefreshSecondsField` (the shared NumberField wrapper for the
    bbox-debounce period on at-runtime sources),
    `MergeWithActiveCaptain` (the shared dedupe-toggle + merge-radius
    fieldset, also composing `ToggleFieldset`, used by every non-base card),
    `ProximityAlarmFields`, `RouteHazardScanFields`, `BridgeAirDraftFields` (the
    bridge air-draft check controls), `ActiveCaptainPoiTypes`, and
    `SeamarkGroups`.
    The panel is a per-source accordion: a collapsible card per data
    source, then an Alerts section. Disclosure state lives at the panel
    root so the four card bodies share one stable map.
- `test/` - `node:test` test suite, run through `tsx`.
- `docs/` - project documentation: the development guide, troubleshooting, the
  notes-resource integration guide (`notes-resource-format.md`), the Garmin API
  research notes, decision records, and maintainer notes.
- `assets/` - committed, published static files: `icons/` (the plugin icon in
  SVG and PNG sizes, wired through the `signalk.appIcon` field) and
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
- `npm run prepublishOnly` - clean and rebuild before publishing (runs
  automatically on `npm publish`).

## Conventions

- All new code is TypeScript under `src/`.
- Keep modules focused and small. Shared types belong in `src/shared/types.ts`.
- Do not edit `dist/` or `public/`; they are generated.
- Run `npm run lint`, `npm run typecheck`, and `npm test` before committing.
