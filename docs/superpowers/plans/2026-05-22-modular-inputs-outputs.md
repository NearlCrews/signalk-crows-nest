# Modular Inputs and Outputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: this plan is executed by an
> agent team (up to 5 teammates), not subagents. Steps use checkbox (`- [ ]`)
> syntax for tracking. Teammates coordinate every edit to `src/index.ts` and
> the shared task list, because that file is the integration point.

**Goal:** Restructure `signalk-crows-nest` so a new POI data source (an input)
or a new SignalK consumer of POI data (an output) is added by writing one
self-contained module and registering it on one line, with no runtime
behavior change.

**Architecture:** Two registries. An `InputRegistry` holds `InputModule`s,
each wrapping a `PoiSource`. An `OutputRegistry` holds `OutputModule`s, each a
consumer that `start()`s into an `OutputHandle`. Position-driven outputs return
a `PositionScanContributor` on their handle; the shared position monitor drives
the per-tick scan from the union of those contributors. `index.ts` becomes a
thin assembler; `plugin.ts` owns lifecycle and assembles the config schema from
per-module fragments. Files move into purpose-named directories and are
renamed kebab-case.

**Tech Stack:** TypeScript 6, `tsc` + webpack (Module Federation panel), ESLint
9 + neostandard, `node:test` via `tsx`, Node 20+.

**Spec:** `docs/superpowers/specs/2026-05-22-modular-inputs-outputs-design.md`

---

## Conventions for every task

- After any file change, the gate is: `npm run typecheck && npm run lint && npm test`.
  A move task is "done" only when all three are green.
- Move files with `git mv` so history is preserved.
- When a file moves, its imports break. Do not hand-enumerate them: run
  `npm run typecheck`, fix each reported path, repeat until clean. The compiler
  is the source of truth for what broke.
- Import specifiers keep the `.js` extension (node16 module resolution), e.g.
  `import { foo } from '../shared/types.js'`.
- Commit at the end of every task with a Conventional Commit message.
- No em dashes in any code, comment, commit message, or doc. Use the Oxford
  comma in lists of three or more.
- American English everywhere: every new file, comment, string, identifier,
  and doc uses American spelling (`meter`, `color`, `normalize`, `behavior`),
  never British. Phase 0 converts the existing code; nothing after it may
  reintroduce a British spelling.
- Every commit message ends with:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

## Team lanes

- **Lane A: shell** (anchor) - Phase 0, Phase 1, and Phase 5. Owns `index.ts`,
  `plugin/`, the registries, config assembly.
- **Lane B: inputs** - Phase 3A. Owns `src/inputs/`.
- **Lane C: notes output** - Phase 3B. Owns `src/outputs/notes-resource/`.
- **Lane D: position outputs** - Phase 3C. Owns `src/outputs/proximity-alarm/`,
  `src/outputs/route-hazard/`, `src/monitoring/`.
- **Lane E: panel, tests, docs** - Phase 4 and Phase 6. Owns `src/panel/`,
  `test/`, build-config verification, `CLAUDE.md`, `docs/`.

Phase 0, Phase 1, and Phase 2 run first and serially (Lane A). Phases 3A, 3B,
3C, and 4 run in parallel after Phase 2. Phase 5 integrates (Lane A) after
3A/3B/3C land. Phase 6 finishes (Lane E) after Phase 5.

---

# Phase 0: Convert the codebase to American English (Lane A)

The codebase currently uses British spellings (`metres`, `normalise`,
`sanitise`, `behaviour`, `colour`, `honours`, `centre`, `cancelled`,
`travelled`, `licence`). Phase 0 converts everything to American English before
the restructure, so every later move carries American spelling and every new
module is written American from the start. It runs first and keeps the build
green at every commit.

Brand and proper names are NOT changed: `ActiveCaptain`, `Garmin`, `SignalK`,
`Freeboard-SK`, `NMEA`, `neostandard`. Do not touch `node_modules`, `dist`, or
`public`.

### Task 0.1: Rename British identifiers in code

These identifiers carry British spelling. Rename each and update every
reference (including tests).

| British identifier | American | Location |
| --- | --- | --- |
| `honoursRetryAfter` | `honorsRetryAfter` | `src/activeCaptainClient.ts` (local var) |
| `sanitisePoiId` | `sanitizePoiId` | `src/proximityAlarms.ts` and `src/routeHazardAlarms.ts` (local fn, each file) |
| `travelledMeters` | `traveledMeters` | `src/positionMonitor.ts` (local var) |
| `normaliseConfig` | `normalizeConfig` | `src/panel/normaliseConfig.ts` (exported fn) |
| `metresNorth` | `metersNorth` | `test/proximityAlarms.test.ts` (param) |
| `cancelled` | `canceled` | `src/panel/hooks/useStatus.ts` (`useRef` var) |

The file `src/panel/normaliseConfig.ts` keeps its name in this phase (it is
renamed to `normalize-config.ts` in Task 4.1); only the exported identifier
`normaliseConfig` changes here.

- [ ] **Step 1: Rename each identifier**

For each row, rename the identifier in its defining file and update every
reference. `sanitisePoiId` is a separate local function in two files: rename
both. After each file, confirm with `grep`:

```bash
grep -rEnw "honoursRetryAfter|sanitisePoiId|travelledMeters|normaliseConfig|metresNorth" src test --include='*.ts' --include='*.tsx'
```

Expected: no output once every rename is done. (`cancelled` is a common word;
verify it only in `src/panel/hooks/useStatus.ts`.)

- [ ] **Step 2: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green, 212 tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: rename British-spelled identifiers to American English"
```

### Task 0.2: Convert British spellings in comments, strings, and tests

Convert British spelling in every comment, string literal, JSDoc block, schema
title, and `test(...)` description across `src/` and `test/`.

- [ ] **Step 1: Apply the substitutions**

Apply each substitution below, case-preserving (a capitalized British word maps
to the capitalized American word). Work file by file; these are word-boundary
replacements.

```
metre -> meter            metres -> meters
kilometre -> kilometer    kilometres -> kilometers
centre -> center          centred -> centered
behaviour -> behavior     colour -> color
honour -> honor           honoured -> honored        honours -> honors
normalise -> normalize    normalised -> normalized    normalises -> normalizes
sanitise -> sanitize      sanitises -> sanitizes      sanitised -> sanitized
humanise -> humanize      humanised -> humanized
localise -> localize      localised -> localized
cancelled -> canceled     labelled -> labeled         modelled -> modeled
travelled -> traveled     licence -> license
analyse -> analyze        prioritise -> prioritize
optimise -> optimize      recognise -> recognize
initialise -> initialize  organise -> organize
```

- [ ] **Step 2: Verify no British spelling remains**

```bash
grep -rEniw "metre|metres|kilometre|kilometres|centre|centred|behaviour|colour|honour|honours|honoured|normalise|normalised|sanitise|sanitised|humanised|localised|cancelled|labelled|modelled|travelled|licence|analyse|prioritise|optimise|recognise|initialise|organise" src test --include='*.ts' --include='*.tsx'
```

Expected: no output. Any line printed is a missed British spelling: fix it.
(`color` and `meter` already appear in American identifiers such as
`radiusMeters`; that is correct and expected.)

- [ ] **Step 3: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: convert source comments and strings to American English"
```

### Task 0.3: Convert British spellings in docs

**Files:**
- Modify: every file under `docs/`, plus `README.md` and `CLAUDE.md`

- [ ] **Step 1: Apply the same substitutions to docs**

Apply the Task 0.2 substitution table to `docs/**/*.md`, `README.md`, and
`CLAUDE.md`. Do not change the design spec or this plan under
`docs/superpowers/` (they are already American).

- [ ] **Step 2: Verify**

```bash
grep -rEniw "metre|metres|kilometre|centre|behaviour|colour|honour|normalise|sanitise|cancelled|travelled|licence|analyse" docs README.md CLAUDE.md --exclude-dir=superpowers
```

Expected: no output. Fix any printed line.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: convert documentation to American English"
```

---

# Phase 1: Directory skeleton and shared moves (Lane A)

Phase 1 keeps the build green at every commit. It does the low-risk moves
first so the parallel phases have stable target directories.

### Task 1.1: Create the directory skeleton

**Files:**
- Create: `src/inputs/.gitkeep`, `src/outputs/.gitkeep`, `src/monitoring/.gitkeep`,
  `src/geo/.gitkeep`, `src/status/.gitkeep`, `src/shared/.gitkeep`,
  `src/plugin/.gitkeep`, `src/inputs/active-captain/.gitkeep`,
  `src/outputs/notes-resource/.gitkeep`, `src/outputs/proximity-alarm/.gitkeep`,
  `src/outputs/route-hazard/.gitkeep`

- [ ] **Step 1: Create the directories**

```bash
mkdir -p src/inputs/active-captain src/outputs/notes-resource \
  src/outputs/proximity-alarm src/outputs/route-hazard \
  src/monitoring src/geo src/status src/shared src/plugin
for d in src/inputs src/inputs/active-captain src/outputs \
  src/outputs/notes-resource src/outputs/proximity-alarm \
  src/outputs/route-hazard src/monitoring src/geo src/status \
  src/shared src/plugin; do touch "$d/.gitkeep"; done
```

- [ ] **Step 2: Commit**

```bash
git add src && git commit -m "chore: scaffold modular input/output directories"
```

### Task 1.2: Move shared and geo modules

`types.ts`, `pluginId.ts`, and `positionUtilities.ts` have no intra-`src`
dependencies of their own (they are leaf modules), so moving them is safe.

**Files:**
- Move: `src/types.ts` -> `src/shared/types.ts`
- Move: `src/pluginId.ts` -> `src/shared/plugin-id.ts`
- Move: `src/positionUtilities.ts` -> `src/geo/position-utilities.ts`

- [ ] **Step 1: Move the files**

```bash
git mv src/types.ts src/shared/types.ts
git mv src/pluginId.ts src/shared/plugin-id.ts
git mv src/positionUtilities.ts src/geo/position-utilities.ts
```

- [ ] **Step 2: Fix every broken import**

Run `npm run typecheck`. For each `Cannot find module` error, update the
import specifier to the new relative path with the `.js` extension. Repeat
until `npm run typecheck` is clean. Also update imports in `test/`.

- [ ] **Step 3: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green, 212 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: move shared types and geo helpers into directories"
```

### Task 1.3: Move status modules

**Files:**
- Move: `src/pluginStatus.ts` -> `src/status/plugin-status.ts`
- Move: `src/statusRouter.ts` -> `src/status/status-router.ts`
- Move: `src/statusTypes.ts` -> `src/status/status-types.ts`

- [ ] **Step 1: Move the files**

```bash
git mv src/pluginStatus.ts src/status/plugin-status.ts
git mv src/statusRouter.ts src/status/status-router.ts
git mv src/statusTypes.ts src/status/status-types.ts
```

- [ ] **Step 2: Fix imports**

Run `npm run typecheck`; fix each reported path until clean. `statusTypes.ts`
is imported by `src/panel/` too: update those specifiers. Update `test/`
imports (`test/pluginStatus.test.ts`).

- [ ] **Step 3: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: move status modules into src/status"
```

---

# Phase 2: Interfaces and registries (Lane A)

Phase 2 adds new files only. The build stays green because nothing imports
them yet. These are the contracts the parallel phases code against, so Phase 2
must finish before Phases 3A/3B/3C start.

### Task 2.1: Define the input contracts

**Files:**
- Create: `src/inputs/poi-source.ts`
- Test: `test/poi-source.test.ts` (no test needed; pure type file, skip)

- [ ] **Step 1: Write `src/inputs/poi-source.ts`**

```typescript
/**
 * Input contracts.
 *
 * A `PoiSource` is one upstream provider of points of interest. An
 * `InputModule` packages a source for registration: it carries the id, the
 * config-schema fragment, an enablement check, and a factory. Adding a new POI
 * data source means implementing these two interfaces and registering the
 * module in `src/index.ts`.
 */

