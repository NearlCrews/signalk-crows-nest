# Multi-source POI Inputs and the OpenSeaMap Input: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is executed by an
> agent team (up to 6 teammates). Steps use checkbox (`- [ ]`) syntax for
> tracking. Teammates coordinate edits to the shared files (`src/index.ts`,
> `src/plugin/plugin.ts`, `src/shared/types.ts`, `note-builder.ts`) through the
> shared task list.

**Goal:** Extend `signalk-crows-nest` from one POI source to a multi-source
plugin, and add OpenSeaMap (via the OSM Overpass API) as the second source,
without cluttering the configuration panel.

**Architecture:** A namespaced-id aggregate `PoiSource` merges every enabled
input; `getDetails` returns a normalized, pre-rendered `PoiDetailView` so the
`notes` output is source-agnostic; the panel becomes a per-source accordion;
status goes per-source.

**Tech Stack:** TypeScript 6, `tsc` + webpack, ESLint 9 + neostandard,
`node:test` via `tsx`, Node 20.3+, the OSM Overpass API.

**Spec:** `docs/superpowers/specs/2026-05-22-multi-source-inputs-openseamap-design.md`

---

## Conventions for every task

- Gate: `npm run typecheck && npm run lint && npm test && npm run build` must
  all be green before a task is done. Every commit is green.
- American English, no em dashes, the Oxford comma, in all code, comments,
  and commit messages.
- Test files import source modules with the `.js` extension.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Commit locally only; no push, no PR.
- The suite is 295 tests at the start; it must never go red.

## Team lanes

- **Lane A (foundation)** - Phase 1: shared types, the aggregate registry,
  note-builder, the attribution helper. Anchor; runs first.
- **Lane B (notifications)** - Phase 2: the `activecaptain` to `crowsNest`
  notification-path rename.
- **Lane C (status)** - Phase 3: per-source `StatusSnapshot` and `StatusBar`.
- **Lane D (OpenSeaMap)** - Phase 4: the `src/inputs/openseamap/` module.
- **Lane E (panel)** - Phase 5: the accordion panel rework.
- **Lane F (integration)** - Phase 6: wiring, docs, the final sweep.

Phase 1 runs first and alone. Phases 2, 3, and 4 run in parallel after Phase 1.
Phase 5 runs after Phase 1 (it only needs the config shape). Phase 6 integrates
last.

---

# Phase 1: Multi-source foundation (Lane A)

### Task 1.1: Add the normalized detail and summary types

`PoiSource.getDetails` currently returns the ActiveCaptain-shaped `PoiDetails`,
which cannot represent an OpenSeaMap POI. Introduce a normalized view that
every source produces, so the `notes` output is source-agnostic.

**Files:**
- Modify: `src/shared/types.ts`
- Test: none (type-only).

- [ ] **Step 1: Add `PoiDetailView` and extend `PoiSummary` in `src/shared/types.ts`**

Add a normalized detail view, and add `source` and `url` to `PoiSummary`:

```typescript
/**
 * A source-agnostic, fully rendered point-of-interest detail view. Every
 * `PoiSource.getDetails` returns this shape: the source has already rendered
 * its own detail HTML (with an attribution footer), so the `notes` output
 * builds a note from this without knowing which source produced it.
 */
export interface PoiDetailView {
  /** Display name. */
  name: string
  /** Map position. */
  position: Position
  /** POI type, used for the note `skIcon`. */
  type: PoiType
  /** Public web page for this POI (source-specific). */
  url: string
  /** Source slug, e.g. `activecaptain` or `openseamap`. */
  source: string
  /** Human-readable attribution credit for the source. */
  attribution: string
  /** Rendered HTML description, including the attribution footer. Omitted when none. */
  description?: string
  /** ISO-8601 UTC last-modified time, omitted when unknown. */
  timestamp?: string
}
```

In the existing `PoiSummary` interface add three fields:

```typescript
  /** Source slug that produced this entry, e.g. `activecaptain`. */
  source: string
  /** Public web page for this POI (source-specific). */
  url: string
  /** Human-readable attribution credit for the source. */
  attribution: string
```

- [ ] **Step 2: Verify typecheck fails meaningfully and commit**

Run `npm run typecheck`. It will report errors where `PoiSummary` is
constructed without `source`/`url` and where `getDetails` returns `PoiDetails`.
That is expected; those call sites are fixed in Tasks 1.3, 1.4, and 4.x. Do NOT
commit a red typecheck: instead, complete Task 1.2 and 1.3 before the first
commit of Phase 1, then commit them together.

### Task 1.2: Change the `PoiSource.getDetails` contract

**Files:**
- Modify: `src/inputs/poi-source.ts`

- [ ] **Step 1: Update the `getDetails` signature**

In `src/inputs/poi-source.ts`, change the `PoiSource.getDetails` return type
from `Promise<PoiDetails>` to `Promise<PoiDetailView>`, update the import to
pull `PoiDetailView` from `../shared/types.js`, and update the doc comment to
say it returns a fully rendered, source-agnostic detail view.

