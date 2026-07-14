import test from 'node:test'
import assert from 'node:assert/strict'
import { requestText } from '../src/inputs/http-one-shot.js'
import { startStubServer } from './helpers.js'

test('requestText enforces a wall-clock deadline while bytes keep arriving', async () => {
  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    const interval = setInterval(() => res.write('x'), 5)
    res.once('close', () => clearInterval(interval))
  })
  try {
    const started = Date.now()
    await assert.rejects(
      () => requestText(server.url, {}, 40, 'trickle'),
      /timed out after 40 ms/
    )
    assert.ok(Date.now() - started < 500, 'a trickling body cannot extend the deadline')
  } finally {
    await server.close()
  }
})

test('requestText rejects a streamed body that exceeds its byte limit', async () => {
  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.write('1234')
    res.end('5678')
  })
  try {
    await assert.rejects(
      () => requestText(server.url, {}, 1000, 'large body', undefined, 6),
      /response exceeds 6 bytes/
    )
  } finally {
    await server.close()
  }
})

test('requestText validates deadline and body-limit arguments', async () => {
  await assert.rejects(
    () => requestText('http://127.0.0.1/', {}, 0, 'invalid'),
    /timeoutMs must be a positive finite number/
  )
  await assert.rejects(
    () => requestText('http://127.0.0.1/', {}, 1, 'invalid', undefined, Number.NaN),
    /maxResponseBytes must be a positive safe integer/
  )
})
