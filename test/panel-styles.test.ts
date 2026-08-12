/**
 * Contract tests for the panel's style module.
 *
 * Two regressions these lock out:
 * - Reintroducing a local runtime stylesheet and its host-nonce dependency.
 * - Dead `--ac-*` aliases: every inline alias PanelRoot declares must be
 *   consumed somewhere in the style module, or it is unused surface that a
 *   future token rename has to be audited against for nothing.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PANEL_STYLE, S } from '../src/panel/styles.js'

test('panel aliases are inline custom properties backed by public UI tokens', () => {
  for (const [name, value] of Object.entries(PANEL_STYLE)) {
    assert.match(name, /^--ac-[a-z0-9-]+$/)
    if (name !== '--ac-font-small' && name !== '--ac-font-title') {
      assert.match(String(value), /var\(--snui-/)
    }
  }
})

test('every declared --ac-* alias is consumed by the style module', () => {
  const declared = new Set(Object.keys(PANEL_STYLE))
  assert.ok(declared.size > 0)
  const usage = JSON.stringify(S)
  const consumed = new Set(
    [...usage.matchAll(/var\((--ac-[a-z0-9-]+)/g)].map((match) => match[1])
  )
  const dead = [...declared].filter((name) => !consumed.has(name))
  assert.deepEqual(dead, [])
})

test('the panel documents strict CSP without scraping a host nonce', () => {
  const panelSource = readFileSync(resolve('src/panel/PluginConfigurationPanel.tsx'), 'utf8')
  const developmentGuide = readFileSync(resolve('docs/development.md'), 'utf8')

  assert.doesNotMatch(panelSource, /discoverStyleNonce|querySelectorAll\(['"]script, style/)
  assert.match(developmentGuide, /does not expose\s+a documented style-nonce API/)
  assert.match(developmentGuide, /`PanelRoot` through its `styleNonce` prop/)
})
