import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const EXPECTED_SHARED_UI_VERSION = '0.8.2'
// Split for the same reason as scripts/check-package.mjs: the shape assertion
// is never hand-edited, so pasting a failing range into the literal above
// cannot quietly turn an exact pin into a range that still reports as exact.
const EXACT_SHARED_UI_VERSION = /^0\.\d+\.\d+$/
const packageManifest: unknown = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const uiPackage: unknown = JSON.parse(
  readFileSync(resolve('node_modules/signalk-nearlcrews-ui/package.json'), 'utf8')
)
if (typeof packageManifest !== 'object' || packageManifest === null ||
    !('devDependencies' in packageManifest) ||
    typeof packageManifest.devDependencies !== 'object' || packageManifest.devDependencies === null ||
    !('signalk-nearlcrews-ui' in packageManifest.devDependencies)) {
  throw new Error('package.json declares no signalk-nearlcrews-ui development dependency')
}
const pinnedVersion: unknown = packageManifest.devDependencies['signalk-nearlcrews-ui']
if (typeof pinnedVersion !== 'string' || !EXACT_SHARED_UI_VERSION.test(pinnedVersion)) {
  throw new Error(
    'package.json must pin signalk-nearlcrews-ui to an exact version, not a range; it has ' +
    JSON.stringify(pinnedVersion)
  )
}
if (pinnedVersion !== EXPECTED_SHARED_UI_VERSION) {
  throw new Error(
    `package.json must pin signalk-nearlcrews-ui ${EXPECTED_SHARED_UI_VERSION}; it has ${pinnedVersion}`
  )
}
if (typeof uiPackage !== 'object' || uiPackage === null ||
    !('version' in uiPackage) || typeof uiPackage.version !== 'string') {
  throw new Error('signalk-nearlcrews-ui package.json carries no version string')
}
const uiVersion = uiPackage.version
if (uiVersion !== EXPECTED_SHARED_UI_VERSION) {
  throw new Error(
    `installed signalk-nearlcrews-ui must be ${EXPECTED_SHARED_UI_VERSION}; it is ${uiVersion}`
  )
}

