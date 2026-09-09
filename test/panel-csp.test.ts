/**
 * Contract test for the panel's Content Security Policy stance.
 *
 * The regression this locks out: reintroducing a local runtime stylesheet
 * whose nonce is scraped from arbitrary host `script` or `style` elements.
 * Signal K Admin exposes no trusted style-nonce contract, so the panel must
 * neither scan for one nor claim to. The development guide states the stance
 * and names the supported handoff (`styleNonce` on the shared panel root) for
 * the day the host provides a nonce.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('the panel documents strict CSP without scraping a host nonce', () => {
  const panelSource = readFileSync(resolve('src/panel/PluginConfigurationPanel.tsx'), 'utf8')
  const developmentGuide = readFileSync(resolve('docs/development.md'), 'utf8')

  assert.doesNotMatch(panelSource, /discoverStyleNonce|querySelectorAll\(['"]script, style/)
  assert.match(developmentGuide, /does not expose\s+a documented style-nonce API/)
  assert.match(developmentGuide, /`PanelRoot` through its `styleNonce` prop/)
})

test('the panel styles itself from the shared UI alone', () => {
  // No panel-local token vocabulary or inline style module remains: every
  // surface comes from the shared components and their public --snui-* tokens.
  const panelSources = ['src/panel/PluginConfigurationPanel.tsx', 'src/panel/components/DataSourceCard.tsx', 'src/panel/components/StatusBar.tsx']
    .map((path) => readFileSync(resolve(path), 'utf8'))
    .join('\n')
  assert.doesNotMatch(panelSources, /--ac-|from '\.\.?\/styles\.js'|style=\{/)
})
