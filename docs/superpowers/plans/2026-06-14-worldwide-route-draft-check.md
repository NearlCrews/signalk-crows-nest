# Worldwide Route-Draft Safety Check Implementation Plan

> Historical document: the AI route-draft feature was removed in v0.12.0.
> This file records the former implementation plan and must not be executed
> against the current codebase.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the AI route-draft safety check beyond US ENC waters so every leg of a drafted route is checked by every data provider whose coverage envelope reaches it, with every unverified dimension flagged explicitly and never silently passed.

**Architecture:** Refactor the ENC-specific `checkLegs` into a thin orchestrator over a small set of capability-tagged `LegSafetyProvider` implementations (ENC, OpenSeaMap, EMODnet). A resolver computes, per leg, the union of every provider whose envelope intersects the leg. Each provider returns per-dimension coverage so the orchestrator emits "not checked" by responsibility, not by string-matching. Built in three phases on one branch, shipped as one release.

**Tech Stack:** TypeScript 6, `node:test` via `tsx`, ESLint 9 neostandard, existing `EncDirectClient` (ArcGIS REST), `OverpassClient` (OSM Overpass), and `http-one-shot.ts` (raw GET). Storage stays SI.

**Spec:** `docs/superpowers/specs/2026-06-14-worldwide-route-draft-check-design.md`

**Conventions for every commit message and code comment in this plan:** no em dashes, use the Oxford comma, write "and" not an ampersand in prose, and never describe any AI or review process. Run `npm run lint`, `npm run typecheck`, and `npm test` before each commit.

---

## File Structure

Created:
- `src/route-draft/leg-geometry.ts` - planar ring and open-polyline helpers shared by the providers (moved out of `safety-check.ts`, with new polyline variants).
- `src/route-draft/providers/provider.ts` - the `LegSafetyProvider` interface, `Coverage`, `LegDimensionCoverage`, `LegRef`, and the `resolveProviders` region resolver.
- `src/route-draft/providers/enc-provider.ts` - the ENC depth, land, standoff, and hazard logic, wrapped as a provider (moved out of `safety-check.ts`).
- `src/route-draft/providers/openseamap-provider.ts` - OpenSeaMap hazard and coastline-land provider.
- `src/route-draft/providers/emodnet-provider.ts` - EMODnet modeled-depth provider.
- `src/route-draft/emodnet/emodnet-client.ts` - GET-only EMODnet depth-profile client on `http-one-shot.ts`.
- `src/inputs/openseamap/coastline-query.ts` - `natural=coastline` Overpass query returning polylines.
- `src/inputs/openseamap/element-summary.ts` - pure `OverpassElement` to `PoiSummary` mapper, extracted from `openseamap-source.ts`.
- `src/shared/regions.ts` - coverage-envelope predicates the resolver reads (US ENC via `isInUsWaters`, EMODnet European envelope).
- Tests: `test/route-draft-leg-geometry.test.ts`, `test/route-draft-providers-resolver.test.ts`, `test/route-draft-enc-provider.test.ts`, `test/route-draft-openseamap-provider.test.ts`, `test/route-draft-emodnet-provider.test.ts`, `test/route-draft-emodnet-client.test.ts`, `test/openseamap-coastline-query.test.ts`, `test/shared-regions.test.ts`.

Modified:
- `src/route-draft/safety-check.ts` - becomes the orchestrator; loses the moved geometry and ENC internals.
- `src/route-draft/endpoint.ts` - `RouteDraftService` gains `overpass` and `emodnet`; the orchestrator call passes the provider set.
- `src/plugin/plugin.ts` - builds the Overpass and EMODnet clients into the service; closes them on teardown.
- `src/inputs/openseamap/overpass-client.ts` - add a generic query method, a threaded `AbortSignal`, and `listCoastlineWays`.
- `src/inputs/openseamap/openseamap-source.ts` - consume the extracted `element-summary.ts`.
- `test/route-draft-safety-check.test.ts` - the two orchestrator-level tests move to a new orchestrator suite in phase 2; the ENC-behavior tests move to `route-draft-enc-provider.test.ts`.
- `CLAUDE.md`, `CHANGELOG.md`, `README.md` - updated as part of the release.

---

## PHASE 1: Behavior-preserving refactor

Phase 1 introduces the geometry module, the provider interface, the resolver, the orchestrator, and `EncProvider`, all wired to reproduce today's behavior exactly. The legacy whole-route outside-US guard and its single refusal flag stay. No new upstream calls. Every existing test stays green.

### Task 1: Move planar geometry into `leg-geometry.ts`

**Files:**
- Create: `src/route-draft/leg-geometry.ts`
- Create: `test/route-draft-leg-geometry.test.ts`
- Modify: `src/route-draft/safety-check.ts` (remove the moved helpers, import them)

- [ ] **Step 1: Create the geometry module by moving the existing helpers verbatim**

Move these functions out of `src/route-draft/safety-check.ts` into a new `src/route-draft/leg-geometry.ts`, unchanged in body: `pointInRings`, `orient2D`, `segmentsCross`, `segmentCrossesRings`, and `legPolyline`. Add `export` to each. Keep their JSDoc. The module header:

```typescript
/**
 * Planar leg-vs-area geometry shared by the route-draft safety providers.
 *
 * The ring helpers (closed rings, wrapping the last vertex to the first) serve
 * the ENC depth-area and land-area polygons. The open-polyline helpers added
 * for the OpenSeaMap coastline check do NOT wrap, because an OSM coastline way
 * is an open line, not a closed ring. Both share the segmentsCross and orient2D
 * primitives so the two cannot drift.
 *
 * All inputs are GeoJSON [lon, lat] arrays (longitude is x, latitude is y),
 * matching the EncAreaPolygon ring shape. Tests at degree scale over short
 * coastal legs make a spherical correction unnecessary.
 */

import { sampleRhumbLeg } from '../geo/position-utilities.js'
import type { Position } from '../shared/types.js'
```

`legPolyline` already imports `sampleRhumbLeg`; keep that. Export `legPolyline`, `pointInRings`, `orient2D`, `segmentsCross`, and `segmentCrossesRings`.

- [ ] **Step 2: Import the moved helpers back into `safety-check.ts`**

In `src/route-draft/safety-check.ts`, delete the moved function bodies and add:

```typescript
import { pointInRings, segmentsCross, segmentCrossesRings, legPolyline } from './leg-geometry.js'
```

`orient2D` is only used by `segmentsCross`, so it does not need importing into `safety-check.ts`. Leave `nearestLandApproachMeters` in `safety-check.ts` for now (it moves to `enc-provider.ts` in Task 3).

- [ ] **Step 3: Run the full suite to verify no behavior changed**

Run: `npm test`
Expected: PASS, the same count as before (the move is internal).

- [ ] **Step 4: Add focused unit tests for the moved helpers**

These helpers had no direct unit test before (only via the orchestrator). Add `test/route-draft-leg-geometry.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { pointInRings, segmentsCross, segmentCrossesRings } from '../src/route-draft/leg-geometry.js'

const SQUARE: number[][][] = [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]

test('pointInRings is true inside and false outside the ring', () => {
  assert.equal(pointInRings(0, 0, SQUARE), true)
  assert.equal(pointInRings(2, 2, SQUARE), false)
})

test('segmentsCross detects a proper crossing and rejects a non-crossing pair', () => {
  assert.equal(segmentsCross([-1, 0], [1, 0], [0, -1], [0, 1]), true)
  assert.equal(segmentsCross([-1, 0], [1, 0], [-1, 1], [1, 1]), false)
})

test('segmentCrossesRings is true when a segment cuts a ring edge', () => {
  assert.equal(segmentCrossesRings([-2, 0], [2, 0], SQUARE), true)
  assert.equal(segmentCrossesRings([2, 2], [3, 3], SQUARE), false)
})
```

- [ ] **Step 5: Run the new tests**

