import test from 'node:test'
import assert from 'node:assert/strict'
import { POI_TYPE_GROUPS } from '../src/panel/poi-type-groups.js'
import { POI_TYPE_FLAGS } from '../src/shared/poi-type-selection.js'

test('the groups cover exactly the 13 POI-type flags, each once', () => {
  const grouped = POI_TYPE_GROUPS.flatMap((group) => group.options.map((option) => option.flag))
  assert.equal(grouped.length, new Set(grouped).size, 'no flag is repeated across groups')
  const expected = POI_TYPE_FLAGS.map(([flag]) => flag).sort()
  assert.deepEqual([...grouped].sort(), expected, 'the groups cover exactly the POI-type flags')
})

test('every group has a non-empty title and labeled options', () => {
  assert.equal(POI_TYPE_GROUPS.length, 4, 'there are four POI-type groups')
  for (const group of POI_TYPE_GROUPS) {
    assert.ok(group.title.length > 0, 'the group has a title')
    assert.ok(group.options.length > 0, 'the group has at least one option')
    for (const option of group.options) {
      assert.ok(option.label.length > 0, `${option.flag} has a display label`)
    }
  }
})
