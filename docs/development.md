# Development

## Prerequisites

- Node.js 20.3 or newer
- TypeScript 6+ (installed as a dev dependency)
- npm

## Setup

```bash
git clone https://github.com/NearlCrews/signalk-crows-nest.git
cd signalk-crows-nest
npm install
```

## Build commands

```bash
npm run build         # Build the plugin and the configuration panel
npm run build:plugin  # Compile src/ (excluding src/panel/) to dist/ with tsc
npm run build:panel   # Bundle the React panel to public/ with webpack
npm test              # Run the test suite under test/
npm run typecheck     # Type-check the plugin, panel, and tests (no emit)
npm run lint          # Lint with ESLint 9 and neostandard
npm run lint:fix      # Lint and auto-fix
npm run clean         # Remove dist/ and the panel build artifacts
```

`npm run prepublishOnly` runs `clean` then `build` automatically before
`npm publish`.

## Architecture

The plugin imports points of interest (POIs) from multiple marine data sources
(Garmin ActiveCaptain and OpenSeaMap, via the OpenStreetMap Overpass API) and
exposes them as Signal K `notes` resources, so chart plotters such as
Freeboard-SK can render them as an extra chart layer.

When the Signal K resources API receives a `notes` query, the plugin resolves
the query into a bounding box and asks the aggregate POI source for POIs in
that box. The aggregate fans the query out to every enabled input, namespaces
each resource id with its source slug, unions the results, and merges
duplicates that more than one source reports. POI detail summaries are fetched
lazily and rendered into HTML descriptions. Each source's HTTP client
rate-limits requests, retries `429` and `5xx` responses with exponential
backoff, and honors `Retry-After`; a cache holds detail responses so repeated
queries do not refetch.

The plugin ships its own configuration panel: a federated React app, loaded by
the Signal K admin UI through Module Federation, that replaces the generated
settings form with a live status section and grouped POI-type toggles.

## Project structure

A POI data source is an "input"; a SignalK consumer of POI data is an "output".
Each is a self-contained module registered on one line in `src/index.ts`.

```
src/                      # TypeScript source
├── index.ts              # Plugin entrypoint: registers the input and output modules
├── plugin/               # The plugin shell
│   ├── plugin.ts          # Plugin factory: schema assembly, start/stop lifecycle
│   └── plugin-config.ts   # Merges per-module config-schema fragments into one schema
├── inputs/               # POI data sources
│   ├── poi-source.ts      # The PoiSource and InputModule contracts
│   ├── input-registry.ts  # Holds the inputs, builds the aggregate PoiSource
│   ├── dedupe-pois.ts     # Merges duplicate POIs against the ActiveCaptain base
│   ├── active-captain/    # The ActiveCaptain input (module, source adapter, client,
│   │                      #   cache, store, detail renderer, templates, rating filter)
│   └── openseamap/        # The OpenSeaMap input (module, source adapter, Overpass
│                          #   client, seamark-type mapping)
├── outputs/              # SignalK consumers of POI data
│   ├── output.ts          # The OutputModule and PositionScanContributor contracts
│   ├── output-registry.ts # Holds the outputs, starts the enabled ones
│   ├── notes-resource/    # The SignalK notes resource provider output
│   ├── proximity-alarm/   # The proximity hazard-alarm output
│   └── route-hazard/      # The route-corridor hazard-scan output
├── monitoring/           # position-monitor.ts: drives the per-tick scan
├── geo/                  # position-utilities.ts: bounding-box and great-circle helpers
├── status/               # plugin-status.ts (per-source recorder), status-router.ts, status-types.ts
├── shared/               # types.ts, plugin-id.ts, poi-type-selection.ts, attribution.ts, notification-path.ts, time.ts
└── panel/                # Federated React configuration panel (bundled to public/)
    ├── index.tsx          # Federation entry; re-exports PluginConfigurationPanel
    ├── PluginConfigurationPanel.tsx  # Root panel component
    ├── config-reducer.ts  # Pure reducer over the plugin config (testable)
    ├── normalize-config.ts# Normalizes the raw config object
    ├── active-captain-poi-types.ts  # UI metadata: the ActiveCaptain POI-type groups
    ├── seamark-groups.ts  # UI metadata: the OpenSeaMap seamark groups
    ├── styles.ts          # Inline style objects
    ├── hooks/             # use-config, use-status
    └── components/        # StatusBar, DataSourcesSection, DataSourceCard,
                           #   ActiveCaptainSource, OpenSeaMapSource, AlertsSection,
                           #   and the per-field input components
test/                     # node:test suites, run through tsx
dist/                     # Compiled plugin output (generated, not committed)
public/                   # Webpack Module Federation output for the panel (generated, not committed)
docs/                     # Project documentation
.github/                  # Community files, issue templates, and CI workflows
```

`dist/`, `public/`, and `assets/` are the directories published to npm (see
the `files` field in `package.json`).

## Testing

Tests run on the Node.js built-in `node:test` runner through `tsx`, so there is
no separate test framework. The suite lives under `test/`, with one test file
per module, named for the module it covers (for example,
`test/active-captain-client.test.ts` covers the HTTP client and
`test/position-monitor.test.ts` covers the per-tick scan).

`npm run typecheck` runs three `tsc` passes with no emit: the plugin runtime
(`tsconfig.json`, which excludes `test/` and `src/panel/`), the React panel
(`tsconfig.panel.json`), and the test suite (`tsconfig.test.json`).

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before
committing.

## Adding functionality

This repository ships exactly ONE npm package and ONE Signal K plugin. New
functionality is a new focused module under `src/`, never a new package or a
monorepo. A new POI data source is a new `InputModule` under `src/inputs/`, and
a new consumer of POI data is a new `OutputModule` under `src/outputs/`, each
registered in `src/index.ts`. Keep modules small and put shared types in
`src/shared/types.ts`. See [CLAUDE.md](../CLAUDE.md) for the full architecture
rule and conventions.

For details of the ActiveCaptain API the client talks to, see
[docs/garmin-api.md](garmin-api.md).

## Releasing

The release process and checklist live in
[docs/maintainers/releasing.md](maintainers/releasing.md).

## Contributing

See [CONTRIBUTING.md](../.github/CONTRIBUTING.md). In short: fork, create a
feature branch from `main`, make changes with proper TypeScript types, add
tests for new functionality, ensure lint, type-check, tests, and the build all
pass, then open a pull request.
