# AI route drafting in crows-nest (server-side half)

Status: design, revised after a four-lens review (SignalK and crows-nest fit, OpenRouter and
structured outputs, ENC depth and safety honesty, and topology, contract, and completeness). For
sign-off. Local-only working note (docs/superpowers is not published).
Date: 2026-06-14. Author: design pass with Nearl Crews.

This is the server-side half of Binnacle's AI route drafting. The Binnacle (client) half is built and
on main, shipping dark, specified in the Binnacle repo at
`docs/superpowers/specs/2026-06-13-ai-route-drafting-design.md`. This spec supersedes that spec's
"companion (follow-on)" sketch, which assumed `signalk-openrouter-companion`. The server-side work
lands in `signalk-crows-nest`, because crows-nest already owns the NOAA ENC charted-feature domain (it
queries NOAA ENC Direct for wrecks, obstructions, and rocks today) and already pairs with Binnacle,
which renders its notes natively.

## Goal

Turn a plain-language passage request ("from here to Avalon, stay 3 nm off the coast") into a drafted
route the navigator reviews and saves, with a server-side safety check against NOAA ENC charted
depth-area contours and charted point hazards, and a deterministic fuel estimate. The model proposes;
owned code disposes.

## What this is honest about (read first)

The single most important limitation, stated first because the review flagged it as easy to
under-state:

- **The depth check reads the charted depth AREA contour, not the depth at every point.** A charted
  sounding, rock, or obstruction inside a depth area can be shallower than that area's shallow contour
  value (`DRVAL1`). So "this leg's charted depth area is deep enough" does NOT mean "every point on the
  leg is deep enough." The point-hazard scan (wrecks, rocks, and obstructions) partly compensates, but
  individual charted soundings (`SOUNDG`) are not read in v1. The check never claims to have verified
  the depth at the boat's track; it checks the area contour and the charted point hazards.

The rest:

- The route is a DRAFT. The navigator verifies every leg against the real charts in Binnacle and owns
  the save, the same standard any plotter holds a hand-drawn route to.
- The data is NOAA ENC Direct, which NOAA labels "not for navigation," is online only, and covers US
  waters only. It is a planning aid, not ECDIS.
- It does not model tide, squat, heel, the data-quality band (CATZOC), area or line hazards (only point
  hazards), or anything finer than the chart compilation scale. A shoal narrower than the leg sampling
  may not be flagged.
- The check needs connectivity, which is fine: drafting already needs connectivity for the LLM call,
  so the depth check adds no new offline constraint.

## Architecture and scope split

Three plugins, each with one job:

- **Binnacle** (webapp): the thin client. Renders the ENC, the draft, and crows-nest's hazard notes,
  owns the human-over-chart verification and the armed save. Calls one endpoint, gets waypoints plus
  flags.
- **signalk-crows-nest** (this spec): the NOAA ENC authority and the route-draft host. Gains the
  charted-depth query, a "check these legs" depth-and-hazard function, and an optional `route-draft`
  endpoint (the OpenRouter draft, the fuel math, and the vessel and fuel config). The AI piece is
  entirely opt-in: with no OpenRouter key, crows-nest behaves as today plus the new charted-depth
  capability, which is not AI.
- **signalk-openrouter-companion**: untouched. We LIFT its OpenRouter client and budget tracker into
  crows-nest rather than depend on it.

## Authorization (resolved: admin scope)

Verified against the signalk-server core (`tokensecurity.js`): the server registers
`app.use('/plugins', adminAuthenticationMiddleware(false))` at security startup, before any plugin
router runs. It prefix-matches every `/plugins/*` route and rejects a non-admin principal, so a
plugin-level `addWriteMiddleware` on a `/plugins/...` sub-path is shadowed and cannot grant a readwrite
token access. `writeAuthenticationMiddleware` (which admits admin or readwrite) applies only to
`/signalk/v1|v2/*`, which a plugin has no supported way to mount a custom route under.

Decision: the `route-draft` endpoint is **admin-scoped**, and that is appropriate, not a fallback.
Drafting spends the OpenRouter budget (real money) and is an owner-level planning action; the
openrouter-companion admin-gates its budget-spending routes for the same reason. On the common
single-owner boat the owner is the admin, so it just works. This was already silently true of the
shipped Binnacle feature.

