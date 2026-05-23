# Crow's Nest

[![npm version](https://img.shields.io/npm/v/signalk-crows-nest.svg)](https://www.npmjs.com/package/signalk-crows-nest)
[![npm downloads](https://img.shields.io/npm/dm/signalk-crows-nest.svg)](https://www.npmjs.com/package/signalk-crows-nest)
[![License](https://img.shields.io/github/license/NearlCrews/signalk-crows-nest.svg)](https://github.com/NearlCrews/signalk-crows-nest/blob/main/LICENSE)
[![CI](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-crows-nest/actions/workflows/ci.yml)

A [Signal K server](https://github.com/SignalK/signalk-server) plugin that
imports points of interest from multiple marine data sources, the
[Garmin ActiveCaptain](https://activecaptain.garmin.com) community database,
[OpenSeaMap](https://www.openseamap.org) (OpenStreetMap marine data), the
[USCG Light List](https://www.navcen.uscg.gov/light-lists) of US Aids to
Navigation, and the [NOAA ENC Direct](https://encdirect.noaa.gov) database of
US wrecks, obstructions, and underwater rocks, and exposes them as Signal K
`notes` resources, so chart plotters such as Freeboard-SK can show marinas,
anchorages, hazards, and more as a layer on the chart. It also keeps a
lookout: it raises a proximity alarm when the vessel nears a hazard, and
scans the active route ahead for hazards, bridges, and locks.

> Built on the foundation of [`signalk-activecaptain-resources`](https://github.com/KvotheBloodless/signalk-activecaptain-resources)
> by Paul Willems and the Signal K community.

## What's New in v0.4.2

v0.4.2 is the first release published to npm. It bundles every feature the
plugin has developed: the four-source point-of-interest aggregate
(ActiveCaptain, OpenSeaMap, USCG Light List, NOAA ENC Direct), the
position-aware proximity-hazard alarms, the route-corridor hazard scan, the
React configuration panel, the per-source earliest-year filter, and the
per-bbox refresh-debounce cache for the two at-runtime sources.

See the [v0.4.2 changelog entry](CHANGELOG.md#v042) and the
[v0.4.2 release](https://github.com/NearlCrews/signalk-crows-nest/releases/tag/v0.4.2).
[Full release history](CHANGELOG.md).

## Features

- **Point-of-interest overlay.** Imports ActiveCaptain marinas, anchorages,
  hazards, businesses, boat ramps, bridges, dams, ferries, inlets, locks, local
  knowledge, navigational aids, and airports as Signal K `notes` resources.
- **Multiple data sources.** Imports from Garmin ActiveCaptain, OpenSeaMap
  (OpenStreetMap marine data, via the OSM Overpass API), the USCG Light List
  of US Aids to Navigation (US-only, off by default), and NOAA ENC Direct's
  authoritative US wrecks, obstructions, and underwater rocks (US-only, off
  by default), merged into one chart layer. A duplicate of a feature reported
  by more than one source is merged within a configurable radius (default
  150 meters), and a second pass collapses same-source duplicates of the
  same feature; the surviving note records every contributing source as a
  corroboration signal.
- **Rich point detail.** Each point's description renders its services, retail,
  mooring, navigation, dockage, fuel, and contact sections, and a featured user
  review.
- **Proximity hazard alarms.** Subscribes to the vessel position and raises a
  Signal K notification when a Hazard point comes within a configurable radius.
- **Route-corridor hazard scan.** Warns about hazards, bridges, and locks on the
  active route ahead, with along-track distance and ETA.
- **Persistent, offline cache.** Point detail is cached on disk, so it survives
  a server restart and stays readable with no connectivity.
- **Rating filter.** Hides low-rated marinas, anchorages, and businesses to cut
  clutter on dense charts.
- **Hazard freshness.** A Hazard whose report has not been confirmed in over two
  years carries a prominent freshness warning in its description.
- **Configuration panel.** A dedicated React panel with a per-source status
  bar and a per-source accordion of data-source cards, in place of the generic
  settings form.

## Requirements

- A running [Signal K server](https://github.com/SignalK/signalk-server) with a
  position source (a GPS).
- Node.js 20.3 or newer.
- The configuration panel needs Signal K admin UI 2.26.0 or newer. On older
  servers the plugin still works and falls back to the standard settings form.

## Installation

In the Signal K server Appstore, search for `signalk-crows-nest` and click
Install. Then, under Server -> Plugin Config, find Crow's Nest and enable it.
The default values are fine to start with, so you can just click Save.

## Configuration

The plugin ships its own configuration panel. In place of the generic settings
form it shows a per-source status bar (each enabled source's API reachability
and last fetch, the cached point-of-interest count, and recent errors), a
per-source accordion of collapsible data-source cards, and an Alerts section.
The ActiveCaptain card holds its cache-duration field, its point-of-interest
type toggles in labeled groups with All and None buttons, and the rating
filter; the OpenSeaMap card holds its Overpass endpoint, its seamark feature
groups, and its dedupe toggle. The Alerts section holds the proximity and route
hazard alarm controls, which consume the merged point-of-interest set.

The following options are available:

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| How long to cache data from Active Captain in minutes | number | 60 | Longer caching means less data traffic; shorter caching means more up to date data. |
| Include marinas | boolean | true | Include marina points of interest. |
| Include anchorages | boolean | true | Include anchorage points of interest. |
| Include hazards | boolean | true | Include hazard points of interest. |
| Include businesses | boolean | true | Include business points of interest. |
| Include boat ramps | boolean | true | Include boat ramp points of interest. |
| Include bridges | boolean | true | Include bridge points of interest. |
| Include dams | boolean | true | Include dam points of interest. |
| Include ferries | boolean | true | Include ferry points of interest. |
| Include inlets | boolean | true | Include inlet points of interest. |
| Include locks | boolean | true | Include lock points of interest. |
| Include local knowledge | boolean | true | Include local knowledge points of interest. |
| Include navigational aids | boolean | true | Include navigational aid points of interest. |
| Include airports | boolean | true | Include airport points of interest. |
| Minimum rating | number | 0 | Hide points of interest whose average rating is below this value (0 to 5; 0 shows everything). |
| Emit a notification when the vessel nears a hazard | boolean | false | Subscribe to the vessel position and raise a proximity alarm for nearby hazards. |
| Proximity alarm radius in meters | number | 500 | How close a hazard must be to raise an alarm. |
| Scan the active route ahead for hazards, bridges, and locks | boolean | false | Read the active Course API route and warn about hazards, bridges, and locks along it. |
| Route corridor half-width in meters | number | 500 | A point of interest within this distance either side of the route line counts as on the route. |
| Import points of interest from OpenSeaMap | boolean | false | Enable the OpenSeaMap source (OpenStreetMap marine data, via the OSM Overpass API). |
| Overpass API endpoint URL | string | `https://overpass-api.de/api/interpreter` | The Overpass API endpoint the OpenSeaMap source queries. |
| OpenSeaMap feature groups to import | array | all four | Which seamark groups to import: hazards, navigational aids, harbours, and infrastructure. |
| Merge OpenSeaMap points of interest that duplicate an ActiveCaptain marker | boolean | true | Merge an OpenSeaMap point into a co-located ActiveCaptain point of the same type, recording both sources on the surviving note. |
| Merge radius for OpenSeaMap points of interest, in meters | number | 150 | Two POIs of the same type within this distance count as the same physical feature. Widen it if duplicate markers still appear on your chart, tighten it if neighbors are merging. |
| OpenSeaMap bbox-debounce window, in seconds | number | 30 | How long to reuse the most recent Overpass result for the same chart viewport before re-querying. 0 disables the cache. |
| Earliest OpenSeaMap update year | number | 0 | Hide OSM elements whose last-edit timestamp is older than this year. 0 disables the filter; elements with no recorded timestamp are always included. |
| Import points of interest from the USCG Light List | boolean | false | Enable the USCG Light List source (US Aids to Navigation; US waters only). |
| Merge USCG Light List points of interest that duplicate an ActiveCaptain marker | boolean | true | Merge a Light List point into a co-located ActiveCaptain point of the same type, recording both sources on the surviving note. |
| USCG Light List background refresh period, in hours | number | 6 | How often the plugin re-downloads the NAVCEN district files. Range: 1 to 168 hours. |
| Earliest USCG Light List update year | number | 0 | Hide records whose last USCG modification date is older than this year. 0 disables the filter; records with no recorded modification date are always included. |
| Import wrecks, obstructions, and rocks from NOAA ENC Direct | boolean | false | Enable the NOAA ENC Direct source (US authoritative chart hazards; US waters only). |
| Merge NOAA ENC points of interest that duplicate an ActiveCaptain marker | boolean | true | Merge a NOAA ENC point into a co-located ActiveCaptain point of the same type, recording both sources on the surviving note. |
| NOAA ENC chart scale band | string | `coastal` | Which ENC chart scale to query: `overview`, `general`, `coastal`, `approach`, `harbour`, or `berthing`. |
| Include NOAA ENC wrecks | boolean | true | Import the wrecks layer in NOAA ENC list queries. |
| Include NOAA ENC obstructions | boolean | true | Import the obstructions layer in NOAA ENC list queries. |
| Include NOAA ENC underwater rocks | boolean | false | Import the underwater rocks layer. Off by default: a coastal-band query can return tens of thousands of rocks. |
| NOAA ENC bbox-debounce window, in seconds | number | 30 | How long to reuse the most recent ENC Direct result for the same chart viewport before re-querying. 0 disables the cache. NOAA refreshes ENC data weekly, so a sub-minute cadence here protects the ArcGIS service from a Freeboard refresh burst on a stationary view. |
| Earliest NOAA ENC survey year | number | 0 | Hide features whose `SORDAT` hydrographic survey date is older than this year. 0 disables the filter; features with no recorded survey date are always included. The survey date is often decades old for stable features (a wreck found in a 1950s lead-line survey vs a 2020s multibeam survey), so this is a data-confidence filter. |

Deselecting every POI type makes the plugin import nothing. A configuration
created before these toggles existed, which carries none of the toggle
settings, instead falls back to including all types so an upgrade keeps working
until the plugin is reconfigured.

### Proximity hazard alarms

With "Emit a notification when the vessel nears a hazard" enabled, the plugin
subscribes to `navigation.position`, scans for nearby hazards as the vessel
moves, and emits a Signal K `notifications.navigation.crowsNest.hazard.*`
alert whenever a Hazard point of interest is within the alarm radius. Chart
plotters and Freeboard-SK render it as an alarm. The notification is raised
once on approach and cleared once the vessel moves a margin beyond the radius.
The feature is off by default.

Point-of-interest detail is cached on disk, so it survives a server restart and
stays readable when the vessel has no connectivity.

### Route-corridor hazard scan

With "Scan the active route ahead for hazards, bridges, and locks" enabled, and
the vessel following an active Course API route, the plugin checks the route
ahead for Hazard, Bridge, and Lock points of interest that lie within the
corridor width of the route line. For each one it emits a Signal K
`notifications.navigation.crowsNest.route.*` notification carrying the
point's along-track distance and, when the speed over ground is known, an ETA.
The notification is raised once when the point first appears on the route
ahead, refreshed as the vessel closes in, and cleared once it is no longer on
the route ahead. The feature is off by default.

The scan reuses the position monitor's existing tick and its single
point-of-interest fetch, so it adds no extra API traffic; enabling it alongside
the proximity hazard alarms shares one fetch per tick. The fetch's bounding box
is widened to enclose the route ahead, up to a 10 NM look-ahead window that
slides forward as the vessel advances. A point of interest beyond the
look-ahead, or beyond the range at which the ActiveCaptain API begins returning
clustered results, is picked up on a later tick once the vessel has closed the
distance: a sliding window rather than a single long-range scan.

### OpenSeaMap source

With "Import points of interest from OpenSeaMap" enabled, the plugin also
queries [OpenSeaMap](https://www.openseamap.org) marine data through the
OpenStreetMap [Overpass API](https://overpass-api.de). It imports four seamark
feature groups, each independently toggleable: hazards (rocks, wrecks,
obstructions), navigational aids (lights, buoys, beacons), harbours and
marinas, and infrastructure (locks, bridges). The source is off by default.

OpenSeaMap and ActiveCaptain points merge into one `notes` layer. When both
sources report the same physical feature, the OpenSeaMap point is merged into
the co-located ActiveCaptain marker of the same type, so the chart shows it
once; the surviving note's `properties.sources` lists every contributing
source as a corroboration signal, and `properties.sourceCount` is its length.
"Same physical feature" means same POI type within a configurable merge
radius (default 150 meters). A second pass collapses OpenSeaMap points that
duplicate themselves, so a feature that OSM tagged twice (typically once as
a node and once as a way) still becomes one note. This dedupe is on by
default and can be turned off in the OpenSeaMap card.

Every OpenSeaMap feature is mapped at the source to a Freeboard-registered
icon. Rocks, wrecks, and obstructions render as hazards; harbours and marinas
as marina markers; locks, bridges, anchorages, anchor berths, and moorings as
their direct Freeboard icons; lights, beacons, buoys, and landmarks render
with the `navigation-structure` glyph. Isolated-danger buoys and beacons
render with the hazard glyph because their purpose is to flag a danger; their
`PoiType` stays `Navigational` so they do not falsely trigger the proximity
alarms. The three ActiveCaptain types Freeboard has no glyph for (Local
Knowledge, Navigational, Airport) likewise route to the closest registered
icon (`notice-to-mariners` or `navigation-structure`) so nothing renders as a
bare default marker.

OpenStreetMap data is published under the
[Open Database License](https://opendatacommons.org/licenses/odbl/) (ODbL),
which requires visible attribution wherever the data is shown. Every OpenSeaMap
point's rendered detail carries an `© OpenStreetMap contributors (ODbL)`
footer.

An optional **Earliest OpenSeaMap update year** filter on the card hides
elements whose OSM last-edit timestamp is older than the chosen year. The
filter defaults to 0 (off); elements with no recorded timestamp pass
through. The OSM `timestamp` is a contributor-freshness signal, not a
data-correctness signal, so an unedited element from 2012 may still be
correct.

### USCG Light List source

With "Import points of interest from the USCG Light List" enabled, the plugin
also imports the US Aids to Navigation that the US Coast Guard publishes in
its [NAVCEN Light List](https://www.navcen.uscg.gov/light-lists): lighted and
unlighted aids, ranges, and isolated-danger marks. The source is US-only and
off by default. A background scheduler periodically re-downloads the NAVCEN
district files (default every six hours) into a persistent on-disk index, so
list queries are served entirely from memory and remain readable when the
vessel has no connectivity. Outbound HTTP is gated on the vessel position:
a vessel outside US waters keeps its already-loaded index but issues no
refresh against NAVCEN until it returns.

Each Light List record's rendered detail describes the aid's characteristic
(color, period, range), structure (height, material), visibility sectors,
and any free-form remarks the upstream publishes. Records are mapped to
Freeboard-registered icons: most aids use `navigation-structure`, while
isolated-danger marks use the hazard glyph because their purpose is to flag
a danger. USCG Light List data is US Government public domain; every Light
List point's rendered detail carries a `© USCG (US Government public domain)`
footer.

An optional **Earliest USCG Light List update year** filter on the card
hides records whose last USCG modification date is older than the chosen
year. The filter defaults to 0 (off); records with no recorded
modification date pass through.

### NOAA ENC Direct source

With "Import wrecks, obstructions, and rocks from NOAA ENC Direct" enabled,
the plugin queries the [NOAA Office of Coast Survey's ENC Direct REST
service](https://encdirect.noaa.gov) for the authoritative US chart hazard
layers (wrecks, obstructions, and underwater rocks). The source is US-only
and off by default. NOAA ENC Direct is the official successor to the
retired AWOIS dataset, so chart hazards are sourced from the same
authoritative survey data that ships in the official ENC chart cells.

The scale-band selector picks which ENC chart scale to query: `overview`
through `berthing`. `coastal` is the recommended default. Per-layer toggles
select wrecks, obstructions, and underwater rocks independently; rocks
default off because a coastal-band query can return tens of thousands of
rocks and obscure other hazards. Outbound HTTP is gated on the vessel
position: a vessel outside US waters issues no list query against NOAA
until it returns.

Each ENC feature's rendered detail decodes the S-57 attributes the wire
carries (water level, quality of sounding, technique of sounding, depth)
into plain English. Features map to Freeboard's hazard glyph. NOAA ENC
Direct data is published under CC0; every NOAA ENC point's rendered detail
carries a `© NOAA Office of Coast Survey (CC0)` footer.

An optional **Earliest NOAA ENC survey year** filter on the card hides
features whose `SORDAT` hydrographic survey date is older than the chosen
year. The filter defaults to 0 (off); features with no recorded survey
date pass through. `SORDAT` is the survey vintage (often decades old for a
stable feature, since NOAA does not re-survey unchanged hazards), so this
is a data-confidence filter rather than a chart-freshness filter.

## Documentation

- [docs/development.md](docs/development.md): the build, test, and release workflow.
- [CLAUDE.md](CLAUDE.md): the project architecture and module layout.
- [docs/troubleshooting.md](docs/troubleshooting.md): troubleshooting.
- [docs/garmin-api.md](docs/garmin-api.md): Garmin ActiveCaptain API research notes.
- [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md): how to contribute.
- [CHANGELOG.md](CHANGELOG.md): notable changes.

## Compatibility

- Signal K server 2.x. The `notes` resources and the notifications work on any
  2.x server; the configuration panel needs admin UI 2.26.0 or newer.
- Pairs cleanly with other Signal K plugins, including
  `signalk-nmea2000-emitter-cannon`: the hazard notifications use the standard
  `notifications.navigation.*` branch, so a downstream consumer categorises
  them as navigational alerts.

## License

MIT. See [LICENSE](LICENSE).

## Author

[Nearl Crews](https://github.com/NearlCrews): author and maintainer.

## Acknowledgments

Built on the foundation of
[`signalk-activecaptain-resources`](https://github.com/KvotheBloodless/signalk-activecaptain-resources)
by Paul Willems. Full credit to the original author for the initial plugin that
imports the ActiveCaptain points of interest and exposes them as Signal K
resources.

- [Signal K](https://signalk.org/) for the open marine data standard.
- [Garmin ActiveCaptain](https://activecaptain.garmin.com) for the community
  point-of-interest database.
- [OpenStreetMap](https://www.openstreetmap.org) contributors and
  [OpenSeaMap](https://www.openseamap.org) for the open marine data, served
  through the [Overpass API](https://overpass-api.de) and used under the
  [Open Database License](https://opendatacommons.org/licenses/odbl/).
- The [US Coast Guard Navigation Center](https://www.navcen.uscg.gov) for
  the Light List of US Aids to Navigation, US Government public domain.
- The [NOAA Office of Coast Survey](https://nauticalcharts.noaa.gov) for
  the [ENC Direct](https://encdirect.noaa.gov) authoritative US chart
  hazard data, published under CC0. ENC Direct is the official successor
  to the retired AWOIS dataset.

## Support

Report issues at
[github.com/NearlCrews/signalk-crows-nest/issues](https://github.com/NearlCrews/signalk-crows-nest/issues).