### Task 1.3: Make the ActiveCaptain source produce the normalized view

The ActiveCaptain source must now render its own detail and return a
`PoiDetailView`, and tag its `PoiSummary`s with `source` and `url`.

**Files:**
- Modify: `src/inputs/active-captain/active-captain-source.ts`
- Modify: `src/inputs/active-captain/active-captain-input.ts` (if it builds summaries)
- Test: `test/active-captain-source.test.ts`

- [ ] **Step 1: Add the ActiveCaptain constants**

In `active-captain-source.ts` add the source slug and the POI page URL prefix
(moved here from `note-builder.ts`):

```typescript
const ACTIVE_CAPTAIN_ATTRIBUTION = 'Data from Garmin ActiveCaptain'
const POI_PAGE_URL_PREFIX = 'https://activecaptain.garmin.com/en-US/pois/'
```

- [ ] **Step 2: Render detail inside `getDetails`**

`getDetails` currently returns `cache.get(id)` (a `PoiDetails`). Change it to:
fetch the `PoiDetails` from the cache, then build a `PoiDetailView` from it,
doing the rendering the `notes` output used to do (move `renderDescription`
and `parseApiDate` usage here from `notes-resource-output.ts`):

```typescript
getDetails: async (id: string): Promise<PoiDetailView> => {
  const entity = await cache.get(id)
  const poi = entity.pointOfInterest
  let description: string | undefined
  try {
    description = appendAttribution(renderDescription(entity), ACTIVE_CAPTAIN_ATTRIBUTION)
  } catch (error) {
    app.debug(`Unable to format description for ${id}: ${String(error)}`)
  }
  const modified = parseApiDate(poi.dateLastModified)
  return {
    name: poi.name,
    position: { ...poi.mapLocation },
    type: poi.poiType,
    url: `${POI_PAGE_URL_PREFIX}${id}`,
    source: ACTIVE_CAPTAIN_SOURCE_ID,
    attribution: ACTIVE_CAPTAIN_ATTRIBUTION,
    ...(description !== undefined && { description }),
    ...(Number.isFinite(modified.getTime()) && { timestamp: modified.toISOString() })
  }
}
```

`appendAttribution` is the shared helper from Task 1.6. Import
`renderDescription` and `parseApiDate` from `./poi-detail-renderer.js`.

- [ ] **Step 3: Tag list summaries with `source` and `url`**

Wherever the ActiveCaptain source produces `PoiSummary[]` (the `listPointsOfInterest`
path, via the client), set `source: ACTIVE_CAPTAIN_SOURCE_ID` and
`url: \`${POI_PAGE_URL_PREFIX}${entity.id}\`` on each summary. If the client
builds the summaries, add the two fields in `active-captain-client.ts`'s list
`.map`; pass the source slug in or set it in the source adapter by mapping
over the client's result.

- [ ] **Step 4: Update `test/active-captain-source.test.ts`**

Update the existing tests so `getDetails` is asserted to return a
`PoiDetailView` (check `name`, `type`, `url`, `source`, and that `description`
contains the attribution string). Keep the cache, 404, and abort tests.

- [ ] **Step 5: Verify and commit Tasks 1.1, 1.2, 1.3 together**

Run `npm run typecheck && npm run lint && npm test`. The notes-output will
still fail to compile until Task 1.4; if so, do Task 1.4 before committing and
commit 1.1 to 1.4 together as one green commit.

```bash
git add -A && git commit -m "feat: normalized PoiDetailView and source-tagged summaries"
```

### Task 1.4: Make the notes output source-agnostic

**Files:**
- Modify: `src/outputs/notes-resource/note-builder.ts`
- Modify: `src/outputs/notes-resource/notes-resource-output.ts`
- Test: `test/note-builder.test.ts`, `test/notes-resource-output.test.ts`

- [ ] **Step 1: Rework `note-builder.ts`**

Remove `POI_PAGE_URL_PREFIX` (it moved to the ActiveCaptain source). Change
`buildNoteResource` to take `url`, `source`, and `attribution` explicitly and
put `source` and `attribution` into `properties`:

```typescript
export function buildNoteResource (
  id: string,
  name: string,
  position: Position,
  skIcon: string,
  url: string,
  source: string,
  attribution: string,
  timestamp?: string,
  description?: string
): Record<string, unknown> {
  const note: Record<string, unknown> = {
    name,
    position,
    url,
    properties: { readOnly: true, skIcon, source, attribution },
    $source: PLUGIN_ID
  }
  if (timestamp !== undefined) note.timestamp = timestamp
  if (description !== undefined) {
    note.description = description
    note.mimeType = 'text/html'
  }
  return note
}
```

Keep `readProperty` unchanged.

- [ ] **Step 2: Rework `notes-resource-output.ts`**

`getResource` no longer renders: it calls `pois.getDetails(id)` (now a
`PoiDetailView`) and builds the note directly from the view:

```typescript
const view = await pois.getDetails(id)
const note = buildNoteResource(
  id, view.name, { ...view.position }, view.type.toLowerCase(),
  view.url, view.source, view.attribution, view.timestamp, view.description)
```

