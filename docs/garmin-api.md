# Garmin ActiveCaptain API

Research notes for the `signalk-crows-nest` plugin. Probed on 2026-05-21.

This plugin imports points of interest (POIs) from Garmin ActiveCaptain and exposes
them as Signal K `notes` resources. There are two distinct APIs in play:

1. The **community API** (`activecaptain.garmin.com/community/api/v1`) - unauthenticated,
   backs the public ActiveCaptain website, and is what this plugin currently uses.
2. The official **third-party / developer API** (`marine.garmin.com/thirdparty.../api/v2`) -
   requires an API key issued through the Garmin Developer Portal.

The README links the developer API swagger page, but the running code talks to the
community API. Both are documented below.

---

## 1. Community API (currently used by the plugin)

Base URL: `https://activecaptain.garmin.com/community/api/v1`

No API key, no authentication. The service sits behind Cloudflare. It responds
with `api-supported-versions: 1.0`. A `User-Agent` header is accepted but not
required (requests without one still return 200); the plugin sends the shared
`PLUGIN_USER_AGENT`, currently
`User-Agent: signalk-crows-nest (+https://github.com/NearlCrews/signalk-crows-nest)`,
which is fine to keep.

### 1.1 List POIs in a bounding box

```
POST /community/api/v1/points-of-interest/bbox
Content-Type: application/json
Accept: application/json
```

Request body:

| Field       | Type    | Required | Notes |
|-------------|---------|----------|-------|
| `north`     | number  | yes      | Latitude of the north edge (decimal degrees) |
| `south`     | number  | yes      | Latitude of the south edge |
| `east`      | number  | yes      | Longitude of the east edge |
| `west`      | number  | yes      | Longitude of the west edge |
| `zoomLevel` | integer | yes      | Map zoom level. The plugin uses `17`. Lower zoom clusters nearby POIs (see `poiCount`); higher zoom returns individual POIs. |
| `poiTypes`  | string  | no       | Comma-separated list of POI types to include. If omitted, all types are returned (confirmed: a body with no `poiTypes` still returns 200). |

Example:

```json
{
  "north": 38.99, "west": -76.52, "south": 38.95, "east": -76.46,
  "zoomLevel": 17,
  "poiTypes": "Marina,Anchorage,Hazard,Business,BoatRamp,Bridge,Dam,Ferry,Inlet,Lock"
}
```

Response body shape:

```json
{
  "pointsOfInterest": [
    {
      "id": "49205",
      "mapLocation": { "latitude": 38.978046, "longitude": -76.519802 },
      "name": "Bacon Sails and Marine Supplies",
      "poiType": "Business",
      "reviewSummary": { "averageRating": 0.0, "numberOfReviews": 0 },
      "poiCount": 1
    }
  ]
}
```

Notes:

- `id` is returned as a **string** here.
- `poiCount` is the number of POIs represented by the entry. A single entry
  can stand in for several POIs, and this clustering happens even at zoom 17
  in dense harbours (probing Newport at zoom 17 returned clusters of 2, 3, and
  4). A cluster entry carries a synthetic `id` with no `name`, and the summary
  endpoint returns HTTP 404 for that id. The plugin therefore drops entries
  with `poiCount` greater than 1: it cannot expose them as individual notes.
- An Annapolis test bbox returned 73 POIs; there is no documented page size or
  pagination. Keep bounding boxes modest in size.

### 1.2 Get a POI summary

```
GET /community/api/v1/points-of-interest/{id}/summary
Accept: application/json
```

Returns the full detail record for one POI. A non-existent id returns **HTTP 404**
(so a 404 is permanent: do not retry it).

The response is an object whose keys are **optional sections**. Only sections that
have data for that POI are present. Observed sections:

