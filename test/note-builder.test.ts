import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNoteResource,
  readProperty,
  type NoteResourceInput
} from '../src/outputs/notes-resource/note-builder.js'

const SAMPLE_URL = 'https://activecaptain.garmin.com/en-US/pois/7'
const SAMPLE_SOURCE = 'activecaptain'
const SAMPLE_ATTRIBUTION = 'Data from Garmin ActiveCaptain'

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

test('buildNoteResource omits timestamp and description when not supplied', () => {
  const note = buildNoteResource(input())
  assert.equal(note.name, 'Dock')
  assert.equal(note.url, SAMPLE_URL)
  assert.equal(note.timestamp, undefined)
  assert.equal(note.description, undefined)
  assert.deepEqual(note.properties, {
    readOnly: true,
    skIcon: 'marina',
    source: SAMPLE_SOURCE,
    attribution: SAMPLE_ATTRIBUTION
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
  assert.equal(properties.sourceCount, 2)
})

test('buildNoteResource omits corroboration for a single contributing source', () => {
  const note = buildNoteResource(input({ sources: ['activecaptain'] }))
  const properties = note.properties as Record<string, unknown>
  assert.equal(properties.sources, undefined, 'one source is not a corroboration signal')
  assert.equal(properties.sourceCount, undefined)
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
