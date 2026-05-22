# Crow's Nest

A [Signal K server](https://github.com/SignalK/signalk-server) plugin that
imports points of interest from multiple marine data sources, the
[Garmin ActiveCaptain](https://activecaptain.garmin.com) community database and
[OpenSeaMap](https://www.openseamap.org) (OpenStreetMap marine data), and
exposes them as Signal K `notes` resources, so chart plotters such as
Freeboard-SK can show marinas, anchorages, hazards, and more as a layer on the
chart. It also keeps a lookout: it raises a proximity alarm when the vessel
nears a hazard, and scans the active route ahead for hazards, bridges, and
locks.

## What's New in v0.5.0

**Multi-source points of interest.** The plugin now imports from more than one
source. Alongside Garmin ActiveCaptain it adds **OpenSeaMap**, OpenStreetMap
marine data fetched through the OSM Overpass API, covering seamark hazards,
navigational aids, harbours, and infrastructure. Enabled sources merge into one
chart layer, and a failing source no longer blanks the chart. An OpenSeaMap
point that duplicates an ActiveCaptain marker is merged into it, and the
surviving note records every source that reported it. The configuration panel
is now a per-source accordion, and the status bar reports each source's health
separately. Resource ids gain a source prefix, and the hazard notifications
move to a source-agnostic `notifications.navigation.crowsNest.*` path.

See the [CHANGELOG](CHANGELOG.md) for the full history.

## Features

- **Point-of-interest overlay.** Imports ActiveCaptain marinas, anchorages,
  hazards, businesses, boat ramps, bridges, dams, ferries, inlets, locks, local
  knowledge, navigational aids, and airports as Signal K `notes` resources.
- **Multiple data sources.** Imports from Garmin ActiveCaptain and OpenSeaMap
  (OpenStreetMap marine data, via the OSM Overpass API), merged into one chart
  layer. A duplicate of a feature reported by more than one source is merged,
  and the note records every contributing source as a corroboration signal.
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
source as a corroboration signal. This dedupe is on by default and can be
turned off in the OpenSeaMap card.

OpenStreetMap data is published under the
[Open Database License](https://opendatacommons.org/licenses/odbl/) (ODbL),
which requires visible attribution wherever the data is shown. Every OpenSeaMap
point's rendered detail carries an `© OpenStreetMap contributors (ODbL)`
footer.

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

## Support

Report issues at
[github.com/NearlCrews/signalk-crows-nest/issues](https://github.com/NearlCrews/signalk-crows-nest/issues).