Implications:
- The endpoint stays under `/plugins/signalk-crows-nest/api/route-draft`, admin-gated (the existing
  status route is already admin-gated, so no new gate work, just compose both onto one router).
- Binnacle detection (`/signalk/v2/features`) is read-scoped, so the Draft control shows for any
  authenticated user. Drafting itself succeeds only for an admin; a non-admin gets 403, which maps to
  `unauthorized` with a message worded "Drafting requires SignalK admin access," not "approve a write
  request." (Binnacle's current `unauthorized` message wording must change accordingly.)

## What crows-nest gains

### 1. Charted-depth and land query (extends the existing ENC Direct client)

`src/inputs/noaa-enc/enc-direct-client.ts` already queries NOAA ENC Direct per usage band with paging.
The existing model keys layers by a named `EncLayerKey` union (`'wreck' | 'obstruction' | 'rock'`) with
one numeric field per key in `LayerIds`, mapped per band in `LAYER_IDS_BY_BAND`. Extend it (this is a
typed change across six bands, not "add an id"):

- Extend `EncLayerKey` with `'depthArea'` and `'land'`. Add the two fields to `LayerIds`. Fill all six
  bands (overview, general, coastal, approach, harbour, berthing) with the real `Depth_Area` and
  `Land_Area` layer ids read from each band's MapServer metadata. The ids differ per band (verified
  live: `enc_coastal` `Depth_Area` is 166 and `Land_Area` 171; `enc_harbour` `Depth_Area` 227 and
  `Land_Area` 233), so do NOT assume they parallel the hazard ids. Lock them with the existing
  layer-id placeholder test, extended for the two new keys per band.
- The `Depth_Area` and `Land_Area` features are POLYGONS, so widen `EncFeature.geometry` (currently
  typed `Point` only) to a Point-or-Polygon union (or add an `EncAreaFeature`), so the rings type-check
  and a local point-in-polygon test has geometry to read.
- Decode `DRVAL1` (shallow range minimum, meters) and `DRVAL2` (deep range maximum, meters) in
  `s57-mapping.ts`, next to the existing decoders. Reuse `encDepthLabel` for the MLLW datum tag.
- **Negative `DRVAL1` is a drying height, not a water depth.** Intertidal areas encode `DRVAL1 < 0`
  (drying H meters above datum). The check classifies these as `land` (effectively land at low water)
  with a message "charted as drying (dries to N.N m above MLLW)," never as a negative water depth.

These depth and land areas are an internal capability for the leg check, NOT published as notes. The
existing hazard layers stay POIs as today.

### 2. The "check these legs" depth-and-hazard function (pure, fully tested)

Given the draft's ordered turning waypoints, the vessel draft, and a safety margin, it returns per-leg
flags. It samples each leg by SEGMENT INTERSECTION, not bare point probes, so a shoal thinner than the
sample spacing cannot hide between samples and so each leg costs one bounded query per layer:

- For each leg, query `Depth_Area` and `Land_Area` once with the leg's bounding box (capped to the
  draft's extent), then test which returned polygons the leg segment actually crosses (a local
  segment-vs-polygon test on the returned rings). This is one bbox query per leg per layer, never one
  query per sample. Densify only to evaluate which polygon a crossing falls in and to place the flag.
- **The densifier is NEW code, not a reuse.** `geo/position-utilities.ts` has no along-leg
  interpolator, and its helpers (`distanceMeters`, `initialBearingRad`, `projectPointOntoLeg`) are
  great-circle, not rhumb-line. Binnacle draws and measures RHUMB lines, so add a loxodromic
  interpolate-along-leg helper to `position-utilities.ts` so the sampled path matches Binnacle's
  editor. Default sample spacing is 0.5 nm; it is the check's internal spacing, not user config.
- **Depth (shallow flag):** flag the leg `shallow` when the crossed depth area's `DRVAL1` is less than
  `draft + safetyMargin` (the minimal safety contour). The message states the charted depth, the
  datum, and the usage band used, never a bare verdict.