import type { ServerAPI } from '@signalk/server-api'
import type { PluginStatus } from '../status/plugin-status.js'
import type { Bbox, PluginConfig, PoiDetails, PoiSummary } from '../shared/types.js'

/** One upstream provider of points of interest. */
export interface PoiSource {
  /** Stable id of the source, e.g. `activecaptain`. */
  readonly id: string
  /**
   * List point-of-interest summaries within a bounding box, restricted to the
   * comma-separated, source-specific `poiTypes` filter. Rejects on failure.
   */
  listPointsOfInterest: (bbox: Bbox, poiTypes: string) => Promise<PoiSummary[]>
  /** Fetch the full detail for one point of interest by id. Rejects on failure. */
  getDetails: (id: string) => Promise<PoiDetails>
  /** Number of detail entries currently cached, for the status snapshot. */
  cacheSize: () => number
  /** Abort in-flight work and release resources. Called on plugin stop. */
  close: () => void
}

/** Dependencies handed to an {@link InputModule} when it builds its source. */
export interface InputContext {
  /** The SignalK app. */
  app: ServerAPI
  /** The resolved plugin configuration. */
  config: PluginConfig
  /** The status recorder; a source wires API outcomes into it. */
  status: PluginStatus
  /** Absolute path to the plugin data directory, for on-disk caches. */
  dataDir: string
}

/** A registrable POI data source. */
export interface InputModule {
  /** Stable id of the input, matching the `PoiSource.id` it creates. */
  readonly id: string
  /** Human-readable name, for logs. */
  readonly name: string
  /**
   * JSON Schema `properties` fragment merged into the plugin config schema.
   * Keyed by config property name.
   */
  readonly configSchema: Record<string, unknown>
  /** True when the current configuration enables this input. */
  isEnabled: (config: PluginConfig) => boolean
  /** Build the source. Called once per plugin start. */
  createSource: (context: InputContext) => PoiSource
}
```

- [ ] **Step 2: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green (new file, no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/inputs/poi-source.ts
git commit -m "feat: add PoiSource and InputModule contracts"
```

### Task 2.2: Define the output contracts

**Files:**
- Create: `src/outputs/output.ts`

- [ ] **Step 1: Write `src/outputs/output.ts`**

```typescript
/**
 * Output contracts.
 *
 * An `OutputModule` is one consumer of POI data. `start()` returns an
 * `OutputHandle`; a position-driven output also attaches a
 * `PositionScanContributor` to that handle, and the shared position monitor
 * drives the per-tick scan from the union of every contributor. Adding a new
 * output means implementing `OutputModule` and registering it in
 * `src/index.ts`.
 */

import type { ServerAPI } from '@signalk/server-api'
import type { PoiSource } from '../inputs/poi-source.js'
import type { PluginStatus } from '../status/plugin-status.js'
import type { Bbox, PluginConfig, PoiSummary, Position } from '../shared/types.js'

/**
 * A position-driven output's contribution to the shared per-tick scan. The
 * monitor calls `buildFetchBox` on every contributor to size one combined
 * list request, then calls `evaluate` on every contributor with the result.
 */
export interface PositionScanContributor {
  /** POI types this contributor needs included in the per-tick list request. */
  readonly poiTypes: readonly string[]
  /**
   * Build this contributor's fetch bounding box for the tick, or `null` when
   * it needs nothing fetched this tick. `tickPosition` is the throttled tick
   * position.
   */
  buildFetchBox: (tickPosition: Position) => Bbox | null
  /**
   * Evaluate the tick. `pois` is the combined list result, or `[]` when no
   * contributor produced a fetch box. `vesselPosition` is the latest fix.
   * Called on every tick so an output can clear stale alarms.
   */
  evaluate: (vesselPosition: Position, pois: PoiSummary[]) => void
}

/** Handle returned by {@link OutputModule.start}; the plugin stops it on teardown. */
export interface OutputHandle {
  /** Tear the output down. Idempotent. */
  stop: () => void
  /**
   * Present only on position-driven outputs. The plugin collects these and
   * builds the shared position monitor from them.
   */
  positionScan?: PositionScanContributor
}

/** Dependencies handed to an {@link OutputModule} when it starts. */
export interface OutputContext {
  /** The SignalK app. */
  app: ServerAPI
  /** The resolved plugin configuration. */
  config: PluginConfig
  /** The aggregate POI source. */
  pois: PoiSource
  /** The status recorder. */
  status: PluginStatus
}

/** A registrable consumer of POI data. */
export interface OutputModule {
  /** Stable id of the output, e.g. `notes-resource`. */
  readonly id: string
  /** Human-readable name, for logs. */
  readonly name: string
  /** JSON Schema `properties` fragment merged into the plugin config schema. */
  readonly configSchema: Record<string, unknown>
  /** True when the current configuration enables this output. */
  isEnabled: (config: PluginConfig) => boolean
  /** Start the output. Called once per plugin start, only when enabled. */
  start: (context: OutputContext) => OutputHandle
}
```

- [ ] **Step 2: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/outputs/output.ts
git commit -m "feat: add OutputModule and PositionScanContributor contracts"
```

### Task 2.3: Build the input registry (TDD)

**Files:**
- Create: `src/inputs/input-registry.ts`
- Test: `test/input-registry.test.ts`

- [ ] **Step 1: Write the failing test `test/input-registry.test.ts`**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { createInputRegistry } from '../src/inputs/input-registry.ts'
import type { InputModule, PoiSource } from '../src/inputs/poi-source.ts'

function stubSource (id: string): PoiSource {
  return {
    id,
    listPointsOfInterest: async () => [],
    getDetails: async () => { throw new Error('not used') },
    cacheSize: () => 0,
    close: () => {}
  }
}

function stubModule (id: string, enabled: boolean): InputModule {
  return {
    id,
    name: id,
    configSchema: { [`enable_${id}`]: { type: 'boolean' } },
    isEnabled: () => enabled,
    createSource: () => stubSource(id)
  }
}

const context = { app: {}, config: {}, status: {}, dataDir: '/tmp' } as never

test('configSchemaFragments returns every module fragment', () => {
  const registry = createInputRegistry([stubModule('a', true), stubModule('b', false)])
  assert.deepEqual(registry.configSchemaFragments(), [
    { enable_a: { type: 'boolean' } },
    { enable_b: { type: 'boolean' } }
  ])
})

test('createSource returns the enabled module source', () => {
  const registry = createInputRegistry([stubModule('a', false), stubModule('b', true)])
  assert.equal(registry.createSource(context).id, 'b')
})

test('createSource throws when no module is enabled', () => {
  const registry = createInputRegistry([stubModule('a', false)])
  assert.throws(() => registry.createSource(context), /no input is enabled/i)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/input-registry.test.ts`
Expected: FAIL, `Cannot find module '.../input-registry.ts'`.

- [ ] **Step 3: Write `src/inputs/input-registry.ts`**

```typescript
/**
 * Input registry.
 *
 * Holds the registered `InputModule`s, exposes their config-schema fragments,
 * and builds the aggregate `PoiSource` for a plugin start. With one enabled
 * input the aggregate is that input's source. Aggregating several sources
 * (merging list results, namespacing ids) is deferred work, documented in the
 * design spec; this is the seam where it will go.
 */

import type { InputContext, InputModule, PoiSource } from './poi-source.js'

/** Public surface of the input registry. */
export interface InputRegistry {
  /** The registered input modules, in registration order. */
  readonly modules: readonly InputModule[]
  /** Each module's config-schema fragment, in registration order. */
  configSchemaFragments: () => Array<Record<string, unknown>>
  /**
   * Build the aggregate POI source from the enabled inputs. Throws when no
   * input is enabled, since the plugin cannot serve resources without a source.
   */
  createSource: (context: InputContext) => PoiSource
}

/** Create an input registry over a fixed set of modules. */
export function createInputRegistry (modules: readonly InputModule[]): InputRegistry {
  return {
    modules,
    configSchemaFragments: () => modules.map((module) => module.configSchema),
    createSource: (context: InputContext): PoiSource => {
      const enabled = modules.filter((module) =>
        module.isEnabled(context.config))
      if (enabled.length === 0) {
        throw new Error('Cannot build a POI source: no input is enabled')
      }
      // One source today. Multi-source aggregation is deferred (see the spec).
      return enabled[0].createSource(context)
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/input-registry.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/inputs/input-registry.ts test/input-registry.test.ts
git commit -m "feat: add the input registry"
```

### Task 2.4: Build the output registry (TDD)

**Files:**
- Create: `src/outputs/output-registry.ts`
- Test: `test/output-registry.test.ts`

- [ ] **Step 1: Write the failing test `test/output-registry.test.ts`**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOutputRegistry } from '../src/outputs/output-registry.ts'
import type { OutputHandle, OutputModule } from '../src/outputs/output.ts'

function stubModule (id: string, enabled: boolean, onStop: () => void): OutputModule {
  return {
    id,
    name: id,
    configSchema: { [`enable_${id}`]: { type: 'boolean' } },
    isEnabled: () => enabled,
    start: (): OutputHandle => ({ stop: onStop })
  }
}

const context = { app: {}, config: {}, pois: {}, status: {} } as never

test('configSchemaFragments returns every module fragment', () => {
  const registry = createOutputRegistry([
    stubModule('a', true, () => {}),
    stubModule('b', true, () => {})
  ])
  assert.deepEqual(registry.configSchemaFragments(), [
    { enable_a: { type: 'boolean' } },
    { enable_b: { type: 'boolean' } }
  ])
})

test('startEnabled starts only enabled modules', () => {
  let started = ''
  const registry = createOutputRegistry([
    { ...stubModule('a', false, () => {}), start: () => { started += 'a'; return { stop: () => {} } } },
    { ...stubModule('b', true, () => {}), start: () => { started += 'b'; return { stop: () => {} } } }
  ])
  const handles = registry.startEnabled(context)
  assert.equal(started, 'b')
  assert.equal(handles.length, 1)
})

