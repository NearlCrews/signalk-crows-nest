import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'assets/screenshots/admin-panel.png')
const vite = execFile(process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--config',
  'fixtures/browser/vite.config.ts'
], { cwd: root })

async function waitForFixture () {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (vite.exitCode !== null) {
      throw new Error(`The browser fixture exited early with code ${vite.exitCode}.`)
    }
    try {
      const response = await fetch('http://127.0.0.1:4177/', {
        signal: AbortSignal.timeout(1_000)
      })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('The browser fixture did not start within 15 seconds.')
}

let browser
try {
  await waitForFixture()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1120, height: 1260 } })
  await page.clock.setFixedTime(new Date('2026-08-12T16:00:00.000Z'))
  await page.goto('http://127.0.0.1:4177/?screenshot', { waitUntil: 'networkidle' })
  await page.locator('body[data-fixture-ready="true"]').waitFor()
  await page.getByRole('radio', { name: 'Light' }).click()
  await mkdir(resolve(root, 'assets/screenshots'), { recursive: true })
  await page.screenshot({ path: output, animations: 'disabled' })
  process.stdout.write(`Captured current panel screenshot: ${output}\n`)
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
