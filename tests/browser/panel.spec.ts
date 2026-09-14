import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
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

/**
 * Load a fixture mode and wait for the panel to mount.
 *
 * The wait is not optional: the fixture sets `data-fixture-ready` only after
 * the federated remote has loaded and rendered, so a test that navigates
 * without it races the mount and fails as a missing locator rather than as
 * the thing it meant to assert.
 */
async function gotoFixture (page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`)
  await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true')
}

/**
 * Match a source card's toggle, and the recent-error list's jump button for
 * that source, by their EXACT accessible names, never by a regex or a
 * substring.
 *
 * The card toggle is named for the source and the jump button is named
 * "Show <source>", so any partial match resolves to both wherever the
 * `?errors` fixture puts jump buttons on the page. That collision was
 * invisible while the button rendered a raw slug, `Show openseamap` against a
 * card named `OpenSeaMap`, so the partial matches here were passing on a
 * defect rather than on a property. They started failing the moment the
 * button began rendering the real display name.
 */

/**
 * Open Alerts and arm the proximity alarm, returning the radius field, which
 * is disabled until the toggle is on. Four tests need a live length control
 * and this is the cheapest one to reach.
 */
async function armProximityAlarm (page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Alerts' }).click()
  await page.getByRole('checkbox', { name: 'Emit an alarm when the vessel nears a hazard' }).check()
  return page.getByRole('spinbutton', { name: /Alarm radius/ })
}

test.beforeEach(async ({ page }) => {
  page.on('console', (message) => {
    if (message.type() === 'error') throw new Error(`Browser console error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    throw error
  })
  await gotoFixture(page)
  await expect(page.getByText('Plugin status', { exact: true })).toBeVisible()
})

