import * as React from 'react'
import { createRoot } from 'react-dom/client'

interface PanelProps {
  configuration: unknown
  save: (configuration: unknown) => void
}

interface RemoteContainer {
  get: (module: string) => Promise<() => { default: React.ComponentType<PanelProps> }>
  init: (scope: ShareScope) => Promise<void> | void
}

interface ShareScope {
  readonly react: Record<string, {
    readonly eager: boolean
    readonly from: string
    readonly get: () => Promise<() => typeof React>
    readonly loaded: boolean
  }>
}

if (new URLSearchParams(window.location.search).has('unsupported-css-scope')) {
  Object.defineProperty(window, 'CSSScopeRule', { configurable: true, value: undefined })
}

const statusPayload = {
  sources: [],
  cachedPoiCount: 0,
  recentErrors: [],
  startedAt: new Date().toISOString()
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
      loaded: true
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
    const [configuration, setConfiguration] = React.useState<unknown>(null)
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