`listResources` builds each note from the `PoiSummary`, which now carries
`source`, `url`, and `attribution` (Task 1.1): pass `entity.url`,
`entity.source`, and `entity.attribution` to `buildNoteResource`. Remove the
now-unused `renderDescription`/`parseApiDate` imports.

- [ ] **Step 3: Update the tests**

`test/note-builder.test.ts`: update for the new `buildNoteResource` signature;
assert `properties.source` and `properties.attribution`.
`test/notes-resource-output.test.ts`: update the `pois` stub so `getDetails`
returns a `PoiDetailView` and `listPointsOfInterest` returns summaries with
`source`/`url`/`attribution`.

- [ ] **Step 4: Verify and commit** (with Task 1.3, per Task 1.3 Step 5).

### Task 1.5: Build the aggregating registry (TDD)

**Files:**
- Modify: `src/inputs/input-registry.ts`
- Test: `test/input-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `test/input-registry.test.ts` tests that, with two stub modules both
enabled, `createSource` returns an aggregate whose `listPointsOfInterest`
prefixes each summary id with its source slug and unions the results; whose
`getDetails('sourceB-raw1')` routes to source B with the raw id `raw1`; whose
`getDetails('unknown-x')` rejects; whose `listPointsOfInterest` still returns
the successful source's results when the other source's promise rejects; and
whose `cacheSize()` sums both sources. Keep the existing single-source tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test test/input-registry.test.ts` -> FAIL.

- [ ] **Step 3: Rewrite `createSource` to build an aggregate**

Replace the `enabled.length > 1` warning-and-use-first branch with a real
aggregate. The aggregate holds `Map<string, PoiSource>` keyed by source id:

```typescript
createSource: (context: InputContext): PoiSource => {
  const enabled = modules.filter((m) => m.isEnabled(context.config))
  if (enabled.length === 0) {
    throw new Error('Cannot build a POI source: no input is enabled')
  }
  const sources = new Map<string, PoiSource>()
  for (const module of enabled) {
    sources.set(module.id, module.createSource(context))
  }
  return {
    id: 'aggregate',
    listPointsOfInterest: async (bbox, poiTypes) => {
      const results = await Promise.allSettled(
        [...sources.values()].map((s) => s.listPointsOfInterest(bbox, poiTypes)))
      const merged: PoiSummary[] = []
      let anyOk = false
      results.forEach((result, index) => {
        const sourceId = [...sources.keys()][index]
        if (result.status === 'fulfilled') {
          anyOk = true
          for (const poi of result.value) {
            merged.push({ ...poi, id: `${sourceId}-${poi.id}` })
          }
        } else {
          context.status.recordError(
            `List from "${sourceId}" failed: ${String(result.reason)}`)
        }
      })
      if (!anyOk) {
        throw new Error('Every POI source failed the list request')
      }
      return merged
    },
    getDetails: async (id) => {
      const hyphen = id.indexOf('-')
      const sourceId = hyphen > 0 ? id.slice(0, hyphen) : ''
      const rawId = hyphen > 0 ? id.slice(hyphen + 1) : id
      const source = sources.get(sourceId)
      if (source === undefined) {
        throw new Error(`No source for resource id "${id}"`)
      }
      return await source.getDetails(rawId)
    },
    cacheSize: () => [...sources.values()].reduce((sum, s) => sum + s.cacheSize(), 0),
    close: () => { for (const s of sources.values()) s.close() }
  }
}
```

Note: the prefix split uses `indexOf('-')`, the FIRST hyphen, because a raw id
(an OSM id) can itself contain hyphens or slashes.

- [ ] **Step 4: Run the tests to verify they pass; verify the gate; commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/inputs/input-registry.ts test/input-registry.test.ts
git commit -m "feat: aggregate POI source across enabled inputs"
```

### Task 1.6: Add the shared attribution-footer helper (TDD)

**Files:**
- Create: `src/shared/attribution.ts`
- Test: `test/attribution.test.ts`

- [ ] **Step 1: Write the failing test**

`test/attribution.test.ts`: `appendAttribution('<p>hi</p>', 'Data from X')`
returns the HTML with a footer element containing `Data from X`;
`appendAttribution('', 'Data from X')` still yields a footer;
the footer markup is a single, consistent element (e.g.
`<p class="ac-attribution">...</p>`).

- [ ] **Step 2: Run it -> FAIL.**

- [ ] **Step 3: Write `src/shared/attribution.ts`**

```typescript
/**
 * Attribution footer for rendered POI detail. Each POI source supplies its own
 * attribution credit string; this helper appends it as a footer to that
 * source's rendered HTML description, so attribution is visible at the point
 * of display. This matters for OpenStreetMap data, whose ODbL license requires
 * visible attribution wherever the data is shown.
 */

