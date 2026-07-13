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
npm run build:icons   # Copy the SignalK admin-UI icon set into public/assets/icons/
npm test              # Run the test suite under test/
npm run typecheck     # Type-check the plugin, panel, and tests (no emit)
npm run lint          # Lint with ESLint 9 and neostandard
npm run lint:fix      # Lint and auto-fix
npm run clean         # Remove dist/ and the panel build artifacts
```

The `prepack` lifecycle runs `clean` then `build` automatically before
`npm pack` or `npm publish`.

## Architecture

The plugin imports points of interest (POIs) from multiple marine data sources
(Garmin ActiveCaptain, OpenSeaMap via the OpenStreetMap Overpass API, the USCG
Light List of US Aids to Navigation, NOAA ENC Direct's authoritative US
wrecks, obstructions, and underwater rocks, NOAA CO-OPS tide and current
stations, the USCG Local Notice to Mariners feeds, the NGA World Port Index,
and USACE locks and dams) and exposes them as Signal K `notes` resources, so
chartplotters such as Freeboard-SK can render them as an extra chart layer.

When the Signal K resources API receives a `notes` query, the plugin resolves
the query into a bounding box and asks the aggregate POI source for POIs in
that box. The aggregate fans the query out to every enabled input, namespaces
each resource id with its source slug, unions the results, and merges
duplicates that more than one source reports. POI detail summaries are fetched
lazily and rendered into HTML descriptions. The queued sources' HTTP clients
(ActiveCaptain and Overpass) rate-limit requests, retry `429` and `5xx`
responses with exponential backoff, and honor `Retry-After`; the low-volume
sources use a simpler one-shot client, with a shared conditional-GET envelope
(`http-conditional-get.ts`) for the bulk downloads (USCG Light List, Local
Notice to Mariners, and NOAA CO-OPS) and a shared ArcGIS REST paging protocol
(`arcgis-query.ts`) for the bbox-queried services (NOAA ENC Direct and
USACE). A cache holds detail responses so repeated queries do not refetch.

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
│   ├── http-client.ts     # Shared queued HTTP plumbing (ActiveCaptain, Overpass):
│   │                      #   queue, throttle, retry, Retry-After
│   ├── http-one-shot.ts   # One-shot GET shared by the low-volume raw clients
│   ├── http-conditional-get.ts # Conditional-GET envelope shared by the
│   │                      #   bulk-download sources (USCG Light List, USCG LNM,
│   │                      #   NOAA CO-OPS)
│   ├── arcgis-query.ts    # Shared ArcGIS REST /query paging protocol
│   │                      #   (NOAA ENC Direct, USACE)
│   ├── refresh-scheduler.ts # Periodic-refresh scheduler shared by the
│   │                      #   full-download inputs (Light List, CO-OPS, LNM)
│   ├── dedupe-pois.ts     # Merges duplicates against the ActiveCaptain base layer,
│   │                      #   then a same-source pass; radius configurable, default 150 ft
│   ├── active-captain/    # The ActiveCaptain input: module, source adapter, client,
│   │                      #   wire types, cache, store, detail renderer, templates,
│   │                      #   rating filter
│   ├── openseamap/        # The OpenSeaMap input: module, source adapter, Overpass
│   │                      #   client, seamark-type mapping
│   ├── uscg-light-list/   # The USCG Light List input (US-only, periodic-download
│   │                      #   with conditional GET): module, source adapter,
│   │                      #   NAVCEN client, on-disk index store, types, mapping,
│   │                      #   detail renderer
│   ├── noaa-enc/          # The NOAA ENC Direct input (US-only, at-runtime bbox
│   │                      #   query): module, source adapter, ArcGIS REST client,
│   │                      #   wire types, S-57 enum and per-layer mapping,
│   │                      #   plain-English detail renderer
│   ├── noaa-coops/        # The NOAA CO-OPS tide and current stations input
│   │                      #   (US and territories, periodic download): module,
│   │                      #   source adapter, keyless mdapi client, on-disk
│   │                      #   store, mapping, detail renderer, section builder
│   ├── uscg-lnm/          # The USCG Local Notice to Mariners input (US-only,
│   │                      #   periodic download of the NAVCEN GeoJSON layers):
│   │                      #   module, source adapter, client, on-disk store,
│   │                      #   pinned layer catalog, detail renderer, section
│   │                      #   builder
│   ├── wpi/               # The NGA World Port Index input (worldwide,
│   │                      #   full-index download held on disk): module, source
│   │                      #   adapter, client, Pub 150 code-to-label mapping,
│   │                      #   detail renderer, section builder
│   ├── usace/             # The USACE locks and dams input (US-only, at-runtime
│   │                      #   bbox query): module, source adapter, ArcGIS
│   │                      #   client, mapping, detail renderer, section builder
├── outputs/              # SignalK consumers of POI data
│   ├── output.ts          # The OutputModule and PositionScanContributor contracts
│   ├── output-registry.ts # Holds the outputs, starts the enabled ones
│   ├── notes-resource/    # The SignalK notes resource provider output
│   ├── proximity-alarm/   # The proximity hazard-alarm output
│   ├── route-hazard/      # The route-corridor hazard-scan output
│   └── bridge-air-draft/  # The bridge air-draft check (proximity + route-ahead warning)
├── monitoring/           # position-monitor.ts: drives the per-tick scan
├── geo/                  # position-utilities.ts: bounding-box and great-circle helpers
├── status/               # plugin-status.ts (per-source recorder), status-router.ts,
│                         #   admin-gate.ts (the shared admin gate the status route
│                         #   mounts behind), status-types.ts
├── shared/               # Source-agnostic helpers: types.ts (cross-module contracts;
│                         #   skIcon is required on PoiSummary and PoiDetailView),
│                         #   plugin-id.ts (id, repo URL, and shared User-Agent),
│                         #   poi-type-selection.ts, seamark-groups.ts,
│                         #   us-waters.ts (isInUsWaters plus the shouldSkipOutsideUsWaters
│                         #   gate the US-only inputs call), year-filter.ts and rating.ts
│                         #   (the filter/clamp plus shared bounds and config-schema
│                         #   builders every opting-in source uses), html-escape.ts
│                         #   (escapeHtml and labeledParagraph for the detail renderers),
│                         #   relative-time-format.ts (shared relative-time stepping),
│                         #   namespaced-id.ts (splitOnFirstUnderscore for the underscore
│                         #   id form), notification-path.ts, notification-tracker.ts,
│                         #   numbers.ts (toFiniteNumber, positiveFiniteNumber,
│                         #   isValidLatitude/Longitude, isWireTruthy), cache.ts,
│                         #   time.ts (MS_PER_SECOND/MINUTE/HOUR and
│                         #   SECONDS_PER_MINUTE/HOUR/DAY), source-ids.ts,
│                         #   bbox-debounce.ts (the geographic stale-while-revalidate
│                         #   cache), detail-store.ts and hydrated-detail-cache.ts
│                         #   (the disk-backed detail persistence behind the
│                         #   offline hydration), atomic-write-json.ts (the
│                         #   crash-safe JSON write the on-disk stores share),
│                         #   map-link.ts, bridge-clearance.ts, length.ts,
│                         #   proximity-radius.ts, light-character.ts, url-safety.ts
│                         #   (the safeLinkUrl scheme allowlist), overpass-endpoints.ts
│                         #   (the OpenSeaMap default and fallback mirrors), and
│                         #   normalized-detail.ts (the structured-notes schema).
│                         #   See CLAUDE.md for the complete module map
└── panel/                # Federated React configuration panel (bundled to public/)
    ├── index.tsx          # Federation entry; re-exports PluginConfigurationPanel
    ├── PluginConfigurationPanel.tsx  # Root panel component
    ├── config-reducer.ts  # Pure reducer over the plugin config (testable)
    ├── normalize-config.ts# Normalizes the raw config object
    ├── active-captain-poi-types.ts  # UI metadata: the ActiveCaptain POI-type groups
    ├── relative-time.ts   # ISO timestamp to a localized "N minutes ago" phrase
    ├── styles.ts          # The --ac-* design tokens and theme blocks
    ├── unit-system.ts     # The display-units resolver keyed off the server unit preset
    ├── hooks/             # use-config, use-status, use-theme, use-unit-system,
    │                      #   use-number-draft, use-collapse-focus-restore
    └── components/        # StatusBar, FooterBar, DataSourcesSection (per-source
                           #   accordion shell), DataSourceCard (one collapsible card),
                           #   ActiveCaptainSource, OpenSeaMapSource, UscgLightListSource,
                           #   NoaaEncSource, NoaaCoopsSource, UscgLnmSource, WpiSource,
                           #   UsaceSource (card bodies), AlertsSection (the proximity,
                           #   route-hazard, and bridge air-draft controls),
                           #   ThemeToggle; and the per-field input components, including
                           #   the shared NumberField, LengthField (the meters-backed,
                           #   unit-aware wrapper), MinimumYearField (the per-source
                           #   earliest-year filter), ProximityAlarmFields, and
                           #   RouteHazardScanFields
test/                     # node:test suites, run through tsx
dist/                     # Compiled plugin output (generated, not committed)
public/                   # Webpack Module Federation output for the panel (generated, not committed)
docs/                     # Project documentation
.github/                  # Community files, issue templates, and CI workflows
```

