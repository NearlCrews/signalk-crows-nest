# Troubleshooting

## No points of interest appear on the chart

- Confirm the plugin is enabled in the Signal K admin UI under Server, then
  Plugin Config.
- Open Freeboard-SK and make sure the `notes` layer is switched on in its
  layer controls.
- Confirm at least one data source is enabled in the configuration panel.
  The ActiveCaptain source is on by default; every other source (OpenSeaMap,
  USCG Light List, NOAA ENC Direct, NOAA CO-OPS, USCG Local Notice to
  Mariners, NGA World Port Index, and USACE locks and dams) is off by
  default and has to be enabled on its card. Check the Plugin status section
  at the top of the panel: an enabled source whose API call has succeeded
  reads as `Reachable` and shows a recent fetch time.
- Confirm at least one ActiveCaptain POI type is selected. Selecting none
  intentionally hides the chart notes layer, including notes from optional
  sources. Enabled safety alerts still fetch the hazard types they need.
- Pan the chart to an area with known coverage. Coverage is uneven for
  every source (ActiveCaptain is heavy on the US East Coast and Gulf,
  OpenSeaMap is heavy in Europe), so an empty bounding box legitimately
  returns nothing.
- Give a newly enabled source time to arrive, and expect a different wait
  depending on which one it is. The USCG Light List, USCG Local Notice to
  Mariners, and NOAA CO-OPS sources wait 30 seconds after the plugin starts
  before their first download, so they legitimately show nothing straight
  after you enable them, with their pill reading `Idle` and the health table
  reading `Not yet contacted`. The viewport-driven sources answer the next
  chart request instead, so they do not wait. The NGA
  World Port Index is the slow one: it has no bounding-box query, so its first
  list call downloads the whole worldwide index. Its pill reads `Idle` until
  the chartplotter first asks for the area, then `Fetching` until the download
  lands, and the expanded card explains the wait as
  "List request exceeded 5s; result will appear on next refresh". The ports
  appear on a later chart refresh, which on a satellite link can be minutes
  rather than seconds.

  A pill reading `Idle:` followed by a reason, such as
  `Idle: outside US waters`, is the opposite case and waiting will not help.
  That source is skipping on purpose and stays quiet until the reason stops
  applying. Five of the eight sources are US-only and gate their requests on
  the vessel position this way: the USCG Light List, USCG Local Notice to
  Mariners, NOAA CO-OPS, NOAA ENC Direct, and USACE locks and dams. Offshore,
  every one of them reads `Idle: outside US waters` until the vessel returns
  to US waters, whichever section of this page brought you here.

- Enable the plugin's debug log (see below) and watch for
  `Incoming request to list note resources`. If that line never appears, the
  chartplotter is not querying the `notes` resource type at all.

A GPS fix is not required for the chart notes layer: the chartplotter supplies
its own bounding box or search center. A valid `navigation.position` is required
for the proximity, route, and bridge air-draft alarms. It also lets the plugin
skip US-only upstream requests when the vessel is clearly outside US waters.

## Enabling debug logging

The plugin logs through `app.debug`. Turn it on in the Signal K admin UI under
Server, then Server Log, by adding `signalk-crows-nest` to the debug
field, or set the `DEBUG` environment variable before starting the server:

```bash
DEBUG=signalk-crows-nest signalk-server
```

With debug on you will see the resolved caching window, the `poiTypes` string,
each incoming list and detail request, and the bounding box derived from each
query.

## Some POI types never show up

The ActiveCaptain card in the configuration panel has 13 POI-type toggles
(marinas, anchorages, hazards, businesses, boat ramps, bridges, dams,
ferries, inlets, locks, local knowledge, navigational aids, and airports).
These toggles filter ActiveCaptain. Optional sources use their own feature-group
or layer controls, so disabling ActiveCaptain hazards does not disable an
enabled OpenSeaMap hazard group or NOAA ENC hazard layer.

The OpenSeaMap card has four feature-group toggles (hazards, navigational
aids, harbours, and infrastructure). A group switched off is left out of
the Overpass query, so those seamark features are never fetched. The
OpenSeaMap source itself has its own enable toggle; with it off, no
OpenSeaMap features show up regardless of the group toggles.

Several other cards carry per-layer toggles with deliberate defaults: the
NOAA ENC Direct card imports wrecks and obstructions by default but leaves
underwater rocks off (a coastal-band query can return tens of thousands),
the NOAA CO-OPS card imports both the tide and the current-meter station
families by default, and the USACE card imports locks by default but leaves
dams off (the National Inventory of Dams lists tens of thousands, most not
on navigable water). A layer switched off is never queried.

If you switch every POI type off in the ActiveCaptain card, the chart notes
output returns no resources from any source. This is the deliberate way to
hide the complete notes layer without disabling the safety outputs. An enabled
alarm still adds Hazard, Bridge, or Lock to its internal position-driven scan
as needed.

## The configuration panel does not load

The plugin ships a federated React configuration panel that the Signal K admin
UI loads through Module Federation. It requires Signal K admin UI 2.26.0 or
newer. On an older server the plugin still works: the admin UI falls back to
the standard generated settings form, which exposes the plugin configuration
without the grouped layout, theme control, or live status section.

The shared panel themes also require a browser with native CSS `@scope`
support. An unsupported browser displays an update message instead of a
partially styled configuration form.

If you are on a new enough server and the panel still does not appear, do a
full browser reload of the admin UI so it re-fetches the panel bundle.

## The status section shows errors or a stale fetch time