Run: `npm test -- test/route-draft-leg-geometry.test.ts` (or `npx tsx --test test/route-draft-leg-geometry.test.ts`)
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/leg-geometry.ts test/route-draft-leg-geometry.test.ts src/route-draft/safety-check.ts
git commit -m "refactor(route-draft): extract leg geometry to leg-geometry.ts"
```

### Task 2: Define the provider interface and resolver scaffold

**Files:**
- Create: `src/route-draft/providers/provider.ts`
- Create: `src/shared/regions.ts`
- Create: `test/shared-regions.test.ts`

- [ ] **Step 1: Write the regions module**

`src/shared/regions.ts`:

```typescript
/**
 * Coverage-envelope predicates the route-draft provider resolver reads. Kept
 * out of us-waters.ts (the inputs' outbound-HTTP gate) so the route-draft region
 * concept does not couple to that gate. Browser-safe: no node-only imports.
 */

import type { Position } from './types.js'
import { isInUsWaters } from './us-waters.js'

/** True when a leg endpoint is inside the (generous) US ENC coverage envelope. */
export function isInEncCoverage (position: Position): boolean {
  return isInUsWaters(position)
}

/**
 * EMODnet bathymetry coverage envelope: longitude -36 to +43, latitude 15 to 90
 * (European seas, the Mediterranean, the Black Sea, the Baltic, the Norwegian
 * and Icelandic seas, the Arctic, and Macaronesia). Out-of-coverage cells
 * degrade to "not checked", so this coarse gate only decides whether to query.
 */
export function isInEmodnetCoverage (position: Position): boolean {
  const { latitude, longitude } = position
  return latitude >= 15 && latitude <= 90 && longitude >= -36 && longitude <= 43
}
```

- [ ] **Step 2: Test the regions module**

`test/shared-regions.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { isInEncCoverage, isInEmodnetCoverage } from '../src/shared/regions.js'

test('US ENC coverage matches US waters and excludes Europe', () => {
  assert.equal(isInEncCoverage({ latitude: 40.5, longitude: -74 }), true)
  assert.equal(isInEncCoverage({ latitude: 43.3, longitude: 5.4 }), false)
})

test('EMODnet coverage includes the Med and excludes the US east coast', () => {
  assert.equal(isInEmodnetCoverage({ latitude: 43.3, longitude: 5.4 }), true)
  assert.equal(isInEmodnetCoverage({ latitude: 40.5, longitude: -74 }), false)
})
```

Run: `npm test -- test/shared-regions.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the provider interface and resolver**

`src/route-draft/providers/provider.ts`:

```typescript
/**
 * The route-draft leg-safety provider contract and the per-leg region resolver.
 *
 * Each provider declares the dimensions it supplies (depth, land, hazards) and
 * its geographic footprint. The resolver owns coverage truth: per leg it returns
 * the union of every provider whose footprint reaches the leg. The orchestrator
 * (safety-check.ts) runs that set and decides not-checked emission by which
 * dimensions a responsible provider actually verified.
 */

import type { LegFlag, LegCheckParams } from '../safety-check.js'
import type { Position } from '../../shared/types.js'

/** Whether a responsible provider returned data for a dimension, or none. */
export type Coverage = 'data' | 'nodata'

/** Per-leg coverage a provider reports for each dimension it is responsible for. */
export interface LegDimensionCoverage {
  depth?: Coverage
  land?: Coverage
}

/** The dimensions a provider can supply. */
export type Dimension = 'depth' | 'land' | 'hazards'

/** A covered leg with its global index and endpoints, handed to checkHazards. */
export interface LegRef {
  leg: number
  from: Position
  to: Position
}

/** One leg's depth-and-land result from a provider. */
export interface LegProviderResult {
  flags: LegFlag[]
  coverage: LegDimensionCoverage
}

/** A leg-safety provider over one data source. */
export interface LegSafetyProvider {
  id: string
  capabilities: ReadonlySet<Dimension>
  /** True when this provider's footprint reaches the leg. OSM is global. */
  coversLeg: (from: Position, to: Position) => boolean
  /** Per-leg depth and land flags plus which dimensions returned data. */
  checkLeg: (leg: number, from: Position, to: Position, params: LegCheckParams) => Promise<LegProviderResult>
  /** Hazard sweep over the legs this provider covers; flags carry global indices. */
  checkHazards?: (legs: LegRef[], params: LegCheckParams) => Promise<LegFlag[]>
}

/**
 * The active providers for one leg: every provider whose footprint reaches it.
 * Order follows the input provider list, which the orchestrator builds in
 * precedence order (ENC, then EMODnet, then OpenSeaMap).
 */
export function resolveProviders (
  providers: readonly LegSafetyProvider[],
  from: Position,
  to: Position
): LegSafetyProvider[] {
  return providers.filter((p) => p.coversLeg(from, to))
}
```

Note: `LegFlag` and `LegCheckParams` stay exported from `safety-check.ts` (they already are). This import direction (provider imports from safety-check) is fine because the types are interfaces with no runtime cycle.

- [ ] **Step 4: Test the resolver**

`test/route-draft-providers-resolver.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveProviders, type LegSafetyProvider } from '../src/route-draft/providers/provider.js'
import type { Position } from '../src/shared/types.js'

function stub (id: string, covers: boolean): LegSafetyProvider {
  return {
    id,
    capabilities: new Set(),
    coversLeg: () => covers,
    checkLeg: async () => ({ flags: [], coverage: {} })
  }
}

const A: Position = { latitude: 40, longitude: -74 }
const B: Position = { latitude: 41, longitude: -74 }

test('resolveProviders returns only providers whose footprint reaches the leg', () => {
  const active = resolveProviders([stub('enc', true), stub('osm', true), stub('emodnet', false)], A, B)
  assert.deepEqual(active.map((p) => p.id), ['enc', 'osm'])
})
```

Run: `npm test -- test/route-draft-providers-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/providers/provider.ts src/shared/regions.ts test/shared-regions.test.ts test/route-draft-providers-resolver.test.ts
git commit -m "feat(route-draft): add the leg-safety provider contract and region resolver"
```

### Task 3: Wrap the ENC logic as `EncProvider`

**Files:**
- Create: `src/route-draft/providers/enc-provider.ts`
- Create: `test/route-draft-enc-provider.test.ts`
- Modify: `src/route-draft/safety-check.ts`

- [ ] **Step 1: Move the ENC internals into `enc-provider.ts`**

Move these functions from `src/route-draft/safety-check.ts` into `src/route-draft/providers/enc-provider.ts`, unchanged in body: `crossedAreas`, `legCrossesArea`, `shallowestNavigable`, `dryingArea`, `queryLegBands`, `legBbox`, `nearestLandApproachMeters`, `hazardSummary`, `hazardMessage`, the `CrossedArea`, `DryingArea`, `QueryChartedAreas`, `ScanRouteCorridor`, and `LegCheckDeps` types, the `addLandFlags`, `addShallowOrNoCoverageFlags`, and `addStandoffFlag` helpers, and the per-leg body of `checkOneLeg` and the hazard body of `addHazardFlags` and `queryHazards`. They import from `./leg-geometry.js` (`pointInRings`, `segmentCrossesRings`, `legPolyline`) and from `../safety-check.js` (`LegFlag`).

- [ ] **Step 2: Build the EncProvider factory implementing the interface**

Add to `src/route-draft/providers/enc-provider.ts`. It adapts the moved per-leg and hazard logic to `LegSafetyProvider`. `checkLeg` returns coverage: `depth` is `'data'` when at least one depth area covered the leg (navigable or drying), else `'nodata'`; `land` is `'data'` when a land query returned (a leg with no land area is still covered, the query ran), so ENC `land` is `'data'` whenever the band query succeeded. A rejected band query throws, which the orchestrator turns into not-checked.