/** Append a source attribution footer to a rendered HTML description. */
export function appendAttribution (html: string, attribution: string): string {
  return `${html}<p class="ac-attribution">${attribution}</p>`
}
```

- [ ] **Step 4: Run the test -> PASS; verify the gate; commit.**

```bash
git add src/shared/attribution.ts test/attribution.test.ts
git commit -m "feat: shared POI attribution footer helper"
```

---

# Phase 2: Notification path rename (Lane B)

### Task 2.1: Rename the notification vendor segment

**Files:**
- Modify: `src/outputs/proximity-alarm/proximity-alarms.ts`
- Modify: `src/outputs/route-hazard/route-hazard-alarms.ts`
- Test: `test/proximity-alarms.test.ts`, `test/route-hazard-alarms.test.ts`

- [ ] **Step 1: Change the path prefixes**

In `proximity-alarms.ts`, change `NOTIFICATION_PATH_PREFIX` from
`notifications.navigation.activecaptain.hazard.` to
`notifications.navigation.crowsNest.hazard.`. In `route-hazard-alarms.ts`,
change it from `notifications.navigation.activecaptain.route.` to
`notifications.navigation.crowsNest.route.`.

- [ ] **Step 2: Update the tests**

Update every assertion in `test/proximity-alarms.test.ts` and
`test/route-hazard-alarms.test.ts` that checks a notification path to expect
the `crowsNest` segment.

- [ ] **Step 3: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A
git commit -m "fix: rename alarm notification paths to the source-agnostic crowsNest segment"
```

---

# Phase 3: Per-source status (Lane C)

### Task 3.1: Make `StatusSnapshot` per-source

**Files:**
- Modify: `src/status/status-types.ts`
- Modify: `src/status/plugin-status.ts`
- Test: `test/plugin-status.test.ts`

- [ ] **Step 1: Rework `status-types.ts`**

Replace the flat `apiReachable` / `lastListFetch` with a per-source array.
Add a `SourceStatus` type and reference it from `StatusSnapshot`:

```typescript
/** Health of one POI data source. */
export interface SourceStatus {
  /** Source slug, e.g. `activecaptain`. */
  source: string
  /** Human-readable source name. */
  name: string
  /** Whether the source's last request succeeded; null before the first. */
  apiReachable: boolean | null
  /** The source's most recent successful list fetch, or null. */
  lastListFetch: LastListFetch | null
}
```

In `StatusSnapshot` replace `apiReachable` and `lastListFetch` with
`sources: SourceStatus[]`. Keep `cachedPoiCount`, `recentErrors`, `startedAt`.

- [ ] **Step 2: Rework `plugin-status.ts`**

`createPluginStatus` takes the list of enabled sources (`{ source, name }[]`)
so it can build one `SourceStatus` per source. `recordListFetch` and
`recordDetailSuccess` and `recordError` gain a `source` argument so an outcome
is attributed to the right source. `snapshot(cachedPoiCount)` assembles the
per-source array. Keep `recentErrors` global (capped). Update the `PluginStatus`
interface accordingly.

- [ ] **Step 3: Update `test/plugin-status.test.ts`**

Cover: a fresh recorder reports each source `apiReachable: null`; a
`recordListFetch('activecaptain', 5)` sets that source reachable with the
fetch; a `recordError('openseamap', ...)` sets that source unreachable and
appends to `recentErrors`; the snapshot has one `SourceStatus` per source.

- [ ] **Step 4: Verify the gate and commit**

> NOTE: this changes `createPluginStatus`'s signature and the `record*`
> signatures, so the callers (`plugin.ts`, `active-captain-source.ts`, the
> aggregate registry, `notes-resource-output.ts`) will not compile until Phase
> 6 wires them. Coordinate with Lane F: either land Task 3.1 together with the
> Phase 6 wiring as one green commit, or have Lane F own the caller updates.
> Do not commit a red typecheck.

### Task 3.2: Make `StatusBar` render per-source rows

**Files:**
- Modify: `src/panel/components/StatusBar.tsx`
- Test: none (component; covered by the panel build).

- [ ] **Step 1: Rework `StatusBar.tsx`**

Render one compact row per `SourceStatus` in `snapshot.sources`: the source
name, a reachability dot, and the last-fetch time. Keep the cached-count and
recent-errors display. Use existing `S.*` style tokens; add a `--ac-*` token
if a new color is needed, no hex literals.

- [ ] **Step 2: Verify with `npm run build` and commit**

```bash
npm run build
git add -A && git commit -m "feat: per-source status rows in the config panel status bar"
```

---

# Phase 4: The OpenSeaMap input (Lane D)

Mirrors `src/inputs/active-captain/` in structure. Read that directory first;
the client, source, and input-module patterns transfer directly.

### Task 4.1: The Overpass client

