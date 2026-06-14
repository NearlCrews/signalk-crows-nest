import test from 'node:test'
import assert from 'node:assert/strict'
import { combineAbortSignals } from '../src/shared/abort.js'

test('a single defined signal is returned directly, without an AbortSignal.any wrapper', () => {
  const controller = new AbortController()
  const combined = combineAbortSignals([controller.signal, undefined])
  assert.equal(combined, controller.signal)
})

test('the combined signal aborts when any of its inputs aborts', () => {
  const a = new AbortController()
  const b = new AbortController()
  const combined = combineAbortSignals([a.signal, b.signal])
  assert.equal(combined.aborted, false)
  b.abort()
  assert.equal(combined.aborted, true)
})

test('an already-aborted input yields an already-aborted combined signal', () => {
  const live = new AbortController()
  const combined = combineAbortSignals([live.signal, AbortSignal.abort()])
  assert.equal(combined.aborted, true)
})