```typescript
import { isInEncCoverage } from '../../shared/regions.js'
import { metersFromNauticalMiles } from '../../shared/length.js'
import type { EncDirectClient } from '../../inputs/noaa-enc/enc-direct-client.js'
import type { LegSafetyProvider, LegProviderResult, LegRef, Dimension } from './provider.js'
import type { LegCheckParams, LegFlag } from '../safety-check.js'
import type { QueryChartedAreas, ScanRouteCorridor } from './enc-provider-deps.js'

const ENC_CAPABILITIES: ReadonlySet<Dimension> = new Set<Dimension>(['depth', 'land', 'hazards'])

export interface EncProviderDeps {
  client: EncDirectClient
  queryChartedAreas: QueryChartedAreas
  scanRouteCorridor: ScanRouteCorridor
  logger?: { debug: (m: string) => void, error: (m: string) => void }
}

export function createEncProvider (deps: EncProviderDeps): LegSafetyProvider {
  return {
    id: 'enc',
    capabilities: ENC_CAPABILITIES,
    coversLeg: (from, to) => isInEncCoverage(from) || isInEncCoverage(to),
    checkLeg: async (leg, from, to, params): Promise<LegProviderResult> => {
      // The body is the moved checkOneLeg, returning coverage alongside flags.
      // depth coverage is 'data' when any depth area (navigable or drying)
      // crossed the leg, else 'nodata'; land coverage is 'data' whenever the
      // band query succeeded (an empty land set is still a successful query).
      return await checkEncLeg(deps, leg, from, to, params)
    },
    checkHazards: async (legs: LegRef[], params): Promise<LegFlag[]> => {
      return await scanEncHazards(deps, legs, params)
    }
  }
}
```

Define `checkEncLeg` from the moved `checkOneLeg` (it now returns `{ flags, coverage }` and reads `deps` instead of `ctx`), and `scanEncHazards` from the moved `addHazardFlags` and `queryHazards`, taking `LegRef[]` and emitting global leg indices via the ref's `leg`. Put the injected query types (`QueryChartedAreas`, `ScanRouteCorridor`) in a tiny `src/route-draft/providers/enc-provider-deps.ts` to avoid a type cycle, or inline them in `enc-provider.ts`; choose inline if no cycle appears.

- [ ] **Step 3: Reduce `safety-check.ts` to the orchestrator, preserving behavior**

Rewrite `checkLegs` to: keep the `waypoints.length < 2` guard; KEEP the legacy whole-route outside-US guard exactly (`if (waypoints.some((wp) => !deps.isInUsWaters(wp))) return { flags: [{ kind: 'other', message: 'depth and hazards unavailable: route is outside US ENC coverage' }], checked: false }`); then run the single `EncProvider` built from `deps` over every leg in the existing bounded-concurrency pool, and run `EncProvider.checkHazards` once over all legs when any leg was checked. The orchestrator owns `cumulativeLegStartMeters` and `legForAlongTrack` and passes `LegRef[]` to `checkHazards`. `checkLegs` keeps its exact signature `(deps: LegCheckDeps, params: LegCheckParams)` so the endpoint and tests are unchanged in phase 1.

The orchestrator constructs the provider internally in phase 1:

```typescript
import { createEncProvider } from './providers/enc-provider.js'

export async function checkLegs (deps: LegCheckDeps, params: LegCheckParams): Promise<LegCheckResult> {
  const { waypoints } = params
  if (waypoints.length < 2) return { flags: [], checked: false }
  if (waypoints.some((wp) => !deps.isInUsWaters(wp))) {
    return {
      flags: [{ kind: 'other', message: 'depth and hazards unavailable: route is outside US ENC coverage' }],
      checked: false
    }
  }
  const enc = createEncProvider({
    client: deps.client,
    queryChartedAreas: deps.queryChartedAreas,
    scanRouteCorridor: deps.scanRouteCorridor,
    logger: deps.logger
  })
  return await runOrchestrator([enc], waypoints, params, deps.logger)
}
```

Write `runOrchestrator` to reproduce today's flow over a provider list: per-leg pool calling `resolveProviders` (here always `[enc]`), collecting `{ flags, coverage }`, emitting not-checked only for a `nodata` or unowned dimension, then the per-provider hazard sweep. In phase 1 with one full-capability provider in US waters, the emitted flags must match today's output exactly.

- [ ] **Step 4: Move the ENC-behavior tests to the provider suite, keep orchestrator tests**

Copy `test/route-draft-safety-check.test.ts` to `test/route-draft-enc-provider.test.ts`. Both still call `checkLegs` in phase 1 (the public entry is unchanged), so no test body changes yet. Keep both files green. The split is finalized in phase 2 when `checkLegs` changes shape.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, including all of `test/route-draft-safety-check.test.ts` unchanged. The "degrades when the route leaves US ENC coverage" test still passes because the legacy guard is retained.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/providers/enc-provider.ts src/route-draft/safety-check.ts test/route-draft-enc-provider.test.ts
git commit -m "refactor(route-draft): wrap the ENC check as a provider behind the orchestrator"
```

---

## PHASE 2: OpenSeaMap provider (worldwide hazards and coastline land)

Phase 2 replaces the whole-route guard with the per-leg union resolver, adds the OpenSeaMap provider, the coastline Overpass surface, the tiling that defeats the 2-degree clamp, and the extracted element-to-summary mapper. The outside-US test moves to the orchestrator suite and changes meaning (a non-US leg now gets OSM, not a whole-route refusal).

### Task 4: Add open-polyline geometry for the coastline check

**Files:**
- Modify: `src/route-draft/leg-geometry.ts`
- Modify: `test/route-draft-leg-geometry.test.ts`

- [ ] **Step 1: Write the failing tests for the polyline helpers**

Add to `test/route-draft-leg-geometry.test.ts`:

```typescript
import { polylineCrossesLeg, nearestPolylineApproachMeters } from '../src/route-draft/leg-geometry.js'
import type { Position } from '../src/shared/types.js'

const COASTLINE: number[][] = [[-1, 0], [1, 0]] // an open west-to-east line at lat 0

test('polylineCrossesLeg is true when the leg crosses the open coastline line', () => {
  const from: Position = { latitude: -1, longitude: 0 }
  const to: Position = { latitude: 1, longitude: 0 }
  assert.equal(polylineCrossesLeg(from, to, [COASTLINE]), true)
})

test('polylineCrossesLeg is false for a leg that stays on one side', () => {
  const from: Position = { latitude: 0.5, longitude: -1 }
  const to: Position = { latitude: 0.5, longitude: 1 }
  assert.equal(polylineCrossesLeg(from, to, [COASTLINE]), false)
})

test('nearestPolylineApproachMeters finds a close pass to a sparse segment', () => {
  // Leg parallel to and ~1 nm north of a coastline segment whose nearest vertex
  // is far away; vertex-only sampling would miss it, segment distance does not.
  const from: Position = { latitude: 0.016, longitude: -0.5 }
  const to: Position = { latitude: 0.016, longitude: 0.5 }
  const d = nearestPolylineApproachMeters(from, to, [[[-5, 0], [5, 0]]])
  assert.ok(d !== undefined && d < 2000, `expected a close pass, got ${String(d)}`)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/route-draft-leg-geometry.test.ts`
Expected: FAIL with "polylineCrossesLeg is not a function".

- [ ] **Step 3: Implement the polyline helpers**

Add to `src/route-draft/leg-geometry.ts`. Reuse `segmentsCross` for crossing, and add a point-to-segment distance for the standoff. Distances use the existing geo helpers, projecting onto the leg.

```typescript
import { projectPointOntoLeg, initialBearingRad, rhumbDistanceMeters } from '../geo/position-utilities.js'

/** True when the leg [from,to] crosses any segment of any open polyline. */
export function polylineCrossesLeg (from: Position, to: Position, lines: number[][][]): boolean {
  const a = [from.longitude, from.latitude]
  const b = [to.longitude, to.latitude]
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      if (segmentsCross(a, b, line[i], line[i + 1])) return true
    }
  }
  return false
}

