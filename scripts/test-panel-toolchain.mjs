import assert from 'node:assert/strict'
import { supportsPanelToolchain } from './panel-toolchain.mjs'

// Babel 8 declares `node: ^22.18.0 || >=24.11.0`; the predicate must follow
// that range exactly, including the gap at Node 23.
assert.equal(supportsPanelToolchain('20.19.5'), false, 'Node 20 cannot run the panel toolchain')
assert.equal(supportsPanelToolchain('22.17.9'), false, 'Node 22 below 22.18 is excluded')
assert.equal(supportsPanelToolchain('22.18.0'), true, 'Node 22.18.0 is the Node 22 floor')
assert.equal(supportsPanelToolchain('22.22.2'), true, 'later Node 22 releases qualify')
assert.equal(supportsPanelToolchain('23.11.0'), false, 'Node 23 falls in the gap of the range')
assert.equal(supportsPanelToolchain('24.10.9'), false, 'Node 24 below 24.11 is excluded')
assert.equal(supportsPanelToolchain('24.11.0'), true, 'Node 24.11.0 is the Node 24 floor')
assert.equal(supportsPanelToolchain('26.0.0'), true, 'every later major qualifies')
assert.equal(supportsPanelToolchain('garbage'), false, 'an unparsable version never qualifies')

process.stdout.write('Panel toolchain floor tests passed.\n')
