import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNoteResource, readProperty } from '../src/outputs/notes-resource/note-builder.js'

test('buildNoteResource omits timestamp and description when not supplied', () => {
  const note = buildNoteResource('7', 'Dock', { latitude: 1, longitude: 2 }, 'marina')
  assert.equal(note.name, 'Dock')
  assert.equal(note.url, 'https://activecaptain.garmin.com/en-US/pois/7')
  assert.equal(note.timestamp, undefined)
  assert.equal(note.description, undefined)
  assert.deepEqual(note.properties, { readOnly: true, skIcon: 'marina' })
})

test('buildNoteResource includes html description and mimeType when supplied', () => {
  const note = buildNoteResource('7', 'Dock', { latitude: 1, longitude: 2 }, 'marina',
    '2020-01-01T00:00:00.000Z', '<p>hi</p>')
  assert.equal(note.description, '<p>hi</p>')
  assert.equal(note.mimeType, 'text/html')
  assert.equal(note.timestamp, '2020-01-01T00:00:00.000Z')
})

test('readProperty reads a dot path and returns undefined for a miss', () => {
  const note = buildNoteResource('7', 'Dock', { latitude: 1, longitude: 2 }, 'marina')
  assert.equal(readProperty(note, 'properties.skIcon'), 'marina')
  assert.equal(readProperty(note, 'properties.nope'), undefined)
})

test('readProperty returns undefined when an intermediate segment is not an object', () => {
  const note = buildNoteResource('7', 'Dock', { latitude: 1, longitude: 2 }, 'marina')
  // `name` is the string 'Dock', so descending into `name.foo` cannot resolve;
  // readProperty must return undefined rather than throw on the string.
  assert.doesNotThrow(() => readProperty(note, 'name.foo'))
  assert.equal(readProperty(note, 'name.foo'), undefined)
})