The source health table reports the result of real upstream requests.
`Reachable` means the latest request succeeded, `Unreachable` means it failed,
and `Not yet contacted` means no request has completed during this plugin run.
A local index or disk-cache hit does not change reachability or the last
successful upstream list-fetch time. This is why cached markers can remain
visible while the source honestly reads as `Unreachable`.

Each source card condenses that state into one of four pills:

- `✓ Healthy`: the last upstream list request succeeded.
- `Idle`: the source is awaiting its first request or deliberately skipped
  one. The label names the reason when it has one, as in
  `Idle: outside US waters`.
- `! Fetching`: the source exceeded the aggregate's five-second response window,
  but its request is still filling the viewport cache. Refresh the chart to use
  the result after it finishes.
- `× Unreachable`: the last real request failed. The recent-error list keeps the
  failure details, and each entry carries a "Show <source>" button that opens
  the matching card and moves focus to it.

Common failures include a lost internet connection, Cloudflare throttling the
ActiveCaptain community API, an overloaded Overpass endpoint, or an NGA
maintenance window answering the World Port Index with `503`. The queued
ActiveCaptain and OpenSeaMap clients retry `429` and `5xx` responses with
exponential backoff and honor `Retry-After`. The lower-volume one-shot clients
use a bounded request instead and try again on the next chart or scheduled
refresh, and a failed World Port Index full download waits ten minutes before
the next attempt, serving the last known ports in the meantime, so a repeated
upstream outage produces one recorded error per attempt rather than one per
chart poll. The map-viewport sources apply the same idea per chart tile: a
failed tile fetch waits a minute before the next attempt while cached markers
keep serving. During an outage the server's plugin status line appends how
many sources are offline and that cached data is being shown. One source
failing does not stop the other enabled sources.

If the primary Overpass endpoint is down for a sustained period, add one or more
fallback mirrors in the OpenSeaMap card's "Fallback endpoints" field (one per
line). The source tries the primary first and fails over to each mirror in
order, so a single Overpass instance outage no longer takes OpenSeaMap offline.
Use full-planet mirrors only: a regional extract answers an out-of-region query
with no data rather than an error.

## Save is unavailable

The panel refuses to save an Overpass endpoint the plugin cannot use, on the
OpenSeaMap card's main endpoint field and on any line of its fallback list. The
offending field states the problem, and Save stays unavailable until it is
corrected. Clear the main endpoint field to return to the default. This is
deliberate: an unusable endpoint used to be accepted, replaced with the default
the next time the panel loaded, and lost, so OpenSeaMap ran against an endpoint
other than the one shown on screen.

## Configuration changes do not take effect

Signal K reloads plugin configuration when you save it, and the plugin rebuilds
its runtime, HTTP clients, in-memory viewport caches, and `poiTypes` string on
every start, so configuration changes apply on save. The on-disk detail and
full-dataset stores deliberately survive saves and restarts for offline use.
Restarting therefore does not erase persisted source data.

## Editing a POI fails

Every source the plugin imports from is read-only. The plugin rejects any
attempt to create, update, or delete a `notes` resource it provides. To
edit a POI, use the upstream site: ActiveCaptain points link back to the
ActiveCaptain community website, and OpenSeaMap points link back to the
OpenStreetMap element page.

## Stale or unexpected POI data

ActiveCaptain detail records use the configured freshness window (default 24
hours). A longer window means less API traffic but more delay before an edited
ActiveCaptain description is fetched again. The at-runtime sources use their
own viewport refresh periods, while USCG Light List, NOAA CO-OPS, USCG Local
Notice to Mariners, and World Port Index use their configured full-dataset
refresh periods. Shorten the setting that belongs to the stale source and pan
or refresh the chart after that window. A restart clears in-memory viewport
state but intentionally retains on-disk records.

OpenSeaMap, NOAA ENC Direct, USACE, and World Port Index can rebuild markers
from their persisted stores during an outage. The bulk-download sources also
list from their complete on-disk indexes. ActiveCaptain persists known detail
records, but a cold-start list still requires the ActiveCaptain upstream. Any
stale offline list serve keeps available markers useful while recording the
upstream as unreachable and adding a recent error, so visible data is not
mistaken for a fresh network result.

## Two markers for the same harbour or hazard

When more than one source reports the same physical feature, the plugin
merges them into one note (see the per-source dedupe in `README.md`).
The default merge radius is 150 feet; widen the "Merge radius" field on
the matching source card (every card except ActiveCaptain carries one) if
duplicates still appear close together, or tighten it if genuinely
separate neighbors are being merged. The radius is per-source, so a tight
USCG merge can coexist with a looser OpenSeaMap merge.

## Too many old or low-confidence features on the chart

Each opting-in source (OpenSeaMap, USCG Light List, NOAA ENC Direct)
carries an optional "Earliest ... year" field on its card. Set it to a
year and the source hides every feature whose source-specific date is
older. The fields default to 0 (no filter) and features without a recorded
date always pass through. The date means a different thing per source:

- **NOAA ENC Direct**: SORDAT is the hydrographic survey date. A wreck
  found in a 1950s lead-line survey is lower depth-confidence than one
  from a 2020s multibeam survey, so a cutoff like 1990 hides the oldest
  surveys and keeps the modern ones.
- **USCG Light List**: MODIFIED_DATE is when the USCG last edited the
  record. A cutoff hides aids the USCG has not touched recently.
- **OpenSeaMap**: the OSM `timestamp` is when any contributor last edited
  the element. A cutoff hides elements no contributor has touched for a
  while; this is a contributor-attention signal, not a correctness signal.