test.beforeEach(async ({ page }) => {
  page.on('console', (message) => {
    if (message.type() === 'error') throw new Error(`Browser console error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    throw error
  })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')
  await expect(page.getByText('Plugin status', { exact: true })).toBeVisible()
})

test('loads the production remote with the current shared UI and saves defaults', async ({ page }) => {
  const root = page.locator('[data-snui-root]')
  await expect(root).toHaveAttribute('data-snui-version', uiVersion)
  await expect(root).not.toHaveAttribute('data-snui-theme')
  await expect(page.getByRole('radio', { name: 'Auto' })).toBeChecked()

  await page.getByRole('button', { name: /Garmin ActiveCaptain/ }).click()
  await expect(page.getByRole('button', { name: 'Advanced' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1')
  await expect(page.getByRole('status')).toContainText('Save requested')
  await expect(page.getByRole('status')).toBeFocused()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('preserves unknown configuration keys through an edit and save request', async ({ page }) => {
  await page.goto('/?future-config')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')

  await page.getByRole('checkbox', { name: 'Enable OpenSeaMap' }).check()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1')

  const saved = JSON.parse(await page.locator('body').getAttribute('data-saved-configuration') ?? '{}')
  expect(saved.futureFeature).toEqual({ enabled: true, strategy: 'coastal' })
  expect(saved.futureFlag).toBe('keep-me')
  expect(saved.openSeaMapEnabled).toBe(true)
})

test('provides deterministic populated state for the release screenshot', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-12T16:00:00.000Z'))
  await page.goto('/?screenshot')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked()
  await expect(page.getByText('reachable', { exact: true })).toHaveCount(8)
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(7)
  for (const name of [
    'Garmin ActiveCaptain',
    'OpenSeaMap',
    'USCG Light List',
    'NOAA ENC Direct',
    'NOAA CO-OPS',
    'USCG Local Notice to Mariners',
    'NGA World Port Index',
    'USACE locks and dams'
  ]) {
    await expect(page.locator(`[title^="${name}: 1 POI in last fetch"]`)).toHaveCount(1)
  }
})

test('supports every explicit theme and returns to Auto', async ({ page }) => {
  const root = page.locator('[data-snui-root]')
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' })
  for (const [label, value] of [
    ['System', 'system'],
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['Night', 'night']
  ] as const) {
    await themeGroup.getByRole('radio', { name: label }).click()
    await expect(root).toHaveAttribute('data-snui-theme', value)
  }
  await themeGroup.getByRole('radio', { name: 'Auto' }).click()
  await expect(root).not.toHaveAttribute('data-snui-theme')
})

test('holds a below-minimum numeric draft while editing and normalizes it on blur', async ({ page }) => {
  // The draft buffer is what lets a field be cleared or part-typed without the
  // clamp snapping it back on every keystroke, so it must survive while the
  // field has focus and must give way to the committed value once focus
  // leaves. Both halves are pinned here because they also bound the retained
  // section behavior: every NumberField sits inside a CollapsibleSection whose
  // default mountStrategy is 'retain', and collapsing one requires clicking
  // its header, which blurs the field first. A draft therefore cannot outlive
  // a collapse to be stranded by the effects React Activity re-runs on reopen.
  await page.getByRole('button', { name: 'Alerts' }).click()
  await page.getByRole('checkbox', { name: 'Emit an alarm when the vessel nears a hazard' }).check()

  // A raw "0" is below the one metre floor, so the committed value clamps away
  // from it. That is what makes this discriminating rather than tautological.
  const radius = page.getByRole('spinbutton', { name: /Alarm radius/ })
  await radius.fill('0')
  await expect(radius).toHaveValue('0')

  await page.getByRole('button', { name: 'Data sources' }).focus()
  await expect(radius).not.toHaveValue('0')
})

test('has no Axe findings or horizontal overflow at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('gives every interactive control a 44-pixel coarse-pointer target @coarse', async ({ page }) => {
  // The heaviest test in the repository by design: it drives roughly eighty
  // interactions, expanding every section and then checking every toggle.
  // That costs about 26 seconds on an idle host and over 40 on a busy one,
  // which does not fit the 30-second project default, so it carries its own
  // budget rather than holding every other test to a limit only this one
  // needs. The budget applies to the body, not to the shared beforeEach.
  test.setTimeout(120_000)

  // A sweep rather than a list of suspects. The one target this panel got
  // wrong was found by review, not by measurement, and a second one (the
  // jump-to-source button in the recent-error list) then survived every check
  // here because no fixture state rendered it. So this expands everything,
  // renders the error state, and measures whatever the panel actually draws.
  await page.goto('/?errors')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')

  for (let pass = 0; pass < 40; pass++) {
    const collapsed = page.locator('[data-snui-root] button[aria-expanded="false"]')
    if (await collapsed.count() === 0) break
    const next = collapsed.first()
    await next.scrollIntoViewIfNeeded()
    await next.click()
  }
  expect(await page.locator('[data-snui-root] button[aria-expanded="false"]').count()).toBe(0)

  // Enable every toggle so the fields they gate render as live controls.
  const toggles = page.locator('[data-snui-root] input[type="checkbox"]')
  for (let index = 0; index < await toggles.count(); index++) {
    await toggles.nth(index).check({ force: true })
  }

  const measured = await page.evaluate(() => {
    const root = document.querySelector('[data-snui-root]')
    if (root === null) return { total: 0, undersized: ['panel root missing'] }
    const undersized: string[] = []
    let total = 0
    for (const element of root.querySelectorAll('button, a[href], select, input, textarea')) {
      const control = element as HTMLInputElement
      if (control.type === 'hidden' || element.closest('[hidden]') !== null) continue
      let box = element.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      // Clicking anywhere in a label activates its control, so where a label
      // wraps the input the label is the honest target, text or not.
      const label = element.closest('label')
      if (label !== null) box = label.getBoundingClientRect()
      total++
      if (box.height >= 44) continue
      const name = element.getAttribute('aria-label') ?? element.id ??
        (element.textContent ?? '').trim().slice(0, 30)
      undersized.push(`${element.tagName.toLowerCase()}[${name}] ${box.height.toFixed(1)}px`)
    }
    return { total, undersized }
  })
  expect(measured.undersized).toEqual([])
  // Guard the sweep itself: a selector or expansion regression that measured
  // almost nothing would otherwise pass silently.
  expect(measured.total).toBeGreaterThan(80)

  // The enable checkbox is a square target taking its size from a text-free
  // label, so its width has to clear the floor too.
  const enableTarget = page.locator('label:has(input[aria-label="Enable OpenSeaMap"])')
  const targetBox = await enableTarget.boundingBox()
  expect(targetBox?.width).toBeGreaterThanOrEqual(44)
})

test('shows a compatibility message when native CSS scope is unavailable', async ({ page }) => {
  await page.goto('/?unsupported-css-scope')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')
  await expect(page.locator('[data-browser-compatibility-message]')).toContainText(
    'Browser update required'
  )
  await expect(page.locator('[data-snui-root]')).toHaveCount(0)
})
