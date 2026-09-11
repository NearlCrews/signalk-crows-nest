import test from 'node:test'
import assert from 'node:assert/strict'
import { brotliCompressSync, gzipSync } from 'node:zlib'
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

/**
 * The decompression-bomb guard. `maxResponseBytes` exists to stop a hostile or
 * broken upstream exhausting the plugin process's memory, so it has to bound
 * what the process actually holds: the DECOMPRESSED body. A few kilobytes on
 * the wire inflate to megabytes here, so a cap applied to the compressed
 * stream would wave this through.
 */
test('requestText counts the byte limit against decompressed, not compressed, bytes', async () => {
  const CAP = 64 * 1024
  const bomb = gzipSync(Buffer.alloc(16 * 1024 * 1024, 0x61))
  // The load-bearing assertion: the compressed stream fits inside the cap with
  // room to spare, so a cap enforced on the input would let the whole 16 MB
  // through. Only a cap on the output can reject this.
  assert.ok(bomb.length < CAP,
    `the compressed body (${bomb.length} bytes) must fit under the ${CAP}-byte cap`)

  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
    res.end(bomb)
  })
  try {
    const started = Date.now()
    await assert.rejects(
      () => requestText(server.url, {}, 5000, 'bomb', undefined, CAP),
      new RegExp(`response exceeds ${CAP} bytes`)
    )
    // Aborting on the inflating stream rather than after it finishes: the
    // whole 16 MB never lands in the buffer, so the rejection is prompt.
    assert.ok(Date.now() - started < 3000, 'the cap aborts mid-inflation, not after')
  } finally {
    await server.close()
  }
})

test('requestText advertises only the encodings it can decode', async () => {
  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('plain')
  })
  try {
    await requestText(server.url, {}, 1000, 'accept-encoding')
    assert.equal(server.requests.at(-1)?.headers['accept-encoding'], 'gzip, br')
  } finally {
    await server.close()
  }
})

test('requestText lets a caller override the advertised encodings', async () => {
  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('plain')
  })
  try {
    await requestText(server.url, { 'Accept-Encoding': 'identity' }, 1000, 'override')
    assert.equal(server.requests.at(-1)?.headers['accept-encoding'], 'identity')
  } finally {
    await server.close()
  }
})

test('requestText decodes a gzip response body', async () => {
  const payload = JSON.stringify({ stations: [{ id: '8447386', name: 'Fall River' }] })
  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
    res.end(gzipSync(Buffer.from(payload, 'utf8')))
  })
  try {
    const response = await requestText(server.url, {}, 1000, 'gzip')
    assert.equal(response.status, 200)
    assert.equal(response.body, payload)
  } finally {
    await server.close()
  }
})

test('requestText decodes a brotli response body', async () => {
  // services7.arcgis.com, which serves the USACE Locks layer, answers `br`
  // when brotli is advertised, so this is a live path rather than a courtesy.
  const payload = JSON.stringify({ features: [{ id: 1 }] })
  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'br' })
    res.end(brotliCompressSync(Buffer.from(payload, 'utf8')))
  })
  try {
    const response = await requestText(server.url, {}, 1000, 'brotli')
    assert.equal(response.body, payload)
  } finally {
    await server.close()
  }
})

test('requestText rejects a Content-Encoding it never advertised', async () => {
  // Handing compressed bytes to a JSON parser would fail confusingly one layer
  // up, so an encoding this transport cannot decode fails here, by name.
  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'deflate' })
    res.end(Buffer.from([0x78, 0x9c, 0x03, 0x00]))
  })
  try {
    await assert.rejects(
      () => requestText(server.url, {}, 1000, 'unsupported'),
      /unsupported.*Content-Encoding "deflate"/
    )
  } finally {
    await server.close()
  }
})

test('requestText resolves an empty body for a 304 that echoes Content-Encoding', async () => {
  // A 304 carries no body but may repeat the header fields a 200 would have
  // sent. Feeding those zero bytes to a decompressor errors ("unexpected end
  // of file"), which would break every conditional GET the moment an upstream
  // started compressing.
  const server = await startStubServer((_req, res) => {
    res.writeHead(304, { 'Content-Encoding': 'gzip', ETag: '"abc"' })
    res.end()
  })
  try {
    const response = await requestText(server.url, {}, 1000, 'not-modified')
    assert.equal(response.status, 304)
    assert.equal(response.body, '')
    assert.equal(response.headers.etag, '"abc"')
  } finally {
    await server.close()
  }
})

test('requestText decodes a compressed error body', async () => {
  // ArcGIS reports a bad layer id as HTTP 200 with an `{ error }` payload, and
  // encdirect.noaa.gov gzips that body like any other. The caller's non-2xx
  // and error-shape handling both read `body`, so it has to be decoded
  // whatever the status says.
  const payload = JSON.stringify({ error: { code: 400, message: 'Invalid layer' } })
  const server = await startStubServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
    res.end(gzipSync(Buffer.from(payload, 'utf8')))
  })
  try {
    const response = await requestText(server.url, {}, 1000, 'error body')
    assert.equal(response.status, 400)
    assert.equal(response.body, payload)
  } finally {
    await server.close()
  }
})

test('requestText surfaces a decompressor failure as a labeled client error', async () => {
  // Truncated or corrupt compressed bytes must reject through the same path
  // every other transport failure takes, so the source's status recording sees
  // it, rather than escaping as an unhandled stream error.
  const server = await startStubServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
    res.end(Buffer.from('not actually gzip at all', 'utf8'))
  })
  try {
    await assert.rejects(
      () => requestText(server.url, {}, 1000, 'corrupt'),
      (error: Error) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /corrupt/)
        return true
      }
    )
  } finally {
    await server.close()
  }
})