/**
 * Nearest approach, in meters, from the leg to any open-polyline segment. Unlike
 * the ring helper this samples each coastline SEGMENT (densified to bounded
 * sub-points) so a long sparse segment passing close to the leg is not missed.
 * Returns undefined when no segment vertex projects onto the on-leg span.
 */
export function nearestPolylineApproachMeters (
  from: Position, to: Position, lines: number[][][]
): number | undefined {
  const bearing = initialBearingRad(from, to)
  const legLengthMeters = rhumbDistanceMeters(from, to)
  let nearest: number | undefined
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      for (const [lon, lat] of densifySegment(line[i], line[i + 1])) {
        const projection = projectPointOntoLeg(from, to, { latitude: lat, longitude: lon }, bearing)
        const along = projection.alongTrackMeters
        const cross = Math.abs(projection.crossTrackMeters)
        if (!Number.isFinite(along) || !Number.isFinite(cross)) continue
        if (along < 0 || along > legLengthMeters) continue
        if (nearest === undefined || cross < nearest) nearest = cross
      }
    }
  }
  return nearest
}

/** Sample a coastline segment into at most ~20 interior points so a near pass is caught. */
function densifySegment (a: number[], b: number[]): number[][] {
  const steps = 20
  const out: number[][] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- test/route-draft-leg-geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/leg-geometry.ts test/route-draft-leg-geometry.test.ts
git commit -m "feat(route-draft): add open-polyline geometry for the coastline check"
```

### Task 5: Extract the OpenSeaMap element-to-summary mapper

**Files:**
- Create: `src/inputs/openseamap/element-summary.ts`
- Modify: `src/inputs/openseamap/openseamap-source.ts`
- Test: `test/openseamap-source.test.ts` stays green

- [ ] **Step 1: Move `toSummary` (and the helpers it needs) into the shared module**

Create `src/inputs/openseamap/element-summary.ts` and move `elementId`, `elementOsmUrl`, `elementName`, `attachClearance`, and `toSummary` from `openseamap-source.ts`, exporting `toSummary` and `elementId`. They import `elementMarking` from `./seamark-mapping.js`, `parseOsmClearanceMeters` from `./clearance.js`, `tagValue` from `./openseamap-detail.js`, and the shared id and types. Keep the `OPENSEAMAP_ATTRIBUTION` and `OSM_ELEMENT_URL_PREFIX` constants with them (or re-export).

- [ ] **Step 2: Import them back into `openseamap-source.ts`**

```typescript
import { toSummary, elementId } from './element-summary.js'
```

Delete the moved bodies. `toDetailView` still lives in the source (it builds the detail view, not the summary); if it shares `elementName`/`attachClearance`, import those from `element-summary.js` too.

- [ ] **Step 3: Run the OpenSeaMap source tests**

Run: `npm test -- test/openseamap-source.test.ts`
Expected: PASS unchanged.

- [ ] **Step 4: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/inputs/openseamap/element-summary.ts src/inputs/openseamap/openseamap-source.ts
git commit -m "refactor(openseamap): extract the element-to-summary mapper for reuse"
```

### Task 6: Add the Overpass coastline surface and a threaded abort signal

**Files:**
- Modify: `src/inputs/openseamap/overpass-client.ts`
- Create: `src/inputs/openseamap/coastline-query.ts`
- Create: `test/openseamap-coastline-query.test.ts`
- Modify: `test/overpass-client.test.ts`

- [ ] **Step 1: Add a generic query method, a threaded signal, and a way-geometry parse to the client**

In `src/inputs/openseamap/overpass-client.ts`:

1. Add `signal?: AbortSignal` to `listPointsOfInterest` and `getById` on the `OverpassClient` interface and thread it into `http.fetch` (the shared client must pass `init.signal` through; if it overwrites the signal, combine with `AbortSignal.any([existing, callerSignal])` so plugin-stop and the caller deadline both abort). Verify `createHttpClient`'s `fetch` honors a passed signal; if it hard-overwrites, add a `signal` param to its `fetch` options and combine there.
2. Add a `CoastlineWay` shape and a `listCoastlineWays` method:

```typescript
export interface CoastlineWay {
  /** Ordered [lon, lat] vertices of one coastline way. */
  points: number[][]
}

// On the OverpassClient interface:
listCoastlineWays: (bbox: Bbox, signal?: AbortSignal) => Promise<CoastlineWay[]>
```

3. Build the query and a geometry parser. `out geom` returns a `geometry` array of `{ lat, lon }` per way:

```typescript
function buildCoastlineQuery (bbox: Bbox): string {
  const { south, west, north, east } = clampBbox(bbox)
  return (
    `[out:json][timeout:${LIST_QUERY_TIMEOUT_SECONDS}][bbox:${south},${west},${north},${east}];` +
    'way["natural"="coastline"];' +
    'out geom;'
  )
}
```

Add a `runRawQuery(query, errorPrefix, signal)` that returns the parsed `OverpassResponse` (not normalized elements), reusing the endpoint failover loop. Parse coastline ways: for each wire element with a `geometry` array, map to `{ points: geometry.map((g) => [g.lon, g.lat]) }`, dropping ways with fewer than two valid points. The existing `runQuery` can be refactored to call `runRawQuery` then `parseElement`, so both share failover, headers, the User-Agent, and the signal.

- [ ] **Step 2: Write the coastline query module**

`src/inputs/openseamap/coastline-query.ts`:

```typescript
/**
 * natural=coastline Overpass query for the route-draft land check. An internal
 * capability, not published as POIs, mirroring how depth-area-query.ts sits
 * under inputs/noaa-enc. Tiles a wide bbox into sub-boxes no larger than the
 * Overpass client's clamp so coverage is never silently truncated.
 */

import type { OverpassClient, CoastlineWay } from './overpass-client.js'
import { tileBbox } from '../../shared/bbox-tiles.js'
import type { Bbox } from '../../shared/types.js'

export async function queryCoastline (
  client: OverpassClient, bbox: Bbox, signal?: AbortSignal
): Promise<CoastlineWay[]> {
  const tiles = tileBbox(bbox, 2)
  const perTile = await Promise.all(tiles.map((t) => client.listCoastlineWays(t, signal)))
  return perTile.flat()
}
```

- [ ] **Step 3: Write the bbox tiler**

Create `src/shared/bbox-tiles.ts`:

```typescript
/**
 * Split a bbox into sub-boxes no larger than maxSpanDegrees on either edge, so a
 * route-draft Overpass query covers a wide box completely rather than letting the
 * client's center clamp silently truncate it. A box already within the span
 * returns as a single tile.
 */

import type { Bbox } from './types.js'

export function tileBbox (bbox: Bbox, maxSpanDegrees: number): Bbox[] {
  const tiles: Bbox[] = []
  const latCount = Math.max(1, Math.ceil((bbox.north - bbox.south) / maxSpanDegrees))
  const lonCount = Math.max(1, Math.ceil((bbox.east - bbox.west) / maxSpanDegrees))
  const latStep = (bbox.north - bbox.south) / latCount
  const lonStep = (bbox.east - bbox.west) / lonCount
  for (let i = 0; i < latCount; i += 1) {
    for (let j = 0; j < lonCount; j += 1) {
      tiles.push({
        south: bbox.south + latStep * i,
        north: bbox.south + latStep * (i + 1),
        west: bbox.west + lonStep * j,
        east: bbox.west + lonStep * (j + 1)
      })
    }
  }
  return tiles
}
```

Add `test/shared-bbox-tiles.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { tileBbox } from '../src/shared/bbox-tiles.js'

test('a small bbox returns a single tile', () => {
  assert.equal(tileBbox({ south: 0, north: 1, west: 0, east: 1 }, 2).length, 1)
})

test('a 5x5 degree bbox tiles into 3x3 sub-boxes each within the span', () => {
  const tiles = tileBbox({ south: 0, north: 5, west: 0, east: 5 }, 2)
  assert.equal(tiles.length, 9)
  for (const t of tiles) {
    assert.ok(t.north - t.south <= 2 + 1e-9 && t.east - t.west <= 2 + 1e-9)
  }
})
```

- [ ] **Step 4: Write the coastline query test with a stub client**

`test/openseamap-coastline-query.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { queryCoastline } from '../src/inputs/openseamap/coastline-query.js'
import type { OverpassClient, CoastlineWay } from '../src/inputs/openseamap/overpass-client.js'

function stubClient (ways: CoastlineWay[], calls: { n: number }): OverpassClient {
  return {
    listPointsOfInterest: async () => [],
    getById: async () => undefined,
    listCoastlineWays: async () => { calls.n += 1; return ways },
    close: () => {}
  }
}

test('queryCoastline tiles a wide bbox into multiple client calls and unions the ways', async () => {
  const calls = { n: 0 }
  const client = stubClient([{ points: [[0, 0], [1, 1]] }], calls)
  const ways = await queryCoastline(client, { south: 0, north: 5, west: 0, east: 5 })
  assert.equal(calls.n, 9)
  assert.equal(ways.length, 9)
})
```

Run: `npm test -- test/shared-bbox-tiles.test.ts test/openseamap-coastline-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a client test for the coastline parse and the threaded signal**

In `test/overpass-client.test.ts`, follow the existing fetch-stub pattern to assert that `listCoastlineWays` issues a `natural=coastline` query, parses `geometry` into `points`, and that an already-aborted signal rejects. (Match the file's existing mock-fetch helper.)

Run: `npm test -- test/overpass-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/inputs/openseamap/overpass-client.ts src/inputs/openseamap/coastline-query.ts src/shared/bbox-tiles.ts test/openseamap-coastline-query.test.ts test/shared-bbox-tiles.test.ts test/overpass-client.test.ts
git commit -m "feat(openseamap): add coastline query, bbox tiling, and a threaded abort signal"
```

### Task 7: Build the OpenSeaMap provider

**Files:**
- Create: `src/route-draft/providers/openseamap-provider.ts`
- Create: `test/route-draft-openseamap-provider.test.ts`

- [ ] **Step 1: Write the failing provider tests with stub clients**

`test/route-draft-openseamap-provider.test.ts` exercises: a coastline crossing yields a `land` flag; a hazard seamark in the corridor yields a `hazard` flag via `checkHazards`; an OSM-only leg's `checkLeg` reports `coverage.land` and the provider has no `depth` capability; the hazard query is hard-coded to rock, wreck, and obstruction regardless of any config. Use a stub `OverpassClient` whose `listCoastlineWays` returns a crossing way and whose `listPointsOfInterest` returns a `seamark:type=wreck` element near the leg.

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenSeaMapProvider } from '../src/route-draft/providers/openseamap-provider.js'
import type { OverpassClient } from '../src/inputs/openseamap/overpass-client.js'
import type { Position } from '../src/shared/types.js'

const FROM: Position = { latitude: 43.0, longitude: 5.0 }
const TO: Position = { latitude: 43.2, longitude: 5.0 }

function client (overrides: Partial<OverpassClient> = {}): OverpassClient {
  return {
    listPointsOfInterest: async () => [],
    getById: async () => undefined,
    listCoastlineWays: async () => [],
    close: () => {},
    ...overrides
  }
}

const params = {
  waypoints: [FROM, TO], draftMeters: 2, safetyMarginMeters: 1,
  standoffNm: 0.5, corridorHalfWidthMeters: 500, bands: [] as never[]
}

test('flags land when the leg crosses an OSM coastline way', async () => {
  const provider = createOpenSeaMapProvider({
    client: client({ listCoastlineWays: async () => [{ points: [[4.9, 43.1], [5.1, 43.1]] }] }),
    scanRouteCorridor: (await import('../src/outputs/route-hazard/route-corridor.js')).scanRouteCorridor
  })
  const result = await provider.checkLeg(0, FROM, TO, params as never)
  assert.equal(result.coverage.land, 'data')
  assert.ok(result.flags.some((f) => f.kind === 'land' && /coastline/i.test(f.message)))
})

test('emits an unconditional depth-not-checked flag on an OSM leg', async () => {
  const provider = createOpenSeaMapProvider({ client: client(), scanRouteCorridor: () => [] })
  const result = await provider.checkLeg(0, FROM, TO, params as never)
  assert.ok(result.flags.some((f) => f.kind === 'other' && /depth not checked/i.test(f.message)))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/route-draft-openseamap-provider.test.ts`
Expected: FAIL with "createOpenSeaMapProvider is not a function".

- [ ] **Step 3: Implement the provider**

`src/route-draft/providers/openseamap-provider.ts`. Capabilities are `land` and `hazards` (no depth). `coversLeg` is always true (global footprint). `checkLeg` queries coastline over the standoff-expanded leg bbox, flags a crossing and a standoff under-run via the polyline helpers, reports `coverage.land`, and always pushes an explicit depth-not-checked flag. `checkHazards` queries hazard seamarks over the route bbox (tiled), maps elements to `PoiSummary` via the extracted mapper, runs `scanRouteCorridor`, and emits global-indexed flags.

```typescript
import { isInEncCoverage } from '../../shared/regions.js'
import { positionToBbox, unionBbox } from '../../geo/position-utilities.js'
import { metersFromNauticalMiles, METERS_PER_NAUTICAL_MILE } from '../../shared/length.js'
import { polylineCrossesLeg, nearestPolylineApproachMeters } from '../leg-geometry.js'
import { queryCoastline } from '../../inputs/openseamap/coastline-query.js'
import { tileBbox } from '../../shared/bbox-tiles.js'
import { toSummary } from '../../inputs/openseamap/element-summary.js'
import type { OverpassClient } from '../../inputs/openseamap/overpass-client.js'
import type { LegSafetyProvider, LegProviderResult, LegRef, Dimension } from './provider.js'
import type { LegCheckParams, LegFlag } from '../safety-check.js'
import type { CorridorPoi, PoiSummary, Bbox, RoutePolyline } from '../../shared/types.js'

/** Hazard seamark types, hard-coded so a disabled display group cannot drop the check. */
const HAZARD_SEAMARK_REGEX = '^(rock|wreck|obstruction)$'
const OSM_CAPABILITIES: ReadonlySet<Dimension> = new Set<Dimension>(['land', 'hazards'])

export interface OpenSeaMapProviderDeps {
  client: OverpassClient
  scanRouteCorridor: (input: { route: RoutePolyline, pois: PoiSummary[], corridorHalfWidthMeters: number }) => CorridorPoi[]
  logger?: { debug: (m: string) => void, error: (m: string) => void }
}

export function createOpenSeaMapProvider (deps: OpenSeaMapProviderDeps): LegSafetyProvider {
  return {
    id: 'openseamap',
    capabilities: OSM_CAPABILITIES,
    coversLeg: () => true,
    checkLeg: async (leg, from, to, params): Promise<LegProviderResult> => {
      const flags: LegFlag[] = []
      const standoffMeters = metersFromNauticalMiles(params.standoffNm)
      const bbox = unionBbox(positionToBbox(from, standoffMeters), positionToBbox(to, standoffMeters))
      let ways
      try {
        ways = await queryCoastline(deps.client, bbox, params.signal)
      } catch (error) {
        deps.logger?.debug(`leg ${leg} coastline query failed: ${String(error)}`)
        flags.push({ leg, kind: 'other', message: 'land not checked for this leg: the OpenStreetMap coastline query failed' })
        flags.push({ leg, kind: 'other', message: 'depth not checked here, no depth source covers this leg, verify on the chart' })
        return { flags, coverage: { land: 'nodata' } }
      }
      const lines = ways.map((w) => w.points)
      if (polylineCrossesLeg(from, to, lines)) {
        flags.push({ leg, kind: 'land', message: 'Crosses the OpenStreetMap coastline, verify on the chart (absence of a crossing is not proof of clear water)' })
      } else {
        const nearest = nearestPolylineApproachMeters(from, to, lines)
        if (nearest !== undefined && nearest < standoffMeters) {
          const nm = (nearest / METERS_PER_NAUTICAL_MILE).toFixed(2)
          flags.push({ leg, kind: 'other', message: `Nearest OpenStreetMap coastline is ${nm} nm off this leg, under the ${params.standoffNm} nm standoff` })
        }
      }
      // Depth is never an OSM capability: always explicit, never suppressed by a crossing.
      flags.push({ leg, kind: 'other', message: 'depth not checked here, no depth source covers this leg, verify on the chart' })
      return { flags, coverage: { land: 'data' } }
    },
    checkHazards: async (legs: LegRef[], params): Promise<LegFlag[]> => {
      return await scanOsmHazards(deps, legs, params)
    }
  }
}
```

Write `scanOsmHazards`: build the route bbox from the legs expanded by `corridorHalfWidthMeters`, tile it, call `client.listPointsOfInterest(tile, HAZARD_SEAMARK_REGEX, params.signal)` per tile, keep only `type === 'Hazard'` summaries via `toSummary`, run `scanRouteCorridor` over a `RoutePolyline` built from `legs` (waypoints = the leg endpoints, `vesselPosition: null`), and map each corridor hit to a global leg index using the same `cumulativeLegStartMeters`/`legForAlongTrack` the orchestrator exposes (import them from `safety-check.js`, or pass them in). Emit `{ leg, kind: 'hazard', message: 'OpenStreetMap-charted <type> within the leg corridor' }`. Dedupe against ENC happens in the orchestrator (Task 8), not here.

- [ ] **Step 4: Run the provider tests**

Run: `npm test -- test/route-draft-openseamap-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/providers/openseamap-provider.ts test/route-draft-openseamap-provider.test.ts
git commit -m "feat(route-draft): add the OpenSeaMap hazard and coastline-land provider"
```

### Task 8: Switch the orchestrator to the per-leg union and wire OSM

**Files:**
- Modify: `src/route-draft/safety-check.ts`
- Modify: `src/route-draft/endpoint.ts`
- Modify: `src/plugin/plugin.ts`
- Modify: `test/route-draft-safety-check.test.ts` (becomes the orchestrator suite)
- Modify: `test/route-draft-enc-provider.test.ts` (the ENC-behavior tests)

- [ ] **Step 1: Change the orchestrator to accept a provider list and resolve per leg**

Replace the phase-1 `checkLegs` internals: remove the whole-route outside-US guard, build the provider list from injected deps (ENC, then OpenSeaMap, in precedence order), and per leg call `resolveProviders`. For each leg, run every active provider's `checkLeg` concurrently; merge flags; for each dimension in `{depth, land}`, if no active provider reported `coverage` for it, or every responsible provider reported `nodata` and none reported `data`, emit one explicit not-checked flag (deduped per dimension per region downstream). Run each hazard-capable active provider's `checkHazards` over the legs it covers. Dedupe ENC and OSM hazards by rounded position and type, preferring ENC. Keep `cumulativeLegStartMeters`, `legForAlongTrack`, and the bounded-concurrency pool. Add the not-checked dedup: collapse identical `(kind, message)` flags that are not leg-specific into one.

Update `LegCheckDeps` to carry what the providers need: `client` (ENC), `queryChartedAreas`, `scanRouteCorridor`, `overpass` (OverpassClient), `isInUsWaters` is no longer used by the orchestrator (the resolver uses the regions module) but keep it injectable for tests, and `logger`. `checkLegs` keeps returning `LegCheckResult`.

- [ ] **Step 2: Update the endpoint to pass the new deps**

In `src/route-draft/endpoint.ts`, add `overpass: OverpassClient` to `RouteDraftService`, and in `handleDraft` pass `overpass: service.overpass` into the `checkLegs` deps. No response-shape change.

- [ ] **Step 3: Build and close the Overpass client in the service**

In `src/plugin/plugin.ts` `startRouteDraft`, after `const enc = createEncDirectClient()` add:

```typescript
const overpass = createOverpassClient(
  resolvePrimaryEndpoint(undefined),
  { debug: (m) => { app.debug(m) }, error: (m) => { app.error(m) } },
  // A lighter spacing than the display client, since the route-draft burst is
  // bounded, tiled, and admin-gated, and must fit inside the request deadline.
  { minDelayMs: 250 }
)
```

Add `overpass` to the `routeDraftService` object literal, and close it in `teardown` alongside the ENC client. Import `createOverpassClient` and `resolvePrimaryEndpoint`.

- [ ] **Step 4: Retarget the tests**

Split the suites:
- `test/route-draft-enc-provider.test.ts`: keep the depth, land, drying, standoff, best-band, one-query-per-band, and the charted-query-rejects-degrade tests, calling `createEncProvider(...).checkLeg/checkHazards` directly with the existing stub deps.
- `test/route-draft-safety-check.test.ts`: keep the orchestrator tests. Replace "degrades when the route leaves US ENC coverage" with "a non-US leg is checked by OpenSeaMap, not refused": give a Mediterranean leg, stub the Overpass coastline and hazard calls, and assert a `land` flag (or land-not-checked on a stubbed failure) and an explicit depth-not-checked flag, never the old whole-route refusal. Keep the deadline-abort test at the orchestrator level, asserting every provider's in-flight query is aborted.

Add new orchestrator tests: a US leg runs ENC only when OSM returns nothing extra (assert no duplicate hazard), a US-envelope-overlapping-foreign leg (Miami to Bimini coordinates) runs both ENC and OSM, ENC and OSM hazards dedupe by position and type, and identical not-checked flags dedupe per dimension.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/safety-check.ts src/route-draft/endpoint.ts src/plugin/plugin.ts test/route-draft-safety-check.test.ts test/route-draft-enc-provider.test.ts
git commit -m "feat(route-draft): resolve providers per leg and add worldwide OpenSeaMap checks"
```

---

## PHASE 3: EMODnet provider (European modeled depth)

Phase 3 adds the EMODnet client and the depth provider gated by the European envelope. A live-sample spike confirms the response shape before committing the parse.

### Task 9: Confirm the live EMODnet response shape

**Files:** none (verification only)

- [ ] **Step 1: Query the live service and record the shape**

Run:
```bash
curl -s 'https://rest.emodnet-bathymetry.eu/depth_profile?geom=LINESTRING(4.0%2053.0,4.2%2053.0)' | head -c 400
curl -s -o /dev/null -w '%{http_code}\n' 'https://rest.emodnet-bathymetry.eu/depth_sample?geom=POINT(10%2051)'
```
Expected: the profile is a flat JSON array of signed numbers or `null`; the out-of-coverage land sample returns 200 with a positive value or 204. Confirm the array is bare numbers (not per-cell objects). If the shape differs from the spec, stop and update the spec and this task before coding the parse.

### Task 10: Build the EMODnet client

**Files:**
- Create: `src/route-draft/emodnet/emodnet-client.ts`
- Create: `test/route-draft-emodnet-client.test.ts`

- [ ] **Step 1: Write the failing client test**

`test/route-draft-emodnet-client.test.ts` asserts the client builds a `LINESTRING(lon lat,...)` geom in lon-lat order, parses a flat array dropping nulls, returns the samples, treats an all-null array and a 204 as no data, and rejects on a 5xx. Inject the `requestText` transport so no live HTTP runs:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmodnetClient } from '../src/route-draft/emodnet/emodnet-client.js'
import type { Position } from '../src/shared/types.js'

const LEG: [Position, Position] = [
  { latitude: 53, longitude: 4 }, { latitude: 53, longitude: 4.2 }
]

test('builds a lon-lat LINESTRING and parses the non-null samples', async () => {
  let requested = ''
  const client = createEmodnetClient({
    requestText: async (url) => { requested = url; return { status: 200, body: '[-10.5, null, -8.2]', headers: {} } }
  })
  const result = await client.depthProfile(LEG[0], LEG[1])
  assert.match(decodeURIComponent(requested), /LINESTRING\(4 53,4\.2 53\)/)
  assert.deepEqual(result, { samples: [-10.5, -8.2] })
})

test('an all-null array is no data', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 200, body: '[null, null]', headers: {} }) })
  assert.deepEqual(await client.depthProfile(LEG[0], LEG[1]), { samples: [] })
})

test('a 204 is no data', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 204, body: '', headers: {} }) })
  assert.deepEqual(await client.depthProfile(LEG[0], LEG[1]), { samples: [] })
})

test('a 500 rejects', async () => {
  const client = createEmodnetClient({ requestText: async () => ({ status: 500, body: 'err', headers: {} }) })
  await assert.rejects(() => client.depthProfile(LEG[0], LEG[1]))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/route-draft-emodnet-client.test.ts`
Expected: FAIL with "createEmodnetClient is not a function".

- [ ] **Step 3: Implement the client**

`src/route-draft/emodnet/emodnet-client.ts`:

```typescript
/**
 * EMODnet bathymetry depth-profile client. GET-only on the shared one-shot
 * transport (low-volume, one request per EU leg, honors the caller signal,
 * degrades on failure, no auth needed). The depth_profile endpoint returns a
 * flat JSON array of signed depth values or null, one per DTM cell, in meters
 * referenced to LAT. WKT axis order is longitude then latitude.
 */

import { requestText, type OneShotResponse } from '../../inputs/http-one-shot.js'
import { PLUGIN_USER_AGENT } from '../../shared/plugin-id.js'
import { MS_PER_SECOND } from '../../shared/time.js'
import type { Position } from '../../shared/types.js'

const BASE_URL = 'https://rest.emodnet-bathymetry.eu/depth_profile'
const REQUEST_TIMEOUT_MS = 15 * MS_PER_SECOND

export interface EmodnetProfile { samples: number[] }

export interface EmodnetClient {
  depthProfile: (from: Position, to: Position, signal?: AbortSignal) => Promise<EmodnetProfile>
}

export interface EmodnetClientDeps {
  requestText?: (url: string, headers: Record<string, string>, timeoutMs: number, label: string, signal?: AbortSignal) => Promise<OneShotResponse>
}

function lonLat (p: Position): string { return `${p.longitude} ${p.latitude}` }

export function createEmodnetClient (deps: EmodnetClientDeps = {}): EmodnetClient {
  const get = deps.requestText ?? requestText
  return {
    depthProfile: async (from, to, signal): Promise<EmodnetProfile> => {
      const geom = encodeURIComponent(`LINESTRING(${lonLat(from)},${lonLat(to)})`)
      const url = `${BASE_URL}?geom=${geom}`
      const res = await get(url, { 'User-Agent': PLUGIN_USER_AGENT, Accept: 'application/json' }, REQUEST_TIMEOUT_MS, 'EMODnet', signal)
      if (res.status === 204 || res.body.trim() === '') return { samples: [] }
      if (res.status < 200 || res.status >= 300) throw new Error(`EMODnet depth_profile failed: HTTP ${res.status}`)
      let raw: unknown
      try { raw = JSON.parse(res.body) } catch { throw new Error('EMODnet depth_profile returned non-JSON') }
      if (!Array.isArray(raw)) throw new Error('EMODnet depth_profile did not return an array')
      const samples = raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      return { samples }
    }
  }
}
```

- [ ] **Step 4: Run the client tests**

Run: `npm test -- test/route-draft-emodnet-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/emodnet/emodnet-client.ts test/route-draft-emodnet-client.test.ts
git commit -m "feat(route-draft): add the EMODnet depth-profile client"
```

### Task 11: Build the EMODnet provider

**Files:**
- Create: `src/route-draft/providers/emodnet-provider.ts`
- Create: `test/route-draft-emodnet-provider.test.ts`

- [ ] **Step 1: Write the failing provider tests**

`test/route-draft-emodnet-provider.test.ts` covers: shallowest = `max()` of the non-null samples (negative below datum); a value under draft-plus-margin flags shallow with the LAT and modeled-awareness wording; a positive sample is flagged as drying or land, never a depth; a partial-null profile adds the incomplete-gaps caveat; an all-empty profile reports `coverage.depth = 'nodata'`; every checked leg carries the modeled-data caveat; and `coversLeg` is false outside the European envelope.

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmodnetProvider } from '../src/route-draft/providers/emodnet-provider.js'
import type { Position } from '../src/shared/types.js'

