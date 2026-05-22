# Config UI for signalk-activecaptain-resources

**Status:** Approved. Ready for implementation.

**Date:** 2026-05-22

**Target release:** v1.2.0

## 1. Problem

The plugin is configured through the SignalK admin UI's stock react-jsonschema-form, generated from `plugin.schema`. That form has no live feedback: a user cannot tell whether the Garmin API is reachable, how much data is cached, or whether recent requests failed. The 13 POI-type toggles render as a flat, unscannable list.

## 2. Approach

Adopt the federated React panel pattern (the `signalk-plugin-configurator` keyword), modelled on the `signalk-nmea2000-emitter-cannon` plugin. A webpack Module Federation build produces a React app under `public/`; the SignalK admin UI loads its `remoteEntry.js` and renders the exposed `PluginConfigurationPanel` component instead of the generated form.

The Node plugin keeps its current build (`tsc` to `dist/`, CommonJS). The panel is a second, independent build (`webpack` to `public/`). One `npm run build` runs both. The plugin's config shape is unchanged, so there is no migration logic.

The panel adds a live status section, which needs the plugin to expose a small admin-gated HTTP endpoint and to record request outcomes.

## 3. Decisions locked in brainstorming

| Decision | Choice |
|---|---|
| Panel scope | Config form plus a live status dashboard |
| POI-type layout | 13 toggles in four labelled groups, with All and None buttons |
| Preset chips | Out of scope |
| Map preview | Out of scope |
| Dark mode | Out of scope |
| Federation container | Classic `library: { type: "var" }` (matches the emitter cannon source; the plugin is CommonJS with no `"type": "module"`, so there is no ESM tension) |

## 4. File layout

New files:

```
src/
  statusTypes.ts        // StatusSnapshot type, shared by plugin and panel
  pluginStatus.ts       // request-outcome recorder, produces StatusSnapshot
  statusRouter.ts       // admin-gated Express router factory
  panel/
    index.tsx                       // federation entry, re-exports the panel
    PluginConfigurationPanel.tsx    // root component
    poiTypeGroups.ts                // UI metadata: the four groups and labels
    configReducer.ts                // pure reducer over PluginConfig (testable)
    styles.ts                       // inline style objects
    components/
      StatusBar.tsx
      CacheDurationField.tsx
      PoiTypeGroups.tsx
      FooterBar.tsx
    hooks/
      useConfig.ts                  // useReducer wrapper around configReducer
      useStatus.ts                  // polls /api/status
webpack.config.cjs
tsconfig.panel.json
test/
  pluginStatus.test.ts
  configReducer.test.ts
public/                 // webpack output, git-ignored, shipped in the npm tarball
```

Existing files that change:

- `src/index.ts`: gains `registerWithRouter`, creates a `PluginStatus`, records list-fetch and detail outcomes around the existing client calls.
- `src/poiCache.ts`: `PoiCache` gains `size(): number` so the status snapshot can report the cached entry count.
- `package.json`: adds the `signalk-plugin-configurator` keyword, `public/` to `files`, panel build scripts, panel devDependencies; version bumps to 1.2.0.
- `tsconfig.json`: excludes `src/panel` (it is built by webpack, not tsc).
- `eslint.config.js`: lints `.tsx` panel files.
- `.gitignore`: ignores `public/` build output.
- `.github/workflows/ci.yml`: the existing build step now also builds the panel; add a typecheck step covering both tsconfigs.
- `README.md`: documents the panel and the minimum admin UI version.

## 5. Status API

The plugin gains `registerWithRouter`, mounting one endpoint under `/plugins/signalk-activecaptain-resources/`:

```
GET /api/status  ->  StatusSnapshot
```

`StatusSnapshot` (in `src/statusTypes.ts`, imported by both the plugin and the panel):

```typescript
export interface StatusSnapshot {
  apiReachable: boolean | null            // null until the first request
  lastListFetch: { at: string, poiCount: number } | null
  cachedPoiCount: number
  recentErrors: Array<{ at: string, message: string }>  // most recent 5
  startedAt: string
}
```

The endpoint is admin-gated with `app.securityStrategy.addAdminMiddleware('/plugins/signalk-activecaptain-resources/api')`, matching the emitter cannon panel. Plugin routers receive no auth by default; without this gate the endpoint would be reachable by anyone on the admin port. The panel runs inside the admin's authenticated session, so the gate is transparent to legitimate use.