test('startEnabled isolates a failing module start', () => {
  const registry = createOutputRegistry([
    { ...stubModule('a', true, () => {}), start: () => { throw new Error('boom') } },
    stubModule('b', true, () => {})
  ])
  const handles = registry.startEnabled({ ...context, app: { error: () => {} } } as never)
  assert.equal(handles.length, 1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/output-registry.test.ts`
Expected: FAIL, `Cannot find module '.../output-registry.ts'`.

- [ ] **Step 3: Write `src/outputs/output-registry.ts`**

```typescript
/**
 * Output registry.
 *
 * Holds the registered `OutputModule`s, exposes their config-schema fragments,
 * and starts the enabled ones for a plugin start. A failing output start is
 * isolated and logged so one broken output cannot stop the others, mirroring
 * how the legacy entrypoint isolated the position monitor.
 */

import type { OutputContext, OutputHandle, OutputModule } from './output.js'

/** Public surface of the output registry. */
export interface OutputRegistry {
  /** The registered output modules, in registration order. */
  readonly modules: readonly OutputModule[]
  /** Each module's config-schema fragment, in registration order. */
  configSchemaFragments: () => Array<Record<string, unknown>>
  /**
   * Start every enabled output. A start that throws is logged through
   * `context.app.error` and skipped; the remaining outputs still start.
   */
  startEnabled: (context: OutputContext) => OutputHandle[]
}

/** Create an output registry over a fixed set of modules. */
export function createOutputRegistry (modules: readonly OutputModule[]): OutputRegistry {
  return {
    modules,
    configSchemaFragments: () => modules.map((module) => module.configSchema),
    startEnabled: (context: OutputContext): OutputHandle[] => {
      const handles: OutputHandle[] = []
      for (const module of modules) {
        if (!module.isEnabled(context.config)) {
          continue
        }
        try {
          handles.push(module.start(context))
        } catch (error) {
          context.app.error(`Cannot start output ${module.id}: ${String(error)}`)
        }
      }
      return handles
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/output-registry.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/outputs/output-registry.ts test/output-registry.test.ts
git commit -m "feat: add the output registry"
```

### Task 2.5: Build the config-schema assembler (TDD)

**Files:**
- Create: `src/plugin/plugin-config.ts`
- Test: `test/plugin-config.test.ts`

- [ ] **Step 1: Write the failing test `test/plugin-config.test.ts`**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { assemblePluginSchema } from '../src/plugin/plugin-config.ts'

test('assemblePluginSchema merges fragments in order', () => {
  const schema = assemblePluginSchema('Title', 'Desc', [
    { a: { type: 'boolean' } },
    { b: { type: 'number' } }
  ])
  assert.equal(schema.title, 'Title')
  assert.equal(schema.description, 'Desc')
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['cachingDurationMinutes'])
  assert.deepEqual(Object.keys(schema.properties), ['a', 'b'])
})

test('assemblePluginSchema rejects a duplicated property key', () => {
  assert.throws(
    () => assemblePluginSchema('T', 'D', [{ a: {} }, { a: {} }]),
    /duplicate config property/i
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/plugin-config.test.ts`
Expected: FAIL, `Cannot find module '.../plugin-config.ts'`.

- [ ] **Step 3: Write `src/plugin/plugin-config.ts`**

```typescript
/**
 * Plugin config-schema assembly.
 *
 * The plugin config schema is no longer one literal: each input and output
 * module contributes a `properties` fragment, and this module merges them into
 * the single schema object the SignalK admin UI renders. A duplicated property
 * key across modules is a wiring bug and throws rather than silently shadowing.
 */

/** The assembled JSON Schema for the plugin configuration. */
export interface PluginSchema {
  title: string
  description: string
  type: 'object'
  required: string[]
  properties: Record<string, unknown>
}

/** The one always-required config property. */
const REQUIRED_PROPERTIES = ['cachingDurationMinutes']

/**
 * Merge per-module `properties` fragments into one plugin schema.
 *
 * @param title       Plugin title, shown by the admin UI.
 * @param description Plugin description, shown by the admin UI.
 * @param fragments   Per-module `properties` fragments, in registration order.
 */
export function assemblePluginSchema (
  title: string,
  description: string,
  fragments: Array<Record<string, unknown>>
): PluginSchema {
  const properties: Record<string, unknown> = {}
  for (const fragment of fragments) {
    for (const [key, value] of Object.entries(fragment)) {
      if (key in properties) {
        throw new Error(`Duplicate config property "${key}" across modules`)
      }
      properties[key] = value
    }
  }
  return {
    title,
    description,
    type: 'object',
    required: [...REQUIRED_PROPERTIES],
    properties
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/plugin-config.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/plugin/plugin-config.ts test/plugin-config.test.ts
git commit -m "feat: add the plugin config-schema assembler"
```

---

# Phase 3A: ActiveCaptain input (Lane B)

Moves the ActiveCaptain cluster into `src/inputs/active-captain/` and wraps it
as an `InputModule`. Depends on Phase 2 (`poi-source.ts`).

### Task 3A.1: Move the ActiveCaptain cluster

**Files:**
- Move: `src/activeCaptainClient.ts` -> `src/inputs/active-captain/active-captain-client.ts`
- Move: `src/poiCache.ts` -> `src/inputs/active-captain/poi-cache.ts`
- Move: `src/poiStore.ts` -> `src/inputs/active-captain/poi-store.ts`
- Move: `src/handlebarsUtilities.ts` -> `src/inputs/active-captain/poi-detail-renderer.ts`
- Move: `src/templates.ts` -> `src/inputs/active-captain/templates.ts`
- Move: `src/ratingFilter.ts` -> `src/inputs/active-captain/rating-filter.ts`

`ratingFilter.ts` moves here for now because it filters on ActiveCaptain
ratings; the notes-resource output imports it (an output depending on an input
is the normal data-flow direction).

- [ ] **Step 1: Move the files**

```bash
git mv src/activeCaptainClient.ts src/inputs/active-captain/active-captain-client.ts
git mv src/poiCache.ts src/inputs/active-captain/poi-cache.ts
git mv src/poiStore.ts src/inputs/active-captain/poi-store.ts
git mv src/handlebarsUtilities.ts src/inputs/active-captain/poi-detail-renderer.ts
git mv src/templates.ts src/inputs/active-captain/templates.ts
git mv src/ratingFilter.ts src/inputs/active-captain/rating-filter.ts
```

- [ ] **Step 2: Fix imports**

Run `npm run typecheck`; fix each reported path until clean. These files
import from `../shared/types.js` now, and `poi-detail-renderer.ts` imports
`./templates.js`. `src/index.ts` still imports several of them: update those
specifiers in place (Phase 5 rewrites `index.ts`, but it must compile now).
Update `test/` imports for the moved test files in Task 6.x; for now update
the import paths inside `test/activeCaptainClient.test.ts`,
`test/poiCache.test.ts`, `test/poiStore.test.ts`,
`test/handlebarsUtilities.test.ts`, and `test/ratingFilter.test.ts`.

- [ ] **Step 3: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor: move the ActiveCaptain cluster into src/inputs/active-captain"
```

### Task 3A.2: Move POI-type selection into shared

`buildPoiTypesString` and the `ensurePoiTypes` helper (currently inline in
`index.ts`) are used by both the notes output and the monitor, so they belong
in `shared/`.

**Files:**
- Move: `src/poiTypeSelection.ts` -> `src/shared/poi-type-selection.ts`
- Modify: `src/shared/poi-type-selection.ts` (add `ensurePoiTypes`)

- [ ] **Step 1: Move the file**

```bash
git mv src/poiTypeSelection.ts src/shared/poi-type-selection.ts
```

- [ ] **Step 2: Append `ensurePoiTypes` to `src/shared/poi-type-selection.ts`**

Add this function (lifted verbatim from `src/index.ts`, where it is currently
a private helper, with its doc comment):

```typescript
/**
 * Ensure the POI-types string includes every type in `required`. The position
 * monitor's per-tick fetch uses it, and the position-driven outputs can only
 * act on points of interest the fetch returned.
 */
export function ensurePoiTypes (poiTypes: string | null, required: readonly string[]): string {
  const present = (poiTypes === null || poiTypes === '') ? [] : poiTypes.split(',')
  const merged = [...present]
  for (const type of required) {
    if (!merged.includes(type)) {
      merged.push(type)
    }
  }
  return merged.join(',')
}
```

- [ ] **Step 3: Fix imports**

Run `npm run typecheck`; fix the import path in `src/index.ts` and
`test/poiTypeSelection.test.ts` until clean.

- [ ] **Step 4: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: move POI-type selection into src/shared"
```

### Task 3A.3: Create the ActiveCaptain `PoiSource` adapter (TDD)

`active-captain-client.ts` exposes `pointOfInterestDetails`; the `PoiSource`
contract names detail access `getDetails`, and the detail path must go through
the cache. This adapter wires the client, the cache, and the store into one
`PoiSource`.

**Files:**
- Create: `src/inputs/active-captain/active-captain-source.ts`
- Test: `test/active-captain-source.test.ts`

- [ ] **Step 1: Write the failing test `test/active-captain-source.test.ts`**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveCaptainSource } from '../src/inputs/active-captain/active-captain-source.ts'
import type { PoiDetails, PoiSummary } from '../src/shared/types.ts'

const sampleDetails = { pointOfInterest: { name: 'X' } } as unknown as PoiDetails

function fakeClient () {
  return {
    listPointsOfInterest: async (): Promise<PoiSummary[]> =>
      [{ id: '1', name: 'A', type: 'Marina', position: { latitude: 0, longitude: 0 } }],
    pointOfInterestDetails: async (): Promise<PoiDetails> => sampleDetails,
    close: () => {}
  }
}

test('getDetails returns detail through the cache', async () => {
  const source = createActiveCaptainSource({
    client: fakeClient(),
    cachingDurationMinutes: 60,
    dataDir: '/tmp/crows-nest-test',
    status: { recordDetailSuccess: () => {}, recordError: () => {} } as never,
    app: { setPluginError: () => {}, debug: () => {} } as never
  })
  assert.equal((await source.getDetails('1')).pointOfInterest.name, 'X')
  assert.equal(source.id, 'activecaptain')
  source.close()
})

test('listPointsOfInterest delegates to the client', async () => {
  const source = createActiveCaptainSource({
    client: fakeClient(),
    cachingDurationMinutes: 60,
    dataDir: '/tmp/crows-nest-test',
    status: { recordDetailSuccess: () => {}, recordError: () => {} } as never,
    app: { setPluginError: () => {}, debug: () => {} } as never
  })
  const list = await source.listPointsOfInterest(
    { north: 1, south: 0, east: 1, west: 0 }, 'Marina')
  assert.equal(list.length, 1)
  source.close()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/active-captain-source.test.ts`
Expected: FAIL, `Cannot find module '.../active-captain-source.ts'`.

- [ ] **Step 3: Write `src/inputs/active-captain/active-captain-source.ts`**

```typescript
/**
 * ActiveCaptain POI source.
 *
 * Wires the ActiveCaptain HTTP client, the TTL detail cache, and the on-disk
 * store into one `PoiSource`. The cache listener records detail outcomes onto
 * the status recorder; a 404 is the API answering normally (the point of
 * interest does not exist), so it is recorded as a success, not an outage.
 */

import type { ServerAPI } from '@signalk/server-api'
import { HttpError } from './active-captain-client.js'
import type { ActiveCaptainClient } from './active-captain-client.js'
import { createPoiCache } from './poi-cache.js'
import { createPoiStore } from './poi-store.js'
import type { PoiSource } from '../poi-source.js'
import type { PluginStatus } from '../../status/plugin-status.js'

/** The stable id of the ActiveCaptain source. */
export const ACTIVE_CAPTAIN_SOURCE_ID = 'activecaptain'

/** HTTP status for a point of interest that does not exist. */
const HTTP_NOT_FOUND = 404

/** Dependencies for {@link createActiveCaptainSource}. */
export interface ActiveCaptainSourceConfig {
  /** The ActiveCaptain HTTP client. */
  client: ActiveCaptainClient
  /** Detail cache TTL, in minutes. */
  cachingDurationMinutes: number
  /** Plugin data directory, for the on-disk store. */
  dataDir: string
  /** Status recorder for detail outcomes. */
  status: PluginStatus
  /** SignalK app, for `setPluginError` and debug logging. */
  app: Pick<ServerAPI, 'setPluginError' | 'debug'>
}

/** Create the ActiveCaptain POI source. */
export function createActiveCaptainSource (config: ActiveCaptainSourceConfig): PoiSource {
  const { client, cachingDurationMinutes, dataDir, status, app } = config

  const store = createPoiStore(dataDir, cachingDurationMinutes)
  const cache = createPoiCache(client, cachingDurationMinutes, {
    onLoadSuccess: () => { status.recordDetailSuccess() },
    onLoadError: (error) => {
      // A 404 is the API answering normally: the point of interest does not
      // exist. That is not a reachability failure.
      if (error instanceof HttpError && error.status === HTTP_NOT_FOUND) {
        status.recordDetailSuccess()
      } else {
        const message = `Detail request failed: ${String(error)}`
        status.recordError(message)
        app.setPluginError(message)
      }
    }
  }, store)

  return {
    id: ACTIVE_CAPTAIN_SOURCE_ID,
    listPointsOfInterest: (bbox, poiTypes) => client.listPointsOfInterest(bbox, poiTypes),
    getDetails: (id) => cache.get(id),
    cacheSize: () => cache.size(),
    close: () => { client.close() }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/active-captain-source.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/inputs/active-captain/active-captain-source.ts test/active-captain-source.test.ts
git commit -m "feat: add the ActiveCaptain POI source adapter"
```

### Task 3A.4: Create the ActiveCaptain `InputModule`

**Files:**
- Create: `src/inputs/active-captain/active-captain-input.ts`
- Test: `test/active-captain-input.test.ts`

- [ ] **Step 1: Write the failing test `test/active-captain-input.test.ts`**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { activeCaptainInput } from '../src/inputs/active-captain/active-captain-input.ts'

test('the input is always enabled', () => {
  assert.equal(activeCaptainInput.isEnabled({} as never), true)
})

test('the config fragment carries the caching and POI-type properties', () => {
  const keys = Object.keys(activeCaptainInput.configSchema)
  assert.ok(keys.includes('cachingDurationMinutes'))
  assert.ok(keys.includes('includeMarinas'))
  assert.equal(keys.filter((k) => k.startsWith('include')).length, 13)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/active-captain-input.test.ts`
Expected: FAIL, `Cannot find module '.../active-captain-input.ts'`.

- [ ] **Step 3: Write `src/inputs/active-captain/active-captain-input.ts`**

The `configSchema` fragment is the `cachingDurationMinutes` property plus the
13 `includeX` properties, copied verbatim from the schema literal currently in
`src/index.ts` (lines 300 to 317). `createActiveCaptainClient(app)` is the
existing factory; it takes the app as its `Logger`.

```typescript
/**
 * ActiveCaptain input module.
 *
 * Registers the ActiveCaptain API as a POI source. Owns the config-schema
 * fragment for the cache duration and the 13 POI-type toggles, since those
 * tune the ActiveCaptain API specifically. Always enabled: it is the plugin's
 * only data source. The POI-type toggles control which types are fetched, not
 * whether the source runs.
 */

import { createActiveCaptainClient } from './active-captain-client.js'
import { createActiveCaptainSource, ACTIVE_CAPTAIN_SOURCE_ID } from './active-captain-source.js'
import type { InputContext, InputModule } from '../poi-source.js'

/** Default caching window, in minutes, when configuration omits it. */
const DEFAULT_CACHING_DURATION_MINUTES = 60

/** The cache-duration and POI-type-toggle config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  cachingDurationMinutes: {
    type: 'number',
    title: 'How long to cache data from Active Captain in minutes (longer = less data traffic; shorter = more up to date data)',
    default: DEFAULT_CACHING_DURATION_MINUTES
  },
  includeMarinas: { type: 'boolean', title: 'Include marinas', default: true },
  includeAnchorages: { type: 'boolean', title: 'Include anchorages', default: true },
  includeHazards: { type: 'boolean', title: 'Include hazards', default: true },
  includeBusinesses: { type: 'boolean', title: 'Include businesses', default: true },
  includeBoatRamps: { type: 'boolean', title: 'Include boat ramps', default: true },
  includeBridges: { type: 'boolean', title: 'Include bridges', default: true },
  includeDams: { type: 'boolean', title: 'Include dams', default: true },
  includeFerries: { type: 'boolean', title: 'Include ferries', default: true },
  includeInlets: { type: 'boolean', title: 'Include inlets', default: true },
  includeLocks: { type: 'boolean', title: 'Include locks', default: true },
  includeLocalKnowledge: { type: 'boolean', title: 'Include local knowledge', default: true },
  includeNavigational: { type: 'boolean', title: 'Include navigational aids', default: true },
  includeAirports: { type: 'boolean', title: 'Include airports', default: true }
}

/** Resolve the caching duration from raw config, applying the default. */
function resolveCachingDuration (raw: unknown): number {
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_CACHING_DURATION_MINUTES
}

/** The ActiveCaptain input module. */
export const activeCaptainInput: InputModule = {
  id: ACTIVE_CAPTAIN_SOURCE_ID,
  name: 'Garmin ActiveCaptain',
  configSchema: CONFIG_SCHEMA,
  isEnabled: () => true,
  createSource: (context: InputContext) => {
    const { app, config, status, dataDir } = context
    return createActiveCaptainSource({
      client: createActiveCaptainClient(app),
      cachingDurationMinutes: resolveCachingDuration(config.cachingDurationMinutes),
      dataDir,
      status,
      app
    })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/active-captain-input.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/inputs/active-captain/active-captain-input.ts test/active-captain-input.test.ts
git commit -m "feat: add the ActiveCaptain input module"
```

---

# Phase 3B: Notes-resource output (Lane C)

Extracts the `notes` resource provider from `index.ts` into an `OutputModule`.
Depends on Phase 2 (`output.ts`) and Phase 3A Task 3A.2 (shared
`poi-type-selection.ts`). Lane C coordinates with Lane B so both do not edit
`index.ts` at once; `index.ts` is only rewritten in Phase 5.

### Task 3B.1: Move the resource-query parser

**Files:**
- Move: `src/resourceQuery.ts` -> `src/outputs/notes-resource/resource-query.ts`

- [ ] **Step 1: Move the file**

```bash
git mv src/resourceQuery.ts src/outputs/notes-resource/resource-query.ts
```

- [ ] **Step 2: Fix imports**

Run `npm run typecheck`; fix the import path in `src/index.ts` and
`test/resourceQuery.test.ts` until clean.

- [ ] **Step 3: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A && git commit -m "refactor: move resource-query parser into notes-resource output"
```

### Task 3B.2: Extract the note builder (TDD)

`buildNoteResource` and `readProperty` are currently private helpers in
`index.ts`. Move them verbatim into a focused module.

**Files:**
- Create: `src/outputs/notes-resource/note-builder.ts`
- Test: `test/note-builder.test.ts`

- [ ] **Step 1: Write the failing test `test/note-builder.test.ts`**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNoteResource, readProperty } from '../src/outputs/notes-resource/note-builder.ts'

test('buildNoteResource omits timestamp and description when not supplied', () => {
  const note = buildNoteResource('7', 'Dock', { latitude: 1, longitude: 2 }, 'marina')
  assert.equal(note.name, 'Dock')
  assert.equal(note.url, 'https://activecaptain.garmin.com/en-US/pois/7')
  assert.equal(note.timestamp, undefined)
  assert.equal(note.description, undefined)
  assert.deepEqual(note.properties, { readOnly: true, skIcon: 'marina' })
})

test('buildNoteResource includes html description and mimeType when supplied', () => {
  const note = buildNoteResource('7', 'Dock', { latitude: 1, longitude: 2 }, 'marina',
    '2020-01-01T00:00:00.000Z', '<p>hi</p>')
  assert.equal(note.description, '<p>hi</p>')
  assert.equal(note.mimeType, 'text/html')
  assert.equal(note.timestamp, '2020-01-01T00:00:00.000Z')
})

test('readProperty reads a dot path and returns undefined for a miss', () => {
  const note = buildNoteResource('7', 'Dock', { latitude: 1, longitude: 2 }, 'marina')
  assert.equal(readProperty(note, 'properties.skIcon'), 'marina')
  assert.equal(readProperty(note, 'properties.nope'), undefined)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/note-builder.test.ts`
Expected: FAIL, `Cannot find module '.../note-builder.ts'`.

- [ ] **Step 3: Write `src/outputs/notes-resource/note-builder.ts`**

Lift `buildNoteResource` and `readProperty` verbatim from `src/index.ts`
(lines 109 to 169), plus the `POI_PAGE_URL_PREFIX` constant (line 48) and the
`PLUGIN_ID` import. Header comment:

```typescript
/**
 * SignalK `notes` resource builder.
 *
 * Pure helpers that turn a point of interest into a SignalK `notes` resource
 * object and read a dot-notation property path back out of one. The shape is
 * shared by the list and single-resource responses.
 */

import { PLUGIN_ID } from '../../shared/plugin-id.js'
import type { Position } from '../../shared/types.js'

/** Public ActiveCaptain page for a point of interest, by id. */
const POI_PAGE_URL_PREFIX = 'https://activecaptain.garmin.com/en-US/pois/'
```

Then the bodies of `buildNoteResource` and `readProperty` exactly as they are
in `index.ts` today, both `export`ed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test test/note-builder.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/outputs/notes-resource/note-builder.ts test/note-builder.test.ts
git commit -m "feat: extract the notes resource builder"
```

### Task 3B.3: Build the notes-resource output module

This module holds the `listResources`/`getResource` logic currently in
`index.ts` (lines 181 to 287), reworked to read from `OutputContext` instead of
the `Runtime` closure. Its `OutputHandle.stop` is a no-op: the SignalK server
unregisters a plugin's resource providers on stop.

**Files:**
- Create: `src/outputs/notes-resource/notes-resource-output.ts`
- Test: `test/notes-resource-output.test.ts`

- [ ] **Step 1: Write `src/outputs/notes-resource/notes-resource-output.ts`**

```typescript
/**
 * Notes-resource output.
 *
 * Registers the SignalK `notes` resource provider that exposes points of
 * interest to chart plotters. This is the ActiveCaptain-to-notes adapter: it
 * lists POIs through the aggregate source, applies the minimum-rating display
 * filter, and renders detail descriptions. It owns the `minimumRating` config
 * property, since that is a display filter on this output.
 *
 * The resource provider is registered on every plugin start; the SignalK
 * server unregisters it on stop, so `stop()` here is a no-op.
 */

import type { ResourceProviderMethods } from '@signalk/server-api'
import type { OutputContext, OutputHandle, OutputModule } from '../output.js'
import { buildNoteResource, readProperty } from './note-builder.js'
import { resolveBbox } from './resource-query.js'
import { filterByRating } from '../../inputs/active-captain/rating-filter.js'
import { parseApiDate, renderDescription } from '../../inputs/active-captain/poi-detail-renderer.js'
import { buildPoiTypesString } from '../../shared/poi-type-selection.js'
import { PLUGIN_ID } from '../../shared/plugin-id.js'
import type { PoiSummary } from '../../shared/types.js'

/** The SignalK resource type this output provides. */
const RESOURCE_TYPE = 'notes'

/** The `minimumRating` config fragment owned by this output. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  minimumRating: {
    type: 'number',
    title: 'Minimum rating: hide points of interest rated below this (0 to 5; 0 shows all)',
    default: 0,
    minimum: 0,
    maximum: 5
  }
}

/** Build the resource-provider methods bound to one plugin run's context. */
function buildMethods (context: OutputContext): ResourceProviderMethods {
  const { app, config, pois, status } = context
  const minimumRating =
    typeof config.minimumRating === 'number' && config.minimumRating > 0
      ? config.minimumRating
      : 0

  return {
    listResources: async (query: Record<string, unknown>): Promise<Record<string, unknown>> => {
      app.debug(`Incoming request to list note resources - query: ${JSON.stringify(query)}`)
      const poiTypes = buildPoiTypesString(config)
      if (poiTypes === null) {
        app.debug('No POI types are selected in the configuration; returning no resources')
        return {}
      }
      const bbox = resolveBbox(query)
      if (bbox === null) {
        app.debug(`Could not derive a bounding box from query ${JSON.stringify(query)}`)
        return {}
      }

      let entities: PoiSummary[]
      try {
        entities = await pois.listPointsOfInterest(bbox, poiTypes)
      } catch (error) {
        const message = `List request failed: ${String(error)}`
        status.recordError(message)
        app.setPluginError(message)
        throw error
      }
      status.recordListFetch(entities.length)
      app.setPluginStatus(`${entities.length} point(s) of interest from the last search`)

      entities = filterByRating(entities, minimumRating)
      const resources: Record<string, unknown> = {}
      for (const entity of entities) {
        resources[entity.id] = buildNoteResource(
          entity.id,
          entity.name,
          { ...entity.position },
          entity.type.toLowerCase()
        )
      }
      return resources
    },

    getResource: async (id: string, property?: string): Promise<object> => {
      app.debug(`Incoming request to get note ${id}${property != null ? ` property ${property}` : ''}`)
      const entity = await pois.getDetails(id)
      const poi = entity.pointOfInterest

      let description = ''
      try {
        description = renderDescription(entity)
      } catch (error) {
        app.debug(`Unable to format description for ${id} - ${String(error)}`)
      }

      const modified = parseApiDate(poi.dateLastModified)
      const timestamp = Number.isFinite(modified.getTime())
        ? modified.toISOString()
        : undefined
      const note = buildNoteResource(
        id,
        poi.name,
        { ...poi.mapLocation },
        poi.poiType.toLowerCase(),
        timestamp,
        description
      )

      if (property === undefined || property === '') {
        return note
      }
      const value = readProperty(note, property)
      if (value === undefined) {
        throw new Error(`Resource ${id} has no property ${property}`)
      }
      return { value, timestamp: note.timestamp, $source: PLUGIN_ID }
    },

    setResource: (): Promise<void> =>
      Promise.reject(new Error('ActiveCaptain resources are read-only')),

    deleteResource: (): Promise<void> =>
      Promise.reject(new Error('ActiveCaptain resources are read-only'))
  }
}

/** The notes-resource output module. */
export const notesResourceOutput: OutputModule = {
  id: 'notes-resource',
  name: 'SignalK notes resource',
  configSchema: CONFIG_SCHEMA,
  isEnabled: () => true,
  start: (context: OutputContext): OutputHandle => {
    try {
      context.app.registerResourceProvider({
        type: RESOURCE_TYPE,
        methods: buildMethods(context)
      })
    } catch (error) {
      context.app.error(`Cannot register as a ${RESOURCE_TYPE} resource provider: ${String(error)}`)
    }
    // The SignalK server unregisters resource providers on plugin stop.
    return { stop: () => {} }
  }
}
```

- [ ] **Step 2: Write the test `test/notes-resource-output.test.ts`**

Port the resource-provider scenarios from the current `index.ts` behavior.
Cover: `listResources` returns `{}` when `buildPoiTypesString` is null (all
toggles off), returns `{}` on an unresolvable bbox, returns notes keyed by id
on success, records the list fetch on the status stub, and rethrows on a list
error; `getResource` returns the built note, returns a property value for a
property request, and rejects an unknown property; `setResource` and
`deleteResource` reject.

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { notesResourceOutput } from '../src/outputs/notes-resource/notes-resource-output.ts'
import type { OutputContext } from '../src/outputs/output.ts'
import type { PoiDetails } from '../src/shared/types.ts'

function recordingApp () {
  const provider: { methods?: Record<string, unknown> } = {}
  return {
    provider,
    app: {
      debug: () => {},
      error: () => {},
      setPluginStatus: () => {},
      setPluginError: () => {},
      registerResourceProvider: (r: { methods: Record<string, unknown> }) => {
        provider.methods = r.methods
      }
    }
  }
}

const allTypesOn = {
  includeMarinas: true, includeAnchorages: true, includeHazards: true,
  includeBusinesses: true, includeBoatRamps: true, includeBridges: true,
  includeDams: true, includeFerries: true, includeInlets: true,
  includeLocks: true, includeLocalKnowledge: true, includeNavigational: true,
  includeAirports: true
}

function contextWith (overrides: Partial<OutputContext>): OutputContext {
  const { app } = recordingApp()
  return {
    app: app as never,
    config: { ...allTypesOn } as never,
    status: { recordListFetch: () => {}, recordError: () => {}, recordDetailSuccess: () => {} } as never,
    pois: {
      id: 'activecaptain',
      listPointsOfInterest: async () => [
        { id: '1', name: 'A', type: 'Marina', position: { latitude: 0, longitude: 0 } }
      ],
      getDetails: async (): Promise<PoiDetails> => ({
        pointOfInterest: {
          name: 'A', poiType: 'Marina', mapLocation: { latitude: 0, longitude: 0 },
          dateLastModified: '2020-01-01 00:00:00'
        }
      }) as unknown as PoiDetails,
      cacheSize: () => 0,
      close: () => {}
    },
    ...overrides
  } as OutputContext
}

test('listResources returns notes keyed by id', async () => {
  const { app, provider } = recordingApp()
  notesResourceOutput.start(contextWith({ app: app as never }))
  const methods = provider.methods as { listResources: (q: object) => Promise<Record<string, unknown>> }
  const result = await methods.listResources({
    bbox: '0,0,1,1'
  })
  assert.ok('1' in result)
})

test('setResource rejects', async () => {
  const { app, provider } = recordingApp()
  notesResourceOutput.start(contextWith({ app: app as never }))
  const methods = provider.methods as { setResource: () => Promise<void> }
  await assert.rejects(methods.setResource(), /read-only/)
})
```

Add the remaining scenarios listed above as further `test(...)` cases, using
the same `contextWith` helper (vary `config`, `pois`, and `status` stubs per
case). Match the exact query format `resolveBbox` accepts: read
`src/outputs/notes-resource/resource-query.ts` to confirm the accepted query
keys before writing the bbox fixtures.

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --import tsx --test test/notes-resource-output.test.ts`
Expected: PASS.

- [ ] **Step 4: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add src/outputs/notes-resource/notes-resource-output.ts test/notes-resource-output.test.ts
git commit -m "feat: add the notes-resource output module"
```

---

# Phase 3C: Position-driven outputs and monitoring (Lane D)

Moves the alarm and route modules, refactors the position monitor to the
`PositionScanContributor` model, and wraps the proximity and route features as
`OutputModule`s. Depends on Phase 2 (`output.ts`) and Phase 3A Task 3A.2.

### Task 3C.1: Move geo helper `unionBbox` and the alarm and route modules

**Files:**
- Move: `src/proximityAlarms.ts` -> `src/outputs/proximity-alarm/proximity-alarms.ts`
- Move: `src/routeHazardAlarms.ts` -> `src/outputs/route-hazard/route-hazard-alarms.ts`
- Move: `src/routeCorridor.ts` -> `src/outputs/route-hazard/route-corridor.ts`
- Move: `src/courseReader.ts` -> `src/outputs/route-hazard/course-reader.ts`
- Move: `src/positionMonitor.ts` -> `src/monitoring/position-monitor.ts`
- Modify: `src/geo/position-utilities.ts` (add `unionBbox`)

- [ ] **Step 1: Move the files**

```bash
git mv src/proximityAlarms.ts src/outputs/proximity-alarm/proximity-alarms.ts
git mv src/routeHazardAlarms.ts src/outputs/route-hazard/route-hazard-alarms.ts
git mv src/routeCorridor.ts src/outputs/route-hazard/route-corridor.ts
git mv src/courseReader.ts src/outputs/route-hazard/course-reader.ts
git mv src/positionMonitor.ts src/monitoring/position-monitor.ts
```

- [ ] **Step 2: Move `unionBbox` into the geo helpers**

Cut the `unionBbox` function (currently a private helper in
`positionMonitor.ts`, lines 159 to 167) and paste it into
`src/geo/position-utilities.ts` as an exported function with its doc comment:

```typescript
/** The smallest bounding box that encloses both inputs. */
export function unionBbox (a: Bbox, b: Bbox): Bbox {
  return {
    north: Math.max(a.north, b.north),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    west: Math.min(a.west, b.west)
  }
}
```

- [ ] **Step 3: Fix imports**

Run `npm run typecheck`; fix every reported path until clean. `index.ts` still
imports these modules: update the specifiers in place. Update the moved test
files' imports (`test/proximityAlarms.test.ts`, `test/routeHazardAlarms.test.ts`,
`test/routeCorridor.test.ts`, `test/courseReader.test.ts`,
`test/positionMonitor.test.ts`) and have `positionMonitor.ts` import
`unionBbox` from `../geo/position-utilities.js`.

- [ ] **Step 4: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green. The monitor test still passes here, because the monitor's
interface has not changed yet (only `unionBbox`'s home moved).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: move position outputs and monitor into directories"
```

### Task 3C.2: Refactor the position monitor to the contributor model

> **EXECUTION NOTE:** refactoring the monitor changes `createPositionMonitor`'s
> signature, which `src/index.ts` still calls the old way. This task therefore
> breaks `index.ts` typecheck until Phase 5 rewrites `index.ts`. Do NOT execute
> or commit Task 3C.2 standalone. Execute it as the first step of Phase 5,
> together with the `plugin.ts` creation, the `index.ts` rewrite, and the
> monitor-test rewrite (Task 6.3), producing one green-to-green commit. Phase
> 3C in parallel execution covers only Tasks 3C.1, 3C.3, and 3C.4, which are
> all additive and keep the build green.

The monitor currently bakes in optional `alarms` and `routeScan`. Refactor it
to take a list of `PositionScanContributor`s instead. The per-tick logic
becomes: ask every contributor for a fetch box, union the non-null boxes, do
one list request, then call every contributor's `evaluate`. When no contributor
produced a box, still call every `evaluate` with `[]` so an output can clear
stale alarms (this preserves today's "clear route alarms when the route ends"
behavior).

**Files:**
- Modify: `src/monitoring/position-monitor.ts`
- Test: `test/position-monitor.test.ts` (rewrite, see Task 6.3)

- [ ] **Step 1: Rewrite the monitor's public interface and tick loop**

Replace `PositionMonitorConfig`'s `alarms`, `routeScan`, `poiTypes`, and
`scanRadiusMeters` fields with a single `contributors` field and keep
`poiTypes`. Keep `app`, `client`, `minMoveMeters`, `minIntervalMs`, and `now`.
Remove `RouteScanConfig`, the `routeCorridorBbox` helper, the
`ROUTE_LOOK_AHEAD_METERS` constant, and the `scanRouteCorridor` import: that
route-corridor logic moves into the route-hazard output (Task 3C.4). The
`client` field is typed `PoiListSource` as today; `PoiSource` satisfies it.

New shape:

```typescript
import type { PositionScanContributor } from '../outputs/output.js'

/** Dependencies and tunables for {@link createPositionMonitor}. */
export interface PositionMonitorConfig {
  /** The SignalK app, used for the position stream and debug logging. */
  app: MonitorApp
  /** The POI source, used to list nearby points of interest. */
  client: PoiListSource
  /** The position-driven outputs that contribute to and consume each tick. */
  contributors: readonly PositionScanContributor[]
  /**
   * The comma-separated `poiTypes` string for the list request. It must
   * include every type any contributor needs, otherwise that contributor
   * never sees the points of interest it acts on.
   */
  poiTypes: string
  /** Minimum distance, in meters, the vessel must move before a new tick. */
  minMoveMeters?: number
  /** Minimum time, in milliseconds, between ticks. */
  minIntervalMs?: number
  /** Clock source, injectable for tests. Defaults to `Date.now`. */
  now?: () => number
}
```

The tick body becomes:

```typescript
  async function runTick (tickPosition: Position): Promise<void> {
    tickInFlight = true
    lastTickPosition = tickPosition
    lastTickTime = now()
    try {
      // Ask every contributor for its fetch box, then union the non-null boxes
      // into one list request.
      let bbox: Bbox | undefined
      for (const contributor of contributors) {
        const box = contributor.buildFetchBox(tickPosition)
        if (box !== null) {
          bbox = bbox === undefined ? box : unionBbox(bbox, box)
        }
      }

      // No box means nothing to fetch this tick. Contributors are still
      // evaluated with an empty result so an output can clear stale alarms
      // (for example a route that has just been finished or cancelled).
      const vesselPosition = latestPosition ?? tickPosition
      if (bbox === undefined) {
        for (const contributor of contributors) {
          contributor.evaluate(vesselPosition, [])
        }
        return
      }

      const pois = await client.listPointsOfInterest(bbox, poiTypes)
      // A response that lands after stop() must not drive an evaluation.
      if (stopped) {
        return
      }
      // Evaluate against the newest fix, not the one the scan started from.
      const latest = latestPosition ?? tickPosition
      for (const contributor of contributors) {
        contributor.evaluate(latest, pois)
      }
    } catch (error) {
      app.debug(`Position monitor scan failed: ${String(error)}`)
    } finally {
      tickInFlight = false
      maybeTick()
    }
  }
```

`stop()` no longer clears alarms or stops a course reader (each contributor's
owning output does that in its own `OutputHandle.stop`). `stop()` becomes:

```typescript
    stop: () => {
      if (stopped) {
        return
      }
      stopped = true
      unsubscribe()
      app.debug('Position monitor stopped')
    }
```

Keep `toPosition`, `shouldTick`, `maybeTick`, `onPosition`, the subscription
setup, `tickInFlight`, `latestPosition`, `lastTickPosition`, and `lastTickTime`
exactly as they are today.

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: `position-monitor.ts` compiles. `test/position-monitor.test.ts` will
fail to compile here because it uses the old interface; that test is rewritten
in Task 6.3. `npm test` is therefore deferred for this file until Phase 6.

- [ ] **Step 3: Commit**

```bash
git add src/monitoring/position-monitor.ts
git commit -m "refactor: drive the position monitor from scan contributors"
```

### Task 3C.3: Build the proximity-alarm output

**Files:**
- Create: `src/outputs/proximity-alarm/proximity-alarm-output.ts`
- Test: `test/proximity-alarm-output.test.ts`

- [ ] **Step 1: Write `src/outputs/proximity-alarm/proximity-alarm-output.ts`**

```typescript
/**
 * Proximity-alarm output.
 *
 * A position-driven output: it raises a SignalK hazard notification when the
 * vessel comes within the configured radius of a Hazard point of interest. It
 * contributes a vessel-surroundings fetch box to the shared position monitor
 * and evaluates the proximity alarms on every tick. Owns the
 * `enableProximityAlarms` and `proximityAlarmRadiusMeters` config properties.
 */

import { createProximityAlarms } from './proximity-alarms.js'
import type { OutputContext, OutputHandle, OutputModule, PositionScanContributor } from '../output.js'
import { positionToBbox } from '../../geo/position-utilities.js'

/** Default proximity-alarm radius, in meters; mirrors the schema default. */
const DEFAULT_PROXIMITY_ALARM_RADIUS_METERS = 500

/** Lower bound on the hazard-scan radius, so the alarm check always has data. */
const MIN_SCAN_RADIUS_METERS = 2000

/** POI type the proximity alarms act on. */
const PROXIMITY_POI_TYPES = ['Hazard'] as const

/** The proximity-alarm config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  enableProximityAlarms: {
    type: 'boolean',
    title: 'Emit a notification when the vessel nears a hazard (subscribes to the vessel position)',
    default: false
  },
  proximityAlarmRadiusMeters: {
    type: 'number',
    title: 'Proximity alarm radius in meters',
    default: 500,
    minimum: 1
  }
}

/** Resolve the alarm radius from raw config, applying the default. */
function resolveRadius (raw: unknown): number {
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_PROXIMITY_ALARM_RADIUS_METERS
}

/** The proximity-alarm output module. */
export const proximityAlarmOutput: OutputModule = {
  id: 'proximity-alarm',
  name: 'Proximity hazard alarms',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config) => config.enableProximityAlarms === true,
  start: (context: OutputContext): OutputHandle => {
    const radiusMeters = resolveRadius(context.config.proximityAlarmRadiusMeters)
    // The scan box is wider than the alarm radius so a hazard is fetched well
    // before it crosses the radius. This mirrors the legacy monitor sizing.
    const scanRadiusMeters = Math.max(radiusMeters * 3, MIN_SCAN_RADIUS_METERS)
    const alarms = createProximityAlarms(context.app, radiusMeters)

    const positionScan: PositionScanContributor = {
      poiTypes: PROXIMITY_POI_TYPES,
      buildFetchBox: (tickPosition) => positionToBbox(tickPosition, scanRadiusMeters),
      evaluate: (vesselPosition, pois) => { alarms.evaluate(vesselPosition, pois) }
    }
    return {
      stop: () => { alarms.clearAll() },
      positionScan
    }
  }
}
```

- [ ] **Step 2: Write `test/proximity-alarm-output.test.ts`**

Cover: `isEnabled` is true only when `enableProximityAlarms` is true;
`start` returns a handle whose `positionScan.poiTypes` includes `Hazard`;
`positionScan.buildFetchBox` returns a box centred on the tick position;
`positionScan.evaluate` raises a notification (spy on `app.handleMessage`)
for a Hazard inside the radius; `handle.stop()` clears active alarms.

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { proximityAlarmOutput } from '../src/outputs/proximity-alarm/proximity-alarm-output.ts'
import type { OutputContext } from '../src/outputs/output.ts'

test('isEnabled tracks the config flag', () => {
  assert.equal(proximityAlarmOutput.isEnabled({ enableProximityAlarms: true } as never), true)
  assert.equal(proximityAlarmOutput.isEnabled({ enableProximityAlarms: false } as never), false)
})

test('start contributes a Hazard scan and raises an alarm on evaluate', () => {
  const messages: unknown[] = []
  const context = {
    app: { handleMessage: (_id: string, d: unknown) => messages.push(d), debug: () => {} },
    config: { enableProximityAlarms: true, proximityAlarmRadiusMeters: 500 },
    pois: {} as never,
    status: {} as never
  } as unknown as OutputContext
  const handle = proximityAlarmOutput.start(context)
  assert.ok(handle.positionScan)
  assert.ok(handle.positionScan.poiTypes.includes('Hazard'))
  const box = handle.positionScan.buildFetchBox({ latitude: 10, longitude: 20 })
  assert.ok(box !== null && box.north > 10 && box.south < 10)
  handle.positionScan.evaluate({ latitude: 0, longitude: 0 }, [
    { id: 'h1', name: 'Rock', type: 'Hazard', position: { latitude: 0, longitude: 0 } }
  ])
  assert.equal(messages.length, 1)
  handle.stop()
  assert.equal(messages.length, 2) // a clear notification on stop
})
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --import tsx --test test/proximity-alarm-output.test.ts`
Expected: PASS.

- [ ] **Step 4: Verify typecheck, lint, and commit**

```bash
npm run typecheck && npm run lint
node --import tsx --test test/proximity-alarm-output.test.ts
git add src/outputs/proximity-alarm/proximity-alarm-output.ts test/proximity-alarm-output.test.ts
git commit -m "feat: add the proximity-alarm output module"
```

### Task 3C.4: Build the route-hazard output

This output owns the route-corridor fetch-box widening (the `routeCorridorBbox`
helper and `ROUTE_LOOK_AHEAD_METERS` cap removed from the monitor in Task 3C.2)
and the per-tick corridor scan. It reads the route once per tick in
`buildFetchBox` and reuses it in `evaluate`, matching the legacy monitor's
"read the route once per tick" behavior.

**Files:**
- Create: `src/outputs/route-hazard/route-hazard-output.ts`
- Test: `test/route-hazard-output.test.ts`

- [ ] **Step 1: Write `src/outputs/route-hazard/route-hazard-output.ts`**

```typescript
/**
 * Route-hazard output.
 *
 * A position-driven output: it scans the active route ahead and raises a
 * SignalK route notification for each Hazard, Bridge, or Lock in the route
 * corridor. It contributes a route-corridor fetch box to the shared position
 * monitor and runs the corridor scan on every tick. Owns the
 * `enableRouteHazardScan` and `routeCorridorWidthMeters` config properties.
 *
 * The active route is read once per tick, in `buildFetchBox`, and reused in
 * `evaluate`, so a course delta arriving mid-tick cannot make the fetch box
 * and the scan disagree.
 */

import { createCourseReader } from './course-reader.js'
import { createRouteHazardAlarms } from './route-hazard-alarms.js'
import { scanRouteCorridor } from './route-corridor.js'
import type { OutputContext, OutputHandle, OutputModule, PositionScanContributor } from '../output.js'
import { distanceMeters, positionToBbox, unionBbox } from '../../geo/position-utilities.js'
import type { Bbox, CorridorPoi, Position, RoutePolyline } from '../../shared/types.js'

/** Default route-corridor half-width, in meters; mirrors the schema default. */
const DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS = 500

/** Meters in a nautical mile. */
const METERS_PER_NAUTICAL_MILE = 1852

/**
 * How far ahead along the route, in meters, the fetch box is widened. Beyond
 * this cap the ActiveCaptain bounding-box endpoint clusters results, so the
 * look-ahead is a sliding window: a point past the cap is picked up on a
 * later tick.
 */
const ROUTE_LOOK_AHEAD_METERS = 10 * METERS_PER_NAUTICAL_MILE

/** POI types the route-corridor scan acts on. */
const ROUTE_SCAN_POI_TYPES = ['Hazard', 'Bridge', 'Lock'] as const

/** The route-hazard config fragment. */
const CONFIG_SCHEMA: Record<string, unknown> = {
  enableRouteHazardScan: {
    type: 'boolean',
    title: 'Scan the active route ahead for hazards, bridges, and locks (uses the Course API)',
    default: false
  },
  routeCorridorWidthMeters: {
    type: 'number',
    title: 'Route corridor width in meters',
    default: 500,
    minimum: 1
  }
}

/** Resolve the corridor half-width from raw config, applying the default. */
function resolveCorridorWidth (raw: unknown): number {
  return typeof raw === 'number' && raw > 0 ? raw : DEFAULT_ROUTE_CORRIDOR_WIDTH_METERS
}

/**
 * Build a bounding box enclosing the route ahead, out to the look-ahead cap,
 * each route point expanded by the corridor half-width. Returns `null` when
 * the route carries no usable points. Lifted from the legacy position monitor.
 */
function routeCorridorBbox (route: RoutePolyline, corridorWidthMeters: number): Bbox | null {
  const points: Position[] = route.vesselPosition !== null
    ? [route.vesselPosition, ...route.waypoints]
    : [...route.waypoints]

  let box: Bbox | undefined
  let traveledMeters = 0
  let previous: Position | undefined
  for (const point of points) {
    if (previous !== undefined) {
      traveledMeters += distanceMeters(previous, point)
    }
    const pointBox = positionToBbox(point, corridorWidthMeters)
    box = box === undefined ? pointBox : unionBbox(box, pointBox)
    previous = point
    if (traveledMeters >= ROUTE_LOOK_AHEAD_METERS) {
      break
    }
  }
  return box ?? null
}

/** The route-hazard output module. */
export const routeHazardOutput: OutputModule = {
  id: 'route-hazard',
  name: 'Route-corridor hazard scan',
  configSchema: CONFIG_SCHEMA,
  isEnabled: (config) => config.enableRouteHazardScan === true,
  start: (context: OutputContext): OutputHandle => {
    const corridorWidthMeters = resolveCorridorWidth(context.config.routeCorridorWidthMeters)
    const courseReader = createCourseReader({ app: context.app })
    const alarms = createRouteHazardAlarms(context.app)

    // The route read in buildFetchBox, reused in evaluate within the same tick.
    let tickRoute: RoutePolyline | null = null

    const positionScan: PositionScanContributor = {
      poiTypes: ROUTE_SCAN_POI_TYPES,
      buildFetchBox: () => {
        tickRoute = courseReader.getRouteAhead()
        return tickRoute === null
          ? null
          : routeCorridorBbox(tickRoute, corridorWidthMeters)
      },
      evaluate: (_vesselPosition, pois) => {
        let corridorPois: CorridorPoi[] = []
        if (tickRoute !== null) {
          const vesselState = courseReader.getVesselState()
          corridorPois = scanRouteCorridor({
            route: tickRoute,
            pois,
            corridorWidthMeters,
            speedOverGround: vesselState.speedOverGround
          }).filter((poi) => poi.alongTrackDistanceMeters <= ROUTE_LOOK_AHEAD_METERS)
        }
        alarms.evaluate(corridorPois)
      }
    }
    return {
      stop: () => {
        alarms.clearAll()
        courseReader.stop()
      },
      positionScan
    }
  }
}
```

- [ ] **Step 2: Write `test/route-hazard-output.test.ts`**

Cover: `isEnabled` tracks `enableRouteHazardScan`; `start` returns a handle
whose `positionScan.poiTypes` includes `Hazard`, `Bridge`, and `Lock`;
`buildFetchBox` returns `null` when the course reader reports no route;
`evaluate` calls the route alarms with `[]` when there is no route (clearing
stale alarms); `handle.stop()` stops the course reader and clears alarms.
Stub the SignalK app slice the course reader needs (`getCourse`,
`resourcesApi.getResource`, `getSelfPath`, `streambundle.getSelfBus`, `debug`);
reuse the stub patterns from the existing `test/courseReader.test.ts`.

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --import tsx --test test/route-hazard-output.test.ts`
Expected: PASS.

- [ ] **Step 4: Verify typecheck, lint, and commit**

```bash
npm run typecheck && npm run lint
node --import tsx --test test/route-hazard-output.test.ts
git add src/outputs/route-hazard/route-hazard-output.ts test/route-hazard-output.test.ts
git commit -m "feat: add the route-hazard output module"
```

---

# Phase 4: Panel file renames (Lane E)

Independent of Phases 3A/3B/3C: the panel only depends on `statusTypes`
(already moved in Task 1.3) and `pluginId`. Can run in parallel with Phase 3.

### Task 4.1: Rename panel non-component files to kebab-case

React component `.tsx` files keep PascalCase (React convention). Non-component
`.ts` files and the hook files go kebab-case.

**Files:**
- Move: `src/panel/configReducer.ts` -> `src/panel/config-reducer.ts`
- Move: `src/panel/normaliseConfig.ts` -> `src/panel/normalize-config.ts`
- Move: `src/panel/poiTypeGroups.ts` -> `src/panel/poi-type-groups.ts`
- Move: `src/panel/hooks/useConfig.ts` -> `src/panel/hooks/use-config.ts`
- Move: `src/panel/hooks/useStatus.ts` -> `src/panel/hooks/use-status.ts`

`src/panel/index.tsx`, `src/panel/styles.ts`,
`src/panel/PluginConfigurationPanel.tsx`, and `src/panel/components/*.tsx`
keep their names. `styles.ts` is already kebab-safe.

- [ ] **Step 1: Move the files**

```bash
git mv src/panel/configReducer.ts src/panel/config-reducer.ts
git mv src/panel/normaliseConfig.ts src/panel/normalize-config.ts
git mv src/panel/poiTypeGroups.ts src/panel/poi-type-groups.ts
git mv src/panel/hooks/useConfig.ts src/panel/hooks/use-config.ts
git mv src/panel/hooks/useStatus.ts src/panel/hooks/use-status.ts
```

- [ ] **Step 2: Fix imports**

Run `npm run typecheck`; fix every reported path in `src/panel/` until clean.
Update the imports in `test/configReducer.test.ts` and
`test/normaliseConfig.test.ts` (those test files are renamed in Task 6.1).

- [ ] **Step 3: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 4: Verify the panel still bundles**

Run: `npm run build:panel`
Expected: webpack builds with no error. The Module Federation expose entry
`./src/panel/index.tsx` is unchanged, so `webpack.config.cjs` needs no edit;
confirm the build output appears in `public/`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename panel files to kebab-case"
```

---

# Phase 5: Plugin shell and integration (Lane A)

Runs after Phases 3A, 3B, and 3C land. This phase is the atomic integration:
it executes Task 3C.2 (the monitor refactor) and Task 6.3 (the monitor-test
rewrite) together with the `plugin.ts` creation and the `index.ts` rewrite,
because the monitor refactor breaks `index.ts` until that rewrite. Do the
monitor refactor, the monitor-test rewrite, `plugin.ts`, and the `index.ts`
rewrite first with no commit in between; then run the full gate; then make one
green commit. The remaining Phase 5 tasks (the build-entrypoint checks) commit
normally afterward.

Order within the integration commit: (1) Task 3C.2 monitor refactor, (2) Task
6.3 monitor-test rewrite, (3) Task 5.1 `plugin.ts`, (4) Task 5.2 `index.ts`
rewrite. Stage all of it, run `npm run typecheck && npm run lint && npm test`,
confirm green, then one commit: `refactor: wire the modular plugin shell`.

### Task 5.1: Build the plugin factory

**Files:**
- Create: `src/plugin/plugin.ts`

- [ ] **Step 1: Write `src/plugin/plugin.ts`**

```typescript
/**
 * Plugin factory.
 *
 * Assembles the SignalK plugin from the input and output registries: it builds
 * the config schema from the modules' fragments, and its `start`/`stop`
 * lifecycle builds the aggregate POI source, starts the enabled outputs, and
 * builds the shared position monitor from the outputs' scan contributors.
 */

import type { Plugin, ServerAPI } from '@signalk/server-api'
import type { InputRegistry } from '../inputs/input-registry.js'
import type { OutputRegistry } from '../outputs/output-registry.js'
import type { OutputContext, OutputHandle, PositionScanContributor } from '../outputs/output.js'
import type { PoiSource } from '../inputs/poi-source.js'
import { assemblePluginSchema } from './plugin-config.js'
import { createPositionMonitor } from '../monitoring/position-monitor.js'
import type { PositionMonitor } from '../monitoring/position-monitor.js'
import { createPluginStatus } from '../status/plugin-status.js'
import type { PluginStatus } from '../status/plugin-status.js'
import { createStatusRouter } from '../status/status-router.js'
import { buildPoiTypesString, ensurePoiTypes } from '../shared/poi-type-selection.js'
import { PLUGIN_ID } from '../shared/plugin-id.js'
import type { PluginConfig } from '../shared/types.js'

const PLUGIN_NAME = "Crow's Nest"
const PLUGIN_DESCRIPTION =
  'Imports Garmin ActiveCaptain points of interest as SignalK resources, with proximity and route-corridor hazard alarms'

/** OpenAPI description of the plugin's internal status API. */
const OPEN_API = {
  openapi: '3.0.0',
  info: {
    title: "Crow's Nest plugin API",
    version: '1.0.0',
    description: 'Internal status API consumed by the plugin configuration panel.'
  },
  paths: {
    '/api/status': {
      get: {
        summary: 'Plugin status snapshot',
        description: 'Returns the current status snapshot. Requires administrator authentication.',
        responses: {
          200: {
            description: 'The current status snapshot.',
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          401: { description: 'The caller is not an authenticated administrator.' }
        }
      }
    }
  }
}

/** State rebuilt on every plugin start so configuration changes take effect. */
interface Runtime {
  source: PoiSource
  handles: OutputHandle[]
  monitor?: PositionMonitor
}

/** Build the SignalK plugin from the input and output registries. */
export function createPlugin (
  app: ServerAPI,
  inputs: InputRegistry,
  outputs: OutputRegistry
): Plugin {
  let runtime: Runtime | undefined
  let status: PluginStatus = createPluginStatus()

  /** Tear the current runtime down. Idempotent. */
  function teardown (): void {
    if (runtime === undefined) {
      return
    }
    runtime.monitor?.stop()
    for (const handle of runtime.handles) {
      handle.stop()
    }
    runtime.source.close()
    runtime = undefined
  }

  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    schema: assemblePluginSchema(PLUGIN_NAME, PLUGIN_DESCRIPTION, [
      ...inputs.configSchemaFragments(),
      ...outputs.configSchemaFragments()
    ]),

    start: (rawConfig: object): void => {
      // Guard against a start() without a matching stop().
      teardown()

      const config = rawConfig as PluginConfig
      // A fresh recorder per run: this run reports its own start time and a
      // clean error history.
      status = createPluginStatus()

      const source = inputs.createSource({
        app,
        config,
        status,
        dataDir: app.getDataDirPath()
      })

      const outputContext: OutputContext = { app, config, pois: source, status }
      const handles = outputs.startEnabled(outputContext)
      runtime = { source, handles }

      // Build the shared position monitor from the outputs' scan contributors.
      const contributors: PositionScanContributor[] = handles
        .map((handle) => handle.positionScan)
        .filter((scan): scan is PositionScanContributor => scan !== undefined)
      if (contributors.length > 0) {
        const requiredTypes = [...new Set(contributors.flatMap((c) => [...c.poiTypes]))]
        try {
          runtime.monitor = createPositionMonitor({
            app,
            client: source,
            contributors,
            poiTypes: ensurePoiTypes(buildPoiTypesString(config), requiredTypes)
          })
        } catch (error) {
          app.error(`Cannot start the position monitor: ${String(error)}`)
        }
      }

      app.setPluginStatus('Ready, waiting for resource requests')
    },

    stop: (): void => {
      teardown()
    },

    getOpenApi: () => OPEN_API,

    registerWithRouter: createStatusRouter(
      app,
      () => status.snapshot(runtime?.source.cacheSize() ?? 0)
    )
  }
}
```

- [ ] **Step 2: Verify typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: `plugin.ts` compiles. `index.ts` still has the old code; it is
rewritten next. If `PLUGIN_ID` does not resolve, confirm
`src/shared/plugin-id.ts` exports it (it should, after Task 1.2).

- [ ] **Step 3: Commit**

```bash
git add src/plugin/plugin.ts
git commit -m "feat: add the plugin factory"
```

### Task 5.2: Rewrite `index.ts` as a thin assembler

**Files:**
- Modify: `src/index.ts` (replace its entire contents)

- [ ] **Step 1: Replace `src/index.ts` with the assembler**

```typescript
/**
 * SignalK plugin entrypoint.
 *
 * Registers the input and output modules and hands them to the plugin factory.
 * Adding a POI data source or a POI consumer means implementing the module
 * (see `src/inputs/poi-source.ts` and `src/outputs/output.ts`) and adding it
 * to the relevant array below. All wiring lives in `src/plugin/plugin.ts`.
 */

import type { Plugin, ServerAPI } from '@signalk/server-api'
import { createInputRegistry } from './inputs/input-registry.js'
import { createOutputRegistry } from './outputs/output-registry.js'
import { createPlugin } from './plugin/plugin.js'
import { activeCaptainInput } from './inputs/active-captain/active-captain-input.js'
import { notesResourceOutput } from './outputs/notes-resource/notes-resource-output.js'
import { proximityAlarmOutput } from './outputs/proximity-alarm/proximity-alarm-output.js'
import { routeHazardOutput } from './outputs/route-hazard/route-hazard-output.js'

export = function (app: ServerAPI): Plugin {
  const inputs = createInputRegistry([
    activeCaptainInput
  ])
  const outputs = createOutputRegistry([
    notesResourceOutput,
    proximityAlarmOutput,
    routeHazardOutput
  ])
  return createPlugin(app, inputs, outputs)
}
```

- [ ] **Step 2: Verify the gate**

Run: `npm run typecheck && npm run lint`
Expected: clean. Any remaining old import in `index.ts` is gone, so unused
moved files are no longer referenced from the entrypoint.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: every test except `test/position-monitor.test.ts` passes.
`test/position-monitor.test.ts` is rewritten in Task 6.3. If it fails to
compile, temporarily allow it: it is fixed in the next phase.

- [ ] **Step 4: Build the plugin**

Run: `npm run build`
Expected: `tsc` compiles `src/` to `dist/`, webpack bundles the panel to
`public/`, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "refactor: reduce the entrypoint to module registration"
```

### Task 5.3: Confirm the entrypoint of the build

The published `package.json` `main` field must still resolve. `tsc` mirrors the
`src/` tree into `dist/`, so `dist/index.js` still exists.

**Files:**
- Verify: `package.json` (`main`, `files`)

- [ ] **Step 1: Confirm the build output path**

```bash
npm run build:plugin
test -f dist/index.js && echo "dist/index.js present"
node -e "console.log(require('./package.json').main)"
```

Expected: `dist/index.js present`, and `main` is `dist/index.js` (or
`dist/index`). If `main` points elsewhere, correct it to `dist/index.js`.

- [ ] **Step 2: Confirm the publish file list**

```bash
node -e "console.log(require('./package.json').files)"
```

Expected: the list includes `dist` and `public`. No change needed; if a stale
path is listed, correct it.

- [ ] **Step 3: Commit any correction**

```bash
git add package.json
git commit -m "chore: confirm build entrypoint after restructure" --allow-empty
```

---

# Phase 6: Test migration, monitor test rewrite, and docs (Lane E)

### Task 6.1: Rename test files to kebab-case

Tests stay flat under `test/`. Rename each to match its module.

**Files:**
- Move every `test/*.test.ts` whose name is camelCase to kebab-case:
  `activeCaptainClient.test.ts` -> `active-captain-client.test.ts`,
  `configReducer.test.ts` -> `config-reducer.test.ts`,
  `courseReader.test.ts` -> `course-reader.test.ts`,
  `handlebarsUtilities.test.ts` -> `poi-detail-renderer.test.ts`,
  `normaliseConfig.test.ts` -> `normalize-config.test.ts`,
  `pluginStatus.test.ts` -> `plugin-status.test.ts`,
  `poiCache.test.ts` -> `poi-cache.test.ts`,
  `poiStore.test.ts` -> `poi-store.test.ts`,
  `poiTypeSelection.test.ts` -> `poi-type-selection.test.ts`,
  `positionMonitor.test.ts` -> `position-monitor.test.ts`,
  `positionUtilities.test.ts` -> `position-utilities.test.ts`,
  `proximityAlarms.test.ts` -> `proximity-alarms.test.ts`,
  `ratingFilter.test.ts` -> `rating-filter.test.ts`,
  `resourceQuery.test.ts` -> `resource-query.test.ts`,
  `routeCorridor.test.ts` -> `route-corridor.test.ts`,
  `routeHazardAlarms.test.ts` -> `route-hazard-alarms.test.ts`

- [ ] **Step 1: Move every file**

```bash
cd test
git mv activeCaptainClient.test.ts active-captain-client.test.ts
git mv configReducer.test.ts config-reducer.test.ts
git mv courseReader.test.ts course-reader.test.ts
git mv handlebarsUtilities.test.ts poi-detail-renderer.test.ts
git mv normaliseConfig.test.ts normalize-config.test.ts
git mv pluginStatus.test.ts plugin-status.test.ts
git mv poiCache.test.ts poi-cache.test.ts
git mv poiStore.test.ts poi-store.test.ts
git mv poiTypeSelection.test.ts poi-type-selection.test.ts
git mv positionMonitor.test.ts position-monitor.test.ts
git mv positionUtilities.test.ts position-utilities.test.ts
git mv proximityAlarms.test.ts proximity-alarms.test.ts
git mv ratingFilter.test.ts rating-filter.test.ts
git mv resourceQuery.test.ts resource-query.test.ts
git mv routeCorridor.test.ts route-corridor.test.ts
git mv routeHazardAlarms.test.ts route-hazard-alarms.test.ts
cd ..
```

- [ ] **Step 2: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green except `test/position-monitor.test.ts` (rewritten next).
Import paths inside the test files were already corrected during the move
tasks; if `npm run typecheck` reports a stale path, fix it.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: rename test files to kebab-case"
```

### Task 6.2: Confirm the test-file `.ts` import specifiers

The test files import source modules with a `.ts` specifier (for example
`import { x } from '../src/inputs/poi-source.ts'`), matching the existing
convention in `test/`. Confirm every moved test imports its module at the new
path.

- [ ] **Step 1: Scan for stale source paths**

```bash
grep -rEn "from '\.\./src/" test | grep -vE "/(shared|inputs|outputs|monitoring|geo|status|plugin|panel)/" || echo "all imports point into the new tree"
```

Expected: `all imports point into the new tree`. Any line printed is a stale
top-level `../src/<file>.ts` import; update it to the module's new directory.

- [ ] **Step 2: Verify the gate and commit**

```bash
npm run typecheck && npm run lint && npm test
git add -A && git commit -m "test: point test imports at the restructured modules" --allow-empty
```

### Task 6.3: Rewrite the position-monitor test

> **EXECUTION NOTE:** execute this task inside the Phase 5 integration commit,
> not after it (see the Phase 5 note). It is listed here only because it is a
> test-suite change. The steps below still apply; the commit is the shared
> Phase 5 integration commit, so skip this task's own Step 4 commit.

The monitor's interface changed (Task 3C.2): `createPositionMonitor` now takes
`contributors` instead of `alarms`/`routeScan`/`scanRadiusMeters`. Rewrite the
test against the new interface, porting every scenario.

**Files:**
- Modify: `test/position-monitor.test.ts` (rewrite)

- [ ] **Step 1: Rewrite the test**

Keep the existing `PositionStream`/`MonitorApp` stub helpers from the old test.
Replace every `alarms`/`routeScan` setup with one or more fake
`PositionScanContributor`s: an object with `poiTypes`, a `buildFetchBox` spy,
and an `evaluate` spy. Port these scenarios from the old test and from the
monitor's documented behavior:

1. The first position fix triggers a tick (no throttle on the first fix).
2. A second fix within `minIntervalMs` does not tick; one past both the time
   and the distance thresholds does.
3. A burst of fixes while a tick is in flight does not stack overlapping list
   requests (`tickInFlight` guard); the deferred fix ticks once the slot frees.
4. `buildFetchBox` results from several contributors are unioned into one
   `listPointsOfInterest` call, and `poiTypes` is passed through.
5. When every contributor returns `null` from `buildFetchBox`, no list request
   is made and every contributor's `evaluate` is still called with `[]`.
6. `evaluate` is called with the latest position, not the tick's start
   position, when a newer fix arrived during the request.
7. A `listPointsOfInterest` rejection is swallowed (the tick does not throw)
   and logged via `app.debug`.
8. A list response that lands after `stop()` does not call any `evaluate`.
9. `stop()` unsubscribes from the position stream and is idempotent.

Use a controllable `now()` and a deferred-promise fake source so the in-flight
and throttle scenarios are deterministic, exactly as the old test did.

- [ ] **Step 2: Run the test**

Run: `node --import tsx --test test/position-monitor.test.ts`
Expected: PASS, every ported scenario green.

- [ ] **Step 3: Verify the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green, total test count is the prior 212 minus the monitor's old
case count plus the rewritten cases plus the new module tests.

- [ ] **Step 4: Commit**

```bash
git add test/position-monitor.test.ts
git commit -m "test: rewrite the position-monitor test for the contributor model"
```

### Task 6.4: Update `CLAUDE.md` and `docs/`

**Files:**
- Modify: `CLAUDE.md` (the Layout section)
- Modify: `docs/development.md` (any module-path references)

- [ ] **Step 1: Rewrite the `CLAUDE.md` Layout section**

Replace the flat `src/` file list with the new directory structure: describe
`src/index.ts` as the module-registration entrypoint, then `src/plugin/`,
`src/inputs/` (with the `PoiSource`/`InputModule` contracts and the
`active-captain/` source), `src/outputs/` (with the `OutputModule` contract and
the `notes-resource/`, `proximity-alarm/`, and `route-hazard/` outputs),
`src/monitoring/`, `src/geo/`, `src/status/`, `src/shared/`, and `src/panel/`.
Add a sentence to the "Architecture rule" or "Conventions" section: a new POI
data source is a new `InputModule` under `src/inputs/`, and a new consumer is a
new `OutputModule` under `src/outputs/`, registered in `src/index.ts`; this is
the modular extension path and it does not change the one-plugin rule.

- [ ] **Step 2: Update `docs/development.md`**

Search `docs/development.md` for references to old module paths or filenames
(for example `activeCaptainClient.ts`, `positionMonitor.ts`) and update them to
the new paths. Run:

```bash
grep -rEn "activeCaptainClient|positionMonitor|poiCache|courseReader|routeCorridor|handlebarsUtilities|resourceQuery|pluginStatus" docs CLAUDE.md README.md || echo "no stale module references"
```

Fix every printed reference.

- [ ] **Step 3: Verify the gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: describe the modular input/output structure"
```

### Task 6.5: Final verification sweep

- [ ] **Step 1: Run every check**

```bash
npm run clean && npm run build && npm run typecheck && npm run lint && npm test
```

Expected: build succeeds, `dist/` and `public/` populated, typecheck clean,
lint clean, every test green.

- [ ] **Step 2: Confirm no stale top-level source files remain**

```bash
ls src/*.ts 2>/dev/null
```

Expected: only `src/index.ts`. Any other top-level `src/*.ts` was missed by a
move task; move it into its directory and fix imports.

- [ ] **Step 3: Confirm the `.gitkeep` files are gone**

```bash
find src -name .gitkeep
```

Expected: no output. Every directory now holds real files. Remove any
remaining `.gitkeep` and commit.

```bash
find src -name .gitkeep -delete
git add -A && git commit -m "chore: drop directory placeholders" --allow-empty
```

---

## Behavior-preservation acceptance checks

Run after Phase 6. These confirm the restructuring changed no behavior.

- [ ] `npm test` is green: every ported test plus the new module and registry
  tests.
- [ ] `npm run build` produces `dist/index.js` and a `public/` panel bundle.
- [ ] The assembled config schema has the same properties, in the same order,
  as the legacy literal: `cachingDurationMinutes`, the 13 `includeX` toggles,
  `minimumRating`, `enableProximityAlarms`, `proximityAlarmRadiusMeters`,
  `enableRouteHazardScan`, `routeCorridorWidthMeters`, with `required` equal to
  `['cachingDurationMinutes']`. Verify by adding a one-off assertion or by
  inspection of `assemblePluginSchema` output in a `node --import tsx` REPL.
- [ ] The webpack Module Federation expose name is still
  `./PluginConfigurationPanel` (unchanged in `webpack.config.cjs`).
- [ ] `git log --stat` shows the moved files retained history (moves used
  `git mv`).

## Deferred work (not in this plan)

- Multi-source aggregation and POI-id namespacing (changes resource ids).
- A dynamic, schema-driven panel; new outputs still need a hand-written panel
  component.

Both are documented in the design spec.
