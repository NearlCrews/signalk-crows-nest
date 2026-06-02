# Enhancement roadmap

Enhancement opportunities for signalk-crows-nest beyond the
original scope ("import ActiveCaptain points of interest as `notes` resources
for chart display"). Produced by a four-expert review on 2026-05-22.

The original plugin is purely pull-driven and read-only. The largest
opportunities come from making it position-aware and offline-capable.

## Tier 1: position-aware safety (shipped in v0.3.0)

Shipped in v0.3.0. None of these needed a Garmin API key or carried
terms-of-service exposure.

- **Position subscription and hazard scan.** Subscribe to
  `navigation.position` and scan for points of interest around the vessel as
  it moves. The enabler for the proximity alarms.
- **Proximity hazard alarms.** When the vessel nears a Hazard (and optionally
  a Bridge, Lock, or Inlet), emit a SignalK `notifications.*` delta. Turns a
  passive chart layer into an active safety tool.
- **Persistent, offline cache.** Back the in-memory cache with on-disk storage
  so point-of-interest detail survives restarts and is readable with no
  connectivity.
- **Rating filter.** A configurable minimum rating, so low-rated or unreviewed
  points of interest can be hidden. The bounding-box response already carries
  the review summary, so this needs no extra requests.
- **Hazard freshness surfacing.** Prominently flag stale Hazard reports; a
  stale hazard is a safety signal the crew must see.

## Tier 2: strong, moderate effort

- Route-corridor hazard scan: flag hazards, bridges, and locks along an active
  Course API route, with distance and ETA. Shipped in v0.4.0.
- Bridge air-draft check: warn when a bridge's vertical clearance is at or below
  the vessel air draft plus a margin, as a proximity alarm and a route-ahead
  warning. Shipped in v0.7.0.
- Route-ahead prefetch: warm the cache for points of interest ahead of the
  vessel while connectivity still exists.
- "Navigate to this POI": one-tap set the Course API destination.
- Map preview in the configuration panel.
- Bridge and lock schedule notifications on approach.
- Night-vision (red) theme for the panel and the rendered note descriptions.
- NOAA tide and current cross-reference for the nearest station.
- CI release automation and SignalK App Store polish (icon, metadata). Shipped:
  a GitHub-release-driven npm publish with provenance, the plugin app icon,
  the registry screenshots, and a SignalK plugin-ci run on the published commit.

## Tier 3: ambitious or gated

- A bundled SignalK webapp for browsing points of interest off the chart
  plotter.
- Developer API local mirror: incremental sync and bulk export for a true
  offline regional dataset. Requires a Garmin developer API key and accepting
  Garmin's developer terms.
- Full review list and review photos (developer API only).
- Contributing reviews and hazard reports back to ActiveCaptain (developer API
  plus per-user Garmin sign-in).
- Multi-source marine POI aggregation. OpenSeaMap (OpenStreetMap marine data
  via the OSM Overpass API) shipped in v0.5.0, with per-source dedupe against
  the ActiveCaptain base layer. The USCG Light List of US Aids to Navigation
  and NOAA ENC Direct's authoritative US wrecks, obstructions, and underwater
  rocks both shipped as US-only, opt-in inputs that gate outbound HTTP on the
  vessel position. NOAA ENC Direct is the official successor to the retired
  AWOIS dataset, so chart hazards now come from the same authoritative survey
  data that ships in the official ENC chart cells. USACE lock status and
  Waterway Guide remain candidates for follow-up sources.
- React panel component tests.

## Candidate data sources (researched 2026-05-30)

A session review surfaced these as the strongest next sources, beyond the four
that ship today:

- **NOAA CO-OPS tide and current stations** as a first-class input, not just the
  Tier 2 nearest-station cross-reference: the free
  `api.tidesandcurrents.noaa.gov` station-metadata endpoint lists every station
  with a position, rendered as a POI note with the next high/low or flood/ebb
  and a deep link. High daily value, fits the pull-and-cache pattern, US plus
  some Pacific and Caribbean coverage.
- **AIS Aids to Navigation read from SignalK itself**: a new input that surfaces
  the AIS AtoN already on the SignalK bus (message 21, especially virtual AtoN)
  as POI notes. Global, no external API, and no terms-of-service exposure; it
  introduces a read-from-SignalK input flavor alongside the HTTP pulls.
- **World Port Index (NGA Pub 150)**: a free global ports and harbours dataset
  that fills the plugin's US bias for international cruisers.

USACE lock status and Waterway Guide remain the other candidates noted in
Tier 3.
