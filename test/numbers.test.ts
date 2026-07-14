import test from 'node:test'
import assert from 'node:assert/strict'
import { toPositiveSafeInteger } from '../src/shared/numbers.js'

test('toPositiveSafeInteger accepts positive integers and plain decimal text', () => {
  assert.equal(toPositiveSafeInteger(42), 42)
  assert.equal(toPositiveSafeInteger('42'), 42)
})

test('toPositiveSafeInteger rejects partial, alternate, and unsafe spellings', () => {
  for (const value of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '',
    '0',
    '-1',
    '+1',
    '01',
    '1.5',
    '1e2',
    '12junk',
    String(Number.MAX_SAFE_INTEGER + 1)
  ]) {
    assert.equal(toPositiveSafeInteger(value), null, `expected ${String(value)} to be rejected`)
  }
})