**Files:**
- Create: `src/inputs/openseamap/overpass-client.ts`
- Test: `test/overpass-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover: a bbox is rendered into an Overpass QL query with the
`south,west,north,east` order; the request sends a descriptive `User-Agent`
header; an HTTP 429 with `Retry-After` triggers a capped backoff retry; a
successful response is parsed into `PoiSummary[]` with `source: 'openseamap'`,
a typed id (`node/123`), a position, and an OSM `url`; a `getById` query
returns one element. Use a stub `fetch`.

- [ ] **Step 2: Write `overpass-client.ts`**

Mirror `src/inputs/active-captain/active-captain-client.ts`: a
concurrency-limited, throttled queue, exponential backoff with `Retry-After`,
an `AbortController` for `close()`. Differences specific to Overpass:
- The request is a POST (or GET) to the configured endpoint with an Overpass
  QL body: `[out:json][timeout:60][bbox:S,W,N,E];nwr["seamark:type"~"<regex>"];out center tags;`
  plus `nwr[leisure=marina](...)` for marinas.
- A `User-Agent` header identifying the plugin and version is REQUIRED by the
  Overpass usage policy; set it on every request.
- Cap the bounding-box span; if a requested bbox is larger, clamp it and
  document that distant POIs are picked up on a later, recentered request.
- Parse the `elements` array: each element has `type` (`node`/`way`/`relation`),
  `id`, `tags`, and either `lat`/`lon` (node) or `center` (way/relation). The
  POI id is `\`${element.type}/${element.id}\``.

Expose `listPointsOfInterest(bbox, seamarkRegex)` and `getById(typedId)`, plus
`close()`.

- [ ] **Step 3: Run the tests -> PASS. Verify the gate. Commit.**

```bash
git add src/inputs/openseamap/overpass-client.ts test/overpass-client.test.ts
git commit -m "feat: OSM Overpass API client"
```

### Task 4.2: The seamark-to-POI-type mapping (TDD)

**Files:**
- Create: `src/inputs/openseamap/seamark-mapping.ts`
- Test: `test/seamark-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

Cover: `seamarkToPoiType('rock')`, `('wreck')`, `('obstruction')` return
`'Hazard'`; `('harbour')` returns `'Marina'`; `('lock_basin')` returns
`'Lock'`; `('light_major')` and `('buoy_lateral')` return `'Navigational'`;
`('anchorage')` returns `'Anchorage'`; an unknown value returns `'Unknown'`.
Also test the seamark-group definitions: each group lists the `seamark:type`
values it fetches, and `seamarkRegex(['hazards'])` builds a regex matching
`rock|wreck|obstruction`.

- [ ] **Step 2: Run it -> FAIL.**

- [ ] **Step 3: Write `seamark-mapping.ts`**

Define: a `seamarkToPoiType(value: string): PoiType` map; the seamark groups
(`hazards`, `navaids`, `harbours`, `infrastructure`) each with its member
`seamark:type` values and a display label; and `seamarkRegex(groups: string[])`
that builds the alternation regex for the Overpass query. Keep the `PoiType`
union unchanged; map every seamark value to an existing member.

- [ ] **Step 4: Run the test -> PASS. Verify the gate. Commit.**

```bash
git add src/inputs/openseamap/seamark-mapping.ts test/seamark-mapping.test.ts
git commit -m "feat: OpenSeaMap seamark-type mapping and groups"
```

### Task 4.3: The OpenSeaMap source

**Files:**
- Create: `src/inputs/openseamap/openseamap-source.ts`
- Test: `test/openseamap-source.test.ts`

- [ ] **Step 1: Write `openseamap-source.ts`**

A `PoiSource` (id `openseamap`) wrapping the Overpass client. Mirror
`active-captain-source.ts`:
- `listPointsOfInterest(bbox, poiTypes)`: call the client, map each element to
  a `PoiSummary` (`id` the typed OSM id, `type` via `seamarkToPoiType`,
  `position`, `name` from `tags.name` or a type-derived fallback,
  `source: 'openseamap'`, `url: \`https://www.openstreetmap.org/${typedId}\``,
  `attribution: OPENSEAMAP_ATTRIBUTION`). Populate the detail cache from the
  full tags returned, so `getDetails` is usually a cache hit.
- `getDetails(id)`: serve from cache; on a miss call `client.getById(id)`.
  Render a simple HTML description from the seamark tags, append the ODbL
  attribution footer with `appendAttribution`, and return a `PoiDetailView`
  with `source: 'openseamap'`, `attribution: OPENSEAMAP_ATTRIBUTION`, and the
  OSM `url`. Handle a deleted element (client returns nothing) by rejecting
  with a clear "not found" error.
- `cacheSize()` and `close()` as in the ActiveCaptain source.

`OPENSEAMAP_ATTRIBUTION` is `'© OpenStreetMap contributors (ODbL)'`.

- [ ] **Step 2: Write `test/openseamap-source.test.ts`**

Cover: `listPointsOfInterest` maps elements to source-tagged summaries;
`getDetails` returns a `PoiDetailView` whose `description` contains the ODbL
attribution; a missing element rejects.

