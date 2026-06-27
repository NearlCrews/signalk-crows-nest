# Troubleshooting

## No points of interest appear on the chart

- Confirm the plugin is enabled in the Signal K admin UI under Server ->
  Plugin Config.
- Confirm your Signal K server has a position source (a GPS). The plugin
  serves POIs for the map region the chartplotter asks about; with no
  position, Freeboard-SK has no region to request.
- Open Freeboard-SK and make sure the `notes` layer is switched on in its
  layer controls.
- Confirm at least one data source is enabled in the configuration panel.
  The ActiveCaptain source is on by default; the OpenSeaMap source is off
  by default and has to be enabled to import OpenStreetMap marine data.
  Check the per-source status bar at the top of the panel: an enabled
  source whose API call has succeeded shows a green tick and a recent
  fetch time.
- Pan the chart to an area with known coverage. Coverage is uneven for
  every source (ActiveCaptain is heavy on the US East Coast and Gulf,
  OpenSeaMap is heavy in Europe), so an empty bounding box legitimately
  returns nothing.
- Enable the plugin's debug log (see below) and watch for
  `Incoming request to list note resources`. If that line never appears, the
  chartplotter is not querying the `notes` resource type at all.

## Enabling debug logging

The plugin logs through `app.debug`. Turn it on in the Signal K admin UI under
Server -> Server Log by adding `signalk-crows-nest` to the debug
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
A type that is switched off is excluded from the `poiTypes` request sent
to every source, so those POIs are never fetched.

The OpenSeaMap card has four feature-group toggles (hazards, navigational
aids, harbours, and infrastructure). A group switched off is left out of
the Overpass query, so those seamark features are never fetched. The
OpenSeaMap source itself has its own enable toggle; with it off, no
OpenSeaMap features show up regardless of the group toggles.

If you switch every POI type off in the ActiveCaptain card, the plugin
imports nothing: with no types selected the request is empty, so the
notes output returns no resources.

## The configuration panel does not load

The plugin ships a federated React configuration panel that the Signal K admin
UI loads through Module Federation. It requires Signal K admin UI 2.26.0 or
newer. On an older server the plugin still works: the admin UI falls back to
the standard generated settings form, which exposes the same caching duration
and POI-type options without the live status section.

If you are on a new enough server and the panel still does not appear, do a
full browser reload of the admin UI so it re-fetches the panel bundle.

## The status section shows errors or a stale fetch time

The status section reports each enabled source's API reachability and last
successful fetch time, plus the most recent global errors. Each card's pill
shows the source's health (ok, idle, or error), not a rolling POI count: a
per-fetch count would look broken on a stable source. Recent errors there are real: they are the failures the
plugin recorded while talking to a source's API. Common causes are a lost
internet connection, Cloudflare throttling the ActiveCaptain community API,
or an overloaded Overpass endpoint. The plugin retries `429` and `5xx`
responses with exponential backoff and honors `Retry-After`, so transient
errors usually clear on the next query. A source whose calls keep failing
shows a red cross in its row; the other enabled sources keep working.

If the primary Overpass endpoint is down for a sustained period, add one or more
fallback mirrors in the OpenSeaMap card's "Fallback endpoints" field (one per
line). The source tries the primary first and fails over to each mirror in
order, so a single Overpass instance outage no longer takes OpenSeaMap offline.
Use full-planet mirrors only: a regional extract answers an out-of-region query
with no data rather than an error.

## Configuration changes do not take effect

Signal K reloads plugin configuration when you save it, and the plugin rebuilds
its runtime (HTTP client, cache, and `poiTypes` string) on every start, so
caching-duration and POI-type changes apply on save. Cached POI detail records
from before the change may persist until their TTL expires; restart the plugin
to clear the cache immediately.

## Editing a POI fails

Every source the plugin imports from is read-only. The plugin rejects any
attempt to create, update, or delete a `notes` resource it provides. To
edit a POI, use the upstream site: ActiveCaptain points link back to the
ActiveCaptain community website, and OpenSeaMap points link back to the
OpenStreetMap element page.

## Stale or unexpected POI data

POI detail records are cached for the configured window (default 60 minutes).
A longer window means less traffic to upstream APIs but more lag before
edits made on ActiveCaptain or OpenStreetMap reach your chart. Shorten the
caching duration, or restart the plugin, if you need fresher data.

## Two markers for the same harbour or hazard

When more than one source reports the same physical feature, the plugin
merges them into one note (see the per-source dedupe in `README.md`).
The default merge radius is 150 feet; widen the "Merge radius" field on
the matching source card (OpenSeaMap, USCG Light List, or NOAA ENC) if
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
