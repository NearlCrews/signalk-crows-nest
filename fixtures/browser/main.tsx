import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import { createHostShareScope, loadPanelRemote } from 'signalk-nearlcrews-ui/host-harness'
import {
  ACTIVE_CAPTAIN_SOURCE_ID,
  NOAA_COOPS_SOURCE_ID,
  NOAA_ENC_SOURCE_ID,
  OPENSEAMAP_SOURCE_ID,
  USACE_SOURCE_ID,
  USCG_LIGHT_LIST_SOURCE_ID,
  USCG_LNM_SOURCE_ID,
  WPI_SOURCE_ID
} from '../../src/shared/source-ids.js'

const fixtureParams = new URLSearchParams(window.location.search)
const screenshotTimestamp = '2026-08-12T16:00:00.000Z'

if (fixtureParams.has('unsupported-css-scope')) {
  Object.defineProperty(window, 'CSSScopeRule', { configurable: true, value: undefined })
}

const statusPayload = {
  sources: fixtureParams.has('screenshot')
    ? [
        { source: ACTIVE_CAPTAIN_SOURCE_ID, name: 'Garmin ActiveCaptain' },
        { source: OPENSEAMAP_SOURCE_ID, name: 'OpenSeaMap' },
        { source: USCG_LIGHT_LIST_SOURCE_ID, name: 'USCG Light List' },
        { source: NOAA_ENC_SOURCE_ID, name: 'NOAA ENC Direct' },
        { source: NOAA_COOPS_SOURCE_ID, name: 'NOAA CO-OPS' },
        { source: USCG_LNM_SOURCE_ID, name: 'USCG Local Notice to Mariners' },
        { source: WPI_SOURCE_ID, name: 'NGA World Port Index' },
        { source: USACE_SOURCE_ID, name: 'USACE locks and dams' }
      ].map(({ source, name }) => ({
        source,
        name,
        apiReachable: true,
        lastListFetch: { at: screenshotTimestamp, poiCount: 1 },
        lastSkip: null
      }))
    : [],
  cachedPoiCount: fixtureParams.has('screenshot') ? 8 : 0,
  // The recent-error list renders a jump-to-source button that exists in no
  // other state, so it needs a fixture mode of its own to be measurable.
  recentErrors: fixtureParams.has('errors')
    ? [
        {
          at: new Date().toISOString(),
          message: 'Overpass endpoint returned 504',
          source: OPENSEAMAP_SOURCE_ID
        },
        { at: new Date().toISOString(), message: 'Status poll timed out' }
      ]
    : [],
  startedAt: fixtureParams.has('screenshot') ? screenshotTimestamp : new Date().toISOString()
}

/**
 * The server-wide active unit preset, served only under `?imperial`.
 *
 * Every other fixture mode 404s the whole `/signalk/v1/unitpreferences/`
 * ladder, which resolves to metric, so without this mode no test ever renders
 * a length field in feet. The panel's imperial path is where the metric
 * bounds become fractional (a 1 m floor is 3.28 ft), so it needs a fixture of
 * its own. Only the `length` category matters: `resolveUnitSystem` reads
 * `categories.length.targetUnit` and treats anything but `foot` as metric.
 */
const imperialPreset = {
  name: 'imperial',
  categories: {
    length: {
      targetUnit: 'foot',
      formula: 'value / 0.3048',
      inverseFormula: 'value * 0.3048',
      symbol: 'ft'
    }
  }
}

/** A JSON reply, the only kind this fixture serves. */
function jsonResponse (body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

window.fetch = async (input): Promise<Response> => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const path = new URL(rawUrl, window.location.origin).pathname
  if (path.startsWith('/signalk/v1/unitpreferences/')) {
    // The per-user applicationData document is left 404ing below, so the
    // ladder falls through to the server-wide active preset, which is the
    // rung a server with no per-user override actually answers on.
    if (fixtureParams.has('imperial') && path.endsWith('/unitpreferences/active')) {
      return jsonResponse(imperialPreset, 200)
    }
    return jsonResponse({ error: 'no unit preferences' }, 404)
  }
  if (path.endsWith('/api/status')) {
    // A status endpoint that never answers, so the panel's poll-failure
    // banner and the announcement that goes with it are measurable.
    if (fixtureParams.has('status-error')) {
      return jsonResponse({ error: 'status unavailable' }, 503)
    }
    return jsonResponse(statusPayload, 200)
  }
  return jsonResponse({ error: `Unhandled fixture request: ${path}` }, 404)
}

try {
  // The harness loads the remote and builds the share scope the way the
  // Signal K Admin does, so neither can drift from the host's own.
  const container = await loadPanelRemote({
    packageName: 'signalk-crows-nest',
    url: '/panel-assets/remoteEntry.js'
  })
  await container.init(createHostShareScope(React, ReactDOM))
  const factory = await container.get('./PluginConfigurationPanel')
  if (factory === undefined || factory === null) {
    throw new Error('The production panel does not expose ./PluginConfigurationPanel.')
  }
  const Panel = factory().default
  const rootElement = document.querySelector('#root')
  if (!(rootElement instanceof HTMLElement)) throw new Error('Fixture root is missing.')

  function HostFixture (): React.ReactElement {
    const [configuration, setConfiguration] = React.useState<unknown>(() =>
      fixtureParams.has('future-config')
        ? {
            cachingDurationMinutes: 15,
            futureFeature: { enabled: true, strategy: 'coastal' },
            futureFlag: 'keep-me'
          }
        : fixtureParams.has('screenshot')
          ? {
              openSeaMapEnabled: true,
              uscgLightListEnabled: true,
              noaaEncEnabled: true,
              noaaCoopsEnabled: true,
              uscgLnmEnabled: true,
              wpiEnabled: true,
              usaceEnabled: true
            }
          : undefined
    )
    const save = (nextConfiguration: unknown): void => {
      document.body.dataset.saveCount = String(Number(document.body.dataset.saveCount ?? 0) + 1)
      document.body.dataset.savedConfiguration = JSON.stringify(nextConfiguration)
      setConfiguration(nextConfiguration)
    }
    return <Panel configuration={configuration} save={save} />
  }

  createRoot(rootElement).render(<HostFixture />)
  document.body.dataset.fixtureReady = 'true'
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  document.querySelector('#fixture-error')?.append(document.createTextNode(message))
  document.body.dataset.fixtureReady = 'error'
}