`dist/`, `public/`, and `assets/` are the directories published to npm (see
the `files` field in `package.json`). `assets/icons/` holds the SignalK
admin-UI icon set (the master SVG and the four rasterized PNGs), and the
`build:icons` script copies them under `public/assets/icons/` so the SignalK
admin's `express.static` mount can serve them at runtime.

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
`src/shared/types.ts`. Every `PoiSummary` and `PoiDetailView` a source produces
must set `skIcon` to a Freeboard-registered icon name; the field is required, so
an omission is a compile error. See [CLAUDE.md](../CLAUDE.md) for the full
architecture rule and conventions.

### The two acquisition patterns

Every input follows one of two acquisition patterns, each with shared
machinery a new source reuses:

- **Periodic download with conditional GET.** `src/inputs/uscg-light-list/`
  is the reference: it fetches the full NAVCEN district file set on a
  background scheduler (default daily), records HTTP `Last-Modified` and
  `ETag` responses, and replays them as `If-Modified-Since` and
  `If-None-Match` headers on the next refresh. The parsed records land in an
  on-disk index under the plugin data directory, so list queries are served
  entirely from memory and survive a restart. This pattern fits datasets
  that are large but rarely change. The NOAA CO-OPS
  (`src/inputs/noaa-coops/`), USCG Local Notice to Mariners
  (`src/inputs/uscg-lnm/`), and World Port Index (`src/inputs/wpi/`) inputs
  follow it too, through the shared machinery: the scheduler lives in
  `src/inputs/refresh-scheduler.ts`, the conditional-GET envelope in
  `src/inputs/http-conditional-get.ts`, and the crash-safe store write in
  `src/shared/atomic-write-json.ts`.
