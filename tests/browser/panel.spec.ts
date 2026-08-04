import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

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
  await expect(root).toHaveAttribute('data-snui-version', '0.6.2')
  await expect(root).not.toHaveAttribute('data-snui-theme')
  await expect(page.getByRole('radio', { name: 'Auto' })).toBeChecked()

  await page.getByRole('button', { name: /Garmin ActiveCaptain/ }).click()
  await expect(page.getByRole('button', { name: 'Advanced' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('supports every explicit theme and returns to Auto', async ({ page }) => {
  const root = page.locator('[data-snui-root]')
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' })
  for (const [label, value] of [
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
    page.getByRole('button', { name: 'Save', exact: true })
  ]) {
    const box = await control.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
})

test('shows a compatibility message when native CSS scope is unavailable', async ({ page }) => {
  await page.goto('/?unsupported-css-scope')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')
  await expect(page.locator('[data-browser-compatibility-message]')).toContainText(
    'Browser update required'
  )
  await expect(page.locator('[data-snui-root]')).toHaveCount(0)
})
