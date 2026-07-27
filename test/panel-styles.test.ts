/**
 * Contract tests for the panel's style module.
 *
 * Two regressions these lock out:
 * - Depending on the shared UI library's private class names (the library's
 *   design contract declares internal classes and DOM nesting private API, so
 *   a selector like `button:not(.snui-button)` can silently start matching
 *   the wrong elements on any library release).
 * - Dead `--ac-*` aliases: every alias the theme block declares must be
 *   consumed somewhere in the style module, or it is unused surface that a
 *   future token rename has to be audited against for nothing.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { PLAIN_BUTTON_CLASS, S, THEME_STYLE } from '../src/panel/styles.js'

test('THEME_STYLE never references the shared library private class names', () => {
  // `--snui-*` custom properties are the library's public token API and are
  // fine; `.snui-` class selectors are private API and are not.
  assert.ok(!THEME_STYLE.includes('.snui-'))
})

test('THEME_STYLE styles the panel-owned plain buttons through the opt-in class', () => {
  assert.ok(THEME_STYLE.includes(`.${PLAIN_BUTTON_CLASS}`))
})

test('every declared --ac-* alias is consumed by the style module', () => {
  const declared = new Set(THEME_STYLE.match(/--ac-[a-z0-9-]+(?=:)/g))
  assert.ok(declared.size > 0)
  const usage = THEME_STYLE + JSON.stringify(S)
  const consumed = new Set(
    [...usage.matchAll(/var\((--ac-[a-z0-9-]+)/g)].map((match) => match[1])
  )
  const dead = [...declared].filter((name) => !consumed.has(name))
  assert.deepEqual(dead, [])
})