- **Best band:** prefer the finest band that HAS a covering depth area, and where bands overlap take
  the SHALLOWER (more conservative) `DRVAL1`, not the finest band's value alone (coarse-band contours
  are generalized and can read deeper). State the band in the message.
- **No coverage is an explicit flag, never a silent pass.** A leg crossing water that is in neither a
  navigable `Depth_Area` nor `Land_Area` (an unsurveyed gap, or a band with no coverage there) yields
  an `other` flag worded "no charted depth area here, verify on the chart." Degrading to silence would
  read as "probably fine."
- **Land flag:** `Land_Area` crossing yields `land`. Drying areas (negative `DRVAL1`) also yield `land`
  per section 1.
- **Hazards:** reuse the corridor geometry (`outputs/route-hazard/route-corridor.ts`,
  `scanRouteCorridor`, `projectPointOntoLeg`) over the ENC POINT hazard POIs (wrecks, rocks, and
  obstructions) within a configurable cross-track corridor; flag `hazard` with the category and any
  least-depth label. Area and line hazards (`Wreck_area`, `Obstruction_line`, `Obstruction_area`) are
  NOT queried in v1, so the banner says "point hazards," not "all hazards."
- **Standoff check (owned code):** flag a leg whose nearest `Land_Area` approach is under the
  configured `standoffNm` (`other` or a `standoff` message). Tacking sailability stays a model-side
  prompt input in v1, stated as advisory, not enforced.

Outside US waters (the existing `isInUsWaters` gate) or when ENC Direct is unreachable, the function
returns "depth and hazards unavailable" and the draft still returns with whatever was computed, plus a
clear note, the detect-and-degrade posture crows-nest uses elsewhere.

### 3. The route-draft module (the only genuinely new shape)

A new self-contained module (for example `src/route-draft/`), registered in `src/index.ts` AND wired
into the schema assembly and the start/stop lifecycle in `src/plugin/plugin.ts` (it is a third module
kind, neither a POI input nor a POI output, so it does not flow through the input/output registries).
Gated entirely on the OpenRouter key.

