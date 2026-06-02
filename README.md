# Crow's Nest

[![npm version](https://img.shields.io/npm/v/signalk-crows-nest.svg)](https://www.npmjs.com/package/signalk-crows-nest)
[![npm downloads](https://img.shields.io/npm/dm/signalk-crows-nest.svg)](https://www.npmjs.com/package/signalk-crows-nest)
[![License](https://img.shields.io/github/license/NearlCrews/signalk-crows-nest.svg)](https://github.com/NearlCrews/signalk-crows-nest/blob/main/LICENSE)
[![CI](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/ci.yml)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/nearlcrews)

A Signal K plugin that imports points of interest from four marine data
sources (Garmin ActiveCaptain, OpenSeaMap, the USCG Light List, and NOAA
ENC Direct), publishes them as Signal K `notes` resources for chart
plotters like Freeboard-SK, and raises proximity and route-corridor
hazard alarms. Pairs well with sibling plugins such as
[`signalk-nmea2000-emitter-cannon`](https://github.com/NearlCrews/signalk-nmea2000-emitter-cannon).

> Built on the foundation of [`signalk-activecaptain-resources`](https://github.com/KvotheBloodless/signalk-activecaptain-resources)
> by Paul Willems and the Signal K community.

## Screenshots

Points of interest from every source land on the chart as Signal K notes, each
with a plain-English popup, and the whole plugin is configured from one panel.

| ActiveCaptain hazard | USCG Light List aid | Configuration panel |
| --- | --- | --- |
| [![An ActiveCaptain hazard note open in Freeboard-SK, showing the rating, the review text, and a staleness warning](assets/screenshots/freeboard-activecaptain-hazard.png)](assets/screenshots/freeboard-activecaptain-hazard.png) | [![A USCG Light List buoy note open in Freeboard-SK, showing the light characteristic and the source citation](assets/screenshots/freeboard-uscg-light-list.png)](assets/screenshots/freeboard-uscg-light-list.png) | [![The Crow's Nest configuration panel, showing per-source live status and the data-source cards](assets/screenshots/admin-panel.png)](assets/screenshots/admin-panel.png) |

## What's New in v0.7.0

A feature release: the new **bridge air-draft check** warns when a bridge would
not clear the vessel. It compares each bridge's vertical clearance against the
vessel air draft (`design.airHeight`, or a configured fallback) plus a
configurable safety margin, then raises a proximity alarm as the vessel nears a
too-low bridge and upgrades a too-low bridge on the active route to a
clearance-specific route warning. Clearance is read from OpenSeaMap's OSM tags
and ActiveCaptain's detail, and the dedupe pass keeps the more conservative
figure. This release also folds in two whole-codebase `/cleanup` passes (about
forty reuse and quality fixes with no behavior change beyond the feature), and
all 663 tests pass.

See the [v0.7.0 changelog entry](CHANGELOG.md#v070) and the
[full release history](CHANGELOG.md).

## Features

- **Point-of-interest overlay** as Signal K `notes` resources: marinas,
  anchorages, hazards, businesses, boat ramps, bridges, dams, ferries,
  inlets, locks, local knowledge, navigational aids, airports, lighted
  and unlighted aids, daymarks, racons, wrecks, obstructions, and
  underwater rocks
- **Four data sources, merged into one chart layer**: Garmin
  ActiveCaptain (the base), OpenSeaMap (OSM marine data via the Overpass
  API), the USCG Light List of US Aids to Navigation (US-only,
  opt-in), and NOAA ENC Direct (US authoritative wrecks, obstructions,
  and rocks, US-only, opt-in). Cross-source duplicates merge into the
  ActiveCaptain base; the surviving note records every contributing
  source as a corroboration signal
- **Proximity hazard alarms** with hysteresis: a Signal K notification
  fires when a Hazard point comes within a configurable radius and
  clears once the vessel moves beyond it
- **Route-corridor hazard scan**: warns about hazards, bridges, and
  locks on the active Course API route ahead, with along-track distance
  and ETA
- **Bridge air-draft check**: warns when a bridge's vertical clearance is
  at or below the vessel air draft (`design.airHeight` or a configured
  fallback) plus a safety margin, both as a proximity alarm as the vessel
  nears a too-low bridge and as a clearance-specific route warning ahead
- **Rich point detail** rendered to HTML, with the source-specific
  attribution credit (ODbL for OSM, CC0 for NOAA, US Government public
  domain for USCG, Garmin ActiveCaptain for the base) published as a
  structured `properties.attribution` field on every note instead of
  appended inline to the description, so a Signal K client UI can render
  it in chrome rather than next to the POI text
- **Persistent, offline cache** for ActiveCaptain detail responses; the
  USCG Light List index is sharded on disk and queried through an
  in-memory spatial tile index for sub-millisecond bbox lookups
- **Per-bbox refresh-debounce cache** on every at-runtime source so a
  Freeboard refresh burst on a stationary viewport reuses the cached
  result rather than flooding the upstream
- **Per-source earliest-year filter** for source-specific data
  freshness (`SORDAT` survey vintage on NOAA ENC, `MODIFIED_DATE` on
  USCG, OSM element `timestamp` on OpenSeaMap)
- **Rating filter** on ActiveCaptain to cut clutter on dense charts
- **Hazard freshness warning** in the popup body for an ActiveCaptain
  Hazard whose report has not been confirmed in over two years
- **React configuration panel** with a per-source status bar, a
  per-source accordion of cards each with a live-status pill, a global
  Alerts section, and opportunistic dark-mode token support
- **TypeScript 6** under strict flags, **MIT-licensed**, Node 20.3+

## Requirements

- [Signal K server](https://github.com/SignalK/signalk-server) 2.x with
  a position source (a GPS) attached to `vessels.self`
- Node.js 20.3+
- A chart plotter that consumes Signal K `notes` resources, such as
  [Freeboard-SK](https://github.com/SignalK/freeboard-sk)
- The configuration panel needs Signal K admin UI 2.26.0 or newer. On
  older servers the plugin still works and falls back to the standard
  settings form

## Installation

Install from the Signal K Admin UI under **AppStore -> Available**, or
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

In the Signal K admin UI, open **Server -> Plugin Config**, find "Crow's
Nest", and enable the plugin. The defaults work for an
ActiveCaptain-only setup; opt-in to the other sources from their cards.
The plugin ships a React config panel that the Signal K admin loads via
webpack 5 Module Federation. The panel has these areas:

1. **Per-source status bar** at the top: reachability and last-fetch
   time for each enabled source, plus any recent errors
2. **Data sources accordion** with one collapsible card per source
   (ActiveCaptain, OpenSeaMap, USCG Light List, NOAA ENC Direct). Each
   card's body groups its options into bordered fieldsets: import
   layers, refresh and freshness, filters (when present), and merge
   with ActiveCaptain
3. **Alerts section** (collapsed by default, opens automatically when an
   alarm is enabled): the proximity-alarm, route-corridor scan, and
   bridge air-draft check controls, each in its own fieldset with an
   opt-in toggle and its numeric settings

Per-source enable toggles live on each card's header, alongside the
disclosure chevron. Each card carries a small live-status pill on the
header (`✓ ok` for a healthy source, `… idle` for one that has not
fetched yet, `! error` for the last attempt failing); the hover and
screen-reader tooltip carries the longer "N POIs in last fetch, M
minutes ago" detail. Disabled cards show a "Disabled." prefix on their
summary so an off source never reads as live. Every numeric input
clears cleanly mid-edit. Saving applies immediately; the plugin's
internal cache rebuilds on the next request.

## Documentation

- [Troubleshooting](docs/troubleshooting.md)
- [Development guide](docs/development.md)
- [Architecture notes](CLAUDE.md): project layout and module map
- [Changelog](CHANGELOG.md)
- [Contributing](.github/CONTRIBUTING.md)
- [Security policy](.github/SECURITY.md)

## Compatibility

- **Signal K Server**: 2.x. The `notes` resources and the notifications
  work on any 2.x server; the configuration panel needs admin UI 2.26.0+
- **Node.js**: 20.3+
- **`@signalk/server-api`**: 2.25.0+
- **TypeScript**: 6.0+ (development only)
- **Chart plotters**: Freeboard-SK is the reference consumer; any
  client that reads Signal K `notes` resources will see the markers

## License

MIT: see [LICENSE](LICENSE).

## Author

[Nearl Crews](https://github.com/NearlCrews) - author and maintainer.

## Acknowledgments

Built on the foundation of [`signalk-activecaptain-resources`](https://github.com/KvotheBloodless/signalk-activecaptain-resources)
by Paul Willems and the Signal K community. Full credit to the original
author for the initial plugin that imports ActiveCaptain points of
interest and exposes them as Signal K resources.

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
  Aids to Navigation, US Government public domain
- The [NOAA Office of Coast Survey](https://nauticalcharts.noaa.gov)
  for [ENC Direct](https://encdirect.noaa.gov) authoritative US chart
  hazard data, published under CC0

## Support

Find this plugin useful? You can support its continued development by
[buying me a coffee](https://www.buymeacoffee.com/nearlcrews).

- [Report a bug](https://github.com/NearlCrews/signalk-crows-nest/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/NearlCrews/signalk-crows-nest/issues/new?template=feature_request.yml)
- [Security issues](.github/SECURITY.md)