const MED_FROM: Position = { latitude: 43.0, longitude: 5.0 }
const MED_TO: Position = { latitude: 43.1, longitude: 5.0 }
const params = { waypoints: [MED_FROM, MED_TO], draftMeters: 2, safetyMarginMeters: 1, standoffNm: 0.5, corridorHalfWidthMeters: 500, bands: [] as never[] }

function provider (samples: number[]) {
  return createEmodnetProvider({ client: { depthProfile: async () => ({ samples }) } })
}

test('flags shallow with LAT and modeled wording when max() is under draft plus margin', async () => {
  const result = await provider([-2.5, -10, -8]).checkLeg(0, MED_FROM, MED_TO, params as never)
  const shallow = result.flags.find((f) => f.kind === 'shallow')
  assert.ok(shallow)
  assert.match(shallow!.message, /2\.5 m/)
  assert.match(shallow!.message, /LAT/)
  assert.match(shallow!.message, /modeled|EMODnet/i)
  assert.equal(result.coverage.depth, 'data')
})

test('a positive sample is land or drying, never reported as a depth', async () => {
  const result = await provider([3.2, -20]).checkLeg(0, MED_FROM, MED_TO, params as never)
  assert.ok(result.flags.some((f) => f.kind === 'land'))
  assert.equal(result.flags.some((f) => f.kind === 'shallow' && /3\.2/.test(f.message)), false)
})

