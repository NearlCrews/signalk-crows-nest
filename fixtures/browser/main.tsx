import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
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

interface PanelProps {
  configuration: unknown
  save: (configuration: unknown) => void
}

interface RemoteContainer {
  get: (module: string) => Promise<() => { default: React.ComponentType<PanelProps> }>
  init: (scope: ShareScope) => Promise<void> | void
}

interface ShareScope {
  readonly react: Record<string, ShareScopeEntry<typeof React>>
  readonly 'react-dom': Record<string, ShareScopeEntry<typeof ReactDOM>>
}

interface ShareScopeEntry<T> {
  readonly eager: boolean
  readonly from: string
  readonly get: () => Promise<() => T>
  readonly loaded: boolean
  readonly shareConfig: {
    readonly singleton: boolean
    readonly requiredVersion: string
  }
}

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
  recentErrors: [],
  startedAt: fixtureParams.has('screenshot') ? screenshotTimestamp : new Date().toISOString()
}

window.fetch = async (input): Promise<Response> => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const path = new URL(rawUrl, window.location.origin).pathname
  if (path.endsWith('/api/status')) {
    return new Response(JSON.stringify(statusPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  return new Response(JSON.stringify({ error: `Unhandled fixture request: ${path}` }), {
    status: 404,
    headers: { 'content-type': 'application/json' }
  })
}

async function loadRemote (): Promise<RemoteContainer> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/panel-assets/remoteEntry.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load the production panel remote.'))
    document.head.append(script)
  })
  const container = (window as unknown as Record<string, unknown>).signalk_crows_nest
  if (typeof container !== 'object' || container === null) {
    throw new Error('The production panel did not register its remote container.')
  }
  return container as unknown as RemoteContainer
}

const shareScope: ShareScope = {
  react: {
    [React.version]: {
      eager: true,
      from: 'crows-nest-browser-fixture',
      get: () => Promise.resolve(() => React),
      loaded: true,
      shareConfig: {
        singleton: true,
        requiredVersion: `^${React.version}`
      }
    }
  },
  'react-dom': {
    [ReactDOM.version]: {
      eager: true,
      from: 'crows-nest-browser-fixture',
      get: () => Promise.resolve(() => ReactDOM),
      loaded: true,
      shareConfig: {
        singleton: true,
        requiredVersion: `^${ReactDOM.version}`
      }
    }
  }
}

try {
  const container = await loadRemote()
  await container.init(shareScope)
  const factory = await container.get('./PluginConfigurationPanel')
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
          : null
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
