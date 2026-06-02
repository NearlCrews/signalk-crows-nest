import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNoteResource,
  readProperty,
  type NoteResourceInput
} from '../src/outputs/notes-resource/note-builder.js'
import { NORMALIZED_DETAIL_SCHEMA_VERSION } from '../src/shared/normalized-detail.js'

const SAMPLE_URL = 'https://activecaptain.garmin.com/en-US/pois/7'
const SAMPLE_SOURCE = 'activecaptain'
const SAMPLE_ATTRIBUTION = 'Data from Garmin ActiveCaptain'
const PLUGIN_ID = 'signalk-crows-nest'
const PLUGIN_REPO_URL = 'https://github.com/NearlCrews/signalk-crows-nest'

/** Build a NoteResourceInput for the fixture POI, with overrides merged on top. */
function input (overrides: Partial<NoteResourceInput> = {}): NoteResourceInput {
  return {
    name: 'Dock',
    position: { latitude: 1, longitude: 2 },
    skIcon: 'marina',
    url: SAMPLE_URL,
    source: SAMPLE_SOURCE,
    attribution: SAMPLE_ATTRIBUTION,
    ...overrides
  }
}

test('publishes normalized detail under properties.crowsNest when sections are supplied', () => {
  const note = buildNoteResource(input({
    type: 'Navigational',
    sections: [
      { id: 'light', title: 'Light', items: [{ label: 'Character', value: 'flashing', kind: 'text' }] }
    ]
  }))
  const properties = note.properties as Record<string, unknown>
  const crowsNest = properties.crowsNest as Record<string, unknown>
  assert.equal(crowsNest.schemaVersion, NORMALIZED_DETAIL_SCHEMA_VERSION)
  assert.equal(crowsNest.type, 'Navigational')
  assert.deepEqual(crowsNest.sections, [
    { id: 'light', title: 'Light', items: [{ label: 'Character', value: 'flashing', kind: 'text' }] }
  ])
  // The standard fields and HTML path are untouched: a generic consumer still
  // sees a normal note.
  assert.equal(note.name, 'Dock')
  assert.equal(properties.skIcon, 'marina')
})

test('publishes crowsNest with type but no sections for a list-style note', () => {
  // A list entry carries the POI type (so a marker can be styled without a
  // detail fetch) but omits the heavy per-POI sections.
  const note = buildNoteResource(input({ type: 'Marina' }))
  const properties = note.properties as Record<string, unknown>
  const crowsNest = properties.crowsNest as Record<string, unknown>
  assert.equal(crowsNest.schemaVersion, NORMALIZED_DETAIL_SCHEMA_VERSION)
  assert.equal(crowsNest.type, 'Marina')
  assert.equal(crowsNest.sections, undefined, 'a list entry carries no sections')
})

test('omits properties.crowsNest entirely when neither type nor sections is supplied', () => {
  const note = buildNoteResource(input())
  const properties = note.properties as Record<string, unknown>
  assert.equal(properties.crowsNest, undefined, 'no type and no sections means no crowsNest blob')
})

test('buildNoteResource omits timestamp and description when not supplied', () => {
  const note = buildNoteResource(input())
  assert.equal(note.name, 'Dock')
  assert.equal(note.url, SAMPLE_URL)
  assert.equal(note.timestamp, undefined)
  assert.equal(note.description, undefined)
  assert.deepEqual(note.properties, {
    skIcon: 'marina',
    source: SAMPLE_SOURCE,
    attribution: SAMPLE_ATTRIBUTION,
    plugin: PLUGIN_ID,
    pluginRepo: PLUGIN_REPO_URL
  })
})

test('buildNoteResource includes html description and mimeType when supplied', () => {
  const note = buildNoteResource(input({
    timestamp: '2020-01-01T00:00:00.000Z',
    description: '<p>hi</p>'
  }))
  assert.equal(note.description, '<p>hi</p>')
  assert.equal(note.mimeType, 'text/html')
  assert.equal(note.timestamp, '2020-01-01T00:00:00.000Z')
})

test('buildNoteResource carries corroboration when more than one source contributed', () => {
  const note = buildNoteResource(input({ sources: ['activecaptain', 'openseamap'] }))
  const properties = note.properties as Record<string, unknown>
  assert.deepEqual(properties.sources, ['activecaptain', 'openseamap'])
  // sourceCount is intentionally not published: it would be derivable from
  // sources.length and inviting the two to disagree silently is worse than
  // making the consumer read the length.
  assert.equal(properties.sourceCount, undefined)
})

test('buildNoteResource omits corroboration for a single contributing source', () => {
  const note = buildNoteResource(input({ sources: ['activecaptain'] }))
  const properties = note.properties as Record<string, unknown>
  assert.equal(properties.sources, undefined, 'one source is not a corroboration signal')
})

test('readProperty reads a dot path and returns undefined for a miss', () => {
  const note = buildNoteResource(input())
  assert.equal(readProperty(note, 'properties.skIcon'), 'marina')
  assert.equal(readProperty(note, 'properties.source'), SAMPLE_SOURCE)
  assert.equal(readProperty(note, 'properties.attribution'), SAMPLE_ATTRIBUTION)
  assert.equal(readProperty(note, 'properties.nope'), undefined)
})

test('readProperty returns undefined when an intermediate segment is not an object', () => {
  const note = buildNoteResource(input())
  // `name` is the string 'Dock', so descending into `name.foo` cannot resolve;
  // readProperty must return undefined rather than throw on the string.
  assert.doesNotThrow(() => readProperty(note, 'name.foo'))
  assert.equal(readProperty(note, 'name.foo'), undefined)
})