- [ ] **Step 3: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/inputs/openseamap/openseamap-source.ts test/openseamap-source.test.ts
git commit -m "feat: OpenSeaMap POI source"
```

### Task 4.4: The OpenSeaMap input module

**Files:**
- Create: `src/inputs/openseamap/openseamap-input.ts`
- Test: `test/openseamap-input.test.ts`

- [ ] **Step 1: Write `openseamap-input.ts`**

An `InputModule` (id `openseamap`) mirroring `active-captain-input.ts`. Its
`configSchema` fragment (flat, prefixed keys):

```typescript
const CONFIG_SCHEMA: Record<string, unknown> = {
  openSeaMapEnabled: {
    type: 'boolean',
    title: 'Import points of interest from OpenSeaMap (OpenStreetMap marine data)',
    default: false
  },
  openSeaMapEndpoint: {
    type: 'string',
    title: 'Overpass API endpoint URL',
    default: 'https://overpass-api.de/api/interpreter'
  },
  openSeaMapSeamarkGroups: {
    type: 'array',
    title: 'OpenSeaMap feature groups to import',
    items: { type: 'string', enum: ['hazards', 'navaids', 'harbours', 'infrastructure'] },
    default: ['hazards', 'navaids', 'harbours', 'infrastructure']
  }
}
```

`isEnabled` returns `config.openSeaMapEnabled === true`. `createSource` builds
the Overpass client (from the endpoint config) and the source. Add the new
config keys to the `PluginConfig` type in `src/shared/types.ts`.

- [ ] **Step 2: Write `test/openseamap-input.test.ts`**

Cover: `isEnabled` tracks `openSeaMapEnabled`; the config fragment has the
three keys; `createSource` returns a `PoiSource` with id `openseamap`.

- [ ] **Step 3: Verify the gate and commit**

```bash
git add src/inputs/openseamap/openseamap-input.ts test/openseamap-input.test.ts src/shared/types.ts
git commit -m "feat: OpenSeaMap input module"
```

---

# Phase 5: Configuration panel rework (Lane E)

### Task 5.1: The accordion card shell

**Files:**
- Create: `src/panel/components/DataSourceCard.tsx`
- Modify: `src/panel/styles.ts`

- [ ] **Step 1: Write `DataSourceCard.tsx`**

A presentational accordion card: props `name`, `enabled`, `summary` (one-line
string), `onToggleEnabled`, and `children`. It renders a header row (an enable
checkbox, the name, the summary text, and an expand chevron), holds local
expand/collapse state, and renders `children` only when expanded. Default
collapsed. Disabled cards show the summary as `Disabled`. Match the existing
small-focused-component style (see `ProximityAlarmFields.tsx`).

- [ ] **Step 2: Add accordion tokens to `styles.ts`**

Add the `S.*` style objects the card needs (header row, chevron, expanded
body) and any `--ac-*` token in `THEME_STYLE`. No hex literals.

- [ ] **Step 3: Verify with `npm run build` and commit**

```bash
npm run build
git add -A && git commit -m "feat: collapsible data-source card component"
```

### Task 5.2: Rename the ActiveCaptain POI-type component

**Files:**
- Move: `src/panel/components/PoiTypeGroups.tsx` -> `src/panel/components/ActiveCaptainPoiTypes.tsx`
- Move: `src/panel/poi-type-groups.ts` -> `src/panel/active-captain-poi-types.ts`

- [ ] **Step 1: `git mv` both files and update the exported symbol names**

Rename the component and its metadata module so they are explicitly
ActiveCaptain-specific. Update all imports.

- [ ] **Step 2: Verify the gate (`npm run build` included) and commit**

```bash
git add -A && git commit -m "refactor: rename PoiTypeGroups to ActiveCaptain-specific names"
```

### Task 5.3: The per-source card bodies and the Alerts section

**Files:**
- Create: `src/panel/components/ActiveCaptainSource.tsx`
- Create: `src/panel/components/OpenSeaMapSource.tsx`
- Create: `src/panel/components/AlertsSection.tsx`
- Create: `src/panel/components/DataSourcesSection.tsx`
- Create: `src/panel/components/EndpointUrlField.tsx`
- Create: `src/panel/components/SeamarkGroups.tsx`

- [ ] **Step 1: Write the card-body components**

- `ActiveCaptainSource.tsx`: composes `CacheDurationField`, `RatingFilterField`,
  and `ActiveCaptainPoiTypes` (the renamed component) for the ActiveCaptain
  card body.
- `OpenSeaMapSource.tsx`: composes `EndpointUrlField` (a labeled text input for
  the Overpass URL) and `SeamarkGroups` (a checklist of the four seamark
  groups) for the OpenSeaMap card body.
- `AlertsSection.tsx`: wraps `ProximityAlarmFields` and `RouteHazardScanFields`
  under an "Alerts" heading.
- `DataSourcesSection.tsx`: renders a `DataSourceCard` per source, with the
  matching body component as its `children`.
- `EndpointUrlField.tsx` and `SeamarkGroups.tsx`: small focused inputs in the
  style of `CacheDurationField.tsx`.

- [ ] **Step 2: Verify with `npm run build` and commit**

```bash
npm run build
git add -A && git commit -m "feat: per-source card bodies and the Alerts section"
```

### Task 5.4: Extend the config reducer and normalize-config

**Files:**
- Modify: `src/panel/config-reducer.ts`
- Modify: `src/panel/normalize-config.ts`
- Test: `test/config-reducer.test.ts`, `test/normalize-config.test.ts`

- [ ] **Step 1: Add the OpenSeaMap actions to the reducer**

Add reducer cases for `openSeaMapEnabled`, `openSeaMapEndpoint`, and
`openSeaMapSeamarkGroups`, following the existing identity-preserving pattern
(return `state` unchanged when nothing changed). Add the matching `ConfigAction`
variants.

- [ ] **Step 2: Extend `normalize-config.ts`**

`normalizeConfig` must fill the three OpenSeaMap keys with their defaults
(`openSeaMapEnabled: false`, the default endpoint, all four groups) when an old
config omits them, so an existing flat config keeps working untouched.

- [ ] **Step 3: Update the tests**

`test/config-reducer.test.ts`: cover the three new actions.
`test/normalize-config.test.ts`: cover that an empty config gets the OpenSeaMap
defaults and that an explicit `openSeaMapEnabled: true` is preserved.

- [ ] **Step 4: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add -A && git commit -m "feat: OpenSeaMap config actions and defaults"
```

