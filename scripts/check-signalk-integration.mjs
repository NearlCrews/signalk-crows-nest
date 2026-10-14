/* global document, window */
// Mounts the installed production panel inside a running Signal K Admin UI.
// The CI signalk-admin job installs the release tarball into a real
// signalk-server, starts it, and runs this against SIGNALK_URL. Run it locally
// the same way, against a throwaway server on a free port and config
// directory, never against a live boat server.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const rawBaseUrl = process.env.SIGNALK_URL
assert.ok(rawBaseUrl, 'SIGNALK_URL must identify the running Signal K server')
const baseUrl = new URL(rawBaseUrl)

async function requestText (path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { accept: 'text/html,application/javascript,application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  assert.equal(response.ok, true, `${path} returned HTTP ${response.status}`)
  return response.text()
}

const adminHtml = await requestText('/admin/')
assert.match(adminHtml, /<html[\s>]/i, 'Signal K did not serve the Admin host document')
assert.match(adminHtml, /<script\b/i, 'Signal K Admin host document did not reference a JavaScript application')

const plugins = JSON.parse(await requestText('/skServer/plugins'))
assert.ok(Array.isArray(plugins), 'Signal K plugin list was not an array')
assert.ok(
  plugins.some((plugin) => plugin?.packageName === pkg.name || plugin?.id === pkg.name),
  `${pkg.name} was absent from the running Signal K plugin list`
)

const remotePath = `/${pkg.name}/remoteEntry.js`
const remote = await requestText(remotePath)
const safeName = pkg.name.replace(/[-@/]/g, '_')
assert.match(remote, new RegExp(`\\b${safeName}\\b`), 'the served panel remote did not expose its classic global name')
assert.doesNotMatch(remote, /jsxDEV|jsx-dev-runtime/, 'the served panel remote used the React development JSX runtime')

// CI points this at the runner's installed Chrome; locally it falls back to
// the Chromium build Playwright installs.
const browser = await chromium.launch({
  channel: process.env.SIGNALK_BROWSER_CHANNEL || undefined,
  headless: true
})
try {
  const page = await browser.newPage()
  const adminUrl = new URL(`/admin/#/serverConfiguration/plugins/${encodeURIComponent(pkg.name)}`, baseUrl)
  await page.goto(adminUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  // The same section heading the browser suite and `npm run check:panel` use
  // as the mount anchor.
  await page.getByRole('heading', { level: 2, name: 'Plugin status' })
    .waitFor({ state: 'visible', timeout: 30_000 })

  assert.equal(await page.locator('[data-snui-version]').count() > 0, true, 'the mounted panel did not render signalk-nearlcrews-ui')
  assert.equal(await page.getByText('Plugin Configuration Unavailable', { exact: true }).count(), 0, 'the Admin host displayed its plugin error boundary')
  assert.equal(await page.getByText('Error loading component', { exact: true }).count(), 0, 'the Admin host displayed its remote-loading fallback')

  const remoteState = await page.evaluate((containerName) => {
    const container = window[containerName]
    return {
      hasContainer: typeof container === 'object' && container !== null,
      hasGet: typeof container?.get === 'function',
      hasInit: typeof container?.init === 'function',
      injectedScripts: [...document.querySelectorAll('script[src$="/remoteEntry.js"]')]
        .map((script) => script.getAttribute('src'))
    }
  }, safeName)
  assert.deepEqual(
    { hasContainer: remoteState.hasContainer, hasGet: remoteState.hasGet, hasInit: remoteState.hasInit },
    { hasContainer: true, hasGet: true, hasInit: true },
    'the Admin page did not execute the production Module Federation container'
  )
  assert.ok(remoteState.injectedScripts.includes(remotePath), 'the mounted Admin page did not load the expected remote script')
} finally {
  await browser.close()
}

process.stdout.write(`Signal K executed its Admin application and mounted the installed ${pkg.name} production panel.\n`)
