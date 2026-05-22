# Development

## Prerequisites

- Node.js 20 or newer
- TypeScript 6+ (installed as a dev dependency)
- npm

## Setup

```bash
git clone https://github.com/KvotheBloodless/signalk-activecaptain-resources.git
cd signalk-activecaptain-resources
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

The plugin imports points of interest (POIs) from the Garmin ActiveCaptain
community API and exposes them as Signal K `notes` resources, so chart plotters
such as Freeboard-SK can render them as an extra chart layer.

When the Signal K resources API receives a `notes` query, the plugin resolves
the query into a bounding box and position, asks the ActiveCaptain client for
POIs in that box, and returns them as notes resources. POI detail summaries are
fetched lazily and rendered into HTML descriptions with Handlebars. The HTTP
client rate-limits requests, retries `429` and `5xx` responses with exponential
backoff, and honours `Retry-After`. A TTL cache holds detail responses so
repeated queries do not refetch.

The plugin ships its own configuration panel: a federated React app, loaded by
the Signal K admin UI through Module Federation, that replaces the generated
settings form with a live status section and grouped POI-type toggles.

## Project structure

```
src/                      # TypeScript source
├── index.ts              # Plugin entrypoint: config schema, notes resource provider, lifecycle
├── activeCaptainClient.ts# HTTP client for the ActiveCaptain API (rate limiting, backoff, Retry-After)
├── poiCache.ts           # TTL cache of POI detail responses, backed by lru-cache
├── positionUtilities.ts  # Geo helpers (position to bounding box, longitude normalization)
├── resourceQuery.ts      # Parses a Signal K resource query into a bounding box and position
├── poiTypeSelection.ts   # Maps config POI-type toggles to the API poiTypes string
├── handlebarsUtilities.ts# Registers Handlebars helpers, renders POI detail descriptions
├── templates.ts          # Handlebars templates and partials, inlined as string constants
├── pluginStatus.ts       # Request-outcome recorder, produces a StatusSnapshot
├── statusRouter.ts       # Admin-gated Express router that serves the status snapshot
├── statusTypes.ts        # StatusSnapshot type, shared by plugin and panel
├── types.ts              # Shared type contracts and ActiveCaptain wire types
└── panel/                # Federated React configuration panel (bundled to public/)
    ├── index.tsx          # Federation entry; re-exports PluginConfigurationPanel
    ├── PluginConfigurationPanel.tsx  # Root panel component
    ├── configReducer.ts   # Pure reducer over the plugin config (testable)
    ├── poiTypeGroups.ts   # UI metadata: the four POI-type groups and labels
    ├── styles.ts          # Inline style objects
    ├── hooks/             # useConfig, useStatus
    └── components/        # StatusBar, PoiTypeGroups, CacheDurationField, FooterBar
test/                     # node:test suites, run through tsx
dist/                     # Compiled plugin output (generated, not committed)
public/                   # Webpack Module Federation output for the panel (generated, not committed)
docs/                     # Project documentation
.github/                  # Community files, issue templates, and CI workflows
```

`dist/` and `public/` are the only directories published to npm (see the
`files` field in `package.json`).

## Testing

Tests run on the Node.js built-in `node:test` runner through `tsx`, so there is
no separate test framework. The suite lives under `test/`, one file per tested
module:

```
test/activeCaptainClient.test.ts   # HTTP client: rate limiting, backoff, Retry-After
test/configReducer.test.ts         # Panel config reducer
test/handlebarsUtilities.test.ts   # Handlebars helpers and POI rendering
test/poiCache.test.ts              # TTL cache behavior
test/poiTypeSelection.test.ts      # POI-type toggle to poiTypes string mapping
test/pluginStatus.test.ts          # Status snapshot recorder
test/positionUtilities.test.ts     # Geo helpers
test/resourceQuery.test.ts         # Resource query parsing
```

`npm run typecheck` runs three `tsc` passes with no emit: the plugin runtime
(`tsconfig.json`, which excludes `test/` and `src/panel/`), the React panel
(`tsconfig.panel.json`), and the test suite (`tsconfig.test.json`).

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before
committing.

## Adding functionality

This repository ships exactly ONE npm package and ONE Signal K plugin. New
functionality is a new focused module under `src/`, never a new package or a
monorepo. Keep modules small and put shared types in `src/types.ts`. See
[CLAUDE.md](../CLAUDE.md) for the full architecture rule and conventions.

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
