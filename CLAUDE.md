# CLAUDE.md

Guidance for Claude Code (and contributors) working in this repository.

## What this is

`signalk-crows-nest` is a single [Signal K server](https://github.com/SignalK/signalk-server)
plugin. It imports points of interest from multiple marine data sources
(Garmin ActiveCaptain, and OpenSeaMap via the OpenStreetMap Overpass API) and
exposes them as Signal K `notes` resources so chart plotters such as
Freeboard-SK can display them.

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
    - `dedupe-pois.ts` - merges non-base POIs that duplicate an ActiveCaptain
      base POI, so a feature reported by several sources becomes one
      corroborated note rather than overlapping markers.
    - `active-captain/` - the ActiveCaptain input: `active-captain-input.ts`
      (the `InputModule`), `active-captain-source.ts` (the `PoiSource` adapter
      over the client, cache, and store), `active-captain-client.ts` (the HTTP
      client, with rate limiting, exponential backoff, and `Retry-After`
      support), `poi-cache.ts` (TTL detail cache), `poi-store.ts` (disk-backed
      detail store, readable offline), `poi-detail-renderer.ts` (Handlebars
      helpers and POI detail rendering), `templates.ts` (inlined Handlebars
      templates), and `rating-filter.ts` (drops list entries below the
      configured minimum rating).
    - `openseamap/` - the OpenSeaMap input (OpenStreetMap marine data via the
      OSM Overpass API): `openseamap-input.ts` (the `InputModule`),
      `openseamap-source.ts` (the `PoiSource` adapter over the client and an
      in-memory detail cache), `overpass-client.ts` (the Overpass HTTP client,
      with rate limiting, backoff, and the required `User-Agent`), and
      `seamark-mapping.ts` (maps `seamark:type` values onto the plugin's
      `PoiType` union and defines the seamark feature groups).
  - `outputs/` - SignalK consumers of POI data.
    - `output.ts` - the `OutputModule`, `OutputHandle`, `OutputContext`, and
      `PositionScanContributor` contracts an output implements.
    - `output-registry.ts` - holds the registered outputs and starts the
      enabled ones.
    - `notes-resource/` - the `notes` resource output: `notes-resource-output.ts`
      (the `OutputModule` that registers the SignalK `notes` provider),
      `note-builder.ts` (turns a POI into a `notes` resource object), and
      `resource-query.ts` (parses a resource query into a bounding box).
    - `proximity-alarm/` - the proximity-alarm output: `proximity-alarm-output.ts`
      (the `OutputModule`) and `proximity-alarms.ts` (emits SignalK hazard
      notifications, with hysteresis, near a Hazard).
    - `route-hazard/` - the route-corridor hazard output: `route-hazard-output.ts`
      (the `OutputModule`), `route-hazard-alarms.ts` (emits SignalK route
      notifications, raised once and cleared once), `route-corridor.ts` (pure
      corridor geometry), and `course-reader.ts` (reads the active route from
      the SignalK Course API).
  - `monitoring/` - `position-monitor.ts` subscribes to `navigation.position`
    and drives the per-tick scan from the position-driven outputs' scan
    contributors.
  - `geo/` - `position-utilities.ts`: geo helpers (`toPosition` parsing,
    position to bounding box, great-circle `distanceMeters`, `unionBbox`, and
    `projectPointOntoLeg` for corridor geometry).
  - `status/` - `plugin-status.ts` (records request outcomes, produces a
    `StatusSnapshot`), `status-router.ts` (admin-gated Express router that
    serves the snapshot), and `status-types.ts` (the `StatusSnapshot` type,
    shared by plugin and panel).
  - `shared/` - `types.ts` (shared type contracts, the single source of truth
    for the data shapes), `plugin-id.ts` (the plugin id, shared by plugin and
    panel), `poi-type-selection.ts` (maps the config POI-type toggles to the
    API `poiTypes` string), `notification-path.ts` (builds path-safe SignalK
    notification deltas, shared by the alarm outputs), and `time.ts` (the
    minute-to-millisecond constant shared by the cache and store).
  - `panel/` - federated React configuration panel (`index.tsx`,
    `PluginConfigurationPanel.tsx`, `config-reducer.ts`, `normalize-config.ts`,
    `active-captain-poi-types.ts`, `seamark-groups.ts`, `styles.ts`, plus
    `hooks/` and `components/`). The panel is a per-source accordion: a
    collapsible card per data source, then an Alerts section.
- `test/` - `node:test` test suite, run through `tsx`.
- `docs/` - project documentation: the development guide, troubleshooting, the
  Garmin API research notes, decision records, and maintainer notes.
- `dist/` and `public/` - compiled plugin and bundled panel. Generated, not
  committed. They, together with the committed `assets/` directory, are
  published to npm (see the `files` field in `package.json`).

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