test('an empty profile is not checked', async () => {
  const result = await provider([]).checkLeg(0, MED_FROM, MED_TO, params as never)
  assert.equal(result.coverage.depth, 'nodata')
})

test('does not cover a US leg', () => {
  assert.equal(provider([]).coversLeg({ latitude: 40, longitude: -74 }, { latitude: 41, longitude: -74 }), false)
})
```

For the partial-gap caveat test, extend `EmodnetProfile` to also report whether any cell was null (see Step 3).

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- test/route-draft-emodnet-provider.test.ts`
Expected: FAIL with "createEmodnetProvider is not a function".

- [ ] **Step 3: Implement the provider**

Extend the client's `EmodnetProfile` to `{ samples: number[], hadGap: boolean }` (set `hadGap` when the raw array contained a null among non-empty data) so the provider can emit the partial-gap caveat; update the client and its tests accordingly. Then:

`src/route-draft/providers/emodnet-provider.ts`:

```typescript
import { isInEmodnetCoverage } from '../../shared/regions.js'
import { formatMeters } from '../../shared/format-meters.js'
import type { EmodnetClient } from '../emodnet/emodnet-client.js'
import type { LegSafetyProvider, LegProviderResult, Dimension } from './provider.js'
import type { LegCheckParams, LegFlag } from '../safety-check.js'

const EMODNET_CAPABILITIES: ReadonlySet<Dimension> = new Set<Dimension>(['depth'])

export interface EmodnetProviderDeps {
  client: EmodnetClient
  logger?: { debug: (m: string) => void, error: (m: string) => void }
}

export function createEmodnetProvider (deps: EmodnetProviderDeps): LegSafetyProvider {
  return {
    id: 'emodnet',
    capabilities: EMODNET_CAPABILITIES,
    coversLeg: (from, to) => isInEmodnetCoverage(from) && isInEmodnetCoverage(to),
    checkLeg: async (leg, from, to, params): Promise<LegProviderResult> => {
      const flags: LegFlag[] = []
      let profile
      try {
        profile = await deps.client.depthProfile(from, to, params.signal)
      } catch (error) {
        deps.logger?.debug(`leg ${leg} EMODnet query failed: ${String(error)}`)
        flags.push({ leg, kind: 'other', message: 'depth not checked for this leg: the EMODnet query failed' })
        return { flags, coverage: { depth: 'nodata' } }
      }
      if (profile.samples.length === 0) {
        flags.push({ leg, kind: 'other', message: 'no EMODnet modeled depth here, verify on the chart' })
        return { flags, coverage: { depth: 'nodata' } }
      }
      // Negative below datum, so the shallowest navigable is the maximum value.
      const shallowest = Math.max(...profile.samples)
      const minimalContour = params.draftMeters + params.safetyMarginMeters
      if (shallowest >= 0) {
        // An above-datum sample is land or drying, never a navigable depth.
        flags.push({ leg, kind: 'land', message: `EMODnet modeled terrain is ${formatMeters(shallowest)} m above LAT on this leg (drying or land), verify on the chart` })
      } else if (-shallowest < minimalContour) {
        flags.push({ leg, kind: 'shallow', message: `EMODnet modeled depth ${formatMeters(-shallowest)} m, LAT, awareness-grade and not charted, under the ${formatMeters(minimalContour)} m draft-plus-margin contour` })
      }
      if (profile.hadGap) {
        flags.push({ leg, kind: 'other', message: 'EMODnet modeled depth is incomplete on this leg, gaps not checked, verify on the chart' })
      }
      // Awareness caveat on every checked leg, so a clean leg is not read as charted clearance.
      flags.push({ leg, kind: 'other', message: 'depth on this leg is EMODnet modeled bathymetry referenced to LAT, awareness-grade and not charted, verify on the chart' })
      return { flags, coverage: { depth: 'data' } }
    }
  }
}
```