| Section          | Present for | Contents |
|------------------|-------------|----------|
| `pointOfInterest`| always      | `id` (number here), `name`, `poiType`, `mapLocation`, `dateLastModified`, optional `notes[]` |
| `contact`        | most        | address fields, `phone`, `email`, `website`, `vhfChannel`, `afterHourContact` |
| `reviewSummary`  | most        | `averageRating`, `numberOfReviews` |
| `featuredReview` | some        | `createdBy`, `rating`, `title`, `text`, `dateVisited`, `votes`, `photos[]`, `status` |
| `dockage`        | marinas     | berth counts (`total`, `transient`), `price`, `pricingOption`, `currency`, AC power options (`acPower30`, `acPower50`, ...), dock types, `loaMax`, `beamMax`, `liveaboard`, `secureAccess`, `securityPatrol`, `isFree`, `notes[]` |
| `fuel`           | marinas     | `diesel`, `gas`, `ethanolFree`, `propane`, `electric`, `depthFuel`, `currency`, `volumeUnits`, `notes[]` |
| `amenity`        | marinas     | `bar`, `boatRamp`, `cellReception`, `courtesyCar`, `laundry`, `lodging`, `pets`, `restaurant`, `restroom`, `shower`, `transportation`, `trash`, `water`, `wifi`, `notes[]` |
| `business`       | marinas/biz | `cash`, `check`, `credit`, `public`, `seasonal`, `notes[]` |
| `businessProgram`| sponsored   | `programTier`, `callToActionEnabled`, `competitorAdEnabled`, `communityEditsEnabled` |
| `retail`         | marinas/biz | `fishingSupplies`, `grocery`, `hardware`, `ice`, `marineRetail`, `notes[]` |
| `services`       | marinas     | repair/haul-out/storage/charter flags, `pumpOut`, `notes[]` (large boolean-ish set) |
| `mooring`        | marinas     | `dinghy`, `launch`, `total`, `transient`, `isFree`, `hasMoorings`, `notes[]` |
| `navigation`     | marinas     | `current`, `tide`, `depthApproach`, `fixedBridge`, `notes[]` |

Conventions inside sections:

- Most capability fields are tri-state strings: `"Yes"`, `"No"`, `"Unknown"`
  (and occasionally `"Nearby"`). Code should treat anything not `"Yes"` as
  not-confirmed rather than assuming a boolean.
- Each section can carry a `notes[]` array of `{ "field": "...", "value": "..." }`
  free-text entries. `value` can contain `\r` / `\n` line breaks.
- Each section repeats `id` (number) and usually `dateLastModified`.
- Distance/volume units are spelled out in the section (`distanceUnit: "Meter"`,
  `volumeUnits: "Gallon"`); numeric values such as `loaMax`, `beamMax`,
  `depthApproach` are already in those units (meters in the samples seen).

The plugin's Handlebars partials render `dockage`, `mooring`, `contact`,
`fuel`, `amenity`, `services`, `retail`, `navigation`, `business`,
`reviewSummary`, and `featuredReview`. The `businessProgram` section is
returned by the API but not rendered: it is sponsored-tier marketing metadata,
not boater-useful detail.

### 1.3 POI types

The complete `PoiType` enumeration (taken from the developer API contract, and a
superset of what the plugin currently exposes):

```
Unknown, Anchorage, Hazard, Marina, LocalKnowledge, Navigational,
BoatRamp, Business, Inlet, Bridge, Lock, Dam, Ferry, Airport
```

The plugin config exposes 13 of these: Marina, Anchorage, Hazard, Business,
BoatRamp, Bridge, Dam, Ferry, Inlet, Lock, LocalKnowledge, Navigational, and
Airport. `Unknown` is a sentinel and should not be requested.

For the `bbox` `poiTypes` field the values are joined with commas, e.g.
`"Marina,Anchorage,Hazard"`.

---

## 2. Official third-party / developer API

Swagger UI: `https://marine.garmin.com/thirdparty-stage/swagger/index.html`
(`thirdparty-stage` is the staging host; a `thirdparty` production host also
exists and responds 403 without credentials.)

OpenAPI specs are published at:

- `https://marine.garmin.com/thirdparty-stage/swagger/v1/swagger.json`
- `https://marine.garmin.com/thirdparty-stage/swagger/v2/swagger.json`
- `https://marine.garmin.com/thirdparty-stage/swagger/v2.1/swagger.json`

The API title is `Community.Developer`. It is OpenAPI 3.0.1.

### 2.1 Authentication: API key required

Two security schemes are defined and both are needed:

- `apikey` - an API key sent in an `apikey` request header. Described in the
  spec as "API key needed to access all endpoints."
- `Bearer` - a JWT sent as `Authorization: Bearer {token}`.

The JWT is obtained from `GET /api/v{n}/authentication/access-token`, which
takes `serviceUrl` and `serviceTicket` query parameters "obtained from SSO".
So the full flow is: Garmin SSO login -> service ticket -> exchange for a JWT
access token -> call endpoints with both `apikey` and the bearer token.
`refresh-token` renews an expiring JWT.