### Task 5.5: Reassemble the panel

**Files:**
- Modify: `src/panel/PluginConfigurationPanel.tsx`

- [ ] **Step 1: Restructure `PluginConfigurationPanel.tsx`**

Replace the flat stack with the four zones: `StatusBar`, then
`DataSourcesSection` (the accordion: an ActiveCaptain card and an OpenSeaMap
card), then `AlertsSection`, then `FooterBar`. Wire each card's enable toggle
and body fields to the reducer `dispatch`. Build each card's collapsed
one-line summary from the config (e.g. ActiveCaptain: count of enabled POI
types and the cache duration; OpenSeaMap: count of enabled seamark groups, or
`Disabled`).

- [ ] **Step 2: Verify the build and the panel**

Run `npm run build`. Then verify the rendered panel: build a standalone
harness (esbuild or webpack) that renders `PluginConfigurationPanel` in a
browser, drive it with Playwright against the system Chromium, and confirm the
accordion collapses/expands, the OpenSeaMap card reveals its fields on enable,
and Save emits the OpenSeaMap config keys. Capture a screenshot.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: per-source accordion configuration panel"
```

---

# Phase 6: Integration and docs (Lane F)

### Task 6.1: Register the OpenSeaMap input and wire per-source status

**Files:**
- Modify: `src/index.ts`
- Modify: `src/plugin/plugin.ts`
- Modify: `src/inputs/active-captain/active-captain-source.ts` and the other
  `status.record*` callers, for the new `source` argument.

- [ ] **Step 1: Register the input**

In `src/index.ts` add `openSeaMapInput` to the `createInputRegistry([...])`
array, after `activeCaptainInput`.

- [ ] **Step 2: Wire per-source status**

Update `plugin.ts` to build `createPluginStatus` with the enabled sources'
`{ source, name }`, and update every `status.record*` call site (the
ActiveCaptain source's cache listener, the aggregate registry, the
notes-resource output, the monitor) to pass the originating `source` slug.

- [ ] **Step 3: Verify the full gate and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add -A && git commit -m "feat: register the OpenSeaMap input and wire per-source status"
```

### Task 6.2: Per-source dedupe and corroboration against the ActiveCaptain base

With more than one source enabled, the same physical marina, hazard, or lock
can appear as separate markers a few meters apart. ActiveCaptain is the fixed
"base" layer. Each non-base source carries its own opt-in dedupe toggle,
checked by default. When a non-base source's dedupe is on, its POIs that
coincide with a base ActiveCaptain POI merge into that base marker, and the
surviving note records every contributing source as a corroboration signal.
Absence of corroboration is NOT a negative signal (source coverage is uneven),
so it is surfaced only as confidence-up.

**Files:**
- Create: `src/inputs/dedupe-pois.ts`
- Test: `test/dedupe-pois.test.ts`
- Modify: `src/inputs/input-registry.ts`, `src/shared/types.ts`,
  `src/inputs/openseamap/openseamap-input.ts`,
  `src/outputs/notes-resource/note-builder.ts`, and the panel
  (`config-reducer.ts`, `normalize-config.ts`, the OpenSeaMap source card).

- [ ] **Step 1: Write the failing test `test/dedupe-pois.test.ts`**

Cover: a non-base POI of the same `PoiType` within the radius of a base
(`activecaptain`) POI merges into the base POI, whose `sources` then lists both
slugs; the base POI is always the survivor (its id and content win); a non-base
POI of a DIFFERENT type at the same spot does NOT merge; a dedupe-enabled
non-base POI with no co-located base POI passes through unmerged with `sources`
equal to its own source; two non-base sources both co-located with one base POI
all merge into that base POI (`sources` lists all three); a POI from a source
NOT in the dedupe-enabled set is never merged or dropped; when no base POI
exists at all (ActiveCaptain disabled), every POI passes through unmerged.

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Write `src/inputs/dedupe-pois.ts`**