Note `formatMeters` reports a magnitude; depths are printed as positive meters of water (`-shallowest`), elevations as positive meters above LAT, so no negative number is ever printed, matching the ENC drying-area rule.

- [ ] **Step 4: Run the provider tests**

Run: `npm test -- test/route-draft-emodnet-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/providers/emodnet-provider.ts src/route-draft/emodnet/emodnet-client.ts test/route-draft-emodnet-provider.test.ts test/route-draft-emodnet-client.test.ts
git commit -m "feat(route-draft): add the EMODnet modeled-depth provider"
```

### Task 12: Wire EMODnet into the service and orchestrator

**Files:**
- Modify: `src/route-draft/safety-check.ts`
- Modify: `src/route-draft/endpoint.ts`
- Modify: `src/plugin/plugin.ts`
- Modify: `test/route-draft-safety-check.test.ts`

- [ ] **Step 1: Add EMODnet to the provider list**

In `safety-check.ts`, build the provider list as `[enc, emodnet, openseamap]` (precedence order) from the injected deps. EMODnet `coversLeg` already gates to the European envelope, so it is inert elsewhere. Where both ENC and EMODnet report depth on a leg (rare envelope overlap), prefer ENC: when ENC reported `coverage.depth === 'data'`, drop EMODnet's depth flags for that leg.