**You cannot use this API without an API key.** The key is issued through the
Garmin Developer Portal:

1. Create an ActiveCaptain Community account (Garmin recommends a **separate**
   account for development, not your personal boating account).
2. Go to the ActiveCaptain Developer page and click "Request Access", fill in
   the form, and agree to the terms and conditions.
3. Once granted Developer Portal access, click "Add Application"; the app is
   issued a **Stage API key**. A production key follows after review.
4. Garmin's guidance: one shared company login holds the keys for a team.

References: <https://activecaptain.garmin.com/en-US/Developer>,
<https://developer.garmin.com/active-captain/>,
<https://developer.garmin.com/active-captain/web/>.

### 2.2 What the developer API offers over the community API

Endpoints in the v2 contract (all under `/api/v2`):

- `POST /points-of-interest/bbox` - POIs for a bounding box, with **richer
  filters** than the community API: `rating`, `includeNearby`, and capability
  filters `amenity`, `fuel`, `retail`, `services` in addition to `poiTypes`
  and `zoomLevel`.
- `GET  /points-of-interest/{id}` - full POI data.
- `GET  /points-of-interest/sync` - up to 100 POIs changed on or after a given
  time (for incremental sync / local caching).
- `POST /points-of-interest/tiles` - tiles overlapped by given bounding boxes.
- `POST /points-of-interest/export` - URLs for bulk data exports.
- `POST /points-of-interest` - **create** a new POI.
- `PUT  /points-of-interest/{id}/location` - move a POI.
- `POST /points-of-interest/{id}/view` - record a POI view.
- `GET  /points-of-interest/{id}/reviews`, `GET /reviews/{id}`,
  `GET /reviews/sync`, `POST /reviews/{id}/votes` - reviews and voting.
- `GET  /user` (v1) - data about the authenticated user.
- `GET  /currencies`, `GET /health/is-alive` (v1).
- v2.1 adds `POST /points-of-interest/sync-status` - tile sync status.

So the developer API adds write access (create/move POIs, vote on reviews),
incremental sync endpoints, bulk export, and capability-based filtering. For a
**read-only chart-overlay plugin** the community API already returns the same
POI and summary content; the developer API's main read advantage is the sync
and export endpoints, which matter only if the plugin moved to a local mirror
of the dataset.

Official native SDKs also exist for storing/rendering this data:
<https://github.com/garmin/ActiveCaptainCommunitySDK-ios> and
<https://github.com/garmin/ActiveCaptainCommunitySDK-android>.

---

## 3. Rate limits

### 3.1 Documented limits

None. No rate limit is published for the community API, and no
`X-RateLimit-*`, `RateLimit-*`, or `Retry-After` headers appear on any
response. The only response headers of note are Cloudflare's (`server: cloudflare`,
`cf-ray`, `cf-cache-status: DYNAMIC`) and `api-supported-versions: 1.0`.

The developer API's terms (rate limits included) are inside the Developer Portal
and not public.

### 3.2 Observed behavior

Probed responsibly on 2026-05-21 against the community API:

- 25 rapid sequential `GET /summary` requests: all HTTP 200.
- 40 fully concurrent `GET /summary` requests: all HTTP 200.
- Typical response time 0.12 to 0.45 s.
- No throttling, no `429`, no challenge page observed.

No enforced limit was hit. However, the API is Cloudflare-fronted, so Cloudflare
can throttle or serve a challenge (`429` / `503`, possibly an HTML body instead
of JSON) for traffic it considers abusive. The absence of an enforced limit is
not a license to hammer the service.

### 3.3 Recommended client settings

Treat the plugin as a good citizen. Concrete values for the API client:

| Setting | Recommended value |
|---------|-------------------|
| Max concurrency (in-flight requests) | **5** (hard ceiling 6) |
| Steady-state request rate | **~5 requests/second**, token-bucket limited, short bursts up to the concurrency cap |
| Per-request timeout | 10 s connect + read (responses normally land well under 0.5 s) |
| Retry on | `429`, `502`, `503`, `504`, and network errors only |
| Do not retry on | other `4xx` (notably `404` = POI does not exist, permanent) |
| Backoff | exponential with full jitter: base 1 s, factor 2, cap 30 s, max 4 retries |
| `Retry-After` | if present on a `429`/`503`, honor it instead of the computed backoff, but cap the wait at the maximum backoff (30 s) so a huge header value cannot stall a request indefinitely |
| User-Agent | keep the shared `PLUGIN_USER_AGENT` (`signalk-crows-nest (+https://github.com/NearlCrews/signalk-crows-nest)`) |

