import assert from 'node:assert/strict'
import { normalizePackReport } from './package-report.mjs'

const report = { filename: 'test-package-1.0.0.tgz', files: [{ path: 'package.json' }] }

assert.equal(normalizePackReport([report]), report, 'npm 11 array reports must remain supported')
assert.equal(normalizePackReport(report), report, 'direct object reports must remain supported')
assert.equal(
  normalizePackReport({ 'test-package': report }),
  report,
  'npm 12 keyed object reports must remain supported'
)
assert.throws(() => normalizePackReport([]), /no package report/)
assert.throws(() => normalizePackReport(null), /no package report/)
assert.throws(() => normalizePackReport({ first: report, second: report }), /no package report/)

process.stdout.write('Package report compatibility tests passed.\n')
