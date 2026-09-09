import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The installed shared UI's version, which the built remote must stamp on its
// root. The exact pin, its agreement with the installed package, and the stamp
// inside the bundle are asserted by the library's own `snui-check-consumer`
// command (`npm run check:panel`); this spec only proves the mounted panel
// reports that same version at runtime.
const uiPackage: unknown = JSON.parse(
  readFileSync(resolve('node_modules/signalk-nearlcrews-ui/package.json'), 'utf8')
)
if (typeof uiPackage !== 'object' || uiPackage === null ||
    !('version' in uiPackage) || typeof uiPackage.version !== 'string') {
  throw new Error('signalk-nearlcrews-ui package.json carries no version string')
}
const uiVersion = uiPackage.version

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
  // The save bar's status is the panel's one polite live region for the save
  // flow; the checkbox groups each mount an empty status region for their
  // empty-selection warning, so the text filter picks the save bar's.
  const saveStatus = page.getByRole('status').filter({ hasText: 'Save requested' })
  await expect(saveStatus).toBeVisible()
  // Focus moves to the bar's status destination, which wraps the live region,
  // so the focused element contains the confirmation rather than being it.
  await expect(page.locator(':focus')).toContainText('Save requested')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('renders each roled live region without a redundant aria-live', async ({ page }) => {
  // A roled live region must not also carry aria-live, which double announces
  // on some screen readers. Sweep every status and alert in the panel,
  // including the ones inside expanded cards.
  await page.getByRole('button', { name: /Garmin ActiveCaptain/ }).click()
  await page.getByRole('button', { name: 'Alerts' }).click()
  const roledRegions = page.locator('[data-snui-root] [role="status"], [data-snui-root] [role="alert"]')
  const count = await roledRegions.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    await expect(roledRegions.nth(index)).not.toHaveAttribute('aria-live')
  }
})

test('builds one heading outline from the sections down to each card', async ({ page }) => {
  // Signal K Admin owns the page heading and the h5 card header, so the panel
  // starts at h2: the status section, Data sources, and Alerts. Each source
  // card is an h3 under Data sources and its Advanced disclosure an h4, so a
  // screen reader's heading list reads as a tree rather than eight siblings.
  await expect(page.getByRole('heading', { level: 2, name: 'Plugin status' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Data sources' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Alerts' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(8)
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await page.getByRole('button', { name: /OpenSeaMap/ }).click()
  await expect(page.getByRole('heading', { level: 4, name: 'Advanced' })).toHaveCount(1)
  // The enable checkbox sits beside the heading, outside the toggle button,
  // and keeps its name through a visually hidden label.
  const enable = page.getByRole('checkbox', { name: 'Enable OpenSeaMap' })
  await expect(enable).toBeVisible()
  await expect(page.getByRole('button', { name: /OpenSeaMap/ })).not.toContainText('Enable')
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
  // Every card header carries an ok pill whose accessible text is the tone
  // label plus the label, and every retained card body holds the visible
  // detail line that replaced the old hover-only tooltip.
  await expect(page.getByText('Success. ok')).toHaveCount(8)
  await expect(page.getByText('1 POI in last fetch')).toHaveCount(8)
  // Every retained body holds the line; only the expanded card shows it.
  await page.getByRole('button', { name: /OpenSeaMap/ }).click()
  await expect(page.getByText('1 POI in last fetch, now.').filter({ visible: true })).toHaveCount(1)
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

  // The enable checkbox is a square target whose label is visually hidden,
  // so its width has to clear the floor too.
  const enableTarget = page.locator('label', {
    has: page.getByRole('checkbox', { name: 'Enable OpenSeaMap' })
  })
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

test('announces a status-poll failure from a region that predates the message', async ({ page }) => {
  // A live region created in the same commit as its text is not announced
  // reliably, so the announcer stays mounted and empty while the endpoint is
  // healthy and only its text changes when a poll fails. The empty region on
  // a healthy panel is the half a banner-only implementation cannot have.
  const announcer = page.locator('#ac-status-announcement')
  await expect(announcer).toHaveAttribute('role', 'status')
  await expect(announcer).toHaveText('')

  await page.goto('/?status-error')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')
  await expect(announcer).toHaveText(
    'Status unavailable. HTTP 503. The next poll will retry automatically.'
  )

  // The visible banner repeats the same words without becoming a second live
  // region, so a screen reader hears the failure once.
  const announcing = page
    .locator('[data-snui-root] [role="status"], [data-snui-root] [role="alert"], [data-snui-root] [aria-live]')
    .filter({ hasText: 'Status unavailable' })
  await expect(announcing).toHaveCount(1)
  await expect(announcing).toHaveAttribute('id', 'ac-status-announcement')

  // The failure is still on screen and not only announced: the banner repeats
  // the words outside the visually hidden announcer.
  const onScreen = page
    .getByText('HTTP 503. The next poll will retry automatically.', { exact: true })
    .and(page.locator('[data-snui-root] :not(#ac-status-announcement)'))
  await expect(onScreen).toHaveCount(1)
  await expect(onScreen).toBeVisible()
})

test('opens a collapsed Data sources section when jumping to a source', async ({ page }) => {
  await page.goto('/?errors')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')

  const section = page.getByRole('button', { name: 'Data sources' })
  await section.click()
  await expect(section).toHaveAttribute('aria-expanded', 'false')
  const card = page.getByRole('button', { name: 'OpenSeaMap', exact: true })
  await expect(card).toBeHidden()

  // The recent-error list is the only place this button exists, and the
  // section it points into is the one the operator just closed.
  await page.getByRole('button', { name: 'Show openseamap' }).click()

  await expect(section).toHaveAttribute('aria-expanded', 'true')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('aria-expanded', 'true')
  await expect(card).toBeInViewport()
  // Focus reaches a card that React had to reveal in the same commit, which
  // pins the handoff as running after the reveal rather than racing it.
  await expect(page.locator(':focus')).toHaveAccessibleName('OpenSeaMap')
})

test('moves focus to the revealed card when jumping to a source', async ({ page }) => {
  await page.goto('/?errors')
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')

  await page.getByRole('button', { name: 'Show openseamap' }).click()

  // Focus lands on the card's own disclosure toggle: it names the source and
  // reports that the card is now expanded, so the destination is announced
  // rather than merely scrolled to, and the next Tab reaches the first field
  // instead of the rest of the error list.
  const focused = page.locator(':focus')
  await expect(focused).toHaveAccessibleName('OpenSeaMap')
  await expect(focused).toHaveAttribute('aria-expanded', 'true')
})