The single most effective limiter is **caching**, which the plugin already does:
summaries are cached (default 60 minutes via `cachingDurationMinutes`). Keep
that. The `bbox` list call is one request per `listResources` query and is low
volume, so it does not need its own cache. Detail (`summary`) fetches are the
ones that fan out, so the concurrency cap and rate limiter should be applied
there.

---

## 4. Authentication: does logging in help?

**Recommendation: No. Do not add Garmin account login to this plugin.**

Reasoning:

- The community API the plugin uses is fully unauthenticated. Logging in with a
  personal Garmin account grants it **nothing**: it is a different API surface.
  There is no "authenticated community API" tier with more data or higher
  limits.
- The only way a Garmin login yields extra capability is the **developer API**,
  and that is gated by an **API key + JWT**, not by a normal user login. The
  added endpoints there (create POI, move POI, vote, sync, export) are write
  and bulk-sync features that a read-only chart-overlay plugin does not need.
  The read content (POIs + summaries) is the same data the community API
  already returns.
- Requiring every plugin user to obtain a Garmin developer API key would be a
  significant onboarding burden for zero display benefit, and a single shared
  key embedded in an open-source plugin would violate the per-application key
  model and risk revocation.
- No observed or documented rate-limit relief comes from authenticating.

If the plugin ever needs incremental sync, bulk export, or write-back
(contributing reviews/edits from Signal K), revisit this: that work genuinely
requires the developer API and an API key. For the current feature set
(read-only POI overlay), stay on the unauthenticated community API.

---

## 5. Terms of service and acceptable use

- The community API is the public backend of `activecaptain.garmin.com`. It is
  not formally published as a public API, so its stability is not guaranteed:
  Garmin could change or lock it down without notice. The official, supported
  path is the developer API with a key.
- ActiveCaptain content is community-contributed and governed by the
  [ActiveCaptain Community Policies](https://activecaptain.garmin.com/en-US/CommunityPolicy)
  and Terms of Use. Data is "as is"; it is navigational reference, not a
  substitute for official charts.
- Attribution: the plugin credits "Data from Garmin ActiveCaptain" on every
  produced note via the structured `properties.attribution` field, alongside
  `properties.source = 'activecaptain'`, `properties.plugin`, and
  `properties.pluginRepo`, and the note's `url` links back to the POI page
  on `activecaptain.garmin.com`. Keep these. They are the right thing to do
  and they are the norm for displaying ActiveCaptain data; a Signal K client
  UI is expected to surface the attribution credit (and the link) from
  these structured fields rather than depend on an inline footer in the
  description.
- Be a low-impact consumer: cache aggressively, keep bounding boxes reasonable,
  respect the concurrency/backoff guidance in section 3.3, and send a
  descriptive `User-Agent` so Garmin can identify the traffic.
- The developer API's "Request Access" form requires agreeing to Garmin's
  developer terms and conditions. If the project ever adopts the developer API,
  those terms (including any redistribution and rate-limit clauses) become
  binding and must be reviewed at that point.
- Garmin's marine privacy policy:
  <https://www.garmin.com/en-GB/privacy/marine/policy/>. The plugin sends only
  bounding-box coordinates and POI ids, no personal data, so this is low risk,
  but do not start sending user identifiers without revisiting it.

---

## 6. Summary for the plugin

- Keep using the unauthenticated community API. It returns everything a
  read-only POI overlay needs.
- Do not add Garmin login or an API key. They unlock the developer API, whose
  extra value is write/sync/export, not display data.
- Apply the section 3.3 client settings: concurrency 5, ~5 req/s, exponential
  backoff (base 1 s, cap 30 s, 4 retries), honor `Retry-After` capped at the
  30 s maximum, retry only `429`/`5xx`/network errors, never retry `404`.
- Keep caching summaries (default 60 min) - it is the main load mitigation.
- The config UI exposes all 13 selectable POI types. The plugin renders every
  boater-useful summary section, including `services`, `mooring`, `navigation`,
  `retail`, and the `featuredReview`; only the sponsored `businessProgram`
  metadata is left out.
- Keep the "Data from Garmin ActiveCaptain" attribution credit, published
  on every note as `properties.attribution` and corroborated by
  `properties.source`, `properties.plugin`, and `properties.pluginRepo`.
