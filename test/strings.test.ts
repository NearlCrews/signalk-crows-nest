/**
 * Tests for the shared string helpers.
 *
 * The serial comma is the point: it is a house rule, and each caller had got
 * it slightly wrong on its own before the joiner existed. `presentString` and
 * `capitalizeFirst` have no direct coverage yet; this is their obvious home
 * when they get it.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { joinWords } from '../src/shared/strings.js'

test('joins by count, with a serial comma from three items up', () => {
  assert.equal(joinWords([]), '')
  assert.equal(joinWords(['proximity']), 'proximity')
  assert.equal(joinWords(['proximity', 'route corridor']), 'proximity and route corridor')
  assert.equal(
    joinWords(['proximity', 'route corridor', 'bridge air draft']),
    'proximity, route corridor, and bridge air draft'
  )
  assert.equal(joinWords(['a', 'b', 'c', 'd']), 'a, b, c, and d')
})