`src/pluginStatus.ts` exposes `createPluginStatus()` returning a `PluginStatus` with `recordListFetch(poiCount)`, `recordDetailSuccess()`, `recordError(message)`, and `snapshot(cachedPoiCount)`. `apiReachable` is derived passively from the last request outcome: no extra Garmin traffic, consistent with the API research in `docs/garmin-api.md`. `index.ts` calls these around the existing `listPointsOfInterest` and `cache.get` calls; the cache reports its own entry count through the new `poiCache.size()`.

## 6. Panel

`PluginConfigurationPanel({ configuration, save })`, the federation contract from the admin UI. `save` is fire-and-forget.

```
PluginConfigurationPanel
├── StatusBar           // apiReachable dot, cached count, last fetch, recent errors
├── CacheDurationField  // cachingDurationMinutes number input
├── PoiTypeGroups       // four labelled groups of toggles, with All and None
└── FooterBar           // dirty indicator, Save, Discard
```

State: a single `useReducer` at the panel root over the existing `PluginConfig` shape. The reducer (`configReducer.ts`) is a pure function, exported and unit-tested. Actions: `setCacheDuration`, `setPoiType`, `setAllPoiTypes`, `discard`. Dirty is an identity check against the last-saved snapshot. `save(state)` runs only on an explicit Save click.

`useStatus` polls `GET /plugins/signalk-activecaptain-resources/api/status` every 5 seconds, paused when `document.hidden`, and surfaces a non-fatal error banner if a poll fails.

The four POI-type groups (`poiTypeGroups.ts`):

- Berthing and services: Marinas, Anchorages, Boat ramps, Businesses
- Navigation and hazards: Hazards, Inlets, Navigational aids
- Infrastructure: Bridges, Dams, Ferries, Locks
- Other: Local knowledge, Airports

Styling is inline style objects with a small injected `<style>` block for states that need it, no CSS pipeline. React 19 is a host-provided shared singleton. Neutral palette, no theme assumptions.

## 7. Build and tooling

`webpack.config.cjs`: `ModuleFederationPlugin`, container name `signalk_activecaptain_resources` (the package name with non-word characters replaced), `library: { type: "var" }`, `filename: "remoteEntry.js"`, exposes `./PluginConfigurationPanel`, `react` and `react-dom` as shared singletons at `^19`. Output to `public/`. `babel-loader` with `@babel/preset-typescript` and `@babel/preset-react` (automatic runtime). A `resolve.extensionAlias` maps `.js` specifiers onto `.ts`/`.tsx` so panel code can import shared modules with the node16 `.js` convention.

`tsconfig.panel.json` extends the root tsconfig with `jsx: react-jsx`, DOM libs, `moduleResolution: Bundler`, `noEmit`, and includes `src/panel/**`, `src/types.ts`, `src/statusTypes.ts`, `src/poiTypeSelection.ts`.

`package.json` scripts: `build` runs `build:plugin` (`tsc`) then `build:panel` (`webpack`); `typecheck` runs `tsc --noEmit` over both tsconfigs; `clean` removes `dist/` and the `public/` build artifacts. `prepublishOnly` runs clean then build. New devDependencies: `webpack`, `webpack-cli`, `babel-loader`, `@babel/core`, `@babel/preset-react`, `@babel/preset-typescript`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@types/express`. `react` and `react-dom` are dev-only: at runtime they are host-provided singletons.

## 8. Testing

Unit tests with the existing `node:test` runner:

- `pluginStatus.test.ts`: recording a fetch sets `lastListFetch` and `apiReachable`; recording an error sets `apiReachable` false and caps `recentErrors` at five; `snapshot()` shape.
- `configReducer.test.ts`: each action, the All/None bulk actions, and discard.

No React component render tests: low value on a federation panel, matching the emitter cannon decision. The panel is exercised by a live smoke test in the running admin UI.

## 9. Rollout

- Version 1.2.0.
- Minimum SignalK admin UI 2.27.0 (it provides React 19), documented in the README.
- `public/` is git-ignored and rebuilt by `prepublishOnly`; the npm tarball ships `dist/` and `public/`.
- The `plugin.schema` property is kept: with the configurator keyword the admin UI ignores it, but non-admin tools may still read it.

## 10. Out of scope

- A map preview of POIs.
- Preset chips beyond All and None.
- Dark or night-red theming.
- React component render tests.