Add an optional `sources?: string[]` field to `PoiSummary` in
`src/shared/types.ts`. Export `BASE_SOURCE_ID = 'activecaptain'` and
`dedupeAgainstBase(pois: PoiSummary[], dedupeSources: ReadonlySet<string>, radiusMeters: number): PoiSummary[]`.
Bucket the POIs into a spatial grid (cell side equal to `radiusMeters`) so the
pass is O(n), not O(n^2). For each base POI (`source === BASE_SOURCE_ID`), find
same-`type` POIs within `radiusMeters` (use `distanceMeters` from
`src/geo/position-utilities.ts`) whose `source` is in `dedupeSources`; drop
those non-base POIs and set the base POI's `sources` to the base slug plus
every merged source slug, deduplicated. A dedupe-enabled non-base POI with no
co-located base POI passes through with `sources: [its own source]`. A POI
whose `source` is not in `dedupeSources` is never merged or dropped. Default
radius: 50 meters.

- [ ] **Step 4: Wire it into the aggregate registry**

In `input-registry.ts`, after the `Promise.allSettled` union, build the
`dedupeSources` set from the enabled non-base modules whose per-source dedupe
config flag is true, then run `dedupeAgainstBase`. When the set is empty, or
the base source is not enabled, return the plain union unchanged.

- [ ] **Step 5: Add the per-source dedupe config key**

Add `openSeaMapDedupe?: boolean` to `PluginConfig`, and add an
`openSeaMapDedupe` boolean to the OpenSeaMap input module's `configSchema`
fragment in `openseamap-input.ts` (title: "Merge OpenSeaMap points of interest
that duplicate an ActiveCaptain marker", default `true`). Each future non-base
source adds its own `<source>Dedupe` key the same way; ActiveCaptain, the base,
has no dedupe key.

- [ ] **Step 6: Surface corroboration on the note**

In `note-builder.ts`, when the POI's `sources` has more than one entry, add
`sources` and `sourceCount` to the note's `properties`, and have `attribution`
credit every contributing source. This is the corroboration signal a consumer
reads to know a marker is confirmed by more than one independent source.

- [ ] **Step 7: Add the dedupe toggle to the OpenSeaMap card**

Add the `openSeaMapDedupe` checkbox, checked by default, to the OpenSeaMap
source card in the panel, with a hint that it removes OpenSeaMap markers that
duplicate an ActiveCaptain one. Add the reducer action and the
`normalize-config.ts` default (`true`).

- [ ] **Step 8: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add -A && git commit -m "feat: per-source dedupe and corroboration against the ActiveCaptain base"
```

### Task 6.3: End-to-end test of the multi-source path

**Files:**
- Create: `test/multi-source.test.ts`

- [ ] **Step 1: Write the test**

With both `activeCaptainInput` and `openSeaMapInput` registered and enabled
(stub clients), assert: a `listResources` call returns notes whose ids are
prefixed (`activecaptain-*` and `openseamap-*`); a `getResource` of an
`openseamap-` id routes to the OpenSeaMap source; a `getResource` of an
`activecaptain-` id routes to ActiveCaptain; an unknown-prefix id rejects.

- [ ] **Step 2: Run it, verify the gate, commit.**

### Task 6.4: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `docs/development.md`

- [ ] **Step 1: Update the docs**

`CLAUDE.md`: add the `src/inputs/openseamap/` module and describe the
multi-source aggregate registry. `README.md`: add OpenSeaMap to the source
list and the features, describe the new accordion panel, and add the
OpenStreetMap/ODbL attribution to the Acknowledgments. `CHANGELOG.md`: add a
`v0.5.0` entry covering the OpenSeaMap source, the multi-source registry, the
namespaced resource ids, and the `notifications.navigation.crowsNest.*` rename
(with the hot-upgrade caveat). `docs/development.md`: note the new module.

- [ ] **Step 2: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add -A && git commit -m "docs: document the OpenSeaMap source and multi-source architecture"
```

### Task 6.5: Final verification sweep

- [ ] **Step 1: Run every check**

```bash
npm run clean && npm run build && npm run typecheck && npm run lint && npm test
```

Expected: build succeeds, typecheck and lint clean, every test green.

- [ ] **Step 2: Confirm behavior preservation**

Confirm: with only ActiveCaptain enabled, the assembled config schema still has
every ActiveCaptain property; a `notes` list returns `activecaptain-` prefixed
ids; the proximity and route alarms emit on `notifications.navigation.crowsNest.*`.

---

## Behavior-preservation acceptance checks

- The 295-test suite plus the new tests are all green.
- `npm run build` produces `dist/` and the `public/` panel bundle.
- With only ActiveCaptain enabled: notes resources are unchanged except the
  `activecaptain-` id prefix; old saved configs load (the OpenSeaMap keys take
  defaults).
- The Module Federation panel name `./PluginConfigurationPanel` is unchanged.

## Deferred work (not in this plan)

- The NGA World Port Index, NOAA NDBC, and USACE lock inputs (follow-on specs).
- UUIDv5-derived resource ids (the read-only provider makes prefixed strings
  acceptable; recorded as a future option).
