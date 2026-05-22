# Troubleshooting

## No ActiveCaptain POIs appear on the chart

- Confirm the plugin is enabled in the Signal K admin UI under Server ->
  Plugin Config.
- Confirm your Signal K server has a position source (a GPS). The plugin
  serves POIs for the map region the chart plotter asks about; with no
  position, Freeboard-SK has no region to request.
- Open Freeboard-SK and make sure the ActiveCaptain notes layer is switched on
  in its layer controls.
- Pan the chart to an area with known ActiveCaptain coverage. Coverage is
  uneven; an empty bounding box legitimately returns nothing.
- Enable the plugin's debug log (see below) and watch for
  `Incoming request to list note resources`. If that line never appears, the
  chart plotter is not querying the `notes` resource type at all.

## Enabling debug logging

The plugin logs through `app.debug`. Turn it on in the Signal K admin UI under
Server -> Server Log by adding `signalk-activecaptain-resources` to the debug
field, or set the `DEBUG` environment variable before starting the server:

```bash
DEBUG=signalk-activecaptain-resources signalk-server
```

With debug on you will see the resolved caching window, the `poiTypes` string,
each incoming list and detail request, and the bounding box derived from each
query.

## Some POI types never show up

The configuration has 13 POI-type toggles. A type that is switched off is
excluded from the `poiTypes` string sent to the API, so those POIs are never
fetched. Check the toggles in the configuration panel.

If you switch every POI type off, the plugin falls back to requesting all
types rather than fetching nothing.

## The configuration panel does not load

The plugin ships a federated React configuration panel that the Signal K admin
UI loads through Module Federation. It requires Signal K admin UI 2.26.0 or
newer. On an older server the plugin still works: the admin UI falls back to
the standard generated settings form, which exposes the same caching duration
and POI-type options without the live status section.

If you are on a new enough server and the panel still does not appear, do a
full browser reload of the admin UI so it re-fetches the panel bundle.

## The status section shows errors or a stale fetch time

The status section reports Garmin API reachability, the cached POI count, the
last fetch time, and recent errors. Recent errors there are real: they are the
failures the plugin recorded while talking to the ActiveCaptain API. Common
causes are a lost internet connection or Cloudflare throttling the community
API. The plugin retries `429` and `5xx` responses with exponential backoff, so
transient errors usually clear on the next query.

## Configuration changes do not take effect

Signal K reloads plugin configuration when you save it, and the plugin rebuilds
its runtime (HTTP client, cache, and `poiTypes` string) on every start, so
caching-duration and POI-type changes apply on save. Cached POI detail records
from before the change may persist until their TTL expires; restart the plugin
to clear the cache immediately.

## Editing a POI fails

ActiveCaptain resources are read-only. The plugin rejects any attempt to create,
update, or delete a `notes` resource it provides. To edit a POI, use the
ActiveCaptain community website; the plugin links each note back to its public
ActiveCaptain page.

## Stale or unexpected POI data

POI detail records are cached for the configured window (default 60 minutes).
A longer window means less traffic to Garmin but more lag before edits made on
ActiveCaptain reach your chart. Shorten the caching duration, or restart the
plugin, if you need fresher data.