- **OpenRouter client (lifted, then extended):** lifted from
  `signalk-openrouter-companion/src/core/openrouter.ts` and `budget.ts`, restyled to crows-nest
  conventions (neostandard, no semicolons, `.js` import specifiers for node16, `app.debug`/`app.error`
  string logging, not the companion's logger), and built on `fetch` plus `AbortSignal.timeout` (NOT
  `http-one-shot.ts`, which is GET-only; mirror `http-client.ts`'s fetch use). Fix the attribution
  header to `X-Title` while lifting (the companion sends `X-OpenRouter-Title`, which OpenRouter
  ignores).
- **The lift is a request-construction and response-parsing change, not an addition.** The companion's
  client hardcodes the body (`model`, `max_tokens`, `messages`) and reads only the content text.
  Extend `CompleteArgs` with optional `responseFormat`, `models` (the fallback array, sent instead of
  `model`), `provider`, and `maxTokens`, threaded into the body only when present, keeping the existing
  single-`model` path so the lift never regresses the companion's callers. Extend `CompleteResult` to
  surface `finishReason`, `usage.cost`, and `prompt_tokens_details.cached_tokens`.
- **Structured outputs:** `response_format: { type: "json_schema", json_schema: { name, strict: true,
  schema } }` with `additionalProperties: false`, and `provider: { require_parameters: true }` so an
  incapable provider errors rather than returning prose. The schema's `maxItems` and `maxLength` are
  documentation only (OpenRouter does NOT enforce them), so the response is clamped in code after
  parsing (truncate waypoints, drop out-of-range coordinates, drop unknown flag kinds). The structural
  guarantee (types, required, additionalProperties) IS enforced.
- **finish_reason is the missing signal.** Inspect `choices[0].finish_reason`: `length` (truncated,
  often invalid JSON) and `content_filter`/`error` are terminal `model-error`, not a usable draft. A
  status-200 "empty completion" is also `model-error` explicitly, never an empty route. Size
  `max_tokens` against the worst-case schema-conformant output (a 25-waypoint draft with names, a
  note, and per-leg messages), so a normal draft does not hit the `length` ceiling.
- **Model:** default `google/gemini-2.5-flash`, with `google/gemini-2.5-flash-lite` as the second
  entry in the `models` array. Both support strict structured outputs (verified), which is the real
  guarantee; OpenRouter does not document that `require_parameters` filters per-array-entry, so the
  in-code clamp is the backstop. `require_parameters` filters the provider pool first, so a fallback
  stays within capable providers; log `usage.model` to catch a silent drop to the weaker model.
  `temperature: 0.2`.
- **The model proposes only turning waypoints.** Code densifies, runs the section-2 check, SETS the
  `land`, `shallow`, and `hazard` flags from the ENC geometry overwriting anything the model guessed,
  and computes distance and fuel. The model phrasing lands only in `note`.

### 4. Config (an OpenRouter section and a Route-drafting section)

Config-schema fragments wired into `assemblePluginSchema([...])` in `plugin.ts` (the route-draft
module's fragment is added explicitly there, since it is not an input or output), rendered in the panel
with the existing primitives (`ToggleFieldset`, `NumberField`, `LengthField`, `SegmentedControl`). The
fragment's top-level keys must not collide with existing module keys (the assembler throws on
duplicates), so namespace them clearly (`routeDraftEnabled`, `routeDraftOpenRouterApiKey`, and so on).

- **OpenRouter**: `routeDraftEnabled`, the API key (a MASKED panel input, since it is stored plaintext
  at rest in the plugin config), `routeDraftModel` (default the slug above), and a daily
  `routeDraftMaxCallsPerDay` budget.
- **Vessel**: `propulsion` (Sail, Power, or Motorsail, a `SegmentedControl`), `draftM` (`LengthField`),
  `safetyMarginM`, and `tackingAngleDeg`. Config is the primary source; `design.draft.value.maximum`
  (meters, via `getSelfPath`) is read only as an opportunistic fallback (commonly unpopulated).
- **Fuel**: `cruiseSpeedKn`, `burnAtCruise` (per the unit setting), and `reservePercent`. The plugin
  reads `tanks.fuel.<id>` summed across tanks (`currentVolume` m^3, else `capacity` m^3 times
  `currentLevel` 0..1), converting at the edge. It derives nm-per-unit from cruise over burn, computes
  fuel for the drafted distance, and reports the margin, never a bare boolean. Honesty: the head-sea
  derate is a single flat assumption, stated in `derateNote` as such; for a sailing vessel the plugin
  does NOT silently assume a motoring fraction, it either takes one from config or reports "fuel not
  estimated for sail unless a motoring fraction is given." Fuel never produces a `marginPct` worded as
  a guarantee.
- **Routing defaults**: `standoffNm` (the offing, checked in owned code per section 2) and `maxLegNm`
  (the threshold above which the prompt asks the MODEL to add a turning waypoint; this is distinct from
  the internal 0.5 nm sample spacing, which is not config).

## The contract (Binnacle to crows-nest)

Request unchanged from the Binnacle spec:

```
POST /plugins/signalk-crows-nest/api/route-draft     (Bearer = Signal K session token, ADMIN scope)
{ prompt, from: { latitude, longitude }, bounds: [west, south, east, north], units: "metric" | "imperial" }
```

Response, an `{ ok: true }`-discriminated body. The response carries only the model's TURNING
waypoints (the densified samples are internal to the check and not returned). The flag vocabulary gains
`shallow` (real `DRVAL1`) and `hazard` (charted point hazards), replacing the old coarse
`deep-water-only`; `confidence` is retained because the shipped client reads it:

```
{ ok: true,
  waypoints:    [ { latitude, longitude, name? } ],   // turning points only, not the dense samples
  destination?: { name },
  name?:        string,
  note:         string,
  confidence?:  "high" | "low",
  fuel?:        { neededL, aboardL?, marginPct?, derateNote? },
  flags?:       [ { wp?, leg?, kind: "land" | "shallow" | "hazard" | "fuel" | "other", message } ] }
```

```
{ ok: false, error: "budget" | "no-route" | "model-error" | "unauthorized" | "bad-request", message }
```

The client synthesizes `timeout` and `unreachable`.

Error mapping (verified against current OpenRouter docs):
- The local daily-call refusal returns `budget` BEFORE the call.
- OpenRouter 402 (insufficient credits) is distinct from the local budget refusal and maps to
  `model-error` (the remedy is to top up credits, not wait for tomorrow), with a distinguishing message.
- 401 and a permission 403 map to `unauthorized`; a moderation or guardrail 403 maps to `model-error`.
- A server 408 maps to `timeout` (same user-facing condition as the client-synthesized timeout).
- 503 ("no provider meets routing requirements," the `require_parameters` shortfall) is transient: the
  lifted client already retries it honoring `Retry-After`, and after retries exhaust it maps to
  `model-error` with a transient-flavored message.
- A status-200 empty or refused completion, and a `length`/`content_filter` `finish_reason`, map to
  `model-error`.

## Response-time budget

The shipped Binnacle client hard-times-out at 25 seconds (`DRAFT_TIMEOUT_MS`). The server now does an
LLM round trip PLUS one bbox `Depth_Area` and `Land_Area` query per leg PLUS the corridor hazard scan,
all against ENC Direct. To avoid a successfully-drafted-but-discarded route:
- Run the ENC depth, land, and hazard checks CONCURRENTLY (bounded), after the LLM returns, with a hard
  cap on legs and queries per draft.
- Set a server-side time budget well under 25 seconds for the check. If the check overruns its budget,
  return the LLM route with `flags: [{ kind: "other", message: "depth and hazards not checked: timed
  out" }]` rather than failing the whole draft.

## Model, prompt, and cost control

- System prompt (stable prefix, so Gemini caching can engage): role and task, the output contract in
  prose, unit discipline (decimal degrees, SI unless noted), and standing marine guidance (prefer open
  water, round headlands with offing, respect point-of-sail basics, emit explicit tack waypoints rather
  than one unsailable upwind leg).
- User prompt (tight, variable content strictly after the stable system prompt): the position and
  bounds, the nearest-N from the SignalK resources API (the `waypoints` resource and, usefully,
  crows-nest's own published ENC hazard `notes`), capped, the propulsion and cruise speed, the request
  verbatim. A wind and tide summary is included ONLY when crows-nest can read it opportunistically from
  the SignalK `environment.*` deltas; crows-nest is not a weather provider, so when that data is absent
  the summary is simply omitted, not fetched.
- Cost: `max_tokens` bounds output, nearest-N and the bbox bound input, the daily CALL cap refuses with
  `budget` when exhausted. Be honest about the cap: it bounds the number of calls per day, not dollars.
  At roughly $0.001 to $0.003 per draft on flash, with a worst case several times that if input and
  output are large, the cap of N calls per day bounds spend to roughly N times the worst case. Caching
  is opportunistic (it only helps repeated drafts within the cache TTL, which an intermittent drafting
  tool rarely hits), so it is not modeled into the baseline cost; `usage.cost` and
  `cached_tokens` are parsed and logged so real spend is observable and tunable from data.

## Binnacle-side changes (small, on the dark feature)

Verified against the shipped client on main. More than "repoint two constants":
- Repoint the path to `/plugins/signalk-crows-nest/api/route-draft` and the detected plugin id to
  `signalk-crows-nest`, set the version floor to the crows-nest release that ships the endpoint, and
  rename the `OPENROUTER_COMPANION_*` constants. This breaks the by-name re-exports in
  `src/features/routing/index.ts`, which must be updated too.
- Swap `deep-water-only` for `shallow` and add `hazard` in the `DraftFlag` kind union
  (`route-draft-client.ts`), the `FLAG_ORDER` (`draft-format.ts`: land, shallow, hazard, fuel, then
  other), the `FLAG_KINDS` validation set, and the draft-format and client tests that assert the old
  kind.
- Update `DRAFT_ERROR_MESSAGES` in `src/app/App.svelte`: the `budget` and `unreachable` messages name
  "the companion plugin" and "the AI companion," which read wrong after the repoint, and the
  `unauthorized` message must say drafting requires SignalK admin access, not "approve a write request."
- Rewrite the not-chart-verified banner in `RoutesPanel.svelte`: word it precisely as "checks the NOAA
  ENC charted depth-area contour, charted land, and charted point hazards (wrecks, rocks, and
  obstructions) along each leg," keeping "advisory, US-only, online, not a substitute for verifying on
  the chart, and a charted area can still contain shoaler soundings this does not read." Refresh the
  now-stale `route-draft-client.ts` and `draft-format.ts` comments that mention the companion and coarse
  bathymetry.

Detection stays the version-floor gate; a crows-nest present but with no OpenRouter key returns
`unauthorized` ("configure the OpenRouter key in crows-nest"), and a non-admin user gets `unauthorized`
("drafting requires SignalK admin access").

## Build order

1. The charted-depth and land query: extend `EncLayerKey`, `LayerIds`, `LAYER_IDS_BY_BAND` (all six
   bands, real ids, locked by the layer-id test), widen `EncFeature.geometry` to polygons, decode
   `DRVAL1`/`DRVAL2` with the negative-drying branch, and a `depthAt` that selects the containing
   polygon (the existing client returns all bbox-intersecting areas, so pick the containing one by
   local point-in-polygon, or add an `esriGeometryPoint` within-query path).
2. The "check these legs" function: the new rhumb-line densifier, the segment-intersection depth and
   land test, the best-band conservative selection, the no-coverage flag, the standoff check, and the
   corridor hazard scan, returning the flag set. Pure, fully unit-tested.
3. The OpenRouter client lift plus the request-and-response extension (structured outputs,
   `finish_reason`, `cost`, `cached_tokens`, the `X-Title` fix) and the budget tracker, on `fetch`.
4. The route-draft module: prompt, schema, parse and clamp, the section-2 check, the fuel and distance
   math, the contract response, the response-time budget, the complete error map. Compose its router
   with the status router onto one `registerWithRouter`, and document the endpoint in `getOpenApi()`.
   Detect-and-degrade when ENC Direct or the key is absent.
5. The config fragments (wired into `assemblePluginSchema` in plugin.ts) and the panel section, with a
   masked key field.
6. The Binnacle-side repoint, flag taxonomy, error messages, comments, and banner update; verify the
   dark feature lights up against a crows-nest that ships the endpoint.
7. Release crows-nest (the version that ships the endpoint), then a Binnacle release that sets the
   floor to it.

## Testing (node:test via tsx, matching the repo)

- The depth query: `Depth_Area` and `Land_Area` request building, the six-band layer-id map (locked),
  `DRVAL1`/`DRVAL2` decoding including the negative-drying case, polygon geometry parsing, and the
  `depthAt` containing-polygon and best-band selection.
- The "check these legs" function: rhumb densification, the segment-intersection shallow flag against a
  synthetic depth area, the drying-as-land branch, the no-coverage flag, the land flag, the standoff
  flag, the corridor hazard flag, and the out-of-US and unreachable degrade.
- The OpenRouter client: the structured-output request shape (`response_format`, `models`, `provider`,
  `require_parameters`), `finish_reason` of `length` and `content_filter` mapping to `model-error`, the
  parse and clamp of a good and a malformed body, each error code, and the budget refusal.
- The route-draft handler: the admin-gate registration and OpenAPI doc, the contract response, the
  no-key and non-admin `unauthorized` paths, the response-time-budget degrade, and that the model's
  flags are overwritten by the geometry.

## Out of scope (future, separate)

- An offline S-57 engine (bundled cells plus WASM GDAL) for real-time anti-grounding while underway and
  offline. A bigger, separate project; route-drafting does not need it.
- Reading individual charted soundings (`SOUNDG`), area and line hazards, tide-corrected under-keel
  clearance, squat, heel, and CATZOC weighting: the refinements past the depth-area-contour-plus-point-
  hazard model.
- A readwrite (non-admin) endpoint: not supported for a custom plugin route, and route-drafting is an
  owner-level budget-spending action anyway.
- Non-US ENC (other hydrographic offices) and S-101.
- Voice input, multi-turn refinement, weather routing, and learned fuel burn.
