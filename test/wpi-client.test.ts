/**
 * Tests for the World Port Index HTTP client.
 *
 * The client fetches the whole index in one GET (the endpoint is not
 * bounding-box queryable), so an in-process HTTP server stands in for NGA MSI:
 * the tests assert the request path and User-Agent, that the `{ ports }`
 * envelope is unwrapped, and that a non-2xx response rejects. The client uses
 * the raw one-shot transport (node http), not global fetch, so the mock is a
 * real server rather than a fetch stub.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { gzipSync } from 'node:zlib'
import { createWpiClient } from '../src/inputs/wpi/wpi-client.js'
import { startStubServer, type StubServer } from './helpers.js'

async function startServer (
  handler: (req: IncomingMessage) => { status?: number, body: unknown }
): Promise<StubServer> {
  return startStubServer((req, res) => {
    const { status = 200, body } = handler(req)
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
}

const samplePorts = [
  { portNumber: 7630, portName: 'Brooklyn', xcoord: -74.0167, ycoord: 40.6667, harborSize: 'L' },
  { portNumber: 48430, portName: 'Abadan', xcoord: 48.2833, ycoord: 30.3333, harborSize: 'M' }
]

test('fetchAllPorts requests the WPI publication path and unwraps the ports array', async () => {
  const server = await startServer(() => ({ body: { ports: samplePorts } }))
  try {
    const client = createWpiClient({ baseUrl: server.url })
    const ports = await client.fetchAllPorts()
    assert.equal(ports.length, 2)
    assert.equal(ports[0].portName, 'Brooklyn')
    assert.equal(ports[1].portNumber, 48430)
    const url = server.requests[0]?.url ?? ''
    assert.ok(url.startsWith('/api/publications/world-port-index'), `unexpected path ${url}`)
    assert.ok(url.includes('output=json'))
  } finally {
    await server.close()
  }
})

test('fetchAllPorts sends the descriptive User-Agent header', async () => {
  const server = await startServer(() => ({ body: { ports: [] } }))
  try {
    const client = createWpiClient({ baseUrl: server.url })
    await client.fetchAllPorts()
    const ua = String(server.requests[0]?.headers['user-agent'] ?? '')
    assert.match(ua, /signalk-crows-nest/)
  } finally {
    await server.close()
  }
})

test('fetchAllPorts rejects when the envelope carries no ports array', async () => {
  // Valid JSON in an unexpected shape, which is what an upstream envelope
  // rename looks like. Coercing the missing array to an empty list told the
  // source the index really had emptied, and its authoritative replace wiped
  // every port while the list call still reported a fresh fetch.
  const server = await startServer(() => ({ body: {} }))
  try {
    const client = createWpiClient({ baseUrl: server.url })
    await assert.rejects(() => client.fetchAllPorts(), /ports/)
  } finally {
    await server.close()
  }
})

test('fetchAllPorts resolves to an empty array when the upstream publishes no ports', async () => {
  // An explicitly empty array is a legitimate answer and must stay
  // representable without an error.
  const server = await startServer(() => ({ body: { ports: [] } }))
  try {
    const client = createWpiClient({ baseUrl: server.url })
    assert.deepEqual(await client.fetchAllPorts(), [])
  } finally {
    await server.close()
  }
})

test('fetchAllPorts rejects on a non-2xx response', async () => {
  const server = await startServer(() => ({ status: 503, body: 'unavailable' }))
  try {
    const client = createWpiClient({ baseUrl: server.url })
    await assert.rejects(() => client.fetchAllPorts(), /World Port Index HTTP 503/)
  } finally {
    await server.close()
  }
})

test('fetchAllPorts decodes a gzip-compressed full dump', async () => {
  // The live NGA endpoint answers `gzip` when it is advertised (measured
  // 2026-09-09: 6,316,131 bytes uncompressed, 578,874 compressed, the largest
  // single saving in the plugin).
  const server = await startStubServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Encoding', 'gzip')
    res.end(gzipSync(Buffer.from(JSON.stringify({ ports: samplePorts }), 'utf8')))
  })
  try {
    const client = createWpiClient({ baseUrl: server.url })
    const ports = await client.fetchAllPorts()
    assert.equal(ports.length, 2)
    assert.equal(ports[0].portName, 'Brooklyn')
    assert.equal(server.requests[0]?.headers['accept-encoding'], 'gzip, br')
  } finally {
    await server.close()
  }
})
