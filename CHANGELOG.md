## Change Log

<a id="v120"></a>

### v1.2.0 (2026/05/21) - TypeScript rewrite, modern toolchain, and a React configuration panel

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
- The panel requires Signal K admin UI 2.27.0 or newer; on older servers the
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
