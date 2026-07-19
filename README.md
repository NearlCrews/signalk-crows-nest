# Crow's Nest

[![npm version](https://img.shields.io/npm/v/signalk-crows-nest.svg)](https://www.npmjs.com/package/signalk-crows-nest)
[![npm downloads](https://img.shields.io/npm/dm/signalk-crows-nest.svg)](https://www.npmjs.com/package/signalk-crows-nest)
[![CI](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/ci.yml)
[![ESLint](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/eslint.yml/badge.svg)](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/eslint.yml)
[![SignalK Plugin CI](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/plugin-ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/plugin-ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/NearlCrews/signalk-crows-nest/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.3-brightgreen.svg)](https://nodejs.org)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/nearlcrews)

A points-of-interest importer for [Signal K](https://signalk.org): it pulls
marinas, ports, anchorages, hazards, aids to navigation, live safety notices,
tide and current stations, locks, and chart hazards from eight marine data
sources and publishes them as Signal K `notes` resources, with proximity,
route-corridor, and bridge air-draft alarms.

> Built on the foundation of [`signalk-activecaptain-resources`](https://github.com/KvotheBloodless/signalk-activecaptain-resources)
> by Paul Willems and the Signal K community.

> The alarms and the imported data are advisory. They are not certified for
> safety-of-life navigation: always cross-check against official charts and
> your primary instruments.

## What's new in 0.14.0

- **Route warnings react while the vessel is stationary.** Changing the
  active route now requests a fresh safety scan immediately, and the scan
  limits a long first leg to the 10-nautical-mile look-ahead.
- **Cleaner source shutdown and refresh behavior.** Stopping the plugin now
  cancels retry delays, bulk refreshes, and NOAA or USACE ArcGIS requests
  promptly. Async stores cannot commit a flush after shutdown, and complete
  World Port Index refreshes remove ports that are no longer present upstream.
- **More accurate status and resource responses.** Concurrent requests keep
  their own source provenance, cached reads no longer hide refresh failures,
  empty source selections read as intentional skips, malformed spatial queries
  are rejected, and notification timestamps reflect the current publication
  time.
- **Safer spatial and transport boundaries.** ArcGIS queries split correctly
  at the antimeridian, OpenSeaMap respects the selected feature groups, and
  one-shot requests have wall-clock deadlines and bounded response bodies.
- **Reproducible package contents.** The npm `prepack` lifecycle now cleans and
  rebuilds the plugin and panel for both `npm pack` and `npm publish`.

## What it does

Signal K is an open marine data standard that streams a boat's navigation,
environment, and AIS data over a single API. Crow's Nest is a Signal K
server plugin that fills the chart around that data: it imports points of
interest from eight sources, merges duplicates into one corroborated marker,
and serves them as standard `notes` resources that chartplotters such as
[Freeboard-SK](https://github.com/SignalK/freeboard-sk) display natively.

It is built for life on a boat: details are cached on disk so the chart
keeps working offline, refresh traffic is debounced and sized to each
upstream's real update rate, and the same POI data drives three safety
alarms (hazard proximity, hazards on the route ahead, and a bridge
air-draft check).

## Features

- **Eight data sources, merged into one chart layer.** Garmin ActiveCaptain
  is the base; the other seven are opt-in: OpenSeaMap (OpenStreetMap marine
  data via the Overpass API), the USCG Light List of US Aids to Navigation
  (US-only), NOAA ENC Direct (US authoritative wrecks, obstructions, and
  underwater rocks), NOAA CO-OPS tide and current stations (US and
  territories), USCG Local Notice to Mariners live safety notices (US-only),
  the NGA World Port Index (worldwide), and USACE locks and dams (US inland
  waterways). Cross-source duplicates merge into the ActiveCaptain base, and
  the surviving note records every contributing source as a corroboration
  signal.
- **A broad point-of-interest overlay** as Signal K `notes` resources:
  marinas, ports, anchorages, hazards, safety notices, businesses, boat
  ramps, bridges, dams, ferries, inlets, locks, local knowledge,
  navigational aids, airports, lighted and unlighted aids, daymarks, racons,
  tide and current stations, wrecks, obstructions, and underwater rocks.
- **Proximity hazard alarms** with hysteresis: a Signal K notification
  fires when a Hazard point comes within a configurable radius and clears
  once the vessel moves beyond it.
- **Route-corridor hazard scan**: warns about hazards, bridges, and locks
  on the active Course API route ahead, with along-track distance and ETA.
- **Bridge air-draft check**: warns when a bridge's vertical clearance is
  at or below the vessel air draft (`design.airHeight` or a configured
  fallback) plus a safety margin, both as a proximity alarm as the vessel
  nears a too-low bridge and as a clearance-specific route warning ahead.
- **Rich point detail** rendered as plain-English HTML, with the
  source-specific attribution credit (ODbL for OSM, CC0 for NOAA ENC, US
  Government public domain for the USCG, NOAA CO-OPS, NGA, and USACE feeds,
  Garmin ActiveCaptain for the base) published as a structured
  `properties.attribution` field on every note, so a client UI can render it
  in chrome rather than next to the POI text.
- **A normalized detail schema for structured clients**: every note also
  carries a presentation-neutral `properties.crowsNest` view of the same
  detail alongside the HTML, documented in the
  [notes-resource integration guide](docs/notes-resource-format.md), so a
  richer chartplotter can render the sections natively and skip the HTML.
- **Persistent, offline caching.** ActiveCaptain details and OpenSeaMap, NOAA
  ENC, and USACE features live in 30-day on-disk stores. OpenSeaMap, NOAA ENC,
  and USACE can rebuild previously visited markers from those stores after an
  offline restart; ActiveCaptain can still resolve a known marker's persisted
  detail, but a new ActiveCaptain list requires its upstream. The USCG Light
  List index is sharded on disk and queried through an in-memory spatial tile
  index, while Local Notice to Mariners, NOAA CO-OPS, and World Port Index keep
  their complete datasets on disk and survive restarts.
- **Refresh debounce per source**: each at-runtime source snaps the
  viewport to a coarse tile and serves stale while revalidating, so a
  Freeboard refresh burst on a stationary viewport reuses the cached
  result rather than flooding the upstream.
- **Filters to cut clutter**: a minimum-rating filter on ActiveCaptain, a
  per-source earliest-year filter (`SORDAT` survey vintage on NOAA ENC,
  `MODIFIED_DATE` on USCG, OSM element timestamp on OpenSeaMap), and a
  freshness warning in the popup for an ActiveCaptain Hazard whose report
  has not been confirmed in over two years.
- **A React configuration panel** with a per-source status bar, an
  accordion of cards each with a live-status pill, an Alerts section, and
  shared `signalk-nearlcrews-ui` controls and themes. Fresh profiles start in
  Light mode, with Dark, red-preserving Night, and Auto available from the
  theme toggle.

## Screenshots

Points of interest from every source land on the chart as Signal K notes,
each with a plain-English popup, and the whole plugin is configured from
one panel.

| ActiveCaptain hazard | USCG Light List aid | Configuration panel |
| --- | --- | --- |
| [![An ActiveCaptain hazard note open in Freeboard-SK, showing the rating, the review text, and a staleness warning](assets/screenshots/freeboard-activecaptain-hazard.png)](assets/screenshots/freeboard-activecaptain-hazard.png) | [![A USCG Light List buoy note open in Freeboard-SK, showing the light characteristic and the source citation](assets/screenshots/freeboard-uscg-light-list.png)](assets/screenshots/freeboard-uscg-light-list.png) | [![The Crow's Nest configuration panel, showing per-source live status and the data-source cards](assets/screenshots/admin-panel.png)](assets/screenshots/admin-panel.png) |

## Architecture

Crow's Nest is one plugin built from focused modules:

- **TypeScript 6 under strict flags.** The Node plugin compiles with `tsc`;
  the React configuration panel bundles with webpack 5 as a Module
  Federation remote that the Signal K admin UI loads. The panel uses
  `signalk-nearlcrews-ui` for shared controls and token-driven themes.
- **Inputs and outputs.** Every POI source is a self-contained input module
  (ActiveCaptain, OpenSeaMap, USCG Light List, NOAA ENC Direct, NOAA CO-OPS,
  USCG Local Notice to Mariners, NGA World Port Index, and USACE locks and
  dams) and every consumer is an output module (the `notes` provider, the
  proximity alarm, the route-corridor scan, and the bridge air-draft check),
  each registered on one line in the plugin entrypoint.
- **One aggregate source.** A registry fans each chart request out to every
  enabled input, namespaces the ids, unions the results, records per-source
  health, and runs the dedupe pass that merges duplicates within a
  configurable radius (default 150 feet).
- **Polite HTTP.** Queued, throttled clients with retry and `Retry-After`
  handling for the high-volume sources; conditional GET for the bulk-download
  feeds (USCG Light List, Local Notice to Mariners, and NOAA CO-OPS);
  Overpass fallback mirrors so a single instance outage does not take the
  source offline; and a US-waters gate that skips outbound HTTP on the
  US-only feeds when the vessel is elsewhere.
- **Tested on `node:test`** via `tsx`, with ESLint 9 and neostandard.

See the [architecture notes](CLAUDE.md) for the full module map.

## Signal K paths

Crow's Nest is a well-behaved Signal K citizen: it reads a few `vessels.self`
paths and the Course API, and it writes only `notes` resources and
notifications under its own branch. All values are SI units (position in
decimal degrees, distances and heights in meters).

**Reads (from `vessels.self`):**

- `navigation.position`: the US-waters gate on the US-only feeds and the
  vessel position for proximity, route, and bridge air-draft scans. Chart
  resource requests supply their own bounding box or search center.
- `navigation.speedOverGround`: ETA math in the route-corridor scan.
- `design.airHeight`: the vessel air draft for the bridge-clearance check
  (a configured fallback is used only when this path is absent).
- The **Course API** active route: the route-corridor hazard scan reads the
  active route to look ahead along the planned track.

**Writes:**

- `resources/notes`: every imported POI is published as a Signal K `note`
  resource (with the source-agnostic structured detail on
  `properties.crowsNest` alongside the HTML description) so chartplotters such
  as Freeboard-SK can display it.
- `notifications.navigation.crowsNest.hazard.<id>`: proximity hazard alarms.
- `notifications.navigation.crowsNest.route.<id>`: route-corridor hazard
  alarms (including the too-low-bridge verdict).
- `notifications.navigation.crowsNest.bridgeClearance.<id>`: bridge
  air-draft alarms.

The plugin also serves an admin-gated `GET` status endpoint.

## Requirements

- [Signal K server](https://github.com/SignalK/signalk-server) 2.x. The
  `notes` layer does not require a GPS because the chartplotter supplies its
  viewport. A `navigation.position` source on `vessels.self` is required for
  the position-driven alarms and lets the plugin avoid US-only requests when
  the vessel is clearly outside US waters.
- Node.js 20.3 or newer.
- A chartplotter that consumes Signal K `notes` resources. Freeboard-SK
  is the reference consumer; any client that reads `notes` resources will
  see the markers, including [Binnacle](https://github.com/NearlCrews/signalk-binnacle),
  which renders the structured detail natively.
- The configuration panel needs Signal K admin UI 2.26.0 or newer. On
  older servers the plugin still works and falls back to the standard
  settings form.

## Installation

Install from the Signal K admin UI under **AppStore, then Available**, or
from npm:

```bash
cd ~/.signalk
npm install signalk-crows-nest
```

From source:

```bash
git clone https://github.com/NearlCrews/signalk-crows-nest.git
cd signalk-crows-nest
npm install
npm run build
ln -s "$(pwd)" ~/.signalk/node_modules/signalk-crows-nest
```

## Configuration

In the Signal K admin UI, open **Server, then Plugin Config**, find
"Crow's Nest", and enable the plugin. The defaults work for an
ActiveCaptain-only setup; opt in to the other sources from their cards.
The panel has these areas:

1. **Theme toggle** in the top corner: Light, Dark, a red-preserving Night
   mode for night vision at the helm, or Auto. Light is the default for a
   fresh profile, and an explicit choice persists across visits.
2. **Per-source status bar**: `reachable`, `unreachable`, or `not yet
   contacted` for each enabled source, the last successful upstream list-fetch
   time, a "checked Ns ago" freshness note, and recent errors. A
   source-attributed error is clickable and opens the matching source card.
   Local cache and index reads do not count as proof that an upstream is
   reachable.
3. **Data sources accordion** with one collapsible card per source
   (ActiveCaptain, OpenSeaMap, USCG Light List, NOAA ENC Direct, NOAA
   CO-OPS, USCG Local Notice to Mariners, NGA World Port Index, and USACE
   locks and dams). Each card's body groups its options into bordered
   fieldsets: import layers, refresh and freshness, filters (when present),
   and merge with ActiveCaptain. In brief, per card:
   - **ActiveCaptain** (always on): 13 POI-type toggles, a minimum-rating
     filter, the detail freshness window (default 24 hours), and the viewport
     refresh window (default 30 seconds). Selecting no POI types hides the
     chart notes layer; enabled safety alerts still request the hazard types
     they require.
   - **OpenSeaMap** (off by default): four seamark feature-group toggles, an
     earliest-year filter, the Overpass endpoint with optional fallback
     mirrors, and the viewport refresh window (default 10 minutes).
   - **USCG Light List** (off by default, US-only): the background refresh
     period in hours (default 24) and an earliest-year filter.
   - **NOAA ENC Direct** (off by default, US-only): wreck and obstruction
     layer toggles (on), an underwater-rocks toggle (off, heavy), the chart
     scale band, an earliest survey-year filter, and the viewport refresh
     window (default 30 minutes).
   - **NOAA CO-OPS** (off by default, US and territories): tide and
     current-meter station family toggles (both on) and the background
     refresh period in hours (default 24).
   - **USCG Local Notice to Mariners** (off by default, US-only): the
     background refresh period in seconds (default 900, 15 minutes).
   - **NGA World Port Index** (off by default, worldwide): the background
     refresh period in hours (default 24).
   - **USACE locks and dams** (off by default, US-only): a locks toggle
     (on), a dams toggle (off, heavy), and the viewport refresh window
     (default 30 minutes).

   Every card except ActiveCaptain also carries a merge-with-ActiveCaptain
   toggle (on by default) and its per-source merge radius.
4. **Alerts section** (collapsed by default, opens automatically when an
   alarm is enabled): the proximity-alarm, route-corridor scan, and
   bridge air-draft check controls, each in its own fieldset with an
   opt-in toggle and its numeric settings.

Per-source enable toggles live on each card's header, alongside the
disclosure chevron. Each card carries a small live-status pill on the
header: `✓ ok` after a successful upstream list fetch, `… idle` before the
first request or during an intentional skip, `… waiting` when a slow request
continues after the five-second aggregate deadline, and `! error` after a
failure. Idle pills include reasons such as `outside US waters`, and the ok
tooltip carries the longer "N POIs in last fetch, M minutes ago" detail.
Disabled cards show a "Disabled." prefix on their summary so an off source
never reads as live. Every numeric input clears cleanly mid-edit. Saving
applies immediately; the plugin rebuilds its runtime and in-memory viewport
caches while retaining the on-disk data used for offline operation.

## Documentation

- [Troubleshooting](docs/troubleshooting.md)
- [Development guide](docs/development.md)
- [Notes-resource integration guide](docs/notes-resource-format.md): the
  wire format and the normalized detail schema for client developers
- [Architecture notes](CLAUDE.md): project layout and module map
- [Changelog](CHANGELOG.md)
- [Contributing](.github/CONTRIBUTING.md)
- [Security policy](.github/SECURITY.md)

## Development

This project targets Node 20.3 or newer and develops against
`@signalk/server-api` 2.30.0 or newer, with TypeScript 6 and the exact shared
UI package `signalk-nearlcrews-ui` 0.3.0 (development only).

```bash
git clone https://github.com/NearlCrews/signalk-crows-nest.git
cd signalk-crows-nest
npm install          # install dependencies
npm run build        # compile the plugin and bundle the panel
npm test             # node:test suite via tsx
npm run typecheck    # type-check the plugin, the panel, and the tests
npm run lint         # ESLint 9 with neostandard
npm run lint:fix     # lint and auto-fix
npm run clean        # remove dist/ and the panel build artifacts
```

Run `npm run lint`, `npm run typecheck`, and `npm test` before committing.
See the [development guide](docs/development.md) for the full workflow.

## License

MIT: see [LICENSE](LICENSE) for the full text. The software is provided
"AS IS", without warranty of any kind. Treat the imported data and the
alarms as advisory, and always carry independent means of navigation.
Bundled dependency licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Acknowledgments

Built on the foundation of [`signalk-activecaptain-resources`](https://github.com/KvotheBloodless/signalk-activecaptain-resources)
by Paul Willems and the Signal K community. Full credit to the original
author for the initial plugin that imports ActiveCaptain points of
interest and exposes them as Signal K resources. Crow's Nest is written
and maintained by [Nearl Crews](https://github.com/NearlCrews).

- [Signal K Project](https://signalk.org/) for the open marine data
  standard
- [Garmin ActiveCaptain](https://activecaptain.garmin.com) for the
  community point-of-interest database
- [OpenStreetMap](https://www.openstreetmap.org) contributors and
  [OpenSeaMap](https://www.openseamap.org) for the open marine data,
  served through the [Overpass API](https://overpass-api.de) and used
  under the [Open Database License](https://opendatacommons.org/licenses/odbl/)
- The [US Coast Guard Navigation Center](https://www.navcen.uscg.gov)
  for the [Light List](https://www.navcen.uscg.gov/light-lists) of US
  Aids to Navigation and for the Local Notice to Mariners feeds, US
  Government public domain
- The [NOAA Office of Coast Survey](https://nauticalcharts.noaa.gov)
  for [ENC Direct](https://encdirect.noaa.gov) authoritative US chart
  hazard data, published under CC0
- [NOAA CO-OPS](https://tidesandcurrents.noaa.gov) for the tide and
  current station metadata, US Government public domain
- The [National Geospatial-Intelligence Agency](https://msi.nga.mil) for
  the World Port Index (Pub 150), US Government public domain
- The [US Army Corps of Engineers](https://www.usace.army.mil) for the
  navigation lock data and the National Inventory of Dams, US Government
  public domain

Crow's Nest pairs well with sibling plugins such as
[`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon)
and [`signalk-binnacle`](https://github.com/NearlCrews/signalk-binnacle).

## Support

Find this plugin useful? You can support its continued development by
[buying me a coffee](https://www.buymeacoffee.com/nearlcrews).

- [Report a bug](https://github.com/NearlCrews/signalk-crows-nest/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/NearlCrews/signalk-crows-nest/issues/new?template=feature_request.yml)
- [Security issues](.github/SECURITY.md)
