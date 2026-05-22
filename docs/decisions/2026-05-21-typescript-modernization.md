# TypeScript modernization of signalk-activecaptain-resources

**Status:** Accepted. Implemented for v1.2.0.

**Date:** 2026-05-21

**Target release:** v1.2.0

## 1. Context

The plugin was written in plain JavaScript under `plugin/`, with snake_case
file names (`activecaptain_client.js`, `handlebars_utilities.js`,
`position_utilities.js`, `index.js`) and Handlebars partials as separate
`.hbsp` and `.hbs` files. It had no automated tests, no type checking, and the
toolchain had aged:

- Runtime dependencies were `axios`, `moment`, `@inventivetalent/loading-cache`,
  `@inventivetalent/time`, `handlebars`, and `helpers-for-handlebars`.
- Linting was ESLint 8 with `eslint-config-standard`.
- Configuration was the Signal K admin UI's stock generated settings form,
  which gave no live feedback and rendered the POI-type toggles as a flat,
  unscannable list.

## 2. Decision

Rewrite the plugin in TypeScript and modernize the toolchain, while keeping it
as exactly ONE npm package and ONE Signal K plugin.

- **Language.** All source becomes TypeScript under `src/`, compiled to `dist/`
  by `tsc` in strict mode. The plugin entrypoint exports the Signal K plugin
  factory.
- **Structure.** The code is split into focused modules rather than packages:
  the HTTP client, the detail cache, the geometry helpers, the resource-query
  parser, the POI-type selection, the Handlebars rendering, the inlined
  templates, the status recorder and router, and the shared type contracts in
  `src/types.ts`.
- **Dependencies.** `axios` is replaced by the native `fetch` API; `moment` by
  the native `Intl` API for relative times; the `@inventivetalent` caches by
  `lru-cache`. The runtime now depends only on `handlebars` and `lru-cache`.
- **Toolchain.** Linting moves to ESLint 9 with the neostandard flat config.
  The project targets TypeScript 6 and Node.js 20 or newer.
- **Tests.** A `node:test` suite, run through `tsx`, covers every module.
- **Configuration UI.** A federated React panel replaces the generated form
  (see `docs/superpowers/specs/2026-05-22-config-panel-design.md`).

## 3. Architecture rule

This repository ships exactly ONE npm package and ONE Signal K plugin. New
functionality is a new focused module under `src/`, never a new package and
never a monorepo. This rule is recorded in `CLAUDE.md` and is binding for all
future work.

## 4. Consequences

- The published npm package contains only `dist/` (compiled plugin) and
  `public/` (the bundled React panel); source, tests, and docs are not shipped.
- Two build steps now run under one `npm run build`: `tsc` for the plugin and
  webpack for the panel.
- Type checking and the test suite catch regressions that the old untyped,
  untested code could not, and CI runs them on Node.js 20 and 22.
- The legacy `plugin/` JavaScript files and their separate Handlebars template
  files are removed; templates are inlined as string constants.