- [ ] **Step 2: Add the EMODnet client to the service**

Add `emodnet: EmodnetClient` to `RouteDraftService` in `endpoint.ts`, pass it into the `checkLegs` deps in `handleDraft`, and in `plugin.ts` `startRouteDraft` add `const emodnet = createEmodnetClient()` to the service literal. The EMODnet one-shot client holds no sockets between calls, so it needs no `close`.

- [ ] **Step 3: Add the orchestrator EU and overlap tests**

In `test/route-draft-safety-check.test.ts`, add: a Mediterranean leg produces an EMODnet depth flag plus the OSM land and hazard checks; a US leg never invokes EMODnet (assert the stub is not called); and an ENC-and-EMODnet overlap leg prefers the ENC depth flag.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/route-draft/safety-check.ts src/route-draft/endpoint.ts src/plugin/plugin.ts test/route-draft-safety-check.test.ts
git commit -m "feat(route-draft): add EMODnet European depth to the per-leg check"
```

### Task 13: Documentation and release prep

**Files:**
- Modify: `CLAUDE.md`, `CHANGELOG.md`, `README.md`, `package.json`

- [ ] **Step 1: Update the architecture docs**

In `CLAUDE.md`, update the `route-draft/` description and the layout tree: add `providers/` (provider.ts, enc-provider.ts, openseamap-provider.ts, emodnet-provider.ts), `emodnet/emodnet-client.ts`, `leg-geometry.ts`, `inputs/openseamap/coastline-query.ts`, `inputs/openseamap/element-summary.ts`, `shared/regions.ts`, and `shared/bbox-tiles.ts`. Rewrite the `safety-check.ts` line to describe the orchestrator and the per-leg union. Document the placement rule: the coastline query lives under `inputs/openseamap` because it reuses the Overpass client, the EMODnet client lives under `route-draft` because it has no POI-source counterpart, mirroring `depth-area-query.ts` under `inputs/noaa-enc`.

- [ ] **Step 2: Update the CHANGELOG and README**

Add a dated `CHANGELOG.md` entry: the route-draft safety check now covers worldwide routes, with OpenSeaMap point hazards and OpenStreetMap coastline land worldwide and EMODnet modeled depth (awareness-grade, referenced to LAT) in European seas, every unverified dimension flagged explicitly. Overwrite the README "What's New" section to the new version. Add the EMODnet CC-BY citation to the README attribution section and note OSM coastline is ODbL.

- [ ] **Step 3: Bump the version**

Bump `package.json` `version` per the release checklist, refresh the lockfile if dependencies changed.

- [ ] **Step 4: Run every gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md CHANGELOG.md README.md package.json package-lock.json
git commit -m "docs(route-draft): document the worldwide safety check and bump the version"
```

---

## Self-Review

**Spec coverage:** Worldwide hazards (Task 7), worldwide coastline land (Tasks 4, 6, 7), EU EMODnet depth (Tasks 9-12), per-leg union resolver (Tasks 2, 8), per-dimension coverage contract (Tasks 2, 3, 8), not-checked-by-responsibility plus dedup (Task 8), hazard sweep decoupled from depth and run per provider (Tasks 7, 8), ENC-and-OSM hazard dedupe and ENC-and-EMODnet depth precedence (Tasks 8, 12), the 2-degree clamp defeated by tiling (Task 6), threaded abort through Overpass (Task 6), EMODnet LAT datum, negative sign, positive-as-land, partial-gap, and awareness caveat (Task 11), lon-lat WKT (Task 10), phase-1 behavior preservation with the retained guard (Task 3), one release (Task 13), CLAUDE.md and attribution updates (Task 13). All spec sections map to a task.

**Placeholder scan:** The refactor tasks name exact functions and the destination modules rather than re-pasting hundreds of lines of already-tested code, which is the correct instruction for a move; every new module and every test has complete code. Task 9 is a deliberate live-verification gate, not a placeholder.

**Type consistency:** `LegSafetyProvider`, `LegProviderResult`, `LegDimensionCoverage`, `Coverage`, `LegRef`, and `Dimension` are defined once in `provider.ts` and used unchanged in every provider and the orchestrator. `EmodnetProfile` gains `hadGap` in Task 11 with the client and its tests updated together. `CoastlineWay` is defined in `overpass-client.ts` and consumed by `coastline-query.ts` and the provider. `checkLegs` keeps its signature through phase 1 and changes its deps shape in phase 2, with the tests retargeted in the same task.

**Open items carried from the spec:** whether to relocate `http-one-shot.ts` to `src/shared/` (left under `inputs`, imported by the EMODnet client, which is acceptable since route-draft already imports from `inputs`), and the exact US ENC envelope (reuses `isInUsWaters` via `regions.ts`). Neither blocks implementation.
