# CLAUDE.md

Guidance for Claude Code (and contributors) working in this repository.

## What this is

`signalk-activecaptain-resources` is a single [Signal K server](https://github.com/SignalK/signalk-server)
plugin. It imports points of interest from the Garmin ActiveCaptain API and
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
- New functionality is a new module under `src/`, not a new package.

## Layout

- `src/` - TypeScript source. The Node plugin (everything except `src/panel/`)
  is compiled to `dist/` by `tsc`; the React panel under `src/panel/` is
  bundled to `public/` by webpack.
  - `index.ts` - plugin entrypoint. Exports the Signal K plugin factory via
    `export =`, defines the config schema (caching duration plus 13 POI-type
    toggles), registers the `notes` resource provider, and mounts the
    admin-gated status API via `registerWithRouter`.
  - `activeCaptainClient.ts` - HTTP client for the ActiveCaptain API, built on
    native `fetch` with rate limiting, exponential backoff, and `Retry-After`
    support.
  - `poiCache.ts` - TTL cache of point-of-interest detail responses, backed by
    `lru-cache`.
  - `positionUtilities.ts` - geo helpers (position to bounding box, etc).
  - `resourceQuery.ts` - parses an incoming Signal K resource query into a
    bounding box and position (`resolveBbox`, `resolvePosition`).
  - `poiTypeSelection.ts` - maps the config POI-type toggles to the API
    `poiTypes` string (`POI_TYPE_FLAGS`, `buildPoiTypesString`).
  - `handlebarsUtilities.ts` - registers Handlebars helpers and renders POI
    detail descriptions. Relative times use the native `Intl` API.
  - `templates.ts` - Handlebars templates and partials, inlined as string
    constants so no extra files need to be published.
  - `pluginStatus.ts` - records request outcomes and produces a
    `StatusSnapshot` for the configuration panel.
  - `statusRouter.ts` - admin-gated Express router factory that serves the
    status snapshot.
  - `statusTypes.ts` - the `StatusSnapshot` type, shared by plugin and panel.
  - `types.ts` - shared type contracts (the single source of truth for the
    data shapes that flow between modules and the ActiveCaptain wire types).
  - `panel/` - federated React configuration panel (`index.tsx`,
    `PluginConfigurationPanel.tsx`, `configReducer.ts`, `poiTypeGroups.ts`,
    `styles.ts`, plus `hooks/` and `components/`).
- `test/` - `node:test` test suite, run through `tsx`.
- `docs/` - project documentation: the development guide, troubleshooting, the
  Garmin API research notes, decision records, and maintainer notes.
- `dist/` and `public/` - compiled plugin and bundled panel. Generated, not
  committed. These are the only directories published to npm (see the `files`
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
- Node.js 20 or newer.
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
- Keep modules focused and small. Shared types belong in `src/types.ts`.
- Do not edit `dist/` or `public/`; they are generated.
- Run `npm run lint`, `npm run typecheck`, and `npm test` before committing.
