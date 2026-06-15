# Route-draft API: a guide for an LLM or client integrator

This document explains how to use the AI route-draft endpoint that
`signalk-crows-nest` exposes. The audience is another LLM, or an engineer
writing a client (such as Binnacle) that calls the endpoint. It is a contract
and behavior reference, not a tutorial on the plugin internals.

## What the endpoint does

`POST /api/route-draft` turns a plain-language passage request into a drafted
route. The plugin asks an LLM (through OpenRouter) for the passage's turning
waypoints, then, in owned deterministic code, checks every leg against marine
data and computes a fuel estimate. The model proposes; the plugin disposes. Every
safety flag and every number in the response is decided by the plugin, never by
the model.

The result is always a DRAFT to verify on the chart before saving. It is not a
sanctioned route and it is not a guarantee of safe water.

## Prerequisites

- The endpoint is admin-gated. The SignalK server must have security (access
  control) enabled, and the caller must be an authenticated administrator with
  same-origin credentials. If the server has no access control, or the caller is
  not an admin, the route is not mounted and the feature is unavailable. This is
  deliberate: drafting spends the OpenRouter budget, which is an owner-level
  action.
- An OpenRouter API key must be configured in the plugin (the "Route drafting"
  section of the plugin's admin panel). The feature is off until the key is set.
- The worldwide safety checks are fully automatic. There is no per-source toggle
  to enable; the plugin queries whichever providers cover each leg.
- A per-UTC-day call budget bounds how many drafts can be requested. When it is
  spent, the endpoint returns the `budget` error (see below) until the next day.

## Request

`POST /api/route-draft` with a JSON body:

```json
{
  "prompt": "Take me from Boston Harbor to Provincetown, staying well off the shoals.",
  "from": { "latitude": 42.35, "longitude": -71.04 },
  "bounds": [-71.2, 41.9, -69.9, 42.5],
  "units": "imperial"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `prompt` | string | The plain-language passage request. Required and non-blank when drafting from words; optional, a one-line steering hint, when `route` is given. |
| `from` | `{ latitude, longitude }`, required | The vessel's current position, decimal degrees. For a draft it is used as the start only when the prompt names no starting point, or asks to start from the current location ("from here", "from me"); a prompt that names a start begins there. For an optimize the start is the drawn route's first waypoint. |
| `bounds` | `[west, south, east, north]`, required | The visible chart window, decimal degrees, four finite numbers. The model is told to keep waypoints inside this window, and a waypoint far outside it is dropped as a hallucination. The window may cross the antimeridian (west greater than east). A window wider than 120 degrees on either edge (antimeridian-aware for longitude) is rejected, so send a real viewport, not a hemisphere. |
| `units` | `"metric"` or `"imperial"` | Units for any prose the model writes. Anything other than `"imperial"` is treated as `"metric"`. Coordinates are always decimal degrees and stored values are SI regardless. |
| `route` | `[{ latitude, longitude }, ...]`, optional | The navigator's drawn route to OPTIMIZE, ordered turning points, coordinates only (no names). Its presence makes the request an optimize: the plugin refines this polyline rather than drafting from the prompt alone. Two to 25 waypoints; a non-array, an invalid coordinate, fewer than two, or more than 25 is rejected as `bad-request` before any model call. |

### The optimize variant

When `route` is present the endpoint optimizes that drawn route instead of drafting
from scratch. It keeps the drawn start and destination (the plugin anchors the
first and last returned waypoints to the exact drawn coordinates after the model
replies, keeping the model's names), uses a lower sampling temperature, and treats
`prompt` as an optional one-line hint. The response is the same shape plus the
`optimized` marker below. Everything else, the worldwide per-leg safety check, the
flags, the fuel estimate, the five-case error vocabulary, and the per-UTC-day call
budget, is identical to a draft.

## Response: success

HTTP 200 with `ok: true`:

```json
{
  "ok": true,
  "waypoints": [
    { "latitude": 42.35, "longitude": -71.04, "name": "Boston Harbor entrance" },
    { "latitude": 42.34, "longitude": -70.65 },
    { "latitude": 42.05, "longitude": -70.18, "name": "Provincetown approach" }
  ],
  "destination": { "name": "Provincetown" },
  "name": "Boston to Provincetown",
  "note": "Rounds Race Point with offing; one turn to clear the shoals.",
  "confidence": "high",
  "fuel": { "neededL": 38.2, "aboardL": 120, "marginPct": 60.2, "derateNote": "..." },
  "flags": [
    { "leg": 1, "kind": "shallow", "message": "Charted depth area DRVAL1 is 3.0 m, MLLW, Coastal band, under the 3.5 m draft-plus-margin contour" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `waypoints` | The ordered turning waypoints, each `{ latitude, longitude, name? }`, decimal degrees. These are TURNING points only; a client densifies between them for display. At least two. |
| `destination` | Optional `{ name }` for the passage destination. |
| `name` | Optional suggested route name. |
| `note` | The model's brief rationale for the route. Prose only, never a safety verdict. |
| `confidence` | Optional `"high"` or `"low"`, the model's own confidence. Treat `"low"` as a stronger prompt to verify. |
| `fuel` | Optional fuel estimate (see below). Omitted when no honest estimate is possible. |
| `flags` | Optional array of per-leg and route-level safety flags (see below). Omitted when there are none. |
| `optimized` | Present and `true` only when the request carried a `route` and the plugin consumed it. A client that sent a `route` should assert this to detect an older build that ignored the field and drafted from scratch; it is absent on a from-scratch draft. |

### The fuel object

When present, `fuel` is `{ neededL, aboardL?, marginPct?, derateNote }`:

- `neededL`: liters of fuel the passage needs at the configured cruise speed and
  burn, including a flat head-sea derate.
- `aboardL`: liters aboard, read from the vessel's fuel tanks, when available.
- `marginPct`: the percentage margin of fuel aboard over fuel needed, after the
  configured reserve, when both are known.
- `derateNote`: a short honest note about the derate assumption.

`fuel` is omitted entirely when no honest estimate can be made (for example a
sailing vessel with no motoring burn configured, or a zero cruise speed). Do not
fabricate a fuel figure when it is absent.

## Response: errors

HTTP non-200 (or 200 for `budget` and `no-route`) with `ok: false`, an `error`
code, and a human `message`. There are exactly five error codes:

| `error` | Meaning | What to tell the operator |
| --- | --- | --- |
| `bad-request` | The request body was invalid (missing prompt, bad coordinates, malformed or too-large bounds). | Fix the request. The `message` says what is wrong. |
| `budget` | The daily drafting budget is used up. | Try again tomorrow, or raise the cap in the plugin. |
| `no-route` | The model could not draft a usable route for that prompt. | Rephrase, or try a shorter passage. |
| `model-error` | The OpenRouter call failed (a bad or empty completion, an out-of-credits account, a moderation block, a transport fault, or a provider error). | The `message` names the cause. An administrator may need to check the key or the OpenRouter account. |
| `unauthorized` | OpenRouter rejected the configured API key. | An administrator must fix the key in the plugin. |

Always read and surface the `message`; it is written for an operator to act on.

## The safety flags: the most important part

`flags` is the deterministic safety check's output. Each flag is
`{ leg?, wp?, kind, message }`:

- `leg`: the zero-based index of the leg (the waypoint pair) the flag falls on,
  when the flag is leg-scoped. Route-level flags (the collapsed depth note and
  the EMODnet awareness note) omit `leg`.
- `wp`: the index of the waypoint a flag falls on, when waypoint-scoped.
- `kind`: one of `"land"`, `"shallow"`, `"hazard"`, or `"other"`.
- `message`: a human-readable string that always states the charted or modeled
  value and its datum, never a bare verdict.

Flags arrive ordered most-safety-critical first: `land`, then `shallow`, then
`hazard`, then `other`.

### The honesty contract (do not break it when you present the result)

The single most important property: a route is NEVER silently passed. For every
leg and every dimension (depth, land, hazards), the result either states what was
checked and its value, or carries an explicit "not checked" flag. The ABSENCE of
a `shallow`, `land`, or `hazard` flag is not a statement that the leg is safe; it
means only that the available data did not raise that specific flag within the
stated caveat. Coverage is patchy (OpenStreetMap) or modeled (EMODnet), so a
client must present the drafted route as something to verify on the chart, and
must surface the flags rather than hide them or summarize them away.

Do not, for example, tell the operator "this route is safe" or "no hazards
found." Say "the check raised these flags; verify the route on the chart."

### What each flag kind means

- `land`: a leg crosses charted land (ENC), an area charted as drying, or the
  OpenStreetMap coastline. The message names the source. A coastline crossing is
  a strong warning, and its message also notes that absence of a crossing is not
  proof of clear water.
- `shallow`: a leg's charted or modeled shallowest depth is under the vessel
  draft plus the safety margin. The message states the value and the datum: ENC
  reads MLLW and is charted, EMODnet reads LAT and is modeled and explicitly not
  charted.
- `hazard`: a charted point hazard (wreck, rock, or obstruction) lies in the
  corridor along a leg. The message names the source (ENC charted, or
  OpenStreetMap-charted).
- `other`: everything else, including standoff warnings (a leg passes closer to
  land than the configured offing), explicit not-checked notes, the route-level
  collapsed depth-not-checked note, and the route-level EMODnet awareness note.

### Datum matters

Depth flags carry their vertical datum because the two depth sources differ:

- ENC depth is referenced to Mean Lower Low Water (MLLW) and is charted,
  authoritative US data.
- EMODnet depth is referenced to Lowest Astronomical Tide (LAT) and is modeled,
  awareness-grade bathymetry, not a navigational chart. An EMODnet-checked route
  carries a single route-level note saying so. Treat EMODnet depth as awareness
  only.

Never present a depth without its datum and source qualifier.

## Coverage by region

The check resolves data providers per leg by the union of every provider whose
coverage envelope reaches that leg:

| Region | Depth | Land | Point hazards |
| --- | --- | --- | --- |
| US waters | ENC charted (MLLW), authoritative | ENC charted land | ENC charted wrecks, rocks, and obstructions |
| European seas | EMODnet modeled (LAT), awareness-grade | OpenStreetMap coastline | OpenStreetMap seamarks |
| Elsewhere | not checked (explicit flag) | OpenStreetMap coastline | OpenStreetMap seamarks |

Where ENC and OpenSeaMap both cover a leg, hazards reported by both are merged so
the same feature is flagged once, with ENC preferred. Depth outside US and
European waters has no free authoritative or modeled source, so it is always an
explicit "not checked," never a silent pass.

## A minimal client flow

1. Confirm the operator is an authenticated admin and the plugin has an OpenRouter
   key configured (otherwise the endpoint is absent).
2. Send the prompt, the vessel position, the visible chart bounds, and the units.
3. On `ok: false`, show the `message` and stop.
4. On `ok: true`, render the waypoints as a draft route the operator must review.
5. Show the `flags` prominently, in the order received, with their full messages.
   Do not collapse them into a single "safe" or "unsafe" verdict.
6. Show the `fuel` estimate when present, with its derate note. Omit it when
   absent rather than inventing one.
7. Always label the route a draft to verify on the chart.

## Related

- The notes-resource integration format (how POIs are published) is documented
  in `notes-resource-format.md`.
- The design and the per-region rationale are in
  `superpowers/specs/2026-06-14-worldwide-route-draft-check-design.md`.
