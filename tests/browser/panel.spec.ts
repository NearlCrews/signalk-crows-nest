import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const EXPECTED_SHARED_UI_VERSION = '0.8.1'
const packageManifest: unknown = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const uiPackage: unknown = JSON.parse(
  readFileSync(resolve('node_modules/signalk-nearlcrews-ui/package.json'), 'utf8')
)
if (typeof packageManifest !== 'object' || packageManifest === null ||
    !('devDependencies' in packageManifest) ||
    typeof packageManifest.devDependencies !== 'object' || packageManifest.devDependencies === null ||
    !('signalk-nearlcrews-ui' in packageManifest.devDependencies) ||
    packageManifest.devDependencies['signalk-nearlcrews-ui'] !== EXPECTED_SHARED_UI_VERSION) {
  throw new Error(`package.json must pin signalk-nearlcrews-ui ${EXPECTED_SHARED_UI_VERSION}`)
}
if (typeof uiPackage !== 'object' || uiPackage === null ||
    !('version' in uiPackage) || typeof uiPackage.version !== 'string') {
  throw new Error('signalk-nearlcrews-ui package.json carries no version string')
}
const uiVersion = uiPackage.version
if (uiVersion !== EXPECTED_SHARED_UI_VERSION) {
  throw new Error(`installed signalk-nearlcrews-ui must be ${EXPECTED_SHARED_UI_VERSION}`)
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

test('has no Axe findings or horizontal overflow at 320 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test('provides coarse-pointer controls with 44-pixel targets @coarse', async ({ page }) => {
  for (const control of [
    page.getByRole('radio', { name: 'Auto' }),
    page.getByRole('button', { name: 'Data sources' }),
    page.getByRole('button', { name: 'Save', exact: true }),
    // The card header is the panel's own markup rather than a shared UI
    // control, so it is the one place the package's target floor is not
    // inherited for free. Both of its controls are covered here.
    page.getByRole('button', { name: /OpenSeaMap/ }).first()
  ]) {
    const box = await control.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
  // The enable checkbox paints a 22-pixel box and takes its target from the
  // label wrapped around it, so the label is what has to clear the floor, in
  // both dimensions because the target is square.
  const enableTarget = page.locator('label:has(input[aria-label="Enable OpenSeaMap"])')
  const targetBox = await enableTarget.boundingBox()
  expect(targetBox?.height).toBeGreaterThanOrEqual(44)
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