- **At-runtime bounding-box query.** `src/inputs/noaa-enc/` is the
  reference: it fans the list request out across the configured ArcGIS REST
  hazard layers in parallel, stashes raw features in an LRU detail cache,
  and re-queries by `OBJECTID` on a detail-cache miss. This pattern fits
  datasets where the upstream API is bbox-aware and the per-query result set
  is bounded. The USACE input (`src/inputs/usace/`) follows it, and the
  shared ArcGIS `/query` paging protocol both clients speak lives in
  `src/inputs/arcgis-query.ts`.

The US-only inputs (USCG Light List, NOAA ENC Direct, NOAA CO-OPS, USCG
Local Notice to Mariners, and USACE) are gated on the vessel position: they
call `shouldSkipOutsideUsWaters` (in `src/shared/us-waters.ts`), which reads
`InputContext.getCurrentPosition`, checks `isInUsWaters`, and records the skip,
so the source issues no outbound HTTP when the vessel has left US waters. A new
US-only source follows the same pattern.

Each input is registered on one line in `src/index.ts`. The
`InputModule.configSchema` fragment is merged automatically into the
plugin schema by the input registry; the matching panel card is added to
`src/panel/components/DataSourcesSection.tsx` with `DataSourceCard` as the
collapsible shell. Per-source dedupe against the ActiveCaptain base layer
is opt-in via `InputModule.isDedupeEnabled` and a `<source>Dedupe` config
key.

A source whose wire data carries a date per record can opt into the
earliest-year filter by populating `PoiSummary.timestamp` (ISO-8601 UTC)
and calling `filterByMinimumYear` from `src/shared/year-filter.ts` at the
end of `listPointsOfInterest`. The matching panel card mounts the shared
`MinimumYearField` component with a source-specific label and hint, and
the input module's config-schema fragment adds the source's
`<source>MinimumXxxYear` key clamped to the shared `[MIN_YEAR, MAX_YEAR]`
range. Three sources today follow this pattern: NOAA ENC Direct,
USCG Light List, and OpenSeaMap.

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