test('loads the production remote with the current shared UI and saves defaults', async ({ page }) => {
  const root = page.locator('[data-snui-root]')
  await expect(root).toHaveAttribute('data-snui-version', uiVersion)
  await expect(root).not.toHaveAttribute('data-snui-theme')
  await expect(page.getByRole('radio', { name: 'Match Admin' })).toBeChecked()

  await page.getByRole('button', { name: 'Garmin ActiveCaptain', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Advanced' }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-save-count', '1')
  // Never query role="status" bare in this file. Several regions carry it at
  // once: the save bar's own status, which also reports an unusable endpoint
  // through invalidMessage, the always-mounted status-poll banner, the
  // ActiveCaptain empty-selection chip, and one per checkbox group. A text
  // filter or a scoped locator is what picks out the one under test.
  const saveStatus = page.getByRole('status').filter({ hasText: 'Save sent to the server' })
  await expect(saveStatus).toBeVisible()
  // Focus moves to the bar's status destination, which wraps the live region,
  // so the focused element contains the confirmation rather than being it.
  await expect(page.locator(':focus')).toContainText('Save sent to the server')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('renders each roled live region without a redundant aria-live', async ({ page }) => {
  // A roled live region must not also carry aria-live, which double announces
  // on some screen readers. Sweep every status and alert in the panel,
  // including the ones inside expanded cards.
  await page.getByRole('button', { name: 'Garmin ActiveCaptain', exact: true }).click()
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
  await page.getByRole('button', { name: 'OpenSeaMap', exact: true }).click()
  await expect(page.getByRole('heading', { level: 4, name: 'Advanced' })).toHaveCount(1)
  // The enable checkbox sits beside the heading, outside the toggle button,
  // and keeps its name through a visually hidden label.
  const enable = page.getByRole('checkbox', { name: 'Enable OpenSeaMap' })
  await expect(enable).toBeVisible()
  // Exactly one toggle is named for the source and nothing more, which is
  // what fails if the checkbox's label is ever absorbed into the button: the
  // name becomes "Enable OpenSeaMap" and this resolves to nothing.
  const toggle = page.getByRole('button', { name: 'OpenSeaMap', exact: true })
  await expect(toggle).toHaveCount(1)
  await expect(toggle).not.toContainText('Enable')
})

test('preserves unknown configuration keys through an edit and save request', async ({ page }) => {
  await gotoFixture(page, '?future-config')

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
  await gotoFixture(page, '?screenshot')
  await page.getByRole('radio', { name: 'Light' }).click()
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked()
  await expect(page.getByText('Reachable', { exact: true })).toHaveCount(8)
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(7)
  // Every card header carries a healthy pill whose accessible text is the
  // tone label plus the label, and every retained card body holds the visible
  // detail line that replaced the old hover-only tooltip. The label names the
  // source's state rather than repeating the tone, so it does not read as
  // "Success. ok".
  await expect(page.getByText('Success. Healthy')).toHaveCount(8)
  await expect(page.getByText('1 POI in last fetch')).toHaveCount(8)
  // Every retained body holds the line; only the expanded card shows it.
  await page.getByRole('button', { name: 'OpenSeaMap', exact: true }).click()
  await expect(page.getByText('1 POI in last fetch, now.').filter({ visible: true })).toHaveCount(1)
})

test('supports every explicit theme and returns to Match Admin', async ({ page }) => {
  const root = page.locator('[data-snui-root]')
  const themeGroup = page.getByRole('radiogroup', { name: 'Panel theme' })
  for (const [label, value] of [
    ['Match device', 'system'],
    ['Light', 'light'],
    ['Dark', 'dark'],
    ['Night', 'night']
  ] as const) {
    await themeGroup.getByRole('radio', { name: label }).click()
    await expect(root).toHaveAttribute('data-snui-theme', value)
  }
  await themeGroup.getByRole('radio', { name: 'Match Admin' }).click()
  await expect(root).not.toHaveAttribute('data-snui-theme')

  // The selector is chrome, not the operator's task, so it trails the panel
  // and must not take the first tab stop ahead of the status readout and the
  // source cards. Nothing here carries a positive tabindex, so document order
  // is the tab order.
  const trailsTheContent = await page.evaluate(() => {
    const panel = document.querySelector('[data-snui-root]')
    const group = panel?.querySelector('[role="radiogroup"]') ?? null
    const card = panel?.querySelector('#ac-source-card-openseamap') ?? null
    if (group === null || card === null) return null
    return Boolean(card.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(trailsTheContent).toBe(true)
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
  // A raw "0" is below the one metre floor, so the committed value clamps away
  // from it. That is what makes this discriminating rather than tautological.
  const radius = await armProximityAlarm(page)
  await radius.fill('0')
  await expect(radius).toHaveValue('0')

  await page.getByRole('button', { name: 'Data sources' }).focus()
  await expect(radius).not.toHaveValue('0')
})

test('Discard drops a number draft that did not change the committed value', async ({ page }) => {
  // The case draft-reset-context.ts exists for, and the only one the Discard
  // epoch can reach. A draft is shown while the value it was typed against is
  // still committed, so a Discard that moves the value drops the draft by
  // itself; a draft that resolves to the value already committed leaves
  // nothing stale but the epoch.
  //
  // It discriminates on WebKit alone. Chromium moves focus to the Discard
  // button when it is pressed, blurring the input and committing the draft
  // before Discard runs, so the stale text is gone there either way.
  // `npm run test:browser` is Chromium only and passes this for the wrong
  // reason; the full matrix under `verify:release` is what exercises it. If
  // the project list is ever trimmed for speed, this test needs WebKit or it
  // stops discriminating.
  const radius = await armProximityAlarm(page)
  // Drive the committed value down to the 1 m floor and let it settle. The
  // focus move is load-bearing, not cosmetic: it blurs the input so the draft
  // commits, which is what establishes the floor as the committed value.
  // `.focus()` rather than a click, so it cannot also toggle the section.
  await radius.fill('0')
  await page.getByRole('button', { name: 'Data sources' }).focus()
  // Keep this as an assertion. If it ever reads anything else the setup has
  // failed and everything after it is vacuous.
  expect(await radius.inputValue()).toBe('1')

  // Now a draft that resolves to the SAME committed value, so the field
  // reports no change and only the epoch can clear the raw text.
  await radius.fill('0')
  expect(await radius.inputValue()).toBe('0')

  const discard = page.getByRole('button', { name: 'Discard', exact: true })
  await expect(discard).toBeEnabled()
  await discard.click()
  // The pre-edit value is the 500 m default, shown in metric because the
  // fixture serves no unit preferences.
  await expect(radius).toHaveValue('500')
})

test('Discard restores an edited field and clears the dirty state', async ({ page }) => {
  await page.getByRole('button', { name: 'Garmin ActiveCaptain', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced' }).first().click()

  const cache = page.getByRole('spinbutton', { name: /Cache duration/ })
  // Read the default rather than naming it, so changing it does not break this.
  const before = await cache.inputValue()
  await cache.fill('99')
  // Several regions carry role="status", so the text filter is what picks the
  // save bar's out of them.
  const unsaved = page.getByRole('status').filter({ hasText: 'Unsaved changes' })
  await expect(unsaved).toBeVisible()

  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(cache).toHaveValue(before)
  await expect(unsaved).toHaveCount(0)
})

test('blocks Save on an Overpass endpoint the plugin would silently replace', async ({ page }) => {
  // The plugin coerces an unusable endpoint to the FOSSGIS default, in its
  // input module and in the panel's own normalizeConfig alike, so a typo that
  // reached the save was written, ignored, and gone by the next mount with
  // OpenSeaMap querying an endpoint other than the one on screen.
  await page.getByRole('button', { name: 'OpenSeaMap', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced' }).first().click()

  const endpoint = page.getByRole('textbox', { name: /Overpass API endpoint URL/ })
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()

  // A host with no scheme: the shared coercion drops it.
  await endpoint.fill('overpass-api.de/api/interpreter')
  await expect(save).toBeDisabled()
  await expect(
    page.getByRole('status').filter({ hasText: 'Overpass API endpoint URL' })
  ).toBeVisible()

  await endpoint.fill('https://overpass.kumi.systems/api/interpreter')
  await expect(save).toBeEnabled()
})

test('renders lengths in feet on whole-foot bounds under an imperial preset', async ({ page }) => {
  // The only test that exercises the imperial path at all: every other
  // fixture mode 404s the unit-preferences ladder, which resolves to metric.
  await gotoFixture(page, '?imperial')
  const radius = await armProximityAlarm(page)
  // The 500 m default, converted for display. The configuration stays metric.
  await expect(radius).toHaveValue('1640.42')

  // The stored floor is 1 m, which is 3.28 ft. A whole-unit field rounds that
  // up to the next whole foot, so the spinner steps on the grid its own step
  // describes and a numeric keypad, which has no decimal key, can reach the
  // floor at all.
  await expect(radius).toHaveAttribute('min', '4')
  await expect(radius).toHaveAttribute('step', '1')
  await expect(radius).toHaveAttribute('inputmode', 'numeric')
})

test('has no Axe findings or horizontal overflow at 320 pixels', async ({ page }) => {
  // The collapsed panel shows almost none of its controls, so a sweep of the
  // landing state would audit the section headers and little else. Open one
  // source card and its Advanced disclosure, which between them render every
  // field kind the panel has (checkbox group, number field, select, text
  // input, and textarea), open Alerts for the alarm toggles, and take the
  // fixture that renders the recent-error list with its jump buttons.
  await page.setViewportSize({ width: 320, height: 900 })
  await gotoFixture(page, '?errors')
  await page.getByRole('button', { name: 'OpenSeaMap', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced' }).first().click()
  // Armed, so the radius renders as a live control: Axe exempts a disabled
  // one from the contrast rules this sweep is here to run.
  const radius = await armProximityAlarm(page)
  await expect(radius).toBeEnabled()

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
  await gotoFixture(page, '?errors')

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
  await gotoFixture(page, '?unsupported-css-scope')
  await expect(page.locator('[data-browser-compatibility-message]')).toContainText(
    'Browser update required'
  )
  await expect(page.locator('[data-snui-root]')).toHaveCount(0)
})

test('announces a status-poll failure from a region that predates the message', async ({ page }) => {
  // A live region created in the same commit as its text is not announced
  // reliably, so the banner stays mounted and empty while the endpoint is
  // healthy and only its content changes when a poll fails. The empty region
  // on a healthy panel is the half a conditional banner cannot have.
  const banner = page.locator('#ac-status-banner')
  await expect(banner).toHaveAttribute('role', 'status')
  await expect(banner).toBeEmpty()
  // An always-mounted banner must not draw a danger box over a healthy panel,
  // so the empty one is out of the flow and paints nothing.
  const emptyBox = await banner.boundingBox()
  expect(emptyBox?.height ?? 0).toBeLessThanOrEqual(1)

  await gotoFixture(page, '?status-error')
  await expect(banner).toContainText('Status unavailable')
  await expect(banner).toContainText('The plugin returned HTTP 503. The next poll will retry automatically.')

  // One element shows the failure and announces it, so a screen reader hears
  // it once and the operator reads the same words on screen.
  const announcing = page
    .locator('[data-snui-root] [role="status"], [data-snui-root] [role="alert"], [data-snui-root] [aria-live]')
    .filter({ hasText: 'Status unavailable' })
  await expect(announcing).toHaveCount(1)
  await expect(announcing).toHaveAttribute('id', 'ac-status-banner')
  await expect(announcing).toBeVisible()

  // The failure is on screen, not only in the accessibility tree.
  const onScreen = page.getByText('The plugin returned HTTP 503. The next poll will retry automatically.', { exact: true })
  await expect(onScreen).toHaveCount(1)
  await expect(onScreen).toBeVisible()
})

test('opens a collapsed Data sources section when jumping to a source', async ({ page }) => {
  await gotoFixture(page, '?errors')

  const section = page.getByRole('button', { name: 'Data sources' })
  await section.click()
  await expect(section).toHaveAttribute('aria-expanded', 'false')
  const card = page.getByRole('button', { name: 'OpenSeaMap', exact: true })
  await expect(card).toBeHidden()

  // The recent-error list is the only place this button exists, and the
  // section it points into is the one the operator just closed.
  await page.getByRole('button', { name: 'Show OpenSeaMap', exact: true }).click()

  await expect(section).toHaveAttribute('aria-expanded', 'true')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('aria-expanded', 'true')
  await expect(card).toBeInViewport()
  // Focus reaches a card that React had to reveal in the same commit, which
  // pins the handoff as running after the reveal rather than racing it.
  await expect(page.locator(':focus')).toHaveAccessibleName('OpenSeaMap')
})

test('moves focus to the revealed card when jumping to a source', async ({ page }) => {
  await gotoFixture(page, '?errors')

  await page.getByRole('button', { name: 'Show OpenSeaMap', exact: true }).click()

  // Focus lands on the card's own disclosure toggle: it names the source and
  // reports that the card is now expanded, so the destination is announced
  // rather than merely scrolled to, and the next Tab reaches the first field
  // instead of the rest of the error list.
  const focused = page.locator(':focus')
  await expect(focused).toHaveAccessibleName('OpenSeaMap')
  await expect(focused).toHaveAttribute('aria-expanded', 'true')
})
